import { SOC2_DESCRIPTION_SECTIONS, SOC2_LABELS, type Soc2Category, type Soc2CriterionRow, type Soc2DetailDto } from "@contix/shared";
import { html as h } from "../documents/render";

/* ============================================================
 * Zpráva SOC 2 Type I / Type II (ADR-091) – vlastní texty CONTIXu (ne vzorová zpráva AICPA),
 * jen podmnožina HTML pro htmlToDocx (h1–h3, p, div, table, ul, b, br, span.muted/.small).
 * Auditor text zprávy v DMS / Wordu dále upraví – výstup je pracovní návrh.
 * ============================================================ */

type Lbl = (s: string) => string;

interface Txt {
  title: (type: string) => string;
  partI: string;
  partII: string;
  partIII: string;
  partIV: string;
  partV: string;
  draft: string;
  scopeH: string;
  scope: (p: P) => string;
  subH: string;
  sub: (names: string) => string;
  cuecH: string;
  cuec: string;
  orgRespH: string;
  orgResp: (p: P) => string;
  audRespH: string;
  audResp: (p: P) => string;
  limitsH: string;
  limits: string;
  testsH: string;
  tests: string;
  opinionH: string;
  opinion: Record<string, (p: P) => string>;
  basisH: string;
  useH: string;
  use: (p: P) => string;
  assertion: (p: P) => string;
  noCuec: string;
  cuecCol: [string, string];
  subCols: [string, string, string, string];
  matrixIntro: (p: P) => string;
  cols: [string, string, string];
  noControls: string;
  noTest: string;
  noExceptions: string;
  exception: string;
  mapped: string;
  responsesH: string;
  methods: Record<string, string>;
  population: (n: number, s: number) => string;
  signature: (p: P) => string;
}
interface P {
  org: string;
  system: string;
  auditor: string;
  when: string;
  categories: string;
  type2: boolean;
}

const CS: Txt = {
  title: (t) => `Zpráva ${t}`,
  partI: "Oddíl I – Zpráva nezávislého auditora",
  partII: "Oddíl II – Tvrzení vedení organizace poskytující služby",
  partIII: "Oddíl III – Popis systému",
  partIV: "Oddíl IV – Kritéria, kontroly, testy a výsledky",
  partV: "Oddíl V – Další informace poskytnuté vedením",
  draft: "Pracovní návrh zprávy vygenerovaný v CONTIXu – před vydáním jej auditor zkontroluje a upraví.",
  scopeH: "Rozsah",
  scope: (p) =>
    `Provedli jsme ověřovací zakázku týkající se popisu systému „${p.system}“ organizace ${p.org} ${p.when} (dále jen „popis“) a ${p.type2 ? "vhodnosti návrhu a provozní účinnosti" : "vhodnosti návrhu"} kontrol uvedených v popisu, které mají poskytnout přiměřenou jistotu, že závazky služby a systémové požadavky organizace budou splněny na základě kritérií důvěryhodných služeb (Trust Services Criteria) pro kategorie: ${p.categories}.`,
  subH: "Subdodavatelské organizace",
  sub: (n) => `Organizace využívá subdodavatelské organizace (${n}). Popis uvádí kontroly, u nichž organizace předpokládá jejich zavedení subdodavatelem (doplňkové kontroly subdodavatelských organizací). Naše ověření se na kontroly subdodavatelských organizací vyčleněných metodou carve-out nevztahuje.`,
  cuecH: "Doplňkové kontroly uživatelských organizací",
  cuec: "Popis uvádí, že některá kritéria lze splnit jen tehdy, pokud uživatelské organizace zavedou doplňkové kontroly předpokládané při návrhu kontrol organizace. Vhodnost návrhu ani účinnost těchto doplňkových kontrol jsme neověřovali.",
  orgRespH: "Odpovědnost organizace poskytující služby",
  orgResp: (p) =>
    `Vedení organizace ${p.org} odpovídá za sestavení popisu a tvrzení v oddílu II, za poskytování služeb, za stanovení závazků a systémových požadavků, za výběr kritérií a za návrh, zavedení${p.type2 ? " a provoz" : ""} účinných kontrol, které zajistí jejich splnění.`,
  audRespH: "Odpovědnost auditora",
  audResp: (p) =>
    `Naší odpovědností je vyjádřit na základě provedených postupů výrok k popisu a k ${p.type2 ? "vhodnosti návrhu a provozní účinnosti" : "vhodnosti návrhu"} kontrol. Ověření jsme provedli v souladu se standardy pro ověřovací zakázky platnými pro zprávy SOC 2. Tyto standardy vyžadují, abychom zakázku naplánovali a provedli tak, abychom získali přiměřenou jistotu, zda je popis ve všech významných ohledech uveden v souladu s kritérii popisu a zda kontroly byly vhodně navrženy${p.type2 ? " a účinně fungovaly" : ""}. Domníváme se, že získané důkazní informace jsou dostatečné a vhodné jako základ pro náš výrok.`,
  limitsH: "Přirozená omezení",
  limits:
    "Popis je sestaven tak, aby vyhověl společným potřebám širokého okruhu uživatelů, a nemusí proto zahrnovat každé hledisko systému, které může jednotlivý uživatel považovat za důležité. Kontroly mohou z povahy věci selhat; projekce hodnocení do budoucích období podléhá riziku, že se kontroly stanou nedostatečnými v důsledku změn podmínek nebo snížené míry jejich dodržování.",
  testsH: "Popis testů kontrol",
  tests: "Konkrétní kontroly, které jsme testovali, povaha, načasování a výsledky testů jsou uvedeny v oddílu IV.",
  opinionH: "Výrok",
  opinion: {
    unmodified: (p) =>
      `Podle našeho názoru, ve všech významných ohledech: a) popis věrně zobrazuje systém „${p.system}“, který byl navržen a zaveden ${p.when}; b) kontroly uvedené v popisu byly vhodně navrženy tak, aby poskytovaly přiměřenou jistotu splnění závazků služby a systémových požadavků na základě příslušných kritérií${p.type2 ? "; c) kontroly uvedené v popisu po celé sledované období účinně fungovaly a poskytovaly přiměřenou jistotu splnění závazků služby a systémových požadavků" : ""}.`,
    qualified: (p) =>
      `Podle našeho názoru, s výjimkou dopadu skutečností popsaných v odstavci Základ pro výrok s výhradou, ve všech významných ohledech popis věrně zobrazuje systém „${p.system}“ ${p.when} a kontroly byly vhodně navrženy${p.type2 ? " a účinně fungovaly" : ""} tak, aby poskytovaly přiměřenou jistotu splnění závazků služby a systémových požadavků na základě příslušných kritérií.`,
    adverse: (p) =>
      `Podle našeho názoru, vzhledem k významnosti skutečností popsaných v odstavci Základ pro záporný výrok, popis nezobrazuje věrně systém „${p.system}“ ${p.when} nebo kontroly nebyly vhodně navrženy${p.type2 ? " či účinně nefungovaly" : ""} tak, aby poskytovaly přiměřenou jistotu splnění závazků služby a systémových požadavků.`,
    disclaimer: () => "Vzhledem k významnosti skutečností popsaných v odstavci Základ pro odmítnutí výroku jsme nezískali dostatečné a vhodné důkazní informace, abychom mohli vyjádřit výrok. Výrok proto nevyjadřujeme.",
  },
  basisH: "Základ pro modifikovaný výrok",
  useH: "Omezení použití",
  use: (p) => `Zpráva včetně popisu testů kontrol a jejich výsledků je určena výhradně vedení organizace ${p.org}, uživatelským organizacím a dalším určeným stranám, které mají dostatečné znalosti o povaze služeb, systému a kritériích. Nesmí být použita jinými stranami.`,
  assertion: (p) =>
    `Sestavili jsme přiložený popis systému „${p.system}“ organizace ${p.org} ${p.when} podle kritérií popisu systému. Potvrzujeme, že podle našeho nejlepšího vědomí: a) popis věrně zobrazuje systém, který byl navržen a zaveden; b) kontroly uvedené v popisu byly vhodně navrženy tak, aby poskytovaly přiměřenou jistotu splnění našich závazků služby a systémových požadavků na základě kritérií důvěryhodných služeb pro kategorie: ${p.categories}${p.type2 ? "; c) kontroly uvedené v popisu po celé období účinně fungovaly" : ""}. Doplňkové kontroly uživatelských a subdodavatelských organizací uvedené v popisu jsou součástí předpokladů návrhu našich kontrol.`,
  noCuec: "Popis neuvádí doplňkové kontroly uživatelských organizací.",
  cuecCol: ["Doplňková kontrola uživatelské organizace", "Kritéria"],
  subCols: ["Subdodavatelská organizace", "Služby", "Metoda", "Předpokládané kontroly (CSOC)"],
  matrixIntro: (p) =>
    `Oddíl uvádí kritéria důvěryhodných služeb v rozsahu zprávy (ID a stručný popisek CONTIXu – plné znění kritérií viz publikace AICPA), kontroly organizace, které je pokrývají, ${p.type2 ? "testy provozní účinnosti provedené auditorem za sledované období a jejich výsledky" : "postupy ověření návrhu a zavedení kontrol"}. Odkazy na vyhlášku č. 409/2025 Sb. a ISO/IEC 27001:2022 jsou informativní.`,
  cols: ["Kontrola organizace", "Test auditora", "Výsledek testu"],
  noControls: "Kontrola není přiřazena.",
  noTest: "Test nebyl proveden.",
  noExceptions: "Bez výjimek.",
  exception: "Výjimka",
  mapped: "Vazba",
  responsesH: "Vyjádření vedení k výjimkám",
  methods: { inquiry: "dotazování", observation: "pozorování", inspection: "inspekce", reperformance: "opakované provedení" },
  population: (n, s) => `populace ${n}, vzorek ${s}`,
  signature: (p) => p.auditor,
};

const EN: Txt = {
  title: (t) => `${t} Report`,
  partI: "Section I – Independent Service Auditor's Report",
  partII: "Section II – Assertion of Service Organisation Management",
  partIII: "Section III – Description of the System",
  partIV: "Section IV – Criteria, Controls, Tests and Results",
  partV: "Section V – Other Information Provided by Management",
  draft: "Working draft generated in CONTIX – the auditor reviews and edits it before issuance.",
  scopeH: "Scope",
  scope: (p) =>
    `We have performed an assurance engagement on ${p.org}'s description of its "${p.system}" system ${p.when} (the "description") and the ${p.type2 ? "suitability of design and operating effectiveness" : "suitability of design"} of the controls stated in the description to provide reasonable assurance that the service organisation's commitments and system requirements were achieved based on the Trust Services Criteria for the categories: ${p.categories}.`,
  subH: "Subservice organisations",
  sub: (n) => `The organisation uses subservice organisations (${n}). The description presents the controls the organisation assumes the subservice organisations have implemented (complementary subservice organisation controls). Our examination did not extend to the controls of subservice organisations presented using the carve-out method.`,
  cuecH: "Complementary user entity controls",
  cuec: "The description indicates that certain criteria can be met only if user entities implement complementary controls assumed in the design of the organisation's controls. We have not evaluated the suitability of design or operating effectiveness of such complementary controls.",
  orgRespH: "Service organisation's responsibilities",
  orgResp: (p) =>
    `${p.org} management is responsible for preparing the description and the assertion in Section II, providing the services, identifying the commitments and system requirements, selecting the criteria, and designing, implementing${p.type2 ? " and operating" : ""} effective controls to achieve them.`,
  audRespH: "Service auditor's responsibilities",
  audResp: (p) =>
    `Our responsibility is to express an opinion, based on our procedures, on the description and on the ${p.type2 ? "suitability of design and operating effectiveness" : "suitability of design"} of the controls. We conducted our examination in accordance with the attestation standards applicable to SOC 2 reports. Those standards require that we plan and perform the examination to obtain reasonable assurance about whether the description is presented in accordance with the description criteria in all material respects and whether the controls were suitably designed${p.type2 ? " and operated effectively" : ""}. We believe the evidence obtained is sufficient and appropriate to provide a basis for our opinion.`,
  limitsH: "Inherent limitations",
  limits:
    "The description is prepared to meet the common needs of a broad range of users and may therefore not include every aspect of the system that an individual user may consider important. Controls may, by their nature, fail; projecting any evaluation to future periods is subject to the risk that controls become inadequate because of changes in conditions or reduced compliance.",
  testsH: "Description of tests of controls",
  tests: "The specific controls tested and the nature, timing and results of those tests are listed in Section IV.",
  opinionH: "Opinion",
  opinion: {
    unmodified: (p) =>
      `In our opinion, in all material respects: a) the description fairly presents the "${p.system}" system that was designed and implemented ${p.when}; b) the controls stated in the description were suitably designed to provide reasonable assurance that the service commitments and system requirements would be achieved based on the applicable criteria${p.type2 ? "; c) the controls stated in the description operated effectively throughout the period to provide reasonable assurance that the service commitments and system requirements were achieved" : ""}.`,
    qualified: (p) =>
      `In our opinion, except for the effects of the matters described in the Basis for qualified opinion paragraph, in all material respects the description fairly presents the "${p.system}" system ${p.when} and the controls were suitably designed${p.type2 ? " and operated effectively" : ""} to provide reasonable assurance that the service commitments and system requirements were achieved based on the applicable criteria.`,
    adverse: (p) =>
      `In our opinion, because of the significance of the matters described in the Basis for adverse opinion paragraph, the description does not fairly present the "${p.system}" system ${p.when} or the controls were not suitably designed${p.type2 ? " or did not operate effectively" : ""} to provide reasonable assurance that the service commitments and system requirements were achieved.`,
    disclaimer: () => "Because of the significance of the matters described in the Basis for disclaimer of opinion paragraph, we have not been able to obtain sufficient appropriate evidence to provide a basis for an opinion. Accordingly, we do not express an opinion.",
  },
  basisH: "Basis for modified opinion",
  useH: "Restricted use",
  use: (p) => `This report, including the description of tests of controls and results thereof, is intended solely for the information and use of ${p.org} management, user entities and other specified parties who have sufficient knowledge of the nature of the services, the system and the criteria. It is not intended to be used by anyone else.`,
  assertion: (p) =>
    `We have prepared the accompanying description of ${p.org}'s "${p.system}" system ${p.when} based on the description criteria. We confirm, to the best of our knowledge and belief, that: a) the description fairly presents the system that was designed and implemented; b) the controls stated in the description were suitably designed to provide reasonable assurance that our service commitments and system requirements would be achieved based on the Trust Services Criteria for the categories: ${p.categories}${p.type2 ? "; c) the controls stated in the description operated effectively throughout the period" : ""}. The complementary user entity and subservice organisation controls stated in the description are assumed in the design of our controls.`,
  noCuec: "The description does not identify complementary user entity controls.",
  cuecCol: ["Complementary user entity control", "Criteria"],
  subCols: ["Subservice organisation", "Services", "Method", "Assumed controls (CSOC)"],
  matrixIntro: (p) =>
    `This section lists the Trust Services Criteria in scope (ID and a short CONTIX caption – refer to the AICPA publication for the full criteria), the organisation's controls addressing them and ${p.type2 ? "the tests of operating effectiveness performed by the auditor over the period and their results" : "the procedures used to evaluate design and implementation"}. References to Decree No. 409/2025 Coll. and ISO/IEC 27001:2022 are informative.`,
  cols: ["Organisation's control", "Auditor's test", "Test result"],
  noControls: "No control assigned.",
  noTest: "Not tested.",
  noExceptions: "No exceptions noted.",
  exception: "Exception",
  mapped: "Mapping",
  responsesH: "Management's responses to exceptions",
  methods: { inquiry: "inquiry", observation: "observation", inspection: "inspection", reperformance: "reperformance" },
  population: (n, s) => `population ${n}, sample ${s}`,
  signature: (p) => p.auditor,
};

const listOrDash = (v: string[]) => (v.length ? v.join(", ") : "—");

function matrixRows(r: Soc2CriterionRow, x: Txt, lbl: Lbl): string {
  const { esc, nl } = h;
  if (!r.controls.length) return `<tr><td>${esc(x.noControls)}</td><td>—</td><td>—</td></tr>`;
  return r.controls
    .map((ctl) => {
      const tests = r.tests.filter((t) => t.controlId === ctl.id);
      const testCell = tests.length
        ? tests
            .map(
              (t) =>
                `${t.methods.map((m) => esc(x.methods[m] ?? m)).join(", ")}${t.procedure ? `: ${nl(t.procedure)}` : ""}${t.populationSize != null || t.samples ? `<br><span class="small">${esc(x.population(t.populationSize ?? 0, t.samples))}</span>` : ""}`,
            )
            .join("<br>")
        : esc(x.noTest);
      const exc = r.exceptions.filter((e) => !e.testId || tests.some((t) => t.id === e.testId));
      const resultCell = !tests.length
        ? "—"
        : exc.length
          ? exc.map((e) => `<b>${esc(x.exception)}${e.code ? ` ${esc(e.code)}` : ""}:</b> ${esc(e.title)}${e.description ? `<br>${nl(e.description)}` : ""}`).join("<br>")
          : tests.some((t) => t.failed > 0)
            ? `<b>${esc(x.exception)}:</b> ${tests.reduce((n, t) => n + t.failed, 0)} / ${tests.reduce((n, t) => n + t.samples, 0)}`
            : esc(x.noExceptions);
      void lbl;
      return `<tr><td><b>${esc(ctl.code ?? "")}</b> ${esc(ctl.name)}${ctl.description ? `<br>${nl(ctl.description)}` : ""}</td><td>${testCell}</td><td>${resultCell}</td></tr>`;
    })
    .join("");
}

/** Celá zpráva (HTML pro tisk i Word). */
export function soc2ReportBody(d: Soc2DetailDto, o: { org: string; locale: string; lbl: Lbl; fmtDay: (v: string | null) => string }): { title: string; body: string } {
  const x = o.locale === "en" ? EN : CS;
  const { esc, nl } = h;
  const type2 = d.reportType === "type2";
  const typeName = type2 ? "SOC 2 Type II" : "SOC 2 Type I";
  const org = d.serviceOrg?.trim() || o.org;
  const when =
    o.locale === "en"
      ? type2
        ? `throughout the period ${o.fmtDay(d.periodFrom)} to ${o.fmtDay(d.periodTo)}`
        : `as of ${o.fmtDay(d.asOf)}`
      : type2
        ? `za období od ${o.fmtDay(d.periodFrom)} do ${o.fmtDay(d.periodTo)}`
        : `ke dni ${o.fmtDay(d.asOf)}`;
  const p: P = { org, system: d.systemName || "—", auditor: d.serviceAuditor ?? "", when, categories: (["CC", ...d.categories.filter((c) => c !== "CC")] as Soc2Category[]).map((c) => o.lbl(SOC2_LABELS.category[c])).join(", "), type2 };
  const title = `${x.title(typeName)} – ${org}`;
  const sub = d.subservice.length ? `<h3>${esc(x.subH)}</h3><p>${esc(x.sub(d.subservice.map((s) => s.name).join(", ")))}</p>` : "";
  const cuec = d.cuecs.length ? `<h3>${esc(x.cuecH)}</h3><p>${esc(x.cuec)}</p>` : "";
  const basis = d.opinion !== "unmodified" && d.opinionBasis ? `<h3>${esc(x.basisH)}</h3><p>${nl(d.opinionBasis)}</p>` : "";
  const partI = `<h1>${esc(x.partI)}</h1>
<h3>${esc(x.scopeH)}</h3><p>${esc(x.scope(p))}</p>${sub}${cuec}
<h3>${esc(x.orgRespH)}</h3><p>${esc(x.orgResp(p))}</p>
<h3>${esc(x.audRespH)}</h3><p>${esc(x.audResp(p))}</p>
<h3>${esc(x.limitsH)}</h3><p>${esc(x.limits)}</p>
${type2 ? `<h3>${esc(x.testsH)}</h3><p>${esc(x.tests)}</p>` : ""}
${basis}
<h3>${esc(x.opinionH)}</h3><p>${esc(x.opinion[d.opinion]!(p))}</p>
<h3>${esc(x.useH)}</h3><p>${esc(x.use(p))}</p>
<p>${esc(d.reportPlace ?? "")}${d.reportPlace ? ", " : ""}${esc(o.fmtDay(d.reportDate))}<br><b>${esc(d.serviceAuditor ?? "")}</b><br>${esc(d.signatory ?? "")}</p>`;
  const partII = `<h1>${esc(x.partII)}</h1><p>${d.assertion?.trim() ? nl(d.assertion) : esc(x.assertion(p))}</p><p><b>${esc(org)}</b></p>`;
  const sections = SOC2_DESCRIPTION_SECTIONS.filter((k) => d.description[k]?.trim())
    .map((k) => `<h2>${esc(o.lbl(SOC2_LABELS.section[k]))}</h2><p>${nl(d.description[k]!)}</p>`)
    .join("");
  const cuecTable = d.cuecs.length
    ? `<table><thead><tr><th>${esc(x.cuecCol[0])}</th><th>${esc(x.cuecCol[1])}</th></tr></thead><tbody>${d.cuecs.map((c) => `<tr><td>${nl(c.text)}</td><td>${esc(listOrDash(c.criteria))}</td></tr>`).join("")}</tbody></table>`
    : `<p>${esc(x.noCuec)}</p>`;
  const subTable = d.subservice.length
    ? `<h2>${esc(x.subH)}</h2><table><thead><tr>${x.subCols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${d.subservice
        .map((s) => `<tr><td>${esc(s.name)}</td><td>${nl(s.services)}</td><td>${esc(o.lbl(SOC2_LABELS.method[s.method]))}</td><td>${s.csocs.map((c) => `${nl(c.text)}${c.criteria.length ? ` <span class="small">(${esc(c.criteria.join(", "))})</span>` : ""}`).join("<br>") || "—"}</td></tr>`)
        .join("")}</tbody></table>`
    : "";
  const partIII = `<h1>${esc(x.partIII)}</h1>${sections}<h2>${esc(x.cuecH)}</h2>${cuecTable}${subTable}`;
  const matrix = d.criteria
    .filter((r) => r.workpaper.conclusion !== "na")
    .map(
      (r) => `<h3>${esc(r.id)} – ${esc(o.lbl(r.label))}</h3>
<div class="muted small">${esc(x.mapped)}: ${esc(listOrDash(r.cz409))} · ISO 27001: ${esc(listOrDash(r.iso))}</div>
<table><thead><tr>${x.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${matrixRows(r, x, o.lbl)}</tbody></table>`,
    )
    .join("");
  const partIV = `<h1>${esc(x.partIV)}</h1><p>${esc(x.matrixIntro(p))}</p>${matrix}`;
  const responses = d.criteria.flatMap((r) => r.exceptions.filter((e) => e.managementResponse?.trim()).map((e) => ({ r, e })));
  const partV =
    d.otherInfo?.trim() || responses.length
      ? `<h1>${esc(x.partV)}</h1>${d.otherInfo?.trim() ? `<p>${nl(d.otherInfo)}</p>` : ""}${
          responses.length
            ? `<h2>${esc(x.responsesH)}</h2>${responses.map(({ r, e }) => `<p><b>${esc(r.id)}${e.code ? ` · ${esc(e.code)}` : ""} – ${esc(e.title)}</b><br>${nl(e.managementResponse!)}</p>`).join("")}`
            : ""
        }`
      : "";
  const body = `<div class="muted small">${esc(org)} · ${esc(d.systemName)}</div>
<h1>${esc(title)}</h1>
<div class="muted">${esc(o.lbl(SOC2_LABELS.reportType[d.reportType]))} · ${esc(when)}</div>
<p class="small muted">${esc(x.draft)}</p>
${partI}${partII}${partIII}${partIV}${partV}`;
  return { title, body };
}
