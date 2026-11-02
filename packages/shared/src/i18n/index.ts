import { z } from "zod";
import { CS } from "./cs";
import { EN } from "./en";
import { HELP_EN } from "./help.en";
import { EN_LABELS } from "./en.labels";
import { formatMessage, type MsgParams } from "./format";

export { formatMessage, formatNumber, type MsgParams } from "./format";
export { CS } from "./cs";

/*
 * Jazykové verze (ADR-036). Zdroj pravdy je čeština (CS). Další jazyk = jazykový balíček:
 * vestavěný (EN) nebo nahraný správcem v Administraci (uloží se do DB, nepotřebuje novou verzi aplikace).
 * Chybějící klíče se dohledají v náhradním jazyce: zvolený → fallback balíčku → en → cs.
 */

export type MsgKey = keyof typeof CS;
export type Messages = Partial<Record<string, string>>;

export interface HelpTranslation {
  title: string;
  summary: string;
  body: string;
}
export interface LangPack {
  locale: string;
  /** Název česky / anglicky pro správce. */
  name: string;
  /** Název v daném jazyce (zobrazuje se v nabídce jazyků). */
  nativeName: string;
  fallback?: string | null;
  messages: Messages;
  /** Překlady témat nápovědy podle ID tématu. */
  help?: Record<string, HelpTranslation>;
}

export const BASE_LOCALE = "cs";
export const BUILTIN_PACKS: LangPack[] = [
  { locale: "cs", name: "Čeština", nativeName: "Čeština", messages: CS },
  { locale: "en", name: "Angličtina", nativeName: "English", fallback: "cs", messages: { ...EN, ...EN_LABELS }, help: HELP_EN },
];

/** BCP 47 v praxi: cs, en, de, uk, sr-Latn, sr-Cyrl, pt-BR … */
export const LOCALE_RE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

export const LangPackInput = z.object({
  locale: z.string().regex(LOCALE_RE, "Kód jazyka ve tvaru cs, en, de, uk, sr-Latn…"),
  name: z.string().trim().min(1).max(60),
  nativeName: z.string().trim().min(1).max(60),
  fallback: z.string().regex(LOCALE_RE).nullable().optional(),
  messages: z.record(z.string().max(200), z.string().max(5000)).refine((m) => Object.keys(m).length <= 30_000, "Příliš mnoho textů"),
  help: z
    .record(z.string().max(100), z.object({ title: z.string().max(300), summary: z.string().max(1000), body: z.string().max(60_000) }))
    .optional(),
});
export type LangPackInput = z.infer<typeof LangPackInput>;

/** Sloučí vestavěný balíček s nahraným (nahraný přepisuje a doplňuje). */
export function mergePack(base: LangPack | undefined, custom: LangPack | undefined): LangPack | undefined {
  if (!base) return custom;
  if (!custom) return base;
  return {
    ...base,
    ...custom,
    messages: { ...base.messages, ...custom.messages },
    help: { ...(base.help ?? {}), ...(custom.help ?? {}) },
  };
}

/** Pořadí jazyků, ve kterém se hledá text. */
export function localeChain(locale: string, packs: Map<string, LangPack>): string[] {
  const out: string[] = [];
  const add = (l: string | null | undefined) => {
    if (l && packs.has(l) && !out.includes(l)) out.push(l);
  };
  add(locale);
  add(packs.get(locale)?.fallback);
  // sr-Latn → sr
  add(locale.split("-")[0]);
  add("en");
  add(BASE_LOCALE);
  return out;
}

export type Translate = {
  (key: MsgKey, params?: MsgParams): string;
  /** Dynamický klíč (např. popisky výčtů) s náhradním textem. */
  dyn: (key: string, fallback: string, params?: MsgParams) => string;
  /** Překlad hotového českého popisku (výčty ze sdílených *_LABELS, mapy v komponentách) – klíč `lbl:<český text>`. */
  lbl: <T extends string | null | undefined>(text: T) => T extends string ? string : T;
  locale: string;
  has: (key: string) => boolean;
  /** Překlad tématu nápovědy (v řetězci jazyků), nebo undefined = české téma. */
  help: (topicId: string) => HelpTranslation | undefined;
};

export function createTranslator(locale: string, packs: Map<string, LangPack>): Translate {
  const chain = localeChain(locale, packs).map((l) => packs.get(l)!);
  const lookup = (key: string) => {
    for (const p of chain) {
      const m = p.messages[key];
      if (m !== undefined) return m;
    }
    return undefined;
  };
  const t = ((key: MsgKey, params?: MsgParams) => formatMessage(locale, lookup(key) ?? key, params)) as Translate;
  t.dyn = (key, fallback, params) => formatMessage(locale, lookup(key) ?? fallback, params);
  // popisky jsou česky (zdroj) – hledá se jen v jazycích před češtinou v řetězci
  const lblLookup = (text: string) => {
    for (const p of chain) {
      if (p.locale === BASE_LOCALE) return undefined;
      const m = p.messages[`lbl:${text}`];
      if (m !== undefined) return m;
    }
    return undefined;
  };
  t.lbl = ((text: string | null | undefined) => (text ? (lblLookup(text) ?? text) : text)) as Translate["lbl"];
  t.locale = locale;
  t.has = (key) => lookup(key) !== undefined;
  // nápověda: jen ze zvoleného jazyka a jeho náhradních (bez češtiny – ta je v HELP_TOPICS)
  t.help = (id) => {
    for (const p of chain) {
      if (p.locale === BASE_LOCALE) return undefined;
      const h = p.help?.[id];
      if (h) return h;
    }
    return undefined;
  };
  return t;
}

/** Podíl přeložených textů (vůči češtině) – pro přehled jazyků v Administraci. */
export function packCompleteness(pack: LangPack): number {
  const keys = Object.keys(CS);
  if (pack.locale === BASE_LOCALE) return 100;
  const done = keys.filter((k) => typeof pack.messages[k] === "string" && pack.messages[k]!.trim()).length;
  return Math.round((done / keys.length) * 100);
}

/** Popisek hodnoty výčtu: klíč enum.<název>.<hodnota>, jinak původní (český) popisek. */
export const enumLabel = (t: Translate, name: string, value: string, fallback: string) => t.dyn(`enum.${name}.${value}`, fallback);

/** Jazyk z hlavičky Accept-Language, který máme k dispozici. */
export function pickLocale(acceptLanguage: string | null | undefined, available: string[], fallback = BASE_LOCALE): string {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]!.trim();
    if (!tag) continue;
    if (available.includes(tag)) return tag;
    const base = tag.split("-")[0]!;
    const hit = available.find((a) => a === base || a.startsWith(`${base}-`));
    if (hit) return hit;
  }
  return fallback;
}

/** Téma nápovědy v jazyce překladače (title / summary / body), jinak české. */
export function localizeTopic<T extends { id: string; title: string; summary: string; body: string }>(t: Translate, topic: T): T {
  const h = t.help(topic.id);
  return h ? { ...topic, title: h.title, summary: h.summary, body: h.body } : topic;
}
