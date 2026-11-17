import { z } from "zod";
import { CRITICALITIES, ENVIRONMENTS, LIFECYCLE_STATUSES } from "./asset";
import { CONTROL_STATUSES } from "./controls";
import { PROCESS_TYPES } from "./process";

/* ============================================================
 * Hromadné úpravy v seznamech (v1.75, ADR-168): vybraným záznamům nastaví odpovědnost, štítky a vybrané atributy.
 * Každý záznam se ověří zvlášť (oprávnění ve společnosti záznamu, útvar / funkce ze stejné společnosti), nevyhovující
 * se přeskočí s důvodem; každá změna do auditu. Stav rizika se hromadně nemění (přijetí má vlastní schválení).
 * ============================================================ */

const ids = z.array(z.string().uuid()).min(1).max(500);
const tagList = z.array(z.string().trim().min(1).max(60)).max(20).optional();
const nullableId = z.string().uuid().nullable().optional();

export const AssetBulkInput = z.object({
  ids,
  set: z
    .object({
      ownerUnitId: nullableId,
      ownerUserId: nullableId,
      technicalOwnerUserId: nullableId,
      technicalDeputyUserId: nullableId,
      criticality: z.enum(CRITICALITIES).optional(),
      lifecycleStatus: z.enum(LIFECYCLE_STATUSES).optional(),
      environment: z.enum(ENVIRONMENTS).nullable().optional(),
    })
    .default({}),
  addTags: tagList,
  removeTags: tagList,
});
export type AssetBulkInput = z.input<typeof AssetBulkInput>;

export const RiskBulkInput = z.object({
  ids,
  set: z.object({ ownerPositionId: nullableId }).default({}),
  addTags: tagList,
  removeTags: tagList,
});
export type RiskBulkInput = z.input<typeof RiskBulkInput>;

export const ControlBulkInput = z.object({
  ids,
  set: z
    .object({
      ownerPositionId: nullableId,
      // „nepoužitelné“ vyžaduje zdůvodnění – jen v detailu
      status: z.enum(CONTROL_STATUSES.filter((s) => s !== "not_applicable") as [Exclude<(typeof CONTROL_STATUSES)[number], "not_applicable">, ...Exclude<(typeof CONTROL_STATUSES)[number], "not_applicable">[]]).optional(),
    })
    .default({}),
  addTags: tagList,
  removeTags: tagList,
});
export type ControlBulkInput = z.input<typeof ControlBulkInput>;

/** Procesy (v1.79): stav jen přes schvalování verzí, proto se hromadně nemění. */
export const ProcessBulkInput = z.object({
  ids,
  set: z
    .object({
      ownerPositionId: nullableId,
      orgUnitId: nullableId,
      criticality: z.enum(CRITICALITIES).optional(),
      processType: z.enum(PROCESS_TYPES).optional(),
    })
    .default({}),
  addTags: tagList,
  removeTags: tagList,
});
export type ProcessBulkInput = z.input<typeof ProcessBulkInput>;

/** Dodavatelé (v1.79): významnost, data mimo ČR, stav, interval a datum přezkumu. */
export const SupplierBulkInput = z.object({
  ids,
  set: z
    .object({
      ownerUnitId: nullableId,
      significant: z.boolean().optional(),
      dataOutsideCz: z.boolean().optional(),
      status: z.enum(["active", "ended"]).optional(),
      reviewIntervalMonths: z.number().int().min(1).max(36).optional(),
      lastReviewAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    })
    .default({}),
  addTags: tagList,
  removeTags: tagList,
});
export type SupplierBulkInput = z.input<typeof SupplierBulkInput>;

export interface BulkResultDto {
  updated: number;
  skipped: { id: string; reason: string }[];
}

/** Je co měnit (aspoň jedno pole nebo štítek). */
export const bulkHasChange = (i: { set?: Record<string, unknown>; addTags?: string[]; removeTags?: string[] }) =>
  Object.values(i.set ?? {}).some((v) => v !== undefined) || !!i.addTags?.length || !!i.removeTags?.length;
