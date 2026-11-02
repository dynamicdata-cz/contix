import type { LangPack } from "./index";
import { EN } from "./en";
import { EN_LABELS } from "./en.labels";
import { HELP_EN } from "./help.en";

/** Vestavěný anglický balíček jako samostatný modul – web ho načítá až při přepnutí do angličtiny (v1.09, ADR-105). */
export const EN_PACK: LangPack = { locale: "en", name: "Angličtina", nativeName: "English", fallback: "cs", messages: { ...EN, ...EN_LABELS }, help: HELP_EN };
