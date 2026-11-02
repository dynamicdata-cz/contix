import { checkMethodology, MethodologyDef, type MethodologyFormat } from "@contix/shared";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

/* Balíčky metodik: YAML / JSON / XML ↔ ověřená definice (MethodologyDef). */

/* ---------------- parsování formátů ---------------- */

const XML_ARRAYS = new Set(["factor", "step", "area", "level", "rule", "when", "item"]);
const NUM = new Set(["value", "weight", "min", "max"]);
const BOOL = new Set(["perArea", "acceptable"]);

/** Normalizace výstupu XML parseru: obalové prvky → pole, čísla/booleany z atributů. */
function fromXml(root: Record<string, unknown>): unknown {
  const conv = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(conv);
    if (!o || typeof o !== "object") return o;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (NUM.has(k) && typeof v === "string" && v.trim() !== "") out[k] = Number(v);
      else if (BOOL.has(k) && typeof v === "string") out[k] = v === "true" || v === "1";
      else out[k] = conv(v);
    }
    return out;
  };
  const m = conv(root) as Record<string, any>;
  const unwrap = (x: any, tag: string) => (x && typeof x === "object" && !Array.isArray(x) ? (x[tag] ?? []) : x);
  if (m.factors) m.factors = unwrap(m.factors, "factor").map((f: any) => ({ ...f, scale: unwrap(f.scale, "step") }));
  if (m.areas) m.areas = unwrap(m.areas, "area");
  if (m.levels) m.levels = unwrap(m.levels, "level");
  if (m.steps) m.steps = unwrap(m.steps, "step");
  if (m.checklist) m.checklist = unwrap(m.checklist, "item");
  if (m.rules)
    m.rules = unwrap(m.rules, "rule").map((r: any) => ({
      level: r.level,
      when: Object.fromEntries((r.when ?? []).map((w: any) => [w.var, { ...(w.min !== undefined && { min: w.min }), ...(w.max !== undefined && { max: w.max }) }])),
    }));
  return m;
}

function toXml(def: MethodologyDef): string {
  const d = structuredClone(def) as Record<string, any>;
  const attrs = (o: Record<string, any>, keys: string[]) => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) out[keys.includes(k) ? `@_${k}` : k] = v;
    return out;
  };
  const root: Record<string, any> = attrs({ kind: d.kind, id: d.id, version: d.version }, ["kind", "id", "version"]);
  for (const k of ["name", "description", "source", "formula", "areaAggregate"]) if (d[k] !== undefined) root[k] = d[k];
  if (d.matrix) root.matrix = attrs(d.matrix, ["x", "y"]);
  if (d.areas) root.areas = { area: d.areas.map((a: any) => attrs(a, ["key", "label", "weight"])) };
  if (d.factors)
    root.factors = {
      factor: d.factors.map((f: any) => ({
        ...attrs({ key: f.key, perArea: f.perArea }, ["key", "perArea"]),
        label: f.label,
        ...(f.description && { description: f.description }),
        scale: { step: f.scale.map((s: any) => attrs(s, ["value", "label"])) },
      })),
    };
  if (d.levels) root.levels = { level: d.levels.map((l: any) => attrs(l, ["key", "label", "mapsTo", "min", "max", "acceptable", "treatment"])) };
  if (d.rules)
    root.rules = {
      rule: d.rules.map((r: any) => ({ "@_level": r.level, when: Object.entries(r.when).map(([k, v]: [string, any]) => attrs({ var: k, ...v }, ["var", "min", "max"])) })),
    };
  if (d.steps) root.steps = { step: d.steps.map((s: any) => attrs(s, ["key", "title"])) };
  if (d.checklist) root.checklist = { item: d.checklist.map((i: any) => attrs(i, ["id", "section", "ref", "requirementId"])) };
  const xml = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true, indentBy: "  ", suppressEmptyNode: true, suppressBooleanAttributes: false }).build({ methodology: root });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}

/** Text balíčku → ověřená definice (nebo seznam chyb). */
export function parseMethodology(format: MethodologyFormat, content: string): { def: MethodologyDef | null; errors: string[] } {
  let raw: unknown;
  try {
    if (format === "json") raw = JSON.parse(content);
    else if (format === "yaml") raw = Bun.YAML.parse(content);
    else {
      const parsed = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        parseAttributeValue: false,
        parseTagValue: false,
        trimValues: true,
        processEntities: true,
        isArray: (name, _jpath, _leaf, isAttribute) => !isAttribute && XML_ARRAYS.has(name),
      }).parse(content);
      if (!parsed?.methodology) return { def: null, errors: ["Kořenový prvek musí být <methodology>."] };
      raw = fromXml(parsed.methodology);
    }
  } catch (e) {
    return { def: null, errors: [`Soubor nelze načíst jako ${format.toUpperCase()}: ${(e as Error).message}`] };
  }
  const p = MethodologyDef.safeParse(raw);
  if (!p.success) return { def: null, errors: p.error.issues.map((i) => `${i.path.join(".") || "(kořen)"}: ${i.message}`) };
  const errors = checkMethodology(p.data);
  return { def: errors.length ? null : p.data, errors };
}

export function serializeMethodology(def: MethodologyDef, format: MethodologyFormat): string {
  if (format === "json") return JSON.stringify(def, null, 2);
  if (format === "yaml") return `# Metodika CONTIX – ${def.name}\n${Bun.YAML.stringify(def, null, 2)}`;
  return toXml(def);
}

