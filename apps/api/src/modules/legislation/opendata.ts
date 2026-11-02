import { fragmentKey, textOfXhtml } from "@contix/shared";
import type { Config } from "../../config";
import { EsbirkaClient, type FetchLike, type SourceFragment, type SourceVersion } from "./esbirka";

/* ============================================================
 * Otevřená data e-Sbírky bez registrace (ADR-035):
 * - SPARQL endpoint (opendata.eselpoint.gov.cz/sparql, aktualizace denně, CC BY 4.0) – znění a fragmenty jednoho předpisu,
 * - RSS „Změny v e-Sbírce“ (nová / změněná časová znění, nastavené datum zrušení) – rychlý spouštěč a informace o zrušení.
 * Model dat (slovník https://slovník.gov.cz/datový/sbírka/pojem/):
 *   právní akt  <…/eli/cz/sb/2025/409>  má-znění → znění <…/sb/2025/409/2025-11-01> (účinnost-znění-od/do, typ KONSOL / VYHLZNE)
 *   znění má-fragment-znění → označení (citace, url-fragmentu-znění „/sb/…#par_6-odst_1“, pořadí, hierarchie)
 *   označení obsahuje-fragment → fragment (text-fragmentu XHTML, má-typ-fragmentu)
 * Klíč fragmentu = kotva url-fragmentu-znění (stejná jako v REST API) → znění z obou zdrojů jsou porovnatelná.
 * Názvy vlastností jsou na jednom místě (P) – při změně struktury (e-Legislativa 2027) se upraví jen zde.
 * ============================================================ */

const VOC = "https://slovník.gov.cz/datový/sbírka/pojem/";
const P = {
  hasVersion: `${VOC}má-znění`,
  citation: `${VOC}citace-právního-aktu`,
  from: `${VOC}účinnost-znění-od`,
  to: `${VOC}účinnost-znění-do`,
  versionType: `${VOC}má-typ-znění-právního-aktu`,
  hasFragment: `${VOC}má-fragment-znění`,
  fragUrl: `${VOC}url-fragmentu-znění`,
  fragCitation: `${VOC}citace-označení-fragmentu-znění-právního-aktu`,
  order: `${VOC}pořadí-fragmentu-znění-právního-aktu`,
  hierarchy: `${VOC}hierarchie-fragmentu-znění-právního-aktu`,
  contains: `${VOC}obsahuje-fragment`,
  text: `${VOC}text-fragmentu`,
  fragType: `${VOC}má-typ-fragmentu`,
};
const RES = "https://opendata.eselpoint.gov.cz/esel-esb/eli/cz";
export const DEFAULT_SPARQL_URL = "https://opendata.eselpoint.gov.cz/sparql";
export const DEFAULT_RSS_URL = "https://e-sbirka.gov.cz/rss/zmeny";
export const DEFAULT_WEB_URL = "https://e-sbirka.gov.cz/sbr-cache";
const PAGE = 5000;
/** Rozestup dotazů na zdroj (ohleduplnost); v testech 0. */
const DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 300;

const ACT_RE = /^\/sb\/\d{4}\/\d{1,5}$/;
const VERSION_RE = /^\/sb\/\d{4}\/\d{1,5}\/\d{4}-\d{2}-\d{2}$/;
/**
 * Klíč z IRI označení, když fragment nemá kotvu (úvodní věty, přílohy, odstavce bez čísla):
 * „…/dokument/norma/cast_2/par_3/frag_1251308“ → „par_3“, „…/dokument/prefix/frag_1“ → „prefix“, „…/prilohy/priloha_0/frag_9“ → „priloha_1“.
 * Čísla frag_* (ID zdroje) se nepoužívají; pořadí v rámci stejného klíče doplní volající (~2, ~3…).
 */
export function keyFromDesignation(iri: string): string {
  const path = iri.split("/dokument/")[1] ?? "";
  const segs = path.split("/").filter((x) => x && !/^frag_\d+$/.test(x) && !/^(norma|cast|hlava|dil|oddil|pododdil)(_|$)/.test(x));
  const fixed = segs.map((x) => x.replace(/^priloha_(\d+)$/, (_, n) => `priloha_${Number(n) + 1}`)).filter((x) => x !== "prilohy");
  return fixed.length ? fixed.join("-") : path.startsWith("prilohy") ? "prilohy" : (path.split("/")[0] ?? "dokument");
}
const SECTION_LABEL: Record<string, string> = { prefix: "Úvod", postfix: "Závěr", prilohy: "Přílohy" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const localName = (iri: string) => {
  const last = iri.split(/[/#]/).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};
type FragSchema = {
  /** Vzor, který naváže ?d na znění (případně převod textové hodnoty na IRI). */
  head: string;
  /** Vlastnosti označení a fragmentu jsou v pojmenovaném grafu. */
  graph: boolean;
  literal: boolean;
  order: string | null;
  url: string | null;
  cit: string | null;
  h: string | null;
  contains: string | null;
  text: string | null;
  typ: string | null;
  textOnD: string | null;
  dPreds: string[];
  fPreds: string[];
  /** Diagnostika: ukázková hodnota označení a vlastnosti, které na označení odkazují. */
  sample: string | null;
  reverse: string[];
};
type Binding = Record<string, { value: string } | undefined>;

/**
 * Vybere sledované znění: nejnovější vyhlášené (i budoucí – posouzení dopadu tak vznikne hned po zveřejnění novely,
 * ne až v den účinnosti); konsolidované má přednost před vyhlášeným (0000-00-00). Vrací i znění účinné k danému dni.
 */
export function pickVersion(versions: { versionKey: string; from: string | null; to: string | null; type: string }[], today: string) {
  const usable = versions.filter((v) => v.from && !v.versionKey.endsWith("/0000-00-00")).sort((a, b) => b.from!.localeCompare(a.from!));
  const announced = versions.find((v) => v.versionKey.endsWith("/0000-00-00")) ?? null;
  const latest = usable[0] ?? announced;
  const effective = usable.find((v) => v.from! <= today) ?? announced;
  return { latest, effective };
}

export class EsbirkaOpenDataClient {
  private last = 0;
  constructor(
    private config: Pick<Config, "ESBIRKA_SPARQL_URL"> & Partial<Pick<Config, "ESBIRKA_WEB_URL" | "ESBIRKA_WEB_FALLBACK">>,
    private fetchImpl: FetchLike = fetch,
    private today = () => new Date().toISOString().slice(0, 10),
  ) {}

  private async select(query: string): Promise<Binding[]> {
    const url = this.config.ESBIRKA_SPARQL_URL ?? DEFAULT_SPARQL_URL;
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + DELAY_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/sparql-results+json" },
          body: new URLSearchParams({ query, format: "application/sparql-results+json" }).toString(),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (attempt < 2) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw new Error(`Otevřená data e-Sbírky nedostupná: ${(e as Error).message}`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Otevřená data e-Sbírky (SPARQL) vrátila HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      try {
        const j = (await res.json()) as { results?: { bindings?: Binding[] } };
        if (!Array.isArray(j.results?.bindings)) throw new Error();
        return j.results!.bindings!;
      } catch {
        throw new Error("Otevřená data e-Sbírky nevrátila platný výsledek SPARQL – možná změna rozhraní.");
      }
    }
  }

  /** Nejnovější vyhlášené znění předpisu (může být i s budoucí účinností). */
  async current(staleUrl: string): Promise<SourceVersion> {
    if (!ACT_RE.test(staleUrl)) throw new Error(`Neplatná stálá URL předpisu: ${staleUrl}`);
    const act = `<${RES}${staleUrl}>`;
    const rows = await this.select(
      `SELECT ?z ?od ?do ?typ ?cit WHERE { ${act} <${P.hasVersion}> ?z . OPTIONAL { ${act} <${P.citation}> ?cit } OPTIONAL { ?z <${P.from}> ?od } OPTIONAL { ?z <${P.to}> ?do } OPTIONAL { ?z <${P.versionType}> ?typ } }`,
    );
    if (!rows.length) throw new Error("Předpis v otevřených datech e-Sbírky nenalezen – zkontrolujte číslo a rok (nové předpisy se v datech objeví do druhého dne).");
    const versions = rows
      .map((r) => ({ versionKey: (r.z?.value ?? "").replace(RES, ""), from: r.od?.value?.slice(0, 10) ?? null, to: r.do?.value?.slice(0, 10) ?? null, type: (r.typ?.value ?? "").split("/").pop() ?? "" }))
      .filter((v) => VERSION_RE.test(v.versionKey));
    const { latest: current, effective } = pickVersion(versions, this.today());
    if (!current) throw new Error("V otevřených datech e-Sbírky není žádné znění předpisu.");
    return {
      versionKey: current.versionKey,
      effectiveFrom: current.from,
      code: rows[0]?.cit?.value ?? null,
      title: null,
      sourceUrl: `https://e-sbirka.gov.cz${current.versionKey}`,
      meta: {
        source: "opendata",
        versionType: current.type,
        effectiveTo: current.to,
        effectiveNow: effective?.versionKey ?? null,
        versions: versions.length,
        // náhradní znění, když nejnovější ještě nemá v datech text (od nejnovějšího, max. 5) – v1.12.2
        candidates: [...versions.filter((v) => v.from && !v.versionKey.endsWith("/0000-00-00")).sort((a, b) => b.from!.localeCompare(a.from!)), ...versions.filter((v) => v.versionKey.endsWith("/0000-00-00"))]
          .slice(0, 5)
          .map((v) => ({ versionKey: v.versionKey, from: v.from })),
      },
    };
  }

  /** Odkud byl text posledního znění (otevřená data / web e-Sbírky). */
  lastSource: "opendata" | "web" | null = null;
  /** Popis prázdného výsledku (počty vazeb ve zdroji, žádný obsah) – do chybové hlášky. */
  lastDiagnostic: string | null = null;

  /**
   * Vlastnosti označení a fragmentu, které zdroj skutečně používá (v1.12.3): známé názvy z P mají přednost, jinak se
   * najdou podle názvu (pořadí, url, citace, hierarchie, text) na vzorku označení znění. Zdroj tak přežije přejmenování
   * vlastností bez nového vydání CONTIXu; když se text nenajde vůbec, diagnostika vypíše nalezené názvy.
   */
  async fragmentSchema(z: string): Promise<FragSchema> {
    // označení se hledají ve třech podobách: IRI ve výchozím grafu, hodnota jako text (převod na IRI), IRI v pojmenovaném grafu
    const variants = [
      { lit: false, g: false },
      { lit: true, g: false },
      { lit: false, g: true },
    ];
    let chosen = variants[0]!;
    let dRows: Binding[] = [];
    for (const v of variants) {
      const head = v.lit ? `${z} <${P.hasFragment}> ?d0 . BIND(IRI(STR(?d0)) AS ?d)` : `${z} <${P.hasFragment}> ?d .`;
      const inner = v.g ? "GRAPH ?g0 { ?d ?p ?o }" : "?d ?p ?o";
      dRows = await this.select(`SELECT ?p (SAMPLE(?o) AS ?o) WHERE { { SELECT ?d WHERE { ${head} } LIMIT 40 } ${inner} } GROUP BY ?p`).catch(() => []);
      if (dRows.length) {
        chosen = v;
        break;
      }
    }
    const head = chosen.lit ? `${z} <${P.hasFragment}> ?d0 . BIND(IRI(STR(?d0)) AS ?d)` : `${z} <${P.hasFragment}> ?d .`;
    const sample = `{ SELECT ?d WHERE { ${head} } LIMIT 40 }`;
    let gi = 0;
    const w = (body: string) => (chosen.g ? `GRAPH ?g${++gi} { ${body} }` : body);
    const dPreds = dRows.map((r) => r.p?.value ?? "").filter(Boolean);
    const pick = (list: string[], known: string, re: RegExp, not?: (string | null)[]) => (list.includes(known) ? known : (list.find((p) => re.test(localName(p)) && !not?.includes(p)) ?? null));
    const order = pick(dPreds, P.order, /pořad|poradi|order/i);
    const url = pick(dPreds, P.fragUrl, /^url|-url|url-/i);
    const cit = pick(dPreds, P.fragCitation, /citace|citation/i);
    const h = pick(dPreds, P.hierarchy, /hierarch/i);
    const textOnD = pick(dPreds, P.text, /text|xhtml/i, [url, cit, h, order]);
    const schema: FragSchema = { head, graph: chosen.g, literal: chosen.lit, order, url, cit, h, contains: null, text: null, typ: null, textOnD, dPreds: dPreds.map(localName), fPreds: [], sample: null, reverse: [] };
    const iriValued = dRows.filter((r) => /^https?:/.test(r.o?.value ?? "") && !/typ|type|hierarch|url/i.test(localName(r.p?.value ?? ""))).map((r) => r.p!.value);
    const candidates = dPreds.includes(P.contains) ? [P.contains, ...iriValued.filter((p) => p !== P.contains)] : iriValued;
    for (const c of candidates.slice(0, 5)) {
      const fp = (await this.select(`SELECT ?p WHERE { ${sample} ${w(`?d <${c}> ?f`)} ${w("?f ?p ?x")} } GROUP BY ?p`).catch(() => [])).map((r) => r.p?.value ?? "").filter(Boolean);
      const text = pick(fp, P.text, /text|xhtml|obsah/i);
      if (!schema.fPreds.length) schema.fPreds = fp.map(localName);
      if (text) {
        Object.assign(schema, { contains: c, text, typ: pick(fp, P.fragType, /typ/i, [text]), fPreds: fp.map(localName) });
        break;
      }
    }
    if (!dRows.length) {
      // diagnostika: jak vypadá hodnota označení a odkud se na ni odkazuje
      const [one] = await this.select(`SELECT ?d WHERE { ${z} <${P.hasFragment}> ?d } LIMIT 1`).catch(() => []);
      schema.sample = one?.d ? `${(one.d as { type?: string }).type ?? "?"} ${one.d.value.slice(0, 160)}` : null;
      schema.reverse = (await this.select(`SELECT ?p (COUNT(*) AS ?n) WHERE { ${sample} ?s ?p ?d } GROUP BY ?p LIMIT 10`).catch(() => [])).map((r) => `${localName(r.p?.value ?? "")}×${r.n?.value ?? "?"}`);
    }
    return schema;
  }

  /** Fragmenty znění se stejnými klíči jako REST API (kotva url-fragmentu-znění). */
  async fragments(versionKey: string): Promise<SourceFragment[]> {
    if (!VERSION_RE.test(versionKey)) throw new Error(`Neplatné označení znění: ${versionKey}`);
    this.lastDiagnostic = null;
    const z = `<${RES}${versionKey}>`;
    const webOnly = this.config.ESBIRKA_WEB_FALLBACK === "only";
    const sc = webOnly ? null : await this.fragmentSchema(z);
    const out: SourceFragment[] = [];
    const used = new Map<string, number>();
    let gi = 0;
    const w = (body: string) => (sc?.graph ? `GRAPH ?g${++gi} { ${body} }` : body);
    const opt = (p: string | null, v: string) => (p ? `OPTIONAL { ${w(`?d <${p}> ${v}`)} }` : "");
    const textPart = !sc
      ? ""
      : sc.contains && sc.text
        ? `OPTIONAL { ${w(`?d <${sc.contains}> ?f`)} OPTIONAL { ${w(`?f <${sc.text}> ?text`)} } ${sc.typ ? `OPTIONAL { ${w(`?f <${sc.typ}> ?typ`)} }` : ""} }`
        : sc.textOnD
          ? `OPTIONAL { ${w(`?d <${sc.textOnD}> ?text`)} }`
          : "";
    const rowsAll: Binding[] = [];
    if (sc && textPart) {
      const base = `${sc.head} ${opt(sc.url, "?url")} ${opt(sc.cit, "?cit")} ${opt(sc.h, "?h")} ${textPart}`;
      if (sc.order) {
        // stránkování podle pořadí fragmentu (keyset) – Virtuoso neumí řadit s OFFSET nad 10 000 řádků
        let after = "";
        for (let page = 0; page < 100; page++) {
          const rows = await this.select(`SELECT ?d ?url ?cit ?ord ?h ?f ?typ ?text WHERE { ${base} ${w(`?d <${sc.order}> ?ord`)} FILTER(STR(?ord) > "${after}") } ORDER BY STR(?ord) LIMIT ${PAGE}`);
          rowsAll.push(...rows);
          if (rows.length < PAGE) break;
          const last = rows.at(-1)?.ord?.value ?? "";
          if (!/^[0-9A-Za-z]+$/.test(last) || last <= after) throw new Error("Otevřená data e-Sbírky: neočekávané pořadí fragmentů – možná změna struktury dat.");
          after = last;
        }
      } else {
        // bez pořadí: stránky podle IRI označení, pořadí v dokumentu podle čísla frag_N
        for (let page = 0; page < 2; page++) {
          const rows = await this.select(`SELECT ?d ?url ?cit ?h ?f ?typ ?text WHERE { ${base} } ORDER BY STR(?d) LIMIT ${PAGE} OFFSET ${page * PAGE}`);
          rowsAll.push(...rows);
          if (rows.length < PAGE) break;
        }
        const n = (r: Binding) => Number(/frag_(\d+)$/.exec(r.d?.value ?? "")?.[1] ?? Number.MAX_SAFE_INTEGER);
        rowsAll.sort((a, b) => n(a) - n(b));
      }
    }
    for (const r of rowsAll) {
      const text = textOfXhtml(r.text?.value ?? "");
      if (!text) continue;
      const cit = r.cit?.value?.trim() ?? "";
      const fallback = keyFromDesignation(r.d?.value ?? "");
      let key = fragmentKey(r.url?.value?.includes("#") ? r.url.value : null, cit) ?? fallback;
      const n = (used.get(key) ?? 0) + 1;
      used.set(key, n);
      if (n > 1) key = `${key}~${n}`;
      out.push({
        key,
        label: (cit || SECTION_LABEL[fallback] || fallback.replace(/^priloha_(\d+)/, "Příloha $1").replace(/_/g, " ")).slice(0, 500),
        text,
        depth: Math.max(0, (r.h?.value ?? "/").split("/").filter(Boolean).length - 2),
        kind: (r.typ?.value ?? "").split("/").pop() ?? "",
        sourceId: r.f?.value?.split("/").pop()?.slice(0, 60) ?? null,
      });
    }
    let web = "";
    if (!out.length && (this.config.ESBIRKA_WEB_FALLBACK ?? "on") !== "off") {
      // záloha: text znění z veřejného JSON webu e-Sbírky (stejné klíče fragmentů jako REST API – znění jsou porovnatelná)
      const wc = new EsbirkaClient({ ESBIRKA_API_URL: this.config.ESBIRKA_WEB_URL ?? DEFAULT_WEB_URL, ESBIRKA_API_KEY: undefined }, this.fetchImpl, true);
      try {
        const wf = await wc.fragments(versionKey);
        if (wf.length) {
          this.lastSource = "web";
          return wf;
        }
        web = `; web e-Sbírky: ${wc.lastDiagnostic ?? "bez textu"}`;
      } catch (e) {
        web = `; web e-Sbírky: ${(e as Error).message.slice(0, 200)}`;
      }
    }
    this.lastSource = out.length ? "opendata" : null;
    if (!out.length) {
      // diagnostika: názvy vlastností označení a fragmentu ve zdroji (bez hodnot) – podle nich se upraví P
      const preds = (await this.select(`SELECT ?p (COUNT(*) AS ?n) WHERE { ${z} ?p ?o } GROUP BY ?p ORDER BY DESC(?n) LIMIT 12`).catch(() => []))
        .map((r) => `${localName(r.p?.value ?? "")}×${r.n?.value ?? "?"}`)
        .join(", ");
      this.lastDiagnostic = !sc ? `znění ${versionKey}${web || "; web e-Sbírky: bez textu"}` : `znění ${versionKey}: řádků ${rowsAll.length}; vlastnosti znění: ${preds || "žádné"}; označení: ${sc.dPreds.join(", ") || "žádné"}${sc.graph ? " (v pojmenovaném grafu)" : ""}${sc.literal ? " (hodnota jako text)" : ""}; fragment: ${sc.fPreds.join(", ") || "nenalezen"}${sc.sample ? `; vzor označení: ${sc.sample}` : ""}${sc.reverse.length ? `; odkazují: ${sc.reverse.join(", ")}` : ""}${web}`;
    }
    return out;
  }
}

/* ---------- RSS „Změny v e-Sbírce“ ---------- */

export interface RssChange {
  staleUrl: string;
  kind: "version" | "repeal";
  /** Datum ze zprávy (účinnost nového znění / datum zrušení), ISO. */
  date: string | null;
  title: string;
  published: string | null;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#xD;|&#13;/gi, "")
    .replace(/&amp;/g, "&")
    .trim();
const czDate = (s: string | undefined) => {
  const m = s?.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
};

export function parseRssChanges(xml: string): RssChange[] {
  const out: RssChange[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const tag = (t: string) => decode(m[1]!.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)</${t}>`, "i"))?.[1] ?? "");
    const title = tag("title");
    const link = tag("link") || tag("guid");
    const su = link.match(/\/sb\/(\d{4})\/(\d{1,5})/);
    if (!su) continue;
    const pub = tag("pubDate");
    const d = pub ? new Date(pub) : null;
    out.push({
      staleUrl: `/sb/${su[1]}/${Number(su[2])}`,
      kind: /zrušen/i.test(title) ? "repeal" : "version",
      date: czDate(title.split(/[-–:]/).slice(1).join(" ")) ?? czDate(title),
      title: title.replace(/\s+/g, " ").slice(0, 300),
      published: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
    });
  }
  return out;
}

export async function fetchRssChanges(config: Pick<Config, "ESBIRKA_RSS_URL">, fetchImpl: FetchLike = fetch): Promise<RssChange[]> {
  const res = await fetchImpl(config.ESBIRKA_RSS_URL ?? DEFAULT_RSS_URL, { headers: { accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`RSS e-Sbírky vrátilo HTTP ${res.status}`);
  return parseRssChanges(await res.text());
}
