import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Audit kybernetické bezpečnosti – § 16 vyhl. č. 409/2025 Sb.
 *  - plán auditu (odst. 1), rozsah (odst. 2), zahrnutí výsledků a nápravná opatření (odst. 3),
 *  - četnost: při významných změnách, alespoň 1× za 2 roky, dle plánu (odst. 4); po systematických celcích do 5 let (odst. 5),
 *  - auditor dle § 5 odst. 4 (praxe ≥ 3 roky, nestrannost, bez jiné bezpečnostní role),
 *  - seznámení vrcholného vedení s výsledky (§ 4 odst. 2 písm. e).
 * ============================================================ */

export const AUDIT_TYPES = ["regular", "partial", "change", "supplier", "check", "authority", "soc2"] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];
export const AUDIT_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export const FINDING_SEVERITIES = ["major", "minor", "observation", "recommendation"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export const FINDING_STATUSES = ["open", "in_progress", "closed", "accepted"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const AUDIT_LABELS = {
  type: {
    regular: "Audit KB v plném rozsahu (§ 16 odst. 4 písm. b)",
    partial: "Průběžný audit po celcích (§ 16 odst. 5)",
    change: "Audit při významné změně (§ 16 odst. 4 písm. a)",
    supplier: "Audit dodavatele (zákaznický audit)",
    check: "Kontrola v oblasti kybernetické bezpečnosti",
    authority: "Kontrola orgánu dozoru (NÚKIB)",
    soc2: "Ověření SOC 2 (zpráva Type I / Type II)",
  } satisfies Record<AuditType, string>,
  status: { planned: "Plánovaný", in_progress: "Probíhá", completed: "Dokončený", cancelled: "Zrušený" } satisfies Record<AuditStatus, string>,
  severity: { major: "Závažná neshoda", minor: "Méně závažná neshoda", observation: "Pozorování", recommendation: "Doporučení" } satisfies Record<FindingSeverity, string>,
  findingStatus: { open: "Otevřené", in_progress: "Řeší se", closed: "Uzavřené", accepted: "Akceptované riziko" } satisfies Record<FindingStatus, string>,
} as const;

/** Audit v plném rozsahu alespoň jednou za 2 roky; po systematických celcích celý rozsah do 5 let. */
export const AUDIT_FULL_YEARS = 2;
export const AUDIT_PARTIAL_YEARS = 5;

const text = (max = 10000) => z.string().trim().max(max).optional().nullable();
const date = z.string().date().nullable().optional();
const ids = z.array(z.string().uuid()).default([]);

export const AuditInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  title: z.string().trim().min(1).max(300),
  auditType: z.enum(AUDIT_TYPES).default("regular"),
  status: z.enum(AUDIT_STATUSES).default("planned"),
  /** Rozsah – oddíly vyhlášky (např. „§ 8“), u plného auditu všechny. */
  sections: z.array(z.string().trim().min(1).max(20)).max(60).default([]),
  scope: text(),
  plannedStart: date,
  plannedEnd: date,
  performedStart: date,
  performedEnd: date,
  auditorName: text(200),
  auditorPositionId: z.string().uuid().nullable().optional(),
  auditorExternal: z.boolean().default(false),
  /** § 5 odst. 4 písm. a) – vyškolen a praxe s audity KB / ISMS alespoň 3 roky. */
  auditorQualified: z.boolean().default(false),
  /** § 5 odst. 4 písm. b) – nestrannost. */
  auditorIndependent: z.boolean().default(false),
  conclusion: text(),
  reportRef: text(300),
  /** § 4 odst. 2 písm. e) – seznámení vrcholného vedení s výsledky. */
  managementInformedAt: date,
  supplierId: z.string().uuid().nullable().optional(),
  changeIds: ids,
  /** Metodika auditu = kontrolní seznam (vestavěný dle vyhlášky nebo importovaný YAML/JSON/XML). */
  methodologyKey: z.string().trim().max(60).nullable().optional(),
});
export type AuditInput = z.input<typeof AuditInput>;
export const AuditPatch = patchOf(AuditInput.omit({ companyId: true }));

export const FindingInput = z.object({
  code: z.string().trim().max(50).optional().nullable(),
  title: z.string().trim().min(1).max(500),
  description: text(),
  severity: z.enum(FINDING_SEVERITIES).default("minor"),
  status: z.enum(FINDING_STATUSES).default("open"),
  requirementId: z.string().trim().max(100).nullable().optional(),
  /** § 16 odst. 3 písm. b) – nápravné opatření přijaté bez zbytečného odkladu. */
  correctiveAction: text(),
  ownerPositionId: z.string().uuid().nullable().optional(),
  dueDate: date,
  closedAt: date,
  verification: text(),
  /** § 16 odst. 3 písm. a) – zahrnutí do řízení rizik a plánu rozvoje bezpečnostního povědomí. */
  riskId: z.string().uuid().nullable().optional(),
  /** Opatření, kterého se zjištění týká (v1.05). */
  controlId: z.string().uuid().nullable().optional(),
  awareness: z.boolean().default(false),
});
export type FindingInput = z.input<typeof FindingInput>;
export const FindingPatch = patchOf(FindingInput);

/* ---------------- kontrolní seznam auditu ---------------- */

export const AUDIT_CHECK_RESULTS = ["not_checked", "conform", "partial", "nonconform", "not_applicable"] as const;
export type AuditCheckResult = (typeof AUDIT_CHECK_RESULTS)[number];
export const AUDIT_CHECK_LABELS: Record<AuditCheckResult, string> = {
  not_checked: "Neověřeno",
  conform: "Shoda",
  partial: "Částečná shoda",
  nonconform: "Neshoda",
  not_applicable: "Nevztahuje se",
};
export const AuditCheckInput = z.object({
  result: z.enum(AUDIT_CHECK_RESULTS),
  note: z.string().trim().max(5000).nullable().optional(),
});
export type AuditCheckInput = z.input<typeof AuditCheckInput>;

export interface AuditCheckRow {
  itemId: string;
  section: string | null;
  ref: string | null;
  requirementId: string | null;
  question: string;
  guidance: string | null;
  result: AuditCheckResult;
  note: string | null;
  findingId: string | null;
  findingCode: string | null;
}
export interface AuditChecklistDto {
  methodologyKey: string | null;
  methodologyName: string | null;
  items: AuditCheckRow[];
  summary: Record<AuditCheckResult, number>;
}

export interface FindingDto {
  id: string;
  auditId: string;
  auditCode: string | null;
  auditTitle: string;
  code: string | null;
  title: string;
  description: string | null;
  severity: FindingSeverity;
  status: FindingStatus;
  requirementId: string | null;
  requirementRef: string | null;
  correctiveAction: string | null;
  ownerPositionId: string | null;
  ownerPositionName: string | null;
  dueDate: string | null;
  closedAt: string | null;
  verification: string | null;
  riskId: string | null;
  riskName: string | null;
  controlId: string | null;
  controlLabel: string | null;
  awareness: boolean;
  overdue: boolean;
}

export interface AuditListItem {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  auditType: AuditType;
  status: AuditStatus;
  sections: string[];
  plannedStart: string | null;
  performedEnd: string | null;
  auditorName: string | null;
  findings: Record<FindingSeverity, number>;
  openFindings: number;
  overdueFindings: number;
  gaps: string[];
  updatedAt: string;
}

export interface AuditDetail extends AuditListItem {
  scope: string | null;
  plannedEnd: string | null;
  performedStart: string | null;
  auditorPositionId: string | null;
  auditorPositionName: string | null;
  auditorExternal: boolean;
  auditorQualified: boolean;
  auditorIndependent: boolean;
  conclusion: string | null;
  reportRef: string | null;
  managementInformedAt: string | null;
  supplierId: string | null;
  supplierName: string | null;
  changes: { id: string; code: string | null; title: string }[];
  findingList: FindingDto[];
  methodologyKey: string | null;
  methodologyName: string | null;
  canEdit: boolean;
}

export interface AuditCoverageRow {
  section: string;
  title: string;
  lastAudit: string | null;
  lastAuditId: string | null;
  /** ok = do 2 let, partial = 2–5 let (jen při průběžném auditu po celcích), overdue = více než 5 let nebo nikdy. */
  state: "ok" | "partial" | "overdue";
}

/** Nesplněné náležitosti auditu (§ 5 odst. 4, § 16 odst. 3, § 4 odst. 2 písm. e). */
export function auditGaps(a: {
  auditType: AuditType;
  status: AuditStatus;
  auditorName: string | null;
  auditorQualified: boolean;
  auditorIndependent: boolean;
  auditorOtherRoles: string[];
  managementInformedAt: string | null;
  sections: string[];
  scope: string | null;
  findingsWithoutAction: number;
}): string[] {
  if (a.status === "cancelled") return [];
  const ksb = a.auditType === "regular" || a.auditType === "partial" || a.auditType === "change";
  const g: string[] = [];
  if (!a.sections.length && !a.scope) g.push("Není vymezen rozsah auditu (§ 16 odst. 2).");
  if (ksb) {
    if (!a.auditorName) g.push("Není určen auditor kybernetické bezpečnosti (§ 4 odst. 4 písm. d).");
    else {
      if (!a.auditorQualified) g.push("Není doložena odborná způsobilost auditora – vyškolení a praxe alespoň 3 roky (§ 5 odst. 4 písm. a).");
      if (!a.auditorIndependent) g.push("Není doložena nestrannost auditora (§ 5 odst. 4 písm. b).");
    }
    if (a.auditorOtherRoles.length) g.push(`Auditor zastává jinou bezpečnostní roli (${a.auditorOtherRoles.join(", ")}) – § 5 odst. 4 písm. c).`);
  }
  if (a.status === "completed") {
    if (a.findingsWithoutAction) g.push(`${a.findingsWithoutAction} neshod bez nápravného opatření (§ 16 odst. 3 písm. b).`);
    if (!a.managementInformedAt) g.push("Vrcholné vedení nebylo seznámeno s výsledky (§ 4 odst. 2 písm. e).");
  }
  return g;
}

export function coverageState(last: string | null, today = new Date()): AuditCoverageRow["state"] {
  if (!last) return "overdue";
  const d = new Date(`${last.slice(0, 10)}T00:00:00Z`);
  const full = new Date(d);
  full.setUTCFullYear(full.getUTCFullYear() + AUDIT_FULL_YEARS);
  const part = new Date(d);
  part.setUTCFullYear(part.getUTCFullYear() + AUDIT_PARTIAL_YEARS);
  if (today <= full) return "ok";
  if (today <= part) return "partial";
  return "overdue";
}
