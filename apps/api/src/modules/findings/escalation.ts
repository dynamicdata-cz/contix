import { FINDING_ESCALATION_DAYS, FINDING_SLA_DAYS, type FindingEscalationDto } from "@contix/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { escalationChain, escalationLevel, orgSnapshot, positionOfUser } from "../org/hierarchy";
import { getVulnSla, vulnDueSql } from "../vulnerabilities/intel";

/* ============================================================
 * Eskalace nálezů po termínu (v1.71, ADR-164): nález testu nebo serveru (termín otevřeného úkolu, jinak lhůta
 * podle závažnosti od zjištění) a zranitelnost (lhůta opravy) po termínu déle než týden eskaluje od garanta aktiva
 * (technický garant → zástupce → vlastník) na vedoucího jeho útvaru, každý další týden o úroveň výš – stejný
 * řetězec jako u povinností (ADR-146). Za aktivum: počet nálezů po termínu a nejstarší překročení. Při čtení.
 * ============================================================ */

const slaCase = (sev: ReturnType<typeof sql>) => sql`(case ${sev} ${sql.join(Object.entries(FINDING_SLA_DAYS).map(([k, v]) => sql`when ${k} then ${v}::int`), sql` `)} else 30 end)`;
const slaDue = (alias: string) => sql`(${sql.raw(alias)}.first_seen_at + ${slaCase(sql.raw(`${alias}.severity::text`))} * interval '1 day')::date`;

export interface EscalationRow extends FindingEscalationDto {
  guarantorUserId: string;
  /** Uživatelé, na které nález eskaloval (vedoucí v řetězci až po dosaženou úroveň). */
  managerUserIds: string[];
  /** Úroveň eskalace pro každého vedoucího. */
  levels: Map<string, number>;
}

export async function findingEscalations(db: Db, companyIds?: string[], now = new Date()): Promise<EscalationRow[]> {
  const sla = await getVulnSla(db);
  const today = now.toISOString().slice(0, 10);
  const cos = companyIds ? (companyIds.length ? sql`and a.company_id in (${sql.join(companyIds.map((i) => sql`${i}::uuid`), sql`, `)})` : sql`and false`) : sql``;
  const rows = (await db.execute(sql`
    with ot as (
      select source_kind, source_id, min(due_date) as due from tasks
      where source_kind in ('sectest_finding', 'host_finding') and status in ('open', 'in_progress') group by source_kind, source_id
    ),
    late as (
      select f.asset_id, coalesce(ot.due, ${slaDue("f")}) as due from sec_test_findings f
        left join ot on ot.source_kind = 'sectest_finding' and ot.source_id = f.id
        where f.status = 'open' and f.asset_id is not null
      union all
      select h.asset_id, coalesce(ot.due, ${slaDue("h")}) from host_findings h
        left join ot on ot.source_kind = 'host_finding' and ot.source_id = h.id
        where h.status = 'open' and h.asset_id is not null
      union all
      select asset_vulnerabilities.asset_id, ${vulnDueSql(sla)} from asset_vulnerabilities
        join assets on assets.id = asset_vulnerabilities.asset_id left join vuln_intel on vuln_intel.cve_id = asset_vulnerabilities.cve_id
        where asset_vulnerabilities.status = 'open'
    )
    select a.id::text as asset_id, a.name, a.company_id::text as company_id,
      coalesce(a.technical_owner_user_id, a.technical_deputy_user_id, a.owner_user_id)::text as guarantor, u.display_name as guarantor_name,
      count(*)::int as overdue, (${today}::date - min(l.due))::int as days
    from late l join assets a on a.id = l.asset_id left join users u on u.id = coalesce(a.technical_owner_user_id, a.technical_deputy_user_id, a.owner_user_id)
    where l.due is not null and l.due < ${today}::date - ${FINDING_ESCALATION_DAYS}::int ${cos}
      and coalesce(a.technical_owner_user_id, a.technical_deputy_user_id, a.owner_user_id) is not null
    group by a.id, a.name, a.company_id, guarantor, u.display_name
    order by days desc, a.name`)) as unknown as { asset_id: string; name: string; company_id: string; guarantor: string; guarantor_name: string | null; overdue: number; days: number }[];
  if (!rows.length) return [];
  const snap = await orgSnapshot(db);
  const holders = new Map<string, string[]>();
  for (const [uid, ps] of snap.positionsOfUser) for (const p of ps) holders.set(p, [...(holders.get(p) ?? []), uid]);
  const out: EscalationRow[] = [];
  for (const r of rows) {
    const base = positionOfUser(snap, r.guarantor, r.company_id);
    if (!base) continue;
    const chain = escalationChain(snap, base);
    const lvl = escalationLevel(Number(r.days), chain.length);
    const levels = new Map<string, number>();
    chain.slice(0, lvl).forEach((p, i) => (holders.get(p) ?? []).forEach((u) => u !== r.guarantor && !levels.has(u) && levels.set(u, i + 1)));
    if (!levels.size) continue;
    out.push({
      assetId: r.asset_id,
      assetName: r.name,
      companyId: r.company_id,
      guarantorName: r.guarantor_name,
      guarantorUserId: r.guarantor,
      overdue: Number(r.overdue),
      daysOverdue: Number(r.days),
      level: Math.max(...levels.values()),
      managerUserIds: [...levels.keys()],
      levels,
    });
  }
  return out;
}

/** Eskalace na konkrétního vedoucího (úroveň za něj). */
export function escalationsFor(rows: EscalationRow[], userId: string): FindingEscalationDto[] {
  return rows
    .filter((r) => r.levels.has(userId))
    .map((r) => ({ assetId: r.assetId, assetName: r.assetName, companyId: r.companyId, guarantorName: r.guarantorName, overdue: r.overdue, daysOverdue: r.daysOverdue, level: r.levels.get(userId)! }));
}
