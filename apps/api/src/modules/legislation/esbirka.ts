import { fragmentKey, textOfXhtml } from "@contix/shared";
import type { Config } from "../../config";

/* ============================================================
 * Konektor na veřejné REST API e-Sbírky (ADR-035).
 * - přístup jen pro čtení, přístupový klíč z registrace klienta u MV ČR (hlavička esel-api-access-key),
 * - šetrně: sekvenčně, max. ~4 dotazy/s, opakování při 429/5xx,
 * - odolně vůči změnám schématu (e-Legislativa 2027): pole se čtou tolerantně, identita fragmentu = klíč z citace,
 *   ID fragmentů zdroje se ukládají jen informativně; surová metadata se ukládají pro pozdější migraci.
 * Cesty jsou na jednom místě (PATHS) – při změně API se upraví jen zde.
 * ============================================================ */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const ESBIRKA_SCHEMA_VERSION = 1;
const PATHS = {
  document: (staleUrl: string) => `/dokumenty-sbirky/${encodeURIComponent(staleUrl)}`,
  fragments: (staleUrl: string, page: number) => `/dokumenty-sbirky/${encodeURIComponent(staleUrl)}/fragmenty?cisloStranky=${page}`,
};
const KEY_HEADER = "esel-api-access-key";
const MAX_PAGES = 500;
/** Rozestup dotazů na zdroj (ohleduplnost); v testech 0. */
const DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 250;

export interface SourceVersion {
  /** Stálá URL konkrétního znění (/sb/2025/264/2025-11-01). */
  versionKey: string;
  effectiveFrom: string | null;
  code: string | null;
  title: string | null;
  sourceUrl: string;
  meta: Record<string, unknown>;
}
export interface SourceFragment {
  key: string;
  label: string;
  text: string;
  depth: number;
  kind: string;
  sourceId: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
  return null;
};
const num = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (typeof o[k] === "number") return o[k] as number;
  return null;
};

const TEXT_KEYS = ["xhtml", "text", "obsah", "xhtmlFragmentu", "textFragmentu", "obsahFragmentu", "html"];
/** Seznam fragmentů v odpovědi – známé klíče, jinak první pole objektů s textem (i o úroveň níž, např. `data.fragmenty`). */
export function fragmentListOf(raw: unknown): Record<string, unknown>[] {
  const isFrag = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x) && Object.keys(x as object).some((k) => /xhtml|text|obsah|citace/i.test(k));
  const pick = (v: unknown) => (Array.isArray(v) && (v.length === 0 || v.some(isFrag)) ? (v as Record<string, unknown>[]) : null);
  if (Array.isArray(raw)) return pick(raw) ?? [];
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  for (const k of ["seznam", "fragmenty", "polozky", "data", "content", "items"]) {
    const v = pick(o[k]);
    if (v) return v;
  }
  for (const v of Object.values(o)) {
    const a = pick(v);
    if (a?.length) return a;
    if (v && typeof v === "object" && !Array.isArray(v)) for (const w of Object.values(v as Record<string, unknown>)) {
      const b = pick(w);
      if (b?.length) return b;
    }
  }
  return [];
}
/** Text fragmentu – známé názvy polí, jinak první textové pole s xhtml / text / obsah v názvu. */
export function fragmentText(f: Record<string, unknown>): string {
  const known = str(f, ...TEXT_KEYS);
  if (known) return known;
  for (const [k, v] of Object.entries(f)) if (/xhtml|text|obsah/i.test(k) && typeof v === "string" && v.trim()) return v;
  return "";
}
/** Struktura odpovědi pro diagnostiku (klíče a délky polí, žádný obsah). */
function shapeOf(raw: unknown): string {
  if (Array.isArray(raw)) return `pole (${raw.length} položek)`;
  if (!raw || typeof raw !== "object") return typeof raw;
  return `klíče ${Object.entries(raw as Record<string, unknown>).slice(0, 12).map(([k, v]) => (Array.isArray(v) ? `${k}[${v.length}]` : k)).join(", ")}`;
}

export function esbirkaConfigured(config: Pick<Config, "ESBIRKA_API_KEY">) {
  return !!config.ESBIRKA_API_KEY?.trim();
}

export class EsbirkaClient {
  private last = 0;
  constructor(
    private config: Pick<Config, "ESBIRKA_API_URL" | "ESBIRKA_API_KEY">,
    private fetchImpl: FetchLike = fetch,
    /** Bez přístupového klíče – veřejný JSON webu e-Sbírky (záloha otevřených dat, v1.12.4). */
    private keyless = false,
  ) {}

  private async get(path: string): Promise<unknown> {
    const key = this.config.ESBIRKA_API_KEY?.trim();
    if (!key && !this.keyless) throw new Error("Není nastaven přístupový klíč e-Sbírky (ESBIRKA_API_KEY) – zaregistrujte klienta REST API u MV ČR.");
    const url = `${(this.config.ESBIRKA_API_URL ?? "https://api.e-sbirka.gov.cz").replace(/\/+$/, "")}${path}`;
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + DELAY_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers: { ...(key && !this.keyless ? { [KEY_HEADER]: key } : {}), accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      } catch (e) {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(`e-Sbírka nedostupná: ${(e as Error).message}`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new Error(`e-Sbírka odmítla přístupový klíč (HTTP ${res.status}).`);
      if (res.status === 404) throw new Error("Předpis v e-Sbírce nenalezen (HTTP 404) – zkontrolujte číslo a rok.");
      if (!res.ok) throw new Error(`e-Sbírka vrátila HTTP ${res.status}.`);
      try {
        return await res.json();
      } catch {
        throw new Error("e-Sbírka nevrátila platný JSON – možná změna rozhraní.");
      }
    }
  }

  /** Aktuální znění předpisu (podle stálé URL bez data). */
  async current(staleUrl: string): Promise<SourceVersion> {
    const raw = await this.get(PATHS.document(staleUrl));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Neočekávaná odpověď e-Sbírky (detail předpisu).");
    const o = raw as Record<string, unknown>;
    const versionKey = str(o, "staleUrl", "stalaUrl", "stálaUrl") ?? staleUrl;
    return {
      versionKey: versionKey.split("#")[0]!,
      effectiveFrom: str(o, "datumUcinnostiOd", "ucinnostOd", "datumUcinnosti")?.slice(0, 10) ?? null,
      code: str(o, "zkracenaCitace", "kodDokumentuSbirky"),
      title: str(o, "uplnaCitace", "nazev", "zkracenaCitace"),
      sourceUrl: `https://e-sbirka.gov.cz${versionKey.split("#")[0]}`,
      meta: o,
    };
  }

  /** Fragmenty znění (stránkovaně) → jen fragmenty s textem, s vlastním klíčem. */
  async fragments(versionKey: string): Promise<SourceFragment[]> {
    const out: SourceFragment[] = [];
    const used = new Map<string, number>();
    let pages: number | null = null;
    const seen = new Set<string>();
    let first = 0;
    let lastShape = "";
    this.lastDiagnostic = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const raw = await this.get(PATHS.fragments(versionKey, page));
      const list = fragmentListOf(raw);
      lastShape ||= shapeOf(raw);
      const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      pages ??= num(o, "pocetStranek", "celkovyPocetStranek", "totalPages") ?? num((o.stranka ?? o.page ?? {}) as Record<string, unknown>, "pocetStranek", "totalPages");
      // stránkování od 1: prázdná stránka 0 → zkusit stránku 1 (v1.12.1)
      if (page === 0 && !list.length && first === 0) {
        first = 1;
        continue;
      }
      // rozhraní bez stránkování vrací stále stejný seznam → konec, když stránka nepřinese nic nového
      const fresh = list.filter((f) => f.id == null || !seen.has(String(f.id)));
      if (page > first && !fresh.length) break;
      for (const f of list) if (f.id != null) seen.add(String(f.id));
      for (const f of fresh) {
        const text = textOfXhtml(fragmentText(f));
        if (!text) continue;
        const label = str(f, "zkracenaCitace", "uplnaCitace", "citace", "kodTypuFragmentu") ?? "";
        let key = fragmentKey(str(f, "staleUrl", "stalaUrl", "eli"), str(f, "zkracenaCitace", "uplnaCitace", "citace")) ?? `frag_${out.length}`;
        const n = (used.get(key) ?? 0) + 1;
        used.set(key, n);
        if (n > 1) key = `${key}~${n}`;
        out.push({ key, label: label.slice(0, 500), text, depth: num(f, "hloubka", "uroven") ?? 0, kind: str(f, "kodTypuFragmentu", "typ") ?? "", sourceId: f.id != null ? String(f.id).slice(0, 60) : null });
      }
      if (!list.length || (pages != null && page + 1 - first >= pages)) break;
    }
    if (!out.length) this.lastDiagnostic = `znění ${versionKey}, odpověď: ${lastShape || "prázdná"}`;
    return out;
  }
  /** Popis poslední prázdné odpovědi fragmentů (do chybové hlášky – bez obsahu, jen struktura). */
  lastDiagnostic: string | null = null;
}
