import { TAG_ENTITIES, TAG_ENTITY_READ_PERM, TAG_ENTITY_WRITE_PERM, TagAssignInput, TagInput, type Permission, type TagColor, type TagDto, type TagEntity, type TaggedObjectDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { hasPermIn, scopeOf } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, controls, dataLocations, objectTags, processes, risks, suppliers, tags } from "../../db/schema";

/* ============================================================
 * Společné štítky (v1.52, ADR-149): katalog, přiřazení k záznamům, záznamy se štítkem napříč evidencemi.
 * Aktiva drží štítky v assets.tags (text) – katalog je s nimi propojen názvem (bez rozlišení velikosti písmen).
 * ============================================================ */

type Ctx = Context<AppEnv>;
interface Ent {
  table: PgTable;
  id: PgColumn;
  company: PgColumn;
  name: SQL;
}
const ENT: Record<TagEntity, Ent> = {
  asset: { table: assets, id: assets.id, company: assets.companyId, name: sql`${assets.name}` },
  risk: { table: risks, id: risks.id, company: risks.companyId, name: sql`coalesce(${risks.code} || ' ', '') || ${risks.name}` },
  supplier: { table: suppliers, id: suppliers.id, company: suppliers.companyId, name: sql`${suppliers.name}` },
  process: { table: processes, id: processes.id, company: processes.companyId, name: sql`coalesce(${processes.code} || ' ', '') || ${processes.name}` },
  control: { table: controls, id: controls.id, company: controls.companyId, name: sql`coalesce(${controls.code} || ' ', '') || ${controls.name}` },
  location: { table: dataLocations, id: dataLocations.id, company: dataLocations.companyId, name: sql`${dataLocations.name}` },
};
const READ_ANY = [...new Set(Object.values(TAG_ENTITY_READ_PERM))] as Permission[];
const WRITE_ANY = [...new Set(Object.values(TAG_ENTITY_WRITE_PERM))] as Permission[];
const isEntity = (v: string): v is TagEntity => (TAG_ENTITIES as readonly string[]).includes(v);

/**
 * Štítky aktiva z formuláře / importu do katalogu (v1.74, ADR-167): chybějící se založí, existující se zapíší
 * v pravopisu katalogu – aktivum tak nemá „Nis2“ vedle „NIS2“ a štítek je vidět na stránce Štítky.
 */
export async function canonicalTags(db: Db, names: string[]): Promise<string[]> {
  const uniq = [...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean).slice(0, 50);
  if (!uniq.length) return [];
  await db.insert(tags).values(uniq.map((name) => ({ name: name.slice(0, 60) }))).onConflictDoNothing();
  const rows = await db.select({ name: tags.name }).from(tags).where(inArray(sql`lower(${tags.name})`, uniq.map((n) => n.toLowerCase())));
  const byLower = new Map(rows.map((r) => [r.name.toLowerCase(), r.name]));
  return uniq.map((n) => byLower.get(n.toLowerCase()) ?? n);
}

export function tagRoutes(db: Db) {
  /** Společnost záznamu + kontrola oprávnění v ní. */
  async function entityCompany(c: Ctx, type: string, id: string, write: boolean): Promise<{ type: TagEntity; companyId: string }> {
    if (!isEntity(type)) throw new HTTPException(404, { message: "Neznámá evidence" });
    const e = ENT[type];
    const [row] = (await db.select({ companyId: e.company }).from(e.table).where(eq(e.id, id))) as { companyId: string }[];
    const perm = (write ? TAG_ENTITY_WRITE_PERM : TAG_ENTITY_READ_PERM)[type] as Permission;
    if (!row || !hasPermIn(c, TAG_ENTITY_READ_PERM[type] as Permission, row.companyId)) throw new HTTPException(404, { message: "Záznam nenalezen" });
    if (!hasPermIn(c, perm, row.companyId)) throw new HTTPException(403, { message: "Chybí oprávnění k úpravě záznamu" });
    return { type, companyId: row.companyId };
  }
  /** Firmy v rozsahu, kde smí uživatel číst danou evidenci. */
  const readable = (c: Ctx, type: TagEntity) => scopeOf(c).ids.filter((id) => hasPermIn(c, TAG_ENTITY_READ_PERM[type] as Permission, id));

  /** Najde nebo založí štítky v katalogu (podle názvu bez ohledu na velikost písmen). */
  async function ensureTags(names: string[]) {
    const uniq = [...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean);
    if (!uniq.length) return [];
    await db.insert(tags).values(uniq.map((name) => ({ name }))).onConflictDoNothing();
    return db.select().from(tags).where(inArray(sql`lower(${tags.name})`, uniq.map((n) => n.toLowerCase())));
  }

  async function catalog(c: Ctx): Promise<TagDto[]> {
    const rows = await db.select().from(tags).orderBy(tags.name);
    const counts = new Map<string, number>();
    for (const type of TAG_ENTITIES) {
      const ids = readable(c, type);
      if (!ids.length) continue;
      if (type === "asset") {
        const r = await db.execute<{ n: string; c: number }>(sql`select lower(t) as n, count(*)::int as c from ${assets}, unnest(${assets.tags}) t where ${inArray(assets.companyId, ids)} group by 1`);
        for (const x of r as unknown as { n: string; c: number }[]) {
          const tag = rows.find((t) => t.name.toLowerCase() === x.n);
          if (tag) counts.set(tag.id, (counts.get(tag.id) ?? 0) + Number(x.c));
        }
      } else {
        const r = await db
          .select({ id: objectTags.tagId, n: sql<number>`count(*)::int` })
          .from(objectTags)
          .where(and(eq(objectTags.entityType, type), inArray(objectTags.companyId, ids)))
          .groupBy(objectTags.tagId);
        for (const x of r) counts.set(x.id, (counts.get(x.id) ?? 0) + x.n);
      }
    }
    return rows.map((t) => ({ id: t.id, name: t.name, color: t.color as TagColor, description: t.description, count: counts.get(t.id) ?? 0 }));
  }

  return (
    new Hono<AppEnv>()
      .get("/", requirePerm(...READ_ANY), async (c) => c.json(await catalog(c)))
      .post("/", requirePerm("admin:settings"), zValidator("json", TagInput), async (c) => {
        const i = c.req.valid("json");
        const [dup] = await db.select({ id: tags.id }).from(tags).where(eq(sql`lower(${tags.name})`, i.name.toLowerCase()));
        if (dup) throw new HTTPException(409, { message: "Štítek s tímto názvem už existuje" });
        const [t] = await db.insert(tags).values({ name: i.name, color: i.color ?? "slate", description: i.description ?? null }).returning();
        await audit(db, { c, user: currentUser(c), action: "tag.created", entityType: "tag", entityId: t!.id, details: { name: i.name } });
        return c.json(await catalog(c), 201);
      })
      .put("/:id", requirePerm("admin:settings"), zValidator("json", TagInput), async (c) => {
        const i = c.req.valid("json");
        const [cur] = await db.select().from(tags).where(eq(tags.id, c.req.param("id")));
        if (!cur) throw new HTTPException(404, { message: "Štítek nenalezen" });
        const [dup] = await db.select({ id: tags.id }).from(tags).where(and(eq(sql`lower(${tags.name})`, i.name.toLowerCase()), sql`${tags.id} <> ${cur.id}`));
        if (dup) throw new HTTPException(409, { message: "Štítek s tímto názvem už existuje" });
        await db.update(tags).set({ name: i.name, color: i.color ?? "slate", description: i.description ?? null, updatedAt: new Date() }).where(eq(tags.id, cur.id));
        // přejmenování i u textových štítků aktiv
        if (cur.name !== i.name) await db.execute(sql`update ${assets} set tags = array_replace(tags, ${cur.name}, ${i.name}) where ${cur.name} = any(tags)`);
        await audit(db, { c, user: currentUser(c), action: "tag.updated", entityType: "tag", entityId: cur.id, details: { from: cur.name, to: i.name } });
        return c.json(await catalog(c));
      })
      .delete("/:id", requirePerm("admin:settings"), async (c) => {
        const [cur] = await db.select().from(tags).where(eq(tags.id, c.req.param("id")));
        if (!cur) throw new HTTPException(404, { message: "Štítek nenalezen" });
        await db.delete(tags).where(eq(tags.id, cur.id));
        await db.execute(sql`update ${assets} set tags = array_remove(tags, ${cur.name}) where ${cur.name} = any(tags)`);
        await audit(db, { c, user: currentUser(c), action: "tag.deleted", entityType: "tag", entityId: cur.id, details: { name: cur.name } });
        return c.json(await catalog(c));
      })
      /** Štítky jednoho záznamu. */
      .get("/of/:type/:id", requirePerm(...READ_ANY), async (c) => {
        const { type } = await entityCompany(c, c.req.param("type"), c.req.param("id"), false);
        if (type === "asset") return c.json(((await db.select({ t: assets.tags }).from(assets).where(eq(assets.id, c.req.param("id"))))[0]?.t ?? []) as string[]);
        const rows = await db.select({ name: tags.name }).from(objectTags).innerJoin(tags, eq(tags.id, objectTags.tagId)).where(and(eq(objectTags.entityType, type), eq(objectTags.entityId, c.req.param("id")))).orderBy(tags.name);
        return c.json(rows.map((r) => r.name));
      })
      /** Nastaví štítky záznamu (chybějící se založí v katalogu). */
      .put("/of/:type/:id", requirePerm(...WRITE_ANY), zValidator("json", TagAssignInput), async (c) => {
        const id = c.req.param("id");
        const { type, companyId } = await entityCompany(c, c.req.param("type"), id, true);
        const list = await ensureTags(c.req.valid("json").names);
        if (type === "asset") await db.update(assets).set({ tags: list.map((t) => t.name), updatedAt: new Date() }).where(eq(assets.id, id));
        else {
          await db.delete(objectTags).where(and(eq(objectTags.entityType, type), eq(objectTags.entityId, id)));
          if (list.length) await db.insert(objectTags).values(list.map((t) => ({ tagId: t.id, entityType: type, entityId: id, companyId })));
        }
        await audit(db, { c, user: currentUser(c), action: "tag.assigned", entityType: type, entityId: id, details: { tags: list.map((t) => t.name) } });
        return c.json(list.map((t) => t.name).sort((a, b) => a.localeCompare(b)));
      })
      /** Záznamy se štítkem napříč evidencemi (v rozsahu a oprávněních uživatele). */
      .get("/:id/objects", requirePerm(...READ_ANY), async (c) => {
        const [tag] = await db.select().from(tags).where(eq(tags.id, c.req.param("id")));
        if (!tag) throw new HTTPException(404, { message: "Štítek nenalezen" });
        const out: TaggedObjectDto[] = [];
        for (const type of TAG_ENTITIES) {
          const ids = readable(c, type);
          if (!ids.length) continue;
          const e = ENT[type];
          const rows = (
            type === "asset"
              ? await db
                  .select({ id: assets.id, name: assets.name, companyId: assets.companyId })
                  .from(assets)
                  .where(and(inArray(assets.companyId, ids), sql`exists (select 1 from unnest(${assets.tags}) t where lower(t) = ${tag.name.toLowerCase()})`))
                  .limit(500)
              : await db
                  .select({ id: e.id, name: e.name, companyId: e.company })
                  .from(objectTags)
                  .innerJoin(e.table, eq(e.id, objectTags.entityId))
                  .where(and(eq(objectTags.tagId, tag.id), eq(objectTags.entityType, type), inArray(objectTags.companyId, ids)))
                  .limit(500)
          ) as { id: string; name: string; companyId: string }[];
          for (const r of rows) out.push({ entityType: type, id: r.id, name: r.name, companyId: r.companyId });
        }
        return c.json(out);
      })
  );
}
