import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Organizační struktura: útvary (strom) a funkční místa
 * ============================================================ */

export const ORG_UNIT_TYPES = ["organization", "division", "department", "section", "team", "other"] as const;
export const OrgUnitType = z.enum(ORG_UNIT_TYPES);
export type OrgUnitType = z.infer<typeof OrgUnitType>;

export const ORG_LABELS = {
  unitType: {
    organization: "Organizace",
    division: "Sekce / úsek",
    department: "Odbor",
    section: "Oddělení",
    team: "Tým / skupina",
    other: "Jiný útvar",
  } satisfies Record<OrgUnitType, string>,
} as const;

/** Bezpečnostní role dle ZKB, které může funkční místo zastávat (vedle pracovní náplně). */
export const SECURITY_ROLES = [
  "Výbor pro řízení kybernetické bezpečnosti",
  "Manažer kybernetické bezpečnosti",
  "Architekt kybernetické bezpečnosti",
  "Garant aktiva",
  "Auditor kybernetické bezpečnosti",
  "Pověřenec pro ochranu osobních údajů",
] as const;

export const OrgUnitInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  code: z.string().trim().max(50).optional().nullable(),
  unitType: OrgUnitType.default("department"),
  description: z.string().trim().max(5000).optional().nullable(),
  sortOrder: z.number().int().default(0),
});
export type OrgUnitInput = z.input<typeof OrgUnitInput>;
export const OrgUnitPatch = patchOf(OrgUnitInput.omit({ companyId: true }));

export const PositionInput = z.object({
  orgUnitId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  code: z.string().trim().max(50).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  isManager: z.boolean().default(false),
  securityRoles: z.array(z.string().trim().min(1)).default([]),
  holderIds: z.array(z.string().uuid()).default([]),
});
export type PositionInput = z.input<typeof PositionInput>;
export const PositionPatch = patchOf(PositionInput);

export interface PositionDto {
  id: string;
  orgUnitId: string;
  name: string;
  code: string | null;
  description: string | null;
  isManager: boolean;
  securityRoles: string[];
  holders: { id: string; displayName: string; email: string }[];
}

export interface OrgUnitDto {
  id: string;
  /** Společnost skupiny, které útvar patří (název a typ z Administrace → Společnosti). */
  companyId: string;
  companyName: string;
  companyKind: "holding" | "company";
  /** Útvar nadřazené společnosti (holdingu) – v aktuální společnosti jen ke čtení a k přiřazení funkčních míst. */
  shared: boolean;
  parentId: string | null;
  name: string;
  code: string | null;
  unitType: OrgUnitType;
  description: string | null;
  sortOrder: number;
  positions: PositionDto[];
}

/** Odkaz na odpovědný subjekt (RACI, vlastník) – funkční místo nebo celý útvar. */
export const PartyRef = z.object({
  kind: z.enum(["position", "org_unit"]),
  id: z.string().uuid(),
});
export type PartyRef = z.infer<typeof PartyRef>;

/* ============================================================
 * Funkční místo – co vlastní a předání při odchodu (v1.10, ADR-106).
 * ============================================================ */
export const POSITION_USAGE_KINDS = [
  "process",
  "risk",
  "risk_action",
  "control",
  "requirement",
  "policy_owner",
  "policy_reviewer",
  "policy_approver",
  "task",
  "incident",
  "change",
  "isms_objective",
  "audit_auditor",
  "audit_finding",
  "audit_request",
  "plan",
  "exercise",
  "activity",
  "ai_owner",
  "ai_oversight",
  "cra_product",
  "legal_review",
  "legal_task",
  "legal_watch",
  "info_review",
  "training",
  "access_review",
  "cycle",
] as const;
export type PositionUsageKind = (typeof POSITION_USAGE_KINDS)[number];
export const POSITION_USAGE_LABELS: Record<PositionUsageKind, string> = {
  process: "Vlastník procesů",
  risk: "Vlastník rizik",
  risk_action: "Akce plánu zvládání rizik",
  control: "Vlastník opatření",
  requirement: "Odpovědnost za požadavky (SoA)",
  policy_owner: "Gestor dokumentů",
  policy_reviewer: "Revize dokumentů",
  policy_approver: "Schvalování dokumentů",
  task: "Úkoly",
  incident: "Řešení incidentů",
  change: "Změny",
  isms_objective: "Cíle ISMS",
  audit_auditor: "Auditor",
  audit_finding: "Nápravná opatření z auditů",
  audit_request: "Požadavky auditora na podklady",
  plan: "Plány kontinuity",
  exercise: "Cvičení (facilitátor)",
  activity: "Činnosti zpracování (GDPR)",
  ai_owner: "Vlastník AI systémů",
  ai_oversight: "Lidský dohled nad AI",
  cra_product: "Produkty (CRA)",
  legal_review: "Posouzení změn předpisů",
  legal_task: "Úkoly ze změn předpisů",
  legal_watch: "Sledované předpisy",
  info_review: "Posouzení varování regulátora",
  training: "Kurzy školení",
  access_review: "Přezkumy přístupů (recenzent)",
  cycle: "Hodnotící cykly (vedoucí)",
};
export interface PositionUsageDto {
  position: { id: string; name: string; unitName: string; companyId: string; holders: { id: string; name: string }[] };
  groups: { kind: PositionUsageKind; items: { id: string; label: string; link: string }[]; total: number; canHandover: boolean }[];
  raci: { processId: string; processName: string; stepName: string; role: string }[];
}
export const PositionHandoverInput = z.object({
  targetPositionId: z.string().uuid(),
  kinds: z.array(z.enum(POSITION_USAGE_KINDS)).min(1).max(POSITION_USAGE_KINDS.length),
  note: z.string().trim().max(500).optional(),
});
export type PositionHandoverInput = z.infer<typeof PositionHandoverInput>;
