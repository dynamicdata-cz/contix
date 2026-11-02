import { z } from "zod";

const csv = (def = "") =>
  z
  .string()
  .default(def)
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = (def = "true") =>
  z
  .string()
  .default(def)
  .transform((v) => !["0", "false", "no", "off"].includes(v.toLowerCase()));

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default("postgres://contix:contix@localhost:5432/contix"),
  CORS_ORIGINS: csv("http://localhost:5173"),
  /** Veřejná adresa aplikace (web) – pro OIDC redirect a kontrolu Origin. */
  APP_URL: z.string().default("http://localhost:5173"),
  /** Tajný klíč pro šifrování MFA tajemství. V produkci POVINNÝ (min. 32 znaků). */
  APP_SECRET: z.string().min(32).optional(),
  COOKIE_SECURE: z.string().optional(),

  // Prvotní administrátor (vytvoří se při startu, pokud v DB není žádný uživatel)
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  // Microsoft Entra ID (Azure AD)
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
  // Google Workspace
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Obecný OIDC poskytovatel – např. AD FS (on-prem Active Directory), Keycloak, Authentik
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_LABEL: z.string().default("Firemní účet (SSO)"),
  /** AD FS: přidejte "allatclaims", aby se skupiny dostaly do id_tokenu. */
  OIDC_SCOPES: z.string().default("openid profile email"),

  // Wazuh Server API (Wazuh manager, výchozí port 55000)
  WAZUH_API_URL: z.string().optional(),
  WAZUH_API_USER: z.string().optional(),
  WAZUH_API_PASSWORD: z.string().optional(),
  WAZUH_VERIFY_TLS: bool(),

  // Síťový sken (nmap). Bez povolených rozsahů je sken vypnutý.
  SCAN_ENABLED: bool("false"),
  SCAN_ALLOWED_CIDRS: csv(),
  NMAP_PATH: z.string().default("nmap"),

  // Převodní služba dokumentů (LibreOffice, ADR-025) – PDF z Wordu/Excelu, text pro vyhledávání. Prázdné = vypnuto.
  CONVERTER_URL: z
    .string()
    .optional()
    .transform((v) => (v?.trim() && v.trim() !== "off" ? v.trim().replace(/\/+$/, "") : undefined))
    .pipe(z.string().url().optional()),

  // Identity a přístupy (ADR-029): koncové body Microsoftu – změna jen pro národní cloudy (US Gov, Čína).
  ENTRA_LOGIN_URL: z.string().url().optional(),
  GRAPH_URL: z.string().url().optional(),

  // Legislativa (ADR-035): veřejné REST API e-Sbírky (registrace klienta u MV ČR). Bez klíče se předpisy nestahují.
  ESBIRKA_API_URL: z.string().url().optional(),
  ESBIRKA_API_KEY: z.string().optional(),
  /** Zdroj předpisů: auto (REST API s klíčem, jinak otevřená data), api, opendata, off. */
  /** Odkaz na zdrojový kód této instalace (AGPL-3.0 čl. 13, v1.15) – zobrazí se v aplikaci; upravená verze = odkaz na upravený kód. */
  CONTIX_SOURCE_URL: z.string().url().optional(),
  ESBIRKA_SOURCE: z.enum(["auto", "api", "opendata", "off"]).optional(),
  ESBIRKA_SPARQL_URL: z.string().url().optional(),
  ESBIRKA_RSS_URL: z.string().url().optional(),
  /** Záložní čtení textu z webu e-Sbírky (JSON webové aplikace), když otevřená data text nevrátí (v1.12.4). */
  ESBIRKA_WEB_URL: z.string().url().optional(),
  ESBIRKA_WEB_FALLBACK: z.enum(["on", "off", "only"]).optional(),
  /** Předpisy EU z EUR-Lex (CELLAR, bez registrace): on (výchozí) / off. */
  EURLEX_SOURCE: z.enum(["on", "off"]).optional(),
  EURLEX_SPARQL_URL: z.string().url().optional(),

  /** ARES (údaje o firmách podle IČO / názvu): on (výchozí) / off; vlastní adresa REST API (proxy). */
  ARES_SOURCE: z.enum(["on", "off"]).optional(),
  ARES_URL: z.string().url().optional(),

  // Monitoring: Bearer token pro GET /api/metrics (Prometheus). Bez tokenu je endpoint vypnutý.
  METRICS_TOKEN: z.string().min(16).optional(),
});

export type Config = z.infer<typeof Env>;
export const config: Config = Env.parse(process.env);

const DEV_SECRET = "contix-dev-secret-DO-NOT-USE-IN-PRODUCTION-0000";

export function appSecret(c: Config): string {
  if (c.APP_SECRET) return c.APP_SECRET;
  if (c.NODE_ENV === "production") throw new Error("APP_SECRET musí být v produkci nastaven (min. 32 znaků).");
  return DEV_SECRET;
}

export const cookieSecure = (c: Config) =>
  c.COOKIE_SECURE !== undefined ? c.COOKIE_SECURE === "true" : c.NODE_ENV === "production";
