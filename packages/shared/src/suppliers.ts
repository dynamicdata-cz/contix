import { z } from "zod";
import type { DoraProvider } from "./dora";
import { patchOf } from "./zutil";

/* ============================================================
 * Řízení dodavatelů – § 9 vyhl. č. 409/2025 Sb. (významní dodavatelé, § 2 písm. h) a příloha č. 5;
 * § 3 odst. 5 a příloha č. 2 vyhl. č. 410/2025 Sb.
 * Texty ustanovení příloh jsou převzaty z e-Sbírky (znění od 1. 11. 2025).
 * ============================================================ */

export const CLAUSE_STATES = ["included", "partial", "missing", "not_relevant"] as const;
export type ClauseState = (typeof CLAUSE_STATES)[number];
export const CLAUSE_LABELS: Record<ClauseState, string> = {
  included: "Obsaženo",
  partial: "Částečně",
  missing: "Chybí",
  not_relevant: "Nerelevantní",
};

export interface ContractClause {
  key: string;
  text: string;
  points?: string[];
}

/** Příloha č. 5 vyhl. č. 409/2025 Sb. – obsah smlouvy s významnými dodavateli (relevantní ustanovení). */
export const CLAUSES_409: ContractClause[] = [
  { key: "a", text: "ustanovení o bezpečnosti informací z pohledu důvěrnosti (včetně ustanovení o mlčenlivosti), integrity a dostupnosti" },
  { key: "b", text: "ustanovení o oprávnění užívat data" },
  { key: "c", text: "ustanovení o autorství programového kódu, popřípadě o programových licencích" },
  { key: "d", text: "ustanovení o kontrole zavedených bezpečnostních opatření (pravidla zákaznického auditu)" },
  {
    key: "e",
    text: "ustanovení upravující řetězení dodavatelů, přičemž musí být zajištěno, že subdodavatelé se zaváží dodržovat v plném rozsahu ujednání mezi povinnou osobou a dodavatelem a nebudou v rozporu s požadavky povinné osoby na dodavatele",
  },
  {
    key: "f",
    text: "ustanovení o povinnosti dodavatele dodržovat bezpečnostní politiky povinné osoby nebo ustanovení o odsouhlasení bezpečnostních politik dodavatele (nebo odsouhlasení pro dodavatelský vztah relevantních částí bezpečnostních politik) povinnou osobou",
  },
  { key: "g", text: "ustanovení o řízení změn" },
  { key: "h", text: "ustanovení o souladu smluv s obecně závaznými právními předpisy" },
  {
    key: "i",
    text: "ustanovení o povinnosti dodavatele informovat povinnou osobu o",
    points: [
      "1. kybernetických bezpečnostních incidentech souvisejících s plněním smlouvy,",
      "2. způsobu řízení rizik na straně dodavatele a o zbytkových rizicích souvisejících s plněním smlouvy,",
      "3. významné změně ovládání tohoto dodavatele podle zákona o obchodních korporacích nebo změně vlastnictví zásadních aktiv, popřípadě změně oprávnění nakládat s těmito aktivy, využívaných tímto dodavatelem k plnění podle smlouvy s povinnou osobou,",
      "4. žádosti cizozemského orgánu o zpřístupnění nebo předání dat zpracovávaných na území cizího státu, vyjma situace, kdy by takové informování bylo v rozporu s právním řádem, v jehož působnosti dochází ke zpracování dat nebo podle kterého byla žádost podána,",
      "5. fyzických osobách přicházejících do kontaktu s důvěrnými informacemi povinné osoby (jedná se například o osoby zastávající bezpečnostní role, penetrační testery a administrátory),",
    ],
  },
  {
    key: "j",
    text: "specifikace podmínek z pohledu bezpečnosti při ukončení smlouvy, tzv. exit strategie (například přechodné období při ukončení spolupráce, kdy je třeba ještě udržovat službu před nasazením nového řešení, migrace dat a podobně)",
  },
  {
    key: "k",
    text: "specifikace podmínek pro řízení kontinuity činností v souvislosti s dodavateli zahrnutí dodavatelů do plánů obnovy, plánů kontinuity, úkoly dodavatelů při aktivaci řízení kontinuity činností apod.)",
  },
  { key: "l", text: "specifikace náležitosti smlouvy o úrovni služeb (SLA) a způsobu a úrovni realizace bezpečnostních opatření" },
  { key: "m", text: "ustanovení o dodržování pravidel bezpečného vývoje" },
  { key: "n", text: "specifikace podmínek pro formát předání dat a informací po vyžádání povinnou osobou" },
  { key: "o", text: "pravidla pro likvidaci dat" },
  {
    key: "p",
    text: "ustanovení o právu jednostranně odstoupit od smlouvy nebo smlouvu vypovědět bez výpovědní doby v případě významné změny kontroly nad dodavatelem nebo změny kontroly nad zásadními aktivy využívanými dodavatelem k plnění podle smlouvy",
  },
  { key: "q", text: "ustanovení o sankcích za porušení povinností" },
  {
    key: "r",
    text: "ustanovení o zpřístupnění nebo předání dat na základě žádosti cizozemského orgánu o zpřístupnění nebo předání dat zpracovávaných na území cizího státu",
    points: [
      "1. až po provedení přezkoumání zákonnosti žádosti,",
      "2. až po vynaložení úsilí o zabránění zpřístupnění nebo předání dat v rámci možností daných právním řádem, v jehož působnosti dochází ke zpracování dat nebo podle kterého byla žádost podána,",
      "3. pouze v nezbytném rozsahu.",
    ],
  },
];

/** Příloha č. 2 vyhl. č. 410/2025 Sb. – požadavky na smluvní ujednání s dodavateli. */
export const CLAUSES_410: ContractClause[] = [
  { key: "a", text: "ustanovení o bezpečnosti informací z pohledu důvěrnosti (včetně ustanovení o mlčenlivosti), integrity a dostupnosti" },
  { key: "b", text: "ustanovení o auditu dodavatele související s plněním smlouvy" },
  { key: "c", text: "ustanovení o řetězení dodavatelů" },
  { key: "d", text: "ustanovení upravující tzv. exit strategii, podmínky ukončení smluvního vztahu z pohledu bezpečnosti informací" },
  { key: "e", text: "ustanovení o sankcích za porušení smluvních povinností" },
  { key: "f", text: "ustanovení o oprávnění užívat data" },
  { key: "g", text: "ustanovení o autorství programového kódu, případně o programových licencích" },
  { key: "h", text: "ustanovení o důvěrnosti smluvního vztahu" },
  {
    key: "i",
    text: "ustanovení o povinnosti dodavatele dodržovat bezpečnostní politiky povinné osoby nebo ustanovení o odsouhlasení bezpečnostních politik dodavatele (nebo odsouhlasení pro dodavatelský vztah relevantních částí bezpečnostních politik) povinnou osobou",
  },
  { key: "j", text: "ustanovení o řízení změn" },
  { key: "k", text: "ustanovení o kybernetických bezpečnostních incidentech souvisejících s plněním smlouvy" },
  { key: "l", text: "ustanovení upravující zajištění řízení kontinuity činností" },
  { key: "m", text: "náležitosti smlouvy o úrovni služeb (SLA) a způsobu a úrovni realizace bezpečnostních opatření" },
  { key: "n", text: "ustanovení o dodržování pravidel bezpečného vývoje" },
];

export const CLAUSE_SETS = { cz409: CLAUSES_409, cz410: CLAUSES_410 } as const;
export type ClauseSet = keyof typeof CLAUSE_SETS;

const text = (max = 5000) => z.string().trim().max(max).optional().nullable();
const date = z.string().date().nullable().optional();

export const SupplierInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(300),
  ico: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "IČO má 8 číslic")
    .or(z.literal(""))
    .optional()
    .nullable(),
  address: text(500),
  country: z.string().trim().max(100).optional().nullable(),
  contactName: text(200),
  contactEmail: z.string().trim().max(200).optional().nullable(),
  contactPhone: text(50),
  /** Předmět plnění pro organizaci. */
  supplyDescription: text(),
  /** Významný dodavatel (§ 2 písm. h vyhl. 409/2025). */
  significant: z.boolean().default(false),
  significanceReason: text(),
  /** Zpracovává data nebo provozuje aktiva mimo území ČR (hrozby H08, H20, H21 přílohy č. 3). */
  dataOutsideCz: z.boolean().default(false),
  /** § 9 odst. 1 písm. b) – prokazatelné seznámení s pravidly pro dodavatele. */
  rulesAcknowledgedAt: date,
  /** § 9 odst. 1 písm. e) – prokazatelné písemné informování o evidenci jako významného dodavatele. */
  notifiedAt: date,
  notificationRef: text(200),
  /** § 9 odst. 2 písm. a) – hodnocení rizik před uzavřením smlouvy. */
  riskAssessedAt: date,
  /** § 9 odst. 1 písm. g) / odst. 2 písm. c) – pravidelný přezkum plnění smluv a kontrola opatření. */
  lastReviewAt: date,
  reviewIntervalMonths: z.number().int().min(1).max(36).default(12),
  status: z.enum(["active", "ended"]).default("active"),
  notes: text(),
  assetIds: z.array(z.string().uuid()).default([]),
  processIds: z.array(z.string().uuid()).default([]),
  riskIds: z.array(z.string().uuid()).default([]),
});
export type SupplierInput = z.input<typeof SupplierInput>;
export const SupplierPatch = patchOf(SupplierInput.omit({ companyId: true }));

export const ContractInput = z.object({
  title: z.string().trim().min(1).max(300),
  number: text(100),
  validFrom: date,
  validTo: date,
  clauseSet: z.enum(["cz409", "cz410"]).default("cz409"),
  clauses: z.record(z.string(), z.enum(CLAUSE_STATES)).default({}),
  sla: text(),
  exitStrategy: text(),
  documentUrl: z.string().trim().max(2000).optional().nullable(),
  note: text(),
});
export type ContractInput = z.input<typeof ContractInput>;
export const ContractPatch = patchOf(ContractInput);

export interface ContractDto {
  id: string;
  supplierId: string;
  title: string;
  number: string | null;
  validFrom: string | null;
  validTo: string | null;
  clauseSet: ClauseSet;
  clauses: Record<string, ClauseState>;
  sla: string | null;
  exitStrategy: string | null;
  documentUrl: string | null;
  note: string | null;
  /** Počet relevantních ustanovení, která chybí nebo nejsou posouzena. */
  missingClauses: number;
  expired: boolean;
}

export interface SupplierListItem {
  id: string;
  companyId: string;
  name: string;
  ico: string | null;
  country: string | null;
  significant: boolean;
  status: "active" | "ended";
  dataOutsideCz: boolean;
  notifiedAt: string | null;
  lastReviewAt: string | null;
  reviewDue: boolean;
  contractCount: number;
  missingClauses: number;
  riskCount: number;
  assetCount: number;
  /** Chybějící povinnosti § 9 u významného dodavatele. */
  gaps: string[];
  updatedAt: string;
}

export interface SupplierDetail extends SupplierListItem {
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  supplyDescription: string | null;
  significanceReason: string | null;
  rulesAcknowledgedAt: string | null;
  notificationRef: string | null;
  riskAssessedAt: string | null;
  reviewIntervalMonths: number;
  notes: string | null;
  /** DORA – údaje poskytovatele IKT (ADR-069). */
  dora: Partial<DoraProvider>;
  contracts: ContractDto[];
  assets: { id: string; name: string; assetType: string }[];
  processes: { id: string; code: string | null; name: string }[];
  risks: { id: string; code: string | null; name: string; level: string | null }[];
  canEdit: boolean;
}

/** Relevantní ustanovení, která chybí nebo nejsou posouzena (nerelevantní se nepočítají). */
export function missingClauses(set: ClauseSet, clauses: Record<string, ClauseState>): number {
  return CLAUSE_SETS[set].filter((c) => {
    const s = clauses[c.key];
    return s !== "included" && s !== "not_relevant";
  }).length;
}

/** Mezery v plnění § 9 u významného dodavatele. */
export function supplierGaps(s: {
  significant: boolean;
  status: string;
  notifiedAt: string | null;
  riskAssessedAt: string | null;
  rulesAcknowledgedAt: string | null;
  reviewDue: boolean;
  contractCount: number;
  missingClauses: number;
}): string[] {
  if (!s.significant || s.status !== "active") return [];
  const g: string[] = [];
  if (!s.notifiedAt) g.push("Není doloženo písemné informování o evidenci (§ 9 odst. 1 písm. e).");
  if (!s.rulesAcknowledgedAt) g.push("Není doloženo seznámení s pravidly pro dodavatele (§ 9 odst. 1 písm. b).");
  if (!s.riskAssessedAt) g.push("Chybí hodnocení rizik souvisejících s plněním (§ 9 odst. 2 písm. a).");
  if (!s.contractCount) g.push("Není evidována smlouva (§ 9 odst. 1 písm. f).");
  if (s.missingClauses) g.push(`Ve smlouvách chybí ${s.missingClauses} ustanovení dle přílohy č. 5.`);
  if (s.reviewDue) g.push("Přezkum plnění smlouvy je po termínu (§ 9 odst. 1 písm. g).");
  return g;
}
