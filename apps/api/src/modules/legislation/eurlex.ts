import { parseEuStaleUrl, type EuLang } from "@contix/shared";
import type { Config } from "../../config";
import type { FetchLike, SourceFragment, SourceVersion } from "./esbirka";
import { parseEurLexXhtml } from "./eurlexParse";

export { parseEurLexXhtml };

/* ============================================================
 * Předpisy EU z EUR-Lex bez registrace (v0.39, ADR-037):
 * - metadata a seznam znění: veřejný SPARQL endpoint úložiště CELLAR Úřadu pro publikace EU
 *   (publications.europa.eu/webapi/rdf/sparql – limit 60 s na dotaz, max. 5 souběžných spojení),
 * - text: XHTML projev (manifestation) díla v daném jazyce – původní akt (Úřední věstník) nebo konsolidované znění.
 * Model (ontologie CDM): dílo (work) má CELEX; konsolidované znění „0YYYYTNNNN-RRRRMMDD“ odkazuje na základní akt
 * (act_consolidated_based_on_resource_legal); výraz (expression) = jazyk; projev (manifestation) typu xhtml; položka (item) = soubor.
 * Klíče fragmentů jako u nařízení v CONTIX: cl_21, cl_21-odst_2, priloha_I, priloha_1-bod_1.1.1 → DORA čl. 6 = dora:6.
 * ============================================================ */

export const DEFAULT_EURLEX_SPARQL_URL = "https://publications.europa.eu/webapi/rdf/sparql";
const CDM = "http://publications.europa.eu/ontology/cdm#";
const LANG: Record<EuLang, string> = { cs: "CES", en: "ENG" };
/** Rozestup dotazů na zdroj (ohleduplnost); v testech 0. */
const DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Binding = Record<string, { value: string } | undefined>;

export interface EuWork {
  celex: string;
  date: string | null;
  title: string | null;
  item: string | null;
  inForce: boolean | null;
  endOfValidity: string | null;
}

/** Konsolidované znění: datum z CELEX („02014R0910-20241018“ → 2024-10-18), jinak datum dokumentu. */
export const consolidationDate = (celex: string) =>
  celex
    .match(/-(\d{4})(\d{2})(\d{2})$/)
    ?.slice(1)
    .join("-") ?? null;

/**
 * Sledované znění: nejnovější konsolidované znění dostupné v jazyce (i s budoucím datem), jinak původní akt.
 * Vrací i nejnovější znění v jakémkoli jazyce (když překlad konsolidace ještě není, uživatel se to dozví).
 */
export function pickEuVersion(works: EuWork[], base: string) {
  const dated = works.map((w) => ({
    ...w,
    at: w.celex === base ? (w.date ?? "0000-00-00") : (consolidationDate(w.celex) ?? w.date ?? "0000-00-00"),
  }));
  const sorted = dated.sort((a, b) => b.at.localeCompare(a.at) || (a.celex === base ? 1 : -1));
  return {
    chosen: sorted.find((w) => w.item) ?? null,
    newest: sorted[0] ?? null,
  };
}

export class EurLexClient {
  private last = 0;
  /** CELEX znění → URL souboru XHTML (z posledního dotazu current()). */
  private items = new Map<string, string>();
  constructor(
    private config: Pick<Config, "EURLEX_SPARQL_URL">,
    private fetchImpl: FetchLike = fetch,
  ) {}

  private async request(url: string, init: RequestInit, what: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + DELAY_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(90_000),
        });
      } catch (e) {
        if (attempt < 2) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error(`EUR-Lex (${what}) nedostupný: ${(e as Error).message}`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`EUR-Lex (${what}) vrátil HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      return res;
    }
  }

  private async select(query: string): Promise<Binding[]> {
    const res = await this.request(
      this.config.EURLEX_SPARQL_URL ?? DEFAULT_EURLEX_SPARQL_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/sparql-results+json",
        },
        body: new URLSearchParams({
          query,
          format: "application/sparql-results+json",
        }).toString(),
      },
      "SPARQL",
    );
    try {
      const j = (await res.json()) as { results?: { bindings?: Binding[] } };
      if (!Array.isArray(j.results?.bindings)) throw new Error();
      return j.results!.bindings!;
    } catch {
      throw new Error("EUR-Lex (CELLAR) nevrátil platný výsledek SPARQL – možná změna rozhraní.");
    }
  }

  /** Základní akt + všechna konsolidovaná znění; u každého XHTML soubor v jazyce (pokud existuje). */
  async works(celex: string, lang: EuLang): Promise<EuWork[]> {
    if (!/^[0-9A-Z()]+$/.test(celex)) throw new Error(`Neplatné číslo CELEX: ${celex}`);
    const rows = await this.select(`PREFIX cdm:<${CDM}>
SELECT ?c ?d ?force ?eov ?title ?i WHERE {
 { ?w cdm:resource_legal_id_celex ?c . FILTER(STR(?c)="${celex}") OPTIONAL { ?w cdm:resource_legal_in-force ?force } OPTIONAL { ?w cdm:resource_legal_date_end-of-validity ?eov } }
 UNION { ?base cdm:resource_legal_id_celex ?bc . FILTER(STR(?bc)="${celex}") ?w cdm:act_consolidated_based_on_resource_legal ?base . ?w cdm:resource_legal_id_celex ?c }
 OPTIONAL { ?w cdm:work_date_document ?d }
 OPTIONAL { ?e cdm:expression_belongs_to_work ?w ; cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/${LANG[lang]}> .
   OPTIONAL { ?e cdm:expression_title ?title }
   ?m cdm:manifestation_manifests_expression ?e ; cdm:manifestation_type ?type . FILTER(STR(?type)="xhtml")
   ?i cdm:item_belongs_to_manifestation ?m }
}`);
    const byCelex = new Map<string, EuWork>();
    for (const r of rows) {
      const c = r.c?.value?.trim();
      if (!c) continue;
      const w = byCelex.get(c) ?? {
        celex: c,
        date: null,
        title: null,
        item: null,
        inForce: null,
        endOfValidity: null,
      };
      w.date ??= r.d?.value?.slice(0, 10) ?? null;
      w.title ??= r.title?.value?.replace(/\s+/g, " ").trim() ?? null;
      // více souborů (DOC_1, DOC_2…) – první podle názvu je hlavní text
      const item = r.i?.value?.replace(/^http:\/\/publications\.europa\.eu\//, "https://publications.europa.eu/") ?? null;
      if (item && (!w.item || item < w.item)) w.item = item;
      if (r.force?.value) w.inForce = r.force.value === "1" || r.force.value === "true";
      w.endOfValidity ??= r.eov?.value?.slice(0, 10) ?? null;
      byCelex.set(c, w);
    }
    return [...byCelex.values()];
  }

  async current(staleUrl: string): Promise<SourceVersion> {
    const ref = parseEuStaleUrl(staleUrl);
    if (!ref) throw new Error(`Neplatná identifikace předpisu EU: ${staleUrl}`);
    const works = await this.works(ref.celex, ref.lang);
    const base = works.find((w) => w.celex === ref.celex);
    if (!base) throw new Error(`Předpis ${ref.celex} v EUR-Lex (CELLAR) nenalezen – zkontrolujte číslo CELEX.`);
    const { chosen, newest } = pickEuVersion(works, ref.celex);
    if (!chosen) throw new Error(`Text předpisu ${ref.celex} není v EUR-Lex k dispozici v jazyce „${ref.lang}“ ve formátu XHTML (starší akty bývají jen v PDF).`);
    this.items.set(chosen.celex, chosen.item!);
    const eov = base.endOfValidity && base.endOfValidity < "9999" ? base.endOfValidity : null;
    return {
      versionKey: chosen.celex,
      effectiveFrom: chosen.celex === ref.celex ? null : consolidationDate(chosen.celex),
      code: null,
      title: (base.title ?? chosen.title)?.slice(0, 500) ?? null,
      sourceUrl: `https://eur-lex.europa.eu/legal-content/${ref.lang.toUpperCase()}/TXT/?uri=CELEX:${chosen.celex}`,
      meta: {
        source: "eurlex",
        celex: ref.celex,
        lang: ref.lang,
        documentDate: base.date,
        inForce: base.inForce,
        endOfValidity: eov,
        consolidated: chosen.celex !== ref.celex,
        versions: works.length,
        // nejnovější znění zatím bez překladu do zvoleného jazyka
        newerUntranslated: newest && newest.celex !== chosen.celex && !newest.item ? newest.celex : null,
      },
    };
  }

  async fragments(versionKey: string): Promise<SourceFragment[]> {
    const item = this.items.get(versionKey);
    if (!item) throw new Error(`Neznámé znění ${versionKey} – nejdříve načtěte aktuální znění předpisu.`);
    const res = await this.request(item, { headers: { accept: "application/xhtml+xml, text/html" } }, "text");
    return parseEurLexXhtml(await res.text());
  }
}
