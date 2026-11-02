import { nextTestDate, PlanInput, PlanPatch, PlanTestInput, type PlanDetail, type PlanListItem } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import { assertScope, inScope, targetCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import { assets, biaAssessments, continuityPlans, planAssets, planProcesses, planTests, positionHolders, positions, processes, users } from "../../db/schema";

type Ctx = Context<AppEnv>;
type PlanRow = typeof continuityPlans.$inferSelect;

/** Plány kontinuity činností a obnovy + testy (§ 15 písm. e) a § 4 odst. 1 písm. i) vyhl. č. 409/2025 Sb.). */
export function planRoutes(db: Db) {
  async function enrich(rows: PlanRow[]): Promise<PlanListItem[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [procs, tests, owners] = await Promise.all([
      db
        .select({ planId: planProcesses.planId, id: processes.id, code: processes.code, name: processes.name, rto: biaAssessments.rtoHours })
        .from(planProcesses)
        .innerJoin(processes, eq(processes.id, planProcesses.processId))
        .leftJoin(biaAssessments, eq(biaAssessments.processId, processes.id))
        .where(inArray(planProcesses.planId, ids)),
      db.select().from(planTests).where(inArray(planTests.planId, ids)).orderBy(desc(planTests.testedAt)),
      db.select({ id: positions.id, name: positions.name }).from(positions),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((p) => {
      const pp = procs.filter((x) => x.planId === p.id);
      const biaRtos = pp.map((x) => x.rto).filter((x): x is number => x != null);
      const rto = p.rtoTargetHours ?? (biaRtos.length ? Math.min(...biaRtos) : null);
      const last = tests.find((t) => t.planId === p.id) ?? null;
      const next = p.status === "approved" ? nextTestDate(last?.testedAt ?? null, p.approvedAt?.toISOString() ?? null, p.testIntervalMonths) : null;
      return {
        id: p.id,
        companyId: p.companyId,
        code: p.code,
        name: p.name,
        planType: p.planType,
        status: p.status,
        version: p.version,
        ownerPositionName: owners.find((o) => o.id === p.ownerPositionId)?.name ?? null,
        processes: pp.map(({ id, code, name }) => ({ id, code, name })),
        rtoTargetHours: rto,
        rtoFromBia: p.rtoTargetHours == null && rto != null,
        lastTest: last ? { testedAt: last.testedAt, result: last.result, achievedRtoHours: last.achievedRtoHours } : null,
        nextTestDue: next,
        testOverdue: !!next && next < today,
        approvedAt: p.approvedAt?.toISOString() ?? null,
        updatedAt: p.updatedAt.toISOString(),
      };
    });
  }

  async function canEdit(c: Ctx, p: { ownerPositionId: string | null }) {
    if (hasPerm(c, "bia:write")) return true;
    if (!p.ownerPositionId) return false;
    const rows = await db.select().from(positionHolders).where(eq(positionHolders.positionId, p.ownerPositionId));
    return rows.some((r) => r.userId === currentUser(c).id);
  }

  async function detail(c: Ctx, id: string): Promise<PlanDetail> {
    const [p] = await db.select().from(continuityPlans).where(eq(continuityPlans.id, id));
    if (!p) throw new HTTPException(404, { message: "Plán nenalezen" });
    assertScope(c, p.companyId, "Plán nenalezen");
    const [item] = await enrich([p]);
    const [as, tests, pos, approver] = await Promise.all([
      db
        .select({ id: assets.id, name: assets.name, assetType: assets.assetType, availability: assets.availability })
        .from(planAssets)
        .innerJoin(assets, eq(assets.id, planAssets.assetId))
        .where(eq(planAssets.planId, id))
        .orderBy(asc(assets.name)),
      db
        .select({ t: planTests, createdByName: users.displayName })
        .from(planTests)
        .leftJoin(users, eq(users.id, planTests.createdById))
        .where(eq(planTests.planId, id))
        .orderBy(desc(planTests.testedAt)),
      db.select({ id: positions.id, name: positions.name }).from(positions),
      p.approvedById ? db.select({ name: users.displayName }).from(users).where(eq(users.id, p.approvedById)) : [],
    ]);
    const rto = item!.rtoTargetHours;
    return {
      ...item!,
      ownerPositionId: p.ownerPositionId,
      purpose: p.purpose,
      scope: p.scope,
      activation: p.activation,
      strategy: p.strategy,
      steps: p.steps.map((s) => ({ ...s, responsiblePositionName: pos.find((x) => x.id === s.responsiblePositionId)?.name ?? null })),
      contacts: p.contacts,
      resources: p.resources,
      planRtoTargetHours: p.rtoTargetHours,
      testIntervalMonths: p.testIntervalMonths,
      lastReviewAt: p.lastReviewAt,
      assets: as,
      tests: tests.map(({ t, createdByName }) => ({
        id: t.id,
        testedAt: t.testedAt,
        testType: t.testType,
        scenario: t.scenario,
        participants: t.participants,
        result: t.result,
        achievedRtoHours: t.achievedRtoHours,
        findings: t.findings,
        improvements: t.improvements,
        createdByName,
        rtoMet: rto != null && t.achievedRtoHours != null ? t.achievedRtoHours <= rto : null,
      })),
      approvedByName: approver[0]?.name ?? null,
      canEdit: await canEdit(c, p),
    };
  }

  async function setLinks(planId: string, v: { processIds?: string[]; assetIds?: string[] }) {
    if (v.processIds) {
      await db.delete(planProcesses).where(eq(planProcesses.planId, planId));
      const ids = [...new Set(v.processIds)];
      if (ids.length) await db.insert(planProcesses).values(ids.map((processId) => ({ planId, processId })));
    }
    if (v.assetIds) {
      await db.delete(planAssets).where(eq(planAssets.planId, planId));
      const ids = [...new Set(v.assetIds)];
      if (ids.length) await db.insert(planAssets).values(ids.map((assetId) => ({ planId, assetId })));
    }
  }

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "continuity"))
    .get("/", requirePerm("bia:read"), async (c) => {
      const rows = await db.select().from(continuityPlans).where(inScope(c, continuityPlans.companyId)).orderBy(asc(continuityPlans.code), asc(continuityPlans.name));
      return c.json(await enrich(rows));
    })
    .post("/", requirePerm("bia:write"), zValidator("json", PlanInput), async (c) => {
      const { processIds, assetIds, companyId: requested, ...input } = c.req.valid("json");
      if (input.status === "approved") throw new HTTPException(400, { message: "Nový plán se zakládá jako návrh; schvaluje se samostatně." });
      const [p] = await db.insert(continuityPlans).values({ ...input, companyId: targetCompany(c, requested, "bia:write") }).returning();
      await setLinks(p!.id, { processIds, assetIds });
      await audit(db, { c, user: currentUser(c), action: "plan.created", entityType: "continuity_plan", entityId: p!.id, details: { name: p!.name } });
      return c.json(await detail(c, p!.id), 201);
    })
    .get("/:id", requirePerm("bia:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
    .patch("/:id", requirePerm("bia:read"), zValidator("json", PlanPatch), async (c) => {
      const id = c.req.param("id");
      const [cur] = await db.select().from(continuityPlans).where(eq(continuityPlans.id, id));
      if (!cur) throw new HTTPException(404, { message: "Plán nenalezen" });
      assertScope(c, cur.companyId, "Plán nenalezen");
      if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "Plán upravuje jeho vlastník nebo správce kontinuity" });
      const { processIds, assetIds, ...rest } = c.req.valid("json");
      const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<PlanRow>;
      if (input.status === "approved" && cur.status !== "approved") {
        if (!hasPerm(c, "bia:write")) throw new HTTPException(403, { message: "Plán schvaluje správce kontinuity" });
        input.approvedAt = new Date();
        input.approvedById = currentUser(c).id;
      }
      // věcná změna schváleného plánu = nová verze, která se musí znovu schválit
      const substantive = ["steps", "strategy", "activation", "scope", "contacts", "resources", "rtoTargetHours"].some((k) => k in input);
      if (cur.status === "approved" && substantive && input.status !== "retired") {
        input.version = cur.version + 1;
        input.status = "draft";
        input.approvedAt = null;
        input.approvedById = null;
      }
      if (Object.keys(input).length) await db.update(continuityPlans).set({ ...input, updatedAt: new Date() }).where(eq(continuityPlans.id, id));
      await setLinks(id, { processIds, assetIds });
      await audit(db, { c, user: currentUser(c), action: "plan.updated", entityType: "continuity_plan", entityId: id, details: { ...input, processIds, assetIds } });
      return c.json(await detail(c, id));
    })
    .delete("/:id", requirePerm("bia:write"), async (c) => {
      const id = c.req.param("id");
      await detail(c, id);
      const [p] = await db.delete(continuityPlans).where(eq(continuityPlans.id, id)).returning({ name: continuityPlans.name });
      if (!p) throw new HTTPException(404, { message: "Plán nenalezen" });
      await audit(db, { c, user: currentUser(c), action: "plan.deleted", entityType: "continuity_plan", entityId: id, details: p });
      return c.body(null, 204);
    })
    /** Záznam o testu plánu. */
    .post("/:id/tests", requirePerm("bia:read"), zValidator("json", PlanTestInput), async (c) => {
      const id = c.req.param("id");
      const [p] = await db.select().from(continuityPlans).where(eq(continuityPlans.id, id));
      if (!p) throw new HTTPException(404, { message: "Plán nenalezen" });
      assertScope(c, p.companyId, "Plán nenalezen");
      if (!(await canEdit(c, p))) throw new HTTPException(403, { message: "Test zaznamenává vlastník plánu nebo správce kontinuity" });
      const input = c.req.valid("json");
      if (input.testedAt > new Date().toISOString().slice(0, 10)) throw new HTTPException(400, { message: "Datum testu nemůže být v budoucnosti." });
      const [t] = await db.insert(planTests).values({ ...input, planId: id, createdById: currentUser(c).id }).returning();
      await audit(db, { c, user: currentUser(c), action: "plan.tested", entityType: "continuity_plan", entityId: id, details: { testId: t!.id, result: t!.result } });
      return c.json(await detail(c, id), 201);
    })
    .delete("/:id/tests/:testId", requirePerm("bia:write"), async (c) => {
      const { id, testId } = c.req.param();
      await detail(c, id);
      await db.delete(planTests).where(and(eq(planTests.id, testId), eq(planTests.planId, id)));
      await audit(db, { c, user: currentUser(c), action: "plan.test_deleted", entityType: "continuity_plan", entityId: id, details: { testId } });
      return c.json(await detail(c, id));
    });
}
