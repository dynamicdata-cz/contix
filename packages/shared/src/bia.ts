import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Analýza dopadů (BIA) – § 15 vyhlášky č. 409/2025 Sb.
 *  a) metodika analýzy dopadů, b) analýza a dokumentace dopadů se zohledněním hodnocení rizik,
 *  c) cíle kontinuity: 1. minimální úroveň služeb, 2. doba obnovení chodu (RTO), 3. bod obnovení dat (RPO).
 * Oblasti dopadu = oblasti hodnocení primárních aktiv (příl. č. 1 tab. č. 4 vyhl. 409/2025).
 * ============================================================ */

export const BIA_AREAS = [
  { key: "personal_data", label: "Osobní údaje", description: "Rozsah a důležitost osobních údajů, zvláštních kategorií osobních údajů." },
  { key: "legal", label: "Právní a smluvní povinnosti", description: "Rozsah dotčených právních povinností nebo jiných závazků nebo obchodního tajemství." },
  { key: "internal_control", label: "Řídicí a kontrolní činnosti", description: "Rozsah narušení vnitřních řídicích a kontrolních činností." },
  { key: "financial", label: "Finanční a ekonomické zájmy", description: "Poškození veřejných, obchodních nebo ekonomických zájmů a možné finanční ztráty." },
  { key: "services", label: "Poskytování důležitých služeb", description: "Dopady na poskytování důležitých služeb." },
  { key: "operations", label: "Běžné činnosti", description: "Rozsah narušení běžných činností." },
  { key: "reputation", label: "Dobré jméno", description: "Dopady na zachování dobrého jména nebo ochranu dobré pověsti." },
  { key: "safety", label: "Bezpečnost a zdraví osob", description: "Dopady na bezpečnost a zdraví osob." },
  { key: "international", label: "Mezinárodní vztahy", description: "Dopady na mezinárodní vztahy." },
  { key: "users", label: "Uživatelé regulované služby", description: "Dopady na uživatele regulované služby." },
] as const;
export type BiaAreaKey = (typeof BIA_AREAS)[number]["key"];

/** Časové body, ve kterých se dopad výpadku hodnotí. */
export const BIA_TIMEPOINTS = [
  { key: "1h", label: "1 hod", hours: 1 },
  { key: "4h", label: "4 hod", hours: 4 },
  { key: "1d", label: "1 den", hours: 24 },
  { key: "3d", label: "3 dny", hours: 72 },
  { key: "1w", label: "1 týden", hours: 168 },
  { key: "2w", label: "2 týdny+", hours: 336 },
] as const;
export type BiaTimepoint = (typeof BIA_TIMEPOINTS)[number]["key"];

/** Úrovně dopadu 0–4 (0 = žádný). 3 = vysoký = nepřípustný (pro odvození MTPD). */
export const BIA_IMPACT_LABELS = ["Žádný", "Nízký", "Střední", "Vysoký", "Kritický"] as const;

export const BIA_STATUSES = ["draft", "approved"] as const;

const level = z.number().int().min(0).max(4);
const hours = z.number().min(0).max(24 * 365).nullable().optional();

export const BiaInput = z.object({
  processId: z.string().uuid(),
  status: z.enum(BIA_STATUSES).default("draft"),
  assessedAt: z.string().date().nullable().optional(),
  /** impacts[area][timepoint] = 0–4 */
  impacts: z.record(z.string(), z.record(z.string(), level)).default({}),
  /** Maximální přijatelná doba výpadku (MTPD) v hodinách. */
  mtpdHours: hours,
  /** Doba obnovení chodu (RTO) – § 15 písm. c) bod 2. */
  rtoHours: hours,
  /** Bod obnovení dat (RPO) – § 15 písm. c) bod 3. */
  rpoHours: hours,
  /** Minimální úroveň poskytovaných služeb – § 15 písm. c) bod 1. */
  minServiceLevel: z.string().trim().max(5000).optional().nullable(),
  peakPeriods: z.string().trim().max(2000).optional().nullable(),
  dependencies: z.string().trim().max(5000).optional().nullable(),
  notes: z.string().trim().max(10000).optional().nullable(),
});
export type BiaInput = z.input<typeof BiaInput>;
export const BiaPatch = patchOf(BiaInput.omit({ processId: true }));

export interface BiaListItem {
  id: string;
  companyId: string;
  processId: string;
  processCode: string | null;
  processName: string;
  processCriticality: string;
  status: (typeof BIA_STATUSES)[number];
  assessedAt: string | null;
  maxImpact: number;
  mtpdHours: number | null;
  rtoHours: number | null;
  rpoHours: number | null;
  /** Požadovaná úroveň dostupnosti (1–4) odvozená z RTO. */
  requiredAvailability: number | null;
  /** Aktiva procesu s nižším hodnocením dostupnosti, než odpovídá RTO. */
  availabilityGaps: number;
  warnings: string[];
  updatedAt: string;
}

export interface BiaDetail extends BiaListItem {
  impacts: Record<string, Record<string, number>>;
  minServiceLevel: string | null;
  peakPeriods: string | null;
  dependencies: string | null;
  notes: string | null;
  suggestedMtpdHours: number | null;
  assets: { id: string; name: string; assetType: string; assetClass: string; availability: number | null; gap: boolean }[];
  canEdit: boolean;
}

/** MTPD návrh = první časový bod, kdy některá oblast dosáhne vysokého (≥ 3) dopadu. */
export function suggestMtpd(impacts: Record<string, Record<string, number>>): number | null {
  for (const tp of BIA_TIMEPOINTS) {
    if (Object.values(impacts).some((a) => (a?.[tp.key] ?? 0) >= 3)) return tp.hours;
  }
  return null;
}

export function maxImpact(impacts: Record<string, Record<string, number>>): number {
  return Math.max(0, ...Object.values(impacts).flatMap((a) => Object.values(a ?? {})));
}

/**
 * Požadovaná úroveň dostupnosti aktiv (příl. č. 1 tab. č. 3 vyhl. 409/2025) podle RTO:
 * kritická = nepřípustný výpadek několika minut, vysoká = několika hodin, střední = 1 pracovního dne, nízká = týdny.
 */
export function requiredAvailability(rtoHours: number | null | undefined): number | null {
  if (rtoHours == null) return null;
  if (rtoHours < 1) return 4;
  if (rtoHours < 8) return 3;
  if (rtoHours <= 24) return 2;
  return 1;
}

export function formatHours(h: number | null | undefined): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${h} h`;
  const d = h / 24;
  return Number.isInteger(d) ? `${d} d` : `${h} h`;
}

/** Kontroly konzistence BIA. */
export function biaWarnings(b: { mtpdHours?: number | null; rtoHours?: number | null; rpoHours?: number | null; minServiceLevel?: string | null }): string[] {
  const w: string[] = [];
  if (b.rtoHours == null) w.push("Chybí doba obnovení chodu (RTO) – § 15 písm. c) bod 2.");
  if (b.rpoHours == null) w.push("Chybí bod obnovení dat (RPO) – § 15 písm. c) bod 3.");
  if (!b.minServiceLevel) w.push("Chybí minimální úroveň poskytovaných služeb – § 15 písm. c) bod 1.");
  if (b.rtoHours != null && b.mtpdHours != null && b.rtoHours > b.mtpdHours) w.push("RTO je delší než maximální přijatelná doba výpadku (MTPD).");
  return w;
}
