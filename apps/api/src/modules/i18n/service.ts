import { BUILTIN_PACKS, CS, createTranslator, localeChain, mergePack, pickLocale, type LangPack, type Translate } from "@contix/shared";
import type { Context } from "hono";
import type { AppEnv } from "../../auth/service";
import { getSettings } from "../../auth/service";
import type { Db } from "../../db/client";
import { languagePacks } from "../../db/schema";

/* Jazykové balíčky: vestavěné (shared) + nahrané správcem (tabulka language_packs), ADR-036. */

/** Čeština bez DB (výchozí pro výpočty mimo požadavek, testy). */
export const CS_T: Translate = createTranslator("cs", new Map(BUILTIN_PACKS.map((p) => [p.locale, p] as const)));

let cache: { at: number; packs: Map<string, LangPack>; custom: Set<string> } | null = null;
export const invalidatePacks = () => void (cache = null);

/** Všechny dostupné balíčky (vestavěné sloučené s nahranými). Cache 60 s. */
export async function allPacks(db: Db): Promise<{ packs: Map<string, LangPack>; custom: Set<string> }> {
  if (cache && Date.now() - cache.at < 60_000) return cache;
  const rows = await db.select().from(languagePacks);
  const packs = new Map(BUILTIN_PACKS.map((p) => [p.locale, p] as const));
  const custom = new Set<string>();
  for (const r of rows) {
    custom.add(r.locale);
    const up: LangPack = { locale: r.locale, name: r.name, nativeName: r.nativeName, fallback: r.fallback, messages: r.messages ?? {}, help: r.help ?? undefined };
    packs.set(r.locale, mergePack(packs.get(r.locale), up)!);
  }
  cache = { at: Date.now(), packs, custom };
  return cache;
}

/** Jazyk požadavku: uživatel → výchozí jazyk organizace; bez přihlášení podle prohlížeče. */
export async function localeOf(db: Db, c: Context<AppEnv>): Promise<string> {
  const { packs } = await allPacks(db);
  const user = c.get("auth")?.user;
  if (user?.locale && packs.has(user.locale)) return user.locale;
  const s = await getSettings(db);
  if (user) return packs.has(s.defaultLocale) ? s.defaultLocale : "cs";
  return pickLocale(c.req.header("accept-language"), [...packs.keys()], packs.has(s.defaultLocale) ? s.defaultLocale : "cs");
}

export async function translatorFor(db: Db, locale: string): Promise<Translate> {
  const { packs } = await allPacks(db);
  return createTranslator(packs.has(locale) ? locale : "cs", packs);
}

/** Překladač pro požadavek (hlášky API v jazyce uživatele). */
export async function tFor(db: Db, c: Context<AppEnv>): Promise<Translate> {
  return translatorFor(db, await localeOf(db, c));
}

export { localeChain, CS };
