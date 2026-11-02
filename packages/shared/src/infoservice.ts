import { z } from "zod";

/* ============================================================
 * Informační servis regulátora (ADR-087): RSS NÚKIB (aktuality, varování, upozornění na zranitelnosti),
 * otevřená data o nahlášených incidentech (NÚKIB/incidents-opendata) a stav napojení na Národní MISP.
 * Jen stahování veřejných zdrojů – nic se neodesílá. Server bez internetu: ruční nahrání souboru.
 * ============================================================ */

export const NUKIB_RSS_URL = "https://nukib.gov.cz/rss.xml";
/** Repozitář je od 3/2025 archivovaný (jen čtení) – data končí posledním zveřejněným měsícem. */
export const NUKIB_OPENDATA_URL = "https://github.com/NUKIB/incidents-opendata/raw/refs/heads/main/data.csv";
export const NUKIB_OPENDATA_REPO = "https://github.com/NUKIB/incidents-opendata";

export const FEED_ITEM_KINDS = ["warning", "vulnerability", "report", "guidance", "news"] as const;
export type FeedItemKind = (typeof FEED_ITEM_KINDS)[number];
export const FEED_ITEM_LABELS: Record<FeedItemKind, string> = {
  warning: "Varování",
  vulnerability: "Upozornění na zranitelnost",
  report: "Přehled / zpráva",
  guidance: "Metodika a doporučení",
  news: "Aktualita",
};

export interface FeedItem {
  guid: string;
  title: string;
  link: string;
  summary: string;
  category: string;
  publishedAt: string | null;
}

/** Text z RSS / HTML: CDATA, entity a značky pryč, mezery sloučené. */
export const decodeFeedText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    // HTML v popisu kódovaný entitami (&lt;p&gt;) – po dekódování značky znovu odstranit
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Odkaz jen http(s) – jinak prázdný (žádné javascript: apod.). */
export const safeLink = (u: string) => (/^https?:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : "");

/** RSS 2.0 i Atom; položky bez názvu se přeskočí. */
export function parseRssFeed(xml: string, max = 200): FeedItem[] {
  const out: FeedItem[] = [];
  const atom = !/<item\b/i.test(xml) && /<entry\b/i.test(xml);
  const re = atom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  for (const m of xml.matchAll(re)) {
    const body = m[1]!;
    const raw = (t: string) => body.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, "i"))?.[1] ?? "";
    const title = decodeFeedText(raw("title")).slice(0, 500);
    if (!title) continue;
    const link = safeLink(atom ? (body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? "") : decodeFeedText(raw("link")));
    const guid = (decodeFeedText(raw(atom ? "id" : "guid")) || link || title).slice(0, 500);
    const pub = decodeFeedText(raw(atom ? "updated" : "pubDate") || raw("published") || raw("dc:date"));
    const d = pub ? new Date(pub) : null;
    out.push({
      guid,
      title,
      link,
      summary: decodeFeedText(raw(atom ? "summary" : "description") || raw("content")).slice(0, 2000),
      category: decodeFeedText(raw("category")).slice(0, 200),
      publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Druh položky podle názvu (a kategorie). Varování NÚKIB má přednost – je třeba ho zohlednit v hodnocení rizik. */
export function classifyFeedItem(i: { title: string; category?: string; summary?: string }): FeedItemKind {
  const t = `${i.title} ${i.category ?? ""}`.toLowerCase();
  // česky, slovensky, německy, anglicky (NÚKIB, SK-CERT, CERT.at, BSI / CERT-Bund, CERT-EU)
  if (/varování|varovani|varovanie|warnung|warning|výstrah|vystrah/.test(t)) return "warning";
  if (/zranitelnost|zraniteľnos|vulnerab|upozorňuje|upozornuje|aktualizac|záplat|cve-\d|schwachstelle|sicherheitslücke|sicherheitslucke|sicherheitsupdate|security update|patch|exploit|kritische lücke|kritická chyb|kritick[áé] zranit/.test(t)) return "vulnerability";
  if (/přehled kybernetických incidentů|prehled kybernetickych|výroční zpráv|zpráva o stavu|report|statistik|lagebericht|jahresbericht|tagesbericht|situationsbericht|threat landscape/.test(t)) return "report";
  if (/metodik|průvodce|pruvodce|doporučení|doporuceni|odporúčan|minimální|minimalni|vyhlášk|vyhlask|konzultac|postup|příručk|leitfaden|empfehlung|handreichung|guidance|guideline|best practice/.test(t)) return "guidance";
  return "news";
}

/** Druh položky v kanálu: rozpoznaný z názvu, jinak výchozí druh kanálu. */
export function feedItemKind(i: { title: string; category?: string }, defaultKind?: FeedItemKind): FeedItemKind {
  const k = classifyFeedItem(i);
  return k === "news" && defaultKind ? defaultKind : k;
}

/* ---------- otevřená data o incidentech ---------- */

export interface IncidentStatRow {
  month: string;
  classification: string;
  severity: string;
  count: number;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * CSV otevřených dat NÚKIB: sloupce „Rok/měsíc“ (YYYY-MM), „Klasifikace ENISA“, „Závažnost“, volitelně počet.
 * Řádek bez počtu = jeden incident. Vrací agregaci měsíc × klasifikace × závažnost.
 */
export function parseIncidentOpendata(csv: string): { rows: IncidentStatRow[]; errors: string[] } {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  if (!lines.length) return { rows: [], errors: ["Soubor je prázdný."] };
  const sep = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const head = splitCsvLine(lines[0]!, sep).map((h) => h.toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iMonth = col(/rok|měsíc|mesic|month|datum/);
  const iClass = col(/klasifikace|classification|typ/);
  const iSev = col(/závažnost|zavaznost|severity/);
  const iCount = col(/počet|pocet|count/);
  if (iMonth < 0 || iClass < 0) return { rows: [], errors: ["Chybí sloupce „Rok/měsíc“ a „Klasifikace ENISA“."] };
  const agg = new Map<string, IncidentStatRow>();
  lines.slice(1).forEach((l, n) => {
    const c = splitCsvLine(l, sep);
    const m = (c[iMonth] ?? "").match(/^(\d{4})[-/.](\d{1,2})/);
    if (!m) {
      if (errors.length < 10) errors.push(`Řádek ${n + 2}: neplatný měsíc „${(c[iMonth] ?? "").slice(0, 20)}“.`);
      return;
    }
    const month = `${m[1]}-${m[2]!.padStart(2, "0")}`;
    const classification = (c[iClass] || "Ostatní").slice(0, 100);
    const severity = (iSev >= 0 ? c[iSev] : "") || "neuvedeno";
    const count = iCount >= 0 ? Math.max(0, Math.round(Number((c[iCount] ?? "").replace(/\s/g, "")) || 0)) : 1;
    const key = `${month}|${classification}|${severity}`;
    const cur = agg.get(key);
    if (cur) cur.count += count;
    else agg.set(key, { month, classification, severity: severity.slice(0, 100), count });
  });
  return { rows: [...agg.values()].sort((a, b) => a.month.localeCompare(b.month)), errors };
}

export interface IncidentStatsSummary {
  firstMonth: string | null;
  lastMonth: string | null;
  total: number;
  /** Posledních N měsíců (do posledního zveřejněného): měsíc → klasifikace → počet. */
  months: { month: string; total: number; byClass: Record<string, number> }[];
  /** Klasifikace seřazené podle počtu v období. */
  classes: { name: string; count: number }[];
  severities: { name: string; count: number }[];
  /** Meziroční srovnání posledních 12 měsíců s předchozími 12. */
  last12: number;
  prev12: number;
}

const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Ruční údaje za měsíc (ADR-087): rozdělení podle klasifikace a podle závažnosti se zadává zvlášť –
 * řádek klasifikace má závažnost „*“, řádek závažnosti klasifikaci „*“. */
export const ANY = "*";

/** Měsíce s ručními údaji nahradí otevřená data téhož měsíce. */
export function mergeIncidentStats(opendata: IncidentStatRow[], manual: IncidentStatRow[]): IncidentStatRow[] {
  const manualMonths = new Set(manual.map((r) => r.month));
  return [...opendata.filter((r) => !manualMonths.has(r.month)), ...manual];
}

export function summarizeIncidentStats(rows: IncidentStatRow[], months = 12): IncidentStatsSummary {
  if (!rows.length) return { firstMonth: null, lastMonth: null, total: 0, months: [], classes: [], severities: [], last12: 0, prev12: 0 };
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const first = sorted[0]!.month;
  const last = sorted.at(-1)!.month;
  const from = addMonths(last, -(months - 1));
  const window = Array.from({ length: months }, (_, i) => addMonths(from, i));
  const clsRows = rows.filter((r) => r.classification !== ANY);
  const sevRows = rows.filter((r) => r.severity !== ANY);
  // počet za měsíc: z rozdělení podle klasifikace, není-li, podle závažnosti
  const totals = new Map<string, number>();
  for (const m of new Set(rows.map((r) => r.month))) {
    const c = clsRows.filter((r) => r.month === m).reduce((n, r) => n + r.count, 0);
    totals.set(m, c || sevRows.filter((r) => r.month === m).reduce((n, r) => n + r.count, 0));
  }
  const sumBy = (xs: IncidentStatRow[], key: "classification" | "severity") => {
    const m = new Map<string, number>();
    for (const r of xs) m.set(r[key], (m.get(r[key]) ?? 0) + r.count);
    return [...m.entries()].map(([name, count]) => ({ name, count })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };
  const y1 = addMonths(last, -11);
  const y2 = addMonths(last, -23);
  const sumMonths = (f: (m: string) => boolean) => [...totals.entries()].filter(([m]) => f(m)).reduce((n, [, v]) => n + v, 0);
  return {
    firstMonth: first,
    lastMonth: last,
    total: sumMonths(() => true),
    months: window.map((month) => {
      const byClass: Record<string, number> = {};
      for (const r of clsRows.filter((x) => x.month === month)) byClass[r.classification] = (byClass[r.classification] ?? 0) + r.count;
      return { month, total: totals.get(month) ?? 0, byClass };
    }),
    classes: sumBy(clsRows.filter((r) => r.month >= from), "classification"),
    // otevřená data mají závažnost velkými písmeny („VÝZNAMNÝ INCIDENT“) – sjednotit s ručními údaji
    severities: sumBy(sevRows.filter((r) => r.month >= from).map((r) => ({ ...r, severity: r.severity.charAt(0).toUpperCase() + r.severity.slice(1).toLowerCase() })), "severity"),
    last12: sumMonths((m) => m >= y1),
    prev12: sumMonths((m) => m >= y2 && m < y1),
  };
}

/* ---------- ruční doplnění měsíce a návrh z PDF (ADR-087) ---------- */

const statItem = z.object({ name: z.string().trim().min(1).max(100).refine((v) => v !== ANY), count: z.number().int().min(0).max(100_000) });
export const IncidentMonthInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  classes: z.array(statItem).max(30),
  severities: z.array(statItem).max(10),
  /** Odkud čísla jsou (měsíční přehled NÚKIB) – do auditu. */
  sourceUrl: z.union([z.string().trim().max(1000).regex(/^https?:\/\//), z.literal("")]).optional(),
});
export type IncidentMonthInput = z.infer<typeof IncidentMonthInput>;

/** Klasifikace ENISA, jak je NÚKIB používá v přehledech, a stupně závažnosti – nabídka formuláře. */
export const NUKIB_CLASSES = ["Průnik", "Pokus o průnik", "Dostupnost", "Podvod/phishing", "Škodlivý kód", "Informační bezpečnost", "Sběr informací", "Zranitelnost", "Urážlivý obsah", "Ostatní"] as const;
export const NUKIB_SEVERITIES = ["Méně významný incident", "Významný incident", "Velmi významný incident"] as const;

const CZ_MONTHS = ["leden|ledna|lednu", "únor|února|únoru", "březen|března|březnu", "duben|dubna|dubnu", "květen|května|květnu", "červen|června|červnu", "červenec|července|červenci", "srpen|srpna|srpnu", "září", "říjen|října|říjnu", "listopad|listopadu", "prosinec|prosince|prosinci"];
/** Měsíc z názvu přehledu („… za září 2026“, „…-brezen2026.pdf“) → YYYY-MM. */
export function monthFromTitle(title: string): string | null {
  const t = title.toLowerCase();
  const ascii = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // červenec dřív než červen
  const order = [6, 5, 0, 1, 2, 3, 4, 7, 8, 9, 10, 11];
  for (const i of order) {
    for (const form of CZ_MONTHS[i]!.split("|")) {
      const f = form.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const m = ascii.match(new RegExp(`${f}[\\s_-]*(20\\d{2})`));
      if (m) return `${m[1]}-${String(i + 1).padStart(2, "0")}`;
    }
  }
  return null;
}

const MONTH_SLUGS = ["leden", "unor", "brezen", "duben", "kveten", "cerven", "cervenec", "srpen", "zari", "rijen", "listopad", "prosinec"];
/** Možné adresy měsíčního přehledu NÚKIB (názvy souborů se liší: „zari-2026“, „brezen2026“, „leden_2025“). */
export function nukibReportUrls(month: string, base = "https://nukib.gov.cz/download/publikace/vyzkum/"): string[] {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return [];
  const slug = MONTH_SLUGS[Number(m[2]) - 1];
  if (!slug) return [];
  const y = m[1]!;
  const cap = slug[0]!.toUpperCase() + slug.slice(1);
  const names = [`${slug}-${y}`, `${slug}${y}`, `${slug}_${y}`, `${cap}-${y}`, `${cap}${y}`];
  return names.flatMap((n) => [`${base}Kyberneticke-incidenty-pohledem-NUKIB-${n}.pdf`, `${base}Kyberneticke-incidenty-pohledem-NUKIB_${n}.pdf`]);
}

export interface IncidentStatsProposal {
  month: string | null;
  total: number | null;
  classes: { name: string; count: number }[];
  severities: { name: string; count: number }[];
  warnings: string[];
}

/** Odpověď modelu → návrh; čísla se validují, nic se neukládá (potvrzuje člověk ve formuláři). */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Závažnost na název formuláře: „méně významný kybernetický incident“, „VÝZNAMNÝ INCIDENT“ → stupně NÚKIB. */
export function canonicalSeverity(name: string): string {
  const f = fold(name);
  if (f.includes("velmi vyznamn")) return "Velmi významný incident";
  if (f.includes("mene vyznamn")) return "Méně významný incident";
  if (f.includes("vyznamn")) return "Významný incident";
  return name.trim();
}
/** Klasifikace na názvy NÚKIB / ENISA („Podvod“ → „Podvod/phishing“, „pokus o průnik“ → „Pokus o průnik“). */
export function canonicalClass(name: string): string {
  const f = fold(name);
  if (f.startsWith("pokus o prunik")) return "Pokus o průnik";
  const hit = NUKIB_CLASSES.find((c) => fold(c) === f || fold(c).split("/")[0] === f);
  return hit ?? name.trim();
}
/** Sloučí položky se stejným (sjednoceným) názvem a vynechá nuly. */
export function foldStatItems(xs: { name: string; count: number }[], canon: (n: string) => string) {
  const m = new Map<string, number>();
  for (const x of xs) {
    const n = canon(x.name);
    m.set(n, (m.get(n) ?? 0) + x.count);
  }
  return [...m.entries()].filter(([, c]) => c > 0).map(([name, count]) => ({ name, count }));
}

export function parseIncidentStatsProposal(text: string): IncidentStatsProposal {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("Model nevrátil JSON.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("Model nevrátil platný JSON.");
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100_000 ? Math.round(v) : null);
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((x) => ({ name: String((x as { name?: unknown })?.name ?? "").trim().slice(0, 100), count: num((x as { count?: unknown })?.count) }))
      .filter((x): x is { name: string; count: number } => !!x.name && x.name !== ANY && x.count != null)
      .slice(0, 30);
  const month = typeof raw.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month) ? raw.month : null;
  const total = num(raw.total);
  const classes = foldStatItems(list(raw.classes), canonicalClass);
  const severities = foldStatItems(list(raw.severities), canonicalSeverity);
  const warnings: string[] = [];
  const cs = classes.reduce((n, x) => n + x.count, 0);
  const ss = severities.reduce((n, x) => n + x.count, 0);
  if (total != null && classes.length && cs < total) warnings.push(`Klasifikace pokrývá ${cs} z ${total} incidentů – v grafu přehledu může chybět kategorie; doplňte podle PDF.`);
  else if (total != null && classes.length && cs !== total) warnings.push(`Součet podle klasifikace (${cs}) nesedí s celkovým počtem (${total}).`);
  if (total != null && severities.length && ss !== total) warnings.push(`Součet podle závažnosti (${ss}) nesedí s celkovým počtem (${total}).`);
  // popisky hodnot v grafu závažnosti nejsou v textu PDF v pořadí legendy – u NÚKIB převažují méně významné incidenty
  const sev = (n: string) => severities.find((x) => x.name === n)?.count ?? 0;
  if (sev("Významný incident") + sev("Velmi významný incident") > sev("Méně významný incident") && ss > 2)
    warnings.push("Významných incidentů vychází víc než méně významných – u NÚKIB neobvyklé; ověřte graf závažnosti v PDF (hodnoty mohly být přiřazeny opačně).");
  if (!month) warnings.push("Měsíc přehledu se nepodařilo určit.");
  return { month, total, classes, severities, warnings };
}

/* ---------- nastavení a DTO ---------- */

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https:\/\/[^\s"'<>]+$/, "Zadejte adresu https://");

export const InfoFeedInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(100),
  url: httpsUrl,
  enabled: z.boolean().default(true),
  /** Vydavatel (NÚKIB, SK-CERT, CERT.at, BSI…) a země (CZ, SK, … / EU; prázdné = všem) – třídění a relevance podle profilu společnosti. */
  publisher: z.string().trim().max(60).default(""),
  country: z.union([z.string().regex(/^([A-Z]{2}|EU)$/), z.literal("")]).default(""),
  /** Formát zdroje: RSS / Atom, nebo webová stránka s výpisem novinek (bez kanálu RSS, např. CSIRT.CZ). */
  format: z.enum(["rss", "html"]).default("rss"),
  /** U stránky: začátek cesty odkazů na jednotlivé novinky (např. /cs/kyberbezpecnost/aktualne-z-bezpecnosti/). */
  linkPrefix: z.string().trim().max(200).regex(/^(\/[^\s"'<>]*)?$/).default(""),
  /** Druh položek, které podle názvu nejsou rozpoznané (např. kanál „Warnungen“ = varování). */
  defaultKind: z.enum(FEED_ITEM_KINDS).optional(),
});
export const InfoServiceSettingsInput = z.object({
  autoRefresh: z.boolean(),
  intervalHours: z.number().int().min(1).max(168),
  feeds: z.array(InfoFeedInput).max(10),
  opendataEnabled: z.boolean(),
  opendataUrl: httpsUrl,
});
export type InfoServiceSettingsInput = z.input<typeof InfoServiceSettingsInput>;

export const INFO_SERVICE_DEFAULTS: z.infer<typeof InfoServiceSettingsInput> = {
  autoRefresh: true,
  intervalHours: 6,
  feeds: [{ id: "nukib", name: "NÚKIB – aktuality", url: NUKIB_RSS_URL, enabled: true, publisher: "NÚKIB", country: "CZ", format: "rss", linkPrefix: "" }],
  opendataEnabled: true,
  opendataUrl: NUKIB_OPENDATA_URL,
};

export interface InfoSourceState {
  at: string;
  count: number;
  error: string | null;
}

export interface InfoFeedItemDto {
  id: string;
  feedId: string;
  feedName: string;
  kind: FeedItemKind;
  title: string;
  link: string;
  summary: string;
  category: string;
  publishedAt: string | null;
  publisher: string;
  country: string;
  /** Posouzení za aktivní společnost (seznámení, zohlednění v hodnocení rizik). */
  review: { at: string; userName: string | null; note: string } | null;
  assessment: InfoAssessmentDto | null;
}

/* ---------- posouzení dopadu (ADR-088) ---------- */

/** Stav posouzení položky za společnost: posuzuje se → netýká se / dotčeno → vyřešeno. */
export const INFO_ASSESSMENT_STATUSES = ["assessing", "not_applicable", "affected", "resolved"] as const;
export type InfoAssessmentStatus = (typeof INFO_ASSESSMENT_STATUSES)[number];
/** Uzavřené posouzení – položka se už nepočítá mezi neposouzené. */
export const INFO_DECIDED: readonly InfoAssessmentStatus[] = ["not_applicable", "resolved"];
export const INFO_ASSESSMENT_LABELS: Record<InfoAssessmentStatus, string> = {
  assessing: "Posuzuje se",
  not_applicable: "Netýká se",
  affected: "Dotčeno – řeší se",
  resolved: "Vyřešeno",
};
export const INFO_LINK_KINDS = ["risk", "task", "incident"] as const;
export type InfoLinkKind = (typeof INFO_LINK_KINDS)[number];

export const InfoAssessmentInput = z.object({
  companyId: z.string().uuid().optional(),
  status: z.enum(INFO_ASSESSMENT_STATUSES),
  note: z.string().trim().max(4000).default(""),
  ownerPositionId: z.string().uuid().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  /** Dotčená aktiva (nahradí dosavadní výběr). */
  assetIds: z.array(z.string().uuid()).max(500).optional(),
});
export type InfoAssessmentInput = z.input<typeof InfoAssessmentInput>;
export const InfoLinkInput = z.object({ companyId: z.string().uuid().optional(), kind: z.enum(INFO_LINK_KINDS), targetId: z.string().uuid() });

export interface InfoAssessmentDto {
  id: string;
  status: InfoAssessmentStatus;
  note: string;
  ownerPositionId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  at: string;
  userName: string | null;
  assets: { id: string; name: string }[];
  links: { kind: InfoLinkKind; targetId: string; label: string }[];
}

/** Návrh dotčeného aktiva: shoda CVE se zranitelností aktiva, nebo názvu produktu se softwarem / OS / výrobcem. */
export interface InfoAssetSuggestion {
  id: string;
  name: string;
  reason: string;
}

const STOP = new Set(
  "NÚKIB NUKIB Varování Upozornění Upozorňuje Vydali Řízení Přehled Ruští Čínští Aktéři Nový Nová Nové Kritické Kritická Jediným Řešením Aktualizace Krok Pro Při Jak Kde Která Který Jsme Byl Bylo Této Tento Česká Český České Evropská Unie Den Rok Datum Zranitelnost Zranitelnosti Analýza Doporučení Metodika Průvodce Signal Signalu".toLowerCase().split(" "),
);
/** Pojmy produktů z názvu a popisu (PHP, Fortinet, Ivanti Connect Secure…) – hledají se v softwaru a OS aktiv. */
export function productTermsOf(text: string, max = 12): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][A-Za-z0-9+.-]{1,30}|[a-z]+[A-Z][A-Za-z0-9]+)\b/g)) {
    const w = m[1]!.replace(/[.-]+$/, "");
    if (w.length < 3 || STOP.has(w.toLowerCase()) || /^CVE$/i.test(w)) continue;
    out.add(w);
    if (out.size >= max) break;
  }
  return [...out];
}
export const cveIdsOf = (text: string) => [...new Set([...text.matchAll(/CVE-\d{4}-\d{4,7}/gi)].map((m) => m[0]!.toUpperCase()))];

export interface InfoServiceDto {
  settings: z.infer<typeof InfoServiceSettingsInput>;
  state: Record<string, InfoSourceState>;
  lastRefreshAt: string | null;
  counts: { total: number; warningsOpen: number; vulnerabilities30d: number; unreviewed: number };
  stats: IncidentStatsSummary;
  /** Měsíce s ručně doplněnými údaji (z měsíčních přehledů NÚKIB). */
  manualMonths: string[];
  /** Měsíční přehledy z RSS (kandidáti na doplnění). */
  reports: { id: string; title: string; month: string | null; link: string; publishedAt: string | null }[];
  /** Je k dispozici AI asistent a převodní služba (návrh čísel z PDF). */
  suggestAvailable: boolean;
  /** Národní MISP (ADR-073) – jen stav napojení, bez adres s klíči a tajemství. */
  misp: { enabled: boolean; host: string | null; pull: boolean; lastPull: InfoSourceState | null; checkOk: boolean | null } | null;
}

export const InfoReviewInput = z.object({ note: z.string().trim().max(2000).default(""), companyId: z.string().uuid().optional() });
