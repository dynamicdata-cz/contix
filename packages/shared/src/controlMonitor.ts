import { OBLIGATION_KINDS } from "./notifications";
import { z } from "zod";

/* ============================================================
 * Průběžné monitorování opatření (v1.01, ADR-096) – continuous control monitoring.
 * Monitor = automatická kontrola nad daty, která CONTIX už má (Entra / AD, Wazuh, zranitelnosti, SCA, TLS, SOC),
 * běží denně / týdně / měsíčně a každý běh je neměnný záznam (pass / fail / error). Za období (např. období
 * zprávy SOC 2 Type II) se z běhů složí test provozní účinnosti: každý běh = vzorek, výpadky běhů = výjimka.
 * Jen čtení zdrojů – monitor nic nemění.
 * ============================================================ */

export const CONTROL_MONITOR_KINDS = [
  "identity_mfa",
  "identity_hygiene",
  "privileged_accounts",
  "m365_secure_score",
  "vuln_overdue",
  "vuln_kev",
  "sca_score",
  "agent_coverage",
  "eol_assets",
  "tls_expiry",
  "soc_sla",
  // v1.13 (ADR-109): data GRC v CONTIXu a výsledky externích kontrol
  "training_completion",
  "policy_ack",
  "obligations_overdue",
  "external_check",
] as const;
export type ControlMonitorKind = (typeof CONTROL_MONITOR_KINDS)[number];

export const MONITOR_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type MonitorFrequency = (typeof MONITOR_FREQUENCIES)[number];
export const MONITOR_FREQ_HOURS: Record<MonitorFrequency, number> = { daily: 24, weekly: 168, monthly: 720 };

export const MONITOR_RESULTS = ["pass", "fail", "error"] as const;
export type MonitorResult = (typeof MONITOR_RESULTS)[number];

/** Parametry monitoru – použijí se jen ty, které druh zná (`MONITOR_SPEC[kind].params`). */
export const MonitorParams = z.object({
  /** Minimální podíl v % (MFA, pokrytí agentem, Secure Score). */
  minPct: z.number().min(0).max(100).optional(),
  /** Maximální počet (tolerance). */
  maxCount: z.number().int().min(0).max(100_000).optional(),
  /** Minimální skóre SCA (%). */
  minScore: z.number().int().min(0).max(100).optional(),
  /** Zranitelnost KEV se počítá až po N dnech od zjištění (doba na opravu). */
  graceDays: z.number().int().min(0).max(365).optional(),
  /** Agent bez hlášení déle než N dní = nepokryté aktivum. */
  staleDays: z.number().int().min(1).max(365).optional(),
  /** Certifikát končící do N dní = nález. */
  warnDays: z.number().int().min(0).max(365).optional(),
  /** Priority zranitelností po termínu (výchozí P1 a P2). */
  priorities: z.array(z.enum(["p1", "p2", "p3", "p4"])).max(4).optional(),
  /** Jen produkční aktiva (EOL, pokrytí agentem). */
  productionOnly: z.boolean().optional(),
  /** Zdroj identit (Entra ID pro Secure Score; prázdné = všechny zdroje společnosti). */
  sourceId: z.string().uuid().optional(),
  /** Druhy povinností sledované monitorem „povinnosti po termínu“ (prázdné = všechny). */
  obligationKinds: z.array(z.enum(OBLIGATION_KINDS)).max(OBLIGATION_KINDS.length).optional(),
});
export type MonitorParams = z.infer<typeof MonitorParams>;
type ParamKey = keyof MonitorParams;

export interface MonitorSpec {
  /** Měřená hodnota: podíl v %, počet nálezů nebo skóre. */
  metric: "pct" | "count" | "score";
  /** min = hodnota musí být ≥ prahu, max = ≤ prahu. */
  direction: "min" | "max";
  thresholdKey: "minPct" | "maxCount" | "minScore";
  defaults: MonitorParams;
  params: ParamKey[];
  /** Odkud data pochází (zobrazení a postup testu). */
  source: "identity" | "entra" | "vulnerabilities" | "sca" | "assets" | "tls" | "soc" | "awareness" | "policies" | "obligations" | "external";
  /** Modul, který musí být zapnutý. */
  module: string;
}

export const MONITOR_SPEC: Record<ControlMonitorKind, MonitorSpec> = {
  identity_mfa: { metric: "pct", direction: "min", thresholdKey: "minPct", defaults: { minPct: 100 }, params: ["minPct", "sourceId"], source: "identity", module: "identity" },
  identity_hygiene: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0 }, params: ["maxCount", "sourceId"], source: "identity", module: "identity" },
  privileged_accounts: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 10 }, params: ["maxCount", "sourceId"], source: "identity", module: "identity" },
  m365_secure_score: { metric: "pct", direction: "min", thresholdKey: "minPct", defaults: { minPct: 70 }, params: ["minPct", "sourceId"], source: "entra", module: "identity" },
  vuln_overdue: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0, priorities: ["p1", "p2"] }, params: ["maxCount", "priorities"], source: "vulnerabilities", module: "vulnerabilities" },
  vuln_kev: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0, graceDays: 14 }, params: ["maxCount", "graceDays"], source: "vulnerabilities", module: "vulnerabilities" },
  sca_score: { metric: "score", direction: "min", thresholdKey: "minScore", defaults: { minScore: 80 }, params: ["minScore"], source: "sca", module: "assets" },
  agent_coverage: { metric: "pct", direction: "min", thresholdKey: "minPct", defaults: { minPct: 95, staleDays: 7 }, params: ["minPct", "staleDays", "productionOnly"], source: "assets", module: "assets" },
  eol_assets: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0 }, params: ["maxCount", "productionOnly"], source: "assets", module: "assets" },
  tls_expiry: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0, warnDays: 14 }, params: ["maxCount", "warnDays"], source: "tls", module: "assets" },
  soc_sla: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0 }, params: ["maxCount"], source: "soc", module: "soc" },
  training_completion: { metric: "pct", direction: "min", thresholdKey: "minPct", defaults: { minPct: 90 }, params: ["minPct"], source: "awareness", module: "awareness" },
  policy_ack: { metric: "pct", direction: "min", thresholdKey: "minPct", defaults: { minPct: 95 }, params: ["minPct"], source: "policies", module: "policies" },
  obligations_overdue: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0 }, params: ["maxCount", "obligationKinds"], source: "obligations", module: "controls" },
  /** Výsledek posílá externí skript (záloha, kontrola konfigurace…) přes token; když nedorazí včas, běh = chyba. */
  external_check: { metric: "count", direction: "max", thresholdKey: "maxCount", defaults: { maxCount: 0 }, params: ["maxCount"], source: "external", module: "controls" },
};

/** Výsledek externí kontroly (`POST /api/public/monitors/result`, Bearer token monitoru). */
export const MonitorPushInput = z.object({
  /** Výsledek podle skriptu; když chybí, vyhodnotí se `value` proti toleranci monitoru. */
  result: z.enum(["pass", "fail"]).optional(),
  /** Počet nálezů / chyb (např. neúspěšné úlohy zálohování). */
  value: z.number().min(0).max(1_000_000_000).optional(),
  population: z.number().int().min(0).max(1_000_000_000).optional(),
  summary: z.string().trim().max(1000).optional(),
  details: z.array(z.object({ ref: z.string().trim().min(1).max(200), detail: z.string().trim().max(500).default("") })).max(50).default([]),
}).refine((v) => v.result !== undefined || v.value !== undefined, { message: "Zadejte result nebo value" });
export type MonitorPushInput = z.input<typeof MonitorPushInput>;

/** Parametry doplněné o výchozí hodnoty a omezené na ty, které druh zná. */
export function monitorParamsOf(kind: ControlMonitorKind, raw: unknown): MonitorParams {
  const spec = MONITOR_SPEC[kind];
  const p = MonitorParams.safeParse(raw ?? {});
  const given = p.success ? p.data : {};
  const out: Record<string, unknown> = { ...spec.defaults };
  for (const k of spec.params) if (given[k] !== undefined) out[k] = given[k];
  return out as MonitorParams;
}

/** Vyhodnocení jedné hodnoty proti prahu (čistá funkce). */
export function evaluateMonitor(kind: ControlMonitorKind, value: number, params: MonitorParams): { result: "pass" | "fail"; threshold: number } {
  const spec = MONITOR_SPEC[kind];
  const threshold = Number(monitorParamsOf(kind, params)[spec.thresholdKey] ?? 0);
  const ok = spec.direction === "min" ? value >= threshold : value <= threshold;
  return { result: ok ? "pass" : "fail", threshold };
}

export const ControlMonitorInput = z.object({
  controlId: z.string().uuid(),
  kind: z.enum(CONTROL_MONITOR_KINDS),
  name: z.string().trim().max(200).optional(),
  frequency: z.enum(MONITOR_FREQUENCIES).default("daily"),
  params: MonitorParams.default({}),
  enabled: z.boolean().default(true),
  /** Při nesplnění nebo chybě založit úkol vlastníkovi opatření (jeden otevřený na monitor). */
  autoTask: z.boolean().default(false),
});
export type ControlMonitorInput = z.input<typeof ControlMonitorInput>;

export const MonitorPeriodTestInput = z
  .object({
    from: z.string().date(),
    to: z.string().date(),
    /** Tolerovaný počet neúspěšných běhů (výjimek). */
    tolerable: z.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => v.from <= v.to, { message: "Začátek období musí být před koncem", path: ["to"] });
export type MonitorPeriodTestInput = z.input<typeof MonitorPeriodTestInput>;

export interface MonitorRunDto {
  id: string;
  runAt: string;
  result: MonitorResult;
  value: number | null;
  threshold: number | null;
  population: number | null;
  exceptions: number | null;
  summary: string;
  details: { ref: string; detail: string }[];
}

export interface ControlMonitorDto {
  id: string;
  companyId: string;
  controlId: string;
  controlName: string;
  kind: ControlMonitorKind;
  name: string;
  frequency: MonitorFrequency;
  params: MonitorParams;
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: MonitorResult | null;
  lastSummary: string | null;
  /** Posledních 30 běhů (nejstarší první) pro proužek historie. */
  recent: { runAt: string; result: MonitorResult }[];
  /** Úspěšnost za posledních 90 dní (%), null = bez běhů. */
  passRate90: number | null;
  autoTask: boolean;
  /** Otevřený úkol z nesplněného běhu (v1.13). */
  openTaskId: string | null;
  /** Externí kontrola má vydaný token (hodnota se zobrazí jen jednou). */
  hasToken: boolean;
}

/** Souhrn běhů za období (čistá funkce) – podklad testu provozní účinnosti. */
export function monitorPeriod(runs: { runAt: string | Date; result: MonitorResult }[], from: string, to: string, frequency: MonitorFrequency, tolerable = 0) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T23:59:59.999Z`).getTime();
  const inPeriod = runs.filter((r) => {
    const t = new Date(r.runAt).getTime();
    return t >= start && t <= end;
  });
  const hours = (end - start) / 3_600_000;
  const expected = Math.max(1, Math.floor((hours + 1) / MONITOR_FREQ_HOURS[frequency]));
  const passed = inPeriod.filter((r) => r.result === "pass").length;
  const failed = inPeriod.filter((r) => r.result === "fail").length;
  const errors = inPeriod.filter((r) => r.result === "error").length;
  // výpadek monitorování: méně než 90 % očekávaných běhů = jedna výjimka „monitor neběžel“
  const missing = Math.max(0, expected - inPeriod.length);
  const gap = inPeriod.length < Math.ceil(expected * 0.9);
  const exceptions = failed + errors + (gap ? 1 : 0);
  const result: "effective" | "effective_with_exceptions" | "ineffective" | "not_tested" = !inPeriod.length
    ? "not_tested"
    : exceptions === 0
      ? "effective"
      : exceptions <= tolerable
        ? "effective_with_exceptions"
        : "ineffective";
  return { runs: inPeriod.length, expected, passed, failed, errors, missing, gap, coverage: Math.min(100, Math.round((inPeriod.length / expected) * 100)), exceptions, result };
}

export const MONITOR_LABELS = {
  kind: {
    identity_mfa: "Vícefaktorové ověření (MFA) u účtů",
    identity_hygiene: "Hygiena účtů – kritické a vysoké nálezy v adresáři",
    privileged_accounts: "Počet privilegovaných účtů",
    m365_secure_score: "Microsoft Secure Score (M365 / Entra)",
    vuln_overdue: "Zranitelnosti po termínu opravy",
    vuln_kev: "Aktivně zneužívané zranitelnosti (CISA KEV)",
    sca_score: "Shoda konfigurace (Wazuh SCA / CIS)",
    agent_coverage: "Pokrytí aktiv agentem Wazuh",
    eol_assets: "Systémy bez podpory výrobce (EOL)",
    tls_expiry: "Certifikáty po platnosti nebo brzy končící",
    soc_sla: "Alerty a případy SOC po lhůtě",
    training_completion: "Plnění povinných školení",
    policy_ack: "Seznámení s platnými dokumenty",
    obligations_overdue: "Povinnosti a lhůty po termínu",
    external_check: "Externí kontrola (výsledek ze skriptu – zálohy, konfigurace…)",
  } satisfies Record<ControlMonitorKind, string>,
  frequency: { daily: "Denně", weekly: "Týdně", monthly: "Měsíčně" } satisfies Record<MonitorFrequency, string>,
  result: { pass: "Splněno", fail: "Nesplněno", error: "Chyba – neproběhlo" } satisfies Record<MonitorResult, string>,
  param: {
    minPct: "Minimum (%)",
    maxCount: "Tolerance (max. počet)",
    minScore: "Minimální skóre (%)",
    graceDays: "Doba na opravu (dny)",
    staleDays: "Agent bez hlášení déle než (dny)",
    warnDays: "Upozornit dní před koncem platnosti",
    priorities: "Priority",
    productionOnly: "Jen produkční aktiva",
    sourceId: "Zdroj identit",
    obligationKinds: "Druhy povinností",
  } satisfies Record<ParamKey, string>,
} as const;
