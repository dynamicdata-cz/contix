import { SavedViewInput, type ModuleKey, type Permission, type SavedViewDto, type ViewPage } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { savedViews, users } from "../../db/schema";

/* ============================================================
 * Uložené pohledy seznamů (ADR-075). Vlastní pohledy uživatele + sdílené pohledy ostatních (jen čtení).
 * Mění a maže jen vlastník. Stav pohledu je jen nastavení UI – žádná data.
 * ============================================================ */

export function savedViewRoutes(db: Db, page: ViewPage, module: ModuleKey, perm: Permission) {
  return new Hono<AppEnv>()
    .use("/views", requireModule(db, module))
    .use("/views/*", requireModule(db, module))
    .get("/views", requirePerm(perm), async (c) => {
      const me = currentUser(c).id;
      const rows = await db
        .select({ v: savedViews, owner: users.displayName })
        .from(savedViews)
        .leftJoin(users, eq(users.id, savedViews.userId))
        .where(and(eq(savedViews.page, page), or(eq(savedViews.userId, me), eq(savedViews.shared, true))))
        .orderBy(asc(savedViews.name));
      return c.json(
        rows.map(({ v, owner }): SavedViewDto => ({ id: v.id, page, name: v.name, state: v.state, shared: v.shared, mine: v.userId === me, ownerName: v.userId === me ? null : owner, updatedAt: v.updatedAt.toISOString() })),
      );
    })
    .post("/views", requirePerm(perm), zValidator("json", SavedViewInput), async (c) => {
      const input = c.req.valid("json");
      const me = currentUser(c).id;
      // stejný název = přepsání vlastního pohledu
      const [row] = await db
        .insert(savedViews)
        .values({ userId: me, page, name: input.name, state: input.state, shared: input.shared })
        .onConflictDoUpdate({ target: [savedViews.userId, savedViews.page, savedViews.name], set: { state: input.state, shared: input.shared, updatedAt: new Date() } })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "view.saved", entityType: "saved_view", entityId: row!.id, details: { page, name: input.name, shared: input.shared } });
      const dto: SavedViewDto = { id: row!.id, page, name: row!.name, state: row!.state, shared: row!.shared, mine: true, ownerName: null, updatedAt: row!.updatedAt.toISOString() };
      return c.json(dto, 201);
    })
    .delete("/views/:id", requirePerm(perm), async (c) => {
      const [row] = await db.select().from(savedViews).where(and(eq(savedViews.id, c.req.param("id")), eq(savedViews.page, page)));
      if (!row) throw new HTTPException(404, { message: "Záznam nenalezen" });
      if (row.userId !== currentUser(c).id) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      await db.delete(savedViews).where(eq(savedViews.id, row.id));
      await audit(db, { c, user: currentUser(c), action: "view.deleted", entityType: "saved_view", entityId: row.id, details: { page, name: row.name } });
      return c.body(null, 204);
    });
}
