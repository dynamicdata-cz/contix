import { z } from "zod";
import { patchOf } from "./zutil";

/* ============================================================
 * Kybernetické bezpečnostní události a incidenty
 *  - § 14 vyhl. č. 409/2025 Sb. (zvládání událostí a incidentů), § 10 a § 14 vyhl. č. 410/2025 Sb.,
 *  - hlášení § 15 a § 16 zákona č. 264/2025 Sb. (prvotní hlášení 24 h, oznámení 72 h, závěrečná zpráva 30 dnů),
 *  - porušení zabezpečení osobních údajů – čl. 33 GDPR (ohlášení ÚOOÚ do 72 h).
 * ============================================================ */

export const INCIDENT_KINDS = ["unassessed", "event", "incident"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ["new", "assessing", "handling", "resolved", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_CATEGORIES = [
  "malware",
  "ransomware",
  "phishing",
  "unauthorized_access",
  "account_compromise",
  "dos",
  "data_leak",
  "vulnerability_exploit",
  "misconfiguration",
  "hw_failure",
  "physical",
  "supplier",
  "other",
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

/** Přímá příčina (§ 14 odst. 1 písm. b) bod 6 vyhl. 410/2025). */
export const INCIDENT_CAUSES = ["unknown", "human_error", "technical_failure", "intentional"] as const;
export type IncidentCause = (typeof INCIDENT_CAUSES)[number];

export const AUTHORITY_DECISIONS = ["pending", "significant", "not_significant"] as const;
export type AuthorityDecision = (typeof AUTHORITY_DECISIONS)[number];

export const REPORT_TYPES = ["initial", "notification", "interim", "final", "voluntary", "gdpr"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_RECIPIENTS = ["nukib", "national_cert", "uoou", "financial_supervisor", "other"] as const;
export type ReportRecipient = (typeof REPORT_RECIPIENTS)[number];
export const REPORT_CHANNELS = ["portal", "email", "data_box", "other"] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];

/** Oblasti posouzení významnosti dopadu (§ 14 odst. 1 písm. b) vyhl. 410/2025). */
export const SIGNIFICANCE_AREAS = [
  { key: "operational", label: "Provozní dopad a schopnost poskytovat regulovanou službu" },
  { key: "users", label: "Množství zasažených uživatelů regulované služby a jiných orgánů a osob" },
  { key: "recovery", label: "Časové, lidské a technické zdroje potřebné k obnově poskytování služby" },
  { key: "assets", label: "Typ a umístění dotčených aktiv" },
  { key: "data", label: "Citlivost zasažených informací a dat a možná újma z jejich narušení" },
  { key: "cause", label: "Přímá příčina (lidská chyba, technická závada, úmyslné jednání)" },
] as const;

export const INCIDENT_LABELS = {
  kind: { unassessed: "Neposouzeno", event: "Událost", incident: "Incident" } satisfies Record<IncidentKind, string>,
  status: { new: "Nahlášeno", assessing: "Posuzuje se", handling: "Řeší se", resolved: "Vyřešeno", closed: "Uzavřeno" } satisfies Record<IncidentStatus, string>,
  category: {
    malware: "Škodlivý kód",
    ransomware: "Ransomware",
    phishing: "Phishing / sociální inženýrství",
    unauthorized_access: "Neoprávněný přístup",
    account_compromise: "Kompromitace účtu",
    dos: "Odepření služby (DoS/DDoS)",
    data_leak: "Únik nebo neoprávněné zpřístupnění dat",
    vulnerability_exploit: "Zneužití zranitelnosti",
    misconfiguration: "Chybná konfigurace",
    hw_failure: "Selhání HW / infrastruktury",
    physical: "Fyzická událost",
    supplier: "Incident u dodavatele",
    other: "Jiné",
  } satisfies Record<IncidentCategory, string>,
  cause: { unknown: "Neznámá", human_error: "Lidská chyba", technical_failure: "Technická závada", intentional: "Úmyslné jednání" } satisfies Record<IncidentCause, string>,
  authority: {
    pending: "Čeká se na sdělení Úřadu",
    significant: "Významný dopad na kybernetický prostor státu",
    not_significant: "Bez významného dopadu na kybernetický prostor státu",
  } satisfies Record<AuthorityDecision, string>,
  reportType: {
    initial: "Prvotní hlášení (§ 16 odst. 1)",
    notification: "Oznámení (§ 16 odst. 3 písm. a)",
    interim: "Průběžná zpráva (§ 16 odst. 3 písm. b, c)",
    final: "Závěrečná zpráva (§ 16 odst. 3 písm. c)",
    voluntary: "Dobrovolné hlášení (§ 15 odst. 5)",
    gdpr: "Ohlášení porušení zabezpečení OÚ (čl. 33 GDPR)",
  } satisfies Record<ReportType, string>,
  recipient: { nukib: "NÚKIB (Úřad)", national_cert: "Národní CERT", uoou: "ÚOOÚ", financial_supervisor: "Orgán dohledu nad finančním trhem (DORA)", other: "Jiný" } satisfies Record<ReportRecipient, string>,
  channel: { portal: "Portál Úřadu", email: "E-mail", data_box: "Datová schránka", other: "Jinak" } satisfies Record<ReportChannel, string>,
} as const;

const text = (max = 10000) => z.string().trim().max(max).optional().nullable();
const ts = z.string().datetime({ offset: true }).nullable().optional();
const ids = z.array(z.string().uuid()).default([]);

export const TimelineEntry = z.object({ at: z.string().datetime({ offset: true }), text: z.string().trim().min(1).max(2000) });
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const IncidentInput = z.object({
  /** Společnost skupiny, do které záznam patří (výchozí = aktivní společnost). */
  companyId: z.string().uuid().optional(),
  code: z.string().trim().max(50).optional().nullable(),
  title: z.string().trim().min(1).max(300),
  description: text(),
  kind: z.enum(INCIDENT_KINDS).default("unassessed"),
  status: z.enum(INCIDENT_STATUSES).default("new"),
  category: z.enum(INCIDENT_CATEGORIES).default("other"),
  cause: z.enum(INCIDENT_CAUSES).default("unknown"),
  reportedBy: text(200),
  ownerPositionId: z.string().uuid().nullable().optional(),
  /** Okamžik zjištění – od něj běží lhůty § 16 zákona. */
  detectedAt: z.string().datetime({ offset: true }),
  occurredAt: ts,
  resolvedAt: ts,
  /** Kritéria hlášení § 15 zákona. */
  inScope: z.boolean().default(true),
  cyberOrigin: z.boolean().default(true),
  /** Úmyslné zavinění lze ve lhůtě 24 h vyloučit → hlášení není povinné. */
  intentExcluded: z.boolean().default(false),
  /** Významnost dopadu (§ 15 odst. 3 zákona, § 14 vyhl. 410/2025). */
  toleranceExceeded: z.boolean().default(false),
  significanceAreas: z.record(z.string(), z.boolean()).default({}),
  significanceNote: text(),
  /** § 16 odst. 2 – sdělení Úřadu o významném dopadu na kybernetický prostor státu (režim vyšších povinností). */
  authorityDecision: z.enum(AUTHORITY_DECISIONS).default("pending"),
  /** Údaje prvotního hlášení § 16 odst. 1. */
  suspectedUnlawful: z.boolean().default(false),
  crossBorder: z.boolean().default(false),
  /** Porušení zabezpečení osobních údajů (čl. 33 GDPR). */
  personalDataBreach: z.boolean().default(false),
  /** Dopad. */
  affectedUsers: z.number().int().min(0).nullable().optional(),
  downtimeHours: z.number().min(0).nullable().optional(),
  financialLoss: z.number().min(0).nullable().optional(),
  impactDescription: text(),
  indicators: text(),
  /** § 14 odst. 1 písm. d) – věrohodné podklady (důkazy) a jejich uložení. */
  evidence: text(),
  /** § 14 odst. 1 písm. i) – opatření k odvrácení a zmírnění dopadu. */
  containment: text(),
  /** § 14 odst. 1 písm. k) – příčina. */
  rootCause: text(),
  /** § 14 odst. 1 písm. n) – vyhodnocení účinnosti řešení a opatření proti opakování. */
  lessonsLearned: text(),
  timeline: z.array(TimelineEntry).max(500).default([]),
  assetIds: ids,
  processIds: ids,
  riskIds: ids,
  controlIds: ids,
  supplierIds: ids,
});
export type IncidentInput = z.input<typeof IncidentInput>;
export const IncidentPatch = patchOf(IncidentInput.omit({ companyId: true }));

export const IncidentReportInput = z.object({
  reportType: z.enum(REPORT_TYPES),
  recipient: z.enum(REPORT_RECIPIENTS).default("nukib"),
  channel: z.enum(REPORT_CHANNELS).default("portal"),
  submittedAt: z.string().datetime({ offset: true }),
  reference: text(200),
  summary: text(),
});
export type IncidentReportInput = z.input<typeof IncidentReportInput>;

export interface IncidentReportDto {
  id: string;
  reportType: ReportType;
  recipient: ReportRecipient;
  channel: ReportChannel;
  submittedAt: string;
  reference: string | null;
  summary: string | null;
  createdByName: string | null;
}

export type DeadlineState = "done" | "overdue" | "pending" | "waiting";
export interface IncidentDeadline {
  type: ReportType;
  label: string;
  legal: string;
  /** Termín (ISO) – null, pokud zatím nelze určit. */
  due: string | null;
  state: DeadlineState;
  submittedAt: string | null;
  note?: string;
}

export interface IncidentListItem {
  id: string;
  companyId: string;
  code: string | null;
  title: string;
  kind: IncidentKind;
  status: IncidentStatus;
  category: IncidentCategory;
  detectedAt: string;
  resolvedAt: string | null;
  ownerPositionName: string | null;
  reportable: boolean;
  significant: boolean;
  personalDataBreach: boolean;
  /** Nejbližší nesplněná lhůta hlášení. */
  nextDeadline: IncidentDeadline | null;
  overdueReports: number;
  assetCount: number;
  /** Názvy dotčených aktiv (nejvýše 5) – filtr a seskupení v seznamu. */
  assetNames: string[];
  cause: IncidentCause;
  updatedAt: string;
}

export interface IncidentDetail extends IncidentListItem {
  description: string | null;
  cause: IncidentCause;
  reportedBy: string | null;
  ownerPositionId: string | null;
  occurredAt: string | null;
  inScope: boolean;
  cyberOrigin: boolean;
  intentExcluded: boolean;
  toleranceExceeded: boolean;
  significanceAreas: Record<string, boolean>;
  significanceNote: string | null;
  authorityDecision: AuthorityDecision;
  suspectedUnlawful: boolean;
  crossBorder: boolean;
  affectedUsers: number | null;
  downtimeHours: number | null;
  financialLoss: number | null;
  impactDescription: string | null;
  indicators: string | null;
  evidence: string | null;
  containment: string | null;
  rootCause: string | null;
  lessonsLearned: string | null;
  timeline: TimelineEntry[];
  reports: IncidentReportDto[];
  deadlines: IncidentDeadline[];
  /** Kroky § 14 vyhl. 409, které u incidentu chybějí. */
  gaps: string[];
  recipient: ReportRecipient;
  /** Pravidla hlášení z regulatorního profilu (ADR-081): CZ vyšší / nižší / neregulovaná, nebo obecná pravidla EU NIS2. */
  regime: IncidentRegime;
  /** Únosná míra újmy stanovená organizací (z nastavení). */
  tolerance: string;
  assets: { id: string; name: string; assetType: string }[];
  processes: { id: string; code: string | null; name: string }[];
  risks: { id: string; code: string | null; name: string; level: string | null }[];
  controls: { id: string; code: string | null; name: string }[];
  suppliers: { id: string; name: string; significant: boolean }[];
  createdByName: string | null;
  createdAt: string;
  canEdit: boolean;
}

/** Pravidla hlášení: český zákon (vyšší / nižší povinnosti), bez povinnosti, nebo obecně čl. 23 NIS2 (balíček bez národního předpisu). */
export type IncidentRegime = "higher" | "lower" | "none" | "nis2" | "dora";
type Regime = IncidentRegime;

/** Významný dopad = překročena únosná míra újmy a současně je některá oblast posouzena jako významná (§ 14 odst. 2 vyhl. 410). */
export function isSignificant(i: { toleranceExceeded: boolean; significanceAreas: Record<string, boolean> }) {
  return i.toleranceExceeded && Object.values(i.significanceAreas).some(Boolean);
}

/** Povinnost hlásit podle § 15 zákona. */
export function isReportable(i: { kind: IncidentKind; inScope: boolean; cyberOrigin: boolean; intentExcluded: boolean; toleranceExceeded: boolean; significanceAreas: Record<string, boolean> }, regime: Regime) {
  if (regime === "none" || i.kind !== "incident") return false;
  const base = i.inScope && i.cyberOrigin && !i.intentExcluded;
  // NIS2 čl. 23 / DORA čl. 19: hlásí se jen významný (závažný) incident – stejně jako nižší povinnosti v CZ
  return regime === "higher" ? base : base && isSignificant(i);
}

const H = 3600_000;
/** + 1 kalendářní měsíc (lhůty NIS2). */
const addMonth = (t: number) => {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.getTime();
};
const D = 24 * H;
const iso = (t: number) => new Date(t).toISOString();

/**
 * Lhůty hlášení podle § 16 zákona č. 264/2025 Sb. (+ čl. 33 GDPR).
 * `trustService` = poskytovatel služeb vytvářejících důvěru (oznámení do 24 h).
 */
export function incidentDeadlines(
  i: {
    kind: IncidentKind;
    inScope: boolean;
    cyberOrigin: boolean;
    intentExcluded: boolean;
    toleranceExceeded: boolean;
    significanceAreas: Record<string, boolean>;
    authorityDecision: AuthorityDecision;
    personalDataBreach: boolean;
    detectedAt: string;
    resolvedAt: string | null;
  },
  reports: { reportType: ReportType; submittedAt: string }[],
  regime: Regime,
  opts: { trustService?: boolean; now?: Date; legalRef?: string | null } = {},
): IncidentDeadline[] {
  const now = (opts.now ?? new Date()).getTime();
  const det = new Date(i.detectedAt).getTime();
  const first = (t: ReportType) =>
    reports
      .filter((r) => r.reportType === t)
      .map((r) => r.submittedAt)
      .sort()[0] ?? null;
  const mk = (type: ReportType, label: string, legal: string, due: number | null, extra: Partial<IncidentDeadline> = {}): IncidentDeadline => {
    const sub = first(type);
    const state: DeadlineState = sub ? "done" : due == null ? "waiting" : now > due ? "overdue" : "pending";
    return { type, label, legal, due: due == null ? null : iso(due), state, submittedAt: sub, ...extra };
  };
  const out: IncidentDeadline[] = [];
  if (regime === "dora" && isReportable(i, regime)) {
    // DORA čl. 19 + nařízení v přenesené pravomoci (EU) 2025/301 čl. 5: závažný incident související s IKT
    out.push(
      mk("initial", "Prvotní oznámení závažného incidentu IKT", "čl. 19 odst. 4 písm. a) DORA, čl. 5 nař. 2025/301 – do 4 h od klasifikace jako závažného, nejpozději do 24 h od zjištění", det + 24 * H, {
        note: "Lhůta 4 h běží od klasifikace incidentu jako závažného (kritéria nař. 2024/1772); zde je uvedena nejzazší lhůta 24 h od zjištění.",
      }),
    );
    const initial = first("initial");
    if (!initial) out.push(mk("interim", "Průběžná zpráva", "čl. 5 odst. 1 písm. b) nař. 2025/301 – do 72 h od prvotního oznámení", null, { note: "Lhůta poběží od podání prvotního oznámení." }));
    else out.push(mk("interim", "Průběžná zpráva", "čl. 5 odst. 1 písm. b) nař. 2025/301 – do 72 h od prvotního oznámení (a aktualizace po obnovení běžné činnosti)", new Date(initial).getTime() + 72 * H));
    const interim = reports.filter((r) => r.reportType === "interim").map((r) => r.submittedAt).sort().at(-1) ?? null;
    out.push(
      mk("final", "Závěrečná zpráva", "čl. 5 odst. 1 písm. c) nař. 2025/301 – do 1 měsíce od poslední průběžné zprávy", interim ? addMonth(new Date(interim).getTime()) : null,
        interim ? {} : { note: "Lhůta poběží od poslední průběžné zprávy." }),
    );
  }
  if (regime === "nis2" && isReportable(i, regime)) {
    // národní zákon balíčku (SK § 24, DE § 32 BSIG…) + odkaz na čl. 23 odst. 4 NIS2
    const ref = (l: string) => (opts.legalRef ? `${opts.legalRef}, čl. 23 odst. 4 písm. ${l}) NIS2` : `čl. 23 odst. 4 písm. ${l}) NIS2`);
    // směrnice (EU) 2022/2555, čl. 23 odst. 4 – vnitrostátní transpozice může lhůty upřesnit (ověřte u příslušného CSIRT / orgánu)
    out.push(mk("initial", "Včasné varování", `${ref("a")} – do 24 h od zjištění významného incidentu`, det + 24 * H));
    const hours = opts.trustService ? 24 : 72;
    out.push(mk("notification", "Oznámení incidentu s prvotním posouzením, závažností, dopadem a IoC", `${ref("b")} – do ${hours} h od zjištění`, det + hours * H));
    const notice = first("notification");
    if (!notice) out.push(mk("final", "Závěrečná zpráva", `${ref("d")} – do 1 měsíce od oznámení`, null, { note: "Lhůta poběží od předložení oznámení." }));
    else {
      const limit = addMonth(new Date(notice).getTime());
      const resolved = i.resolvedAt ? new Date(i.resolvedAt).getTime() : null;
      if (resolved != null || now <= limit) out.push(mk("final", "Závěrečná zpráva", `${ref("d")} – do 1 měsíce od oznámení`, limit, resolved == null ? { note: "Pokud incident po lhůtě stále trvá, předkládá se zpráva o pokroku." } : {}));
      else {
        out.push(mk("interim", "Zpráva o pokroku (incident trvá)", `${ref("e")} – v době, kdy měla být předložena závěrečná zpráva`, limit));
        out.push(mk("final", "Závěrečná zpráva", `${ref("e")} – do 1 měsíce od vyřešení incidentu`, null, { note: "Lhůta poběží od vyřešení incidentu." }));
      }
    }
  }
  if ((regime === "higher" || regime === "lower") && isReportable(i, regime)) {
    out.push(mk("initial", "Prvotní hlášení", "§ 16 odst. 1 zákona – do 24 h od zjištění", det + 24 * H));
    // povinnost oznámení: nižší režim = významný dopad (§ 15 odst. 2); vyšší režim = sdělení Úřadu (§ 16 odst. 2)
    const needNotice = regime === "lower" ? isSignificant(i) : i.authorityDecision === "significant";
    const waiting = regime === "higher" && i.authorityDecision === "pending";
    if (needNotice || waiting) {
      const hours = opts.trustService ? 24 : 72;
      out.push(
        mk("notification", "Oznámení s prvotním posouzením, dopadem a IoC", `§ 16 odst. 3 písm. a) zákona – do ${hours} h od zjištění`, det + hours * H,
          waiting ? { note: "Povinnost vznikne, pokud Úřad sdělí významný dopad na kybernetický prostor státu (§ 16 odst. 2)." } : {}),
      );
      if (needNotice) {
        const notice = first("notification");
        if (!notice) out.push(mk("final", "Závěrečná zpráva o vyřešení", "§ 16 odst. 3 písm. c) zákona – do 30 dnů od oznámení", null, { note: "Lhůta poběží od předložení oznámení." }));
        else {
          const limit = new Date(notice).getTime() + 30 * D;
          const resolved = i.resolvedAt ? new Date(i.resolvedAt).getTime() : null;
          if (resolved != null && resolved <= limit) out.push(mk("final", "Závěrečná zpráva o vyřešení", "§ 16 odst. 3 písm. c) zákona – do 30 dnů od oznámení", limit));
          else if (resolved == null && now <= limit) out.push(mk("final", "Závěrečná zpráva o vyřešení", "§ 16 odst. 3 písm. c) zákona – do 30 dnů od oznámení", limit, { note: "Pokud incident po lhůtě stále trvá, předkládá se místo ní průběžná zpráva." }));
          else {
            out.push(mk("interim", "Průběžná zpráva o aktuálním stavu (incident trvá po 30 dnech)", "§ 16 odst. 3 písm. c) zákona – bez zbytečného odkladu po uplynutí lhůty", limit));
            out.push(
              mk("final", "Závěrečná zpráva o vyřešení", "§ 16 odst. 3 písm. c) zákona – do 30 dnů od vyřešení", resolved != null ? resolved + 30 * D : null,
                resolved == null ? { note: "Lhůta poběží od vyřešení incidentu." } : {}),
            );
          }
        }
      }
    }
  }
  if (i.personalDataBreach)
    out.push(mk("gdpr", "Ohlášení porušení zabezpečení osobních údajů ÚOOÚ", "čl. 33 GDPR – do 72 h (není-li nepravděpodobné, že porušení bude mít za následek riziko)", det + 72 * H));
  return out;
}

/** Nesplněné kroky zvládání incidentu (§ 14 odst. 1 vyhl. 409/2025) podle fáze. */
export function incidentGaps(i: {
  kind: IncidentKind;
  status: IncidentStatus;
  ownerPositionId: string | null;
  evidence: string | null;
  containment: string | null;
  rootCause: string | null;
  lessonsLearned: string | null;
  significant: boolean;
  reports: { reportType: ReportType }[];
}): string[] {
  if (i.kind === "event") return [];
  const g: string[] = [];
  if (i.kind === "unassessed" && i.status !== "new") g.push("Není rozhodnuto, zda jde o incident (§ 14 odst. 1 písm. g).");
  if (i.kind !== "incident") return g;
  if (!i.ownerPositionId) g.push("Není určena odpovědnost za zvládání incidentu (§ 14 odst. 1 písm. c).");
  if (!i.containment) g.push("Nejsou uvedena opatření k odvrácení a zmírnění dopadu (§ 14 odst. 1 písm. i).");
  if (!i.evidence) g.push("Nejsou zaznamenány podklady (důkazy) pro analýzu (§ 14 odst. 1 písm. d).");
  const done = i.status === "resolved" || i.status === "closed";
  if (done && !i.rootCause) g.push("Není určena příčina incidentu (§ 14 odst. 1 písm. k).");
  if (i.status === "closed" && !i.lessonsLearned) g.push("Chybí vyhodnocení účinnosti řešení a opatření proti opakování (§ 14 odst. 1 písm. n).");
  return g;
}
