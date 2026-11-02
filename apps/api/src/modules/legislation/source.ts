import type { Config } from "../../config";
import { EsbirkaClient, esbirkaConfigured, type FetchLike, type SourceFragment, type SourceVersion } from "./esbirka";
import { EurLexClient } from "./eurlex";
import { EsbirkaOpenDataClient } from "./opendata";

/** Zdroj znění předpisů ze Sbírky – REST API (registrace u MV) nebo otevřená data (SPARQL, bez registrace). */
export interface LegalSourceClient {
  current(staleUrl: string): Promise<SourceVersion>;
  fragments(versionKey: string): Promise<SourceFragment[]>;
}
export type LegalSourceKind = "api" | "opendata" | "off";
type SourceConfig = Pick<Config, "ESBIRKA_SOURCE" | "ESBIRKA_API_KEY" | "ESBIRKA_API_URL" | "ESBIRKA_SPARQL_URL" | "EURLEX_SOURCE" | "EURLEX_SPARQL_URL"> & Partial<Pick<Config, "ESBIRKA_WEB_URL" | "ESBIRKA_WEB_FALLBACK">>;

export const LEGAL_TEXT_MODES = ["auto", "opendata", "web", "api"] as const;
export type LegalTextMode = (typeof LEGAL_TEXT_MODES)[number];
/**
 * Konfigurace zdroje podle volby v administraci (v1.13.2): auto = podle server.env (otevřená data / REST API, záloha z webu),
 * opendata = jen otevřená data, web = seznam znění z otevřených dat a text z webu e-Sbírky, api = REST API (klíč v server.env).
 * ESBIRKA_SOURCE=off a ESBIRKA_WEB_FALLBACK=off ze server.env mají vždy přednost.
 */
export function withTextMode<T extends SourceConfig>(config: T, mode: LegalTextMode | undefined): T {
  if (config.ESBIRKA_SOURCE === "off" || !mode || mode === "auto") return config;
  if (mode === "opendata") return { ...config, ESBIRKA_SOURCE: "opendata", ESBIRKA_WEB_FALLBACK: "off" };
  if (mode === "web") return { ...config, ESBIRKA_SOURCE: "opendata", ESBIRKA_WEB_FALLBACK: config.ESBIRKA_WEB_FALLBACK === "off" ? "off" : "only" };
  return { ...config, ESBIRKA_SOURCE: "api" };
}

export function legalSourceKind(config: SourceConfig): LegalSourceKind {
  const s = config.ESBIRKA_SOURCE ?? "auto";
  if (s === "off") return "off";
  if (s === "opendata") return "opendata";
  if (s === "api") return esbirkaConfigured(config) ? "api" : "off";
  return esbirkaConfigured(config) ? "api" : "opendata";
}

export function createLegalSource(config: SourceConfig, fetchImpl?: FetchLike): LegalSourceClient {
  const kind = legalSourceKind(config);
  if (kind === "api") return new EsbirkaClient(config, fetchImpl);
  if (kind === "opendata") return new EsbirkaOpenDataClient(config, fetchImpl);
  throw new Error(config.ESBIRKA_SOURCE === "api" ? "Je nastaven zdroj REST API, ale chybí přístupový klíč e-Sbírky (ESBIRKA_API_KEY)." : "Stahování předpisů z e-Sbírky je vypnuto (ESBIRKA_SOURCE=off).");
}

export const LEGAL_SOURCE_LABEL: Record<LegalSourceKind, string> = {
  api: "REST API e-Sbírky",
  opendata: "otevřená data e-Sbírky (SPARQL + RSS)",
  off: "vypnuto",
};

/** Předpisy EU (EUR-Lex / CELLAR) – bez registrace, lze vypnout EURLEX_SOURCE=off. */
export const eurlexEnabled = (config: Pick<Config, "EURLEX_SOURCE">) => (config.EURLEX_SOURCE ?? "on") !== "off";

/** Zdroj podle druhu předpisu. */
export function sourceForAct(source: "esbirka" | "eurlex", config: SourceConfig, fetchImpl?: FetchLike): LegalSourceClient {
  if (source === "esbirka") return createLegalSource(config, fetchImpl);
  if (!eurlexEnabled(config)) throw new Error("Stahování předpisů EU z EUR-Lex je vypnuto (EURLEX_SOURCE=off).");
  return new EurLexClient(config, fetchImpl);
}
