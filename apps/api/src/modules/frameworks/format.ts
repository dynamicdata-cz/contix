import {
  FRAMEWORK_CSV_HEADERS,
  packFromNative,
  packFromOscal,
  packFromTable,
  validatePack,
  type FrameworkExportFormat,
  type FrameworkImportFormat,
  type FrameworkImportIssue,
  type FrameworkPack,
  type FrameworkPackMetaInput,
  type FrameworkImportPreview,
} from "@contix/shared";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { readTable } from "../import/table";

/* ============================================================
 * Knihovna rámců (ADR-079): soubor → balíček (CSV / XLSX / YAML / JSON / XML / OSCAL) a export.
 * Formát se určuje podle přípony; YAML a JSON se rozliší na OSCAL (klíč „catalog“) a nativní balíček.
 * ============================================================ */

export const FRAMEWORK_MAX_BYTES = 15 * 1024 * 1024;

const XML_ARRAYS = new Set(["requirement", "mapping", "use"]);

function fromXml(text: string): unknown {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", isArray: (name) => XML_ARRAYS.has(name), parseTagValue: false, trimValues: true }).parse(text) as Record<string, any>;
  const f = doc.framework;
  if (!f) return null;
  const list = <T,>(x: any, tag: string): T[] => (x && typeof x === "object" && !Array.isArray(x) ? (x[tag] ?? []) : []);
  const text_ = (v: any) => (v && typeof v === "object" ? (v["#text"] ?? "") : (v ?? ""));
  return {
    ...Object.fromEntries(Object.entries(f).filter(([k]) => !["requirements", "uses", "fullText"].includes(k)).map(([k, v]) => [k, text_(v)])),
    ...(f.fullText !== undefined ? { fullText: String(text_(f.fullText)) === "true" } : {}),
    ...(f.uses ? { uses: list<string>(f.uses, "use").map(text_) } : {}),
    requirements: list<any>(f.requirements, "requirement").map((r) => ({
      ref: r.ref,
      section: r.section,
      sectionTitle: r.sectionTitle ?? "",
      text: text_(r.text),
      guidance: text_(r.guidance),
      level: r.level ?? "",
      mappings: list<any>(r.mappings, "mapping").map(text_),
    })),
  };
}

function toXml(pack: Record<string, any>): string {
  const { requirements, uses, ...meta } = pack;
  const root = {
    framework: {
      ...meta,
      uses: { use: uses ?? [] },
      requirements: {
        requirement: (requirements as any[]).map((r) => ({
          "@_ref": r.ref,
          "@_section": r.section,
          ...(r.sectionTitle ? { "@_sectionTitle": r.sectionTitle } : {}),
          ...(r.level ? { "@_level": r.level } : {}),
          text: r.text,
          ...(r.guidance ? { guidance: r.guidance } : {}),
          ...(r.mappings?.length ? { mappings: { mapping: r.mappings } } : {}),
        })),
      },
    },
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true, suppressEmptyNode: true }).build(root)}`;
}

const ext = (name: string) => name.toLowerCase().match(/\.[a-z]+$/)?.[0] ?? "";

/** Soubor + doplněná metadata → ověřený balíček a náhled. */
export function parseFrameworkFile(buf: Uint8Array, filename: string, meta: Partial<FrameworkPackMetaInput>): { pack: FrameworkPack | null; preview: FrameworkImportPreview } {
  const e = ext(filename);
  const fail = (format: FrameworkImportFormat, message: string) => validatePack(null, { format, errors: [{ row: null, message }] });
  let format: FrameworkImportFormat;
  let raw: { pack: unknown; errors: FrameworkImportIssue[]; warnings: FrameworkImportIssue[] };
  try {
    if (e === ".csv" || e === ".xlsx") {
      format = "table";
      const t = readTable(buf, filename);
      if (!t.rows.length) return fail(format, "Tabulka neobsahuje žádné řádky.");
      raw = packFromTable(meta as FrameworkPackMetaInput, t.headers, t.rows);
    } else if (e === ".yaml" || e === ".yml" || e === ".json") {
      const text = new TextDecoder().decode(buf).replace(/^﻿/, "");
      const doc = e === ".json" ? JSON.parse(text) : Bun.YAML.parse(text);
      format = doc && typeof doc === "object" && "catalog" in (doc as object) ? "oscal" : "native";
      raw = format === "oscal" ? packFromOscal(doc, meta) : packFromNative(doc, meta);
    } else if (e === ".xml") {
      format = "native";
      const doc = fromXml(new TextDecoder().decode(buf));
      if (!doc) return fail(format, "XML neobsahuje prvek <framework>.");
      raw = packFromNative(doc, meta);
    } else return fail("native", "Nepodporovaný formát – použijte CSV, XLSX, YAML, JSON nebo XML.");
  } catch (err) {
    return fail("native", `Soubor nelze přečíst: ${(err as Error).message.slice(0, 300)}`);
  }
  return validatePack(raw.pack, { format, errors: raw.errors, warnings: raw.warnings });
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function serializeFramework(pack: Record<string, any>, format: FrameworkExportFormat): { body: string; mime: string; ext: string } {
  if (format === "json") return { body: JSON.stringify(pack, null, 2), mime: "application/json", ext: "json" };
  if (format === "xml") return { body: toXml(pack), mime: "application/xml", ext: "xml" };
  if (format === "csv") {
    const titles = new Map<string, string>();
    const rows = (pack.requirements as any[]).map((r) => {
      if (r.sectionTitle) titles.set(r.section, r.sectionTitle);
      return [r.ref, r.section, r.sectionTitle ?? titles.get(r.section) ?? "", r.text, r.guidance ?? "", r.level ?? "", (r.mappings ?? []).join("; ")];
    });
    // BOM kvůli Excelu, středník jako oddělovač (české prostředí)
    return { body: `﻿${[FRAMEWORK_CSV_HEADERS, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n")}\r\n`, mime: "text/csv; charset=utf-8", ext: "csv" };
  }
  return { body: `# Rámec CONTIX – ${pack.name}\n${Bun.YAML.stringify(pack, null, 2)}`, mime: "application/yaml", ext: "yaml" };
}
