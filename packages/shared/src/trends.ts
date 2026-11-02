/* ============================================================
 * Trendy a historie shody (ADR-042): měsíční snímky ukazatelů za společnost – míra shody podle rámců, rizika,
 * zranitelnosti, výjimky, povinnosti. Snímek měsíce se během měsíce přepisuje (poslední stav), uzavřené měsíce se nemění.
 * ============================================================ */

export const TREND_METRICS = [
  "compliance",
  "risks_unacceptable",
  "risks_untreated",
  "risks_critical_high",
  "risks_total",
  "plan_overdue",
  "findings_open",
  "findings_overdue",
  "controls_tested_pct",
  "evidence_expired",
  "obligations_overdue",
  "assets_red",
  "vulns_critical",
  "vulns_high",
  "exceptions_total",
  "exceptions_expired",
  "incidents_significant",
  "vulns_p1",
  "vulns_sla_overdue",
  // v1.24 (ADR-121) – analýza rizik z dat
  "risks_medium",
  "risks_low",
  "threat_coverage_pct",
  "unassessed_threats",
  "weak_capabilities",
  "risks_over_appetite",
  "kri_alerts",
  "detection_blind",
] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

/** Směr: „up“ = vyšší je lepší (míra shody), „down“ = nižší je lepší (rizika, nálezy…). */
export const TREND_DIRECTION: Record<TrendMetric, "up" | "down"> = {
  compliance: "up",
  controls_tested_pct: "up",
  risks_unacceptable: "down",
  risks_untreated: "down",
  risks_critical_high: "down",
  risks_total: "down",
  plan_overdue: "down",
  findings_open: "down",
  findings_overdue: "down",
  evidence_expired: "down",
  obligations_overdue: "down",
  assets_red: "down",
  vulns_critical: "down",
  vulns_high: "down",
  exceptions_total: "down",
  exceptions_expired: "down",
  incidents_significant: "down",
  vulns_p1: "down",
  vulns_sla_overdue: "down",
  risks_medium: "down",
  risks_low: "down",
  threat_coverage_pct: "up",
  unassessed_threats: "down",
  weak_capabilities: "down",
  risks_over_appetite: "down",
  kri_alerts: "down",
  detection_blind: "down",
};

export const TREND_LABELS: Record<TrendMetric, string> = {
  compliance: "Míra shody (%)",
  controls_tested_pct: "Otestovaná zavedená opatření (%)",
  risks_unacceptable: "Nepřijatelná rizika",
  risks_untreated: "Nepřijatelná rizika bez rozhodnutí",
  risks_critical_high: "Kritická a vysoká rizika",
  risks_total: "Rizika celkem",
  plan_overdue: "Akce plánu zvládání po termínu",
  findings_open: "Otevřená zjištění auditů",
  findings_overdue: "Zjištění auditů po termínu",
  evidence_expired: "Prošlé důkazy",
  obligations_overdue: "Povinnosti po termínu",
  assets_red: "Aktiva v červeném stavu",
  vulns_critical: "Kritické zranitelnosti",
  vulns_high: "Vysoké zranitelnosti",
  exceptions_total: "Platné výjimky",
  exceptions_expired: "Výjimky po platnosti",
  incidents_significant: "Významné incidenty (12 měsíců)",
  vulns_p1: "Zranitelnosti P1 (KEV / EPSS)",
  vulns_sla_overdue: "Zranitelnosti po termínu opravy",
  risks_medium: "Střední rizika",
  risks_low: "Nízká rizika",
  threat_coverage_pct: "Pokrytí katalogu hrozeb (%)",
  unassessed_threats: "Neposouzené hrozby",
  weak_capabilities: "Slabé bezpečnostní schopnosti",
  risks_over_appetite: "Rizika nad ochotou riskovat",
  kri_alerts: "Překročené KRI",
  detection_blind: "Slepá místa detekce ATT&CK",
};

/** Ukazatele přehledu skupiny společností (v1.24, ADR-121). */
export const GROUP_RISK_METRICS = ["risks_total", "risks_critical_high", "risks_over_appetite", "threat_coverage_pct", "weak_capabilities", "kri_alerts", "detection_blind"] as const satisfies readonly TrendMetric[];

export interface GroupRiskRowDto {
  companyId: string;
  name: string;
  period: string | null;
  takenAt: string | null;
  values: Partial<Record<(typeof GROUP_RISK_METRICS)[number], number | null>>;
}

/** Hodnoty jednoho snímku: ukazatel → číslo (null = modul vypnutý / bez dat); míra shody i po rámcích `compliance:<rámec>`. */
export type TrendValues = Partial<Record<TrendMetric | `compliance:${string}`, number | null>>;

export interface TrendPoint {
  /** Měsíc YYYY-MM. */
  period: string;
  takenAt: string;
  values: TrendValues;
}

export interface TrendDto {
  companyId: string;
  /** Hlavní rámec společnosti (podle režimu) – ukazatel `compliance`. */
  framework: string;
  frameworks: { id: string; name: string }[];
  points: TrendPoint[];
}

/** Posledních `n` měsíců končících měsícem `to` (YYYY-MM), vzestupně. */
export function monthRange(to: string, n: number): string[] {
  const [y, m] = to.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export const periodOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Změna proti předchozímu měsíci s hodnotou: zlepšení / zhoršení podle směru ukazatele. */
export function trendChange(points: TrendPoint[], metric: TrendMetric | `compliance:${string}`): { last: number | null; prev: number | null; delta: number | null; better: boolean | null } {
  const vals = points.map((p) => p.values[metric]).filter((v): v is number => typeof v === "number");
  const last = vals.at(-1) ?? null;
  const prev = vals.length > 1 ? vals.at(-2)! : null;
  if (last == null || prev == null) return { last, prev, delta: null, better: null };
  const delta = Math.round((last - prev) * 10) / 10;
  const dir = metric.startsWith("compliance") ? "up" : TREND_DIRECTION[metric as TrendMetric];
  return { last, prev, delta, better: delta === 0 ? null : dir === "up" ? delta > 0 : delta < 0 };
}
