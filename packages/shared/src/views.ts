import { z } from "zod";

/* ============================================================
 * Uložené pohledy seznamů (v0.80, ADR-075): kombinace filtrů, řazení a seskupení pod názvem.
 * Stav pohledu je volný objekt stránky (validuje ho stránka při načtení); sdílený pohled vidí všichni se čtením stránky.
 * ============================================================ */

export const VIEW_PAGES = ["incidents", "soc_alerts", "risks", "controls", "suppliers"] as const;
export type ViewPage = (typeof VIEW_PAGES)[number];

export const SavedViewInput = z.object({
  name: z.string().trim().min(1).max(80),
  state: z.record(z.string(), z.unknown()).refine((s) => JSON.stringify(s).length <= 4000, "Pohled je příliš velký"),
  shared: z.boolean().default(false),
});
export type SavedViewInput = z.input<typeof SavedViewInput>;

export interface SavedViewDto {
  id: string;
  page: ViewPage;
  name: string;
  state: Record<string, unknown>;
  shared: boolean;
  mine: boolean;
  ownerName: string | null;
  updatedAt: string;
}

/** Řazení seznamu: sloupec + směr. */
export type SortDir = "asc" | "desc";
export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

/** Stabilní řazení podle hodnoty (null / prázdné vždy na konec). */
export function sortRows<T>(rows: T[], value: (r: T) => string | number | null | undefined, dir: SortDir): T[] {
  const m = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: value(r) }))
    .sort((a, b) => {
      const an = a.v == null || a.v === "";
      const bn = b.v == null || b.v === "";
      if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
      const c = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v), "cs", { numeric: true });
      return c ? c * m : a.i - b.i;
    })
    .map((x) => x.r);
}

/** Seskupení se zachováním pořadí (skupiny v pořadí prvního výskytu, nebo seřazené podle počtu). */
export function groupRows<T>(rows: T[], key: (r: T) => string, order: "first" | "count" = "count"): { key: string; rows: T[] }[] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  const out = [...m.entries()].map(([k, v]) => ({ key: k, rows: v }));
  return order === "count" ? out.sort((a, b) => b.rows.length - a.rows.length) : out;
}
