import { SEVERITIES, pctOf, type Severity, type VulnMetricsDto } from "@contix/shared";
import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, vulnIntel } from "../../db/schema";
import { getVulnSla, vulnDueSql, vulnOverdueSql } from "./intel";

/*
 * Metriky správy zranitelností (ADR-097): MTTR, stárnutí, měsíční vývoj, dodržení lhůt, zdroje, triáž.
 * Počítá se při čtení (SQL agregace, bez dotazů v cyklu), nepersistuje se. `scope` = podmínka nad assets.company_id.
 */
export async function vulnMetrics(db: Db, scope: SQL, months = 12, now = new Date()): Promise<VulnMetricsDto> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const sla = await getVulnSla(db);
  const days = sql<number>`extract(epoch from (now() - ${assetVulnerabilities.firstSeenAt})) / 86400`;
  const [monthly, mttr, aging, [slaRow], [overdue], bySource, [triage]] = await Promise.all([
    db.execute<{ month: string; opened: number; closed: number; open: number }>(sql`
      with v as (
        select av.first_seen_at, av.resolved_at, av.status from asset_vulnerabilities av join assets on assets.id = av.asset_id
         where ${scope} and av.status in ('open', 'accepted', 'resolved')),
      m as (select generate_series(${start.toISOString()}::timestamptz, date_trunc('month', now()), interval '1 month') as s)
      select to_char(m.s, 'YYYY-MM') as month,
        (select count(*)::int from v where v.first_seen_at >= m.s and v.first_seen_at < m.s + interval '1 month') as opened,
        (select count(*)::int from v where v.status = 'resolved' and v.resolved_at >= m.s and v.resolved_at < m.s + interval '1 month') as closed,
        (select count(*)::int from v where v.first_seen_at < least(m.s + interval '1 month', now()) and (v.resolved_at is null or v.resolved_at >= least(m.s + interval '1 month', now()))) as open
      from m order by m.s`),
    db
      .select({ severity: assetVulnerabilities.severity, days: sql<number | null>`avg(extract(epoch from (${assetVulnerabilities.resolvedAt} - ${assetVulnerabilities.firstSeenAt})) / 86400)`, n: sql<number>`count(*)::int` })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .where(and(scope, eq(assetVulnerabilities.status, "resolved"), gte(assetVulnerabilities.resolvedAt, start)))
      .groupBy(assetVulnerabilities.severity),
    db
      .select({
        severity: assetVulnerabilities.severity,
        d30: sql<number>`count(*) filter (where ${days} <= 30)::int`,
        d90: sql<number>`count(*) filter (where ${days} > 30 and ${days} <= 90)::int`,
        d180: sql<number>`count(*) filter (where ${days} > 90 and ${days} <= 180)::int`,
        older: sql<number>`count(*) filter (where ${days} > 180)::int`,
      })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .where(and(scope, eq(assetVulnerabilities.status, "open")))
      .groupBy(assetVulnerabilities.severity),
    db
      .select({ n: sql<number>`count(*)::int`, inTime: sql<number>`count(*) filter (where ${assetVulnerabilities.resolvedAt}::date <= ${vulnDueSql(sla)})::int` })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(scope, eq(assetVulnerabilities.status, "resolved"), gte(assetVulnerabilities.resolvedAt, start), sql`${vulnDueSql(sla)} is not null`)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(scope, vulnOverdueSql(sla))),
    db
      .select({
        source: sql<string>`coalesce(nullif(${assetVulnerabilities.scanner}, ''), ${assetVulnerabilities.sourceType}::text)`,
        open: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'open')::int`,
        resolved90: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'resolved' and ${assetVulnerabilities.resolvedAt} >= now() - interval '90 days')::int`,
      })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .where(scope)
      .groupBy(sql`1`),
    db
      .select({
        falsePositive: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'false_positive')::int`,
        outOfScope: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'out_of_scope')::int`,
        duplicate: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'duplicate')::int`,
        verified: sql<number>`count(*) filter (where ${assetVulnerabilities.verified} and ${inArray(assetVulnerabilities.status, ["open", "accepted"])})::int`,
      })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .where(scope),
  ]);
  const bySev = <T,>(rows: ({ severity: Severity } & T)[], empty: T) => Object.fromEntries(SEVERITIES.map((s) => [s, rows.find((r) => r.severity === s) ?? empty])) as Record<Severity, T>;
  const mt = bySev(mttr.map((r) => ({ severity: r.severity, days: r.days == null ? null : Math.round(Number(r.days) * 10) / 10, n: r.n })), { days: null as number | null, n: 0 });
  const ag = bySev(aging, { d30: 0, d90: 0, d180: 0, older: 0 });
  return {
    months: (monthly as unknown as { month: string; opened: number; closed: number; open: number }[]).map((r) => ({ month: r.month, opened: Number(r.opened), closed: Number(r.closed), open: Number(r.open) })),
    mttr: Object.fromEntries(SEVERITIES.map((s) => [s, { days: mt[s].days, n: mt[s].n }])) as VulnMetricsDto["mttr"],
    aging: Object.fromEntries(SEVERITIES.map((s) => [s, { d30: ag[s].d30, d90: ag[s].d90, d180: ag[s].d180, older: ag[s].older }])) as VulnMetricsDto["aging"],
    sla: { resolved: slaRow?.n ?? 0, inTime: slaRow?.inTime ?? 0, pct: pctOf(slaRow?.inTime ?? 0, slaRow?.n ?? 0), openOverdue: overdue?.n ?? 0 },
    bySource: bySource.filter((r) => r.open || r.resolved90).sort((a, b) => b.open - a.open),
    triage: triage ?? { falsePositive: 0, outOfScope: 0, duplicate: 0, verified: 0 },
  };
}
