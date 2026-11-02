import { VULN_OBLIGATION_PRIORITIES, type ManagementReport, type ObligationItem, type Translate } from "@contix/shared";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, vulnIntel } from "../../db/schema";
import { getVulnSla, vulnDueSql, vulnPrioritySql } from "./intel";

/* ============================================================
 * Lhůty oprav zranitelností (ADR-050): povinnost „Oprava zranitelností“ za aktivum (jen priority
 * VULN_OBLIGATION_PRIORITIES, nejbližší termín) a statistika pro zprávu pro vedení a trendy.
 * Počítá se při čtení, nic se nepersistuje.
 * ============================================================ */

const PRIO_NUM = { p1: 1, p2: 2, p3: 3, p4: 4 } as const;

export interface VulnRemediationItem extends Omit<ObligationItem, "urgency"> {
  ownerUserId: string | null;
}

/** Aktiva s otevřenými zranitelnostmi P1 / P2 s termínem opravy (jedna položka za aktivum, nejbližší termín). */
export async function vulnRemediationItems(db: Db, companyIds: string[], t: Translate): Promise<VulnRemediationItem[]> {
  if (!companyIds.length) return [];
  const sla = await getVulnSla(db);
  const prios = VULN_OBLIGATION_PRIORITIES.filter((p) => sla[p] != null).map((p) => PRIO_NUM[p]);
  if (!prios.length) return [];
  const due = vulnDueSql(sla);
  const rows = await db
    .select({
      assetId: assets.id,
      name: assets.name,
      companyId: assets.companyId,
      ownerUserId: assets.ownerUserId,
      due: sql<string>`min(${due})::text`,
      total: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${due} < current_date)::int`,
      p1: sql<number>`count(*) filter (where ${vulnPrioritySql} = 1)::int`,
    })
    .from(assetVulnerabilities)
    .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
    .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
    .where(and(inArray(assets.companyId, companyIds), eq(assetVulnerabilities.status, "open"), sql`${vulnPrioritySql} in (${sql.join(prios.map((p) => sql`${p}`), sql`, `)})`))
    .groupBy(assets.id, assets.name, assets.companyId, assets.ownerUserId);
  return rows.map((r) => ({
    key: `vuln_remediation:${r.assetId}`,
    kind: "vuln_remediation" as const,
    title: t("srv.obl.vulnFix", { asset: r.name }),
    detail: t("srv.obl.vulnFixDetail", { total: r.total, p1: r.p1, overdue: r.overdue }),
    companyId: r.companyId,
    due: r.due,
    link: `/assets/${r.assetId}`,
    ownerPositionId: null,
    ownerName: null,
    ownerUserId: r.ownerUserId,
  }));
}

/** Statistika oprav pro zprávu pro vedení (stav nyní + opravy za období). */
export async function vulnRemediationStats(db: Db, companyId: string, from: string, to: string): Promise<NonNullable<ManagementReport["vulnRemediation"]>> {
  const sla = await getVulnSla(db);
  const due = vulnDueSql(sla);
  const base = () =>
    db
      .select({
        p1: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'open' and ${vulnPrioritySql} = 1)::int`,
        p2: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'open' and ${vulnPrioritySql} = 2)::int`,
        kev: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'open' and coalesce(${vulnIntel.kev}, false))::int`,
        overdue: sql<number>`count(*) filter (where ${assetVulnerabilities.status} = 'open' and ${due} < current_date)::int`,
      })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(eq(assets.companyId, companyId));
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 864e5);
  const [[now], [res]] = await Promise.all([
    base(),
    db
      .select({
        resolved: sql<number>`count(*)::int`,
        withDue: sql<number>`count(*) filter (where ${due} is not null)::int`,
        onTime: sql<number>`count(*) filter (where ${due} is not null and ${assetVulnerabilities.resolvedAt}::date <= ${due})::int`,
      })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(eq(assets.companyId, companyId), eq(assetVulnerabilities.status, "resolved"), gte(assetVulnerabilities.resolvedAt, start), lt(assetVulnerabilities.resolvedAt, end))),
  ]);
  return {
    p1: now?.p1 ?? 0,
    p2: now?.p2 ?? 0,
    kevOpen: now?.kev ?? 0,
    overdue: now?.overdue ?? 0,
    resolved: res?.resolved ?? 0,
    resolvedOnTimePct: res && res.withDue ? Math.round((res.onTime / res.withDue) * 100) : null,
  };
}

