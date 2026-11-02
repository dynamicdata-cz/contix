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
 * Shoda 2–4 se použije jen tehdy, když je jednoznačná (právě jeden kandidát).
 */

export type MatchReason = "serial" | "mac" | "hostname";

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

type Candidate = Pick<AssetRow, "id" | "serialNumber" | "macAddresses" | "hostname">;

export function pickMatch(
  item: DiscoveredAsset,
  candidates: Candidate[],
): { id: string; reason: MatchReason } | { ambiguous: string[] } | null {
  const rules: [MatchReason, (c: Candidate) => boolean][] = [];

  const serial = normalizeSerial(item.serialNumber);
  if (serial) rules.push(["serial", (c) => normalizeSerial(c.serialNumber) === serial]);

  const macs = new Set((item.macAddresses ?? []).map(normalizeMac).filter(Boolean));
  if (macs.size) rules.push(["mac", (c) => c.macAddresses.some((m) => macs.has(normalizeMac(m)))]);

  const host = shortHost(item.hostname);
  if (host) rules.push(["hostname", (c) => shortHost(c.hostname) === host]);

  for (const [reason, test] of rules) {
    const hits = candidates.filter(test);
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
