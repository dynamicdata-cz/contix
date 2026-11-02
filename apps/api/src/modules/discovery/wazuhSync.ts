import { ROOT_COMPANY_ID } from "@contix/shared";
import { and, desc, eq } from "drizzle-orm";
import { audit } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { assetSources, discoveryRuns } from "../../db/schema";
import { getWazuhConfig, wazuhReady, type WazuhConfig } from "../connectors/config";
import { recomputeHealth, syncVulnerabilities } from "../vulnerabilities/service";
import { fetchApiVulns, fetchIndexerVulns } from "../vulnerabilities/sources";
import { createWazuhConnector } from "./connectors/wazuh";
import { startRun } from "./runner";

/* ============================================================
 * Synchronizace s Wazuhem (aktiva, software, zranitelnosti, semafor) – ručně z Discovery
 * i automaticky z plánovače (každých `autoSyncHours` hodin, jen držitel lease).
 * ============================================================ */

export async function wazuhRunning(db: Db) {
  const r = await db.select({ id: discoveryRuns.id }).from(discoveryRuns).where(and(eq(discoveryRuns.connector, "wazuh"), eq(discoveryRuns.status, "running")));
  return r.length > 0;
}

export async function startWazuhSync(db: Db, w: WazuhConfig, companyId: string, trigger: "manual" | "schedule") {
  return startRun(
    db,
    "wazuh",
    createWazuhConnector(),
    { url: w.url, user: w.user, password: w.password!, verifyTls: w.verifyTls, includePackages: w.includePackages },
    { url: w.url, vulnerabilities: w.vulnEnabled, trigger },
    async (ctx) => {
      let stats: Record<string, number> = {};
      if (w.vulnEnabled) {
        const useIndexer = !!(w.indexerUrl && w.indexerUser && w.indexerPassword);
        const records = useIndexer
          ? fetchIndexerVulns({ url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword!, verifyTls: w.indexerVerifyTls, indexPattern: w.indexPattern }, ctx.log)
          : fetchApiVulns(
              { url: w.url, user: w.user, password: w.password!, verifyTls: w.verifyTls },
              (await db.select({ ref: assetSources.sourceRef }).from(assetSources).where(eq(assetSources.sourceType, "wazuh"))).map((r) => r.ref),
              ctx.log,
            );
        ctx.log(useIndexer ? "načítám zranitelnosti z Wazuh Indexeru" : "Wazuh Indexer není nastaven – zkouším Server API (Wazuh ≤ 4.7)");
        try {
          stats = await syncVulnerabilities(db, records, ctx.log);
        } catch (e) {
          // aktiva jsou načtená – chyba zranitelností nemá shodit celý běh
          ctx.log(`CHYBA zranitelností: ${(e as Error).message}`);
          stats = { vulnError: 1 };
        }
      }
      const h = await recomputeHealth(db);
      ctx.log(`semafor: ${h.red} červených, ${h.orange} oranžových, ${h.green} zelených, ${h.unknown} bez dat`);
      return stats;
    },
    companyId,
  );
}

/**
 * Automatická synchronizace (volá plánovač každých 15 minut). Spustí se, když od posledního běhu
 * (ručního i automatického) uplynulo `autoSyncHours`. Nová aktiva jdou do společnosti posledního běhu.
 */
export async function autoWazuhSync(db: Db, config: Config, now = new Date()): Promise<string | null> {
  const w = await getWazuhConfig(db, config);
  if (!wazuhReady(w) || !w.autoSyncHours) return null;
  if (await wazuhRunning(db)) return null;
  const [last] = await db.select({ at: discoveryRuns.createdAt, companyId: discoveryRuns.companyId }).from(discoveryRuns).where(eq(discoveryRuns.connector, "wazuh")).orderBy(desc(discoveryRuns.createdAt)).limit(1);
  if (last && now.getTime() - last.at.getTime() < w.autoSyncHours * 3600_000) return null;
  const { runId } = await startWazuhSync(db, w, last?.companyId ?? ROOT_COMPANY_ID, "schedule");
  await audit(db, { action: "discovery.started", entityType: "discovery_run", entityId: runId, details: { connector: "wazuh", trigger: "schedule" } });
  return runId;
}
