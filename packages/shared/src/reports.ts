import type { OpsLevel } from "./ops";

/* ============================================================
 * Zpráva pro vedení – souhrn stavu kybernetické bezpečnosti (jedna stránka, tisk / Word).
 * ============================================================ */

export interface ManagementKpi {
  key: string;
  label: string;
  value: string;
  level: OpsLevel;
  detail: string;
  link: string | null;
}

export interface ManagementReport {
  organizationName: string;
  regime: string;
  /** Popis regulatorního profilu (ADR-080). */
  profileName: string;
  /** Rámec, podle kterého se zpráva vede (ADR-086). */
  basisLabel?: string;
  periodFrom: string;
  periodTo: string;
  generatedAt: string;
  kpis: ManagementKpi[];
  compliance: { framework: string; name: string; score: number; applicable: number; compliant: number; partial: number; nonCompliant: number; notAssessed: number }[];
  risks: { total: number; byLevel: Record<string, number>; unacceptable: number; untreated: number } | null;
  plan: { open: number; done: number; overdue: number } | null;
  incidents: { events: number; incidents: number; significant: number; overdueReports: number; personalData: number; list: { code: string | null; title: string; category: string; detectedAt: string; significant: boolean }[] } | null;
  audits: { done: number; openFindings: number; overdueFindings: number; openMajor: number } | null;
  /** Opravy zranitelností (v0.55, ADR-050): priority, katalog KEV, po termínu, podíl oprav v termínu za období. */
  vulnRemediation: { p1: number; p2: number; kevOpen: number; overdue: number; resolved: number; resolvedOnTimePct: number | null } | null;
  /** SOC za období (v0.53): alerty, eskalace, verdikty, doba převzetí, lhůty, nejčastější taktiky ATT&CK. */
  soc: { alerts: number; escalated: number; truePositive: number; falsePositive: number; benign: number; fpRate: number | null; mttaHours: number | null; mttrHours: number | null; aiCompared: number; aiAgreement: number | null; aiMissed: number; openBreached: number; exploitAttempts: number; topTactics: { id: string; n: number }[] } | null;
  assurance: { testsLastYear: Record<string, number>; implementedControls: number; implementedNotTested: number; implementedWithoutEvidence: number; evidenceExpired: number; testsOverdue: number } | null;
  obligations: { overdue: number; soon: number; byKind: Record<string, number> };
  assets: { total: number; red: number; orange: number; green: number; unknown: number } | null;
  continuity: { plans: number; approved: number; testOverdue: number; neverTested: number } | null;
  documents: { title: string; version: number; approvedAt: string | null }[];
}

/** Úroveň podle prahů (vyšší = horší). */
export function levelByThreshold(v: number, warnAt: number, errorAt: number): OpsLevel {
  return v >= errorAt ? "error" : v >= warnAt ? "warning" : "ok";
}
