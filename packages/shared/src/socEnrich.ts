import { z } from "zod";
import { isPrivateIp, normalizeIoc, type SocIocType } from "./socIoc";
import type { TiRecord } from "./threatIntel";

/* ============================================================
 * Cortex a MISP (v0.78, ADR-073).
 * Cortex = obohacení IOC analyzátory, jen ručně na pokyn analytika a jen povolenými analyzátory (allow-list).
 * MISP = stahování atributů do zdrojů hrozeb (porovnání s alerty a hledání ve Wazuhu jako u abuse.ch),
 * dotaz na hodnotu a sdílení IOC (jen ručně, s oprávněním soc:share).
 * Interní adresy a jména (soukromé IP, interní domény) se ven nikdy neposílají – `enrichGuard`.
 * ============================================================ */

export const ENRICH_PROVIDERS = ["cortex", "misp"] as const;
export type EnrichProvider = (typeof ENRICH_PROVIDERS)[number];
export const ENRICH_STATUSES = ["running", "done", "failed"] as const;
export type EnrichStatus = (typeof ENRICH_STATUSES)[number];
export const ENRICH_LEVELS = ["info", "safe", "suspicious", "malicious"] as const;
export type EnrichLevel = (typeof ENRICH_LEVELS)[number];

/** Taxonomie výsledku analyzátoru (Cortex `summary.taxonomies`). */
export interface EnrichTaxonomy {
  level: EnrichLevel;
  namespace: string;
  predicate: string;
  value: string;
}

/* ---------- ochrana interních údajů ---------- */

/** Přípony, které nikdy nejsou veřejné (RFC 6761/6762/8375 a běžné interní zvyklosti). */
const INTERNAL_SUFFIXES = ["local", "lan", "internal", "intranet", "corp", "home", "home.arpa", "localdomain", "test", "localhost"];

export type EnrichGuardReason = "invalid" | "private_ip" | "internal_domain";

const hostOf = (type: SocIocType, v: string): string | null => {
  if (type === "domain") return v;
  if (type === "email") return v.split("@")[1] ?? null;
  if (type === "url") return v.replace(/^https?:\/\//i, "").split(/[/:?#]/)[0]?.toLowerCase() ?? null;
  return null;
};

/** Smí hodnota opustit CONTIX? `{ value }` = ano (normalizovaná), `{ reason }` = ne. */
export function enrichGuard(type: SocIocType, raw: string, internalDomains: string[] = []): { value: string } | { reason: EnrichGuardReason } {
  const value = normalizeIoc(type, raw);
  if (!value) return { reason: "invalid" };
  if (type === "ip") return isPrivateIp(value) ? { reason: "private_ip" } : { value };
  const host = hostOf(type, value);
  if (host) {
    if (/^[\d.]+$/.test(host) || host.includes(":")) return isPrivateIp(host.replace(/^\[|\]$/g, "")) ? { reason: "private_ip" } : { value };
    if (!host.includes(".")) return { reason: "internal_domain" };
    const own = internalDomains.map((d) => d.toLowerCase().replace(/^\.+|\.+$/g, "")).filter(Boolean);
    if ([...INTERNAL_SUFFIXES, ...own].some((s) => host === s || host.endsWith(`.${s}`))) return { reason: "internal_domain" };
  }
  return { value };
}

/* ---------- Cortex ---------- */

/** Datový typ Cortexu pro IOC; u domény podle toho, co analyzátor umí (domain / fqdn). */
export function cortexDataType(type: SocIocType, supported: string[]): string | null {
  const want = type === "email" ? ["mail"] : type === "domain" ? ["domain", "fqdn"] : [type];
  return want.find((w) => supported.includes(w)) ?? null;
}

/** Odhad, zda analyzátor posílá hodnotu třetí straně (podle názvu z katalogu Cortex-Analyzers). */
export type CortexReach = "local" | "external" | "unknown";
const LOCAL_ANALYZERS = ["fileinfo", "yara", "maxmind", "misp", "eml", "emlparser", "capa", "floss", "clamav", "elasticsearch", "splunk", "cuckoo", "torproject", "abuse_finder", "msg_parser", "pefile", "oletools", "ldapquery", "malwareclustering"];
const EXTERNAL_ANALYZERS = [
  "virustotal", "abuseipdb", "shodan", "censys", "greynoise", "otx", "urlscan", "hybridanalysis", "ipinfo", "emailrep", "crtsh", "googlesafebrowsing", "robtex", "securitytrails",
  "pulsedive", "threatminer", "circlpassive", "domaintools", "ibmxforce", "malwarebazaar", "threatfox", "urlhaus", "dshield", "onyphe", "spamhaus", "phishtank", "fortiguard", "mnemonic",
  "dnsdb", "farsight", "hippocampe", "joesandbox", "anyrun", "triage", "vmray", "intezer", "unshortenlink", "whois", "dnslookingglass", "binaryedge", "zscaler", "riskiq", "passivetotal", "recordedfuture",
];
export function cortexReach(name: string): CortexReach {
  const n = name.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (LOCAL_ANALYZERS.some((p) => n.startsWith(p))) return "local";
  if (EXTERNAL_ANALYZERS.some((p) => n.startsWith(p))) return "external";
  return "unknown";
}

const LEVEL_ORDER: Record<EnrichLevel, number> = { info: 0, safe: 1, suspicious: 2, malicious: 3 };
export const levelOf = (v: unknown): EnrichLevel => (typeof v === "string" && (ENRICH_LEVELS as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as EnrichLevel) : "info");
/** Taxonomie z odpovědi Cortexu (neznámé úrovně = info, nejvýše 30). */
export function taxonomiesOf(report: unknown): EnrichTaxonomy[] {
  const t = (report as { summary?: { taxonomies?: unknown } } | null)?.summary?.taxonomies;
  if (!Array.isArray(t)) return [];
  return t.slice(0, 30).map((x: Record<string, unknown>) => ({ level: levelOf(x.level), namespace: String(x.namespace ?? "").slice(0, 80), predicate: String(x.predicate ?? "").slice(0, 80), value: String(x.value ?? "").slice(0, 200) }));
}
/** Celkový verdikt = nejvyšší úroveň (malicious > suspicious > safe > info). */
export function verdictOf(t: { level: EnrichLevel }[]): EnrichLevel | null {
  if (!t.length) return null;
  return t.reduce<EnrichLevel>((a, x) => (LEVEL_ORDER[x.level] > LEVEL_ORDER[a] ? x.level : a), "info");
}

export interface CortexAnalyzer {
  id: string;
  name: string;
  dataTypes: string[];
  description: string;
  reach: CortexReach;
}

/* ---------- MISP ---------- */

export const MISP_DISTRIBUTIONS = [0, 1, 2, 3] as const;
export const MISP_TLPS = ["tlp:clear", "tlp:green", "tlp:amber", "tlp:amber+strict", "tlp:red"] as const;
export const MISP_THREAT_LEVELS = [1, 2, 3, 4] as const;

/** Atribut MISP → záznam zdroje hrozeb (jen typy, které CONTIX porovnává; soukromé IP vynechá). */
const MISP_TYPES: Record<string, SocIocType> = {
  "ip-src": "ip",
  "ip-dst": "ip",
  "ip-src|port": "ip",
  "ip-dst|port": "ip",
  domain: "domain",
  hostname: "domain",
  "domain|ip": "domain",
  "hostname|port": "domain",
  url: "url",
  md5: "hash",
  sha1: "hash",
  sha256: "hash",
  "filename|md5": "hash",
  "filename|sha1": "hash",
  "filename|sha256": "hash",
  "email-src": "email",
  "email-dst": "email",
  email: "email",
};
export const MISP_MAX_ATTRIBUTES = 200_000;

const unixIso = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

/** Odpověď `/attributes/restSearch` (returnFormat json) → záznamy zdroje hrozeb. */
export function parseMispAttributes(json: unknown, baseUrl: string): TiRecord[] {
  const r = (json as { response?: unknown; Attribute?: unknown } | null) ?? {};
  const resp = r.response as { Attribute?: unknown } | unknown[] | undefined;
  const list: Record<string, any>[] = Array.isArray(resp) ? (resp as any[]) : Array.isArray((resp as any)?.Attribute) ? (resp as any).Attribute : Array.isArray(r.Attribute) ? (r.Attribute as any[]) : [];
  const base = baseUrl.replace(/\/+$/, "");
  const out: TiRecord[] = [];
  const seen = new Set<string>();
  const add = (type: SocIocType, raw: string, a: Record<string, any>) => {
    const v = normalizeIoc(type, raw.trim());
    if (!v || (type === "ip" && isPrivateIp(v)) || seen.has(`${type}|${v}`)) return;
    seen.add(`${type}|${v}`);
    const tags = (Array.isArray(a.Tag) ? a.Tag : [])
      .map((t: { name?: string }) => String(t?.name ?? ""))
      .filter((n: string) => n && !/^tlp:/i.test(n))
      .slice(0, 3);
    const threat = [a.Event?.info, ...tags].filter(Boolean).join(" · ").slice(0, 200) || null;
    const eventId = a.event_id ?? a.Event?.id;
    out.push({ type, value: v, threat, confidence: null, firstSeen: a.first_seen ? new Date(a.first_seen).toISOString() : unixIso(a.timestamp), reference: eventId && base ? `${base}/events/view/${encodeURIComponent(String(eventId))}`.slice(0, 500) : null });
  };
  for (const a of list) {
    const mt = String(a?.type ?? "").toLowerCase();
    const type = MISP_TYPES[mt];
    const val = String(a?.value ?? "");
    if (!type || !val) continue;
    if (mt === "domain|ip") {
      const [d, ip] = val.split("|");
      add("domain", d ?? "", a);
      if (ip) add("ip", ip, a);
    } else if (mt.includes("|")) {
      const parts = val.split("|");
      add(type, (mt.startsWith("filename|") ? parts[1] : parts[0]) ?? "", a);
    } else add(type, val, a);
    if (out.length >= MISP_MAX_ATTRIBUTES) break;
  }
  return out;
}

/** IOC → atribut MISP pro sdílení. */
export function mispAttributeFor(type: SocIocType, value: string): { type: string; category: string; value: string } {
  if (type === "ip") return { type: "ip-dst", category: "Network activity", value };
  if (type === "domain") return { type: "domain", category: "Network activity", value };
  if (type === "url") return { type: "url", category: "Network activity", value };
  if (type === "email") return { type: "email-src", category: "Payload delivery", value };
  return { type: value.length === 32 ? "md5" : value.length === 40 ? "sha1" : "sha256", category: "Payload delivery", value };
}

/** Výsledek dotazu do MISP → taxonomie (nalezeno s to_ids = malicious, bez to_ids = suspicious). */
export function mispLookupTaxonomies(json: unknown): EnrichTaxonomy[] {
  const resp = (json as { response?: { Attribute?: any[] } } | null)?.response;
  const list: any[] = Array.isArray(resp?.Attribute) ? resp!.Attribute! : [];
  if (!list.length) return [{ level: "info", namespace: "MISP", predicate: "not_found", value: "" }];
  const events = new Map<string, { info: string; ids: boolean }>();
  for (const a of list) {
    const id = String(a.event_id ?? a.Event?.id ?? "");
    const cur = events.get(id);
    const ids = a.to_ids === true || a.to_ids === 1 || a.to_ids === "1";
    events.set(id, { info: String(a.Event?.info ?? cur?.info ?? "").slice(0, 120), ids: (cur?.ids ?? false) || ids });
  }
  return [...events.entries()].slice(0, 20).map(([id, e]) => ({ level: e.ids ? "malicious" : "suspicious", namespace: "MISP", predicate: `#${id}`, value: e.info || "—" }));
}

/* ---------- nastavení a DTO ---------- */

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/[^\s]+$/, "Neplatná adresa");
const domainEntry = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^\.?([a-z0-9-]+\.)*[a-z0-9-]+$/, "Neplatná doména")
  .max(200);
const tag = z.string().trim().min(1).max(120);

export const SocIntegrationsInput = z.object({
  internalDomains: z.array(domainEntry).max(50).optional(),
  cortex: z
    .object({
      enabled: z.boolean().optional(),
      url: z.union([httpUrl, z.literal("")]).optional(),
      verifyTls: z.boolean().optional(),
      /** Prázdný řetězec = smazat, vynechat = ponechat. */
      apiKey: z.string().trim().max(500).optional(),
      tlp: z.number().int().min(0).max(3).optional(),
      pap: z.number().int().min(0).max(3).optional(),
      allowed: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    })
    .optional(),
  misp: z
    .object({
      enabled: z.boolean().optional(),
      url: z.union([httpUrl, z.literal("")]).optional(),
      verifyTls: z.boolean().optional(),
      apiKey: z.string().trim().max(500).optional(),
      lookup: z.boolean().optional(),
      pull: z
        .object({
          enabled: z.boolean(),
          days: z.number().int().min(1).max(365),
          toIdsOnly: z.boolean(),
          publishedOnly: z.boolean(),
          tags: z.array(tag).max(30),
          excludeTags: z.array(tag).max(30),
        })
        .optional(),
      share: z
        .object({
          enabled: z.boolean(),
          distribution: z.number().int().min(0).max(3),
          tlp: z.enum(MISP_TLPS),
          threatLevel: z.number().int().min(1).max(4),
          publish: z.boolean(),
        })
        .optional(),
    })
    .optional(),
});
export type SocIntegrationsInput = z.input<typeof SocIntegrationsInput>;

export interface IntegrationCheck {
  at: string;
  ok: boolean;
  error: string | null;
  version: string | null;
}
export interface SocIntegrationsDto {
  internalDomains: string[];
  cortex: { enabled: boolean; url: string; verifyTls: boolean; hasApiKey: boolean; tlp: number; pap: number; allowed: string[]; analyzers: CortexAnalyzer[]; check: IntegrationCheck | null };
  misp: {
    enabled: boolean;
    url: string;
    verifyTls: boolean;
    hasApiKey: boolean;
    lookup: boolean;
    pull: { enabled: boolean; days: number; toIdsOnly: boolean; publishedOnly: boolean; tags: string[]; excludeTags: string[] };
    share: { enabled: boolean; distribution: number; tlp: (typeof MISP_TLPS)[number]; threatLevel: number; publish: boolean };
    check: IntegrationCheck | null;
  };
}

/** Co může analytik spustit (bez nastavení). */
export interface EnrichOptionsDto {
  cortex: { id: string; name: string; dataTypes: string[]; reach: CortexReach }[];
  mispLookup: boolean;
  mispShare: boolean;
}

export const EnrichRunInput = z
  .object({
    provider: z.enum(ENRICH_PROVIDERS),
    analyzerId: z.string().trim().min(1).max(200).optional(),
    type: z.enum(["ip", "domain", "url", "hash", "email"]),
    value: z.string().trim().min(1).max(2000),
    alertId: z.string().uuid().optional(),
    iocId: z.string().uuid().optional(),
  })
  .refine((v) => v.provider !== "cortex" || !!v.analyzerId, { message: "Vyberte analyzátor", path: ["analyzerId"] });
export type EnrichRunInput = z.input<typeof EnrichRunInput>;

export const MispShareInput = z.object({
  iocIds: z.array(z.string().uuid()).min(1).max(500),
  info: z.string().trim().min(3).max(300),
  distribution: z.number().int().min(0).max(3).optional(),
  tlp: z.enum(MISP_TLPS).optional(),
});
export type MispShareInput = z.input<typeof MispShareInput>;
export interface MispShareResult {
  eventId: string;
  eventUrl: string | null;
  shared: number;
  skipped: { value: string; reason: EnrichGuardReason | "revoked" }[];
}

export interface SocEnrichmentDto {
  id: string;
  provider: EnrichProvider;
  analyzer: string;
  type: SocIocType;
  value: string;
  display: string;
  status: EnrichStatus;
  verdict: EnrichLevel | null;
  taxonomies: EnrichTaxonomy[];
  /** Plná zpráva analyzátoru (zkrácená), jen v detailu. */
  report: unknown;
  error: string | null;
  alertId: string | null;
  iocId: string | null;
  createdByName: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export const ENRICH_LABELS = {
  provider: { cortex: "Cortex", misp: "MISP" } as Record<EnrichProvider, string>,
  status: { running: "Probíhá", done: "Dokončeno", failed: "Chyba" } as Record<EnrichStatus, string>,
  level: { info: "Informace", safe: "Bezpečné", suspicious: "Podezřelé", malicious: "Škodlivé" } as Record<EnrichLevel, string>,
  reach: { local: "Lokální", external: "Odesílá třetí straně", unknown: "Neověřeno" } as Record<CortexReach, string>,
  guard: { invalid: "neplatná hodnota", private_ip: "interní adresa se neodesílá", internal_domain: "interní jméno se neodesílá", revoked: "zrušený IOC" } as Record<EnrichGuardReason | "revoked", string>,
  distribution: { 0: "Jen vaše organizace", 1: "Tato komunita", 2: "Propojené komunity", 3: "Všechny komunity" } as Record<number, string>,
  threatLevel: { 1: "Vysoká", 2: "Střední", 3: "Nízká", 4: "Neurčená" } as Record<number, string>,
};
