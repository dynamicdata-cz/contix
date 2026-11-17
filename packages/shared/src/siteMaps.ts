import { z } from "zod";

/* ============================================================
 * Mapy a půdorysy (v1.25, ADR-122): podklad (PDF, obrázek, DXF/DWG převedený na obrázek) a umístění aktiv
 * se stavem semaforu. Stav se počítá při čtení (`markerStatus`), nepersistuje se.
 * ============================================================ */

export const MAP_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp", "pdf", "dxf", "dwg"] as const;
/** Přípony, které se převádějí převodní službou na obrázek. */
export const MAP_CONVERT_EXTENSIONS = ["pdf", "dxf", "dwg"] as const;
export const MAP_MAX_BYTES = 30 * 1024 * 1024;

export const MARKER_STATUSES = ["red", "orange", "green", "unknown"] as const;
export type MarkerStatus = (typeof MARKER_STATUSES)[number];

export const MARKER_REASONS = ["incident", "alert_high", "alert", "health_red", "kev", "vuln_critical", "health_orange", "risk_unacceptable"] as const;
export type MarkerReason = (typeof MARKER_REASONS)[number];

export interface MarkerInput {
  health: string | null;
  openIncidents: number;
  /** Otevřené alerty SOC s vysokou závažností (úroveň pravidla ≥ 10). */
  alertsHigh: number;
  alerts: number;
  kev: number;
  critVulns: number;
  risksUnacceptable: number;
}

/**
 * Semafor prvku na mapě: červená = něco se děje (incident, závažný alert, KEV, červený stav aktiva),
 * oranžová = pozor (zranitelnosti, nepřijatelné riziko, oranžový stav, alert), zelená = stav aktiva v pořádku,
 * jinak bez dat.
 */
export function markerStatus(x: MarkerInput): { status: MarkerStatus; reasons: { key: MarkerReason; n: number }[] } {
  const reasons: { key: MarkerReason; n: number }[] = [];
  const add = (key: MarkerReason, n: number) => n > 0 && reasons.push({ key, n });
  add("incident", x.openIncidents);
  add("alert_high", x.alertsHigh);
  add("kev", x.kev);
  if (x.health === "red") reasons.push({ key: "health_red", n: 1 });
  const red = reasons.length > 0;
  add("alert", x.alerts - x.alertsHigh);
  add("vuln_critical", x.critVulns);
  add("risk_unacceptable", x.risksUnacceptable);
  if (x.health === "orange") reasons.push({ key: "health_orange", n: 1 });
  const status: MarkerStatus = red ? "red" : reasons.length ? "orange" : x.health === "green" ? "green" : "unknown";
  return { status, reasons };
}

export interface MapPlacementDto {
  assetId: string;
  name: string;
  assetType: string;
  x: number;
  y: number;
  status: MarkerStatus;
  reasons: { key: MarkerReason; n: number }[];
}

export interface SiteMapDto {
  id: string;
  companyId: string;
  name: string;
  site: string | null;
  building: string | null;
  floor: string | null;
  fileName: string;
  imageMime: string;
  createdAt: string;
  counts: Record<MarkerStatus, number>;
}

export interface SiteMapDetailDto extends SiteMapDto {
  placements: MapPlacementDto[];
}

export const SiteMapInput = z.object({
  name: z.string().trim().min(1).max(200),
  site: z.string().trim().max(200).nullable().optional(),
  building: z.string().trim().max(200).nullable().optional(),
  floor: z.string().trim().max(100).nullable().optional(),
});
export type SiteMapInput = z.input<typeof SiteMapInput>;

export const MapPlacementInput = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export type MapPlacementInput = z.input<typeof MapPlacementInput>;

export function markerCounts(list: { status: MarkerStatus }[]): Record<MarkerStatus, number> {
  const out = { red: 0, orange: 0, green: 0, unknown: 0 };
  for (const p of list) out[p.status]++;
  return out;
}

export const SITE_MAP_LABELS = {
  status: { red: "Něco se děje", orange: "Pozor", green: "V pořádku", unknown: "Bez dat" } satisfies Record<MarkerStatus, string>,
  reason: {
    incident: "Otevřený incident",
    alert_high: "Závažný alert SOC",
    alert: "Alert SOC",
    health_red: "Kritický stav aktiva",
    kev: "Aktivně zneužívaná zranitelnost (KEV)",
    vuln_critical: "Kritické / vysoké zranitelnosti",
    health_orange: "Stav aktiva vyžaduje pozornost",
    risk_unacceptable: "Nepřijatelné riziko",
  } satisfies Record<MarkerReason, string>,
};
