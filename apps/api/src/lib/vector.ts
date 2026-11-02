import { sql, type SQL } from "drizzle-orm";

/* Vyhledávání podle významu nad pgvector (v1.07, ADR-103): pro běžné dimenze modelů existují částečné HNSW indexy
 * nad přetypováním (migrace 0084) – dotaz musí použít stejný výraz a literál dimenze, jinak index nepoužije. */
export const INDEXED_DIMS = [384, 768, 1024, 1536] as const;

/** Vzdálenost (kosinová) sloupce `col` od vektoru `v` + podmínka na dimenzi; `col` je pevný identifikátor z kódu. */
export function cosine(col: string, v: number[]): { dist: SQL; dims: SQL } {
  const d = v.length;
  if (!Number.isInteger(d) || d <= 0 || d > 16000) throw new Error("Neplatná dimenze vektoru");
  const lit = `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
  if ((INDEXED_DIMS as readonly number[]).includes(d)) {
    return { dist: sql`(${sql.raw(`(${col}::vector(${d}))`)} <=> ${lit}::vector(${sql.raw(String(d))}))`, dims: sql.raw(`vector_dims(${col}) = ${d}`) };
  }
  return { dist: sql`(${sql.raw(col)} <=> ${lit}::vector)`, dims: sql.raw(`vector_dims(${col}) = ${d}`) };
}

/** Dotaz pro fulltext: slova bez diakritiky jako předpony (hrubé „skloňování“ češtiny), spojení OR. */
export function prefixTsQuery(words: string[]): string | null {
  const parts = words
    .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, "").replace(/-/g, " ").trim())
    .filter((w) => w.length >= 3)
    .flatMap((w) => w.split(" "))
    .filter((w) => w.length >= 2)
    .map((w) => `${w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w}:*`);
  return parts.length ? [...new Set(parts)].slice(0, 12).join(" | ") : null;
}
