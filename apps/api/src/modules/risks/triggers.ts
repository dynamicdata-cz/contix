import type { RiskTrigger } from "@contix/shared";
import { KRI_META, RISK_APPETITE_LABELS, RISK_SCENARIO_LABELS, templateByKey, type KriKey } from "@contix/shared";
import { and, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import {
  alertSuggestions,
  assets,
  assetVulnerabilities,
  auditFindings,
  changeAssets,
  changeRisks,
  changes,
  controls,
  controlMonitorRuns,
  kriSettings,
  controlMonitors,
  controlTests,
  incidentAssets,
  incidentRisks,
  incidents,
  riskAssets,
  riskControls,
  riskScenarioProposals,
  risks,
  supplierQuestionnaires,
  supplierRisks,
  suppliers,
  vulnIntel,
} from "../../db/schema";
import { vulnPrioritySql } from "../vulnerabilities/intel";

/* ============================================================
 * Podněty k přehodnocení rizik (ADR-058) – dávkově pro více rizik, počítá se při čtení.
 * Základ = poslední hodnocení nebo rozhodnutí vlastníka (potvrzení beze změny); bez nich založení rizika.
 * ============================================================ */

/** Od kdy se podněty počítají. */
export const riskBaselineSql = sql<Date>`coalesce(greatest(${risks.assessedAt}, ${risks.reviewedAt}), ${risks.createdAt})`;
export const riskBaseline = (r: { assessedAt: Date | null; reviewedAt: Date | null; createdAt: Date }) => {
  const xs = [r.assessedAt, r.reviewedAt].filter((d): d is Date => !!d);
  return xs.length ? new Date(Math.max(...xs.map((d) => d.getTime()))) : r.createdAt;
};

const iso = (d: Date | string | null) => (d == null ? new Date(0).toISOString() : new Date(d).toISOString());

/** Podněty pro zadaná rizika (uzavřená rizika se přeskočí). Výsledek: riskId → podněty seřazené od nejnovějšího. */
export async function riskTriggers(db: Db, riskIds: string[]): Promise<Map<string, RiskTrigger[]>> {
  const out = new Map<string, RiskTrigger[]>();
  if (!riskIds.length) return out;
  const add = (riskId: string, t: RiskTrigger) => {
    const l = out.get(riskId) ?? [];
    l.push(t);
    out.set(riskId, l);
  };
  const inRisks = and(inArray(risks.id, riskIds), ne(risks.status, "closed"));
  const base = riskBaselineSql;

  const [incDirect, incAsset, findings, chDirect, chAsset, soc, vulns, tests, expired, quest, scen, mons, kris] = await Promise.all([
    // incidenty navázané na riziko
    db
      .select({ riskId: risks.id, id: incidents.id, code: incidents.code, title: incidents.title, kind: incidents.kind, at: incidents.detectedAt })
      .from(incidentRisks)
      .innerJoin(incidents, eq(incidents.id, incidentRisks.incidentId))
      .innerJoin(risks, eq(risks.id, incidentRisks.targetId))
      .where(and(inRisks, ne(incidents.kind, "event"), gt(incidents.detectedAt, base))),
    // incidenty na aktivech rizika
    db
      .select({ riskId: risks.id, id: incidents.id, code: incidents.code, title: incidents.title, kind: incidents.kind, at: incidents.detectedAt })
      .from(riskAssets)
      .innerJoin(risks, eq(risks.id, riskAssets.riskId))
      .innerJoin(incidentAssets, eq(incidentAssets.targetId, riskAssets.assetId))
      .innerJoin(incidents, and(eq(incidents.id, incidentAssets.incidentId), eq(incidents.companyId, risks.companyId)))
      .where(and(inRisks, ne(incidents.kind, "event"), gt(incidents.detectedAt, base))),
    // zjištění auditů (závažná a méně závažná neshoda)
    db
      .select({ riskId: risks.id, id: auditFindings.id, auditId: auditFindings.auditId, code: auditFindings.code, title: auditFindings.title, severity: auditFindings.severity, at: auditFindings.createdAt })
      .from(auditFindings)
      .innerJoin(risks, eq(risks.id, auditFindings.riskId))
      .where(and(inRisks, inArray(auditFindings.severity, ["major", "minor"]), gt(auditFindings.createdAt, base))),
    // významné změny navázané na riziko
    db
      .select({ riskId: risks.id, id: changes.id, code: changes.code, title: changes.title, at: sql<Date>`coalesce(${changes.implementedAt}::timestamptz, ${changes.approvedAt})` })
      .from(changeRisks)
      .innerJoin(changes, eq(changes.id, changeRisks.changeId))
      .innerJoin(risks, eq(risks.id, changeRisks.targetId))
      .where(and(inRisks, eq(changes.significant, true), inArray(changes.status, ["approved", "implemented", "closed"]), gt(sql`coalesce(${changes.implementedAt}::timestamptz, ${changes.approvedAt})`, base))),
    // významné změny aktiv rizika
    db
      .select({ riskId: risks.id, id: changes.id, code: changes.code, title: changes.title, at: sql<Date>`coalesce(${changes.implementedAt}::timestamptz, ${changes.approvedAt})` })
      .from(riskAssets)
      .innerJoin(risks, eq(risks.id, riskAssets.riskId))
      .innerJoin(changeAssets, eq(changeAssets.targetId, riskAssets.assetId))
      .innerJoin(changes, and(eq(changes.id, changeAssets.changeId), eq(changes.companyId, risks.companyId)))
      .where(and(inRisks, eq(changes.significant, true), inArray(changes.status, ["approved", "implemented", "closed"]), gt(sql`coalesce(${changes.implementedAt}::timestamptz, ${changes.approvedAt})`, base))),
    // signály SOC: eskalované, potvrzené nebo pokus o zneužití na aktivech rizika
    db
      .select({
        riskId: risks.id,
        n: sql<number>`count(distinct ${alertSuggestions.id})::int`,
        at: sql<Date>`max(${alertSuggestions.lastSeen})`,
        exploit: sql<boolean>`bool_or(coalesce((${alertSuggestions.exposure}->>'exploit')::boolean, false))`,
        escalated: sql<number>`count(distinct ${alertSuggestions.id}) filter (where ${alertSuggestions.status} = 'accepted')::int`,
      })
      .from(riskAssets)
      .innerJoin(risks, eq(risks.id, riskAssets.riskId))
      .innerJoin(alertSuggestions, and(eq(alertSuggestions.assetId, riskAssets.assetId), eq(alertSuggestions.companyId, risks.companyId)))
      .where(
        and(
          inRisks,
          gt(alertSuggestions.lastSeen, base),
          or(eq(alertSuggestions.status, "accepted"), eq(alertSuggestions.verdict, "true_positive"), sql`coalesce((${alertSuggestions.exposure}->>'exploit')::boolean, false)`),
        ),
      )
      .groupBy(risks.id),
    // nové otevřené zranitelnosti P1 (KEV / vysoké EPSS) na aktivech rizika
    db
      .select({
        riskId: risks.id,
        n: sql<number>`count(distinct ${assetVulnerabilities.id})::int`,
        at: sql<Date>`max(greatest(${assetVulnerabilities.firstSeenAt}, ${vulnIntel.kevDateAdded}::timestamptz))`,
        cves: sql<string[]>`(array_agg(distinct ${assetVulnerabilities.cveId}))[1:5]`,
      })
      .from(riskAssets)
      .innerJoin(risks, eq(risks.id, riskAssets.riskId))
      .innerJoin(assets, eq(assets.id, riskAssets.assetId))
      .innerJoin(assetVulnerabilities, eq(assetVulnerabilities.assetId, riskAssets.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(inRisks, eq(assetVulnerabilities.status, "open"), sql`${vulnPrioritySql} = 1`, sql`greatest(${assetVulnerabilities.firstSeenAt}, ${vulnIntel.kevDateAdded}::timestamptz) > ${base}`))
      .groupBy(risks.id),
    // testy navázaných opatření s výsledkem neúčinné / účinné s výjimkami
    db
      .select({ riskId: risks.id, id: controlTests.id, title: controlTests.title, code: controls.code, name: controls.name, result: controlTests.result, at: controlTests.performedAt })
      .from(riskControls)
      .innerJoin(risks, eq(risks.id, riskControls.riskId))
      .innerJoin(controls, eq(controls.id, riskControls.controlId))
      .innerJoin(controlTests, eq(controlTests.controlId, riskControls.controlId))
      .where(and(inRisks, eq(controlTests.status, "completed"), inArray(controlTests.result, ["ineffective", "effective_with_exceptions"]), sql`${controlTests.performedAt}::timestamptz > ${base}`)),
    // prošlé výjimky zranitelností na aktivech rizika
    db
      .select({ riskId: risks.id, id: assetVulnerabilities.id, cveId: assetVulnerabilities.cveId, asset: assets.name, assetId: assets.id, until: assetVulnerabilities.acceptedUntil })
      .from(riskAssets)
      .innerJoin(risks, eq(risks.id, riskAssets.riskId))
      .innerJoin(assets, eq(assets.id, riskAssets.assetId))
      .innerJoin(assetVulnerabilities, eq(assetVulnerabilities.assetId, riskAssets.assetId))
      .where(and(inRisks, eq(assetVulnerabilities.status, "accepted"), sql`${assetVulnerabilities.acceptedUntil} < current_date`, sql`${assetVulnerabilities.acceptedUntil}::timestamptz > ${base}`)),
    // vyhodnocené dotazníky dodavatelů (navázané na riziko nebo dodavatele rizika) s odpověďmi „ne“
    db
      .select({ riskId: risks.id, id: supplierQuestionnaires.id, supplierId: suppliers.id, supplier: suppliers.name, title: supplierQuestionnaires.title, answers: supplierQuestionnaires.answers, at: supplierQuestionnaires.evaluatedAt })
      .from(supplierQuestionnaires)
      .innerJoin(suppliers, eq(suppliers.id, supplierQuestionnaires.supplierId))
      .innerJoin(
        risks,
        or(eq(risks.id, supplierQuestionnaires.riskId), sql`exists (select 1 from ${supplierRisks} sr where sr.supplier_id = ${suppliers.id} and sr.risk_id = ${risks.id})`),
      )
      .where(and(inRisks, eq(risks.companyId, suppliers.companyId), sql`${supplierQuestionnaires.evaluatedAt} > ${base}`)),
    // přijaté / navázané scénáře z dat, jejichž doložené skutečnosti se po rozhodnutí změnily (v1.18, ADR-115)
    db
      .select({
        riskId: risks.id,
        template: riskScenarioProposals.templateKey,
        asset: assets.name,
        at: riskScenarioProposals.fingerprintChangedAt,
        higher: sql<boolean>`(${riskScenarioProposals.impact} * ${riskScenarioProposals.likelihood}) > coalesce(${risks.impact} * ${risks.likelihood}, 0)`,
        pImpact: riskScenarioProposals.impact,
        pLikelihood: riskScenarioProposals.likelihood,
      })
      .from(riskScenarioProposals)
      .innerJoin(risks, eq(risks.id, riskScenarioProposals.riskId))
      .innerJoin(assets, eq(assets.id, riskScenarioProposals.primaryAssetId))
      .where(
        and(
          inRisks,
          inArray(riskScenarioProposals.status, ["accepted", "linked"]),
          sql`${riskScenarioProposals.decidedFingerprint} is not null and ${riskScenarioProposals.decidedFingerprint} <> ${riskScenarioProposals.fingerprint}`,
          gt(riskScenarioProposals.fingerprintChangedAt, base),
        ),
      ),
    // nesplněné průběžné monitory navázaných opatření – poslední běh nesplněn a nesplnění po základu (v1.20, ADR-117)
    db
      .select({
        riskId: risks.id,
        monitorId: controlMonitors.id,
        monitor: controlMonitors.name,
        controlId: controls.id,
        code: controls.code,
        name: controls.name,
        effectiveness: controls.effectiveness,
        summary: controlMonitors.lastSummary,
        at: sql<Date>`(select max(${controlMonitorRuns.runAt}) from ${controlMonitorRuns} where ${controlMonitorRuns.monitorId} = ${controlMonitors.id} and ${controlMonitorRuns.result} = 'fail')`,
      })
      .from(riskControls)
      .innerJoin(risks, eq(risks.id, riskControls.riskId))
      .innerJoin(controls, eq(controls.id, riskControls.controlId))
      .innerJoin(controlMonitors, eq(controlMonitors.controlId, riskControls.controlId))
      .where(
        and(
          inRisks,
          eq(controlMonitors.enabled, true),
          eq(controlMonitors.lastResult, "fail"),
          sql`exists (select 1 from ${controlMonitorRuns} where ${controlMonitorRuns.monitorId} = ${controlMonitors.id} and ${controlMonitorRuns.result} = 'fail' and ${controlMonitorRuns.runAt} > ${base})`,
        ),
      ),
    // překročené KRI, které sledují schopnost přijatého / navázaného scénáře rizika (v1.23, ADR-120)
    db
      .select({ riskId: risks.id, template: riskScenarioProposals.templateKey, key: kriSettings.key, at: kriSettings.breachedSince })
      .from(riskScenarioProposals)
      .innerJoin(risks, eq(risks.id, riskScenarioProposals.riskId))
      .innerJoin(kriSettings, and(eq(kriSettings.companyId, risks.companyId), eq(kriSettings.enabled, true), sql`${kriSettings.breachedSince} is not null`))
      .where(and(inRisks, inArray(riskScenarioProposals.status, ["accepted", "linked"]), gt(kriSettings.breachedSince, base))),
  ]);

  const seenInc = new Set<string>();
  for (const i of [...incDirect, ...incAsset]) {
    if (seenInc.has(`${i.riskId}|${i.id}`)) continue;
    seenInc.add(`${i.riskId}|${i.id}`);
    add(i.riskId, { kind: "incident", at: iso(i.at), link: `/incidents/${i.id}`, title: `${i.code ? `${i.code} ` : ""}${i.title}`, detail: i.kind, count: 1, strong: i.kind === "incident" });
  }
  for (const f of findings)
    add(f.riskId, { kind: "audit_finding", at: iso(f.at), link: `/audits/${f.auditId}`, title: `${f.code ? `${f.code} ` : ""}${f.title}`, detail: f.severity, count: 1, strong: f.severity === "major" });
  const seenCh = new Set<string>();
  for (const ch of [...chDirect, ...chAsset]) {
    if (seenCh.has(`${ch.riskId}|${ch.id}`)) continue;
    seenCh.add(`${ch.riskId}|${ch.id}`);
    add(ch.riskId, { kind: "change", at: iso(ch.at), link: `/isms/changes/${ch.id}`, title: `${ch.code ? `${ch.code} ` : ""}${ch.title}`, detail: null, count: 1, strong: false });
  }
  for (const s of soc)
    add(s.riskId, { kind: "soc", at: iso(s.at), link: null, title: "", detail: s.exploit ? "exploit" : s.escalated ? "escalated" : "true_positive", count: s.n, strong: s.exploit || s.escalated > 0 });
  for (const v of vulns) add(v.riskId, { kind: "vuln", at: iso(v.at), link: null, title: "", detail: (v.cves ?? []).join(", "), count: v.n, strong: true });
  for (const ct of tests)
    add(ct.riskId, { kind: "control_test", at: iso(ct.at), link: `/controls/tests/${ct.id}`, title: `${ct.code ? `${ct.code} ` : ""}${ct.name}${ct.title ? ` – ${ct.title}` : ""}`, detail: ct.result, count: 1, strong: ct.result === "ineffective" });
  for (const e of expired) add(e.riskId, { kind: "exception", at: iso(e.until), link: `/assets/${e.assetId}`, title: `${e.cveId} · ${e.asset}`, detail: e.until, count: 1, strong: false });
  const seenQ = new Set<string>();
  for (const q of quest) {
    if (seenQ.has(`${q.riskId}|${q.id}`)) continue;
    seenQ.add(`${q.riskId}|${q.id}`);
    const no = Object.values(q.answers ?? {}).filter((a) => a?.value === "no").length;
    if (!no) continue;
    add(q.riskId, { kind: "supplier", at: iso(q.at), link: `/suppliers/${q.supplierId}`, title: `${q.supplier} – ${q.title}`, detail: String(no), count: no, strong: false });
  }
  for (const x of scen)
    add(x.riskId, {
      kind: "scenario",
      at: iso(x.at),
      link: "/risks/scenarios?tab=decided",
      title: `${RISK_SCENARIO_LABELS.template[x.template as keyof typeof RISK_SCENARIO_LABELS.template] ?? x.template}: ${x.asset}`,
      detail: `${x.pImpact}×${x.pLikelihood}`,
      count: 1,
      strong: !!x.higher,
    });
  for (const m of mons)
    add(m.riskId, {
      kind: "control_monitor",
      at: iso(m.at),
      link: `/controls/${m.controlId}`,
      title: `${m.code ? `${m.code} ` : ""}${m.name}${m.monitor ? ` – ${m.monitor}` : ""}`,
      detail: m.summary,
      count: 1,
      strong: m.effectiveness === "effective",
    });
  const seenKri = new Set<string>();
  for (const k of kris) {
    const meta = KRI_META[k.key as KriKey];
    if (!meta?.capability || !templateByKey(k.template)?.capabilities.includes(meta.capability) || seenKri.has(`${k.riskId}|${k.key}`)) continue;
    seenKri.add(`${k.riskId}|${k.key}`);
    add(k.riskId, { kind: "kri", at: iso(k.at), link: "/risks/appetite", title: RISK_APPETITE_LABELS.kri[k.key as KriKey], detail: k.key, count: 1, strong: false });
  }
  for (const l of out.values()) l.sort((a, b) => b.at.localeCompare(a.at));
  return out;
}
