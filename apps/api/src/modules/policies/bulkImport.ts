import {
  docImportColumns,
  DOC_IMPORT_MAX_ROWS,
  normName,
  parseDocImportRow,
  type DocImportPreviewDto,
  type DocImportRow,
} from "@contix/shared";
import { safeUnzip } from "../../lib/zip";
import { readTable, type Table } from "../import/table";

/* ============================================================
 * Hromadný import dokumentace (ADR-033): ZIP s tabulkou metadat (CSV / XLSX) a soubory dokumentů.
 * Čisté funkce – čtení archivu, výběr tabulky, párování souborů a rolí. Zápis řeší routes.ts.
 * ============================================================ */

export const IMPORT_ZIP_MAX = 100 * 1024 * 1024;
const FILE_EXT_ORDER = ["docx", "doc", "odt", "xlsx", "xls", "pptx", "pdf", "md", "txt"];

const isJunk = (p: string) => /(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(p) || /(^|\/)~\$/.test(p) || p.endsWith("/");
const base = (p: string) => p.split("/").pop() ?? p;
const ext = (p: string) => (base(p).split(".").pop() ?? "").toLowerCase();
const rank = (p: string) => (FILE_EXT_ORDER.includes(ext(p)) ? FILE_EXT_ORDER.indexOf(ext(p)) : 99);

export interface ImportArchive {
  metadataFile: string;
  table: Table;
  files: Map<string, Uint8Array>;
}

/** Rozbalí archiv a vybere tabulku metadat: má sloupce označení + název; přednost má tabulka se sloupcem „Soubor“, pak název s „metadata“. */
export function readImportZip(buf: Uint8Array): ImportArchive {
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error("Nahrajte ZIP archiv s tabulkou metadat a soubory dokumentů.");
  const all = safeUnzip(buf, { maxBytes: 300 * 1024 * 1024, maxEntries: 5000 });
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(all)) if (!isJunk(path) && data.length) files.set(path.replace(/\\/g, "/"), data);
  const candidates: { path: string; table: Table; score: number }[] = [];
  for (const [path, data] of files) {
    if (!/\.(csv|xlsx)$/i.test(path)) continue;
    let table: Table;
    try {
      table = readTable(data, path);
    } catch {
      continue;
    }
    const cols = docImportColumns(table.headers);
    if (cols.title == null || (cols.code == null && cols.docType == null)) continue;
    const score = (cols.file != null ? 100 : 0) + (/metadata/i.test(base(path)) ? 10 : 0) + (cols.owner != null ? 5 : 0) + Math.min(table.rows.length, 999) / 1000;
    candidates.push({ path, table, score });
  }
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best) throw new Error("Archiv neobsahuje tabulku metadat (CSV / XLSX se sloupci Označení/ID a Název).");
  if (best.table.rows.length > DOC_IMPORT_MAX_ROWS) throw new Error(`Tabulka má více než ${DOC_IMPORT_MAX_ROWS} řádků.`);
  return { metadataFile: best.path, table: best.table, files };
}

/** Najde soubor dokumentu: podle sloupce „Soubor“ (i s jinou kořenovou složkou v archivu), jinak podle označení na začátku názvu souboru. */
export function matchFile(files: Map<string, Uint8Array>, used: Set<string>, declared: string, code: string | null): string | null {
  const paths = [...files.keys()].filter((p) => !/\.(csv)$/i.test(p));
  if (declared) {
    const d = declared.replace(/\\/g, "/").replace(/^\.?\//, "");
    const hit = paths.find((p) => p === d || p.endsWith(`/${d}`)) ?? paths.find((p) => normName(base(p)) === normName(base(d)));
    if (hit) return hit;
  }
  if (!code) return null;
  const c = code.toLowerCase();
  const found = paths
    .filter((p) => !used.has(p))
    .filter((p) => {
      const b = base(p).toLowerCase();
      return b.startsWith(`${c}_`) || b.startsWith(`${c} `) || b.startsWith(`${c}.`);
    })
    .sort((a, b) => rank(a) - rank(b));
  return found[0] ?? null;
}

/** Náhled importu: řádky, chyby, soubory, role a jejich navržená funkční místa. */
export function buildPreview(
  archive: ImportArchive,
  existingCodes: Set<string>,
  positions: { id: string; name: string }[],
  decree: "cz409" | "cz410" = "cz409",
): DocImportPreviewDto {
  const cols = docImportColumns(archive.table.headers);
  const used = new Set<string>();
  const seen = new Set<string>();
  const rows: DocImportRow[] = archive.table.rows.map((r, i) => {
    const row = parseDocImportRow(cols, r, archive.table.lines[i] ?? i + 2, decree);
    const key = row.code?.toLowerCase();
    if (key && seen.has(key)) row.errors.push(`Označení ${row.code} je v tabulce vícekrát.`);
    if (key) seen.add(key);
    row.exists = !!key && existingCodes.has(key);
    const declared = cols.file != null ? (r[cols.file] ?? "").trim() : "";
    row.file = matchFile(archive.files, used, declared, row.code);
    if (row.file) used.add(row.file);
    else if (!row.errors.length) row.warnings.push(declared ? `Soubor „${declared}“ v archivu není – založí se dokument bez souboru.` : "Soubor dokumentu nenalezen – založí se dokument bez souboru.");
    return row;
  });
  // nadřazený dokument musí být v importu nebo už existovat
  const codes = new Set([...rows.filter((r) => !r.errors.length).map((r) => r.code?.toLowerCase()), ...existingCodes]);
  for (const r of rows) if (r.parentCode && !codes.has(r.parentCode.toLowerCase())) r.warnings.push(`Nadřazený dokument ${r.parentCode} nenalezen – vazba se nevytvoří.`);
  // role → navržené funkční místo podle názvu
  const byName = new Map<string, string>();
  for (const p of positions) if (!byName.has(normName(p.name))) byName.set(normName(p.name), p.id);
  const counts = new Map<string, number>();
  for (const r of rows) for (const n of [r.owner, r.reviewer, r.approver]) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  const roles = [...counts].map(([name, count]) => ({ name, count, positionId: byName.get(normName(name)) ?? null })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "cs"));
  const meta = new Set([archive.metadataFile]);
  const unusedFiles = [...archive.files.keys()].filter((p) => !used.has(p) && !meta.has(p) && !/\.csv$/i.test(p));
  const ok = rows.filter((r) => !r.errors.length);
  return {
    metadataFile: archive.metadataFile,
    rows,
    roles,
    unusedFiles,
    summary: {
      total: rows.length,
      create: ok.filter((r) => !r.exists).length,
      skip: ok.filter((r) => r.exists).length,
      errors: rows.length - ok.length,
      withoutFile: ok.filter((r) => !r.exists && !r.file).length,
    },
  };
}
