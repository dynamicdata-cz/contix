import type { ConnectorSettingsDto, ScanSettingsInput, WazuhSettingsInput } from "@contix/shared";
import { desc, eq } from "drizzle-orm";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { appSettings, discoveryRuns } from "../../db/schema";
import { decrypt, encrypt } from "../../auth/crypto";

/**
 * Konfigurace konektorů. Primárně z DB (Administrace → Konektory), jinak fallback na .env.
 * Hesla se ukládají šifrovaně (AES-256-GCM, klíč z APP_SECRET) a nikdy se nevrací do UI.
 */

const WAZUH_KEY = "connector.wazuh";
const SCAN_KEY = "connector.network_scan";

interface StoredWazuh {
  enabled: boolean;
  url: string;
  user: string;
  passwordEnc: string | null;
  verifyTls: boolean;
  includePackages: boolean;
  vulnEnabled?: boolean;
  indexerUrl?: string;
  indexerUser?: string;
  indexerPasswordEnc?: string | null;
  indexerVerifyTls?: boolean;
  indexPattern?: string;
  autoSyncHours?: number;
}
interface StoredScan {
  enabled: boolean;
  allowedCidrs: string[];
  nmapPath: string;
}

export interface WazuhConfig {
  source: "db" | "env" | "none";
  enabled: boolean;
  url: string;
  user: string;
  password: string | null;
  verifyTls: boolean;
  includePackages: boolean;
  vulnEnabled: boolean;
  indexerUrl: string;
  indexerUser: string;
  indexerPassword: string | null;
  indexerVerifyTls: boolean;
  indexPattern: string;
  autoSyncHours: number;
}

const VULN_DEFAULTS = {
  vulnEnabled: true,
  indexerUrl: "",
  indexerUser: "",
  indexerPassword: null as string | null,
  indexerVerifyTls: true,
  indexPattern: "wazuh-states-vulnerabilities-*",
  autoSyncHours: 24,
};
export interface ScanConfig {
  source: "db" | "env";
  enabled: boolean;
  allowedCidrs: string[];
  nmapPath: string;
}

async function read<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return (row?.value as T) ?? null;
}
async function write(db: Db, key: string, value: unknown) {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function getWazuhConfig(db: Db, config: Config): Promise<WazuhConfig> {
  const s = await read<StoredWazuh>(db, WAZUH_KEY);
  if (s) {
    const dec = (v?: string | null) => {
      try {
        return v ? decrypt(v, appSecret(config)) : null;
      } catch {
        return null; // změněný APP_SECRET → heslo je potřeba zadat znovu
      }
    };
    return {
      source: "db",
      enabled: s.enabled,
      url: s.url,
      user: s.user,
      password: dec(s.passwordEnc),
      verifyTls: s.verifyTls,
      includePackages: s.includePackages,
      vulnEnabled: s.vulnEnabled ?? true,
      indexerUrl: s.indexerUrl ?? "",
      indexerUser: s.indexerUser ?? "",
      indexerPassword: dec(s.indexerPasswordEnc),
      indexerVerifyTls: s.indexerVerifyTls ?? s.verifyTls,
      indexPattern: s.indexPattern ?? VULN_DEFAULTS.indexPattern,
      autoSyncHours: s.autoSyncHours ?? VULN_DEFAULTS.autoSyncHours,
    };
  }
  if (config.WAZUH_API_URL && config.WAZUH_API_USER && config.WAZUH_API_PASSWORD)
    return {
      source: "env",
      enabled: true,
      url: config.WAZUH_API_URL,
      user: config.WAZUH_API_USER,
      password: config.WAZUH_API_PASSWORD,
      verifyTls: config.WAZUH_VERIFY_TLS,
      includePackages: true,
      ...VULN_DEFAULTS,
    };
  return { source: "none", enabled: false, url: "", user: "", password: null, verifyTls: true, includePackages: true, ...VULN_DEFAULTS };
}

export const wazuhReady = (w: WazuhConfig) => w.enabled && !!w.url && !!w.user && !!w.password;

export async function saveWazuhConfig(db: Db, config: Config, input: ReturnType<typeof normalizeWazuh>) {
  const prev = await read<StoredWazuh>(db, WAZUH_KEY);
  const passwordEnc = input.password
    ? encrypt(input.password, appSecret(config))
    : (prev?.passwordEnc ?? (config.WAZUH_API_PASSWORD ? encrypt(config.WAZUH_API_PASSWORD, appSecret(config)) : null));
  const indexerPasswordEnc = input.indexerPassword
    ? encrypt(input.indexerPassword, appSecret(config))
    : (prev?.indexerPasswordEnc ?? null);
  const value: StoredWazuh = {
    enabled: input.enabled,
    url: input.url.replace(/\/+$/, ""),
    user: input.user,
    passwordEnc,
    verifyTls: input.verifyTls,
    includePackages: input.includePackages,
    vulnEnabled: input.vulnEnabled,
    indexerUrl: input.indexerUrl.replace(/\/+$/, ""),
    indexerUser: input.indexerUser,
    indexerPasswordEnc,
    indexerVerifyTls: input.indexerVerifyTls,
    indexPattern: input.indexPattern,
    autoSyncHours: input.autoSyncHours,
  };
  await write(db, WAZUH_KEY, value);
}

export const normalizeWazuh = (i: WazuhSettingsInput) => ({
  enabled: i.enabled ?? true,
  url: i.url,
  user: i.user,
  password: i.password || undefined,
  verifyTls: i.verifyTls ?? true,
  includePackages: i.includePackages ?? true,
  vulnEnabled: i.vulnEnabled ?? true,
  indexerUrl: i.indexerUrl ?? "",
  indexerUser: i.indexerUser ?? "",
  indexerPassword: i.indexerPassword || undefined,
  indexerVerifyTls: i.indexerVerifyTls ?? true,
  indexPattern: i.indexPattern ?? "wazuh-states-vulnerabilities-*",
  autoSyncHours: i.autoSyncHours ?? 24,
});

export async function getScanConfig(db: Db, config: Config): Promise<ScanConfig> {
  const s = await read<StoredScan>(db, SCAN_KEY);
  if (s) return { source: "db", ...s };
  return { source: "env", enabled: config.SCAN_ENABLED, allowedCidrs: config.SCAN_ALLOWED_CIDRS, nmapPath: config.NMAP_PATH };
}

export const scanReady = (s: ScanConfig) => s.enabled && s.allowedCidrs.length > 0;

export async function saveScanConfig(db: Db, input: Required<ScanSettingsInput>) {
  await write(db, SCAN_KEY, input satisfies StoredScan);
}

/* ---------- nmap: dostupnost a verze ---------- */

export async function nmapInfo(nmapPath: string): Promise<{ found: string | null; version: string | null }> {
  const found = Bun.which(nmapPath);
  if (!found) return { found: null, version: null };
  try {
    const p = Bun.spawn([found, "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    return { found, version: out.match(/Nmap version (\S+)/)?.[1] ?? null };
  } catch {
    return { found, version: null };
  }
}

export const isPrivileged = () => typeof process.getuid === "function" && process.getuid() === 0;

export async function connectorSettingsDto(db: Db, config: Config): Promise<ConnectorSettingsDto> {
  const [w, s] = await Promise.all([getWazuhConfig(db, config), getScanConfig(db, config)]);
  const n = await nmapInfo(s.nmapPath);
  const [last] = await db
    .select({ at: discoveryRuns.createdAt, status: discoveryRuns.status })
    .from(discoveryRuns)
    .where(eq(discoveryRuns.connector, "wazuh"))
    .orderBy(desc(discoveryRuns.createdAt))
    .limit(1);
  return {
    wazuh: {
      source: w.source,
      enabled: w.enabled,
      url: w.url,
      user: w.user,
      hasPassword: !!w.password,
      verifyTls: w.verifyTls,
      includePackages: w.includePackages,
      vulnEnabled: w.vulnEnabled,
      indexerUrl: w.indexerUrl,
      indexerUser: w.indexerUser,
      hasIndexerPassword: !!w.indexerPassword,
      indexerVerifyTls: w.indexerVerifyTls,
      indexPattern: w.indexPattern,
      autoSyncHours: w.autoSyncHours,
      lastSyncAt: last?.at?.toISOString() ?? null,
      lastSyncStatus: last?.status ?? null,
    },
    networkScan: {
      source: s.source,
      enabled: s.enabled,
      allowedCidrs: s.allowedCidrs,
      nmapPath: s.nmapPath,
      nmapFound: n.found,
      nmapVersion: n.version,
      privileged: isPrivileged(),
    },
  };
}
