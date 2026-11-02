import { z } from "zod";
import { patchOf } from "./zutil";
import { SOC_SEVERITIES, type SocSeverity } from "./soc";

/* ============================================================
 * Zdroje alertů SOC (v0.57, ADR-052): webhook s tokenem pro další nástroje (obecný JSON, Suricata EVE,
 * Microsoft Defender) a hlášení phishingu zaměstnanci. Syslog se záměrně přijímá přes Wazuh.
 * ============================================================ */

export const SOC_SOURCE_PRESETS = ["generic", "suricata", "defender", "sentinel", "elastic"] as const;
export type SocSourcePreset = (typeof SOC_SOURCE_PRESETS)[number];

/** Hodnota `source` u alertu podle šablony zdroje (+ phishing z hlášení zaměstnanců). */
export const SOC_PRESET_SOURCE: Record<SocSourcePreset, string> = { generic: "webhook", suricata: "suricata", defender: "defender", sentinel: "sentinel", elastic: "elastic" };

/* ---------- stahování ze SIEM (v0.67, ADR-062) ---------- */

/** Šablony, které umí i stahování (pull) – CONTIX se sám ptá API SIEM, jen čtení. */
export const SOC_PULL_PRESETS = ["sentinel", "elastic"] as const satisfies readonly SocSourcePreset[];
export type SocPullPreset = (typeof SOC_PULL_PRESETS)[number];
export const SOC_PULL_FIRST_HOURS = 24;

const baseUrl = z.string().trim().max(300).regex(/^https?:\/\/[^\s]+$/, "Neplatná adresa");
export const SocSentinelConfig = z.object({
  tenantId: z.string().trim().min(3).max(100),
  clientId: z.string().trim().min(3).max(100),
  subscriptionId: z.string().trim().min(3).max(100),
  resourceGroup: z.string().trim().min(1).max(100).regex(/^[\w.()-]+$/, "Neplatná skupina prostředků"),
  workspace: z.string().trim().min(1).max(100).regex(/^[\w-]+$/, "Neplatný název pracovního prostoru"),
  /** Přihlášení a Azure Resource Manager – výchozí veřejný Azure (jinak např. Azure Government). */
  authorityUrl: baseUrl.default("https://login.microsoftonline.com"),
  managementUrl: baseUrl.default("https://management.azure.com"),
});
export const SocElasticConfig = z.object({
  url: baseUrl,
  index: z.string().trim().min(1).max(200).regex(/^[\w.*,-]+$/, "Neplatný index").default(".alerts-security.alerts-default"),
  authType: z.enum(["apikey", "basic"]).default("apikey"),
  username: z.string().trim().max(200).default(""),
  verifyTls: z.boolean().default(true),
  /** Jen otevřené alerty (kibana.alert.workflow_status = open). */
  openOnly: z.boolean().default(true),
});
export const SocPullInput = z.object({
  enabled: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5).max(1440).default(15),
  sentinel: SocSentinelConfig.optional(),
  elastic: SocElasticConfig.optional(),
});
export type SocPullInput = z.input<typeof SocPullInput>;
export type SocPullConfig = z.infer<typeof SocPullInput>;

export interface SocPullDto {
  config: SocPullConfig;
  hasSecret: boolean;
  lastPullAt: string | null;
  cursor: string | null;
  lastResult: { at: string; fetched: number; created: number; updated: number; error: string | null } | null;
}

/** Zdroje, u kterých lze opakování potlačit (pravidlo + hostitel / IP); ne ruční alerty a hlášení phishingu. */
export const SOC_SUPPRESSIBLE_SOURCES = ["wazuh", "webhook", "suricata", "defender", "threatintel", "hunt", "netscan", "sentinel", "elastic"];

/** Limity příjmu: velikost požadavku, počet událostí v jednom požadavku, velikost .eml. */
export const SOC_INGEST_MAX_BYTES = 1_000_000;
export const SOC_INGEST_MAX_EVENTS = 500;
export const PHISHING_EML_MAX_BYTES = 2_000_000;

export interface SocSourceDto {
  id: string;
  companyId: string;
  companyName: string | null;
  name: string;
  preset: SocSourcePreset;
  defaultSeverity: SocSeverity;
  enabled: boolean;
  /** Prvních 8 znaků tokenu (k rozpoznání); celý token se zobrazí jen jednou. */
  tokenPrefix: string;
  eventsTotal: number;
  alertsCreated: number;
  lastEventAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Stahování ze SIEM (Sentinel / Elastic), null = jen webhook. */
  pull: SocPullDto | null;
}

export const SocSourceInput = z.object({
  name: z.string().trim().min(2).max(120),
  preset: z.enum(SOC_SOURCE_PRESETS),
  defaultSeverity: z.enum(SOC_SEVERITIES).default("medium"),
  enabled: z.boolean().default(true),
  companyId: z.string().uuid().optional(),
  pull: SocPullInput.nullable().optional(),
  /** Tajemství pro stahování (client secret / API klíč / heslo); prázdné = smazat, vynechat = ponechat. */
  secret: z.string().max(2000).optional(),
});
export type SocSourceInput = z.input<typeof SocSourceInput>;
export const SocSourcePatch = patchOf(SocSourceInput.omit({ companyId: true, preset: true }));
export type SocSourcePatch = z.input<typeof SocSourcePatch>;

/** Odpověď při založení zdroje / obnově tokenu – token se ukáže jen tentokrát. */
export interface SocSourceSecret {
  source: SocSourceDto;
  token: string;
}

export interface SocIngestResult {
  accepted: number;
  created: number;
  updated: number;
  suppressed: number;
  skipped: number;
}

/* ---------- hlášení phishingu ---------- */

export interface PhishingAuth {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}
/** Co se z .eml uloží (ne celý e-mail): hlavičky, výsledky ověření, odkazy, názvy příloh. */
export interface PhishingEmlInfo {
  from: string | null;
  replyTo: string | null;
  returnPath: string | null;
  subject: string | null;
  date: string | null;
  messageId: string | null;
  auth: PhishingAuth;
  /** Počet hlaviček Received a první (nejstarší) server. */
  hops: number;
  originIp: string | null;
  urls: string[];
  domains: string[];
  attachments: string[];
}

export interface PhishingReportResult {
  alertId: string;
  /** Stejný odesílatel a předmět už nahlásil někdo jiný – připsáno k existujícímu alertu. */
  duplicate: boolean;
  info: PhishingEmlInfo | null;
}

export const SOC_SOURCE_LABELS = {
  preset: { generic: "Obecný JSON", suricata: "Suricata (EVE JSON)", defender: "Microsoft Defender", sentinel: "Microsoft Sentinel", elastic: "Elastic Security" } as Record<SocSourcePreset, string>,
};
