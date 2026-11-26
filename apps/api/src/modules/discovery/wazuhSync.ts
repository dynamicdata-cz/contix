import { companyForAgent, ROOT_COMPANY_ID } from "@contix/shared";
import { applySuppressionRules } from "../vulnerabilities/suppression";
import { and, desc, eq } from "drizzle-orm";
import { audit } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { assetSources, discoveryRuns } from "../../db/schema";
import { listWazuh, wazuhApiReady, type WazuhConn } from "../connections/wazuh";
import { recomputeHealth, syncVulnerabilities } from "../vulnerabilities/service";
import { fetchApiVulns, fetchIndexerVulns, type VulnStreamMeta } from "../vulnerabilities/sources";
import { createWazuhConnector, type WazuhParams } from "./connectors/wazuh";
import { startRun } from "./runner";
import type { Connector } from "./types";

/* ============================================================
 * Synchronizace s Wazuhem (aktiva, software, zranitelnosti, semafor) – ručně z Discovery
 * i automaticky z plánovače (každých `autoSyncHours` hodin, jen držitel lease). Každé připojení zvlášť (ADR-146).
 * ============================================================ */

export async function wazuhRunning(db: Db, connectionId?: string) {
  const r = await db
    .select({ id: discoveryRuns.id })
    .from(discoveryRuns)
    .where(and(eq(discoveryRuns.connector, "wazuh"), eq(discoveryRuns.status, "running"), connectionId ? eq(discoveryRuns.connectionId, connectionId) : undefined));
  return r.length > 0;
}

/** Konektor jednoho Wazuhu: položky nesou připojení a společnost podle rozsahu / skupin agenta. */
function scopedConnector(w: WazuhConn, fallbackCompany: string): Connector<WazuhParams> {
  const inner = createWazuhConnector();
  const scoped = !!w.companyId || w.groupMap.length > 0;
  return {
    id: inner.id,
    async *collect(params, ctx) {
      for await (const item of inner.collect(params, ctx)) {
        const groups = ((item.attributes?.wazuh as { groups?: unknown } | undefined)?.groups ?? []) as string[];
        yield { ...item, connectionId: w.id, companyId: companyForAgent(w, Array.isArray(groups) ? groups.map(String) : [], fallbackCompany), matchInCompany: scoped };
      }
    },
  };
}

export async function startWazuhSync(db: Db, w: WazuhConn, companyId: string, trigger: "manual" | "schedule") {
  return startRun(
    db,
    "wazuh",
    scopedConnector(w, companyId),
    { url: w.url, user: w.user, password: w.password!, verifyTls: w.verifyTls, includePackages: w.includePackages },
    { url: w.url, connection: w.name, vulnerabilities: w.vulnEnabled, trigger },
    async (ctx) => {
      let stats: Record<string, number> = {};
      if (w.vulnEnabled) {
        const useIndexer = !!(w.indexerUrl && w.indexerUser && w.indexerPassword);
        const meta: VulnStreamMeta = { sortedByAgent: false, total: null, read: 0 };
        const records = useIndexer
          ? fetchIndexerVulns({ url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword!, verifyTls: w.indexerVerifyTls, indexPattern: w.indexPattern }, ctx.log, undefined, meta)
          : fetchApiVulns(
              { url: w.url, user: w.user, password: w.password!, verifyTls: w.verifyTls },
              (await db.select({ ref: assetSources.sourceRef }).from(assetSources).where(and(eq(assetSources.sourceType, "wazuh"), eq(assetSources.connectionId, w.id)))).map((r) => r.ref),
              ctx.log,
            );
        ctx.log(useIndexer ? "načítám zranitelnosti z Wazuh Indexeru" : "Wazuh Indexer není nastaven – zkouším Server API (Wazuh ≤ 4.7)");
        try {
          stats = await syncVulnerabilities(db, records, ctx.log, w.id, meta);
        } catch (e) {
          // aktiva jsou načtená – chyba zranitelností nemá shodit celý běh
          ctx.log(`CHYBA zranitelností: ${(e as Error).message}`);
          stats = { vulnError: 1 };
        }
      }
      // pravidla utlumení historických zranitelností (v1.106)
      if (w.vulnEnabled) {
        const sp = await applySuppressionRules(db);
        if (sp.suppressed || sp.released || sp.expired) ctx.log(`utlumení: ${sp.suppressed} nově utlumených, ${sp.released + sp.expired} znovu otevřených`);
      }
      const h = await recomputeHealth(db);
      ctx.log(`semafor: ${h.red} červených, ${h.orange} oranžových, ${h.green} zelených, ${h.unknown} bez dat`);
      return stats;
    },
    w.companyId ?? companyId,
    w.id,
  );
}

/**
 * Automatická synchronizace (volá plánovač každých 15 minut): každé zapnuté připojení, když od jeho posledního běhu
 * uplynulo `autoSyncHours`. Nová aktiva: společnost připojení / podle skupiny agenta / poslední ruční běh / kořenová.
 */
export async function autoWazuhSync(db: Db, config: Config, now = new Date()): Promise<string | null> {
  let started: string | null = null;
  for (const w of await listWazuh(db, config, { enabledOnly: true })) {
    if (!wazuhApiReady(w) || !w.autoSyncHours) continue;
    if (await wazuhRunning(db, w.id)) continue;
    const [last] = await db
      .select({ at: discoveryRuns.createdAt, companyId: discoveryRuns.companyId })
      .from(discoveryRuns)
      .where(and(eq(discoveryRuns.connector, "wazuh"), eq(discoveryRuns.connectionId, w.id)))
      .orderBy(desc(discoveryRuns.createdAt))
      .limit(1);
    if (last && now.getTime() - last.at.getTime() < w.autoSyncHours * 3600_000) continue;
    const { runId } = await startWazuhSync(db, w, last?.companyId ?? ROOT_COMPANY_ID, "schedule");
    await audit(db, { action: "discovery.started", entityType: "discovery_run", entityId: runId, details: { connector: "wazuh", connection: w.name, trigger: "schedule" } });
    started ??= runId;
  }
  return started;
}
