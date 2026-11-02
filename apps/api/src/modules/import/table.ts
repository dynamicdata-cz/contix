import { XMLParser } from "fast-xml-parser";
import { strFromU8, strToU8, zipSync } from "fflate";
import { safeUnzip } from "../../lib/zip";
import { IMPORT_MAX_ROWS } from "@contix/shared";

/* ============================================================
 * Čtení tabulek pro import: CSV (oddělovač ; , nebo tabulátor, UTF-8 i Windows-1250) a XLSX (bez externí knihovny –
 * ZIP přes fflate, XML přes fast-xml-parser). Vrací záhlaví a řádky jako text; význam hodnot řeší shared/import.ts.
 * ============================================================ */

export interface Table {
  sheets: string[];
  sheet: string | null;
  headers: string[];
  rows: string[][];
  /** Číslo řádku v souboru (1 = první řádek) pro každý řádek dat – kvůli hlášení chyb. */
  lines: number[];
}

const isXlsx = (buf: Uint8Array) => buf[0] === 0x50 && buf[1] === 0x4b; // "PK" – ZIP

export function readTable(buf: Uint8Array, filename: string, sheet?: string | null): Table {
  if (isXlsx(buf) || /\.xlsx$/i.test(filename)) return readXlsx(buf, sheet);
  if (/\.xls$/i.test(filename)) throw new Error("Starý formát .xls není podporován – uložte soubor jako .xlsx nebo CSV.");
  return { sheets: [], sheet: null, ...splitHeader(parseCsv(decodeText(buf))) };
}

function splitHeader(all: string[][]): { headers: string[]; rows: string[][]; lines: number[] } {
  // první neprázdný řádek je záhlaví; prázdné řádky se vynechají (čísla řádků zůstávají podle souboru)
  const nonEmpty = all.map((r, i) => ({ r, line: i + 1 })).filter(({ r }) => r.some((c) => c.trim() !== ""));
  const [head, ...rest] = nonEmpty;
  const headers = (head?.r ?? []).map((h) => h.trim());
  const width = headers.length;
  return { headers, rows: rest.map(({ r }) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim())), lines: rest.map(({ line }) => line) };
}

/* ---------------- CSV ---------------- */

/** Znaky 0x80–0xFF kódování Windows-1250. */
const CP1250 = "\u20ac\ufffd\u201a\ufffd\u201e\u2026\u2020\u2021\ufffd\u2030\u0160\u2039\u015a\u0164\u017d\u0179\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\ufffd\u2122\u0161\u203a\u015b\u0165\u017e\u017a\xa0\u02c7\u02d8\u0141\xa4\u0104\xa6\xa7\xa8\xa9\u015e\xab\xac\xad\xae\u017b\xb0\xb1\u02db\u0142\xb4\xb5\xb6\xb7\xb8\u0105\u015f\xbb\u013d\u02dd\u013e\u017c\u0154\xc1\xc2\u0102\xc4\u0139\u0106\xc7\u010c\xc9\u0118\xcb\u011a\xcd\xce\u010e\u0110\u0143\u0147\xd3\xd4\u0150\xd6\xd7\u0158\u016e\xda\u0170\xdc\xdd\u0162\xdf\u0155\xe1\xe2\u0103\xe4\u013a\u0107\xe7\u010d\xe9\u0119\xeb\u011b\xed\xee\u010f\u0111\u0144\u0148\xf3\xf4\u0151\xf6\xf7\u0159\u016f\xfa\u0171\xfc\xfd\u0163\u02d9";

export function decodeText(buf: Uint8Array): string {
  let b = buf;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try {
    return utf8.decode(b);
  } catch {
    // Excel v české lokalizaci ukládá CSV ve Windows-1250 (Bun TextDecoder ho nepodporuje → vlastní tabulka)
    let out = "";
    for (const x of b) out += x < 0x80 ? String.fromCharCode(x) : CP1250[x - 0x80];
    return out;
  }
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [";", "\t", ","].sort((a, b) => count(b) - count(a))[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* ---------------- XLSX ---------------- */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: false,
  htmlEntities: true,
  isArray: (name) => ["sheet", "Relationship", "si", "r", "row", "c"].includes(name),
});

const textOf = (n: unknown): string => {
  if (n == null) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (typeof n === "object") {
    const o = n as Record<string, unknown>;
    if ("#text" in o) return String(o["#text"]);
  }
  return "";
};

/** Text sdíleného řetězce nebo inline řetězce: <t> nebo bohatý text <r><t>…</t></r>. */
const richText = (si: Record<string, unknown> | undefined): string => {
  if (!si) return "";
  if (si.t !== undefined) return textOf(si.t);
  return ((si.r as Record<string, unknown>[] | undefined) ?? []).map((r) => textOf(r.t)).join("");
};

const colIndex = (ref: string) => {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export function readXlsx(buf: Uint8Array, wanted?: string | null): Table {
  let files: Record<string, Uint8Array>;
  try {
    files = safeUnzip(buf, { filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") || f.name.endsWith(".rels") });
  } catch {
    throw new Error("Soubor není platný sešit Excelu (.xlsx).");
  }
  const read = (p: string) => (files[p] ? xml.parse(strFromU8(files[p]!)) : null);
  const wb = read("xl/workbook.xml");
  if (!wb) throw new Error("Soubor není platný sešit Excelu (.xlsx).");
  const sheets = (wb.workbook?.sheets?.sheet ?? []) as Record<string, string>[];
  const rels = ((read("xl/_rels/workbook.xml.rels")?.Relationships?.Relationship ?? []) as Record<string, string>[]).reduce<Record<string, string>>((m, r) => {
    m[r["@Id"]!] = r["@Target"]!;
    return m;
  }, {});
  const names = sheets.map((s) => s["@name"]!);
  const chosen = sheets.find((s) => s["@name"] === wanted) ?? sheets[0];
  if (!chosen) throw new Error("Sešit neobsahuje žádný list.");
  const target = rels[chosen["@r:id"]!] ?? "worksheets/sheet1.xml";
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const shared = ((read("xl/sharedStrings.xml")?.sst?.si ?? []) as Record<string, unknown>[]).map(richText);
  const ws = read(path);
  const rowsXml = (ws?.worksheet?.sheetData?.row ?? []) as Record<string, unknown>[];
  const all: string[][] = [];
  for (const r of rowsXml) {
    const idx = Number(r["@r"] ?? all.length + 1) - 1;
    // ochrana proti řídkým indexům (r="200000000" → obří pole)
    if (!Number.isInteger(idx) || idx < 0 || idx > IMPORT_MAX_ROWS + 1000) throw new Error(`List má příliš mnoho řádků (max. ${IMPORT_MAX_ROWS}).`);
    const cells: string[] = [];
    for (const c of (r.c ?? []) as Record<string, unknown>[]) {
      const ci = colIndex(String(c["@r"] ?? ""));
      if (!Number.isInteger(ci) || ci < 0 || ci > 500) throw new Error("List má příliš mnoho sloupců (max. 500).");
      const t = c["@t"];
      let v: string;
      if (t === "s") v = shared[Number(textOf(c.v))] ?? "";
      else if (t === "inlineStr") v = richText(c.is as Record<string, unknown>);
      else if (t === "b") v = textOf(c.v) === "1" ? "ano" : "ne";
      else v = textOf(c.v);
      cells[ci] = v;
    }
    all[idx] = Array.from({ length: cells.length }, (_, i) => cells[i] ?? "");
  }
  return { sheets: names, sheet: chosen["@name"]!, ...splitHeader(Array.from({ length: all.length }, (_, i) => all[i] ?? [])) };
}

/* ---------------- zápis jednoduchého XLSX (šablony importu) ---------------- */

const escXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function writeXlsx(sheets: { name: string; rows: string[][]; widths?: number[] }[]): Uint8Array {
  const enc = (s: string) => strToU8(s);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    ),
    "_rels/.rels": enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    // styl 1 = tučné písmo (záhlaví)
    "xl/styles.xml": enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ),
  };
  sheets.forEach((s, i) => {
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const rows = s.rows
      .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v === "" ? "" : `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${escXml(v)}</t></is></c>`)).join("")}</row>`)
      .join("");
    files[`xl/worksheets/sheet${i + 1}.xml`] = enc(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${i === 0 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ""}</sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return zipSync(files);
}
