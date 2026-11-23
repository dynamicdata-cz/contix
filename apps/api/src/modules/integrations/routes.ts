import { buildIntegrationMap, type IntegrationMapDto, type MapCoverage, type MapNodeDto, type Translate } from "@contix/shared";
import { and, count, eq, gte, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { agentEvents, assets, assetSources, connections, hostInventories, identityComputers, identitySources } from "../../db/schema";
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
import { writeXlsx } from "../import/table";
import { summarize, wazuhAgents, wazuhAgentsDto } from "./wazuhAgents";

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
  const pcScope = companyIds ? inArray(identityComputers.companyId, companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]) : undefined;
  const [ad] = await db
    .select({ n: count(), noAsset: sql<number>`count(*) filter (where ${identityComputers.assetId} is null)`.mapWith(Number) })
    .from(identityComputers)
    .where(
      and(
        pcScope,
        isNull(identityComputers.removedAt),
        eq(identityComputers.enabled, true),
        inArray(identityComputers.role, ["server", "dc"]),
        gte(identityComputers.lastLogonAt, new Date(Date.now() - 90 * 86_400_000)),
      ),
    );
  const adPart = ad?.n ? { adServers: Number(ad.n), adNoAsset: ad.noAsset } : {};
  if (!ids.length) return { servers: 0, agent: 0, collector: 0, wazuh: 0, none: 0, duplicate: 0, noneSample: [], ...adPart };
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
    ...adPart,
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
  // stav agentů Wazuhu (v1.93) – jen aktiva v rozsahu uživatele
  const wz = wazuh.filter((k) => inCo(k.companyId));
  const wzAgents = await wazuhAgents(db, wz.map((k) => k.id), admin || !scope ? undefined : inArray(assets.companyId, scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]));
  // služby a jejich stav jen pro správu systému (podrobnosti obsahují adresy a nastavení)
  const services = admin && o.t ? (await systemStatus(db, config, o.t)).checks : [];
  return buildIntegrationMap({
    now: new Date(),
    concentrators: concentrators.filter((k) => inCo(k.companyId)),
    agents: agents.filter((a) => inCo(a.companyId)),
    collectors: collectors.filter((k) => inCo(k.companyId)),
    hosts,
    wazuh: wz,
    wazuhAgents: Object.fromEntries([...wzAgents].map(([id, r]) => [id, summarize(r.items)])),
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
  })
    /** Agenti jednoho připojení Wazuhu (v1.93, ADR-187) – panel mapy propojení. */
    .get("/wazuh/:id/agents", requirePerm("admin:settings", "discovery:run", "soc:read"), async (c) => {
      const dto = await agentsFor(c);
      return c.json(dto);
    })
    .get("/wazuh/:id/agents.csv", requirePerm("admin:settings", "discovery:run", "soc:read"), (c) => exportAgents(c, "csv"))
    .get("/wazuh/:id/agents.xlsx", requirePerm("admin:settings", "discovery:run", "soc:read"), (c) => exportAgents(c, "xlsx"));

  async function exportAgents(c: Context<AppEnv>, format: "csv" | "xlsx") {
      const dto = await agentsFor(c);
      const t = await tFor(db, c);
      const head = [
        t("imap.wz.col.agentId"),
        t("imap.wz.col.name"),
        t("imap.wz.col.ip"),
        t("imap.wz.col.state"),
        t("imap.wz.col.lastKeepAlive"),
        t("imap.wz.col.offlineDays"),
        t("imap.wz.col.version"),
        t("imap.wz.col.outdated"),
        t("imap.wz.col.os"),
        t("imap.wz.col.groups"),
        t("imap.wz.col.asset"),
        t("imap.wz.col.openVulns"),
        t("imap.wz.col.criticalVulns"),
      ];
      const rows = dto.items.map((a) => [
        a.agentId,
        a.name,
        a.ip ?? "",
        t(`imap.wz.st.${a.state}`),
        a.lastKeepAlive?.slice(0, 16).replace("T", " ") ?? "",
        a.offlineDays === null ? "" : String(a.offlineDays),
        a.version ?? "",
        a.outdated ? t("imap.wz.yes") : "",
        a.os ?? "",
        a.groups.join(", "),
        a.asset?.name ?? "",
        String(a.openVulns),
        String(a.criticalVulns),
      ]);
      const name = `wazuh-agenti-${new Date().toISOString().slice(0, 10)}`;
      if (format === "xlsx")
        return new Response(new Uint8Array(writeXlsx([{ name: t("imap.wz.sheet"), rows: [head, ...rows], widths: [8, 26, 16, 14, 18, 8, 14, 8, 28, 20, 26, 10, 10] }])), {
          headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "private, no-store" },
        });
      const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return c.body(`\uFEFF${[head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`, 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` });
  }

  async function agentsFor(c: Context<AppEnv>) {
    const admin = hasPerm(c, "admin:settings");
    const id = c.req.param("id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HTTPException(404, { message: "Připojení nenalezeno" });
    const [conn] = await db.select({ companyId: connections.companyId }).from(connections).where(eq(connections.id, id));
    const scope = scopeOf(c).ids;
    if (!conn || (!admin && scope && conn.companyId && !scope.includes(conn.companyId))) throw new HTTPException(404, { message: "Připojení nenalezeno" });
    const dto = await wazuhAgentsDto(db, id, admin ? undefined : inScope(c, assets.companyId));
    if (!dto) throw new HTTPException(404, { message: "Připojení nenalezeno" });
    return dto;
  }
}

