import { z } from "zod";

/* ============================================================
 * Bezpečnostní zóny (v1.97, ADR-191): rozšiřitelný katalog zón sítě s úrovní důvěry. Výchozí sada pokrývá běžné
 * rozdělení (Internet, DMZ, hosté, uživatelé, servery, správa, OT); další zóny se přidávají jako vlastní
 * (druh „custom“ s vlastní úrovní důvěry). Aktiva se do zón řadí podle IP (nejpřesnější rozsah vyhrává), nebo ručně.
 * Vazby mezi aktivy přes hranici zón se hodnotí podle rozdílu důvěry (vyhl. 409/2025 – segmentace a ochrana hranic).
 * ============================================================ */

export const ZONE_KINDS = ["internet", "dmz", "guest", "user", "server", "management", "ot", "custom"] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];
/** Úroveň důvěry 0 (nedůvěryhodná) – 4 (nejcitlivější). */
export const ZONE_TRUST_LEVELS = [0, 1, 2, 3, 4] as const;
export const ZONE_TRUST_LABELS: Record<number, string> = {
  0: "Nedůvěryhodná",
  1: "Hraniční",
  2: "Vnitřní",
  3: "Chráněná",
  4: "Kritická",
};
export const ZONE_KIND_LABELS: Record<ZoneKind, string> = {
  internet: "Internet",
  dmz: "DMZ",
  guest: "Hosté",
  user: "Uživatelé",
  server: "Servery",
  management: "Správa",
  ot: "OT / průmyslové řízení",
  custom: "Vlastní",
};

/** Výchozí katalog – vytvoří se tlačítkem „Výchozí zóny“; rozsahy IP doplní správce. */
export const DEFAULT_ZONES: { kind: Exclude<ZoneKind, "custom">; name: string; trust: number; color: string; description: string }[] = [
  { kind: "internet", name: "Internet", trust: 0, color: "#94a3b8", description: "Vše mimo vlastní síť – veřejné služby, uživatelé z internetu, cloud bez VPN." },
  { kind: "dmz", name: "DMZ", trust: 1, color: "#f59e0b", description: "Služby dostupné z internetu (web, pošta, VPN brána, reverzní proxy)." },
  { kind: "guest", name: "Hosté", trust: 1, color: "#a78bfa", description: "Wi-Fi a připojení pro návštěvy – bez přístupu do vnitřní sítě." },
  { kind: "user", name: "Uživatelé", trust: 2, color: "#38bdf8", description: "Pracovní stanice a notebooky zaměstnanců, tiskárny." },
  { kind: "server", name: "Servery", trust: 3, color: "#22c55e", description: "Vnitřní servery a aplikace (AD, souborové služby, databáze, aplikační servery)." },
  { kind: "management", name: "Správa", trust: 4, color: "#ef4444", description: "Administrace infrastruktury: hypervizory, management rozhraní, zálohy, jump servery." },
  { kind: "ot", name: "OT / průmyslové řízení", trust: 4, color: "#e11d48", description: "Řídicí systémy, SCADA, PLC, měření a regulace – oddělené od kancelářské sítě." },
];

export const SecurityZoneInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(ZONE_KINDS).default("custom"),
  trust: z.number().int().min(0).max(4),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#64748b"),
  description: z.string().trim().max(2000).default(""),
  /** Rozsahy IPv4 i IPv6 (CIDR nebo jedna adresa; IPv6 od v1.101). */
  cidrs: z
    .array(
      z
        .string()
        .trim()
        .refine((c) => cidrRangeAny(c) !== null, "Rozsah zadejte jako 10.0.0.0/24 nebo 2001:db8::/64"),
    )
    .max(200)
    .default([]),
  sortOrder: z.number().int().min(0).max(999).default(100),
});
export type SecurityZoneInput = z.input<typeof SecurityZoneInput>;

export interface SecurityZoneDto {
  id: string;
  companyId: string;
  name: string;
  kind: ZoneKind;
  trust: number;
  color: string;
  description: string;
  cidrs: string[];
  sortOrder: number;
  assets: number;
  /** Aktiva se sběrem dat (agent, sběrač, Wazuh). */
  monitored: number;
  servers: number;
  workstations: number;
  internetFacing: number;
  openFindings: number;
}

export interface ZoneMapDto {
  zones: SecurityZoneDto[];
  assets: { id: string; name: string; assetType: string; zoneId: string | null; manual: boolean; health: string; monitored: boolean; internetFacing: boolean; criticality: string }[];
  /** Vazby (aktivum používá aktivum) přes hranici zón; `level` = hodnocení hranice. */
  flows: {
    fromId: string;
    toId: string;
    fromZone: string;
    toZone: string;
    level: ZoneFlowLevel;
    /** Vazba vede přes řízený přechod (firewall, proxy, jump server) – nález se nezakládá (v1.101). */
    control: { viaAssetId: string | null; viaName: string | null; note: string } | null;
  }[];
  /** Aktiva s IP mimo všechny zóny (návrh na doplnění rozsahů). */
  unassigned: number;
}
export type ZoneFlowLevel = "ok" | "warn" | "high";

/* ---------- IP a rozsahy ---------- */

export function ipToInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0]! << 24) >>> 0) + (p[1]! << 16) + (p[2]! << 8) + p[3]!;
}
/** Rozsah → [začátek, konec, délka prefixu]; jedna adresa = /32. */
export function cidrRange(cidr: string): [number, number, number] | null {
  const [ip, bits] = cidr.split("/");
  const base = ipToInt(ip ?? "");
  const n = bits === undefined ? 32 : Number(bits);
  if (base === null || !Number.isInteger(n) || n < 0 || n > 32) return null;
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  const start = (base & mask) >>> 0;
  return [start, (start + (n === 32 ? 0 : 2 ** (32 - n) - 1)) >>> 0, n];
}
/* ---------- IPv4 i IPv6 (v1.101) ---------- */

/** Adresa → rodina a číselná hodnota (bigint); IPv6 bez zóny rozhraní (%eth0), IPv4 mapované v IPv6 jako IPv4. */
export function parseIp(ip: string): { fam: 4 | 6; v: bigint } | null {
  const s = ip.trim().replace(/%.*$/, "").toLowerCase();
  const v4 = ipToInt(s);
  if (v4 !== null) return { fam: 4, v: BigInt(v4) };
  if (!s.includes(":") || !/^[0-9a-f:.]+$/.test(s)) return null;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const m = ipToInt(mapped[1]!);
    return m === null ? null : { fam: 4, v: BigInt(m) };
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (x: string) => (x ? x.split(":") : []);
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return { fam: 6, v: groups.reduce((acc, g) => (acc << 16n) | BigInt(parseInt(g, 16)), 0n) };
}

/** Rozsah IPv4 i IPv6 → rodina, začátek, konec a počet bitů hostitele (menší = přesnější rozsah). */
export function cidrRangeAny(cidr: string): { fam: 4 | 6; start: bigint; end: bigint; hostBits: number } | null {
  const [ip, bits, extra] = cidr.trim().split("/");
  if (extra !== undefined) return null;
  const a = parseIp(ip ?? "");
  if (!a) return null;
  const width = a.fam === 4 ? 32 : 128;
  if (bits !== undefined && !/^\d{1,3}$/.test(bits)) return null;
  const n = bits === undefined ? width : Number(bits);
  if (n < 0 || n > width) return null;
  const host = BigInt(width - n);
  const start = (a.v >> host) << host;
  return { fam: a.fam, start, end: start + (1n << host) - 1n, hostBits: width - n };
}

/** Zóna pro sadu IP adres: nejpřesnější rozsah (nejméně bitů hostitele); při shodě nižší pořadí zóny. IPv4 i IPv6. */
export function matchZone<Z extends { id: string; cidrs: string[]; sortOrder: number }>(ips: string[], zones: Z[]): Z | null {
  let best: { z: Z; host: number } | null = null;
  const ranges = zones.flatMap((z) => z.cidrs.map((c) => ({ z, r: cidrRangeAny(c) })));
  for (const ip of ips) {
    const a = parseIp(ip);
    if (!a) continue;
    for (const { z, r } of ranges) {
      if (!r || r.fam !== a.fam || a.v < r.start || a.v > r.end) continue;
      if (!best || r.hostBits < best.host || (r.hostBits === best.host && z.sortOrder < best.z.sortOrder)) best = { z, host: r.hostBits };
    }
  }
  return best?.z ?? null;
}

/** Je rozsah `inner` celý uvnitř některého z rozsahů `outer`? */
export function cidrCovered(inner: string, outer: string[]): boolean {
  const i = cidrRangeAny(inner);
  if (!i) return false;
  return outer.some((o) => {
    const r = cidrRangeAny(o);
    return !!r && r.fam === i.fam && r.start <= i.start && r.end >= i.end;
  });
}

/** Podsíť adresy pro návrh rozsahu: IPv4 /24, IPv6 /64. */
export function subnetOf(ip: string): string | null {
  const a = parseIp(ip);
  if (!a) return null;
  if (a.fam === 4) {
    const n = Number(a.v);
    return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.0/24`;
  }
  const net = (a.v >> 64n) << 64n;
  const g = Array.from({ length: 4 }, (_, i) => ((net >> BigInt(112 - i * 16)) & 0xffffn).toString(16));
  return `${g.join(":")}::/64`;
}

/** Druh zóny navržený podle typů aktiv v podsíti (většina), dostupnost z internetu → DMZ. */
export function suggestZoneKind(types: Record<string, number>, internetFacing: number): Exclude<ZoneKind, "custom" | "internet"> {
  const total = Object.values(types).reduce((a, b) => a + b, 0) || 1;
  if (internetFacing / total >= 0.5) return "dmz";
  const sum = (...k: string[]) => k.reduce((a, x) => a + (types[x] ?? 0), 0);
  const score: [Exclude<ZoneKind, "custom" | "internet">, number][] = [
    ["user", sum("workstation", "laptop", "printer", "mobile_device")],
    ["server", sum("server", "virtual_machine", "container", "database", "application", "storage")],
    ["management", sum("network_device", "security_device")],
    ["ot", sum("iot_ot")],
  ];
  score.sort((a, b) => b[1] - a[1]);
  return score[0]![1] > 0 ? score[0]![0] : "server";
}

export interface ZoneSuggestionDto {
  cidr: string;
  /** Odkud návrh je: síťový segment skenu (název) nebo podsíť z IP adres aktiv. */
  source: { kind: "segment"; name: string } | { kind: "assets" };
  /** Aktiva s IP v rozsahu, která zatím nejsou v žádné zóně. */
  assets: number;
  sample: string[];
  types: Record<string, number>;
  suggestedKind: Exclude<ZoneKind, "custom" | "internet">;
  /** Existující zóna navrženého druhu (pokud je). */
  suggestedZoneId: string | null;
}

export const ZoneSuggestionsApply = z.object({
  items: z
    .array(z.object({ cidr: z.string().trim().refine((c) => cidrRangeAny(c) !== null, "Neplatný rozsah"), zoneId: z.string().uuid() }))
    .min(1)
    .max(200),
});
export type ZoneSuggestionsApply = z.input<typeof ZoneSuggestionsApply>;

/** Řízený přechod pro vazbu přes hranici zón: zařízení (firewall, proxy, jump server) nebo popis. */
export const ZoneFlowControlInput = z
  .object({
    fromId: z.string().uuid(),
    toId: z.string().uuid(),
    viaAssetId: z.string().uuid().nullable().default(null),
    note: z.string().trim().max(500).default(""),
  })
  .refine((v) => v.viaAssetId || v.note, { message: "Vyberte zařízení řízeného přechodu nebo napište, jak je přechod řízen.", path: ["note"] });
export type ZoneFlowControlInput = z.input<typeof ZoneFlowControlInput>;

/**
 * Hodnocení vazby přes hranici zón (zdroj „používá“ cíl, tj. tok zdroj → cíl):
 * - do OT nebo Správy z jiné zóny než OT / Správa / Servery → vysoké riziko,
 * - skok o víc než jednu úroveň důvěry nahoru (např. Uživatelé → Správa, DMZ → Servery přímo) → vysoké,
 * - skok o jednu úroveň nahoru → upozornění (má být přes řízený přechod – firewall, proxy),
 * - stejná nebo nižší důvěra cíle → v pořádku.
 */
export function zoneFlowLevel(from: { kind: ZoneKind; trust: number }, to: { kind: ZoneKind; trust: number }): ZoneFlowLevel {
  if ((to.kind === "ot" || to.kind === "management") && !["ot", "management", "server"].includes(from.kind) && from.kind !== to.kind) return "high";
  const d = to.trust - from.trust;
  if (d > 1) return "high";
  if (d === 1) return "warn";
  return "ok";
}

/* ---------- kontroly zón (nálezy, zdroj „monitoring“) ---------- */
export const ZONE_CODES = ["zone_exposed_unmonitored", "zone_workstation_in_server", "zone_boundary_flow", "zone_unmonitored"] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];
