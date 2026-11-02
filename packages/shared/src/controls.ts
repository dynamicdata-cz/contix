import { z } from "zod";
import { FrameworkIdSchema, type FrameworkId } from "./frameworks";
import { patchOf } from "./zutil";

/* ============================================================
 * Opatření (bezpečnostní opatření organizace) a shoda s požadavky
 * – prohlášení o aplikovatelnosti (§ 8 odst. 1 písm. f vyhl. 409/2025)
 * – přehled bezpečnostních opatření (§ 3 odst. 2 a příl. č. 1 vyhl. 410/2025)
 * ============================================================ */

export const CONTROL_CATEGORIES = ["organizational", "technical", "physical", "people"] as const;
export const ControlCategory = z.enum(CONTROL_CATEGORIES);
export type ControlCategory = z.infer<typeof ControlCategory>;

/** Stav zavedení – odpovídá sloupci „Stav bezpečnostního opatření“ přílohy č. 1 vyhl. 410 (zavedeno / v procesu / nezavedeno). */
export const CONTROL_STATUSES = ["not_implemented", "planned", "in_progress", "implemented", "not_applicable"] as const;
export const ControlStatus = z.enum(CONTROL_STATUSES);
export type ControlStatus = z.infer<typeof ControlStatus>;

export const EFFECTIVENESS = ["not_assessed", "effective", "partially_effective", "ineffective"] as const;
export const Effectiveness = z.enum(EFFECTIVENESS);
export type Effectiveness = z.infer<typeof Effectiveness>;

/** Míra shody požadavku. */
export const COMPLIANCE = ["not_assessed", "compliant", "partial", "non_compliant", "not_applicable"] as const;
export const Compliance = z.enum(COMPLIANCE);
export type Compliance = z.infer<typeof Compliance>;

export const CONTROL_LABELS = {
  category: { organizational: "Organizační", technical: "Technické", physical: "Fyzické", people: "Personální" } satisfies Record<ControlCategory, string>,
  status: {
    not_implemented: "Nezavedeno",
    planned: "Plánováno",
    in_progress: "V procesu",
    implemented: "Zavedeno",
    not_applicable: "Neaplikováno",
  } satisfies Record<ControlStatus, string>,
  effectiveness: {
    not_assessed: "Nehodnoceno",
    effective: "Účinné",
    partially_effective: "Částečně účinné",
    ineffective: "Neúčinné",
  } satisfies Record<Effectiveness, string>,
  compliance: {
    not_assessed: "Neposouzeno",
    compliant: "Splněno",
    partial: "Částečně",
    non_compliant: "Nesplněno",
    not_applicable: "Neaplikováno",
  } satisfies Record<Compliance, string>,
  /** Priorita dle přílohy č. 1 vyhl. 410/2025. */
  priority: {
    1: "Nízká – nemá dopad na poskytování regulované služby",
    2: "Střední – minimální, krátkodobý dopad",
    3: "Vysoká – vážný, dlouhodobý dopad",
    4: "Kritická – bezprostřední nebo nevratný dopad, známé způsoby obejití",
  } as Record<number, string>,
} as const;

/** Váha pro výpočet míry shody (%). */
export const COMPLIANCE_WEIGHT: Record<Compliance, number | null> = {
  compliant: 1,
  partial: 0.5,
  non_compliant: 0,
  not_assessed: 0,
  not_applicable: null,
};

const text = (max = 10000) => z.string().trim().max(max).optional().nullable();

export const ControlInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().min(1).max(500),
  description: text(),
  category: ControlCategory.default("organizational"),
  ownerPositionId: z.string().uuid().nullable().optional(),
  status: ControlStatus.default("not_implemented"),
  /** Způsob plnění / popis zavedení. */
  implementation: text(),
  /** Kde je opatření kodifikováno / doloženo (směrnice, záznamy). */
  evidence: text(5000),
  effectiveness: Effectiveness.default("not_assessed"),
  plannedDate: z.string().date().nullable().optional(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  lastReviewAt: z.string().date().nullable().optional(),
  requirementIds: z.array(z.string().max(100)).default([]),
  assetIds: z.array(z.string().uuid()).default([]),
});
export type ControlInput = z.input<typeof ControlInput>;
export const ControlPatch = patchOf(ControlInput.omit({ companyId: true }));

export interface ControlListItem {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  category: ControlCategory;
  status: ControlStatus;
  effectiveness: Effectiveness;
  ownerPositionName: string | null;
  plannedDate: string | null;
  priority: number | null;
  requirementCount: number;
  riskCount: number;
  frameworks: FrameworkId[];
  updatedAt: string;
}

export interface ControlDetail extends ControlListItem {
  description: string | null;
  ownerPositionId: string | null;
  implementation: string | null;
  evidence: string | null;
  lastReviewAt: string | null;
  requirements: { id: string; framework: FrameworkId; ref: string; section: string; text: string }[];
  risks: { id: string; code: string | null; name: string; level: string | null }[];
  assets: { id: string; name: string; assetType: string; healthStatus: string }[];
  canEdit: boolean;
}

/* ---------- posouzení požadavku (SoA) ---------- */

export const RequirementAssessmentInput = z.object({
  applicable: z.boolean(),
  /** Odůvodnění neaplikování (povinné při applicable=false). */
  justification: text(),
  /** Přijatá náhradní bezpečnostní opatření. */
  compensating: text(),
  /** Ruční posouzení míry shody; null = odvodit z navázaných opatření. */
  compliance: Compliance.nullable().optional(),
  /** Způsob plnění (pro SoA) – pokud není vyplněn, skládá se z opatření. */
  implementationNote: text(),
  priority: z.number().int().min(1).max(4).nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
});
export type RequirementAssessmentInput = z.input<typeof RequirementAssessmentInput>;

export interface RequirementRow {
  id: string;
  framework: FrameworkId;
  section: string;
  sectionTitle: string;
  ref: string;
  text: string;
  lead: string | null;
  points: string[];
  /** Vodítko a úroveň (vlastní rámce z knihovny). */
  guidance?: string | null;
  level?: string | null;
  applicable: boolean;
  justification: string | null;
  compensating: string | null;
  implementationNote: string | null;
  manualCompliance: Compliance | null;
  /** Odvozeno z opatření. */
  derivedCompliance: Compliance;
  compliance: Compliance;
  priority: number | null;
  dueDate: string | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  /** Opatření společnosti a opatření zděděná od nadřazené společnosti (holdingu) – `inherited`. */
  controls: { id: string; code: string | null; name: string; status: ControlStatus; inherited?: boolean }[];
  /** Počet důkazů – přímo k požadavku a přes namapovaná opatření. */
  evidenceCount: number;
  updatedAt: string | null;
}

export interface ComplianceSummary {
  framework: FrameworkId;
  total: number;
  applicable: number;
  byCompliance: Record<Compliance, number>;
  /** Míra shody v % (splněno = 1, částečně = 0,5) z aplikovatelných požadavků. */
  score: number;
  sections: { section: string; title: string; total: number; applicable: number; score: number; byCompliance: Record<Compliance, number> }[];
}

/**
 * Odvození míry shody požadavku z navázaných opatření:
 *  – žádné opatření → nesplněno, všechna zavedená (a nehodnocená/účinná) → splněno,
 *  – zavedené, ale neúčinné nebo jen část zavedena → částečně.
 */
export function deriveCompliance(controls: { status: ControlStatus; effectiveness: Effectiveness }[]): Compliance {
  const relevant = controls.filter((c) => c.status !== "not_applicable");
  if (!relevant.length) return controls.length ? "not_applicable" : "non_compliant";
  const impl = relevant.filter((c) => c.status === "implemented");
  if (impl.length === relevant.length && impl.every((c) => c.effectiveness !== "ineffective" && c.effectiveness !== "partially_effective")) return "compliant";
  if (impl.length > 0 || relevant.some((c) => c.status === "in_progress")) return "partial";
  return "non_compliant";
}

export function complianceScore(counts: Record<Compliance, number>): number {
  let sum = 0;
  let n = 0;
  for (const [k, v] of Object.entries(counts) as [Compliance, number][]) {
    const w = COMPLIANCE_WEIGHT[k];
    if (w == null) continue;
    sum += w * v;
    n += v;
  }
  return n ? Math.round((sum / n) * 1000) / 10 : 0;
}

export const emptyComplianceCounts = (): Record<Compliance, number> =>
  Object.fromEntries(COMPLIANCE.map((c) => [c, 0])) as Record<Compliance, number>;

/** Generování výchozího katalogu opatření podle § vyhlášky. */
/** Doplnění mapování existujícího katalogu (V-xx / N-xx) o příbuzné požadavky vybraných rámců – náhled nebo zápis. */
export const ControlCrosswalkInput = z.object({
  frameworks: z.array(FrameworkIdSchema).min(1),
  apply: z.boolean().default(false),
});
export type ControlCrosswalkInput = z.input<typeof ControlCrosswalkInput>;
export interface ControlCrosswalkResult {
  items: { controlId: string; code: string; name: string; add: { id: string; framework: FrameworkId; ref: string; text: string }[] }[];
  total: number;
  applied: boolean;
}

export const GenerateControlsInput = z.object({
  regime: z.enum(["higher", "lower"]),
  /** Přidat mapování na příbuzné požadavky ISO 27001 / DORA / ZKB. */
  includeCrosswalk: z.boolean().default(true),
});
