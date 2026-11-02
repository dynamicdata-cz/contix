import { z } from "zod";

/**
 * Sdílený doménový slovník modulu Asset.
 * Používá ho backend (validace API, DB enumy) i frontend (formuláře, filtry).
 */

export const ASSET_TYPES = [
  "server",
  "workstation",
  "laptop",
  "virtual_machine",
  "container",
  "network_device",
  "security_device",
  "storage",
  "mobile_device",
  "iot_ot",
  "printer",
  "cloud_resource",
  "application",
  "database",
  "saas_service",
  "information_asset",
  "facility",
  "other",
  // primární aktiva (doplněno v0.2)
  "business_service",
  "business_process",
  // podpůrná aktiva – lidé a dodavatelé
  "personnel",
  "supplier",
] as const;
export const AssetType = z.enum(ASSET_TYPES);
export type AssetType = z.infer<typeof AssetType>;

/**
 * Třída aktiva dle ZKB / NIS2:
 *  - primární aktiva = informace, služby a procesy, které organizace chrání,
 *  - podpůrná aktiva = technika, lidé, dodavatelé a prostory, na kterých primární aktiva závisí.
 */
export const ASSET_CLASSES = ["primary", "supporting"] as const;
export const AssetClass = z.enum(ASSET_CLASSES);
export type AssetClass = z.infer<typeof AssetClass>;

const PRIMARY_TYPES = new Set<AssetType>(["information_asset", "business_service", "business_process"]);
/** Výchozí třída podle typu (lze u aktiva ručně změnit). */
export const defaultAssetClass = (t: AssetType): AssetClass => (PRIMARY_TYPES.has(t) ? "primary" : "supporting");

export const CRITICALITIES = ["low", "medium", "high", "critical"] as const;
export const Criticality = z.enum(CRITICALITIES);
export type Criticality = z.infer<typeof Criticality>;

export const LIFECYCLE_STATUSES = ["planned", "active", "maintenance", "retired", "disposed"] as const;
export const LifecycleStatus = z.enum(LIFECYCLE_STATUSES);
export type LifecycleStatus = z.infer<typeof LifecycleStatus>;

export const ENVIRONMENTS = ["production", "test", "development", "other"] as const;
export const Environment = z.enum(ENVIRONMENTS);
export type Environment = z.infer<typeof Environment>;

/** Odkud záznam o aktivu pochází. */
export const SOURCE_TYPES = ["manual", "wazuh", "network_scan", "import"] as const;
export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceType>;

/** Hodnocení CIA (důvěrnost / integrita / dostupnost), 1 = nízká … 4 = kritická. */
export const CiaLevel = z.number().int().min(1).max(4);

const optionalText = z.string().trim().max(500).optional().nullable();

/** Pole bez výchozích hodnot – základ pro vytvoření i PATCH. */
const AssetBase = z.object({
  name: z.string().trim().min(1).max(255),
  assetType: AssetType,
  assetClass: AssetClass.optional(),
  description: z.string().max(5000).optional().nullable(),
  hostname: optionalText,
  fqdn: optionalText,
  ipAddresses: z.array(z.string().trim()),
  macAddresses: z.array(z.string().trim()),
  osName: optionalText,
  osVersion: optionalText,
  manufacturer: optionalText,
  model: optionalText,
  serialNumber: optionalText,
  location: optionalText,
  ownerName: optionalText,
  ownerUserId: z.string().uuid().optional().nullable(),
  criticality: Criticality,
  confidentiality: CiaLevel.optional().nullable(),
  integrity: CiaLevel.optional().nullable(),
  availability: CiaLevel.optional().nullable(),
  lifecycleStatus: LifecycleStatus,
  environment: Environment.optional().nullable(),
  /** Aktivum je redundantní (cluster, záložní linka, HA) – není jediným bodem selhání (ADR-065). */
  redundant: z.boolean(),
  /** Dosažitelné z internetu – zvyšuje prioritu kritických a vysokých zranitelností (ADR-095). */
  internetFacing: z.boolean(),
  tags: z.array(z.string().trim().min(1)),
  attributes: z.record(z.string(), z.unknown()),
});

export const AssetInput = AssetBase.extend({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),

  ipAddresses: AssetBase.shape.ipAddresses.default([]),
  macAddresses: AssetBase.shape.macAddresses.default([]),
  criticality: Criticality.default("medium"),
  lifecycleStatus: LifecycleStatus.default("active"),
  redundant: z.boolean().default(false),
  internetFacing: z.boolean().default(false),
  tags: AssetBase.shape.tags.default([]),
  attributes: AssetBase.shape.attributes.default({}),
});
export type AssetInput = z.input<typeof AssetInput>;

/** PATCH – pouze zaslaná pole (žádné výchozí hodnoty, aby se nic nepřepsalo). */
export const AssetPatch = AssetBase.partial();
export type AssetPatch = z.input<typeof AssetPatch>;

export const AssetListQuery = z.object({
  /** `exclude` = jen aktiva vlastních společností, bez sdílených (ADR-085). */
  shared: z.enum(["exclude"]).optional(),
  q: z.string().optional(),
  assetType: AssetType.optional(),
  assetClass: AssetClass.optional(),
  criticality: Criticality.optional(),
  source: SourceType.optional(),
  ownerUserId: z.string().uuid().optional(),
  health: z.enum(["green", "orange", "red", "unknown"]).optional(),
  sort: z.enum(["name", "risk"]).default("name"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AssetListQuery = z.infer<typeof AssetListQuery>;

export interface AssetSourceDto {
  sourceType: SourceType;
  sourceRef: string;
  lastSyncedAt: string;
}

export interface AssetDto {
  id: string;
  /** Společnost skupiny, které aktivum patří. */
  companyId: string;
  name: string;
  assetType: AssetType;
  assetClass: AssetClass;
  description: string | null;
  hostname: string | null;
  fqdn: string | null;
  ipAddresses: string[];
  macAddresses: string[];
  osName: string | null;
  osVersion: string | null;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  ownerName: string | null;
  ownerUserId: string | null;
  criticality: Criticality;
  confidentiality: number | null;
  integrity: number | null;
  availability: number | null;
  redundant: boolean;
  internetFacing: boolean;
  lifecycleStatus: LifecycleStatus;
  environment: Environment | null;
  tags: string[];
  attributes: Record<string, unknown>;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  /** Semafor: green / orange / red / unknown + důvody. */
  healthStatus: "green" | "orange" | "red" | "unknown";
  healthReasons: { level: "red" | "orange"; code: string; text: string }[];
  vulnCritical: number;
  vulnHigh: number;
  vulnMedium: number;
  vulnLow: number;
  supportStatus: "supported" | "ending" | "eol" | "unknown";
  osEolDate: string | null;
  createdAt: string;
  updatedAt: string;
  sources?: AssetSourceDto[];
  /** Další společnosti skupiny, se kterými je aktivum sdílené (ADR-085). */
  sharedWith?: string[];
}

/** Sdílení aktiva s dalšími společnostmi holdingu (ADR-085). */
export const AssetShareInput = z.object({ companyIds: z.array(z.string().uuid()).max(200) });
export type AssetShareInput = z.infer<typeof AssetShareInput>;

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/* ---------- Discovery ---------- */

export const DISCOVERY_CONNECTORS = ["wazuh", "network_scan", "csv_import"] as const;
export const DiscoveryConnector = z.enum(DISCOVERY_CONNECTORS);
export type DiscoveryConnector = z.infer<typeof DiscoveryConnector>;

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface DiscoveryRunDto {
  id: string;
  connector: DiscoveryConnector;
  status: RunStatus;
  params: Record<string, unknown>;
  stats: { discovered?: number; created?: number; updated?: number; conflicts?: number; failed?: number };
  error: string | null;
  log: string[];
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export const NetworkScanRequest = z.object({
  targets: z.array(z.string().trim().min(1)).min(1).max(32),
  profile: z.enum(["ping", "standard", "os_detect"]).default("standard"),
});
export type NetworkScanRequest = z.input<typeof NetworkScanRequest>;

export const LABELS = {
  assetType: {
    server: "Server",
    workstation: "Pracovní stanice",
    laptop: "Notebook",
    virtual_machine: "Virtuální stroj",
    container: "Kontejner",
    network_device: "Síťové zařízení",
    security_device: "Bezpečnostní zařízení",
    storage: "Úložiště",
    mobile_device: "Mobilní zařízení",
    iot_ot: "IoT / OT",
    printer: "Tiskárna",
    cloud_resource: "Cloudový zdroj",
    application: "Aplikace",
    database: "Databáze",
    saas_service: "SaaS služba",
    information_asset: "Informační aktivum",
    facility: "Objekt / prostory",
    other: "Ostatní",
    business_service: "Služba",
    business_process: "Proces / činnost",
    personnel: "Zaměstnanci / role",
    supplier: "Dodavatel",
  } satisfies Record<AssetType, string>,
  assetClass: { primary: "Primární", supporting: "Podpůrné" } satisfies Record<AssetClass, string>,
  criticality: { low: "Nízká", medium: "Střední", high: "Vysoká", critical: "Kritická" } satisfies Record<
    Criticality,
    string
  >,
  lifecycleStatus: {
    planned: "Plánované",
    active: "Aktivní",
    maintenance: "Údržba",
    retired: "Vyřazené",
    disposed: "Zlikvidované",
  } satisfies Record<LifecycleStatus, string>,
  environment: { production: "Produkce", test: "Test", development: "Vývoj", other: "Jiné" } satisfies Record<
    Environment,
    string
  >,
  source: { manual: "Ruční", wazuh: "Wazuh", network_scan: "Síťový sken", import: "Import" } satisfies Record<
    SourceType,
    string
  >,
} as const;

/* ---------- Vazby primární ↔ podpůrná aktiva ---------- */

export const AssetLinkInput = z.object({
  primaryId: z.string().uuid(),
  supportingId: z.string().uuid(),
  note: z.string().trim().max(500).optional().nullable(),
});
export type AssetLinkInput = z.input<typeof AssetLinkInput>;

export interface LinkedAssetDto {
  id: string;
  name: string;
  assetType: AssetType;
  assetClass: AssetClass;
  criticality: Criticality;
  confidentiality: number | null;
  integrity: number | null;
  availability: number | null;
  note: string | null;
}

/** Efektivní hodnocení CIA – podpůrné aktivum dědí maximum z primárních aktiv, která podporuje. */
export interface EffectiveCia {
  confidentiality: number | null;
  integrity: number | null;
  availability: number | null;
  inherited: boolean;
}

export function effectiveCia(
  own: { confidentiality: number | null; integrity: number | null; availability: number | null },
  primaries: { confidentiality: number | null; integrity: number | null; availability: number | null }[],
): EffectiveCia {
  const max = (k: "confidentiality" | "integrity" | "availability") => {
    const vals = [own[k], ...primaries.map((p) => p[k])].filter((v): v is number => v != null);
    return vals.length ? Math.max(...vals) : null;
  };
  const eff = { confidentiality: max("confidentiality"), integrity: max("integrity"), availability: max("availability") };
  const inherited =
    eff.confidentiality !== own.confidentiality || eff.integrity !== own.integrity || eff.availability !== own.availability;
  return { ...eff, inherited };
}

/* ---------- Nastavení konektorů (Administrace → Konektory) ---------- */

export const WazuhSettingsInput = z.object({
  enabled: z.boolean().default(true),
  url: z.string().trim().url("Zadejte URL, např. https://wazuh.firma.local:55000"),
  user: z.string().trim().min(1),
  /** Prázdné = ponechat uložené heslo. */
  password: z.string().max(500).optional(),
  verifyTls: z.boolean().default(true),
  includePackages: z.boolean().default(true),
  /** Zranitelnosti: Wazuh 4.8+ je ukládá do Wazuh Indexeru (port 9200). */
  vulnEnabled: z.boolean().default(true),
  indexerUrl: z.union([z.literal(""), z.string().trim().url("Zadejte URL indexeru, např. https://wazuh.firma.local:9200")]).optional(),
  indexerUser: z.string().trim().max(200).optional(),
  /** Prázdné = ponechat uložené heslo. */
  indexerPassword: z.string().max(500).optional(),
  indexerVerifyTls: z.boolean().default(true),
  indexPattern: z.string().trim().min(1).max(200).default("wazuh-states-vulnerabilities-*"),
  /** Automatická synchronizace aktiv a zranitelností – interval v hodinách (0 = jen ručně). */
  autoSyncHours: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(24)]).default(24),
});
export type WazuhSettingsInput = z.input<typeof WazuhSettingsInput>;

export const ScanSettingsInput = z.object({
  enabled: z.boolean(),
  allowedCidrs: z.array(z.string().trim().min(1)).max(50).default([]),
  nmapPath: z.string().trim().min(1).max(500).default("nmap"),
});
export type ScanSettingsInput = z.input<typeof ScanSettingsInput>;

export interface ConnectorSettingsDto {
  wazuh: {
    source: "db" | "env" | "none";
    enabled: boolean;
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
    /** Poslední synchronizace (ruční i automatická). */
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
  };
  networkScan: {
    source: "db" | "env";
    enabled: boolean;
    allowedCidrs: string[];
    nmapPath: string;
    nmapFound: string | null;
    nmapVersion: string | null;
    /** Detekce OS a SYN sken vyžadují root / CAP_NET_RAW. */
    privileged: boolean;
  };
}

export interface ConnectorTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}
