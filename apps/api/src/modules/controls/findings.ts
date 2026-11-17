import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../../db/client";

/* ============================================================
 * Otevřené nálezy navázané na opatření (v1.67, ADR-160) – důkaz neúčinnosti:
 * závažné = kritický nález bezpečnostního testu nebo zásadní zjištění auditu, ostatní = vysoký nález / menší zjištění.
 * ============================================================ */

export const findingsSeriousSql = (id: PgColumn | SQL) =>
  sql<number>`((select count(*) from sec_test_findings f where f.control_id = ${id} and f.status = 'open' and f.severity = 'critical')
    + (select count(*) from audit_findings a where a.control_id = ${id} and a.status in ('open', 'in_progress') and a.severity = 'major'))::int`;
export const findingsOtherSql = (id: PgColumn | SQL) =>
  sql<number>`((select count(*) from sec_test_findings f where f.control_id = ${id} and f.status = 'open' and f.severity = 'high')
    + (select count(*) from audit_findings a where a.control_id = ${id} and a.status in ('open', 'in_progress') and a.severity = 'minor'))::int`;

/** Počty otevřených nálezů podle opatření. */
export async function controlFindingCounts(db: Db, controlIds: string[]): Promise<Map<string, { serious: number; other: number }>> {
  const out = new Map<string, { serious: number; other: number }>();
  if (!controlIds.length) return out;
  const rows = (await db.execute<{ id: string; serious: number; other: number }>(sql`
    select x.id::text as id,
      ((select count(*) from sec_test_findings f where f.control_id = x.id and f.status = 'open' and f.severity = 'critical')
        + (select count(*) from audit_findings a where a.control_id = x.id and a.status in ('open', 'in_progress') and a.severity = 'major'))::int as serious,
      ((select count(*) from sec_test_findings f where f.control_id = x.id and f.status = 'open' and f.severity = 'high')
        + (select count(*) from audit_findings a where a.control_id = x.id and a.status in ('open', 'in_progress') and a.severity = 'minor'))::int as other
    from controls x where x.id in (${sql.join(controlIds.map((i) => sql`${i}::uuid`), sql`, `)})`)) as unknown as { id: string; serious: number; other: number }[];
  for (const r of rows) if (r.serious || r.other) out.set(r.id, { serious: Number(r.serious), other: Number(r.other) });
  return out;
}
