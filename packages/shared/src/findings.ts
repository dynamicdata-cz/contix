import { z } from "zod";

/* ============================================================
 * Jednotný přehled nálezů (v1.65, ADR-158): bezpečnostní testy, konfigurace serverů (sběrač),
 * zranitelnosti a zjištění auditů na jedné stupnici závažnosti a stavů – s odpovědnou osobou,
 * úkolem a výjimkou. Zdroje zůstávají ve svých modulech; přehled je jen čte.
 * ============================================================ */

export const FINDING_SOURCES = ["sectest", "host", "vulnerability", "audit"] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];
export const UNIFIED_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type UnifiedSeverity = (typeof UNIFIED_SEVERITIES)[number];
export const UNIFIED_STATUSES = ["open", "in_progress", "accepted", "fixed", "dismissed"] as const;
export type UnifiedStatus = (typeof UNIFIED_STATUSES)[number];

/** Závažnost zdroje → jednotná stupnice. Audit: zásadní = vysoká, menší = střední, pozorování = nízká, doporučení = info. */
export function unifiedSeverity(source: FindingSource, s: string): UnifiedSeverity {
  if (source === "audit") return ({ major: "high", minor: "medium", observation: "low", recommendation: "info" } as Record<string, UnifiedSeverity>)[s] ?? "medium";
  if (source === "vulnerability" && s === "unknown") return "info";
  return (UNIFIED_SEVERITIES as readonly string[]).includes(s) ? (s as UnifiedSeverity) : "info";
}
/** Stav zdroje → jednotný stav (opraveno / zamítnuto = falešný nález, mimo rozsah, duplicita). */
export function unifiedStatus(s: string): UnifiedStatus {
  if (s === "open" || s === "in_progress" || s === "accepted") return s;
  if (s === "fixed" || s === "resolved" || s === "closed") return "fixed";
  return "dismissed";
}

export interface UnifiedFindingDto {
  /** Klíč `zdroj:id`. */
  key: string;
  id: string;
  source: FindingSource;
  companyId: string;
  title: string;
  detail: string;
  severity: UnifiedSeverity;
  status: UnifiedStatus;
  assetId: string | null;
  assetName: string | null;
  /** Odpovědná osoba (technický garant aktiva) nebo funkční místo (audit). */
  ownerName: string | null;
  task: { id: string; code: string; status: string; dueDate: string | null; assigneeName: string | null } | null;
  dueDate: string | null;
  /** Termín je lhůta opravy podle závažnosti (nález bez úkolu, zranitelnost), ne termín úkolu (v1.71). */
  dueFromSla?: boolean;
  acceptedUntil: string | null;
  firstSeenAt: string | null;
  link: string;
  /** Priorita opravy (v1.70) – `findingPriority`, vyšší = dříve. */
  priority: number;
}
export interface UnifiedFindingsDto {
  items: UnifiedFindingDto[];
  /** Otevřené (open + in_progress) podle zdroje a závažnosti – bez ohledu na filtr stavu. */
  open: Record<FindingSource, Record<UnifiedSeverity, number>>;
  /** Zdroje, ke kterým má uživatel přístup. */
  sources: FindingSource[];
  truncated: boolean;
  /** Počet nálezů odpovídajících filtru (nejvýš 1500 za zdroj) – seznam vrací prvních `limit` podle priority (v1.72). */
  total?: number;
}

export const FindingsQuery = z.object({
  assetId: z.string().uuid().optional(),
  /** Inventář serveru ze sběrače (jen zdroj host, v1.67). */
  hostId: z.string().uuid().optional(),
  source: z.enum(FINDING_SOURCES).optional(),
  status: z.enum(["active", "all", ...UNIFIED_STATUSES]).default("active"),
  severity: z.enum(UNIFIED_SEVERITIES).optional(),
  q: z.string().trim().max(200).optional(),
  /** Odpovědnost (v1.69): moje = garant / zástupce / vlastník aktiva, řešitel úkolu nebo funkce zjištění; tým = podřízené útvary. */
  who: z.enum(["mine", "team"]).optional(),
  /** Kolik položek vrátit (v1.72, stránkování „Zobrazit další“); bez limitu nejvýš 1500. */
  limit: z.coerce.number().int().min(50).max(1500).optional(),
});
export type FindingsQuery = z.input<typeof FindingsQuery>;

export const FINDING_LABELS = {
  source: { sectest: "Bezpečnostní test", host: "Konfigurace serveru", vulnerability: "Zranitelnost", audit: "Zjištění auditu" } as Record<FindingSource, string>,
  severity: { critical: "Kritická", high: "Vysoká", medium: "Střední", low: "Nízká", info: "Info" } as Record<UnifiedSeverity, string>,
  status: { open: "Otevřený", in_progress: "V řešení", accepted: "Přijaté riziko", fixed: "Opraveno", dismissed: "Zamítnuto" } as Record<UnifiedStatus, string>,
};

/* ---------- náprava nálezů (v1.69, ADR-162) ---------- */

export interface RemediationStat {
  /** Otevřené (u auditu i v řešení). */
  open: number;
  /** Otevřené po termínu (úkol z nálezu, jinak lhůta podle závažnosti; lhůta opravy zranitelnosti; termín zjištění). */
  overdue: number;
  /** Z toho eskalované – po termínu déle než týden (v1.71, ADR-164). */
  escalated: number;
  /** Opravené / uzavřené v období. */
  fixed: number;
  /** Průměrná doba opravy ve dnech (od zjištění po opravu), null = nic opraveno. */
  avgDays: number | null;
  /** Podíl oprav v termínu (%), null = žádná oprava s termínem. */
  onTimePct: number | null;
}
export interface FindingsRemediationDto {
  from: string;
  to: string;
  sources: FindingSource[];
  bySource: Record<FindingSource, RemediationStat & { bySeverity: Record<UnifiedSeverity, RemediationStat> }>;
  total: RemediationStat & { bySeverity: Record<UnifiedSeverity, RemediationStat> };
}
export const RemediationQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assetId: z.string().uuid().optional(),
});
export type RemediationQuery = z.input<typeof RemediationQuery>;

/** Řádek agregace (součty) → ukazatel. */
export function remediationStat(a: { open: number; overdue: number; escalated?: number; fixed: number; sumDays: number; withDue: number; onTime: number }): RemediationStat {
  return {
    open: a.open,
    overdue: a.overdue,
    escalated: a.escalated ?? 0,
    fixed: a.fixed,
    avgDays: a.fixed ? Math.round((a.sumDays / a.fixed) * 10) / 10 : null,
    onTimePct: a.withDue ? Math.round((a.onTime / a.withDue) * 100) : null,
  };
}

/* ---------- priorita a plán oprav (v1.70, ADR-163) ---------- */

/**
 * Priorita opravy nálezu (vyšší = dříve): závažnost + dostupnost z internetu + kritičnost aktiva + termín po splatnosti.
 * Deterministicky a vysvětlitelně (důvody), AI ji jen doplňuje o seskupení a zdůvodnění.
 */
export function findingPriority(x: { severity: UnifiedSeverity; internetFacing?: boolean | null; criticality?: string | null; overdue?: boolean }): number {
  const sev = { critical: 40, high: 25, medium: 12, low: 4, info: 1 }[x.severity];
  const crit = ({ critical: 12, high: 8, medium: 3 } as Record<string, number>)[x.criticality ?? ""] ?? 0;
  return sev + (x.internetFacing ? 15 : 0) + crit + (x.overdue ? 10 : 0);
}

export const FINDING_PLAN_EFFORTS = ["low", "medium", "high"] as const;
export type FindingPlanEffort = (typeof FINDING_PLAN_EFFORTS)[number];
export interface FindingPlanStep {
  title: string;
  why: string;
  effort: FindingPlanEffort | null;
  items: { key: string; title: string; link: string; severity: UnifiedSeverity }[];
  /** Úkol založený z kroku (v1.71). */
  taskId?: string | null;
}
export interface FindingPlanDto {
  companyId: string;
  generatedAt: string;
  model: string;
  summary: string;
  steps: FindingPlanStep[];
  /** Kolik nálezů model dostal (nejvýš 60 podle priority). */
  considered: number;
}

/** Odpověď modelu → kroky plánu; reference F1… jen ze seznamu, prázdné kroky se zahodí. */
export function parseFindingPlan(text: string, refs: Map<string, { key: string; title: string; link: string; severity: UnifiedSeverity }>): { summary: string; steps: FindingPlanStep[] } {
  const raw = (() => {
    const s = text.replace(/<think>[\s\S]*?<\/think>/g, "");
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    try {
      return JSON.parse(s.slice(a, b + 1)) as { summary?: unknown; steps?: unknown };
    } catch {
      return null;
    }
  })();
  if (!raw) return { summary: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim().slice(0, 3000), steps: [] };
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const steps: FindingPlanStep[] = [];
  const used = new Set<string>();
  for (const s of Array.isArray(raw.steps) ? raw.steps.slice(0, 20) : []) {
    const o = (s ?? {}) as Record<string, unknown>;
    const items = (Array.isArray(o.refs) ? o.refs : [])
      .map((r) => (typeof r === "string" ? refs.get(r.trim().toUpperCase()) : undefined))
      .filter((x): x is NonNullable<typeof x> => !!x && !used.has(x.key));
    for (const i of items) used.add(i.key);
    const title = str(o.title, 300);
    if (!title || !items.length) continue;
    const effort = (FINDING_PLAN_EFFORTS as readonly string[]).includes(String(o.effort)) ? (o.effort as FindingPlanEffort) : null;
    steps.push({ title, why: str(o.why, 1500), effort, items });
  }
  return { summary: str(raw.summary, 3000), steps };
}

/* ---------- plnění plánu, lhůty a eskalace (v1.71, ADR-164) ---------- */

/** Lhůta opravy nálezu bez úkolu podle závažnosti (dny od zjištění) – stejná jako termín úkolu z nálezu. */
export const FINDING_SLA_DAYS: Record<UnifiedSeverity, number> = { critical: 7, high: 14, medium: 30, low: 90, info: 180 };
/** Po kolika dnech po termínu nález eskaluje na vedoucího garanta (pak každý další týden o úroveň výš). */
export const FINDING_ESCALATION_DAYS = 7;

export function findingSlaDue(firstSeenAt: string | Date, severity: UnifiedSeverity): string {
  const d = new Date(firstSeenAt);
  d.setUTCDate(d.getUTCDate() + FINDING_SLA_DAYS[severity]);
  return d.toISOString().slice(0, 10);
}

/** Termín úkolu z kroku plánu podle náročnosti (dny). */
export const FINDING_PLAN_DUE_DAYS: Record<FindingPlanEffort, number> = { low: 14, medium: 30, high: 60 };

export interface FindingPlanStepDto extends FindingPlanStep {
  task: { id: string; code: string; status: string; dueDate: string | null; assigneeName: string | null } | null;
  /** Nálezy kroku, které už nejsou otevřené (opravené, přijaté, zamítnuté). */
  resolved: number;
  /** Krok je splněný: úkol splněný, nebo žádný nález kroku už není otevřený. */
  done: boolean;
}
export interface FindingPlanViewDto extends Omit<FindingPlanDto, "steps"> {
  steps: FindingPlanStepDto[];
  progress: { steps: number; done: number; items: number; resolved: number; withTask: number };
}

export const FindingPlanTasksInput = z.object({
  /** Indexy kroků plánu (0…); kroky s úkolem se přeskočí. */
  steps: z.array(z.number().int().min(0).max(19)).min(1).max(20),
});
export type FindingPlanTasksInput = z.input<typeof FindingPlanTasksInput>;

/** Aktivum s nálezy po termínu, které eskalovaly na vedoucího garanta. */
export interface FindingEscalationDto {
  assetId: string;
  assetName: string;
  companyId: string;
  guarantorName: string | null;
  /** Nálezy po termínu (testy, servery, zranitelnosti). */
  overdue: number;
  /** Nejstarší překročení termínu ve dnech. */
  daysOverdue: number;
  /** Úroveň eskalace: 1 = přímý vedoucí garanta, 2 = o úroveň výš… */
  level: number;
}
