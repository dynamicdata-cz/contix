import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * AI Act – nařízení (EU) 2024/1689 ve znění nařízení (EU) 2026/1744 (Digital Omnibus) – ADR-090.
 * Registr AI systémů organizace (zavádějící subjekt i poskytovatel), screening zakázaných praktik (čl. 5),
 * klasifikace rizika (čl. 6, přílohy I a III, transparentnost čl. 50), povinnosti podle role a třídy,
 * posouzení dopadu na základní práva (FRIA, čl. 27), AI gramotnost (čl. 4) a šablona interní směrnice.
 * Klasifikace a povinnosti se počítají při čtení – persistují se jen odpovědi screeningu a stav povinností.
 * ============================================================ */

/** Role organizace k AI systému (čl. 3 odst. 3 a 4). Dovozce a distributor nejsou v rozsahu. */
export const AI_ROLES = ["deployer", "provider", "provider_deployer"] as const;
export type AiRole = (typeof AI_ROLES)[number];
export const AI_SYSTEM_STATUSES = ["proposed", "approved", "in_use", "rejected", "retired"] as const;
export type AiSystemStatus = (typeof AI_SYSTEM_STATUSES)[number];
/** Odkud systém pochází. */
export const AI_SOURCES = ["saas", "on_prem", "embedded", "internal"] as const;
export type AiSource = (typeof AI_SOURCES)[number];
export const AI_RISK_CLASSES = ["unassessed", "prohibited", "high", "limited", "minimal"] as const;
export type AiRiskClass = (typeof AI_RISK_CLASSES)[number];
export const AI_OBLIGATION_STATUSES = ["open", "in_progress", "done", "na"] as const;
export type AiObligationStatus = (typeof AI_OBLIGATION_STATUSES)[number];
export const FRIA_STATUSES = ["draft", "completed"] as const;
export type FriaStatus = (typeof FRIA_STATUSES)[number];

/** Zakázané praktiky (čl. 5 odst. 1). `from` = den použitelnosti zákazu. */
export const AI_PROHIBITED = [
  { key: "manipulation", ref: "čl. 5 odst. 1 písm. a)", from: "2025-02-02" },
  { key: "exploitation", ref: "čl. 5 odst. 1 písm. b)", from: "2025-02-02" },
  { key: "intimate_imagery", ref: "čl. 5 odst. 1 písm. ba)", from: "2026-12-02" },
  { key: "csam", ref: "čl. 5 odst. 1 písm. bb)", from: "2026-12-02" },
  { key: "social_scoring", ref: "čl. 5 odst. 1 písm. c)", from: "2025-02-02" },
  { key: "crime_prediction", ref: "čl. 5 odst. 1 písm. d)", from: "2025-02-02" },
  { key: "face_scraping", ref: "čl. 5 odst. 1 písm. e)", from: "2025-02-02" },
  { key: "emotion_workplace", ref: "čl. 5 odst. 1 písm. f)", from: "2025-02-02" },
  { key: "biometric_sensitive", ref: "čl. 5 odst. 1 písm. g)", from: "2025-02-02" },
  { key: "realtime_rbi", ref: "čl. 5 odst. 1 písm. h)", from: "2025-02-02" },
] as const;
export type AiProhibitedKey = (typeof AI_PROHIBITED)[number]["key"];
export const AI_PROHIBITED_KEYS = AI_PROHIBITED.map((p) => p.key) as AiProhibitedKey[];

/** Vysoce rizikové oblasti použití (příloha III). `fria` = FRIA i pro soukromé subjekty (čl. 27 odst. 1 – příloha III bod 5 písm. b, c). */
export const AI_ANNEX_III = [
  { key: "biometric_id", ref: "příl. III bod 1 a)", area: 1 },
  { key: "biometric_categorisation", ref: "příl. III bod 1 b)", area: 1 },
  { key: "emotion_recognition", ref: "příl. III bod 1 c)", area: 1 },
  { key: "critical_infrastructure", ref: "příl. III bod 2", area: 2 },
  { key: "education_access", ref: "příl. III bod 3 a)", area: 3 },
  { key: "education_evaluation", ref: "příl. III bod 3 b), c)", area: 3 },
  { key: "exam_monitoring", ref: "příl. III bod 3 d)", area: 3 },
  { key: "recruitment", ref: "příl. III bod 4 a)", area: 4 },
  { key: "employment_decisions", ref: "příl. III bod 4 b)", area: 4 },
  { key: "public_benefits", ref: "příl. III bod 5 a)", area: 5 },
  { key: "creditworthiness", ref: "příl. III bod 5 b)", area: 5, fria: true },
  { key: "insurance_pricing", ref: "příl. III bod 5 c)", area: 5, fria: true },
  { key: "emergency_triage", ref: "příl. III bod 5 d)", area: 5 },
  { key: "law_enforcement", ref: "příl. III bod 6", area: 6 },
  { key: "migration", ref: "příl. III bod 7", area: 7 },
  { key: "justice", ref: "příl. III bod 8 a)", area: 8 },
  { key: "elections", ref: "příl. III bod 8 b)", area: 8 },
] as const;
export type AiAnnexIIIKey = (typeof AI_ANNEX_III)[number]["key"];
export const AI_ANNEX_III_KEYS = AI_ANNEX_III.map((a) => a.key) as AiAnnexIIIKey[];

/** Výjimky z vysokého rizika (čl. 6 odst. 3) – neplatí, provádí-li systém profilování fyzických osob. */
export const AI_EXCEPTIONS = ["narrow_task", "improve_human", "detect_patterns", "preparatory"] as const;
export type AiException = (typeof AI_EXCEPTIONS)[number];

/** Spouštěče povinností transparentnosti (čl. 50). */
export const AI_TRANSPARENCY = [
  { key: "interacts", ref: "čl. 50 odst. 1", role: "provider" },
  { key: "synthetic_content", ref: "čl. 50 odst. 2", role: "provider" },
  { key: "emotion_biometric", ref: "čl. 50 odst. 3", role: "deployer" },
  { key: "deepfake", ref: "čl. 50 odst. 4", role: "deployer" },
  { key: "public_text", ref: "čl. 50 odst. 4", role: "deployer" },
] as const;
export type AiTransparencyKey = (typeof AI_TRANSPARENCY)[number]["key"];
export const AI_TRANSPARENCY_KEYS = AI_TRANSPARENCY.map((a) => a.key) as AiTransparencyKey[];

/** Odpovědi screeningu (persistují se; třída se z nich počítá). */
export const AiScreening = z.object({
  prohibited: z.array(z.enum(AI_PROHIBITED_KEYS as [AiProhibitedKey, ...AiProhibitedKey[]])).max(20).default([]),
  /** Bezpečnostní komponenta / výrobek podle harmonizačních předpisů přílohy I s posouzením shody třetí stranou (čl. 6 odst. 1). */
  annexI: z.boolean().default(false),
  annexIII: z.array(z.enum(AI_ANNEX_III_KEYS as [AiAnnexIIIKey, ...AiAnnexIIIKey[]])).max(20).default([]),
  /** Výjimka čl. 6 odst. 3 (jen u použití z přílohy III). */
  exception: z.enum(AI_EXCEPTIONS).nullable().default(null),
  /** Systém provádí profilování fyzických osob – výjimka neplatí. */
  profiling: z.boolean().default(false),
  transparency: z.array(z.enum(AI_TRANSPARENCY_KEYS as [AiTransparencyKey, ...AiTransparencyKey[]])).max(10).default([]),
  /** Postaveno na obecném modelu AI (GPAI – např. jazykový model). */
  gpai: z.boolean().default(false),
  /** Organizace je subjekt veřejného práva nebo poskytuje veřejné služby (FRIA čl. 27, registrace čl. 26 odst. 8). */
  publicService: z.boolean().default(false),
  /** Systém zpracovává osobní údaje (DPIA – čl. 26 odst. 9). */
  personalData: z.boolean().default(false),
});
export type AiScreening = z.infer<typeof AiScreening>;
export const EMPTY_SCREENING: AiScreening = AiScreening.parse({});

export interface AiClassification {
  cls: AiRiskClass;
  /** Použití z přílohy III, které díky výjimce čl. 6 odst. 3 není vysoce rizikové (poskytovatel: dokumentace + registrace). */
  annexIIIExempt: boolean;
  /** Důvody (odkazy na ustanovení). */
  reasons: string[];
  /** Od kdy platí povinnosti vysokého rizika (podle přílohy I / III, nařízení 2026/1744). */
  highRiskFrom: string | null;
}

/** Klasifikace rizika AI systému. Nevyplněný screening = neposouzeno. */
export function classifyAiSystem(s: AiScreening | null): AiClassification {
  if (!s) return { cls: "unassessed", annexIIIExempt: false, reasons: [], highRiskFrom: null };
  const reasons: string[] = [];
  if (s.prohibited.length) {
    for (const k of s.prohibited) reasons.push(AI_PROHIBITED.find((p) => p.key === k)!.ref);
    return { cls: "prohibited", annexIIIExempt: false, reasons, highRiskFrom: null };
  }
  const exempt = !!s.annexIII.length && !!s.exception && !s.profiling;
  const highIII = !!s.annexIII.length && !exempt;
  if (s.annexI || highIII) {
    if (s.annexI) reasons.push("čl. 6 odst. 1, příl. I");
    if (highIII) for (const k of s.annexIII) reasons.push(AI_ANNEX_III.find((a) => a.key === k)!.ref);
    if (highIII && s.profiling && s.exception) reasons.push("čl. 6 odst. 3 – profilování");
    return { cls: "high", annexIIIExempt: false, reasons, highRiskFrom: highIII ? "2027-12-02" : "2028-08-02" };
  }
  if (exempt) reasons.push("čl. 6 odst. 3");
  if (s.transparency.length) {
    for (const k of s.transparency) reasons.push(AI_TRANSPARENCY.find((a) => a.key === k)!.ref);
    return { cls: "limited", annexIIIExempt: exempt, reasons, highRiskFrom: null };
  }
  return { cls: "minimal", annexIIIExempt: exempt, reasons, highRiskFrom: null };
}

/* ---------------- povinnosti podle role a třídy ---------------- */

type ObligationRole = "deployer" | "provider" | "any";
interface ObligationDef {
  key: string;
  ref: string;
  role: ObligationRole;
  /** Platí pro systém? */
  applies: (s: AiScreening, c: AiClassification) => boolean;
  /** Den použitelnosti (null = podle `highRiskFrom`). */
  from: string | null;
}

const high = (_s: AiScreening, c: AiClassification) => c.cls === "high";
const highIII = (s: AiScreening, c: AiClassification) => c.cls === "high" && s.annexIII.length > 0;
const tr = (k: AiTransparencyKey) => (s: AiScreening, c: AiClassification) => c.cls !== "prohibited" && s.transparency.includes(k);

export const AI_OBLIGATIONS: ObligationDef[] = [
  { key: "literacy", ref: "čl. 4", role: "any", applies: (_s, c) => c.cls !== "prohibited", from: "2025-02-02" },
  // zavádějící subjekt (čl. 26, 27, 50, 86)
  { key: "d_instructions", ref: "čl. 26 odst. 1", role: "deployer", applies: high, from: null },
  { key: "d_oversight", ref: "čl. 26 odst. 2", role: "deployer", applies: high, from: null },
  { key: "d_input_data", ref: "čl. 26 odst. 4", role: "deployer", applies: high, from: null },
  { key: "d_monitoring", ref: "čl. 26 odst. 5", role: "deployer", applies: high, from: null },
  { key: "d_logs", ref: "čl. 26 odst. 6", role: "deployer", applies: high, from: null },
  { key: "d_workers", ref: "čl. 26 odst. 7", role: "deployer", applies: high, from: null },
  { key: "d_registration", ref: "čl. 26 odst. 8, čl. 49 odst. 3", role: "deployer", applies: (s, c) => high(s, c) && s.publicService, from: null },
  { key: "d_dpia", ref: "čl. 26 odst. 9, čl. 35 GDPR", role: "deployer", applies: (s, c) => high(s, c) && s.personalData, from: null },
  { key: "d_inform_persons", ref: "čl. 26 odst. 11", role: "deployer", applies: highIII, from: null },
  { key: "d_explanation", ref: "čl. 86", role: "deployer", applies: highIII, from: null },
  { key: "fria", ref: "čl. 27", role: "deployer", applies: (s, c) => friaRequired(s, c), from: null },
  { key: "t_emotion", ref: "čl. 50 odst. 3", role: "deployer", applies: tr("emotion_biometric"), from: "2026-08-02" },
  { key: "t_deepfake", ref: "čl. 50 odst. 4", role: "deployer", applies: tr("deepfake"), from: "2026-08-02" },
  { key: "t_public_text", ref: "čl. 50 odst. 4", role: "deployer", applies: tr("public_text"), from: "2026-08-02" },
  // poskytovatel (čl. 9–20, 43–49, 72, 73, 50)
  { key: "p_risk_mgmt", ref: "čl. 9", role: "provider", applies: high, from: null },
  { key: "p_data", ref: "čl. 10", role: "provider", applies: high, from: null },
  { key: "p_tech_doc", ref: "čl. 11, příl. IV", role: "provider", applies: high, from: null },
  { key: "p_logging", ref: "čl. 12, 19", role: "provider", applies: high, from: null },
  { key: "p_instructions", ref: "čl. 13", role: "provider", applies: high, from: null },
  { key: "p_oversight", ref: "čl. 14", role: "provider", applies: high, from: null },
  { key: "p_accuracy", ref: "čl. 15", role: "provider", applies: high, from: null },
  { key: "p_qms", ref: "čl. 17", role: "provider", applies: high, from: null },
  { key: "p_doc_keeping", ref: "čl. 18", role: "provider", applies: high, from: null },
  { key: "p_conformity", ref: "čl. 43", role: "provider", applies: high, from: null },
  { key: "p_declaration", ref: "čl. 47, 48", role: "provider", applies: high, from: null },
  { key: "p_registration", ref: "čl. 49 odst. 1", role: "provider", applies: high, from: null },
  { key: "p_exempt_registration", ref: "čl. 6 odst. 4, čl. 49 odst. 2", role: "provider", applies: (_s, c) => c.annexIIIExempt, from: "2027-12-02" },
  { key: "p_postmarket", ref: "čl. 72", role: "provider", applies: high, from: null },
  { key: "p_incidents", ref: "čl. 73", role: "provider", applies: high, from: null },
  { key: "p_corrective", ref: "čl. 20", role: "provider", applies: high, from: null },
  { key: "t_interacts", ref: "čl. 50 odst. 1", role: "provider", applies: tr("interacts"), from: "2026-08-02" },
  { key: "t_marking", ref: "čl. 50 odst. 2", role: "provider", applies: tr("synthetic_content"), from: "2026-08-02" },
];
export type AiObligationKey = (typeof AI_OBLIGATIONS)[number]["key"];

/** FRIA (čl. 27): vysoce rizikový systém z přílohy III (mimo bod 2) u subjektu veřejného práva / poskytovatele veřejných služeb,
 *  nebo použití z bodu 5 písm. b) a c) (bonita, životní a zdravotní pojištění). */
export function friaRequired(s: AiScreening, c: AiClassification): boolean {
  if (c.cls !== "high") return false;
  const uses = s.annexIII.filter((k) => k !== "critical_infrastructure");
  if (!uses.length) return false;
  return s.publicService || uses.some((k) => AI_ANNEX_III.find((a) => a.key === k && "fria" in a && a.fria));
}

const roleMatches = (r: ObligationRole, role: AiRole) => r === "any" || role === "provider_deployer" || r === role;

export interface AiObligationState {
  status: AiObligationStatus;
  note: string | null;
  at: string | null;
}
export interface AiObligationItem extends AiObligationState {
  key: string;
  ref: string;
  role: ObligationRole;
  /** Den, od kterého povinnost platí. */
  from: string;
}

/** Povinnosti systému podle role a klasifikace se stavem z evidence. */
export function aiObligationsFor(role: AiRole, s: AiScreening | null, states: Record<string, AiObligationState | undefined>): AiObligationItem[] {
  if (!s) return [];
  const c = classifyAiSystem(s);
  return AI_OBLIGATIONS.filter((o) => roleMatches(o.role, role) && o.applies(s, c)).map((o) => {
    const st = states[o.key];
    return { key: o.key, ref: o.ref, role: o.role, from: o.from ?? c.highRiskFrom ?? "2027-12-02", status: st?.status ?? "open", note: st?.note ?? null, at: st?.at ?? null };
  });
}

/* ---------------- FRIA ---------------- */

/** Prvky posouzení dopadu na základní práva (čl. 27 odst. 1 písm. a–f). */
export const FRIA_FIELDS = ["process", "period", "affected", "risks", "oversight", "mitigation"] as const;
export type FriaField = (typeof FRIA_FIELDS)[number];
const longText = z.string().trim().max(10000).nullable().optional();
export const FriaInput = z.object({
  process: longText,
  period: longText,
  affected: longText,
  risks: longText,
  oversight: longText,
  mitigation: longText,
  /** Oznámení výsledků orgánu dozoru nad trhem (čl. 27 odst. 3). */
  authorityNotifiedAt: z.string().date().nullable().optional(),
  nextReview: z.string().date().nullable().optional(),
});
export type FriaInput = z.input<typeof FriaInput>;
export type FriaData = Partial<Record<FriaField, string | null>> & { authorityNotifiedAt?: string | null; nextReview?: string | null };
export const friaMissing = (f: FriaData | null) => FRIA_FIELDS.filter((k) => !f?.[k]?.trim());

/* ---------------- mezery ---------------- */

export const AI_GAPS = [
  "not_screened",
  "prohibited",
  "no_purpose",
  "no_owner",
  "not_approved",
  "no_oversight",
  "fria_missing",
  "dpia_missing",
  "obligations_open",
  "review_overdue",
] as const;
export type AiGap = (typeof AI_GAPS)[number];

export function aiSystemGaps(a: {
  status: AiSystemStatus;
  purpose: string;
  ownerPositionId: string | null;
  oversightPositionId: string | null;
  screening: AiScreening | null;
  obligations: AiObligationItem[];
  friaStatus: FriaStatus | null;
  /** Použití bylo schváleno (rozhodnutí vlastníka). */
  decided: boolean;
  /** Navázaná činnost zpracování má dokončené DPIA (null = bez vazby). */
  dpiaCompleted: boolean | null;
  nextReview: string | null;
  today: string;
}): AiGap[] {
  if (a.status === "retired" || a.status === "rejected") return [];
  const g: AiGap[] = [];
  const c = classifyAiSystem(a.screening);
  if (c.cls === "unassessed") g.push("not_screened");
  if (c.cls === "prohibited") g.push("prohibited");
  if (!a.purpose.trim()) g.push("no_purpose");
  if (!a.ownerPositionId) g.push("no_owner");
  if (a.status === "in_use" && !a.decided) g.push("not_approved");
  if (c.cls === "high" && !a.oversightPositionId) g.push("no_oversight");
  if (a.obligations.some((o) => o.key === "fria") && a.friaStatus !== "completed") g.push("fria_missing");
  if (a.obligations.some((o) => o.key === "d_dpia") && a.dpiaCompleted !== true) g.push("dpia_missing");
  if (a.obligations.some((o) => o.status === "open" || o.status === "in_progress")) g.push("obligations_open");
  if (a.nextReview && a.nextReview < a.today) g.push("review_overdue");
  return g;
}

/* ---------------- vstupy a DTO ---------------- */

const text = (max = 5000) => z.string().trim().max(max).nullable().optional();

export const AiSystemInput = z.object({
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  vendor: text(300),
  /** Model / verze (např. GPT-4o, Llama 3.1 70B, interní model). */
  model: text(300),
  role: z.enum(AI_ROLES).default("deployer"),
  source: z.enum(AI_SOURCES).default("saas"),
  status: z.enum(AI_SYSTEM_STATUSES).default("proposed"),
  /** Účel a způsob použití v organizaci (zamýšlený účel – čl. 3 odst. 12). */
  purpose: z.string().trim().max(5000).default(""),
  description: text(),
  /** Kdo systém používá (útvary, role, počet uživatelů). */
  users: text(2000),
  /** Vstupní data (jaké údaje do systému vstupují, klasifikace informací). */
  inputData: text(3000),
  /** Výstupy a jak se s nimi nakládá (rozhodnutí, doporučení, obsah). */
  outputs: text(3000),
  /** Lidský dohled – jak výstupy kontroluje člověk. */
  humanOversight: text(3000),
  /** Kde jsou data zpracována (EU / mimo EU, poskytovatel cloudu). */
  dataLocation: text(500),
  /** Návod k použití / podmínky poskytovatele. */
  instructionsUrl: text(1000),
  /** Doba uchování logů v měsících (čl. 26 odst. 6 – nejméně 6). */
  logRetentionMonths: z.number().int().min(0).max(240).nullable().optional(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  /** Osoba pověřená lidským dohledem (čl. 26 odst. 2) – funkční místo. */
  oversightPositionId: z.string().uuid().nullable().optional(),
  screening: AiScreening.nullable().optional(),
  reviewMonths: z.number().int().min(1).max(60).default(12),
  processIds: z.array(z.string().uuid()).max(50).default([]),
  assetIds: z.array(z.string().uuid()).max(100).default([]),
  supplierIds: z.array(z.string().uuid()).max(20).default([]),
  /** Činnosti zpracování (GDPR) – DPIA. */
  activityIds: z.array(z.string().uuid()).max(20).default([]),
  /** Rizika a opatření AI systému (v1.11). */
  riskIds: z.array(z.string().uuid()).max(50).default([]),
  controlIds: z.array(z.string().uuid()).max(50).default([]),
});
export type AiSystemInput = z.input<typeof AiSystemInput>;
export const AiSystemPatch = patchOf(AiSystemInput.omit({ companyId: true }));

export const AiObligationInput = z.object({ status: z.enum(AI_OBLIGATION_STATUSES), note: z.string().trim().max(3000).nullable().optional() });
export const AiSystemDecisionInput = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().trim().max(3000).nullable().optional() });
export const AiDirectiveInput = z.object({
  companyId: z.string().uuid().optional(),
  /** Vytvořit i kurz AI gramotnosti navázaný na shrnutí (čl. 4). */
  course: z.boolean().default(true),
});

export interface AiSystemDto {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  vendor: string | null;
  model: string | null;
  role: AiRole;
  source: AiSource;
  status: AiSystemStatus;
  purpose: string;
  description: string | null;
  users: string | null;
  inputData: string | null;
  outputs: string | null;
  humanOversight: string | null;
  dataLocation: string | null;
  instructionsUrl: string | null;
  logRetentionMonths: number | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  oversightPositionId: string | null;
  oversightPositionName: string | null;
  screening: AiScreening | null;
  screenedAt: string | null;
  classification: AiClassification;
  obligations: AiObligationItem[];
  fria: (FriaData & { status: FriaStatus; approvedAt: string | null; approvedByName: string | null }) | null;
  friaRequired: boolean;
  decision: { at: string; byName: string | null; note: string | null } | null;
  processes: { id: string; code: string | null; name: string }[];
  assets: { id: string; name: string; assetType: string }[];
  suppliers: { id: string; name: string }[];
  activities: { id: string; code: string | null; name: string; dpiaStatus: string | null }[];
  risks: { id: string; code: string | null; name: string }[];
  controls: { id: string; code: string | null; name: string }[];
  reviewMonths: number;
  lastReviewedAt: string | null;
  nextReview: string | null;
  gaps: AiGap[];
  canEdit: boolean;
  updatedAt: string;
}

export interface AiLiteracyCourse {
  id: string;
  title: string;
  required: number;
  ok: number;
  overdue: number;
  missing: number;
}
export interface AiSummaryDto {
  total: number;
  byClass: Record<AiRiskClass, number>;
  byStatus: Record<AiSystemStatus, number>;
  withGaps: number;
  friaOpen: number;
  /** Kurzy s tématem AI gramotnosti (čl. 4). */
  literacy: AiLiteracyCourse[];
  /** Platná / rozpracovaná směrnice o AI vytvořená ze šablony. */
  directive: { id: string; title: string; status: string } | null;
}

/** Téma kurzu, podle kterého se pozná kurz AI gramotnosti. */
export const AI_LITERACY_TOPIC = "AI gramotnost";

/* ---------------- popisky ---------------- */

export const AIACT_LABELS = {
  role: { deployer: "Zavádějící subjekt (uživatel)", provider: "Poskytovatel", provider_deployer: "Poskytovatel i zavádějící subjekt" } satisfies Record<AiRole, string>,
  status: { proposed: "Navrženo ke schválení", approved: "Schváleno", in_use: "Používá se", rejected: "Zamítnuto", retired: "Vyřazeno" } satisfies Record<AiSystemStatus, string>,
  source: { saas: "Cloudová služba (SaaS)", on_prem: "Provoz u nás (on-premise)", embedded: "Součást jiného produktu", internal: "Vlastní vývoj" } satisfies Record<AiSource, string>,
  cls: { unassessed: "Neposouzeno", prohibited: "Zakázaná praktika", high: "Vysoké riziko", limited: "Omezené riziko (transparentnost)", minimal: "Minimální riziko" } satisfies Record<AiRiskClass, string>,
  obligationStatus: { open: "Nesplněno", in_progress: "Rozpracováno", done: "Splněno", na: "Netýká se" } satisfies Record<AiObligationStatus, string>,
  friaStatus: { draft: "Rozpracováno", completed: "Dokončeno" } satisfies Record<FriaStatus, string>,
  prohibited: {
    manipulation: "Podprahové, manipulativní nebo klamavé techniky, které podstatně narušují chování osob a mohou způsobit závažnou újmu",
    exploitation: "Zneužívání zranitelnosti osob kvůli věku, zdravotnímu postižení nebo sociální či ekonomické situaci",
    intimate_imagery: "Vytváření nebo úprava intimních či sexuálně explicitních zobrazení identifikovatelné osoby bez jejího souhlasu (od 2. 12. 2026)",
    csam: "Vytváření materiálu zobrazujícího sexuální zneužívání dětí (od 2. 12. 2026)",
    social_scoring: "Sociální skóre – hodnocení osob podle chování nebo osobnostních rysů vedoucí k nepříznivému zacházení",
    crime_prediction: "Předpovídání, že osoba spáchá trestný čin, jen na základě profilování nebo osobnostních rysů",
    face_scraping: "Necílené stahování snímků obličejů z internetu nebo kamer pro databáze rozpoznávání obličejů",
    emotion_workplace: "Rozpoznávání emocí na pracovišti nebo ve vzdělávání (mimo zdravotní a bezpečnostní důvody)",
    biometric_sensitive: "Biometrická kategorizace odvozující rasu, politické názory, členství v odborech, náboženství nebo sexuální orientaci",
    realtime_rbi: "Biometrická identifikace na dálku v reálném čase na veřejně přístupných místech pro účely vymáhání práva",
  } satisfies Record<AiProhibitedKey, string>,
  annexIII: {
    biometric_id: "Biometrická identifikace na dálku",
    biometric_categorisation: "Biometrická kategorizace podle citlivých znaků",
    emotion_recognition: "Rozpoznávání emocí",
    critical_infrastructure: "Bezpečnostní komponenta kritické infrastruktury (digitální infrastruktura, doprava, voda, plyn, teplo, elektřina)",
    education_access: "Vzdělávání – přijímání a přidělování ke studiu",
    education_evaluation: "Vzdělávání – hodnocení výsledků učení a úrovně vzdělání",
    exam_monitoring: "Vzdělávání – sledování zakázaného chování při testech",
    recruitment: "Zaměstnání – nábor, inzerce, třídění žádostí, hodnocení uchazečů",
    employment_decisions: "Zaměstnání – povýšení, ukončení, přidělování úkolů, sledování a hodnocení výkonu",
    public_benefits: "Nárok na veřejné dávky a služby",
    creditworthiness: "Úvěruschopnost a úvěrové skóre fyzických osob (mimo odhalování podvodů)",
    insurance_pricing: "Posouzení rizika a ceny životního a zdravotního pojištění",
    emergency_triage: "Tísňová volání a třídění pacientů (triáž)",
    law_enforcement: "Vymáhání práva",
    migration: "Migrace, azyl a ochrana hranic",
    justice: "Výkon spravedlnosti – pomoc soudním orgánům",
    elections: "Ovlivňování výsledku voleb nebo hlasování",
  } satisfies Record<AiAnnexIIIKey, string>,
  exception: {
    narrow_task: "Plní úzce vymezený procedurální úkol",
    improve_human: "Zlepšuje výsledek dříve dokončené lidské činnosti",
    detect_patterns: "Odhaluje vzorce rozhodování nebo odchylky – nenahrazuje lidské posouzení",
    preparatory: "Provádí přípravný úkol k posouzení",
  } satisfies Record<AiException, string>,
  transparency: {
    interacts: "Přímo komunikuje s lidmi (chatbot, hlasový asistent)",
    synthetic_content: "Vytváří syntetický zvuk, obraz, video nebo text",
    emotion_biometric: "Rozpoznává emoce nebo biometricky kategorizuje osoby",
    deepfake: "Vytváří nebo upravuje obsah typu deepfake",
    public_text: "Generuje texty zveřejňované k informování veřejnosti",
  } satisfies Record<AiTransparencyKey, string>,
  obligation: {
    literacy: "Opatření k podpoře AI gramotnosti zaměstnanců a dalších osob, které systém obsluhují",
    d_instructions: "Technická a organizační opatření k používání v souladu s návodem poskytovatele",
    d_oversight: "Lidský dohled svěřen osobám s potřebnou způsobilostí, odbornou přípravou a pravomocí",
    d_input_data: "Vstupní data relevantní a dostatečně reprezentativní vzhledem k účelu",
    d_monitoring: "Monitorování provozu; informování poskytovatele a orgánu dozoru o riziku nebo závažném incidentu, pozastavení",
    d_logs: "Uchovávání automaticky generovaných logů alespoň 6 měsíců",
    d_workers: "Informování zástupců zaměstnanců a dotčených zaměstnanců před zavedením na pracovišti",
    d_registration: "Registrace použití v databázi EU (veřejný subjekt); nepoužívat neregistrovaný systém",
    d_dpia: "Posouzení vlivu na ochranu osobních údajů (DPIA) s využitím informací od poskytovatele",
    d_inform_persons: "Informování fyzických osob, že o nich rozhoduje nebo s rozhodováním pomáhá vysoce rizikový systém",
    d_explanation: "Postup pro vysvětlení individuálního rozhodnutí na žádost dotčené osoby",
    fria: "Posouzení dopadu na základní práva (FRIA) před prvním použitím a oznámení výsledků orgánu dozoru",
    t_emotion: "Informování osob vystavených rozpoznávání emocí nebo biometrické kategorizaci",
    t_deepfake: "Zveřejnění, že obsah typu deepfake byl uměle vytvořen nebo upraven",
    t_public_text: "Označení AI textů zveřejněných k informování veřejnosti (pokud neprošly lidskou redakcí)",
    p_risk_mgmt: "Systém řízení rizik po celý životní cyklus",
    p_data: "Správa dat – trénovací, validační a testovací data",
    p_tech_doc: "Technická dokumentace podle přílohy IV",
    p_logging: "Automatické zaznamenávání událostí (logy) a jejich uchovávání",
    p_instructions: "Návod k použití a informace pro zavádějící subjekty",
    p_oversight: "Návrh umožňující účinný lidský dohled",
    p_accuracy: "Přesnost, spolehlivost a kybernetická bezpečnost",
    p_qms: "Systém řízení kvality",
    p_doc_keeping: "Uchovávání dokumentace 10 let",
    p_conformity: "Posouzení shody (interní kontrola nebo oznámený subjekt)",
    p_declaration: "EU prohlášení o shodě a označení CE",
    p_registration: "Registrace systému v databázi EU před uvedením na trh",
    p_exempt_registration: "Zdokumentované posouzení, že systém z přílohy III není vysoce rizikový, a jeho registrace",
    p_postmarket: "Monitorování po uvedení na trh",
    p_incidents: "Hlášení závažných incidentů orgánu dozoru",
    p_corrective: "Nápravná opatření a informační povinnost",
    t_interacts: "Informování osob, že komunikují se systémem AI",
    t_marking: "Strojově čitelné označení syntetického obsahu",
  } satisfies Record<AiObligationKey, string>,
  fria: {
    process: "a) Popis procesů, ve kterých se systém používá v souladu se zamýšleným účelem",
    period: "b) Doba a četnost používání",
    affected: "c) Kategorie fyzických osob a skupin, které mohou být dotčeny",
    risks: "d) Konkrétní rizika újmy pro tyto osoby a skupiny",
    oversight: "e) Opatření lidského dohledu podle návodu k použití",
    mitigation: "f) Opatření pro případ naplnění rizik, interní správa a mechanismus stížností",
  } satisfies Record<FriaField, string>,
  gap: {
    not_screened: "Chybí screening – klasifikace rizika",
    prohibited: "Zakázaná praktika – systém nesmí být používán",
    no_purpose: "Chybí účel použití",
    no_owner: "Chybí odpovědné funkční místo",
    not_approved: "Používá se bez posouzení a schválení",
    no_oversight: "Vysoce rizikový systém bez pověřeného lidského dohledu",
    fria_missing: "Posouzení dopadu na základní práva (FRIA) není dokončeno",
    dpia_missing: "Chybí dokončené DPIA navázané činnosti zpracování",
    obligations_open: "Nesplněné povinnosti",
    review_overdue: "Přezkum po termínu",
  } satisfies Record<AiGap, string>,
} as const;

export const AI_CLASS_ORDER: AiRiskClass[] = ["prohibited", "high", "limited", "minimal", "unassessed"];
