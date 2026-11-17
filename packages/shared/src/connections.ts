import { z } from "zod";
import { WazuhSettingsInput } from "./asset";

/* ============================================================
 * Připojení (v1.49, ADR-146): instance cizího systému → schopnosti → rozsah.
 * Teď Wazuh (inventář, zranitelnosti, SCA, alerty, hunting, reakce); každý typ může mít víc instancí.
 * ============================================================ */

export const CONNECTION_KINDS = ["wazuh", "collector", "netbox", "jira", "probe"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];

export const ConnectionGroupMap = z
  .array(z.object({ group: z.string().trim().min(1).max(200), companyId: z.string().uuid() }))
  .max(200)
  .default([]);

export const WazuhConnectionInput = WazuhSettingsInput.extend({
  name: z.string().trim().min(1).max(120),
  /** null = celá skupina; jinak společnost, do které patří všechna aktiva a alerty tohoto Wazuhu. */
  companyId: z.string().uuid().nullable().default(null),
  /** Skupina agentů ve Wazuhu → společnost (jen u připojení pro celou skupinu). */
  groupMap: ConnectionGroupMap,
  alertsEnabled: z.boolean().default(false),
  alertMinLevel: z.number().int().min(1).max(15).default(10),
  alertsIndexPattern: z.string().trim().min(1).max(200).default("wazuh-alerts-*"),
  /** Účet pro Active Response v tomto Wazuhu (prázdné = účet ze SOC → Reakce). */
  arUser: z.string().trim().max(200).optional(),
  arPassword: z.string().max(500).optional(),
});
export type WazuhConnectionInput = z.input<typeof WazuhConnectionInput>;

export interface WazuhConnectionDto {
  id: string;
  kind: "wazuh";
  name: string;
  /** Nejstarší připojení – používají ho starší rozhraní (Administrace → Konektory, nastavení alertů). */
  primary: boolean;
  enabled: boolean;
  companyId: string | null;
  groupMap: { group: string; companyId: string }[];
  url: string;
  user: string;
  hasPassword: boolean;
  verifyTls: boolean;
  includePackages: boolean;
  vulnEnabled: boolean;
  indexerUrl: string;
  indexerUser: string;
  hasIndexerPassword: boolean;
  indexerVerifyTls: boolean;
  indexPattern: string;
  autoSyncHours: number;
  alertsEnabled: boolean;
  alertMinLevel: number;
  alertsIndexPattern: string;
  arUser: string;
  hasArPassword: boolean;
  /** Počet agentů spárovaných s aktivy. */
  agents: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastAlertSyncAt: string | null;
  lastAlertResult: string | null;
}

/**
 * Společnost pro agenta: připojení omezené na společnost → ta; jinak první řádek mapování, jehož skupina
 * je mezi skupinami agenta (pořadí mapování = priorita); jinak `fallback`.
 */
export function companyForAgent(conn: { companyId: string | null; groupMap: { group: string; companyId: string }[] }, groups: readonly string[] | null | undefined, fallback: string | null): string | null {
  if (conn.companyId) return conn.companyId;
  const g = new Set((groups ?? []).map((x) => x.toLowerCase()));
  return conn.groupMap.find((m) => g.has(m.group.toLowerCase()))?.companyId ?? fallback;
}

/** Připojení pokrývá společnost (omezené na ni, mapuje do ní skupinu, nebo je pro celou skupinu bez mapování). */
export function connectionCovers(conn: { companyId: string | null; groupMap: { group: string; companyId: string }[] }, companyId: string): boolean {
  if (conn.companyId) return conn.companyId === companyId;
  return !conn.groupMap.length || conn.groupMap.some((m) => m.companyId === companyId);
}

/** Sběrač ze serverů (v1.51, ADR-148): připojení, kterým servery posílají inventář s tokenem. */
export const CollectorConnectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  /** Společnost serverů (null = kořenová společnost skupiny). */
  companyId: z.string().uuid().nullable().default(null),
});
export type CollectorConnectionInput = z.input<typeof CollectorConnectionInput>;

export const COLLECTOR_TOKEN_PREFIX = "ctxh_";

export interface CollectorConnectionDto {
  id: string;
  kind: "collector";
  name: string;
  enabled: boolean;
  companyId: string | null;
  tokenPrefix: string;
  hosts: number;
  lastReportAt: string | null;
  /** Token je uložen šifrovaně → lze stáhnout instalátor (tokeny z doby před v1.54 jen jako otisk). */
  installerReady: boolean;
  /** Poslední nastavení instalátoru (IP adresa CONTIXu pro /etc/hosts, certifikát CA). */
  hostsIp: string;
  caPem: string;
}

/** Instalátor sběrače (v1.54): jeden skript pro server – skript, adresa, token, CA, /etc/hosts, cron, první běh. */
export const CollectorInstallerInput = z.object({
  /** Adresa CONTIXu, kterou uvidí servery (výchozí APP_URL). */
  url: z.string().trim().url().optional(),
  /** IP adresa CONTIXu – zapíše se do /etc/hosts, jen když server název nepřeloží (prázdné = nic). */
  hostsIp: z.union([z.literal(""), z.ipv4(), z.ipv6()]).default(""),
  /** Kořenový certifikát CA v PEM (interní CA Caddy nebo CA zákazníka); prázdné = veřejný certifikát. */
  caPem: z
    .string()
    .trim()
    .max(20_000)
    .refine((v) => !v || /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(v), "Certifikát musí být ve formátu PEM (-----BEGIN CERTIFICATE-----)")
    .default(""),
  /** Interval spouštění v hodinách. */
  everyHours: z.union([z.literal(1), z.literal(6), z.literal(12), z.literal(24)]).default(6),
});
export type CollectorInstallerInput = z.input<typeof CollectorInstallerInput>;

/* ---------- NetBox (v1.53, ADR-150): zařízení a virtuální stroje → aktiva ---------- */
export const NetboxConnectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  url: z.string().trim().url("Zadejte URL NetBoxu, např. https://netbox.firma.local"),
  /** Prázdné = ponechat uložený token. */
  token: z.string().max(500).optional(),
  verifyTls: z.boolean().default(true),
  companyId: z.string().uuid().nullable().default(null),
  /** Tenant NetBoxu (slug) → společnost. */
  groupMap: ConnectionGroupMap,
  includeVms: z.boolean().default(true),
  autoSyncHours: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(24)]).default(24),
});
export type NetboxConnectionInput = z.input<typeof NetboxConnectionInput>;

export interface NetboxConnectionDto {
  id: string;
  kind: "netbox";
  name: string;
  enabled: boolean;
  url: string;
  hasToken: boolean;
  verifyTls: boolean;
  companyId: string | null;
  groupMap: { group: string; companyId: string }[];
  includeVms: boolean;
  autoSyncHours: number;
  assets: number;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
}

/* ---------- JIRA (v1.53, ADR-150): úkol CONTIXu → issue, stav zpět ---------- */
export const JiraConnectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  url: z.string().trim().url("Zadejte URL JIRA, např. https://firma.atlassian.net"),
  deployment: z.enum(["cloud", "datacenter"]).default("cloud"),
  /** Cloud: e-mail účtu (Basic s API tokenem); Data Center: prázdné (Bearer PAT). */
  user: z.string().trim().max(200).default(""),
  token: z.string().max(500).optional(),
  verifyTls: z.boolean().default(true),
  projectKey: z.string().trim().regex(/^[A-Z][A-Z0-9_]{0,19}$/, "Klíč projektu, např. SEC"),
  issueType: z.string().trim().min(1).max(60).default("Task"),
  /** Stavy, které znamenají hotovo → úkol v CONTIXu se uzavře. */
  doneStatuses: z.array(z.string().trim().min(1).max(60)).max(20).default(["Done", "Hotovo"]),
  companyId: z.string().uuid().nullable().default(null),
});
export type JiraConnectionInput = z.input<typeof JiraConnectionInput>;

export interface JiraConnectionDto {
  id: string;
  kind: "jira";
  name: string;
  enabled: boolean;
  url: string;
  deployment: "cloud" | "datacenter";
  user: string;
  hasToken: boolean;
  verifyTls: boolean;
  projectKey: string;
  issueType: string;
  doneStatuses: string[];
  companyId: string | null;
  issues: number;
}

export const EXTERNAL_ISSUE_ENTITIES = ["task"] as const;
export type ExternalIssueEntity = (typeof EXTERNAL_ISSUE_ENTITIES)[number];

export interface ExternalIssueDto {
  id: string;
  connectionId: string;
  connectionName: string;
  entityType: ExternalIssueEntity;
  entityId: string;
  issueKey: string;
  issueUrl: string;
  status: string | null;
  lastSyncAt: string | null;
}
