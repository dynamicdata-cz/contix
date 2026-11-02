import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Plány kontinuity činností a plány obnovy – § 15 písm. e) vyhl. č. 409/2025 Sb.
 * (vypracovat, aktualizovat a pravidelně testovat) a § 4 odst. 1 písm. i) (vrcholné vedení zajistí testování).
 * Vyhl. č. 410/2025 Sb. § 6: priorita a postupy obnovy technických aktiv, odpovědnosti, zálohy.
 * ============================================================ */

export const PLAN_TYPES = ["continuity", "recovery", "incident_response", "crisis_communication"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
export const PLAN_STATUSES = ["draft", "approved", "retired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const TEST_TYPES = ["tabletop", "walkthrough", "simulation", "full"] as const;
export type TestType = (typeof TEST_TYPES)[number];
export const TEST_RESULTS = ["passed", "partial", "failed"] as const;
export type TestResult = (typeof TEST_RESULTS)[number];

export const BCM_LABELS = {
  planType: {
    continuity: "Plán kontinuity činností",
    recovery: "Plán obnovy",
    incident_response: "Plán reakce na incident",
    crisis_communication: "Plán krizové komunikace",
  } satisfies Record<PlanType, string>,
  status: { draft: "Návrh", approved: "Schválený", retired: "Zrušený" } satisfies Record<PlanStatus, string>,
  testType: {
    tabletop: "Stolní cvičení (tabletop)",
    walkthrough: "Procházka postupem (walkthrough)",
    simulation: "Simulace",
    full: "Plný test / přepnutí",
  } satisfies Record<TestType, string>,
  result: { passed: "Úspěšný", partial: "Částečně úspěšný", failed: "Neúspěšný" } satisfies Record<TestResult, string>,
} as const;

const text = (max = 10000) => z.string().trim().max(max).optional().nullable();

export const PlanStep = z.object({
  title: z.string().trim().min(1).max(500),
  description: text(5000),
  /** Odpovědné funkční místo (nebo volný text v `responsibleText`). */
  responsiblePositionId: z.string().uuid().nullable().optional(),
  responsibleText: text(300),
  /** Cílový čas dokončení kroku od aktivace (min). */
  targetMinutes: z.number().int().min(0).max(60 * 24 * 60).nullable().optional(),
});
export type PlanStep = z.infer<typeof PlanStep>;

export const PlanContact = z.object({
  name: z.string().trim().min(1).max(200),
  role: text(200),
  phone: text(50),
  email: z.string().trim().max(200).optional().nullable(),
});
export type PlanContact = z.infer<typeof PlanContact>;

export const PlanInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  name: z.string().trim().min(1).max(300),
  planType: z.enum(PLAN_TYPES).default("continuity"),
  status: z.enum(PLAN_STATUSES).default("draft"),
  ownerPositionId: z.string().uuid().nullable().optional(),
  purpose: text(),
  scope: text(),
  /** Kritéria a oprávnění k aktivaci plánu. */
  activation: text(),
  /** Strategie / náhradní řešení (nouzový režim, záložní lokalita…). */
  strategy: text(),
  steps: z.array(PlanStep).max(200).default([]),
  contacts: z.array(PlanContact).max(100).default([]),
  /** Potřebné zdroje (lidé, technika, dodavatelé, zálohy). */
  resources: text(),
  /** Cílová doba obnovení (h) – pokud není zadána, bere se nejpřísnější RTO z BIA navázaných procesů. */
  rtoTargetHours: z.number().min(0).max(24 * 365).nullable().optional(),
  testIntervalMonths: z.number().int().min(1).max(36).default(12),
  lastReviewAt: z.string().date().nullable().optional(),
  processIds: z.array(z.string().uuid()).default([]),
  assetIds: z.array(z.string().uuid()).default([]),
});
export type PlanInput = z.input<typeof PlanInput>;
export const PlanPatch = patchOf(PlanInput.omit({ companyId: true }));

export const PlanTestInput = z.object({
  testedAt: z.string().date(),
  testType: z.enum(TEST_TYPES),
  scenario: text(5000),
  participants: text(2000),
  result: z.enum(TEST_RESULTS),
  /** Dosažená doba obnovení (h). */
  achievedRtoHours: z.number().min(0).max(24 * 365).nullable().optional(),
  findings: text(),
  improvements: text(),
});
export type PlanTestInput = z.input<typeof PlanTestInput>;

export interface PlanListItem {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  planType: PlanType;
  status: PlanStatus;
  version: number;
  ownerPositionName: string | null;
  processes: { id: string; code: string | null; name: string }[];
  /** Cílové RTO (z plánu, jinak nejpřísnější z BIA). */
  rtoTargetHours: number | null;
  rtoFromBia: boolean;
  lastTest: { testedAt: string; result: TestResult; achievedRtoHours: number | null } | null;
  nextTestDue: string | null;
  testOverdue: boolean;
  approvedAt: string | null;
  updatedAt: string;
}

export interface PlanDetail extends PlanListItem {
  ownerPositionId: string | null;
  purpose: string | null;
  scope: string | null;
  activation: string | null;
  strategy: string | null;
  steps: (PlanStep & { responsiblePositionName?: string | null })[];
  contacts: PlanContact[];
  resources: string | null;
  planRtoTargetHours: number | null;
  testIntervalMonths: number;
  lastReviewAt: string | null;
  assets: { id: string; name: string; assetType: string; availability: number | null }[];
  tests: (Omit<PlanTestInput, "testedAt"> & { id: string; testedAt: string; createdByName: string | null; rtoMet: boolean | null })[];
  approvedByName: string | null;
  canEdit: boolean;
}

/** Datum dalšího testu = poslední test (nebo schválení) + interval. */
export function nextTestDate(lastTest: string | null, approvedAt: string | null, months: number): string | null {
  const base = lastTest ?? approvedAt;
  if (!base) return null;
  const d = new Date(`${base.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
