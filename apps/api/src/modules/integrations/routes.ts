import { buildIntegrationMap, type IntegrationMapDto, type MapCoverage, type MapNodeDto, type Translate } from "@contix/shared";
import { and, count, eq, gte, inArray, isNotNull, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { agentEvents, assets, assetSources, connections, hostInventories, identitySources } from "../../db/schema";
import { hasPerm, requirePerm } from "../../auth/middleware";
import type { AppEnv } from "../../auth/service";
import { inScope, scopeOf } from "../../auth/scope";
import { agentDtos, concentratorDtos } from "../agents/service";
import { collectorDtos, hostSummaries } from "../collector/service";
import { getScanConfig, nmapInfo } from "../connectors/config";
import { jiraDtos } from "../connections/jira";
import { netboxDtos } from "../connections/netbox";
import { wazuhDtos } from "../connections/wazuh";
import { tFor } from "../i18n/service";
import { systemStatus } from "../ops/routes";
import { probeDtos } from "../sectests/service";

/* ============================================================
 * Mapa propojení (v1.86, ADR-181): data pro Administraci → Konektory, stránku mapy a dlaždici v Přehledu.
 * Výpočet stavů a vazeb je `buildIntegrationMap` (shared). Bez správy systému jen záznamy v rozsahu společností
 * uživatele a bez adres serverů, otisků a tokenů.
 * ============================================================ */

/** Pokrytí serverů sběrem: aktivní servery a kdo o nich posílá data (agent, sběrač, Wazuh). */
export async function serverCoverage(db: Db, companyIds: string[] | null): Promise<MapCoverage> {
  const scope = companyIds ? inArray(assets.companyId, companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]) : undefined;
  const servers = await db
    .select({ id: assets.id, name: assets.name })
    .from(assets)
    .where(and(eq(assets.assetType, "server"), inArray(assets.lifecycleStatus, ["active", "maintenance"]), scope));
  const ids = servers.map((s) => s.id);
  if (!ids.length) return { servers: 0, agent: 0, collector: 0, wazuh: 0, none: 0, duplicate: 0, noneSample: [] };
  const [inv, wz] = await Promise.all([
    db
      .select({ assetId: hostInventories.assetId, kind: connections.kind })
      .from(hostInventories)
      .innerJoin(connections, eq(connections.id, hostInventories.connectionId))
      .where(and(isNotNull(hostInventories.assetId), inArray(hostInventories.assetId, ids))),
    db.selectDistinct({ assetId: assetSources.assetId }).from(assetSources).where(and(eq(assetSources.sourceType, "wazuh"), inArray(assetSources.assetId, ids))),
  ]);
  const agent = new Set(inv.filter((r) => r.kind === "concentrator").map((r) => r.assetId!));
  const collector = new Set(inv.filter((r) => r.kind === "collector").map((r) => r.assetId!));
  const wazuh = new Set(wz.map((r) => r.assetId));
  const none = servers.filter((s) => !agent.has(s.id) && !collector.has(s.id) && !wazuh.has(s.id));
  return {
    servers: servers.length,
    agent: agent.size,
    collector: collector.size,
    wazuh: wazuh.size,
    none: none.length,
    duplicate: [...agent].filter((a) => collector.has(a)).length,
    noneSample: none.slice(0, 10).map((s) => ({ id: s.id, name: s.name })),
  };
}

const HIDDEN_FACTS = new Set(["url", "indexer", "key", "token", "detail", "error", "cidrs"]);

/** Mapa propojení (ADR-181) – pro API i upozornění na zdroje dat (v1.88). `scope` null = vše (správa systému). */
export async function loadIntegrationMap(db: Db, config: Config, o: { admin: boolean; scope: string[] | null; hostsWhere?: SQL; t?: Translate }): Promise<IntegrationMapDto> {
  const { admin, scope } = o;
  const inCo = (id: string | null | undefined) => admin || !scope || !id || scope.includes(id);
  const since = new Date(Date.now() - 86_400_000);
  const [concentrators, agents, collectors, hosts, wazuh, netbox, jira, probes, scanCfg, idSrc, msgs, coverage] = await Promise.all([
    concentratorDtos(db),
    agentDtos(db),
    collectorDtos(db),
    hostSummaries(db, o.hostsWhere),
    wazuhDtos(db, config),
    netboxDtos(db, config),
    jiraDtos(db, config),
    probeDtos(db),
    getScanConfig(db, config),
    db.select().from(identitySources),
    db.select({ id: agentEvents.agentId, n: count() }).from(agentEvents).where(gte(agentEvents.receivedAt, since)).groupBy(agentEvents.agentId),
    serverCoverage(db, admin ? null : scope),
  ]);
  const nmap = scanCfg.enabled ? await nmapInfo(scanCfg.nmapPath) : { found: null };
  // služby a jejich stav jen pro správu systému (podrobnosti obsahují adresy a nastavení)
  const services = admin && o.t ? (await systemStatus(db, config, o.t)).checks : [];
  return buildIntegrationMap({
    now: new Date(),
    concentrators: concentrators.filter((k) => inCo(k.companyId)),
    agents: agents.filter((a) => inCo(a.companyId)),
    collectors: collectors.filter((k) => inCo(k.companyId)),
    hosts,
    wazuh: wazuh.filter((k) => inCo(k.companyId)),
    netbox: netbox.filter((k) => inCo(k.companyId)),
    jira: jira.filter((k) => inCo(k.companyId)),
    probes: probes.filter((k) => inCo(k.companyId)),
    scan: admin ? { enabled: scanCfg.enabled, nmapFound: !!nmap.found, allowedCidrs: scanCfg.allowedCidrs } : null,
    identity: idSrc
      .filter((s) => inCo(s.companyId))
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind, enabled: s.enabled, lastSyncAt: s.lastSyncAt?.toISOString() ?? null, lastStatus: s.lastStatus, lastError: s.lastError, syncHours: s.syncHours })),
    services,
    agentMsgs24h: Object.fromEntries(msgs.map((m) => [m.id, Number(m.n)])),
    coverage,
  });
}

export function integrationRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;
  return new Hono<AppEnv>().get("/map", requirePerm("admin:settings", "discovery:run", "soc:read"), async (c) => {
    const admin = hasPerm(c, "admin:settings");
    const map = await loadIntegrationMap(db, config, { admin, scope: scopeOf(c).ids, hostsWhere: admin ? undefined : inScope(c, hostInventories.companyId), t: admin ? await tFor(db, c) : undefined });
    if (!admin)
      for (const n of map.nodes as MapNodeDto[]) {
        n.facts = n.facts.filter((f) => !HIDDEN_FACTS.has(f.key));
        n.links = n.links.filter((l) => !l.link.to.startsWith("/admin/"));
      }
    return c.json(map);
  });
}

