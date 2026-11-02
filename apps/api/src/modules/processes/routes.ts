import {
  BpmnInput,
  generateBpmn,
  ProcessAssetsInput,
  ProcessDocumentInput,
  ProcessInput,
  ProcessPatch,
  ReorderStepsInput,
  riskScore,
  StepInput,
  StepPatch,
  STEP_TYPES,
  type ProcessDetail,
  type ProcessListItem,
  type RaciDto,
  type StepDto,
  ApproveProcessVersionInput,
  ProcessVersionInput,
  processSnapshotOf,
  type ProcessSnapshot,
  type ProcessVersionDetail,
  type ProcessVersionDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, ilike, inArray, isNull, max, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, inScope, riskPolicies, targetCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import {
  assets,
  orgUnits,
  positionHolders,
  positions,
  processAssets,
  processDocuments,
  processes,
  processSteps,
  riskProcesses,
  risks,
  stepRaci,
  users,
  processVersions,
} from "../../db/schema";
import { alias } from "drizzle-orm/pg-core";

type Ctx = Context<AppEnv>;
const verCreator = alias(users, "ver_creator");
const verApprover = alias(users, "ver_approver");

/** Kdo krok „provádí“ – dráha v BPMN: první R, jinak A. */
export function laneOf(raci: RaciDto[]): string | null {
  const r = raci.find((x) => x.role === "R") ?? raci.find((x) => x.role === "A");
  return r ? r.name : null;
}

async function loadSteps(db: Db, processId: string): Promise<StepDto[]> {
  const steps = await db.select().from(processSteps).where(eq(processSteps.processId, processId)).orderBy(asc(processSteps.order));
  if (!steps.length) return [];
  const ids = steps.map((s) => s.id);
  const [raci, stepAssets] = await Promise.all([
    db.select().from(stepRaci).where(inArray(stepRaci.stepId, ids)),
    db
      .select({ stepId: processAssets.stepId, id: assets.id, name: assets.name, assetType: assets.assetType, healthStatus: assets.healthStatus })
      .from(processAssets)
      .innerJoin(assets, eq(assets.id, processAssets.assetId))
      .where(inArray(processAssets.stepId, ids))
      .orderBy(asc(assets.name)),
  ]);
  const posIds = [...new Set(raci.filter((r) => r.partyKind === "position").map((r) => r.partyId))];
  const unitIds = [...new Set(raci.filter((r) => r.partyKind === "org_unit").map((r) => r.partyId))];
  const [posRows, unitRows] = await Promise.all([
    posIds.length
      ? db
          .select({ id: positions.id, name: positions.name, unitName: orgUnits.name })
          .from(positions)
          .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
          .where(inArray(positions.id, posIds))
      : [],
    unitIds.length ? db.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(inArray(orgUnits.id, unitIds)) : [],
  ]);
  const posMap = new Map(posRows.map((p) => [p.id, p]));
  const unitMap = new Map(unitRows.map((u) => [u.id, u]));
  const roleOrder = { R: 0, A: 1, C: 2, I: 3 } as const;

  return steps.map((s) => ({
    id: s.id,
    processId: s.processId,
    order: s.order,
    name: s.name,
    stepType: s.stepType,
    description: s.description,
    inputs: s.inputs,
    outputs: s.outputs,
    duration: s.duration,
    systems: s.systems,
    raci: raci
      .filter((r) => r.stepId === s.id)
      .map((r): RaciDto => {
        if (r.partyKind === "position") {
          const p = posMap.get(r.partyId);
          return { kind: "position", id: r.partyId, role: r.role, name: p?.name ?? "(smazané místo)", orgUnitName: p?.unitName ?? null };
        }
        return { kind: "org_unit", id: r.partyId, role: r.role, name: unitMap.get(r.partyId)?.name ?? "(smazaný útvar)" };
      })
      .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name, "cs")),
    assets: stepAssets.filter((a) => a.stepId === s.id).map(({ stepId: _, ...a }) => a),
  }));
}

async function setStepLinks(db: Db, processId: string, stepId: string, raci: z.output<typeof StepInput>["raci"] | undefined, assetIds: string[] | undefined) {
  if (raci) {
    await db.delete(stepRaci).where(eq(stepRaci.stepId, stepId));
    const uniq = [...new Map(raci.map((r) => [`${r.kind}:${r.id}:${r.role}`, r])).values()];
    if (uniq.length) await db.insert(stepRaci).values(uniq.map((r) => ({ stepId, partyKind: r.kind, partyId: r.id, role: r.role })));
  }
  if (assetIds) {
    await db.delete(processAssets).where(eq(processAssets.stepId, stepId));
    const uniq = [...new Set(assetIds)];
    if (uniq.length) await db.insert(processAssets).values(uniq.map((assetId) => ({ processId, stepId, assetId })));
  }
}

export function processRoutes(db: Db) {
  /** Úpravy: oprávnění processes:write, nebo držitel funkčního místa vlastníka procesu. */
  async function canEdit(c: Ctx, p: { ownerPositionId: string | null }) {
    if (hasPerm(c, "processes:write")) return true;
    if (!p.ownerPositionId) return false;
    const [h] = await db
      .select({ n: count() })
      .from(positionHolders)
      .where(and(eq(positionHolders.positionId, p.ownerPositionId), eq(positionHolders.userId, currentUser(c).id)));
    return h!.n > 0;
  }

  async function loadForEdit(c: Ctx, id: string) {
    const [p] = await db.select().from(processes).where(eq(processes.id, id));
    if (!p) throw new HTTPException(404, { message: "Proces nenalezen" });
    assertScope(c, p.companyId, "Proces nenalezen");
    if (!(await canEdit(c, p))) throw new HTTPException(403, { message: "Proces může upravovat jen vlastník nebo správce procesů" });
    return p;
  }

  async function versionList(c: Ctx, processId: string): Promise<ProcessVersionDto[]> {
    const rows = await db
      .select({ v: processVersions, createdByName: verCreator.displayName, approvedByName: verApprover.displayName })
      .from(processVersions)
      .leftJoin(verCreator, eq(verCreator.id, processVersions.createdById))
      .leftJoin(verApprover, eq(verApprover.id, processVersions.approvedById))
      .where(eq(processVersions.processId, processId))
      .orderBy(desc(processVersions.number));
    const canApprove = hasPerm(c, "processes:write", "documents:approve");
    return rows.map(({ v, createdByName, approvedByName }) => ({
      id: v.id,
      processId: v.processId,
      number: v.number,
      status: v.status as ProcessVersionDto["status"],
      changeSummary: v.changeSummary,
      createdByName,
      createdAt: v.createdAt.toISOString(),
      approvedByName,
      approvedAt: v.approvedAt?.toISOString() ?? null,
      approvalNote: v.approvalNote,
      canApprove: canApprove && v.status === "draft",
    }));
  }

  async function touch(id: string) {
    await db.update(processes).set({ version: sql`${processes.version} + 1`, updatedAt: new Date() }).where(eq(processes.id, id));
  }

  async function assertNoCycle(id: string, parentId: string | null | undefined) {
    let cur = parentId ?? null;
    const all = await db.select({ id: processes.id, parentId: processes.parentId }).from(processes);
    const map = new Map(all.map((u) => [u.id, u.parentId]));
    while (cur) {
      if (cur === id) throw new HTTPException(400, { message: "Proces nemůže být nadřazený sám sobě" });
      cur = map.get(cur) ?? null;
    }
  }

  async function detail(c: Ctx, id: string): Promise<ProcessDetail> {
    const [row] = await db
      .select({ p: processes, ownerPositionName: positions.name, orgUnitName: orgUnits.name })
      .from(processes)
      .leftJoin(positions, eq(positions.id, processes.ownerPositionId))
      .leftJoin(orgUnits, eq(orgUnits.id, processes.orgUnitId))
      .where(eq(processes.id, id));
    if (!row) throw new HTTPException(404, { message: "Proces nenalezen" });
    assertScope(c, row.p.companyId, "Proces nenalezen");
    const p = row.p;
    const settings = await getSettings(db);
    const policies = await riskPolicies(db, settings);
    const [steps, holders, procAssets, docs, riskRows, children] = await Promise.all([
      loadSteps(db, id),
      p.ownerPositionId
        ? db
            .select({ id: users.id, displayName: users.displayName })
            .from(positionHolders)
            .innerJoin(users, eq(users.id, positionHolders.userId))
            .where(eq(positionHolders.positionId, p.ownerPositionId))
        : [],
      db
        .select({ stepId: processAssets.stepId, id: assets.id, name: assets.name, assetType: assets.assetType, assetClass: assets.assetClass, healthStatus: assets.healthStatus })
        .from(processAssets)
        .innerJoin(assets, eq(assets.id, processAssets.assetId))
        .where(eq(processAssets.processId, id))
        .orderBy(asc(assets.name)),
      db.select().from(processDocuments).where(eq(processDocuments.processId, id)).orderBy(asc(processDocuments.title)),
      hasPerm(c, "risks:read")
        ? db.select({ r: risks }).from(riskProcesses).innerJoin(risks, eq(risks.id, riskProcesses.riskId)).where(eq(riskProcesses.processId, id))
        : [],
      db
        .select({ id: processes.id, code: processes.code, name: processes.name, status: processes.status })
        .from(processes)
        .where(eq(processes.parentId, id))
        .orderBy(asc(processes.code), asc(processes.name)),
    ]);

    // Aktiva procesu: přímo přiřazená + použitá v krocích (deduplikace).
    const assetMap = new Map<string, ProcessDetail["assets"][number]>();
    for (const a of procAssets) {
      const prev = assetMap.get(a.id);
      const viaSteps = a.stepId != null;
      if (!prev) assetMap.set(a.id, { id: a.id, name: a.name, assetType: a.assetType, assetClass: a.assetClass, healthStatus: a.healthStatus, viaSteps });
      else if (!viaSteps) prev.viaSteps = false;
    }

    return {
      id: p.id,
      companyId: p.companyId,
      parentId: p.parentId,
      code: p.code,
      name: p.name,
      processType: p.processType,
      status: p.status,
      criticality: p.criticality,
      ownerPositionName: row.ownerPositionName,
      orgUnitName: row.orgUnitName,
      updatedAt: p.updatedAt.toISOString(),
      purpose: p.purpose,
      description: p.description,
      trigger: p.trigger,
      inputs: p.inputs,
      outputs: p.outputs,
      kpis: p.kpis,
      frequency: p.frequency,
      legislation: p.legislation,
      ownerPositionId: p.ownerPositionId,
      orgUnitId: p.orgUnitId,
      ownerHolders: holders,
      hasBpmn: !!p.bpmnXml,
      version: p.version,
      steps,
      assets: [...assetMap.values()],
      documents: docs.map((d) => ({ id: d.id, title: d.title, url: d.url, docType: d.docType, stepId: d.stepId })),
      risks: riskRows.map(({ r }) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        level: riskScore(policies.get(r.companyId) ?? settings.riskPolicy, r, r.scaleLevels).level ?? "unassessed",
        status: r.status,
      })),
      children,
      canEdit: await canEdit(c, p),
    };
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "processes"))

      .get(
        "/",
        requirePerm("processes:read"),
        zValidator("query", z.object({ q: z.string().optional(), status: z.string().optional(), assetId: z.string().uuid().optional() })),
        async (c) => {
          const { q, status, assetId } = c.req.valid("query");
          const where = [inScope(c, processes.companyId)];
          if (q) where.push(or(ilike(processes.name, `%${q}%`), ilike(processes.code, `%${q}%`))!);
          if (status) where.push(eq(processes.status, status as ProcessListItem["status"]));
          if (assetId) where.push(sql`exists (select 1 from process_assets pa where pa.process_id = ${processes.id} and pa.asset_id = ${assetId})`);
          const rows = await db
            .select({
              p: processes,
              ownerPositionName: positions.name,
              orgUnitName: orgUnits.name,
              stepCount: sql<number>`(select count(*)::int from process_steps s where s.process_id = ${processes.id})`,
              riskCount: sql<number>`(select count(*)::int from risk_processes rp where rp.process_id = ${processes.id})`,
            })
            .from(processes)
            .leftJoin(positions, eq(positions.id, processes.ownerPositionId))
            .leftJoin(orgUnits, eq(orgUnits.id, processes.orgUnitId))
            .where(where.length ? and(...where) : undefined)
            .orderBy(asc(processes.code), asc(processes.name));
          return c.json(
            rows.map(
              (r): ProcessListItem => ({
                id: r.p.id,
                companyId: r.p.companyId,
                parentId: r.p.parentId,
                code: r.p.code,
                name: r.p.name,
                processType: r.p.processType,
                status: r.p.status,
                criticality: r.p.criticality,
                ownerPositionName: r.ownerPositionName,
                orgUnitName: r.orgUnitName,
                stepCount: r.stepCount,
                riskCount: r.riskCount,
                updatedAt: r.p.updatedAt.toISOString(),
              }),
            ),
          );
        },
      )

      .post("/", requirePerm("processes:write"), zValidator("json", ProcessInput), async (c) => {
        const { companyId: requested, ...input } = c.req.valid("json");
        const [p] = await db.insert(processes).values({ ...input, companyId: targetCompany(c, requested, "processes:write") }).returning();
        await audit(db, { c, user: currentUser(c), action: "process.created", entityType: "process", entityId: p!.id, details: { name: p!.name } });
        return c.json(p, 201);
      })

      .get("/:id", requirePerm("processes:read"), async (c) => c.json(await detail(c, c.req.param("id"))))

      /* ---------- verze procesu ---------- */
      .get("/:id/versions", requirePerm("processes:read"), async (c) => {
        const d = await detail(c, c.req.param("id"));
        return c.json(await versionList(c, d.id));
      })
      .get("/:id/versions/:vid", requirePerm("processes:read"), async (c) => {
        const d = await detail(c, c.req.param("id"));
        const [v] = await db.select().from(processVersions).where(and(eq(processVersions.id, c.req.param("vid")), eq(processVersions.processId, d.id)));
        if (!v) throw new HTTPException(404, { message: "Verze nenalezena" });
        const dto = (await versionList(c, d.id)).find((x) => x.id === v.id)!;
        return c.json({ ...dto, snapshot: v.snapshot as ProcessSnapshot } satisfies ProcessVersionDetail);
      })
      /** Uloží snímek aktuálního stavu procesu jako novou verzi (návrh). */
      .post("/:id/versions", requirePerm("processes:read"), zValidator("json", ProcessVersionInput), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const d = await detail(c, id);
        const snapshot = processSnapshotOf(d);
        const v = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`proc-ver:${id}`}))`);
          const [m] = await tx.select({ n: max(processVersions.number) }).from(processVersions).where(eq(processVersions.processId, id));
          const [draft] = await tx.select({ id: processVersions.id }).from(processVersions).where(and(eq(processVersions.processId, id), eq(processVersions.status, "draft")));
          if (draft) throw new HTTPException(409, { message: "Proces už má neschválený návrh verze – schvalte ho nebo smažte." });
          const [row] = await tx
            .insert(processVersions)
            .values({ processId: id, number: (m?.n ?? 0) + 1, changeSummary: c.req.valid("json").changeSummary, snapshot, createdById: currentUser(c).id })
            .returning();
          return row!;
        });
        await audit(db, { c, user: currentUser(c), action: "process.version_created", entityType: "process", entityId: id, details: { number: v.number } });
        return c.json(await versionList(c, id), 201);
      })
      .post("/:id/versions/:vid/approve", requirePerm("processes:write", "documents:approve"), zValidator("json", ApproveProcessVersionInput), async (c) => {
        const d = await detail(c, c.req.param("id"));
        const [v] = await db.select().from(processVersions).where(and(eq(processVersions.id, c.req.param("vid")), eq(processVersions.processId, d.id)));
        if (!v) throw new HTTPException(404, { message: "Verze nenalezena" });
        if (v.status !== "draft") throw new HTTPException(409, { message: "Schválit lze jen návrh verze" });
        await db.transaction(async (tx) => {
          await tx.update(processVersions).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(processVersions.processId, d.id), eq(processVersions.status, "approved")));
          await tx
            .update(processVersions)
            .set({ status: "approved", approvedById: currentUser(c).id, approvedAt: new Date(), approvalNote: c.req.valid("json").note ?? null, updatedAt: new Date() })
            .where(eq(processVersions.id, v.id));
          // schválená verze → proces je platný
          await tx.update(processes).set({ status: "active", updatedAt: new Date() }).where(and(eq(processes.id, d.id), eq(processes.status, "draft")));
        });
        await audit(db, { c, user: currentUser(c), action: "process.version_approved", entityType: "process", entityId: d.id, details: { number: v.number } });
        return c.json(await versionList(c, d.id));
      })
      .delete("/:id/versions/:vid", requirePerm("processes:read"), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const [v] = await db.select().from(processVersions).where(and(eq(processVersions.id, c.req.param("vid")), eq(processVersions.processId, id)));
        if (!v) throw new HTTPException(404, { message: "Verze nenalezena" });
        if (v.status !== "draft") throw new HTTPException(409, { message: "Schválené verze se uchovávají a nelze je smazat." });
        await db.delete(processVersions).where(eq(processVersions.id, v.id));
        await audit(db, { c, user: currentUser(c), action: "process.version_deleted", entityType: "process", entityId: id, details: { number: v.number } });
        return c.json(await versionList(c, id));
      })

      .patch("/:id", requirePerm("processes:read"), zValidator("json", ProcessPatch), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
        // Vlastníka a zařazení v hierarchii smí měnit jen správce procesů (ne sám vlastník).
        if (!hasPerm(c, "processes:write") && ("ownerPositionId" in input || "parentId" in input))
          throw new HTTPException(403, { message: "Vlastníka a nadřazený proces mění správce procesů" });
        if ("parentId" in input) await assertNoCycle(id, input.parentId as string | null);
        if (!Object.keys(input).length) return c.json(await detail(c, id));
        await db
          .update(processes)
          .set({ ...input, version: sql`${processes.version} + 1`, updatedAt: new Date() })
          .where(eq(processes.id, id));
        await audit(db, { c, user: currentUser(c), action: "process.updated", entityType: "process", entityId: id, details: input });
        return c.json(await detail(c, id));
      })

      .delete("/:id", requirePerm("processes:write"), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const [[ch]] = await Promise.all([db.select({ n: count() }).from(processes).where(eq(processes.parentId, id))]);
        if (ch!.n > 0) throw new HTTPException(409, { message: "Proces má podprocesy – nejdřív je přesuňte nebo smažte." });
        const [p] = await db.delete(processes).where(eq(processes.id, id)).returning({ name: processes.name });
        if (!p) throw new HTTPException(404, { message: "Proces nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "process.deleted", entityType: "process", entityId: id, details: p });
        return c.body(null, 204);
      })

      /* ---------- kroky ---------- */
      .post("/:id/steps", requirePerm("processes:read"), zValidator("json", StepInput), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const { raci, assetIds, ...input } = c.req.valid("json");
        const [m] = await db.select({ m: max(processSteps.order) }).from(processSteps).where(eq(processSteps.processId, id));
        const [s] = await db
          .insert(processSteps)
          .values({ ...input, processId: id, order: (m?.m ?? 0) + 1 })
          .returning();
        await setStepLinks(db, id, s!.id, raci, assetIds);
        await touch(id);
        await audit(db, { c, user: currentUser(c), action: "process.step_created", entityType: "process", entityId: id, details: { step: s!.name } });
        return c.json(s, 201);
      })
      .patch("/:id/steps/:stepId", requirePerm("processes:read"), zValidator("json", StepPatch), async (c) => {
        const { id, stepId } = c.req.param();
        await loadForEdit(c, id);
        const { raci, assetIds, ...rest } = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
        const [s] = Object.keys(input).length
          ? await db
              .update(processSteps)
              .set({ ...input, updatedAt: new Date() })
              .where(and(eq(processSteps.id, stepId), eq(processSteps.processId, id)))
              .returning()
          : await db.select().from(processSteps).where(and(eq(processSteps.id, stepId), eq(processSteps.processId, id)));
        if (!s) throw new HTTPException(404, { message: "Krok nenalezen" });
        await setStepLinks(db, id, stepId, raci, assetIds);
        await touch(id);
        await audit(db, { c, user: currentUser(c), action: "process.step_updated", entityType: "process", entityId: id, details: { step: s.name, ...input } });
        return c.json(s);
      })
      .delete("/:id/steps/:stepId", requirePerm("processes:read"), async (c) => {
        const { id, stepId } = c.req.param();
        await loadForEdit(c, id);
        const [s] = await db
          .delete(processSteps)
          .where(and(eq(processSteps.id, stepId), eq(processSteps.processId, id)))
          .returning({ name: processSteps.name });
        if (!s) throw new HTTPException(404, { message: "Krok nenalezen" });
        await touch(id);
        await audit(db, { c, user: currentUser(c), action: "process.step_deleted", entityType: "process", entityId: id, details: { step: s.name } });
        return c.body(null, 204);
      })
      .put("/:id/steps/order", requirePerm("processes:read"), zValidator("json", ReorderStepsInput), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const { stepIds } = c.req.valid("json");
        const existing = await db.select({ id: processSteps.id }).from(processSteps).where(eq(processSteps.processId, id));
        const set = new Set(existing.map((s) => s.id));
        if (stepIds.length !== set.size || !stepIds.every((s) => set.has(s)))
          throw new HTTPException(400, { message: "Seznam kroků neodpovídá procesu" });
        await db.transaction(async (tx) => {
          for (const [i, sid] of stepIds.entries()) await tx.update(processSteps).set({ order: i + 1 }).where(eq(processSteps.id, sid));
        });
        await touch(id);
        return c.json(await loadSteps(db, id));
      })

      /** Import kroků z BPMN diagramu (FE vyparsuje úlohy v pořadí toku). Přidá jen kroky, které ještě neexistují (dle názvu). */
      .post(
        "/:id/steps/import",
        requirePerm("processes:read"),
        zValidator(
          "json",
          z.object({ tasks: z.array(z.object({ name: z.string().trim().min(1).max(255), stepType: z.enum(STEP_TYPES).default("task") })).max(500) }),
        ),
        async (c) => {
          const id = c.req.param("id");
          await loadForEdit(c, id);
          const { tasks } = c.req.valid("json");
          const existing = await db.select({ name: processSteps.name, order: processSteps.order }).from(processSteps).where(eq(processSteps.processId, id));
          const names = new Set(existing.map((s) => s.name.toLowerCase()));
          let order = Math.max(0, ...existing.map((s) => s.order));
          const toAdd = tasks.filter((t) => !names.has(t.name.toLowerCase()) && names.add(t.name.toLowerCase()));
          if (toAdd.length) await db.insert(processSteps).values(toAdd.map((t) => ({ processId: id, name: t.name, stepType: t.stepType, order: ++order })));
          if (toAdd.length) await touch(id);
          await audit(db, { c, user: currentUser(c), action: "process.steps_imported", entityType: "process", entityId: id, details: { added: toAdd.length } });
          return c.json({ added: toAdd.length, skipped: tasks.length - toAdd.length });
        },
      )

      /* ---------- aktiva a dokumenty ---------- */
      .put("/:id/assets", requirePerm("processes:read"), zValidator("json", ProcessAssetsInput), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const ids = [...new Set(c.req.valid("json").assetIds)];
        await db.delete(processAssets).where(and(eq(processAssets.processId, id), isNull(processAssets.stepId)));
        if (ids.length) await db.insert(processAssets).values(ids.map((assetId) => ({ processId: id, assetId })));
        await touch(id);
        await audit(db, { c, user: currentUser(c), action: "process.assets_set", entityType: "process", entityId: id, details: { assetIds: ids } });
        return c.json(await detail(c, id));
      })
      .post("/:id/documents", requirePerm("processes:read"), zValidator("json", ProcessDocumentInput), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const input = c.req.valid("json");
        if (input.url && !/^(https?:\/\/|\\\\|file:)/i.test(input.url))
          throw new HTTPException(400, { message: "Odkaz musí začínat http(s)://, file: nebo \\\\server" });
        const [d] = await db.insert(processDocuments).values({ ...input, processId: id }).returning();
        await audit(db, { c, user: currentUser(c), action: "process.document_added", entityType: "process", entityId: id, details: { title: d!.title } });
        return c.json(d, 201);
      })
      .delete("/:id/documents/:docId", requirePerm("processes:read"), async (c) => {
        const { id, docId } = c.req.param();
        await loadForEdit(c, id);
        const [d] = await db
          .delete(processDocuments)
          .where(and(eq(processDocuments.id, docId), eq(processDocuments.processId, id)))
          .returning({ title: processDocuments.title });
        if (!d) throw new HTTPException(404, { message: "Dokument nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "process.document_removed", entityType: "process", entityId: id, details: d });
        return c.body(null, 204);
      })

      /* ---------- BPMN ---------- */
      .get("/:id/bpmn", requirePerm("processes:read"), async (c) => {
        const id = c.req.param("id");
        const [p] = await db.select({ name: processes.name, xml: processes.bpmnXml, companyId: processes.companyId }).from(processes).where(eq(processes.id, id));
        if (!p) throw new HTTPException(404, { message: "Proces nenalezen" });
        assertScope(c, p.companyId, "Proces nenalezen");
        if (p.xml) return c.json({ xml: p.xml, generated: false });
        const steps = await loadSteps(db, id);
        return c.json({ xml: generateBpmn(p.name, steps.map((s) => ({ id: s.id, name: s.name, stepType: s.stepType, lane: laneOf(s.raci) }))), generated: true });
      })
      /** Vygeneruje diagram z aktuálních kroků (neukládá). */
      .post("/:id/bpmn/generate", requirePerm("processes:read"), async (c) => {
        const id = c.req.param("id");
        const [p] = await db.select({ name: processes.name, companyId: processes.companyId }).from(processes).where(eq(processes.id, id));
        if (!p) throw new HTTPException(404, { message: "Proces nenalezen" });
        assertScope(c, p.companyId, "Proces nenalezen");
        const steps = await loadSteps(db, id);
        return c.json({ xml: generateBpmn(p.name, steps.map((s) => ({ id: s.id, name: s.name, stepType: s.stepType, lane: laneOf(s.raci) }))), generated: true });
      })
      .put("/:id/bpmn", requirePerm("processes:read"), zValidator("json", BpmnInput), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        const { xml } = c.req.valid("json");
        if (!xml.includes("http://www.omg.org/spec/BPMN/20100524/MODEL")) throw new HTTPException(400, { message: "Nejde o BPMN 2.0 XML" });
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new HTTPException(400, { message: "XML nesmí obsahovat DTD/entity" });
        await db
          .update(processes)
          .set({ bpmnXml: xml, version: sql`${processes.version} + 1`, updatedAt: new Date() })
          .where(eq(processes.id, id));
        await audit(db, { c, user: currentUser(c), action: "process.bpmn_saved", entityType: "process", entityId: id, details: { bytes: xml.length } });
        return c.json({ ok: true });
      })
      .delete("/:id/bpmn", requirePerm("processes:read"), async (c) => {
        const id = c.req.param("id");
        await loadForEdit(c, id);
        await db.update(processes).set({ bpmnXml: null, updatedAt: new Date() }).where(eq(processes.id, id));
        await audit(db, { c, user: currentUser(c), action: "process.bpmn_cleared", entityType: "process", entityId: id });
        return c.body(null, 204);
      })
  );
}
