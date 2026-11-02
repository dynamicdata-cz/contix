import { z } from "zod";
import { DEFAULT_CHANGE_CRITERIA } from "./isms";
import { patchOf } from "./zutil";
import { RoleAssignment, type ScopeCompany } from "./companies";
import { HealthPolicySchema } from "./vuln";
import { MODULE_KEYS } from "./modules";
import { RiskPolicySchema } from "./risk";
import { TlsPolicy } from "./certificates";

/** Volitelné kategorie SOC 2 (oddíly rámce soc2). */
export const SOC2_OPTIONAL = ["A1", "C1", "PI1", "P"] as const;
/** Rámce, které si společnost volí navíc k zákonu a vyhlášce podle režimu (ADR-074). */
export const OPTIONAL_FRAMEWORKS = ["iso27001", "dora", "nis2", "soc2", "iso9001", "cis8"] as const;
/** Volitelný rámec: vestavěný nebo vlastní z knihovny („x-…“, ADR-079). */
export type OptionalFramework = (typeof OPTIONAL_FRAMEWORKS)[number] | `x-${string}`;
export const OptionalFrameworkSchema = z.union([z.enum(OPTIONAL_FRAMEWORKS), z.string().regex(/^x-[a-z0-9][a-z0-9-]{1,39}$/) as unknown as z.ZodType<`x-${string}`>]);

/* ============================================================
 * Katalog oprávnění (permissions). Role = pojmenovaná sada oprávnění.
 * Nové moduly (risk, control, audit…) sem přidají svá oprávnění.
 * ============================================================ */

export const PERMISSIONS = {
  "assets:read": "Číst aktiva",
  "assets:write": "Zakládat a upravovat všechna aktiva",
  "assets:write_own": "Upravovat aktiva, jejichž je uživatel vlastníkem",
  "assets:delete": "Mazat aktiva",
  "discovery:run": "Spouštět discovery a importy",
  "audit_log:read": "Číst auditní záznamy",
  "org:read": "Číst organizační strukturu",
  "org:write": "Spravovat organizační strukturu",
  "processes:read": "Číst procesy",
  "processes:write": "Zakládat a upravovat procesy",
  "risks:read": "Číst rizika a katalogy",
  "risks:write": "Spravovat rizika a jejich hodnocení",
  "risks:catalog": "Spravovat katalog hrozeb a zranitelností",
  "controls:read": "Číst opatření a prohlášení o aplikovatelnosti",
  "controls:write": "Spravovat opatření a posuzovat shodu (SoA)",
  "controls:test": "Testovat opatření a spravovat důkazy",
  "bia:read": "Číst analýzy dopadů (BIA)",
  "bia:write": "Zpracovávat analýzy dopadů (BIA) a plány kontinuity",
  "suppliers:read": "Číst evidenci dodavatelů",
  "suppliers:write": "Spravovat dodavatele a smlouvy",
  "documents:approve": "Schvalovat dokumenty ISMS (SoA, zpráva o rizicích, plán zvládání, zpráva o přezkoumání)",
  "isms:read": "Číst evidenci změn a přezkoumání ISMS",
  "isms:write": "Evidovat a posuzovat změny, zpracovávat přezkoumání ISMS",
  "incidents:report": "Nahlásit podezřelou událost nebo neobvyklé chování (§ 14 odst. 1 písm. f)",
  "incidents:read": "Číst kybernetické bezpečnostní události a incidenty",
  "incidents:write": "Evidovat a zvládat události a incidenty, zaznamenávat hlášení",
  "audits:read": "Číst audity kybernetické bezpečnosti a zjištění",
  "audits:write": "Plánovat a evidovat audity, zjištění a nápravná opatření",
  "audits:external": "Externí auditor – jen přidělené audity: požadavky na podklady, sdílené důkazy, připomínky, převzetí",
  "policies:read": "Číst bezpečnostní politiku a dokumentaci (§ 6)",
  "policies:write": "Spravovat bezpečnostní politiku a dokumentaci, verze a přezkumy",
  "awareness:read": "Číst plán rozvoje povědomí, školení a jejich přehledy (§ 10)",
  "awareness:write": "Spravovat školení, termíny a evidenci absolvování",
  "obligations:self": "Vidět své povinnosti – seznámení s dokumenty, školení a úkoly",
  "gdpr:read": "Číst záznamy o činnostech zpracování a DPIA",
  "gdpr:write": "Spravovat záznamy o činnostech zpracování a DPIA",
  "aiact:read": "Číst registr AI systémů, klasifikaci a povinnosti (AI Act)",
  "aiact:write": "Spravovat registr AI systémů, schvalovat použití AI a FRIA",
  "cra:read": "Číst produkty s digitálními prvky, požadavky CRA a hlášení",
  "cra:write": "Spravovat produkty, SBOM, požadavky CRA a hlášení podle čl. 14",
  "trust:read": "Číst bezpečnostní dotazníky zákazníků, knihovnu odpovědí a Trust Center",
  "trust:write": "Odpovídat na dotazníky zákazníků, schvalovat odpovědi, spravovat Trust Center a žádosti o přístup",
  "knowledge:read": "Číst znalostní články (postupy, FAQ, runbooky)",
  "knowledge:write": "Psát a zveřejňovat znalostní články",
  "identity:read": "Číst účty a nálezy z Active Directory / Entra ID",
  "identity:write": "Spouštět kontroly účtů a udělovat výjimky nálezům",
  "legislation:read": "Číst sledované předpisy, změny a posouzení dopadu",
  "legislation:write": "Spravovat sledované předpisy, posuzovat dopad změn a úkoly",
  "actions:read": "Číst přehled akcí a úkolů ze všech oblastí",
  "actions:write": "Zakládat a spravovat úkoly (navázané na libovolný záznam)",
  "soc:read": "Číst frontu bezpečnostních alertů SOC",
  "soc:write": "Triáž alertů SOC – převzetí, poznámky, uzavření, AI poradce",
  "soc:respond": "Schvalovat a provádět zásahy SOC (blokace IP přes Wazuh, ruční zásahy)",
  "soc:share": "Sdílet IOC do MISP (odeslání mimo CONTIX)",
  "ai:use": "Používat AI asistenta – vyžádat návrhy a rozhodovat o nich",
  "api:tokens": "Vytvářet osobní API tokeny pro MCP klienty (čtení dat s vlastními oprávněními)",
  "admin:users": "Spravovat uživatele a skupiny",
  "admin:roles": "Spravovat role a oprávnění",
  "admin:settings": "Spravovat nastavení systému",
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];
export const PermissionSchema = z.enum(PERMISSION_KEYS as [Permission, ...Permission[]]);

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: "Aktiva", permissions: ["assets:read", "assets:write", "assets:write_own", "assets:delete", "discovery:run"] },
  { label: "Organizace a procesy", permissions: ["org:read", "org:write", "processes:read", "processes:write"] },
  { label: "Rizika", permissions: ["risks:read", "risks:write", "risks:catalog"] },
  { label: "Opatření, shoda a kontinuita", permissions: ["controls:read", "controls:write", "controls:test", "controls:test", "bia:read", "bia:write", "suppliers:read", "suppliers:write", "documents:approve"] },
  { label: "Řízení ISMS", permissions: ["isms:read", "isms:write", "incidents:report", "incidents:read", "incidents:write", "audits:read", "audits:write", "audits:external"] },
  { label: "Dokumentace a povědomí", permissions: ["policies:read", "policies:write", "awareness:read", "awareness:write", "obligations:self"] },
  { label: "Audit", permissions: ["audit_log:read"] },
  { label: "Ochrana osobních údajů (GDPR)", permissions: ["gdpr:read", "gdpr:write"] },
  { label: "Umělá inteligence (AI Act)", permissions: ["aiact:read", "aiact:write"] },
  { label: "Dotazníky zákazníků a Trust Center", permissions: ["trust:read", "trust:write"] },
  { label: "Znalostní báze", permissions: ["knowledge:read", "knowledge:write"] },
  { label: "Kybernetická odolnost produktů (CRA)", permissions: ["cra:read", "cra:write"] },
  { label: "Identity a přístupy", permissions: ["identity:read", "identity:write"] },
  { label: "Legislativa", permissions: ["legislation:read", "legislation:write"] },
  { label: "Akce a úkoly", permissions: ["actions:read", "actions:write"] },
  { label: "SOC", permissions: ["soc:read", "soc:write", "soc:respond", "soc:share"] },
  { label: "AI asistent", permissions: ["ai:use", "api:tokens"] },
  { label: "Administrace", permissions: ["admin:users", "admin:roles", "admin:settings"] },
];

/** Systémové role – vytvoří se automaticky, nelze je smazat (oprávnění lze upravit). */
export const SYSTEM_ROLES: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  { key: "admin", name: "Administrátor", description: "Plná správa systému", permissions: [...PERMISSION_KEYS] },
  {
    key: "ciso",
    name: "CISO",
    description: "Odpovědnost za informační a kybernetickou bezpečnost organizace",
    permissions: [
      "assets:read", "assets:write", "assets:delete", "discovery:run", "audit_log:read",
      "org:read", "org:write", "processes:read", "processes:write", "risks:read", "risks:write", "risks:catalog",
      "controls:read", "controls:write", "controls:test", "bia:read", "bia:write", "suppliers:read", "suppliers:write", "documents:approve",
      "isms:read", "isms:write", "incidents:report", "incidents:read", "incidents:write", "audits:read", "audits:write",
      "policies:read", "policies:write", "awareness:read", "awareness:write", "obligations:self", "ai:use", "api:tokens", "gdpr:read", "gdpr:write", "aiact:read", "aiact:write", "cra:read", "cra:write", "trust:read", "trust:write", "knowledge:read", "knowledge:write", "identity:read", "identity:write", "legislation:read", "legislation:write", "actions:read", "actions:write", "soc:read", "soc:write", "soc:respond", "soc:share",
    ],
  },
  {
    key: "security_manager",
    name: "Manažer kybernetické bezpečnosti",
    description: "Řízení ISMS, rizik a bezpečnostních opatření (role dle ZKB)",
    permissions: [
      "assets:read", "assets:write", "discovery:run", "audit_log:read",
      "org:read", "processes:read", "processes:write", "risks:read", "risks:write", "risks:catalog",
      "controls:read", "controls:write", "controls:test", "bia:read", "bia:write", "suppliers:read", "suppliers:write",
      "isms:read", "isms:write", "incidents:report", "incidents:read", "incidents:write", "audits:read", "audits:write",
      "policies:read", "policies:write", "awareness:read", "awareness:write", "obligations:self", "ai:use", "api:tokens", "gdpr:read", "gdpr:write", "aiact:read", "aiact:write", "cra:read", "cra:write", "trust:read", "trust:write", "knowledge:read", "knowledge:write", "identity:read", "identity:write", "legislation:read", "legislation:write", "actions:read", "actions:write", "soc:read", "soc:write", "soc:respond", "soc:share",
    ],
  },
  {
    key: "architect",
    name: "Architekt kybernetické bezpečnosti",
    description: "Návrh a správa bezpečnostní architektury, vazby aktiv",
    permissions: ["assets:read", "assets:write", "discovery:run", "org:read", "processes:read", "processes:write", "risks:read", "risks:write", "controls:read", "controls:write", "controls:test", "bia:read", "suppliers:read", "isms:read", "isms:write", "incidents:report", "incidents:read", "incidents:write", "audits:read", "policies:read", "awareness:read", "obligations:self", "ai:use", "api:tokens", "actions:read", "actions:write", "soc:read", "knowledge:read"],
  },
  {
    key: "soc_l1",
    name: "SOC analytik L1",
    description: "První linie SOC – převzetí a triáž alertů, poznámky, návrh zásahu (bez schvalování)",
    permissions: ["soc:read", "soc:write", "assets:read", "incidents:report", "incidents:read", "obligations:self", "ai:use", "knowledge:read"],
  },
  {
    key: "soc_l2",
    name: "SOC analytik L2 / zvládání incidentů",
    description: "Schvaluje a provádí zásahy SOC, sdílí IOC, vede incidenty a navazující úkoly",
    permissions: ["soc:read", "soc:write", "soc:respond", "soc:share", "assets:read", "incidents:report", "incidents:read", "incidents:write", "risks:read", "identity:read", "actions:read", "actions:write", "obligations:self", "ai:use", "knowledge:read", "knowledge:write"],
  },
  {
    key: "it_admin",
    name: "Správce IT",
    description: "Aktiva, skeny sítě a importy, nálezy účtů z AD, testy opatření",
    permissions: ["assets:read", "assets:write", "discovery:run", "identity:read", "controls:read", "controls:test", "actions:read", "incidents:report", "obligations:self", "knowledge:read"],
  },
  {
    key: "privacy_officer",
    name: "Pověřenec pro ochranu osobních údajů",
    description: "Záznamy o činnostech zpracování a DPIA; čtení procesů, aktiv, dodavatelů, dokumentace a incidentů",
    permissions: ["gdpr:read", "gdpr:write", "aiact:read", "processes:read", "assets:read", "suppliers:read", "policies:read", "incidents:read", "incidents:report", "obligations:self", "knowledge:read"],
  },
  {
    key: "auditor",
    name: "Auditor kybernetické bezpečnosti",
    description: "Nezávislé ověřování – pouze čtení",
    permissions: ["assets:read", "audit_log:read", "org:read", "processes:read", "risks:read", "controls:read", "controls:test", "bia:read", "suppliers:read", "isms:read", "incidents:report", "incidents:read", "audits:read", "audits:write", "policies:read", "awareness:read", "obligations:self", "gdpr:read", "aiact:read", "cra:read", "trust:read", "identity:read", "legislation:read", "actions:read", "soc:read", "knowledge:read"],
  },
  {
    key: "asset_owner",
    name: "Garant / vlastník aktiva",
    description: "Odpovídá za svěřená aktiva, upravuje jen ta svá",
    permissions: ["assets:read", "assets:write_own", "org:read", "processes:read", "risks:read", "controls:read", "bia:read", "suppliers:read", "isms:read", "audits:read", "incidents:report", "policies:read", "obligations:self", "actions:read"],
  },
  { key: "external_auditor", name: "Externí auditor", description: "Auditor mimo organizaci – vidí jen audity, ke kterým je přidělen (požadavky na podklady a sdílené důkazy)", permissions: ["audits:external"] },
  { key: "employee", name: "Zaměstnanec", description: "Běžný uživatel – platné dokumenty, seznámení, školení, hlášení událostí", permissions: ["obligations:self", "incidents:report"] },
  { key: "viewer", name: "Čtenář", description: "Pouze čtení", permissions: ["assets:read", "org:read", "processes:read", "risks:read", "controls:read", "bia:read", "suppliers:read", "isms:read", "audits:read", "incidents:report", "policies:read", "obligations:self", "actions:read"] },
];

/** Oprávnění přidaná v jednotlivých verzích – při aktualizaci se doplní systémovým rolím (dle jejich výchozí sady). */
export const PERMISSION_UPGRADES: { version: string; permissions: Permission[] }[] = [
  { version: "0.5", permissions: ["org:read", "org:write", "processes:read", "processes:write", "risks:read", "risks:write", "risks:catalog"] },
  { version: "0.6", permissions: ["controls:read", "controls:write", "bia:read", "bia:write"] },
  { version: "0.7", permissions: ["suppliers:read", "suppliers:write", "documents:approve"] },
  { version: "0.8", permissions: ["isms:read", "isms:write"] },
  { version: "0.9", permissions: ["incidents:report", "incidents:read", "incidents:write", "audits:read", "audits:write"] },
  { version: "0.11", permissions: ["policies:read", "policies:write", "awareness:read", "awareness:write", "obligations:self"] },
  { version: "0.14", permissions: ["ai:use"] },
  { version: "0.15", permissions: ["controls:test"] },
  { version: "0.19", permissions: ["gdpr:read", "gdpr:write"] },
  { version: "0.20", permissions: ["api:tokens"] },
  { version: "0.28", permissions: ["identity:read", "identity:write"] },
  { version: "0.34", permissions: ["legislation:read", "legislation:write"] },
  { version: "0.48", permissions: ["actions:read", "actions:write"] },
  { version: "0.51", permissions: ["soc:read", "soc:write"] },
  { version: "0.60", permissions: ["soc:respond"] },
  { version: "0.76", permissions: ["audits:external"] },
  { version: "0.78", permissions: ["soc:share"] },
  { version: "0.95", permissions: ["aiact:read", "aiact:write"] },
  { version: "0.97", permissions: ["cra:read", "cra:write"] },
  { version: "1.04", permissions: ["trust:read", "trust:write"] },
  { version: "1.07", permissions: ["knowledge:read", "knowledge:write"] },
];

/* ============================================================
 * Schémata API
 * ============================================================ */

export const PASSWORD_MIN = 12;

export const LoginInput = z.object({
  /** E-mail; u přihlášení účtem AD i uživatelské jméno (jan.novak, DOMÉNA\\jan.novak, UPN). */
  email: z.string().trim().toLowerCase().min(1).max(320),
  password: z.string().min(1).max(200),
});

export const MfaCodeInput = z.object({ code: z.string().trim().min(6).max(20) });

export const ChangePasswordInput = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(PASSWORD_MIN, `Heslo musí mít alespoň ${PASSWORD_MIN} znaků`).max(200),
});

export const UserCreate = z.object({
  email: z.string().trim().toLowerCase().email(),
  displayName: z.string().trim().min(1).max(200),
  jobTitle: z.string().trim().max(200).optional().nullable(),
  authProvider: z.enum(["local", "oidc", "ad"]).default("local"),
  /** U lokálního účtu: dočasné heslo (uživatel si ho musí změnit). */
  password: z.string().min(PASSWORD_MIN).max(200).optional(),
  /** Role pro celou skupinu (přiřazené kořenové společnosti). */
  roleIds: z.array(z.string().uuid()).default([]),
  /** Role přiřazené konkrétním společnostem (platí i pro jejich dceřiné společnosti). */
  roleAssignments: z.array(RoleAssignment).optional(),
  groupIds: z.array(z.string().uuid()).default([]),
  /** Domovská společnost uživatele (holding nebo společnost skupiny). */
  companyId: z.string().uuid().optional(),
});
export type UserCreate = z.input<typeof UserCreate>;

export const UserUpdate = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  jobTitle: z.string().trim().max(200).optional().nullable(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  roleAssignments: z.array(RoleAssignment).optional(),
  groupIds: z.array(z.string().uuid()).optional(),
  companyId: z.string().uuid().optional(),
  /** Převod na firemní účet (AD / SSO) odebere heslo CONTIXu; zpět na lokální = pak reset hesla. */
  authProvider: z.enum(["local", "oidc", "ad"]).optional(),
});
export type UserUpdate = z.input<typeof UserUpdate>;

export const RoleInput = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,49}$/, "Klíč: malá písmena, číslice a podtržítko"),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  permissions: z.array(PermissionSchema).default([]),
  /** ID/názvy skupin z Entra ID / AD, jejichž členové roli dostanou automaticky. */
  externalGroups: z.array(z.string().trim().min(1)).default([]),
});
export type RoleInput = z.input<typeof RoleInput>;
export const RolePatch = patchOf(RoleInput.omit({ key: true }));

export const GroupInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  roleIds: z.array(z.string().uuid()).default([]),
  roleAssignments: z.array(RoleAssignment).optional(),
  memberIds: z.array(z.string().uuid()).default([]),
});
export type GroupInput = z.input<typeof GroupInput>;
export const GroupPatch = patchOf(GroupInput);

export const SettingsSchema = z.object({
  organizationName: z.string().trim().max(200).default("Moje organizace"),
  /** Výchozí jazyk ovládání, nápovědy, výstupů a e-mailů (uživatel si může zvolit vlastní). */
  defaultLocale: z.string().regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/).default("cs"),
  /** Identifikace povinné osoby – pro dokumenty a oznámení významným dodavatelům (§ 9 odst. 3 vyhl. 409/2025). */
  organizationIco: z.string().trim().max(20).default(""),
  organizationAddress: z.string().trim().max(500).default(""),
  /** Regulované služby (název/y) a režim povinností dle zákona č. 264/2025 Sb. */
  regulatedServices: z.string().trim().max(2000).default(""),
  regime: z.enum(["higher", "lower", "none"]).default("higher"),
  /** Regulatorní balíček a hlavní rámec (ADR-080) – u kořenové společnosti ukládá do `companies`. */
  pack: z.enum(["cz", "sk", "pl", "de", "at", "generic"]).default("cz"),
  primaryFramework: z
    .string()
    .regex(/^([a-z0-9]{2,12}|x-[a-z0-9][a-z0-9-]{1,39})$/)
    .nullable()
    .default(null),
  /** Finanční subjekt podle DORA (ADR-084) – u kořenové společnosti ukládá do `companies`. */
  doraEntity: z.boolean().default(false),
  /** Pravidla kontroly certifikátů a TLS (ADR-070). */
  tlsPolicy: TlsPolicy.prefault({}),
  /** Kontaktní osoba pro hlášení incidentů (ADR-067). */
  incidentContact: z
    .object({ name: z.string().trim().max(200).default(""), role: z.string().trim().max(200).default(""), phone: z.string().trim().max(50).default(""), email: z.string().trim().max(200).default("") })
    .prefault({}),
  /** Únosná míra újmy pro posouzení významnosti dopadu incidentu (§ 14 odst. 1 písm. a vyhl. 410/2025). */
  incidentTolerance: z.string().trim().max(3000).default(""),
  /** Poskytovatel služeb vytvářejících důvěru – oznámení incidentu do 24 h (§ 16 odst. 3 písm. a zákona). */
  trustServiceProvider: z.boolean().default(false),
  /** Volitelné kategorie SOC 2 v rozsahu zprávy (bezpečnost CC je vždy). Kritéria mimo rozsah = neaplikovatelná. */
  soc2Scope: z.array(z.enum(SOC2_OPTIONAL)).default([]),
  /** Další sledované rámce (ISO 27001, DORA…); null = automaticky ty, které mají nějaké posouzení. Zákon a vyhláška podle režimu jsou vždy. */
  frameworks: z.array(OptionalFrameworkSchema).max(20).nullable().default(null),
  /** Implementační skupina CIS Controls (1 = IG1 … 3 = IG3); dílčí opatření vyšších skupin jsou neaplikovatelná. */
  cisIg: z.number().int().min(1).max(3).default(1),
  /** Kritéria pro určení významných změn (§ 11 odst. 1 písm. a vyhl. 409/2025) – stanoví povinná osoba. */
  changeCriteria: z.array(z.string().trim().min(1).max(500)).max(50).default(DEFAULT_CHANGE_CRITERIA),
  sessionTimeoutMinutes: z.number().int().min(5).max(24 * 60).default(60),
  sessionMaxHours: z.number().int().min(1).max(24 * 14).default(12),
  mfaRequired: z.boolean().default(false),
  maxFailedLogins: z.number().int().min(3).max(50).default(5),
  lockoutMinutes: z.number().int().min(1).max(24 * 60).default(15),
  /** Založit uživatele automaticky při prvním přihlášení přes Entra ID / OIDC. */
  oidcAutoProvision: z.boolean().default(false),
  oidcDefaultRoleKey: z.string().default("viewer"),
  /**
   * Povolené e-mailové domény SSO (např. firma.cz). Prázdné = Entra ID / firemní OIDC bez omezení;
   * Google bez domén nesmí zakládat ani propojovat účty (přihlásit by se mohl kdokoli s Google účtem).
   */
  oidcAllowedDomains: z
    .array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Zadejte doménu, např. firma.cz"))
    .max(20)
    .default([]),
  /** Pravidla semaforu zranitelností a zastaralosti. */
  healthPolicy: HealthPolicySchema.prefault({}),
  /** Zapnuté moduly (Administrace → Moduly). */
  enabledModules: z.array(z.string()).default([...MODULE_KEYS]),
  /** Zdroj textu předpisů ze Sbírky (v1.13.2): auto = otevřená data, při výpadku web e-Sbírky; api vyžaduje klíč. */
  legalTextSource: z.enum(["auto", "opendata", "web", "api"]).default("auto"),
  /** Metodika hodnocení rizik. */
  riskPolicy: RiskPolicySchema.prefault({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
/** PATCH bez výchozích hodnot – jinak by částečná změna vrátila ostatní nastavení na výchozí. */
export const SettingsPatch = patchOf(SettingsSchema);

/* ============================================================
 * DTO
 * ============================================================ */

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  externalGroups: string[];
  isSystem: boolean;
  userCount?: number;
}

export interface GroupDto {
  id: string;
  name: string;
  description: string | null;
  roleIds: string[];
  roleAssignments: RoleAssignment[];
  memberIds: string[];
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  authProvider: "local" | "oidc" | "ad";
  isActive: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  /** Zvolený jazyk ovládání (null = výchozí jazyk organizace). */
  locale: string | null;
  roles: { id: string; key: string; name: string; source: "manual" | "idp"; companyId: string; companyName: string }[];
  groupIds: string[];
  companyId: string;
  companyName: string;
}

export interface MeDto {
  user: UserDto;
  permissions: Permission[];
  /** Přihlášení dokončeno, ale je potřeba druhý faktor. */
  mfaPending: boolean;
  /** Organizace vyžaduje MFA a uživatel ho ještě nemá nastavené. */
  mfaSetupRequired: boolean;
  mustChangePassword: boolean;
  organizationName: string;
  enabledModules: string[];
  /** Společnosti, ke kterým má uživatel přístup (strom). */
  companies: ScopeCompany[];
  /** Aktivní společnost; null = souhrnný pohled za skupinu. */
  activeCompanyId: string | null;
  homeCompanyId: string;
  /** Uživatel smí zvolit souhrnný pohled za skupinu (má roli na úrovni kořene). */
  canGroupView: boolean;
  /** Jazyk, ve kterém se má aplikace zobrazit (uživatel → organizace). */
  locale: string;
}

export interface AuthProviderInfo {
  id: string;
  label: string;
}

export interface AuditLogDto {
  id: string;
  at: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
}
