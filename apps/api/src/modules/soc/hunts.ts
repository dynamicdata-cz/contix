import {
  ATTACK_ID_RE,
  SEVERITY_LEVEL,
  SOC_HUNT_MAX_BUCKETS,
  SOC_HUNT_TEMPLATES,
  SOC_OPEN_STATUSES,
  SocHuntInput,
  SocHuntPatch,
  huntNextRun,
  tacticsFor,
  type SocHuntBucket,
  type SocHuntDto,
  type SocHuntRun,
  type SocSeverity,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, assetSources, socHunts, users } from "../../db/schema";
import { getAlertSettings } from "../alerts/routes";
import { getWazuhConfig } from "../connectors/config";
import type { FetchLike } from "../discovery/connectors/wazuh";
import type { Mailer, TeamsPoster } from "../notifications/service";
import { indexerCall } from "../vulnerabilities/sources";
import { refreshExposure } from "./exposure";
import { notifyNewAlerts } from "./response";
import { activeSuppressions, correlateAlerts, suppressGroup } from "./service";

/* ============================================================
 * Plánované hledání hrozeb (ADR-059): query_string do alertů Wazuh Indexeru nad oknem
 * od posledního běhu, seskupení podle pole, skupiny nad prahem → alert `source = hunt`.
 * Indexer se jen čte; okno se při chybě neposouvá; zkušební běh nic neukládá.
 * ============================================================ */

type Deps = { db: Db; config: Config; fetchImpl?: FetchLike; mailer?: Mailer; teams?: TeamsPoster };
type Row = typeof socHunts.$inferSelect;
type Ctx = Context<AppEnv>;

const str = (v: unknown) => (v == null ? null : String(v));
const tsOf = (v: { value_as_string?: string; value?: number } | undefined) => v?.value_as_string ?? (v?.value ? new Date(v.value).toISOString() : null);

/** Dotaz do indexeru – vrátí celkový počet a skupiny nad prahem. */
async function searchHunt(d: Deps, h: Pick<Row, "query" | "groupBy" | "threshold">, since: Date, until: Date): Promise<{ total: number; buckets: SocHuntBucket[] }> {
  const w = await getWazuhConfig(d.db, d.config);
  if (!w.indexerUrl || !w.indexerUser || !w.indexerPassword) throw new Error("Wazuh Indexer není nastaven (Administrace → Konektory).");
  const al = await getAlertSettings(d.db);
  const res = await indexerCall(
    { url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword, verifyTls: w.indexerVerifyTls, indexPattern: al.alertsIndexPattern },
    `/${encodeURIComponent(al.alertsIndexPattern).replace(/%2A/g, "*")}/_search`,
    {
      size: 0,
      track_total_hits: true,
      query: { bool: { filter: [{ range: { timestamp: { gt: since.toISOString(), lte: until.toISOString() } } }, { query_string: { query: h.query, analyze_wildcard: true, default_operator: "AND", lenient: true } }] } },
      aggs: {
        hunt: {
          terms: { field: h.groupBy, size: SOC_HUNT_MAX_BUCKETS, min_doc_count: h.threshold, order: { _count: "desc" } },
          aggs: {
            first: { min: { field: "timestamp" } },
            last: { max: { field: "timestamp" } },
            agent: { top_hits: { size: 1, _source: ["agent.id", "agent.name"], sort: [{ timestamp: { order: "desc" } }] } },
          },
        },
      },
    },
    d.fetchImpl ?? (fetch as FetchLike),
  );
  const tot = res.hits?.total;
  const buckets: SocHuntBucket[] = ((res.aggregations?.hunt?.buckets ?? []) as any[])
    .filter((b) => (Number(b.doc_count) || 0) >= h.threshold)
    .map((b) => {
      const ag = b.agent?.hits?.hits?.[0]?._source?.agent ?? {};
      return {
        key: String(b.key).slice(0, 255),
        count: Number(b.doc_count) || 0,
        agentId: h.groupBy === "agent.id" ? String(b.key) : str(ag.id),
        agentName: str(ag.name)?.slice(0, 255) ?? null,
        first: tsOf(b.first),
        last: tsOf(b.last),
      };
    });
  return { total: Number(typeof tot === "object" ? tot?.value : tot) || 0, buckets };
}

/** Skupiny → alerty SOC (nový nebo navýšení otevřeného se stejným klíčem). */
async function alertsFor(d: Deps, h: Row, buckets: SocHuntBucket[], now: Date): Promise<{ alerts: number; ids: string[] }> {
  const suppressions = await activeSuppressions(d.db, now);
  const ruleId = `hunt:${h.id.slice(0, 8)}`;
  const mitreIds = h.mitreIds.filter((m) => ATTACK_ID_RE.test(m));
  let alerts = 0;
  const ids: string[] = [];
  for (const b of buckets) {
    const [asset] = b.agentId
      ? await d.db
          .select({ id: assets.id, companyId: assets.companyId })
          .from(assetSources)
          .innerJoin(assets, eq(assets.id, assetSources.assetId))
          .where(and(eq(assetSources.sourceType, "wazuh"), eq(assetSources.sourceRef, b.agentId)))
      : [];
    const companyId = asset?.companyId ?? h.companyId;
    const first = b.first ? new Date(b.first) : now;
    const last = b.last ? new Date(b.last) : now;
    if (suppressions.length && (await suppressGroup(d.db, suppressions, { companyId, ruleId, agentId: b.agentId, srcip: h.groupBy === "data.srcip" ? b.key : null, n: b.count, last }))) continue;
    const key = `hunt:${h.id}:${b.key}`.slice(0, 200);
    const [open] = await d.db
      .select()
      .from(alertSuggestions)
      .where(and(eq(alertSuggestions.groupKey, key), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])))
      .limit(1);
    if (open) {
      await d.db
        .update(alertSuggestions)
        .set({ count: open.count + b.count, lastSeen: last > open.lastSeen ? last : open.lastSeen, updatedAt: new Date() })
        .where(eq(alertSuggestions.id, open.id));
      ids.push(open.id);
      continue;
    }
    const [row] = await d.db
      .insert(alertSuggestions)
      .values({
        companyId,
        source: "hunt",
        groupKey: key,
        ruleId,
        ruleLevel: SEVERITY_LEVEL[h.severity as SocSeverity] ?? 7,
        title: `Hledání hrozeb: ${h.name} – ${b.key}`.slice(0, 300),
        description: `${h.hypothesis ? `${h.hypothesis} ` : ""}Dotaz „${h.query}“ našel ${b.count}× (${h.groupBy} = ${b.key}).`.slice(0, 2000),
        agentId: b.agentId,
        agentName: b.agentName,
        assetId: asset?.id ?? null,
        firstSeen: first,
        lastSeen: last,
        count: b.count,
        mitreIds,
        mitreTactics: tacticsFor(mitreIds),
        sample: { huntId: h.id, huntName: h.name, query: h.query, groupBy: h.groupBy, key: b.key, ...(h.groupBy === "data.srcip" ? { srcip: b.key } : {}) },
      })
      .returning({ id: alertSuggestions.id });
    ids.push(row!.id);
    alerts++;
  }
  return { alerts, ids };
}

/** Jeden běh hledání. Zkušební běh (`dryRun`) jen vrátí skupiny, nic neuloží. */
export async function runHunt(d: Deps, h: Row, opts: { dryRun?: boolean; now?: Date } = {}): Promise<SocHuntRun> {
  const now = opts.now ?? new Date();
  const since = !opts.dryRun && h.windowEnd ? h.windowEnd : new Date(now.getTime() - h.lookbackHours * 3600_000);
  const run: SocHuntRun = { at: now.toISOString(), since: since.toISOString(), until: now.toISOString(), total: 0, buckets: [], alerts: 0, error: null, dryRun: !!opts.dryRun };
  try {
    const r = await searchHunt(d, h, since, now);
    run.total = r.total;
    run.buckets = r.buckets;
    if (!opts.dryRun && r.buckets.length) {
      const a = await alertsFor(d, h, r.buckets, now);
      run.alerts = a.alerts;
      if (a.ids.length) {
        await refreshExposure(d.db, a.ids);
        await correlateAlerts(d.db, now);
        if (a.alerts) await notifyNewAlerts(d).catch(() => {});
      }
    }
  } catch (e) {
    run.error = (e as Error).message.slice(0, 500);
  }
  if (!opts.dryRun)
    await d.db
      .update(socHunts)
      .set({ lastRun: run as unknown as Record<string, unknown>, ...(run.error ? {} : { windowEnd: now }), updatedAt: new Date() })
      .where(eq(socHunts.id, h.id));
  return run;
}

/** Plánovač: spustí zapnutá hledání, kterým uplynul interval. */
export async function processHunts(d: Deps, now = new Date()): Promise<number> {
  const rows = await d.db.select().from(socHunts).where(eq(socHunts.enabled, true));
  let n = 0;
  for (const h of rows) {
    const next = huntNextRun({ enabled: h.enabled, intervalHours: h.intervalHours, lastRun: (h.lastRun as unknown as SocHuntRun | null) ?? null });
    if (!next || new Date(next) > now) continue;
    await runHunt(d, h, { now });
    n++;
  }
  return n;
}

async function dtos(db: Db, where: SQL | undefined): Promise<SocHuntDto[]> {
  const rows = await db
    .select({
      h: socHunts,
      by: users.displayName,
      open: sql<number>`(select count(*)::int from ${alertSuggestions} a where a.group_key like 'hunt:' || ${socHunts.id}::text || ':%' and a.status in ('new','in_progress'))`,
    })
    .from(socHunts)
    .leftJoin(users, eq(users.id, socHunts.createdById))
    .where(where)
    .orderBy(desc(socHunts.enabled), socHunts.name);
  return rows.map(({ h, by, open }) => {
    const lastRun = (h.lastRun as unknown as SocHuntRun | null) ?? null;
    return {
      id: h.id,
      companyId: h.companyId,
      name: h.name,
      hypothesis: h.hypothesis,
      query: h.query,
      groupBy: h.groupBy,
      threshold: h.threshold,
      intervalHours: h.intervalHours,
      lookbackHours: h.lookbackHours,
      severity: h.severity as SocSeverity,
      mitreIds: h.mitreIds,
      enabled: h.enabled,
      templateKey: h.templateKey,
      lastRun,
      nextRunAt: huntNextRun({ enabled: h.enabled, intervalHours: h.intervalHours, lastRun }),
      openAlerts: open,
      createdByName: by,
      updatedAt: h.updatedAt.toISOString(),
    };
  });
}

export function socHuntRoutes(deps: Deps) {
  const { db } = deps;
  const inIds = (c: Ctx): SQL => {
    const l = scopeOf(c).ids.filter((id) => hasPermIn(c, "soc:read", id));
    return l.length ? inArray(socHunts.companyId, l) : sql`false`;
  };
  async function load(c: Ctx, id: string): Promise<Row> {
    const [r] = await db.select().from(socHunts).where(eq(socHunts.id, id));
    assertScope(c, r?.companyId, "Hledání nenalezeno");
    if (!hasPermIn(c, "soc:write", r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r!;
  }
  const one = async (id: string) => (await dtos(db, eq(socHunts.id, id)))[0]!;

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "soc"))
    .get("/hunts", requirePerm("soc:read"), async (c) => c.json(await dtos(db, inIds(c))))
    .get("/hunts/templates", requirePerm("soc:read"), (c) => c.json(SOC_HUNT_TEMPLATES))
    .post("/hunts", requirePerm("soc:write"), zValidator("json", SocHuntInput), async (c) => {
      const { companyId: requested, ...input } = c.req.valid("json");
      const companyId = targetCompany(c, requested, "soc:write");
      const [r] = await db
        .insert(socHunts)
        .values({ ...input, templateKey: input.templateKey ?? null, companyId, createdById: currentUser(c).id })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "soc.hunt_created", entityType: "soc_hunt", entityId: r!.id, details: { name: r!.name, query: r!.query } });
      return c.json(await one(r!.id), 201);
    })
    .patch("/hunts/:id", requirePerm("soc:write"), zValidator("json", SocHuntPatch), async (c) => {
      const cur = await load(c, c.req.param("id"));
      const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
      // změna dotazu nebo seskupení → okno znovu od „zpět o“ (lookback)
      const reset = ("query" in input && input.query !== cur.query) || ("groupBy" in input && input.groupBy !== cur.groupBy);
      await db
        .update(socHunts)
        .set({ ...input, ...(reset ? { windowEnd: null } : {}), updatedAt: new Date() })
        .where(eq(socHunts.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "soc.hunt_updated", entityType: "soc_hunt", entityId: cur.id, details: input });
      return c.json(await one(cur.id));
    })
    .delete("/hunts/:id", requirePerm("soc:write"), async (c) => {
      const cur = await load(c, c.req.param("id"));
      await db.delete(socHunts).where(eq(socHunts.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "soc.hunt_deleted", entityType: "soc_hunt", entityId: cur.id, details: { name: cur.name } });
      return c.body(null, 204);
    })
    /** Spustit hned (`dryRun=1` = zkušební běh bez alertů, okno „zpět o“). */
    .post("/hunts/:id/run", requirePerm("soc:write"), zValidator("query", z.object({ dryRun: z.enum(["0", "1"]).default("0") })), async (c) => {
      const cur = await load(c, c.req.param("id"));
      const dryRun = c.req.valid("query").dryRun === "1";
      const run = await runHunt(deps, cur, { dryRun });
      if (!dryRun) await audit(db, { c, user: currentUser(c), action: "soc.hunt_run", entityType: "soc_hunt", entityId: cur.id, details: { total: run.total, alerts: run.alerts, error: run.error } });
      return c.json({ run, hunt: await one(cur.id) });
    });
}
