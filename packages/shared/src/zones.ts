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

const CIDR = /^(\d{1,3}\.){3}\d{1,3}(\/(\d|[12]\d|3[0-2]))?$/;
export const SecurityZoneInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(ZONE_KINDS).default("custom"),
  trust: z.number().int().min(0).max(4),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#64748b"),
  description: z.string().trim().max(2000).default(""),
  /** Rozsahy IPv4 (CIDR nebo jedna adresa). */
  cidrs: z.array(z.string().trim().regex(CIDR, "Rozsah zadejte jako 10.0.0.0/24")).max(200).default([]),
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
  flows: { fromId: string; toId: string; fromZone: string; toZone: string; level: ZoneFlowLevel }[];
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
/** Zóna pro sadu IP adres: nejpřesnější rozsah (nejdelší prefix); při shodě délky nižší pořadí zóny. */
export function matchZone<Z extends { id: string; cidrs: string[]; sortOrder: number }>(ips: string[], zones: Z[]): Z | null {
  let best: { z: Z; bits: number } | null = null;
  for (const ip of ips) {
    const v = ipToInt(ip);
    if (v === null) continue;
    for (const z of zones)
      for (const c of z.cidrs) {
        const r = cidrRange(c);
        if (!r || v < r[0] || v > r[1]) continue;
        if (!best || r[2] > best.bits || (r[2] === best.bits && z.sortOrder < best.z.sortOrder)) best = { z, bits: r[2] };
      }
  }
  return best?.z ?? null;
}

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
