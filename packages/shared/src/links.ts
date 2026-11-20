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
  "project",
  // v1.74 (ADR-167): vazby na aktivum, které detail dosud neukazoval
  "tls_endpoint",
  "access_resource",
  "scenario_proposal",
  // v1.75 (ADR-168): zbývající vazby procesů, rizik, opatření a dodavatelů
  "subprocess",
  "supplier_contract",
  "cra_finding",
  "attack_path",
  "legal_task",
  "control_automation",
  "data_location",
] as const;
export type BacklinkKind = (typeof BACKLINK_KINDS)[number];

/** Které druhy zpětných vazeb se u cíle zobrazují (přímé vazby, které detail už ukazuje, se neopakují). */
export const BACKLINKS_FOR: Record<LinkTarget, readonly BacklinkKind[]> = {
  asset: ["incident", "change", "control", "supplier", "plan", "activity", "ai_system", "cra_product", "project", "tls_endpoint", "access_resource", "scenario_proposal", "audit"],
  process: ["incident", "change", "bia", "plan", "supplier", "activity", "ai_system", "cra_product", "project", "subprocess", "supplier_contract", "audit"],
  risk: ["incident", "change", "audit_finding", "supplier", "supplier_report", "supplier_questionnaire", "ai_system", "cra_product", "project", "cra_finding", "attack_path", "scenario_proposal"],
  control: ["incident", "change", "audit_finding", "treatment_action", "exception", "supplier_report", "activity", "ai_system", "legal_task", "control_automation", "audit"],
  supplier: ["incident", "change", "audit", "activity", "ai_system", "cra_product", "project", "data_location"],
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
    project: "Projekty",
    tls_endpoint: "Certifikáty a TLS",
    access_resource: "Oprávnění (žádosti o přístup)",
    scenario_proposal: "Návrhy rizik ze scénářů",
    subprocess: "Podprocesy",
    supplier_contract: "Smlouvy s dodavateli (funkce DORA)",
    cra_finding: "Zranitelnosti produktů (CRA)",
    attack_path: "Útočné cesty",
    legal_task: "Úkoly ze změn předpisů",
    control_automation: "Automatické testy opatření",
    data_location: "Umístění dat",
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
  project: "/projects/",
} as const;
export type RecordPathKind = keyof typeof RECORD_PATHS;
export const recordPath = (kind: RecordPathKind, id: string) => `${RECORD_PATHS[kind]}${id}`;

/* ---------- rychlé hledání (v1.06, ADR-102): Ctrl+K ---------- */
export const QUICK_KINDS = ["asset", "process", "risk", "control", "supplier", "incident", "change", "policy", "audit", "cra_product", "ai_system", "activity", "plan", "sectest_finding", "server", "cve"] as const;
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
  sectest_finding: "Nález testu",
  server: "Server (sběrač)",
  cve: "Zranitelnost",
};
export interface QuickHit {
  kind: QuickKind;
  id: string;
  label: string;
  sub: string | null;
  link: string;
}

/* ---------- pokrytí vazeb (v1.75, ADR-168) ---------- */

/**
 * Kde se ukazuje každá tabulka s cizím klíčem na aktivum, proces, riziko, opatření nebo dodavatele.
 * `detail` = karta / záložka detailu, `backlink:<druh>` = zpětná vazba (Kde je záznam použit), `elsewhere` = v jiném
 * modulu s odkazem z detailu, `internal` = technická tabulka bez obchodní vazby. Test `review.test.ts` hlídá, že nová
 * tabulka s cizím klíčem na tyto evidence je tu uvedená – vazba tak nezůstane skrytá.
 */
export type RelationPlace = "detail" | "elsewhere" | "internal" | `backlink:${BacklinkKind}`;
export const RELATION_COVERAGE: Record<"assets" | "processes" | "risks" | "controls" | "suppliers", Record<string, RelationPlace>> = {
  assets: {
    activity_assets: "backlink:activity",
    ai_system_assets: "backlink:ai_system",
    alert_suggestions: "elsewhere", // SOC – hostitel aktiva (odkaz v nabídce detailu)
    asset_companies: "detail", // sdílení
    asset_dependencies: "detail",
    asset_duplicate_dismissals: "internal",
    asset_links: "detail", // primární / podpůrná
    asset_software: "detail",
    asset_sources: "detail",
    asset_vulnerabilities: "detail",
    audit_findings: "detail", // záložka Nálezy a úkoly (jednotné nálezy)
    audit_assets: "backlink:audit", // rozsah auditu (v1.88)
    change_assets: "backlink:change",
    control_assets: "backlink:control",
    cra_product_assets: "backlink:cra_product",
    host_findings: "detail",
    host_inventories: "detail",
    iam_resources: "backlink:access_resource",
    identity_computers: "detail", // zdroj „Active Directory“ v detailu aktiva (v1.90)
    incident_assets: "backlink:incident",
    info_assessment_assets: "detail",
    map_placements: "detail",
    net_observations: "elsewhere", // Discovery – sledování segmentů
    plan_assets: "backlink:plan",
    policy_assets: "detail", // související dokumenty
    process_assets: "detail",
    project_assets: "backlink:project",
    risk_assets: "detail",
    risk_scenario_proposals: "backlink:scenario_proposal",
    sca_check_results: "detail",
    sca_results: "detail",
    sec_test_findings: "detail",
    supplier_assets: "backlink:supplier",
    threat_assessments: "elsewhere", // Rizikové scénáře – pokrytí katalogu hrozeb
    tls_endpoints: "backlink:tls_endpoint",
    vuln_scans: "elsewhere", // Zranitelnosti – importy skenů
  },
  processes: {
    activity_processes: "backlink:activity",
    ai_system_processes: "backlink:ai_system",
    audit_processes: "backlink:audit", // rozsah auditu (v1.88)
    bia_assessments: "backlink:bia",
    change_processes: "backlink:change",
    cra_product_processes: "backlink:cra_product",
    incident_processes: "backlink:incident",
    plan_processes: "backlink:plan",
    policy_processes: "detail",
    process_assets: "detail",
    process_documents: "detail",
    process_steps: "detail",
    process_versions: "detail",
    processes: "backlink:subprocess", // nadřazený proces je v záhlaví detailu
    project_processes: "backlink:project",
    risk_processes: "detail",
    supplier_contract_processes: "backlink:supplier_contract",
    supplier_processes: "backlink:supplier",
  },
  risks: {
    ai_system_risks: "backlink:ai_system",
    attack_path_decisions: "backlink:attack_path",
    audit_findings: "backlink:audit_finding",
    change_risks: "backlink:change",
    cra_findings: "backlink:cra_finding",
    cra_product_risks: "backlink:cra_product",
    incident_risks: "backlink:incident",
    policy_risks: "detail",
    project_risks: "backlink:project",
    risk_assets: "detail",
    risk_catalog_links: "detail",
    risk_controls: "detail",
    risk_cves: "detail",
    risk_processes: "detail",
    risk_reviews: "detail",
    risk_scenario_proposals: "backlink:scenario_proposal",
    risk_treatment_actions: "detail",
    supplier_questionnaires: "backlink:supplier_questionnaire",
    supplier_report_items: "backlink:supplier_report",
    supplier_risks: "backlink:supplier",
  },
  controls: {
    activity_controls: "backlink:activity",
    ai_system_controls: "backlink:ai_system",
    audit_findings: "backlink:audit_finding",
    audit_controls: "backlink:audit", // rozsah auditu (v1.88)
    change_controls: "backlink:change",
    control_assets: "detail",
    control_automations: "backlink:control_automation",
    control_monitors: "detail",
    control_requirements: "detail",
    control_tests: "detail",
    evidence_controls: "detail",
    exception_controls: "backlink:exception",
    incident_controls: "backlink:incident",
    legal_tasks: "backlink:legal_task",
    policy_controls: "detail",
    risk_controls: "detail",
    risk_treatment_actions: "backlink:treatment_action",
    sec_test_findings: "detail",
    supplier_report_items: "backlink:supplier_report",
  },
  suppliers: {
    activity_suppliers: "backlink:activity",
    ai_system_suppliers: "backlink:ai_system",
    audits: "backlink:audit",
    change_suppliers: "backlink:change",
    cra_product_suppliers: "backlink:cra_product",
    data_locations: "backlink:data_location",
    incident_suppliers: "backlink:incident",
    policy_suppliers: "detail",
    project_costs: "backlink:project",
    project_suppliers: "backlink:project",
    supplier_assets: "detail",
    supplier_contracts: "detail",
    supplier_processes: "detail",
    supplier_questionnaires: "detail",
    supplier_reports: "detail",
    supplier_risks: "detail",
  },
};
