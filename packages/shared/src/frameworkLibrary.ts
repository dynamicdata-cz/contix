import { z } from "zod";
import {
  FRAMEWORK_KINDS,
  FRAMEWORK_USES,
  JURISDICTION_RE,
  requirementById,
  type CustomFrameworkDto,
  type FrameworkKind,
  type FrameworkMeta,
  type FrameworkUse,
  type Requirement,
} from "./frameworks";

/* ============================================================
 * Knihovna rámců (v0.83, ADR-079): vlastní rámce – zákony a vyhlášky jiných států, normy, interní požadavky.
 * Balíček rámce (CONTIX YAML / JSON / XML) ↔ `FrameworkPack`; tabulka (CSV / XLSX) a katalog OSCAL se převádějí na stejný tvar.
 * ID požadavku = „x-<klíč>:<ref>“ – stálé podle ref, takže nový import zachová posouzení i vazby.
 * ============================================================ */

export const FRAMEWORK_IMPORT_FORMATS = ["table", "native", "oscal"] as const;
export type FrameworkImportFormat = (typeof FRAMEWORK_IMPORT_FORMATS)[number];
export const FRAMEWORK_EXPORT_FORMATS = ["yaml", "json", "xml", "csv"] as const;
export type FrameworkExportFormat = (typeof FRAMEWORK_EXPORT_FORMATS)[number];
/** Přípony, které knihovna přijme. */
export const FRAMEWORK_FILE_EXTENSIONS = [".csv", ".xlsx", ".yaml", ".yml", ".json", ".xml"] as const;

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const FRAMEWORK_MAX_REQUIREMENTS = 5000;

export const FrameworkPackMeta = z.object({
  key: z.string().trim().toLowerCase().regex(KEY_RE, "Klíč: malá písmena, číslice a pomlčky (2–40 znaků), např. sk-zkb"),
  name: z.string().trim().min(1).max(300),
  shortName: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).default(""),
  jurisdiction: z.string().trim().toUpperCase().regex(JURISDICTION_RE, "Země: dvoupísmenný kód (SK, PL, DE…), EU nebo INT"),
  kind: z.enum(FRAMEWORK_KINDS),
  uses: z.array(z.enum(FRAMEWORK_USES)).min(1).default(["gap", "audit"]),
  version: z.string().trim().max(60).default(""),
  language: z.string().trim().max(20).default(""),
  source: z.string().trim().max(500).default(""),
  /** Úřední / plné znění (true) nebo jen popisky (false – texty norem chráněné autorským právem). */
  fullText: z.boolean().default(true),
});
export type FrameworkPackMeta = z.infer<typeof FrameworkPackMeta>;
export type FrameworkPackMetaInput = z.input<typeof FrameworkPackMeta>;

export const FrameworkPackRequirement = z.object({
  ref: z.string().trim().min(1).max(80),
  section: z.string().trim().min(1).max(120),
  sectionTitle: z.string().trim().max(300).default(""),
  text: z.string().trim().min(1).max(20_000),
  guidance: z.string().trim().max(20_000).default(""),
  level: z.string().trim().max(60).default(""),
  mappings: z.array(z.string().trim().min(3).max(120)).max(100).default([]),
});
export type FrameworkPackRequirement = z.infer<typeof FrameworkPackRequirement>;

export const FrameworkPack = FrameworkPackMeta.extend({
  requirements: z.array(FrameworkPackRequirement).min(1, "Rámec nemá žádné požadavky").max(FRAMEWORK_MAX_REQUIREMENTS),
});
export type FrameworkPack = z.infer<typeof FrameworkPack>;

/** Metadata pro import tabulky (CSV / XLSX) – v souboru nejsou. */
export const FrameworkImportMeta = FrameworkPackMeta;

export const frameworkIdOf = (key: string) => `x-${key}` as const;
/** Normalizace citace na část ID (bez mezer; jen bezpečné znaky). */
export const refKey = (ref: string) =>
  ref
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/§\s*/g, "par")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9._/()-]/g, "-")
    .replace(/-+/g, "-")
    // ID požadavku má nejvýš 100 znaků: „x-“ + klíč (40) + „:“ + 55
    .slice(0, 55);
export const requirementIdOf = (key: string, ref: string) => `${frameworkIdOf(key)}:${refKey(ref)}`;

export interface FrameworkImportIssue {
  /** Řádek / pořadí požadavku (1…), null = celý soubor. */
  row: number | null;
  message: string;
}

export interface FrameworkImportPreview {
  ok: boolean;
  format: FrameworkImportFormat;
  meta: (FrameworkPackMeta & { id: string }) | null;
  requirements: number;
  sections: number;
  /** Mapování na existující požadavky jiných rámců. */
  mappings: number;
  unknownMappings: string[];
  errors: FrameworkImportIssue[];
  warnings: FrameworkImportIssue[];
  /** Ukázka prvních požadavků. */
  sample: { id: string; ref: string; section: string; text: string }[];
  /** Nahrazení existujícího rámce: počty. */
  replace: { added: number; removed: number; kept: number; removedAssessed: number } | null;
  existing: boolean;
}

/* ---------------- tabulka (CSV / XLSX) ---------------- */

const norm = (h: string) =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Názvy sloupců (cs, sk, en, pl, de) → pole požadavku. */
export const FRAMEWORK_TABLE_COLUMNS: Record<keyof Omit<FrameworkPackRequirement, never>, string[]> = {
  ref: ["id", "ref", "reference", "cislo", "c", "oznaceni", "identifikator", "kod", "code", "control", "controlid", "nr", "numer", "nummer", "ustanoveni", "clanek", "article"],
  section: ["section", "oddil", "kapitola", "cast", "par", "paragraf", "domain", "domena", "group", "skupina", "oblast", "bereich", "rozdzial"],
  sectionTitle: ["sectiontitle", "nazevoddilu", "nazovoddielu", "nazevkapitoly", "nazovkapitoly", "domainname", "grouptitle", "nazevoblasti"],
  text: ["text", "pozadavek", "poziadavka", "requirement", "title", "nazev", "nazov", "popis", "znení", "zneni", "wymaganie", "anforderung", "control text", "controltext"],
  guidance: ["guidance", "voditko", "navod", "vysvetlivka", "poznamka", "note", "description", "discussion", "hinweis", "wytyczne", "doplnujicitext"],
  level: ["level", "uroven", "kategorie", "kategoria", "priorita", "priority", "ig", "typ", "type", "stufe", "poziom"],
  mappings: ["mapping", "mappings", "mapovani", "mapovanie", "vazby", "crosswalk", "zuordnung", "mapowanie"],
};

/** Převod tabulky na balíček. Sekce chybí → odvodí se z citace (část před poslední tečkou). */
export function packFromTable(meta: FrameworkPackMetaInput, headers: string[], rows: string[][]): { pack: unknown; errors: FrameworkImportIssue[]; warnings: FrameworkImportIssue[] } {
  const errors: FrameworkImportIssue[] = [];
  const warnings: FrameworkImportIssue[] = [];
  const idx: Partial<Record<keyof FrameworkPackRequirement, number>> = {};
  headers.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(FRAMEWORK_TABLE_COLUMNS) as [keyof FrameworkPackRequirement, string[]][])
      if (idx[field] === undefined && names.map(norm).includes(n)) idx[field] = i;
  });
  if (idx.ref === undefined) errors.push({ row: null, message: "Chybí sloupec s označením požadavku (ID / Ref / Číslo)." });
  if (idx.text === undefined) errors.push({ row: null, message: "Chybí sloupec s textem požadavku (Text / Požadavek / Title)." });
  if (errors.length) return { pack: null, errors, warnings };
  if (idx.section === undefined) warnings.push({ row: null, message: "Sloupec Oddíl chybí – oddíl se odvodí z označení požadavku." });
  const cell = (r: string[], f: keyof FrameworkPackRequirement) => (idx[f] === undefined ? "" : (r[idx[f]!] ?? "").trim());
  const titles = new Map<string, string>();
  const requirements = rows
    .map((r, i) => ({ r, line: i + 2 }))
    .filter(({ r }) => r.some((c) => c.trim()))
    .map(({ r, line }) => {
      const ref = cell(r, "ref");
      const section = cell(r, "section") || sectionFromRef(ref);
      const st = cell(r, "sectionTitle");
      if (st && !titles.has(section)) titles.set(section, st);
      if (!ref) errors.push({ row: line, message: "Prázdné označení požadavku." });
      if (!cell(r, "text")) errors.push({ row: line, message: `Požadavek ${ref || "?"} nemá text.` });
      return { ref, section, sectionTitle: st, text: cell(r, "text"), guidance: cell(r, "guidance"), level: cell(r, "level"), mappings: splitList(cell(r, "mappings")) };
    });
  for (const q of requirements) if (!q.sectionTitle) q.sectionTitle = titles.get(q.section) ?? "";
  return { pack: { ...meta, requirements }, errors, warnings };
}

export const sectionFromRef = (ref: string) => {
  const r = ref.trim();
  const i = r.lastIndexOf(".");
  return i > 0 ? r.slice(0, i) : r.split(/\s+/)[0] || r;
};
const splitList = (v: string) =>
  v
    .split(/[;,\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/* ---------------- OSCAL katalog (JSON / YAML) ---------------- */

type OscalPart = { name?: string; prose?: string; parts?: OscalPart[]; props?: { name: string; value: string }[] };
type OscalControl = { id: string; title?: string; class?: string; props?: { name: string; value: string }[]; parts?: OscalPart[]; controls?: OscalControl[] };
type OscalGroup = { id?: string; title?: string; groups?: OscalGroup[]; controls?: OscalControl[] };

const proseOf = (parts: OscalPart[] | undefined, names: string[]): string =>
  (parts ?? [])
    .filter((p) => !p.name || names.includes(p.name) || names.includes("*"))
    .map((p) => {
      const label = p.props?.find((x) => x.name === "label")?.value;
      const own = [label, p.prose].filter(Boolean).join(" ");
      const sub = proseOf(p.parts, ["*"]);
      return [own, sub].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n")
    .replace(/\{\{\s*insert:\s*param,\s*([^}\s]+)\s*\}\}/g, "[$1]")
    .trim();

/** Katalog OSCAL → balíček (skupiny = oddíly, opatření i rozšíření = požadavky). */
export function packFromOscal(doc: unknown, meta: Partial<FrameworkPackMetaInput>): { pack: unknown; errors: FrameworkImportIssue[]; warnings: FrameworkImportIssue[] } {
  const cat = (doc as { catalog?: { metadata?: { title?: string; version?: string }; groups?: OscalGroup[]; controls?: OscalControl[] } })?.catalog;
  if (!cat) return { pack: null, errors: [{ row: null, message: "Soubor není katalog OSCAL (chybí „catalog“)." }], warnings: [] };
  const requirements: FrameworkPackRequirement[] = [];
  const warnings: FrameworkImportIssue[] = [];
  const add = (c: OscalControl, section: string, sectionTitle: string) => {
    const label = c.props?.find((p) => p.name === "label" && !p.value.includes("("))?.value ?? c.props?.find((p) => p.name === "label")?.value ?? c.id.toUpperCase();
    const statement = proseOf(c.parts, ["statement"]);
    requirements.push({
      ref: label,
      section,
      sectionTitle,
      text: [c.title, statement].filter(Boolean).join(" – ").slice(0, 20_000) || c.id,
      guidance: proseOf(c.parts, ["guidance"]).slice(0, 20_000),
      level: c.props?.find((p) => /^(priority|baseline|level|implementation-level)$/i.test(p.name))?.value ?? "",
      mappings: [],
    });
    for (const sub of c.controls ?? []) add(sub, section, sectionTitle);
  };
  const walk = (g: OscalGroup, parentTitle?: string) => {
    const title = g.title ?? parentTitle ?? "";
    const section = (g.id ?? title).toUpperCase().slice(0, 120) || "—";
    for (const c of g.controls ?? []) add(c, section, title);
    for (const sub of g.groups ?? []) walk(sub, title);
  };
  for (const g of cat.groups ?? []) walk(g);
  for (const c of cat.controls ?? []) add(c, c.id.split(/[-.]/)[0]!.toUpperCase(), "");
  if (!requirements.length) return { pack: null, errors: [{ row: null, message: "Katalog OSCAL neobsahuje žádná opatření." }], warnings };
  const title = cat.metadata?.title ?? "";
  return {
    pack: {
      key: meta.key ?? slug(title),
      name: meta.name || title || "OSCAL katalog",
      shortName: meta.shortName || title.slice(0, 40) || "OSCAL",
      description: meta.description ?? "",
      jurisdiction: meta.jurisdiction ?? "INT",
      kind: meta.kind ?? "framework",
      uses: meta.uses ?? ["gap", "audit"],
      version: meta.version || cat.metadata?.version || "",
      language: meta.language ?? "en",
      source: meta.source || "OSCAL katalog",
      fullText: meta.fullText ?? true,
      requirements,
    },
    errors: [],
    warnings,
  };
}

export const slug = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "ramec";

/* ---------------- nativní balíček (YAML / JSON / XML po převodu) ---------------- */

/** Nativní balíček CONTIX: { contix: "framework/1", key, name, …, sections?: {oddíl: název}, requirements: […] }. */
export function packFromNative(doc: unknown, override: Partial<FrameworkPackMetaInput> = {}): { pack: unknown; errors: FrameworkImportIssue[]; warnings: FrameworkImportIssue[] } {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { pack: null, errors: [{ row: null, message: "Soubor neobsahuje balíček rámce." }], warnings: [] };
  const d = doc as Record<string, unknown> & { sections?: Record<string, string>; requirements?: Record<string, unknown>[] };
  const titles = d.sections && typeof d.sections === "object" ? d.sections : {};
  const reqs = (Array.isArray(d.requirements) ? d.requirements : []).map((r) => {
    const section = String(r.section ?? sectionFromRef(String(r.ref ?? r.id ?? "")));
    return {
      ...r,
      ref: r.ref ?? r.id,
      section,
      sectionTitle: r.sectionTitle ?? titles[section] ?? "",
      mappings: typeof r.mappings === "string" ? splitList(r.mappings) : r.mappings,
    };
  });
  const { contix: _v, sections: _s, ...rest } = d;
  const clean = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined && v !== ""));
  return { pack: { ...rest, ...clean, requirements: reqs }, errors: [], warnings: [] };
}

/* ---------------- ověření a převod do registru ---------------- */

/** Ověří balíček (zod + jedinečnost ID + mapování). `pack` je výsledek převodu formátu. */
export function validatePack(
  raw: unknown,
  opts: { format: FrameworkImportFormat; errors?: FrameworkImportIssue[]; warnings?: FrameworkImportIssue[] } = { format: "native" },
): { pack: FrameworkPack | null; preview: FrameworkImportPreview } {
  const errors = [...(opts.errors ?? [])];
  const warnings = [...(opts.warnings ?? [])];
  const base: FrameworkImportPreview = { ok: false, format: opts.format, meta: null, requirements: 0, sections: 0, mappings: 0, unknownMappings: [], errors, warnings, sample: [], replace: null, existing: false };
  if (raw === null || errors.length) return { pack: null, preview: base };
  const p = FrameworkPack.safeParse(raw);
  if (!p.success) {
    for (const i of p.error.issues.slice(0, 30)) {
      const row = i.path[0] === "requirements" && typeof i.path[1] === "number" ? i.path[1] + 1 : null;
      errors.push({ row, message: `${i.path.join(".")}: ${i.message}` });
    }
    return { pack: null, preview: base };
  }
  const pack = p.data;
  const seen = new Map<string, number>();
  pack.requirements.forEach((r, i) => {
    const id = requirementIdOf(pack.key, r.ref);
    if (seen.has(id)) errors.push({ row: i + 1, message: `Označení „${r.ref}“ se opakuje (řádek ${seen.get(id)! + 1}).` });
    else seen.set(id, i);
  });
  const own = new Set(seen.keys());
  const unknown = new Set<string>();
  let mappings = 0;
  for (const r of pack.requirements) {
    r.mappings = r.mappings.filter((m) => {
      const ok = own.has(m) || !!requirementById(m);
      if (ok) mappings++;
      else unknown.add(m);
      return ok;
    });
  }
  if (unknown.size) warnings.push({ row: null, message: `Neznámá mapování se vynechají: ${[...unknown].slice(0, 10).join(", ")}${unknown.size > 10 ? " …" : ""}` });
  const sections = new Set(pack.requirements.map((r) => r.section)).size;
  const preview: FrameworkImportPreview = {
    ...base,
    ok: errors.length === 0,
    meta: { ...metaOf(pack), id: frameworkIdOf(pack.key) },
    requirements: pack.requirements.length,
    sections,
    mappings,
    unknownMappings: [...unknown],
    sample: pack.requirements.slice(0, 8).map((r) => ({ id: requirementIdOf(pack.key, r.ref), ref: r.ref, section: r.section, text: r.text.slice(0, 200) })),
  };
  return { pack: errors.length ? null : pack, preview };
}

const metaOf = (pack: FrameworkPack): FrameworkPackMeta => {
  const { requirements: _r, ...m } = pack;
  return m;
};

/** Balíček → tvar pro registr (`registerCustomFrameworks`). */
export function packToDto(pack: FrameworkPack): CustomFrameworkDto {
  const id = frameworkIdOf(pack.key);
  const meta: FrameworkMeta = {
    id,
    name: pack.name,
    shortName: pack.shortName,
    description: pack.description,
    source: pack.source,
    fullText: pack.fullText,
    jurisdiction: pack.jurisdiction,
    kind: pack.kind as FrameworkKind,
    uses: pack.uses as FrameworkUse[],
    version: pack.version,
    language: pack.language,
    custom: true,
  };
  const requirements: Requirement[] = pack.requirements.map((r, i) => ({
    id: requirementIdOf(pack.key, r.ref),
    framework: id,
    section: r.section,
    sectionTitle: r.sectionTitle || r.section,
    ref: r.ref,
    text: r.text,
    points: [],
    lead: null,
    order: i,
    guidance: r.guidance || null,
    level: r.level || null,
    mappings: r.mappings,
  }));
  return { meta, requirements };
}

/** Rámec (vestavěný i vlastní) → nativní balíček pro export. */
export function packOf(meta: FrameworkMeta, reqs: Requirement[]): Record<string, unknown> {
  const key = meta.custom ? meta.id.slice(2) : meta.id;
  return {
    contix: "framework/1",
    key,
    name: meta.name,
    shortName: meta.shortName,
    description: meta.description,
    jurisdiction: meta.jurisdiction,
    kind: meta.kind,
    uses: meta.uses,
    version: meta.version,
    language: meta.language,
    source: meta.source,
    fullText: meta.fullText,
    requirements: reqs.map((r) => ({
      ref: r.ref,
      section: r.section,
      ...(r.sectionTitle && r.sectionTitle !== r.section ? { sectionTitle: r.sectionTitle } : {}),
      text: [r.lead, r.text, ...r.points].filter(Boolean).join("\n"),
      ...(r.guidance ? { guidance: r.guidance } : {}),
      ...(r.level ? { level: r.level } : {}),
      ...(r.mappings?.length ? { mappings: r.mappings } : {}),
    })),
  };
}

/** Sloupce exportu CSV (stejné názvy, jaké přijímá import). */
export const FRAMEWORK_CSV_HEADERS = ["ID", "Oddíl", "Název oddílu", "Text", "Vodítko", "Úroveň", "Mapování"] as const;

/* ---------------- DTO knihovny ---------------- */

export interface FrameworkLibraryItem extends FrameworkMeta {
  requirements: number;
  sections: number;
  /** Rámec sleduje aktivní společnost. */
  inScope: boolean;
  importedAt: string | null;
  /** Počet posouzení a vazeb (u vlastních – kvůli smazání). */
  assessed: number;
}

/** Názvy jurisdikcí (ostatní se zobrazí kódem). */
export const JURISDICTION_LABELS: Record<string, string> = {
  CZ: "Česko",
  SK: "Slovensko",
  PL: "Polsko",
  DE: "Německo",
  AT: "Rakousko",
  HU: "Maďarsko",
  SI: "Slovinsko",
  HR: "Chorvatsko",
  RO: "Rumunsko",
  EU: "Evropská unie",
  INT: "Mezinárodní",
};
