import { z } from "zod";

/* ============================================================
 * Přesun záznamů mezi společnostmi skupiny.
 * ============================================================ */

export const TRANSFER_ENTITIES = [
  "assets",
  "risks",
  "processes",
  "controls",
  "suppliers",
  "incidents",
  "audits",
  "changes",
  "policies",
  "courses",
  "plans",
  "objectives",
  "processing",
  "ai_systems",
  "cra_products",
] as const;
export type TransferEntity = (typeof TRANSFER_ENTITIES)[number];

export const TRANSFER_LABELS: Record<TransferEntity, string> = {
  processing: "činnost zpracování (vč. DPIA)",
  assets: "aktivum",
  risks: "riziko",
  processes: "proces (včetně BIA)",
  controls: "opatření",
  suppliers: "dodavatel",
  incidents: "incident",
  audits: "audit",
  changes: "změna",
  policies: "dokument",
  courses: "školení",
  plans: "plán kontinuity",
  objectives: "cíl ISMS",
  ai_systems: "AI systém (vč. FRIA)",
  cra_products: "produkt s digitálními prvky (vč. SBOM a hlášení)",
};

export const TransferInput = z.object({
  entity: z.enum(TRANSFER_ENTITIES),
  ids: z.array(z.string().uuid()).min(1).max(500),
  targetCompanyId: z.string().uuid(),
  /** Provést i přes upozornění na vazby, které z cílové společnosti nebudou vidět. */
  force: z.boolean().default(false),
  note: z.string().trim().max(1000).nullable().optional(),
});
export type TransferInput = z.input<typeof TransferInput>;

export interface TransferResult {
  moved: number;
  /** Upozornění (vazby na záznamy, které nejsou v cílové společnosti ani nadřazených). */
  warnings: string[];
  /** true = nic se nepřesunulo, je třeba potvrdit (`force`). */
  needsConfirmation: boolean;
}
