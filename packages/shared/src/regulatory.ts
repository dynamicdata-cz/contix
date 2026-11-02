import { z } from "zod";
import { FRAMEWORKS, frameworkExists, type FrameworkId } from "./frameworks";

/* ============================================================
 * Regulatorní profil společnosti (v0.84, ADR-080).
 * Profil = balíček země + úroveň povinností + hlavní rámec. Moduly se ptají profilu (`profileOf`),
 * nikdy přímo na režim / vyhlášku 409 / 410 – tak lze CONTIX použít i mimo českou legislativu.
 * Balíček CZ je první; „generic“ = bez národního předpisu, hlavní rámec z knihovny (ISO, vlastní rámec jiného státu…).
 * ============================================================ */

export const PACK_IDS = ["cz", "sk", "pl", "de", "at", "generic"] as const;
export type PackId = (typeof PACK_IDS)[number];

export interface PackLevel {
  /** Úroveň povinností (u CZ = `regime`). */
  key: "higher" | "lower" | "none";
  name: string;
  /** Hlavní rámec (vyhláška); null = neregulovaný – hlavní rámec volitelně z knihovny. */
  primary: FrameworkId | null;
  /** Zákon, který se sleduje vždy s hlavním rámcem. */
  law: FrameworkId | null;
}

export interface RegulatoryPack {
  id: PackId;
  jurisdiction: string;
  name: string;
  description: string;
  /** Úřad pro hlášení incidentů a dozor (zobrazení; pravidla hlášení od 0.85). */
  authority: string;
  levels: PackLevel[];
  /** Doporučená metodika analýzy rizik (ID v registru metodik). */
  riskMethodology: string;
  /** Ustanovení národního zákona o hlášení incidentů (lhůty podle čl. 23 NIS2) – ADR-082. */
  reportingRef?: string;
  /** Stav znění, ze kterého balíček vychází (k ověření). */
  asOf?: string;
}

export const REGULATORY_PACKS: RegulatoryPack[] = [
  {
    id: "cz",
    jurisdiction: "CZ",
    name: "Česko – zákon č. 264/2025 Sb., o kybernetické bezpečnosti",
    description: "Režim vyšších povinností (vyhl. 409/2025 Sb.), nižších povinností (vyhl. 410/2025 Sb.) nebo neregulovaný subjekt.",
    authority: "NÚKIB",
    levels: [
      { key: "higher", name: "Vyšší povinnosti (vyhl. 409)", primary: "cz409", law: "zkb" },
      { key: "lower", name: "Nižší povinnosti (vyhl. 410)", primary: "cz410", law: "zkb" },
      { key: "none", name: "Neregulovaná", primary: null, law: null },
    ],
    riskMethodology: "zkb409",
  },
  /*
   * Balíčky států EU podle vnitrostátní transpozice NIS2 (stav 10/2026 – ověřte aktuální znění).
   * Lhůty hlášení: včasné varování 24 h, oznámení 72 h, závěrečná zpráva do 1 měsíce. Hlavní rámec = NIS2 + 2024/2690,
   * plné znění národního zákona lze naimportovat do knihovny rámců a zvolit jako hlavní rámec.
   */
  {
    id: "sk",
    jurisdiction: "SK",
    name: "Slovensko – zákon č. 69/2018 Z. z. o kybernetickej bezpečnosti (NIS2, od 1. 1. 2025)",
    description: "Prevádzkovateľ základnej služby (§ 17) – registrácia u NBÚ do 60 dní; bezpečnostné opatrenia § 20; hlásenie incidentov § 24 cez jednotný informačný systém kybernetickej bezpečnosti.",
    authority: "NBÚ / SK-CERT",
    levels: [
      { key: "higher", name: "Prevádzkovateľ základnej služby", primary: "nis2", law: null },
      { key: "none", name: "Mimo pôsobnosti zákona", primary: null, law: null },
    ],
    riskMethodology: "matrix_5x5",
    reportingRef: "§ 24 zákona č. 69/2018 Z. z.",
    asOf: "2026-10",
  },
  {
    id: "pl",
    jurisdiction: "PL",
    name: "Polsko – ustawa o krajowym systemie cyberbezpieczeństwa (novela Dz.U. 2026 poz. 252, od 3. 4. 2026)",
    description: "Podmiot kluczowy / ważny – wpis do wykazu (Ministerstwo Cyfryzacji); środki bezpieczeństwa do 3. 4. 2027; incydenty do CSIRT NASK / GOV / MON przez system S46.",
    authority: "CSIRT NASK / CSIRT GOV / CSIRT MON",
    levels: [
      { key: "higher", name: "Podmiot kluczowy", primary: "nis2", law: null },
      { key: "lower", name: "Podmiot ważny", primary: "nis2", law: null },
      { key: "none", name: "Poza zakresem ustawy", primary: null, law: null },
    ],
    riskMethodology: "matrix_5x5",
    reportingRef: "UKSC (čl. 23 NIS2)",
    asOf: "2026-10",
  },
  {
    id: "de",
    jurisdiction: "DE",
    name: "Německo – BSIG ve znění NIS2UmsuCG (od 6. 12. 2025)",
    description: "Besonders wichtige / wichtige Einrichtung (§ 28 BSIG) – registrace u BSI do 3 měsíců (§ 33); opatření § 30; hlášení § 32 (Erstmeldung 24 h, Folgemeldung 72 h, Abschlussmeldung 1 měsíc).",
    authority: "BSI",
    levels: [
      { key: "higher", name: "Besonders wichtige Einrichtung", primary: "nis2", law: null },
      { key: "lower", name: "Wichtige Einrichtung", primary: "nis2", law: null },
      { key: "none", name: "Außerhalb des Anwendungsbereichs", primary: null, law: null },
    ],
    riskMethodology: "matrix_5x5",
    reportingRef: "§ 32 BSIG",
    asOf: "2026-10",
  },
  {
    id: "at",
    jurisdiction: "AT",
    name: "Rakousko – NISG 2026 (BGBl. I Nr. 94/2025, od 1. 10. 2026)",
    description: "Wesentliche / wichtige Einrichtung – registrace do 31. 12. 2026 (USP „NIS 2 Services“, Bundesamt für Cybersicherheit); opatření § 32; hlášení sektorovému / národnímu CSIRT.",
    authority: "Sektorový / národní CSIRT; dozor Bundesamt für Cybersicherheit",
    levels: [
      { key: "higher", name: "Wesentliche Einrichtung", primary: "nis2", law: null },
      { key: "lower", name: "Wichtige Einrichtung", primary: "nis2", law: null },
      { key: "none", name: "Außerhalb des Anwendungsbereichs", primary: null, law: null },
    ],
    riskMethodology: "matrix_5x5",
    reportingRef: "NISG 2026 (čl. 23 NIS2)",
    asOf: "2026-10",
  },
  {
    id: "generic",
    jurisdiction: "INT",
    name: "Bez národního předpisu – hlavní rámec z knihovny",
    description: "Pro společnosti mimo Česko nebo dobrovolné řízení bezpečnosti: hlavní rámec zvolíte z knihovny (ISO/IEC 27001, NIS2, importovaný zákon jiného státu…).",
    authority: "Národní CSIRT / příslušný orgán (NIS2)",
    levels: [{ key: "none", name: "Podle hlavního rámce", primary: null, law: null }],
    riskMethodology: "matrix_5x5",
  },
];

export const regulatoryPack = (id: string | null | undefined): RegulatoryPack => REGULATORY_PACKS.find((p) => p.id === id) ?? REGULATORY_PACKS[0]!;

export const PackIdSchema = z.enum(PACK_IDS);
/** Hlavní rámec (jen formát ID – existence se ověřuje až při použití, rámec mohl být z knihovny smazán). */
export const PrimaryFrameworkSchema = z
  .string()
  .regex(/^([a-z0-9]{2,12}|x-[a-z0-9][a-z0-9-]{1,39})$/)
  .nullable();

export interface RegulatoryProfile {
  pack: PackId;
  jurisdiction: string;
  /** Úroveň povinností. */
  level: "higher" | "lower" | "none";
  levelName: string;
  /** Regulovaný subjekt podle národního zákona balíčku. */
  regulated: boolean;
  /** Hlavní rámec (vyhláška nebo zvolený z knihovny); null = žádný. */
  primary: FrameworkId | null;
  /** Zákon sledovaný s hlavním rámcem. */
  law: FrameworkId | null;
  /** Rámec pro výchozí výběry v UI (SoA, pokrytí, audit) – nikdy null. */
  defaultFramework: FrameworkId;
  /** Vestavěný kontrolní seznam auditu podle hlavního rámce (`fw:<id>` nebo vestavěná metodika). */
  auditMethodology: string | null;
  riskMethodology: string;
  authority: string;
  /** Pravidla hlášení incidentů (ADR-081). */
  incidentRegime: "higher" | "lower" | "none" | "nis2" | "dora";
  /** Výchozí adresát hlášení. */
  incidentRecipient: "nukib" | "national_cert" | "financial_supervisor" | "other";
  /** Uvádět odkazy na § české vyhlášky v kontrolách (dokumentace ISMS, změny). */
  czLegalRefs: boolean;
  /** Ustanovení národního zákona o hlášení (balíčky států EU) – doplní se k lhůtám NIS2. */
  incidentLegalRef: string | null;
  /** Finanční subjekt podle DORA (ADR-084): sektorový předpis EU se sleduje vždy a má přednost pro řízení rizik IKT a hlášení incidentů. */
  doraEntity: boolean;
  /** Sektorový rámec sledovaný vždy (DORA). */
  sector: FrameworkId | null;
}

/** Profil ze (sloučeného) nastavení společnosti. */
export function profileOf(s: { regime?: string | null; pack?: string | null; primaryFramework?: string | null; doraEntity?: boolean | null }): RegulatoryProfile {
  const dora = !!s.doraEntity;
  const pack = regulatoryPack(s.pack);
  const level = pack.levels.find((l) => l.key === s.regime) ?? pack.levels[0]!;
  const chosen = s.primaryFramework && frameworkExists(s.primaryFramework) ? (s.primaryFramework as FrameworkId) : null;
  // CZ: vyhláška podle režimu pevně; ostatní balíčky: zvolený rámec z knihovny (např. importovaný národní zákon) má přednost před NIS2
  // finanční subjekt bez národní vyhlášky: hlavním rámcem je DORA (nezvolil-li jiný)
  const primary = pack.id === "cz" ? (level.primary ?? chosen ?? (dora ? "dora" : null)) : (chosen ?? (dora ? "dora" : level.primary));
  return {
    pack: pack.id,
    jurisdiction: pack.jurisdiction,
    level: level.key,
    levelName: level.name,
    regulated: !!level.primary,
    primary,
    law: level.law,
    // dříve se u neregulované CZ společnosti ukazovala vyhláška 409 – zachováno kvůli návaznosti
    defaultFramework: primary ?? (pack.id === "cz" ? "cz409" : "iso27001"),
    auditMethodology: primary === "cz409" ? "zkb409_audit" : primary === "cz410" ? "zkb410_audit" : primary ? `fw:${primary}` : null,
    riskMethodology: pack.riskMethodology,
    authority: pack.authority,
    // DORA má u finančních subjektů přednost před NIS2 / ZKB pro hlášení incidentů (společné prohlášení ČNB a NÚKIB 24. 6. 2026)
    incidentRegime: dora ? "dora" : pack.id === "cz" ? level.key : pack.id === "generic" || level.key !== "none" ? "nis2" : "none",
    incidentRecipient: dora ? "financial_supervisor" : pack.id === "cz" ? (level.key === "lower" ? "national_cert" : "nukib") : "other",
    incidentLegalRef: dora ? null : (pack.reportingRef ?? null),
    czLegalRefs: pack.id === "cz",
    doraEntity: dora,
    sector: dora ? "dora" : null,
  };
}

/** Rámce, které profil sleduje vždy (zákon + hlavní rámec). */
export const baseFrameworks = (p: RegulatoryProfile): FrameworkId[] => [...new Set([p.law, p.primary, p.sector].filter((x): x is FrameworkId => !!x))];

/** Dozorový orgán finančního trhu podle země (adresát hlášení podle DORA). */
export const DORA_AUTHORITY: Record<string, string> = { CZ: "ČNB", SK: "NBS", PL: "KNF", DE: "BaFin", AT: "FMA" };
export const doraAuthorityOf = (p: RegulatoryProfile) => DORA_AUTHORITY[p.jurisdiction] ?? "příslušný orgán dohledu";

/**
 * Česká vyhláška profilu – jen pro funkce vázané na strukturu vyhlášky (oddíly § ISMS, výchozí katalog V-xx/N-xx,
 * šablony dotazníků). Mimo balíček CZ null; nové funkce mají pracovat s `primary` / `defaultFramework`.
 */
export const czDecreeOf = (p: RegulatoryProfile): "cz409" | "cz410" | null => (p.pack === "cz" && (p.primary === "cz409" || p.primary === "cz410") ? p.primary : null);

/** Odstraní odkaz na § české vyhlášky / zákona na konci hlášky mezery – mimo balíček CZ se neuvádí (ADR-081). */
export const withLegalRefs = (gaps: string[], czLegalRefs: boolean): string[] => (czLegalRefs ? gaps : gaps.map((g) => g.replace(/ \(§.*?\)(?=\.$)/, "")));

/** Klíč a parametry popisku profilu pro výstupy (zpráva pro vedení, průvodce): CZ podle režimu, jinak hlavní rámec. */
export function profileLabelKey(p: RegulatoryProfile): { key: "prf.label.higher" | "prf.label.lower" | "prf.label.none" | "prf.label.generic"; main: string } {
  const main = p.primary ? (FRAMEWORKS.find((f) => f.id === p.primary)?.shortName ?? p.primary) : "—";
  if (p.pack !== "cz") return { key: "prf.label.generic", main };
  return { key: p.level === "higher" ? "prf.label.higher" : p.level === "lower" ? "prf.label.lower" : "prf.label.none", main };
}
