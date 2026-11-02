/**
 * Jazykové verze ovládání (ADR-036). Vestavěné balíčky (cs, en) jsou součástí aplikace – texty jsou
 * k dispozici hned; nahrané balíčky (Administrace → Jazyky) se dotáhnou z API a doplní / přepíší vestavěné.
 */
import { CS, createTranslator, mergePack, type LangPack, type Translate } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { api } from "./api";
import { setFormatLocale } from "./utils";

const KEY = "contix.locale";
/* čeština je v aplikaci vždy; angličtina (~0,7 MB textů a nápovědy) se načte až při potřebě (v1.09, ADR-105) */
const CS_PACK: LangPack = { locale: "cs", name: "Čeština", nativeName: "Čeština", messages: CS };
const builtin = new Map<string, LangPack>([["cs", CS_PACK]]);
const BUILTIN_LOCALES = new Set(["cs", "en"]);
let enLoading: Promise<void> | null = null;
function loadEn(): Promise<void> {
  if (builtin.has("en")) return Promise.resolve();
  enLoading ??= import("@contix/shared/i18n/en").then((m) => {
    builtin.set("en", m.EN_PACK);
  });
  return enLoading;
}

/** Jazyk před přihlášením: naposledy použitý v tomto prohlížeči, jinak podle prohlížeče, jinak čeština. */
export function initialLocale(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v) return v;
  } catch {
    /* úložiště nedostupné */
  }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "cs").split("-")[0]!;
  return BUILTIN_LOCALES.has(nav) ? nav : "cs";
}
export function rememberLocale(l: string) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* úložiště nedostupné */
  }
}

const Ctx = createContext<Translate>(createTranslator("cs", builtin));
let current: Translate = createTranslator("cs", builtin);
/** Překlad českého popisku mimo komponentu s useT() (malé odznaky, pomocné funkce) – podle aktuálního jazyka. */
/** Překlad klíče mimo komponentu (pomocné funkce) – podle aktuálního jazyka. */
export const tt: Translate = new Proxy((() => "") as unknown as Translate, {
  apply: (_f, _this, args: Parameters<Translate>) => current(...args),
  get: (_f, p) => (current as unknown as Record<string | symbol, unknown>)[p],
});
export const lbl: Translate["lbl"] = (text) => current.lbl(text);

export function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
  const custom = useQuery({ queryKey: ["i18n", "packs", locale], queryFn: () => api.i18n.packs(locale), staleTime: 5 * 60_000, retry: false });
  // angličtina je potřeba pro „en“ i jako náhradní jazyk jiných balíčků
  const needEn = locale !== "cs";
  const en = useQuery({ queryKey: ["i18n", "builtin-en"], queryFn: () => loadEn().then(() => true), enabled: needEn, staleTime: Infinity, retry: 2 });
  const t = useMemo(() => {
    const packs = new Map<string, LangPack>(builtin);
    for (const p of custom.data?.packs ?? []) packs.set(p.locale, p.locale === "cs" || p.locale === "en" ? mergePack(builtin.get(p.locale), p)! : p);
    return createTranslator(packs.has(locale) ? locale : "cs", packs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, custom.data, en.data]);
  setFormatLocale(t.locale);
  current = t;
  useEffect(() => {
    document.documentElement.lang = t.locale;
    rememberLocale(t.locale);
  }, [t.locale]);
  if (needEn && en.isPending) return null;
  return <Ctx.Provider value={t}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);
