import { decodeFeedText, type FeedItem } from "@contix/shared";

/* Zdroj bez RSS (ADR-089): výpis novinek z webové stránky – jen odkazy, nadpisy a datum, nic dalšího se nestahuje. */

const CZ_DATE = /(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})|(20\d{2})-(\d{2})-(\d{2})/;
/**
 * Výpis novinek z webové stránky (zdroj bez RSS): odkazy na téže doméně, jejichž cesta začíná `prefix` a je delší
 * (článek, ne rozcestník ani stránkování). Datum se hledá v textu kolem odkazu (1. 2. 2026 / 2026-02-01).
 */
export function parseHtmlListing(html: string, base: string, prefix: string, max = 100): FeedItem[] {
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return [];
  }
  const items = new Map<string, FeedItem>();
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    let u: URL;
    try {
      u = new URL(m[1]!.replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (u.origin !== origin || u.search || !u.pathname.startsWith(prefix || "/") || u.pathname.replace(/\/$/, "") === (prefix || "/").replace(/\/$/, "")) continue;
    const title = decodeFeedText(m[2]!).slice(0, 500);
    if (title.length < 12) continue;
    u.hash = "";
    const link = u.toString();
    // nejbližší datum u odkazu (před ním, nebo za ním) – ne datum sousední novinky
    const start = m.index ?? 0;
    const before = decodeFeedText(html.slice(Math.max(0, start - 300), start));
    const after = decodeFeedText(html.slice(start + m[0].length, start + m[0].length + 300));
    const lastBefore = [...before.matchAll(new RegExp(CZ_DATE.source, "g"))].at(-1);
    const firstAfter = after.match(CZ_DATE);
    const distBefore = lastBefore ? before.length - ((lastBefore.index ?? 0) + lastBefore[0].length) : Infinity;
    const distAfter = firstAfter ? (firstAfter.index ?? 0) : Infinity;
    const d = distBefore <= distAfter ? lastBefore : firstAfter;
    const iso = d ? (d[3] ? `${d[3]}-${d[2]!.padStart(2, "0")}-${d[1]!.padStart(2, "0")}` : `${d[4]}-${d[5]}-${d[6]}`) : null;
    const prev = items.get(link);
    if (!prev || title.length > prev.title.length)
      items.set(link, { guid: link.slice(0, 500), title, link, summary: "", category: "", publishedAt: iso && !Number.isNaN(Date.parse(iso)) ? new Date(`${iso}T00:00:00Z`).toISOString() : (prev?.publishedAt ?? null) });
    if (items.size >= max) break;
  }
  return [...items.values()];
}

