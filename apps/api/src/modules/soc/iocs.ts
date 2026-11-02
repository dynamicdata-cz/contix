import {
  SOC_IOC_DEFAULT_DAYS,
  SOC_IOC_FEED_TYPES,
  SOC_IOC_MAX_DAYS,
  SocIocFeedInput,
  SocIocInput,
  SocIocPatch,
  defang,
  detectIocType,
  iocCandidatesOf,
  iocState,
  isPrivateIp,
  normalizeIoc,
  type SocIocAction,
  type SocIocCandidate,
  type SocIocCreateResult,
  type SocIocDto,
  type SocIocFeedDto,
  type SocIocFeedSecret,
  type SocIocHunt,
  type SocIocType,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, socIocFeeds, socIocs, users } from "../../db/schema";
import { getAlertSettings } from "../alerts/routes";
import { getWazuhConfig } from "../connectors/config";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { hashToken } from "../suppliers/questionnaires";
import { indexerCall } from "../vulnerabilities/sources";

/* ============================================================
 * Indikátory kompromitace (ADR-054): evidence, kandidáti z alertu (potvrzuje analytik), zpětné vyhledání
 * ve Wazuh Indexeru (jen čtení) a v alertech CONTIXu, export a feed k blokaci (jen platné IOC s akcí „blokovat“).
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof socIocs.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** Pole Wazuh alertů, ve kterých se hodnota hledá (frázově, `lenient` kvůli typům polí). */
const HUNT_FIELDS: Record<SocIocType, string[]> = {
  ip: ["data.srcip", "data.dstip", "data.src_ip", "data.dest_ip", "data.win.eventdata.ipAddress", "agent.ip", "full_log"],
  domain: ["data.url", "data.hostname", "data.dns.question.name", "data.win.eventdata.queryName", "data.http.hostname", "full_log"],
  url: ["data.url", "data.http.url", "full_log"],
  hash: ["syscheck.sha256_after", "syscheck.sha1_after", "syscheck.md5_after", "data.virustotal.source.sha1", "data.win.eventdata.hashes", "full_log"],
  email: ["data.srcuser", "data.dstuser", "data.office365.UserId", "full_log"],
};

/** Zpětné hledání IOC: Wazuh Indexer (agregace podle agenta) + alerty CONTIXu. Chyba indexeru se jen uloží. */
export async function huntIoc(db: Db, config: Config, ioc: Pick<Row, "companyId" | "type" | "value">, days: number, fetchImpl: FetchLike = fetch as FetchLike): Promise<SocIocHunt> {
  const since = new Date(Date.now() - days * 864e5);
  const [cx] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alertSuggestions)
    .where(and(eq(alertSuggestions.companyId, ioc.companyId), gte(alertSuggestions.lastSeen, since), or(ilike(sql`${alertSuggestions.sample}::text`, likeOf(ioc.value)), ilike(alertSuggestions.description, likeOf(ioc.value)))));
  const out: SocIocHunt = { at: new Date().toISOString(), days, total: 0, agents: [], contixAlerts: cx?.n ?? 0, error: null };
  try {
    const w = await getWazuhConfig(db, config);
    if (!w.indexerUrl || !w.indexerUser || !w.indexerPassword) throw new Error("Wazuh Indexer není nastaven (Administrace → Konektory) – hledalo se jen v alertech CONTIXu.");
    const al = await getAlertSettings(db);
    const index = encodeURIComponent(al.alertsIndexPattern).replace(/%2A/g, "*");
    const res = await indexerCall(
      { url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword, verifyTls: w.indexerVerifyTls, indexPattern: al.alertsIndexPattern },
      `/${index}/_search`,
      {
        size: 0,
        track_total_hits: true,
        query: { bool: { filter: [{ range: { timestamp: { gte: since.toISOString() } } }, { multi_match: { query: ioc.value, type: "phrase", fields: HUNT_FIELDS[ioc.type as SocIocType], lenient: true } }] } },
        aggs: { agents: { terms: { field: "agent.name", size: 25 }, aggs: { first: { min: { field: "timestamp" } }, last: { max: { field: "timestamp" } } } } },
      },
      fetchImpl,
    );
    const tot = res.hits?.total;
    out.total = Number(typeof tot === "object" ? tot?.value : tot) || 0;
    out.agents = ((res.aggregations?.agents?.buckets ?? []) as any[]).map((b) => ({
      name: String(b.key).slice(0, 255),
      count: Number(b.doc_count) || 0,
      first: b.first?.value_as_string ?? (b.first?.value ? new Date(b.first.value).toISOString() : null),
      last: b.last?.value_as_string ?? (b.last?.value ? new Date(b.last.value).toISOString() : null),
    }));
  } catch (e) {
    out.error = (e as Error).message.slice(0, 500);
  }
  return out;
}

async function dtos(db: Db, where: SQL | undefined, limit = 1000): Promise<SocIocDto[]> {
  const rows = await db
    .select({ i: socIocs, alertTitle: sql<string | null>`coalesce(${alertSuggestions.title}, ${alertSuggestions.description})`, by: users.displayName })
    .from(socIocs)
    .leftJoin(alertSuggestions, eq(alertSuggestions.id, socIocs.sourceAlertId))
    .leftJoin(users, eq(users.id, socIocs.createdById))
    .where(where)
    .orderBy(desc(socIocs.updatedAt))
    .limit(limit);
  const d = today();
  return rows.map(({ i, alertTitle, by }) => ({
    id: i.id,
    companyId: i.companyId,
    type: i.type as SocIocType,
    value: i.value,
    display: defang(i.type as SocIocType, i.value),
    action: i.action as SocIocAction,
    state: iocState({ revokedAt: i.revokedAt, validUntil: i.validUntil }, d),
    note: i.note,
    validUntil: i.validUntil,
    sourceAlertId: i.sourceAlertId,
    sourceAlertTitle: alertTitle,
    lastHunt: (i.lastHunt as unknown as SocIocHunt | null) ?? null,
    mispEventId: i.mispEventId,
    mispSharedAt: i.mispSharedAt?.toISOString() ?? null,
    createdByName: by,
    createdAt: i.createdAt.toISOString(),
  }));
}

/** Platné IOC k blokaci (export i feed). */
const blockable = (companyIds: string[], type?: SocIocType) =>
  and(inArray(socIocs.companyId, companyIds), eq(socIocs.action, "block"), isNull(socIocs.revokedAt), or(isNull(socIocs.validUntil), gte(socIocs.validUntil, today())), type ? eq(socIocs.type, type) : undefined);

export function socIocRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike }) {
  const { db, config } = deps;
  const ids = (c: Ctx, perm: "soc:read" | "soc:write" = "soc:read") => scopeOf(c).ids.filter((id) => hasPermIn(c, perm, id));
  const inIds = (c: Ctx): SQL => {
    const l = ids(c);
    return l.length ? inArray(socIocs.companyId, l) : sql`false`;
  };
  async function load(c: Ctx, id: string): Promise<Row> {
    const [r] = await db.select().from(socIocs).where(eq(socIocs.id, id));
    assertScope(c, r?.companyId, "IOC nenalezen");
    if (!hasPermIn(c, "soc:write", r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r!;
  }
  const one = async (id: string) => (await dtos(db, eq(socIocs.id, id)))[0]!;

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "soc"))
      .get("/iocs", requirePerm("soc:read"), zValidator("query", z.object({ state: z.enum(["active", "all"]).default("active"), type: z.enum(["ip", "domain", "url", "hash", "email"]).optional(), q: z.string().trim().max(200).optional() })), async (c) => {
        const q = c.req.valid("query");
        const d = today();
        return c.json(
          await dtos(
            db,
            and(
              inIds(c),
              q.state === "active" ? and(isNull(socIocs.revokedAt), or(isNull(socIocs.validUntil), gte(socIocs.validUntil, d))) : undefined,
              q.type ? eq(socIocs.type, q.type) : undefined,
              q.q ? or(ilike(socIocs.value, likeOf(q.q)), ilike(socIocs.note, likeOf(q.q))) : undefined,
            ),
          ),
        );
      })
      .post("/iocs", requirePerm("soc:write"), zValidator("json", SocIocInput), async (c) => {
        const input = c.req.valid("json");
        const user = currentUser(c);
        let companyId = targetCompany(c, input.companyId, "soc:write");
        if (input.sourceAlertId) {
          const [a] = await db.select({ companyId: alertSuggestions.companyId }).from(alertSuggestions).where(eq(alertSuggestions.id, input.sourceAlertId));
          assertScope(c, a?.companyId, "Alert nenalezen");
          if (!hasPermIn(c, "soc:write", a!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
          companyId = a!.companyId;
        }
        const validUntil = input.validUntil === null ? null : (input.validUntil ?? plusDays(SOC_IOC_DEFAULT_DAYS));
        if (validUntil && (validUntil < today() || validUntil > plusDays(SOC_IOC_MAX_DAYS))) throw new HTTPException(400, { message: "Platnost IOC musí být od dneška nejvýše na rok." });
        const res: SocIocCreateResult = { created: 0, updated: 0, rejected: [] };
        for (const it of input.items) {
          const type = it.type ?? detectIocType(it.value);
          const value = type ? normalizeIoc(type, it.value) : null;
          if (!type || !value) {
            res.rejected.push({ value: it.value.slice(0, 200), reason: "invalid" });
            continue;
          }
          if (type === "ip" && input.action === "block" && isPrivateIp(value)) {
            res.rejected.push({ value, reason: "private_ip" });
            continue;
          }
          const [ex] = await db.select().from(socIocs).where(and(eq(socIocs.companyId, companyId), eq(socIocs.type, type), eq(socIocs.value, value)));
          if (ex) {
            await db
              .update(socIocs)
              .set({ action: input.action, validUntil, revokedAt: null, revokedById: null, note: input.note || ex.note, sourceAlertId: ex.sourceAlertId ?? input.sourceAlertId ?? null, updatedAt: new Date() })
              .where(eq(socIocs.id, ex.id));
            res.updated++;
          } else {
            await db.insert(socIocs).values({ companyId, type, value, action: input.action, validUntil, note: input.note, sourceAlertId: input.sourceAlertId ?? null, createdById: user.id });
            res.created++;
          }
        }
        await audit(db, { c, user, action: "soc.iocs_added", details: { created: res.created, updated: res.updated, rejected: res.rejected.length, action: input.action, sourceAlertId: input.sourceAlertId } });
        return c.json(res, 201);
      })
      .patch("/iocs/:id", requirePerm("soc:write"), zValidator("json", SocIocPatch), async (c) => {
        const r = await load(c, c.req.param("id"));
        const input = c.req.valid("json");
        if (input.validUntil && (input.validUntil < today() || input.validUntil > plusDays(SOC_IOC_MAX_DAYS))) throw new HTTPException(400, { message: "Platnost IOC musí být od dneška nejvýše na rok." });
        if (input.action === "block" && r.type === "ip" && isPrivateIp(r.value)) throw new HTTPException(400, { message: "Interní adresu nelze blokovat." });
        await db.update(socIocs).set({ ...input, updatedAt: new Date() }).where(eq(socIocs.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "soc.ioc_updated", entityType: "soc_ioc", entityId: r.id, details: input });
        return c.json(await one(r.id));
      })
      .post("/iocs/:id/revoke", requirePerm("soc:write"), async (c) => {
        const r = await load(c, c.req.param("id"));
        if (r.revokedAt) throw new HTTPException(409, { message: "IOC už byl zrušen." });
        const user = currentUser(c);
        await db.update(socIocs).set({ revokedAt: new Date(), revokedById: user.id, updatedAt: new Date() }).where(eq(socIocs.id, r.id));
        await audit(db, { c, user, action: "soc.ioc_revoked", entityType: "soc_ioc", entityId: r.id, details: { type: r.type, value: r.value } });
        return c.json(await one(r.id));
      })
      .post("/iocs/:id/hunt", requirePerm("soc:write"), zValidator("json", z.object({ days: z.number().int().min(1).max(365).default(30) })), async (c) => {
        const r = await load(c, c.req.param("id"));
        const h = await huntIoc(db, config, r, c.req.valid("json").days, deps.fetchImpl);
        await db.update(socIocs).set({ lastHunt: h as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(socIocs.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "soc.ioc_hunt", entityType: "soc_ioc", entityId: r.id, details: { days: h.days, total: h.total, contixAlerts: h.contixAlerts } });
        return c.json(await one(r.id));
      })
      /** Kandidáti z alertu + už evidované hodnoty. */
      .get("/alerts/:id/iocs", requirePerm("soc:read"), async (c) => {
        const [a] = await db.select().from(alertSuggestions).where(eq(alertSuggestions.id, c.req.param("id")));
        assertScope(c, a?.companyId, "Alert nenalezen");
        if (!hasPermIn(c, "soc:read", a!.companyId)) throw new HTTPException(404, { message: "Alert nenalezen" });
        const cands = iocCandidatesOf({ source: a!.source, description: a!.description, sample: a!.sample ?? null });
        const existing = cands.length
          ? await db
              .select({ id: socIocs.id, type: socIocs.type, value: socIocs.value })
              .from(socIocs)
              .where(and(eq(socIocs.companyId, a!.companyId), inArray(socIocs.value, cands.map((x) => x.value))))
          : [];
        const out: SocIocCandidate[] = cands.map((x) => ({ ...x, display: defang(x.type, x.value), existingId: existing.find((e) => e.type === x.type && e.value === x.value)?.id ?? null }));
        return c.json(out);
      })
      /** Export platných IOC k blokaci – text (jeden na řádek) nebo CSV. */
      .get("/iocs/export", requirePerm("soc:read"), zValidator("query", z.object({ type: z.enum(SOC_IOC_FEED_TYPES).optional(), format: z.enum(["txt", "csv"]).default("txt") })), async (c) => {
        const q = c.req.valid("query");
        const rows = await db.select().from(socIocs).where(blockable(ids(c), q.type)).orderBy(socIocs.type, socIocs.value);
        const body =
          q.format === "csv"
            ? ["type,value,valid_until,note", ...rows.map((r) => [r.type, r.value, r.validUntil ?? "", r.note].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n")
            : rows.map((r) => r.value).join("\n");
        await audit(db, { c, user: currentUser(c), action: "soc.iocs_exported", details: { type: q.type ?? "all", format: q.format, count: rows.length } });
        return c.body(`${body}\n`, 200, {
          "content-type": q.format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="contix-ioc-${q.type ?? "all"}.${q.format}"`,
        });
      })
      /* ---------- feedy pro firewall / proxy ---------- */
      .get("/ioc-feeds", requirePerm("soc:read"), async (c) => {
        const l = ids(c);
        const rows = l.length ? await db.select().from(socIocFeeds).where(inArray(socIocFeeds.companyId, l)).orderBy(desc(socIocFeeds.createdAt)) : [];
        return c.json(rows.map(feedDto));
      })
      .post("/ioc-feeds", requirePerm("admin:settings"), zValidator("json", SocIocFeedInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, input.companyId, "admin:settings");
        const token = `cxf_${randomBytes(24).toString("base64url")}`;
        const user = currentUser(c);
        const [row] = await db.insert(socIocFeeds).values({ companyId, name: input.name, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), createdById: user.id }).returning();
        await audit(db, { c, user, action: "soc.ioc_feed_created", entityType: "soc_ioc_feed", entityId: row!.id, details: { name: input.name } });
        return c.json({ feed: feedDto(row!), token } satisfies SocIocFeedSecret, 201);
      })
      .delete("/ioc-feeds/:id", requirePerm("admin:settings"), async (c) => {
        const [f] = await db.select().from(socIocFeeds).where(eq(socIocFeeds.id, c.req.param("id")));
        assertScope(c, f?.companyId, "Feed nenalezen");
        if (!hasPermIn(c, "admin:settings", f!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        await db.delete(socIocFeeds).where(eq(socIocFeeds.id, f!.id));
        await audit(db, { c, user: currentUser(c), action: "soc.ioc_feed_deleted", entityType: "soc_ioc_feed", entityId: f!.id, details: { name: f!.name } });
        return c.json({ ok: true });
      })
  );
}

const feedDto = (f: typeof socIocFeeds.$inferSelect): SocIocFeedDto => ({
  id: f.id,
  companyId: f.companyId,
  name: f.name,
  tokenPrefix: f.tokenPrefix,
  fetches: f.fetches,
  lastFetchAt: f.lastFetchAt?.toISOString() ?? null,
  createdAt: f.createdAt.toISOString(),
});

/** Veřejný feed k blokaci: `/api/public/soc/feed/<token>/<ip|domain|url|hash>.txt` (External Dynamic List / Threat Feed). */
export function publicSocFeedRoutes(db: Db) {
  return new Hono().get("/feed/:token/:file", async (c) => {
    const m = c.req.param("file").match(/^(ip|domain|url|hash)\.txt$/);
    if (!m) return c.text("Nenalezeno\n", 404);
    const [f] = await db.select().from(socIocFeeds).where(eq(socIocFeeds.tokenHash, hashToken(c.req.param("token"))));
    if (!f) return c.text("Neplatný token feedu\n", 401);
    if (!((await getSettings(db)).enabledModules as string[]).includes("soc")) return c.text("Nenalezeno\n", 404);
    const rows = await db.select({ value: socIocs.value }).from(socIocs).where(blockable([f.companyId], m[1] as SocIocType)).orderBy(socIocs.value);
    await db.update(socIocFeeds).set({ fetches: sql`${socIocFeeds.fetches} + 1`, lastFetchAt: new Date() }).where(eq(socIocFeeds.id, f.id));
    return c.body(rows.map((r) => r.value).join("\n") + (rows.length ? "\n" : ""), 200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  });
}
