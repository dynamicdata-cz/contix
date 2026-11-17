import { USER_HANDOVER_KINDS, UserHandoverInput, type UserResponsibilitiesDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { scopeOf } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, orgUnits, positionHolders, positions, tasks, users } from "../../db/schema";
import { reassignHostFindingTasks } from "../collector/findings";
import { reassignFindingTasks } from "../sectests/tasks";

/* ============================================================
 * Odpovědnosti uživatele a jejich předání (v1.65, ADR-158): při deaktivaci nebo odchodu
 * se aktiva (business vlastník, technický garant, zástupce) a přidělené úkoly předají jiné osobě,
 * aby nálezy a úkoly nezůstaly „ničí“. Funkční místa se předávají v Organizaci (držitel místa).
 * Jen záznamy ve společnostech, které má administrátor v rozsahu.
 * ============================================================ */

const ASSET_COL = { asset_owner: assets.ownerUserId, asset_technical: assets.technicalOwnerUserId, asset_deputy: assets.technicalDeputyUserId } as const;
const OPEN = ["open", "in_progress"];

export async function userResponsibilities(db: Db, userId: string, companyIds: string[]): Promise<UserResponsibilitiesDto> {
  const none = { asset_owner: 0, asset_technical: 0, asset_deputy: 0, task: 0 };
  if (!companyIds.length) return { counts: none, assets: [], positions: [] };
  const rows = await db
    .select({ id: assets.id, name: assets.name, owner: assets.ownerUserId, tech: assets.technicalOwnerUserId, dep: assets.technicalDeputyUserId })
    .from(assets)
    .where(and(inArray(assets.companyId, companyIds), or(eq(assets.ownerUserId, userId), eq(assets.technicalOwnerUserId, userId), eq(assets.technicalDeputyUserId, userId))))
    .orderBy(assets.name);
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.assigneeUserId, userId), inArray(tasks.status, OPEN), inArray(tasks.companyId, companyIds)));
  const pos = await db
    .select({ id: positions.id, name: positions.name })
    .from(positionHolders)
    .innerJoin(positions, eq(positions.id, positionHolders.positionId))
    .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
    .where(and(eq(positionHolders.userId, userId), inArray(orgUnits.companyId, companyIds)));
  return {
    counts: {
      asset_owner: rows.filter((r) => r.owner === userId).length,
      asset_technical: rows.filter((r) => r.tech === userId).length,
      asset_deputy: rows.filter((r) => r.dep === userId).length,
      task: t?.n ?? 0,
    },
    assets: rows.slice(0, 100).map((r) => ({
      id: r.id,
      name: r.name,
      roles: USER_HANDOVER_KINDS.filter((k) => k !== "task" && (k === "asset_owner" ? r.owner : k === "asset_technical" ? r.tech : r.dep) === userId),
    })),
    positions: pos,
  };
}

export function userHandoverRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get("/users/:id/responsibilities", requirePerm("admin:users"), async (c) => {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, c.req.param("id")));
      if (!u) throw new HTTPException(404, { message: "Uživatel nenalezen" });
      return c.json(await userResponsibilities(db, u.id, scopeOf(c).ids));
    })
    .post("/users/:id/handover", requirePerm("admin:users"), zValidator("json", UserHandoverInput), async (c) => {
      const i = c.req.valid("json");
      const [from] = await db.select({ id: users.id, name: users.displayName }).from(users).where(eq(users.id, c.req.param("id")));
      const [to] = await db.select({ id: users.id, name: users.displayName, active: users.isActive }).from(users).where(eq(users.id, i.toUserId));
      if (!from) throw new HTTPException(404, { message: "Uživatel nenalezen" });
      if (!to || !to.active) throw new HTTPException(400, { message: "Cílový uživatel neexistuje nebo není aktivní" });
      if (to.id === from.id) throw new HTTPException(400, { message: "Cílový uživatel je stejný jako zdrojový" });
      const ids = scopeOf(c).ids;
      if (!ids.length) return c.json({ moved: {} });
      const moved: Record<string, number> = {};
      const touched = new Set<string>();
      await db.transaction(async (tx) => {
        for (const k of i.kinds) {
          if (k === "task") {
            const r = await tx
              .update(tasks)
              .set({ assigneeUserId: to.id, updatedAt: new Date() })
              .where(and(eq(tasks.assigneeUserId, from.id), inArray(tasks.status, OPEN), inArray(tasks.companyId, ids)))
              .returning({ id: tasks.id });
            moved[k] = r.length;
            continue;
          }
          const col = ASSET_COL[k];
          const r = await tx
            .update(assets)
            .set({ [k === "asset_owner" ? "ownerUserId" : k === "asset_technical" ? "technicalOwnerUserId" : "technicalDeputyUserId"]: to.id, updatedAt: new Date() })
            .where(and(eq(col, from.id), inArray(assets.companyId, ids)))
            .returning({ id: assets.id });
          moved[k] = r.length;
          for (const a of r) touched.add(a.id);
        }
      });
      // úkoly z nálezů aktiv podle nových odpovědných osob
      for (const id of touched) {
        await reassignFindingTasks(db, { assetId: id });
        await reassignHostFindingTasks(db, { assetId: id });
      }
      await audit(db, { c, user: currentUser(c), action: "user.handover", entityType: "user", entityId: from.id, details: { from: from.name, to: to.name, toId: to.id, moved, note: i.note ?? null } });
      return c.json({ moved });
    });
}
