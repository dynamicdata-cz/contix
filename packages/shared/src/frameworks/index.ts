/**
 * Regulatorní rámce a jejich požadavky pro modul Opatření a shoda.
 * - ZKB: zákon č. 264/2025 Sb., o kybernetické bezpečnosti (§ 12 – stanovení rozsahu)
 * - CZ409 / CZ410: vyhlášky o bezpečnostních opatřeních (vyšší / nižší povinnosti) – plné znění z e-Sbírky
 * - ISO/IEC 27001:2022 – čísla kapitol a opatření přílohy A; názvy jsou vlastní stručné popisky CONTIX
 *   (text normy je chráněn autorským právem – plné znění mějte z licencované normy)
 * - DORA: nařízení (EU) 2022/2554 – články s úředními českými názvy (EUR-Lex)
 * - NIS2: směrnice (EU) 2022/2555 (čl. 20, 21, 23) a příloha prováděcího nařízení (EU) 2024/2690 – úřední české znění (EUR-Lex)
 * - ISO 9001:2015 – čísla kapitol a vlastní stručné popisky CONTIX (systém managementu kvality, bez textu normy)
 * - SOC 2: AICPA Trust Services Criteria – jen ID kritérií a vlastní popisky CONTIX (text je chráněn autorským právem)
 */
import { CZ409 } from "./data/cz409";
import { CZ410, ZKB12 } from "./data/cz410";
import { DORA_ARTICLES, ISO9001_CLAUSES, ISO_ANNEX_A, ISO_CLAUSES } from "./data/international";
import { NIS2_DIRECTIVE, NIS2_IR } from "./data/nis2";
import { SOC2_CATEGORIES, SOC2_CRITERIA, SOC2_SECTIONS } from "./data/soc2";
import { CIS_CONTROLS, CIS_SAFEGUARDS } from "./data/cis";
import { z } from "zod";

export { SOC2_CATEGORIES, SOC2_CRITERIA, SOC2_SECTIONS };

/** Vestavěné rámce (data v kódu). Vlastní rámce z knihovny mají ID „x-<klíč>“ (ADR-079). */
export const FRAMEWORK_IDS = ["zkb", "cz409", "cz410", "iso27001", "dora", "nis2", "soc2", "iso9001", "cis8"] as const;
export type BuiltinFrameworkId = (typeof FRAMEWORK_IDS)[number];
export type CustomFrameworkId = `x-${string}`;
export type FrameworkId = BuiltinFrameworkId | CustomFrameworkId;

export const CUSTOM_FRAMEWORK_RE = /^x-[a-z0-9][a-z0-9-]{1,39}$/;
export const isCustomFrameworkId = (id: string): id is CustomFrameworkId => CUSTOM_FRAMEWORK_RE.test(id);
/** ID rámce – vestavěný nebo vlastní (bez ověření existence; to řeší `frameworkExists`). */
export const FrameworkIdPattern = z.union([z.enum(FRAMEWORK_IDS), z.string().regex(CUSTOM_FRAMEWORK_RE) as unknown as z.ZodType<CustomFrameworkId>]);
/** ID existujícího rámce (vestavěný nebo načtený vlastní z knihovny). */
export const FrameworkIdSchema = FrameworkIdPattern.refine((id) => frameworkExists(id), { message: "Neznámý rámec" });
export const frameworkExists = (id: string): id is FrameworkId => FRAMEWORKS.some((f) => f.id === id);
/** Pořadí rámce pro řazení (vestavěné podle FRAMEWORK_IDS, vlastní za nimi). */
export const frameworkOrder = (id: string) => {
  const i = FRAMEWORKS.findIndex((f) => f.id === id);
  return i < 0 ? 999 : i;
};

/** Vyhláška podle režimu: vyšší povinnosti = 409, nižší = 410, neregulovaná = žádná. */
export const decreeFor = (regime: "higher" | "lower" | "none"): FrameworkId | null => (regime === "higher" ? "cz409" : regime === "lower" ? "cz410" : null);

/**
 * Rámce v rozsahu společnosti (ADR-074): zákon a vyhláška podle režimu + zvolené další rámce.
 * `selected = null` (nezvoleno) = další rámce, které mají aspoň jedno posouzení (`assessed`).
 */
export function frameworksInScope(
  profile: "higher" | "lower" | "none" | { law: FrameworkId | null; primary: FrameworkId | null; sector?: FrameworkId | null },
  selected: readonly string[] | null | undefined,
  assessed: readonly string[] = [],
): FrameworkId[] {
  // regulatorní profil (ADR-080): zákon + hlavní rámec; řetězec = český režim (zpětná kompatibilita)
  const base = typeof profile === "string" ? (decreeFor(profile) ? (["zkb", decreeFor(profile)!] as FrameworkId[]) : []) : [profile.law, profile.primary, profile.sector ?? null].filter((x): x is FrameworkId => !!x);
  const extra = (selected ?? assessed).filter((f) => ["iso27001", "dora", "nis2", "soc2", "iso9001", "cis8"].includes(f) || (isCustomFrameworkId(f) && frameworkExists(f)));
  return [...new Set([...base, ...FRAMEWORKS.map((f) => f.id).filter((f) => extra.includes(f))])];
}

export const FRAMEWORK_KINDS = ["law", "regulation", "directive", "standard", "framework", "internal"] as const;
export type FrameworkKind = (typeof FRAMEWORK_KINDS)[number];
export const FRAMEWORK_KIND_LABELS: Record<FrameworkKind, string> = {
  law: "Zákon",
  regulation: "Vyhláška / nařízení",
  directive: "Směrnice EU",
  standard: "Norma",
  framework: "Rámec / osvědčená praxe",
  internal: "Interní požadavky",
};
/** K čemu rámec slouží: posouzení shody (GAP / SoA), audit, analýza rizik. */
export const FRAMEWORK_USES = ["gap", "audit", "risk"] as const;
export type FrameworkUse = (typeof FRAMEWORK_USES)[number];
export const FRAMEWORK_USE_LABELS: Record<FrameworkUse, string> = { gap: "Shoda (GAP / SoA)", audit: "Audit", risk: "Analýza rizik" };
/** Kód státu (ISO 3166-1 alfa-2), EU nebo INT (mezinárodní). */
export const JURISDICTION_RE = /^([A-Z]{2}|EU|INT)$/;

export interface FrameworkMeta {
  id: FrameworkId;
  name: string;
  shortName: string;
  description: string;
  source: string;
  /** Text požadavků je úředním dílem / plným zněním (true), nebo jen popiskem (false). */
  fullText: boolean;
  /** Stát (CZ, SK, PL…), EU nebo INT. */
  jurisdiction: string;
  kind: FrameworkKind;
  uses: FrameworkUse[];
  version: string;
  /** Jazyk textů (BCP 47); prázdné = čeština u vestavěných. */
  language: string;
  /** Vlastní rámec z knihovny (import). */
  custom: boolean;
}

type BuiltinMeta = Omit<FrameworkMeta, "custom" | "uses" | "language"> & { uses?: FrameworkUse[]; language?: string };
const BUILTIN_META: BuiltinMeta[] = [
  {
    id: "zkb",
    jurisdiction: "CZ",
    kind: "law",
    version: "264/2025",
    name: "Zákon č. 264/2025 Sb., o kybernetické bezpečnosti",
    shortName: "ZKB",
    description: "Stanovení rozsahu řízení kybernetické bezpečnosti (§ 12).",
    source: "e-Sbírka; auditní checklist NÚKIB (31. 3. 2026)",
    fullText: true,
  },
  {
    id: "cz409",
    jurisdiction: "CZ",
    kind: "regulation",
    version: "409/2025",
    name: "Vyhláška č. 409/2025 Sb. – režim vyšších povinností",
    shortName: "Vyhl. 409",
    description: "Bezpečnostní opatření poskytovatele regulované služby v režimu vyšších povinností (§ 3–27).",
    source: "e-Sbírka, znění účinné od 1. 11. 2025",
    fullText: true,
  },
  {
    id: "cz410",
    jurisdiction: "CZ",
    kind: "regulation",
    version: "410/2025",
    name: "Vyhláška č. 410/2025 Sb. – režim nižších povinností",
    shortName: "Vyhl. 410",
    description: "Bezpečnostní opatření poskytovatele regulované služby v režimu nižších povinností (§ 3–14).",
    source: "e-Sbírka, znění účinné od 1. 11. 2025",
    fullText: true,
  },
  {
    id: "iso27001",
    jurisdiction: "INT",
    kind: "standard",
    version: "2022",
    name: "ISO/IEC 27001:2022",
    shortName: "ISO 27001",
    description: "Požadavky na ISMS (kap. 4–10) a opatření přílohy A (93). Názvy jsou stručné popisky CONTIX.",
    source: "Struktura normy ISO/IEC 27001:2022 (bez textu normy)",
    fullText: false,
  },
  {
    id: "dora",
    jurisdiction: "EU",
    kind: "regulation",
    version: "2022/2554",
    name: "DORA – nařízení (EU) 2022/2554",
    shortName: "DORA",
    description: "Digitální provozní odolnost finančního sektoru – řízení rizik IKT, incidenty, testování, třetí strany.",
    source: "EUR-Lex, úřední český název článků",
    fullText: false,
  },
  {
    id: "nis2",
    jurisdiction: "EU",
    kind: "directive",
    version: "2022/2555",
    name: "NIS2 – směrnice (EU) 2022/2555 a prováděcí nařízení (EU) 2024/2690",
    shortName: "NIS2",
    description:
      "Povinnosti subjektů podle směrnice NIS2 (čl. 20 řízení, čl. 21 opatření k řízení rizik, čl. 23 hlášení) a technické a metodické požadavky přílohy prováděcího nařízení (EU) 2024/2690 (13 oblastí).",
    source: "EUR-Lex, úřední české znění (CELEX 32022L2555 a 32024R2690)",
    fullText: true,
  },
  {
    id: "soc2",
    jurisdiction: "INT",
    kind: "framework",
    version: "2017 (rev. 2022)",
    name: "SOC 2 – Trust Services Criteria (AICPA)",
    shortName: "SOC 2",
    description:
      "Kritéria pro atestační zprávu SOC 2: bezpečnost (společná kritéria CC1–CC9, povinná) a volitelně dostupnost, důvěrnost, integrita zpracování a soukromí. Názvy jsou stručné popisky CONTIX.",
    source: "Struktura TSC 2017 (rev. 2022) – bez textu kritérií",
    fullText: false,
  },
  {
    id: "iso9001",
    jurisdiction: "INT",
    kind: "standard",
    version: "2015",
    name: "ISO 9001:2015 – systém managementu kvality",
    shortName: "ISO 9001",
    description: "Požadavky na systém managementu kvality (kap. 4–10). Názvy jsou stručné popisky CONTIX.",
    source: "Struktura normy ISO 9001:2015 (bez textu normy)",
    fullText: false,
  },
  {
    id: "cis8",
    jurisdiction: "INT",
    kind: "framework",
    version: "8.1",
    name: "CIS Critical Security Controls v8.1",
    shortName: "CIS v8.1",
    description: "18 opatření a 153 dílčích opatření (safeguards) v implementačních skupinách IG1–IG3. Názvy jsou stručné popisky CONTIX.",
    source: "Struktura CIS Controls v8.1 (bez textu CIS – licence CC BY-NC-ND 4.0)",
    fullText: false,
  },
];

/** Vestavěné + načtené vlastní rámce (pole se mění na místě při `registerCustomFrameworks`). */
export const FRAMEWORKS: FrameworkMeta[] = BUILTIN_META.map((m) => ({ ...m, uses: m.uses ?? ["gap", "audit"], language: m.language ?? "cs", custom: false }));

/** Implementační skupina CIS (1–3), od které dílčí opatření platí. */
export const CIS_IG: Record<string, 1 | 2 | 3> = Object.fromEntries(CIS_SAFEGUARDS.map(([id, ig]) => [`cis8:${id}`, ig]));
export const cisIgOf = (requirementId: string): 1 | 2 | 3 | null => CIS_IG[requirementId] ?? null;

export interface Requirement {
  /** Stabilní ID, např. "cz409:8/1/f" nebo "iso27001:A.5.15". */
  id: string;
  framework: FrameworkId;
  /** Oddíl (§ / kapitola / článek) – pro seskupení. */
  section: string;
  sectionTitle: string;
  /** Citace, např. "§ 8 odst. 1 písm. f)". */
  ref: string;
  text: string;
  /** Body (1., 2., …) patřící k požadavku – zobrazují se pod textem. */
  points: string[];
  /** Úvodní věta odstavce/paragrafu, ke které se požadavek váže (kontext). */
  lead: string | null;
  order: number;
  /** Vodítko / doplňující text (vlastní rámce). */
  guidance?: string | null;
  /** Úroveň / kategorie (např. IG, priorita, typ subjektu). */
  level?: string | null;
  /** ID požadavků jiných rámců, se kterými je obsahově shodný nebo příbuzný (oboustranně). */
  mappings?: string[];
}

/**
 * Parsuje data ve formátu "#§|nadpis" / "odst|písm|bod|text".
 * Posuzovaný požadavek = písmeno, nebo odstavec bez písmen. Body se připojí k nadřazenému požadavku,
 * úvodní věty (odstavec s písmeny) slouží jako kontext.
 */
function parseDecree(fw: FrameworkId, data: string): Requirement[] {
  type Row = { o: string; l: string; b: string; t: string };
  const sections: { par: string; title: string; rows: Row[] }[] = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) {
      const [par, title] = line.slice(1).split("|");
      sections.push({ par: par!, title: title!, rows: [] });
      continue;
    }
    const [o, l, b, ...rest] = line.split("|");
    sections.at(-1)!.rows.push({ o: o!, l: l!, b: b!, t: rest.join("|") });
  }
  const out: Requirement[] = [];
  let order = 0;
  for (const s of sections) {
    const hasLetters = (o: string) => s.rows.some((r) => r.o === o && r.l);
    for (const r of s.rows) {
      if (r.b) {
        // bod – připojit k požadavku (písmeno nebo odstavec)
        const parentId = `${fw}:${s.par}${r.o ? `/${r.o}` : ""}${r.l ? `/${r.l}` : ""}`;
        const parent = out.find((x) => x.id === parentId);
        parent?.points.push(`${r.b}. ${r.t}`);
        continue;
      }
      if (!r.l && hasLetters(r.o)) continue; // úvodní věta – jen kontext
      const lead = r.l ? (s.rows.find((x) => x.o === r.o && !x.l && !x.b)?.t ?? null) : null;
      const ref = `§ ${s.par}${r.o ? ` odst. ${r.o}` : ""}${r.l ? ` písm. ${r.l})` : ""}`;
      out.push({
        id: `${fw}:${s.par}${r.o ? `/${r.o}` : ""}${r.l ? `/${r.l}` : ""}`,
        framework: fw,
        section: `§ ${s.par}`,
        sectionTitle: s.title,
        ref,
        text: r.t,
        points: [],
        lead,
        order: order++,
      });
    }
  }
  return out;
}

function iso(): Requirement[] {
  let order = 0;
  const clauses = ISO_CLAUSES.map(([id, title]) => ({
    id: `iso27001:${id}`,
    framework: "iso27001" as const,
    section: `Kap. ${id.split(".")[0]}`,
    sectionTitle: "Požadavky na ISMS",
    ref: `kap. ${id}`,
    text: title,
    points: [],
    lead: null,
    order: order++,
  }));
  const themes: Record<string, string> = {
    "5": "Organizační opatření",
    "6": "Opatření týkající se lidí",
    "7": "Fyzická opatření",
    "8": "Technologická opatření",
  };
  const annex = ISO_ANNEX_A.map(([id, title]) => ({
    id: `iso27001:A.${id}`,
    framework: "iso27001" as const,
    section: `A.${id.split(".")[0]}`,
    sectionTitle: themes[id.split(".")[0]!]!,
    ref: `A.${id}`,
    text: title,
    points: [],
    lead: null,
    order: order++,
  }));
  return [...clauses, ...annex];
}

function dora(): Requirement[] {
  return DORA_ARTICLES.map(([art, chapter, title, summary], i) => ({
    id: `dora:${art}`,
    framework: "dora" as const,
    section: chapter,
    sectionTitle: DORA_CHAPTERS[chapter] ?? chapter,
    ref: `čl. ${art}`,
    text: title,
    points: summary ? [summary] : [],
    lead: null,
    order: i,
  }));
}

/**
 * NIS2: směrnice (čl. → odstavec → písmeno, ID nis2:21/2/a) a příloha prováděcího nařízení 2024/2690 (bod, ID nis2:P1.1.1).
 * Posuzovaný požadavek = písmeno, odstavec bez písmen, nebo bod přílohy (písmena přílohy jsou jeho body).
 */
function nis2(): Requirement[] {
  const out: Requirement[] = [];
  let order = 0;
  // směrnice
  type Row = { o: string; l: string; t: string };
  const arts: { art: string; title: string; rows: Row[] }[] = [];
  for (const line of NIS2_DIRECTIVE.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("#")) {
      const [art, title] = line.slice(1).split("|");
      arts.push({ art: art!, title: title!, rows: [] });
      continue;
    }
    const [o, l, ...rest] = line.split("|");
    arts.at(-1)!.rows.push({ o: o!, l: l!, t: rest.join("|") });
  }
  for (const a of arts) {
    for (const r of a.rows) {
      if (r.l === "-") {
        out.filter((x) => x.id.startsWith(`nis2:${a.art}/${r.o}`)).at(-1)?.points.push(r.t);
        continue;
      }
      if (!r.l && a.rows.some((x) => x.o === r.o && x.l && x.l !== "-")) continue; // úvodní věta odstavce – kontext
      out.push({
        id: `nis2:${a.art}/${r.o}${r.l ? `/${r.l}` : ""}`,
        framework: "nis2",
        section: `Čl. ${a.art}`,
        sectionTitle: a.title,
        ref: `čl. ${a.art} odst. ${r.o}${r.l ? ` písm. ${r.l})` : ""}`,
        text: r.t,
        points: [],
        lead: r.l ? (a.rows.find((x) => x.o === r.o && !x.l)?.t ?? null) : null,
        order: order++,
      });
    }
  }
  // příloha prováděcího nařízení
  let sec = "";
  let secTitle = "";
  let sub = "";
  for (const line of NIS2_IR.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("##")) {
      sub = line.slice(2).split("|")[1] ?? "";
      continue;
    }
    if (line.startsWith("#")) {
      [sec, secTitle] = line.slice(1).split("|") as [string, string];
      // „… (čl. 21 odst. 2 písm. a) směrnice (EU) 2022/2555)“ – odkaz na směrnici je v textu bodů, nadpis zkrátit
      secTitle = secTitle.replace(/\s*\(čl\. 21 odst\. 2 .*\)$/, "");
      sub = "";
      continue;
    }
    const [pt, l, ...rest] = line.split("|");
    const t = rest.join("|");
    if (!l) {
      out.push({ id: `nis2:P${pt}`, framework: "nis2", section: `Příl. ${sec}`, sectionTitle: secTitle, ref: `2024/2690 bod ${pt}`, text: t, points: [], lead: sub || null, order: order++ });
      continue;
    }
    const req = out.find((x) => x.id === `nis2:P${pt}`);
    req?.points.push(l === "-" ? t : `${l}) ${t}`);
  }
  return out;
}

function iso9001(): Requirement[] {
  const titles: Record<string, string> = { "4": "Kontext organizace", "5": "Vedení", "6": "Plánování", "7": "Podpora", "8": "Provoz", "9": "Hodnocení výkonnosti", "10": "Zlepšování" };
  return ISO9001_CLAUSES.map(([id, title], i) => ({
    id: `iso9001:${id}`,
    framework: "iso9001" as const,
    section: `Kap. ${id.split(".")[0]}`,
    sectionTitle: titles[id.split(".")[0]!]!,
    ref: `kap. ${id}`,
    text: title,
    points: [],
    lead: null,
    order: i,
  }));
}

function soc2(): Requirement[] {
  return SOC2_CRITERIA.map(([id, section, title], i) => ({
    id: `soc2:${id}`,
    framework: "soc2" as const,
    section,
    sectionTitle: SOC2_SECTIONS[section] ?? section,
    ref: id,
    text: title,
    points: [],
    lead: null,
    order: i,
  }));
}

function cis8(): Requirement[] {
  return CIS_SAFEGUARDS.map(([id, ig, title], i) => {
    const c = id.split(".")[0]!;
    return { id: `cis8:${id}`, framework: "cis8" as const, section: `CIS ${c}`, sectionTitle: CIS_CONTROLS[c] ?? c, ref: `${id} · IG${ig}`, text: title, points: [], lead: null, order: i };
  });
}

export const DORA_CHAPTERS: Record<string, string> = {
  "Kap. II": "Řízení rizika v oblasti IKT",
  "Kap. III": "Incidenty související s IKT",
  "Kap. IV": "Testování digitální provozní odolnosti",
  "Kap. V": "Řízení rizika v oblasti IKT spojeného s třetími stranami",
  "Kap. VI": "Ujednání o sdílení informací",
};

let builtin: Requirement[] | null = null;
let custom: Requirement[] = [];
let cache: Requirement[] | null = null;
let byId = new Map<string, Requirement>();
let byFw = new Map<string, Requirement[]>();
let mapped = new Map<string, string[]>();
/** Verze registru – mění se při každé registraci vlastních rámců (pro memoizaci ve webu). */
export let frameworkRegistryVersion = 0;

function rebuild() {
  builtin ??= [...parseDecree("zkb", ZKB12), ...parseDecree("cz409", CZ409), ...parseDecree("cz410", CZ410), ...iso(), ...dora(), ...nis2(), ...soc2(), ...iso9001(), ...cis8()];
  cache = [...builtin, ...custom];
  byId = new Map(cache.map((r) => [r.id, r]));
  byFw = new Map();
  for (const r of cache) (byFw.get(r.framework) ?? byFw.set(r.framework, []).get(r.framework)!).push(r);
  // mapování z vlastních rámců platí oboustranně
  mapped = new Map();
  const add = (a: string, b: string) => {
    const l = mapped.get(a) ?? mapped.set(a, []).get(a)!;
    if (!l.includes(b)) l.push(b);
  };
  for (const r of custom) for (const m of r.mappings ?? []) if (byId.has(m) && m !== r.id) (add(r.id, m), add(m, r.id));
  return cache;
}

/** Všechny požadavky všech rámců (vestavěné se parsují jednou). */
export function allRequirements(): Requirement[] {
  return cache ?? rebuild();
}
export function requirementsOf(fw: FrameworkId | string): Requirement[] {
  if (!cache) rebuild();
  return byFw.get(fw) ?? [];
}
export function requirementById(id: string): Requirement | null {
  if (!cache) rebuild();
  return byId.get(id) ?? null;
}
/** Požadavky namapované na daný požadavek (mapování z knihovny rámců, oboustranně). */
export function mappedRequirements(id: string): Requirement[] {
  if (!cache) rebuild();
  return (mapped.get(id) ?? []).map((x) => byId.get(x)!).filter(Boolean);
}

/** Vlastní rámec z knihovny ve tvaru pro registr (API i web). */
export interface CustomFrameworkDto {
  meta: FrameworkMeta;
  requirements: Requirement[];
}

/** Nahradí vlastní rámce v registru (API po načtení z DB, web po stažení katalogu). */
export function registerCustomFrameworks(list: CustomFrameworkDto[]) {
  const builtinMeta = FRAMEWORKS.filter((f) => !f.custom);
  FRAMEWORKS.length = 0;
  FRAMEWORKS.push(...builtinMeta, ...list.map((x) => ({ ...x.meta, custom: true })));
  custom = list.flatMap((x) => x.requirements);
  frameworkRegistryVersion++;
  rebuild();
}

/* ============================================================
 * Mapování vyhlášky č. 409/2025 Sb. (§) na ISO/IEC 27001:2022, DORA, SOC 2 a vyhlášku č. 410/2025 Sb.
 * Orientační mapování CONTIX (odborný odhad obsahové příbuznosti) – ověřte pro svůj kontext.
 * ============================================================ */
export const CROSSWALK_409: Record<string, { iso: string[]; dora: number[]; cz410: string[]; soc2: string[]; zkb?: boolean }> = {
  "3": { iso: ["4.1", "4.2", "4.3", "4.4", "6.2", "9.1", "9.3", "10.1", "10.2", "A.5.1"], dora: [6], cz410: ["3"], soc2: ["CC3.1", "CC4.1", "CC4.2", "CC5.1"] },
  "4": { iso: ["5.1", "5.3", "7.1", "9.3", "A.5.2", "A.5.4"], dora: [5], cz410: ["4"], soc2: ["CC1.2", "CC1.3", "CC1.5"] },
  "5": { iso: ["5.3", "7.2", "A.5.2", "A.5.3"], dora: [5, 6], cz410: ["4"], soc2: ["CC1.3", "CC1.4"] },
  "6": { iso: ["5.2", "7.5", "A.5.1", "A.5.37"], dora: [6], cz410: ["3"], soc2: ["CC2.2", "CC5.3"] },
  "7": { iso: ["A.5.9", "A.5.10", "A.5.11", "A.5.12", "A.5.13", "A.5.14", "A.7.10", "A.7.14", "A.8.10"], dora: [8], cz410: ["3"], zkb: true, soc2: ["CC6.1", "CC6.5", "C1.1"] },
  "8": { iso: ["6.1.1", "6.1.2", "6.1.3", "8.2", "8.3"], dora: [6, 8], cz410: ["3"], soc2: ["CC3.1", "CC3.2", "CC3.3", "CC9.1"] },
  "9": { iso: ["A.5.19", "A.5.20", "A.5.21", "A.5.22", "A.5.23"], dora: [28, 29, 30], cz410: ["3"], soc2: ["CC9.2"] },
  "10": { iso: ["7.2", "7.3", "A.6.1", "A.6.2", "A.6.3", "A.6.4", "A.6.5", "A.6.6"], dora: [13], cz410: ["5"], soc2: ["CC1.4", "CC2.2"] },
  "11": { iso: ["6.3", "A.8.32"], dora: [9], cz410: [], soc2: ["CC3.4", "CC8.1"] },
  "12": { iso: ["A.5.8", "A.8.25", "A.8.26", "A.8.27", "A.8.28", "A.8.29", "A.8.30", "A.8.31", "A.8.33"], dora: [7, 9], cz410: ["3"], soc2: ["CC5.2", "CC8.1"] },
  "13": { iso: ["A.5.15", "A.5.18", "A.6.7", "A.8.1", "A.8.2", "A.8.3", "A.8.18"], dora: [9], cz410: ["7"], soc2: ["CC6.1", "CC6.2", "CC6.3"] },
  "14": { iso: ["A.5.5", "A.5.24", "A.5.25", "A.5.26", "A.5.27", "A.5.28", "A.6.8"], dora: [17, 18, 19], cz410: ["10", "14"], soc2: ["CC2.3", "CC7.3", "CC7.4", "CC7.5"] },
  "15": { iso: ["A.5.29", "A.5.30"], dora: [11, 12], cz410: ["6"], soc2: ["CC7.5", "CC9.1", "A1.2", "A1.3"] },
  "16": { iso: ["9.2", "A.5.35", "A.5.36", "A.8.34"], dora: [6, 24], cz410: [], soc2: ["CC4.1", "CC4.2"] },
  "17": { iso: ["A.7.1", "A.7.2", "A.7.3", "A.7.4", "A.7.5", "A.7.6", "A.7.7", "A.7.8", "A.7.11", "A.7.12", "A.7.13"], dora: [9], cz410: ["7"], soc2: ["CC6.4", "A1.2"] },
  "18": { iso: ["A.5.14", "A.8.20", "A.8.21", "A.8.22", "A.8.23"], dora: [9], cz410: ["11"], soc2: ["CC6.6", "CC6.7"] },
  "19": { iso: ["A.5.16", "A.5.17", "A.8.5"], dora: [9], cz410: ["8"], soc2: ["CC6.1", "CC6.2"] },
  "20": { iso: ["A.5.18", "A.8.2", "A.8.3"], dora: [9], cz410: ["8"], soc2: ["CC6.1", "CC6.3"] },
  "21": { iso: ["A.7.10", "A.8.7", "A.8.16", "A.8.23"], dora: [10], cz410: ["9"], soc2: ["CC6.8", "CC7.2"] },
  "22": { iso: ["A.8.15", "A.8.17"], dora: [10], cz410: ["9"], soc2: ["CC7.2"] },
  "23": { iso: ["A.5.7", "A.5.25", "A.8.16"], dora: [10, 13], cz410: ["9"], soc2: ["CC7.3"] },
  "24": { iso: ["A.8.8", "A.8.19", "A.8.26", "A.8.29"], dora: [9, 24, 25, 26], cz410: ["12"], soc2: ["CC7.1", "CC6.8"] },
  "25": { iso: ["A.5.14", "A.8.24"], dora: [9], cz410: ["13"], soc2: ["CC6.1", "CC6.7"] },
  "26": { iso: ["A.5.30", "A.8.6", "A.8.9", "A.8.13", "A.8.14"], dora: [11, 12], cz410: ["6"], soc2: ["A1.1", "A1.2"] },
  "27": { iso: ["A.7.2", "A.8.8", "A.8.20", "A.8.22"], dora: [9], cz410: [], soc2: ["CC6.6", "CC6.8"] },
};

/**
 * Vyhláška 409 (§) → NIS2: písmena čl. 20/21/23 směrnice a body přílohy prováděcího nařízení 2024/2690 (oddíly „1.1“ zahrnují body 1.1.x).
 * Orientační mapování CONTIX – vyhláška 409 transponuje čl. 21 NIS2 do českého práva; ověřte pro svůj kontext.
 */
export const CROSSWALK_409_NIS2: Record<string, { directive: string[]; annex: string[] }> = {
  "3": { directive: ["21/1", "21/2/f"], annex: ["2.2", "7.1", "7.2", "7.3"] },
  "4": { directive: ["20/1", "20/2"], annex: ["1.2"] },
  "5": { directive: ["20/1"], annex: ["1.2"] },
  "6": { directive: ["21/2/a"], annex: ["1.1"] },
  "7": { directive: ["21/2/i"], annex: ["12.1", "12.2", "12.3", "12.4", "12.5"] },
  "8": { directive: ["21/2/a"], annex: ["2.1"] },
  "9": { directive: ["21/2/d", "21/3"], annex: ["5.1", "5.2"] },
  "10": { directive: ["20/2", "21/2/g", "21/2/i"], annex: ["8.1", "8.2", "10.1", "10.2", "10.3", "10.4"] },
  "11": { directive: ["21/2/e"], annex: ["6.4"] },
  "12": { directive: ["21/2/e"], annex: ["6.1", "6.2", "6.3", "6.5"] },
  "13": { directive: ["21/2/i"], annex: ["11.1", "11.2"] },
  "14": { directive: ["21/2/b", "23/1", "23/2", "23/4/a", "23/4/b", "23/4/c", "23/4/d", "23/4/e"], annex: ["3.1", "3.3", "3.4", "3.5", "3.6"] },
  "15": { directive: ["21/2/c"], annex: ["4.1", "4.3"] },
  "16": { directive: ["21/2/f"], annex: ["2.3"] },
  "17": { directive: ["21/2/i"], annex: ["13.1", "13.2", "13.3"] },
  "18": { directive: ["21/2/e", "21/2/j"], annex: ["6.7", "6.8"] },
  "19": { directive: ["21/2/i", "21/2/j"], annex: ["11.5", "11.6", "11.7"] },
  "20": { directive: ["21/2/i"], annex: ["11.2", "11.3", "11.4"] },
  "21": { directive: ["21/2/b"], annex: ["3.2", "6.9"] },
  "22": { directive: ["21/2/b"], annex: ["3.2"] },
  "23": { directive: ["21/2/b"], annex: ["3.4"] },
  "24": { directive: ["21/2/e"], annex: ["6.6", "6.10"] },
  "25": { directive: ["21/2/h"], annex: ["9.1", "9.2", "9.3"] },
  "26": { directive: ["21/2/c"], annex: ["4.2"] },
  "27": { directive: ["21/2/e"], annex: ["6.7", "6.8"] },
};

/**
 * Vyhláška 409 (§) → CIS Controls v8.1: celé opatření („7“) nebo dílčí opatření („3.6“).
 * Orientační mapování CONTIX (obsahová příbuznost) – ověřte pro svůj kontext.
 */
export const CROSSWALK_409_CIS: Record<string, string[]> = {
  "7": ["1", "2", "3.1", "3.2", "3.7", "3.8"],
  "8": ["7.1"],
  "9": ["15"],
  "10": ["14"],
  "11": ["4.1"],
  "12": ["16"],
  "13": ["3.3", "6.1", "6.2", "6.8"],
  "14": ["17"],
  "15": ["11"],
  "16": ["18"],
  "18": ["12", "13.4", "13.5", "13.9", "13.10"],
  "19": ["5", "6.3", "6.4", "6.5", "6.6", "6.7"],
  "20": ["5.3", "6.1", "6.2", "6.8"],
  "21": ["10", "13.1", "13.2", "13.3", "13.7", "13.8"],
  "22": ["8"],
  "23": ["8.11", "13.1", "13.11"],
  "24": ["2.2", "4", "7", "9", "16.4", "16.5"],
  "25": ["3.6", "3.9", "3.10", "3.11", "12.6"],
  "26": ["11"],
  "27": ["12.2", "13.4"],
};

function cisRelated(par409: string): Requirement[] {
  const keys = CROSSWALK_409_CIS[par409];
  if (!keys) return [];
  return requirementsOf("cis8").filter((r) => keys.some((k) => (k.includes(".") ? r.id === `cis8:${k}` : r.section === `CIS ${k}`)));
}

/** Požadavky jiných rámců příbuzné danému § vyhlášky 409 (dle CROSSWALK_409 a CROSSWALK_409_NIS2). */
export function relatedRequirements(par409: string): Requirement[] {
  const c = CROSSWALK_409[par409];
  if (!c) return [];
  const all = allRequirements();
  return [
    ...(c.zkb ? all.filter((r) => r.framework === "zkb") : []),
    ...all.filter((r) => r.framework === "cz410" && c.cz410.includes(r.section.replace("§ ", ""))),
    ...all.filter((r) => r.framework === "iso27001" && c.iso.includes(r.ref.replace("kap. ", ""))),
    ...all.filter((r) => r.framework === "dora" && c.dora.includes(Number(r.ref.replace("čl. ", "")))),
    ...all.filter((r) => r.framework === "soc2" && c.soc2.includes(r.ref)),
    ...nis2Related(par409),
    ...cisRelated(par409),
  ];
}

/**
 * Příbuzné požadavky jiných rámců pro opatření výchozího katalogu (jedno opatření na § vyhlášky):
 * u 409 přímo podle crosswalku, u 410 přes příbuzné § vyhlášky 409 (bez požadavků 410).
 */
export function catalogRelated(decree: "cz409" | "cz410", par: string): Requirement[] {
  if (decree === "cz409") return relatedRequirements(par);
  const pars409 = Object.entries(CROSSWALK_409)
    .filter(([, v]) => v.cz410.includes(par))
    .map(([k]) => k);
  const seen = new Set<string>();
  return pars409.flatMap((p) => relatedRequirements(p)).filter((r) => r.framework !== "cz410" && !seen.has(r.id) && (seen.add(r.id), true));
}

function nis2Related(par409: string): Requirement[] {
  const n = CROSSWALK_409_NIS2[par409];
  if (!n) return [];
  const dir = new Set(n.directive.map((d) => `nis2:${d}`));
  const annex = n.annex.map((a) => `nis2:P${a}`);
  return requirementsOf("nis2").filter((r) => dir.has(r.id) || annex.some((a) => r.id === a || r.id.startsWith(`${a}.`)));
}
