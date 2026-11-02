import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Hodnotící cykly – pravidelné (roční) hodnocení rizik (§ 8 odst. 1 písm. c) a BIA (§ 15).
 * Registr rizik / BIA je živý; cyklus vynutí přehodnocení nebo vědomé potvrzení každé položky
 * v rozsahu, po schválení se výsledek zmrazí (porovnání mezi roky).
 * ============================================================ */

export const CYCLE_KINDS = ["risk", "bia"] as const;
export type CycleKind = (typeof CYCLE_KINDS)[number];
export const CYCLE_STATUSES = ["in_progress", "review", "approved", "cancelled"] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];
export const CYCLE_REASONS = ["regular", "significant_change", "incident", "audit", "other"] as const;
export type CycleReason = (typeof CYCLE_REASONS)[number];
export const CYCLE_ITEM_STATES = ["pending", "reassessed", "confirmed", "excluded"] as const;
export type CycleItemState = (typeof CYCLE_ITEM_STATES)[number];

export const CYCLE_LABELS = {
  kind: { risk: "Hodnocení rizik", bia: "Analýza dopadů (BIA)" } satisfies Record<CycleKind, string>,
  status: { in_progress: "Probíhá", review: "Ke schválení", approved: "Schváleno", cancelled: "Zrušeno" } satisfies Record<CycleStatus, string>,
  reason: {
    regular: "Pravidelné (roční)",
    significant_change: "Významná změna (§ 11)",
    incident: "Po incidentu",
    audit: "Na základě auditu",
    other: "Jiný důvod",
  } satisfies Record<CycleReason, string>,
  item: { pending: "Čeká", reassessed: "Přehodnoceno", confirmed: "Potvrzeno beze změny", excluded: "Vyřazeno z rozsahu" } satisfies Record<CycleItemState, string>,
};

/** Interval pravidelného cyklu v měsících (vyhláška: alespoň jednou ročně). */
export const CYCLE_INTERVAL_MONTHS = 12;

export const CycleInput = z.object({
  companyId: z.string().uuid().optional(),
  kind: z.enum(CYCLE_KINDS),
  title: z.string().trim().min(1).max(300),
  reason: z.enum(CYCLE_REASONS).default("regular"),
  changeId: z.string().uuid().nullable().optional(),
  periodFrom: z.string().date().nullable().optional(),
  periodTo: z.string().date().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  leaderPositionId: z.string().uuid().nullable().optional(),
  team: z.string().trim().max(2000).nullable().optional(),
  scope: z.string().trim().max(5000).nullable().optional(),
  /** Omezení rozsahu na vybrané položky (rizika / BIA); prázdné = vše otevřené ve společnosti. */
  entityIds: z.array(z.string().uuid()).max(5000).default([]),
});
export type CycleInput = z.input<typeof CycleInput>;
export const CyclePatch = patchOf(CycleInput.omit({ companyId: true, kind: true, entityIds: true }));

export const CycleItemDecision = z.object({
  state: z.enum(["confirmed", "excluded", "pending"]),
  note: z.string().trim().max(2000).nullable().optional(),
});

/** Zmrazený stav položky (riziko / BIA) v okamžiku rozhodnutí. */
export interface CycleItemSnapshot {
  name: string;
  code: string | null;
  /** Rizika: skóre a úroveň (aktuální i zbytková), hodnoty; BIA: MTPD/RTO/RPO a max. dopad. */
  score?: number | null;
  level?: string | null;
  levelLabel?: string | null;
  residualScore?: number | null;
  residualLevel?: string | null;
  methodologyKey?: string;
  values?: Record<string, unknown>;
  ale?: number | null;
  mtpdHours?: number | null;
  rtoHours?: number | null;
  rpoHours?: number | null;
  maxImpact?: number | null;
}

export interface CycleItemDto {
  entityId: string;
  name: string;
  code: string | null;
  state: CycleItemState;
  note: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  /** Stav při zahájení cyklu a po rozhodnutí. */
  before: CycleItemSnapshot | null;
  after: CycleItemSnapshot | null;
  /** Aktuální stav položky v registru (pro probíhající cyklus). */
  current: CycleItemSnapshot | null;
}

export interface CycleListItem {
  id: string;
  companyId: string;
  kind: CycleKind;
  title: string;
  reason: CycleReason;
  status: CycleStatus;
  periodFrom: string | null;
  periodTo: string | null;
  dueDate: string | null;
  startedAt: string;
  approvedAt: string | null;
  leaderPositionName: string | null;
  counts: Record<CycleItemState, number>;
  total: number;
  overdue: boolean;
}

export interface CycleDetail extends CycleListItem {
  changeId: string | null;
  changeTitle: string | null;
  team: string | null;
  scope: string | null;
  leaderPositionId: string | null;
  approvedByName: string | null;
  approvalNote: string | null;
  items: CycleItemDto[];
  /** Předchozí schválený cyklus stejného druhu (pro porovnání). */
  previousId: string | null;
  canEdit: boolean;
}

export interface CycleCompareRow {
  entityId: string;
  name: string;
  code: string | null;
  before: CycleItemSnapshot | null;
  after: CycleItemSnapshot | null;
  change: "new" | "removed" | "worse" | "better" | "same";
}

export interface CycleStatusDto {
  kind: CycleKind;
  lastApprovedAt: string | null;
  lastApprovedId: string | null;
  nextDue: string | null;
  overdue: boolean;
  runningId: string | null;
}

const LEVEL_ORDER = ["low", "medium", "high", "critical"];
/** Porovnání dvou snímků položky (rizika podle úrovně, BIA podle RTO a max. dopadu). */
export function compareSnapshots(a: CycleItemSnapshot | null, b: CycleItemSnapshot | null): CycleCompareRow["change"] {
  if (!a && b) return "new";
  if (a && !b) return "removed";
  if (!a || !b) return "same";
  if (a.level !== undefined || b.level !== undefined) {
    const x = LEVEL_ORDER.indexOf(a.level ?? "");
    const y = LEVEL_ORDER.indexOf(b.level ?? "");
    return y > x ? "worse" : y < x ? "better" : "same";
  }
  const ia = a.maxImpact ?? 0;
  const ib = b.maxImpact ?? 0;
  if (ib !== ia) return ib > ia ? "worse" : "better";
  const ra = a.rtoHours ?? Infinity;
  const rb = b.rtoHours ?? Infinity;
  return rb < ra ? "worse" : rb > ra ? "better" : "same";
}

export function nextCycleDue(lastApprovedAt: string | null): string | null {
  if (!lastApprovedAt) return null;
  const d = new Date(lastApprovedAt);
  d.setUTCMonth(d.getUTCMonth() + CYCLE_INTERVAL_MONTHS);
  return d.toISOString().slice(0, 10);
}
