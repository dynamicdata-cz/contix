import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Síťové segmenty a hlídání neevidovaných zařízení (ADR-072).
 * Segment = pojmenované rozsahy (CIDR) + výjimky + profil nmapu + plán. Každý nalezený hostitel se porovná s evidencí
 * aktiv (IP, MAC, jméno); neevidovaný → alert SOC. Režim „inventory“ navíc zakládá / aktualizuje aktiva jako dosud.
 * ============================================================ */

export const NETSCAN_PROFILES = ["ping", "standard", "os_detect"] as const;
export const NETSCAN_MODES = ["monitor", "inventory"] as const;
export const NETSCAN_SCHEDULES = ["manual", "hourly", "every6h", "daily", "weekly"] as const;
export type NetScanSchedule = (typeof NETSCAN_SCHEDULES)[number];
export const NETSCAN_OBS_STATUSES = ["unknown", "known", "changed", "approved"] as const;
export type NetObsStatus = (typeof NETSCAN_OBS_STATUSES)[number];

export const NETSCAN_LABELS = {
  profile: { ping: "Jen dostupnost (ping)", standard: "Standardní (porty a služby)", os_detect: "S detekcí OS (vyžaduje root, jinak standardní)" },
  mode: { monitor: "Jen hlídat – alert na neevidovaná zařízení", inventory: "Evidovat – zakládat a aktualizovat aktiva" },
  schedule: { manual: "Jen ručně", hourly: "Každou hodinu", every6h: "Každých 6 hodin", daily: "Denně", weekly: "Týdně" },
  status: { unknown: "Neevidované", known: "V evidenci", changed: "Změna (jiná MAC)", approved: "Schválené mimo evidenci" },
  weekday: ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"],
} as const;

const IPV4_OR_CIDR = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const cidr = z.string().trim().regex(IPV4_OR_CIDR, "IPv4 adresa nebo rozsah CIDR (např. 10.0.0.0/24)");

export const NetSegmentInput = z.object({
  name: z.string().trim().min(1).max(200),
  cidrs: z.array(cidr).min(1).max(32),
  exclude: z.array(cidr).max(64).default([]),
  profile: z.enum(NETSCAN_PROFILES).default("ping"),
  mode: z.enum(NETSCAN_MODES).default("monitor"),
  schedule: z.enum(NETSCAN_SCHEDULES).default("manual"),
  /** Čas spuštění HH:MM (Europe/Prague) pro denní a týdenní plán. */
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("02:00"),
  /** Den v týdnu 0 = neděle (týdenní plán). */
  scheduleWeekday: z.number().int().min(0).max(6).default(1),
  /** Úroveň alertu na neevidované zařízení (0–15 jako Wazuh). */
  alertLevel: z.number().int().min(3).max(15).default(8),
  enabled: z.boolean().default(true),
  note: z.string().trim().max(1000).optional().nullable(),
  companyId: z.string().uuid().optional(),
});
export type NetSegmentInput = z.input<typeof NetSegmentInput>;
export const NetSegmentPatch = patchOf(NetSegmentInput.omit({ companyId: true }));

export const NetObsDecision = z.object({ note: z.string().trim().max(1000).optional().nullable() });
export const NetObsCreateAsset = z.object({ name: z.string().trim().min(1).max(255).optional(), assetType: z.string().max(40).optional() });
export const NetObsLink = z.object({ assetId: z.string().uuid() });

export interface NetSegmentDto {
  id: string;
  companyId: string;
  name: string;
  cidrs: string[];
  exclude: string[];
  profile: (typeof NETSCAN_PROFILES)[number];
  mode: (typeof NETSCAN_MODES)[number];
  schedule: NetScanSchedule;
  scheduleTime: string;
  scheduleWeekday: number;
  alertLevel: number;
  enabled: boolean;
  note: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunId: string | null;
  lastSummary: NetScanSummary | null;
  running: boolean;
  counts: Record<NetObsStatus, number>;
}
export interface NetScanSummary {
  up: number;
  known: number;
  unknown: number;
  newUnknown: number;
  changed: number;
  approved: number;
  alerts: number;
  error?: string | null;
}
export interface NetObservationDto {
  id: string;
  segmentId: string;
  segmentName: string;
  ip: string | null;
  mac: string | null;
  hostname: string | null;
  vendor: string | null;
  osName: string | null;
  openPorts: { port: number; protocol: string; service?: string; product?: string }[];
  status: NetObsStatus;
  assetId: string | null;
  assetName: string | null;
  alertId: string | null;
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
  note: string | null;
}

/* ---------- porovnání s evidencí ---------- */

export interface NetHost {
  ip: string | null;
  mac: string | null;
  hostname: string | null;
}
export interface NetAssetRef {
  id: string;
  name: string;
  hostname: string | null;
  fqdn: string | null;
  ipAddresses: string[];
  macAddresses: string[];
}
export type NetMatch = { status: "known"; assetId: string; by: "mac" | "ip" | "hostname" } | { status: "changed"; assetId: string; expectedMacs: string[] } | { status: "unknown" };

const normMac = (m: string | null | undefined) => {
  const hex = (m ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  return hex.length === 12 ? hex.match(/.{2}/g)!.join(":") : null;
};
const short = (h: string | null | undefined) => (h ? h.trim().toLowerCase().split(".")[0] || null : null);

/**
 * Hostitel ze skenu × aktiva. Pořadí: MAC (nejsilnější) → IP → jméno.
 * Shoda podle IP, ale aktivum má evidované jiné MAC a sken MAC zná → „changed“ (výměna zařízení / podvržení adresy).
 */
export function matchHost(h: NetHost, list: NetAssetRef[]): NetMatch {
  const mac = normMac(h.mac);
  if (mac) {
    const a = list.find((x) => x.macAddresses.some((m) => normMac(m) === mac));
    if (a) return { status: "known", assetId: a.id, by: "mac" };
  }
  if (h.ip) {
    const a = list.find((x) => x.ipAddresses.includes(h.ip!));
    if (a) {
      const macs = a.macAddresses.map(normMac).filter((x): x is string => !!x);
      if (mac && macs.length && !macs.includes(mac)) return { status: "changed", assetId: a.id, expectedMacs: macs };
      return { status: "known", assetId: a.id, by: "ip" };
    }
  }
  const s = short(h.hostname);
  if (s) {
    const a = list.find((x) => [x.hostname, x.fqdn].some((n) => short(n) === s));
    if (a) return { status: "known", assetId: a.id, by: "hostname" };
  }
  return { status: "unknown" };
}

/** Stabilní klíč hostitele v segmentu: MAC, jinak IP. */
export const netHostKey = (h: NetHost) => (normMac(h.mac) ? `mac:${normMac(h.mac)}` : `ip:${h.ip}`);

/* ---------- plán ---------- */

const TZ = "Europe/Prague";
function zoneOffsetMin(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - at.getTime()) / 60000);
}
function pragueDate(at: Date) {
  const off = zoneOffsetMin(at);
  const l = new Date(at.getTime() + off * 60000);
  return { y: l.getUTCFullYear(), m: l.getUTCMonth(), d: l.getUTCDate(), wd: l.getUTCDay() };
}
function pragueToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  const guess = new Date(Date.UTC(y, m, d, hh, mm));
  const off = zoneOffsetMin(new Date(guess.getTime() - zoneOffsetMin(guess) * 60000));
  return new Date(guess.getTime() - off * 60000);
}

/** Další plánované spuštění po `from` (null = jen ručně). */
export function nextScanAt(s: { schedule: NetScanSchedule; scheduleTime: string; scheduleWeekday: number }, from: Date): Date | null {
  if (s.schedule === "manual") return null;
  if (s.schedule === "hourly") return new Date(from.getTime() + 3600_000);
  if (s.schedule === "every6h") return new Date(from.getTime() + 6 * 3600_000);
  const [hh, mm] = s.scheduleTime.split(":").map(Number) as [number, number];
  const base = pragueDate(from);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(base.y, base.m, base.d + i));
    const cand = pragueToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm);
    if (cand <= from) continue;
    if (s.schedule === "weekly" && day.getUTCDay() !== s.scheduleWeekday) continue;
    return cand;
  }
  return null;
}
