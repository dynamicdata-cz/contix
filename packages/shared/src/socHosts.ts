import type { SocAlertDto, SocLinkedRisk, SocSeverity } from "./soc";
import type { TiMatch } from "./threatIntel";

/* ============================================================
 * Pohled na hostitele (v0.66, ADR-061): vše, co SOC ví o jednom stroji – alerty, aktivita v čase,
 * taktiky ATT&CK, zranitelnosti, IOC a zdroje hrozeb, incidenty, případy, rizika, úkoly a zásahy.
 * Hostitel = aktivum (klíč `a:<id>`), u alertů bez aktiva krátké jméno agenta (`h:<jméno>`).
 * Počítá se při čtení, nic se nepersistuje.
 * ============================================================ */

export const hostKeyOfAsset = (assetId: string) => `a:${assetId}`;
export const hostKeyOfAgent = (agentName: string) => `h:${agentName.trim().toLowerCase().split(".")[0]}`;
export function parseHostKey(key: string): { kind: "asset"; id: string } | { kind: "agent"; name: string } | null {
  if (/^a:[0-9a-f-]{36}$/i.test(key)) return { kind: "asset", id: key.slice(2).toLowerCase() };
  if (/^h:[a-z0-9_-][a-z0-9_.-]{0,254}$/i.test(key)) return { kind: "agent", name: key.slice(2).toLowerCase() };
  return null;
}
/** Klíč hostitele alertu (null = alert bez hostitele, např. hlášení phishingu). */
export function hostKeyOf(a: { assetId: string | null; agentName: string | null }): string | null {
  if (a.assetId) return hostKeyOfAsset(a.assetId);
  if (a.agentName?.trim()) return hostKeyOfAgent(a.agentName);
  return null;
}

export interface SocHostListItem {
  key: string;
  companyId: string;
  assetId: string | null;
  name: string;
  agentName: string | null;
  criticality: string | null;
  total: number;
  open: number;
  severity: SocSeverity;
  exploit: boolean;
  intel: boolean;
  tactics: number;
  lastSeen: string;
}

export interface SocHostDay {
  day: string;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface SocHostDetail {
  key: string;
  companyId: string;
  name: string;
  days: number;
  asset: {
    id: string;
    name: string;
    assetType: string;
    criticality: string | null;
    healthStatus: string;
    confidentiality: number | null;
    integrity: number | null;
    availability: number | null;
    ipAddresses: string[];
    os: string | null;
  } | null;
  agentNames: string[];
  counts: { total: number; open: number; escalated: number; truePositive: number; falsePositive: number; exploit: number };
  daily: SocHostDay[];
  tactics: Record<string, number>;
  alerts: SocAlertDto[];
  vulns: { total: number; p1: number; p2: number; top: { cveId: string; severity: string; cvss: number | null; kev: boolean; epss: number | null; priority: number }[] } | null;
  intel: TiMatch[];
  iocs: { id: string; type: string; value: string; action: string }[];
  incidents: { id: string; code: string | null; title: string; status: string; detectedAt: string }[];
  cases: { id: string; code: string; title: string; status: string }[];
  risks: SocLinkedRisk[];
  tasks: { id: string; seq: number; title: string; status: string; dueDate: string | null; ownerPositionName: string | null; alertId: string | null }[];
  actions: { id: string; kind: string; target: string; status: string; createdAt: string }[];
}

/** Denní počty alertů podle závažnosti za posledních `days` dní (podle prvního výskytu, dny UTC). */
export function hostDaily(alerts: { firstSeen: string; severity: SocSeverity }[], days: number, now = new Date()): SocHostDay[] {
  const out: SocHostDay[] = [];
  const idx = new Map<string, SocHostDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 864e5).toISOString().slice(0, 10);
    const d = { day, low: 0, medium: 0, high: 0, critical: 0 };
    out.push(d);
    idx.set(day, d);
  }
  for (const a of alerts) {
    const d = idx.get(a.firstSeen.slice(0, 10));
    if (d) d[a.severity]++;
  }
  return out;
}
