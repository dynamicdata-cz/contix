import fontkit from "@pdf-lib/fontkit";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { strFromU8 } from "fflate";
import { safeUnzip } from "../../lib/zip";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { degrees, PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { config } from "../../config";
import type { Db } from "../../db/client";
import { policyFiles } from "../../db/schema";

/* ============================================================
 * Převody souborů dokumentace (ADR-025):
 *  - text z Office Open XML / ODF přímo v API (vyhledávání, porovnání verzí),
 *  - PDF a text z PDF přes převodní službu (LibreOffice v interní síti),
 *  - razítko (doložka + vodoznak) do PDF při stažení – vždy podle aktuálního stavu verze.
 * Originál se nikdy nemění.
 * ============================================================ */

const TEXT_MAX = 2_000_000;
const OFFICE_EXT = new Set(["doc", "docx", "docm", "dot", "dotx", "odt", "rtf", "xls", "xlsx", "xlsm", "ods", "ppt", "pptx", "odp"]);

export type FileKind = "pdf" | "office" | "text" | "other";
const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

export function fileKind(filename: string, mime: string, head?: Uint8Array): FileKind {
  if (mime === "application/pdf" || (head && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) return "pdf";
  const ext = extOf(filename);
  if (OFFICE_EXT.has(ext)) return "office";
  if (ext === "txt" || ext === "md" || ext === "csv" || mime.startsWith("text/")) return "text";
  return "other";
}

/** Malá písmena bez diakritiky – pro vyhledávání („směrnice“ najde i „smernice“). Délka odpovídá NFC textu. */
export const normalizeSearch = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Sjednocení textu: NFC, bez nadbytečných mezer, max. 2 MB. */
export function cleanText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TEXT_MAX);
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e.toLowerCase()] ?? _),
  );
/** XML → text: konce odstavců a řádků jako nové řádky, ostatní tagy pryč. */
function xmlText(xml: string, para: RegExp, extra: [RegExp, string][] = []): string {
  let s = xml.replace(para, "\n");
  for (const [re, v] of extra) s = s.replace(re, v);
  return decode(s.replace(/<[^>]+>/g, ""));
}
const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

/** Text z dokumentů Office Open XML a ODF (bez převodní služby). Nepodporovaný formát → null. */
export function officeText(buf: Uint8Array, filename: string): string | null {
  const ext = extOf(filename);
  let files: Record<string, Uint8Array>;
  try {
    files = safeUnzip(buf, { filter: (f) => /\.xml$/.test(f.name) });
  } catch {
    return null;
  }
  const get = (n: string) => (files[n] ? strFromU8(files[n]!) : null);
  if (["docx", "docm", "dotx"].includes(ext) || files["word/document.xml"]) {
    const parts = Object.keys(files)
      .filter((n) => /^word\/(header\d*|document|footnotes|endnotes|footer\d*)\.xml$/.test(n))
      .sort((a, b) => (a.includes("header") ? 0 : a.includes("document") ? 1 : a.includes("note") ? 2 : 3) - (b.includes("header") ? 0 : b.includes("document") ? 1 : b.includes("note") ? 2 : 3));
    return cleanText(
      parts
        .map((n) =>
          xmlText(get(n)!, /<\/w:p>/g, [
            [/<w:tab\/>/g, "\t"],
            [/<w:br[^>]*\/>/g, "\n"],
            [/<w:delText[^>]*>[\s\S]*?<\/w:delText>/g, ""], // smazaný text při sledování změn
          ]),
        )
        .join("\n"),
    );
  }
  if (["xlsx", "xlsm"].includes(ext) || files["xl/workbook.xml"]) {
    const shared = [...(get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode(m[1]!.replace(/<rPh[\s\S]*?<\/rPh>/g, "").replace(/<[^>]+>/g, "")));
    const sheets = Object.keys(files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => num(a) - num(b));
    const out: string[] = [];
    for (const n of sheets) {
      for (const row of get(n)!.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const c of row[1]!.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1] ?? "";
          const body = c[2] ?? "";
          const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (/t="s"/.test(attrs) && v != null) cells.push(shared[Number(v)] ?? "");
          else if (/t="inlineStr"/.test(attrs)) cells.push(decode(body.replace(/<[^>]+>/g, "")));
          else if (v != null) cells.push(decode(v));
        }
        if (cells.some((x) => x.trim())) out.push(cells.join("\t"));
      }
      out.push("");
    }
    return cleanText(out.join("\n"));
  }
  if (["pptx", "ppsx"].includes(ext) || files["ppt/presentation.xml"]) {
    const slides = Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => num(a) - num(b));
    return cleanText(slides.map((n) => xmlText(get(n)!, /<\/a:p>/g, [[/<a:br\/>/g, "\n"]])).join("\n\n"));
  }
  if (["odt", "ods", "odp"].includes(ext) || files["content.xml"]) {
    const c = get("content.xml");
    return c ? cleanText(xmlText(c, /<\/text:(p|h)>/g, [[/<text:tab\/>/g, "\t"], [/<text:line-break\/>/g, "\n"]])) : null;
  }
  return null;
}

/* ---------- převodní služba ---------- */

const converter = () => config.CONVERTER_URL;
export const converterEnabled = () => !!converter();

export async function converterHealth(timeoutMs = 30_000): Promise<{ ok: boolean; version: string | null; error: string | null }> {
  const url = converter();
  if (!url) return { ok: false, version: null, error: null };
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const b = (await r.json().catch(() => ({}))) as { ok?: boolean; version?: string };
    return { ok: r.ok && !!b.ok, version: b.version ?? null, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, version: null, error: (e as Error).message };
  }
}

async function call(path: string, body: Uint8Array, headers: Record<string, string> = {}) {
  const r = await fetch(`${converter()}${path}`, { method: "POST", body, headers: { "content-type": "application/octet-stream", ...headers }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Převodní služba: HTTP ${r.status}`);
  return r;
}
export const convertToPdf = async (buf: Uint8Array, filename: string) => new Uint8Array(await (await call("/pdf", buf, { "x-filename": encodeURIComponent(filename) })).arrayBuffer());
export const pdfToText = async (buf: Uint8Array) => (await call("/text", buf)).text();

/* ---------- zpracování souborů ---------- */

const running = new Map<string, Promise<void>>();

/** Zpracování souboru – souběžné požadavky na tentýž soubor čekají na probíhající běh. */
export function processFile(db: Db, id: string): Promise<void> {
  const cur = running.get(id);
  if (cur) return cur;
  const p = processOne(db, id).finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

/**
 * Doplní text a PDF k souboru verze. Bez převodní služby se vytáhne jen text z Office Open XML / ODF
 * a soubor zůstane „pending“ (zpracuje se, až bude služba dostupná).
 */
async function processOne(db: Db, id: string): Promise<void> {
  {
    const [f] = await db.select().from(policyFiles).where(eq(policyFiles.id, id));
    if (!f) return;
    const kind = fileKind(f.filename, f.mime, f.content.subarray(0, 4));
    let text = f.text;
    const set = async (v: Partial<typeof policyFiles.$inferInsert>) => {
      if (v.text !== undefined) v.searchText = v.text ? normalizeSearch(v.text) : null;
      await db.update(policyFiles).set(v).where(eq(policyFiles.id, id));
    };
    if (kind === "other") return set({ pdfStatus: "none", pdfError: null });
    if (kind === "text") return set({ pdfStatus: "none", pdfError: null, text: cleanText(new TextDecoder().decode(f.content)) });
    if (kind === "pdf") {
      if (!converterEnabled()) return set({ pdfStatus: "native" });
      try {
        return await set({ pdfStatus: "native", pdfError: null, text: cleanText(await pdfToText(f.content)) });
      } catch (e) {
        return await set({ pdfStatus: "native", pdfError: (e as Error).message.slice(0, 500) });
      }
    }
    // Office: text bez převodní služby, PDF jen s ní
    if (text == null) {
      text = officeText(f.content, f.filename);
      if (text != null) await set({ text });
    }
    if (!converterEnabled()) return;
    try {
      const pdf = await convertToPdf(f.content, f.filename);
      const upd: Partial<typeof policyFiles.$inferInsert> = { pdf: Buffer.from(pdf), pdfStatus: "ok", pdfError: null, pdfAt: new Date() };
      if (text == null) upd.text = cleanText(await pdfToText(pdf).catch(() => ""));
      await set(upd);
    } catch (e) {
      await set({ pdfStatus: "failed", pdfError: (e as Error).message.slice(0, 500) });
    }
  }
}

/** Plánovač: dávkově zpracuje čekající soubory (i existující soubory po aktualizaci na v0.24). */
export async function processPendingFiles(db: Db, maxMs = 5 * 60_000): Promise<number> {
  const until = Date.now() + maxMs;
  const where = converterEnabled()
    ? or(eq(policyFiles.pdfStatus, "pending"), and(eq(policyFiles.pdfStatus, "native"), isNull(policyFiles.text), isNull(policyFiles.pdfError)))
    : and(eq(policyFiles.pdfStatus, "pending"), isNull(policyFiles.text));
  let done = 0;
  const seen = new Set<string>();
  while (Date.now() < until) {
    const batch = (await db.select({ id: policyFiles.id }).from(policyFiles).where(where).orderBy(asc(policyFiles.uploadedAt)).limit(10)).filter((x) => !seen.has(x.id));
    if (!batch.length) break;
    for (const { id } of batch) {
      seen.add(id);
      await processFile(db, id);
      done++;
      if (Date.now() >= until) break;
    }
  }
  return done;
}

/* ---------- razítko do PDF ---------- */

let fontBytes: Uint8Array | null = null;
const font = () => (fontBytes ??= new Uint8Array(readFileSync(join(import.meta.dir, "../../../assets/fonts/DejaVuSans.ttf"))));

export interface PdfStamp {
  /** Řádky doložky v zápatí každé stránky. */
  footer: string[];
  /** Diagonální vodoznak („NÁVRH“, „NEPLATNÉ“) – null = bez vodoznaku. */
  watermark: string | null;
}

function fit(f: PDFFont, text: string, size: number, width: number) {
  if (f.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 3 && f.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/** Doplní doložku a vodoznak do PDF. Chráněné / poškozené PDF vrátí beze změny (`stamped: false`). */
export async function stampPdf(pdf: Uint8Array, stamp: PdfStamp): Promise<{ bytes: Uint8Array; stamped: boolean }> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false });
    doc.registerFontkit(fontkit);
    const f = await doc.embedFont(font(), { subset: true });
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      const size = Math.max(6, Math.min(7.5, width / 80));
      const lines = stamp.footer.map((l) => fit(f, l, size, width - 40));
      const boxH = lines.length * (size + 2.5) + 6;
      page.drawRectangle({ x: 14, y: 6, width: width - 28, height: boxH, color: rgb(1, 1, 1), opacity: 0.85 });
      lines.forEach((l, i) => page.drawText(l, { x: 20, y: 6 + boxH - 4 - (i + 1) * (size + 2.5) + 2.5, size, font: f, color: rgb(0.25, 0.25, 0.3) }));
      if (stamp.watermark) {
        const ws = Math.min(width, height) / 6;
        const tw = f.widthOfTextAtSize(stamp.watermark, ws);
        const angle = Math.atan2(height, width);
        page.drawText(stamp.watermark, {
          x: width / 2 - (tw / 2) * Math.cos(angle) + (ws / 3) * Math.sin(angle),
          y: height / 2 - (tw / 2) * Math.sin(angle) - (ws / 3) * Math.cos(angle),
          size: ws,
          font: f,
          color: rgb(0.85, 0.1, 0.1),
          opacity: 0.18,
          rotate: degrees((angle * 180) / Math.PI),
        });
      }
    }
    return { bytes: await doc.save({ useObjectStreams: true }), stamped: true };
  } catch {
    return { bytes: pdf, stamped: false };
  }
}
