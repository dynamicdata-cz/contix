import { z } from "zod";

/* ============================================================
 * Indikátory kompromitace – IOC (v0.59, ADR-054): evidence IP, domén, URL, hashů a e-mailů z alertů,
 * phishingu a ručně; zpětné vyhledání ve Wazuh Indexeru a v alertech CONTIXu; seznam k blokaci (export, feed).
 * ============================================================ */

export const SOC_IOC_TYPES = ["ip", "domain", "url", "hash", "email"] as const;
export type SocIocType = (typeof SOC_IOC_TYPES)[number];
export const SOC_IOC_ACTIONS = ["block", "monitor"] as const;
export type SocIocAction = (typeof SOC_IOC_ACTIONS)[number];
export type SocIocState = "active" | "expired" | "revoked";
/** Typy, pro které existuje feed k blokaci (firewall / proxy / EDR). */
export const SOC_IOC_FEED_TYPES = ["ip", "domain", "url", "hash"] as const;
export type SocIocFeedType = (typeof SOC_IOC_FEED_TYPES)[number];
/** Výchozí platnost IOC (dny) – indikátory stárnou, IP se recyklují. */
export const SOC_IOC_DEFAULT_DAYS = 90;
export const SOC_IOC_MAX_DAYS = 366;

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const EMAIL = /^[^\s@<>"]{1,64}@([a-z0-9-]+\.)+[a-z]{2,63}$/i;
const HASH = /^([a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i;
/** WHATWG URL (v prohlížeči i v Bunu) – sdílený balíček nemá typy DOM. */
const UrlCtor = (globalThis as unknown as { URL: new (s: string) => { protocol: string; hash: string; toString(): string } }).URL;

/** Vrátí zbraněnou podobu z „defanged“ zápisu (evil[.]com, hxxp://). */
export const refang = (v: string) => v.trim().replace(/\[\.\]|\(\.\)|\{\.\}/g, ".").replace(/^hxxp/i, "http").replace(/\[:\]/g, ":").replace(/\[@\]/g, "@");

/** Neškodný zápis pro zobrazení (doména a URL se nedají omylem otevřít). */
export function defang(type: SocIocType, v: string): string {
  if (type === "url") return v.replace(/^http/i, "hxxp").replace(/\./g, "[.]");
  if (type === "domain" || type === "email") return v.replace(/\./g, "[.]");
  return v;
}

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) return /^(::1?$|fc|fd|fe8|fe9|fea|feb)/i.test(ip);
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Typ podle hodnoty (hromadné zadání). */
export function detectIocType(raw: string): SocIocType | null {
  const v = refang(raw);
  if (/^https?:\/\//i.test(v)) return "url";
  if (IPV4.test(v) || (v.includes(":") && IPV6.test(v))) return "ip";
  if (HASH.test(v)) return "hash";
  if (EMAIL.test(v)) return "email";
  if (DOMAIN.test(v.toLowerCase().replace(/\.$/, ""))) return "domain";
  return null;
}

/** Normalizace a kontrola hodnoty; null = neplatná. */
export function normalizeIoc(type: SocIocType, raw: string): string | null {
  const v = refang(raw);
  switch (type) {
    case "ip":
      return IPV4.test(v) || (v.includes(":") && IPV6.test(v)) ? v.toLowerCase() : null;
    case "domain": {
      const d = v.toLowerCase().replace(/\.$/, "").replace(/^\*\./, "");
      return DOMAIN.test(d) ? d : null;
    }
    case "url":
      try {
        const u = new UrlCtor(v);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        u.hash = "";
        return u.toString().slice(0, 2000);
      } catch {
        return null;
      }
    case "hash":
      return HASH.test(v) ? v.toLowerCase() : null;
    case "email":
      return EMAIL.test(v) ? v.toLowerCase() : null;
  }
}

export const iocState = (r: { revokedAt: string | Date | null; validUntil: string | null }, today = new Date().toISOString().slice(0, 10)): SocIocState =>
  r.revokedAt ? "revoked" : r.validUntil && r.validUntil < today ? "expired" : "active";

export interface SocIocHunt {
  at: string;
  days: number;
  /** Nálezy ve Wazuh Indexeru (alerty). */
  total: number;
  agents: { name: string; count: number; first: string | null; last: string | null }[];
  /** Alerty v CONTIXu, které hodnotu zmiňují. */
  contixAlerts: number;
  error: string | null;
}

export interface SocIocDto {
  id: string;
  companyId: string;
  type: SocIocType;
  value: string;
  display: string;
  action: SocIocAction;
  state: SocIocState;
  note: string;
  validUntil: string | null;
  sourceAlertId: string | null;
  sourceAlertTitle: string | null;
  lastHunt: SocIocHunt | null;
  /** Sdíleno do MISP (ADR-073). */
  mispEventId: string | null;
  mispSharedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

export const SocIocInput = z.object({
  items: z
    .array(z.object({ type: z.enum(SOC_IOC_TYPES).optional(), value: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(500),
  action: z.enum(SOC_IOC_ACTIONS).default("block"),
  validUntil: z.string().date().nullable().optional(),
  note: z.string().trim().max(1000).default(""),
  sourceAlertId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});
export type SocIocInput = z.input<typeof SocIocInput>;
export const SocIocPatch = z.object({ action: z.enum(SOC_IOC_ACTIONS).optional(), validUntil: z.string().date().nullable().optional(), note: z.string().trim().max(1000).optional() });
export type SocIocPatch = z.input<typeof SocIocPatch>;

export interface SocIocCreateResult {
  created: number;
  updated: number;
  rejected: { value: string; reason: "invalid" | "private_ip" }[];
}

/** Kandidát na IOC vytažený z alertu (nic se neukládá, dokud analytik nepotvrdí). */
export interface SocIocCandidate {
  type: SocIocType;
  value: string;
  display: string;
  reason: "srcip" | "sender" | "link" | "link_domain" | "origin" | "hash" | "dstip";
  existingId: string | null;
}

export interface SocIocFeedDto {
  id: string;
  companyId: string;
  name: string;
  tokenPrefix: string;
  fetches: number;
  lastFetchAt: string | null;
  createdAt: string;
}
export const SocIocFeedInput = z.object({ name: z.string().trim().min(2).max(120), companyId: z.string().uuid().optional() });
export type SocIocFeedInput = z.input<typeof SocIocFeedInput>;
export interface SocIocFeedSecret {
  feed: SocIocFeedDto;
  token: string;
}

const HASH_IN_TEXT = /\b([a-f0-9]{64}|[a-f0-9]{40}|[a-f0-9]{32})\b/gi;

/** Kandidáti z alertu: externí zdrojová IP, odesílatel a odkazy z phishingu, hashe v popisu. */
export function iocCandidatesOf(a: { source: string; description: string; sample: Record<string, unknown> | null }): Omit<SocIocCandidate, "existingId" | "display">[] {
  const s = (a.sample ?? {}) as Record<string, unknown>;
  const out: Omit<SocIocCandidate, "existingId" | "display">[] = [];
  const add = (type: SocIocType, raw: unknown, reason: SocIocCandidate["reason"]) => {
    if (typeof raw !== "string" || !raw) return;
    const v = normalizeIoc(type, raw.match(/<([^>]+)>/)?.[1] ?? raw);
    if (!v || (type === "ip" && isPrivateIp(v))) return;
    if (!out.some((x) => x.type === type && x.value === v)) out.push({ type, value: v, reason });
  };
  add("ip", s.srcip, a.source === "phishing" ? "origin" : "srcip");
  if (a.source === "phishing") {
    add("email", s.from, "sender");
    for (const k of ["replyTo", "returnPath"]) add("email", s[k], "sender");
    for (const d of (Array.isArray(s.domains) ? s.domains : []).slice(0, 20)) add("domain", d, "link_domain");
    for (const u of (Array.isArray(s.urls) ? s.urls : []).slice(0, 20)) add("url", u, "link");
  }
  for (const h of a.description.match(HASH_IN_TEXT) ?? []) add("hash", h, "hash");
  for (const k of ["sha256", "sha1", "md5"]) add("hash", s[k], "hash");
  return out.slice(0, 50);
}

export const SOC_IOC_LABELS = {
  type: { ip: "IP adresa", domain: "Doména", url: "URL", hash: "Hash souboru", email: "E-mail" } as Record<SocIocType, string>,
  action: { block: "Blokovat", monitor: "Sledovat" } as Record<SocIocAction, string>,
  state: { active: "Platný", expired: "Prošlý", revoked: "Zrušený" } as Record<SocIocState, string>,
  reason: { srcip: "zdrojová IP", sender: "odesílatel", link: "odkaz", link_domain: "doména odkazu", origin: "server odesílatele", hash: "hash", dstip: "cílová IP" } as Record<SocIocCandidate["reason"], string>,
  rejected: { invalid: "neplatná hodnota", private_ip: "interní adresu nelze blokovat" } as Record<SocIocCreateResult["rejected"][number]["reason"], string>,
};
