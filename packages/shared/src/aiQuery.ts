import { z } from "zod";
import type { RecordKind } from "./recordSearch";

/* ============================================================
 * AI II (v0.20): dotazy v přirozeném jazyce nad daty, osobní API tokeny (MCP), duplicity aktiv.
 * ============================================================ */

export const AiQueryInput = z.object({ question: z.string().trim().min(3, "Zadejte dotaz").max(500) });
export type AiQueryInput = z.input<typeof AiQueryInput>;

export interface AiToolTable {
  columns: string[];
  rows: { cells: (string | number | null)[]; link: string | null }[];
  total: number;
  note?: string;
}

export interface AiQueryResult extends Partial<AiToolTable> {
  tool: string;
  title: string;
  args: Record<string, unknown>;
  error?: string;
}

export const AI_QUERY_STATUSES = ["running", "done", "error"] as const;
export type AiQueryStatus = (typeof AI_QUERY_STATUSES)[number];

/**
 * Úryvek z dokumentace nebo záznam evidence, ze kterého odpověď vychází (v0.50, jednotný AI vstup).
 * Číslo `n` odpovídá citaci [n] v odpovědi.
 */
export interface AiQuerySource {
  n: number;
  kind: "doc" | RecordKind;
  title: string;
  /** Kapitola dokumentu / druh výjimky apod. */
  subtitle: string | null;
  link: string;
  snippet: string;
}

export interface AiQueryDto {
  id: string;
  question: string;
  status: AiQueryStatus;
  answer: string | null;
  results: AiQueryResult[];
  /** Citované úryvky dokumentace a záznamy (prázdné u starších dotazů). */
  sources: AiQuerySource[];
  error: string | null;
  model: string | null;
  durationMs: number | null;
  createdAt: string;
  userName?: string | null;
}

export interface AiToolInfo {
  name: string;
  title: string;
  description: string;
}

export const MAX_QUERY_CALLS = 3;

/** Rychlý dotaz nabízený na nástěnce (podle oprávnění, modulů a aktuálního stavu). */
export interface AiQuickQuery {
  question: string;
  /** Zvýraznit (např. jsou věci po termínu). */
  hot?: boolean;
}

/** Ponechat jen citované zdroje; bez citací všechny (jen když nejsou tabulky z nástrojů). Čísla zůstávají. */
export function citedSources<T extends { n: number }>(answer: string, sources: T[], hasTables: boolean): T[] {
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  if (cited.size) return sources.filter((s) => cited.has(s.n));
  return hasTables ? [] : sources;
}

/**
 * Validace plánu modelu: `{"calls":[{"tool","args"}]}` (nebo rovnou pole).
 * Neznámé nástroje se zahodí, nejvýš MAX_QUERY_CALLS volání, args musí být objekt.
 */
export function parseQueryPlan(raw: unknown, known: Set<string>): { calls: { tool: string; args: Record<string, unknown> }[]; reply: string | null } {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(obj?.calls) ? (obj!.calls as unknown[]) : Array.isArray(obj?.tools) ? (obj!.tools as unknown[]) : [];
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const tool = String(r.tool ?? r.name ?? "").trim();
    if (!known.has(tool)) continue;
    const a = r.args ?? r.arguments ?? r.parameters ?? {};
    const args = a && typeof a === "object" && !Array.isArray(a) ? Object.fromEntries(Object.entries(a as Record<string, unknown>).filter(([, v]) => v !== null && v !== "")) : {};
    const key = `${tool}:${JSON.stringify(args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ tool, args });
    if (calls.length >= MAX_QUERY_CALLS) break;
  }
  const reply = typeof obj?.reply === "string" && obj.reply.trim() ? obj.reply.trim().slice(0, 2000) : null;
  return { calls, reply };
}

/* ---------- osobní API tokeny ---------- */

export const API_TOKEN_PREFIX = "ctx_";

export const ApiTokenInput = z.object({
  name: z.string().trim().min(1, "Zadejte název").max(120),
  /** Platnost ve dnech; null = bez expirace (nedoporučeno). */
  expiresInDays: z.number().int().min(1).max(730).nullable().default(90),
  companyId: z.string().uuid().nullable().optional(),
});
export type ApiTokenInput = z.input<typeof ApiTokenInput>;

export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  companyId: string | null;
  companyName: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/* ---------- duplicity aktiv ---------- */

export interface DuplicateAsset {
  id: string;
  name: string;
  hostname: string | null;
  assetType: string;
  serialNumber: string | null;
  ipAddresses: string[];
  macAddresses: string[];
  source: string | null;
  updatedAt: string;
  links: number;
}

export interface AssetDuplicatePair {
  a: DuplicateAsset;
  b: DuplicateAsset;
  /** Důvody shody (česky), např. „stejné sériové číslo“. */
  reasons: string[];
  /** 0–100; ≥ 80 velmi pravděpodobná duplicita. */
  score: number;
}

export const AssetMergeInput = z.object({
  keepId: z.string().uuid(),
  removeId: z.string().uuid(),
  /** Doplnit prázdná pole ponechaného aktiva hodnotami ze slučovaného. */
  fillEmpty: z.boolean().default(true),
});
export type AssetMergeInput = z.input<typeof AssetMergeInput>;

export const AssetDismissInput = z.object({ a: z.string().uuid(), b: z.string().uuid() });

/** Normalizace názvu pro porovnání (malá písmena, bez diakritiky, domény a oddělovačů). */
export function normalizeAssetName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.(local|lan|corp|intra|internal|[a-z0-9-]+\.[a-z]{2,})$/, "")
    .replace(/[^a-z0-9]/g, "");
}

export const normalizeMac = (m: string) => m.toLowerCase().replace(/[^0-9a-f]/g, "");

/** Podobnost řetězců 0–1 (Levenshtein na normalizovaných názvech). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeAssetName(a);
  const y = normalizeAssetName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const m = x.length;
  const n = y.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n]! / Math.max(m, n);
}

type DupInput = Pick<DuplicateAsset, "id" | "name" | "hostname" | "assetType" | "serialNumber" | "ipAddresses" | "macAddresses">;

/** Heuristika duplicity dvojice aktiv; null = nejde o kandidáta. */
export function duplicateReasons(a: DupInput, b: DupInput): { reasons: string[]; score: number } | null {
  const reasons: string[] = [];
  let score = 0;
  const sn = (v: string | null) => (v ?? "").trim().toLowerCase();
  if (sn(a.serialNumber) && sn(a.serialNumber) === sn(b.serialNumber)) {
    reasons.push("stejné sériové číslo");
    score += 60;
  }
  const macsA = new Set(a.macAddresses.map(normalizeMac).filter((m) => m.length === 12 && m !== "000000000000"));
  if (b.macAddresses.map(normalizeMac).some((m) => macsA.has(m))) {
    reasons.push("shodná MAC adresa");
    score += 50;
  }
  const hn = (v: string | null) => (v ? normalizeAssetName(v) : "");
  if (hn(a.hostname) && hn(a.hostname) === hn(b.hostname)) {
    reasons.push("stejný hostname");
    score += 40;
  }
  const ipsA = new Set(a.ipAddresses);
  if (b.ipAddresses.some((ip) => ipsA.has(ip) && ip !== "127.0.0.1")) {
    reasons.push("shodná IP adresa");
    score += 20;
  }
  const sim = nameSimilarity(a.name, b.name);
  if (sim === 1) {
    reasons.push("stejný název");
    score += 35;
  } else if (sim >= 0.85 && normalizeAssetName(a.name).length >= 5) {
    reasons.push(`podobný název (${Math.round(sim * 100)} %)`);
    score += 20;
  }
  if (!reasons.length) return null;
  if (a.assetType !== b.assetType) score -= 15;
  score = Math.max(0, Math.min(100, score));
  // samotná shoda IP (DHCP) nebo podobný název u různých typů nestačí
  if (score < 30) return null;
  return { reasons, score };
}

/* ---------- omezení MCP na IP adresy ---------- */

const normIp = (ip: string) => ip.trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, "");
const v4 = (ip: string): number | null => {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
};
const isV6 = (ip: string) => /^[0-9a-f:]+$/i.test(ip) && ip.includes(":");

/** IPv4 / IPv4 CIDR / IPv6 (přesná shoda). */
export function isIpOrCidr(v: string): boolean {
  const [ip, bits, extra] = normIp(v).split("/");
  if (extra !== undefined || !ip) return false;
  if (v4(ip) != null) return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
  return isV6(ip) && bits === undefined;
}

/** Je IP klienta v povoleném seznamu? */
export function ipAllowed(ip: string | null | undefined, allowed: string[]): boolean {
  if (!ip) return false;
  const c = normIp(ip);
  const cn = v4(c);
  return allowed.some((rule) => {
    const [base, bits] = normIp(rule).split("/");
    if (bits === undefined) return base === c;
    const bn = v4(base!);
    if (bn == null || cn == null) return false;
    const n = Number(bits);
    const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
    return (bn & mask) === (cn & mask);
  });
}
