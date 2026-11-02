import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Ochrana osobních údajů (GDPR): záznamy o činnostech zpracování (čl. 30) navázané na procesy,
 * aktiva a dodavatele (zpracovatele); screening a posouzení vlivu na ochranu osobních údajů (DPIA, čl. 35).
 * ============================================================ */

export const LEGAL_BASES = ["consent", "contract", "legal_obligation", "vital_interest", "public_task", "legitimate_interest"] as const;
export type LegalBasis = (typeof LEGAL_BASES)[number];
export const PROCESSING_ROLES = ["controller", "joint_controller", "processor"] as const;
export type ProcessingRole = (typeof PROCESSING_ROLES)[number];
export const ACTIVITY_STATUSES = ["draft", "active", "retired"] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export const DPIA_STATUSES = ["draft", "in_progress", "completed"] as const;
export type DpiaStatus = (typeof DPIA_STATUSES)[number];

/** Kritéria pro posouzení potřeby DPIA (pokyny WP248 rev.01 / EDPB). Splnění 2+ kritérií = DPIA zpravidla nutné. */
export const DPIA_CRITERIA = [
  "evaluation_scoring",
  "automated_decision",
  "systematic_monitoring",
  "sensitive_data",
  "large_scale",
  "matching_datasets",
  "vulnerable_subjects",
  "innovative_technology",
  "prevents_rights",
] as const;
export type DpiaCriterion = (typeof DPIA_CRITERIA)[number];

export const GDPR_LABELS = {
  legalBasis: {
    consent: "Souhlas – čl. 6 odst. 1 písm. a)",
    contract: "Plnění smlouvy – písm. b)",
    legal_obligation: "Právní povinnost – písm. c)",
    vital_interest: "Životně důležité zájmy – písm. d)",
    public_task: "Veřejný zájem / veřejná moc – písm. e)",
    legitimate_interest: "Oprávněný zájem – písm. f)",
  } satisfies Record<LegalBasis, string>,
  role: { controller: "Správce", joint_controller: "Společný správce", processor: "Zpracovatel" } satisfies Record<ProcessingRole, string>,
  status: { draft: "Návrh", active: "Platná", retired: "Ukončená" } satisfies Record<ActivityStatus, string>,
  dpiaStatus: { draft: "Návrh", in_progress: "Zpracovává se", completed: "Dokončeno" } satisfies Record<DpiaStatus, string>,
  criteria: {
    evaluation_scoring: "Hodnocení nebo bodování (profilování, predikce)",
    automated_decision: "Automatizované rozhodování s právními či obdobnými účinky",
    systematic_monitoring: "Systematické monitorování (např. kamerový systém, sledování zaměstnanců)",
    sensitive_data: "Zvláštní kategorie údajů nebo údaje vysoce osobní povahy",
    large_scale: "Zpracování ve velkém rozsahu",
    matching_datasets: "Propojování nebo kombinování souborů údajů",
    vulnerable_subjects: "Zranitelné subjekty (děti, zaměstnanci, pacienti, senioři)",
    innovative_technology: "Inovativní technologie (biometrie, AI, IoT)",
    prevents_rights: "Zpracování brání subjektům uplatnit práva nebo využít službu",
  } satisfies Record<DpiaCriterion, string>,
} as const;

/** Je DPIA zpravidla nutné? (2+ kritéria, nebo zvláštní kategorie ve velkém rozsahu) */
export function dpiaRequired(criteria: string[]): { required: boolean; count: number } {
  const n = new Set(criteria.filter((c) => (DPIA_CRITERIA as readonly string[]).includes(c))).size;
  return { required: n >= 2, count: n };
}

const text = (max = 5000) => z.string().trim().max(max).nullable().optional();
const list = z.array(z.string().trim().min(1).max(200)).max(50).default([]);

export const ProcessingActivityInput = z.object({
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  status: z.enum(ACTIVITY_STATUSES).default("draft"),
  role: z.enum(PROCESSING_ROLES).default("controller"),
  /** Účel zpracování – čl. 30 odst. 1 písm. b) */
  purpose: z.string().trim().max(5000).default(""),
  legalBasis: z.enum(LEGAL_BASES).nullable().optional(),
  legalBasisNote: text(2000),
  /** Kategorie subjektů údajů – písm. c) */
  dataSubjects: list,
  /** Kategorie osobních údajů – písm. c) */
  dataCategories: list,
  /** Zvláštní kategorie (čl. 9) / údaje o trestných činech (čl. 10) */
  specialCategories: list,
  /** Kategorie příjemců – písm. d) */
  recipients: text(),
  /** Předání do třetích zemí a záruky – písm. e) */
  thirdCountryTransfers: text(),
  /** Lhůty pro výmaz – písm. f) */
  retention: text(2000),
  /** Technická a organizační opatření – písm. g) (popis + vazba na opatření v katalogu) */
  securityMeasures: text(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  processIds: z.array(z.string().uuid()).max(50).default([]),
  assetIds: z.array(z.string().uuid()).max(200).default([]),
  /** Zpracovatelé (dodavatelé) */
  supplierIds: z.array(z.string().uuid()).max(50).default([]),
  controlIds: z.array(z.string().uuid()).max(100).default([]),
  dpiaCriteria: z.array(z.enum(DPIA_CRITERIA)).max(9).default([]),
  reviewMonths: z.number().int().min(1).max(60).default(12),
  lastReviewedAt: z.string().date().nullable().optional(),
});
export type ProcessingActivityInput = z.input<typeof ProcessingActivityInput>;
export const ProcessingActivityPatch = patchOf(ProcessingActivityInput);

export interface ProcessingActivityDto {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  status: ActivityStatus;
  role: ProcessingRole;
  purpose: string;
  legalBasis: LegalBasis | null;
  legalBasisNote: string | null;
  dataSubjects: string[];
  dataCategories: string[];
  specialCategories: string[];
  recipients: string | null;
  thirdCountryTransfers: string | null;
  retention: string | null;
  securityMeasures: string | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  processes: { id: string; code: string | null; name: string }[];
  assets: { id: string; name: string; assetType: string }[];
  suppliers: { id: string; name: string }[];
  controls: { id: string; code: string | null; name: string }[];
  dpiaCriteria: DpiaCriterion[];
  dpiaRequired: boolean;
  dpia: { id: string; status: DpiaStatus; nextReview: string | null; approvedAt: string | null } | null;
  reviewMonths: number;
  lastReviewedAt: string | null;
  nextReview: string | null;
  gaps: string[];
  canEdit: boolean;
  updatedAt: string;
}

/** Chybějící povinné náležitosti záznamu (čl. 30 odst. 1) a navazující povinnosti. */
export function activityGaps(a: {
  status: string;
  role: string;
  purpose: string;
  legalBasis: string | null;
  dataSubjects: string[];
  dataCategories: string[];
  specialCategories: string[];
  retention: string | null;
  securityMeasures: string | null;
  controlCount: number;
  dpiaCriteria: string[];
  dpia: { status: string } | null;
  thirdCountryTransfers: string | null;
}): string[] {
  const g: string[] = [];
  if (!a.purpose.trim()) g.push("Chybí účel zpracování (čl. 30 odst. 1 písm. b).");
  if (a.role !== "processor" && !a.legalBasis) g.push("Chybí právní základ (čl. 6).");
  if (!a.dataSubjects.length) g.push("Chybí kategorie subjektů údajů (písm. c).");
  if (!a.dataCategories.length) g.push("Chybí kategorie osobních údajů (písm. c).");
  if (a.role !== "processor" && !a.retention?.trim()) g.push("Chybí lhůta pro výmaz (písm. f).");
  if (!a.securityMeasures?.trim() && !a.controlCount) g.push("Chybí popis technických a organizačních opatření (písm. g).");
  if (a.specialCategories.length && a.legalBasis === "legitimate_interest") g.push("Zvláštní kategorie údajů vyžadují výjimku dle čl. 9 odst. 2 – ověřte právní základ.");
  const d = dpiaRequired(a.dpiaCriteria);
  if (d.required && (!a.dpia || a.dpia.status !== "completed")) g.push(`Splněna ${d.count} kritéria pro DPIA – posouzení vlivu není dokončeno (čl. 35).`);
  return g;
}

/* ---------------- DPIA ---------------- */

export const DpiaRiskSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  /** Pravděpodobnost a závažnost dopadu na práva a svobody 1–4 */
  likelihood: z.number().int().min(1).max(4),
  severity: z.number().int().min(1).max(4),
  measures: z.string().trim().max(3000).default(""),
  residualLikelihood: z.number().int().min(1).max(4).nullable().default(null),
  residualSeverity: z.number().int().min(1).max(4).nullable().default(null),
});
export type DpiaRisk = z.infer<typeof DpiaRiskSchema>;

export const DpiaInput = z.object({
  status: z.enum(DPIA_STATUSES).optional(),
  /** Systematický popis zpracování (čl. 35 odst. 7 písm. a) */
  description: text(10000),
  /** Nezbytnost a přiměřenost (písm. b) */
  necessity: text(10000),
  risks: z.array(DpiaRiskSchema).max(50).optional(),
  /** Stanovisko pověřence (čl. 35 odst. 2) */
  dpoOpinion: text(5000),
  /** Rozhodnutí správce / závěr; předchozí konzultace s ÚOOÚ (čl. 36) */
  conclusion: text(5000),
  priorConsultation: z.boolean().optional(),
  nextReview: z.string().date().nullable().optional(),
});
export type DpiaInput = z.input<typeof DpiaInput>;

export interface DpiaDto {
  id: string;
  activityId: string;
  activityName: string;
  status: DpiaStatus;
  description: string | null;
  necessity: string | null;
  risks: DpiaRisk[];
  dpoOpinion: string | null;
  conclusion: string | null;
  priorConsultation: boolean;
  nextReview: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  updatedAt: string;
  /** Nejvyšší zbytkové riziko (pravděpodobnost × závažnost) */
  maxResidual: number | null;
}

/** Úroveň rizika DPIA (1–16): ≥ 9 vysoké → zvážit předchozí konzultaci. */
export const dpiaLevel = (l: number, s: number) => (l * s >= 12 ? "high" : l * s >= 6 ? "medium" : "low");
