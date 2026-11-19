import { z } from "zod";
import type { Permission } from "./auth";
import type { ModuleKey } from "./modules";

/* ============================================================
 * Kvalita dat (v1.70, ADR-163): souhrnný seznam slabin v evidenci s hromadnou opravou odpovědnosti.
 * Kontroly se počítají při čtení (SQL), nic se nepersistuje; oprava jen nastaví odpovědnou osobu / funkci.
 * ============================================================ */

export const QUALITY_CHECKS = [
  "assets_no_owner",
  "assets_findings_no_tech",
  "primary_unrated",
  "risks_no_owner",
  "risks_unrated",
  "controls_no_owner",
  "controls_untested",
  "processes_no_owner",
  "findings_no_asset",
  "hosts_no_asset",
  "tasks_unassigned",
  "suppliers_no_contract",
  // v1.76 (ADR-169) – kontrola dat po nasazení útvarů a katalogu štítků
  "assets_unit_text",
  "assets_tags_uncatalogued",
  // v1.88 (ADR-183): kritičnost aktiva nižší než kritičnost procesu, který podporuje
  "assets_crit_below_process",
] as const;
export type QualityCheck = (typeof QUALITY_CHECKS)[number];

/** Hromadná oprava: osoba (uživatel) nebo funkční místo. */
export const QUALITY_FIXES = ["asset_owner", "asset_technical", "position", "unit", "normalize"] as const;
export type QualityFix = (typeof QUALITY_FIXES)[number];

export const QUALITY_META: Record<QualityCheck, { module: ModuleKey | null; perm: Permission; write: Permission; fix: QualityFix | null; weight: "high" | "medium" | "low" }> = {
  assets_no_owner: { module: "assets", perm: "assets:read", write: "assets:write", fix: "asset_owner", weight: "high" },
  assets_findings_no_tech: { module: "assets", perm: "assets:read", write: "assets:write", fix: "asset_technical", weight: "high" },
  primary_unrated: { module: "assets", perm: "assets:read", write: "assets:write", fix: null, weight: "medium" },
  risks_no_owner: { module: "risks", perm: "risks:read", write: "risks:write", fix: "position", weight: "high" },
  risks_unrated: { module: "risks", perm: "risks:read", write: "risks:write", fix: null, weight: "medium" },
  controls_no_owner: { module: "controls", perm: "controls:read", write: "controls:write", fix: "position", weight: "medium" },
  controls_untested: { module: "controls", perm: "controls:read", write: "controls:write", fix: null, weight: "medium" },
  processes_no_owner: { module: "processes", perm: "processes:read", write: "processes:write", fix: "position", weight: "medium" },
  findings_no_asset: { module: "sectests", perm: "sectests:read", write: "sectests:run", fix: null, weight: "medium" },
  hosts_no_asset: { module: "assets", perm: "assets:read", write: "assets:write", fix: null, weight: "low" },
  tasks_unassigned: { module: null, perm: "actions:read", write: "actions:write", fix: "position", weight: "medium" },
  suppliers_no_contract: { module: "suppliers", perm: "suppliers:read", write: "suppliers:write", fix: null, weight: "medium" },
  assets_unit_text: { module: "assets", perm: "assets:read", write: "assets:write", fix: "unit", weight: "low" },
  assets_tags_uncatalogued: { module: "assets", perm: "assets:read", write: "assets:write", fix: "normalize", weight: "low" },
  assets_crit_below_process: { module: "processes", perm: "assets:read", write: "assets:write", fix: null, weight: "medium" },
};

export const QUALITY_LABELS: Record<QualityCheck, string> = {
  assets_no_owner: "Aktiva bez vlastníka",
  assets_findings_no_tech: "Aktiva s nálezy bez technického garanta",
  primary_unrated: "Primární aktiva bez hodnocení CIA",
  risks_no_owner: "Rizika bez vlastníka",
  risks_unrated: "Neohodnocená rizika",
  controls_no_owner: "Opatření bez odpovědné funkce",
  controls_untested: "Zavedená opatření bez testu za 12 měsíců",
  processes_no_owner: "Procesy bez vlastníka",
  findings_no_asset: "Nálezy testů bez aktiva",
  hosts_no_asset: "Servery ze sběrače bez aktiva",
  tasks_unassigned: "Otevřené úkoly bez řešitele",
  suppliers_no_contract: "Významní dodavatelé bez platné smlouvy",
  assets_unit_text: "Aktiva s útvarem jen jako text (bez vazby na strukturu)",
  assets_tags_uncatalogued: "Aktiva se štítky mimo katalog nebo v jiném zápisu",
  assets_crit_below_process: "Aktiva s nižší kritičností než proces, který podporují (priorita nálezů)",
};

export interface QualityItem {
  id: string;
  companyId: string;
  label: string;
  link: string;
}
export interface QualityCheckDto {
  key: QualityCheck;
  count: number;
  items: QualityItem[];
  /** Uživatel smí hromadně opravit (oprávnění k zápisu alespoň v jedné společnosti položek). */
  canFix: boolean;
}
export interface QualityDto {
  checks: QualityCheckDto[];
  /** Podíl kontrol bez nálezu (%), jen z dostupných kontrol. */
  score: number | null;
  /** Vývoj skóre a počtu slabin z měsíčních snímků trendů aktivní společnosti (v1.71), nejstarší první. */
  history?: { period: string; score: number | null; issues: number | null }[];
}

/** Skóre kvality: podíl kontrol bez nálezu (%). */
export const qualityScore = (counts: number[]) => (counts.length ? Math.round((counts.filter((n) => n === 0).length / counts.length) * 100) : null);

/** Chybějící údaje, za které odpovídá konkrétní osoba (týdenní souhrn, v1.71). */
export const QUALITY_GAP_KINDS = ["asset_unrated", "asset_no_tech", "task_unassigned"] as const;
export type QualityGapKind = (typeof QUALITY_GAP_KINDS)[number];
export interface QualityGap {
  kind: QualityGapKind;
  label: string;
  link: string;
}

export const QualityFixInput = z
  .object({
    check: z.enum(QUALITY_CHECKS),
    ids: z.array(z.string().uuid()).min(1).max(500),
    userId: z.string().uuid().optional(),
    positionId: z.string().uuid().optional(),
    /** Útvar (oprava `unit`, v1.76). */
    unitId: z.string().uuid().optional(),
  })
  // nejvýš jeden cíl; bez cíle jen oprava `normalize` (ověří server)
  .refine((v) => [v.userId, v.positionId, v.unitId].filter(Boolean).length <= 1, { message: "Vyberte osobu, nebo funkční místo" });
export type QualityFixInput = z.infer<typeof QualityFixInput>;
