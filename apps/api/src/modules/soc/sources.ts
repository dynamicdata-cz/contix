import {
  PHISHING_EML_MAX_BYTES,
  SOC_INGEST_MAX_BYTES,
  SOC_INGEST_MAX_EVENTS,
  SocSourceInput,
  SocSourcePatch,
  SocPullInput,
  SOC_PULL_PRESETS,
  type SocSeverity,
  type SocSourceDto,
  type SocSourcePreset,
  type SocSourceSecret,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { companies, socSources } from "../../db/schema";
import { hashToken } from "../suppliers/questionnaires";
import { ingestEvents, normalizeEvents, parseEvents } from "./ingest";
import { pullConfigOf, pullDto, pullSource } from "./pull";
import { encrypt } from "../../auth/crypto";
import { appSecret } from "../../config";
import { parseEml, reportPhishing } from "./phishing";
import { notifyNewAlerts } from "./response";
import type { Config } from "../../config";
import type { Mailer, TeamsPoster } from "../notifications/service";

/* ============================================================
 * Zdroje alertů SOC (ADR-052): správa webhooků s tokenem (admin:settings), veřejný příjem
 * `POST /api/public/soc/ingest` (Bearer token) a hlášení phishingu zaměstnanci (incidents:report).
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof socSources.$inferSelect;

/** Konfigurace stahování jen pro Sentinel / Elastic a s nastavením odpovídající šablony. */
function pullOf(preset: SocSourcePreset, pull: SocSourceInput["pull"]): Record<string, unknown> | null {
  if (!pull) return null;
  if (!(SOC_PULL_PRESETS as readonly string[]).includes(preset)) throw new HTTPException(400, { message: "Stahování podporují jen zdroje Microsoft Sentinel a Elastic Security." });
  const p = SocPullInput.parse(pull);
  if (preset === "sentinel" && !p.sentinel) throw new HTTPException(400, { message: "Chybí nastavení Microsoft Sentinel." });
  if (preset === "elastic" && !p.elastic) throw new HTTPException(400, { message: "Chybí nastavení Elasticsearch." });
  return { enabled: p.enabled, intervalMinutes: p.intervalMinutes, ...(preset === "sentinel" ? { sentinel: p.sentinel } : { elastic: p.elastic }) };
}

const newToken = () => `cxs_${randomBytes(24).toString("base64url")}`;

async function dtos(db: Db, where: SQL): Promise<SocSourceDto[]> {
  const rows = await db.select({ s: socSources, companyName: companies.name }).from(socSources).leftJoin(companies, eq(companies.id, socSources.companyId)).where(where).orderBy(desc(socSources.createdAt));
  return rows.map(({ s, companyName }) => ({
    id: s.id,
    companyId: s.companyId,
    companyName,
    name: s.name,
    preset: s.preset as SocSourcePreset,
    defaultSeverity: s.defaultSeverity as SocSeverity,
    enabled: s.enabled,
    tokenPrefix: s.tokenPrefix,
    eventsTotal: s.eventsTotal,
    alertsCreated: s.alertsCreated,
    lastEventAt: s.lastEventAt?.toISOString() ?? null,
    lastError: s.lastError,
    createdAt: s.createdAt.toISOString(),
    pull: pullDto(s),
  }));
}

export function socSourceRoutes(deps: { db: Db; config: Config; mailer?: Mailer; teams?: TeamsPoster }) {
  const { db } = deps;
  const ids = (c: Ctx) => scopeOf(c).ids.filter((id) => hasPermIn(c, "soc:read", id));
  async function load(c: Ctx, id: string): Promise<Row> {
    const [r] = await db.select().from(socSources).where(eq(socSources.id, id));
    assertScope(c, r?.companyId, "Zdroj nenalezen");
    if (!hasPermIn(c, "admin:settings", r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r!;
  }
  const one = async (id: string) => (await dtos(db, eq(socSources.id, id)))[0]!;

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "soc"))
      .get("/sources", requirePerm("soc:read"), async (c) => {
        const list = ids(c);
        return c.json(await dtos(db, list.length ? inArray(socSources.companyId, list) : sql`false`));
      })
      .post("/sources", requirePerm("admin:settings"), zValidator("json", SocSourceInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, input.companyId, "admin:settings");
        const user = currentUser(c);
        const token = newToken();
        const pull = pullOf(input.preset, input.pull);
        const [row] = await db
          .insert(socSources)
          .values({
            companyId,
            name: input.name,
            preset: input.preset,
            defaultSeverity: input.defaultSeverity,
            enabled: input.enabled,
            tokenHash: hashToken(token),
            tokenPrefix: token.slice(0, 12),
            pullConfig: pull,
            secretEnc: input.secret ? encrypt(input.secret, appSecret(deps.config)) : null,
            createdById: user.id,
          })
          .returning();
        await audit(db, { c, user, action: "soc.source_created", entityType: "soc_source", entityId: row!.id, details: { name: input.name, preset: input.preset, pull: !!pull, secret: input.secret ? "nastaveno" : undefined } });
        return c.json({ source: await one(row!.id), token } satisfies SocSourceSecret, 201);
      })
      .patch("/sources/:id", requirePerm("admin:settings"), zValidator("json", SocSourcePatch), async (c) => {
        const s = await load(c, c.req.param("id"));
        const { pull, secret, ...input } = c.req.valid("json");
        await db
          .update(socSources)
          .set({
            ...input,
            ...(pull !== undefined ? { pullConfig: pullOf(s.preset as SocSourcePreset, pull), ...(pull ? {} : { pullCursor: null }) } : {}),
            ...(secret !== undefined ? { secretEnc: secret ? encrypt(secret, appSecret(deps.config)) : null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(socSources.id, s.id));
        await audit(db, { c, user: currentUser(c), action: "soc.source_updated", entityType: "soc_source", entityId: s.id, details: { ...input, ...(pull !== undefined ? { pull: !!pull } : {}), ...(secret !== undefined ? { secret: secret ? "změněno" : "smazáno" } : {}) } });
        return c.json(await one(s.id));
      })
      /** Stáhnout hned (Sentinel / Elastic) – i pro ověření nastavení. */
      .post("/sources/:id/pull", requirePerm("admin:settings"), async (c) => {
        const s = await load(c, c.req.param("id"));
        if (!pullConfigOf(s)) throw new HTTPException(400, { message: "Zdroj nemá nastavené stahování." });
        const r = await pullSource(deps, s);
        await audit(db, { c, user: currentUser(c), action: "soc.source_pulled", entityType: "soc_source", entityId: s.id, details: { fetched: r.fetched, created: r.created, error: r.error } });
        return c.json({ result: r, source: await one(s.id) });
      })
      .post("/sources/:id/rotate", requirePerm("admin:settings"), async (c) => {
        const s = await load(c, c.req.param("id"));
        const token = newToken();
        await db.update(socSources).set({ tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), updatedAt: new Date() }).where(eq(socSources.id, s.id));
        await audit(db, { c, user: currentUser(c), action: "soc.source_token_rotated", entityType: "soc_source", entityId: s.id });
        return c.json({ source: await one(s.id), token } satisfies SocSourceSecret);
      })
      .delete("/sources/:id", requirePerm("admin:settings"), async (c) => {
        const s = await load(c, c.req.param("id"));
        await db.delete(socSources).where(eq(socSources.id, s.id));
        await audit(db, { c, user: currentUser(c), action: "soc.source_deleted", entityType: "soc_source", entityId: s.id, details: { name: s.name } });
        return c.json({ ok: true });
      })
      /* ---------- hlášení phishingu zaměstnancem ---------- */
      .post("/phishing", requirePerm("incidents:report"), async (c) => {
        const user = currentUser(c);
        const companyId = targetCompany(c, undefined, "incidents:report");
        const body = await c.req.parseBody();
        const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
        const from = typeof body.from === "string" ? body.from.trim().slice(0, 300) || null : null;
        const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 300) || null : null;
        const file = body.file instanceof File ? body.file : null;
        if (file && file.size > PHISHING_EML_MAX_BYTES) throw new HTTPException(413, { message: "E-mail je příliš velký (nejvýše 2 MB)." });
        if (file && !/\.eml$/i.test(file.name) && file.type !== "message/rfc822") throw new HTTPException(400, { message: "Přiložte e-mail ve formátu .eml (v Outlooku: Uložit jako / přetáhnout zprávu na plochu)." });
        if (!file && !subject && !from) throw new HTTPException(400, { message: "Přiložte e-mail (.eml) nebo vyplňte odesílatele či předmět." });
        const info = file ? parseEml(await file.text()) : null;
        const r = await reportPhishing(db, { companyId, userId: user.id, note, info, from, subject });
        if (!r.duplicate) void notifyNewAlerts(deps).catch((e) => console.error("Upozornění SOC:", (e as Error).message));
        await audit(db, { c, user, action: "soc.phishing_reported", entityType: "soc_alert", entityId: r.alertId, details: { duplicate: r.duplicate, withEml: !!file } });
        return c.json(r, r.duplicate ? 200 : 201);
      })
  );
}

/** Veřejný příjem událostí – bez session, autentizace tokenem zdroje (Authorization: Bearer cxs_…). */
export function publicSocIngestRoutes(deps: { db: Db; config: Config; mailer?: Mailer; teams?: TeamsPoster }) {
  const { db } = deps;
  return new Hono().post("/ingest", async (c) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? c.req.header("x-contix-token");
    if (!token) return c.json({ error: "Chybí token zdroje (Authorization: Bearer …)." }, 401);
    const [src] = await db.select().from(socSources).where(eq(socSources.tokenHash, hashToken(token)));
    if (!src || !src.enabled) return c.json({ error: "Neplatný nebo vypnutý token zdroje." }, 401);
    if (!((await getSettings(db)).enabledModules as string[]).includes("soc")) return c.json({ error: "Modul SOC je vypnutý." }, 404);
    if (Number(c.req.header("content-length") ?? 0) > SOC_INGEST_MAX_BYTES) return c.json({ error: "Požadavek je příliš velký (nejvýše 1 MB)." }, 413);
    const text = await c.req.text();
    if (text.length > SOC_INGEST_MAX_BYTES) return c.json({ error: "Požadavek je příliš velký (nejvýše 1 MB)." }, 413);
    const events = parseEvents(text);
    const fail = async (status: 400 | 413, msg: string) => {
      await db.update(socSources).set({ lastError: msg, updatedAt: new Date() }).where(eq(socSources.id, src.id));
      return c.json({ error: msg }, status);
    };
    if (!events.length) return fail(400, "Tělo neobsahuje žádnou událost JSON.");
    if (events.length > SOC_INGEST_MAX_EVENTS) return fail(413, `Nejvýše ${SOC_INGEST_MAX_EVENTS} událostí v jednom požadavku.`);
    const norm = normalizeEvents(src.preset as SocSourcePreset, events, src.defaultSeverity as SocSeverity);
    const { ids: _ids, ...result } = await ingestEvents(db, src, norm, events.length - norm.length);
    // okamžité upozornění na nové závažné alerty (ADR-055) – na pozadí
    if (result.created) void notifyNewAlerts(deps).catch((e) => console.error("Upozornění SOC:", (e as Error).message));
    return c.json(result, 202);
  });
}
