import { strFromU8, strToU8, zipSync, type Zippable } from "fflate";
import { safeUnzip } from "../../lib/zip";

/* ============================================================
 * Šablony Wordu: doplnění značek {{kod}}, {{nazev}}… do .docx / .dotx (ADR-024).
 * Word často rozdělí text značky do více „runs“ (<w:r>) – mezi znaky značky proto
 * tolerujeme libovolné XML tagy a nahradíme celý úsek (formát převezme první run).
 * ============================================================ */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Je soubor šablona Wordu (docx/dotx = ZIP s word/document.xml)? */
export function isWordTemplate(buf: Uint8Array): boolean {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return false;
  try {
    return !!safeUnzip(buf, { filter: (f) => f.name === "word/document.xml" })["word/document.xml"];
  } catch {
    return false;
  }
}

/** Nahradí značky v jednom XML dílu dokumentu. */
export function fillXml(xml: string, values: Record<string, string>): string {
  const gap = "(?:<[^>]+>)*";
  let out = xml;
  for (const [key, value] of Object.entries(values)) {
    // {{ k l í č }} s libovolnými tagy mezi znaky, mezery uvnitř závorek povoleny
    const tokens = ["\\{", "\\{", "\\s*", ...key.split("").map(reEsc), "\\s*", "\\}", "\\}"];
    const re = new RegExp(tokens.join(gap), "g");
    out = out.replace(re, (m) => {
      // zachovat uzavírací/otevírací tagy runů, aby XML zůstalo vyvážené – text dát na místo první značky
      const tags = m.match(/<[^>]+>/g) ?? [];
      return xmlEsc(value) + tags.join("");
    });
  }
  return out;
}

/**
 * Vytvoří .docx ze šablony: doplní značky a z .dotx udělá dokument (content type).
 * Neplatný soubor vrátí beze změny.
 */
export function fillWordTemplate(buf: Uint8Array, values: Record<string, string>): { content: Uint8Array; mime: string } {
  let files: Record<string, Uint8Array>;
  try {
    files = safeUnzip(buf);
  } catch {
    return { content: buf, mime: "application/octet-stream" };
  }
  const out: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    if (TEXT_PARTS.test(name)) out[name] = strToU8(fillXml(strFromU8(data), values));
    else if (name === "[Content_Types].xml") out[name] = strToU8(strFromU8(data).replace("wordprocessingml.template.main+xml", "wordprocessingml.document.main+xml"));
    else out[name] = data;
  }
  return { content: zipSync(out, { level: 6 }), mime: DOCX_MIME };
}
