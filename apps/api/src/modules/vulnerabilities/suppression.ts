import { VulnStaleCriteria } from "@contix/shared";
import { and, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../../db/client";
import { assetVulnerabilities, assets, vulnIntel, vulnSuppressionRules } from "../../db/schema";

/* ============================================================
 * Utlumení historických zranitelností (v1.106, ADR-200): staré nálezy a nálezy na aktivech, která se dlouho
 * nehlásí (vypnutý virtuál, vyřazený počítač), se hromadně nebo pravidlem převedou do stavu „utlumená“.
 * Utlumená zranitelnost se nepočítá do semaforu ani přehledů; vrátí se, když vyprší lhůta, pravidlo přestane
 * platit (aktivum se znovu hlásí), pravidlo se vypne nebo smaže. Když ji zdroj přestane hlásit, je vyřešená.
 * ============================================================ */

export type StaleCriteria = z.infer<typeof VulnStaleCriteria>;

const SEV_RANK = sql`case ${assetVulnerabilities.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
const RANK = { low: 1, medium: 2, high: 3, critical: 4 } as const;

/** Podmínky nad `asset_vulnerabilities` (+ `assets` přes poddotaz) pro kritéria historického nálezu. */
export function staleConditions(cr: StaleCriteria, now = new Date()): SQL[] {
  const out: SQL[] = [];
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  if (cr.olderThanDays) out.push(sql`coalesce(${assetVulnerabilities.detectedAt}, ${assetVulnerabilities.firstSeenAt}) < ${ago(cr.olderThanDays)}::timestamptz`);
  if (cr.assetOfflineDays)
    out.push(
      inArray(
        assetVulnerabilities.assetId,
        sql`(select ${assets.id} from ${assets} where ${assets.lastSeenAt} is null or ${assets.lastSeenAt} < ${ago(cr.assetOfflineDays)}::timestamptz)`,
      ),
    );
  if (cr.maxSeverity) out.push(sql`${SEV_RANK} <= ${RANK[cr.maxSeverity]}`);
  if (cr.wazuhOnly) out.push(eq(assetVulnerabilities.sourceType, "wazuh"));
  if (cr.keepKev) out.push(sql`not exists (select 1 from ${vulnIntel} where ${vulnIntel.cveId} = ${assetVulnerabilities.cveId} and ${vulnIntel.kev})`);
  return out;
}

const inCompanies = (ids: string[]) => inArray(assetVulnerabilities.assetId, sql`(select ${assets.id} from ${assets} where ${inArray(assets.companyId, ids)})`);

/** Hromadné utlumení podle kritérií (ruční akce). Vrací počet utlumených (nebo jen spočítaných). */
export async function suppressMatching(db: Db, o: { companyIds: string[]; criteria: StaleCriteria; reason: string; until: string | null; userId: string; dryRun?: boolean; now?: Date }) {
  if (!o.companyIds.length) return 0;
  const cond = and(eq(assetVulnerabilities.status, "open"), inCompanies(o.companyIds), ...staleConditions(o.criteria, o.now));
  if (o.dryRun) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(assetVulnerabilities).where(cond);
    return r?.n ?? 0;
  }
  const r = await db
    .update(assetVulnerabilities)
    .set({ status: "suppressed", suppressedUntil: o.until, suppressRuleId: null, triageReason: o.reason, triagedBy: o.userId, triagedAt: o.now ?? new Date() })
    .where(cond)
    .returning({ id: assetVulnerabilities.id });
  return r.length;
}

/**
 * Pravidla utlumení: aktivní pravidlo utlumí odpovídající otevřené nálezy a uvolní ty, které už neodpovídají
 * (aktivum se znovu hlásí); vypnuté nebo smazané pravidlo uvolní vše, co tlumilo. Utlumení s prošlou lhůtou se otevře.
 */
export async function applySuppressionRules(db: Db, companyIds?: string[], now = new Date()) {
  const res = { suppressed: 0, released: 0, expired: 0 };
  const rules = await db
    .select()
    .from(vulnSuppressionRules)
    .where(companyIds ? inArray(vulnSuppressionRules.companyId, companyIds) : undefined);
  for (const rule of rules) {
    const cr = VulnStaleCriteria.safeParse(rule.criteria);
    const owned = and(eq(assetVulnerabilities.suppressRuleId, rule.id), eq(assetVulnerabilities.status, "suppressed"));
    if (!rule.active || !cr.success) {
      const r = await db.update(assetVulnerabilities).set({ status: "open", suppressRuleId: null, suppressedUntil: null, triageReason: null }).where(owned).returning({ id: assetVulnerabilities.id });
      res.released += r.length;
      continue;
    }
    const conds = staleConditions(cr.data, now);
    const rel = await db
      .update(assetVulnerabilities)
      .set({ status: "open", suppressRuleId: null, suppressedUntil: null, triageReason: null })
      .where(and(owned, sql`not (${and(...conds)})`))
      .returning({ id: assetVulnerabilities.id });
    res.released += rel.length;
    const sup = await db
      .update(assetVulnerabilities)
      .set({ status: "suppressed", suppressRuleId: rule.id, suppressedUntil: null, triageReason: `Pravidlo „${rule.name}“: ${rule.reason}`.slice(0, 2000), triagedBy: rule.createdById, triagedAt: now })
      .where(and(eq(assetVulnerabilities.status, "open"), inCompanies([rule.companyId]), ...conds))
      .returning({ id: assetVulnerabilities.id });
    res.suppressed += sup.length;
    await db.update(vulnSuppressionRules).set({ lastAppliedAt: now }).where(eq(vulnSuppressionRules.id, rule.id));
  }
  // utlumení s prošlou lhůtou
  const exp = await db
    .update(assetVulnerabilities)
    .set({ status: "open", suppressedUntil: null, suppressRuleId: null, triageReason: null })
    .where(
      and(
        eq(assetVulnerabilities.status, "suppressed"),
        lt(assetVulnerabilities.suppressedUntil, now.toISOString().slice(0, 10)),
        companyIds ? inCompanies(companyIds) : undefined,
      ),
    )
    .returning({ id: assetVulnerabilities.id });
  res.expired = exp.length;
  return res;
}

/** Počet nálezů, které pravidla právě tlumí. */
export async function suppressedByRule(db: Db, ruleIds: string[]) {
  if (!ruleIds.length) return new Map<string, number>();
  const rows = await db
    .select({ id: assetVulnerabilities.suppressRuleId, n: sql<number>`count(*)::int` })
    .from(assetVulnerabilities)
    .where(and(inArray(assetVulnerabilities.suppressRuleId, ruleIds), eq(assetVulnerabilities.status, "suppressed")))
    .groupBy(assetVulnerabilities.suppressRuleId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}
