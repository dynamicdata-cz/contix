import { HostFindingPatch, HostInventoryInput, SecTestTasksInput } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, connections, hostFindings, hostInventories } from "../../db/schema";
import { recomputeHealth } from "../vulnerabilities/service";
import { closeHostFindingTasks, createHostFindingTasks, hostFindingTitle } from "./findings";
import { collectorByToken, hostDetail, hostDto, hostSummaries, ingestInventory } from "./service";

/* ============================================================
 * Sběrač ze serverů (v1.51, ADR-148): veřejný příjem inventáře s tokenem připojení a čtení inventářů.
 * ============================================================ */

const MAX_BYTES = 4 * 1024 * 1024;

/** POST /api/public/hosts/inventory – Authorization: Bearer ctxh_… (token připojení, ne uživatele). */
export function publicHostRoutes(db: Db) {
  return new Hono().post("/inventory", async (c) => {
    const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
    const conn = m ? await collectorByToken(db, m[1]!) : null;
    if (!conn) {
      c.header("www-authenticate", 'Bearer realm="contix"');
      throw new HTTPException(401, { message: "Neplatný nebo vypnutý token sběrače" });
    }
    if (Number(c.req.header("content-length") ?? 0) > MAX_BYTES) throw new HTTPException(413, { message: "Inventář je větší než 4 MB" });
    const text = await c.req.text();
    if (text.length > MAX_BYTES) throw new HTTPException(413, { message: "Inventář je větší než 4 MB" });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new HTTPException(400, { message: "Inventář není platný JSON" });
    }
    const p = HostInventoryInput.safeParse(body);
    if (!p.success) throw new HTTPException(400, { message: `Neplatný inventář: ${p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const r = await ingestInventory(db, conn, p.data);
    await audit(db, { action: "collector.inventory", entityType: "connection", entityId: conn.id, details: { host: p.data.host.hostname, assetId: r.assetId, findings: r.findings } });
    return c.json(r);
  });
}

/** Čtení: přehled serverů v rozsahu uživatele, detail podle aktiva. */
export function hostRoutes(db: Db) {
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "assets"))
    .get("/", requirePerm("assets:read"), async (c) => c.json(await hostSummaries(db, inScope(c, hostInventories.companyId))))
    .get("/:id{[0-9a-f-]{36}}", requirePerm("assets:read"), async (c) => {
      const d = await hostDetail(db, c.req.param("id"));
      assertScope(c, d?.companyId, "Server nenalezen");
      return c.json(d);
    })
    .get("/by-asset/:assetId", requirePerm("assets:read"), async (c) => {
      const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, c.req.param("assetId")));
      assertScope(c, a?.companyId, "Aktivum nenalezeno");
      const rows = await db
        .select({ h: hostInventories, conn: connections.name, assetName: assets.name })
        .from(hostInventories)
        .innerJoin(connections, eq(connections.id, hostInventories.connectionId))
        .leftJoin(assets, eq(assets.id, hostInventories.assetId))
        .where(and(eq(hostInventories.assetId, c.req.param("assetId"))));
      return c.json(rows.map(({ h, conn, assetName }) => hostDto(h, conn, assetName)));
    })
    /* ---- nálezy serveru: stav, přijetí rizika, úkoly (v1.65, ADR-158) ---- */
    .patch("/findings/:id", requirePerm("assets:write"), zValidator("json", HostFindingPatch), async (c) => {
      const [f] = await db.select().from(hostFindings).where(eq(hostFindings.id, c.req.param("id")));
      if (!f || !hasPermIn(c, "assets:write", f.companyId)) throw new HTTPException(404, { message: "Nález nenalezen" });
      const i = c.req.valid("json");
      const me = currentUser(c);
      await db
        .update(hostFindings)
        .set({
          status: i.status,
          note: i.note ?? f.note,
          fixedAt: i.status === "fixed" ? new Date() : null,
          acceptedById: i.status === "accepted" ? me.id : null,
          acceptedAt: i.status === "accepted" ? new Date() : null,
          acceptedUntil: i.status === "accepted" ? (i.until ?? null) : null,
          updatedAt: new Date(),
        })
        .where(eq(hostFindings.id, f.id));
      if (i.status !== "open") {
        const today = new Date().toISOString().slice(0, 10);
        await closeHostFindingTasks(db, [f.id], i.status === "fixed" ? "done" : "cancelled", (i.status === "fixed" ? `Nález označen jako opravený (${today}); další hlášení sběrače opravu ověří.` : `Nález uzavřen jako „${i.status}“ (${today})${i.note ? `: ${i.note}` : ""}.`).slice(0, 4000));
      }
      if (f.assetId) await recomputeHealth(db).catch(() => undefined);
      await audit(db, { c, user: me, action: "host.finding_status", entityType: "host_finding", entityId: f.id, details: { from: f.status, to: i.status, title: hostFindingTitle(f.code, f.subject) } });
      return c.json({ ok: true });
    })
    .post("/findings/tasks", requirePerm("assets:write"), requirePerm("actions:write"), zValidator("json", SecTestTasksInput), async (c) => {
      const ids = [...new Set(c.req.valid("json").ids)];
      const rows = await db.select({ id: hostFindings.id, companyId: hostFindings.companyId }).from(hostFindings).where(inArray(hostFindings.id, ids));
      if (rows.length !== ids.length || rows.some((r) => !hasPermIn(c, "assets:write", r.companyId) || !hasPermIn(c, "actions:write", r.companyId))) throw new HTTPException(404, { message: "Nález nenalezen" });
      const { taskIds, ...res } = await createHostFindingTasks(db, ids, currentUser(c).id);
      if (res.created) await audit(db, { c, user: currentUser(c), action: "host.tasks_created", entityType: "host_finding", entityId: ids[0]!, details: { ...res, taskIds: taskIds.slice(0, 50) } });
      return c.json(res);
    });
}
