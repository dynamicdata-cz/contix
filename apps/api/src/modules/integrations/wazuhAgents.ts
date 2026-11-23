import { WAZUH_STALE_DAYS, wazuhVersionCmp, type WazuhAgentDto, type WazuhAgentState, type WazuhAgentSummary, type WazuhAgentsDto } from "@contix/shared";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetSources, assetVulnerabilities, connections, discoveryRuns } from "../../db/schema";

/* ============================================================
 * Agenti Wazuhu (v1.93, ADR-187): stav z poslední synchronizace (uložený v asset_sources.raw.agent),
 * verze proti manageru (agent 000), zranitelnosti spárovaného aktiva. Agent, který při poslední úspěšné
 * synchronizaci ve Wazuhu chyběl, je „odebraný“.
 * ============================================================ */

type Raw = { agent?: { id?: string; name?: string; ip?: string; status?: string; version?: string; group?: string[]; lastKeepAlive?: string; os?: { name?: string; version?: string } }; os?: { os?: { name?: string; version?: string } } };

const DAY = 86_400_000;

function keepAlive(v: string | undefined): Date | null {
  if (!v || v.startsWith("9999")) return null; // manager hlásí 9999-12-31
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function lastSync(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, Date>();
  const rows = await db
    .selectDistinctOn([discoveryRuns.connectionId], { id: discoveryRuns.connectionId, at: discoveryRuns.createdAt })
    .from(discoveryRuns)
    .where(and(inArray(discoveryRuns.connectionId, ids), eq(discoveryRuns.status, "succeeded")))
    .orderBy(discoveryRuns.connectionId, desc(discoveryRuns.createdAt));
  return new Map(rows.filter((r) => r.id).map((r) => [r.id!, r.at]));
}

/** Agenti jednoho nebo více připojení. `assetScope` omezí na aktiva v rozsahu uživatele (agenti bez aktiva se pak nezobrazí). */
export async function wazuhAgents(db: Db, connectionIds: string[], assetScope?: SQL, now = new Date()) {
  if (!connectionIds.length) return new Map<string, { managerVersion: string | null; lastSyncAt: Date | null; items: WazuhAgentDto[] }>();
  const [rows, synced] = await Promise.all([
    db
      .select({ conn: assetSources.connectionId, ref: assetSources.sourceRef, raw: assetSources.raw, syncedAt: assetSources.lastSyncedAt, assetId: assets.id, assetName: assets.name, criticality: assets.criticality })
      .from(assetSources)
      .innerJoin(assets, eq(assets.id, assetSources.assetId))
      .where(and(eq(assetSources.sourceType, "wazuh"), inArray(assetSources.connectionId, connectionIds), assetScope)),
    lastSync(db, connectionIds),
  ]);
  const ids = [...new Set(rows.map((r) => r.assetId))];
  const vulns = ids.length
    ? await db
        .select({
          assetId: assetVulnerabilities.assetId,
          open: sql<number>`count(*)`.mapWith(Number),
          critical: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'critical')`.mapWith(Number),
        })
        .from(assetVulnerabilities)
        .where(and(inArray(assetVulnerabilities.assetId, ids), eq(assetVulnerabilities.status, "open")))
        .groupBy(assetVulnerabilities.assetId)
    : [];
  const vm = new Map(vulns.map((v) => [v.assetId, v]));
  const out = new Map<string, { managerVersion: string | null; lastSyncAt: Date | null; items: WazuhAgentDto[] }>();
  for (const cid of connectionIds) {
    const mine = rows.filter((r) => r.conn === cid);
    const manager = mine.find((r) => r.ref === "000");
    const managerVersion = (manager?.raw as Raw | null)?.agent?.version ?? null;
    const syncAt = synced.get(cid) ?? null;
    const items = mine
      .filter((r) => r.ref !== "000")
      .map((r): WazuhAgentDto => {
        const a = (r.raw as Raw | null)?.agent ?? {};
        const ka = keepAlive(a.lastKeepAlive);
        // agent chyběl v poslední úspěšné synchronizaci (záznam je starší než její začátek)
        const removed = !!syncAt && r.syncedAt.getTime() < syncAt.getTime() - 60_000;
        const state: WazuhAgentState = removed ? "removed" : a.status === "active" ? "active" : a.status === "pending" ? "pending" : "disconnected";
        const v = vm.get(r.assetId);
        const os = (r.raw as Raw | null)?.os?.os ?? a.os;
        return {
          agentId: r.ref,
          name: a.name ?? r.assetName,
          ip: a.ip && a.ip !== "any" ? a.ip : null,
          state,
          version: a.version ?? null,
          outdated: !!managerVersion && !!a.version && wazuhVersionCmp(a.version, managerVersion) < 0,
          groups: a.group ?? [],
          os: [os?.name, os?.version].filter(Boolean).join(" ") || null,
          lastKeepAlive: ka?.toISOString() ?? null,
          offlineDays: state === "active" ? 0 : ka ? Math.floor((now.getTime() - ka.getTime()) / DAY) : null,
          lastSyncedAt: r.syncedAt.toISOString(),
          asset: { id: r.assetId, name: r.assetName, criticality: r.criticality },
          openVulns: v?.open ?? 0,
          criticalVulns: v?.critical ?? 0,
        };
      });
    out.set(cid, { managerVersion, lastSyncAt: syncAt, items });
  }
  return out;
}

export function summarize(items: WazuhAgentDto[]): WazuhAgentSummary {
  const s: WazuhAgentSummary = { total: items.length, active: 0, disconnected: 0, pending: 0, removed: 0, outdated: 0, stale: 0 };
  for (const a of items) {
    s[a.state]++;
    if (a.outdated && a.state !== "removed") s.outdated++;
    if (a.state === "disconnected" && (a.offlineDays === null || a.offlineDays >= WAZUH_STALE_DAYS)) s.stale++;
  }
  return s;
}

/** Pořadí: problémy nahoře (odpojení nejdéle, čekající, zastaralí), pak aktivní podle jména. */
export function sortAgents(items: WazuhAgentDto[]) {
  const rank = { disconnected: 0, pending: 1, removed: 3, active: 2 } as const;
  return items.sort((a, b) => rank[a.state] - rank[b.state] || (b.offlineDays ?? 9999) - (a.offlineDays ?? 9999) || Number(b.outdated) - Number(a.outdated) || a.name.localeCompare(b.name, "cs"));
}

export async function wazuhAgentsDto(db: Db, connectionId: string, assetScope?: SQL): Promise<WazuhAgentsDto | null> {
  const [conn] = await db.select({ id: connections.id, name: connections.name }).from(connections).where(and(eq(connections.id, connectionId), eq(connections.kind, "wazuh")));
  if (!conn) return null;
  const r = (await wazuhAgents(db, [connectionId], assetScope)).get(connectionId)!;
  return {
    connection: { id: conn.id, name: conn.name },
    managerVersion: r.managerVersion,
    lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
    summary: summarize(r.items),
    items: sortAgents(r.items),
  };
}
