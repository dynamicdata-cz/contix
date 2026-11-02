import { z } from "zod";

/* ============================================================
 * DORA – registr informací o smluvních ujednáních s poskytovateli služeb IKT (čl. 28 odst. 3 nařízení (EU) 2022/2554,
 * prováděcí nařízení Komise (EU) 2024/2956, šablony B_01–B_07). ADR-069.
 * Registr se skládá z evidence dodavatelů, smluv, procesů (= funkce) a BIA; nic se nepersistuje kromě doplňkových údajů.
 * Export = soubory CSV v rozvržení sloupců šablon (c0010 …); převod do balíčku xBRL-CSV dělá nástroj pro podání.
 * ============================================================ */

export const DORA_ENTITY_TYPES = [
  "credit institutions",
  "payment institutions, including payment institutions exempted pursuant to Directive (EU) 2015/2366",
  "account information service providers",
  "electronic money institutions, including electronic money institutions exempted pursuant to Directive 2009/110/EC",
  "investment firms",
  "crypto-asset service providers authorised under Regulation (EU) 2023/1114",
  "issuers of asset-referenced tokens authorised under Regulation (EU) 2023/1114",
  "central securities depositories",
  "central counterparties",
  "trading venues",
  "trade repositories",
  "managers of alternative investment funds",
  "management companies",
  "data reporting service providers",
  "insurance and reinsurance undertakings",
  "insurance intermediaries, reinsurance intermediaries and ancillary insurance intermediaries",
  "institutions for occupational retirement provision",
  "credit rating agencies",
  "administrators of critical benchmarks",
  "crowdfunding service providers",
  "securitisation repositories",
  "other financial entity",
] as const;

/** Typ subjektu česky (pořadí = číslo možnosti v B_01.01.0040). */
export const DORA_ENTITY_TYPE_CS = [
  "Úvěrové instituce",
  "Platební instituce (včetně vyňatých podle PSD2)",
  "Poskytovatelé služeb informování o platebním účtu",
  "Instituce elektronických peněz (včetně vyňatých)",
  "Investiční podniky",
  "Poskytovatelé služeb kryptoaktiv (MiCA)",
  "Emitenti tokenů vázaných na aktiva (MiCA)",
  "Centrální depozitáři cenných papírů",
  "Ústřední protistrany",
  "Obchodní systémy",
  "Registry obchodních údajů",
  "Správci alternativních investičních fondů",
  "Správcovské společnosti",
  "Poskytovatelé služeb hlášení údajů",
  "Pojišťovny a zajišťovny",
  "Zprostředkovatelé pojištění a zajištění",
  "Instituce zaměstnaneckého penzijního pojištění",
  "Ratingové agentury",
  "Administrátoři kritických referenčních hodnot",
  "Poskytovatelé služeb skupinového financování",
  "Registry sekuritizací",
  "Jiný finanční subjekt",
] as const;

export const DORA_HIERARCHY_CS = [
  "Nejvyšší mateřský podnik konsolidace",
  "Mateřský podnik subkonsolidovaného celku",
  "Dceřiný podnik (není mateřským podnikem subkonsolidace)",
  "Není součástí skupiny",
  "Poskytovatel, kterému finanční subjekt svěřil všechny provozní činnosti",
] as const;

/** Druhy služeb IKT (příloha III). */
export const DORA_SERVICE_TYPES = ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14", "S15", "S16", "S17", "S18", "S19"] as const;
export type DoraServiceType = (typeof DORA_SERVICE_TYPES)[number];
export const DORA_SERVICE_LABELS: Record<DoraServiceType, string> = {
  S01: "Řízení projektů IKT",
  S02: "Vývoj IKT",
  S03: "Helpdesk a podpora první úrovně",
  S04: "Služby řízení bezpečnosti IKT",
  S05: "Poskytování dat",
  S06: "Analýza dat",
  S07: "IKT, zařízení a hosting (mimo cloud)",
  S08: "Výpočetní kapacita",
  S09: "Ukládání dat mimo cloud",
  S10: "Telekomunikační operátor",
  S11: "Síťová infrastruktura",
  S12: "Hardware a fyzická zařízení",
  S13: "Licence softwaru (mimo SaaS)",
  S14: "Řízení provozu IKT (včetně údržby)",
  S15: "Poradenství v oblasti IKT",
  S16: "Řízení rizik IKT",
  S17: "Cloud: IaaS",
  S18: "Cloud: PaaS",
  S19: "Cloud: SaaS",
};

export const DORA_ARRANGEMENT_TYPES = ["standalone", "overarching", "subsequent"] as const;
export const DORA_TERMINATION = ["expiry", "breach", "impediment", "data_weakness", "authority", "other"] as const;
export const DORA_SENSITIVITY = ["low", "medium", "high"] as const;
export const DORA_RELIANCE = ["not_significant", "low", "material", "full"] as const;
export const DORA_SUBSTITUTABILITY = ["not_substitutable", "highly_complex", "medium", "easy"] as const;
export const DORA_NON_SUBST_REASON = ["no_alternatives", "migration", "both"] as const;
export const DORA_REINTEGRATION = ["easy", "difficult", "highly_complex"] as const;
export const DORA_IMPACT = ["low", "medium", "high", "not_assessed"] as const;
export const DORA_ALTERNATIVES = ["yes", "no", "not_assessed"] as const;

export const DORA_LABELS = {
  arrangement: { standalone: "Samostatné ujednání", overarching: "Rámcové (zastřešující) ujednání", subsequent: "Navazující / přidružené ujednání" },
  termination: {
    expiry: "Uplynutí doby / neobnovení",
    breach: "Porušení právních předpisů nebo smlouvy",
    impediment: "Překážky ovlivňující podporovanou funkci",
    data_weakness: "Slabiny v nakládání s citlivými daty",
    authority: "Na žádost příslušného orgánu",
    other: "Jiný důvod",
  },
  sensitivity: { low: "Nízká", medium: "Střední", high: "Vysoká" },
  reliance: { not_significant: "Nevýznamná", low: "Nízká závislost", material: "Podstatná závislost", full: "Úplná závislost" },
  substitutability: { not_substitutable: "Nenahraditelný", highly_complex: "Velmi složitě nahraditelný", medium: "Středně složitě nahraditelný", easy: "Snadno nahraditelný" },
  nonSubst: { no_alternatives: "Chybí reálné alternativy", migration: "Obtížná migrace dat a zátěže", both: "Obojí" },
  reintegration: { easy: "Snadná", difficult: "Obtížná", highly_complex: "Velmi složitá" },
  impact: { low: "Nízký", medium: "Střední", high: "Vysoký", not_assessed: "Neposouzeno" },
  alternatives: { yes: "Ano", no: "Ne", not_assessed: "Neposouzeno" },
  personType: { legal: "Právnická osoba", individual: "Fyzická osoba podnikající" },
} as const;

const iso2 = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Kód země ISO 3166-1 (2 písmena)");
const optIso2 = z.union([iso2, z.literal("")]).optional().nullable();
const lei = z.string().trim().toUpperCase().max(20).optional().nullable();
const money = z.number().min(0).max(1e13).optional().nullable();
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("EUR");
const days = z.number().int().min(0).max(3650).optional().nullable();

/** Údaje finančního subjektu (B_01.01 / B_01.02) – na společnosti. */
export const DoraEntity = z.object({
  lei,
  country: optIso2,
  entityType: z.number().int().min(1).max(22).optional().nullable(),
  hierarchy: z.number().int().min(1).max(5).optional().nullable(),
  parentLei: lei,
  currency,
  totalAssets: money,
  competentAuthority: z.string().trim().max(100).optional().nullable(),
});
export type DoraEntity = z.infer<typeof DoraEntity>;

/** Doplňkové údaje dodavatele jako poskytovatele IKT (B_05.01). */
export const DoraProvider = z.object({
  ict: z.boolean().default(false),
  lei,
  euid: z.string().trim().max(40).optional().nullable(),
  country: optIso2,
  personType: z.enum(["legal", "individual"]).default("legal"),
  latinName: z.string().trim().max(300).optional().nullable(),
  parentCode: z.string().trim().max(40).optional().nullable(),
  parentCodeType: z.string().trim().max(10).optional().nullable(),
  annualCost: money,
  currency,
});
export type DoraProvider = z.infer<typeof DoraProvider>;

export const DoraChainLink = z.object({
  rank: z.number().int().min(2).max(20),
  name: z.string().trim().min(1).max(300),
  code: z.string().trim().min(1).max(40),
  codeType: z.string().trim().min(1).max(10),
  serviceType: z.enum(DORA_SERVICE_TYPES),
  /** Komu subdodavatel službu poskytuje (kód); prázdné = přímý poskytovatel. */
  recipientCode: z.string().trim().max(40).optional().nullable(),
  recipientCodeType: z.string().trim().max(10).optional().nullable(),
});
export type DoraChainLink = z.infer<typeof DoraChainLink>;

/** Doplňkové údaje smlouvy (B_02.01, B_02.02, B_05.02, B_07.01). */
export const DoraContract = z.object({
  arrangementType: z.enum(DORA_ARRANGEMENT_TYPES).default("standalone"),
  overarchingContractId: z.string().uuid().optional().nullable(),
  annualCost: money,
  currency,
  serviceTypes: z.array(z.enum(DORA_SERVICE_TYPES)).max(19).default([]),
  terminationReason: z.enum(DORA_TERMINATION).optional().nullable(),
  noticeEntityDays: days,
  noticeProviderDays: days,
  governingLaw: optIso2,
  serviceCountry: optIso2,
  storesData: z.boolean().optional().nullable(),
  dataLocation: optIso2,
  processingLocation: optIso2,
  dataSensitivity: z.enum(DORA_SENSITIVITY).optional().nullable(),
  reliance: z.enum(DORA_RELIANCE).optional().nullable(),
  substitutability: z.enum(DORA_SUBSTITUTABILITY).optional().nullable(),
  nonSubstReason: z.enum(DORA_NON_SUBST_REASON).optional().nullable(),
  lastAuditAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  exitPlan: z.boolean().optional().nullable(),
  reintegration: z.enum(DORA_REINTEGRATION).optional().nullable(),
  discontinuationImpact: z.enum(DORA_IMPACT).optional().nullable(),
  alternatives: z.enum(DORA_ALTERNATIVES).optional().nullable(),
  alternativeProvider: z.string().trim().max(300).optional().nullable(),
  chain: z.array(DoraChainLink).max(50).default([]),
});
export type DoraContract = z.infer<typeof DoraContract>;
export const DoraContractInput = DoraContract.extend({ processIds: z.array(z.string().uuid()).max(200).default([]) });
export type DoraContractInput = z.input<typeof DoraContractInput>;

export const DoraFunctionInput = z.object({ activity: z.string().trim().max(300).optional().nullable() });

/** ISO 17442: 20 znaků, kontrolní číslice ISO 7064 MOD 97-10. */
export function validLei(v: string | null | undefined): boolean {
  if (!v || !/^[A-Z0-9]{18}[0-9]{2}$/.test(v)) return false;
  let rem = 0;
  for (const ch of v) {
    const n = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/* ---------------- vstupy a sestavení registru ---------------- */

export interface DoraEntityIn {
  companyId: string;
  name: string;
  ico: string | null;
  parentCompanyId: string | null;
  dora: Partial<DoraEntity>;
}
export interface DoraProviderIn {
  supplierId: string;
  companyId: string;
  name: string;
  ico: string | null;
  dora: Partial<DoraProvider>;
}
export interface DoraContractIn {
  contractId: string;
  supplierId: string;
  title: string;
  number: string | null;
  validFrom: string | null;
  validTo: string | null;
  exitStrategy: string | null;
  processIds: string[];
  dora: Partial<DoraContract>;
}
export interface DoraFunctionIn {
  processId: string;
  companyId: string;
  functionNo: number;
  name: string;
  criticality: "low" | "medium" | "high" | "critical";
  activity: string | null;
  bia: { assessedAt: string | null; rtoHours: number | null; rpoHours: number | null; approved: boolean } | null;
}

export type DoraFindingKind =
  | "entity_lei"
  | "entity_type"
  | "provider_code"
  | "provider_lei"
  | "provider_country"
  | "contract_cost"
  | "contract_service"
  | "contract_function"
  | "contract_dates"
  | "contract_critical_fields"
  | "contract_exit_plan"
  | "contract_assessment"
  | "function_assessment"
  | "concentration";
export const DORA_FINDING_LABELS: Record<DoraFindingKind, string> = {
  entity_lei: "Subjekt bez platného LEI",
  entity_type: "Subjekt bez typu nebo země",
  provider_code: "Poskytovatel bez identifikačního kódu",
  provider_lei: "Neplatný LEI poskytovatele",
  provider_country: "Poskytovatel bez země sídla",
  contract_cost: "Smlouva bez ročních nákladů",
  contract_service: "Smlouva bez druhu služby IKT",
  contract_function: "Smlouva bez podporované funkce",
  contract_dates: "Smlouva bez data zahájení",
  contract_critical_fields: "Chybí údaje pro kritickou funkci",
  contract_exit_plan: "Kritická funkce bez strategie ukončení",
  contract_assessment: "Chybí posouzení služby (B_07.01)",
  function_assessment: "Funkce bez posouzení (BIA)",
  concentration: "Koncentrace na poskytovatele",
};
export type DoraSeverity = "high" | "medium" | "low";
export interface DoraFinding {
  kind: DoraFindingKind;
  severity: DoraSeverity;
  /** Odkaz na záznam: company / supplier / contract / process. */
  ref: { type: "company" | "supplier" | "contract" | "process"; id: string; supplierId?: string };
  name: string;
  /** Chybějící pole (kódy sloupců šablon). */
  fields: string[];
}

export interface DoraFunctionRow {
  processId: string;
  functionId: string;
  name: string;
  companyId: string;
  critical: "yes" | "no" | "not_assessed";
  assessedAt: string | null;
  rtoHours: number | null;
  rpoHours: number | null;
  impact: (typeof DORA_IMPACT)[number];
  activity: string;
}
export interface DoraContractRow {
  contractId: string;
  supplierId: string;
  reference: string;
  title: string;
  providerName: string;
  providerCode: string | null;
  providerCodeType: string | null;
  serviceTypes: DoraServiceType[];
  functionIds: string[];
  critical: boolean;
  annualCost: number | null;
  currency: string;
  validFrom: string | null;
  validTo: string | null;
  substitutability: string | null;
  /** Počet chybějících údajů (z nálezů). */
  missing: number;
}
export interface DoraConcentration {
  key: string;
  name: string;
  code: string | null;
  contracts: number;
  criticalFunctions: number;
  /** Podíl kritických funkcí registru, které poskytovatel (skupina) podporuje. */
  share: number;
  annualCost: number;
  notSubstitutable: boolean;
}
export interface DoraRegister {
  entities: { companyId: string; name: string; lei: string | null; valid: boolean }[];
  contracts: DoraContractRow[];
  functions: DoraFunctionRow[];
  providers: { supplierId: string; name: string; code: string | null; codeType: string | null; country: string | null; contracts: number }[];
  concentration: DoraConcentration[];
  findings: DoraFinding[];
  summary: { providers: number; contracts: number; functions: number; criticalFunctions: number; findings: number; complete: number };
  /** Řádky šablon pro export: kód šablony → [hlavička, ...řádky]. */
  templates: Record<string, string[][]>;
}

/** Primární kód poskytovatele: LEI → EUID → IČO (země_CRN). */
export function providerCode(p: { ico: string | null; dora: Partial<DoraProvider> }): { code: string; type: string } | null {
  if (p.dora.lei) return { code: p.dora.lei, type: "LEI" };
  if (p.dora.euid) return { code: p.dora.euid, type: "EUID" };
  if (p.ico) return { code: p.ico, type: `${p.dora.country || "CZ"}_CRN` };
  return null;
}

const NONE_DATE = "9999-12-31";
const COLS: Record<string, string[]> = {
  "b_01.01": ["c0010", "c0020", "c0030", "c0040", "c0050", "c0060"],
  "b_01.02": ["c0010", "c0020", "c0030", "c0040", "c0050", "c0060", "c0070", "c0080", "c0090", "c0100", "c0110"],
  "b_01.03": ["c0010", "c0020", "c0030", "c0040"],
  "b_02.01": ["c0010", "c0020", "c0030", "c0040", "c0050"],
  "b_02.02": ["c0010", "c0020", "c0030", "c0040", "c0050", "c0060", "c0070", "c0080", "c0090", "c0100", "c0110", "c0120", "c0130", "c0140", "c0150", "c0160", "c0170", "c0180"],
  "b_02.03": ["c0010", "c0020"],
  "b_03.01": ["c0010", "c0020"],
  "b_03.02": ["c0010", "c0020", "c0030"],
  "b_03.03": ["c0010", "c0020"],
  "b_04.01": ["c0010", "c0020", "c0030", "c0040"],
  "b_05.01": ["c0010", "c0020", "c0030", "c0040", "c0050", "c0060", "c0070", "c0080", "c0090", "c0100", "c0110", "c0120"],
  "b_05.02": ["c0010", "c0020", "c0030", "c0040", "c0050", "c0060", "c0070"],
  "b_06.01": ["c0010", "c0020", "c0030", "c0040", "c0060", "c0070", "c0080", "c0090", "c0100", "c0110"],
  "b_07.01": ["c0010", "c0020", "c0030", "c0040", "c0050", "c0060", "c0070", "c0080", "c0090", "c0100", "c0110", "c0120"],
};
export const DORA_TEMPLATE_CODES = Object.keys(COLS);

const idx = <T extends readonly string[]>(arr: T, v: string | null | undefined) => (v ? String(arr.indexOf(v as T[number]) + 1) : "");
const yn = (v: boolean | null | undefined) => (v == null ? "" : v ? "true" : "false");
const num = (v: number | null | undefined) => (v == null ? "" : String(v));

export function buildDoraRegister(input: { entities: DoraEntityIn[]; providers: DoraProviderIn[]; contracts: DoraContractIn[]; functions: DoraFunctionIn[]; reportingCompanyId: string; today?: string }): DoraRegister {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const findings: DoraFinding[] = [];
  const add = (f: DoraFinding) => findings.push(f);
  const ent = new Map(input.entities.map((e) => [e.companyId, e]));
  const providers = input.providers.filter((p) => p.dora.ict);
  const provById = new Map(providers.map((p) => [p.supplierId, p]));
  const contracts = input.contracts.filter((c) => provById.has(c.supplierId));

  // funkce
  const usedFn = new Set(contracts.flatMap((c) => c.processIds));
  const functions: DoraFunctionRow[] = input.functions
    .filter((f) => usedFn.has(f.processId))
    .map((f) => {
      const assessed = !!f.bia?.assessedAt;
      const critical: DoraFunctionRow["critical"] = !assessed ? "not_assessed" : f.criticality === "critical" || f.criticality === "high" ? "yes" : "no";
      const impact: DoraFunctionRow["impact"] = !assessed ? "not_assessed" : f.criticality === "critical" || f.criticality === "high" ? "high" : f.criticality === "medium" ? "medium" : "low";
      if (!assessed || f.bia?.rtoHours == null || f.bia?.rpoHours == null)
        add({ kind: "function_assessment", severity: "medium", ref: { type: "process", id: f.processId }, name: f.name, fields: ["B_06.01.0060", "B_06.01.0090", "B_06.01.0100"].filter((x, i) => (i === 0 ? !assessed : i === 1 ? f.bia?.rtoHours == null : f.bia?.rpoHours == null)) });
      return {
        processId: f.processId,
        functionId: `F${f.functionNo}`,
        name: f.name,
        companyId: f.companyId,
        critical,
        assessedAt: f.bia?.assessedAt ?? null,
        rtoHours: f.bia?.rtoHours != null ? Math.ceil(f.bia.rtoHours) : null,
        rpoHours: f.bia?.rpoHours != null ? Math.ceil(f.bia.rpoHours) : null,
        impact,
        activity: f.activity?.trim() || "support functions",
      };
    });
  const fnRow = new Map(functions.map((f) => [f.processId, f]));

  // subjekty: vykazující + společnosti poskytovatelů v registru
  const entityIds = [...new Set([input.reportingCompanyId, ...providers.filter((p) => contracts.some((c) => c.supplierId === p.supplierId)).map((p) => p.companyId)])];
  const entities = entityIds
    .map((id) => ent.get(id))
    .filter((e): e is DoraEntityIn => !!e)
    .map((e) => {
      const valid = validLei(e.dora.lei);
      if (!valid) add({ kind: "entity_lei", severity: "high", ref: { type: "company", id: e.companyId }, name: e.name, fields: ["B_01.02.0010"] });
      if (!e.dora.entityType || !e.dora.country) add({ kind: "entity_type", severity: "medium", ref: { type: "company", id: e.companyId }, name: e.name, fields: [!e.dora.entityType && "B_01.02.0040", !e.dora.country && "B_01.02.0030"].filter(Boolean) as string[] });
      return { companyId: e.companyId, name: e.name, lei: e.dora.lei ?? null, valid };
    });
  const leiOf = (companyId: string) => ent.get(companyId)?.dora.lei ?? "";

  // poskytovatelé
  const provRows = providers
    .filter((p) => contracts.some((c) => c.supplierId === p.supplierId))
    .map((p) => {
      const pc = providerCode(p);
      if (!pc) add({ kind: "provider_code", severity: "high", ref: { type: "supplier", id: p.supplierId }, name: p.name, fields: ["B_05.01.0010"] });
      if (p.dora.lei && !validLei(p.dora.lei)) add({ kind: "provider_lei", severity: "high", ref: { type: "supplier", id: p.supplierId }, name: p.name, fields: ["B_05.01.0010"] });
      if (!p.dora.country) add({ kind: "provider_country", severity: "medium", ref: { type: "supplier", id: p.supplierId }, name: p.name, fields: ["B_05.01.0080"] });
      return { supplierId: p.supplierId, name: p.name, code: pc?.code ?? null, codeType: pc?.type ?? null, country: p.dora.country ?? null, contracts: contracts.filter((c) => c.supplierId === p.supplierId).length };
    });
  const provRow = new Map(provRows.map((p) => [p.supplierId, p]));

  // smlouvy
  const refOf = (c: DoraContractIn) => (c.number?.trim() || c.contractId.slice(0, 8)).slice(0, 100);
  const contractRefById = new Map(contracts.map((c) => [c.contractId, refOf(c)]));
  const contractRows: DoraContractRow[] = contracts.map((c) => {
    const d = c.dora;
    const p = provById.get(c.supplierId)!;
    const pr = provRow.get(c.supplierId)!;
    const fns = c.processIds.map((id) => fnRow.get(id)).filter((x): x is DoraFunctionRow => !!x);
    const critical = fns.some((f) => f.critical === "yes");
    const before = findings.length;
    const ref = { type: "contract" as const, id: c.contractId, supplierId: c.supplierId };
    const name = `${p.name} – ${c.title}`;
    if (d.annualCost == null) add({ kind: "contract_cost", severity: "medium", ref, name, fields: ["B_02.01.0050"] });
    if (!d.serviceTypes?.length) add({ kind: "contract_service", severity: "high", ref, name, fields: ["B_02.02.0060"] });
    if (!fns.length) add({ kind: "contract_function", severity: "high", ref, name, fields: ["B_02.02.0050"] });
    if (!c.validFrom) add({ kind: "contract_dates", severity: "medium", ref, name, fields: ["B_02.02.0070"] });
    if (critical) {
      const miss = [
        d.noticeEntityDays == null && "B_02.02.0100",
        d.noticeProviderDays == null && "B_02.02.0110",
        !d.governingLaw && "B_02.02.0120",
        !d.serviceCountry && "B_02.02.0130",
        d.storesData == null && "B_02.02.0140",
        d.storesData && !d.dataLocation && "B_02.02.0150",
        d.storesData && !d.dataSensitivity && "B_02.02.0170",
        !d.reliance && "B_02.02.0180",
      ].filter(Boolean) as string[];
      if (miss.length) add({ kind: "contract_critical_fields", severity: "high", ref, name, fields: miss });
      if (!(d.exitPlan ?? !!c.exitStrategy?.trim())) add({ kind: "contract_exit_plan", severity: "high", ref, name, fields: ["B_07.01.0080"] });
      const am = [!d.substitutability && "B_07.01.0050", d.substitutability && ["not_substitutable", "highly_complex"].includes(d.substitutability) && !d.nonSubstReason && "B_07.01.0060", !d.reintegration && "B_07.01.0090", !d.discontinuationImpact && "B_07.01.0100", !d.alternatives && "B_07.01.0110"].filter(Boolean) as string[];
      if (am.length) add({ kind: "contract_assessment", severity: "medium", ref, name, fields: am });
    }
    const missing = findings.slice(before).reduce((n, f) => n + Math.max(1, f.fields.length), 0);
    return {
      contractId: c.contractId,
      supplierId: c.supplierId,
      reference: refOf(c),
      title: c.title,
      providerName: p.name,
      providerCode: pr.code,
      providerCodeType: pr.codeType,
      serviceTypes: d.serviceTypes ?? [],
      functionIds: fns.map((f) => f.functionId),
      critical,
      annualCost: d.annualCost ?? null,
      currency: d.currency ?? "EUR",
      validFrom: c.validFrom,
      validTo: c.validTo,
      substitutability: d.substitutability ?? null,
      missing,
    };
  });

  // koncentrace: podle nejvyššího mateřského podniku (je-li uveden), jinak podle poskytovatele
  const critTotal = functions.filter((f) => f.critical === "yes").length;
  const groups = new Map<string, { name: string; code: string | null; contracts: Set<string>; fns: Set<string>; cost: number; notSubst: boolean }>();
  for (const c of contractRows) {
    const p = provById.get(c.supplierId)!;
    const key = p.dora.parentCode ? `parent:${p.dora.parentCode}` : `supplier:${p.supplierId}`;
    const g = groups.get(key) ?? { name: p.dora.parentCode ? `${p.name} (${p.dora.parentCode})` : p.name, code: p.dora.parentCode ?? c.providerCode, contracts: new Set(), fns: new Set(), cost: 0, notSubst: false };
    g.contracts.add(c.contractId);
    const src = contracts.find((x) => x.contractId === c.contractId)!;
    for (const id of src.processIds) if (fnRow.get(id)?.critical === "yes") g.fns.add(id);
    g.cost += c.annualCost ?? 0;
    if (c.critical && (c.substitutability === "not_substitutable" || c.substitutability === "highly_complex")) g.notSubst = true;
    groups.set(key, g);
  }
  const concentration: DoraConcentration[] = [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name, code: g.code, contracts: g.contracts.size, criticalFunctions: g.fns.size, share: critTotal ? g.fns.size / critTotal : 0, annualCost: g.cost, notSubstitutable: g.notSubst }))
    .sort((a, b) => b.criticalFunctions - a.criticalFunctions || b.annualCost - a.annualCost);
  for (const g of concentration)
    if (g.criticalFunctions >= 2 && (g.share >= 0.5 || g.notSubstitutable))
      add({ kind: "concentration", severity: g.notSubstitutable ? "high" : "medium", ref: g.key.startsWith("supplier:") ? { type: "supplier", id: g.key.slice(9) } : { type: "supplier", id: contractRows.find((c) => provById.get(c.supplierId)?.dora.parentCode === g.code)!.supplierId }, name: g.name, fields: [] });

  // šablony
  const T: Record<string, string[][]> = Object.fromEntries(Object.entries(COLS).map(([k, cols]) => [k, [cols]]));
  const rep = ent.get(input.reportingCompanyId);
  if (rep) T["b_01.01"]!.push([rep.dora.lei ?? "", rep.name, rep.dora.country ?? "", num(rep.dora.entityType), rep.dora.competentAuthority ?? "", today]);
  for (const e of entityIds.map((id) => ent.get(id)).filter((x): x is DoraEntityIn => !!x)) {
    const parent = e.parentCompanyId ? ent.get(e.parentCompanyId) : null;
    T["b_01.02"]!.push([e.dora.lei ?? "", e.name, e.dora.country ?? "", num(e.dora.entityType), num(e.dora.hierarchy), e.dora.parentLei || parent?.dora.lei || e.dora.lei || "", today, today, NONE_DATE, e.dora.totalAssets != null ? (e.dora.currency ?? "EUR") : "", num(e.dora.totalAssets)]);
  }
  for (const c of contracts) {
    const d = c.dora;
    const ref = contractRefById.get(c.contractId)!;
    const p = provById.get(c.supplierId)!;
    const pc = provRow.get(c.supplierId)!;
    const entLei = leiOf(p.companyId);
    T["b_02.01"]!.push([ref, idx(DORA_ARRANGEMENT_TYPES, d.arrangementType ?? "standalone"), d.overarchingContractId ? (contractRefById.get(d.overarchingContractId) ?? "") : "", d.currency ?? "EUR", num(d.annualCost)]);
    const fns = c.processIds.map((id) => fnRow.get(id)).filter((x): x is DoraFunctionRow => !!x);
    for (const f of fns.length ? fns : [null])
      for (const s of d.serviceTypes?.length ? d.serviceTypes : [""]) {
        const crit = f?.critical === "yes";
        T["b_02.02"]!.push([
          ref,
          entLei,
          pc.code ?? "",
          pc.codeType ?? "",
          f?.functionId ?? "",
          s,
          c.validFrom ?? "",
          c.validTo ?? NONE_DATE,
          c.validTo && c.validTo < today ? idx(DORA_TERMINATION, d.terminationReason) : "",
          crit ? num(d.noticeEntityDays) : "",
          crit ? num(d.noticeProviderDays) : "",
          crit ? (d.governingLaw ?? "") : "",
          crit ? (d.serviceCountry ?? "") : "",
          crit ? yn(d.storesData) : "",
          d.storesData ? (d.dataLocation ?? "") : "",
          d.processingLocation ?? "",
          d.storesData && crit ? idx(DORA_SENSITIVITY, d.dataSensitivity) : "",
          crit ? idx(DORA_RELIANCE, d.reliance) : "",
        ]);
      }
    T["b_03.01"]!.push([ref, entLei]);
    T["b_03.02"]!.push([ref, pc.code ?? "", pc.codeType ?? ""]);
    T["b_04.01"]!.push([ref, entLei, "2", ""]);
    for (const s of d.serviceTypes?.length ? d.serviceTypes : [""]) T["b_05.02"]!.push([ref, s, pc.code ?? "", pc.codeType ?? "", "1", "", ""]);
    for (const l of d.chain ?? []) T["b_05.02"]!.push([ref, l.serviceType, l.code, l.codeType, String(l.rank), l.recipientCode || pc.code || "", l.recipientCodeType || pc.codeType || ""]);
    if (fns.some((f) => f.critical === "yes"))
      for (const s of d.serviceTypes?.length ? d.serviceTypes : [""])
        T["b_07.01"]!.push([
          ref,
          pc.code ?? "",
          pc.codeType ?? "",
          s,
          idx(DORA_SUBSTITUTABILITY, d.substitutability),
          d.substitutability === "not_substitutable" || d.substitutability === "highly_complex" ? idx(DORA_NON_SUBST_REASON, d.nonSubstReason) : "",
          d.lastAuditAt ?? NONE_DATE,
          yn(d.exitPlan ?? !!c.exitStrategy?.trim()),
          idx(DORA_REINTEGRATION, d.reintegration),
          idx(DORA_IMPACT, d.discontinuationImpact),
          idx(DORA_ALTERNATIVES, d.alternatives),
          d.alternativeProvider ?? "",
        ]);
  }
  for (const p of providers.filter((x) => provRow.has(x.supplierId))) {
    const pc = provRow.get(p.supplierId)!;
    const extra = p.dora.lei && p.ico ? { code: p.ico, type: `${p.dora.country || "CZ"}_CRN` } : null;
    T["b_05.01"]!.push([pc.code ?? "", pc.codeType ?? "", extra?.code ?? "", extra?.type ?? "", p.name, p.dora.latinName || p.name, p.dora.personType === "individual" ? "2" : "1", p.dora.country ?? "", p.dora.annualCost != null ? (p.dora.currency ?? "EUR") : "", num(p.dora.annualCost), p.dora.parentCode ?? "", p.dora.parentCode ? (p.dora.parentCodeType ?? "") : ""]);
  }
  for (const c of contracts)
    for (const l of c.dora.chain ?? []) if (!T["b_05.01"]!.some((r) => r[0] === l.code)) T["b_05.01"]!.push([l.code, l.codeType, "", "", l.name, l.name, "1", "", "", "", "", ""]);
  for (const f of functions) T["b_06.01"]!.push([f.functionId, f.activity, f.name, leiOf(f.companyId), f.critical === "yes" ? "true" : f.critical === "no" ? "false" : "not_assessed", "", f.assessedAt ?? NONE_DATE, num(f.rtoHours ?? 0), num(f.rpoHours ?? 0), idx(DORA_IMPACT, f.impact)]);

  const flagged = new Set(findings.filter((f) => f.ref.type === "contract").map((f) => f.ref.id));
  return {
    entities,
    contracts: contractRows,
    functions,
    providers: provRows,
    concentration,
    findings,
    summary: {
      providers: provRows.length,
      contracts: contractRows.length,
      functions: functions.length,
      criticalFunctions: critTotal,
      findings: findings.length,
      complete: contractRows.filter((c) => !flagged.has(c.contractId)).length,
    },
    templates: T,
  };
}

/** CSV jedné šablony (oddělovač čárka, uvozovky dle RFC 4180). */
export function doraCsv(rows: string[][]): string {
  return rows.map((r) => r.map((v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\r\n") + "\r\n";
}

export type DoraRegisterDto = Omit<DoraRegister, "templates"> & { companies: { id: string; name: string; dora: Partial<DoraEntity> }[]; others: { id: string; name: string; significant: boolean }[] };
