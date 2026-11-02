import {
  CourseInput,
  CoursePatch,
  RecordInput,
  SessionInput,
  SessionPatch,
  trainingState,
  type CourseDetail,
  type CourseListItem,
  type MyTrainingItem,
  type TrainingLogRow,
  type TrainingState,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { policies, policyVersions, positions, trainingCourses, trainingRecords, trainingSessionParticipants, trainingSessions, users } from "../../db/schema";
import { audienceMembers, type AudienceMember } from "../org/audience";

type Ctx = Context<AppEnv>;
type CourseRow = typeof trainingCourses.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

/** Stav školení všech dotčených osob kurzu. */
export async function coursePeople(db: Db, course: CourseRow, members?: AudienceMember[]) {
  const m = members ?? (await audienceMembers(db, course.companyId, course.audience));
  const last = new Map<string, string>();
  const lastCreated = new Map<string, number>();
  if (m.length) {
    const rows = await db
      .select({ userId: trainingRecords.userId, at: sql<string>`max(${trainingRecords.completedAt})::text`, created: sql<string>`max(${trainingRecords.createdAt})::text` })
      .from(trainingRecords)
      .where(and(eq(trainingRecords.courseId, course.id), eq(trainingRecords.passed, true), inArray(trainingRecords.userId, m.map((x) => x.userId))))
      .groupBy(trainingRecords.userId);
    for (const r of rows) {
      last.set(r.userId, r.at);
      lastCreated.set(r.userId, new Date(r.created).getTime());
    }
  }
  const t = today();
  // dokument s „opakovat školení při nové verzi“: absolvování před schválením platné verze se nepočítá,
  // lhůta = lhůta pro seznámení od schválení verze
  let reset: { since: string; at: number; days: number } | null = null;
  if (course.policyId) {
    const [r] = await db
      .select({ retrain: policies.retrainOnNewVersion, days: policies.ackDueDays, approvedAt: policyVersions.approvedAt })
      .from(policies)
      .innerJoin(policyVersions, and(eq(policyVersions.policyId, policies.id), eq(policyVersions.status, "approved")))
      .where(eq(policies.id, course.policyId));
    if (r?.retrain && r.approvedAt) reset = { since: r.approvedAt.toISOString().slice(0, 10), at: r.approvedAt.getTime(), days: r.days };
  }
  return m.map((x) => {
    const lc = last.get(x.userId) ?? null;
    // absolvováno před schválením platné verze (u téhož dne rozhoduje okamžik zápisu)
    if (reset && (!lc || lc < reset.since || (lc === reset.since && (lastCreated.get(x.userId) ?? 0) < reset.at))) {
      const since = x.since && x.since > reset.since ? x.since : reset.since;
      const r = trainingState({ ...course, dueDaysForNew: reset.days }, null, t, since);
      return { userId: x.userId, name: x.name, email: x.email, lastCompleted: lc, validUntil: null, dueDate: r.dueDate, state: r.state };
    }
    const s = trainingState(course, lc, t, x.since);
    return { userId: x.userId, name: x.name, email: x.email, lastCompleted: lc, validUntil: s.validUntil, dueDate: s.dueDate, state: s.state };
  });
}

export async function loadCourses(db: Db, where?: SQL) {
  const rows = await db
    .select({ c: trainingCourses, owner: positions.name })
    .from(trainingCourses)
    .leftJoin(positions, eq(positions.id, trainingCourses.ownerPositionId))
    .where(where)
    .orderBy(asc(trainingCourses.code), asc(trainingCourses.title));
  const next = rows.length
    ? await db
        .select({ courseId: trainingSessions.courseId, d: sql<string>`min(${trainingSessions.date})::text` })
        .from(trainingSessions)
        .where(and(inArray(trainingSessions.courseId, rows.map((r) => r.c.id)), eq(trainingSessions.status, "planned"), gte(trainingSessions.date, today())))
        .groupBy(trainingSessions.courseId)
    : [];
  const nextBy = new Map(next.map((n) => [n.courseId, n.d]));
  const out = [];
  for (const { c, owner } of rows) {
    const people = c.active ? await coursePeople(db, c) : [];
    const stats = { ok: 0, due_soon: 0, overdue: 0, missing: 0 } as Record<TrainingState, number>;
    for (const p of people) stats[p.state]++;
    const item: CourseListItem = {
      id: c.id,
      companyId: c.companyId,
      code: c.code,
      title: c.title,
      kind: c.kind,
      form: c.form,
      intervalMonths: c.intervalMonths,
      ownerPositionName: owner,
      active: c.active,
      stats,
      required: people.length,
      nextSession: nextBy.get(c.id) ?? null,
    };
    out.push({ item, row: c, people });
  }
  return out;
}

export function awarenessRoutes(db: Db) {
  async function row(c: Ctx, id: string) {
    const [x] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, id));
    if (!x) throw new HTTPException(404, { message: "Školení nenalezeno" });
    assertScope(c, x.companyId, "Školení nenalezeno");
    return x;
  }

  async function detail(c: Ctx, id: string): Promise<CourseDetail> {
    await row(c, id);
    const [x] = await loadCourses(db, eq(trainingCourses.id, id));
    const r = x!.row;
    const [sessions, pol] = await Promise.all([
      db
        .select({ s: trainingSessions, n: sql<number>`(select count(*)::int from training_session_participants p where p.session_id = ${trainingSessions.id})` })
        .from(trainingSessions)
        .where(eq(trainingSessions.courseId, id))
        .orderBy(desc(trainingSessions.date)),
      r.policyId ? db.select({ title: policies.title }).from(policies).where(eq(policies.id, r.policyId)) : [],
    ]);
    return {
      ...x!.item,
      description: r.description,
      topics: r.topics,
      audience: r.audience,
      dueDaysForNew: r.dueDaysForNew,
      durationHours: r.durationHours,
      ownerPositionId: r.ownerPositionId,
      policyId: r.policyId,
      policyTitle: pol[0]?.title ?? null,
      sessions: sessions.map(({ s, n }) => ({ id: s.id, date: s.date, status: s.status, trainer: s.trainer, location: s.location, note: s.note, effectiveness: s.effectiveness, participants: Number(n) })),
      people: (x!.people.length || !r.active ? x!.people : await coursePeople(db, r)).map(({ userId, name, lastCompleted, validUntil, state }) => ({ userId, name, lastCompleted, validUntil, state })),
      canEdit: hasPerm(c, "awareness:write"),
    };
  }

  /** Zapíše absolvování (bez duplicit pro stejné školení, osobu a den). */
  async function record(courseId: string, userIds: string[], completedAt: string, by: string, extra: { sessionId?: string | null; score?: number | null; passed?: boolean; note?: string | null } = {}) {
    const u = [...new Set(userIds)];
    if (!u.length) return 0;
    const existing = await db
      .select({ userId: trainingRecords.userId })
      .from(trainingRecords)
      .where(and(eq(trainingRecords.courseId, courseId), eq(trainingRecords.completedAt, completedAt), inArray(trainingRecords.userId, u)));
    const have = new Set(existing.map((e) => e.userId));
    const add = u.filter((x) => !have.has(x));
    if (add.length)
      await db.insert(trainingRecords).values(
        add.map((userId) => ({ courseId, userId, completedAt, recordedById: by, sessionId: extra.sessionId ?? null, score: extra.score ?? null, passed: extra.passed ?? true, note: extra.note ?? null })),
      );
    return add.length;
  }

  async function assertUsers(ids: string[]) {
    if (!ids.length) return;
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
    if (found.length !== new Set(ids).size) throw new HTTPException(400, { message: "Neznámý uživatel" });
  }

  async function setParticipants(sessionId: string, ids?: string[]) {
    if (!ids) return;
    await assertUsers(ids);
    await db.delete(trainingSessionParticipants).where(eq(trainingSessionParticipants.sessionId, sessionId));
    const u = [...new Set(ids)];
    if (u.length) await db.insert(trainingSessionParticipants).values(u.map((userId) => ({ sessionId, userId })));
  }

  /** Proběhlý termín → absolvování účastníků (§ 10 odst. 5). */
  async function syncSession(courseId: string, sessionId: string, by: string) {
    const [s] = await db.select().from(trainingSessions).where(eq(trainingSessions.id, sessionId));
    if (!s || s.status !== "held") return;
    const ps = await db.select({ u: trainingSessionParticipants.userId }).from(trainingSessionParticipants).where(eq(trainingSessionParticipants.sessionId, sessionId));
    await record(courseId, ps.map((p) => p.u), s.date, by, { sessionId });
  }

  async function mine(userId: string): Promise<MyTrainingItem[]> {
    const list = await loadCourses(db, eq(trainingCourses.active, true));
    const out: MyTrainingItem[] = [];
    for (const x of list) {
      const p = x.people.find((y) => y.userId === userId);
      if (!p) continue;
      out.push({ courseId: x.row.id, code: x.row.code, title: x.row.title, kind: x.row.kind, form: x.row.form, lastCompleted: p.lastCompleted, validUntil: p.validUntil, state: p.state, nextSession: x.item.nextSession });
    }
    const order: Record<TrainingState, number> = { overdue: 0, missing: 1, due_soon: 2, ok: 3 };
    return out.sort((a, b) => order[a.state] - order[b.state]);
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "awareness"))
      .get("/", requirePerm("awareness:read"), async (c) => c.json((await loadCourses(db, inScope(c, trainingCourses.companyId))).map((x) => x.item)))
      .get("/mine", requirePerm("obligations:self"), async (c) => c.json(await mine(currentUser(c).id)))

      /** Přehled poučení a školení se seznamem osob (§ 10 odst. 5). */
      .get(
        "/log",
        requirePerm("awareness:read"),
        zValidator("query", z.object({ from: z.string().date().optional(), to: z.string().date().optional() })),
        async (c) => {
          const { from, to } = c.req.valid("query");
          const rows = await db
            .select({ r: trainingRecords, title: trainingCourses.title, kind: trainingCourses.kind, name: users.displayName })
            .from(trainingRecords)
            .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
            .innerJoin(users, eq(users.id, trainingRecords.userId))
            .where(and(inScope(c, trainingCourses.companyId), from ? gte(trainingRecords.completedAt, from) : undefined, to ? lte(trainingRecords.completedAt, to) : undefined))
            .orderBy(desc(trainingRecords.completedAt), asc(trainingCourses.title), asc(users.displayName))
            .limit(5000);
          const out: TrainingLogRow[] = rows.map((x) => ({ date: x.r.completedAt, courseId: x.r.courseId, courseTitle: x.title, kind: x.kind, userName: x.name, passed: x.r.passed, score: x.r.score }));
          return c.json(out);
        },
      )

      .post("/", requirePerm("awareness:write"), zValidator("json", CourseInput), async (c) => {
        const { companyId: requested, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "awareness:write");
        const [x] = await db.insert(trainingCourses).values({ ...input, companyId }).returning();
        await audit(db, { c, user: currentUser(c), action: "training.course_created", entityType: "training_course", entityId: x!.id, details: { title: x!.title } });
        return c.json(await detail(c, x!.id), 201);
      })
      .get("/:id", requirePerm("awareness:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/:id", requirePerm("awareness:write"), zValidator("json", CoursePatch), async (c) => {
        const id = c.req.param("id");
        await row(c, id);
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<CourseRow>;
        if (Object.keys(input).length) await db.update(trainingCourses).set({ ...input, updatedAt: new Date() }).where(eq(trainingCourses.id, id));
        await audit(db, { c, user: currentUser(c), action: "training.course_updated", entityType: "training_course", entityId: id, details: input });
        return c.json(await detail(c, id));
      })
      .delete("/:id", requirePerm("awareness:write"), async (c) => {
        const id = c.req.param("id");
        const x = await row(c, id);
        const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(trainingRecords).where(eq(trainingRecords.courseId, id));
        if (n!.n > 0) throw new HTTPException(409, { message: "Školení má záznamy o absolvování (§ 10 odst. 5) – nelze smazat, deaktivujte ho." });
        await db.delete(trainingCourses).where(eq(trainingCourses.id, id));
        await audit(db, { c, user: currentUser(c), action: "training.course_deleted", entityType: "training_course", entityId: id, details: { title: x.title } });
        return c.body(null, 204);
      })

      /* ---------- termíny ---------- */
      .post("/:id/sessions", requirePerm("awareness:write"), zValidator("json", SessionInput), async (c) => {
        const id = c.req.param("id");
        await row(c, id);
        const { participantIds, ...input } = c.req.valid("json");
        const [s] = await db.insert(trainingSessions).values({ ...input, courseId: id }).returning();
        await setParticipants(s!.id, participantIds);
        await syncSession(id, s!.id, currentUser(c).id);
        await audit(db, { c, user: currentUser(c), action: "training.session_saved", entityType: "training_course", entityId: id, details: { date: s!.date, status: s!.status, participants: participantIds.length } });
        return c.json(await detail(c, id), 201);
      })
      .get("/:id/sessions/:sid", requirePerm("awareness:read"), async (c) => {
        const { id, sid } = c.req.param();
        await row(c, id);
        const [s] = await db.select().from(trainingSessions).where(and(eq(trainingSessions.id, sid), eq(trainingSessions.courseId, id)));
        if (!s) throw new HTTPException(404, { message: "Termín nenalezen" });
        const ps = await db.select({ u: trainingSessionParticipants.userId }).from(trainingSessionParticipants).where(eq(trainingSessionParticipants.sessionId, sid));
        return c.json({ ...s, participantIds: ps.map((p) => p.u) });
      })
      .patch("/:id/sessions/:sid", requirePerm("awareness:write"), zValidator("json", SessionPatch), async (c) => {
        const { id, sid } = c.req.param();
        await row(c, id);
        const { participantIds, ...rest } = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
        const [s] = await db.update(trainingSessions).set({ ...input, updatedAt: new Date() }).where(and(eq(trainingSessions.id, sid), eq(trainingSessions.courseId, id))).returning();
        if (!s) throw new HTTPException(404, { message: "Termín nenalezen" });
        await setParticipants(sid, participantIds);
        await syncSession(id, sid, currentUser(c).id);
        await audit(db, { c, user: currentUser(c), action: "training.session_saved", entityType: "training_course", entityId: id, details: { date: s.date, status: s.status } });
        return c.json(await detail(c, id));
      })
      .delete("/:id/sessions/:sid", requirePerm("awareness:write"), async (c) => {
        const { id, sid } = c.req.param();
        await row(c, id);
        await db.delete(trainingSessions).where(and(eq(trainingSessions.id, sid), eq(trainingSessions.courseId, id)));
        return c.json(await detail(c, id));
      })

      /* ---------- absolvování (ruční zápis, import z e-learningu) ---------- */
      .post("/:id/records", requirePerm("awareness:write"), zValidator("json", RecordInput), async (c) => {
        const id = c.req.param("id");
        await row(c, id);
        const { userIds, completedAt, ...extra } = c.req.valid("json");
        await assertUsers(userIds);
        const n = await record(id, userIds, completedAt, currentUser(c).id, extra);
        await audit(db, { c, user: currentUser(c), action: "training.recorded", entityType: "training_course", entityId: id, details: { completedAt, users: n } });
        return c.json(await detail(c, id), 201);
      })
      .get("/:id/records", requirePerm("awareness:read"), async (c) => {
        const id = c.req.param("id");
        await row(c, id);
        const rows = await db
          .select({ r: trainingRecords, name: users.displayName })
          .from(trainingRecords)
          .innerJoin(users, eq(users.id, trainingRecords.userId))
          .where(eq(trainingRecords.courseId, id))
          .orderBy(desc(trainingRecords.completedAt), asc(users.displayName));
        return c.json(rows.map(({ r, name }) => ({ id: r.id, userId: r.userId, name, completedAt: r.completedAt, passed: r.passed, score: r.score, note: r.note, sessionId: r.sessionId })));
      })
      .delete("/:id/records/:rid", requirePerm("awareness:write"), async (c) => {
        const { id, rid } = c.req.param();
        await row(c, id);
        await db.delete(trainingRecords).where(and(eq(trainingRecords.id, rid), eq(trainingRecords.courseId, id)));
        await audit(db, { c, user: currentUser(c), action: "training.record_deleted", entityType: "training_course", entityId: id, details: { recordId: rid } });
        return c.json(await detail(c, id));
      })
  );
}
