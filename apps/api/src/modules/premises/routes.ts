import { LocationAssetsInput, LocationInput, LocationPatch, TextLocationImport } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assetSources, assets, siteMaps } from "../../db/schema";
import { importTextLocations, isWithin, locationDetail, locationsOf, placeAsset, textLocations } from "./service";

/* Lokality – /api/locations (v1.104, ADR-198). Vše v aktivní společnosti. */

export function premiseRoutes(db: Db) {
  const co = (c: Context<AppEnv>, write = false) => {
    const id = targetCompany(c);
    if (write && !hasPermIn(c, "assets:write", id)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return id;
  };
  const facility = async (companyId: string, id: string) => {
    const [f] = await db.select().from(assets).where(and(eq(assets.id, id), eq(assets.companyId, companyId), eq(assets.assetType, "facility")));
    if (!f) throw new HTTPException(404, { message: "Lokalita nenalezena" });
    return f;
  };
  /** Kontrola nového rodiče: stejná společnost, lokalita, ne sama sebe ani potomek. */
  const checkParent = async (companyId: string, id: string | null, parentId: string | null) => {
    if (!parentId) return;
    await facility(companyId, parentId);
    if (id && (parentId === id || (await isWithin(db, companyId, parentId, id)))) throw new HTTPException(400, { message: "Lokalitu nelze umístit do sebe ani do své podřízené lokality" });
  };
  const Id = z.object({ id: z.string().uuid() });
  return new Hono<AppEnv>()
    .use(requireModule(db, "assets"))
    .get("/", requirePerm("assets:read"), async (c) => c.json(await locationsOf(db, co(c))))
    /** Texty z pole „Umístění“ aktiv k převodu na lokality (v1.108). */
    .get("/text-locations", requirePerm("assets:read"), async (c) => c.json(await textLocations(db, co(c))))
    .post("/text-locations", requirePerm("assets:write"), zValidator("json", TextLocationImport), async (c) => {
      const companyId = co(c, true);
      const items = c.req.valid("json").items;
      for (const it of items) if (it.locationId) await facility(companyId, it.locationId);
      const r = await importTextLocations(db, companyId, items);
      await audit(db, { c, user: currentUser(c), action: "location.text_imported", entityType: "company", entityId: companyId, details: { items: items.length, ...r } });
      return c.json(r);
    })
    .get("/:id", requirePerm("assets:read"), zValidator("param", Id), async (c) => {
      const d = await locationDetail(db, co(c), c.req.param("id"));
      if (!d) throw new HTTPException(404, { message: "Lokalita nenalezena" });
      return c.json(d);
    })
    .post("/", requirePerm("assets:write"), zValidator("json", LocationInput), async (c) => {
      const companyId = co(c, true);
      const v = c.req.valid("json");
      await checkParent(companyId, null, v.parentId);
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(assets)
          .values({ companyId, name: v.name, assetType: "facility", assetClass: "supporting", criticality: v.criticality, facilityKind: v.kind, physical: v.physical ?? null })
          .returning();
        await tx.insert(assetSources).values({ assetId: r!.id, sourceType: "manual", sourceRef: r!.id });
        return r!;
      });
      if (v.parentId) await placeAsset(db, row.id, v.parentId);
      await audit(db, { c, user: currentUser(c), action: "location.created", entityType: "asset", entityId: row.id, details: { name: row.name, kind: v.kind, parentId: v.parentId } });
      return c.json(await locationDetail(db, companyId, row.id), 201);
    })
    .patch("/:id", requirePerm("assets:write"), zValidator("param", Id), zValidator("json", LocationPatch), async (c) => {
      const companyId = co(c, true);
      const f = await facility(companyId, c.req.param("id"));
      const v = c.req.valid("json");
      if (v.parentId !== undefined) await checkParent(companyId, f.id, v.parentId);
      const set: Partial<typeof assets.$inferInsert> = {};
      if (v.name !== undefined) set.name = v.name;
      if (v.kind !== undefined) set.facilityKind = v.kind;
      if (v.criticality !== undefined) set.criticality = v.criticality;
      if (v.physical !== undefined) set.physical = v.physical;
      if (Object.keys(set).length) await db.update(assets).set({ ...set, updatedAt: new Date() }).where(eq(assets.id, f.id));
      if (v.parentId !== undefined) await placeAsset(db, f.id, v.parentId);
      await audit(db, { c, user: currentUser(c), action: "location.updated", entityType: "asset", entityId: f.id, details: v });
      return c.json(await locationDetail(db, companyId, f.id));
    })
    /** Umístit aktiva (techniku, racky i podřízené lokality) do lokality. */
    .post("/:id/assets", requirePerm("assets:write"), zValidator("param", Id), zValidator("json", LocationAssetsInput), async (c) => {
      const companyId = co(c, true);
      const f = await facility(companyId, c.req.param("id"));
      const ids = [...new Set(c.req.valid("json").assetIds)];
      const own = await db.select({ id: assets.id, type: assets.assetType }).from(assets).where(and(inArray(assets.id, ids), eq(assets.companyId, companyId)));
      if (own.length !== ids.length) throw new HTTPException(400, { message: "Aktiva nepatří do aktivní společnosti" });
      for (const a of own) {
        if (a.id === f.id) throw new HTTPException(400, { message: "Lokalitu nelze umístit do sebe" });
        if (a.type === "facility") await checkParent(companyId, a.id, f.id);
      }
      for (const a of own) await placeAsset(db, a.id, f.id);
      await audit(db, { c, user: currentUser(c), action: "location.assets_placed", entityType: "asset", entityId: f.id, details: { assetIds: ids } });
      return c.json(await locationDetail(db, companyId, f.id));
    })
    .delete("/:id/assets/:assetId", requirePerm("assets:write"), zValidator("param", z.object({ id: z.string().uuid(), assetId: z.string().uuid() })), async (c) => {
      const companyId = co(c, true);
      const f = await facility(companyId, c.req.param("id"));
      const [a] = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.id, c.req.param("assetId")), eq(assets.companyId, companyId)));
      if (!a) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
      await placeAsset(db, a.id, null);
      await audit(db, { c, user: currentUser(c), action: "location.asset_removed", entityType: "asset", entityId: f.id, details: { assetId: a.id } });
      return c.json(await locationDetail(db, companyId, f.id));
    })
    /** Půdorysy lokality: zvolené mapy patří k ní, ostatní dosud přiřazené se uvolní. */
    .put("/:id/maps", requirePerm("assets:write"), zValidator("param", Id), zValidator("json", z.object({ mapIds: z.array(z.string().uuid()).max(100) })), async (c) => {
      const companyId = co(c, true);
      const f = await facility(companyId, c.req.param("id"));
      const ids = c.req.valid("json").mapIds;
      await db.transaction(async (tx) => {
        await tx.update(siteMaps).set({ locationId: null }).where(and(eq(siteMaps.companyId, companyId), eq(siteMaps.locationId, f.id)));
        if (ids.length) await tx.update(siteMaps).set({ locationId: f.id }).where(and(eq(siteMaps.companyId, companyId), inArray(siteMaps.id, ids)));
      });
      await audit(db, { c, user: currentUser(c), action: "location.maps_set", entityType: "asset", entityId: f.id, details: { mapIds: ids } });
      return c.json(await locationDetail(db, companyId, f.id));
    });
}
