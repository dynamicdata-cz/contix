import { DataLocationInput, locationRules, type DataCategory, type DataLocationDto, type TransferMechanism } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { getCompanies, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { dataLocations, objectTags, suppliers, tags } from "../../db/schema";

/* ============================================================
 * Umístění dat (v1.52, ADR-149): kde se data zpracovávají + pravidla podle země (GDPR, riziko země, DORA).
 * ============================================================ */

type Ctx = Context<AppEnv>;

export function locationRoutes(db: Db) {
  const readIds = (c: Ctx) => scopeOf(c).ids.filter((id) => hasPermIn(c, "suppliers:read", id));

  async function dtos(c: Ctx, where?: ReturnType<typeof eq>): Promise<DataLocationDto[]> {
    const ids = readIds(c);
    if (!ids.length) return [];
    const rows = await db
      .select({ l: dataLocations, supplierName: suppliers.name })
      .from(dataLocations)
      .leftJoin(suppliers, eq(suppliers.id, dataLocations.supplierId))
      .where(and(inArray(dataLocations.companyId, ids), where))
      .orderBy(dataLocations.country, dataLocations.name);
    const dora = new Map((await getCompanies(db)).map((co) => [co.id, !!(co as { doraEntity?: boolean }).doraEntity]));
    const tagRows = rows.length
      ? await db
          .select({ id: objectTags.entityId, name: tags.name })
          .from(objectTags)
          .innerJoin(tags, eq(tags.id, objectTags.tagId))
          .where(and(eq(objectTags.entityType, "location"), inArray(objectTags.entityId, rows.map((r) => r.l.id))))
      : [];
    return rows.map(({ l, supplierName }) => ({
      id: l.id,
      companyId: l.companyId,
      name: l.name,
      supplierId: l.supplierId,
      supplierName,
      provider: l.provider,
      country: l.country,
      region: l.region,
      dataCategories: l.dataCategories as DataCategory[],
      transferMechanism: (l.transferMechanism as TransferMechanism | null) ?? null,
      dpaSigned: l.dpaSigned,
      note: l.note,
      rules: locationRules(l, { doraEntity: dora.get(l.companyId) ?? false }),
      tags: tagRows.filter((t) => t.id === l.id).map((t) => t.name),
      updatedAt: l.updatedAt.toISOString(),
    }));
  }

  async function row(c: Ctx, id: string) {
    const [l] = await db.select().from(dataLocations).where(eq(dataLocations.id, id));
    if (!l || !readIds(c).includes(l.companyId)) throw new HTTPException(404, { message: "Umístění nenalezeno" });
    if (!hasPermIn(c, "suppliers:write", l.companyId)) throw new HTTPException(403, { message: "Chybí oprávnění k úpravě dodavatelů" });
    return l;
  }
  async function checkSupplier(supplierId: string | null | undefined, companyId: string) {
    if (!supplierId) return;
    const [s] = await db.select({ companyId: suppliers.companyId }).from(suppliers).where(eq(suppliers.id, supplierId));
    if (!s || s.companyId !== companyId) throw new HTTPException(400, { message: "Dodavatel nepatří do stejné společnosti" });
  }
  const values = (i: ReturnType<typeof DataLocationInput.parse>) => ({
    name: i.name,
    supplierId: i.supplierId ?? null,
    provider: i.provider ?? null,
    country: i.country,
    region: i.region ?? null,
    dataCategories: i.dataCategories,
    transferMechanism: i.transferMechanism ?? null,
    dpaSigned: i.dpaSigned,
    note: i.note ?? null,
  });

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "suppliers"))
    .get("/", requirePerm("suppliers:read"), async (c) => c.json(await dtos(c)))
    .post("/", requirePerm("suppliers:write"), zValidator("json", DataLocationInput), async (c) => {
      const i = c.req.valid("json");
      const companyId = targetCompany(c, i.companyId ?? null, "suppliers:write");
      await checkSupplier(i.supplierId, companyId);
      const [l] = await db.insert(dataLocations).values({ companyId, ...values(i) }).returning();
      await audit(db, { c, user: currentUser(c), action: "location.created", entityType: "data_location", entityId: l!.id, details: { name: i.name, country: i.country } });
      return c.json((await dtos(c, eq(dataLocations.id, l!.id)))[0], 201);
    })
    .put("/:id", requirePerm("suppliers:write"), zValidator("json", DataLocationInput), async (c) => {
      const l = await row(c, c.req.param("id"));
      const i = c.req.valid("json");
      await checkSupplier(i.supplierId, l.companyId);
      await db.update(dataLocations).set({ ...values(i), updatedAt: new Date() }).where(eq(dataLocations.id, l.id));
      await audit(db, { c, user: currentUser(c), action: "location.updated", entityType: "data_location", entityId: l.id, details: { name: i.name, country: i.country } });
      return c.json((await dtos(c, eq(dataLocations.id, l.id)))[0]);
    })
    .delete("/:id", requirePerm("suppliers:write"), async (c) => {
      const l = await row(c, c.req.param("id"));
      await db.delete(objectTags).where(and(eq(objectTags.entityType, "location"), eq(objectTags.entityId, l.id)));
      await db.delete(dataLocations).where(eq(dataLocations.id, l.id));
      await audit(db, { c, user: currentUser(c), action: "location.deleted", entityType: "data_location", entityId: l.id, details: { name: l.name } });
      return c.body(null, 204);
    });
}
