import { certExpiryItems } from "../assets/certificates";
import { auditRequestItems } from "../audits/requests";
import { EXCEPTION_LABELS, EXCEPTION_LEAD_DAYS, OBLIGATION_LABELS, type ExceptionDto, type Translate, POLICY_WORKFLOW_ACTIONS, urgencyOf, type ObligationItem, type ObligationKind, triggerDue, RISK_TRIGGER_LABELS, exerciseCode, requestCode } from "@contix/shared";
import { vulnRemediationItems } from "../vulnerabilities/remediation";
import { and, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import { getCompanies, riskPolicies } from "../../auth/scope";
import { activityNextReview } from "../gdpr/routes";
import { aiNextReview } from "../aiact/routes";
import { reportDto } from "../cra/routes";
import { getSettings } from "../../auth/service";
import type { Db } from "../../db/client";
import { infoFeedItems, infoItemReviews, accessReviewItems, accessReviews, legalActs, legalChanges, legalReviews, legalTasks, legalVersions, assessmentCycles, policies, policyEvents, policyVersions, trainingCourses, auditFindings, audits, changes, continuityPlans, incidents, planTests, positionHolders, positions, risks, riskTreatmentActions, supplierContracts, suppliers, controlTests, controls, evidence, processingActivities, dpias, aiSystems, craProducts, craReports, supplierQuestionnaires, supplierReports, tasks, exercises } from "../../db/schema";
import { loadAudits, loadFindings } from "../audits/routes";
import { cycleStatus } from "../cycles/routes";
import { loadCourses } from "../awareness/routes";
import { loadIncidents } from "../incidents/routes";
import { loadChanges, reviewStatus } from "../isms/routes";
import { loadPolicies } from "../policies/routes";
import { retentionFor } from "../policies/dms";
import { loadActions } from "../risks/routes";
import { riskBaseline, riskTriggers } from "../risks/triggers";
import { loadExceptions } from "../exceptions/service";
import { CS_T } from "../i18n/service";
import { socSlaItems } from "../soc/service";

/* ============================================================
 * Sběr povinností s termíny z celé evidence. Nic se nepersistuje –
 * stejně jako lhůty incidentů se vše počítá z aktuálních dat.
 * ============================================================ */

const addMonths = (d: string, m: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.toISOString().slice(0, 10);
};

export interface CollectOptions {
  companyIds: string[];
  leadDays: number;
  now?: Date;
  /** Jen tyto druhy (podle zapnutých modulů / oprávnění). */
  kinds?: Set<ObligationKind>;
  /** Zahrnout i položky s termínem „později“ (pro přehled v aplikaci). */
  includeLater?: boolean;
  /** Jazyk textů (titulky, podrobnosti); výchozí čeština. */
  t?: Translate;
}

/** Druhy povinností podle zapnutých modulů. */
const kindsMods = new WeakMap<Set<ObligationKind>, Set<string>>();
export function kindsForModules(enabled: string[]): Set<ObligationKind> {
  const m = new Set(enabled);
  const k = new Set<ObligationKind>();
  if (m.has("incidents")) k.add("incident_report");
  if (m.has("risks")) k.add("risk_action").add("risk_review").add("risk_trigger");
  if (m.has("audits")) k.add("finding").add("audit").add("audit_request");
  if (m.has("isms")) k.add("isms_review").add("change");
  if (m.has("policies")) k.add("policy_review").add("doc_approval").add("doc_retention");
  if (m.has("continuity")) k.add("plan_test").add("exercise");
  if (m.has("assets")) k.add("cert_expiry");
  if (m.has("suppliers")) k.add("contract").add("supplier_questionnaire").add("supplier_report");
  if (m.has("risks") || m.has("continuity")) k.add("assessment_cycle");
  if (m.has("controls")) k.add("control_test").add("evidence_expiry");
  if (m.has("gdpr")) k.add("processing_review");
  if (m.has("aiact")) k.add("ai_review");
  if (m.has("cra")) k.add("cra_report").add("cra_support");
  if (m.has("identity")) k.add("access_review");
  if (m.has("legislation")) k.add("legal_review").add("legal_task").add("info_assessment");
  if (m.has("identity") || m.has("vulnerabilities") || m.has("soc")) k.add("exception_expiry");
  if (m.has("soc")) k.add("soc_sla");
  if (m.has("vulnerabilities")) k.add("vuln_remediation");
  k.add("task");
  kindsMods.set(k, m);
  return k;
}

/** Výjimky s termínem: nálezy identit a SoD (modul identity), zranitelnosti (modul vulnerabilities). */
function exceptionScope(kinds: Set<ObligationKind> | undefined, ids: string[]) {
  const mods = (kinds && kindsMods.get(kinds)) ?? new Set(["identity", "vulnerabilities", "soc"]);
  return { identity_finding: mods.has("identity") ? ids : [], sod_violation: mods.has("identity") ? ids : [], vulnerability: mods.has("vulnerabilities") ? ids : [], soc_suppression: mods.has("soc") ? ids : [] };
}
const exceptionObligation = (e: ExceptionDto, t: Translate = CS_T): Omit<ObligationItem, "urgency"> => ({
  key: `exception_expiry:${e.key}`,
  kind: "exception_expiry",
  title: e.title,
  detail: `${t.lbl(EXCEPTION_LABELS.kind[e.kind])}${e.reason ? ` · ${e.reason.slice(0, 120)}` : ""}`,
  companyId: e.companyId,
  due: e.until,
  link: e.link,
  ownerPositionId: null,
  ownerName: null,
});

export async function collectObligations(db: Db, o: CollectOptions): Promise<ObligationItem[]> {
  const now = o.now ?? new Date();
  const t = o.t ?? CS_T;
  const ids = o.companyIds.length ? o.companyIds : ["00000000-0000-0000-0000-000000000000"];
  const want = (k: ObligationKind) => !o.kinds || o.kinds.has(k);
  const out: ObligationItem[] = [];
  const push = (x: Omit<ObligationItem, "urgency"> & { urgency?: ObligationItem["urgency"] }) => {
    const urgency = x.urgency ?? urgencyOf(x.due, o.leadDays, now);
    if (!o.includeLater && urgency === "later") return;
    out.push({ ...x, urgency });
  };
  const posNames = new Map((await db.select({ id: positions.id, name: positions.name }).from(positions)).map((p) => [p.id, p.name]));
  const owner = (id: string | null | undefined) => ({ ownerPositionId: id ?? null, ownerName: id ? (posNames.get(id) ?? null) : null });

  // incidenty – nejbližší lhůta hlášení (24 h / 72 h / 30 dnů)
  if (want("incident_report")) {
    const list = await loadIncidents(db, and(inArray(incidents.companyId, ids), notInArray(incidents.status, ["closed"])));
    const rows = await db.select({ id: incidents.id, owner: incidents.ownerPositionId }).from(incidents).where(inArray(incidents.companyId, ids));
    const ownerOf = new Map(rows.map((r) => [r.id, r.owner]));
    for (const i of list) {
      const d = i.nextDeadline;
      if (!d?.due || d.submittedAt) continue;
      push({
        key: `incident_report:${i.id}:${d.type}`,
        kind: "incident_report",
        title: `${t.lbl(d.label)} – ${i.code ? `${i.code} ` : ""}${i.title}`,
        detail: d.legal,
        companyId: i.companyId,
        due: d.due,
        link: `/incidents/${i.id}`,
        ...owner(ownerOf.get(i.id)),
      });
    }
  }

  // akce plánu zvládání rizik
  if (want("risk_action")) {
    const pol = await riskPolicies(db, await getSettings(db));
    const acts = await loadActions(db, pol, and(inArray(risks.companyId, ids), inArray(riskTreatmentActions.status, ["planned", "in_progress"]), isNotNull(riskTreatmentActions.dueDate)));
    const co = new Map((await db.select({ id: risks.id, c: risks.companyId }).from(risks).where(inArray(risks.companyId, ids))).map((r) => [r.id, r.c]));
    for (const a of acts)
      push({
        key: `risk_action:${a.id}`,
        kind: "risk_action",
        title: a.title,
        detail: t("srv.obl.riskDetail", { name: `${a.riskCode ? `${a.riskCode} ` : ""}${a.riskName}` }),
        companyId: co.get(a.riskId)!,
        due: a.dueDate,
        link: `/risks/${a.riskId}`,
        ...owner(a.ownerPositionId),
      });
  }

  // pravidelné přehodnocení rizik (§ 8 odst. 1 písm. c)
  if (want("risk_review")) {
    const pol = await riskPolicies(db, await getSettings(db));
    const rs = await db.select().from(risks).where(and(inArray(risks.companyId, ids), ne(risks.status, "closed"), isNotNull(risks.assessedAt)));
    for (const r of rs) {
      const months = pol.get(r.companyId)?.reviewMonths ?? 12;
      // potvrzení beze změny (ADR-058) se počítá jako pravidelné hodnocení
      const last = riskBaseline(r).toISOString().slice(0, 10);
      push({
        key: `risk_review:${r.id}`,
        kind: "risk_review",
        title: t("srv.obl.reassessRisk", { name: `${r.code ? `${r.code} ` : ""}${r.name}` }),
        detail: t("srv.obl.lastAssessed", { date: last }),
        companyId: r.companyId,
        due: addMonths(last, months),
        link: `/risks/${r.id}`,
        ...owner(r.ownerPositionId),
      });
    }
  }

  // podněty k přehodnocení rizika – incidenty, zjištění, změny, SOC, zranitelnosti… (ADR-058)
  if (want("risk_trigger")) {
    const rs = await db.select({ id: risks.id, code: risks.code, name: risks.name, companyId: risks.companyId, ownerPositionId: risks.ownerPositionId }).from(risks).where(and(inArray(risks.companyId, ids), ne(risks.status, "closed")));
    const trig = await riskTriggers(db, rs.map((r) => r.id));
    for (const r of rs) {
      const l = trig.get(r.id);
      if (!l?.length) continue;
      push({
        key: `risk_trigger:${r.id}`,
        kind: "risk_trigger",
        title: t("srv.obl.riskTrigger", { name: `${r.code ? `${r.code} ` : ""}${r.name}` }),
        detail: t("srv.obl.riskTriggerDetail", { n: l.length, kinds: [...new Set(l.map((x) => t.lbl(RISK_TRIGGER_LABELS.kind[x.kind])))].join(", ") }),
        companyId: r.companyId,
        due: triggerDue(l),
        link: `/risks/${r.id}`,
        ...owner(r.ownerPositionId),
      });
    }
  }

  // plánovaná cvičení (ADR-066)
  if (want("exercise")) {
    const ex = await db.select().from(exercises).where(and(inArray(exercises.companyId, ids), inArray(exercises.status, ["planned", "running"]), isNotNull(exercises.plannedAt)));
    for (const e of ex)
      push({
        key: `exercise:${e.id}`,
        kind: "exercise",
        title: t("srv.obl.exercise", { name: `${exerciseCode(e.seq)} ${e.title}` }),
        detail: t(e.status === "running" ? "srv.obl.exerciseRunning" : "srv.obl.exercisePlanned"),
        companyId: e.companyId,
        due: e.plannedAt,
        link: `/continuity/exercises/${e.id}`,
        ...owner(e.facilitatorPositionId),
      });
  }

  // certifikáty před vypršením (ADR-070)
  if (want("cert_expiry")) {
    const warn = (await getSettings(db)).tlsPolicy.warnDays;
    for (const e of await certExpiryItems(db, ids, Math.max(warn, o.leadDays)))
      push({
        key: `cert_expiry:${e.id}`,
        kind: "cert_expiry",
        title: t("srv.obl.certExpiry", { host: `${e.host}:${e.port}` }),
        detail: t("srv.obl.certExpiryDetail"),
        companyId: e.companyId,
        due: e.notAfter!.toISOString().slice(0, 10),
        link: "/assets/certificates",
        ...owner(null),
      });
  }

  // požadavky na podklady pro audit (ADR-071) – vlastník požadavku
  if (want("audit_request")) {
    for (const r of await auditRequestItems(db, ids))
      if (r.dueDate)
        push({
          key: `audit_request:${r.id}`,
          kind: "audit_request",
          title: t("srv.obl.auditRequest", { code: requestCode(r.seq), title: r.title }),
          detail: t(r.status === "returned" ? "srv.obl.auditRequestReturned" : "srv.obl.auditRequestOpen", { audit: r.auditTitle }),
          companyId: r.companyId,
          due: r.dueDate,
          link: `/audits/${r.auditId}`,
          ...owner(r.ownerPositionId),
        });
  }

  // nápravná opatření z auditů
  if (want("finding")) {
    const fs = await loadFindings(db, and(inArray(audits.companyId, ids), inArray(auditFindings.status, ["open", "in_progress"]), isNotNull(auditFindings.dueDate)));
    const co = new Map((await db.select({ id: audits.id, c: audits.companyId }).from(audits).where(inArray(audits.companyId, ids))).map((a) => [a.id, a.c]));
    for (const f of fs)
      push({
        key: `finding:${f.id}`,
        kind: "finding",
        title: `${f.code ? `${f.code} ` : ""}${f.title}`,
        detail: t("srv.obl.auditDetail", { name: f.auditCode ?? f.auditTitle }),
        companyId: co.get(f.auditId)!,
        due: f.dueDate,
        link: `/audits/${f.auditId}`,
        ...owner(f.ownerPositionId),
      });
  }

  // plánované audity
  if (want("audit")) {
    const as = await loadAudits(db, and(inArray(audits.companyId, ids), eq(audits.status, "planned")));
    for (const a of as)
      if (a.plannedStart)
        push({
          key: `audit:${a.id}`,
          kind: "audit",
          title: `${a.code ? `${a.code} ` : ""}${a.title}`,
          detail: t("srv.obl.auditStart"),
          companyId: a.companyId,
          due: a.plannedStart,
          link: `/audits/${a.id}`,
          ...owner(a._row.auditorPositionId),
        });
  }

  // přezkoumání ISMS (1× ročně)
  if (want("isms_review"))
    for (const id of o.companyIds) {
      const s = await reviewStatus(db, id);
      push({
        key: `isms_review:${id}`,
        kind: "isms_review",
        title: t("srv.obl.ismsReview"),
        detail: s.lastReview ? t("srv.obl.lastApproved", { date: s.lastReview.approvedAt.slice(0, 10) }) : t("srv.obl.neverDone"),
        companyId: id,
        due: s.nextReviewDue,
        urgency: s.lastReview ? undefined : "overdue",
        link: "/isms",
        ...owner(null),
      });
    }

  // významné změny před plánovaným nasazením s nesplněnými kroky § 11
  if (want("change")) {
    const cs = await loadChanges(db, and(inArray(changes.companyId, ids), notInArray(changes.status, ["closed", "rejected", "rolled_back", "implemented"])));
    for (const ch of cs)
      if (ch.significant && ch.plannedAt && ch.gaps.length)
        push({
          key: `change:${ch.id}`,
          kind: "change",
          title: `${ch.code ? `${ch.code} ` : ""}${ch.title}`,
          detail: t.lbl(ch.gaps[0] ?? null),
          companyId: ch.companyId,
          due: ch.plannedAt,
          link: `/isms/changes/${ch.id}`,
          ...owner(ch._row.ownerPositionId),
        });
  }

  // přezkum bezpečnostní dokumentace (§ 6 odst. 3)
  if (want("policy_review")) {
    const ps = await loadPolicies(db, and(inArray(policies.companyId, ids), ne(policies.status, "retired")), { withAck: false });
    for (const p of ps)
      if (p.item.nextReviewDue || !p.item.currentVersion)
        push({
          key: `policy_review:${p.item.id}`,
          kind: "policy_review",
          title: `${p.item.code ? `${p.item.code} ` : ""}${p.item.title}`,
          detail: p.item.currentVersion ? t("srv.obl.currentVersion", { version: p.item.currentVersion }) : t("srv.obl.noApprovedVersion"),
          companyId: p.item.companyId,
          due: p.item.nextReviewDue,
          urgency: p.item.currentVersion ? undefined : "soon",
          link: `/policies/${p.item.id}`,
          ...owner(p.item.ownerPositionId),
        });
  }

  // dokumenty v oběhu: věcná kontrola (vlastník procesu), schválení (schvalovatel), vrácené k přepracování (gestor)
  if (want("doc_approval")) {
    const rows = await db
      .select({ v: policyVersions, p: policies })
      .from(policyVersions)
      .innerJoin(policies, eq(policies.id, policyVersions.policyId))
      .where(and(inArray(policies.companyId, ids), inArray(policyVersions.status, ["draft", "review", "approval"])));
    // poslední akce ve workflow každé verze (vrácená verze čeká na gestora)
    const lastAction = new Map<string, string>();
    if (rows.length)
      for (const e of await db
        .select({ versionId: policyEvents.versionId, action: policyEvents.action })
        .from(policyEvents)
        .where(and(inArray(policyEvents.versionId, rows.map((r) => r.v.id)), inArray(policyEvents.action, [...POLICY_WORKFLOW_ACTIONS])))
        .orderBy(policyEvents.at))
        lastAction.set(e.versionId, e.action);
    for (const { v, p } of rows) {
      const name = t("srv.obl.docVersion", { name: `${p.code ? `${p.code} ` : ""}${p.title}`, version: v.version });
      const sent = v.submittedAt ? v.submittedAt.toISOString().slice(0, 10) : null;
      if (v.status === "review")
        push({ key: `doc_approval:${v.id}:review`, kind: "doc_approval", title: name, detail: t("srv.obl.docReview"), companyId: p.companyId, due: sent, urgency: "soon", link: `/policies/${p.id}`, ...owner(p.reviewerPositionId) });
      else if (v.status === "approval")
        push({ key: `doc_approval:${v.id}:approval`, kind: "doc_approval", title: name, detail: t("srv.obl.docApproval"), companyId: p.companyId, due: sent, urgency: "soon", link: `/policies/${p.id}`, ...owner(p.approverPositionId) });
      else if (lastAction.get(v.id) === "return")
        push({ key: `doc_approval:${v.id}:returned`, kind: "doc_approval", title: name, detail: t("srv.obl.docReturned"), companyId: p.companyId, due: null, urgency: "soon", link: `/policies/${p.id}`, ...owner(p.ownerPositionId) });
    }
  }

  // skartační lhůty zrušených dokumentů (gestor / správce dokumentace) – připomíná se před uplynutím lhůty
  if (want("doc_retention")) {
    const rows = await db.select().from(policies).where(and(inArray(policies.companyId, ids), eq(policies.status, "retired"), isNull(policies.disposedAt)));
    for (const p of rows) {
      const r = retentionFor(p);
      if (!r.dueAt) continue;
      push({
        key: `doc_retention:${p.id}`,
        kind: "doc_retention",
        title: `${p.code ? `${p.code} ` : ""}${p.title}`,
        detail: t(r.mark === "A" ? "srv.obl.retentionArchive" : r.mark === "V" ? "srv.obl.retentionSelect" : "srv.obl.retentionShred", { mark: r.mark, years: r.years }),
        companyId: p.companyId,
        due: r.dueAt,
        link: `/policies/${p.id}`,
        ...owner(p.ownerPositionId),
      });
    }
  }

  // přezkum přístupů – jedna povinnost na kampaň a funkční místo recenzenta s nerozhodnutými položkami
  if (want("access_review")) {
    const rows = await db
      .select({ id: accessReviews.id, name: accessReviews.name, companyId: accessReviews.companyId, due: accessReviews.dueDate, pos: accessReviewItems.reviewerPositionId, n: sql<number>`count(*)::int` })
      .from(accessReviewItems)
      .innerJoin(accessReviews, eq(accessReviews.id, accessReviewItems.reviewId))
      .where(and(inArray(accessReviews.companyId, ids), eq(accessReviews.status, "active"), eq(accessReviewItems.decision, "pending")))
      .groupBy(accessReviews.id, accessReviews.name, accessReviews.companyId, accessReviews.dueDate, accessReviewItems.reviewerPositionId);
    for (const r of rows)
      push({
        key: `access_review:${r.id}:${r.pos ?? "none"}`,
        kind: "access_review",
        title: r.name,
        detail: t("srv.obl.accessReview", { n: r.n }),
        companyId: r.companyId,
        due: r.due,
        link: `/identity/reviews/${r.id}`,
        ...owner(r.pos),
      });
  }

  // legislativa – posouzení dopadu nových znění a úkoly z nich
  if (want("legal_review")) {
    const rows = await db
      .select({ id: legalReviews.id, companyId: legalReviews.companyId, due: legalReviews.dueDate, pos: legalReviews.ownerPositionId, code: legalActs.code, to: legalVersions.versionKey })
      .from(legalReviews)
      .innerJoin(legalChanges, eq(legalChanges.id, legalReviews.changeId))
      .innerJoin(legalActs, eq(legalActs.id, legalChanges.actId))
      .innerJoin(legalVersions, eq(legalVersions.id, legalChanges.toVersionId))
      .where(and(inArray(legalReviews.companyId, ids), inArray(legalReviews.status, ["new", "in_review"])));
    for (const r of rows)
      push({
        key: `legal_review:${r.id}`,
        kind: "legal_review",
        title: t("srv.obl.legalChange", { code: r.code }),
        detail: t("srv.obl.legalReview", { version: r.to }),
        companyId: r.companyId,
        due: r.due,
        link: `/legislation/reviews/${r.id}`,
        ...owner(r.pos),
      });
  }
  if (want("legal_task")) {
    const rows = await db.select().from(legalTasks).where(and(inArray(legalTasks.companyId, ids), eq(legalTasks.status, "open")));
    for (const lt of rows)
      push({
        key: `legal_task:${lt.id}`,
        kind: "legal_task",
        title: lt.title,
        detail: t("srv.obl.legalTask"),
        companyId: lt.companyId,
        due: lt.dueDate,
        link: lt.reviewId ? `/legislation/reviews/${lt.reviewId}` : "/legislation",
        ...owner(lt.ownerPositionId),
      });
  }

  // informační servis (ADR-088) – posouzení varování / upozornění NÚKIB s odpovědným místem a termínem
  if (want("info_assessment")) {
    const rows = await db
      .select({ id: infoItemReviews.id, companyId: infoItemReviews.companyId, due: infoItemReviews.dueDate, pos: infoItemReviews.ownerPositionId, title: infoFeedItems.title })
      .from(infoItemReviews)
      .innerJoin(infoFeedItems, eq(infoFeedItems.id, infoItemReviews.itemId))
      .where(and(inArray(infoItemReviews.companyId, ids), inArray(infoItemReviews.status, ["assessing", "affected"]), isNotNull(infoItemReviews.dueDate)));
    for (const r of rows)
      push({
        key: `info_assessment:${r.id}`,
        kind: "info_assessment",
        title: r.title.slice(0, 200),
        detail: t("srv.obl.infoAssessment"),
        companyId: r.companyId,
        due: r.due,
        link: "/infoservice",
        ...owner(r.pos),
      });
  }

  // výjimky s termínem (nálezy identit, SoD, zranitelnosti) – blížící se / uplynulý konec platnosti
  if (want("exception_expiry")) {
    // okno „brzy vyprší“ alespoň 30 dnů (prodloužení výjimky potřebuje čas na nové posouzení)
    for (const e of await loadExceptions(db, exceptionScope(o.kinds, ids)))
      if (e.until) push({ ...exceptionObligation(e, t), urgency: urgencyOf(e.until, Math.max(o.leadDays, EXCEPTION_LEAD_DAYS + 1), now) });
  }

  // testy plánů kontinuity
  if (want("plan_test")) {
    const ps = await db.select().from(continuityPlans).where(and(inArray(continuityPlans.companyId, ids), eq(continuityPlans.status, "approved")));
    if (ps.length) {
      const last = await db
        .select({ planId: planTests.planId, at: sql<string>`max(${planTests.testedAt})::text` })
        .from(planTests)
        .where(inArray(planTests.planId, ps.map((p) => p.id)))
        .groupBy(planTests.planId);
      const lastBy = new Map(last.map((l) => [l.planId, l.at]));
      for (const p of ps) {
        const base = lastBy.get(p.id) ?? p.approvedAt?.toISOString().slice(0, 10);
        if (!base) continue;
        push({
          key: `plan_test:${p.id}`,
          kind: "plan_test",
          title: `${p.code ? `${p.code} ` : ""}${p.name}`,
          detail: lastBy.get(p.id) ? t("srv.obl.lastTest", { date: lastBy.get(p.id)! }) : t("srv.obl.neverTested"),
          companyId: p.companyId,
          due: addMonths(base, p.testIntervalMonths),
          link: `/continuity/plans/${p.id}`,
          ...owner(p.ownerPositionId),
        });
      }
    }
  }

  // konec platnosti smluv s dodavateli
  if (want("contract")) {
    const rows = await db
      .select({ k: supplierContracts, s: suppliers })
      .from(supplierContracts)
      .innerJoin(suppliers, eq(suppliers.id, supplierContracts.supplierId))
      .where(and(inArray(suppliers.companyId, ids), isNotNull(supplierContracts.validTo), eq(suppliers.status, "active")));
    for (const { k, s } of rows)
      push({
        key: `contract:${k.id}`,
        kind: "contract",
        title: `${s.name} – ${k.title}`,
        detail: k.number ? t("srv.obl.contractNo", { number: k.number }) : null,
        companyId: s.companyId,
        due: k.validTo,
        link: `/suppliers/${s.id}`,
        ...owner(null),
      });
  }

  // bezpečnostní dotazníky dodavatelů: čeká na dodavatele (termín = platnost odkazu), vyplněno = k vyhodnocení
  if (want("supplier_questionnaire")) {
    const rows = await db
      .select({ q: supplierQuestionnaires, s: suppliers })
      .from(supplierQuestionnaires)
      .innerJoin(suppliers, eq(suppliers.id, supplierQuestionnaires.supplierId))
      .where(and(inArray(supplierQuestionnaires.companyId, ids), inArray(supplierQuestionnaires.status, ["sent", "submitted"])));
    for (const { q, s } of rows) {
      const submitted = q.status === "submitted";
      push({
        key: `supplier_questionnaire:${q.id}:${q.status}`,
        kind: "supplier_questionnaire",
        title: `${s.name} – ${q.title}`,
        detail: t(submitted ? "srv.obl.sqEvaluate" : "srv.obl.sqWaiting"),
        companyId: q.companyId,
        due: submitted ? q.submittedAt!.toISOString().slice(0, 10) : q.expiresAt.toISOString().slice(0, 10),
        ...(submitted ? { urgency: "soon" as const } : {}),
        link: `/suppliers/${s.id}`,
        ...owner(null),
      });
    }
  }

  // platnost zpráv o ujištění dodavatelů (ADR-098) – jen nejnovější zpráva dodavatele daného druhu
  if (want("supplier_report")) {
    const rows = await db
      .select({ r: supplierReports, s: suppliers })
      .from(supplierReports)
      .innerJoin(suppliers, eq(suppliers.id, supplierReports.supplierId))
      .where(and(inArray(supplierReports.companyId, ids), isNotNull(supplierReports.validUntil), eq(suppliers.status, "active")));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const x of rows) {
      const k = `${x.r.supplierId}|${x.r.kind}`;
      const prev = latest.get(k);
      if (!prev || (x.r.validUntil ?? "") > (prev.r.validUntil ?? "")) latest.set(k, x);
    }
    for (const { r, s } of latest.values())
      push({
        key: `supplier_report:${r.id}`,
        kind: "supplier_report",
        title: `${s.name} – ${r.title}`,
        detail: t("srv.obl.supplierReport"),
        companyId: r.companyId,
        due: r.validUntil!,
        link: `/suppliers/reports/${r.id}`,
        ...owner(null),
      });
  }

  // lhůty SOC (ADR-047) – převzetí a vyřešení otevřených alertů a případů
  if (want("vuln_remediation"))
    for (const { ownerUserId: _o, ...i } of await vulnRemediationItems(db, o.companyIds, t)) {
      const urgency = urgencyOf(i.due, o.leadDays, now);
      if (o.includeLater || urgency !== "later") out.push({ ...i, urgency });
    }
  if (want("soc_sla"))
    for (const { assigneeId: _a, ...i } of await socSlaItems(db, o.companyIds, o.leadDays, now, t)) if (o.includeLater || i.urgency !== "later") out.push(i);

  // úkoly (ADR-043) – nedokončené s termínem, odpovídá funkční místo vlastníka
  if (want("task")) {
    const rows = await db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.companyId, ids), inArray(tasks.status, ["open", "in_progress"]), isNotNull(tasks.dueDate)));
    for (const r of rows)
      push({
        key: `task:${r.id}`,
        kind: "task",
        title: r.title,
        detail: t("srv.obl.taskDetail", { code: `#${r.seq}` }),
        companyId: r.companyId,
        due: r.dueDate,
        link: `/actions?task=${r.id}`,
        ...owner(r.ownerPositionId),
      });
  }

  // pravidelné (roční) hodnocení rizik a BIA
  if (want("assessment_cycle")) {
    const mods = o.kinds ? kindsMods.get(o.kinds) : undefined;
    const kinds: ("risk" | "bia")[] = [];
    if (!mods || mods.has("risks")) kinds.push("risk");
    if (!mods || mods.has("continuity")) kinds.push("bia");
    for (const id of o.companyIds)
      for (const kind of kinds) {
        const st = await cycleStatus(db, id, kind);
        const label = kind === "risk" ? t("srv.obl.cycleRisk") : t("srv.obl.cycleBia");
        if (st.runningId) {
          const [cy] = await db.select().from(assessmentCycles).where(eq(assessmentCycles.id, st.runningId));
          push({
            key: `assessment_cycle:${cy!.id}`,
            kind: "assessment_cycle",
            title: cy!.title,
            detail: t(cy!.status === "review" ? "srv.obl.cycleAwaiting" : "srv.obl.cycleRunning", { label }),
            companyId: id,
            due: cy!.dueDate,
            link: `/cycles/${cy!.id}`,
            ...owner(cy!.leaderPositionId),
          });
        } else
          push({
            key: `assessment_cycle:${id}:${kind}`,
            kind: "assessment_cycle",
            title: label,
            detail: st.lastApprovedAt ? t("srv.obl.lastApproved", { date: st.lastApprovedAt.slice(0, 10) }) : t("srv.obl.neverDone"),
            companyId: id,
            due: st.nextDue,
            urgency: st.lastApprovedAt ? undefined : "overdue",
            link: kind === "risk" ? "/risks/cycles" : "/bia/cycles",
            ...owner(null),
          });
      }
  }

  // plánované testy opatření
  if (want("control_test")) {
    const rows = await db
      .select({ t: controlTests, c: controls })
      .from(controlTests)
      .innerJoin(controls, eq(controls.id, controlTests.controlId))
      .where(and(inArray(controlTests.companyId, ids), inArray(controlTests.status, ["planned", "in_progress"]), isNotNull(controlTests.dueDate)));
    for (const { t: ct, c } of rows)
      push({
        key: `control_test:${ct.id}`,
        kind: "control_test",
        title: `${c.code ? `${c.code} ` : ""}${c.name}`,
        detail: `${ct.kind === "design" ? t("srv.obl.testDesign") : t("srv.obl.testOperating")}${ct.tester ? ` · ${ct.tester}` : ""}`,
        companyId: ct.companyId,
        due: ct.dueDate,
        link: `/controls/tests/${ct.id}`,
        ...owner(c.ownerPositionId),
      });
  }

  // pravidelný přezkum činností zpracování (GDPR) a DPIA
  if (want("processing_review")) {
    const rows = await db
      .select()
      .from(processingActivities)
      .where(and(inArray(processingActivities.companyId, ids), inArray(processingActivities.status, ["active", "draft"])));
    const dp = rows.length ? await db.select().from(dpias).where(inArray(dpias.activityId, rows.map((r) => r.id))) : [];
    for (const a of rows) {
      push({
        key: `processing_review:${a.id}`,
        kind: "processing_review",
        title: `${a.code ? `${a.code} ` : ""}${a.name}`,
        detail: a.lastReviewedAt ? t("srv.obl.lastReviewed", { date: a.lastReviewedAt }) : t("srv.obl.neverReviewed"),
        companyId: a.companyId,
        due: activityNextReview(a),
        link: `/gdpr/${a.id}`,
        ...owner(a.ownerPositionId),
      });
      const d = dp.find((x) => x.activityId === a.id);
      if (d?.nextReview)
        push({
          key: `processing_review:dpia:${d.id}`,
          kind: "processing_review",
          title: `DPIA – ${a.name}`,
          detail: t("srv.obl.dpiaReview"),
          companyId: a.companyId,
          due: d.nextReview,
          link: `/gdpr/${a.id}`,
          ...owner(a.ownerPositionId),
        });
    }
  }

  // přezkum AI systémů a FRIA (AI Act, ADR-090)
  if (want("ai_review")) {
    const rows = await db
      .select()
      .from(aiSystems)
      .where(and(inArray(aiSystems.companyId, ids), inArray(aiSystems.status, ["proposed", "approved", "in_use"])));
    for (const a of rows) {
      const due = aiNextReview(a);
      if (due && a.status !== "proposed")
        push({
          key: `ai_review:${a.id}`,
          kind: "ai_review",
          title: `${a.code ? `${a.code} ` : ""}${a.name}`,
          detail: a.lastReviewedAt ? t("srv.obl.lastReviewed", { date: a.lastReviewedAt }) : t("srv.obl.neverReviewed"),
          companyId: a.companyId,
          due,
          link: `/aiact/${a.id}`,
          ...owner(a.ownerPositionId),
        });
      const fr = a.fria as { nextReview?: string | null } | null;
      if (a.friaStatus === "completed" && fr?.nextReview)
        push({
          key: `ai_review:fria:${a.id}`,
          kind: "ai_review",
          title: `FRIA – ${a.name}`,
          detail: t("srv.obl.friaReview"),
          companyId: a.companyId,
          due: fr.nextReview,
          link: `/aiact/${a.id}`,
          ...owner(a.ownerPositionId),
        });
    }
  }

  // CRA: lhůty hlášení čl. 14 a konec podpůrného období (ADR-092)
  if (want("cra_report")) {
    const rows = await db
      .select({ r: craReports, p: craProducts })
      .from(craReports)
      .innerJoin(craProducts, eq(craProducts.id, craReports.productId))
      .where(and(inArray(craReports.companyId, ids), eq(craReports.closed, false)));
    for (const { r, p } of rows) {
      const next = reportDto(r, p.name).deadlines.find((d) => !d.doneAt && d.due);
      if (!next) continue;
      push({
        key: `cra_report:${r.id}`,
        kind: "cra_report",
        title: `${p.name} – ${r.title}`,
        detail: t(`srv.obl.cra.${next.stage}` as "srv.obl.cra.early"),
        companyId: r.companyId,
        due: next.due!.slice(0, 10),
        link: `/cra/${p.id}`,
        ...owner(p.ownerPositionId),
      });
    }
  }
  if (want("cra_support")) {
    const rows = await db
      .select()
      .from(craProducts)
      .where(and(inArray(craProducts.companyId, ids), eq(craProducts.status, "on_market"), isNotNull(craProducts.supportUntil)));
    for (const p of rows)
      push({
        key: `cra_support:${p.id}`,
        kind: "cra_support",
        title: `${p.name}${p.version ? ` ${p.version}` : ""}`,
        detail: t("srv.obl.craSupport"),
        companyId: p.companyId,
        due: p.supportUntil!,
        link: `/cra/${p.id}`,
        ...owner(p.ownerPositionId),
      });
  }

  // konec platnosti důkazů
  if (want("evidence_expiry")) {
    const rows = await db
      .select()
      .from(evidence)
      .where(and(inArray(evidence.companyId, ids), isNotNull(evidence.validUntil)));
    for (const e of rows)
      push({
        key: `evidence_expiry:${e.id}`,
        kind: "evidence_expiry",
        title: e.title,
        detail: t("srv.obl.evidenceRenew"),
        companyId: e.companyId,
        due: e.validUntil,
        link: `/controls/evidence/${e.id}`,
        ...owner(null),
      });
  }

  const order = { overdue: 0, today: 1, soon: 2, later: 3 } as const;
  return out.sort((a, b) => order[a.urgency] - order[b.urgency] || (a.due ?? "9").localeCompare(b.due ?? "9"));
}

const ackDue = (approvedAt: string, days: number) => {
  const d = new Date(approvedAt);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Osobní povinnosti: položky odpovědných míst uživatele + seznámení s dokumenty + školení. */
export async function personalObligations(db: Db, userId: string, leadDays: number, enabled: string[], now = new Date(), includeLater = true, t: Translate = CS_T): Promise<ObligationItem[]> {
  const mine = await db.select({ p: positionHolders.positionId }).from(positionHolders).where(eq(positionHolders.userId, userId));
  const myPos = new Set(mine.map((m) => m.p));
  const all = (await getCompanies(db)).filter((c) => c.active).map((c) => c.id);
  const kinds = kindsForModules(enabled);
  const owned = myPos.size ? (await collectObligations(db, { companyIds: all, leadDays, now, kinds, includeLater, t })).filter((x) => x.ownerPositionId && myPos.has(x.ownerPositionId)) : [];
  const out = [...owned];
  // výjimky, které uživatel udělil – upozornění před koncem platnosti
  if (kinds.has("exception_expiry"))
    for (const e of await loadExceptions(db, exceptionScope(kinds, all))) {
      if (!e.until || e.acceptedById !== userId) continue;
      const urgency = urgencyOf(e.until, Math.max(leadDays, EXCEPTION_LEAD_DAYS + 1), now);
      if (urgency !== "later") out.push({ ...exceptionObligation(e, t), urgency });
    }
  // opravy zranitelností na aktivech, jejichž je uživatel garantem (vlastníkem)
  if (kinds.has("vuln_remediation"))
    for (const { ownerUserId, ...i } of await vulnRemediationItems(db, all, t)) {
      if (ownerUserId !== userId) continue;
      const urgency = urgencyOf(i.due, leadDays, now);
      if (includeLater || urgency !== "later") out.push({ ...i, urgency });
    }
  // alerty a případy SOC přidělené uživateli
  if (kinds.has("soc_sla")) for (const { assigneeId, ...i } of await socSlaItems(db, all, leadDays, now, t)) if (assigneeId === userId) out.push(i);
  if (enabled.includes("policies")) {
    for (const p of await loadPolicies(db, and(eq(policies.status, "active"), eq(policies.requireAcknowledgement, true)))) {
      if (!p.current || p.ackSet.has(userId) || !p.members.some((m) => m.userId === userId)) continue;
      out.push({
        key: `policy_ack:${p.current.v.id}:${userId}`,
        kind: "policy_ack",
        title: t("srv.obl.docVersion", { name: `${p.item.code ? `${p.item.code} ` : ""}${p.item.title}`, version: p.current.v.version }),
        detail: t("srv.obl.ackConfirm"),
        companyId: p.item.companyId,
        due: p.item.approvedAt ? ackDue(p.item.approvedAt, p.row.ackDueDays) : null,
        urgency: p.item.approvedAt && ackDue(p.item.approvedAt, p.row.ackDueDays) < now.toISOString().slice(0, 10) ? "overdue" : "soon",
        link: `/docs/${p.item.id}`,
        ownerPositionId: null,
        ownerName: null,
      });
    }
  }
  if (enabled.includes("awareness")) {
    for (const c of await loadCourses(db, eq(trainingCourses.active, true))) {
      const me = c.people.find((p) => p.userId === userId);
      if (!me || me.state === "ok") continue;
      const urgency = urgencyOf(me.dueDate, leadDays, now);
      out.push({
        key: `training:${c.row.id}:${userId}`,
        kind: "training",
        title: `${c.row.code ? `${c.row.code} ` : ""}${c.row.title}`,
        detail: me.lastCompleted ? t("srv.obl.lastCompleted", { date: me.lastCompleted }) : t("srv.obl.neverCompleted"),
        companyId: c.row.companyId,
        due: me.dueDate,
        urgency: me.state === "overdue" ? "overdue" : urgency === "later" ? "soon" : urgency,
        link: "/my",
        ownerPositionId: null,
        ownerName: null,
      });
    }
  }
  const order = { overdue: 0, today: 1, soon: 2, later: 3 } as const;
  return out.sort((a, b) => order[a.urgency] - order[b.urgency]);
}

export const kindLabel = (k: ObligationKind) => OBLIGATION_LABELS[k];
