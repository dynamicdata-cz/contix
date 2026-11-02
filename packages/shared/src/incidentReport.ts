import type { Settings } from "./auth";
import type { Translate } from "./i18n";
import { INCIDENT_LABELS, type IncidentDetail, type IncidentRegime, type ReportRecipient, type ReportType } from "./incidents";
import { doraAuthorityOf, profileOf } from "./regulatory";

/** Právní základ hlášení podle pravidel společnosti (ADR-086). */
export function incidentLegalBasis(regime: IncidentRegime, legalRef: string | null): string {
  if (regime === "dora") return "čl. 19 nařízení (EU) 2022/2554 (DORA), nařízení v přenesené pravomoci (EU) 2025/301 a prováděcí nařízení (EU) 2025/302";
  if (regime === "nis2") return legalRef ? `${legalRef}, čl. 23 směrnice (EU) 2022/2555 (NIS2)` : "čl. 23 směrnice (EU) 2022/2555 (NIS2)";
  if (regime === "none") return "";
  return "§ 15 a 16 zákona č. 264/2025 Sb.";
}

/* ============================================================
 * Hlášení incidentu NÚKIB / ÚOOÚ (v0.72, ADR-067): předvyplněné hlášení podle druhu (prvotní, oznámení,
 * průběžná, závěrečná zpráva, dobrovolné, ohlášení GDPR) z evidence incidentu, nastavení organizace a SOC.
 * Kontrola úplnosti (povinná pole), text k vložení do Portálu Úřadu / e-mailu; obsah podaného hlášení se uloží
 * k záznamu o podání. Hlášení se nikdy neodesílá automaticky.
 * ============================================================ */

export interface ReportField {
  key: string;
  label: string;
  value: string;
  required: boolean;
  /** Odkud hodnota je – kde ji doplnit. */
  source: "organization" | "incident" | "soc";
}
export interface ReportSection {
  key: string;
  title: string;
  fields: ReportField[];
}
export interface IncidentReportDraft {
  type: ReportType;
  title: string;
  recipient: ReportRecipient;
  /** Adresát slovy – u DORA konkrétní orgán dohledu (ČNB…). */
  recipientName: string;
  /** Právní základ hlášení podle pravidel společnosti. */
  legalBasis: string;
  sections: ReportSection[];
  /** Nevyplněná povinná pole. */
  missing: { section: string; key: string; label: string; source: ReportField["source"] }[];
  /** Prostý text hlášení (k vložení / e-mailu). */
  text: string;
  due: string | null;
  generatedAt: string;
}

export interface ReportSocInput {
  alerts: number;
  techniques: string[];
  iocs: string[];
  firstSeen: string | null;
}

/** Která pole jsou pro daný druh hlášení povinná. */
const REQUIRED: Record<ReportType, string[]> = {
  initial: ["orgName", "orgIco", "service", "contact", "detectedAt", "description", "suspectedUnlawful", "crossBorder"],
  voluntary: ["orgName", "contact", "detectedAt", "description"],
  notification: ["orgName", "orgIco", "service", "contact", "detectedAt", "description", "suspectedUnlawful", "crossBorder", "impact", "significance", "containment"],
  interim: ["orgName", "contact", "description", "impact", "containment"],
  final: ["orgName", "orgIco", "service", "contact", "detectedAt", "description", "impact", "significance", "containment", "cause", "lessons", "resolvedAt", "crossBorder"],
  gdpr: ["orgName", "orgIco", "contact", "detectedAt", "description", "affectedUsers", "impact", "containment"],
};
/** DORA (prováděcí nařízení 2025/302): finanční subjekt se identifikuje kódem LEI; závěrečná zpráva vyžaduje i hospodářský dopad. */
const REQUIRED_DORA: Partial<Record<ReportType, string[]>> = {
  initial: ["lei", "doraClients", "doraCritical"],
  interim: ["lei", "doraClients", "doraDuration"],
  final: ["lei", "doraClients", "doraDuration", "doraEconomic"],
};

export function buildIncidentReport(
  d: IncidentDetail,
  s: Settings & { incidentContact?: { name: string; role: string; phone: string; email: string } },
  type: ReportType,
  soc: ReportSocInput | null,
  t: Translate,
  now = new Date(),
  extra: { lei?: string | null } = {},
): IncidentReportDraft {
  const L = INCIDENT_LABELS;
  const loc = t.locale === "cs" ? "cs-CZ" : t.locale;
  const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }) : "");
  const yn = (v: boolean) => t(v ? "srv.inc.yes" : "srv.inc.no");
  const profile = profileOf(s);
  const dora = d.regime === "dora" && type !== "gdpr" && type !== "voluntary";
  const req = new Set([...REQUIRED[type], ...(dora ? (REQUIRED_DORA[type] ?? []) : [])]);
  const legalBasis = type === "gdpr" ? "čl. 33 nařízení (EU) 2016/679 (GDPR)" : incidentLegalBasis(d.regime, profile.incidentLegalRef);
  const f = (key: string, label: string, value: string | null | undefined, source: ReportField["source"] = "incident"): ReportField => ({ key, label, value: (value ?? "").trim(), required: req.has(key), source });
  const c = s.incidentContact ?? { name: "", role: "", phone: "", email: "" };
  const contact = [c.name, c.role, c.phone, c.email].filter((x) => x?.trim()).join(", ");
  const sections: ReportSection[] = [
    {
      key: "ident",
      title: t("srv.inc.hIdent"),
      fields: [
        ...(legalBasis ? [f("legal", t("srv.rep.legalBasis"), legalBasis, "organization")] : []),
        f("orgName", t("srv.inc.orgName"), s.organizationName, "organization"),
        f("orgIco", t("srv.inc.orgIco"), s.organizationIco, "organization"),
        ...(dora ? [f("lei", t("srv.rep.lei"), extra.lei, "organization")] : []),
        f("orgAddress", t("srv.inc.orgAddress"), s.organizationAddress, "organization"),
        f("service", t("srv.inc.regulatedService"), s.regulatedServices, "organization"),
        f("contact", t("srv.rep.contact"), contact, "organization"),
      ],
    },
    {
      key: "basic",
      title: t("srv.inc.hBasic"),
      fields: [
        f("designation", t("srv.inc.designation"), `${d.code ?? ""} ${d.title}`.trim()),
        f("detectedAt", t("srv.inc.detectedAt"), dt(d.detectedAt)),
        f("occurredAt", t("srv.inc.occurredAt"), dt(d.occurredAt)),
        f("category", t("srv.inc.category"), t.lbl(L.category[d.category])),
        f("description", t("srv.inc.description"), d.description),
        f("assets", t("srv.inc.affectedAssets"), d.assets.map((a) => a.name).join(", ")),
        f("suspectedUnlawful", t("srv.inc.suspectedUnlawful"), yn(d.suspectedUnlawful)),
        f("crossBorder", t("srv.inc.crossBorder"), yn(d.crossBorder)),
      ],
    },
  ];
  if (type !== "initial" && type !== "voluntary")
    sections.push({
      key: "assess",
      title: t("srv.inc.hAssess"),
      fields: [
        f("impact", t("srv.inc.impact"), d.impactDescription),
        f("affectedUsers", t(type === "gdpr" ? "srv.rep.dataSubjects" : "srv.inc.affectedUsers"), d.affectedUsers == null ? "" : String(d.affectedUsers)),
        f("downtime", t("srv.inc.downtime"), d.downtimeHours == null ? "" : String(d.downtimeHours)),
        f("significance", t("srv.inc.significance"), d.kind === "unassessed" ? "" : `${t(d.significant ? "srv.inc.significant" : "srv.inc.notSignificant")}${d.significanceNote ? ` – ${d.significanceNote}` : ""}`),
        f("containment", t("srv.inc.containment"), d.containment),
        f("indicators", t("srv.inc.indicators"), [d.indicators, soc?.iocs.length ? soc.iocs.join(", ") : null].filter(Boolean).join("\n")),
      ],
    });
  // DORA: klasifikační kritéria závažného incidentu IKT (nařízení v přenesené pravomoci (EU) 2024/1772, čl. 1–8)
  if (dora)
    sections.push({
      key: "dora",
      title: t("srv.rep.hDora"),
      fields: [
        f("doraClients", t("srv.rep.doraClients"), d.affectedUsers == null ? "" : String(d.affectedUsers)),
        f("doraCritical", t("srv.rep.doraCritical"), d.processes.map((p) => `${p.code ? `${p.code} ` : ""}${p.name}`).join(", ") || d.assets.map((a) => a.name).join(", ")),
        f("doraDuration", t("srv.rep.doraDuration"), d.downtimeHours == null ? "" : String(d.downtimeHours)),
        f("doraData", t("srv.rep.doraData"), yn(d.personalDataBreach)),
        f("doraSpread", t("srv.rep.doraSpread"), yn(d.crossBorder)),
        f("doraEconomic", t("srv.rep.doraEconomic"), d.financialLoss == null ? "" : String(d.financialLoss)),
      ],
    });
  if (soc && soc.alerts > 0)
    sections.push({
      key: "soc",
      title: t("srv.rep.hSoc"),
      fields: [
        { key: "socAlerts", label: t("srv.rep.socAlerts"), value: String(soc.alerts), required: false, source: "soc" },
        { key: "socFirst", label: t("srv.rep.socFirst"), value: dt(soc.firstSeen), required: false, source: "soc" },
        { key: "socTechniques", label: t("srv.rep.socTechniques"), value: soc.techniques.join(", "), required: false, source: "soc" },
      ],
    });
  if (type === "final")
    sections.push({
      key: "final",
      title: t("srv.inc.hFinal"),
      fields: [
        f("resolvedAt", t("srv.inc.resolvedAt"), dt(d.resolvedAt)),
        f("cause", t("srv.inc.cause"), d.cause === "unknown" && !d.rootCause ? "" : `${t.lbl(L.cause[d.cause])}${d.rootCause ? ` – ${d.rootCause}` : ""}`),
        f("lessons", t("srv.inc.lessons"), d.lessonsLearned),
        f("financialLoss", t("srv.inc.financialLoss"), d.financialLoss == null ? "" : String(d.financialLoss)),
      ],
    });
  const missing = sections.flatMap((sec) => sec.fields.filter((x) => x.required && !x.value).map((x) => ({ section: sec.key, key: x.key, label: x.label, source: x.source })));
  const title = dora && (type === "initial" || type === "interim" || type === "final") ? t(`srv.rep.dora.${type}`) : t.lbl(L.reportType[type]);
  const recipient: ReportRecipient = type === "gdpr" ? "uoou" : d.recipient;
  const recipientName = recipient === "financial_supervisor" ? doraAuthorityOf(profile) : t.lbl(L.recipient[recipient]);
  const text = [
    `${title} – ${recipientName}`,
    ...(legalBasis ? [legalBasis] : []),
    "",
    ...sections.flatMap((sec) => [`== ${sec.title} ==`, ...sec.fields.filter((x) => x.value).map((x) => `${x.label}: ${x.value}`), ""]),
    t("srv.rep.textFooter", { date: dt(now.toISOString()) }),
  ].join("\n");
  return { type, title, recipient, recipientName, legalBasis, sections, missing, text, due: d.deadlines.find((x) => x.type === type)?.due ?? null, generatedAt: now.toISOString() };
}
