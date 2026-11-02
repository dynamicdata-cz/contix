import type { DiscoveryConnector } from "@contix/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { discoveryRuns } from "../../db/schema";
import { ingestDiscovered } from "./ingest";
import type { Connector } from "./types";

const MAX_LOG = 300;

/**
 * Spustí konektor jako "discovery run".
 * Skeleton: běží v procesu API na pozadí. Pro produkci nahradit frontou úloh
 * (např. pg-boss nad PostgreSQL) a samostatným workerem/collectorem – viz ADR-002.
 */
export async function startRun<P>(
  db: Db,
  connectorId: DiscoveryConnector,
  connector: Connector<P>,
  params: P,
  publicParams: Record<string, unknown> = {},
  /** Krok po načtení aktiv (např. zranitelnosti, přepočet semaforu). Vrací doplňkové statistiky. */
  after?: (ctx: { log: (m: string) => void }) => Promise<Record<string, number>>,
  /** Společnost, do které se zakládají nově nalezená aktiva (existující se párují v rámci celé skupiny). */
  companyId?: string,
): Promise<{ runId: string; done: Promise<void> }> {
  const [run] = await db
    .insert(discoveryRuns)
    .values({ connector: connectorId, status: "running", params: publicParams, startedAt: new Date(), ...(companyId ? { companyId } : {}) })
    .returning({ id: discoveryRuns.id });
  const runId = run!.id;

  const done = (async () => {
    const log: string[] = [];
    const stats: { discovered: number; created: number; updated: number; conflicts: number; failed: number } & Record<string, number> = {
      discovered: 0,
      created: 0,
      updated: 0,
      conflicts: 0,
      failed: 0,
    };
    const ctx = {
      log: (m: string) => {
        if (log.length < MAX_LOG) log.push(`${new Date().toISOString()} ${m}`);
      },
    };
    try {
      for await (const item of connector.collect(params, ctx)) {
        stats.discovered++;
        try {
          const r = await ingestDiscovered(db, item, companyId);
          if (r.action === "created") stats.created++;
          else if (r.action === "updated") stats.updated++;
          else {
            stats.conflicts++;
            ctx.log(`konflikt: "${item.name}" odpovídá více aktivům (${r.candidates.join(", ")})`);
          }
        } catch (e) {
          stats.failed++;
          ctx.log(`chyba u "${item.name}": ${(e as Error).message}`);
        }
        // průběžné statistiky pro UI (dlouhé synchronizace)
        if (stats.discovered % 25 === 0)
          await db.update(discoveryRuns).set({ stats }).where(eq(discoveryRuns.id, runId));
      }
      if (after) {
        await db.update(discoveryRuns).set({ stats, log }).where(eq(discoveryRuns.id, runId));
        Object.assign(stats, await after(ctx));
      }
      await db
        .update(discoveryRuns)
        .set({ status: "succeeded", stats, log, finishedAt: new Date() })
        .where(eq(discoveryRuns.id, runId));
    } catch (e) {
      await db
        .update(discoveryRuns)
        .set({ status: "failed", stats, log, error: (e as Error).message, finishedAt: new Date() })
        .where(eq(discoveryRuns.id, runId));
    }
  })();

  return { runId, done };
}
