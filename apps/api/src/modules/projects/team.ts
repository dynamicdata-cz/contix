import {
  issueScore,
  suggestRag,
  type BudgetState,
  type ChangeRequestDto,
  type IssueKind,
  type LessonDto,
  type MilestoneDto,
  type ProjectIssueDto,
  type ProjectMemberDto,
  type ProjectPortfolioInfo,
  type ProjectPriority,
  type ProjectTaskDto,
  type Rag,
  type StatusReportDto,
} from "@contix/shared";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Db } from "../../db/client";
import { projectChanges, projectIssues, projectLessons, projectMembers, projectMilestones, projectPhases, projectStatusReports, projectTasks, projects, users } from "../../db/schema";

/* ============================================================
 * Projekty III (v1.35, ADR-132): tým (RACI), úkoly (Kanban), milníky, rizika a problémy, hlášení stavu (RAG),
 * žádosti o změnu (schvaluje sponzor), poučení. Souhrny pro portfolio se počítají při čtení.
 * ============================================================ */

type ProjectRow = typeof projects.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

async function nameMap(db: Db, ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  return new Map((u.length ? await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, u)) : []).map((x) => [x.id, x.n]));
}

/** Souhrny pro portfolio – hromadně pro všechny projekty (bez dotazů v cyklu). */
export async function portfolioInfo(
  db: Db,
  rows: ProjectRow[],
  base: Map<string, { budgetState: BudgetState; overdue: boolean; overduePhases: number; gateReady: boolean }>,
): Promise<Map<string, ProjectPortfolioInfo>> {
  const ids = rows.map((r) => r.id);
  const out = new Map<string, ProjectPortfolioInfo>();
  if (!ids.length) return out;
  const d = today();
  const [tasks, issues, ms, reports, changes] = await Promise.all([
    db.select({ p: projectTasks.projectId, status: projectTasks.status, due: projectTasks.dueDate }).from(projectTasks).where(inArray(projectTasks.projectId, ids)),
    db.select({ p: projectIssues.projectId, kind: projectIssues.kind, prob: projectIssues.probability, impact: projectIssues.impact, status: projectIssues.status }).from(projectIssues).where(and(inArray(projectIssues.projectId, ids), ne(projectIssues.status, "closed"))),
    db.select({ p: projectMilestones.projectId, name: projectMilestones.name, due: projectMilestones.dueDate }).from(projectMilestones).where(and(inArray(projectMilestones.projectId, ids), isNull(projectMilestones.doneAt))).orderBy(asc(projectMilestones.dueDate)),
    db.select({ p: projectStatusReports.projectId, overall: projectStatusReports.overall, date: projectStatusReports.date }).from(projectStatusReports).where(inArray(projectStatusReports.projectId, ids)).orderBy(desc(projectStatusReports.date), desc(projectStatusReports.createdAt)),
    db.select({ p: projectChanges.projectId }).from(projectChanges).where(and(inArray(projectChanges.projectId, ids), eq(projectChanges.status, "submitted"))),
  ]);
  for (const r of rows) {
    const t = tasks.filter((x) => x.p === r.id);
    const open = t.filter((x) => x.status !== "done");
    const iss = issues.filter((x) => x.p === r.id);
    const high = iss.filter((x) => issueScore(x.kind as IssueKind, x.prob as ProjectPriority | null, x.impact as ProjectPriority).level === "high").length;
    const m = ms.filter((x) => x.p === r.id);
    const rep = reports.find((x) => x.p === r.id);
    const b = base.get(r.id)!;
    const pending = changes.filter((x) => x.p === r.id).length;
    const sug = suggestRag({
      overduePhases: b.overduePhases,
      overdueMilestones: m.filter((x) => x.due < d).length,
      overdueTasks: open.filter((x) => x.due && x.due < d).length,
      blockedTasks: open.filter((x) => x.status === "blocked").length,
      budgetState: b.budgetState,
      highIssues: high,
      pendingChanges: pending,
      projectOverdue: b.overdue,
    });
    out.set(r.id, {
      rag: (rep?.overall as Rag) ?? null,
      ragDate: rep?.date ?? null,
      suggestedRag: sug.overall,
      tasks: { open: open.length, overdue: open.filter((x) => x.due && x.due < d).length, blocked: open.filter((x) => x.status === "blocked").length, done: t.length - open.length },
      issues: { open: iss.length, high },
      nextMilestone: m[0] ? { name: m[0].name, dueDate: m[0].due } : null,
      pendingChanges: pending,
      gateReady: b.gateReady,
    });
  }
  return out;
}

/** Rozšíření detailu projektu o tým, úkoly, milníky, rizika, hlášení, změny a poučení. */
export async function teamDetail(db: Db, p: ProjectRow, me: string, o: { canEdit: boolean; canDecide: boolean; budgetState: BudgetState; overdue: boolean; overduePhases: number }) {
  const d = today();
  const [members, tasks, milestones, issues, reports, changes, lessons, phases] = await Promise.all([
    db.select().from(projectMembers).where(eq(projectMembers.projectId, p.id)),
    db.select().from(projectTasks).where(eq(projectTasks.projectId, p.id)).orderBy(asc(projectTasks.order), asc(projectTasks.createdAt)),
    db.select().from(projectMilestones).where(eq(projectMilestones.projectId, p.id)).orderBy(asc(projectMilestones.dueDate)),
    db.select().from(projectIssues).where(eq(projectIssues.projectId, p.id)).orderBy(desc(projectIssues.createdAt)),
    db.select().from(projectStatusReports).where(eq(projectStatusReports.projectId, p.id)).orderBy(desc(projectStatusReports.date), desc(projectStatusReports.createdAt)),
    db.select().from(projectChanges).where(eq(projectChanges.projectId, p.id)).orderBy(desc(projectChanges.number)),
    db.select().from(projectLessons).where(eq(projectLessons.projectId, p.id)).orderBy(asc(projectLessons.createdAt)),
    db.select({ id: projectPhases.id, name: projectPhases.name }).from(projectPhases).where(eq(projectPhases.projectId, p.id)),
  ]);
  const nm = await nameMap(db, [
    ...members.map((x) => x.userId),
    ...tasks.map((x) => x.assigneeId),
    ...issues.map((x) => x.ownerId),
    ...reports.map((x) => x.createdById),
    ...changes.flatMap((x) => [x.requestedById, x.decidedById]),
    ...lessons.map((x) => x.createdById),
  ]);
  const n = (id: string | null) => (id ? (nm.get(id) ?? null) : null);
  const phaseName = (id: string | null) => phases.find((x) => x.id === id)?.name ?? null;
  const taskDtos = tasks.map(
    (x): ProjectTaskDto => ({
      id: x.id,
      title: x.title,
      description: x.description,
      phaseId: x.phaseId,
      phaseName: phaseName(x.phaseId),
      assigneeId: x.assigneeId,
      assigneeName: n(x.assigneeId),
      dueDate: x.dueDate,
      priority: x.priority as ProjectPriority,
      status: x.status as ProjectTaskDto["status"],
      order: x.order,
      overdue: x.status !== "done" && !!x.dueDate && x.dueDate < d,
      doneAt: x.doneAt?.toISOString() ?? null,
      canMove: o.canEdit || (x.assigneeId === me && p.status === "active"),
    }),
  );
  const issueDtos = issues.map((x): ProjectIssueDto => {
    const s = issueScore(x.kind as IssueKind, x.probability as ProjectPriority | null, x.impact as ProjectPriority);
    return {
      id: x.id,
      kind: x.kind as IssueKind,
      title: x.title,
      description: x.description,
      probability: x.probability as ProjectPriority | null,
      impact: x.impact as ProjectPriority,
      score: s.score,
      level: s.level,
      ownerId: x.ownerId,
      ownerName: n(x.ownerId),
      status: x.status as ProjectIssueDto["status"],
      response: x.response,
      dueDate: x.dueDate,
      overdue: x.status !== "closed" && !!x.dueDate && x.dueDate < d,
    };
  });
  const msDtos = milestones.map((x): MilestoneDto => ({ id: x.id, name: x.name, dueDate: x.dueDate, phaseId: x.phaseId, doneAt: x.doneAt?.toISOString() ?? null, overdue: !x.doneAt && x.dueDate < d }));
  const open = taskDtos.filter((x) => x.status !== "done");
  const pending = changes.filter((x) => x.status === "submitted").length;
  return {
    members: members.map((x): ProjectMemberDto => ({ id: x.id, userId: x.userId, name: n(x.userId) ?? "—", role: x.role, raci: x.raci as ProjectMemberDto["raci"] })).sort((a, b) => "RACI".indexOf(a.raci) - "RACI".indexOf(b.raci) || a.name.localeCompare(b.name)),
    tasks: taskDtos,
    milestones: msDtos,
    issues: issueDtos.sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || b.score - a.score),
    reports: reports.map(
      (x): StatusReportDto => ({
        id: x.id,
        date: x.date,
        overall: x.overall as Rag,
        schedule: x.schedule as Rag,
        budget: x.budget as Rag,
        scope: x.scope as Rag,
        summary: x.summary,
        achievements: x.achievements,
        nextSteps: x.nextSteps,
        createdByName: n(x.createdById),
      }),
    ),
    changes: changes.map(
      (x): ChangeRequestDto => ({
        id: x.id,
        number: x.number,
        title: x.title,
        description: x.description,
        newEndDate: x.newEndDate,
        oldEndDate: x.oldEndDate,
        budgetDelta: x.budgetDelta === null ? null : Number(x.budgetDelta),
        scope: x.scope,
        status: x.status as ChangeRequestDto["status"],
        requestedByName: n(x.requestedById),
        createdAt: x.createdAt.toISOString(),
        decidedByName: n(x.decidedById),
        decidedAt: x.decidedAt?.toISOString() ?? null,
        comment: x.comment,
        canDecide: x.status === "submitted" && o.canDecide && x.requestedById !== me,
      }),
    ),
    lessons: lessons.map((x): LessonDto => ({ id: x.id, kind: x.kind as LessonDto["kind"], text: x.text, createdByName: n(x.createdById), createdAt: x.createdAt.toISOString() })),
    suggested: suggestRag({
      overduePhases: o.overduePhases,
      overdueMilestones: msDtos.filter((x) => x.overdue).length,
      overdueTasks: open.filter((x) => x.overdue).length,
      blockedTasks: open.filter((x) => x.status === "blocked").length,
      budgetState: o.budgetState,
      highIssues: issueDtos.filter((x) => x.status !== "closed" && x.level === "high").length,
      pendingChanges: pending,
      projectOverdue: o.overdue,
    }),
  };
}

/** Úkoly a žádosti o změnu pro Moje práce: řešitel úkolu (s termínem), sponzor u změny ke schválení. */
export async function projectWorkItems(db: Db, userId: string) {
  const tasks = await db
    .select({ t: projectTasks, p: projects })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(and(eq(projectTasks.assigneeId, userId), ne(projectTasks.status, "done"), eq(projects.status, "active")));
  const changes = await db
    .select({ ch: projectChanges, p: projects })
    .from(projectChanges)
    .innerJoin(projects, eq(projects.id, projectChanges.projectId))
    .where(and(eq(projectChanges.status, "submitted"), eq(projects.sponsorId, userId), eq(projects.status, "active")));
  return {
    tasks: tasks.map((x) => ({ id: x.t.id, projectId: x.p.id, companyId: x.p.companyId, project: x.p.name, title: x.t.title, due: x.t.dueDate, blocked: x.t.status === "blocked" })),
    changes: changes.filter((x) => x.ch.requestedById !== userId).map((x) => ({ id: x.ch.id, projectId: x.p.id, companyId: x.p.companyId, project: x.p.name, title: x.ch.title, number: x.ch.number, created: x.ch.createdAt })),
  };
}
