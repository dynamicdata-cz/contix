import { z } from "zod";

/* ============================================================
 * Společné štítky (v1.52, ADR-149): jeden katalog pro všechny evidence (např. „dostupné z internetu“).
 * ============================================================ */

export const TAG_ENTITIES = ["asset", "risk", "supplier", "process", "control", "location"] as const;
export type TagEntity = (typeof TAG_ENTITIES)[number];

/** Oprávnění k zápisu štítků daného záznamu (stejné jako k úpravě záznamu). */
export const TAG_ENTITY_WRITE_PERM: Record<TagEntity, string> = {
  asset: "assets:write",
  risk: "risks:write",
  supplier: "suppliers:write",
  process: "processes:write",
  control: "controls:write",
  location: "suppliers:write",
};
export const TAG_ENTITY_READ_PERM: Record<TagEntity, string> = {
  asset: "assets:read",
  risk: "risks:read",
  supplier: "suppliers:read",
  process: "processes:read",
  control: "controls:read",
  location: "suppliers:read",
};
export const TAG_ENTITY_LABELS: Record<TagEntity, string> = {
  asset: "Aktivum",
  risk: "Riziko",
  supplier: "Dodavatel",
  process: "Proces",
  control: "Opatření",
  location: "Umístění dat",
};

export const TAG_COLORS = ["slate", "blue", "green", "amber", "red", "violet"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const TagName = z.string().trim().min(1).max(60);
export const TagInput = z.object({ name: TagName, color: z.enum(TAG_COLORS).default("slate"), description: z.string().trim().max(500).nullable().optional() });
export type TagInput = z.input<typeof TagInput>;
export const TagAssignInput = z.object({ names: z.array(TagName).max(30) });

export interface TagDto {
  id: string;
  name: string;
  color: TagColor;
  description: string | null;
  /** Počet záznamů (v rozsahu uživatele) včetně textových štítků aktiv. */
  count: number;
}

export interface TaggedObjectDto {
  entityType: TagEntity;
  id: string;
  name: string;
  companyId: string;
}
