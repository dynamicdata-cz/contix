import { OrgUnitInput, OrgUnitPatch, PositionInput, PositionPatch, type OrgUnitDto, type PositionDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { asc, count, eq, inArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import { assertScope, getCompanies, scopeOf, targetCompany, visibleIds } from "../../auth/scope";
import type { Db } from "../../db/client";
import { orgUnits, positionHolders, positions, processes, risks, users } from "../../db/schema";
import { ApiError } from "../../lib/apiError";

/** Načte celou organizační strukturu (útvary + funkční místa + držitelé) – typicky stovky záznamů. */
export async function loadOrg(db: Db, companyIds?: string[], inScopeIds?: string[]): Promise<OrgUnitDto[]> {
  const cos = new Map((await getCompanies(db)).map((x) => [x.id, x]));
  const own = inScopeIds ? new Set(inScopeIds) : null;
  const [units, pos, holders] = await Promise.all([
    db
      .select()
      .from(orgUnits)
      .where(companyIds ? inArray(orgUnits.companyId, companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]) : undefined)
      .orderBy(asc(orgUnits.sortOrder), asc(orgUnits.name)),
    db.select().from(positions).orderBy(asc(positions.name)),
    db
      .select({ positionId: positionHolders.positionId, id: users.id, displayName: users.displayName, email: users.email })
      .from(positionHolders)
      .innerJoin(users, eq(users.id, positionHolders.userId)),
  ]);
  const posDto = (p: typeof positions.$inferSelect): PositionDto => ({
    id: p.id,
    orgUnitId: p.orgUnitId,
    name: p.name,
    code: p.code,
    description: p.description,
    isManager: p.isManager,
    securityRoles: p.securityRoles,
    holders: holders.filter((h) => h.positionId === p.id).map(({ id, displayName, email }) => ({ id, displayName, email })),
  });
  return units.map((u) => ({
    id: u.id,
    companyId: u.companyId,
    companyName: cos.get(u.companyId)?.name ?? "",
    companyKind: (cos.get(u.companyId)?.kind ?? "company") as OrgUnitDto["companyKind"],
    shared: own ? !own.has(u.companyId) : false,
    parentId: u.parentId,
    name: u.name,
    code: u.code,
    unitType: u.unitType,
    description: u.description,
    sortOrder: u.sortOrder,
    positions: pos.filter((p) => p.orgUnitId === u.id).map(posDto),
  }));
}

async function setHolders(db: Db, positionId: string, holderIds: string[]) {
  await db.delete(positionHolders).where(eq(positionHolders.positionId, positionId));
  if (holderIds.length) await db.insert(positionHolders).values(holderIds.map((userId) => ({ positionId, userId })));
}

export function orgRoutes(db: Db) {
  /** Zabrání cyklu ve stromu (útvar nesmí být svým vlastním předkem). */
  async function assertNoCycle(id: string, parentId: string | null | undefined) {
    let cur = parentId ?? null;
    const all = await db.select({ id: orgUnits.id, parentId: orgUnits.parentId }).from(orgUnits);
    const map = new Map(all.map((u) => [u.id, u.parentId]));
    while (cur) {
      if (cur === id) throw new HTTPException(400, { message: "Útvar nemůže být nadřízený sám sobě" });
      cur = map.get(cur) ?? null;
    }
  }

  /** Útvar v rozsahu požadavku (zápis jen do společností v rozsahu). */
  async function unitOf(c: Context<AppEnv>, id: string) {
    const [u] = await db.select().from(orgUnits).where(eq(orgUnits.id, id));
    if (!u) throw new HTTPException(404, { message: "Útvar nenalezen" });
    assertScope(c, u.companyId, "Útvar nenalezen");
    return u;
  }
  async function positionOf(c: Context<AppEnv>, id: string) {
    const [p] = await db.select({ unitId: positions.orgUnitId }).from(positions).where(eq(positions.id, id));
    if (!p) throw new HTTPException(404, { message: "Funkční místo nenalezeno" });
    return unitOf(c, p.unitId);
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "organization"))
      // org. struktura společností v rozsahu + nadřazených (holding) – funkční místa holdingu lze přiřadit i ve společnosti
      .get("/", requirePerm("org:read"), async (c) => c.json(await loadOrg(db, await visibleIds(db, c), scopeOf(c).ids)))

      /* ---------- útvary ---------- */
      .post("/units", requirePerm("org:write"), zValidator("json", OrgUnitInput), async (c) => {
        const { companyId: requested, ...input } = c.req.valid("json");
        let companyId: string;
        if (input.parentId) {
          const parent = await unitOf(c, input.parentId);
          companyId = parent.companyId;
        } else companyId = targetCompany(c, requested);
        const [u] = await db.insert(orgUnits).values({ ...input, companyId }).returning();
        await audit(db, { c, user: currentUser(c), action: "org.unit_created", entityType: "org_unit", entityId: u!.id, details: { name: u!.name } });
        return c.json(u, 201);
      })
      .patch("/units/:id", requirePerm("org:write"), zValidator("json", OrgUnitPatch), async (c) => {
        const id = c.req.param("id");
        const input = c.req.valid("json");
        const cur = await unitOf(c, id);
        if (input.parentId) {
          const parent = await unitOf(c, input.parentId);
          if (parent.companyId !== cur.companyId) throw new HTTPException(400, { message: "Nadřízený útvar musí patřit stejné společnosti" });
        }
        if (input.parentId !== undefined) await assertNoCycle(id, input.parentId);
        if (!Object.keys(input).length) throw new HTTPException(400, { message: "Nic ke změně" });
        const [u] = await db.update(orgUnits).set(input).where(eq(orgUnits.id, id)).returning();
        if (!u) throw new HTTPException(404, { message: "Útvar nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "org.unit_updated", entityType: "org_unit", entityId: id, details: input });
        return c.json(u);
      })
      .delete("/units/:id", requirePerm("org:write"), async (c) => {
        const id = c.req.param("id");
        await unitOf(c, id);
        const [[children], [procs]] = await Promise.all([
          db.select({ n: count() }).from(orgUnits).where(eq(orgUnits.parentId, id)),
          db.select({ n: count() }).from(processes).where(eq(processes.orgUnitId, id)),
        ]);
        if (children!.n > 0) throw new HTTPException(409, { message: "Útvar má podřízené útvary – nejdřív je přesuňte nebo smažte." });
        if (procs!.n > 0) throw new ApiError(409, "err.org.unitOwnsProcesses", { n: String(procs!.n) });
        const [u] = await db.delete(orgUnits).where(eq(orgUnits.id, id)).returning({ name: orgUnits.name });
        if (!u) throw new HTTPException(404, { message: "Útvar nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "org.unit_deleted", entityType: "org_unit", entityId: id, details: u });
        return c.body(null, 204);
      })

      /* ---------- funkční místa ---------- */
      .post("/positions", requirePerm("org:write"), zValidator("json", PositionInput), async (c) => {
        const { holderIds, ...input } = c.req.valid("json");
        await unitOf(c, input.orgUnitId);
        const [p] = await db.insert(positions).values(input).returning();
        await setHolders(db, p!.id, holderIds);
        await audit(db, { c, user: currentUser(c), action: "org.position_created", entityType: "position", entityId: p!.id, details: { name: p!.name, holderIds } });
        return c.json(p, 201);
      })
      .patch("/positions/:id", requirePerm("org:write"), zValidator("json", PositionPatch), async (c) => {
        const id = c.req.param("id");
        const { holderIds, ...input } = c.req.valid("json");
        await positionOf(c, id);
        if (input.orgUnitId) await unitOf(c, input.orgUnitId);
        const [p] = Object.keys(input).length
          ? await db.update(positions).set(input).where(eq(positions.id, id)).returning()
          : await db.select().from(positions).where(eq(positions.id, id));
        if (!p) throw new HTTPException(404, { message: "Funkční místo nenalezeno" });
        if (holderIds) await setHolders(db, id, holderIds);
        await audit(db, { c, user: currentUser(c), action: "org.position_updated", entityType: "position", entityId: id, details: { ...input, holderIds } });
        return c.json(p);
      })
      .delete("/positions/:id", requirePerm("org:write"), async (c) => {
        const id = c.req.param("id");
        await positionOf(c, id);
        const [[owned], [riskOwned]] = await Promise.all([
          db.select({ n: count() }).from(processes).where(eq(processes.ownerPositionId, id)),
          db.select({ n: count() }).from(risks).where(eq(risks.ownerPositionId, id)),
        ]);
        if (owned!.n + riskOwned!.n > 0)
          throw new ApiError(409, "err.org.positionOwns", { processes: String(owned!.n), risks: String(riskOwned!.n) });
        const [p] = await db.delete(positions).where(eq(positions.id, id)).returning({ name: positions.name });
        if (!p) throw new HTTPException(404, { message: "Funkční místo nenalezeno" });
        await audit(db, { c, user: currentUser(c), action: "org.position_deleted", entityType: "position", entityId: id, details: p });
        return c.body(null, 204);
      })

      /** Kde všude je funkční místo použito (vlastník procesů/rizik, RACI v krocích). */
      .get("/positions/:id/usage", requirePerm("org:read"), async (c) => {
        const id = c.req.param("id");
        const [procs, rsk, raci] = await Promise.all([
          db.select({ id: processes.id, name: processes.name, code: processes.code }).from(processes).where(eq(processes.ownerPositionId, id)),
          db.select({ id: risks.id, name: risks.name, code: risks.code }).from(risks).where(eq(risks.ownerPositionId, id)),
          db.execute<{ process_id: string; process_name: string; step_name: string; role: string }>(sql`
            select p.id as process_id, p.name as process_name, s.name as step_name, r.role
            from step_raci r join process_steps s on s.id = r.step_id join processes p on p.id = s.process_id
            where r.party_kind = 'position' and r.party_id = ${id}
            order by p.name, s."order"`),
        ]);
        return c.json({ ownedProcesses: procs, ownedRisks: rsk, raci: [...raci] });
      })
  );
}
