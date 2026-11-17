import { z } from "zod";
import { normalizeLabel, parseCell, type ImportField } from "./import";
import type { SodConflict } from "./idm";

/* ============================================================
 * Žádosti o přístup (v1.26, ADR-123): evidence osob (HR), katalog oprávnění, žádost → schválení vedoucím a vlastníkem
 * oprávnění → vyřízení správcem → evidované přidělení. Odebrání při skončení platnosti a odchodu osoby.
 * ============================================================ */

export const PERSON_KINDS = ["employee", "contractor", "external"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

export const PERSON_STATUSES = ["joiner", "active", "leaver"] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

export const RESOURCE_KINDS = ["ad_group", "application", "role", "physical", "other"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const ACCESS_ACTIONS = ["grant", "revoke"] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];

export const REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled", "done"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Odkud žádost vznikla: ručně, konec platnosti přidělení, odchod osoby. */
export const REQUEST_ORIGINS = ["request", "expiry", "leaver", "review", "reconcile", "role", "jml"] as const;
export type RequestOrigin = (typeof REQUEST_ORIGINS)[number];

export const CERT_REVIEWERS = ["owner", "manager"] as const;
export type CertReviewer = (typeof CERT_REVIEWERS)[number];
export const CERT_DECISIONS = ["keep", "revoke"] as const;
export type CertDecision = (typeof CERT_DECISIONS)[number];
export type CertStatus = "open" | "closed";

export const APPROVAL_KINDS = ["manager", "owner"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const ACCESS_LABELS = {
  personKind: { employee: "Zaměstnanec", contractor: "Dodavatel / externí pracovník", external: "Jiná osoba" } satisfies Record<PersonKind, string>,
  personStatus: { joiner: "Nastupující", active: "Aktivní", leaver: "Odešel" } satisfies Record<PersonStatus, string>,
  resourceKind: { ad_group: "Skupina AD", application: "Aplikace", role: "Role v systému", physical: "Fyzický přístup", other: "Jiné" } satisfies Record<ResourceKind, string>,
  action: { grant: "Přidělit", revoke: "Odebrat" } satisfies Record<AccessAction, string>,
  status: { pending: "Ke schválení", approved: "Schváleno – k vyřízení", rejected: "Zamítnuto", cancelled: "Zrušeno", done: "Vyřízeno" } satisfies Record<RequestStatus, string>,
  origin: { request: "Žádost", expiry: "Konec platnosti", leaver: "Odchod osoby", review: "Recertifikace", reconcile: "Nesoulad s AD", role: "Business role", jml: "Nástup / přesun / odchod" } satisfies Record<RequestOrigin, string>,
  approval: { manager: "Vedoucí", owner: "Vlastník oprávnění" } satisfies Record<ApprovalKind, string>,
  certReviewer: { owner: "Vlastník oprávnění", manager: "Nadřízený osoby" } satisfies Record<CertReviewer, string>,
  certDecision: { keep: "Ponechat", revoke: "Odebrat" } satisfies Record<CertDecision, string>,
  certStatus: { open: "Probíhá", closed: "Uzavřeno" } satisfies Record<CertStatus, string>,
};

/** Stav osoby podle data nástupu a ukončení (k datu `today`, YYYY-MM-DD). */
export function personStatus(p: { startDate: string | null; endDate: string | null }, today: string): PersonStatus {
  if (p.endDate && p.endDate < today) return "leaver";
  if (p.startDate && p.startDate > today) return "joiner";
  return "active";
}

/** Kroky schválení: přidělení podle nastavení oprávnění, odebrání bez schválení (rovnou k vyřízení). */
export function approvalSteps(r: { approvalManager: boolean; approvalOwner: boolean }, action: AccessAction): ApprovalKind[] {
  if (action === "revoke") return [];
  return [...(r.approvalManager ? (["manager"] as const) : []), ...(r.approvalOwner ? (["owner"] as const) : [])];
}

/** Stav žádosti ze schválení: zamítnutí kterýmkoli schvalovatelem ukončí žádost; všechna schválení = k vyřízení. */
export function requestStatusFrom(decisions: (string | null)[]): "pending" | "approved" | "rejected" {
  if (decisions.includes("rejected")) return "rejected";
  return decisions.every((d) => d === "approved") ? "approved" : "pending";
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Kontrola platnosti přidělení: oprávnění s max. dobou vyžaduje datum do (nejvýše today + maxDays). */
export function validityError(maxDays: number | null, validUntil: string | null | undefined, today: string): string | null {
  if (validUntil && validUntil < today) return "Platnost nesmí končit v minulosti";
  if (!maxDays) return null;
  if (!validUntil) return `Oprávnění lze přidělit nejvýše na ${maxDays} dní – vyplňte platnost do`;
  if (validUntil > addDays(today, maxDays)) return `Oprávnění lze přidělit nejvýše na ${maxDays} dní (do ${addDays(today, maxDays)})`;
  return null;
}

/* ---------------- vstupy ---------------- */

const opt = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => v || null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v || null);

export const PersonInput = z.object({
  personalNumber: opt(50),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320).nullable().optional().or(z.literal("")).transform((v) => v || null),
  login: opt(200),
  department: opt(200),
  jobTitle: opt(200),
  kind: z.enum(PERSON_KINDS).default("employee"),
  managerId: z.string().uuid().nullable().optional().transform((v) => v || null),
  startDate: isoDate,
  endDate: isoDate,
});
export type PersonInput = z.input<typeof PersonInput>;

export const AccessResourceInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(RESOURCE_KINDS).default("application"),
  description: opt(2000),
  assetId: z.string().uuid().nullable().optional().transform((v) => v || null),
  adGroup: opt(500),
  ownerId: z.string().uuid().nullable().optional().transform((v) => v || null),
  approvalManager: z.boolean().default(true),
  approvalOwner: z.boolean().default(true),
  maxDays: z.number().int().min(1).max(3650).nullable().optional().transform((v) => v ?? null),
  privileged: z.boolean().default(false),
  active: z.boolean().default(true),
  /** Skupina v AD ještě neexistuje – vytvořit ji (v1.33). */
  adCreate: z.boolean().default(false),
});
export type AccessResourceInput = z.input<typeof AccessResourceInput>;

export const AccessRequestInput = z.object({
  personId: z.string().uuid(),
  resourceId: z.string().uuid(),
  action: z.enum(ACCESS_ACTIONS).default("grant"),
  justification: z.string().trim().min(3).max(2000),
  validUntil: isoDate,
});
export type AccessRequestInput = z.input<typeof AccessRequestInput>;

export const AccessDecisionInput = z.object({ decision: z.enum(["approved", "rejected"]), comment: opt(2000) });
export const AccessFulfilInput = z.object({ note: opt(2000) });
export const AccessReassignInput = z.object({ approverId: z.string().uuid() });

/* ---------------- DTO ---------------- */

export interface PersonDto {
  id: string;
  companyId: string;
  personalNumber: string | null;
  firstName: string;
  lastName: string;
  name: string;
  email: string | null;
  login: string | null;
  department: string | null;
  jobTitle: string | null;
  kind: PersonKind;
  managerId: string | null;
  managerName: string | null;
  startDate: string | null;
  endDate: string | null;
  status: PersonStatus;
  source: string;
  grants: number;
}

export interface AccessResourceDto {
  id: string;
  companyId: string;
  name: string;
  kind: ResourceKind;
  description: string | null;
  assetId: string | null;
  assetName: string | null;
  adGroup: string | null;
  ownerId: string | null;
  ownerName: string | null;
  approvalManager: boolean;
  approvalOwner: boolean;
  maxDays: number | null;
  privileged: boolean;
  active: boolean;
  adCreate: boolean;
  grants: number;
}

export interface AccessApprovalDto {
  id: string;
  kind: ApprovalKind;
  approverId: string | null;
  approverName: string | null;
  decision: "approved" | "rejected" | null;
  comment: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
}

export interface AccessRequestDto {
  id: string;
  companyId: string;
  personId: string;
  personName: string;
  resourceId: string;
  resourceName: string;
  resourceKind: ResourceKind;
  privileged: boolean;
  adGroup: string | null;
  action: AccessAction;
  origin: RequestOrigin;
  justification: string;
  validUntil: string | null;
  status: RequestStatus;
  requestedByName: string | null;
  createdAt: string;
  fulfilledByName: string | null;
  fulfilledAt: string | null;
  fulfilNote: string | null;
  approvals: AccessApprovalDto[];
  /** Může aktuální uživatel rozhodnout (id kroku) / vyřídit / zrušit. */
  canDecide: string | null;
  canFulfil: boolean;
  canCancel: boolean;
  /** Toxické kombinace, které přidělení způsobí (zjištěno při založení, v1.34). */
  sodConflicts: SodConflict[];
}

export interface AccessGrantDto {
  id: string;
  personId: string;
  personName: string;
  personStatus: PersonStatus;
  resourceId: string;
  resourceName: string;
  resourceKind: ResourceKind;
  privileged: boolean;
  since: string;
  validUntil: string | null;
  expired: boolean;
  requestId: string | null;
}

/* ---------------- import osob (CSV / XLSX, export z personálního systému) ---------------- */

export const PEOPLE_IMPORT_FIELDS: ImportField[] = [
  { key: "personalNumber", label: "Osobní číslo", type: "text", synonyms: ["os cislo", "oscislo", "os c", "osc", "oc", "osobni cislo zamestnance", "cislo zamestnance", "cislo pracovnika", "employee id", "employee number", "personal number", "id zamestnance"] },
  { key: "firstName", label: "Jméno", type: "text", required: true, synonyms: ["krestni jmeno", "first name", "given name", "givenname"] },
  { key: "lastName", label: "Příjmení", type: "text", required: true, synonyms: ["last name", "surname", "sn", "family name"] },
  /** Celé jméno v jednom sloupci (exporty mezd: „Příjmení a jméno“, „Zaměstnanec“) – rozdělí se, tituly se vynechají. */
  { key: "fullNameLastFirst", label: "Příjmení a jméno", type: "text", synonyms: ["prijmeni jmeno", "zamestnanec", "pracovnik", "jmeno zamestnance", "prijmeni a jmeno zamestnance"] },
  { key: "fullNameFirstLast", label: "Jméno a příjmení", type: "text", synonyms: ["jmeno prijmeni", "cele jmeno", "full name", "display name", "displayname", "name"] },
  { key: "email", label: "E-mail", type: "text", synonyms: ["email", "mail", "e mail", "pracovni email", "sluzebni email", "email pracovni", "email sluzebni"] },
  { key: "login", label: "Login", type: "text", synonyms: ["uzivatelske jmeno", "samaccountname", "username", "user name", "ucet", "prihlasovaci jmeno", "uzivatel"] },
  { key: "department", label: "Útvar", type: "text", synonyms: ["oddeleni", "nazev strediska", "stredisko nazev", "nazev utvaru", "odbor", "department", "organizacni jednotka", "utvar nazev", "nazev oddeleni", "org jednotka"] },
  /** Kód střediska – použije se jako útvar, jen když v souboru není jeho název. */
  { key: "departmentCode", label: "Středisko (kód)", type: "text", synonyms: ["stredisko", "kod strediska", "cislo strediska", "nakladove stredisko", "ns"] },
  { key: "jobTitle", label: "Funkce", type: "text", synonyms: ["pracovni pozice", "pozice", "pracovni misto", "pracovni zarazeni", "zarazeni", "profese", "job title", "title", "funkce nazev", "nazev funkce", "nazev pracovniho mista"] },
  { key: "manager", label: "Nadřízený", type: "text", synonyms: ["vedouci", "primy nadrizeny", "manager", "nadrizeny os cislo", "nadrizeny os c", "nadrizeny email", "os cislo nadrizeneho", "os c nadrizeneho", "osobni cislo nadrizeneho", "vedouci os c", "vedouci os cislo"] },
  { key: "startDate", label: "Datum nástupu", type: "date", synonyms: ["nastup", "den nastupu", "datum vzniku pp", "vznik pp", "datum vzniku", "zacatek pp", "start date", "hire date", "platnost od", "od"] },
  { key: "endDate", label: "Datum ukončení", type: "date", synonyms: ["ukonceni", "vystup", "den ukonceni", "datum ukonceni pp", "ukonceni pp", "datum vystupu", "datum skonceni", "konec pp", "end date", "termination date", "platnost do", "do"] },
  { key: "kind", label: "Typ osoby", type: "enum", options: ACCESS_LABELS.personKind, synonyms: ["typ", "druh", "druh ppv", "druh pp", "druh prac pomeru", "druh pracovniho pomeru", "typ pp", "typ pracovniho pomeru", "pracovni pomer", "kind"] },
];

/**
 * Sloupce s citlivými osobními údaji, které CONTIX nenačítá (rodné číslo, datum narození, adresa, mzda, účet…) –
 * náhled na ně upozorní, aby je správce z exportu vynechal (minimalizace údajů, čl. 5 GDPR).
 */
const SENSITIVE_PATTERNS = [/^r ?c$/, /rodne cislo/, /datum narozeni/, /^narozen/, /^(?!.*mail).*adresa/, /bydliste/, /^ulice/, /^psc/, /mzd/, /^plat( |$)/, /platov/, /tarif/, /cislo uctu/, /bankovni/, /^iban/, /pojistovn/, /obcansk/, /cislo op/, /(^| )pas(u)?( |$)/, /rodinny stav/, /statni prislusnost/, /^pohlavi/, /soukrom/, /zdravot/];
export function sensitiveColumns(headers: string[]): string[] {
  return headers.filter((h) => {
    const n = normalizeLabel(h);
    return !!n && SENSITIVE_PATTERNS.some((re) => re.test(n));
  });
}

/** Je to řádek záhlaví exportu osob (rozpozná jméno a příjmení, nebo celé jméno)? */
export function isPeopleHeader(cells: string[]): boolean {
  const m = peopleMapping(cells);
  return (m.includes("firstName") && m.includes("lastName")) || m.includes("fullNameLastFirst") || m.includes("fullNameFirstLast");
}

const TITLE_RE = /^(ing|mgr|bc|mudr|judr|phdr|rndr|paeddr|mvdr|doc|prof|dis|phd|csc|drsc|mba|msc|bsc|dr|ing arch|th d|ll m)$/;
/** Rozdělí celé jméno; tituly (Ing., Ph.D., …) a čárky vynechá. */
export function splitFullName(raw: string, order: "lastFirst" | "firstLast"): { firstName: string; lastName: string } | null {
  const parts = raw
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((p) => p && !TITLE_RE.test(normalizeLabel(p).replace(/ /g, "")) && !/^[A-Za-z]{1,5}\.$/.test(p) && !/\.[A-Za-z]+\.?$/.test(p));
  if (parts.length < 2) return null;
  return order === "lastFirst" ? { lastName: parts[0]!, firstName: parts.slice(1).join(" ") } : { lastName: parts[parts.length - 1]!, firstName: parts.slice(0, -1).join(" ") };
}

/** Mapování záhlaví → pole importu osob. */
export function peopleMapping(headers: string[]): (string | null)[] {
  const used = new Set<string>();
  return headers.map((h) => {
    // porovnání bez mezer: „Služební e-mail“ = „sluzebni email“, „Os. číslo“ = „oscislo“
    const k = (s: string) => normalizeLabel(s).replace(/ /g, "");
    const n = k(h);
    if (!n) return null;
    const hit = PEOPLE_IMPORT_FIELDS.find((f) => !used.has(f.key) && (k(f.key) === n || k(f.label) === n || (f.synonyms ?? []).some((s) => k(s) === n)));
    if (hit) used.add(hit.key);
    return hit?.key ?? null;
  });
}

/** Převod řádku na hodnoty osoby; druh pracovního poměru z personalistiky (DPP, DPČ…) se mapuje na typ osoby. */
export function parsePersonRow(mapping: (string | null)[], row: string[]): { data: Record<string, string | null>; errors: string[] } {
  const data: Record<string, string | null> = {};
  const errors: string[] = [];
  mapping.forEach((key, i) => {
    if (!key) return;
    const field = PEOPLE_IMPORT_FIELDS.find((f) => f.key === key)!;
    const raw = row[i] ?? "";
    if (key === "kind") {
      const n = normalizeLabel(raw);
      if (!n) return;
      if (/^(dpp|dpc|dohoda|externi|externista|dodavatel|osvc|ico|contractor)/.test(n)) data.kind = "contractor";
      else if (/^(hpp|pp|pracovni pomer|zamestnanec|employee|kmenovy)/.test(n)) data.kind = "employee";
      else {
        const p = parseCell(field, raw);
        if (p.error) errors.push(p.error);
        else data.kind = p.value as string;
      }
      return;
    }
    const p = parseCell(field, raw);
    if (p.error) errors.push(p.error);
    else if (p.value !== undefined) data[key] = String(p.value);
  });
  for (const [key, order] of [["fullNameLastFirst", "lastFirst"], ["fullNameFirstLast", "firstLast"]] as const) {
    const full = data[key];
    delete data[key];
    if (!full || (data.firstName && data.lastName)) continue;
    const sp = splitFullName(full, order);
    if (sp) Object.assign(data, sp);
    else errors.push(`Jméno „${full}“ nelze rozdělit na jméno a příjmení`);
  }
  if (data.departmentCode) {
    if (!data.department) data.department = data.departmentCode;
    delete data.departmentCode;
  }
  if (!errors.some((e) => e.startsWith("Jméno „")))
    for (const f of PEOPLE_IMPORT_FIELDS) if (f.required && !data[f.key]) errors.push(`Chybí ${f.label}`);
  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) errors.push(`E-mail „${data.email}“ není platný`);
  if (data.startDate && data.endDate && data.endDate < data.startDate) errors.push("Datum ukončení je před nástupem");
  return { data, errors };
}

export interface PeopleImportRow {
  row: number;
  name: string;
  action: "create" | "update" | "skip";
  changes: string[];
  errors: string[];
  warnings: string[];
}

export interface PeopleImportDto {
  headers: string[];
  mapping: (string | null)[];
  total: number;
  /** missing = osoby z dřívějšího importu, které v souboru nejsou (při missingAsLeft se označí jako odešlé). */
  counts: { create: number; update: number; skip: number; errors: number; leavers: number; missing: number };
  missingNames: string[];
  rows: PeopleImportRow[];
  committed: boolean;
  /** Sloupce s citlivými údaji, které se nenačetly (doporučení vynechat je z exportu). */
  ignoredSensitive: string[];
}

/* ---------------- automatický import ze souboru (v1.27, ADR-124) ---------------- */

export const ImportSettingsInput = z.object({
  enabled: z.boolean(),
  /** Jen název souboru v adresáři importu (bez cesty). */
  fileName: z
    .string()
    .trim()
    .max(200)
    .regex(/^$|^[\p{L}\p{N}_. -]+\.(csv|xlsx|txt)$/iu, "Jen název souboru .csv / .xlsx / .txt bez cesty"),
  missingAsLeft: z.boolean().default(false),
});
export type ImportSettingsInput = z.input<typeof ImportSettingsInput>;

export interface ImportSettingsDto {
  enabled: boolean;
  fileName: string;
  missingAsLeft: boolean;
  /** Adresář importu na serveru (v kontejneru) a zda je dostupný. */
  dir: string;
  dirAvailable: boolean;
  fileFound: boolean;
  lastRunAt: string | null;
  lastResult: PeopleImportDto["counts"] | null;
  lastError: string | null;
}

/* ---------------- recertifikace přidělených oprávnění (v1.27, ADR-124) ---------------- */

export const CertificationInput = z.object({
  name: z.string().trim().min(1).max(200),
  reviewer: z.enum(CERT_REVIEWERS).default("owner"),
  resourceId: z.string().uuid().nullable().optional().transform((v) => v || null),
  privilegedOnly: z.boolean().default(false),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CertificationInput = z.input<typeof CertificationInput>;

export const CertDecisionInput = z.object({
  decision: z.enum(CERT_DECISIONS),
  comment: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
});

export interface CertificationDto {
  id: string;
  companyId: string;
  name: string;
  reviewer: CertReviewer;
  resourceId: string | null;
  resourceName: string | null;
  privilegedOnly: boolean;
  dueDate: string;
  status: CertStatus;
  total: number;
  decided: number;
  revoked: number;
  /** Položky čekající na rozhodnutí aktuálního uživatele. */
  mine: number;
  overdue: boolean;
  createdAt: string;
  closedAt: string | null;
}

export interface CertItemDto {
  id: string;
  grantId: string;
  personName: string;
  personStatus: PersonStatus;
  department: string | null;
  resourceName: string;
  privileged: boolean;
  since: string;
  validUntil: string | null;
  reviewerName: string | null;
  decision: CertDecision | null;
  comment: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  canDecide: boolean;
}

/** Shrnutí kampaně: stav rozhodnutí. */
export function certProgress(items: { decision: string | null }[]) {
  const decided = items.filter((i) => i.decision).length;
  return { total: items.length, decided, revoked: items.filter((i) => i.decision === "revoke").length, done: items.length > 0 && decided === items.length };
}

/* ---------------- soulad evidence se skutečným stavem v AD / Entra ID (v1.28, ADR-125) ---------------- */

export const RECON_TYPES = ["unapproved", "leaver_in_ad", "unknown_account", "missing", "no_account"] as const;
export type ReconType = (typeof RECON_TYPES)[number];

export const RECON_LABELS: Record<ReconType, string> = {
  unapproved: "Ve skupině bez schválení",
  leaver_in_ad: "Odešlá osoba je stále ve skupině",
  unknown_account: "Účet ve skupině bez osoby v evidenci",
  missing: "Přiděleno, ve skupině chybí",
  no_account: "Přiděleno, osoba nemá účet",
};

/** Název skupiny pro porovnání s členstvím účtu: CN z rozlišujícího jména (DN), jinak celý text. */
export function groupKey(adGroup: string): string {
  const m = adGroup.match(/^\s*CN=((?:\\,|[^,])+)/i);
  return (m ? m[1]!.replace(/\\,/g, ",") : adGroup).trim().toLowerCase();
}

/** Login bez domény (DOMÉNA\\jan, jan@firma.cz → jan). */
export const bareLogin = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/^.*\\/, "").replace(/@.*$/, "");

export interface ReconAccount {
  id: string;
  login: string;
  email: string | null;
  enabled: boolean;
  groups: string[];
}
export interface ReconPerson {
  id: string;
  name: string;
  login: string | null;
  email: string | null;
  status: PersonStatus;
}
export interface ReconItem {
  type: ReconType;
  personId: string | null;
  personName: string | null;
  accountId: string | null;
  login: string | null;
  enabled: boolean | null;
}

/** Párování osoby a účtu: login (bez domény), jinak e-mail. */
export function matchAccounts(people: ReconPerson[], accounts: ReconAccount[]): Map<string, ReconAccount> {
  const byLogin = new Map<string, ReconAccount>();
  const byEmail = new Map<string, ReconAccount>();
  for (const a of accounts) {
    byLogin.set(bareLogin(a.login), a);
    if (a.email) byEmail.set(a.email.toLowerCase(), a);
  }
  const out = new Map<string, ReconAccount>();
  for (const p of people) {
    const a = (p.login && byLogin.get(bareLogin(p.login))) || (p.email && byEmail.get(p.email.toLowerCase())) || null;
    if (a) out.set(p.id, a);
  }
  return out;
}

/** Porovná členy skupiny AD s evidovanými přiděleními jednoho oprávnění. */
export function reconcileGroup(group: string, people: ReconPerson[], accounts: ReconAccount[], grantedPersonIds: Set<string>, match: Map<string, ReconAccount>): ReconItem[] {
  const key = groupKey(group);
  const members = accounts.filter((a) => a.groups.some((g) => groupKey(g) === key));
  const personOf = new Map<string, ReconPerson>();
  for (const p of people) {
    const a = match.get(p.id);
    if (a) personOf.set(a.id, p);
  }
  const out: ReconItem[] = [];
  for (const a of members) {
    const p = personOf.get(a.id);
    const base = { accountId: a.id, login: a.login, enabled: a.enabled };
    if (!p) out.push({ type: "unknown_account", personId: null, personName: null, ...base });
    else if (p.status === "leaver") out.push({ type: "leaver_in_ad", personId: p.id, personName: p.name, ...base });
    else if (!grantedPersonIds.has(p.id)) out.push({ type: "unapproved", personId: p.id, personName: p.name, ...base });
  }
  const memberIds = new Set(members.map((a) => a.id));
  for (const pid of grantedPersonIds) {
    const p = people.find((x) => x.id === pid);
    if (!p) continue;
    const a = match.get(pid);
    if (!a) out.push({ type: "no_account", personId: p.id, personName: p.name, accountId: null, login: p.login, enabled: null });
    else if (!memberIds.has(a.id)) out.push({ type: "missing", personId: p.id, personName: p.name, accountId: a.id, login: a.login, enabled: a.enabled });
  }
  const order = RECON_TYPES as readonly string[];
  return out.sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type) || (x.personName ?? x.login ?? "").localeCompare(y.personName ?? y.login ?? ""));
}

export interface ReconResourceDto {
  resourceId: string;
  resourceName: string;
  group: string;
  privileged: boolean;
  members: number;
  granted: number;
  items: ReconItem[];
}

export interface ReconDto {
  /** Poslední synchronizace zdrojů identit společnosti. */
  sources: { id: string; name: string; kind: string; lastSyncAt: string | null }[];
  resources: ReconResourceDto[];
  /** Oprávnění typu skupina AD bez vyplněné skupiny. */
  withoutGroup: number;
}

export const ReconAdoptInput = z.object({ resourceId: z.string().uuid(), personIds: z.array(z.string().uuid()).min(1).max(1000) });
export const ReconRevokeInput = z.object({ resourceId: z.string().uuid(), personId: z.string().uuid(), justification: z.string().trim().max(2000).optional() });

/* ---------------- nastavení skupin v AD (provisioning, v1.29, ADR-126) ---------------- */

export const PROVISIONING_MODES = ["off", "script", "ldap"] as const;
export type ProvisioningMode = (typeof PROVISIONING_MODES)[number];
export const PROVISIONING_LABELS: Record<ProvisioningMode, string> = {
  off: "Vypnuto – správce nastavuje ručně",
  script: "Jen skript PowerShell – spustí správce, CONTIX ověří synchronizací",
  ldap: "Přímo v AD servisním účtem (s náhledem a potvrzením)",
};

/** Skupiny, do kterých CONTIX nikdy nezapisuje (vedle kontroly SID a adminCount na serveru). */
export const PROVISIONING_FORBIDDEN = [
  "Domain Admins",
  "Enterprise Admins",
  "Schema Admins",
  "Administrators",
  "Account Operators",
  "Server Operators",
  "Print Operators",
  "Backup Operators",
  "Group Policy Creator Owners",
  "DnsAdmins",
  "Key Admins",
  "Enterprise Key Admins",
  "Domain Controllers",
  "Read-only Domain Controllers",
  "Enterprise Read-only Domain Controllers",
  "Cert Publishers",
  "Protected Users",
  "Remote Management Users",
  "Hyper-V Administrators",
  "Distributed COM Users",
  "Incoming Forest Trust Builders",
  "Windows Authorization Access Group",
  "Pre-Windows 2000 Compatible Access",
  "Správci domény",
  "Správci podnikové sítě",
  "Správci schématu",
  "Administrátoři",
] as const;

const dnNorm = (dn: string) => dn.trim().toLowerCase().replace(/\s*,\s*/g, ",").replace(/\s*=\s*/g, "=");

/** Kontrola cílové skupiny před zápisem: DN uvnitř povolené OU, ne zakázaná skupina. Vrací důvod odmítnutí nebo null. */
export function provisioningGroupError(groupDn: string | null, allowedOu: string, extraForbidden: string[] = []): string | null {
  if (!groupDn || !/^\s*CN=/i.test(groupDn)) return "Oprávnění nemá skupinu AD zadanou jako rozlišující jméno (CN=…,OU=…)";
  if (!allowedOu.trim()) return "Není nastavena povolená OU pro zápis";
  const g = dnNorm(groupDn);
  const ou = dnNorm(allowedOu);
  if (!g.endsWith(`,${ou}`)) return "Skupina leží mimo povolenou OU";
  const cn = groupKey(groupDn);
  if ([...PROVISIONING_FORBIDDEN, ...extraForbidden].some((f) => f.trim().toLowerCase() === cn)) return "Do této skupiny CONTIX nezapisuje (privilegovaná skupina)";
  return null;
}

/** Hodnota pro PowerShell v jednoduchých uvozovkách. */
const psq = (s: string) => `'${s.replace(/'/g, "''").replace(/[\r\n]/g, " ")}'`;

/** Skupina, kterou CONTIX v AD vytvoří (v1.33). */
export interface ProvisioningGroupOp {
  resourceId: string;
  name: string;
  groupDn: string;
  ou: string;
  description: string | null;
  error: string | null;
}

export interface ProvisioningOp {
  requestId: string;
  action: AccessAction;
  groupDn: string;
  /** DN účtu, jinak login (sAMAccountName). */
  member: string;
  personName: string;
}

/** Skript PowerShell (modul ActiveDirectory) pro režim „jen skript“ – idempotentní, s kontrolou členství. */
export function provisioningScript(ops: ProvisioningOp[], generatedAt: string, creates: ProvisioningGroupOp[] = []): string {
  const lines = [
    "# CONTIX – změny členství ve skupinách AD podle schválených žádostí o přístup",
    `# Vygenerováno ${generatedAt}. Spusťte účtem s právem měnit členství uvedených skupin.`,
    "# Po další synchronizaci zdroje identit CONTIX žádosti sám označí jako vyřízené.",
    "#Requires -Modules ActiveDirectory",
    "$ErrorActionPreference = 'Stop'",
    "",
  ];
  for (const g of creates) {
    lines.push(`# Vytvořit skupinu ${g.name.replace(/[\r\n]/g, " ")}`);
    lines.push(`if (-not (Get-ADGroup -Filter "Name -eq '${g.name.replace(/'/g, "''")}'" -SearchBase ${psq(g.ou)} -ErrorAction SilentlyContinue)) {`);
    lines.push(`  New-ADGroup -Name ${psq(g.name)} -SamAccountName ${psq(g.name)} -GroupCategory Security -GroupScope Global -Path ${psq(g.ou)}${g.description ? ` -Description ${psq(g.description)}` : ""}`);
    lines.push("}");
  }
  for (const o of ops) {
    lines.push(`# ${o.action === "grant" ? "Přidat" : "Odebrat"}: ${o.personName.replace(/[\r\n]/g, " ")} (žádost ${o.requestId})`);
    if (o.action === "grant") lines.push(`Add-ADGroupMember -Identity ${psq(o.groupDn)} -Members ${psq(o.member)} -Confirm:$false`);
    else lines.push(`Remove-ADGroupMember -Identity ${psq(o.groupDn)} -Members ${psq(o.member)} -Confirm:$false`);
  }
  lines.push("", `Write-Host "Hotovo: ${ops.length + creates.length} změn."`, "");
  return lines.join("\r\n");
}

export const ProvisioningSettingsInput = z.object({
  mode: z.enum(PROVISIONING_MODES),
  /** Zdroj identit AD (adresa serveru, TLS, CA); zapisuje se odděleným účtem níže. */
  sourceId: z.string().uuid().nullable().optional().transform((v) => v || null),
  bindDn: z.string().trim().max(500).default(""),
  /** Heslo zapisovacího účtu; prázdné = beze změny. */
  password: z.string().max(500).optional(),
  allowedOu: z.string().trim().max(500).default(""),
  dailyLimit: z.number().int().min(1).max(1000).default(50),
  extraForbidden: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
});
export type ProvisioningSettingsInput = z.input<typeof ProvisioningSettingsInput>;

export interface ProvisioningSettingsDto {
  mode: ProvisioningMode;
  sourceId: string | null;
  sourceName: string | null;
  bindDn: string;
  hasPassword: boolean;
  allowedOu: string;
  dailyLimit: number;
  extraForbidden: string[];
  usedToday: number;
  /** Zdroje identit AD společnosti (výběr). */
  adSources: { id: string; name: string }[];
}

export interface ProvisioningPlanItem {
  requestId: string;
  personName: string;
  resourceName: string;
  action: AccessAction;
  groupDn: string | null;
  member: string | null;
  error: string | null;
}

export interface ProvisioningResult {
  requestId: string;
  ok: boolean;
  message: string;
}

export const ProvisioningApplyInput = z
  .object({ requestIds: z.array(z.string().uuid()).max(200).default([]), resourceIds: z.array(z.string().uuid()).max(100).default([]) })
  .refine((v) => v.requestIds.length + v.resourceIds.length > 0, { message: "Vyberte alespoň jednu změnu" });

/* ---------------- skupiny z AD a pohodlnější nastavení (v1.33, ADR-130) ---------------- */

/** Nadřazená OU / kontejner z DN (CN=X,OU=A,DC=f → OU=A,DC=f). */
export function parentDn(dn: string): string {
  const m = dn.match(/^\s*(?:\\,|[^,])+,(.*)$/);
  return (m?.[1] ?? "").trim();
}

/** Povolená OU musí být úplné DN s doménou; jinak důvod. */
export function allowedOuError(ou: string): string | null {
  const v = ou.trim();
  if (!v) return "Vyplňte povolenou OU";
  if (!/^(OU|CN)=/i.test(v) || !/(^|,)\s*DC=/i.test(v)) return "Zadejte úplné rozlišující jméno OU včetně domény, např. OU=Skupiny,DC=firma,DC=cz";
  if (/^\s*DC=/i.test(v)) return "Povolená OU nesmí být celá doména";
  return null;
}

/** Zapisovací účet nesmí být vestavěný správce ani správce domény podle názvu. */
export function bindAccountError(bindDn: string): string | null {
  const v = bindDn.trim().toLowerCase();
  if (!v) return "Vyplňte zapisovací účet";
  const name = v.replace(/^cn=/, "").replace(/^.*\\/, "").replace(/[,@].*$/, "");
  if (/^(administrator|administrátor|admin|root)$/.test(name)) return "Vestavěný účet správce nepoužívejte – založte oddělený účet s delegovaným právem jen na členství skupin";
  if (!/@|^cn=|\\/i.test(v)) return "Zadejte účet jako UPN (contix-write@firma.cz), DOMÉNA\\účet nebo DN";
  return null;
}

/** Název nové skupiny (CN i sAMAccountName). */
export function adGroupNameError(name: string): string | null {
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,63}$/u.test(name.trim())) return "Název skupiny: písmena, číslice, mezera, _ . - (max. 64 znaků)";
  return null;
}

export interface AdGroupDto {
  dn: string;
  cn: string;
  ou: string;
  description: string | null;
  privileged: boolean;
  protectedGroup: boolean;
  members: number;
  /** Už je v katalogu oprávnění (id oprávnění). */
  resourceId: string | null;
}

export interface AdGroupsDto {
  sources: { id: string; name: string; lastSyncAt: string | null }[];
  groups: AdGroupDto[];
  /** OU, ve kterých leží skupiny (pro výběr povolené OU a místa nové skupiny). */
  ous: string[];
}

export const ImportAdGroupsInput = z.object({
  dns: z.array(z.string().min(3).max(1000)).min(1).max(500),
  approvalManager: z.boolean().default(true),
  approvalOwner: z.boolean().default(true),
  ownerId: z.string().uuid().nullable().optional().transform((v) => v || null),
  /** Stávající členy rovnou zapsat jako přidělená oprávnění. */
  adopt: z.boolean().default(false),
});
export type ImportAdGroupsInput = z.input<typeof ImportAdGroupsInput>;
