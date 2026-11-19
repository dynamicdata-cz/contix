import { CONTROL_SIGNAL_INCIDENT_DAYS, type ControlSignalKind, type ControlSignals } from "@contix/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";

/* ============================================================
 * Signály k opatřením a požadavkům (v1.88, ADR-183) – jeden dotaz na sadu opatření.
 * ============================================================ */

type Row = { id: string; mf: number; me: number; af: number; afs: number; st: number; sts: number; inc: number; ti: number; tis: number; ev: number };

export async function controlSignals(db: Db, controlIds: string[]): Promise<Map<string, ControlSignals>> {
  const out = new Map<string, ControlSignals>();
  if (!controlIds.length) return out;
  const ids = sql.join(controlIds.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute<Row>(sql`
    select c.id,
      (select count(*) from control_monitors m where m.control_id = c.id and m.enabled and m.last_result = 'fail')::int as mf,
      (select count(*) from control_monitors m where m.control_id = c.id and m.enabled and m.last_result = 'error')::int as me,
      (select count(*) from audit_findings a where a.control_id = c.id and a.status in ('open','in_progress') and a.severity in ('major','minor'))::int as af,
      (select count(*) from audit_findings a where a.control_id = c.id and a.status in ('open','in_progress') and a.severity = 'major')::int as afs,
      (select count(*) from sec_test_findings f where f.control_id = c.id and f.status = 'open' and f.severity in ('critical','high'))::int as st,
      (select count(*) from sec_test_findings f where f.control_id = c.id and f.status = 'open' and f.severity = 'critical')::int as sts,
      (select count(*) from incident_controls ic join incidents i on i.id = ic.incident_id
        where ic.control_id = c.id and i.kind <> 'event' and i.detected_at > now() - make_interval(days => ${CONTROL_SIGNAL_INCIDENT_DAYS}))::int as inc,
      (select case when t.result in ('ineffective','effective_with_exceptions') then 1 else 0 end from control_tests t
        where t.control_id = c.id and t.status = 'completed' order by t.performed_at desc nulls last, t.updated_at desc limit 1) as ti,
      (select case when t.result = 'ineffective' then 1 else 0 end from control_tests t
        where t.control_id = c.id and t.status = 'completed' order by t.performed_at desc nulls last, t.updated_at desc limit 1) as tis,
      (select case when count(*) filter (where e.valid_until < current_date) > 0 and count(*) filter (where e.valid_until is null or e.valid_until >= current_date) = 0
        then count(*) filter (where e.valid_until < current_date) else 0 end
        from evidence_controls ec join evidence e on e.id = ec.evidence_id where ec.control_id = c.id)::int as ev
    from controls c where c.id in (${ids})`)) as unknown as Row[];
  for (const r of rows) {
    const kinds: Partial<Record<ControlSignalKind, number>> = {};
    const put = (k: ControlSignalKind, n: number | null) => {
      if (n && n > 0) kinds[k] = Number(n);
    };
    put("monitor_fail", r.mf);
    put("monitor_error", r.me);
    put("audit_finding", r.af);
    put("sectest", r.st);
    put("incident", r.inc);
    put("test_ineffective", r.ti);
    put("evidence_expired", r.ev);
    if (!Object.keys(kinds).length) continue;
    out.set(r.id, { kinds, serious: r.mf > 0 || r.afs > 0 || r.sts > 0 || r.inc > 0 || (r.tis ?? 0) > 0 });
  }
  return out;
}

/** Neshody auditů navázané přímo na požadavek (bez opatření) – pro SoA. */
export async function requirementFindingSignals(db: Db, companyId: string): Promise<Map<string, ControlSignals>> {
  const rows = (await db.execute<{ requirement_id: string; n: number; major: number }>(sql`
    select f.requirement_id, count(*)::int as n, count(*) filter (where f.severity = 'major')::int as major
    from audit_findings f join audits a on a.id = f.audit_id
    where a.company_id = ${companyId} and f.requirement_id is not null and f.control_id is null
      and f.status in ('open','in_progress') and f.severity in ('major','minor')
    group by f.requirement_id`)) as unknown as { requirement_id: string; n: number; major: number }[];
  return new Map(rows.map((r) => [r.requirement_id, { kinds: { audit_finding: r.n }, serious: r.major > 0 }]));
}
