import { unzipSync, type Unzipped, type UnzipFileInfo } from "fflate";

/**
 * Bezpečné rozbalení ZIP (Office dokumenty, XLSX import): fflate alokuje paměť podle velikosti
 * deklarované v archivu, takže „ZIP bomba“ by vyčerpala paměť API. Limit součtu a počtu souborů.
 */
export function safeUnzip(buf: Uint8Array, opts: { filter?: (f: UnzipFileInfo) => boolean; maxBytes?: number; maxEntries?: number } = {}): Unzipped {
  const maxBytes = opts.maxBytes ?? 100 * 1024 * 1024;
  const maxEntries = opts.maxEntries ?? 5000;
  let total = 0;
  let count = 0;
  return unzipSync(buf, {
    filter: (f) => {
      if (opts.filter && !opts.filter(f)) return false;
      count++;
      total += f.originalSize;
      if (count > maxEntries || f.originalSize > maxBytes || total > maxBytes) throw new Error("Archiv je po rozbalení příliš velký");
      return true;
    },
  });
}
