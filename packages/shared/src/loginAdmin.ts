import { z } from "zod";
import { AdSourceConfig } from "./identity";

/* ============================================================
 * Přihlášení do CONTIXu účty AD (LDAPS) a poskytovatelé SSO z administrace (v0.82, ADR-078).
 * ============================================================ */

const groupList = z.array(z.string().trim().min(1).max(300)).max(50);

/** Přihlášení účty AD přes připojení z Identit (identity_sources.login). */
export const AdLoginConfig = z.object({
  enabled: z.boolean().default(false),
  /** Přihlásit se smí jen členové těchto skupin (CN nebo DN, i vnořené členství); prázdné = bez omezení skupinou. */
  allowedGroups: groupList.default([]),
  /** Při prvním přihlášení uživatele založit (jinak jen existující uživatelé CONTIXu). */
  autoProvision: z.boolean().default(true),
  /** Výchozí role nově založeného uživatele; prázdné = jen role ze skupin AD (bez role se nepřihlásí). */
  defaultRoleKey: z.string().trim().max(50).default(""),
  /** Doména pro e-mail, když účet v AD nemá mail ani UPN. */
  upnSuffix: z.string().trim().toLowerCase().max(200).regex(/^$|^[a-z0-9.-]+$/, "Zadejte doménu, např. firma.local").default(""),
});
export type AdLoginConfig = z.infer<typeof AdLoginConfig>;
export const DEFAULT_AD_LOGIN: AdLoginConfig = AdLoginConfig.parse({});

/** Připojení AD pro přihlášení (zakládá / upravuje zdroj v Identitách). */
export const AdLoginSourceInput = z.object({
  name: z.string().trim().min(1).max(200),
  config: AdSourceConfig,
  /** Heslo účtu pro čtení; prázdné = ponechat uložené. */
  secret: z.string().max(1000).optional(),
  login: AdLoginConfig,
});
export type AdLoginSourceInput = z.input<typeof AdLoginSourceInput>;

export const AdLoginTestInput = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(200),
});
export type AdLoginTestInput = z.input<typeof AdLoginTestInput>;

export const AD_LOGIN_FAILURES = ["not_found", "ambiguous", "bad_password", "disabled", "password_expired", "locked", "not_allowed", "no_role", "local_account", "no_email", "not_provisioned", "inactive", "error"] as const;
export type AdLoginFailure = (typeof AD_LOGIN_FAILURES)[number];

export interface AdLoginSourceDto {
  id: string;
  name: string;
  companyId: string;
  config: AdSourceConfig;
  hasSecret: boolean;
  login: AdLoginConfig;
  /** Zdroj se používá i v Identitách a přístupech (synchronizace účtů). */
  syncHours: number;
}

export interface AdLoginTestResult {
  ok: boolean;
  reason: AdLoginFailure | null;
  message: string;
  displayName: string | null;
  email: string | null;
  login: string | null;
  groups: string[];
  /** Role, které uživatel dostane (ze skupin + výchozí). */
  roles: string[];
  existingUser: boolean;
}

/* ---------------- SSO (OIDC) ---------------- */

export const SSO_KINDS = ["entra", "google", "oidc"] as const;
export type SsoKind = (typeof SSO_KINDS)[number];
export const SSO_KIND_LABELS: Record<SsoKind, string> = {
  entra: "Microsoft Entra ID",
  google: "Google Workspace",
  oidc: "Obecný OIDC (AD FS, Keycloak, Authentik)",
};

export const SsoProviderInput = z
  .object({
    kind: z.enum(SSO_KINDS),
    label: z.string().trim().min(1).max(100),
    /** Entra: ID tenanta; ostatní nevyplňují. */
    tenantId: z.string().trim().max(100).default(""),
    /** OIDC: adresa vydavatele (https://adfs.firma.cz/adfs). */
    issuer: z.string().trim().max(500).default(""),
    clientId: z.string().trim().min(1).max(300),
    /** Tajný klíč klienta; prázdné = ponechat uložený. */
    secret: z.string().max(2000).optional(),
    scopes: z.string().trim().max(300).default("openid profile email"),
    enabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "entra" && !/^[A-Za-z0-9.-]{3,100}$/.test(v.tenantId)) ctx.addIssue({ code: "custom", path: ["tenantId"], message: "Zadejte ID tenanta (GUID nebo doménu)." });
    // http jen pro místní vývoj / testy
    if (v.kind === "oidc" && !/^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?)$/.test(v.issuer)) ctx.addIssue({ code: "custom", path: ["issuer"], message: "Zadejte adresu vydavatele začínající https://" });
  });
export type SsoProviderInput = z.input<typeof SsoProviderInput>;

export interface SsoProviderDto {
  id: string;
  /** Identifikátor v adrese (sso-…). */
  providerId: string;
  kind: SsoKind;
  label: string;
  tenantId: string;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  scopes: string;
  enabled: boolean;
  redirectUri: string;
}

export interface LoginAdminDto {
  ad: AdLoginSourceDto[];
  sso: SsoProviderDto[];
  /** Poskytovatelé z konfigurace serveru (server.env) – jen pro přehled. */
  envProviders: { id: string; label: string; issuer: string; redirectUri: string }[];
  roles: { id: string; key: string; name: string; externalGroups: string[] }[];
  appUrl: string;
}

/** Varianty přihlašovacího jména: DOMÉNA\\jméno → jméno; e-mail / UPN zůstává. */
export function parseLoginName(input: string): { kind: "sam" | "upn"; value: string } {
  const v = input.trim();
  const bs = v.lastIndexOf("\\");
  if (bs >= 0) return { kind: "sam", value: v.slice(bs + 1) };
  return v.includes("@") ? { kind: "upn", value: v } : { kind: "sam", value: v };
}

/** Escapování hodnoty do filtru LDAP (RFC 4515). */
export function ldapEscape(v: string): string {
  return v.replace(/[\\*()\0]/g, (ch) => "\\" + ch.charCodeAt(0).toString(16).padStart(2, "0"));
}

/** Shoda skupin AD s mapováním (CN nebo DN, bez rozlišení velikosti písmen). */
export function groupsMatch(userGroups: string[], wanted: string[]): boolean {
  if (!wanted.length) return false;
  const have = new Set(userGroups.map((g) => g.toLowerCase().replace(/\s*,\s*/g, ",")));
  return wanted.some((w) => have.has(w.toLowerCase().replace(/\s*,\s*/g, ",")));
}
