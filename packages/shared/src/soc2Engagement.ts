import { z } from "zod";
import { CROSSWALK_409, SOC2_CRITERIA, SOC2_SECTIONS } from "./frameworks";
import { patchOf } from "./zutil";

/* ============================================================
 * SOC 2 – zakázka auditora (engagement) a zpráva Type I / Type II (ADR-091).
 * Zakázka = audit (`audits`, typ soc2) + údaje zprávy: rozsah kategorií TSC, datum / období, popis systému
 * (oddíly podle kritérií popisu), doplňkové kontroly uživatelů (CUEC), subdodavatelské organizace (CSOC),
 * pracovní papíry ke kritériím a výrok. Matice kritérium → opatření → testy → výjimky se počítá při čtení.
 * Texty AICPA (kritéria, body zaměření, vzorové zprávy) se nevkládají – jen ID, vlastní popisky a vlastní texty CONTIXu.
 * ============================================================ */

export const SOC2_REPORT_TYPES = ["type1", "type2"] as const;
export type Soc2ReportType = (typeof SOC2_REPORT_TYPES)[number];
/** Kategorie TSC v rozsahu zprávy (CC = bezpečnost, povinná). */
export const SOC2_SCOPE_CATEGORIES = ["CC", "A1", "C1", "PI1", "P"] as const;
export type Soc2Category = (typeof SOC2_SCOPE_CATEGORIES)[number];
export const SOC2_OPINIONS = ["unmodified", "qualified", "adverse", "disclaimer"] as const;
export type Soc2Opinion = (typeof SOC2_OPINIONS)[number];
export const SOC2_CONCLUSIONS = ["pending", "no_exceptions", "exceptions", "na"] as const;
export type Soc2Conclusion = (typeof SOC2_CONCLUSIONS)[number];
export const SOC2_SUBSERVICE_METHODS = ["carve_out", "inclusive"] as const;
export type Soc2SubserviceMethod = (typeof SOC2_SUBSERVICE_METHODS)[number];

/** Oddíly popisu systému (podle kritérií popisu systému – vlastní členění CONTIXu). */
export const SOC2_DESCRIPTION_SECTIONS = [
  "services",
  "commitments",
  "infrastructure",
  "software",
  "people",
  "procedures",
  "data",
  "controlEnvironment",
  "riskAssessment",
  "infoCommunication",
  "monitoring",
  "incidents",
  "changes",
  "notApplicable",
] as const;
export type Soc2DescriptionSection = (typeof SOC2_DESCRIPTION_SECTIONS)[number];
/** Oddíly, bez kterých nelze zprávu vydat. */
export const SOC2_REQUIRED_SECTIONS: Soc2DescriptionSection[] = ["services", "commitments", "infrastructure", "software", "people", "procedures", "data", "controlEnvironment", "riskAssessment", "infoCommunication", "monitoring"];

/** Kategorie TSC kritéria (CC1–CC9 → CC). */
export const soc2CategoryOf = (section: string): Soc2Category => (section.startsWith("CC") ? "CC" : (section as Soc2Category));

export interface Soc2Criterion {
  id: string;
  section: string;
  sectionTitle: string;
  category: Soc2Category;
  label: string;
}
/** Kritéria v rozsahu zprávy (CC vždy). */
export function soc2CriteriaFor(categories: string[]): Soc2Criterion[] {
  const cats = new Set<string>(["CC", ...categories]);
  return SOC2_CRITERIA.filter(([, section]) => cats.has(soc2CategoryOf(section))).map(([id, section, label]) => ({ id, section, sectionTitle: SOC2_SECTIONS[section] ?? section, category: soc2CategoryOf(section), label }));
}

/* ---------------- mapování TSC ↔ vyhl. 409 / ISO 27001:2022 ---------------- */

/** Přímé mapování kritérií TSC na ISO/IEC 27001:2022 (kapitoly a opatření přílohy A) – vlastní mapování CONTIXu. */
export const TSC_ISO: Record<string, string[]> = {
  "CC1.1": ["A.5.4", "A.6.2", "A.6.4"],
  "CC1.2": ["5.1", "9.3"],
  "CC1.3": ["5.3", "A.5.2", "A.5.3"],
  "CC1.4": ["7.2", "A.6.1", "A.6.3"],
  "CC1.5": ["5.3", "A.5.4", "A.6.4"],
  "CC2.1": ["7.5", "9.1"],
  "CC2.2": ["5.2", "7.3", "7.4", "A.5.1", "A.6.3"],
  "CC2.3": ["7.4", "A.5.5", "A.5.6", "A.5.14", "A.6.8"],
  "CC3.1": ["4.1", "6.1.1", "6.2"],
  "CC3.2": ["6.1.2", "8.2"],
  "CC3.3": ["6.1.2"],
  "CC3.4": ["6.3", "6.1.2"],
  "CC4.1": ["9.1", "9.2", "A.5.35", "A.5.36"],
  "CC4.2": ["9.3", "10.2"],
  "CC5.1": ["6.1.3", "8.3"],
  "CC5.2": ["A.8.9", "A.8.25", "A.8.32"],
  "CC5.3": ["A.5.1", "A.5.37"],
  "CC6.1": ["A.5.9", "A.5.15", "A.5.17", "A.8.2", "A.8.3", "A.8.5", "A.8.20", "A.8.24"],
  "CC6.2": ["A.5.16", "A.5.18"],
  "CC6.3": ["A.5.15", "A.5.18", "A.8.2"],
  "CC6.4": ["A.7.1", "A.7.2", "A.7.3", "A.7.4"],
  "CC6.5": ["A.7.10", "A.7.14", "A.8.10"],
  "CC6.6": ["A.8.5", "A.8.20", "A.8.21", "A.8.22", "A.8.23"],
  "CC6.7": ["A.5.14", "A.7.10", "A.8.12", "A.8.24"],
  "CC6.8": ["A.8.7", "A.8.19"],
  "CC7.1": ["A.8.8", "A.8.9"],
  "CC7.2": ["A.8.15", "A.8.16"],
  "CC7.3": ["A.5.25", "A.6.8"],
  "CC7.4": ["A.5.24", "A.5.26"],
  "CC7.5": ["A.5.26", "A.5.27", "A.8.13"],
  "CC8.1": ["A.8.9", "A.8.25", "A.8.29", "A.8.32"],
  "CC9.1": ["6.1.3", "A.5.29", "A.5.30"],
  "CC9.2": ["A.5.19", "A.5.20", "A.5.21", "A.5.22"],
  "A1.1": ["A.8.6"],
  "A1.2": ["A.7.5", "A.7.11", "A.8.13", "A.8.14"],
  "A1.3": ["A.5.30", "A.8.13"],
  "C1.1": ["A.5.10", "A.5.12", "A.5.13"],
  "C1.2": ["A.7.14", "A.8.10"],
  "PI1.1": ["A.8.26"],
  "PI1.2": ["A.8.26", "A.8.28"],
  "PI1.3": ["A.8.26", "A.8.28"],
  "PI1.4": ["A.8.26"],
  "PI1.5": ["A.5.33", "A.8.13"],
};
const P_ISO = ["A.5.34"];

/** Paragrafy vyhl. 409/2025 a opatření ISO 27001 ke kritériu TSC (409 = obrácený CROSSWALK_409). */
export function tscCrosswalk(criterion: string): { cz409: string[]; iso: string[] } {
  const cz409 = Object.entries(CROSSWALK_409)
    .filter(([, v]) => v.soc2.includes(criterion))
    .map(([par]) => `§ ${par}`);
  const iso = TSC_ISO[criterion] ?? (criterion.startsWith("P") && !criterion.startsWith("PI") ? P_ISO : []);
  return { cz409, iso };
}

/* ---------------- standardní požadavky na podklady (PBC) ---------------- */

/** Vlastní seznam typických podkladů ke kritériím; `type2` = populace / vzorky za období (jen Type II). */
export const SOC2_PBC_TEMPLATE: { ref: string; cs: string; en: string; type2?: boolean }[] = [
  { ref: "CC1.1", cs: "Kodex chování / etický kodex a doklady o seznámení zaměstnanců", en: "Code of conduct and evidence of employee acknowledgement" },
  { ref: "CC1.2", cs: "Zápisy z jednání vedení / dozorčího orgánu k bezpečnosti a vnitřní kontrole", en: "Minutes of management / board meetings on security and internal control" },
  { ref: "CC1.3", cs: "Organizační schéma a popis bezpečnostních rolí a odpovědností", en: "Organisation chart and description of security roles and responsibilities" },
  { ref: "CC1.4", cs: "Seznam nově přijatých zaměstnanců za období a doklady o prověření a vstupním školení", en: "List of new hires in the period with background checks and onboarding training", type2: true },
  { ref: "CC1.4", cs: "Plán a evidence školení bezpečnostního povědomí", en: "Security awareness training plan and records" },
  { ref: "CC2.1", cs: "Přehled bezpečnostních metrik a reportů pro vedení", en: "Security metrics and management reports" },
  { ref: "CC2.2", cs: "Bezpečnostní politika a směrnice, jejich schválení a zveřejnění zaměstnancům", en: "Security policy and directives, approval and publication to employees" },
  { ref: "CC2.3", cs: "Smluvní podmínky / SLA se zákazníky a popis komunikace bezpečnostních závazků", en: "Customer terms / SLAs and communication of security commitments" },
  { ref: "CC3.2", cs: "Analýza rizik (metodika, registr rizik, plán zvládání) platná v období", en: "Risk assessment (methodology, risk register, treatment plan) valid in the period" },
  { ref: "CC3.3", cs: "Posouzení rizika podvodu", en: "Fraud risk assessment" },
  { ref: "CC3.4", cs: "Evidence významných změn a jejich posouzení", en: "Register of significant changes and their assessment" },
  { ref: "CC4.1", cs: "Plán a zprávy interních auditů / testů kontrol za období", en: "Internal audit / control testing plan and reports for the period" },
  { ref: "CC4.2", cs: "Evidence zjištěných nedostatků a stav nápravných opatření", en: "Log of identified deficiencies and status of corrective actions" },
  { ref: "CC5.3", cs: "Seznam platných politik a postupů s datem posledního přezkumu", en: "List of current policies and procedures with last review date" },
  { ref: "CC6.1", cs: "Konfigurace autentizace (MFA, hesla) a přehled privilegovaných účtů", en: "Authentication configuration (MFA, passwords) and list of privileged accounts" },
  { ref: "CC6.2", cs: "Populace nově zřízených uživatelských účtů za období (pro výběr vzorku)", en: "Population of user accounts created in the period (for sampling)", type2: true },
  { ref: "CC6.2", cs: "Postup registrace a schvalování přístupů", en: "User registration and access approval procedure" },
  { ref: "CC6.3", cs: "Populace změn a odebrání oprávnění za období a seznam odchodů zaměstnanců", en: "Population of access changes and removals in the period and list of leavers", type2: true },
  { ref: "CC6.3", cs: "Záznamy o pravidelném přezkumu přístupových oprávnění", en: "Records of periodic access reviews", type2: true },
  { ref: "CC6.4", cs: "Přehled fyzických přístupů do serverovny / datového centra a jejich přezkum", en: "Physical access list for the server room / data centre and its review" },
  { ref: "CC6.5", cs: "Záznamy o bezpečné likvidaci nosičů a zařízení", en: "Records of secure disposal of media and equipment", type2: true },
  { ref: "CC6.6", cs: "Síťové schéma, pravidla firewallu a jejich přezkum", en: "Network diagram, firewall rules and their review" },
  { ref: "CC6.7", cs: "Konfigurace šifrování přenosu a ukládaných dat", en: "Configuration of encryption in transit and at rest" },
  { ref: "CC6.8", cs: "Pokrytí ochranou proti malwaru / EDR a stav aktualizací", en: "Anti-malware / EDR coverage and update status" },
  { ref: "CC7.1", cs: "Výsledky skenů zranitelností za období a stav jejich řešení", en: "Vulnerability scan results for the period and remediation status", type2: true },
  { ref: "CC7.2", cs: "Konfigurace monitoringu a SIEM, ukázky vyhodnocených alertů", en: "Monitoring and SIEM configuration, examples of triaged alerts", type2: true },
  { ref: "CC7.3", cs: "Populace bezpečnostních událostí a incidentů za období", en: "Population of security events and incidents in the period", type2: true },
  { ref: "CC7.4", cs: "Plán reakce na incidenty a záznamy o zvládání vybraných incidentů", en: "Incident response plan and handling records of selected incidents" },
  { ref: "CC7.5", cs: "Záznamy o obnově po incidentu a poučení (lessons learned)", en: "Recovery and lessons-learned records after incidents" },
  { ref: "CC8.1", cs: "Populace změn (change requests) za období pro výběr vzorku", en: "Population of change requests in the period for sampling", type2: true },
  { ref: "CC8.1", cs: "Postup řízení změn a oddělení vývojového a produkčního prostředí", en: "Change management procedure and segregation of development and production" },
  { ref: "CC9.1", cs: "Plány kontinuity a obnovy, BIA a pojištění", en: "Business continuity and recovery plans, BIA and insurance" },
  { ref: "CC9.2", cs: "Seznam významných dodavatelů, smlouvy a hodnocení dodavatelů (vč. jejich zpráv SOC)", en: "List of significant suppliers, contracts and supplier assessments (incl. their SOC reports)" },
  { ref: "A1.1", cs: "Monitoring kapacit a výkonnosti", en: "Capacity and performance monitoring" },
  { ref: "A1.2", cs: "Konfigurace zálohování a záznamy o zálohách za období", en: "Backup configuration and backup logs for the period", type2: true },
  { ref: "A1.3", cs: "Záznamy o testu obnovy ze zálohy / testu plánu obnovy", en: "Records of backup restore / recovery plan tests" },
  { ref: "C1.1", cs: "Klasifikace informací a seznam důvěrných dat", en: "Information classification and inventory of confidential data" },
  { ref: "C1.2", cs: "Záznamy o likvidaci důvěrných informací po skončení retence", en: "Records of disposal of confidential information after retention", type2: true },
  { ref: "PI1.2", cs: "Kontroly vstupů zpracování a jejich výstupy", en: "Processing input controls and their outputs" },
  { ref: "P1.1", cs: "Informace o zpracování osobních údajů (privacy notice)", en: "Privacy notice" },
  { ref: "P5.1", cs: "Evidence žádostí subjektů údajů a jejich vyřízení", en: "Log of data subject requests and their handling", type2: true },
];

/* ---------------- vstupy ---------------- */

const text = (max = 20000) => z.string().trim().max(max).nullable().optional();
const date = z.string().date().nullable().optional();
const criteria = z.array(z.string().trim().min(2).max(10)).max(80).default([]);

export const Soc2Cuec = z.object({ text: z.string().trim().min(1).max(2000), criteria });
export type Soc2Cuec = z.infer<typeof Soc2Cuec>;
export const Soc2Subservice = z.object({
  name: z.string().trim().min(1).max(300),
  services: z.string().trim().max(3000).default(""),
  method: z.enum(SOC2_SUBSERVICE_METHODS).default("carve_out"),
  supplierId: z.string().uuid().nullable().default(null),
  /** Doplňkové kontroly subdodavatelské organizace (CSOC). */
  csocs: z.array(z.object({ text: z.string().trim().min(1).max(2000), criteria })).max(50).default([]),
});
export type Soc2Subservice = z.infer<typeof Soc2Subservice>;

export const Soc2EngagementInput = z.object({
  companyId: z.string().uuid().optional(),
  /** Název zakázky / auditu. */
  title: z.string().trim().min(1).max(300),
  reportType: z.enum(SOC2_REPORT_TYPES).default("type2"),
  categories: z.array(z.enum(SOC2_SCOPE_CATEGORIES)).max(5).default(["CC"]),
  /** Type I – datum, ke kterému se posuzuje návrh a implementace. */
  asOf: date,
  /** Type II – sledované období. */
  periodFrom: date,
  periodTo: date,
  /** Název posuzovaného systému / služby. */
  systemName: z.string().trim().max(300).default(""),
  /** Organizace poskytující služby (výchozí = název společnosti). */
  serviceOrg: text(300),
  /** Auditorská společnost (service auditor). */
  serviceAuditor: text(300),
  signatory: text(200),
  reportDate: date,
  reportPlace: text(100),
  opinion: z.enum(SOC2_OPINIONS).default("unmodified"),
  /** Důvod modifikace výroku. */
  opinionBasis: text(),
  /** Tvrzení vedení – prázdné = text CONTIXu podle údajů zakázky. */
  assertion: text(),
  description: z
    .object(Object.fromEntries(SOC2_DESCRIPTION_SECTIONS.map((k) => [k, z.string().trim().max(50000).optional()])) as Record<Soc2DescriptionSection, z.ZodOptional<z.ZodString>>)
    .default({}),
  cuecs: z.array(Soc2Cuec).max(100).default([]),
  subservice: z.array(Soc2Subservice).max(30).default([]),
  /** Další informace od vedení (oddíl V – mimo výrok). */
  otherInfo: text(),
});
export type Soc2EngagementInput = z.input<typeof Soc2EngagementInput>;
export const Soc2EngagementPatch = patchOf(Soc2EngagementInput.omit({ companyId: true }));

export const Soc2WorkpaperInput = z.object({ conclusion: z.enum(SOC2_CONCLUSIONS), note: z.string().trim().max(10000).nullable().optional() });
export const Soc2ExceptionInput = z.object({
  criterion: z.string().trim().min(2).max(10),
  testId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(10000).nullable().optional(),
});

/* ---------------- DTO ---------------- */

export interface Soc2Workpaper {
  conclusion: Soc2Conclusion;
  note: string | null;
  byName: string | null;
  at: string | null;
}
export interface Soc2TestRow {
  id: string;
  controlId: string;
  kind: "design" | "operating";
  title: string | null;
  methods: string[];
  procedure: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  performedAt: string | null;
  status: string;
  result: string | null;
  populationSize: number | null;
  samples: number;
  failed: number;
  tester: string | null;
}
export interface Soc2ExceptionRow {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  /** Vyjádření vedení (nápravné opatření). */
  managementResponse: string | null;
  testId: string | null;
}
export interface Soc2CriterionRow extends Soc2Criterion {
  cz409: string[];
  iso: string[];
  controls: { id: string; code: string | null; name: string; description: string | null }[];
  tests: Soc2TestRow[];
  exceptions: Soc2ExceptionRow[];
  pbc: { total: number; open: number; submitted: number; accepted: number };
  workpaper: Soc2Workpaper;
}
export interface Soc2EngagementDto {
  id: string;
  companyId: string;
  auditId: string;
  auditStatus: string;
  title: string;
  reportType: Soc2ReportType;
  categories: Soc2Category[];
  asOf: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  systemName: string;
  serviceOrg: string | null;
  serviceAuditor: string | null;
  signatory: string | null;
  reportDate: string | null;
  reportPlace: string | null;
  opinion: Soc2Opinion;
  opinionBasis: string | null;
  assertion: string | null;
  description: Partial<Record<Soc2DescriptionSection, string>>;
  cuecs: Soc2Cuec[];
  subservice: Soc2Subservice[];
  otherInfo: string | null;
  updatedAt: string;
}
export interface Soc2Progress {
  criteria: number;
  concluded: number;
  withControls: number;
  tested: number;
  exceptions: number;
}
export interface Soc2EngagementListItem extends Pick<Soc2EngagementDto, "id" | "companyId" | "auditId" | "auditStatus" | "title" | "reportType" | "categories" | "asOf" | "periodFrom" | "periodTo" | "systemName"> {
  progress: Soc2Progress;
}
export interface Soc2DetailDto extends Soc2EngagementDto {
  criteria: Soc2CriterionRow[];
  progress: Soc2Progress;
  readiness: Soc2Gap[];
}

/* ---------------- připravenost zprávy ---------------- */

export const SOC2_GAPS = [
  "period_missing",
  "system_missing",
  "description_missing",
  "criteria_without_controls",
  "criteria_untested",
  "criteria_pending",
  "exceptions_without_response",
  "subservice_without_csoc",
  "opinion_basis_missing",
  "signatory_missing",
  "report_date_missing",
] as const;
export type Soc2Gap = (typeof SOC2_GAPS)[number];

export function soc2Progress(rows: Soc2CriterionRow[]): Soc2Progress {
  return {
    criteria: rows.length,
    concluded: rows.filter((r) => r.workpaper.conclusion !== "pending").length,
    withControls: rows.filter((r) => r.controls.length).length,
    tested: rows.filter((r) => r.tests.some((t) => t.status === "completed")).length,
    exceptions: rows.reduce((n, r) => n + r.exceptions.length, 0),
  };
}

/** Co chybí k vydání zprávy (nepersistovat). */
export function soc2Readiness(e: Soc2EngagementDto, rows: Soc2CriterionRow[]): Soc2Gap[] {
  const g: Soc2Gap[] = [];
  if (e.reportType === "type1" ? !e.asOf : !e.periodFrom || !e.periodTo) g.push("period_missing");
  if (!e.systemName.trim()) g.push("system_missing");
  if (SOC2_REQUIRED_SECTIONS.some((k) => !e.description[k]?.trim())) g.push("description_missing");
  const active = rows.filter((r) => r.workpaper.conclusion !== "na");
  if (active.some((r) => !r.controls.length)) g.push("criteria_without_controls");
  if (active.some((r) => !r.tests.some((t) => t.status === "completed"))) g.push("criteria_untested");
  if (rows.some((r) => r.workpaper.conclusion === "pending")) g.push("criteria_pending");
  if (rows.some((r) => r.exceptions.some((x) => !x.managementResponse?.trim()))) g.push("exceptions_without_response");
  if (e.subservice.some((s) => s.method === "carve_out" && !s.csocs.length)) g.push("subservice_without_csoc");
  if (e.opinion !== "unmodified" && !e.opinionBasis?.trim()) g.push("opinion_basis_missing");
  if (!e.signatory?.trim() || !e.serviceAuditor?.trim()) g.push("signatory_missing");
  if (!e.reportDate) g.push("report_date_missing");
  return g;
}

/** Je test v rozsahu zprávy? Type I = test návrhu ke dni (nebo bez data), Type II = test účinnosti, období se překrývá. */
export function soc2TestInScope(t: { kind: string; periodFrom: string | null; periodTo: string | null; performedAt: string | null }, e: { reportType: Soc2ReportType; asOf: string | null; periodFrom: string | null; periodTo: string | null }): boolean {
  if (e.reportType === "type1") return t.kind === "design" && (!e.asOf || !t.performedAt || t.performedAt <= e.asOf);
  if (t.kind !== "operating") return false;
  if (!e.periodFrom || !e.periodTo) return true;
  const from = t.periodFrom ?? t.performedAt;
  const to = t.periodTo ?? t.performedAt;
  if (!from || !to) return true;
  return from <= e.periodTo && to >= e.periodFrom;
}

/* ---------------- popisky ---------------- */

export const SOC2_LABELS = {
  reportType: { type1: "SOC 2 Type I (návrh ke dni)", type2: "SOC 2 Type II (účinnost za období)" } satisfies Record<Soc2ReportType, string>,
  category: { CC: "Bezpečnost (společná kritéria)", A1: "Dostupnost", C1: "Důvěrnost", PI1: "Integrita zpracování", P: "Ochrana soukromí" } satisfies Record<Soc2Category, string>,
  opinion: { unmodified: "Výrok bez výhrad", qualified: "Výrok s výhradou", adverse: "Záporný výrok", disclaimer: "Odmítnutí výroku" } satisfies Record<Soc2Opinion, string>,
  conclusion: { pending: "Rozpracováno", no_exceptions: "Bez výjimek", exceptions: "Zjištěny výjimky", na: "Nerelevantní" } satisfies Record<Soc2Conclusion, string>,
  method: { carve_out: "Vyčleněná (carve-out)", inclusive: "Zahrnutá (inclusive)" } satisfies Record<Soc2SubserviceMethod, string>,
  section: {
    services: "Druhy poskytovaných služeb",
    commitments: "Hlavní závazky služby a systémové požadavky",
    infrastructure: "Komponenty systému – infrastruktura",
    software: "Komponenty systému – software",
    people: "Komponenty systému – lidé",
    procedures: "Komponenty systému – postupy",
    data: "Komponenty systému – data",
    controlEnvironment: "Kontrolní prostředí",
    riskAssessment: "Proces posuzování rizik",
    infoCommunication: "Informační a komunikační systémy",
    monitoring: "Monitorování kontrol",
    incidents: "Významné incidenty v období",
    changes: "Významné změny systému v období",
    notApplicable: "Kritéria, která se na systém nevztahují, a zdůvodnění",
  } satisfies Record<Soc2DescriptionSection, string>,
  gap: {
    period_missing: "Chybí datum (Type I) nebo sledované období (Type II)",
    system_missing: "Chybí název posuzovaného systému",
    description_missing: "Popis systému nemá vyplněné povinné oddíly",
    criteria_without_controls: "Některá kritéria nemají přiřazená opatření",
    criteria_untested: "Některá kritéria nemají dokončený test v rozsahu zprávy",
    criteria_pending: "Pracovní papíry některých kritérií nejsou uzavřené",
    exceptions_without_response: "Výjimky bez vyjádření vedení",
    subservice_without_csoc: "Vyčleněná subdodavatelská organizace bez doplňkových kontrol (CSOC)",
    opinion_basis_missing: "Modifikovaný výrok bez zdůvodnění",
    signatory_missing: "Chybí auditorská společnost nebo podepisující auditor",
    report_date_missing: "Chybí datum zprávy",
  } satisfies Record<Soc2Gap, string>,
} as const;
