import { computeHealth, healthRank, VULN_LABELS, type HealthPolicy, type HealthReason, type HealthStatus, type VulnCounts } from "@contix/shared";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { getSettings } from "../../auth/service";
import type { Db } from "../../db/client";
import { appSettings, assetLinks, assetSources, assets, assetVulnerabilities, vulnIntel } from "../../db/schema";
import { vulnPrioritySql } from "./intel";
import type { VulnRecord } from "./sources";

const LAST_SYNC_KEY = "vuln.lastSync";

/**
 * Zapíše zranitelnosti ze synchronizace:
 *  - nové CVE vloží, známé aktualizuje (last_seen_at),
 *  - dříve vyřešené, které se znovu objevily, znovu otevře,
 *  - CVE, které se v této synchronizaci na aktivu z Wazuhu už neobjevily, označí jako vyřešené.
 */
export async function syncVulnerabilities(db: Db, records: AsyncIterable<VulnRecord>, log: (m: string) => void) {
  const syncStart = new Date();
  const map = new Map(
    (
      await db
        .select({ ref: assetSources.sourceRef, assetId: assetSources.assetId })
        .from(assetSources)
        .where(eq(assetSources.sourceType, "wazuh"))
    ).map((r) => [r.ref, r.assetId]),
  );

  const stats = { vulnFound: 0, vulnNew: 0, vulnResolved: 0, vulnUnmatched: 0 };
  const unmatchedAgents = new Set<string>();
  let batch = new Map<string, typeof assetVulnerabilities.$inferInsert>();

  const flush = async () => {
    if (!batch.size) return;
    const rows = [...batch.values()];
    batch = new Map();
    const res = await db
      .insert(assetVulnerabilities)
      .values(rows)
      .onConflictDoUpdate({
        target: [assetVulnerabilities.assetId, assetVulnerabilities.cveId, assetVulnerabilities.packageName, assetVulnerabilities.packageVersion, assetVulnerabilities.findingKey],
        set: {
          severity: sql`excluded.severity`,
          cvssScore: sql`excluded.cvss_score`,
          description: sql`excluded.description`,
          reference: sql`excluded.reference`,
          publishedAt: sql`excluded.published_at`,
          detectedAt: sql`coalesce(excluded.detected_at, ${assetVulnerabilities.detectedAt})`,
          lastSeenAt: syncStart,
          resolvedAt: null,
          status: sql`case
            when ${assetVulnerabilities.status} = 'resolved' then 'open'::vuln_status
            when ${assetVulnerabilities.status} = 'accepted' and ${assetVulnerabilities.acceptedUntil} < current_date then 'open'::vuln_status
            else ${assetVulnerabilities.status} end`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    stats.vulnNew += res.filter((r) => r.inserted).length;
  };

  for await (const r of records) {
    const assetId = map.get(r.agentId);
    if (!assetId) {
      stats.vulnUnmatched++;
      unmatchedAgents.add(r.agentId);
      continue;
    }
    stats.vulnFound++;
    const key = `${assetId}|${r.cveId}|${r.packageName}|${r.packageVersion}`;
    batch.set(key, {
      assetId,
      cveId: r.cveId,
      severity: r.severity,
      cvssScore: r.cvssScore,
      packageName: r.packageName,
      packageVersion: r.packageVersion,
      description: r.description,
      reference: r.reference,
      publishedAt: r.publishedAt,
      detectedAt: r.detectedAt,
      sourceType: "wazuh",
      firstSeenAt: syncStart,
      lastSeenAt: syncStart,
    });
    if (batch.size >= 500) await flush();
  }
  await flush();

  if (unmatchedAgents.size)
    log(`zranitelnosti ${stats.vulnUnmatched}× u agentů, kteří nejsou v inventáři (${[...unmatchedAgents].slice(0, 10).join(", ")}) – spusťte nejdřív synchronizaci agentů`);

  if (stats.vulnFound === 0 && map.size > 0) {
    log("varování: nenalezena žádná zranitelnost – stávající záznamy ponechány beze změny (ochrana proti chybné konfiguraci)");
  } else {
    const resolved = await db
      .update(assetVulnerabilities)
      .set({ status: "resolved", resolvedAt: syncStart })
      .where(
        and(
          eq(assetVulnerabilities.sourceType, "wazuh"),
          lt(assetVulnerabilities.lastSeenAt, syncStart),
          inArray(assetVulnerabilities.status, ["open", "accepted"]),
          inArray(assetVulnerabilities.assetId, [...new Set(map.values())]),
        ),
      )
      .returning({ id: assetVulnerabilities.id });
    stats.vulnResolved = resolved.length;
  }

  await db
    .insert(appSettings)
    .values({ key: LAST_SYNC_KEY, value: syncStart.toISOString() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: syncStart.toISOString(), updatedAt: new Date() } });
  log(`zranitelnosti: ${stats.vulnFound} na aktivech, ${stats.vulnNew} nových, ${stats.vulnResolved} vyřešených`);
  return stats;
}

export async function lastVulnSync(db: Db): Promise<string | null> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, LAST_SYNC_KEY));
  return (r?.value as string) ?? null;
}

/**
 * Přepočítá semafor všech aktiv (zelená / oranžová / červená / bez dat).
 * Levné i pro tisíce aktiv – 3 dotazy + update jen změněných řádků.
 */
export async function recomputeHealth(db: Db, now = new Date()): Promise<Record<HealthStatus, number>> {
  const policy: HealthPolicy = (await getSettings(db)).healthPolicy;

  // expirované výjimky se znovu otevřou
  await db
    .update(assetVulnerabilities)
    .set({ status: "open" })
    .where(and(eq(assetVulnerabilities.status, "accepted"), lt(assetVulnerabilities.acceptedUntil, sql`current_date`)));

  const [rows, countRows, scanned, links, lastSync, p1Rows] = await Promise.all([
    db
      .select({
        id: assets.id,
        name: assets.name,
        assetClass: assets.assetClass,
        osName: assets.osName,
        osVersion: assets.osVersion,
        lastSeenAt: assets.lastSeenAt,
        healthStatus: assets.healthStatus,
        healthReasons: assets.healthReasons,
        vulnCritical: assets.vulnCritical,
        vulnHigh: assets.vulnHigh,
        vulnMedium: assets.vulnMedium,
        vulnLow: assets.vulnLow,
        supportStatus: assets.supportStatus,
        osEolDate: assets.osEolDate,
      })
      .from(assets),
    db
      .select({ assetId: assetVulnerabilities.assetId, severity: assetVulnerabilities.severity, n: sql<number>`count(*)::int` })
      .from(assetVulnerabilities)
      .where(eq(assetVulnerabilities.status, "open"))
      .groupBy(assetVulnerabilities.assetId, assetVulnerabilities.severity),
    db.selectDistinct({ assetId: assetSources.assetId }).from(assetSources).where(eq(assetSources.sourceType, "wazuh")),
    db.select({ primaryId: assetLinks.primaryId, supportingId: assetLinks.supportingId }).from(assetLinks),
    lastVulnSync(db),
    // zranitelnosti priority P1 (KEV / EPSS, ADR-050)
    db
      .select({ assetId: assetVulnerabilities.assetId, n: sql<number>`count(*)::int` })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(eq(assetVulnerabilities.status, "open"), sql`${vulnPrioritySql} = 1`))
      .groupBy(assetVulnerabilities.assetId),
  ]);
  const p1 = new Map(p1Rows.map((r) => [r.assetId, r.n]));

  const counts = new Map<string, VulnCounts>();
  for (const r of countRows) {
    const c = counts.get(r.assetId) ?? { critical: 0, high: 0, medium: 0, low: 0 };
    if (r.severity !== "unknown") c[r.severity] += r.n;
    counts.set(r.assetId, c);
  }
  const scannedSet = new Set(lastSync ? scanned.map((s) => s.assetId) : []);

  type Result = { status: HealthStatus; reasons: HealthReason[]; support: string; eol: string | null; c: VulnCounts };
  const results = new Map<string, Result>();
  for (const a of rows) {
    const c = counts.get(a.id) ?? { critical: 0, high: 0, medium: 0, low: 0 };
    const h = computeHealth({
      counts: c,
      p1: p1.get(a.id) ?? 0,
      osName: a.osName,
      osVersion: a.osVersion,
      lastSeenAt: scannedSet.has(a.id) ? a.lastSeenAt : null,
      hasVulnData: scannedSet.has(a.id),
      policy,
      now,
    });
    results.set(a.id, { status: h.status, reasons: h.reasons, support: h.support.status, eol: h.support.eolDate, c });
  }

  // primární aktivum přebírá nejhorší stav podpůrných
  if (policy.propagateToPrimary) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const l of links) {
      const p = results.get(l.primaryId);
      const s = results.get(l.supportingId);
      if (!p || !s || (s.status !== "red" && s.status !== "orange")) continue;
      p.reasons.push({
        level: s.status,
        code: "supporting",
        text: `Podpůrné aktivum „${byId.get(l.supportingId)?.name}“: ${VULN_LABELS.health[s.status].toLowerCase()}`,
      });
      if (healthRank[s.status] > healthRank[p.status]) p.status = s.status;
    }
  }

  const summary: Record<HealthStatus, number> = { green: 0, orange: 0, red: 0, unknown: 0 };
  const stamp = new Date();
  for (const a of rows) {
    const r = results.get(a.id)!;
    summary[r.status]++;
    const changed =
      a.healthStatus !== r.status ||
      JSON.stringify(a.healthReasons) !== JSON.stringify(r.reasons) ||
      a.vulnCritical !== r.c.critical ||
      a.vulnHigh !== r.c.high ||
      a.vulnMedium !== r.c.medium ||
      a.vulnLow !== r.c.low ||
      a.supportStatus !== r.support ||
      (a.osEolDate ?? null) !== r.eol;
    if (!changed) continue;
    await db
      .update(assets)
      .set({
        healthStatus: r.status,
        healthReasons: r.reasons,
        healthUpdatedAt: stamp,
        vulnCritical: r.c.critical,
        vulnHigh: r.c.high,
        vulnMedium: r.c.medium,
        vulnLow: r.c.low,
        supportStatus: r.support as "supported",
        osEolDate: r.eol,
        updatedAt: sql`${assets.updatedAt}`, // přepočet semaforu není úprava aktiva
      })
      .where(eq(assets.id, a.id));
  }
  return summary;
}
