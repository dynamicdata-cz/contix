import { SOC_SEVERITIES, effectiveLevel, socSeverity, type SocAiTriage, type SocConfidence, type SocExposure, type SocSeverity, type SocVerdict } from "./soc";

/* ============================================================
 * Úspěšnost SOC a AI (v0.58, ADR-053): doby převzetí a vyřešení, plnění lhůt, falešné poplachy podle zdroje
 * a shoda AI předběžné triáže s rozhodnutím analytika. Počítá se při čtení z alertů, nic se nepersistuje.
 * ============================================================ */

/** Třída výsledku: útok (eskalace / skutečný útok), šum (falešný poplach / neškodné), nelze určit. */
export type SocOutcome = "attack" | "noise" | "unknown";
export const outcomeOf = (v: SocVerdict | null | undefined): SocOutcome => (v === "true_positive" ? "attack" : v === "false_positive" || v === "benign" ? "noise" : "unknown");

/** Skutečný verdikt alertu: eskalovaný = skutečný útok, uzavřený = verdikt analytika, otevřený = null. */
export const actualVerdict = (status: string, verdict: string | null): SocVerdict | null =>
  status === "accepted" ? "true_positive" : status === "dismissed" ? ((verdict as SocVerdict | null) ?? "undetermined") : null;

export interface SocMetricRow {
  id: string;
  title: string;
  source: string;
  status: string;
  verdict: string | null;
  ruleLevel: number;
  exposure: SocExposure | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
  decidedAt: Date | null;
  aiTriage: SocAiTriage | null;
}

export interface SocMetricGroup {
  key: string;
  alerts: number;
  decided: number;
  escalated: number;
  noise: number;
  /** Podíl falešných poplachů a neškodných z rozhodnutých (≥ 3 rozhodnuté), jinak null. */
  fpRate: number | null;
  mttaMinutes: number | null;
  mttrHours: number | null;
  ackMet: number;
  ackTotal: number;
  resolveMet: number;
  resolveTotal: number;
}

export interface SocAiMetrics {
  /** Alerty s dokončeným návrhem (bez chyby). */
  triaged: number;
  errors: number;
  /** Rozhodnuté alerty, kde AI i analytik dali útok / šum. */
  compared: number;
  agree: number;
  agreement: number | null;
  /** AI navrhla „nelze určit“. */
  abstained: number;
  byConfidence: { confidence: SocConfidence; compared: number; agree: number }[];
  /** AI navrhla šum, ale šlo o útok – nejdůležitější chyba. */
  missed: { id: string; title: string }[];
  /** AI navrhla útok, analytik uzavřel jako šum. */
  overcalled: number;
  /** Matice návrh × skutečnost (třídy). */
  matrix: { suggested: SocOutcome; actual: SocOutcome; n: number }[];
  avgDurationMs: number | null;
}

export interface SocMetricsDto {
  days: number;
  from: string;
  total: SocMetricGroup;
  bySource: SocMetricGroup[];
  bySeverity: SocMetricGroup[];
  ai: SocAiMetrics;
  weekly: { week: string; alerts: number; escalated: number; noise: number }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
const mondayOf = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

function group(key: string, rows: SocMetricRow[], sla: { ackMinutes: Record<SocSeverity, number>; resolveHours: Record<SocSeverity, number> }): SocMetricGroup {
  const tta: number[] = [];
  const ttr: number[] = [];
  let decided = 0,
    escalated = 0,
    noise = 0,
    ackMet = 0,
    ackTotal = 0,
    resolveMet = 0,
    resolveTotal = 0;
  for (const r of rows) {
    const sev = socSeverity(effectiveLevel(r.ruleLevel, r.exposure));
    const v = actualVerdict(r.status, r.verdict);
    if (v) {
      decided++;
      if (r.status === "accepted") escalated++;
      if (outcomeOf(v) === "noise") noise++;
    }
    if (r.acknowledgedAt) {
      const m = Math.max(0, (r.acknowledgedAt.getTime() - r.createdAt.getTime()) / 60_000);
      tta.push(m);
      ackTotal++;
      if (m <= sla.ackMinutes[sev]) ackMet++;
    }
    if (v && r.decidedAt) {
      const h = Math.max(0, (r.decidedAt.getTime() - r.createdAt.getTime()) / 3600_000);
      ttr.push(h);
      resolveTotal++;
      if (h <= sla.resolveHours[sev]) resolveMet++;
    }
  }
  return {
    key,
    alerts: rows.length,
    decided,
    escalated,
    noise,
    fpRate: decided >= 3 ? Math.round((noise / decided) * 100) / 100 : null,
    mttaMinutes: r1(median(tta)),
    mttrHours: r1(median(ttr)),
    ackMet,
    ackTotal,
    resolveMet,
    resolveTotal,
  };
}

export function aiMetrics(rows: SocMetricRow[]): SocAiMetrics {
  let triaged = 0,
    errors = 0,
    compared = 0,
    agree = 0,
    abstained = 0,
    overcalled = 0;
  const durations: number[] = [];
  const conf = new Map<SocConfidence, { compared: number; agree: number }>();
  const matrix = new Map<string, number>();
  const missed: { id: string; title: string }[] = [];
  for (const r of rows) {
    const tr = r.aiTriage;
    if (!tr) continue;
    if (tr.error || !tr.verdict) {
      errors++;
      continue;
    }
    triaged++;
    if (tr.durationMs) durations.push(tr.durationMs);
    const actual = actualVerdict(r.status, r.verdict);
    if (!actual) continue;
    const s = outcomeOf(tr.verdict);
    const a = outcomeOf(actual);
    matrix.set(`${s}|${a}`, (matrix.get(`${s}|${a}`) ?? 0) + 1);
    if (s === "unknown") {
      abstained++;
      continue;
    }
    if (a === "unknown") continue;
    compared++;
    const ok = s === a;
    if (ok) agree++;
    if (s === "noise" && a === "attack") missed.push({ id: r.id, title: r.title });
    if (s === "attack" && a === "noise") overcalled++;
    const c = conf.get(tr.confidence ?? "low") ?? { compared: 0, agree: 0 };
    c.compared++;
    if (ok) c.agree++;
    conf.set(tr.confidence ?? "low", c);
  }
  return {
    triaged,
    errors,
    compared,
    agree,
    agreement: compared ? Math.round((agree / compared) * 100) / 100 : null,
    abstained,
    byConfidence: (["high", "medium", "low"] as SocConfidence[]).map((c) => ({ confidence: c, ...(conf.get(c) ?? { compared: 0, agree: 0 }) })),
    missed: missed.slice(0, 20),
    overcalled,
    matrix: [...matrix.entries()].map(([k, n]) => {
      const [suggested, actual] = k.split("|") as [SocOutcome, SocOutcome];
      return { suggested, actual, n };
    }),
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
  };
}

/** Metriky za období – vstupem jsou alerty založené v období (řádky z DB) a lhůty SOC. */
export function computeSocMetrics(rows: SocMetricRow[], sla: { ackMinutes: Record<SocSeverity, number>; resolveHours: Record<SocSeverity, number> }, days: number, now = new Date()): SocMetricsDto {
  const bySource = new Map<string, SocMetricRow[]>();
  const bySev = new Map<SocSeverity, SocMetricRow[]>();
  const weeks = new Map<string, { alerts: number; escalated: number; noise: number }>();
  for (const r of rows) {
    bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
    const sev = socSeverity(effectiveLevel(r.ruleLevel, r.exposure));
    bySev.set(sev, [...(bySev.get(sev) ?? []), r]);
    const w = weeks.get(mondayOf(r.createdAt)) ?? { alerts: 0, escalated: 0, noise: 0 };
    w.alerts++;
    if (r.status === "accepted") w.escalated++;
    if (outcomeOf(actualVerdict(r.status, r.verdict)) === "noise") w.noise++;
    weeks.set(mondayOf(r.createdAt), w);
  }
  // týdny bez alertů doplnit nulami (souvislá osa)
  const weekly: SocMetricsDto["weekly"] = [];
  for (let d = new Date(mondayOf(new Date(now.getTime() - days * 864e5))); d <= now; d = new Date(d.getTime() + 7 * 864e5)) {
    const k = d.toISOString().slice(0, 10);
    weekly.push({ week: k, ...(weeks.get(k) ?? { alerts: 0, escalated: 0, noise: 0 }) });
  }
  return {
    days,
    from: new Date(now.getTime() - days * 864e5).toISOString(),
    total: group("total", rows, sla),
    bySource: [...bySource.entries()].map(([k, rs]) => group(k, rs, sla)).sort((a, b) => b.alerts - a.alerts),
    bySeverity: [...SOC_SEVERITIES].reverse().map((s) => group(s, bySev.get(s) ?? [], sla)),
    ai: aiMetrics(rows),
    weekly,
  };
}

export const SOC_OUTCOME_LABELS: Record<SocOutcome, string> = { attack: "Útok", noise: "Planý poplach", unknown: "Nelze určit" };
