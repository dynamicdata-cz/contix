/**
 * Minimalistický formát zpráv (podmnožina ICU MessageFormat), sdílený UI, API i výstupy:
 *   "Ahoj {name}"                                         – dosazení parametru
 *   "{n, plural, one {# dokument} few {# dokumenty} other {# dokumentů}}" – množná čísla podle Intl.PluralRules
 *   "{kind, select, added {nové} removed {zrušené} other {změněné}}"      – výběr podle hodnoty
 * Kategorie množného čísla se řídí jazykem (cs: one/few/many/other, uk/sr: one/few/many/other, en: one/other).
 * `#` uvnitř plural se nahradí číslem formátovaným podle jazyka. Apostrof se neřeší (není potřeba).
 */
export type MsgParams = Record<string, string | number | null | undefined>;

const pluralCache = new Map<string, Intl.PluralRules>();
const numberCache = new Map<string, Intl.NumberFormat>();
function pluralRules(locale: string) {
  let r = pluralCache.get(locale);
  if (!r) {
    try {
      r = new Intl.PluralRules(locale);
    } catch {
      r = new Intl.PluralRules("en");
    }
    pluralCache.set(locale, r);
  }
  return r;
}
export function formatNumber(locale: string, n: number) {
  let f = numberCache.get(locale);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale);
    } catch {
      f = new Intl.NumberFormat("en");
    }
    numberCache.set(locale, f);
  }
  return f.format(n);
}

/** Najde konec bloku `{…}` od pozice otevírací závorky (počítá vnoření). */
function closing(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Rozloží „one {…} few {…} other {…}“ na mapu variant. */
function variants(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const m = /\s*(=?[\w-]+)\s*\{/y;
    m.lastIndex = i;
    const r = m.exec(body);
    if (!r) break;
    const open = m.lastIndex - 1;
    const end = closing(body, open);
    if (end < 0) break;
    out.set(r[1]!, body.slice(open + 1, end));
    i = end + 1;
  }
  return out;
}

export function formatMessage(locale: string, msg: string, params: MsgParams = {}, hash?: string): string {
  let out = "";
  let i = 0;
  while (i < msg.length) {
    const ch = msg[i]!;
    if (ch === "#" && hash !== undefined) {
      out += hash;
      i++;
      continue;
    }
    if (ch !== "{") {
      out += ch;
      i++;
      continue;
    }
    const end = closing(msg, i);
    if (end < 0) {
      out += msg.slice(i);
      break;
    }
    const inner = msg.slice(i + 1, end);
    const c1 = inner.indexOf(",");
    if (c1 < 0) {
      const v = params[inner.trim()];
      out += v === null || v === undefined ? "" : typeof v === "number" ? formatNumber(locale, v) : String(v);
    } else {
      const name = inner.slice(0, c1).trim();
      const rest = inner.slice(c1 + 1);
      const c2 = rest.indexOf(",");
      const type = rest.slice(0, c2).trim();
      const opts = variants(rest.slice(c2 + 1));
      const raw = params[name];
      if (type === "plural") {
        const n = Number(raw ?? 0);
        const pick = opts.get(`=${n}`) ?? opts.get(pluralRules(locale).select(n)) ?? opts.get("other") ?? "";
        out += formatMessage(locale, pick, params, formatNumber(locale, n));
      } else {
        const pick = opts.get(String(raw)) ?? opts.get("other") ?? "";
        out += formatMessage(locale, pick, params, hash);
      }
    }
    i = end + 1;
  }
  return out;
}
