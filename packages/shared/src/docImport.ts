import { z } from "zod";
import { requirementById, requirementsOf } from "./frameworks";
import { CLASSIFICATIONS, DOC_CODE_PREFIX, MANAGEMENT_SYSTEMS, POLICY_LABELS, POLICY_TYPES, type Classification, type ManagementSystem, type PolicyType } from "./policies";

/* ============================================================
 * Hromadný import dokumentace (v0.32): ZIP = tabulka metadat (CSV / XLSX) + soubory dokumentů.
 * Sloupce odpovídají mapě metadat řídicí dokumentace (ID, Název, Druh, Klasifikační stupeň, Gestor,
 * Vlastník procesu, Schvalovatel, Právní vazba, Přezkum, Nadřazený dokument, Verze, Soubor).
 * Role se párují na funkční místa podle názvu, ručně je lze přemapovat v náhledu.
 * ============================================================ */

/** Názvy sloupců (bez ohledu na velikost písmen a diakritiku). */
export const DOC_IMPORT_COLUMNS = {
  code: ["ID", "Označení", "Kód", "Code"],
  title: ["Název", "Title"],
  docType: ["Druh", "Druh dokumentu", "Typ"],
  classification: ["Klasifikační stupeň", "Klasifikace"],
  owner: ["Gestor"],
  reviewer: ["Vlastník procesu"],
  approver: ["Schvalovatel"],
  legal: ["Právní vazba", "Oddíly"],
  review: ["Přezkum", "Interval přezkumu"],
  parent: ["Nadřazený dokument", "Nadřazený"],
  version: ["Verze"],
  file: ["Soubor", "File"],
  description: ["Popis", "Účel"],
  system: ["Systém řízení", "Oblast", "Systém"],
  requirements: ["Požadavky", "Požadavky předpisů", "Requirements"],
} as const;
export type DocImportColumn = keyof typeof DOC_IMPORT_COLUMNS;
export const DOC_IMPORT_MAX_ROWS = 1000;

/** Porovnávací tvar textu: malá písmena, bez diakritiky, bez obsahu hranatých závorek, sjednocené mezery. */
export function normName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\[[^\]]*\]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();
}

export function docImportColumns(headers: string[]): Partial<Record<DocImportColumn, number>> {
  const n = headers.map(normName);
  const out: Partial<Record<DocImportColumn, number>> = {};
  for (const [k, names] of Object.entries(DOC_IMPORT_COLUMNS) as [DocImportColumn, readonly string[]][]) {
    const i = n.findIndex((h) => names.some((x) => normName(x) === h));
    if (i >= 0) out[k] = i;
  }
  return out;
}

/** Druh dokumentu z popisku („Směrnice“, „Standard / technická konfigurace“…), jinak z prefixu označení. */
export function docTypeFrom(label: string, code: string | null): PolicyType | null {
  const l = normName(label);
  if (l) {
    for (const t of POLICY_TYPES) if (normName(POLICY_LABELS.type[t]) === l || normName(POLICY_LABELS.type[t]).startsWith(l)) return t;
    const words: [string, PolicyType][] = [
      ["politik", "policy"], ["smernic", "directive"], ["metodik", "methodology"], ["rozhodnut", "decision"], ["postup", "procedure"],
      ["standard", "standard"], ["plan", "plan"], ["pokyn", "guideline"], ["prirucka", "guideline"], ["zaznam", "record"], ["evidenc", "record"], ["registr", "record"],
    ];
    for (const [w, t] of words) if (l.includes(w)) return t;
  }
  const p = (code ?? "").toUpperCase().split("-")[0];
  const byPrefix: Record<string, PolicyType> = { POL: "policy", SM: "directive", MET: "methodology", MT: "methodology", RO: "decision", PR: "procedure", PP: "procedure", STD: "standard", ST: "standard", PLN: "plan", PL: "plan", PK: "guideline", EVD: "record", ZA: "record" };
  for (const [t, pre] of Object.entries(DOC_CODE_PREFIX)) byPrefix[pre] ??= t as PolicyType;
  return p && byPrefix[p] ? byPrefix[p]! : null;
}

export function classificationFrom(label: string): Classification | null {
  const l = normName(label);
  if (!l) return null;
  for (const c of CLASSIFICATIONS) if (normName(POLICY_LABELS.classification[c]) === l || l === c) return c;
  if (l.includes("prisne") || l.includes("tajn")) return "restricted";
  if (l.includes("duver")) return "confidential";
  if (l.includes("verej")) return "public";
  if (l.includes("intern")) return "internal";
  return null;
}

/** Interval přezkumu v měsících („1× ročně“, „čtvrtletně“, „pololetně“, „24 měsíců“…); neznámé = 12. */
export function reviewMonthsFrom(text: string): number {
  const l = normName(text);
  const m = l.match(/(\d+)\s*(mesic|m\b)/);
  if (m) return Math.min(60, Math.max(1, Number(m[1])));
  if (l.includes("ctvrtlet")) return 3;
  if (l.includes("pololet")) return 6;
  if (l.includes("mesicn")) return 1;
  if (/2\s*roky|dvouleti|za 2 roky/.test(l)) return 24;
  return 12;
}

const SECTION_SETS = { cz409: new Set(requirementsOf("cz409").map((r) => r.section)), cz410: new Set(requirementsOf("cz410").map((r) => r.section)) };
/** Oddíly vyhlášky (409 nebo 410 podle režimu) z textu právní vazby („§ 13; § 19 odst. 1–6“ → § 13, § 19). Paragrafy zákona se ignorují. */
export function sectionsFrom(text: string, decree: "cz409" | "cz410" = "cz409"): string[] {
  const SECTION_SET = SECTION_SETS[decree];
  const out: string[] = [];
  for (const part of text.split(/[;,]/)) {
    // paragrafy zákona („§ 15–16 zákona“) nejsou oddíly vyhlášky
    if (/z[aá]kon/i.test(part)) continue;
    // „§ 21–23“ = rozsah paragrafů; „§ 19 odst. 1–6“ = jen § 19
    for (const m of part.matchAll(/§\s*(\d+)(?:\s*[–-]\s*(\d+))?/g)) {
      const from = Number(m[1]);
      const to = m[2] ? Math.min(Number(m[2]), from + 30) : from;
      for (let p = from; p <= to; p++) if (SECTION_SET.has(`§ ${p}`) && !out.includes(`§ ${p}`)) out.push(`§ ${p}`);
    }
  }
  return out;
}

/** Systém řízení z popisku („Kvalita (ISO 9001)“, „BOZP“, „isms“…); prázdné = ISMS. */
export function systemFrom(label: string): ManagementSystem | null {
  const l = normName(label);
  if (!l) return "isms";
  for (const s of MANAGEMENT_SYSTEMS) if (l === s || normName(POLICY_LABELS.system[s]) === l) return s;
  const words: [RegExp, ManagementSystem][] = [
    [/9001|kvalit|qms/, "qms"], [/14001|zivotni prostredi|ems/, "ems"], [/45001|bozp|ohs/, "ohs"], [/gdpr|osobni udaj|privacy/, "privacy"],
    [/22301|kontinuit|bcm/, "bcm"], [/27001|isms|bezpecnost|kybern|dora|409|410/, "isms"], [/obecn|vnitrni predpis|general/, "general"],
  ];
  for (const [re, s] of words) if (re.test(l)) return s;
  return null;
}

/** ID požadavků ze sloupce „Požadavky“ (oddělené ; , nebo mezerou), např. „iso27001:5.2; iso9001:7.5; dora:6“. */
export function requirementIdsFrom(text: string): { ids: string[]; unknown: string[] } {
  const parts = text.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const x of parts) (requirementById(x) ? (ids.includes(x) ? null : ids.push(x)) : unknown.push(x));
  return { ids, unknown };
}

export interface DocImportRow {
  line: number;
  code: string | null;
  title: string;
  docType: PolicyType | null;
  system: ManagementSystem;
  requirementIds: string[];
  classification: Classification;
  owner: string | null;
  reviewer: string | null;
  approver: string | null;
  sections: string[];
  reviewMonths: number;
  parentCode: string | null;
  version: string;
  description: string | null;
  /** Soubor v archivu (cesta), null = nenalezen. */
  file: string | null;
  /** Dokument se stejným označením už ve společnosti existuje → přeskočí se. */
  exists: boolean;
  errors: string[];
  warnings: string[];
}

/** Řádek tabulky → záznam importu (bez kontroly souborů a existence – to doplní API). */
export function parseDocImportRow(cols: Partial<Record<DocImportColumn, number>>, row: string[], line: number, decree: "cz409" | "cz410" = "cz409"): DocImportRow {
  const get = (k: DocImportColumn) => (cols[k] != null ? (row[cols[k]!] ?? "").trim() : "");
  const code = get("code") || null;
  let title = get("title");
  // „POL-07 – Politika…“ → „Politika…“
  if (code && title.startsWith(code)) title = title.slice(code.length).replace(/^\s*[–—:-]\s*/, "").trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!title) errors.push("Chybí název dokumentu.");
  if (title.length > 300) errors.push("Název je delší než 300 znaků.");
  if (code && code.length > 50) errors.push("Označení je delší než 50 znaků.");
  const docType = docTypeFrom(get("docType"), code);
  if (!docType) errors.push(`Neznámý druh dokumentu „${get("docType")}“.`);
  const cl = classificationFrom(get("classification"));
  if (get("classification") && !cl) warnings.push(`Neznámá klasifikace „${get("classification")}“ – použije se Interní.`);
  const system = systemFrom(get("system"));
  if (!system) warnings.push(`Neznámý systém řízení „${get("system")}“ – použije se bezpečnost informací (ISMS).`);
  const reqs = requirementIdsFrom(get("requirements"));
  if (reqs.unknown.length) warnings.push(`Neznámé požadavky: ${reqs.unknown.slice(0, 5).join(", ")}${reqs.unknown.length > 5 ? "…" : ""}.`);
  const parent = get("parent").replace(/^[—–-]+$/, "").trim();
  const version = (get("version") || "1.0").slice(0, 20);
  const role = (k: DocImportColumn) => get(k).replace(/^[—–-]+$/, "").trim() || null;
  return {
    line,
    code,
    title: title.slice(0, 300),
    docType,
    system: system ?? "isms",
    requirementIds: reqs.ids,
    classification: cl ?? "internal",
    owner: role("owner"),
    reviewer: role("reviewer"),
    approver: role("approver"),
    // oddíly vyhlášky jen u bezpečnostní dokumentace
    sections: (system ?? "isms") === "isms" ? sectionsFrom(get("legal"), decree) : [],
    reviewMonths: reviewMonthsFrom(get("review")),
    parentCode: parent || null,
    version,
    description: get("description") || null,
    file: null,
    exists: false,
    errors,
    warnings,
  };
}

export interface DocImportPreviewDto {
  /** Soubor s metadaty v archivu. */
  metadataFile: string;
  rows: DocImportRow[];
  /** Názvy rolí z tabulky a navržené funkční místo (shoda názvu). */
  roles: { name: string; count: number; positionId: string | null }[];
  /** Soubory v archivu, které nepatří žádnému řádku. */
  unusedFiles: string[];
  summary: { total: number; create: number; skip: number; errors: number; withoutFile: number };
}

export const DocImportOptions = z.object({
  /** Název role → funkční místo (null = nepřiřazovat). */
  mapping: z.record(z.string().max(300), z.string().uuid().nullable()).default({}),
  /** Cílová složka (null = bez složky). */
  folderId: z.string().uuid().nullable().optional(),
  /** Zakládat složky podle druhu dokumentu (pod cílovou složkou). */
  foldersByType: z.boolean().default(false),
  /** Vyžadovat seznámení (u politik a směrnic). */
  requireAcknowledgement: z.boolean().default(true),
});
export type DocImportOptions = z.input<typeof DocImportOptions>;

export interface DocImportResultDto {
  created: { id: string; code: string | null; title: string }[];
  skipped: { line: number; code: string | null; reason: string }[];
  linkedParents: number;
  files: number;
}
