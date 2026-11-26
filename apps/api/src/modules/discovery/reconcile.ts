import type { AssetRow } from "../../db/schema";
import type { DiscoveredAsset } from "./types";

/**
 * Reconciliation = rozhodnutí, zda nalezené zařízení odpovídá existujícímu aktivu.
 * Čisté funkce bez DB – snadno testovatelné a později rozšiřitelné (AI návrhy duplicit).
 *
 * Pořadí shody (od nejsilnější):
 *   1. stejný zdroj + sourceRef  (řeší repository přes asset_sources)
 *   2. sériové číslo
 *   3. průnik MAC adres
 *   4. hostname (krátké jméno, case-insensitive)
 *   5. IP adresa – jen u skenu sítě (`matchByIp`), kde je adresa jedinou identitou zařízení (v1.103.1)
 * Shoda 2–5 se použije jen tehdy, když je jednoznačná (právě jeden kandidát).
 * Sériové číslo, MAC ani IP nespojí dvě zařízení s RŮZNÝM hostname (v1.103.1) – sdílené virtuální adaptéry
 * (FortiClient, AnyConnect, VMware) a klonované virtuály jinak slévaly různé počítače do jednoho aktiva.
 */

export type MatchReason = "serial" | "mac" | "hostname" | "ip";

/**
 * MAC adresy, které nejsou identitou zařízení: lokálně spravované (Wi-Fi Direct, Hyper-V vnitřní, VirtualBox host-only,
 * PANGP, Npcap loopback), multicast a pevné adresy virtuálních adaptérů VPN klientů a hypervizorů – stejné na všech počítačích.
 */
const SHARED_MACS = new Set([
  "00:09:0f:aa:00:01", // Fortinet FortiClient
  "00:09:0f:fe:00:01", // Fortinet
  "00:05:9a:3c:7a:00", // Cisco AnyConnect
  "00:05:9a:3c:78:00", // Cisco AnyConnect
  "00:50:56:c0:00:01", // VMware Workstation VMnet1
  "00:50:56:c0:00:08", // VMware Workstation VMnet8
  "00:ff:00:00:00:00",
]);
export function isSharedMac(mac: string): boolean {
  const m = normalizeMac(mac);
  if (!m) return true;
  const first = parseInt(m.slice(0, 2), 16);
  return (first & 0x02) !== 0 || (first & 0x01) !== 0 || SHARED_MACS.has(m);
}
/** MAC adresy použitelné k párování. */
export const identityMacs = (macs: string[] = []) => [...new Set(macs.map(normalizeMac).filter((m): m is string => !!m && !isSharedMac(m)))];

/** IP adresa použitelná k párování: ne loopback, link-local (APIPA 169.254/16, fe80::/10) ani nespecifikovaná. */
export function isIdentityIp(ip: string): boolean {
  const v = ip.trim().toLowerCase();
  if (!v || v === "0.0.0.0" || v === "::" || v === "::1") return false;
  if (v.startsWith("127.") || v.startsWith("169.254.")) return false;
  if (/^fe[89ab][0-9a-f]?:/.test(v)) return false;
  return true;
}

export function normalizeMac(mac: string): string | null {
  const hex = mac.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hex.length !== 12 || hex === "000000000000") return null;
  return hex.match(/.{2}/g)!.join(":");
}

export function shortHost(host?: string | null): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase().split(".")[0];
  return h || null;
}

const BAD_SERIALS = new Set(["", "0", "none", "n/a", "na", "default string", "to be filled by o.e.m.", "system serial number"]);

export function normalizeSerial(serial?: string | null): string | null {
  if (!serial) return null;
  const s = serial.trim();
  return BAD_SERIALS.has(s.toLowerCase()) ? null : s;
}

type Candidate = Pick<AssetRow, "id" | "serialNumber" | "macAddresses" | "hostname"> & { ipAddresses?: string[] };

export function pickMatch(
  item: DiscoveredAsset,
  candidates: Candidate[],
): { id: string; reason: MatchReason } | { ambiguous: string[] } | null {
  const rules: [MatchReason, (c: Candidate) => boolean][] = [];

  const serial = normalizeSerial(item.serialNumber);
  if (serial) rules.push(["serial", (c) => normalizeSerial(c.serialNumber) === serial]);

  const macs = new Set(identityMacs(item.macAddresses));
  if (macs.size) rules.push(["mac", (c) => c.macAddresses.some((m) => macs.has(normalizeMac(m) ?? ""))]);

  const host = shortHost(item.hostname);
  if (host) rules.push(["hostname", (c) => shortHost(c.hostname) === host]);

  const ips = new Set((item.ipAddresses ?? []).filter(isIdentityIp));
  if (item.matchByIp && ips.size) rules.push(["ip", (c) => (c.ipAddresses ?? []).some((x) => ips.has(x))]);

  // jiný hostname = jiné zařízení, i když se shoduje sériové číslo, MAC nebo IP
  const compatible = (c: Candidate) => !host || !shortHost(c.hostname) || shortHost(c.hostname) === host;
  for (const [reason, test] of rules) {
    const hits = candidates.filter((c) => test(c) && compatible(c));
    if (hits.length === 1) return { id: hits[0]!.id, reason };
    if (hits.length > 1) return { ambiguous: hits.map((h) => h.id) };
  }
  return null;
}

const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];

/**
 * Sloučení: discovery aktualizuje jen TECHNICKÉ atributy.
 * Řídicí atributy (vlastník, kritičnost, CIA, životní cyklus, popis, název) patří člověku
 * a konektor je nikdy nepřepisuje.
 */
export function mergeTechnical(existing: AssetRow, item: DiscoveredAsset): Partial<AssetRow> {
  const pick = <T>(incoming: T | null | undefined, current: T | null) => (incoming ?? current) as T | null;
  return {
    hostname: pick(item.hostname, existing.hostname),
    fqdn: pick(item.fqdn, existing.fqdn),
    ipAddresses: union(existing.ipAddresses, item.ipAddresses),
    macAddresses: union(existing.macAddresses, (item.macAddresses ?? []).map((m) => normalizeMac(m) ?? m)),
    osName: pick(item.osName, existing.osName),
    osVersion: pick(item.osVersion, existing.osVersion),
    manufacturer: pick(item.manufacturer, existing.manufacturer),
    model: pick(item.model, existing.model),
    serialNumber: pick(normalizeSerial(item.serialNumber), existing.serialNumber),
    attributes: { ...existing.attributes, ...(item.attributes ?? {}) },
    lastSeenAt: item.seenAt ?? new Date(),
  };
}
