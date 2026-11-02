/* ============================================================
 * Zpětné vazby mezi záznamy (v1.05, ADR-101): „kde je tento záznam použit“.
 * Cíl (aktivum, proces, riziko, opatření, dodavatel) → skupiny navázaných záznamů jiných evidencí.
 * Počítá se při čtení z tabulek vazeb (`modules/links`), nic se nepersistuje; každá skupina jen s oprávněním
 * a zapnutým modulem ve společnosti navázaného záznamu.
 * ============================================================ */

export const LINK_TARGETS = ["asset", "process", "risk", "control", "supplier"] as const;
export type LinkTarget = (typeof LINK_TARGETS)[number];

export const BACKLINK_KINDS = [
  "incident",
  "change",
  "activity",
  "ai_system",
  "plan",
  "bia",
  "control",
  "supplier",
  "audit",
  "audit_finding",
  "supplier_report",
  "supplier_questionnaire",
  "treatment_action",
  "cra_product",
  "exception",
] as const;
export type BacklinkKind = (typeof BACKLINK_KINDS)[number];

/** Které druhy zpětných vazeb se u cíle zobrazují (přímé vazby, které detail už ukazuje, se neopakují). */
export const BACKLINKS_FOR: Record<LinkTarget, readonly BacklinkKind[]> = {
  asset: ["incident", "change", "control", "supplier", "plan", "activity", "ai_system", "cra_product"],
  process: ["incident", "change", "bia", "plan", "supplier", "activity", "ai_system", "cra_product"],
  risk: ["incident", "change", "audit_finding", "supplier", "supplier_report", "supplier_questionnaire", "ai_system", "cra_product"],
  control: ["incident", "change", "audit_finding", "treatment_action", "exception", "supplier_report", "activity", "ai_system"],
  supplier: ["incident", "change", "audit", "activity", "ai_system", "cra_product"],
};

export const LINK_LABELS: { kind: Record<BacklinkKind, string>; target: Record<LinkTarget, string> } = {
  kind: {
    incident: "Incidenty",
    change: "Změny",
    activity: "Činnosti zpracování (GDPR)",
    ai_system: "AI systémy",
    plan: "Plány kontinuity",
    bia: "Analýzy dopadů (BIA)",
    control: "Opatření",
    supplier: "Dodavatelé",
    audit: "Audity",
    audit_finding: "Zjištění auditů",
    supplier_report: "Zprávy o ujištění dodavatelů",
    supplier_questionnaire: "Dotazníky dodavatelů",
    treatment_action: "Akce plánu zvládání rizik",
    cra_product: "Produkty (CRA)",
    exception: "Výjimky, které opatření kompenzuje",
  },
  target: { asset: "Aktivum", process: "Proces", risk: "Riziko", control: "Opatření", supplier: "Dodavatel" },
};

export interface BacklinkItem {
  id: string;
  label: string;
  /** Doplňující údaj (audit u zjištění, riziko u akce, dodavatel u zprávy…). */
  sub: string | null;
  link: string;
}
export interface BacklinkGroup {
  kind: BacklinkKind;
  items: BacklinkItem[];
}
export interface BacklinksDto {
  target: LinkTarget;
  id: string;
  groups: BacklinkGroup[];
}

/** Odkaz na detail záznamu ve webu (sdílené pro čipy vazeb a zpětné vazby). */
export const RECORD_PATHS = {
  asset: "/assets/",
  process: "/processes/",
  risk: "/risks/",
  control: "/controls/",
  supplier: "/suppliers/",
  incident: "/incidents/",
  change: "/isms/changes/",
  activity: "/gdpr/",
  ai_system: "/aiact/",
  plan: "/continuity/plans/",
  bia: "/bia/",
  audit: "/audits/",
  policy: "/policies/",
  cra_product: "/cra/",
  supplier_report: "/suppliers/reports/",
  soc_case: "/soc/cases/",
} as const;
export type RecordPathKind = keyof typeof RECORD_PATHS;
export const recordPath = (kind: RecordPathKind, id: string) => `${RECORD_PATHS[kind]}${id}`;

/* ---------- rychlé hledání (v1.06, ADR-102): Ctrl+K ---------- */
export const QUICK_KINDS = ["asset", "process", "risk", "control", "supplier", "incident", "change", "policy", "audit", "cra_product", "ai_system", "activity", "plan", "cve"] as const;
export type QuickKind = (typeof QUICK_KINDS)[number];
export const QUICK_LABELS: Record<QuickKind, string> = {
  asset: "Aktivum",
  process: "Proces",
  risk: "Riziko",
  control: "Opatření",
  supplier: "Dodavatel",
  incident: "Incident",
  change: "Změna",
  policy: "Dokument",
  audit: "Audit",
  cra_product: "Produkt (CRA)",
  ai_system: "AI systém",
  activity: "Činnost zpracování",
  plan: "Plán kontinuity",
  cve: "Zranitelnost",
};
export interface QuickHit {
  kind: QuickKind;
  id: string;
  label: string;
  sub: string | null;
  link: string;
}
