import { z } from "zod";

/**
 * Lokality (v1.104.0, ADR-198): budovy, patra, místnosti a datová centra jsou aktiva typu `facility`
 * s druhem (`facilityKind`). Strom tvoří vazby „umístěno v“ (`located_in`) mezi aktivy –
 * stejná vazba umisťuje servery, racky a další techniku do místností. Bezpečnostní zóna a půdorys
 * mohou patřit do lokality; mapa zón se filtruje podle budovy.
 */

export const FACILITY_KINDS = ["site", "building", "floor", "room", "datacenter", "server_room", "technical_room", "other"] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/** Druhy, které mohou obsahovat jiné lokality (a v jakém pořadí se obvykle vnořují). */
export const FACILITY_RANK: Record<FacilityKind, number> = { site: 0, building: 1, floor: 2, room: 3, datacenter: 3, server_room: 3, technical_room: 3, other: 3 };

/** Prvky fyzické bezpečnosti evidované u lokality (vyhláška 410/2025 § 10 a 409/2025 – fyzická bezpečnost). */
export const PHYSICAL_CONTROLS = ["access_control", "intrusion_alarm", "cctv", "fire_detection", "fire_suppression", "hvac", "ups", "generator", "flood_detection", "visitor_log"] as const;
export type PhysicalControl = (typeof PHYSICAL_CONTROLS)[number];
export const PHYSICAL_LEVELS = ["yes", "partial", "no"] as const;
export type PhysicalLevel = (typeof PHYSICAL_LEVELS)[number];

export const FacilityPhysical = z.object({
  controls: z.partialRecord(z.enum(PHYSICAL_CONTROLS), z.enum(PHYSICAL_LEVELS)).default({}),
  note: z.string().trim().max(2000).default(""),
  address: z.string().trim().max(300).default(""),
  /** Datum poslední kontroly fyzické bezpečnosti (prohlídka, revize). */
  reviewedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});
export type FacilityPhysical = z.infer<typeof FacilityPhysical>;

/** Prvky, které musí mít místnost s technikou – chybějící jsou mezera (doporučení, ne povinnost vyhlášky do písmene). */
const REQUIRED: Partial<Record<FacilityKind, PhysicalControl[]>> = {
  datacenter: ["access_control", "intrusion_alarm", "cctv", "fire_detection", "fire_suppression", "hvac", "ups", "visitor_log"],
  server_room: ["access_control", "intrusion_alarm", "fire_detection", "hvac", "ups"],
  technical_room: ["access_control", "fire_detection"],
  building: ["access_control", "fire_detection"],
  site: ["access_control"],
};
export const requiredPhysical = (kind: FacilityKind | null | undefined): PhysicalControl[] => (kind ? (REQUIRED[kind] ?? []) : []);

/** Mezery fyzické bezpečnosti: povinný prvek není „ano“ (částečně = mezera, ale slabší). */
export function physicalGaps(kind: FacilityKind | null | undefined, p: Partial<FacilityPhysical> | null | undefined): { control: PhysicalControl; level: PhysicalLevel | null }[] {
  const c = p?.controls ?? {};
  return requiredPhysical(kind)
    .filter((k) => c[k] !== "yes")
    .map((k) => ({ control: k, level: c[k] ?? null }));
}

/** Smí lokalita druhu `child` ležet v lokalitě druhu `parent`? (např. budova ne v místnosti) */
export function canNest(parent: FacilityKind | null | undefined, child: FacilityKind | null | undefined): boolean {
  if (!parent || !child) return true;
  if (parent === "other" || child === "other") return true;
  return FACILITY_RANK[child] > FACILITY_RANK[parent] || (parent === "site" && child === "site");
}

/** Typy aktiv, které mohou obsahovat jiná aktiva (cíl vazby „umístěno v“). */
export const CONTAINER_TYPES = ["facility", "rack"] as const;

export interface LocationNodeDto {
  id: string;
  companyId: string;
  name: string;
  kind: FacilityKind | null;
  parentId: string | null;
  /** Cesta od kořene, bez této lokality. */
  path: { id: string; name: string }[];
  depth: number;
  criticality: string;
  physical: FacilityPhysical;
  gaps: { control: PhysicalControl; level: PhysicalLevel | null }[];
  zones: { id: string; name: string; color: string }[];
  /** Aktiva přímo v lokalitě (bez podřízených lokalit). */
  assetsDirect: number;
  /** Aktiva v lokalitě včetně podřízených. */
  assetsTotal: number;
  /** Kritická a vysoká aktiva včetně podřízených. */
  assetsCritical: number;
  maps: { id: string; name: string }[];
}

export interface LocationIssueDto {
  code: "located_in_non_container" | "multiple_locations" | "cycle" | "bad_nesting" | "critical_unplaced";
  assetId: string;
  assetName: string;
  /** Další aktiva v problému (cíle vazby, cyklus…). */
  related: { id: string; name: string }[];
}

export interface LocationsDto {
  nodes: LocationNodeDto[];
  issues: LocationIssueDto[];
  /** Servery, síťová a úložná technika bez umístění. */
  unplaced: number;
}

export interface LocationDetailDto extends LocationNodeDto {
  assets: { id: string; name: string; assetType: string; criticality: string; healthStatus: string; facilityKind: FacilityKind | null; viaRack: string | null }[];
}

export const LocationInput = z.object({
  name: z.string().trim().min(1).max(255),
  kind: z.enum(FACILITY_KINDS),
  parentId: z.string().uuid().nullable().default(null),
  criticality: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  physical: FacilityPhysical.optional(),
});
export type LocationInput = z.input<typeof LocationInput>;

export const LocationPatch = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  kind: z.enum(FACILITY_KINDS).optional(),
  parentId: z.string().uuid().nullable().optional(),
  criticality: z.enum(["low", "medium", "high", "critical"]).optional(),
  physical: FacilityPhysical.optional(),
});
export type LocationPatch = z.input<typeof LocationPatch>;

export const LocationAssetsInput = z.object({ assetIds: z.array(z.string().uuid()).min(1).max(500) });
export type LocationAssetsInput = z.input<typeof LocationAssetsInput>;

/** Typy techniky, u kterých je umístění očekávané (jinak „bez umístění“). */
export const PLACEABLE_TYPES = ["server", "network_device", "security_device", "storage", "rack", "iot_ot", "printer"] as const;

/* ---------- převod textového umístění na lokality (v1.108) ---------- */

export interface TextLocationDto {
  /** Text z pole „Umístění“ aktiv (bez vlastní lokality). */
  text: string;
  assets: number;
  /** Navržená cesta lokalit (rozdělení podle „›“, „>“ nebo „/“). */
  path: string[];
  /** Existující lokalita se stejnou cestou / názvem, pokud je. */
  matchId: string | null;
}

export const TextLocationImport = z.object({
  items: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(255),
        /** Cílová existující lokalita; null = založit podle cesty. */
        locationId: z.string().uuid().nullable().default(null),
        /** Druh nejhlubší nově založené lokality (vyšší úrovně: budova, patro). */
        kind: z.enum(FACILITY_KINDS).default("room"),
      }),
    )
    .min(1)
    .max(200),
});
export type TextLocationImport = z.input<typeof TextLocationImport>;

/** „Budova A › 2. patro / Serverovna“ → ["Budova A", "2. patro", "Serverovna"]. */
export const splitLocationText = (text: string) =>
  text
    .split(/\s*(?:›|>|\/|\|)\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 5);
