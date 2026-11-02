import { withLegalRefs, ChangeInput,
  ChangePatch,
  changeGaps,
  ISMS_REVIEW_MONTHS,
  ObjectiveInput,
  ObjectivePatch,
  OBJECTIVE_STATUSES,
  riskScore,
  type ChangeDetail,
  type ChangeListItem,
  type ChangeStatus,
  type IsmsOverviewDto,
  type ObjectiveDto,
  type ObjectiveStatus,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { profilesByCompany, assertScope, inScope, riskPolicies, scopeOf, settingsFor, targetCompany, visibleIds } from "../../auth/scope";
import type { Db } from "../../db/client";
import {
  assets,
  changeAssets,
  changeControls,
  changeProcesses,
  changeRisks,
  changes,
  changeSuppliers,
  controls,
  documentVersions,
  ismsObjectives,
  positionHolders,
  positions,
  processes,
  risks,
  suppliers,
  users,
} from "../../db/schema";

type Ctx = Context<AppEnv>;
type ChangeRow = typeof changes.$inferSelect;

const LINKS = {
  assetIds: changeAssets,
  processIds: changeProcesses,
  riskIds: changeRisks,
  controlIds: changeControls,
  supplierIds: changeSuppliers,
} as const;
type LinkKey = keyof typeof LINKS;

/** Den, ke kterému se změna vztahuje: provedení, jinak plán, jinak založení. */
const changeDay = sql<string>`coalesce(${changes.implementedAt}, ${changes.plannedAt}, ${changes.createdAt}::date)`;

/** Seznam změn s vyhodnocením mezer § 11 (použito i ve snímcích dokumentů). */
export async function loadChanges(db: Db, where?: SQL): Promise<(ChangeListItem & { _row: ChangeRow })[]> {
  const rows = await db
    .select({ c: changes, owner: positions.name })
    .from(changes)
    .leftJoin(positions, eq(positions.id, changes.ownerPositionId))
    .where(where)
    .orderBy(desc(changeDay), desc(changes.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.c.id);
  const [ra, ca, aa, profiles] = await Promise.all([
    db.select().from(changeRisks).where(inArray(changeRisks.changeId, ids)),
    db.select().from(changeControls).where(inArray(changeControls.changeId, ids)),
    db.select().from(changeAssets).where(inArray(changeAssets.changeId, ids)),
    profilesByCompany(db),
  ]);
  const count = (list: { changeId: string }[], id: string) => list.filter((x) => x.changeId === id).length;
  return rows.map(({ c, owner }) => {
    const riskCount = count(ra, c.id);
    return {
      id: c.id,
      companyId: c.companyId,
      code: c.code,
      title: c.title,
      changeType: c.changeType,
      status: c.status,
      affectsSecurity: c.affectsSecurity,
      significant: c.significant,
      ownerPositionName: owner,
      plannedAt: c.plannedAt,
      implementedAt: c.implementedAt,
      approvedAt: c.approvedAt?.toISOString() ?? null,
      gaps: withLegalRefs(changeGaps({ ...c, riskCount, controlCount: count(ca, c.id) }), profiles.get(c.companyId)?.czLegalRefs ?? true),
      assetCount: count(aa, c.id),
      riskCount,
      updatedAt: c.updatedAt.toISOString(),
      _row: c,
    };
  });
}

export const periodWhere = (from?: string | null, to?: string | null) =>
  and(from ? gte(changeDay, from) : undefined, to ? lte(changeDay, to) : undefined);

function objectiveDto(o: typeof ismsObjectives.$inferSelect, owner: string | null): ObjectiveDto {
  return {
    id: o.id,
    companyId: o.companyId,
    code: o.code,
    title: o.title,
    description: o.description,
    metric: o.metric,
    target: o.target,
    currentValue: o.currentValue,
    status: o.status,
    evaluation: o.evaluation,
    evaluatedAt: o.evaluatedAt,
    dueDate: o.dueDate,
    ownerPositionId: o.ownerPositionId,
    ownerPositionName: owner,
    updatedAt: o.updatedAt.toISOString(),
  };
}

export async function loadObjectives(db: Db, companyIds?: string[]): Promise<ObjectiveDto[]> {
  const rows = await db
    .select({ o: ismsObjectives, owner: positions.name })
    .from(ismsObjectives)
    .leftJoin(positions, eq(positions.id, ismsObjectives.ownerPositionId))
    .where(companyIds ? (companyIds.length ? inArray(ismsObjectives.companyId, companyIds) : sql`false`) : undefined)
    .orderBy(asc(ismsObjectives.code), asc(ismsObjectives.title));
  return rows.map(({ o, owner }) => objectiveDto(o, owner));
}

/** Poslední schválená zpráva o přezkoumání a termín další (alespoň jednou ročně, § 3 písm. f). */
export async function reviewStatus(db: Db, companyId: string) {
  const [last] = await db
    .select({ id: documentVersions.id, version: documentVersions.version, approvedAt: documentVersions.approvedAt })
    .from(documentVersions)
    .where(and(eq(documentVersions.companyId, companyId), eq(documentVersions.kind, "isms_review"), inArray(documentVersions.status, ["approved", "superseded"])))
    .orderBy(desc(documentVersions.approvedAt))
    .limit(1);
  if (!last?.approvedAt) return { lastReview: null, nextReviewDue: null, reviewOverdue: true };
  const d = new Date(last.approvedAt);
  d.setUTCMonth(d.getUTCMonth() + ISMS_REVIEW_MONTHS);
  const next = d.toISOString().slice(0, 10);
  return {
    lastReview: { id: last.id, version: last.version, approvedAt: last.approvedAt.toISOString() },
    nextReviewDue: next,
    reviewOverdue: next < new Date().toISOString().slice(0, 10),
  };
}

const CLOSED: ChangeStatus[] = ["closed", "rejected", "rolled_back"];

/** Řízení ISMS: změny (§ 11 vyhl. 409/2025), cíle ISMS (§ 3 písm. a), přehled přezkoumání (§ 3 písm. f–g). */
export function ismsRoutes(db: Db) {
  async function canEdit(c: Ctx, ownerPositionId: string | null) {
    if (hasPerm(c, "isms:write")) return true;
    if (!ownerPositionId) return false;
    const rows = await db.select().from(positionHolders).where(eq(positionHolders.positionId, ownerPositionId));
    return rows.some((r) => r.userId === currentUser(c).id);
  }

  async function detail(c: Ctx, id: string): Promise<ChangeDetail> {
    const [item] = await loadChanges(db, eq(changes.id, id));
    if (!item) throw new HTTPException(404, { message: "Změna nenalezena" });
    assertScope(c, item.companyId, "Změna nenalezena");
    const { _row: r, ...rest } = item;
    const policies = await riskPolicies(db, await getSettings(db));
    const userIds = [r.approvedById, r.createdById].filter((x): x is string => !!x);
    const [as, ps, rs, cs, ss, names] = await Promise.all([
      db.select({ id: assets.id, name: assets.name, assetType: assets.assetType }).from(changeAssets).innerJoin(assets, eq(assets.id, changeAssets.targetId)).where(eq(changeAssets.changeId, id)).orderBy(asc(assets.name)),
      db.select({ id: processes.id, code: processes.code, name: processes.name }).from(changeProcesses).innerJoin(processes, eq(processes.id, changeProcesses.targetId)).where(eq(changeProcesses.changeId, id)),
      db.select({ r: risks }).from(changeRisks).innerJoin(risks, eq(risks.id, changeRisks.targetId)).where(eq(changeRisks.changeId, id)),
      db.select({ id: controls.id, code: controls.code, name: controls.name }).from(changeControls).innerJoin(controls, eq(controls.id, changeControls.targetId)).where(eq(changeControls.changeId, id)),
      db.select({ id: suppliers.id, name: suppliers.name, significant: suppliers.significant }).from(changeSuppliers).innerJoin(suppliers, eq(suppliers.id, changeSuppliers.targetId)).where(eq(changeSuppliers.changeId, id)),
      userIds.length ? db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, userIds)) : [],
    ]);
    const nameOf = (u: string | null) => (u ? (names.find((n) => n.id === u)?.name ?? null) : null);
    return {
      ...rest,
      description: r.description,
      ownerPositionId: r.ownerPositionId,
      requestedBy: r.requestedBy,
      criteria: r.criteria,
      significanceReason: r.significanceReason,
      riskAssessment: r.riskAssessment,
      measures: r.measures,
      docsUpdatedAt: r.docsUpdatedAt,
      docsNote: r.docsNote,
      testedAt: r.testedAt,
      testResult: r.testResult,
      rollbackPlan: r.rollbackPlan,
      pentest: r.pentest,
      pentestNote: r.pentestNote,
      audit: r.audit,
      auditNote: r.auditNote,
      approvedByName: nameOf(r.approvedById),
      createdByName: nameOf(r.createdById),
      createdAt: r.createdAt.toISOString(),
      assets: as,
      processes: ps,
      risks: rs.map(({ r: x }) => ({ id: x.id, code: x.code, name: x.name, level: riskScore(policies.get(x.companyId)!, x, x.scaleLevels).level })),
      controls: cs,
      suppliers: ss,
      canEdit: await canEdit(c, r.ownerPositionId),
    };
  }

  async function setLinks(changeId: string, v: Partial<Record<LinkKey, string[]>>) {
    for (const key of Object.keys(LINKS) as LinkKey[]) {
      const list = v[key];
      if (!list) continue;
      const t = LINKS[key];
      await db.delete(t).where(eq(t.changeId, changeId));
      const ids = [...new Set(list)];
      if (ids.length) await db.insert(t).values(ids.map((targetId) => ({ changeId, targetId })));
    }
  }

  async function ownedObjective(c: Ctx, id: string) {
    const [o] = await db.select({ companyId: ismsObjectives.companyId }).from(ismsObjectives).where(eq(ismsObjectives.id, id));
    assertScope(c, o?.companyId, "Cíl nenalezen");
  }

  const ListQuery = z.object({
    q: z.string().optional(),
    status: z.enum(["open", "all", "significant"]).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  });

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "isms"))
      .get("/overview", requirePerm("isms:read"), async (c) => {
        const ids = scopeOf(c).ids;
        const [revs, objs, list] = await Promise.all([
          Promise.all(ids.map((id) => reviewStatus(db, id))),
          loadObjectives(db, ids),
          loadChanges(db, inScope(c, changes.companyId)),
        ]);
        // v souhrnném pohledu: nejbližší (nejhorší) termín přezkoumání ze společností v rozsahu
        const rev =
          revs.find((r) => r.reviewOverdue && !r.lastReview) ??
          [...revs].sort((a, b) => (a.nextReviewDue ?? "").localeCompare(b.nextReviewDue ?? ""))[0] ?? { lastReview: null, nextReviewDue: null, reviewOverdue: true };
        const counts = Object.fromEntries(OBJECTIVE_STATUSES.map((s) => [s, 0])) as Record<ObjectiveStatus, number>;
        for (const o of objs) counts[o.status]++;
        const open = list.filter((x) => !CLOSED.includes(x.status));
        const out: IsmsOverviewDto = {
          ...rev,
          objectives: counts,
          changes: { open: open.length, significantOpen: open.filter((x) => x.significant).length, withGaps: list.filter((x) => x.gaps.length).length },
        };
        return c.json(out);
      })

      /** Kritéria pro určení významných změn stanovená organizací (§ 11 odst. 1 písm. a). */
      .get("/criteria", requirePerm("isms:read"), async (c) => c.json((await settingsFor(db, c)).changeCriteria))

      /* ---------- změny ---------- */
      .get("/changes", requirePerm("isms:read"), zValidator("query", ListQuery), async (c) => {
        const { q, status, from, to } = c.req.valid("query");
        const where = and(
          q ? or(ilike(changes.title, `%${q}%`), ilike(changes.code, `%${q}%`)) : undefined,
          status === "open" ? sql`${changes.status} not in ('closed','rejected','rolled_back')` : undefined,
          status === "significant" ? eq(changes.significant, true) : undefined,
          periodWhere(from, to),
        );
        const rows = await loadChanges(db, and(inScope(c, changes.companyId), where));
        return c.json(rows.map(({ _row, ...x }) => x));
      })
      .post("/changes", requirePerm("isms:write"), zValidator("json", ChangeInput), async (c) => {
        const { assetIds, processIds, riskIds, controlIds, supplierIds, companyId: requested, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "isms:write");
        const now = CLOSED.includes(input.status) || input.status === "approved" || input.status === "implemented";
        const [row] = await db
          .insert(changes)
          .values({
            ...input,
            companyId,
            affectsSecurity: input.affectsSecurity || input.significant,
            createdById: currentUser(c).id,
            ...(now ? { approvedById: currentUser(c).id, approvedAt: new Date() } : {}),
          })
          .returning();
        await setLinks(row!.id, { assetIds, processIds, riskIds, controlIds, supplierIds });
        await audit(db, { c, user: currentUser(c), action: "change.created", entityType: "change", entityId: row!.id, details: { title: row!.title, significant: row!.significant } });
        return c.json(await detail(c, row!.id), 201);
      })
      .get("/changes/:id", requirePerm("isms:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/changes/:id", requirePerm("isms:read"), zValidator("json", ChangePatch), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(changes).where(eq(changes.id, id));
        if (!cur) throw new HTTPException(404, { message: "Změna nenalezena" });
        assertScope(c, cur.companyId, "Změna nenalezena");
        if (!(await canEdit(c, cur.ownerPositionId))) throw new HTTPException(403, { message: "Změnu upravuje její vlastník nebo správce ISMS" });
        const { assetIds, processIds, riskIds, controlIds, supplierIds, ...rest } = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<ChangeRow>;
        // schválení / zamítnutí je rozhodnutí správce ISMS
        if (input.status && input.status !== cur.status && ["approved", "rejected"].includes(input.status) && !hasPerm(c, "isms:write"))
          throw new HTTPException(403, { message: "Změnu schvaluje správce ISMS" });
        if (input.status === "approved" && cur.status !== "approved") {
          input.approvedById = currentUser(c).id;
          input.approvedAt = new Date();
        }
        if (input.significant === true) input.affectsSecurity = true;
        if (input.affectsSecurity === false && (input.significant ?? cur.significant)) input.affectsSecurity = true;
        if (Object.keys(input).length) await db.update(changes).set({ ...input, updatedAt: new Date() }).where(eq(changes.id, id));
        await setLinks(id, { assetIds, processIds, riskIds, controlIds, supplierIds });
        await audit(db, { c, user: currentUser(c), action: "change.updated", entityType: "change", entityId: id, details: { ...input } });
        return c.json(await detail(c, id));
      })
      .delete("/changes/:id", requirePerm("isms:write"), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select({ companyId: changes.companyId }).from(changes).where(eq(changes.id, id));
        assertScope(c, cur?.companyId, "Změna nenalezena");
        const [row] = await db.delete(changes).where(eq(changes.id, id)).returning({ title: changes.title });
        if (!row) throw new HTTPException(404, { message: "Změna nenalezena" });
        await audit(db, { c, user: currentUser(c), action: "change.deleted", entityType: "change", entityId: id, details: row });
        return c.body(null, 204);
      })

      /* ---------- cíle ISMS ---------- */
      // cíle společností v rozsahu + skupinové cíle nadřazených společností
      .get("/objectives", requirePerm("isms:read"), async (c) => c.json(await loadObjectives(db, await visibleIds(db, c))))
      .post("/objectives", requirePerm("isms:write"), zValidator("json", ObjectiveInput), async (c) => {
        const { companyId: requested, ...input } = c.req.valid("json");
        const [o] = await db.insert(ismsObjectives).values({ ...input, companyId: targetCompany(c, requested, "isms:write") }).returning();
        await audit(db, { c, user: currentUser(c), action: "objective.created", entityType: "isms_objective", entityId: o!.id, details: { title: o!.title } });
        return c.json(objectiveDto(o!, null), 201);
      })
      .patch("/objectives/:id", requirePerm("isms:write"), zValidator("json", ObjectivePatch), async (c) => {
        const id = c.req.param("id");
        await ownedObjective(c, id);
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
        const [o] = await db.update(ismsObjectives).set({ ...input, updatedAt: new Date() }).where(eq(ismsObjectives.id, id)).returning();
        if (!o) throw new HTTPException(404, { message: "Cíl nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "objective.updated", entityType: "isms_objective", entityId: id, details: input });
        return c.json(objectiveDto(o, null));
      })
      .delete("/objectives/:id", requirePerm("isms:write"), async (c) => {
        const id = c.req.param("id");
        await ownedObjective(c, id);
        const [o] = await db.delete(ismsObjectives).where(eq(ismsObjectives.id, id)).returning({ title: ismsObjectives.title });
        if (!o) throw new HTTPException(404, { message: "Cíl nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "objective.deleted", entityType: "isms_objective", entityId: id, details: o });
        return c.body(null, 204);
      })
  );
}
