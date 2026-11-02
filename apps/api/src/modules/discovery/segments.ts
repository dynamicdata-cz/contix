/** Síťové segmenty, plánované skeny a hlídání neevidovaných zařízení (ADR-072). */
import {
  ancestorsOf,
  defaultAssetClass,
  matchHost,
  netHostKey,
  nextScanAt,
  NetObsCreateAsset,
  NetObsDecision,
  NetObsLink,
  NetSegmentInput,
  NetSegmentPatch,
  SOC_OPEN_STATUSES,
  type AssetType,
  type NetAssetRef,
  type NetObservationDto,
  type NetObsStatus,
  type NetScanSchedule,
  type NetScanSummary,
  type NetSegmentDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, getCompanies, hasPermIn, inScope, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, discoveryRuns, netObservations, netSegments } from "../../db/schema";
import { getScanConfig, nmapInfo, scanReady } from "../connectors/config";
import { acquireLease } from "../ops/lease";
import { correlateAlerts } from "../soc/service";
import { assertTargetsAllowed, createNmapConnector, parseCidr } from "./connectors/nmap";
import { ingestDiscovered } from "./ingest";
import type { DiscoveredAsset } from "./types";

type Ctx = Context<AppEnv>;
type SegRow = typeof netSegments.$inferSelect;
type ObsRow = typeof netObservations.$inferSelect;

/** Sken segmentu – výchozí nmap, v testech náhrada. */
export type NetScanner = (p: { targets: string[]; exclude: string[]; profile: "ping" | "standard" | "os_detect" }) => Promise<DiscoveredAsset[]>;
export interface NetScanDeps {
  scanner?: NetScanner;
}

async function defaultScanner(db: Db, config: Config): Promise<NetScanner> {
  const sc = await getScanConfig(db, config);
  const conn = createNmapConnector({ nmapPath: sc.nmapPath, allowedCidrs: sc.allowedCidrs });
  return async (p) => {
    const out: DiscoveredAsset[] = [];
    for await (const x of conn.collect(p, { log: () => {} })) out.push(x);
    return out;
  };
}

/** Ověří rozsahy segmentu proti povoleným rozsahům skenu. */
export async function assertSegmentAllowed(db: Db, config: Config, cidrs: string[], exclude: string[]) {
  const sc = await getScanConfig(db, config);
  try {
    assertTargetsAllowed(cidrs, sc.allowedCidrs);
    for (const x of exclude) if (!parseCidr(x)) throw new Error(`Neplatná výjimka: ${x}`);
  } catch (e) {
    throw new HTTPException(400, { message: (e as Error).message });
  }
}

const isRunning = async (db: Db, runId: string | null) => {
  if (!runId) return false;
  const [r] = await db.select({ status: discoveryRuns.status, startedAt: discoveryRuns.startedAt }).from(discoveryRuns).where(eq(discoveryRuns.id, runId));
  // běh starší 6 h považujeme za přerušený (restart serveru)
  return r?.status === "running" && !!r.startedAt && Date.now() - r.startedAt.getTime() < 6 * 3600_000;
};

/** Sken jednoho segmentu: hostitelé → porovnání s aktivy → pozorování → alerty na neevidovaná / změněná zařízení. */
export async function runSegmentScan(db: Db, config: Config, segmentId: string, trigger: "manual" | "schedule", deps: NetScanDeps = {}): Promise<{ runId: string; done: Promise<NetScanSummary> }> {
  const [seg] = await db.select().from(netSegments).where(eq(netSegments.id, segmentId));
  if (!seg) throw new HTTPException(404, { message: "Segment nenalezen" });
  if (await isRunning(db, seg.lastRunId)) throw new HTTPException(409, { message: "Sken segmentu už běží" });
  const [run] = await db
    .insert(discoveryRuns)
    .values({ connector: "network_scan", status: "running", companyId: seg.companyId, startedAt: new Date(), params: { segmentId: seg.id, segment: seg.name, targets: seg.cidrs, exclude: seg.exclude, profile: seg.profile, mode: seg.mode, trigger } } as typeof discoveryRuns.$inferInsert)
    .returning({ id: discoveryRuns.id });
  const runId = run!.id;
  const startedAt = new Date();
  await db.update(netSegments).set({ lastRunId: runId, lastRunAt: startedAt, nextRunAt: nextScanAt(seg as never, startedAt) }).where(eq(netSegments.id, seg.id));

  const done = (async (): Promise<NetScanSummary> => {
    const sum: NetScanSummary = { up: 0, known: 0, unknown: 0, newUnknown: 0, changed: 0, approved: 0, alerts: 0 };
    const log: string[] = [];
    try {
      const sc = await getScanConfig(db, config);
      if (!deps.scanner && !scanReady(sc)) throw new Error("Síťový sken je vypnutý nebo nemá povolené rozsahy (Administrace → Konektory).");
      assertTargetsAllowed(seg.cidrs, sc.allowedCidrs);
      const scanner = deps.scanner ?? (await defaultScanner(db, config));
      const hosts = await scanner({ targets: seg.cidrs, exclude: seg.exclude, profile: seg.profile as "ping" });
      sum.up = hosts.length;
      // režim evidence: nejdřív zapsat do inventáře (existující párování podle MAC / jména / zdroje)
      if (seg.mode === "inventory") for (const h of hosts) await ingestDiscovered(db, h, seg.companyId).catch((e) => log.push(`${h.name}: ${(e as Error).message}`));
      // aktiva společnosti segmentu a nadřazených (skupinová infrastruktura)
      const all = await getCompanies(db);
      const cos = ancestorsOf(all, seg.companyId);
      const list: NetAssetRef[] = await db
        .select({ id: assets.id, name: assets.name, hostname: assets.hostname, fqdn: assets.fqdn, ipAddresses: assets.ipAddresses, macAddresses: assets.macAddresses })
        .from(assets)
        .where(and(inArray(assets.companyId, cos), sql`${assets.lifecycleStatus} not in ('retired', 'disposed')`));
      const names = new Map(list.map((a) => [a.id, a.name]));
      const prev = new Map((await db.select().from(netObservations).where(eq(netObservations.segmentId, seg.id))).map((o) => [o.hostKey, o]));
      const now = new Date();
      const alertIds: string[] = [];
      for (const h of hosts) {
        const host = { ip: h.ipAddresses?.[0] ?? null, mac: h.macAddresses?.[0] ?? null, hostname: h.hostname ?? null };
        const key = netHostKey(host);
        const m = matchHost(host, list);
        const old = prev.get(key);
        let status: NetObsStatus = m.status;
        if (old?.status === "approved" && m.status === "unknown") status = "approved";
        const assetId = m.status === "unknown" ? (old?.assetId ?? null) : m.assetId;
        if (m.status !== "unknown") await db.update(assets).set({ lastSeenAt: now }).where(eq(assets.id, m.assetId));
        let alertId = old?.alertId ?? null;
        if (status === "unknown" || status === "changed") {
          const ruleId = status === "unknown" ? "netscan-unknown" : "netscan-changed";
          const groupKey = `netscan:${seg.id}:${key}`.slice(0, 200);
          const title =
            status === "unknown"
              ? `Neevidované zařízení v síti: ${host.ip ?? host.mac}${host.hostname ? ` (${host.hostname})` : ""}`
              : `Změna zařízení na adrese ${host.ip} – aktivum ${names.get(assetId!) ?? ""}`;
          const description =
            status === "unknown"
              ? `Sken segmentu „${seg.name}“ našel zařízení, které není v evidenci aktiv (IP ${host.ip ?? "?"}, MAC ${host.mac ?? "?"}${h.manufacturer ? `, ${h.manufacturer}` : ""}). Ověřte, zda jde o povolené zařízení – založte aktivum nebo ho schvalte; jinak řešte jako možné neoprávněné připojení.`
              : `Adresa ${host.ip} patří aktivu „${names.get(assetId!) ?? ""}“, ale odpověděla jiná MAC adresa (${host.mac}, očekávána ${m.status === "changed" ? m.expectedMacs.join(", ") : "?"}). Může jít o výměnu zařízení, nebo podvržení adresy.`;
          const [open] = await db
            .select({ id: alertSuggestions.id, count: alertSuggestions.count })
            .from(alertSuggestions)
            .where(and(eq(alertSuggestions.groupKey, groupKey), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])))
            .limit(1);
          if (open) {
            await db.update(alertSuggestions).set({ count: open.count + 1, lastSeen: now, updatedAt: now }).where(eq(alertSuggestions.id, open.id));
            alertId = open.id;
          } else {
            const [a] = await db
              .insert(alertSuggestions)
              .values({
                companyId: seg.companyId,
                source: "netscan",
                groupKey,
                ruleId,
                ruleLevel: status === "changed" ? Math.min(15, seg.alertLevel + 2) : seg.alertLevel,
                title: title.slice(0, 300),
                description: description.slice(0, 2000),
                agentName: host.hostname ?? host.ip,
                assetId: status === "changed" ? assetId : null,
                firstSeen: now,
                lastSeen: now,
                count: 1,
                mitreIds: ["T1200"],
                mitreTactics: ["initial-access"],
                sample: Object.fromEntries(Object.entries({ dstip: host.ip, mac: host.mac, hostname: host.hostname, vendor: h.manufacturer, os: h.osName, segment: seg.name, segmentId: seg.id, openPorts: (h.attributes?.openPorts as unknown[] | undefined)?.slice(0, 20) }).filter(([, v]) => v != null)),
              })
              .returning({ id: alertSuggestions.id });
            alertId = a!.id;
            alertIds.push(a!.id);
            sum.alerts++;
          }
          if (status === "unknown" && (!old || old.status !== "unknown")) sum.newUnknown++;
        }
        sum[status]++;
        const values = {
          ip: host.ip,
          mac: host.mac,
          hostname: host.hostname,
          vendor: h.manufacturer ?? null,
          osName: h.osName ?? null,
          openPorts: ((h.attributes?.openPorts as ObsRow["openPorts"] | undefined) ?? []).slice(0, 50),
          status,
          assetId,
          alertId,
          lastSeen: now,
        };
        if (old) await db.update(netObservations).set({ ...values, seenCount: old.seenCount + 1 }).where(eq(netObservations.id, old.id));
        else await db.insert(netObservations).values({ ...values, companyId: seg.companyId, segmentId: seg.id, hostKey: key, firstSeen: now });
      }
      if (alertIds.length) await correlateAlerts(db, now).catch(() => 0);
      await db.update(discoveryRuns).set({ status: "succeeded", finishedAt: new Date(), stats: { discovered: sum.up, created: 0, updated: sum.known, conflicts: 0, failed: 0, unknown: sum.unknown, alerts: sum.alerts }, log }).where(eq(discoveryRuns.id, runId));
    } catch (e) {
      sum.error = (e as Error).message.slice(0, 500);
      await db.update(discoveryRuns).set({ status: "failed", finishedAt: new Date(), error: sum.error, log }).where(eq(discoveryRuns.id, runId));
    }
    await db.update(netSegments).set({ lastSummary: sum }).where(eq(netSegments.id, seg.id));
    return sum;
  })();
  return { runId, done };
}

/** Plánovač: segmenty s plánem, jejichž čas nastal (postupně, jeden po druhém). */
export async function processNetScans(db: Db, config: Config, deps: NetScanDeps = {}, now = new Date()): Promise<number> {
  if (!((await getSettings(db)).enabledModules as string[]).includes("discovery")) return 0;
  if (!(await acquireLease(db, "netscan", 3 * 3600_000))) return 0;
  const due = await db
    .select()
    .from(netSegments)
    .where(and(eq(netSegments.enabled, true), sql`${netSegments.schedule} <> 'manual'`, lte(netSegments.nextRunAt, now)))
    .orderBy(asc(netSegments.nextRunAt));
  // segment s plánem, který ještě nemá nextRunAt (nově založený) – naplánovat
  await db
    .update(netSegments)
    .set({ nextRunAt: now })
    .where(and(eq(netSegments.enabled, true), sql`${netSegments.schedule} <> 'manual'`, sql`${netSegments.nextRunAt} is null`));
  let n = 0;
  for (const s of due) {
    try {
      const { done } = await runSegmentScan(db, config, s.id, "schedule", deps);
      await done;
      n++;
    } catch (e) {
      console.error("Sken segmentu", s.name, (e as Error).message);
    }
  }
  return n;
}

/* ---------- API ---------- */

export function netSegmentRoutes(db: Db, config: Config, deps: NetScanDeps = {}) {
  const segRow = async (c: Ctx, id: string) => {
    const [s] = await db.select().from(netSegments).where(eq(netSegments.id, id));
    assertScope(c, s?.companyId, "Segment nenalezen");
    return s!;
  };
  const obsRow = async (c: Ctx, id: string) => {
    const [o] = await db.select().from(netObservations).where(eq(netObservations.id, id));
    assertScope(c, o?.companyId, "Záznam nenalezen");
    return o!;
  };
  const writeIn = (c: Ctx, companyId: string, perm: "discovery:run" | "assets:write") => {
    if (!hasPermIn(c, perm, companyId)) throw new HTTPException(403, { message: "Nemáte oprávnění v této společnosti" });
  };
  async function segDtos(c: Ctx, where = inScope(c, netSegments.companyId)): Promise<NetSegmentDto[]> {
    const rows = await db.select().from(netSegments).where(where).orderBy(asc(netSegments.name));
    const ids = rows.map((r) => r.id);
    const counts = ids.length ? await db.select({ seg: netObservations.segmentId, status: netObservations.status, n: count() }).from(netObservations).where(inArray(netObservations.segmentId, ids)).groupBy(netObservations.segmentId, netObservations.status) : [];
    const runIds = rows.map((r) => r.lastRunId).filter((x): x is string => !!x);
    const runs = runIds.length ? await db.select({ id: discoveryRuns.id, status: discoveryRuns.status, startedAt: discoveryRuns.startedAt }).from(discoveryRuns).where(inArray(discoveryRuns.id, runIds)) : [];
    return rows.map((r) => {
      const run = runs.find((x) => x.id === r.lastRunId);
      return {
        id: r.id,
        companyId: r.companyId,
        name: r.name,
        cidrs: r.cidrs,
        exclude: r.exclude,
        profile: r.profile as NetSegmentDto["profile"],
        mode: r.mode as NetSegmentDto["mode"],
        schedule: r.schedule as NetScanSchedule,
        scheduleTime: r.scheduleTime,
        scheduleWeekday: r.scheduleWeekday,
        alertLevel: r.alertLevel,
        enabled: r.enabled,
        note: r.note,
        lastRunAt: r.lastRunAt?.toISOString() ?? null,
        nextRunAt: r.nextRunAt?.toISOString() ?? null,
        lastRunId: r.lastRunId,
        lastSummary: r.lastSummary ?? null,
        running: run?.status === "running" && !!run.startedAt && Date.now() - run.startedAt.getTime() < 6 * 3600_000,
        counts: Object.fromEntries((["unknown", "known", "changed", "approved"] as const).map((s) => [s, counts.find((x) => x.seg === r.id && x.status === s)?.n ?? 0])) as NetSegmentDto["counts"],
      };
    });
  }
  async function obsDtos(where: ReturnType<typeof and>): Promise<NetObservationDto[]> {
    const rows = await db
      .select({ o: netObservations, segmentName: netSegments.name, assetName: assets.name })
      .from(netObservations)
      .innerJoin(netSegments, eq(netSegments.id, netObservations.segmentId))
      .leftJoin(assets, eq(assets.id, netObservations.assetId))
      .where(where)
      .orderBy(desc(netObservations.lastSeen))
      .limit(2000);
    return rows.map(({ o, segmentName, assetName }) => ({
      id: o.id,
      segmentId: o.segmentId,
      segmentName,
      ip: o.ip,
      mac: o.mac,
      hostname: o.hostname,
      vendor: o.vendor,
      osName: o.osName,
      openPorts: o.openPorts,
      status: o.status as NetObsStatus,
      assetId: o.assetId,
      assetName: assetName ?? null,
      alertId: o.alertId,
      firstSeen: o.firstSeen.toISOString(),
      lastSeen: o.lastSeen.toISOString(),
      seenCount: o.seenCount,
      note: o.note,
    }));
  }
  const trail = (c: Ctx, action: string, entityId: string, details: Record<string, unknown>) => audit(db, { c, user: currentUser(c), action: `netscan.${action}`, entityType: "net_segment", entityId, details });

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "discovery"))
    .get("/", requirePerm("assets:read"), async (c) => {
      const sc = await getScanConfig(db, config);
      const nmap = await nmapInfo(sc.nmapPath);
      return c.json({ segments: await segDtos(c), scan: { enabled: sc.enabled, allowedCidrs: sc.allowedCidrs, nmap: !!nmap.found || !!deps.scanner } });
    })
    .post("/", requirePerm("discovery:run"), zValidator("json", NetSegmentInput), async (c) => {
      const { companyId: requested, ...input } = c.req.valid("json");
      const companyId = targetCompany(c, requested, "discovery:run");
      await assertSegmentAllowed(db, config, input.cidrs, input.exclude);
      const nextRunAt = input.enabled ? nextScanAt(input as never, new Date()) : null;
      const [s] = await db.insert(netSegments).values({ ...input, companyId, nextRunAt }).returning();
      await trail(c, "segment_created", s!.id, { name: s!.name, cidrs: s!.cidrs, schedule: s!.schedule });
      return c.json((await segDtos(c, eq(netSegments.id, s!.id)))[0], 201);
    })
    .patch("/:id", requirePerm("discovery:run"), zValidator("json", NetSegmentPatch), async (c) => {
      const cur = await segRow(c, c.req.param("id"));
      writeIn(c, cur.companyId, "discovery:run");
      const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<SegRow>;
      const next = { ...cur, ...input };
      if (input.cidrs || input.exclude) await assertSegmentAllowed(db, config, next.cidrs, next.exclude);
      const nextRunAt = next.enabled ? nextScanAt(next as never, new Date()) : null;
      await db.update(netSegments).set({ ...input, nextRunAt, updatedAt: new Date() }).where(eq(netSegments.id, cur.id));
      await trail(c, "segment_updated", cur.id, input);
      return c.json((await segDtos(c, eq(netSegments.id, cur.id)))[0]);
    })
    .delete("/:id", requirePerm("discovery:run"), async (c) => {
      const cur = await segRow(c, c.req.param("id"));
      writeIn(c, cur.companyId, "discovery:run");
      await db.delete(netSegments).where(eq(netSegments.id, cur.id));
      await trail(c, "segment_deleted", cur.id, { name: cur.name });
      return c.body(null, 204);
    })
    .post("/:id/run", requirePerm("discovery:run"), async (c) => {
      const cur = await segRow(c, c.req.param("id"));
      writeIn(c, cur.companyId, "discovery:run");
      const sc = await getScanConfig(db, config);
      if (!deps.scanner && (!scanReady(sc) || !(await nmapInfo(sc.nmapPath)).found)) throw new HTTPException(400, { message: "Síťový sken je vypnutý nebo chybí nmap (Administrace → Konektory)." });
      const { runId, done } = await runSegmentScan(db, config, cur.id, "manual", deps);
      await trail(c, "scan_started", cur.id, { runId });
      if (c.req.query("wait") === "1") return c.json({ runId, summary: await done });
      void done;
      return c.json({ runId }, 202);
    })
    .get("/observations", requirePerm("assets:read"), zValidator("query", z.object({ segmentId: z.string().uuid().optional(), status: z.enum(["unknown", "known", "changed", "approved"]).optional() })), async (c) => {
      const q = c.req.valid("query");
      const where = and(inScope(c, netObservations.companyId), q.segmentId ? eq(netObservations.segmentId, q.segmentId) : undefined, q.status ? eq(netObservations.status, q.status) : undefined);
      return c.json(await obsDtos(where));
    })
    .post("/observations/:id/approve", requirePerm("discovery:run"), zValidator("json", NetObsDecision), async (c) => {
      const o = await obsRow(c, c.req.param("id"));
      writeIn(c, o.companyId, "discovery:run");
      const note = c.req.valid("json").note ?? null;
      await db.update(netObservations).set({ status: "approved", note, decidedById: currentUser(c).id, decidedAt: new Date() }).where(eq(netObservations.id, o.id));
      await trail(c, "device_approved", o.segmentId, { ip: o.ip, mac: o.mac, note });
      return c.json((await obsDtos(eq(netObservations.id, o.id)))[0]);
    })
    .post("/observations/:id/reset", requirePerm("discovery:run"), async (c) => {
      const o = await obsRow(c, c.req.param("id"));
      writeIn(c, o.companyId, "discovery:run");
      await db.update(netObservations).set({ status: o.assetId ? "known" : "unknown", note: null, decidedById: currentUser(c).id, decidedAt: new Date() }).where(eq(netObservations.id, o.id));
      await trail(c, "device_reset", o.segmentId, { ip: o.ip, mac: o.mac });
      return c.json((await obsDtos(eq(netObservations.id, o.id)))[0]);
    })
    .post("/observations/:id/create-asset", requirePerm("assets:write"), zValidator("json", NetObsCreateAsset), async (c) => {
      const o = await obsRow(c, c.req.param("id"));
      writeIn(c, o.companyId, "assets:write");
      if (o.status === "known" && o.assetId) throw new HTTPException(409, { message: "Zařízení už je v evidenci" });
      const body = c.req.valid("json");
      const type = (body.assetType ?? "other") as AssetType;
      const now = new Date();
      const [a] = await db
        .insert(assets)
        .values({
          companyId: o.companyId,
          name: body.name ?? o.hostname ?? o.ip ?? o.mac ?? "Zařízení",
          assetType: type,
          assetClass: defaultAssetClass(type),
          hostname: o.hostname,
          ipAddresses: o.ip ? [o.ip] : [],
          macAddresses: o.mac ? [o.mac] : [],
          manufacturer: o.vendor,
          osName: o.osName,
          attributes: { openPorts: o.openPorts },
          firstSeenAt: o.firstSeen,
          lastSeenAt: now,
        })
        .returning({ id: assets.id, name: assets.name });
      await db.update(netObservations).set({ status: "known", assetId: a!.id, decidedById: currentUser(c).id, decidedAt: now }).where(eq(netObservations.id, o.id));
      await audit(db, { c, user: currentUser(c), action: "asset.created", entityType: "asset", entityId: a!.id, details: { name: a!.name, from: "netscan", ip: o.ip, mac: o.mac } });
      return c.json((await obsDtos(eq(netObservations.id, o.id)))[0], 201);
    })
    .post("/observations/:id/link", requirePerm("assets:write"), zValidator("json", NetObsLink), async (c) => {
      const o = await obsRow(c, c.req.param("id"));
      writeIn(c, o.companyId, "assets:write");
      const { assetId } = c.req.valid("json");
      const [a] = await db.select({ id: assets.id, companyId: assets.companyId, ips: assets.ipAddresses, macs: assets.macAddresses }).from(assets).where(eq(assets.id, assetId));
      assertScope(c, a?.companyId, "Aktivum nenalezeno");
      const ips = [...new Set([...(a!.ips ?? []), ...(o.ip ? [o.ip] : [])])];
      const macs = [...new Set([...(a!.macs ?? []), ...(o.mac ? [o.mac] : [])])];
      await db.update(assets).set({ ipAddresses: ips, macAddresses: macs, lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(assets.id, a!.id));
      await db.update(netObservations).set({ status: "known", assetId: a!.id, decidedById: currentUser(c).id, decidedAt: new Date() }).where(eq(netObservations.id, o.id));
      await audit(db, { c, user: currentUser(c), action: "asset.updated", entityType: "asset", entityId: a!.id, details: { from: "netscan", ip: o.ip, mac: o.mac } });
      return c.json((await obsDtos(eq(netObservations.id, o.id)))[0]);
    });
}
