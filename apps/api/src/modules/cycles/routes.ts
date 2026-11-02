import {
  CYCLE_ITEM_STATES,
  CycleInput,
  CycleItemDecision,
  CyclePatch,
  compareSnapshots,
  getRiskMethodology,
  maxImpact,
  nextCycleDue,
  residualValues,
  riskScore,
  scoreMethodology,
  BUILTIN_RISK_METHODOLOGY,
  type CycleCompareRow,
  type CycleDetail,
  type CycleItemSnapshot,
  type CycleItemState,
  type CycleKind,
  type CycleListItem,
  type CycleStatusDto,
  type Permission,
  type RiskPolicy,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, ne, notInArray, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, riskPolicies, scopeOf, settingsFor, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assessmentCycleItems, assessmentCycles, biaAssessments, changes, positions, processes, risks, users } from "../../db/schema";
import { quantOf } from "../risks/quant";

type Ctx = Context<AppEnv>;
type CycleRow = typeof assessmentCycles.$inferSelect;
type RiskRow = typeof risks.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

const READ: Record<CycleKind, Permission> = { risk: "risks:read", bia: "bia:read" };
const WRITE: Record<CycleKind, Permission> = { risk: "risks:write", bia: "bia:write" };
const MODULE: Record<CycleKind, string> = { risk: "risks", bia: "continuity" };

/* ---------------- snímky položek ---------------- */

export function riskSnapshot(r: RiskRow, policy: RiskPolicy): CycleItemSnapshot {
  const cur = riskScore(policy, r, r.scaleLevels);
  const res = riskScore(policy, residualValues(r), r.scaleLevels);
  const mdef = r.methodologyKey !== BUILTIN_RISK_METHODOLOGY ? getRiskMethodology(r.methodologyKey) : null;
  const lk = mdef ? scoreMethodology(mdef, r.factorValues).levelKey : null;
  return {
    name: r.name,
    code: r.code,
    score: cur.score,
    level: cur.level,
    levelLabel: mdef?.levels.find((l) => l.key === lk)?.label ?? null,
    residualScore: res.score,
    residualLevel: res.level,
    methodologyKey: r.methodologyKey,
    values:
      r.methodologyKey === BUILTIN_RISK_METHODOLOGY
        ? { impact: r.impact, threatLevel: r.threatLevel, vulnLevel: r.vulnLevel, likelihood: r.likelihood }
        : { factors: r.factorValues ?? null },
    ale: r.quant ? (quantOf(r.id, r.quant, policy.quant)?.inherent.mean ?? null) : null,
  };
}

function biaSnapshot(b: typeof biaAssessments.$inferSelect, p: { name: string; code: string | null }): CycleItemSnapshot {
  return { name: p.name, code: p.code, mtpdHours: b.mtpdHours, rtoHours: b.rtoHours, rpoHours: b.rpoHours, maxImpact: maxImpact(b.impacts) };
}

/** Aktuální položky v rozsahu (otevřená rizika / BIA společnosti) se snímky. */
async function currentEntities(db: Db, kind: CycleKind, companyId: string, ids?: string[]): Promise<Map<string, CycleItemSnapshot>> {
  const out = new Map<string, CycleItemSnapshot>();
  if (kind === "risk") {
    const pol = (await riskPolicies(db, await getSettings(db))).get(companyId)!;
    const rows = await db
      .select()
      .from(risks)
      .where(and(eq(risks.companyId, companyId), ids ? inArray(risks.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]) : ne(risks.status, "closed")));
    for (const r of rows) out.set(r.id, riskSnapshot(r, pol));
  } else {
    const rows = await db
      .select({ b: biaAssessments, p: { name: processes.name, code: processes.code } })
      .from(biaAssessments)
      .innerJoin(processes, eq(processes.id, biaAssessments.processId))
      .where(and(eq(biaAssessments.companyId, companyId), ids ? inArray(biaAssessments.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]) : undefined));
    for (const { b, p } of rows) out.set(b.id, biaSnapshot(b, p));
  }
  return out;
}

/** Stav pravidelného hodnocení společnosti (poslední schválený cyklus, termín dalšího). */
export async function cycleStatus(db: Db, companyId: string, kind: CycleKind): Promise<CycleStatusDto> {
  const [last] = await db
    .select({ id: assessmentCycles.id, at: assessmentCycles.approvedAt })
    .from(assessmentCycles)
    .where(and(eq(assessmentCycles.companyId, companyId), eq(assessmentCycles.kind, kind), eq(assessmentCycles.status, "approved")))
    .orderBy(desc(assessmentCycles.approvedAt))
    .limit(1);
  const [running] = await db
    .select({ id: assessmentCycles.id })
    .from(assessmentCycles)
    .where(and(eq(assessmentCycles.companyId, companyId), eq(assessmentCycles.kind, kind), inArray(assessmentCycles.status, ["in_progress", "review"])))
    .limit(1);
  const lastAt = last?.at?.toISOString() ?? null;
  const next = nextCycleDue(lastAt);
  return { kind, lastApprovedAt: lastAt, lastApprovedId: last?.id ?? null, nextDue: next, overdue: !lastAt || (!!next && next < today()), runningId: running?.id ?? null };
}

/**
 * Přehodnocení položky mimo cyklus (úprava rizika / BIA) se v probíhajícím cyklu zapíše jako „přehodnoceno“.
 * Volá se z modulů rizik a BIA po změně hodnocení.
 */
export async function markReassessed(db: Db, kind: CycleKind, entityId: string, userId: string) {
  await markInCycles(db, kind, entityId, userId, "reassessed");
}

/** Potvrzení hodnocení beze změny mimo cyklus (ADR-058) – v probíhajícím cyklu označí jen dosud nerozhodnuté položky. */
export async function markConfirmed(db: Db, kind: CycleKind, entityId: string, userId: string) {
  await markInCycles(db, kind, entityId, userId, "confirmed");
}

async function markInCycles(db: Db, kind: CycleKind, entityId: string, userId: string, state: "reassessed" | "confirmed") {
  const items = await db
    .select({ cycleId: assessmentCycleItems.cycleId, companyId: assessmentCycles.companyId })
    .from(assessmentCycleItems)
    .innerJoin(assessmentCycles, eq(assessmentCycles.id, assessmentCycleItems.cycleId))
    .where(
      and(
        eq(assessmentCycleItems.entityId, entityId),
        eq(assessmentCycles.kind, kind),
        eq(assessmentCycles.status, "in_progress"),
        state === "confirmed" ? eq(assessmentCycleItems.state, "pending") : ne(assessmentCycleItems.state, "excluded"),
      ),
    );
  for (const it of items) {
    const snap = (await currentEntities(db, kind, it.companyId, [entityId])).get(entityId);
    if (!snap) continue;
    await db
      .update(assessmentCycleItems)
      .set({ state, after: snap, decidedAt: new Date(), decidedById: userId, name: snap.name.slice(0, 500), code: snap.code })
      .where(and(eq(assessmentCycleItems.cycleId, it.cycleId), eq(assessmentCycleItems.entityId, entityId)));
  }
}

export async function loadCycles(db: Db, where?: SQL): Promise<(CycleListItem & { _row: CycleRow })[]> {
  const rows = await db
    .select({ c: assessmentCycles, leader: positions.name })
    .from(assessmentCycles)
    .leftJoin(positions, eq(positions.id, assessmentCycles.leaderPositionId))
    .where(where)
    .orderBy(desc(assessmentCycles.startedAt));
  if (!rows.length) return [];
  const items = await db
    .select({ cycleId: assessmentCycleItems.cycleId, state: assessmentCycleItems.state })
    .from(assessmentCycleItems)
    .where(inArray(assessmentCycleItems.cycleId, rows.map((r) => r.c.id)));
  const t = today();
  return rows.map(({ c, leader }) => {
    const counts = Object.fromEntries(CYCLE_ITEM_STATES.map((s) => [s, 0])) as Record<CycleItemState, number>;
    for (const i of items) if (i.cycleId === c.id) counts[i.state]++;
    return {
      id: c.id,
      companyId: c.companyId,
      kind: c.kind,
      title: c.title,
      reason: c.reason,
      status: c.status,
      periodFrom: c.periodFrom,
      periodTo: c.periodTo,
      dueDate: c.dueDate,
      startedAt: c.startedAt.toISOString(),
      approvedAt: c.approvedAt?.toISOString() ?? null,
      leaderPositionName: leader,
      counts,
      total: counts.pending + counts.reassessed + counts.confirmed,
      overdue: (c.status === "in_progress" || c.status === "review") && !!c.dueDate && c.dueDate < t,
      _row: c,
    };
  });
}

export function cycleRoutes(db: Db) {
  async function row(c: Ctx, id: string, write = false) {
    const [x] = await db.select().from(assessmentCycles).where(eq(assessmentCycles.id, id));
    if (!x) throw new HTTPException(404, { message: "Hodnocení nenalezeno" });
    assertScope(c, x.companyId, "Hodnocení nenalezeno");
    if (!hasPerm(c, READ[x.kind])) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    if (write && !hasPermIn(c, WRITE[x.kind], x.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return x;
  }
  async function moduleOn(kind: CycleKind) {
    if (!(await getSettings(db)).enabledModules.includes(MODULE[kind] as never)) throw new HTTPException(404, { message: "Modul není zapnutý" });
  }

  /** Doplní do probíhajícího cyklu položky založené po jeho zahájení. */
  async function syncNew(x: CycleRow) {
    if (x.status !== "in_progress") return;
    const have = new Set((await db.select({ id: assessmentCycleItems.entityId }).from(assessmentCycleItems).where(eq(assessmentCycleItems.cycleId, x.id))).map((r) => r.id));
    const cur = await currentEntities(db, x.kind, x.companyId);
    const add = [...cur].filter(([id]) => !have.has(id));
    if (add.length) await db.insert(assessmentCycleItems).values(add.map(([entityId, s]) => ({ cycleId: x.id, entityId, name: s.name.slice(0, 500), code: s.code, before: null }))).onConflictDoNothing();
  }

  async function detail(c: Ctx, id: string): Promise<CycleDetail> {
    const x = await row(c, id);
    await syncNew(x);
    const [item] = await loadCycles(db, eq(assessmentCycles.id, id));
    const rows = await db
      .select({ i: assessmentCycleItems, by: users.displayName })
      .from(assessmentCycleItems)
      .leftJoin(users, eq(users.id, assessmentCycleItems.decidedById))
      .where(eq(assessmentCycleItems.cycleId, id))
      .orderBy(asc(assessmentCycleItems.code), asc(assessmentCycleItems.name));
    const live = x.status === "in_progress" || x.status === "review" ? await currentEntities(db, x.kind, x.companyId, rows.map((r) => r.i.entityId)) : new Map<string, CycleItemSnapshot>();
    const [ch, approver, prev] = await Promise.all([
      x.changeId ? db.select({ title: changes.title }).from(changes).where(eq(changes.id, x.changeId)) : [],
      x.approvedById ? db.select({ n: users.displayName }).from(users).where(eq(users.id, x.approvedById)) : [],
      db
        .select({ id: assessmentCycles.id })
        .from(assessmentCycles)
        .where(and(eq(assessmentCycles.companyId, x.companyId), eq(assessmentCycles.kind, x.kind), eq(assessmentCycles.status, "approved"), ne(assessmentCycles.id, id)))
        .orderBy(desc(assessmentCycles.approvedAt))
        .limit(1),
    ]);
    const { _row, ...rest } = item!;
    return {
      ...rest,
      changeId: x.changeId,
      changeTitle: ch[0]?.title ?? null,
      team: x.team,
      scope: x.scope,
      leaderPositionId: x.leaderPositionId,
      approvedByName: approver[0]?.n ?? null,
      approvalNote: x.approvalNote,
      items: rows.map(({ i, by }) => ({
        entityId: i.entityId,
        name: i.name,
        code: i.code,
        state: i.state,
        note: i.note,
        decidedAt: i.decidedAt?.toISOString() ?? null,
        decidedByName: by,
        before: i.before,
        after: i.after,
        current: live.get(i.entityId) ?? null,
      })),
      previousId: prev[0]?.id ?? null,
      canEdit: hasPermIn(c, WRITE[x.kind], x.companyId) && (x.status === "in_progress" || x.status === "review"),
    };
  }

  return (
    new Hono<AppEnv>()
      .use("*", requirePerm("risks:read", "bia:read"))
      .get("/", zValidator("query", z.object({ kind: z.enum(["risk", "bia"]) })), async (c) => {
        const { kind } = c.req.valid("query");
        await moduleOn(kind);
        if (!hasPerm(c, READ[kind])) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        return c.json((await loadCycles(db, and(inScope(c, assessmentCycles.companyId), eq(assessmentCycles.kind, kind)))).map(({ _row, ...x }) => x));
      })
      /** Stav pravidelného hodnocení za společnosti v rozsahu. */
      .get("/status", zValidator("query", z.object({ kind: z.enum(["risk", "bia"]) })), async (c) => {
        const { kind } = c.req.valid("query");
        await moduleOn(kind);
        if (!hasPerm(c, READ[kind])) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const out = [];
        for (const id of scopeOf(c).ids) out.push({ companyId: id, ...(await cycleStatus(db, id, kind)) });
        return c.json(out);
      })
      .post("/", zValidator("json", CycleInput), async (c) => {
        const { companyId: requested, entityIds, ...input } = c.req.valid("json");
        await moduleOn(input.kind);
        if (!hasPerm(c, WRITE[input.kind])) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const companyId = targetCompany(c, requested, WRITE[input.kind]);
        const st = await cycleStatus(db, companyId, input.kind);
        if (st.runningId) throw new HTTPException(409, { message: "Pro společnost už probíhá hodnocení stejného druhu – dokončete ho nebo zrušte." });
        const ents = await currentEntities(db, input.kind, companyId, entityIds.length ? entityIds : undefined);
        const s = await settingsFor(db, c, companyId);
        const user = currentUser(c);
        const [x] = await db
          .insert(assessmentCycles)
          .values({ ...input, companyId, methodologyKey: input.kind === "risk" ? s.riskPolicy.methodology || BUILTIN_RISK_METHODOLOGY : null, createdById: user.id, dueDate: input.dueDate ?? null })
          .returning();
        if (ents.size)
          await db.insert(assessmentCycleItems).values([...ents].map(([entityId, snap]) => ({ cycleId: x!.id, entityId, name: snap.name.slice(0, 500), code: snap.code, before: snap })));
        await audit(db, { c, user, action: "cycle.started", entityType: "assessment_cycle", entityId: x!.id, details: { kind: x!.kind, title: x!.title, items: ents.size } });
        return c.json(await detail(c, x!.id), 201);
      })
      .get("/:id", async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/:id", zValidator("json", CyclePatch), async (c) => {
        const id = c.req.param("id");
        const x = await row(c, id, true);
        if (x.status === "approved") throw new HTTPException(409, { message: "Schválené hodnocení nelze měnit." });
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
        if (Object.keys(input).length) await db.update(assessmentCycles).set({ ...input, updatedAt: new Date() }).where(eq(assessmentCycles.id, id));
        await audit(db, { c, user: currentUser(c), action: "cycle.updated", entityType: "assessment_cycle", entityId: id, details: input });
        return c.json(await detail(c, id));
      })

      /** Rozhodnutí o položce: potvrzeno beze změny / vyřazeno z rozsahu / vrátit na „čeká“. */
      .put("/:id/items/:entityId", zValidator("json", CycleItemDecision), async (c) => {
        const { id, entityId } = c.req.param();
        const x = await row(c, id, true);
        if (x.status !== "in_progress") throw new HTTPException(409, { message: "Položky lze měnit jen v probíhajícím hodnocení." });
        const { state, note } = c.req.valid("json");
        const [it] = await db.select().from(assessmentCycleItems).where(and(eq(assessmentCycleItems.cycleId, id), eq(assessmentCycleItems.entityId, entityId)));
        if (!it) throw new HTTPException(404, { message: "Položka nenalezena" });
        if (state === "excluded" && !note) throw new HTTPException(400, { message: "Vyřazení z rozsahu zdůvodněte." });
        const user = currentUser(c);
        const snap = state === "confirmed" ? (await currentEntities(db, x.kind, x.companyId, [entityId])).get(entityId) : undefined;
        if (state === "confirmed" && !snap) throw new HTTPException(409, { message: "Položka už v registru není – vyřaďte ji z rozsahu." });
        if (state === "confirmed" && x.kind === "risk" && snap?.score == null)
          throw new HTTPException(400, { message: "Riziko není ohodnoceno – nejdřív ho ohodnoťte." });
        await db
          .update(assessmentCycleItems)
          .set({ state, note: note ?? null, after: state === "pending" ? null : (snap ?? it.after), decidedAt: state === "pending" ? null : new Date(), decidedById: state === "pending" ? null : user.id })
          .where(and(eq(assessmentCycleItems.cycleId, id), eq(assessmentCycleItems.entityId, entityId)));
        // potvrzení = provedené hodnocení (§ 8 odst. 1 písm. c) – posouvá termín přehodnocení
        if (state === "confirmed") {
          if (x.kind === "risk") await db.update(risks).set({ assessedAt: new Date() }).where(eq(risks.id, entityId));
          else await db.update(biaAssessments).set({ assessedAt: today() }).where(eq(biaAssessments.id, entityId));
        }
        await audit(db, { c, user, action: "cycle.item_decided", entityType: "assessment_cycle", entityId: id, details: { entityId, state } });
        return c.json(await detail(c, id));
      })

      /** Předání ke schválení – všechny položky musí být rozhodnuty. */
      .post("/:id/submit", async (c) => {
        const id = c.req.param("id");
        const x = await row(c, id, true);
        if (x.status !== "in_progress") throw new HTTPException(409, { message: "Ke schválení lze předat jen probíhající hodnocení." });
        await syncNew(x);
        const [p] = await db.select({ e: assessmentCycleItems.entityId }).from(assessmentCycleItems).where(and(eq(assessmentCycleItems.cycleId, id), eq(assessmentCycleItems.state, "pending"))).limit(1);
        if (p) throw new HTTPException(400, { message: "Některé položky čekají na přehodnocení nebo potvrzení." });
        await db.update(assessmentCycles).set({ status: "review", updatedAt: new Date() }).where(eq(assessmentCycles.id, id));
        await audit(db, { c, user: currentUser(c), action: "cycle.submitted", entityType: "assessment_cycle", entityId: id });
        return c.json(await detail(c, id));
      })
      .post("/:id/reopen", async (c) => {
        const id = c.req.param("id");
        const x = await row(c, id, true);
        if (x.status !== "review") throw new HTTPException(409, { message: "Vrátit lze jen hodnocení ke schválení." });
        await db.update(assessmentCycles).set({ status: "in_progress", updatedAt: new Date() }).where(eq(assessmentCycles.id, id));
        return c.json(await detail(c, id));
      })
      /** Schválení – zmrazí konečný stav položek. */
      .post("/:id/approve", requirePerm("documents:approve"), zValidator("json", z.object({ note: z.string().trim().max(2000).nullable().optional() })), async (c) => {
        const id = c.req.param("id");
        const x = await row(c, id);
        if (x.status !== "review") throw new HTTPException(409, { message: "Schválit lze jen hodnocení předané ke schválení." });
        const items = await db.select().from(assessmentCycleItems).where(and(eq(assessmentCycleItems.cycleId, id), notInArray(assessmentCycleItems.state, ["excluded"])));
        const live = await currentEntities(db, x.kind, x.companyId, items.map((i) => i.entityId));
        const user = currentUser(c);
        await db.transaction(async (tx) => {
          for (const i of items) {
            const s = live.get(i.entityId);
            if (s) await tx.update(assessmentCycleItems).set({ after: s }).where(and(eq(assessmentCycleItems.cycleId, id), eq(assessmentCycleItems.entityId, i.entityId)));
          }
          await tx.update(assessmentCycles).set({ status: "approved", approvedAt: new Date(), approvedById: user.id, approvalNote: c.req.valid("json").note ?? null, updatedAt: new Date() }).where(eq(assessmentCycles.id, id));
        });
        await audit(db, { c, user, action: "cycle.approved", entityType: "assessment_cycle", entityId: id, details: { kind: x.kind, items: items.length } });
        return c.json(await detail(c, id));
      })
      .post("/:id/cancel", async (c) => {
        const id = c.req.param("id");
        const x = await row(c, id, true);
        if (x.status === "approved") throw new HTTPException(409, { message: "Schválené hodnocení nelze zrušit." });
        await db.update(assessmentCycles).set({ status: "cancelled", updatedAt: new Date() }).where(eq(assessmentCycles.id, id));
        await audit(db, { c, user: currentUser(c), action: "cycle.cancelled", entityType: "assessment_cycle", entityId: id });
        return c.json(await detail(c, id));
      })

      /** Porovnání s předchozím schváleným hodnocením (nebo zadaným `with`). */
      .get("/:id/compare", zValidator("query", z.object({ with: z.string().uuid().optional() })), async (c) => {
        const id = c.req.param("id");
        const d = await detail(c, id);
        const otherId = c.req.valid("query").with ?? d.previousId;
        let prev = new Map<string, { name: string; code: string | null; snap: CycleItemSnapshot | null }>();
        if (otherId) {
          await row(c, otherId);
          const rows = await db.select().from(assessmentCycleItems).where(and(eq(assessmentCycleItems.cycleId, otherId), ne(assessmentCycleItems.state, "excluded")));
          prev = new Map(rows.map((r) => [r.entityId, { name: r.name, code: r.code, snap: r.after ?? r.before }]));
        }
        const out: CycleCompareRow[] = [];
        const seen = new Set<string>();
        for (const i of d.items) {
          if (i.state === "excluded") continue;
          seen.add(i.entityId);
          const after = d.status === "approved" ? (i.after ?? i.before) : (i.current ?? i.after);
          const before = otherId ? (prev.get(i.entityId)?.snap ?? null) : i.before;
          out.push({ entityId: i.entityId, name: i.name, code: i.code, before, after, change: compareSnapshots(before, after) });
        }
        if (otherId) for (const [eid, p] of prev) if (!seen.has(eid)) out.push({ entityId: eid, name: p.name, code: p.code, before: p.snap, after: null, change: "removed" });
        const order = { worse: 0, new: 1, better: 2, removed: 3, same: 4 } as const;
        return c.json({ previousId: otherId ?? null, rows: out.sort((a, b) => order[a.change] - order[b.change]) });
      })
  );
}
