import { SecurityZoneInput, ZoneFlowControlInput, ZoneSuggestionsApply, cidrCovered } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assetDependencies, assets, securityZones, zoneFlowControls } from "../../db/schema";
import { assignZones, seedDefaultZones, syncZoneFindings, zoneDtos, zoneMap, zoneSuggestions } from "./service";

/* Bezpečnostní zóny – /api/zones (v1.97, ADR-191). Vše v aktivní společnosti. */

export function zoneRoutes(db: Db) {
  const co = (c: Context<AppEnv>, write = false) => {
    const id = targetCompany(c);
    if (write && !hasPermIn(c, "assets:write", id)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return id;
  };
  /** Po změně zón: přeřazení aktiv podle IP a přepočet kontrol. */
  const refresh = async (companyId: string) => {
    const moved = await assignZones(db, companyId);
    await syncZoneFindings(db, [companyId]);
    return moved;
  };
  const zoneOf = async (c: Context<AppEnv>, companyId: string) => {
    const [z] = await db.select().from(securityZones).where(and(eq(securityZones.id, c.req.param("id") ?? ""), eq(securityZones.companyId, companyId)));
    if (!z) throw new HTTPException(404, { message: "Zóna nenalezena" });
    return z;
  };
  const Id = z.object({ id: z.string().uuid() });
  return new Hono<AppEnv>()
    .use(requireModule(db, "assets"))
    .get("/", requirePerm("assets:read"), async (c) => c.json(await zoneDtos(db, co(c))))
    .get("/map", requirePerm("assets:read"), async (c) => c.json(await zoneMap(db, co(c))))
    /** Návrhy rozsahů ze síťových segmentů a podsítí aktiv (v1.101). */
    .get("/suggestions", requirePerm("assets:read"), async (c) => c.json(await zoneSuggestions(db, co(c))))
    .post("/suggestions/apply", requirePerm("assets:write"), zValidator("json", ZoneSuggestionsApply), async (c) => {
      const id = co(c, true);
      const items = c.req.valid("json").items;
      const zones = await db.select().from(securityZones).where(and(eq(securityZones.companyId, id), inArray(securityZones.id, [...new Set(items.map((i) => i.zoneId))])));
      const byId = new Map(zones.map((z) => [z.id, [...(z.cidrs ?? [])]]));
      let added = 0;
      for (const it of items) {
        const list = byId.get(it.zoneId);
        if (!list) throw new HTTPException(400, { message: "Zóna nepatří do aktivní společnosti" });
        if (!cidrCovered(it.cidr, list)) {
          list.push(it.cidr);
          added++;
        }
      }
      for (const [zid, cidrs] of byId) await db.update(securityZones).set({ cidrs: cidrs.slice(0, 200), updatedAt: new Date() }).where(eq(securityZones.id, zid));
      const moved = await refresh(id);
      await audit(db, { c, user: currentUser(c), action: "zones.suggestions_applied", entityType: "company", entityId: id, details: { added } });
      return c.json({ added, moved, zones: await zoneDtos(db, id) });
    })
    /** Řízený přechod vazby přes hranici zón (v1.101): firewall / proxy / jump server nebo popis; nález se pak nezakládá. */
    .put("/flows", requirePerm("assets:write"), zValidator("json", ZoneFlowControlInput), async (c) => {
      const id = co(c, true);
      const v = c.req.valid("json");
      const ids = [v.fromId, v.toId, ...(v.viaAssetId ? [v.viaAssetId] : [])];
      const own = await db.select({ id: assets.id }).from(assets).where(and(inArray(assets.id, ids), eq(assets.companyId, id)));
      if (own.length !== new Set(ids).size) throw new HTTPException(400, { message: "Aktiva nepatří do aktivní společnosti" });
      const [dep] = await db.select({ f: assetDependencies.fromId }).from(assetDependencies).where(and(eq(assetDependencies.fromId, v.fromId), eq(assetDependencies.toId, v.toId)));
      if (!dep) throw new HTTPException(400, { message: "Mezi aktivy není evidovaná vazba" });
      const vals = { fromId: v.fromId, toId: v.toId, viaAssetId: v.viaAssetId ?? null, note: v.note ?? "", createdById: currentUser(c).id };
      await db.insert(zoneFlowControls).values(vals).onConflictDoUpdate({ target: [zoneFlowControls.fromId, zoneFlowControls.toId], set: { viaAssetId: vals.viaAssetId, note: vals.note, updatedAt: new Date() } });
      await syncZoneFindings(db, [id]);
      await audit(db, { c, user: currentUser(c), action: "zones.flow_controlled", entityType: "asset", entityId: v.toId, details: { fromId: v.fromId, viaAssetId: vals.viaAssetId, note: vals.note } });
      return c.json(await zoneMap(db, id));
    })
    .delete("/flows/:fromId/:toId", requirePerm("assets:write"), zValidator("param", z.object({ fromId: z.string().uuid(), toId: z.string().uuid() })), async (c) => {
      const id = co(c, true);
      const fromId = c.req.param("fromId");
      const toId = c.req.param("toId");
      const [a] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, toId), eq(assets.companyId, id)));
      if (!a) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
      await db.delete(zoneFlowControls).where(and(eq(zoneFlowControls.fromId, fromId), eq(zoneFlowControls.toId, toId)));
      await syncZoneFindings(db, [id]);
      await audit(db, { c, user: currentUser(c), action: "zones.flow_control_removed", entityType: "asset", entityId: toId, details: { fromId } });
      return c.json(await zoneMap(db, id));
    })
    .post("/defaults", requirePerm("assets:write"), async (c) => {
      const id = co(c, true);
      const created = await seedDefaultZones(db, id);
      const moved = await refresh(id);
      await audit(db, { c, user: currentUser(c), action: "zones.defaults_created", entityType: "company", entityId: id, details: { created } });
      return c.json({ created, moved, zones: await zoneDtos(db, id) });
    })
    .post("/assign", requirePerm("assets:write"), async (c) => {
      const id = co(c, true);
      return c.json({ moved: await refresh(id), zones: await zoneDtos(db, id) });
    })
    .post("/", requirePerm("assets:write"), zValidator("json", SecurityZoneInput), async (c) => {
      const id = co(c, true);
      const [z] = await db.insert(securityZones).values({ ...c.req.valid("json"), companyId: id }).returning();
      const moved = await refresh(id);
      await audit(db, { c, user: currentUser(c), action: "zones.created", entityType: "company", entityId: id, details: { name: z!.name, cidrs: z!.cidrs } });
      return c.json({ id: z!.id, moved, zones: await zoneDtos(db, id) }, 201);
    })
    .put("/:id", requirePerm("assets:write"), zValidator("param", Id), zValidator("json", SecurityZoneInput), async (c) => {
      const id = co(c, true);
      const cur = await zoneOf(c, id);
      await db.update(securityZones).set({ ...c.req.valid("json"), updatedAt: new Date() }).where(eq(securityZones.id, cur.id));
      const moved = await refresh(id);
      await audit(db, { c, user: currentUser(c), action: "zones.updated", entityType: "company", entityId: id, details: { name: cur.name } });
      return c.json({ moved, zones: await zoneDtos(db, id) });
    })
    .delete("/:id", requirePerm("assets:write"), zValidator("param", Id), async (c) => {
      const id = co(c, true);
      const cur = await zoneOf(c, id);
      // ručně zařazená aktiva se vrátí do automatického zařazení
      await db.update(assets).set({ zoneManual: false }).where(eq(assets.zoneId, cur.id));
      await db.delete(securityZones).where(eq(securityZones.id, cur.id));
      const moved = await refresh(id);
      await audit(db, { c, user: currentUser(c), action: "zones.deleted", entityType: "company", entityId: id, details: { name: cur.name } });
      return c.json({ moved, zones: await zoneDtos(db, id) });
    })
    /** Ruční zóna aktiva; `zoneId: null` = zpět na automatické zařazení podle IP. */
    .put("/assets/:assetId", requirePerm("assets:write"), zValidator("json", z.object({ zoneId: z.string().uuid().nullable() })), async (c) => {
      const [a] = await db.select({ id: assets.id, companyId: assets.companyId }).from(assets).where(eq(assets.id, c.req.param("assetId") ?? ""));
      if (!a || !hasPermIn(c, "assets:write", a.companyId)) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
      const { zoneId } = c.req.valid("json");
      if (zoneId) {
        const [z] = await db.select({ id: securityZones.id }).from(securityZones).where(and(eq(securityZones.id, zoneId), eq(securityZones.companyId, a.companyId)));
        if (!z) throw new HTTPException(400, { message: "Zóna nepatří do společnosti aktiva" });
        await db.update(assets).set({ zoneId, zoneManual: true }).where(eq(assets.id, a.id));
      } else await db.update(assets).set({ zoneManual: false }).where(eq(assets.id, a.id));
      await refresh(a.companyId);
      const [r] = await db.select({ zoneId: assets.zoneId, zoneManual: assets.zoneManual }).from(assets).where(eq(assets.id, a.id));
      await audit(db, { c, user: currentUser(c), action: "asset.zone_set", entityType: "asset", entityId: a.id, details: { zoneId, manual: !!zoneId } });
      return c.json(r);
    });
}
