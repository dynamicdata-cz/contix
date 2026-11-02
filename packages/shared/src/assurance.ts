import { z } from "zod";
import type { Effectiveness } from "./controls";
import { patchOf } from "./zutil";
import { FrameworkIdSchema } from "./frameworks";

/* ============================================================
 * Důkazy a testování opatření (assurance)
 * – důkazy (evidence) k opatřením s platností – podklad pro audit (§ 16 vyhl. 409), SoA a SOC 2
 * – testy návrhu (design / Type I) a provozní účinnosti (operating / Type II) se vzorky a výjimkami
 * ============================================================ */

export const EVIDENCE_KINDS = ["document", "record", "screenshot", "export", "config", "report", "link", "other"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const TEST_KINDS = ["design", "operating"] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const TEST_METHODS = ["inquiry", "observation", "inspection", "reperformance"] as const;
export type TestMethod = (typeof TEST_METHODS)[number];

export const TEST_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const CONTROL_TEST_RESULTS = ["effective", "effective_with_exceptions", "ineffective", "not_tested"] as const;
export type ControlTestResult = (typeof CONTROL_TEST_RESULTS)[number];

export const SAMPLE_RESULTS = ["pass", "fail", "na"] as const;
export type SampleResult = (typeof SAMPLE_RESULTS)[number];

/** Frekvence provádění opatření – určuje doporučený vzorek. */
export const CONTROL_FREQUENCIES = ["annual", "quarterly", "monthly", "weekly", "daily", "multiple_daily", "event"] as const;
export type ControlFrequency = (typeof CONTROL_FREQUENCIES)[number];

export const ASSURANCE_LABELS = {
  evidenceKind: {
    document: "Dokument / směrnice",
    record: "Záznam (zápis, protokol)",
    screenshot: "Snímek obrazovky",
    export: "Export ze systému",
    config: "Konfigurace",
    report: "Zpráva / report",
    link: "Odkaz",
    other: "Jiné",
  } satisfies Record<EvidenceKind, string>,
  testKind: {
    design: "Test návrhu (existence, Type I)",
    operating: "Test provozní účinnosti (období, Type II)",
  } satisfies Record<TestKind, string>,
  method: {
    inquiry: "Dotazování",
    observation: "Pozorování",
    inspection: "Kontrola dokumentace / záznamů",
    reperformance: "Opakované provedení",
  } satisfies Record<TestMethod, string>,
  status: {
    planned: "Plánováno",
    in_progress: "Probíhá",
    completed: "Dokončeno",
    cancelled: "Zrušeno",
  } satisfies Record<TestStatus, string>,
  result: {
    effective: "Účinné",
    effective_with_exceptions: "Účinné s výjimkami",
    ineffective: "Neúčinné",
    not_tested: "Netestováno",
  } satisfies Record<ControlTestResult, string>,
  sample: { pass: "Vyhovuje", fail: "Výjimka", na: "Nelze posoudit" } satisfies Record<SampleResult, string>,
  frequency: {
    annual: "Ročně",
    quarterly: "Čtvrtletně",
    monthly: "Měsíčně",
    weekly: "Týdně",
    daily: "Denně",
    multiple_daily: "Několikrát denně",
    event: "Při události (dle populace)",
  } satisfies Record<ControlFrequency, string>,
} as const;

/** Max. velikost souboru důkazu (bajty). */
export const EVIDENCE_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Doporučená velikost vzorku pro test provozní účinnosti (běžná praxe auditorů pro manuální opatření;
 * automatizované opatření = 1 + test ITGC). Pro „při události“ podle velikosti populace.
 */
export function recommendedSample(freq: ControlFrequency, population?: number | null): { min: number; max: number } {
  const t: Record<Exclude<ControlFrequency, "event">, [number, number]> = {
    annual: [1, 1],
    quarterly: [2, 2],
    monthly: [2, 5],
    weekly: [5, 15],
    daily: [20, 40],
    multiple_daily: [25, 60],
  };
  if (freq !== "event") {
    const [min, max] = t[freq];
    return { min, max };
  }
  const p = population ?? 0;
  if (p <= 0) return { min: 1, max: 25 };
  if (p < 5) return { min: p, max: p };
  if (p < 50) return { min: Math.min(p, 5), max: Math.min(p, 10) };
  if (p < 250) return { min: 10, max: 25 };
  return { min: 25, max: 60 };
}

/** Výsledek testu odvozený ze vzorků (uživatel může přepsat). */
export function deriveTestResult(samples: { result: SampleResult }[], tolerableExceptions = 0): ControlTestResult {
  const tested = samples.filter((s) => s.result !== "na");
  if (!tested.length) return "not_tested";
  const fails = tested.filter((s) => s.result === "fail").length;
  if (fails === 0) return "effective";
  if (fails <= tolerableExceptions) return "effective_with_exceptions";
  return "ineffective";
}

/** Účinnost opatření, kterou lze z výsledku testu navrhnout. */
export function effectivenessFromResult(r: ControlTestResult): Effectiveness | null {
  return r === "effective" ? "effective" : r === "effective_with_exceptions" ? "partially_effective" : r === "ineffective" ? "ineffective" : null;
}

/** Stav platnosti důkazu. */
export function evidenceValidity(validUntil: string | null, now = new Date(), soonDays = 30): "valid" | "expiring" | "expired" | "none" {
  if (!validUntil) return "none";
  const d = new Date(`${validUntil}T23:59:59`);
  if (d < now) return "expired";
  if (d.getTime() - now.getTime() < soonDays * 86_400_000) return "expiring";
  return "valid";
}

/* ---------------- důkazy ---------------- */

export const EvidenceInput = z.object({
  companyId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullable().optional(),
  kind: z.enum(EVIDENCE_KINDS).default("document"),
  /** Odkaz (SharePoint, Confluence, ticket…) – alternativa nebo doplněk k souboru. */
  // jen http(s) – ne javascript:, data: ani file:
  url: z.string().trim().url().max(2000).regex(/^https?:\/\//i, "Odkaz musí začínat http:// nebo https://").nullable().optional(),
  /** Datum pořízení / období, ke kterému se důkaz vztahuje. */
  collectedAt: z.string().date().nullable().optional(),
  periodFrom: z.string().date().nullable().optional(),
  periodTo: z.string().date().nullable().optional(),
  /** Do kdy je důkaz platný (např. certifikát, roční přezkum) – blíží-li se, upozorní se. */
  validUntil: z.string().date().nullable().optional(),
  controlIds: z.array(z.string().uuid()).max(100).default([]),
  /** Požadavky (ID z rámců), které důkaz přímo dokládá – např. kritérium SOC 2 nebo písmeno vyhlášky. */
  requirementIds: z.array(z.string().max(100)).max(200).default([]),
});
export type EvidenceInput = z.input<typeof EvidenceInput>;

/** Balíček pro auditora – výběr obsahu. */
export const AuditPackageQuery = z.object({
  framework: FrameworkIdSchema,
  periodFrom: z.string().date().optional(),
  periodTo: z.string().date().optional(),
  /** Přiložit soubory důkazů (jinak jen seznam s kontrolními součty). */
  files: z.enum(["1", "0"]).default("1"),
  companyId: z.string().uuid().optional(),
});
export type AuditPackageQuery = z.input<typeof AuditPackageQuery>;
/** Max. celková velikost souborů v balíčku (bajty). */
export const AUDIT_PACKAGE_MAX_BYTES = 500 * 1024 * 1024;
export const EvidencePatch = patchOf(EvidenceInput);

export interface EvidenceFileDto {
  id: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  uploadedByName: string | null;
}

export interface EvidenceDto {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  kind: EvidenceKind;
  url: string | null;
  collectedAt: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  validUntil: string | null;
  validity: ReturnType<typeof evidenceValidity>;
  controls: { id: string; code: string | null; name: string }[];
  requirements: { id: string; ref: string; framework: string }[];
  files: EvidenceFileDto[];
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/* ---------------- testy ---------------- */

export const ControlTestInput = z.object({
  controlId: z.string().uuid(),
  kind: z.enum(TEST_KINDS).default("operating"),
  title: z.string().trim().max(300).nullable().optional(),
  methods: z.array(z.enum(TEST_METHODS)).max(4).default(["inspection"]),
  frequency: z.enum(CONTROL_FREQUENCIES).nullable().optional(),
  periodFrom: z.string().date().nullable().optional(),
  periodTo: z.string().date().nullable().optional(),
  /** Plánovaný termín provedení testu. */
  dueDate: z.string().date().nullable().optional(),
  status: z.enum(TEST_STATUSES).default("planned"),
  /** Kdo testuje (jméno / funkce – může jít i o externího auditora). */
  tester: z.string().trim().max(200).nullable().optional(),
  populationSize: z.number().int().min(0).max(1_000_000).nullable().optional(),
  procedure: z.string().trim().max(10000).nullable().optional(),
  tolerableExceptions: z.number().int().min(0).max(100).default(0),
  /** Ruční výsledek (jinak odvozen ze vzorků). */
  result: z.enum(CONTROL_TEST_RESULTS).nullable().optional(),
  conclusion: z.string().trim().max(10000).nullable().optional(),
  performedAt: z.string().date().nullable().optional(),
});
export type ControlTestInput = z.input<typeof ControlTestInput>;
export const ControlTestPatch = patchOf(ControlTestInput.omit({ controlId: true }));

export const SampleInput = z.object({
  ref: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  result: z.enum(SAMPLE_RESULTS).default("pass"),
  note: z.string().trim().max(2000).nullable().optional(),
  evidenceId: z.string().uuid().nullable().optional(),
});
export type SampleInput = z.input<typeof SampleInput>;

export const CompleteTestInput = z.object({
  result: z.enum(CONTROL_TEST_RESULTS),
  conclusion: z.string().trim().min(1).max(10000),
  performedAt: z.string().date().optional(),
  /** Promítnout výsledek do účinnosti opatření (a data posledního přezkumu). */
  applyEffectiveness: z.boolean().default(true),
});
export type CompleteTestInput = z.input<typeof CompleteTestInput>;

export interface ControlTestSampleDto {
  id: string;
  ref: string;
  description: string | null;
  result: SampleResult;
  note: string | null;
  evidenceId: string | null;
  evidenceTitle: string | null;
}

export interface ControlTestDto {
  id: string;
  companyId: string;
  controlId: string;
  controlCode: string | null;
  controlName: string;
  kind: TestKind;
  title: string | null;
  methods: TestMethod[];
  frequency: ControlFrequency | null;
  periodFrom: string | null;
  periodTo: string | null;
  dueDate: string | null;
  status: TestStatus;
  tester: string | null;
  populationSize: number | null;
  procedure: string | null;
  tolerableExceptions: number;
  result: ControlTestResult | null;
  derivedResult: ControlTestResult;
  conclusion: string | null;
  performedAt: string | null;
  sampleCount: number;
  exceptions: number;
  recommended: { min: number; max: number } | null;
  samples: ControlTestSampleDto[];
  createdAt: string;
  updatedAt: string;
}

/** Souhrn ověření opatření (pro detail a přehled). */
export interface ControlAssurance {
  evidenceCount: number;
  evidenceExpired: number;
  lastTest: { id: string; kind: TestKind; result: ControlTestResult | null; performedAt: string | null } | null;
  nextTestDue: string | null;
}
