import { FINDING_ESCALATION_DAYS, FINDING_SOURCES, SECTEST_TASK_DUE_DAYS, UNIFIED_SEVERITIES, remediationStat, unifiedSeverity, type FindingSource, type FindingsRemediationDto, type UnifiedSeverity } from "@contix/shared";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, auditFindings, audits, hostFindings, secTestFindings, vulnIntel } from "../../db/schema";
import { getVulnSla, vulnDueSql } from "../vulnerabilities/intel";

/* ============================================================
 * Náprava nálezů (v1.69, ADR-162): otevřené, po termínu, opravené v období, průměrná doba opravy a podíl oprav
 * v termínu – po zdrojích a závažnosti. Termín: úkol z nálezu, jinak lhůta podle závažnosti; lhůty oprav zranitelností,
 * termín zjištění auditu. Jen agregace SQL při čtení, nic se nepersistuje.
 * ============================================================ */

type Agg = { sev: string; open: number; overdue: number; escalated: number; fixed: number; sumDays: number; withDue: number; onTime: number };
const ZERO = { open: 0, overdue: 0, escalated: 0, fixed: 0, sumDays: 0, withDue: 0, onTime: 0 };
/** Lhůta opravy podle závažnosti (stejná jako termín úkolu z nálezu). */
/** Termín otevřeného nálezu: otevřený úkol z nálezu, jinak lhůta podle závažnosti od zjištění (v1.71, ADR-164). */
const openDue = (kind: string, id: SQL | unknown, sla: SQL) =>
  sql`coalesce((select min(t.due_date) from tasks t where t.source_kind = ${kind} and t.source_id = ${id} and t.status in ('open', 'in_progress')), ${sla}::date)`;
const dueDaysCase = (sev: SQL) => sql`(case ${sev} ${sql.join(Object.entries(SECTEST_TASK_DUE_DAYS).map(([k, v]) => sql`when ${k} then ${v}::int`), sql` `)} else 30 end)`;

export async function findingsRemediation(db: Db, scope: Record<FindingSource, string[]>, from: string, to: string, assetId?: string): Promise<FindingsRemediationDto> {
  const start = `${from}T00:00:00Z`;
  const end = `${to}T23:59:59.999Z`;
  const n = (x: unknown) => Number(x ?? 0);
  const rows: Record<FindingSource, Agg[]> = { sectest: [], host: [], vulnerability: [], audit: [] };
  const jobs: Promise<void>[] = [];
  const num = (e: SQL) => sql<number>`coalesce(${e}, 0)::float8`;

  if (scope.sectest.length) {
    const f = secTestFindings;
    const due = sql`(${f.firstSeenAt} + ${dueDaysCase(sql`${f.severity}`)} * interval '1 day')`;
    const fixedIn = sql`${f.status} = 'fixed' and ${f.fixedAt} between ${start} and ${end}`;
    jobs.push(
      db
        .select({
          sev: f.severity,
          open: sql<number>`count(*) filter (where ${f.status} = 'open')::int`,
          overdue: sql<number>`count(*) filter (where ${f.status} = 'open' and ${openDue('sectest_finding', f.id, due)} < current_date)::int`,
          escalated: sql<number>`count(*) filter (where ${f.status} = 'open' and ${openDue('sectest_finding', f.id, due)} < current_date - ${FINDING_ESCALATION_DAYS}::int)::int`,
          fixed: sql<number>`count(*) filter (where ${fixedIn})::int`,
          sumDays: num(sql`sum(extract(epoch from (${f.fixedAt} - ${f.firstSeenAt})) / 86400) filter (where ${fixedIn})`),
          withDue: sql<number>`count(*) filter (where ${fixedIn})::int`,
          onTime: sql<number>`count(*) filter (where ${fixedIn} and ${f.fixedAt} <= ${due})::int`,
        })
        .from(f)
        .where(and(inArray(f.companyId, scope.sectest), assetId ? eq(f.assetId, assetId) : undefined))
        .groupBy(f.severity)
        .then((r) => void (rows.sectest = r as Agg[])),
    );
  }
  if (scope.host.length) {
    const f = hostFindings;
    const due = sql`(${f.firstSeenAt} + ${dueDaysCase(sql`${f.severity}`)} * interval '1 day')`;
    const fixedIn = sql`${f.status} = 'fixed' and ${f.fixedAt} between ${start} and ${end}`;
    jobs.push(
      db
        .select({
          sev: f.severity,
          open: sql<number>`count(*) filter (where ${f.status} = 'open')::int`,
          overdue: sql<number>`count(*) filter (where ${f.status} = 'open' and ${openDue('host_finding', f.id, due)} < current_date)::int`,
          escalated: sql<number>`count(*) filter (where ${f.status} = 'open' and ${openDue('host_finding', f.id, due)} < current_date - ${FINDING_ESCALATION_DAYS}::int)::int`,
          fixed: sql<number>`count(*) filter (where ${fixedIn})::int`,
          sumDays: num(sql`sum(extract(epoch from (${f.fixedAt} - ${f.firstSeenAt})) / 86400) filter (where ${fixedIn})`),
          withDue: sql<number>`count(*) filter (where ${fixedIn})::int`,
          onTime: sql<number>`count(*) filter (where ${fixedIn} and ${f.fixedAt} <= ${due})::int`,
        })
        .from(f)
        .where(and(inArray(f.companyId, scope.host), assetId ? eq(f.assetId, assetId) : undefined))
        .groupBy(f.severity)
        .then((r) => void (rows.host = r as Agg[])),
    );
  }
  if (scope.vulnerability.length) {
    const v = assetVulnerabilities;
    const sla = await getVulnSla(db);
    const due = vulnDueSql(sla);
    const fixedIn = sql`${v.status} = 'resolved' and ${v.resolvedAt} between ${start} and ${end}`;
    jobs.push(
      db
        .select({
          sev: sql<string>`${v.severity}::text`,
          open: sql<number>`count(*) filter (where ${v.status} = 'open')::int`,
          overdue: sql<number>`count(*) filter (where ${v.status} = 'open' and ${due} < current_date)::int`,
          escalated: sql<number>`count(*) filter (where ${v.status} = 'open' and ${due} < current_date - ${FINDING_ESCALATION_DAYS}::int)::int`,
          fixed: sql<number>`count(*) filter (where ${fixedIn})::int`,
          sumDays: num(sql`sum(extract(epoch from (${v.resolvedAt} - ${v.firstSeenAt})) / 86400) filter (where ${fixedIn})`),
          withDue: sql<number>`count(*) filter (where ${fixedIn} and ${due} is not null)::int`,
          onTime: sql<number>`count(*) filter (where ${fixedIn} and ${due} is not null and ${v.resolvedAt}::date <= ${due})::int`,
        })
        .from(v)
        .innerJoin(assets, eq(assets.id, v.assetId))
        .leftJoin(vulnIntel, eq(vulnIntel.cveId, v.cveId))
        .where(and(inArray(assets.companyId, scope.vulnerability), assetId ? eq(v.assetId, assetId) : undefined))
        .groupBy(v.severity)
        .then((r) => void (rows.vulnerability = r as Agg[])),
    );
  }
  if (scope.audit.length) {
    const f = auditFindings;
    const fixedIn = sql`${f.status} = 'closed' and ${f.closedAt} between ${from}::date and ${to}::date`;
    jobs.push(
      db
        .select({
          sev: sql<string>`${f.severity}::text`,
          open: sql<number>`count(*) filter (where ${f.status} in ('open', 'in_progress'))::int`,
          overdue: sql<number>`count(*) filter (where ${f.status} in ('open', 'in_progress') and ${f.dueDate} < current_date)::int`,
          escalated: sql<number>`count(*) filter (where ${f.status} in ('open', 'in_progress') and ${f.dueDate} < current_date - ${FINDING_ESCALATION_DAYS}::int)::int`,
          fixed: sql<number>`count(*) filter (where ${fixedIn})::int`,
          sumDays: num(sql`sum(greatest(0, ${f.closedAt} - ${f.createdAt}::date)) filter (where ${fixedIn})`),
          withDue: sql<number>`count(*) filter (where ${fixedIn} and ${f.dueDate} is not null)::int`,
          onTime: sql<number>`count(*) filter (where ${fixedIn} and ${f.dueDate} is not null and ${f.closedAt} <= ${f.dueDate})::int`,
        })
        .from(f)
        .innerJoin(audits, eq(audits.id, f.auditId))
        .where(and(inArray(audits.companyId, scope.audit), assetId ? eq(f.assetId, assetId) : undefined))
        .groupBy(f.severity)
        .then((r) => void (rows.audit = r as Agg[])),
    );
  }
  await Promise.all(jobs);

  const sevZero = () => Object.fromEntries(UNIFIED_SEVERITIES.map((s) => [s, { ...ZERO }])) as Record<UnifiedSeverity, typeof ZERO>;
  const totalSev = sevZero();
  const total = { ...ZERO };
  const add = (a: typeof ZERO, b: Agg) => {
    a.open += n(b.open);
    a.overdue += n(b.overdue);
    a.escalated += n(b.escalated);
    a.fixed += n(b.fixed);
    a.sumDays += n(b.sumDays);
    a.withDue += n(b.withDue);
    a.onTime += n(b.onTime);
  };
  const sources = FINDING_SOURCES.filter((s) => scope[s].length);
  const bySource = {} as FindingsRemediationDto["bySource"];
  for (const s of FINDING_SOURCES) {
    const acc = { ...ZERO };
    const sev = sevZero();
    for (const r of rows[s]) {
      const u = unifiedSeverity(s, r.sev);
      add(acc, r);
      add(sev[u], r);
      add(totalSev[u], r);
      add(total, r);
    }
    bySource[s] = { ...remediationStat(acc), bySeverity: Object.fromEntries(UNIFIED_SEVERITIES.map((u) => [u, remediationStat(sev[u])])) as Record<UnifiedSeverity, ReturnType<typeof remediationStat>> };
  }
  return { from, to, sources, bySource, total: { ...remediationStat(total), bySeverity: Object.fromEntries(UNIFIED_SEVERITIES.map((u) => [u, remediationStat(totalSev[u])])) as Record<UnifiedSeverity, ReturnType<typeof remediationStat>> } };
}
