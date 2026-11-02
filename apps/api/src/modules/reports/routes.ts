import { profileLabelKey, profileOf, reportBasisOf, INCIDENT_LABELS,
  OBLIGATION_LABELS,
  RISK_LABELS,
  attackTactic,
  levelByThreshold,
  LOCALE_RE,
  type Translate,
  type IncidentCategory,
  type ManagementKpi,
  type ManagementReport,
  type ObligationKind,
  type OpsLevel,
  TREND_LABELS,
  type TrendDto,
  type TrendMetric,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { count, eq, and, gte, lte } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { loadTrends } from "../trends/routes";
import { settingsFor, soleCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, exercises } from "../../db/schema";
import { doraRegisterOf } from "../suppliers/dora";
import { assuranceStats } from "../assurance/routes";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html as h, printPage } from "../documents/render";
import { ismsReviewSnapshot, metaOf } from "../documents/snapshots";
import { getNotificationSettings } from "../notifications/service";
import { socReportStats } from "../soc/grc";
import { vulnRemediationStats } from "../vulnerabilities/remediation";
import { CS_T, tFor, translatorFor } from "../i18n/service";
import {
  collectObligations,
  kindsForModules,
} from "../notifications/obligations";

/* ============================================================
 * Zpráva pro vedení – jedna stránka se semaforem klíčových ukazatelů (ADR-018).
 * Data = stejné výpočty jako zpráva o přezkoumání ISMS + ověřování opatření + povinnosti + stav aktiv.
 * ============================================================ */

type Ctx = Context<AppEnv>;
const Period = z.object({
  periodFrom: z.string().date().optional(),
  periodTo: z.string().date().optional(),
  companyId: z.string().uuid().optional(),
  lang: z.string().regex(LOCALE_RE).optional(),
});

export async function managementReport(
  db: Db,
  companyId: string,
  periodFrom?: string,
  periodTo?: string,
  t: Translate = CS_T,
): Promise<ManagementReport> {
  const to = periodTo ?? new Date().toISOString().slice(0, 10);
  const from =
    periodFrom ??
    new Date(new Date(to).getTime() - 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
  const s = await settingsFor(db, null, companyId);
  const on = (m: string) => (s.enabledModules as string[]).includes(m);
  const meta = metaOf(s, { periodFrom: from, periodTo: to });
  const [review, assurance, notif] = await Promise.all([
    ismsReviewSnapshot(db, meta, s, {}, companyId),
    on("controls") ? assuranceStats(db, [companyId]) : null,
    getNotificationSettings(db),
  ]);
  const obligations = await collectObligations(db, {
    companyIds: [companyId],
    leadDays: notif.leadDays,
    kinds: kindsForModules(s.enabledModules as string[]),
    includeLater: false,
    t,
  });
  const byKind: Record<string, number> = {};
  for (const o of obligations.filter((x) => x.urgency === "overdue"))
    byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
  const assetsHealth = on("assets")
    ? Object.fromEntries(
        (
          await db
            .select({ k: assets.healthStatus, n: count() })
            .from(assets)
            .where(
              and(
                eq(assets.companyId, companyId),
                eq(assets.lifecycleStatus, "active"),
              ),
            )
            .groupBy(assets.healthStatus)
        ).map((r) => [r.k, r.n]),
      )
    : null;

  const fwMain = profileOf(s).defaultFramework;
  const comp =
    review.compliance.find((c) => c.framework === fwMain) ??
    review.compliance[0];
  const kpis: ManagementKpi[] = [];
  const k = (
    key: string,
    label: string,
    value: string,
    level: OpsLevel,
    detail: string,
    link: string | null,
  ) => kpis.push({ key, label, value, level, detail, link });

  if (comp)
    k(
      "compliance",
      t("srv.rep.compliance", { name: comp.name }),
      `${comp.score.toLocaleString(t.locale)} %`,
      comp.score >= 80 ? "ok" : comp.score >= 50 ? "warning" : "error",
      t("srv.rep.complianceDetail", { compliant: comp.compliant, partial: comp.partial, nonCompliant: comp.nonCompliant, notAssessed: comp.notAssessed, applicable: comp.applicable }),
      "/controls",
    );
  if (review.risks)
    k(
      "risks",
      t("srv.rep.risks"),
      String(review.risks.unacceptable),
      review.risks.untreated > 0
        ? "error"
        : review.risks.unacceptable > 0
          ? "warning"
          : "ok",
      t("srv.rep.risksDetail", { untreated: review.risks.untreated, critical: review.risks.byLevel.critical ?? 0, high: review.risks.byLevel.high ?? 0, total: review.risks.total }),
      "/risks",
    );
  if (review.plan)
    k(
      "plan",
      t("srv.rep.plan"),
      String(review.plan.overdue),
      levelByThreshold(review.plan.overdue, 1, 5),
      t("srv.rep.planDetail", { open: review.plan.open, done: review.plan.done }),
      "/risks/plan",
    );
  if (review.incidents)
    k(
      "incidents",
      t("srv.rep.incidents"),
      String(review.incidents.incidents),
      review.incidents.overdueReports > 0
        ? "error"
        : review.incidents.significant > 0
          ? "warning"
          : "ok",
      t(review.incidents.personalData ? "srv.rep.incidentsDetailPd" : "srv.rep.incidentsDetail", { significant: review.incidents.significant, overdue: review.incidents.overdueReports, events: review.incidents.events, pd: review.incidents.personalData ?? 0 }),
      "/incidents",
    );
  const vulnRemediation = on("vulnerabilities") ? await vulnRemediationStats(db, companyId, from, to) : null;
  if (vulnRemediation)
    k(
      "vulns",
      t("srv.rep.vulns"),
      String(vulnRemediation.overdue),
      vulnRemediation.p1 > 0 ? "error" : levelByThreshold(vulnRemediation.overdue, 1, 50),
      t("srv.rep.vulnsDetail", { p1: vulnRemediation.p1, p2: vulnRemediation.p2, kev: vulnRemediation.kevOpen, onTime: vulnRemediation.resolvedOnTimePct == null ? "—" : `${vulnRemediation.resolvedOnTimePct} %` }),
      "/vulnerabilities",
    );
  const soc = on("soc") ? await socReportStats(db, companyId, from, to) : null;
  if (soc)
    k(
      "soc",
      t("srv.rep.soc"),
      String(soc.openBreached),
      levelByThreshold(soc.openBreached, 1, 5),
      t("srv.rep.socDetail", { alerts: soc.alerts, escalated: soc.escalated, fp: soc.fpRate == null ? "—" : `${Math.round(soc.fpRate * 100)} %`, mtta: soc.mttaHours == null ? "—" : `${soc.mttaHours.toLocaleString(t.locale)} h` }),
      "/soc",
    );
  if (review.audits)
    k(
      "audits",
      t("srv.rep.audits"),
      String(review.audits.overdueFindings),
      levelByThreshold(review.audits.overdueFindings, 1, 3),
      t("srv.rep.auditsDetail", { open: review.audits.openFindings, major: review.audits.openMajor }),
      "/audits",
    );
  if (assurance) {
    const ratio = assurance.implementedControls
      ? Math.round(
          ((assurance.implementedControls - assurance.implementedNotTested) /
            assurance.implementedControls) *
            100,
        )
      : 0;
    k(
      "assurance",
      t("srv.rep.assurance"),
      `${ratio} %`,
      ratio >= 70 ? "ok" : ratio >= 30 ? "warning" : "error",
      t("srv.rep.assuranceDetail", { ineffective: assurance.testsLastYear.ineffective ?? 0, exceptions: assurance.testsLastYear.effective_with_exceptions ?? 0, noEvidence: assurance.implementedWithoutEvidence, expired: assurance.evidenceExpired }),
      "/controls/assurance",
    );
  }
  if (assetsHealth) {
    const red = assetsHealth.red ?? 0;
    k(
      "assets",
      t("srv.rep.assets"),
      String(red),
      levelByThreshold(red, 1, 5),
      t("srv.rep.assetsDetail", { orange: assetsHealth.orange ?? 0, green: assetsHealth.green ?? 0, unknown: assetsHealth.unknown ?? 0 }),
      "/assets",
    );
  }
  if (review.continuity)
    k(
      "continuity",
      t("srv.rep.continuity"),
      String(review.continuity.testOverdue + review.continuity.neverTested),
      levelByThreshold(
        review.continuity.testOverdue + review.continuity.neverTested,
        1,
        3,
      ),
      t("srv.rep.continuityDetail", { plans: review.continuity.plans, approved: review.continuity.approved }),
      "/continuity/plans",
    );
  // DORA – finanční subjekt (ADR-086): závažné incidenty IKT, třetí strany IKT, testování digitální provozní odolnosti
  const profile = profileOf(s);
  if (profile.doraEntity) {
    if (review.incidents)
      k(
        "dora_incidents",
        t("srv.rep.doraIncidents"),
        String(review.incidents.significant),
        review.incidents.overdueReports > 0 ? "error" : review.incidents.significant > 0 ? "warning" : "ok",
        t("srv.rep.doraIncidentsDetail", { overdue: review.incidents.overdueReports, incidents: review.incidents.incidents }),
        "/incidents",
      );
    if (on("suppliers")) {
      const reg = await doraRegisterOf(db, [companyId], companyId);
      k(
        "dora_third_parties",
        t("srv.rep.doraThirdParties"),
        String(reg.summary.findings),
        levelByThreshold(reg.summary.findings, 1, 5),
        t("srv.rep.doraThirdPartiesDetail", { providers: reg.summary.providers, contracts: reg.summary.contracts, complete: reg.summary.complete, critical: reg.summary.criticalFunctions }),
        "/suppliers/dora",
      );
    }
    if (on("continuity")) {
      const [ex] = await db
        .select({ n: count() })
        .from(exercises)
        .where(and(eq(exercises.companyId, companyId), eq(exercises.status, "completed"), gte(exercises.endedAt, new Date(from)), lte(exercises.endedAt, new Date(`${to}T23:59:59Z`))));
      const n = ex?.n ?? 0;
      const gaps = (review.continuity?.testOverdue ?? 0) + (review.continuity?.neverTested ?? 0);
      k(
        "dora_testing",
        t("srv.rep.doraTesting"),
        String(n),
        n === 0 ? "error" : gaps > 0 ? "warning" : "ok",
        t("srv.rep.doraTestingDetail", { overdue: review.continuity?.testOverdue ?? 0, never: review.continuity?.neverTested ?? 0 }),
        "/continuity/exercises",
      );
    }
  }
  const overdue = obligations.filter((x) => x.urgency === "overdue").length;
  k(
    "obligations",
    t("srv.rep.obligations"),
    String(overdue),
    levelByThreshold(overdue, 1, 10),
    Object.entries(byKind)
      .map(([kk, n]) => `${t.lbl(OBLIGATION_LABELS[kk as ObligationKind])} ${n}`)
      .join(", ") || t("srv.rep.none"),
    "/my",
  );

  return {
    organizationName: s.organizationName,
    regime: s.regime,
    profileName: (() => {
      const l = profileLabelKey(profileOf(s));
      return t(l.key, { main: l.main });
    })(),
    basisLabel: t.locale === "cs" ? reportBasisOf(profile).label : reportBasisOf(profile).labelEn,
    periodFrom: from,
    periodTo: to,
    generatedAt: new Date().toISOString(),
    kpis,
    compliance: review.compliance,
    risks: review.risks
      ? {
          total: review.risks.total,
          byLevel: review.risks.byLevel,
          unacceptable: review.risks.unacceptable,
          untreated: review.risks.untreated,
        }
      : null,
    plan: review.plan
      ? {
          open: review.plan.open,
          done: review.plan.done,
          overdue: review.plan.overdue,
        }
      : null,
    incidents: review.incidents
      ? {
          events: review.incidents.events,
          incidents: review.incidents.incidents,
          significant: review.incidents.significant,
          overdueReports: review.incidents.overdueReports,
          personalData: review.incidents.personalData,
          list: review.incidents.list
            .slice(0, 15)
            .map((x) => ({
              code: x.code,
              title: x.title,
              category: x.category,
              detectedAt: x.detectedAt,
              significant: x.significant,
            })),
        }
      : null,
    soc,
    vulnRemediation,
    audits: review.audits
      ? {
          done: review.audits.audits.length,
          openFindings: review.audits.openFindings,
          overdueFindings: review.audits.overdueFindings,
          openMajor: review.audits.openMajor,
        }
      : null,
    assurance: assurance
      ? {
          testsLastYear: assurance.testsLastYear,
          implementedControls: assurance.implementedControls,
          implementedNotTested: assurance.implementedNotTested,
          implementedWithoutEvidence: assurance.implementedWithoutEvidence,
          evidenceExpired: assurance.evidenceExpired,
          testsOverdue: assurance.testsOverdue,
        }
      : null,
    obligations: {
      overdue,
      soon: obligations.filter(
        (x) => x.urgency === "soon" || x.urgency === "today",
      ).length,
      byKind,
    },
    assets: assetsHealth
      ? {
          total: Object.values(assetsHealth).reduce((a, b) => a + b, 0),
          red: assetsHealth.red ?? 0,
          orange: assetsHealth.orange ?? 0,
          green: assetsHealth.green ?? 0,
          unknown: assetsHealth.unknown ?? 0,
        }
      : null,
    continuity: review.continuity
      ? {
          plans: review.continuity.plans,
          approved: review.continuity.approved,
          testOverdue: review.continuity.testOverdue,
          neverTested: review.continuity.neverTested,
        }
      : null,
    documents: review.documents.map((d) => ({
      title: d.title,
      version: d.version,
      approvedAt: d.approvedAt,
    })),
  };
}

const levelText = (t: Translate, l: OpsLevel) =>
  l === "ok" ? t("srv.rep.levelOk") : l === "warning" ? t("srv.rep.levelWarning") : l === "error" ? t("srv.rep.levelError") : "—";
const LEVEL_COLOR: Record<OpsLevel, string> = {
  ok: "#0ca30c",
  warning: "#ec835a",
  error: "#d03b3b",
  off: "#b4b2ab",
};

/** Tisková podoba zprávy (HTML) – stejná pro PDF i Word. */
export function renderManagementReport(r: ManagementReport, t: Translate = CS_T, trend?: TrendDto | null): string {
  const { esc } = h;
  // datum v jazyce výstupu (čeština beze změny)
  const day = t.locale === "cs" ? h.day : (v: string | null | undefined) => (v ? new Date(`${v.slice(0, 10)}T00:00:00Z`).toLocaleDateString(t.locale, { timeZone: "UTC", dateStyle: "medium" }) : "—");
  const dt = t.locale === "cs" ? h.dt : (v: string | null | undefined) => (v ? new Date(v).toLocaleString(t.locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }) : "—");
  const kpiRows = r.kpis
    .map(
      (x) =>
        `<tr><td><span style="color:${LEVEL_COLOR[x.level]}">●</span> <b>${esc(levelText(t, x.level))}</b></td><td>${esc(x.label)}</td><td class="n"><b>${esc(x.value)}</b></td><td class="small">${esc(x.detail)}</td></tr>`,
    )
    .join("");
  const attention = r.kpis.filter((x) => x.level === "error");
  let body = `<div class="muted small">${esc(r.organizationName)}</div>
<h1>${esc(t("srv.rep.title"))}</h1>
<div class="meta"><span class="muted">${esc(t("srv.rep.period"))}</span><span>${day(r.periodFrom)} – ${day(r.periodTo)}</span><span class="muted">${esc(t("srv.rep.asOf"))}</span><span>${dt(r.generatedAt)}</span><span class="muted">${esc(t("srv.rep.regime"))}</span><span>${esc(r.profileName)}</span>${r.basisLabel ? `<span class="muted">${esc(t("doc.framework"))}</span><span>${esc(r.basisLabel)}</span>` : ""}</div>
<h2>${esc(t("srv.rep.h1"))}</h2>
<table><thead><tr><th style="width:18%">${esc(t("srv.rep.colState"))}</th><th>${esc(t("srv.rep.colIndicator"))}</th><th class="n" style="width:10%">${esc(t("srv.rep.colValue"))}</th><th>${esc(t("srv.rep.colDetail"))}</th></tr></thead><tbody>${kpiRows}</tbody></table>
<h2>${esc(t("srv.rep.h2"))}</h2>
${attention.length ? `<ul>${attention.map((x) => `<li><b>${esc(x.label)}: ${esc(x.value)}</b> – ${esc(x.detail)}</li>`).join("")}</ul>` : `<p>${esc(t("srv.rep.noRed"))}</p>`}`;
  if (r.compliance.length)
    body += `<h2>${esc(t("srv.rep.h3"))}</h2><table style="width:auto"><thead><tr><th>${esc(t("srv.rep.colFramework"))}</th><th class="n">${esc(t("srv.rep.colScore"))}</th><th class="n">${esc(t("srv.rep.colApplicable"))}</th><th class="n">${esc(t("srv.rep.colCompliant"))}</th><th class="n">${esc(t("srv.rep.colPartial"))}</th><th class="n">${esc(t("srv.rep.colNonCompliant"))}</th></tr></thead><tbody>${r.compliance
      .map(
        (c) =>
          `<tr><td>${esc(c.name)}</td><td class="n"><b>${c.score.toLocaleString(t.locale)} %</b></td><td class="n">${c.applicable}</td><td class="n">${c.compliant}</td><td class="n">${c.partial}</td><td class="n">${c.nonCompliant}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  if (r.risks)
    body += `<h2>${esc(t("srv.rep.h4"))}</h2><p>${t("srv.rep.risksText", {
      total: r.risks.total,
      levels: esc(
        (["critical", "high", "medium", "low"] as const)
          .map((l) => `${t.lbl(RISK_LABELS.level[l]).toLowerCase()} ${r.risks!.byLevel[l] ?? 0}`)
          .join(", "),
      ),
      unacceptable: r.risks.unacceptable,
      untreated: r.risks.untreated,
    })}${r.plan ? ` ${t("srv.rep.planText", { open: r.plan.open, overdue: r.plan.overdue })}` : ""}</p>`;
  if (r.vulnRemediation)
    body += `<h2>${esc(t("srv.rep.hVulns"))}</h2><p>${esc(
      t("srv.rep.vulnsText", {
        p1: r.vulnRemediation.p1,
        p2: r.vulnRemediation.p2,
        kev: r.vulnRemediation.kevOpen,
        overdue: r.vulnRemediation.overdue,
        resolved: r.vulnRemediation.resolved,
        onTime: r.vulnRemediation.resolvedOnTimePct == null ? "—" : `${r.vulnRemediation.resolvedOnTimePct} %`,
      }),
    )}</p>`;
  if (r.incidents)
    body += `<h2>${esc(t("srv.rep.h5"))}</h2><p>${esc(t("srv.rep.incidentsText", { incidents: r.incidents.incidents, significant: r.incidents.significant, events: r.incidents.events, overdue: r.incidents.overdueReports }))}</p>${
      r.incidents.list.length
        ? `<table><thead><tr><th>${esc(t("srv.rep.colIncident"))}</th><th>${esc(t("srv.rep.colCategory"))}</th><th>${esc(t("srv.rep.colDetected"))}</th><th>${esc(t("srv.rep.colSignificant"))}</th></tr></thead><tbody>${r.incidents.list
            .map(
              (x) =>
                `<tr><td>${esc(x.code ?? "")} ${esc(x.title)}</td><td>${esc(t.lbl(INCIDENT_LABELS.category[x.category as IncidentCategory] ?? x.category))}</td><td>${day(x.detectedAt)}</td><td>${esc(x.significant ? t("srv.rep.yes") : t("srv.rep.no"))}</td></tr>`,
            )
            .join("")}</tbody></table>`
        : ""
    }`;
  if (r.soc)
    body += `<h2>${esc(t("srv.rep.hSoc"))}</h2><p>${esc(
      t("srv.rep.socText", {
        alerts: r.soc.alerts,
        escalated: r.soc.escalated,
        tp: r.soc.truePositive,
        fp: r.soc.falsePositive,
        benign: r.soc.benign,
        fpRate: r.soc.fpRate == null ? "—" : `${Math.round(r.soc.fpRate * 100)} %`,
        mtta: r.soc.mttaHours == null ? "—" : `${r.soc.mttaHours.toLocaleString(t.locale)} h`,
        breached: r.soc.openBreached,
        exploit: r.soc.exploitAttempts,
      }),
    )}${
      r.soc.topTactics.length
        ? ` ${esc(t("srv.rep.socTactics", { list: r.soc.topTactics.map((x) => `${t.locale === "cs" ? (attackTactic(x.id)?.cs ?? x.id) : (attackTactic(x.id)?.name ?? x.id)} (${x.n})`).join(", ") }))}`
        : ""
    }${r.soc.mttrHours != null ? ` ${esc(t("srv.rep.socMttr", { h: r.soc.mttrHours.toLocaleString(t.locale) }))}` : ""}${
      r.soc.aiAgreement != null
        ? ` ${esc(t("srv.rep.socAi", { pct: Math.round(r.soc.aiAgreement * 100), n: r.soc.aiCompared, missed: r.soc.aiMissed }))}`
        : ""
    }</p>`;
  if (r.assurance)
    body += `<h2>${esc(t("srv.rep.h6"))}</h2><p>${esc(
      t("srv.rep.assuranceText", {
        implemented: r.assurance.implementedControls,
        notTested: r.assurance.implementedNotTested,
        noEvidence: r.assurance.implementedWithoutEvidence,
        results:
          Object.entries(r.assurance.testsLastYear)
            .map(
              ([k, n]) =>
                `${({ effective: t("srv.rep.resEffective"), effective_with_exceptions: t("srv.rep.resExceptions"), ineffective: t("srv.rep.resIneffective"), not_tested: t("srv.rep.resNotTested") } as Record<string, string>)[k] ?? k} ${n}`,
            )
            .join(", ") || t("srv.rep.resNone"),
        overdue: r.assurance.testsOverdue,
      }),
    )}${r.audits ? ` ${esc(t("srv.rep.auditsText", { done: r.audits.done, open: r.audits.openFindings, overdue: r.audits.overdueFindings, major: r.audits.openMajor }))}` : ""}</p>`;
  if (trend && trend.points.length > 1) {
    const keys: (TrendMetric | "compliance")[] = ["compliance", "risks_unacceptable", "plan_overdue", "findings_overdue", "vulns_critical", "obligations_overdue", "exceptions_expired"];
    const pts = trend.points.slice(-6);
    const mon = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString(t.locale === "cs" ? "cs-CZ" : t.locale, { month: "short", year: "2-digit", timeZone: "UTC" });
    const rows = keys
      .filter((k) => pts.some((p) => typeof p.values[k] === "number"))
      .map((k) => `<tr><td>${esc(t.lbl(TREND_LABELS[k]))}</td>${pts.map((p) => `<td class="n">${typeof p.values[k] === "number" ? esc((p.values[k] as number).toLocaleString(t.locale)) : "–"}</td>`).join("")}</tr>`)
      .join("");
    body += `<h2>${esc(t("srv.rep.trendTitle"))}</h2><table><thead><tr><th>${esc(t("srv.rep.trendIndicator"))}</th>${pts.map((p) => `<th>${esc(mon(p.period))}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (r.documents.length)
    body += `<h2>${esc(t("srv.rep.h7"))}</h2><ul>${r.documents.map((d) => `<li>${d.approvedAt ? esc(t("srv.rep.docApproved", { title: d.title, version: d.version, date: day(d.approvedAt) })) : `${esc(d.title)} v${d.version}`}</li>`).join("")}</ul>`;
  body += `<p class="small muted">${esc(t("srv.rep.footer", { date: day(r.generatedAt) }))}</p>
<div class="sig"><div>${esc(t("srv.rep.submittedBy"))}</div><div>${esc(t("srv.rep.discussed"))}</div></div>`;
  return printPage(t("srv.rep.pageTitle", { date: day(r.periodTo) }), body, t.locale);
}

export function reportRoutes(db: Db) {
  /** Jazyk výstupu: ?lang= (volba při exportu), jinak jazyk uživatele (ADR-036). */
  const outT = (c: Ctx, lang?: string) => (lang ? translatorFor(db, lang) : tFor(db, c));
  const load = async (c: Ctx) => {
    const q = c.req.valid("query" as never) as z.infer<typeof Period>;
    const t = await outT(c, q.lang);
    const companyId = soleCompany(c, q.companyId);
    const r = await managementReport(
      db,
      companyId,
      q.periodFrom,
      q.periodTo,
      t,
    );
    return { r, t, companyId };
  };
  const perm = requirePerm("isms:read", "risks:read", "controls:read");
  return new Hono<AppEnv>()
    .get("/management", perm, zValidator("query", Period), async (c) =>
      c.json((await load(c)).r),
    )
    .get("/management.html", perm, zValidator("query", Period), async (c) => {
      const { r, t, companyId } = await load(c);
      return c.html(renderManagementReport(r, t, await loadTrends(db, companyId, 6).catch(() => null)), 200, {
        "cache-control": "private, no-store",
      });
    })
    .get("/management.docx", perm, zValidator("query", Period), async (c) => {
      const { r, t, companyId } = await load(c);
      const buf = await htmlToDocx(renderManagementReport(r, t, await loadTrends(db, companyId, 6).catch(() => null)), {
        title: t("srv.rep.docxTitle"),
        headerLine: r.organizationName,
      });
      await audit(db, {
        c,
        user: currentUser(c),
        action: "report.exported",
        details: { report: "management", format: "docx", periodTo: r.periodTo },
      });
      return docxResponse(buf, t("srv.rep.fileName", { date: r.periodTo }));
    });
}
