import {
  CRA_DOC_INFO_LABELS,
  CRA_LABELS,
  CraDocInfo,
  craDocMissing,
  craRequirementsFor,
  type CraDocField,
  type CraDocLang,
  type CraDocument,
  type CraReqState,
  type CraRole,
  type Translate,
} from "@contix/shared";
import type { craProducts } from "../../db/schema";
import { html as h, printPage } from "../documents/render";

/* ============================================================
 * Dokumenty výrobce podle CRA (v1.30, ADR-127) – HTML (tisk / PDF) a podklad pro .docx.
 * Text odpovídá obsahu příloh II, V, VI a VII nařízení (EU) 2024/2847; chybějící údaje se zvýrazní.
 * ============================================================ */

type Row = typeof craProducts.$inferSelect;
export interface CraDocContext {
  product: Row;
  info: CraDocInfo;
  lang: CraDocLang;
  t: Translate;
  orgName: string;
  componentCount: number;
  linkedRisks: number;
}

const REG = {
  cs: "nařízením Evropského parlamentu a Rady (EU) 2024/2847 ze dne 23. října 2024 o horizontálních požadavcích na kybernetickou bezpečnost produktů s digitálními prvky (akt o kybernetické odolnosti)",
  en: "Regulation (EU) 2024/2847 of the European Parliament and of the Council of 23 October 2024 on horizontal cybersecurity requirements for products with digital elements (Cyber Resilience Act)",
};

const TITLES: Record<CraDocument, Record<CraDocLang, string>> = {
  doc: { cs: "EU prohlášení o shodě", en: "EU declaration of conformity" },
  doc_simplified: { cs: "Zjednodušené EU prohlášení o shodě", en: "Simplified EU declaration of conformity" },
  user_info: { cs: "Informace a pokyny pro uživatele", en: "Information and instructions to the user" },
  tech_summary: { cs: "Přehled technické dokumentace", en: "Technical documentation overview" },
};
export const craDocTitle = (kind: CraDocument, lang: CraDocLang) => TITLES[kind][lang];

const FIELD_EN: Partial<Record<CraDocField, string>> = {
  manufacturerName: "manufacturer name",
  version: "version",
  intendedPurpose: "intended purpose",
  securityContact: "vulnerability reporting contact",
  cvdPolicyUrl: "coordinated vulnerability disclosure policy",
  supportUntil: "end of support period",
  conformityModule: "conformity assessment procedure",
  notifiedBody: "notified body",
  docIssuedAt: "date of issue",
  description: "description",
  manufacturerAddress: "manufacturer address",
  manufacturerEmail: "manufacturer e-mail",
  identification: "product identification",
  docUrl: "internet address of the declaration",
  securityProperties: "security properties",
  foreseeableRisks: "foreseeable risk circumstances",
  supportType: "type of technical security support",
  secureInstall: "secure commissioning",
  changesImpact: "impact of changes",
  updateInstall: "installing security updates",
  autoUpdateOff: "turning off automatic updates",
  decommission: "secure decommissioning",
  signatoryName: "signatory",
  signatoryFunction: "signatory function",
  signPlace: "place of issue",
};
const FIELD_CS: Partial<Record<CraDocField, string>> = {
  manufacturerName: "název výrobce",
  version: "verze",
  intendedPurpose: "zamýšlený účel",
  securityContact: "kontakt pro hlášení zranitelností",
  cvdPolicyUrl: "politika koordinovaného zveřejňování zranitelností",
  supportUntil: "konec doby podpory",
  conformityModule: "postup posuzování shody",
  notifiedBody: "oznámený subjekt",
  docIssuedAt: "datum vydání",
  description: "popis",
};
const fieldLabel = (f: CraDocField, lang: CraDocLang) => (lang === "en" ? (FIELD_EN[f] ?? f) : (FIELD_CS[f] ?? (CRA_DOC_INFO_LABELS as Record<string, string>)[f] ?? f).toLowerCase());

const MODULE_TEXT: Record<string, Record<CraDocLang, string>> = {
  A: { cs: "interní kontrola (modul A, příloha VIII část I)", en: "internal control (module A, Annex VIII Part I)" },
  B_C: { cs: "EU přezkoušení typu (modul B) a shoda s typem založená na interní kontrole výroby (modul C), příloha VIII části II a III", en: "EU-type examination (module B) and conformity to type based on internal production control (module C), Annex VIII Parts II and III" },
  H: { cs: "shoda založená na plném zabezpečení kvality (modul H, příloha VIII část IV)", en: "conformity based on full quality assurance (module H, Annex VIII Part IV)" },
  EUCC: { cs: "evropský certifikát kybernetické bezpečnosti (čl. 27 odst. 9)", en: "European cybersecurity certificate (Article 27(9))" },
};

export function renderCraDocument(kind: CraDocument, x: CraDocContext): { title: string; html: string; missing: CraDocField[] } {
  const { esc, nl } = h;
  const { product: p, info, lang, t } = x;
  const L = (cs: string, en: string) => (lang === "en" ? en : cs);
  const manufacturer = p.manufacturerName || (p.role === "manufacturer" ? x.orgName : null);
  const prod = { ...p, manufacturerName: manufacturer };
  const missing = craDocMissing(kind, prod as never, info);
  const miss = (f: CraDocField) => `<span style="background:#fef3c7;color:#92400e;padding:0 4px;border-radius:3px">[${esc(L("doplňte", "fill in"))}: ${esc(fieldLabel(f, lang))}]</span>`;
  /** Hodnota pole nebo zvýrazněná výzva k doplnění (jen u povinných), jinak „—“. */
  const v = (f: CraDocField, multiline = false): string => {
    const val = f in info ? info[f as keyof CraDocInfo] : (prod as Record<string, unknown>)[f];
    if (val === null || val === undefined || val === "") return missing.includes(f) ? miss(f) : "—";
    return multiline ? nl(String(val)) : esc(String(val));
  };
  const date = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(lang === "en" ? "en-GB" : "cs-CZ", { timeZone: "UTC" }) : null);
  const productLine = `${esc(p.name)}${p.version ? ` ${esc(p.version)}` : ""}`;
  const title = TITLES[kind][lang];
  const ptype = t.lbl(CRA_LABELS.productType[p.productType as keyof typeof CRA_LABELS.productType] ?? p.productType);
  const missingNote = missing.length
    ? `<div style="border:1px solid #f59e0b;background:#fffbeb;padding:8px 12px;margin:12px 0" class="no-print small">${esc(L("Koncept – chybí povinné údaje: ", "Draft – required information missing: "))}${missing.map((f) => esc(fieldLabel(f, lang))).join(", ")}</div>`
    : "";
  let body = "";

  if (kind === "doc") {
    const dateIssued = date(p.docIssuedAt);
    body = `<h1>${esc(title)}</h1>
<div class="muted">${esc(L(`č. ${p.code ?? p.id.slice(0, 8)}${p.version ? `-${p.version}` : ""}`, `No. ${p.code ?? p.id.slice(0, 8)}${p.version ? `-${p.version}` : ""}`))}</div>
${missingNote}
<ol>
<li><b>${esc(L("Produkt s digitálními prvky", "Product with digital elements"))}:</b> ${productLine} (${esc(ptype)})<br>${esc(L("Verze / typ / identifikace", "Version / type / identification"))}: ${v("version")}; ${v("identification", true)}</li>
<li><b>${esc(L("Název a adresa výrobce", "Name and address of the manufacturer"))}:</b> ${v("manufacturerName")}, ${v("manufacturerAddress")}${info.authorisedRep ? `<br><b>${esc(L("Zplnomocněný zástupce", "Authorised representative"))}:</b> ${nl(info.authorisedRep)}` : ""}</li>
<li>${esc(L("Toto prohlášení o shodě se vydává na výhradní odpovědnost výrobce.", "This declaration of conformity is issued under the sole responsibility of the manufacturer."))}</li>
<li><b>${esc(L("Předmět prohlášení", "Object of the declaration"))}:</b> ${productLine}${p.description ? ` – ${nl(p.description)}` : ""}${info.identification ? `<br>${nl(info.identification)}` : ""}</li>
<li>${esc(L(`Výše popsaný předmět prohlášení je ve shodě s ${REG.cs}.`, `The object of the declaration described above is in conformity with ${REG.en}.`))}</li>
<li><b>${esc(L("Odkazy na použité harmonizované normy, společné specifikace nebo certifikaci kybernetické bezpečnosti", "References to the relevant harmonised standards, common specifications or cybersecurity certification used"))}:</b> ${p.harmonisedStandards ? nl(p.harmonisedStandards) : esc(L("nebyly použity", "none applied"))}</li>
<li><b>${esc(L("Postup posuzování shody", "Conformity assessment procedure"))}:</b> ${p.conformityModule ? esc(MODULE_TEXT[p.conformityModule]?.[lang] ?? p.conformityModule) : miss("conformityModule")}${
      p.conformityModule === "B_C" || p.conformityModule === "H" || p.conformityModule === "EUCC"
        ? `<br><b>${esc(L("Oznámený subjekt (název, číslo) a certifikát", "Notified body (name, number) and certificate"))}:</b> ${v("notifiedBody")}`
        : ""
    }</li>
<li><b>${esc(L("Doplňující informace", "Additional information"))}:</b> ${esc(L("Kategorie", "Category"))}: ${p.category ? esc(t.lbl(CRA_LABELS.category[p.category as keyof typeof CRA_LABELS.category])) : "—"}; ${esc(L("doba podpory do", "support period until"))}: ${esc(date(p.supportUntil) ?? "—")}${info.additionalInfo ? `<br>${nl(info.additionalInfo)}` : ""}</li>
</ol>
<p>${esc(L("Podepsáno za a jménem", "Signed for and on behalf of"))}: ${v("manufacturerName")}</p>
<table><tbody>
<tr><th style="width:30%">${esc(L("Místo a datum vydání", "Place and date of issue"))}</th><td>${v("signPlace")}, ${dateIssued ? esc(dateIssued) : miss("docIssuedAt")}</td></tr>
<tr><th>${esc(L("Jméno a funkce", "Name and function"))}</th><td>${v("signatoryName")}, ${v("signatoryFunction")}</td></tr>
<tr><th>${esc(L("Podpis", "Signature"))}</th><td style="height:48px"></td></tr>
</tbody></table>`;
  }

  if (kind === "doc_simplified") {
    body = `<h1>${esc(title)}</h1>${missingNote}
<p>${L(
      `${v("manufacturerName")} tímto prohlašuje, že typ produktu s digitálními prvky ${productLine} je v souladu s nařízením (EU) 2024/2847.`,
      `Hereby, ${v("manufacturerName")} declares that the product with digital elements type ${productLine} is in compliance with Regulation (EU) 2024/2847.`,
    )}</p>
<p>${esc(L("Úplné znění EU prohlášení o shodě je k dispozici na této internetové adrese:", "The full text of the EU declaration of conformity is available at the following internet address:"))} ${v("docUrl")}</p>`;
  }

  if (kind === "user_info") {
    const support = date(p.supportUntil);
    body = `<h1>${esc(title)}</h1>
<div class="muted">${productLine} · ${esc(L("podle přílohy II nařízení (EU) 2024/2847", "pursuant to Annex II of Regulation (EU) 2024/2847"))}</div>
${missingNote}
<h2>1. ${esc(L("Výrobce", "Manufacturer"))}</h2>
<p>${v("manufacturerName")}<br>${v("manufacturerAddress")}<br>${esc(L("E-mail", "E-mail"))}: ${v("manufacturerEmail")}${info.manufacturerWeb ? `<br>${esc(info.manufacturerWeb)}` : ""}</p>
<h2>2. ${esc(L("Hlášení zranitelností", "Reporting vulnerabilities"))}</h2>
<p>${esc(L("Kontaktní místo pro hlášení zranitelností", "Single point of contact for reporting vulnerabilities"))}: ${v("securityContact")}<br>${esc(L("Politika koordinovaného zveřejňování zranitelností", "Coordinated vulnerability disclosure policy"))}: ${v("cvdPolicyUrl")}</p>
<h2>3. ${esc(L("Identifikace produktu", "Product identification"))}</h2>
<p>${productLine} (${esc(ptype)})${info.identification ? `<br>${nl(info.identification)}` : ""}</p>
<h2>4. ${esc(L("Zamýšlený účel a bezpečnostní vlastnosti", "Intended purpose and security properties"))}</h2>
<p>${v("intendedPurpose", true)}</p><p>${v("securityProperties", true)}</p>
<h2>5. ${esc(L("Okolnosti, které mohou vést k významným rizikům", "Circumstances which may lead to significant cybersecurity risks"))}</h2>
<p>${v("foreseeableRisks", true)}</p>
${info.docUrl ? `<h2>6. ${esc(L("EU prohlášení o shodě", "EU declaration of conformity"))}</h2><p>${esc(info.docUrl)}</p>` : ""}
<h2>7. ${esc(L("Technická bezpečnostní podpora", "Technical security support"))}</h2>
<p>${v("supportType", true)}<br>${esc(L("Konec doby podpory", "End of the support period"))}: ${support ? `<b>${esc(support)}</b>` : miss("supportUntil")}</p>
<h2>8. ${esc(L("Pokyny", "Instructions"))}</h2>
<h3>a) ${esc(L("Bezpečné uvedení do provozu a používání", "Secure commissioning and use"))}</h3><p>${v("secureInstall", true)}</p>
<h3>b) ${esc(L("Vliv změn produktu na bezpečnost dat", "How changes to the product affect data security"))}</h3><p>${v("changesImpact", true)}</p>
<h3>c) ${esc(L("Instalace bezpečnostních aktualizací", "Installing security updates"))}</h3><p>${v("updateInstall", true)}</p>
<h3>d) ${esc(L("Bezpečné vyřazení z provozu a odstranění dat", "Secure decommissioning and removal of data"))}</h3><p>${v("decommission", true)}</p>
<h3>e) ${esc(L("Vypnutí automatických bezpečnostních aktualizací", "Turning off automatic security updates"))}</h3><p>${v("autoUpdateOff", true)}</p>
${info.integration ? `<h3>f) ${esc(L("Integrace do jiných produktů", "Integration into other products"))}</h3><p>${nl(info.integration)}</p>` : ""}
${info.sbomUrl ? `<h2>9. ${esc(L("Soupis softwarových komponent (SBOM)", "Software bill of materials (SBOM)"))}</h2><p>${esc(info.sbomUrl)}</p>` : ""}`;
  }

  if (kind === "tech_summary") {
    const reqs = craRequirementsFor(p.role as CraRole, (p.requirements ?? {}) as Record<string, CraReqState | undefined>);
    const st = (s: string) => esc(t.lbl(CRA_LABELS.reqStatus[s as keyof typeof CRA_LABELS.reqStatus] ?? s));
    const group = (g: "part1" | "part2" | "obligation") =>
      `<h3>${esc(t.lbl(CRA_LABELS.group[g]))}</h3><table><thead><tr><th style="width:18%">${esc(L("Ustanovení", "Provision"))}</th><th>${esc(L("Požadavek", "Requirement"))}</th><th style="width:14%">${esc(L("Stav", "Status"))}</th><th style="width:30%">${esc(L("Doklad / poznámka", "Evidence / note"))}</th></tr></thead><tbody>${reqs
        .filter((r) => r.group === g)
        .map((r) => `<tr><td>${esc(r.ref)}</td><td>${esc(t.lbl((CRA_LABELS.req as Record<string, string>)[r.key] ?? r.key))}</td><td>${st(r.status)}</td><td>${r.note ? nl(r.note) : ""}</td></tr>`)
        .join("")}</tbody></table>`;
    body = `<h1>${esc(title)}</h1>
<div class="muted">${productLine} · ${esc(L("podle přílohy VII nařízení (EU) 2024/2847", "pursuant to Annex VII of Regulation (EU) 2024/2847"))}</div>
${missingNote}
<h2>1. ${esc(L("Obecný popis produktu", "General description of the product"))}</h2>
<table><tbody>
<tr><th style="width:30%">${esc(L("Zamýšlený účel", "Intended purpose"))}</th><td>${v("intendedPurpose", true)}</td></tr>
<tr><th>${esc(L("Popis", "Description"))}</th><td>${v("description", true)}</td></tr>
<tr><th>${esc(L("Verze a identifikace", "Versions and identification"))}</th><td>${v("version")}${info.identification ? `<br>${nl(info.identification)}` : ""}</td></tr>
<tr><th>${esc(L("Kategorie", "Category"))}</th><td>${p.category ? esc(t.lbl(CRA_LABELS.category[p.category as keyof typeof CRA_LABELS.category])) : "—"}</td></tr>
<tr><th>${esc(L("Uživatelské informace (příloha II)", "User information (Annex II)"))}</th><td>${esc(L("generováno v CONTIXu – samostatný dokument", "generated in CONTIX – separate document"))}</td></tr>
</tbody></table>
<h2>2. ${esc(L("Návrh, vývoj a zvládání zranitelností", "Design, development and vulnerability handling"))}</h2>
<table><tbody>
<tr><th style="width:30%">SBOM</th><td>${esc(L(`${x.componentCount} komponent v evidenci`, `${x.componentCount} components recorded`))}${info.sbomUrl ? `; ${esc(info.sbomUrl)}` : ""}</td></tr>
<tr><th>${esc(L("Politika CVD", "CVD policy"))}</th><td>${v("cvdPolicyUrl")}</td></tr>
<tr><th>${esc(L("Kontakt pro zranitelnosti", "Vulnerability contact"))}</th><td>${v("securityContact")}</td></tr>
<tr><th>${esc(L("Distribuce aktualizací", "Update distribution"))}</th><td>${info.updateInstall ? nl(info.updateInstall) : "—"}</td></tr>
</tbody></table>
<h2>3. ${esc(L("Posouzení kybernetických rizik", "Cybersecurity risk assessment"))}</h2>
<p>${esc(L(`Navázaná rizika v registru rizik: ${x.linkedRisks}.`, `Linked risks in the risk register: ${x.linkedRisks}.`))}</p>
<h2>4. ${esc(L("Doba podpory", "Support period"))}</h2>
<p>${esc(L("Do", "Until"))}: ${esc(date(p.supportUntil) ?? "—")}${p.supportJustification ? `<br>${nl(p.supportJustification)}` : ""}</p>
<h2>5. ${esc(L("Normy a specifikace", "Standards and specifications"))}</h2>
<p>${p.harmonisedStandards ? nl(p.harmonisedStandards) : esc(L("nebyly použity – řešení základních požadavků je popsáno v bodě 7", "none applied – solutions to the essential requirements are described in point 7"))}</p>
<h2>6. ${esc(L("Posouzení shody a prohlášení", "Conformity assessment and declaration"))}</h2>
<p>${p.conformityModule ? esc(MODULE_TEXT[p.conformityModule]?.[lang] ?? p.conformityModule) : miss("conformityModule")}${p.notifiedBody ? `; ${esc(p.notifiedBody)}` : ""}<br>${esc(L("EU prohlášení o shodě vydáno", "EU declaration of conformity issued"))}: ${esc(date(p.docIssuedAt) ?? "—")}</p>
<h2>7. ${esc(L("Základní požadavky (příloha I) a povinnosti", "Essential requirements (Annex I) and obligations"))}</h2>
${group("part1")}${group("part2")}${group("obligation")}`;
  }

  return { title, html: printPage(`${title} – ${p.name}`, body, lang), missing };
}
