import { z } from "zod";
import type { CraProductDto } from "./cra";

/* ============================================================
 * Dokumenty výrobce podle CRA (v1.30, ADR-127): EU prohlášení o shodě (příl. V), zjednodušené prohlášení (příl. VI),
 * informace a pokyny pro uživatele (příl. II) a přehled technické dokumentace (příl. VII). Generují se z údajů
 * produktu + doplňujících údajů `docInfo`; chybějící povinné údaje se v dokumentu zvýrazní a vypíší.
 * ============================================================ */

export const CRA_DOCUMENTS = ["doc", "doc_simplified", "user_info", "tech_summary"] as const;
export type CraDocument = (typeof CRA_DOCUMENTS)[number];

export const CRA_DOC_LANGS = ["cs", "en"] as const;
export type CraDocLang = (typeof CRA_DOC_LANGS)[number];

export const CRA_DOC_LABELS: Record<CraDocument, { name: string; ref: string }> = {
  doc: { name: "EU prohlášení o shodě", ref: "čl. 28, příloha V" },
  doc_simplified: { name: "Zjednodušené EU prohlášení o shodě", ref: "čl. 13 odst. 20, příloha VI" },
  user_info: { name: "Informace a pokyny pro uživatele (bezpečnostní informace o produktu)", ref: "čl. 13 odst. 18, příloha II" },
  tech_summary: { name: "Přehled technické dokumentace", ref: "čl. 31, příloha VII" },
};

const t = (n: number) => z.string().trim().max(n).nullable().optional().transform((v) => v || null);

/** Doplňující údaje pro dokumenty (vedle polí produktu). */
export const CraDocInfo = z.object({
  manufacturerAddress: t(500),
  manufacturerEmail: t(320),
  manufacturerWeb: t(500),
  /** Zplnomocněný zástupce (čl. 18) – název a adresa. */
  authorisedRep: t(800),
  /** Identifikace pro sledovatelnost (sestavení, varianty, sériová čísla…). */
  identification: t(1000),
  /** Internetová adresa, kde je plné EU prohlášení o shodě. */
  docUrl: t(1000),
  /** Kde je k dispozici SBOM (je-li zpřístupněn uživatelům). */
  sbomUrl: t(1000),
  securityProperties: t(5000),
  foreseeableRisks: t(5000),
  supportType: t(2000),
  secureInstall: t(5000),
  changesImpact: t(5000),
  updateInstall: t(5000),
  autoUpdateOff: t(3000),
  decommission: t(5000),
  integration: t(5000),
  signatoryName: t(200),
  signatoryFunction: t(200),
  signPlace: t(200),
  additionalInfo: t(3000),
});
export type CraDocInfo = z.infer<typeof CraDocInfo>;
export type CraDocInfoInput = z.input<typeof CraDocInfo>;

export const CRA_DOC_INFO_FIELDS = Object.keys(CraDocInfo.shape) as (keyof CraDocInfo)[];

export const CRA_DOC_INFO_LABELS: Record<keyof CraDocInfo, string> = {
  manufacturerAddress: "Adresa výrobce",
  manufacturerEmail: "E-mail výrobce",
  manufacturerWeb: "Web výrobce",
  authorisedRep: "Zplnomocněný zástupce (název a adresa)",
  identification: "Identifikace produktu (sestavení, varianty, sériová čísla)",
  docUrl: "Adresa plného EU prohlášení o shodě",
  sbomUrl: "Kde je k dispozici SBOM",
  securityProperties: "Bezpečnostní vlastnosti a základní funkce",
  foreseeableRisks: "Okolnosti, které mohou vést k významným rizikům",
  supportType: "Druh technické bezpečnostní podpory",
  secureInstall: "Bezpečné uvedení do provozu a instalace",
  changesImpact: "Jak změny produktu ovlivní bezpečnost dat",
  updateInstall: "Jak instalovat bezpečnostní aktualizace",
  autoUpdateOff: "Jak vypnout automatické aktualizace",
  decommission: "Bezpečné vyřazení a odstranění dat",
  integration: "Informace pro integraci do jiných produktů",
  signatoryName: "Podepisující osoba",
  signatoryFunction: "Funkce podepisující osoby",
  signPlace: "Místo vydání",
  additionalInfo: "Další informace",
};

export type CraDocField = keyof CraDocInfo | "manufacturerName" | "version" | "intendedPurpose" | "securityContact" | "cvdPolicyUrl" | "supportUntil" | "conformityModule" | "notifiedBody" | "docIssuedAt" | "description";

/** Povinné údaje dokumentu – co chybí, se v dokumentu zvýrazní. */
export const CRA_DOC_REQUIRED: Record<CraDocument, CraDocField[]> = {
  doc: ["manufacturerName", "manufacturerAddress", "version", "identification", "conformityModule", "signatoryName", "signatoryFunction", "signPlace", "docIssuedAt"],
  doc_simplified: ["manufacturerName", "docUrl"],
  user_info: [
    "manufacturerName",
    "manufacturerAddress",
    "manufacturerEmail",
    "securityContact",
    "cvdPolicyUrl",
    "intendedPurpose",
    "securityProperties",
    "foreseeableRisks",
    "supportType",
    "supportUntil",
    "secureInstall",
    "changesImpact",
    "updateInstall",
    "autoUpdateOff",
    "decommission",
  ],
  tech_summary: ["description", "intendedPurpose", "conformityModule", "supportUntil"],
};

/** Chybějící povinné údaje; notifiedBody je povinný jen pro moduly B+C a H. */
export function craDocMissing(kind: CraDocument, p: Pick<CraProductDto, "manufacturerName" | "version" | "intendedPurpose" | "securityContact" | "cvdPolicyUrl" | "supportUntil" | "conformityModule" | "notifiedBody" | "docIssuedAt" | "description">, info: Partial<CraDocInfo>): CraDocField[] {
  const val = (f: CraDocField) => (f in info ? info[f as keyof CraDocInfo] : (p as Record<string, unknown>)[f]);
  const req = [...CRA_DOC_REQUIRED[kind]];
  if (kind === "doc" && (p.conformityModule === "B_C" || p.conformityModule === "H")) req.push("notifiedBody");
  return req.filter((f) => {
    const v = val(f);
    return v === null || v === undefined || (typeof v === "string" && !v.trim());
  });
}

/** Dokumenty, které smí role vydat (dovozce a distributor prohlášení nevydávají – ověřují výrobcovo). */
export function craDocAllowed(role: string, kind: CraDocument): boolean {
  if (role === "manufacturer") return true;
  if (role === "oss_steward") return kind === "user_info";
  return false;
}
