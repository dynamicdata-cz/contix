import {
  SOC_ACTION_LABELS,
  SOC_IOC_LABELS,
  SOC_LABELS,
  appendLines,
  defang,
  effectiveLevel,
  iocState,
  mergeTimeline,
  socSeverity,
  type IncidentSocAction,
  type IncidentSocDraft,
  type IncidentSocEvidence,
  type SocActionKind,
  type SocActionStatus,
  type SocIocAction,
  type SocIocType,
  type SocVerdict,
  type TimelineEntry,
  type Translate,
} from "@contix/shared";
import { asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, socActions, socCases, socIocs, users } from "../../db/schema";
import { CS_T } from "../i18n/service";
import { caseCode } from "./service";

/* ============================================================
 * Incident × SOC (ADR-056): podklady ze SOC k incidentu a návrh doplnění záznamu. Nic se nezapisuje –
 * návrh převezme člověk do formuláře incidentu a uloží ho.
 * ============================================================ */

const loc = (t: Translate) => (t.locale === "cs" ? "cs-CZ" : t.locale);
const dt = (v: Date | string | null, t: Translate) => (v ? new Date(v).toLocaleString(loc(t), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }) : "—");

/** Alerty eskalované na incident (přímo nebo přes případ), jejich IOC a zásahy. */
export async function socEvidenceFor(db: Db, incidentId: string): Promise<IncidentSocEvidence> {
  const cases = await db.select({ id: socCases.id, seq: socCases.seq, title: socCases.title, status: socCases.status }).from(socCases).where(eq(socCases.incidentId, incidentId));
  const caseIds = cases.map((x) => x.id);
  const rows0 = await db
    .select({ a: alertSuggestions, assetName: assets.name })
    .from(alertSuggestions)
    .leftJoin(assets, eq(assets.id, alertSuggestions.assetId))
    .where(caseIds.length ? or(eq(alertSuggestions.incidentId, incidentId), inArray(alertSuggestions.caseId, caseIds)) : eq(alertSuggestions.incidentId, incidentId))
    .orderBy(asc(alertSuggestions.firstSeen))
    .limit(500);
  const rows = rows0.map((x) => ({ ...x.a, assetName: x.assetName }));
  const alertIds = rows.map((r) => r.id);
  const seqOf = new Map(cases.map((x) => [x.id, x.seq]));
  const iocRows = alertIds.length ? await db.select().from(socIocs).where(inArray(socIocs.sourceAlertId, alertIds)).orderBy(asc(socIocs.type), asc(socIocs.value)) : [];
  const rq = alias(users, "rq");
  const dc = alias(users, "dc");
  const ex = alias(users, "ex");
  const conds = [alertIds.length ? inArray(socActions.alertId, alertIds) : undefined, caseIds.length ? inArray(socActions.caseId, caseIds) : undefined].filter(Boolean);
  const actRows = conds.length
    ? await db
        .select({ a: socActions, rq: rq.displayName, dc: dc.displayName, ex: ex.displayName })
        .from(socActions)
        .leftJoin(rq, eq(rq.id, socActions.requestedById))
        .leftJoin(dc, eq(dc.id, socActions.decidedById))
        .leftJoin(ex, eq(ex.id, socActions.executedById))
        .where(or(...conds))
        .orderBy(asc(socActions.createdAt))
    : [];
  const today = new Date().toISOString().slice(0, 10);
  return {
    cases: cases.map((x) => ({ id: x.id, code: caseCode(x.seq), title: x.title, status: x.status })),
    alerts: rows.map((r) => ({
      id: r.id,
      title: r.title ?? r.description,
      source: r.source,
      ruleId: r.ruleId,
      severity: socSeverity(effectiveLevel(r.ruleLevel, r.exposure)),
      count: r.count,
      firstSeen: r.firstSeen.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
      agentName: r.agentName,
      assetId: r.assetId,
      assetName: r.assetName,
      verdict: (r.verdict as SocVerdict | null) ?? (r.status === "accepted" ? "true_positive" : null),
      mitreIds: r.mitreIds,
      caseCode: r.caseId && seqOf.has(r.caseId) ? caseCode(seqOf.get(r.caseId)!) : null,
    })),
    iocs: iocRows.map((i) => ({ id: i.id, type: i.type as SocIocType, value: i.value, display: defang(i.type as SocIocType, i.value), action: i.action as SocIocAction, state: iocState({ revokedAt: i.revokedAt, validUntil: i.validUntil }, today) })),
    actions: actRows.map(({ a, rq: r, dc: d, ex: e }): IncidentSocAction => ({
      id: a.id,
      kind: a.kind as SocActionKind,
      target: a.target,
      status: a.status as SocActionStatus,
      reason: a.reason,
      requestedByName: r,
      createdAt: a.createdAt.toISOString(),
      decidedByName: d,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      decisionNote: a.decisionNote,
      executedByName: e,
      executedAt: a.executedAt?.toISOString() ?? null,
      result: a.result,
    })),
    techniques: [...new Set(rows.flatMap((r) => r.mitreIds))],
    firstSeen: rows.length ? new Date(Math.min(...rows.map((r) => r.firstSeen.getTime()))).toISOString() : null,
    lastSeen: rows.length ? new Date(Math.max(...rows.map((r) => r.lastSeen.getTime()))).toISOString() : null,
  };
}

/** Návrh doplnění polí incidentu z podkladů SOC (jen řádky, které v záznamu ještě nejsou). */
export function socDraftFor(
  inc: { occurredAt: string | null; indicators: string | null; evidence: string | null; containment: string | null; timeline: TimelineEntry[]; assetIds: string[] },
  ev: IncidentSocEvidence,
  t: Translate = CS_T,
): IncidentSocDraft {
  const src = (s: string) => t.lbl(SOC_LABELS.source[s] ?? s);
  const evidence = appendLines(
    inc.evidence,
    t("srv.incSoc.evidenceHead"),
    ev.alerts.map((a) =>
      t("srv.incSoc.evidenceLine", {
        title: a.title,
        src: src(a.source),
        rule: a.ruleId,
        n: a.count,
        from: dt(a.firstSeen, t),
        to: dt(a.lastSeen, t),
        host: a.agentName ?? "—",
        mitre: a.mitreIds.join(", ") || "—",
      }),
    ),
  );
  const indicators = appendLines(
    inc.indicators,
    t("srv.incSoc.iocHead"),
    ev.iocs.map((i) => t("srv.incSoc.iocLine", { type: t.lbl(SOC_IOC_LABELS.type[i.type]), value: i.display, action: t.lbl(SOC_IOC_LABELS.action[i.action]), state: t.lbl(SOC_IOC_LABELS.state[i.state]) })),
  );
  const finished = ev.actions.filter((a) => a.status === "done" || a.status === "failed");
  const containment = appendLines(
    inc.containment,
    t("srv.incSoc.actionsHead"),
    finished.map((a) =>
      t("srv.incSoc.actionLine", {
        kind: t.lbl(SOC_ACTION_LABELS.kind[a.kind]),
        target: a.target,
        approver: a.decidedByName ?? "—",
        executor: a.executedByName ?? "—",
        at: dt(a.executedAt, t),
        result: a.status === "done" ? (a.result ?? t.lbl(SOC_ACTION_LABELS.status.done)) : `${t.lbl(SOC_ACTION_LABELS.status.failed)}: ${a.result ?? ""}`,
      }),
    ),
  );
  const tl: TimelineEntry[] = [];
  for (const a of ev.alerts) tl.push({ at: a.firstSeen, text: t("srv.incSoc.tlAlert", { title: a.title, src: src(a.source) }) });
  for (const a of ev.actions) {
    tl.push({ at: a.createdAt, text: t("srv.incSoc.tlProposed", { kind: t.lbl(SOC_ACTION_LABELS.kind[a.kind]), target: a.target, who: a.requestedByName ?? "—" }) });
    if (a.decidedAt) tl.push({ at: a.decidedAt, text: t(a.status === "rejected" ? "srv.incSoc.tlRejected" : "srv.incSoc.tlApproved", { kind: t.lbl(SOC_ACTION_LABELS.kind[a.kind]), target: a.target, who: a.decidedByName ?? "—" }) });
    if (a.executedAt) tl.push({ at: a.executedAt, text: t(a.status === "done" ? "srv.incSoc.tlDone" : "srv.incSoc.tlFailed", { kind: t.lbl(SOC_ACTION_LABELS.kind[a.kind]), target: a.target, who: a.executedByName ?? "—" }) });
  }
  const occurred = ev.firstSeen && (!inc.occurredAt || ev.firstSeen < inc.occurredAt) ? ev.firstSeen : null;
  return {
    occurredAt: occurred,
    indicators,
    evidence,
    containment,
    timeline: mergeTimeline(inc.timeline, tl),
    assets: [...new Map(ev.alerts.filter((a) => a.assetId && !inc.assetIds.includes(a.assetId)).map((a) => [a.assetId!, { id: a.assetId!, name: a.assetName ?? a.assetId! }])).values()],
  };
}
