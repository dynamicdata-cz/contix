import { profileOf, periodOf, type TrendValues } from "@contix/shared";
import { and, count, eq, gt, inArray, lt } from "drizzle-orm";
import { settingsFor, getCompanies } from "../../auth/scope";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, trendSnapshots } from "../../db/schema";
import { loadExceptions } from "../exceptions/service";
import { appetiteDto } from "../risks/appetite";
import { capabilityDtos, detectionFor, measureCompany, threatCoverage } from "../risks/scenarios";
import { managementReport } from "../reports/routes";

/* Trendy (ADR-042): hodnoty snímku se počítají ze stejných zdrojů jako Zpráva pro vedení (`managementReport`). */

export async function computeTrendValues(db: Db, companyId: string, now = new Date()): Promise<{ values: TrendValues; framework: string }> {
  const s = await settingsFor(db, null, companyId);
  const on = (m: string) => (s.enabledModules as string[]).includes(m);
  const r = await managementReport(db, companyId, undefined, now.toISOString().slice(0, 10));
  const v: TrendValues = {};
  const fwMain = profileOf(s).defaultFramework;
  for (const c of r.compliance) v[`compliance:${c.framework}`] = c.score;
  v.compliance = (r.compliance.find((c) => c.framework === fwMain) ?? r.compliance[0])?.score ?? null;
  if (r.risks) {
    v.risks_unacceptable = r.risks.unacceptable;
    v.risks_untreated = r.risks.untreated;
    v.risks_critical_high = (r.risks.byLevel.critical ?? 0) + (r.risks.byLevel.high ?? 0);
    v.risks_medium = r.risks.byLevel.medium ?? 0;
    v.risks_low = r.risks.byLevel.low ?? 0;
    v.risks_total = r.risks.total;
  }
  // analýza rizik z dat (v1.24, ADR-121) – pokrytí katalogu, schopnosti, ochota, KRI, detekce
  if (on("risks")) {
    const cov = await threatCoverage(db, companyId);
    if (cov.assets.length) {
      v.threat_coverage_pct = cov.summary.assessedShare == null ? null : Math.round(cov.summary.assessedShare * 100);
      v.unassessed_threats = cov.summary.unassessed;
    }
    const caps = await capabilityDtos(db, companyId, await measureCompany(db, companyId, now));
    if (caps.some((c) => c.confidence !== "none")) v.weak_capabilities = caps.filter((c) => c.status === "weak").length;
    const ap = await appetiteDto(db, companyId, now);
    if (ap.categories.some((c) => c.maxLevel)) v.risks_over_appetite = ap.breaches.length;
    if (ap.kris.some((k) => k.status !== "unknown")) v.kri_alerts = ap.kris.filter((k) => k.status === "alert").length;
    const det = await detectionFor(db, companyId, now);
    if (det.measured) v.detection_blind = det.summary.blind;
  }
  if (r.plan) v.plan_overdue = r.plan.overdue;
  if (r.audits) {
    v.findings_open = r.audits.openFindings;
    v.findings_overdue = r.audits.overdueFindings;
  }
  if (r.assurance) {
    const a = r.assurance;
    v.controls_tested_pct = a.implementedControls ? Math.round(((a.implementedControls - a.implementedNotTested) / a.implementedControls) * 100) : null;
    v.evidence_expired = a.evidenceExpired;
  }
  v.obligations_overdue = r.obligations.overdue;
  if (r.assets) v.assets_red = r.assets.red;
  if (r.incidents) v.incidents_significant = r.incidents.significant;
  if (r.vulnRemediation) {
    v.vulns_p1 = r.vulnRemediation.p1;
    v.vulns_sla_overdue = r.vulnRemediation.overdue;
  }
  if (on("vulnerabilities")) {
    const rows = await db
      .select({ sev: assetVulnerabilities.severity, n: count() })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .where(and(eq(assets.companyId, companyId), eq(assetVulnerabilities.status, "open"), inArray(assetVulnerabilities.severity, ["critical", "high"])))
      .groupBy(assetVulnerabilities.severity);
    v.vulns_critical = rows.find((x) => x.sev === "critical")?.n ?? 0;
    v.vulns_high = rows.find((x) => x.sev === "high")?.n ?? 0;
  }
  const ids = [companyId];
  const ex = await loadExceptions(db, {
    identity_finding: on("identity") ? ids : [],
    sod_violation: on("identity") ? ids : [],
    vulnerability: on("vulnerabilities") ? ids : [],
    risk_accepted: on("risks") ? ids : [],
    requirement_na: on("controls") ? ids : [],
  });
  v.exceptions_total = ex.filter((e) => e.state !== "expired").length;
  v.exceptions_expired = ex.filter((e) => e.state === "expired").length;
  return { values: v, framework: fwMain };
}

/** Snímek běžného měsíce (přepíše dřívější snímek téhož měsíce). */
export async function takeTrendSnapshot(db: Db, companyId: string, now = new Date()) {
  const { values } = await computeTrendValues(db, companyId, now);
  const period = periodOf(now);
  await db
    .insert(trendSnapshots)
    .values({ companyId, period, values: values as Record<string, number | null>, takenAt: now })
    .onConflictDoUpdate({ target: [trendSnapshots.companyId, trendSnapshots.period], set: { values: values as Record<string, number | null>, takenAt: now } });
  return { period, values };
}

/** Plánovač: aktivním společnostem obnoví snímek běžného měsíce, je-li starší než `maxAgeMs` (výchozí 12 h). */
export async function processTrendSnapshots(db: Db, now = new Date(), maxAgeMs = 12 * 3600_000): Promise<string[]> {
  const errors: string[] = [];
  const period = periodOf(now);
  const fresh = new Set(
    (
      await db
        .select({ id: trendSnapshots.companyId })
        .from(trendSnapshots)
        .where(and(eq(trendSnapshots.period, period), gt(trendSnapshots.takenAt, new Date(now.getTime() - maxAgeMs))))
    ).map((r) => r.id),
  );
  for (const co of (await getCompanies(db)).filter((x) => x.active && !fresh.has(x.id))) {
    try {
      await takeTrendSnapshot(db, co.id, now);
    } catch (e) {
      errors.push(`${co.name}: ${(e as Error).message}`);
    }
  }
  return errors;
}

/** Úklid: snímky starší než 5 let (trend se ukazuje nejvýš za 36 měsíců). */
export async function pruneTrendSnapshots(db: Db, now = new Date()) {
  const cut = periodOf(new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), 1)));
  await db.delete(trendSnapshots).where(lt(trendSnapshots.period, cut));
}
