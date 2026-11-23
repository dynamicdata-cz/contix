import { z } from "zod";
import { osSupport, type SupportStatus } from "./vuln";

/* ============================================================
 * Identity a přístupy (v0.28): kontroly účtů v Active Directory a Microsoft Entra ID.
 * Konektory jen čtou (LDAPS / Microsoft Graph), nic v adresáři nemění.
 * Pravidla nálezů jsou čistá funkce `evaluateAccount` – sdílí ji API, testy i nápověda.
 * ============================================================ */

export const IDENTITY_SOURCE_KINDS = ["ad", "entra"] as const;
export type IdentitySourceKind = (typeof IDENTITY_SOURCE_KINDS)[number];

export const IDENTITY_ACCOUNT_KINDS = ["user", "service", "guest"] as const;
export type IdentityAccountKind = (typeof IDENTITY_ACCOUNT_KINDS)[number];

export const IDENTITY_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type IdentitySeverity = (typeof IDENTITY_SEVERITIES)[number];

export const IDENTITY_FINDING_STATUSES = ["open", "accepted", "resolved"] as const;
export type IdentityFindingStatus = (typeof IDENTITY_FINDING_STATUSES)[number];

export const IDENTITY_RULES = [
  "stale",
  "never_logged_in",
  "leaver",
  "pwd_never_expires",
  "pwd_not_required",
  "preauth_disabled",
  "kerberoastable",
  "unconstrained_delegation",
  "privileged_pwd_old",
  "no_mfa",
  "privileged_group_size",
  // v1.90 (ADR-185): počítače a servery z AD
  "computer_stale",
  "computer_eol",
  "computer_delegation",
  "computer_no_laps",
  "laps_not_deployed",
  "computer_default_container",
  "server_unmonitored",
] as const;
export type IdentityRule = (typeof IDENTITY_RULES)[number];

export const IDENTITY_LABELS = {
  sourceKind: { ad: "Active Directory", entra: "Microsoft Entra ID" } satisfies Record<IdentitySourceKind, string>,
  accountKind: { user: "Uživatel", service: "Servisní účet", guest: "Host" } satisfies Record<IdentityAccountKind, string>,
  severity: { critical: "Kritická", high: "Vysoká", medium: "Střední", low: "Nízká" } satisfies Record<IdentitySeverity, string>,
  status: { open: "Otevřený", accepted: "Výjimka", resolved: "Vyřešený" } satisfies Record<IdentityFindingStatus, string>,
} as const;

/** Popis pravidla: název, proč na něm záleží a co s nálezem udělat. */
export const IDENTITY_RULE_INFO: Record<IdentityRule, { title: string; why: string; fix: string; sources: IdentitySourceKind[] }> = {
  stale: {
    title: "Neaktivní účet",
    why: "Povolený účet, který se dlouho nepřihlásil, nikdo nesleduje – po odchodu zaměstnance nebo u zapomenutého testovacího účtu je snadným cílem útoku.",
    fix: "Ověřte s vedoucím nebo vlastníkem systému, zda je účet potřeba; jinak ho zakažte a po čase odstraňte.",
    sources: ["ad", "entra"],
  },
  never_logged_in: {
    title: "Účet se nikdy nepřihlásil",
    why: "Účet založený do zásoby nebo pro člověka, který nenastoupil, často zůstane s počátečním heslem.",
    fix: "Zakažte účet, dokud ho držitel skutečně nepotřebuje; u servisních účtů doplňte vlastníka a účel.",
    sources: ["ad", "entra"],
  },
  leaver: {
    title: "Účet odešlého uživatele",
    why: "Uživatel je v CONTIXu deaktivovaný (odchod, změna role), ale jeho účet v adresáři je stále povolený.",
    fix: "Zakažte účet v adresáři podle postupu pro ukončení pracovního poměru a zkontrolujte jeho přístupy.",
    sources: ["ad", "entra"],
  },
  pwd_never_expires: {
    title: "Heslo bez expirace",
    why: "Heslo, které nikdy nevyprší, se v praxi nemění roky; u privilegovaných a servisních účtů je to častý vstupní bod.",
    fix: "Zapněte expiraci nebo převeďte servisní účet na gMSA (spravovaný účet s automatickou změnou hesla).",
    sources: ["ad", "entra"],
  },
  pwd_not_required: {
    title: "Účet nevyžaduje heslo",
    why: "Příznak PASSWD_NOTREQD dovoluje prázdné heslo – účet může být přístupný bez znalosti hesla.",
    fix: "Odstraňte příznak (userAccountControl) a nastavte účtu silné heslo.",
    sources: ["ad"],
  },
  preauth_disabled: {
    title: "Vypnutá předautentizace Kerberos",
    why: "Útočník může bez přihlášení získat zašifrovanou odpověď a heslo prolomit offline (AS-REP roasting).",
    fix: "Zapněte předautentizaci Kerberos (zrušte „Do not require Kerberos preauthentication“).",
    sources: ["ad"],
  },
  kerberoastable: {
    title: "Uživatelský účet se SPN",
    why: "Na účet se servicePrincipalName si může kterýkoli doménový uživatel vyžádat lístek a heslo prolomit offline (Kerberoasting).",
    fix: "Použijte gMSA, nebo účtu nastavte dlouhé náhodné heslo (25+ znaků) a odeberte mu zbytná oprávnění.",
    sources: ["ad"],
  },
  unconstrained_delegation: {
    title: "Neomezená delegace",
    why: "Účet s neomezenou delegací (TRUSTED_FOR_DELEGATION) může vystupovat jménem kohokoli, kdo se k němu přihlásí – včetně správců.",
    fix: "Nahraďte omezenou delegací (constrained / resource-based) nebo delegaci zrušte.",
    sources: ["ad"],
  },
  privileged_pwd_old: {
    title: "Staré heslo privilegovaného účtu",
    why: "Heslo privilegovaného účtu se dlouho neměnilo – roste riziko, že uniklo.",
    fix: "Změňte heslo a ověřte, zda účet potřebuje trvalé členství v privilegované skupině.",
    sources: ["ad", "entra"],
  },
  no_mfa: {
    title: "Bez vícefaktorového ověření",
    why: "Účet nemá registrovanou žádnou metodu MFA – k převzetí stačí heslo (phishing, únik hesla).",
    fix: "Vynuťte registraci MFA (podmíněný přístup / bezpečnostní výchozí nastavení), u správců phishing-odolné metody.",
    sources: ["entra"],
  },
  privileged_group_size: {
    title: "Příliš mnoho privilegovaných účtů",
    why: "Čím více účtů má nejvyšší oprávnění, tím větší je plocha útoku a tím hůř se přístupy kontrolují.",
    fix: "Omezte členy na nezbytné minimum; pro běžnou práci používejte oddělené neprivilegované účty.",
    sources: ["ad", "entra"],
  },
  computer_stale: {
    title: "Neaktivní počítač",
    why: "Povolený účet počítače, který se dlouho nepřihlásil do domény, patří nejčastěji vyřazenému nebo zapomenutému stroji – nikdo ho neaktualizuje ani nesleduje a jeho účet lze zneužít.",
    fix: "Ověřte, zda počítač ještě existuje; vyřazený zakažte, přesuňte do OU vyřazených a po čase odstraňte. Aktivum v CONTIXu převeďte do stavu vyřazeno.",
    sources: ["ad"],
  },
  computer_eol: {
    title: "Systém bez podpory výrobce",
    why: "Operační systém už nedostává bezpečnostní aktualizace – známé zranitelnosti zůstanou neopravené (vyhláška 409, § 24).",
    fix: "Naplánujte upgrade nebo náhradu; do té doby počítač oddělte v síti a zapište výjimku s termínem a kompenzačními opatřeními.",
    sources: ["ad"],
  },
  computer_delegation: {
    title: "Počítač s neomezenou delegací",
    why: "Server s neomezenou delegací Kerberos uchovává lístky přihlášených uživatelů – po jeho kompromitaci se útočník může vydávat za kohokoli včetně správců domény.",
    fix: "Nahraďte neomezenou delegaci omezenou (na konkrétní služby) nebo ji zrušte; citlivé účty označte „Account is sensitive and cannot be delegated“.",
    sources: ["ad"],
  },
  computer_no_laps: {
    title: "Počítač bez LAPS",
    why: "Bez LAPS mívají počítače stejné heslo místního správce – jeden prolomený stroj otevře cestu k dalším (laterální pohyb).",
    fix: "Zahrňte počítač do politiky LAPS (Windows LAPS nebo Microsoft LAPS) a ověřte, že heslo rotuje.",
    sources: ["ad"],
  },
  laps_not_deployed: {
    title: "LAPS není nasazen",
    why: "V doméně není žádný počítač se spravovaným heslem místního správce – hesla místních správců jsou nejspíš stejná nebo se nemění.",
    fix: "Nasaďte Windows LAPS (součást Windows od dubna 2023) politikou skupiny a ověřte rotaci hesel.",
    sources: ["ad"],
  },
  computer_default_container: {
    title: "Počítač ve výchozím kontejneru Computers",
    why: "Na kontejner CN=Computers nelze navázat politiku skupiny (GPO) – počítač nedostává bezpečnostní nastavení organizace.",
    fix: "Přesuňte počítač do příslušné organizační jednotky (OU) a výchozí umístění nových počítačů změňte příkazem redircmp.",
    sources: ["ad"],
  },
  server_unmonitored: {
    title: "Server bez sběru dat",
    why: "Server je v doméně aktivní, ale CONTIX o něm nemá data z agenta, sběrače ani Wazuhu – jeho zranitelnosti, nastavení a události nikdo nesleduje.",
    fix: "Nainstalujte agenta CONTIX nebo Wazuh, případně ho spárujte s aktivem v CONTIXu; vyřazený server zakažte v AD.",
    sources: ["ad"],
  },
};

const SEV_RANK: Record<IdentitySeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
export const identitySeverityRank = (s: IdentitySeverity) => SEV_RANK[s];

/* ---------- nastavení zdroje ---------- */

export const IdentityPolicySchema = z.object({
  /** Po kolika dnech bez přihlášení je účet neaktivní. */
  staleDays: z.number().int().min(14).max(1000).default(90),
  /** Hosté (Entra) – kratší lhůta. */
  guestStaleDays: z.number().int().min(14).max(1000).default(90),
  /** Účet bez přihlášení starší než N dní = „nikdy se nepřihlásil“. */
  neverLoggedDays: z.number().int().min(1).max(365).default(30),
  /** Maximální stáří hesla privilegovaného účtu. */
  privilegedPwdDays: z.number().int().min(30).max(3650).default(365),
  /** Maximální počet členů privilegované skupiny / role. */
  maxPrivilegedMembers: z.number().int().min(1).max(100).default(5),
  /** Po kolika dnech bez přihlášení do domény je počítač neaktivní (v1.90). */
  computerStaleDays: z.number().int().min(14).max(1000).default(90),
});
export type IdentityPolicy = z.infer<typeof IdentityPolicySchema>;
export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = IdentityPolicySchema.parse({});

const name = z.string().trim().min(1).max(200);
const groupList = z.array(z.string().trim().min(1).max(300)).max(50);

export const AdSourceConfig = z.object({
  /** ldaps://dc01.firma.local:636 (ldap:// jen pro test). */
  url: z.string().trim().regex(/^ldaps?:\/\/[^\s/]+(:\d+)?\/?$/, "Zadejte adresu ve tvaru ldaps://server:636"),
  baseDn: z.string().trim().min(3).max(500),
  /** Účet pro čtení: DN nebo UPN (contix-read@firma.local). */
  bindDn: z.string().trim().min(1).max(500),
  verifyTls: z.boolean().default(true),
  /** Kořenový certifikát interní CA (PEM), pokud jí server nedůvěřuje. */
  caCert: z.string().trim().max(20_000).default(""),
  /** Další privilegované skupiny (název CN) k výchozím (Domain Admins, Enterprise Admins…). */
  extraPrivilegedGroups: groupList.default([]),
  /** Načítat i počítače a servery (v1.90, ADR-185). */
  computers: z.boolean().default(true),
});
export type AdSourceConfig = z.infer<typeof AdSourceConfig>;

export const EntraSourceConfig = z.object({
  tenantId: z.string().trim().min(3).max(100),
  clientId: z.string().trim().min(3).max(100),
  /** Další privilegované role (název) k výchozím (Global Administrator…). */
  extraPrivilegedRoles: groupList.default([]),
  /** Skupiny Entra ID, jejichž členství se načítá (pro toxické kombinace, přezkumy a synchronizaci uživatelů; GroupMember.Read.All). */
  trackedGroups: groupList.default([]),
});
export type EntraSourceConfig = z.infer<typeof EntraSourceConfig>;

/** Synchronizace uživatelů a organizační struktury z adresáře (v0.30). */
export const ProvisioningConfig = z.object({
  enabled: z.boolean().default(false),
  /** Jen členové této skupiny / role budou uživateli CONTIXu (povinné při zapnutí). */
  group: z.string().trim().max(300).default(""),
  /** Výchozí role nově založených uživatelů (klíč role). */
  defaultRoleKey: z.string().trim().min(1).max(50).default("employee"),
  /** Útvary podle atributu department. */
  units: z.boolean().default(true),
  /** Funkční místa podle atributu title (pracovní pozice) v útvaru. */
  positions: z.boolean().default(true),
  /** Deaktivovat uživatele CONTIXu, jejichž účet je zakázaný, odstraněný nebo mimo skupinu. */
  deactivate: z.boolean().default(true),
});
export type ProvisioningConfig = z.infer<typeof ProvisioningConfig>;
export const DEFAULT_PROVISIONING: ProvisioningConfig = ProvisioningConfig.parse({});

const sourceBase = {
  name,
  enabled: z.boolean().default(true),
  companyId: z.string().uuid().optional(),
  /** Interval automatické synchronizace v hodinách (0 = jen ručně). */
  syncHours: z.number().int().min(0).max(168).default(24),
  policy: IdentityPolicySchema.default(DEFAULT_IDENTITY_POLICY),
  provisioning: ProvisioningConfig.default(DEFAULT_PROVISIONING),
  /** Heslo účtu (AD) nebo tajný klíč aplikace (Entra); prázdné = ponechat uložené. */
  secret: z.string().max(1000).optional(),
};

export const IdentitySourceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ad"), ...sourceBase, config: AdSourceConfig }),
  z.object({ kind: z.literal("entra"), ...sourceBase, config: EntraSourceConfig }),
]);
export type IdentitySourceInput = z.input<typeof IdentitySourceInput>;

/** Test připojení: hodnoty z formuláře; u uloženého zdroje lze vynechat tajemství. */
export const IdentitySourceTestInput = z.intersection(IdentitySourceInput, z.object({ id: z.string().uuid().optional() }));

export interface IdentitySourceStats {
  accounts: number;
  enabled: number;
  privileged: number;
  /** Počítače z AD (v1.90): povolené, z toho servery. */
  computers?: number;
  servers?: number;
  findings: Record<IdentitySeverity, number>;
}

export interface IdentitySourceDto {
  id: string;
  companyId: string;
  kind: IdentitySourceKind;
  name: string;
  enabled: boolean;
  syncHours: number;
  policy: IdentityPolicy;
  provisioning: ProvisioningConfig;
  config: AdSourceConfig | EntraSourceConfig;
  hasSecret: boolean;
  lastSyncAt: string | null;
  lastStatus: "ok" | "error" | "running" | null;
  lastError: string | null;
  /** Upozornění z poslední synchronizace (např. chybějící licence pro poslední přihlášení). */
  notes: string[];
  stats: IdentitySourceStats | null;
}

export interface IdentityTestResult {
  ok: boolean;
  message: string;
  notes?: string[];
}

export const AcceptIdentityFindingInput = z.object({
  reason: z.string().trim().min(5).max(2000),
  /** Do kdy výjimka platí (max. 2 roky); po uplynutí se nález znovu otevře. */
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type AcceptIdentityFindingInput = z.infer<typeof AcceptIdentityFindingInput>;

export interface IdentityFindingDto {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceKind: IdentitySourceKind;
  rule: IdentityRule;
  severity: IdentitySeverity;
  subject: string;
  detail: string;
  status: IdentityFindingStatus;
  account: { id: string; login: string; displayName: string; kind: IdentityAccountKind; privileged: boolean } | null;
  /** Počítač z AD, kterého se nález týká (v1.90). */
  computer: { id: string; name: string; role: ComputerRole; assetId: string | null } | null;
  acceptedByName: string | null;
  acceptedReason: string | null;
  acceptedUntil: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface IdentityAccountDto {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceKind: IdentitySourceKind;
  login: string;
  displayName: string;
  email: string | null;
  kind: IdentityAccountKind;
  enabled: boolean;
  privileged: boolean;
  privilegedVia: string[];
  lastLogonAt: string | null;
  pwdLastSetAt: string | null;
  createdAt: string | null;
  mfa: boolean | null;
  department: string | null;
  title: string | null;
  contixUser: { id: string; name: string; active: boolean } | null;
  openFindings: number;
  maxSeverity: IdentitySeverity | null;
  removedAt: string | null;
}

export interface IdentityAccountDetail extends IdentityAccountDto {
  dn: string | null;
  groups: string[];
  flags: AccountFlags;
  findings: IdentityFindingDto[];
}

export interface IdentityOverviewDto {
  sources: IdentitySourceDto[];
  open: Record<IdentitySeverity, number>;
  accepted: number;
  byRule: { rule: IdentityRule; open: number; severity: IdentitySeverity }[];
  privileged: number;
  accounts: number;
  /** Trend otevřených nálezů (posledních 12 synchronizací za všechny zdroje v rozsahu, po dnech). */
  trend: { day: string; critical: number; high: number; medium: number; low: number }[];
  /** Počty objektů adresáře – aktivní / neaktivní (v1.91). */
  inventory: IdentityInventory;
}

/* ---------- normalizovaný účet z konektoru ---------- */

export interface AccountFlags {
  pwdNeverExpires: boolean;
  pwdNotRequired: boolean;
  preauthDisabled: boolean;
  hasSpn: boolean;
  unconstrainedDelegation: boolean;
}

/** Skupina z AD (v1.33, ADR-130) – pro katalog oprávnění a výběr OU. */
export interface DirGroup {
  dn: string;
  cn: string;
  description: string | null;
  /** Privilegovaná podle SID / názvu. */
  privileged: boolean;
  /** Chráněná AdminSDHolder (adminCount=1). */
  protectedGroup: boolean;
  /** Počet přímých členů – uživatelů v načtené bázi. */
  members: number;
}

export interface DirAccount {
  externalId: string;
  login: string;
  displayName: string;
  email: string | null;
  kind: IdentityAccountKind;
  enabled: boolean;
  dn: string | null;
  createdAt: Date | null;
  lastLogonAt: Date | null;
  pwdLastSetAt: Date | null;
  /** Je údaj o posledním přihlášení k dispozici (Entra bez licence P1 ne). */
  signInKnown: boolean;
  flags: AccountFlags;
  /** null = neznámé (AD, nebo Entra bez oprávnění k přehledu registrací). */
  mfa: boolean | null;
  /** Privilegované skupiny / role, přes které má účet oprávnění (včetně vnořených skupin). */
  privilegedVia: string[];
  groups: string[];
  department: string | null;
  title: string | null;
}

export interface FindingDraft {
  rule: IdentityRule;
  severity: IdentitySeverity;
  detail: string;
}

const DAY = 86_400_000;
const days = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / DAY);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Nálezy jednoho účtu. Zakázané účty se nehodnotí (kromě nic – zakázaný účet je v pořádku).
 * `contixInactive` = účet je spárovaný s deaktivovaným uživatelem CONTIXu.
 */
export function evaluateAccount(a: DirAccount, policy: IdentityPolicy, now: Date, ctx: { contixInactive?: boolean } = {}): FindingDraft[] {
  if (!a.enabled) return [];
  const out: FindingDraft[] = [];
  const priv = a.privilegedVia.length > 0;
  const via = priv ? ` (privilegovaný: ${a.privilegedVia.slice(0, 3).join(", ")}${a.privilegedVia.length > 3 ? "…" : ""})` : "";
  const up = (base: IdentitySeverity, privileged: IdentitySeverity): IdentitySeverity => (priv ? privileged : base);

  if (ctx.contixInactive) out.push({ rule: "leaver", severity: up("high", "critical"), detail: `Uživatel je v CONTIXu deaktivovaný, účet je povolený${via}.` });

  if (a.signInKnown) {
    const limit = a.kind === "guest" ? policy.guestStaleDays : policy.staleDays;
    if (a.lastLogonAt) {
      const d = days(a.lastLogonAt, now);
      if (d > limit) out.push({ rule: "stale", severity: up("medium", "critical"), detail: `Poslední přihlášení ${fmt(a.lastLogonAt)} (před ${d} dny, limit ${limit})${via}.` });
    } else if (a.createdAt && days(a.createdAt, now) > policy.neverLoggedDays) {
      out.push({ rule: "never_logged_in", severity: up("low", "high"), detail: `Založen ${fmt(a.createdAt)}, dosud bez přihlášení${via}.` });
    }
  }
  if (a.flags.pwdNotRequired) out.push({ rule: "pwd_not_required", severity: up("high", "critical"), detail: `Příznak PASSWD_NOTREQD${via}.` });
  if (a.flags.preauthDisabled) out.push({ rule: "preauth_disabled", severity: up("high", "critical"), detail: `Příznak DONT_REQ_PREAUTH${via}.` });
  if (a.flags.hasSpn && a.kind !== "guest") out.push({ rule: "kerberoastable", severity: up("medium", "critical"), detail: `Účet má servicePrincipalName${via}.` });
  if (a.flags.unconstrainedDelegation) out.push({ rule: "unconstrained_delegation", severity: "high", detail: `Příznak TRUSTED_FOR_DELEGATION${via}.` });
  if (a.flags.pwdNeverExpires)
    out.push({ rule: "pwd_never_expires", severity: priv ? "high" : a.kind === "service" ? "medium" : "low", detail: `Heslo nikdy nevyprší${a.pwdLastSetAt ? `, naposledy změněno ${fmt(a.pwdLastSetAt)}` : ""}${via}.` });
  if (priv && a.pwdLastSetAt && days(a.pwdLastSetAt, now) > policy.privilegedPwdDays)
    out.push({ rule: "privileged_pwd_old", severity: "high", detail: `Heslo změněno ${fmt(a.pwdLastSetAt)} (před ${days(a.pwdLastSetAt, now)} dny, limit ${policy.privilegedPwdDays})${via}.` });
  if (a.mfa === false && a.kind === "user") out.push({ rule: "no_mfa", severity: up("medium", "critical"), detail: `Žádná registrovaná metoda MFA${via}.` });
  return out;
}

/** Nálezy za privilegované skupiny / role: počet povolených členů nad limitem. */
export function evaluateGroups(accounts: DirAccount[], policy: IdentityPolicy): { subject: string; draft: FindingDraft }[] {
  const count = new Map<string, number>();
  for (const a of accounts) if (a.enabled) for (const g of a.privilegedVia) count.set(g, (count.get(g) ?? 0) + 1);
  return [...count]
    .filter(([, n]) => n > policy.maxPrivilegedMembers)
    .map(([g, n]) => ({
      subject: `group:${g}`,
      draft: { rule: "privileged_group_size" as const, severity: n > policy.maxPrivilegedMembers * 2 ? ("high" as const) : ("medium" as const), detail: `${g}: ${n} povolených členů (limit ${policy.maxPrivilegedMembers}).` },
    }));
}

/* ---------- Active Directory: pomocné funkce (sdílené kvůli testům) ---------- */

export const UAC = {
  ACCOUNTDISABLE: 0x2,
  PASSWD_NOTREQD: 0x20,
  DONT_EXPIRE_PASSWORD: 0x10000,
  TRUSTED_FOR_DELEGATION: 0x80000,
  SERVER_TRUST_ACCOUNT: 0x2000,
  DONT_REQ_PREAUTH: 0x400000,
} as const;

/** Windows FILETIME (100 ns od 1. 1. 1601) → Date; 0 a „nikdy“ → null. */
export function fromFileTime(v: string | number | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (s === "0" || s === "9223372036854775807") return null;
  const ms = Number(BigInt(s) / 10_000n) - 11_644_473_600_000;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

/** LDAP GeneralizedTime (20240131120000.0Z) → Date. */
export function fromGeneralizedTime(v: string | null | undefined): Date | null {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)) : null;
}

/** Binární objectSid → S-1-5-21-…  */
export function sidToString(b: Uint8Array): string {
  if (b.length < 8) return "";
  const count = b[1]!;
  let auth = 0n;
  for (let i = 2; i < 8; i++) auth = (auth << 8n) | BigInt(b[i]!);
  const parts = [`S-${b[0]}-${auth}`];
  for (let i = 0; i < count && 8 + i * 4 + 4 <= b.length; i++) {
    const o = 8 + i * 4;
    parts.push(String((b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0));
  }
  return parts.join("-");
}

/** Binární objectGUID → textový GUID (smíšené pořadí bajtů jako ve Windows). */
export function guidToString(b: Uint8Array): string {
  if (b.length !== 16) return "";
  const h = (i: number) => b[i]!.toString(16).padStart(2, "0");
  const r = (idx: number[]) => idx.map(h).join("");
  return `${r([3, 2, 1, 0])}-${r([5, 4])}-${r([7, 6])}-${r([8, 9])}-${r([10, 11, 12, 13, 14, 15])}`;
}

/** Privilegované skupiny AD podle SID (nezávisle na jazyku serveru). */
export const AD_PRIVILEGED_DOMAIN_RIDS = [512, 518, 519, 520, 526, 527] as const; // Domain/Schema/Enterprise Admins, GPO Creator Owners, Key Admins, Enterprise Key Admins
export const AD_PRIVILEGED_BUILTIN_SIDS = ["S-1-5-32-544", "S-1-5-32-548", "S-1-5-32-549", "S-1-5-32-550", "S-1-5-32-551"] as const; // Administrators, Account/Server/Print/Backup Operators
export const AD_PRIVILEGED_NAMES = ["DnsAdmins"] as const;

export function isPrivilegedAdGroup(sid: string, cn: string, extra: string[]): boolean {
  if ((AD_PRIVILEGED_BUILTIN_SIDS as readonly string[]).includes(sid)) return true;
  if (/^S-1-5-21-/.test(sid) && (AD_PRIVILEGED_DOMAIN_RIDS as readonly number[]).includes(Number(sid.split("-").at(-1)))) return true;
  const n = cn.toLowerCase();
  return [...AD_PRIVILEGED_NAMES, ...extra].some((x) => x.toLowerCase() === n);
}

/** Privilegované role Entra ID (ID šablon rolí; název jako záloha). */
export const ENTRA_PRIVILEGED_ROLES: Record<string, string> = {
  "62e90394-69f5-4237-9190-012177145e10": "Global Administrator",
  "e8611ab8-c189-46e8-94e1-60213ab1f814": "Privileged Role Administrator",
  "7be44c8a-adaf-4e2a-84d6-ab2649e08a13": "Privileged Authentication Administrator",
  "194ae4cb-b126-40b2-bd5b-6091b380977d": "Security Administrator",
  "b1be1c3e-b65d-4f19-8427-f6fa0d97feb9": "Conditional Access Administrator",
  "29232cdf-9323-42fd-ade2-1d097af3e4de": "Exchange Administrator",
  "f28a1f50-f6e7-4571-818b-6a12f2af6b6c": "SharePoint Administrator",
  "fe930be7-5e62-47db-91af-98c3a49a38b1": "User Administrator",
  "9b895d92-2cd3-44c7-9d02-a6ac2d5ea5c3": "Application Administrator",
  "158c047a-c907-4556-b7ef-446551a6b5f7": "Cloud Application Administrator",
  "c4e39bd9-1100-46d3-8c65-fb160da0071f": "Authentication Administrator",
  "3a2c62db-5318-420d-8d74-23affee5d9d5": "Intune Administrator",
  "8ac3fc64-6eca-42ea-9e69-59f4c7b60eb2": "Hybrid Identity Administrator",
  "729827e3-9c14-49f7-bb1b-9608f156bbb8": "Helpdesk Administrator",
};

/* ============================================================
 * v0.29 – toxické kombinace (SoD) a přezkum přístupů (recertifikace)
 * ============================================================ */

/** Strana pravidla SoD: skupiny AD / role Entra (podle názvu) a funkční místa CONTIXu. */
export const SodSide = z.object({
  groups: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  positionIds: z.array(z.string().uuid()).max(50).default([]),
});
export type SodSide = z.infer<typeof SodSide>;

export const SodRuleInput = z
  .object({
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).default(""),
    severity: z.enum(IDENTITY_SEVERITIES).default("high"),
    sideA: SodSide,
    sideB: SodSide,
    enabled: z.boolean().default(true),
    companyId: z.string().uuid().optional(),
  })
  .refine((r) => (r.sideA.groups.length || r.sideA.positionIds.length) && (r.sideB.groups.length || r.sideB.positionIds.length), {
    message: "Každá strana pravidla musí mít alespoň jednu skupinu nebo funkční místo.",
  });
export type SodRuleInput = z.input<typeof SodRuleInput>;

export interface SodRuleDto {
  id: string;
  companyId: string;
  name: string;
  description: string;
  severity: IdentitySeverity;
  sideA: SodSide;
  sideB: SodSide;
  enabled: boolean;
  open: number;
  /** Názvy funkčních míst pro zobrazení. */
  positionNames: Record<string, string>;
}

export interface SodViolationDto {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: IdentitySeverity;
  subject: string;
  person: string;
  contixUserId: string | null;
  accounts: { id: string; login: string; sourceName: string }[];
  matchA: string[];
  matchB: string[];
  status: IdentityFindingStatus;
  acceptedByName: string | null;
  acceptedReason: string | null;
  acceptedUntil: string | null;
  firstSeenAt: string;
  resolvedAt: string | null;
}

/** Vstup vyhodnocení SoD: povolené účty (s vazbou na uživatele CONTIXu) a držitelé funkčních míst. */
export interface SodAccount {
  id: string;
  userId: string | null;
  login: string;
  displayName: string;
  sourceName: string;
  groups: string[];
}
export interface SodHolder {
  userId: string;
  userName: string;
  positionId: string;
  positionName: string;
}
export interface SodHit {
  subject: string;
  userId: string | null;
  person: string;
  accountIds: string[];
  matchA: string[];
  matchB: string[];
}

/**
 * Osoby, které splňují obě strany pravidla. Osoba = uživatel CONTIXu (účty spárované e-mailem z více adresářů
 * + jeho funkční místa), jinak samostatný účet. Skupiny se porovnávají bez ohledu na velikost písmen.
 */
export function evaluateSodRule(rule: { sideA: SodSide; sideB: SodSide }, accounts: SodAccount[], holders: SodHolder[]): SodHit[] {
  const people = new Map<string, { userId: string | null; person: string; accountIds: Set<string>; a: Set<string>; b: Set<string> }>();
  const get = (key: string, userId: string | null, person: string) => {
    let p = people.get(key);
    if (!p) people.set(key, (p = { userId, person, accountIds: new Set(), a: new Set(), b: new Set() }));
    return p;
  };
  const ga = new Set(rule.sideA.groups.map((g) => g.toLowerCase()));
  const gb = new Set(rule.sideB.groups.map((g) => g.toLowerCase()));
  for (const acc of accounts) {
    const hitA = acc.groups.filter((g) => ga.has(g.toLowerCase()));
    const hitB = acc.groups.filter((g) => gb.has(g.toLowerCase()));
    if (!hitA.length && !hitB.length) continue;
    const p = get(acc.userId ? `user:${acc.userId}` : `account:${acc.id}`, acc.userId, acc.displayName || acc.login);
    p.accountIds.add(acc.id);
    for (const g of hitA) p.a.add(`${g} (${acc.sourceName})`);
    for (const g of hitB) p.b.add(`${g} (${acc.sourceName})`);
  }
  for (const h of holders) {
    const inA = rule.sideA.positionIds.includes(h.positionId);
    const inB = rule.sideB.positionIds.includes(h.positionId);
    if (!inA && !inB) continue;
    const p = get(`user:${h.userId}`, h.userId, h.userName);
    if (inA) p.a.add(`funkční místo ${h.positionName}`);
    if (inB) p.b.add(`funkční místo ${h.positionName}`);
  }
  return [...people]
    .filter(([, p]) => p.a.size && p.b.size)
    .map(([subject, p]) => ({ subject, userId: p.userId, person: p.person, accountIds: [...p.accountIds], matchA: [...p.a].sort(), matchB: [...p.b].sort() }));
}

/* ---------- přezkum přístupů ---------- */

export const ACCESS_REVIEW_STATUSES = ["active", "closed", "cancelled"] as const;
export type AccessReviewStatus = (typeof ACCESS_REVIEW_STATUSES)[number];
export const ACCESS_REVIEW_DECISIONS = ["pending", "keep", "revoke"] as const;
export type AccessReviewDecision = (typeof ACCESS_REVIEW_DECISIONS)[number];
export const ACCESS_REVIEWER_MODES = ["position", "manager"] as const;
export type AccessReviewerMode = (typeof ACCESS_REVIEWER_MODES)[number];

export const ACCESS_REVIEW_LABELS = {
  status: { active: "Probíhá", closed: "Uzavřeno", cancelled: "Zrušeno" } satisfies Record<AccessReviewStatus, string>,
  decision: { pending: "Čeká na rozhodnutí", keep: "Ponechat", revoke: "Odebrat" } satisfies Record<AccessReviewDecision, string>,
  reviewerMode: {
    position: "Jedno funkční místo (např. vlastník systému)",
    manager: "Vedoucí útvaru držitele účtu (jinak zvolené funkční místo)",
  } satisfies Record<AccessReviewerMode, string>,
} as const;

export const AccessReviewInput = z
  .object({
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).default(""),
    companyId: z.string().uuid().optional(),
    sourceIds: z.array(z.string().uuid()).max(20).default([]),
    /** Jen účty v těchto skupinách / rolích (prázdné = všechny). */
    groups: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
    privilegedOnly: z.boolean().default(false),
    reviewerMode: z.enum(ACCESS_REVIEWER_MODES).default("position"),
    reviewerPositionId: z.string().uuid(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
export type AccessReviewInput = z.input<typeof AccessReviewInput>;

export const AccessReviewDecisionInput = z
  .object({
    decision: z.enum(["keep", "revoke"]),
    note: z.string().trim().max(2000).default(""),
  })
  .refine((d) => d.decision === "keep" || d.note.length >= 3, { message: "U odebrání uveďte, co odebrat (skupinu, celý účet…).", path: ["note"] });
export type AccessReviewDecisionInput = z.input<typeof AccessReviewDecisionInput>;

export interface AccessReviewItemDto {
  id: string;
  accountId: string | null;
  login: string;
  displayName: string;
  sourceName: string;
  kind: IdentityAccountKind;
  /** Přístupy v rozsahu přezkumu (skupiny / role) ke dni zahájení. */
  access: string[];
  privilegedVia: string[];
  lastLogonAt: string | null;
  reviewerPositionId: string;
  reviewerName: string;
  decision: AccessReviewDecision;
  note: string;
  decidedByName: string | null;
  decidedAt: string | null;
  /** Ruční potvrzení provedení odebrání (správce). */
  remediatedManually: boolean;
  /** U odebrání: ověřeno podle aktuálního stavu adresáře (účet zakázaný / odstraněný / bez přezkoumaných přístupů). */
  remediated: boolean | null;
}

export interface AccessReviewDto {
  id: string;
  companyId: string;
  name: string;
  description: string;
  status: AccessReviewStatus;
  scope: { sourceIds: string[]; groups: string[]; privilegedOnly: boolean };
  reviewerMode: AccessReviewerMode;
  reviewerPositionId: string;
  dueDate: string;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  counts: { total: number; pending: number; keep: number; revoke: number; remediated: number };
}

export interface AccessReviewDetail extends AccessReviewDto {
  items: AccessReviewItemDto[];
  /** Může uživatel rozhodovat (u položek svých funkčních míst / identity:write). */
  canDecideAll: boolean;
  myPositionIds: string[];
}

/** Ověření odebrání: účet zmizel / je zakázaný / už nemá žádný z přezkoumaných přístupů. */
export function revokeRemediated(snapshotAccess: string[], current: { enabled: boolean; removed: boolean; groups: string[] } | null): boolean {
  if (!current || current.removed || !current.enabled) return true;
  if (!snapshotAccess.length) return false;
  const now = new Set(current.groups.map((g) => g.toLowerCase()));
  return !snapshotAccess.some((g) => now.has(g.toLowerCase()));
}


/* ============================================================
 * v0.30 – synchronizace uživatelů / struktury a automatické testy opatření
 * ============================================================ */

export interface ProvAccount {
  email: string | null;
  displayName: string;
  title: string | null;
  department: string | null;
  enabled: boolean;
  removed: boolean;
  kind: IdentityAccountKind;
  groups: string[];
}
export interface ProvUser {
  id: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  isActive: boolean;
  /** Spravuje ho tento zdroj (založen synchronizací). */
  managed: boolean;
}
export interface ProvisioningPlan {
  create: { email: string; displayName: string; jobTitle: string | null; department: string | null }[];
  update: { id: string; email: string; displayName: string; jobTitle: string | null }[];
  reactivate: { id: string; email: string }[];
  deactivate: { id: string; email: string; reason: string }[];
  /** Existující uživatelé založení ručně – synchronizace je nemění (jen přiřadí funkční místo). */
  existing: { id: string; email: string }[];
  /** Cílové přiřazení e-mail → útvar / funkční místo (pro všechny uživatele ve skupině). */
  placements: { email: string; unit: string; position: string }[];
  units: string[];
  positions: { unit: string; name: string }[];
}

const normDept = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 255);

/**
 * Plán synchronizace (čistá funkce, náhled i provedení): kdo se založí, aktualizuje, deaktivuje,
 * jaké útvary a funkční místa vzniknou. Ručně založené uživatele nikdy nedeaktivuje ani nepřejmenuje.
 */
export function planProvisioning(accounts: ProvAccount[], users: ProvUser[], cfg: ProvisioningConfig): ProvisioningPlan {
  const plan: ProvisioningPlan = { create: [], update: [], reactivate: [], deactivate: [], existing: [], placements: [], units: [], positions: [] };
  if (!cfg.enabled || !cfg.group.trim()) return plan;
  const group = cfg.group.trim().toLowerCase();
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const wanted = new Map<string, ProvAccount>();
  for (const a of accounts) {
    if (!a.email || a.kind !== "user" || a.removed || !a.enabled) continue;
    if (!a.groups.some((g) => g.toLowerCase() === group)) continue;
    const e = a.email.toLowerCase();
    if (!wanted.has(e)) wanted.set(e, a);
  }
  const units = new Set<string>();
  const positions = new Map<string, { unit: string; name: string }>();
  for (const [email, a] of wanted) {
    const u = byEmail.get(email);
    // ručně založený a deaktivovaný uživatel: synchronizace ho nechává být (ani ho nezařadí)
    if (u && !u.managed && !u.isActive) continue;
    const title = a.title?.trim().slice(0, 200) || null;
    if (!u) plan.create.push({ email, displayName: a.displayName.slice(0, 200) || email, jobTitle: title, department: normDept(a.department) || null });
    else if (!u.managed) plan.existing.push({ id: u.id, email });
    else {
      if (!u.isActive) plan.reactivate.push({ id: u.id, email });
      if (u.displayName !== (a.displayName.slice(0, 200) || email) || (u.jobTitle ?? null) !== title) plan.update.push({ id: u.id, email, displayName: a.displayName.slice(0, 200) || email, jobTitle: title });
    }
    const dept = normDept(a.department);
    if (cfg.units && dept) {
      units.add(dept);
      if (cfg.positions) {
        const name = (title ?? "Pracovník").slice(0, 255);
        positions.set(`${dept}\u0000${name}`, { unit: dept, name });
        plan.placements.push({ email, unit: dept, position: name });
      }
    }
  }
  if (cfg.deactivate)
    for (const u of users) {
      if (!u.managed || !u.isActive || wanted.has(u.email.toLowerCase())) continue;
      const acc = accounts.find((a) => a.email?.toLowerCase() === u.email.toLowerCase());
      plan.deactivate.push({ id: u.id, email: u.email, reason: !acc || acc.removed ? "účet odstraněn z adresáře" : !acc.enabled ? "účet zakázaný" : "není členem skupiny" });
    }
  plan.units = [...units].sort((a, b) => a.localeCompare(b, "cs"));
  plan.positions = [...positions.values()].sort((a, b) => a.unit.localeCompare(b.unit, "cs") || a.name.localeCompare(b.name, "cs"));
  return plan;
}

export interface ProvisioningResultDto {
  created: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  unitsCreated: number;
  positionsCreated: number;
  holdersAdded: number;
  holdersRemoved: number;
}

/* ---------- automatické testy opatření ---------- */

export const CONTROL_AUTOMATION_KINDS = ["identity_checks", "access_review", "sca"] as const;
export type ControlAutomationKind = (typeof CONTROL_AUTOMATION_KINDS)[number];
export const AUTOMATION_FREQUENCIES = ["weekly", "monthly", "quarterly"] as const;
export type AutomationFrequency = (typeof AUTOMATION_FREQUENCIES)[number];
export const AUTOMATION_DAYS: Record<AutomationFrequency, number> = { weekly: 7, monthly: 30, quarterly: 91 };

export const AUTOMATION_LABELS = {
  kind: {
    identity_checks: "Kontrola účtů v adresáři (nálezy Identity a přístupy)",
    access_review: "Uzavřený přezkum přístupů",
    sca: "Shoda konfigurace (Wazuh SCA / CIS)",
  } satisfies Record<ControlAutomationKind, string>,
  frequency: { weekly: "Týdně", monthly: "Měsíčně", quarterly: "Čtvrtletně" } satisfies Record<AutomationFrequency, string>,
} as const;

export const ControlAutomationInput = z.object({
  controlId: z.string().uuid(),
  kind: z.enum(CONTROL_AUTOMATION_KINDS),
  frequency: z.enum(AUTOMATION_FREQUENCIES).default("monthly"),
  /** Zdroje v rozsahu (prázdné = všechny zdroje společnosti opatření). */
  sourceIds: z.array(z.string().uuid()).max(20).default([]),
  /** Pravidla v rozsahu (prázdné = všechna). */
  rules: z.array(z.enum(IDENTITY_RULES)).max(IDENTITY_RULES.length).default([]),
  /** Tolerance: kolik otevřených kritických / vysokých nálezů ještě znamená „účinné s výjimkami“. */
  maxCritical: z.number().int().min(0).max(1000).default(0),
  maxHigh: z.number().int().min(0).max(1000).default(0),
  /** Po testu nastavit účinnost opatření podle výsledku (jinak jen záznam testu). */
  applyEffectiveness: z.boolean().default(false),
  enabled: z.boolean().default(true),
  /** SCA (ADR-064): politiky v rozsahu (prázdné = všechny) a prahy skóre shody (%). */
  scaPolicies: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  scaMinScore: z.number().int().min(0).max(100).default(80),
  scaWarnScore: z.number().int().min(0).max(100).default(60),
});
export type ControlAutomationInput = z.input<typeof ControlAutomationInput>;

export interface ControlAutomationDto {
  id: string;
  companyId: string;
  controlId: string;
  controlName: string;
  kind: ControlAutomationKind;
  frequency: AutomationFrequency;
  sourceIds: string[];
  rules: IdentityRule[];
  maxCritical: number;
  maxHigh: number;
  applyEffectiveness: boolean;
  enabled: boolean;
  scaPolicies: string[];
  scaMinScore: number;
  scaWarnScore: number;
  lastRunAt: string | null;
  lastResult: string | null;
  lastTestId: string | null;
  lastError: string | null;
}

/** Výsledek automatické kontroly účtů podle otevřených nálezů a tolerance. */
export function identityCheckResult(open: Record<IdentitySeverity, number>, cfg: { maxCritical: number; maxHigh: number }): "effective" | "effective_with_exceptions" | "ineffective" {
  if (open.critical > cfg.maxCritical || open.high > cfg.maxHigh) return "ineffective";
  return open.critical + open.high + open.medium + open.low > 0 ? "effective_with_exceptions" : "effective";
}

/* ============================================================
 * v1.89 (ADR-184): počty u filtrů, exporty, reporty, měsíční rozesílání a hromadné akce v nálezech identit.
 * ============================================================ */

/** Počty nálezů pro volby filtru – každá dimenze s ostatními filtry, bez sebe sama. */
export interface IdentityFindingFacets {
  rules: Partial<Record<IdentityRule, number>>;
  /** Nejvyšší závažnost nálezů pravidla ve filtru (v1.92) – barva dlaždice. */
  ruleSeverity: Partial<Record<IdentityRule, IdentitySeverity>>;
  severities: Record<IdentitySeverity, number>;
  /** Počet nálezů podle celého filtru. */
  total: number;
}

/** Hromadná výjimka z vybraných nálezů. */
export const BulkAcceptIdentityInput = AcceptIdentityFindingInput.extend({ ids: z.array(z.string().uuid()).min(1).max(500) });
export type BulkAcceptIdentityInput = z.infer<typeof BulkAcceptIdentityInput>;

export const IDENTITY_REPORT_KINDS = ["inactive", "privileged", "summary", "computers"] as const;
export type IdentityReportKind = (typeof IDENTITY_REPORT_KINDS)[number];
export const IDENTITY_REPORT_LABELS: Record<IdentityReportKind, string> = {
  inactive: "Neaktivní a nikdy nepřihlášené účty",
  privileged: "Privilegované účty",
  summary: "Souhrn pro vedení",
  computers: "Počítače a servery z AD",
};
/** Pravidla reportu neaktivních účtů. */
export const IDENTITY_INACTIVE_RULES: IdentityRule[] = ["stale", "never_logged_in"];
/** Seskupení reportu neaktivních účtů. */
export const IDENTITY_REPORT_GROUPS = ["department", "ou"] as const;
export type IdentityReportGroup = (typeof IDENTITY_REPORT_GROUPS)[number];

/** Organizační jednotka z DN: cesta OU (nejvyšší úroveň první), bez CN a DC. */
export function ouOfDn(dn: string | null | undefined): string | null {
  if (!dn) return null;
  const ous = [...dn.matchAll(/(?:^|,)\s*OU=((?:\\,|[^,])+)/gi)].map((m) => m[1]!.replace(/\\,/g, ",").trim());
  return ous.length ? ous.reverse().join(" / ") : null;
}

/** Plán měsíčního rozesílání reportu garantovi modulu (garant průvodce „identity“). */
export const IdentityReportScheduleInput = z.object({
  enabled: z.boolean(),
  reports: z.array(z.enum(IDENTITY_REPORT_KINDS)).min(1).max(IDENTITY_REPORT_KINDS.length),
  format: z.enum(["docx", "pdf"]).default("docx"),
  /** Den v měsíci (1–28), od kterého se report v daném měsíci odešle. */
  day: z.number().int().min(1).max(28).default(1),
  group: z.enum(IDENTITY_REPORT_GROUPS).default("department"),
});
export type IdentityReportScheduleInput = z.input<typeof IdentityReportScheduleInput>;
export interface IdentityReportScheduleDto extends z.output<typeof IdentityReportScheduleInput> {
  companyId: string;
  lastSentAt: string | null;
  lastStatus: string | null;
  /** Garant modulu (funkční místo) a počet příjemců s e-mailem; null = garant není určen. */
  guarantor: { positionId: string; name: string; recipients: number } | null;
  /** Převodní služba pro PDF je nastavená (jinak se posílá Word). */
  pdfAvailable: boolean;
}


/* ============================================================
 * Počítače a servery z Active Directory (v1.90, ADR-185) – inventář, vazba na aktiva a pokrytí sběrem, nálezy.
 * ============================================================ */

export const COMPUTER_ROLES = ["dc", "server", "workstation", "other"] as const;
export type ComputerRole = (typeof COMPUTER_ROLES)[number];
export const COMPUTER_ROLE_LABELS: Record<ComputerRole, string> = { dc: "Řadič domény", server: "Server", workstation: "Stanice", other: "Jiné" };
/** Pravidla počítačů (subjekt nálezu = `computer:<id>`, LAPS v doméně = `laps`). */
export const COMPUTER_RULES: IdentityRule[] = ["computer_stale", "computer_eol", "computer_delegation", "computer_no_laps", "laps_not_deployed", "computer_default_container", "server_unmonitored"];

export interface DirComputer {
  externalId: string;
  name: string;
  dnsName: string | null;
  dn: string;
  os: string | null;
  osVersion: string | null;
  role: ComputerRole;
  enabled: boolean;
  lastLogonAt: Date | null;
  pwdLastSetAt: Date | null;
  createdAt: Date | null;
  description: string | null;
  spns: string[];
  unconstrainedDelegation: boolean;
  constrainedDelegation: boolean;
  /** Má spravované heslo místního správce (Windows LAPS / Microsoft LAPS). */
  laps: boolean;
}

/** Role počítače: řadič domény podle UAC / primární skupiny, server podle názvu systému. */
export function computerRole(uac: number, primaryGroupId: number | null, os: string | null): ComputerRole {
  if (uac & UAC.SERVER_TRUST_ACCOUNT || primaryGroupId === 516 || primaryGroupId === 521) return "dc";
  if (!os) return "other";
  if (/server/i.test(os)) return "server";
  if (/windows/i.test(os)) return "workstation";
  return "other";
}

export interface ComputerFindingDraft extends FindingDraft {
  /** externalId počítače; null = nález za doménu (LAPS). */
  computer: string | null;
}

/** Nálezy počítačů ze samotného adresáře (bez vazby na CONTIX – `server_unmonitored` počítá služba). */
export function evaluateComputers(list: DirComputer[], policy: IdentityPolicy, now: Date): ComputerFindingDraft[] {
  const out: ComputerFindingDraft[] = [];
  const staleDays = policy.computerStaleDays ?? 90;
  const windows = (c: DirComputer) => /windows/i.test(c.os ?? "");
  const lapsDeployed = list.some((c) => c.laps);
  let withoutLaps = 0;
  for (const c of list) {
    if (!c.enabled) continue;
    const seen = c.lastLogonAt ?? null;
    const age = seen ? days(seen, now) : c.createdAt ? days(c.createdAt, now) : null;
    const stale = age !== null && age > staleDays && c.role !== "dc";
    if (stale)
      out.push({
        computer: c.externalId,
        rule: "computer_stale",
        severity: c.role === "server" ? "high" : "medium",
        detail: seen ? `${c.name}: naposledy v doméně před ${age} dny (${seen.toISOString().slice(0, 10)})` : `${c.name}: nikdy se nepřihlásil do domény (založen před ${age} dny)`,
      });
    const sup = osSupport(c.os, c.osVersion, now);
    if (!stale && sup.status === "eol")
      out.push({ computer: c.externalId, rule: "computer_eol", severity: c.role === "workstation" ? "medium" : "high", detail: `${c.name}: ${c.os}${c.osVersion ? ` ${c.osVersion}` : ""} – podpora skončila ${sup.eolDate}` });
    if (c.unconstrainedDelegation && c.role !== "dc") out.push({ computer: c.externalId, rule: "computer_delegation", severity: "high", detail: `${c.name}: neomezená delegace Kerberos` });
    if (windows(c) && c.role !== "dc" && !c.laps) {
      withoutLaps++;
      if (lapsDeployed && !stale) out.push({ computer: c.externalId, rule: "computer_no_laps", severity: c.role === "server" ? "high" : "medium", detail: `${c.name}: heslo místního správce není spravováno LAPS` });
    }
    if (/,CN=Computers,DC=/i.test(c.dn) && c.role !== "dc") out.push({ computer: c.externalId, rule: "computer_default_container", severity: "low", detail: `${c.name}: ${c.dn}` });
  }
  if (!lapsDeployed && withoutLaps > 0) out.push({ computer: null, rule: "laps_not_deployed", severity: "medium", detail: `Žádný z ${withoutLaps} povolených počítačů s Windows nemá spravované heslo místního správce.` });
  return out;
}

export interface IdentityComputerDto {
  id: string;
  sourceId: string;
  sourceName: string;
  name: string;
  dnsName: string | null;
  dn: string;
  ou: string | null;
  os: string | null;
  osVersion: string | null;
  support: SupportStatus;
  eolDate: string | null;
  role: ComputerRole;
  enabled: boolean;
  lastLogonAt: string | null;
  pwdLastSetAt: string | null;
  createdAt: string | null;
  description: string | null;
  spns: string[];
  unconstrainedDelegation: boolean;
  constrainedDelegation: boolean;
  laps: boolean;
  asset: { id: string; name: string } | null;
  /** Sběr dat o počítači (přes spárované aktivum): agent CONTIX, sběrač, Wazuh. */
  monitoring: ("agent" | "collector" | "wazuh")[];
  openFindings: number;
  removedAt: string | null;
}

export interface IdentityComputerSummary {
  total: number;
  /** Povolené a přihlášené v limitu zdroje (v1.91). */
  active: number;
  enabled: number;
  servers: number;
  workstations: number;
  dcs: number;
  stale: number;
  eol: number;
  noAsset: number;
  /** Aktivní servery (vč. řadičů) bez agenta, sběrače i Wazuhu – i bez aktiva. */
  unmonitored: number;
  laps: number;
}

/** Založení aktiv z vybraných počítačů (servery a stanice bez spárovaného aktiva). */
export const ComputerAssetsInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });

/* ---------- inventář adresáře: aktivní / neaktivní objekty (v1.91, ADR-186) ---------- */

/** Aktivita účtu: aktivní = povolený a přihlášený v limitu zdroje; neznámá = Entra bez údaje o přihlášení. */
export const ACCOUNT_ACTIVITIES = ["active", "inactive", "never", "unknown"] as const;
export type AccountActivity = (typeof ACCOUNT_ACTIVITIES)[number];

export interface IdentityInventory {
  accounts: {
    total: number;
    enabled: number;
    active: number;
    inactive: number;
    never: number;
    unknown: number;
    disabled: number;
    privileged: number;
    privilegedActive: number;
    user: number;
    service: number;
    guest: number;
  };
  /** null = žádný zdroj počítače nenačítá. */
  computers: {
    total: number;
    enabled: number;
    active: number;
    inactive: number;
    disabled: number;
    dc: number;
    server: number;
    workstation: number;
    other: number;
    serversActive: number;
    workstationsActive: number;
  } | null;
  groups: { total: number; privileged: number };
}

/* ---------- skupiny pravidel pro dlaždice nálezů (v1.92) ---------- */

/** Základ podílu: povolené účty, privilegované účty, povolené počítače, servery (vč. řadičů); null = bez podílu. */
export type RuleBase = "accounts" | "privileged" | "computers" | "servers" | null;
export const IDENTITY_RULE_GROUPS: { key: "accounts" | "privileged" | "computers"; title: string; base: RuleBase; rules: { rule: IdentityRule; base: RuleBase }[] }[] = [
  {
    key: "accounts",
    title: "Účty a hesla",
    base: "accounts",
    rules: [
      { rule: "stale", base: "accounts" },
      { rule: "never_logged_in", base: "accounts" },
      { rule: "leaver", base: "accounts" },
      { rule: "pwd_never_expires", base: "accounts" },
      { rule: "pwd_not_required", base: "accounts" },
      { rule: "preauth_disabled", base: "accounts" },
      { rule: "kerberoastable", base: "accounts" },
      { rule: "no_mfa", base: "accounts" },
    ],
  },
  {
    key: "privileged",
    title: "Privilegovaný přístup",
    base: "privileged",
    rules: [
      { rule: "privileged_pwd_old", base: "privileged" },
      { rule: "unconstrained_delegation", base: "accounts" },
      { rule: "privileged_group_size", base: null },
    ],
  },
  {
    key: "computers",
    title: "Počítače a servery",
    base: "computers",
    rules: [
      { rule: "computer_stale", base: "computers" },
      { rule: "computer_eol", base: "computers" },
      { rule: "computer_delegation", base: "computers" },
      { rule: "computer_no_laps", base: "computers" },
      { rule: "laps_not_deployed", base: null },
      { rule: "computer_default_container", base: "computers" },
      { rule: "server_unmonitored", base: "servers" },
    ],
  },
];
