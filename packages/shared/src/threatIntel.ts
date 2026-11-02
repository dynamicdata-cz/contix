import { z } from "zod";
import { isPrivateIp, normalizeIoc, detectIocType, type SocIocType } from "./socIoc";

/* ============================================================
 * Veřejné zdroje IOC (v0.62, ADR-057): abuse.ch URLhaus, ThreatFox, Feodo Tracker a vlastní seznamy.
 * Jen stahování (nic se neodesílá); porovnání s alerty a hledání ve Wazuh Indexeru probíhá lokálně.
 * ============================================================ */

export const TI_FEEDS = ["urlhaus", "threatfox", "feodo"] as const;
export type TiFeed = (typeof TI_FEEDS)[number];

/** Výchozí adresy; `{key}` = Auth-Key z auth.abuse.ch (klíč se posílá i v hlavičce Auth-Key). */
export const TI_FEED_DEFAULTS: Record<TiFeed, { url: string; needsKey: boolean }> = {
  urlhaus: { url: "https://urlhaus-api.abuse.ch/v2/files/exports/{key}/recent.csv", needsKey: true },
  threatfox: { url: "https://threatfox-api.abuse.ch/v2/files/exports/{key}/recent.csv", needsKey: true },
  feodo: { url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt", needsKey: false },
};
/** Nejvýše záznamů z jednoho zdroje (URLhaus „recent“ má desítky tisíc). */
export const TI_MAX_PER_FEED = 200_000;

export interface TiRecord {
  type: SocIocType;
  value: string;
  threat: string | null;
  confidence: number | null;
  firstSeen: string | null;
  reference: string | null;
}

export interface TiFeedState {
  at: string | null;
  count: number;
  error: string | null;
}
export interface TiCustomList {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface TiSettingsDto {
  autoRefresh: boolean;
  intervalHours: number;
  /** Hledat IP a domény ze zdrojů v nových alertech Wazuh Indexeru. */
  hunt: boolean;
  hasAuthKey: boolean;
  feeds: Record<TiFeed, { enabled: boolean; url: string }>;
  custom: TiCustomList[];
}
export interface TiStatusDto extends TiSettingsDto {
  state: Record<string, TiFeedState>;
  totals: { source: string; type: SocIocType; n: number }[];
  lastHunt: { at: string; since: string; hits: number; alerts: number; error: string | null } | null;
  matchedAlerts: number;
  /** Stahování z MISP zapnuto (ADR-073) – zdroj „misp“. */
  mispEnabled: boolean;
}

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/[^\s]+$/, "Neplatná adresa");
export const TiSettingsInput = z.object({
  autoRefresh: z.boolean().optional(),
  intervalHours: z.number().int().min(1).max(168).optional(),
  hunt: z.boolean().optional(),
  /** Prázdný řetězec = smazat, vynechat = ponechat. */
  authKey: z.string().trim().max(200).optional(),
  feeds: z.record(z.enum(TI_FEEDS), z.object({ enabled: z.boolean(), url: httpsUrl })).optional(),
  custom: z
    .array(z.object({ id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/), name: z.string().trim().min(2).max(80), url: httpsUrl, enabled: z.boolean() }))
    .max(20)
    .optional(),
});
export type TiSettingsInput = z.input<typeof TiSettingsInput>;

/** Shoda alertu s veřejným zdrojem. */
export interface TiMatch {
  source: string;
  type: SocIocType;
  value: string;
  threat: string | null;
  confidence: number | null;
}

/* ---------- parsery ---------- */

/** Jednoduchý CSV parser (uvozovky, zdvojené uvozovky). */
export function csvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Sloupce z poslední komentářové hlavičky („# id,dateadded,url,…“) nebo z první řádky bez #. */
function columns(lines: string[], known: string): { cols: string[]; rows: string[] } {
  let cols: string[] = [];
  const rows: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    if (t.startsWith("#")) {
      const c = csvRow(t.replace(/^#\s*/, "")).map((x) => x.toLowerCase());
      if (c.includes(known)) cols = c;
      continue;
    }
    if (!cols.length && csvRow(t).map((x) => x.toLowerCase()).includes(known)) {
      cols = csvRow(t).map((x) => x.toLowerCase());
      continue;
    }
    rows.push(t);
  }
  return { cols, rows };
}
const dateOf = (v: string | undefined) => {
  if (!v) return null;
  const d = new Date(v.includes("T") ? v : `${v.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** URLhaus CSV: id, dateadded, url, url_status, last_online, threat, tags, urlhaus_link, reporter. */
export function parseUrlhausCsv(text: string): TiRecord[] {
  const { cols, rows } = columns(text.split(/\r?\n/), "url");
  const ix = (n: string, d: number) => (cols.length ? cols.indexOf(n) : d);
  const [iUrl, iDate, iThreat, iTags, iLink] = [ix("url", 2), ix("dateadded", 1), ix("threat", 5), ix("tags", 6), ix("urlhaus_link", 7)];
  const out: TiRecord[] = [];
  for (const r of rows) {
    const c = csvRow(r);
    const v = normalizeIoc("url", c[iUrl] ?? "");
    if (!v) continue;
    out.push({ type: "url", value: v, threat: [c[iThreat], c[iTags]].filter(Boolean).join(" · ").slice(0, 200) || null, confidence: null, firstSeen: dateOf(c[iDate]), reference: c[iLink]?.slice(0, 500) || null });
    if (out.length >= TI_MAX_PER_FEED) break;
  }
  return out;
}

const TF_TYPES: Record<string, SocIocType> = { "ip:port": "ip", ip: "ip", domain: "domain", url: "url", md5_hash: "hash", sha1_hash: "hash", sha256_hash: "hash" };
/** ThreatFox CSV: first_seen_utc, ioc_id, ioc_value, ioc_type, threat_type, fk_malware, malware_alias, malware_printable, last_seen_utc, confidence_level, reference, tags, … */
export function parseThreatfoxCsv(text: string): TiRecord[] {
  const { cols, rows } = columns(text.split(/\r?\n/), "ioc_value");
  const ix = (n: string, d: number) => (cols.length ? cols.indexOf(n) : d);
  const [iFirst, iVal, iType, iMal, iConf, iRef] = [ix("first_seen_utc", 0), ix("ioc_value", 2), ix("ioc_type", 3), ix("malware_printable", 7), ix("confidence_level", 9), ix("reference", 10)];
  const out: TiRecord[] = [];
  for (const r of rows) {
    const c = csvRow(r);
    const type = TF_TYPES[(c[iType] ?? "").toLowerCase()];
    if (!type) continue;
    const raw = type === "ip" ? (c[iVal] ?? "").replace(/:\d+$/, "") : (c[iVal] ?? "");
    const v = normalizeIoc(type, raw);
    if (!v || (type === "ip" && isPrivateIp(v))) continue;
    const conf = Number(c[iConf]);
    out.push({ type, value: v, threat: c[iMal]?.slice(0, 200) || null, confidence: Number.isFinite(conf) ? conf : null, firstSeen: dateOf(c[iFirst]), reference: c[iRef]?.slice(0, 500) || null });
    if (out.length >= TI_MAX_PER_FEED) break;
  }
  return out;
}

/** Prostý seznam (jedna hodnota na řádek, # komentáře; první token řádku) – Feodo Tracker i vlastní seznamy. */
export function parsePlainList(text: string, threat: string | null = null): TiRecord[] {
  const out: TiRecord[] = [];
  const seen = new Set<string>();
  for (const l of text.split(/\r?\n/)) {
    const t = l.replace(/[#;].*$/, "").trim().split(/[\s,]+/)[0] ?? "";
    if (!t) continue;
    const type = detectIocType(t);
    const v = type ? normalizeIoc(type, t) : null;
    if (!type || !v || (type === "ip" && isPrivateIp(v)) || seen.has(`${type}|${v}`)) continue;
    seen.add(`${type}|${v}`);
    out.push({ type, value: v, threat, confidence: null, firstSeen: null, reference: null });
    if (out.length >= TI_MAX_PER_FEED) break;
  }
  return out;
}

export function parseFeed(source: string, text: string): TiRecord[] {
  if (source === "urlhaus") return parseUrlhausCsv(text);
  if (source === "threatfox") return parseThreatfoxCsv(text);
  if (source === "feodo") return parsePlainList(text, "Botnet C2 (Feodo Tracker)");
  return parsePlainList(text);
}

export const TI_LABELS = {
  feed: { urlhaus: "abuse.ch URLhaus (škodlivé URL)", threatfox: "abuse.ch ThreatFox (IOC malwaru)", feodo: "abuse.ch Feodo Tracker (C2 botnetů)" } as Record<TiFeed, string>,
  misp: "MISP (atributy událostí)",
};
