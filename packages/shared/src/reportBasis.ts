/**
 * Právní / normativní základ výstupů (ADR-086): zpráva o hodnocení rizik, plán zvládání, SoA, přezkum ISMS
 * a zpráva pro vedení se vedou podle hlavního rámce společnosti (vyhláška 409 / 410, DORA, NIS2, ISO/IEC 27001,
 * jiný rámec z knihovny). Základ se zmrazí do snímku dokumentu – pozdější změna profilu starší verze nemění.
 * Texty českých předpisů se nepřekládají; anglicky jen popisky v záhlaví.
 */
import type { DocKind } from "./documents";
import { FRAMEWORKS } from "./frameworks";
import { doraAuthorityOf, type RegulatoryProfile } from "./regulatory";

export const REPORT_BASIS_IDS = ["cz409", "cz410", "dora", "nis2", "iso27001", "generic"] as const;
export type ReportBasisId = (typeof REPORT_BASIS_IDS)[number];

export interface ReportBasis {
  id: ReportBasisId;
  /** Rámec, podle kterého se dokument vede – záhlaví dokumentu. */
  label: string;
  labelEn: string;
  /** Právní základ dokumentu (podtitul v záhlaví). */
  legal: Record<DocKind, string>;
  legalEn: Record<DocKind, string>;
  /** Název dokumentu podle rámce (jinak výchozí název druhu). */
  titles: Partial<Record<DocKind, string>>;
  /** Odkazy ve zprávě o hodnocení rizik (prázdný řetězec = bez odkazu). */
  risk: { method: string; criteria: string; inputs: string; plan: string; changes: string };
  /** Odkazy v přezkumu ISMS / rámce řízení rizik. */
  review: { title: string; intro: string; objectives: string; suppliers: string; changes: string };
}

const CZ409: ReportBasis = {
  id: "cz409",
  titles: {},
  label: "zákon č. 264/2025 Sb. a vyhláška č. 409/2025 Sb. (vyšší povinnosti)",
  labelEn: "Act No. 264/2025 Coll. and Decree No. 409/2025 Coll. (higher obligations)",
  legal: {
    risk_report: "§ 8 odst. 1 písm. e) vyhlášky č. 409/2025 Sb.",
    soa: "§ 8 odst. 1 písm. f) vyhlášky č. 409/2025 Sb.",
    treatment_plan: "§ 8 odst. 1 písm. g) vyhlášky č. 409/2025 Sb.",
    isms_review: "§ 3 písm. f) a g) vyhlášky č. 409/2025 Sb.",
  },
  legalEn: {
    risk_report: "Section 8(1)(e) of Decree No. 409/2025 Coll.",
    soa: "Section 8(1)(f) of Decree No. 409/2025 Coll.",
    treatment_plan: "Section 8(1)(g) of Decree No. 409/2025 Coll.",
    isms_review: "Section 3(f) and (g) of Decree No. 409/2025 Coll.",
  },
  risk: { method: "§ 8 vyhlášky č. 409/2025 Sb.", criteria: "§ 8 odst. 1 písm. a)", inputs: "§ 8 odst. 1 písm. c)", plan: "§ 8 odst. 1 písm. g)", changes: "§ 11" },
  review: {
    title: "Přezkoumání systému řízení bezpečnosti informací",
    intro: "Vyhodnocení účinnosti systému řízení bezpečnosti informací podle § 3 písm. f) vyhlášky č. 409/2025 Sb. a zpráva o přezkoumání podle § 3 písm. g).",
    objectives: "§ 3 písm. a)",
    suppliers: "§ 9",
    changes: "§ 11",
  },
};

const CZ410: ReportBasis = {
  id: "cz410",
  titles: { isms_review: "Roční aktualizace přehledu bezpečnostních opatření" },
  label: "zákon č. 264/2025 Sb. a vyhláška č. 410/2025 Sb. (nižší povinnosti)",
  labelEn: "Act No. 264/2025 Coll. and Decree No. 410/2025 Coll. (lower obligations)",
  legal: {
    risk_report: "podklad pro přiměřenost bezpečnostních opatření – § 3 odst. 1 písm. a) vyhlášky č. 410/2025 Sb.",
    soa: "§ 3 odst. 2 písm. a) vyhlášky č. 410/2025 Sb.",
    treatment_plan: "§ 3 odst. 2 písm. a) bod 2 vyhlášky č. 410/2025 Sb. (opatření, která budou zavedena)",
    isms_review: "§ 3 odst. 2 písm. b) a § 4 písm. d) vyhlášky č. 410/2025 Sb.",
  },
  legalEn: {
    risk_report: "basis for appropriate security measures – Section 3(1)(a) of Decree No. 410/2025 Coll.",
    soa: "Section 3(2)(a) of Decree No. 410/2025 Coll.",
    treatment_plan: "Section 3(2)(a)(2) of Decree No. 410/2025 Coll. (measures to be implemented)",
    isms_review: "Section 3(2)(b) and Section 4(d) of Decree No. 410/2025 Coll.",
  },
  risk: { method: "vyhlášky č. 410/2025 Sb. (přiměřenost bezpečnostních opatření, § 3 odst. 1 písm. a)", criteria: "", inputs: "", plan: "§ 3 odst. 2 písm. a) bod 2", changes: "" },
  review: {
    title: "Roční aktualizace přehledu bezpečnostních opatření",
    intro: "Roční aktualizace přehledu bezpečnostních opatření s vyhodnocením účinnosti zavedených opatření podle § 3 odst. 2 písm. b) vyhlášky č. 410/2025 Sb.; vrcholné vedení se seznamuje se stavem plnění bezpečnostních opatření podle § 4 písm. d).",
    objectives: "",
    suppliers: "§ 3 odst. 5",
    changes: "",
  },
};

const DORA = (authority: string): ReportBasis => ({
  id: "dora",
  titles: { risk_report: "Zpráva o hodnocení rizik IKT", treatment_plan: "Plán zvládání rizik IKT", isms_review: "Přezkum rámce řízení rizik IKT" },
  label: `DORA – nařízení (EU) 2022/2554 (dohled ${authority})`,
  labelEn: `DORA – Regulation (EU) 2022/2554 (supervised by ${authority})`,
  legal: {
    risk_report: "čl. 6 a 8 nařízení (EU) 2022/2554 (DORA) a nařízení v přenesené pravomoci (EU) 2024/1774 – identifikace a posouzení rizik IKT",
    soa: "přehled plnění požadavků nařízení (EU) 2022/2554 (DORA)",
    treatment_plan: "čl. 6 odst. 8 a čl. 9 nařízení (EU) 2022/2554 (DORA) – opatření ke zvládání rizik IKT",
    isms_review: "čl. 6 odst. 5 a čl. 5 odst. 2 nařízení (EU) 2022/2554 (DORA) – přezkum rámce řízení rizik IKT",
  },
  legalEn: {
    risk_report: "Articles 6 and 8 of Regulation (EU) 2022/2554 (DORA) and Delegated Regulation (EU) 2024/1774 – identification and assessment of ICT risk",
    soa: "overview of compliance with Regulation (EU) 2022/2554 (DORA)",
    treatment_plan: "Article 6(8) and Article 9 of Regulation (EU) 2022/2554 (DORA) – ICT risk treatment",
    isms_review: "Article 6(5) and Article 5(2) of Regulation (EU) 2022/2554 (DORA) – review of the ICT risk management framework",
  },
  risk: {
    method: "čl. 6 a 8 nařízení (EU) 2022/2554 (DORA) a čl. 3 nařízení v přenesené pravomoci (EU) 2024/1774",
    criteria: "úroveň tolerance rizik IKT, čl. 6 odst. 8 písm. b) DORA",
    inputs: "čl. 8 odst. 3 a čl. 13 DORA",
    plan: "čl. 6 odst. 8 a čl. 9 DORA",
    changes: "čl. 8 odst. 3 DORA",
  },
  review: {
    title: "Přezkum rámce řízení rizik IKT",
    intro: `Přezkum rámce řízení rizik IKT podle čl. 6 odst. 5 nařízení (EU) 2022/2554 (DORA) – nejméně jednou ročně, po závažných incidentech IKT a na pokyn orgánu dohledu (${authority}); za řízení rizik IKT odpovídá řídicí orgán (čl. 5 odst. 2).`,
    objectives: "strategie digitální provozní odolnosti, čl. 6 odst. 8 DORA",
    suppliers: "třetí strany poskytující služby IKT, čl. 28–30 DORA",
    changes: "čl. 8 odst. 3 DORA",
  },
});

const NIS2: ReportBasis = {
  id: "nis2",
  titles: { isms_review: "Přezkum opatření k řízení kybernetických rizik" },
  label: "směrnice (EU) 2022/2555 (NIS2) a prováděcí nařízení (EU) 2024/2690",
  labelEn: "Directive (EU) 2022/2555 (NIS2) and Implementing Regulation (EU) 2024/2690",
  legal: {
    risk_report: "čl. 21 odst. 2 písm. a) směrnice (EU) 2022/2555 (NIS2) a bod 2 přílohy prováděcího nařízení (EU) 2024/2690",
    soa: "čl. 21 směrnice (EU) 2022/2555 (NIS2) a příloha prováděcího nařízení (EU) 2024/2690",
    treatment_plan: "bod 2 přílohy prováděcího nařízení (EU) 2024/2690 – plán zvládání rizik",
    isms_review: "čl. 20 a 21 směrnice (EU) 2022/2555 (NIS2) a body 1 a 2 přílohy prováděcího nařízení (EU) 2024/2690",
  },
  legalEn: {
    risk_report: "Article 21(2)(a) of Directive (EU) 2022/2555 (NIS2) and point 2 of the Annex to Implementing Regulation (EU) 2024/2690",
    soa: "Article 21 of Directive (EU) 2022/2555 (NIS2) and the Annex to Implementing Regulation (EU) 2024/2690",
    treatment_plan: "point 2 of the Annex to Implementing Regulation (EU) 2024/2690 – risk treatment plan",
    isms_review: "Articles 20 and 21 of Directive (EU) 2022/2555 (NIS2) and points 1 and 2 of the Annex to Implementing Regulation (EU) 2024/2690",
  },
  risk: {
    method: "čl. 21 odst. 2 písm. a) směrnice NIS2 a bodu 2 přílohy prováděcího nařízení (EU) 2024/2690",
    criteria: "bod 2 přílohy prov. nař. 2024/2690",
    inputs: "bod 2 přílohy prov. nař. 2024/2690",
    plan: "bod 2 přílohy prov. nař. 2024/2690",
    changes: "bod 6 přílohy prov. nař. 2024/2690",
  },
  review: {
    title: "Přezkum opatření k řízení kybernetických rizik",
    intro: "Přezkum opatření k řízení kybernetických rizik podle čl. 21 směrnice (EU) 2022/2555 (NIS2) a přílohy prováděcího nařízení (EU) 2024/2690 (body 1 a 2); řídicí orgány opatření schvalují a dohlížejí na ně (čl. 20). Ověřte vnitrostátní transpozici.",
    objectives: "bod 1 přílohy prov. nař. 2024/2690",
    suppliers: "čl. 21 odst. 2 písm. d) NIS2 (bezpečnost dodavatelského řetězce)",
    changes: "bod 6 přílohy prov. nař. 2024/2690",
  },
};

const ISO: ReportBasis = {
  id: "iso27001",
  titles: { isms_review: "Přezkoumání ISMS vedením" },
  label: "ISO/IEC 27001:2022",
  labelEn: "ISO/IEC 27001:2022",
  legal: {
    risk_report: "ISO/IEC 27001:2022, kap. 6.1.2 a 8.2",
    soa: "ISO/IEC 27001:2022, kap. 6.1.3 d)",
    treatment_plan: "ISO/IEC 27001:2022, kap. 6.1.3 e) a 8.3",
    isms_review: "ISO/IEC 27001:2022, kap. 9.3",
  },
  legalEn: {
    risk_report: "ISO/IEC 27001:2022, clauses 6.1.2 and 8.2",
    soa: "ISO/IEC 27001:2022, clause 6.1.3 d)",
    treatment_plan: "ISO/IEC 27001:2022, clauses 6.1.3 e) and 8.3",
    isms_review: "ISO/IEC 27001:2022, clause 9.3",
  },
  risk: { method: "kap. 6.1.2 a 8.2 normy ISO/IEC 27001:2022", criteria: "kap. 6.1.2 a)", inputs: "kap. 6.1.2", plan: "kap. 6.1.3", changes: "kap. 6.3" },
  review: {
    title: "Přezkoumání systému managementu bezpečnosti informací",
    intro: "Přezkoumání systému managementu bezpečnosti informací vedením podle kap. 9.3 normy ISO/IEC 27001:2022 (vstupy 9.3.2, výstupy 9.3.3).",
    objectives: "kap. 6.2",
    suppliers: "příloha A, opatření 5.19–5.22",
    changes: "kap. 6.3",
  },
};

const GENERIC = (name: string | null): ReportBasis => {
  const fw = name ? `rámec ${name}` : "interní metodika organizace";
  const fwEn = name ? `framework ${name}` : "internal methodology of the organisation";
  return {
    id: "generic",
    titles: {},
    label: name ?? "bez regulatorního rámce",
    labelEn: name ?? "no regulatory framework",
    legal: { risk_report: fw, soa: fw, treatment_plan: fw, isms_review: fw },
    legalEn: { risk_report: fwEn, soa: fwEn, treatment_plan: fwEn, isms_review: fwEn },
    risk: { method: name ? `rámce ${name}` : "metodiky řízení rizik organizace", criteria: "", inputs: "", plan: "", changes: "" },
    review: { title: "Přezkoumání systému řízení bezpečnosti informací", intro: `Přezkoumání systému řízení bezpečnosti informací (${fw}).`, objectives: "", suppliers: "", changes: "" },
  };
};

/** Základ podle ID rámce (SoA se vede podle rámce, za který je sestavené). */
export function reportBasisFor(id: string | null | undefined, opts: { authority?: string } = {}): ReportBasis {
  if (id === "cz409") return CZ409;
  if (id === "cz410") return CZ410;
  if (id === "dora") return DORA(opts.authority ?? "příslušný orgán dohledu");
  if (id === "nis2") return NIS2;
  if (id === "iso27001") return ISO;
  return GENERIC(id ? (FRAMEWORKS.find((f) => f.id === id)?.name ?? id) : null);
}

/** Základ výstupů společnosti: finanční subjekt → DORA, jinak hlavní rámec profilu. */
export function reportBasisOf(p: RegulatoryProfile): ReportBasis {
  if (p.doraEntity) return reportBasisFor("dora", { authority: doraAuthorityOf(p) });
  return reportBasisFor(p.primary, { authority: doraAuthorityOf(p) });
}

/** Výchozí základ starších snímků (před v0.90 se vše vedlo podle vyhlášky č. 409/2025 Sb.). */
export const LEGACY_REPORT_BASIS = CZ409;

/** „ (§ 8 odst. 1 písm. a)“ – odkaz v závorce, prázdný odkaz = nic. */
export const refIn = (r: string) => (r ? ` (${r})` : "");
