import { companyForAgent, ROOT_COMPANY_ID, type AssetType, type NetboxConnectionDto, type NetboxConnectionInput } from "@contix/shared";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { decrypt, encrypt } from "../../auth/crypto";
import { audit } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { assetSources, connections, discoveryRuns } from "../../db/schema";
import { describeFetchError, type FetchLike } from "../discovery/connectors/wazuh";
import { startRun } from "../discovery/runner";
import type { Connector, DiscoveredAsset } from "../discovery/types";

/* ============================================================
 * NetBox (v1.53, ADR-150): zařízení (dcim) a virtuální stroje → aktiva. Jen čtení (API token s právem view).
 * Tenant NetBoxu → společnost (`groupMap`), párování s existujícími aktivy jako u ostatních zdrojů.
 * ============================================================ */

export interface NetboxConn {
  id: string;
  name: string;
  enabled: boolean;
  url: string;
  token: string | null;
  verifyTls: boolean;
  companyId: string | null;
  groupMap: { group: string; companyId: string }[];
  includeVms: boolean;
  autoSyncHours: number;
}

type Row = typeof connections.$inferSelect;
function toConn(r: Row, config: Config): NetboxConn {
  const c = r.config as Partial<NetboxConn>;
  let token: string | null = null;
  try {
    token = r.secrets.token ? decrypt(r.secrets.token, appSecret(config)) : null;
  } catch {
    token = null;
  }
  return { id: r.id, name: r.name, enabled: r.enabled, url: c.url ?? "", token, verifyTls: c.verifyTls ?? true, companyId: r.companyId, groupMap: r.groupMap ?? [], includeVms: c.includeVms ?? true, autoSyncHours: c.autoSyncHours ?? 24 };
}

export async function listNetbox(db: Db, config: Config): Promise<NetboxConn[]> {
  return (await db.select().from(connections).where(eq(connections.kind, "netbox")).orderBy(asc(connections.createdAt))).map((r) => toConn(r, config));
}

export async function saveNetbox(db: Db, config: Config, id: string | null, i: NetboxConnectionInput): Promise<string> {
  const prev = id ? (await db.select().from(connections).where(and(eq(connections.id, id), eq(connections.kind, "netbox"))))[0] : undefined;
  const token = i.token ? encrypt(i.token, appSecret(config)) : prev?.secrets.token;
  const values = {
    kind: "netbox",
    name: i.name,
    enabled: i.enabled ?? true,
    companyId: i.companyId ?? null,
    groupMap: i.companyId ? [] : (i.groupMap ?? []),
    config: { url: i.url.replace(/\/+$/, ""), verifyTls: i.verifyTls ?? true, includeVms: i.includeVms ?? true, autoSyncHours: i.autoSyncHours ?? 24 },
    secrets: (token ? { token } : {}) as Record<string, string>,
    updatedAt: new Date(),
  };
  if (prev) {
    await db.update(connections).set(values).where(eq(connections.id, prev.id));
    return prev.id;
  }
  const [r] = await db.insert(connections).values(values).returning({ id: connections.id });
  return r!.id;
}

export async function netboxDtos(db: Db, config: Config): Promise<NetboxConnectionDto[]> {
  const list = await listNetbox(db, config);
  if (!list.length) return [];
  const ids = list.map((n) => n.id);
  const [n, runs] = await Promise.all([
    db.select({ id: assetSources.connectionId, n: count() }).from(assetSources).where(inArray(assetSources.connectionId, ids)).groupBy(assetSources.connectionId),
    db.selectDistinctOn([discoveryRuns.connectionId], { id: discoveryRuns.connectionId, at: discoveryRuns.createdAt, status: discoveryRuns.status }).from(discoveryRuns).where(inArray(discoveryRuns.connectionId, ids)).orderBy(discoveryRuns.connectionId, desc(discoveryRuns.createdAt)),
  ]);
  return list.map((c) => {
    const run = runs.find((r) => r.id === c.id);
    return { id: c.id, kind: "netbox", name: c.name, enabled: c.enabled, url: c.url, hasToken: !!c.token, verifyTls: c.verifyTls, companyId: c.companyId, groupMap: c.groupMap, includeVms: c.includeVms, autoSyncHours: c.autoSyncHours, assets: n.find((x) => x.id === c.id)?.n ?? 0, lastSyncAt: run?.at.toISOString() ?? null, lastSyncStatus: run?.status ?? null };
  });
}

/** Klient NetBox REST API: GET s tokenem a stránkováním přes `next`. */
function netboxClient(c: Pick<NetboxConn, "url" | "token" | "verifyTls">, fetchImpl: FetchLike) {
  const tls = c.verifyTls === false ? { rejectUnauthorized: false } : undefined;
  const get = async (url: string) => {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { Authorization: `Token ${c.token}`, Accept: "application/json" }, tls, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(describeFetchError(e, url));
    }
    if (res.status === 401 || res.status === 403) throw new Error("NetBox odmítl token – zkontrolujte token a jeho oprávnění (view).");
    if (!res.ok) throw new Error(`NetBox ${new URL(url).pathname}: HTTP ${res.status}`);
    return (await res.json()) as any;
  };
  return {
    get,
    async *all(path: string): AsyncGenerator<any> {
      let next: string | null = `${c.url}${path}${path.includes("?") ? "&" : "?"}limit=500`;
      for (let i = 0; next && i < 400; i++) {
        const page = await get(next);
        for (const r of page.results ?? []) yield r;
        next = page.next ?? null;
      }
    },
  };
}

export async function testNetbox(c: Pick<NetboxConn, "url" | "token" | "verifyTls">, fetchImpl: FetchLike = fetch as FetchLike) {
  const cl = netboxClient(c, fetchImpl);
  const st = await cl.get(`${c.url}/api/status/`).catch(() => null);
  const dev = await cl.get(`${c.url}/api/dcim/devices/?limit=1`);
  const vm = await cl.get(`${c.url}/api/virtualization/virtual-machines/?limit=1`).catch(() => null);
  return { version: (st?.["netbox-version"] as string | undefined) ?? null, devices: Number(dev.count) || 0, vms: vm ? Number(vm.count) || 0 : null };
}

const ip = (v: any) => (typeof v?.address === "string" ? v.address.split("/")[0] : null);
const slugOf = (v: any) => (typeof v === "object" && v ? String(v.slug ?? v.value ?? v.name ?? "") : String(v ?? ""));
function guessType(role: string, isVm: boolean): AssetType {
  if (isVm) return "virtual_machine";
  const r = role.toLowerCase();
  if (/(switch|router|access|wifi|wlan|core|edge|net)/.test(r)) return "network_device";
  if (/(firewall|fw|ids|ips|waf|security)/.test(r)) return "security_device";
  if (/(storage|san|nas)/.test(r)) return "storage";
  if (/(print)/.test(r)) return "printer";
  if (/(pc|desktop|workstation)/.test(r)) return "workstation";
  return "server";
}

/** Konektor jednoho NetBoxu: zařízení a VM (aktivní i plánované), tenant → společnost. */
export function createNetboxConnector(c: NetboxConn, fallbackCompany: string, fetchImpl: FetchLike = fetch as FetchLike): Connector<null> {
  const cl = netboxClient(c, fetchImpl);
  const scoped = !!c.companyId || c.groupMap.length > 0;
  const company = (tenant: string) => companyForAgent(c, tenant ? [tenant] : [], fallbackCompany);
  return {
    id: "netbox",
    async *collect(_p, ctx) {
      ctx.log(`NetBox ${c.url}: zařízení`);
      for await (const d of cl.all("/api/dcim/devices/")) {
        if (!d.name) continue;
        const role = slugOf(d.role ?? d.device_role);
        const tenant = slugOf(d.tenant);
        yield {
          sourceType: "netbox",
          sourceRef: `dcim:${d.id}`,
          connectionId: c.id,
          companyId: company(tenant),
          matchInCompany: scoped,
          name: String(d.name),
          assetType: guessType(role, false),
          hostname: String(d.name),
          ipAddresses: [ip(d.primary_ip4), ip(d.primary_ip6)].filter((x): x is string => !!x),
          osName: d.platform?.name ?? null,
          manufacturer: d.device_type?.manufacturer?.name ?? null,
          model: d.device_type?.model ?? null,
          serialNumber: d.serial || null,
          attributes: { netbox: { id: d.id, url: d.url, site: d.site?.name ?? null, rack: d.rack?.name ?? null, role, tenant: tenant || null, status: slugOf(d.status) } },
          raw: { id: d.id, status: slugOf(d.status) },
          governance: { location: d.site?.name ?? null, tags: (d.tags ?? []).map((t: any) => String(t.name ?? t.slug)).filter(Boolean) },
        } satisfies DiscoveredAsset;
      }
      if (!c.includeVms) return;
      ctx.log(`NetBox ${c.url}: virtuální stroje`);
      for await (const v of cl.all("/api/virtualization/virtual-machines/")) {
        if (!v.name) continue;
        const tenant = slugOf(v.tenant);
        yield {
          sourceType: "netbox",
          sourceRef: `vm:${v.id}`,
          connectionId: c.id,
          companyId: company(tenant),
          matchInCompany: scoped,
          name: String(v.name),
          assetType: "virtual_machine",
          hostname: String(v.name),
          ipAddresses: [ip(v.primary_ip4), ip(v.primary_ip6)].filter((x): x is string => !!x),
          osName: v.platform?.name ?? null,
          attributes: { netbox: { id: v.id, url: v.url, cluster: v.cluster?.name ?? null, tenant: tenant || null, status: slugOf(v.status), vcpus: v.vcpus ?? null, memoryMb: v.memory ?? null } },
          raw: { id: v.id, status: slugOf(v.status) },
          governance: { location: v.site?.name ?? null, tags: (v.tags ?? []).map((t: any) => String(t.name ?? t.slug)).filter(Boolean) },
        } satisfies DiscoveredAsset;
      }
    },
  };
}

export async function netboxRunning(db: Db, id: string) {
  return (await db.select({ id: discoveryRuns.id }).from(discoveryRuns).where(and(eq(discoveryRuns.connectionId, id), eq(discoveryRuns.status, "running")))).length > 0;
}

export async function startNetboxSync(db: Db, c: NetboxConn, companyId: string, trigger: "manual" | "schedule", fetchImpl?: FetchLike) {
  return startRun(db, "netbox", createNetboxConnector(c, companyId, fetchImpl), null, { url: c.url, connection: c.name, trigger }, undefined, c.companyId ?? companyId, c.id);
}

/** Plánovač: každé zapnuté připojení po uplynutí jeho intervalu. */
export async function autoNetboxSync(db: Db, config: Config, now = new Date()) {
  for (const c of await listNetbox(db, config)) {
    if (!c.enabled || !c.token || !c.autoSyncHours || (await netboxRunning(db, c.id))) continue;
    const [last] = await db.select({ at: discoveryRuns.createdAt }).from(discoveryRuns).where(eq(discoveryRuns.connectionId, c.id)).orderBy(desc(discoveryRuns.createdAt)).limit(1);
    if (last && now.getTime() - last.at.getTime() < c.autoSyncHours * 3600_000) continue;
    const { runId } = await startNetboxSync(db, c, c.companyId ?? ROOT_COMPANY_ID, "schedule");
    await audit(db, { action: "discovery.started", entityType: "discovery_run", entityId: runId, details: { connector: "netbox", connection: c.name, trigger: "schedule" } });
  }
}
