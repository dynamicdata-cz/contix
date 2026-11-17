import {
  DocReqInput,
  DocReqUpdate,
  GateDecisionInput,
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_PREFIX,
  ProjectCostInput,
  ProjectTemplateInput,
  budgetState,
  CraLinksInput,
  type CraLinksDto,
  type ProjectCostDto,
  type ProjectTemplate,
  type ProjectTemplateDto,
  PhasePatch,
  ProjectInput,
  ProjectPatch,
  gateBlockers,
  type DocReqDto,
  type DocReqStatus,
  type PhaseDto,
  type ProjectDetailDto,
  type ProjectDto,
  ChangeDecisionInput,
  ChangeRequestInput,
  LessonInput,
  MilestoneInput,
  ProjectIssueInput,
  ProjectMemberInput,
  ProjectTaskInput,
  ProjectTaskPatch,
  StatusReportInput,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  assets,
  processes,
  projectAssets,
  projectChanges,
  projectCosts,
  projectDocs,
  projectIssues,
  projectLessons,
  projectMembers,
  projectMilestones,
  projectPhases,
  projectProcesses,
  projectRisks,
  projectStatusReports,
  projectSuppliers,
  projectTasks,
  projectTemplates,
  projects,
  risks,
  suppliers,
  users,
} from "../../db/schema";
import { assetVisible } from "../assets/routes";
import { safeFilename } from "../assurance/routes";
import { mimeFor } from "../policies/mime";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { projectReportHtml } from "./report";
import { portfolioInfo, teamDetail } from "./team";

/* ============================================================
 * Projekty s fázemi a branami (v1.31, ADR-128).
 * Fáze se zakládají ze šablony; dokument schvaluje jiný uživatel než ten, kdo ho předložil; bránu schvaluje sponzor
 * (bez sponzora uživatel s projects:write, nikdy manažer projektu) a jen bez blokujících povinných dokumentů.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type ProjectRow = typeof projects.$inferSelect;
const MAX_FILE = 25 * 1024 * 1024;
const todayIso = () => new Date().toISOString().slice(0, 10);

async function names(db: Db, ids: (string | null | undefined)[]) {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  return new Map((u.length ? await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, u)) : []).map((x) => [x.id, x.n]));
}

/** Přehled projektů s postupem (fáze, dokumenty). */
export async function projectDtos(db: Db, rows: ProjectRow[]): Promise<ProjectDto[]> {
  if (!rows.length) return [];
  const phases = await db.select().from(projectPhases).where(inArray(projectPhases.projectId, rows.map((r) => r.id))).orderBy(asc(projectPhases.order));
  const docs = phases.length ? await db.select({ phaseId: projectDocs.phaseId, status: projectDocs.status, required: projectDocs.required }).from(projectDocs).where(inArray(projectDocs.phaseId, phases.map((p) => p.id))) : [];
  const nm = await names(db, rows.flatMap((r) => [r.managerId, r.sponsorId]));
  const spentRows = await db.select({ id: projectCosts.projectId, s: sql<string>`sum(${projectCosts.amount})` }).from(projectCosts).where(inArray(projectCosts.projectId, rows.map((r) => r.id))).groupBy(projectCosts.projectId);
  const customIds = rows.map((r) => r.templateKey).filter((k) => k.startsWith(PROJECT_TEMPLATE_PREFIX)).map((k) => k.slice(PROJECT_TEMPLATE_PREFIX.length));
  const customNames = new Map((customIds.length ? await db.select({ id: projectTemplates.id, n: projectTemplates.name }).from(projectTemplates).where(inArray(projectTemplates.id, customIds)) : []).map((x) => [`${PROJECT_TEMPLATE_PREFIX}${x.id}`, x.n]));
  const today = todayIso();
  const base = new Map(
    rows.map((r) => {
      const spent = Number(spentRows.find((x) => x.id === r.id)?.s ?? 0);
      const ph = phases.filter((p) => p.projectId === r.id);
      const cur = ph.find((p) => p.status === "active");
      const overduePhases = ph.filter((p) => p.status === "active" && p.plannedEnd && p.plannedEnd < today).length;
      const gateReady = !!cur && !docs.some((x) => x.phaseId === cur.id && x.required && x.status !== "approved" && x.status !== "na");
      const bs = budgetState(r.budget === null ? null : Number(r.budget), spent);
      return [r.id, { budgetState: bs, overdue: r.status === "active" && !!r.endDate && r.endDate < today, overduePhases, gateReady }] as const;
    }),
  );
  const info = await portfolioInfo(db, rows, base);
  return rows.map((r) => {
    const spent = Number(spentRows.find((x) => x.id === r.id)?.s ?? 0);
    const budget = r.budget === null ? null : Number(r.budget);
    const ph = phases.filter((p) => p.projectId === r.id);
    const cur = ph.find((p) => p.status === "active");
    const d = docs.filter((x) => ph.some((p) => p.id === x.phaseId));
    return {
      id: r.id,
      companyId: r.companyId,
      code: r.code,
      name: r.name,
      description: r.description,
      templateKey: r.templateKey,
      templateName: PROJECT_TEMPLATES.find((t) => t.key === r.templateKey)?.name ?? customNames.get(r.templateKey) ?? "Vlastní šablona",
      status: r.status as ProjectDto["status"],
      managerId: r.managerId,
      managerName: r.managerId ? (nm.get(r.managerId) ?? null) : null,
      sponsorId: r.sponsorId,
      sponsorName: r.sponsorId ? (nm.get(r.sponsorId) ?? null) : null,
      startDate: r.startDate,
      endDate: r.endDate,
      currentPhase: cur?.name ?? null,
      progress: { phases: ph.length, approved: ph.filter((p) => p.status === "approved").length, docs: d.length, docsDone: d.filter((x) => x.status === "approved" || x.status === "na").length },
      budget,
      spent,
      budgetState: budgetState(budget, spent),
      overdue: r.status === "active" && ((!!cur?.plannedEnd && cur.plannedEnd < today) || (!!r.endDate && r.endDate < today)),
      createdAt: r.createdAt.toISOString(),
      info: info.get(r.id)!,
    };
  });
}

/** Brány po termínu nebo k rozhodnutí – pro Moje práce (manažer: termín fáze; sponzor: brána připravená ke schválení). */
export async function projectGateItems(db: Db, userId: string) {
  const rows = await db
    .select({ p: projects, ph: projectPhases })
    .from(projects)
    .innerJoin(projectPhases, and(eq(projectPhases.projectId, projects.id), eq(projectPhases.status, "active")))
    .where(and(eq(projects.status, "active"), or(eq(projects.managerId, userId), eq(projects.sponsorId, userId))));
  const out: { projectId: string; companyId: string; name: string; phase: string; due: string | null; ready: boolean; role: "manager" | "sponsor" }[] = [];
  for (const x of rows) {
    const docs = await db.select({ name: projectDocs.name, required: projectDocs.required, status: projectDocs.status }).from(projectDocs).where(eq(projectDocs.phaseId, x.ph.id));
    const ready = gateBlockers(docs.map((d) => ({ ...d, status: d.status as DocReqStatus }))).length === 0;
    if (x.p.sponsorId === userId && ready) out.push({ projectId: x.p.id, companyId: x.p.companyId, name: x.p.name, phase: x.ph.name, due: x.ph.plannedEnd, ready, role: "sponsor" });
    else if (x.p.managerId === userId && x.ph.plannedEnd) out.push({ projectId: x.p.id, companyId: x.p.companyId, name: x.p.name, phase: x.ph.name, due: x.ph.plannedEnd, ready, role: "manager" });
  }
  return out;
}

export function projectRoutes(db: Db) {
  async function linksOf(projectId: string): Promise<CraLinksDto> {
    const code = (c: string | null, n: string) => (c ? `${c} ${n}` : n);
    const [a, s, pr, r] = await Promise.all([
      db.select({ id: assets.id, name: assets.name, assetType: assets.assetType, healthStatus: assets.healthStatus }).from(projectAssets).innerJoin(assets, eq(assets.id, projectAssets.targetId)).where(eq(projectAssets.projectId, projectId)).orderBy(asc(assets.name)),
      db.select({ id: suppliers.id, name: suppliers.name }).from(projectSuppliers).innerJoin(suppliers, eq(suppliers.id, projectSuppliers.targetId)).where(eq(projectSuppliers.projectId, projectId)).orderBy(asc(suppliers.name)),
      db.select({ id: processes.id, code: processes.code, name: processes.name }).from(projectProcesses).innerJoin(processes, eq(processes.id, projectProcesses.targetId)).where(eq(projectProcesses.projectId, projectId)).orderBy(asc(processes.name)),
      db.select({ id: risks.id, code: risks.code, name: risks.name }).from(projectRisks).innerJoin(risks, eq(risks.id, projectRisks.targetId)).where(eq(projectRisks.projectId, projectId)).orderBy(asc(risks.name)),
    ]);
    return { assets: a, suppliers: s, processes: pr.map((x) => ({ id: x.id, label: code(x.code, x.name) })), risks: r.map((x) => ({ id: x.id, label: code(x.code, x.name) })) };
  }
  const load = async (c: Ctx, id: string) => {
    const [p] = await db.select().from(projects).where(eq(projects.id, id));
    assertScope(c, p?.companyId, "Projekt nenalezen");
    return p!;
  };
  const canEdit = (c: Ctx, p: ProjectRow) => hasPermIn(c, "projects:write", p.companyId) && p.status !== "closed" && p.status !== "cancelled";
  const assertEditable = (c: Ctx, p: ProjectRow) => {
    if (!canEdit(c, p)) throw new HTTPException(p.status === "closed" || p.status === "cancelled" ? 409 : 403, { message: p.status === "closed" || p.status === "cancelled" ? "Projekt je uzavřený" : "Nedostatečná oprávnění" });
  };
  const editable = async (c: Ctx, id: string) => {
    const p = await load(c, id);
    assertEditable(c, p);
    return p;
  };
  /** Bránu schvaluje sponzor; bez sponzora kdokoli s projects:write kromě manažera projektu. */
  const canApproveGate = (c: Ctx, p: ProjectRow) => {
    const me = currentUser(c).id;
    if (p.status !== "active") return false;
    // sponzor (typicky vedení) stačí se čtením projektů; bez sponzora rozhoduje kdokoli s projects:write kromě manažera
    if (p.sponsorId) return p.sponsorId === me;
    return hasPermIn(c, "projects:write", p.companyId) && p.managerId !== me;
  };
  const loadDoc = async (c: Ctx, projectId: string, docId: string) => {
    const p = await load(c, projectId);
    const [d] = await db.select({ d: projectDocs, ph: projectPhases }).from(projectDocs).innerJoin(projectPhases, eq(projectPhases.id, projectDocs.phaseId)).where(and(eq(projectDocs.id, docId), eq(projectPhases.projectId, p.id)));
    if (!d) throw new HTTPException(404, { message: "Dokument nenalezen" });
    return { p, d: d.d, ph: d.ph };
  };

  async function detail(c: Ctx, p: ProjectRow): Promise<ProjectDetailDto> {
    const [base] = await projectDtos(db, [p]);
    const phases = await db.select().from(projectPhases).where(eq(projectPhases.projectId, p.id)).orderBy(asc(projectPhases.order));
    const docs = phases.length
      ? await db
          .select({ id: projectDocs.id, phaseId: projectDocs.phaseId, name: projectDocs.name, required: projectDocs.required, security: projectDocs.security, status: projectDocs.status, note: projectDocs.note, url: projectDocs.url, fileName: projectDocs.fileName, fileSize: projectDocs.fileSize, updatedById: projectDocs.updatedById, updatedAt: projectDocs.updatedAt, submittedById: projectDocs.submittedById })
          .from(projectDocs)
          .where(inArray(projectDocs.phaseId, phases.map((x) => x.id)))
          .orderBy(asc(projectDocs.name))
      : [];
    const nm = await names(db, [...docs.map((d) => d.updatedById), ...phases.map((x) => x.approvedById)]);
    const me = currentUser(c).id;
    const today = todayIso();
    const costRows = await db
      .select({ c: projectCosts, phaseName: projectPhases.name, supplierName: suppliers.name, by: users.displayName })
      .from(projectCosts)
      .leftJoin(projectPhases, eq(projectPhases.id, projectCosts.phaseId))
      .leftJoin(suppliers, eq(suppliers.id, projectCosts.supplierId))
      .leftJoin(users, eq(users.id, projectCosts.createdById))
      .where(eq(projectCosts.projectId, p.id))
      .orderBy(desc(projectCosts.date), desc(projectCosts.createdAt));
    const extras = await teamDetail(db, p, me, {
      canEdit: canEdit(c, p),
      canDecide: canApproveGate(c, p),
      budgetState: base!.budgetState,
      overdue: p.status === "active" && !!p.endDate && p.endDate < today,
      overduePhases: phases.filter((x) => x.status === "active" && x.plannedEnd && x.plannedEnd < today).length,
    });
    return {
      ...base!,
      ...extras,
      canReport: canEdit(c, p),
      costs: costRows.map(
        (x): ProjectCostDto => ({ id: x.c.id, date: x.c.date, description: x.c.description, amount: Number(x.c.amount), phaseId: x.c.phaseId, phaseName: x.phaseName, supplierId: x.c.supplierId, supplierName: x.supplierName, createdByName: x.by }),
      ),
      canEdit: canEdit(c, p),
      canApproveGate: canApproveGate(c, p),
      phases: phases.map((ph): PhaseDto => {
        const ds = docs
          .filter((d) => d.phaseId === ph.id)
          .map(
            (d): DocReqDto => ({
              id: d.id,
              name: d.name,
              required: d.required,
              security: d.security,
              status: d.status as DocReqStatus,
              note: d.note,
              url: d.url,
              fileName: d.fileName,
              fileSize: d.fileSize,
              updatedByName: d.updatedById ? (nm.get(d.updatedById) ?? null) : null,
              updatedAt: d.updatedAt?.toISOString() ?? null,
              canReview: d.status === "submitted" && d.submittedById !== me && canEdit(c, p),
            }),
          );
        return {
          id: ph.id,
          order: ph.order,
          name: ph.name,
          status: ph.status as PhaseDto["status"],
          plannedStart: ph.plannedStart,
          plannedEnd: ph.plannedEnd,
          approvedByName: ph.approvedById ? (nm.get(ph.approvedById) ?? null) : null,
          approvedAt: ph.approvedAt?.toISOString() ?? null,
          gateComment: ph.gateComment,
          overdue: ph.status === "active" && !!ph.plannedEnd && ph.plannedEnd < today,
          docs: ds,
          blockers: gateBlockers(ds),
        };
      }),
    };
  }

  const phaseCheck = async (projectId: string, phaseId: string | null | undefined) => {
    if (!phaseId) return;
    const [ph] = await db.select({ id: projectPhases.id }).from(projectPhases).where(and(eq(projectPhases.id, phaseId), eq(projectPhases.projectId, projectId)));
    if (!ph) throw new HTTPException(400, { message: "Fáze nepatří k projektu" });
  };
  const userCheck = async (id: string | null) => {
    if (!id) return;
    const [u] = await db.select({ a: users.isActive }).from(users).where(eq(users.id, id));
    if (!u?.a) throw new HTTPException(400, { message: "Uživatel nenalezen" });
  };

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "projects"))
      .get("/templates", requirePerm("projects:read"), async (c) => {
        const custom = await db.select().from(projectTemplates).where(inScope(c, projectTemplates.companyId)).orderBy(asc(projectTemplates.name));
        const out: ProjectTemplateDto[] = [
          ...PROJECT_TEMPLATES.map((t) => ({ ...t, custom: false, id: null, companyId: null, active: true })),
          ...custom.map((t) => ({ key: `${PROJECT_TEMPLATE_PREFIX}${t.id}`, name: t.name, phases: t.phases.map((ph, i) => ({ key: `p${i + 1}`, ...ph })), custom: true, id: t.id, companyId: t.companyId, active: t.active })),
        ];
        return c.json(out);
      })
      .post("/templates", requirePerm("projects:write"), zValidator("json", ProjectTemplateInput), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "projects:write");
        const v = c.req.valid("json");
        const [t] = await db.insert(projectTemplates).values({ ...v, companyId, createdById: currentUser(c).id }).returning();
        await audit(db, { c, user: currentUser(c), action: "project.template_created", entityType: "project_template", entityId: t!.id, details: { name: v.name, phases: v.phases.length } });
        return c.json({ id: t!.id }, 201);
      })
      .put("/templates/:tid", requirePerm("projects:write"), zValidator("json", ProjectTemplateInput), async (c) => {
        const [t] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, c.req.param("tid")));
        assertScope(c, t?.companyId, "Šablona nenalezena");
        if (!hasPermIn(c, "projects:write", t!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const v = c.req.valid("json");
        await db.update(projectTemplates).set({ ...v, updatedAt: new Date() }).where(eq(projectTemplates.id, t!.id));
        await audit(db, { c, user: currentUser(c), action: "project.template_updated", entityType: "project_template", entityId: t!.id, details: { name: v.name, phases: v.phases.length, active: v.active } });
        return c.json({ ok: true });
      })
      .delete("/templates/:tid", requirePerm("projects:write"), async (c) => {
        const [t] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, c.req.param("tid")));
        assertScope(c, t?.companyId, "Šablona nenalezena");
        if (!hasPermIn(c, "projects:write", t!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const [used] = await db.select({ id: projects.id }).from(projects).where(eq(projects.templateKey, `${PROJECT_TEMPLATE_PREFIX}${t!.id}`)).limit(1);
        if (used) throw new HTTPException(409, { message: "Šablonu používá projekt – místo smazání ji vyřaďte" });
        await db.delete(projectTemplates).where(eq(projectTemplates.id, t!.id));
        await audit(db, { c, user: currentUser(c), action: "project.template_deleted", entityType: "project_template", entityId: t!.id, details: { name: t!.name } });
        return c.json({ ok: true });
      })
      .get("/", requirePerm("projects:read"), async (c) => {
        const rows = await db.select().from(projects).where(inScope(c, projects.companyId)).orderBy(desc(projects.createdAt));
        return c.json(await projectDtos(db, rows));
      })
      .post("/", requirePerm("projects:write"), zValidator("json", ProjectInput), async (c) => {
        const v = c.req.valid("json");
        if (v.managerId && v.sponsorId && v.managerId === v.sponsorId) throw new HTTPException(400, { message: "Sponzor a manažer projektu musí být různé osoby" });
        await userCheck(v.managerId);
        await userCheck(v.sponsorId);
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "projects:write");
        let tpl: ProjectTemplate | undefined = PROJECT_TEMPLATES.find((t) => t.key === v.templateKey);
        if (!tpl && v.templateKey.startsWith(PROJECT_TEMPLATE_PREFIX)) {
          const tid = v.templateKey.slice(PROJECT_TEMPLATE_PREFIX.length);
          const [ct] = /^[0-9a-f-]{36}$/i.test(tid) ? await db.select().from(projectTemplates).where(eq(projectTemplates.id, tid)) : [];
          // vlastní šablona musí patřit společnosti projektu a být aktivní
          if (ct && ct.companyId === companyId && ct.active) tpl = { key: v.templateKey, name: ct.name, phases: ct.phases.map((ph, i) => ({ key: `p${i + 1}`, ...ph })) };
        }
        if (!tpl) throw new HTTPException(400, { message: "Neznámá šablona projektu" });
        const me = currentUser(c);
        const p = await db.transaction(async (tx) => {
          const [p] = await tx.insert(projects).values({ ...v, budget: v.budget === null ? null : String(v.budget), companyId, createdById: me.id }).returning();
          for (const [i, ph] of tpl.phases.entries()) {
            const [row] = await tx.insert(projectPhases).values({ projectId: p!.id, order: i + 1, name: ph.name, status: i === 0 ? "active" : "planned" }).returning({ id: projectPhases.id });
            if (ph.docs.length) await tx.insert(projectDocs).values(ph.docs.map((d) => ({ phaseId: row!.id, name: d.name, required: d.required, security: !!d.security })));
          }
          return p!;
        });
        await audit(db, { c, user: me, action: "project.created", entityType: "project", entityId: p.id, details: { name: p.name, template: tpl.key } });
        return c.json(await detail(c, p), 201);
      })
      .get("/:id", requirePerm("projects:read"), async (c) => c.json(await detail(c, await load(c, c.req.param("id")))))
      .patch("/:id", requirePerm("projects:write"), zValidator("json", ProjectPatch), async (c) => {
        const p = await load(c, c.req.param("id"));
        if (!hasPermIn(c, "projects:write", p.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const v = c.req.valid("json");
        const managerId = v.managerId !== undefined ? v.managerId : p.managerId;
        const sponsorId = v.sponsorId !== undefined ? v.sponsorId : p.sponsorId;
        if (managerId && sponsorId && managerId === sponsorId) throw new HTTPException(400, { message: "Sponzor a manažer projektu musí být různé osoby" });
        if (v.managerId) await userCheck(v.managerId);
        if (v.sponsorId) await userCheck(v.sponsorId);
        if (v.status === "closed") {
          const open = await db.select({ id: projectPhases.id }).from(projectPhases).where(and(eq(projectPhases.projectId, p.id), inArray(projectPhases.status, ["planned", "active"])));
          if (open.length) throw new HTTPException(409, { message: "Projekt lze uzavřít až po schválení všech bran (jinak ho zrušte)" });
        }
        const { budget, ...rest } = v;
        await db
          .update(projects)
          .set({ ...rest, ...(budget !== undefined ? { budget: budget === null ? null : String(budget) } : {}), updatedAt: new Date() })
          .where(eq(projects.id, p.id));
        await audit(db, { c, user: currentUser(c), action: "project.updated", entityType: "project", entityId: p.id, details: v });
        return c.json(await detail(c, await load(c, p.id)));
      })
      .patch("/:id/phases/:phaseId", requirePerm("projects:write"), zValidator("json", PhasePatch), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [ph] = await db.select().from(projectPhases).where(and(eq(projectPhases.id, c.req.param("phaseId")), eq(projectPhases.projectId, p.id)));
        if (!ph) throw new HTTPException(404, { message: "Fáze nenalezena" });
        const v = c.req.valid("json");
        const start = v.plannedStart !== undefined ? v.plannedStart : ph.plannedStart;
        const end = v.plannedEnd !== undefined ? v.plannedEnd : ph.plannedEnd;
        if (start && end && start > end) throw new HTTPException(400, { message: "Začátek fáze musí být před jejím koncem" });
        await db.update(projectPhases).set(v).where(eq(projectPhases.id, ph.id));
        return c.json(await detail(c, p));
      })
      /* ---- rozpočet a náklady (v1.32) ---- */
      .post("/:id/costs", requirePerm("projects:write"), zValidator("json", ProjectCostInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const v = c.req.valid("json");
        if (v.phaseId) {
          const [ph] = await db.select({ id: projectPhases.id }).from(projectPhases).where(and(eq(projectPhases.id, v.phaseId), eq(projectPhases.projectId, p.id)));
          if (!ph) throw new HTTPException(400, { message: "Fáze nepatří k projektu" });
        }
        if (v.supplierId) {
          const [sp] = await db.select({ companyId: suppliers.companyId }).from(suppliers).where(eq(suppliers.id, v.supplierId));
          assertScope(c, sp?.companyId, "Dodavatel nenalezen");
        }
        await db.insert(projectCosts).values({ ...v, amount: String(v.amount), projectId: p.id, createdById: currentUser(c).id });
        await audit(db, { c, user: currentUser(c), action: "project.cost_added", entityType: "project", entityId: p.id, details: { description: v.description, amount: v.amount, date: v.date } });
        return c.json(await detail(c, p), 201);
      })
      .delete("/:id/costs/:cid", requirePerm("projects:write"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [x] = await db.delete(projectCosts).where(and(eq(projectCosts.id, c.req.param("cid")), eq(projectCosts.projectId, p.id))).returning();
        if (!x) throw new HTTPException(404, { message: "Náklad nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "project.cost_removed", entityType: "project", entityId: p.id, details: { description: x.description, amount: Number(x.amount) } });
        return c.json(await detail(c, p));
      })
      /* ---- vazby na aktiva, rizika, dodavatele, procesy (v1.32) ---- */
      .get("/:id/links", requirePerm("projects:read"), async (c) => c.json(await linksOf((await load(c, c.req.param("id"))).id)))
      .put("/:id/links", requirePerm("projects:write"), zValidator("json", CraLinksInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const v = c.req.valid("json");
        const ids = (x: string[]) => [...new Set(x)];
        const bad = () => new HTTPException(400, { message: "Neznámý navázaný záznam" });
        const aRows = v.assetIds.length ? await db.select({ id: assets.id, companyId: assets.companyId }).from(assets).where(inArray(assets.id, ids(v.assetIds))) : [];
        if (aRows.length !== ids(v.assetIds).length) throw bad();
        for (const a of aRows) if (!(await assetVisible(db, c, a))) throw bad();
        for (const [tbl, list] of [
          [suppliers, v.supplierIds],
          [processes, v.processIds],
          [risks, v.riskIds],
        ] as const) {
          if (!list.length) continue;
          const rows = await db.select({ id: tbl.id, companyId: tbl.companyId }).from(tbl).where(inArray(tbl.id, ids(list)));
          if (rows.length !== ids(list).length) throw bad();
          for (const r of rows) assertScope(c, r.companyId, "Navázaný záznam nenalezen");
        }
        await db.transaction(async (tx) => {
          for (const [t, list] of [
            [projectAssets, v.assetIds],
            [projectSuppliers, v.supplierIds],
            [projectProcesses, v.processIds],
            [projectRisks, v.riskIds],
          ] as const) {
            await tx.delete(t).where(eq(t.projectId, p.id));
            if (list.length) await tx.insert(t).values(ids(list).map((targetId) => ({ projectId: p.id, targetId })));
          }
        });
        await audit(db, { c, user: currentUser(c), action: "project.links_updated", entityType: "project", entityId: p.id, details: { assets: v.assetIds.length, suppliers: v.supplierIds.length, processes: v.processIds.length, risks: v.riskIds.length } });
        return c.json(await linksOf(p.id));
      })
      /** Brána: schválení aktuální fáze → další fáze (nebo konec projektu). */
      .post("/:id/phases/:phaseId/approve", requirePerm("projects:read"), zValidator("json", GateDecisionInput), async (c) => {
        const p = await load(c, c.req.param("id"));
        if (!canApproveGate(c, p)) throw new HTTPException(403, { message: p.sponsorId ? "Bránu schvaluje sponzor projektu" : "Manažer projektu nemůže schválit bránu vlastního projektu" });
        const [ph] = await db.select().from(projectPhases).where(and(eq(projectPhases.id, c.req.param("phaseId")), eq(projectPhases.projectId, p.id)));
        if (!ph) throw new HTTPException(404, { message: "Fáze nenalezena" });
        if (ph.status !== "active") throw new HTTPException(409, { message: "Schválit lze jen bránu aktuální fáze" });
        const docs = await db.select({ name: projectDocs.name, required: projectDocs.required, status: projectDocs.status }).from(projectDocs).where(eq(projectDocs.phaseId, ph.id));
        const blockers = gateBlockers(docs.map((d) => ({ ...d, status: d.status as DocReqStatus })));
        if (blockers.length) throw new HTTPException(409, { message: `Chybí schválené dokumenty: ${blockers.join(", ")}` });
        const me = currentUser(c);
        const comment = c.req.valid("json").comment;
        await db.transaction(async (tx) => {
          await tx.update(projectPhases).set({ status: "approved", approvedById: me.id, approvedAt: new Date(), gateComment: comment }).where(eq(projectPhases.id, ph.id));
          await tx.update(projectPhases).set({ status: "active" }).where(and(eq(projectPhases.projectId, p.id), eq(projectPhases.order, ph.order + 1)));
        });
        await audit(db, { c, user: me, action: "project.gate_approved", entityType: "project", entityId: p.id, details: { phase: ph.name, comment } });
        return c.json(await detail(c, p));
      })
      .post("/:id/phases/:phaseId/docs", requirePerm("projects:write"), zValidator("json", DocReqInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [ph] = await db.select().from(projectPhases).where(and(eq(projectPhases.id, c.req.param("phaseId")), eq(projectPhases.projectId, p.id)));
        if (!ph) throw new HTTPException(404, { message: "Fáze nenalezena" });
        if (ph.status === "approved") throw new HTTPException(409, { message: "Brána fáze je už schválená" });
        await db.insert(projectDocs).values({ phaseId: ph.id, ...c.req.valid("json") });
        return c.json(await detail(c, p), 201);
      })
      /** Stav dokumentu: předložení (submitted), schválení / vrácení (jiný uživatel než předkladatel), netýká se (s důvodem). */
      .patch("/:id/docs/:docId", requirePerm("projects:write"), zValidator("json", DocReqUpdate), async (c) => {
        const { p, d, ph } = await loadDoc(c, c.req.param("id"), c.req.param("docId"));
        assertEditable(c, p);
        if (ph.status === "approved") throw new HTTPException(409, { message: "Brána fáze je už schválená" });
        const v = c.req.valid("json");
        const me = currentUser(c);
        if ((v.status === "approved" || v.status === "rejected") && d.submittedById === me.id) throw new HTTPException(403, { message: "Dokument schvaluje jiný uživatel než ten, kdo ho předložil" });
        if ((v.status === "approved" || v.status === "rejected") && d.status !== "submitted") throw new HTTPException(409, { message: "Schválit nebo vrátit lze jen předložený dokument" });
        if (v.status === "submitted" && !d.fileName && !(v.url ?? d.url)) throw new HTTPException(400, { message: "Předložte soubor nebo odkaz na dokument" });
        if (v.status === "na" && !(v.note ?? d.note)) throw new HTTPException(400, { message: "Uveďte, proč se dokument netýká" });
        if (v.status === "rejected" && !v.note) throw new HTTPException(400, { message: "Uveďte důvod vrácení" });
        await db
          .update(projectDocs)
          .set({ ...v, ...(v.status === "submitted" ? { submittedById: me.id } : {}), updatedById: me.id, updatedAt: new Date() })
          .where(eq(projectDocs.id, d.id));
        await audit(db, { c, user: me, action: "project.doc_updated", entityType: "project", entityId: p.id, details: { doc: d.name, status: v.status, note: v.note } });
        return c.json(await detail(c, p));
      })
      .delete("/:id/docs/:docId", requirePerm("projects:write"), async (c) => {
        const { p, d, ph } = await loadDoc(c, c.req.param("id"), c.req.param("docId"));
        assertEditable(c, p);
        if (ph.status === "approved") throw new HTTPException(409, { message: "Brána fáze je už schválená" });
        if (d.required) throw new HTTPException(409, { message: "Povinný dokument nelze odebrat – označte ho jako „netýká se“ s důvodem" });
        await db.delete(projectDocs).where(eq(projectDocs.id, d.id));
        await audit(db, { c, user: currentUser(c), action: "project.doc_removed", entityType: "project", entityId: p.id, details: { doc: d.name } });
        return c.json(await detail(c, p));
      })
      /** Nahrání souboru = předložení ke schválení. */
      .post("/:id/docs/:docId/file", requirePerm("projects:write"), async (c) => {
        const { p, d, ph } = await loadDoc(c, c.req.param("id"), c.req.param("docId"));
        assertEditable(c, p);
        if (ph.status === "approved") throw new HTTPException(409, { message: "Brána fáze je už schválená" });
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        if (file.size > MAX_FILE) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 25 MB)" });
        const buf = Buffer.from(await file.arrayBuffer());
        const name = safeFilename(file.name);
        const me = currentUser(c);
        await db
          .update(projectDocs)
          .set({ fileName: name, fileMime: mimeFor(name), fileSize: buf.length, fileSha256: createHash("sha256").update(buf).digest("hex"), content: buf, status: "submitted", submittedById: me.id, updatedById: me.id, updatedAt: new Date() })
          .where(eq(projectDocs.id, d.id));
        await audit(db, { c, user: me, action: "project.doc_uploaded", entityType: "project", entityId: p.id, details: { doc: d.name, file: name, size: buf.length } });
        return c.json(await detail(c, p));
      })
      /* ---- tým (v1.35) ---- */
      .post("/:id/members", requirePerm("projects:write"), zValidator("json", ProjectMemberInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const v = c.req.valid("json");
        await userCheck(v.userId);
        await db.insert(projectMembers).values({ ...v, projectId: p.id }).onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: v.role, raci: v.raci } });
        await audit(db, { c, user: currentUser(c), action: "project.member_set", entityType: "project", entityId: p.id, details: v });
        return c.json(await detail(c, p), 201);
      })
      .delete("/:id/members/:mid", requirePerm("projects:write"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [x] = await db.delete(projectMembers).where(and(eq(projectMembers.id, c.req.param("mid")), eq(projectMembers.projectId, p.id))).returning();
        if (!x) throw new HTTPException(404, { message: "Člen týmu nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "project.member_removed", entityType: "project", entityId: p.id, details: { userId: x.userId } });
        return c.json(await detail(c, p));
      })
      /* ---- úkoly (v1.35): správce projektu vše, řešitel jen stav a pořadí svého úkolu ---- */
      .post("/:id/tasks", requirePerm("projects:write"), zValidator("json", ProjectTaskInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const v = c.req.valid("json");
        await phaseCheck(p.id, v.phaseId);
        await userCheck(v.assigneeId);
        const [mx] = await db.select({ m: sql<number>`coalesce(max(${projectTasks.order}), 0)::int` }).from(projectTasks).where(and(eq(projectTasks.projectId, p.id), eq(projectTasks.status, v.status)));
        const [t] = await db
          .insert(projectTasks)
          .values({ ...v, projectId: p.id, order: (mx?.m ?? 0) + 1, doneAt: v.status === "done" ? new Date() : null, createdById: currentUser(c).id })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "project.task_created", entityType: "project", entityId: p.id, details: { task: t!.title, assigneeId: t!.assigneeId, dueDate: t!.dueDate } });
        return c.json(await detail(c, p), 201);
      })
      .patch("/:id/tasks/:tid", requirePerm("projects:read"), zValidator("json", ProjectTaskPatch), async (c) => {
        const p = await load(c, c.req.param("id"));
        const [t] = await db.select().from(projectTasks).where(and(eq(projectTasks.id, c.req.param("tid")), eq(projectTasks.projectId, p.id)));
        if (!t) throw new HTTPException(404, { message: "Úkol nenalezen" });
        const v = c.req.valid("json");
        const me = currentUser(c).id;
        if (!canEdit(c, p)) {
          const onlyMove = Object.entries(v).every(([k, x]) => x === undefined || k === "status" || k === "order");
          if (t.assigneeId !== me || p.status !== "active" || !onlyMove) throw new HTTPException(p.status === "closed" || p.status === "cancelled" ? 409 : 403, { message: p.status === "closed" || p.status === "cancelled" ? "Projekt je uzavřený" : "Úkol může upravit správce projektu, řešitel jen jeho stav" });
        }
        if (v.phaseId) await phaseCheck(p.id, v.phaseId);
        if (v.assigneeId) await userCheck(v.assigneeId);
        const doneAt = v.status === undefined || v.status === t.status ? undefined : v.status === "done" ? new Date() : null;
        await db
          .update(projectTasks)
          .set({ ...v, ...(doneAt !== undefined ? { doneAt } : {}), updatedAt: new Date() })
          .where(eq(projectTasks.id, t.id));
        await audit(db, { c, user: currentUser(c), action: "project.task_updated", entityType: "project", entityId: p.id, details: { task: t.title, ...v } });
        return c.json(await detail(c, p));
      })
      .delete("/:id/tasks/:tid", requirePerm("projects:write"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [x] = await db.delete(projectTasks).where(and(eq(projectTasks.id, c.req.param("tid")), eq(projectTasks.projectId, p.id))).returning();
        if (!x) throw new HTTPException(404, { message: "Úkol nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "project.task_deleted", entityType: "project", entityId: p.id, details: { task: x.title } });
        return c.json(await detail(c, p));
      })
      /* ---- milníky ---- */
      .post("/:id/milestones", requirePerm("projects:write"), zValidator("json", MilestoneInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const { done, ...v } = c.req.valid("json");
        await phaseCheck(p.id, v.phaseId);
        await db.insert(projectMilestones).values({ ...v, projectId: p.id, doneAt: done ? new Date() : null });
        await audit(db, { c, user: currentUser(c), action: "project.milestone_created", entityType: "project", entityId: p.id, details: v });
        return c.json(await detail(c, p), 201);
      })
      .put("/:id/milestones/:mid", requirePerm("projects:write"), zValidator("json", MilestoneInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [m] = await db.select().from(projectMilestones).where(and(eq(projectMilestones.id, c.req.param("mid")), eq(projectMilestones.projectId, p.id)));
        if (!m) throw new HTTPException(404, { message: "Milník nenalezen" });
        const { done, ...v } = c.req.valid("json");
        await phaseCheck(p.id, v.phaseId);
        await db.update(projectMilestones).set({ ...v, doneAt: done ? (m.doneAt ?? new Date()) : null }).where(eq(projectMilestones.id, m.id));
        await audit(db, { c, user: currentUser(c), action: "project.milestone_updated", entityType: "project", entityId: p.id, details: { ...v, done } });
        return c.json(await detail(c, p));
      })
      .delete("/:id/milestones/:mid", requirePerm("projects:write"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [x] = await db.delete(projectMilestones).where(and(eq(projectMilestones.id, c.req.param("mid")), eq(projectMilestones.projectId, p.id))).returning();
        if (!x) throw new HTTPException(404, { message: "Milník nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "project.milestone_deleted", entityType: "project", entityId: p.id, details: { name: x.name } });
        return c.json(await detail(c, p));
      })
      /* ---- rizika a problémy projektu ---- */
      .post("/:id/issues", requirePerm("projects:write"), zValidator("json", ProjectIssueInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const v = c.req.valid("json");
        await userCheck(v.ownerId);
        await db.insert(projectIssues).values({ ...v, probability: v.kind === "issue" ? null : (v.probability ?? "medium"), projectId: p.id });
        await audit(db, { c, user: currentUser(c), action: "project.issue_created", entityType: "project", entityId: p.id, details: { kind: v.kind, title: v.title, impact: v.impact } });
        return c.json(await detail(c, p), 201);
      })
      .put("/:id/issues/:iid", requirePerm("projects:write"), zValidator("json", ProjectIssueInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [x] = await db.select().from(projectIssues).where(and(eq(projectIssues.id, c.req.param("iid")), eq(projectIssues.projectId, p.id)));
        if (!x) throw new HTTPException(404, { message: "Záznam nenalezen" });
        const v = c.req.valid("json");
        await userCheck(v.ownerId);
        await db.update(projectIssues).set({ ...v, probability: v.kind === "issue" ? null : (v.probability ?? "medium"), updatedAt: new Date() }).where(eq(projectIssues.id, x.id));
        await audit(db, { c, user: currentUser(c), action: "project.issue_updated", entityType: "project", entityId: p.id, details: { title: v.title, status: v.status } });
        return c.json(await detail(c, p));
      })
      .delete("/:id/issues/:iid", requirePerm("projects:write"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [x] = await db.delete(projectIssues).where(and(eq(projectIssues.id, c.req.param("iid")), eq(projectIssues.projectId, p.id))).returning();
        if (!x) throw new HTTPException(404, { message: "Záznam nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "project.issue_deleted", entityType: "project", entityId: p.id, details: { title: x.title } });
        return c.json(await detail(c, p));
      })
      /* ---- hlášení stavu (RAG) ---- */
      .post("/:id/reports", requirePerm("projects:write"), zValidator("json", StatusReportInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const v = c.req.valid("json");
        await db.insert(projectStatusReports).values({ ...v, projectId: p.id, date: todayIso(), createdById: currentUser(c).id });
        await audit(db, { c, user: currentUser(c), action: "project.status_reported", entityType: "project", entityId: p.id, details: { overall: v.overall, schedule: v.schedule, budget: v.budget, scope: v.scope } });
        return c.json(await detail(c, p), 201);
      })
      /* ---- žádosti o změnu: podá tým, schvaluje sponzor (jako bránu), ne žadatel ---- */
      .post("/:id/changes", requirePerm("projects:write"), zValidator("json", ChangeRequestInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        if (p.status !== "active") throw new HTTPException(409, { message: "Změnu lze podat jen u probíhajícího projektu" });
        const v = c.req.valid("json");
        if (v.newEndDate && p.startDate && v.newEndDate < p.startDate) throw new HTTPException(400, { message: "Nový termín je před začátkem projektu" });
        const [mx] = await db.select({ m: sql<number>`coalesce(max(${projectChanges.number}), 0)::int` }).from(projectChanges).where(eq(projectChanges.projectId, p.id));
        await db.insert(projectChanges).values({
          projectId: p.id,
          number: (mx?.m ?? 0) + 1,
          title: v.title,
          description: v.description,
          newEndDate: v.newEndDate,
          oldEndDate: v.newEndDate ? p.endDate : null,
          budgetDelta: v.budgetDelta === null ? null : String(v.budgetDelta),
          scope: v.scope,
          requestedById: currentUser(c).id,
        });
        await audit(db, { c, user: currentUser(c), action: "project.change_requested", entityType: "project", entityId: p.id, details: v });
        return c.json(await detail(c, p), 201);
      })
      .post("/:id/changes/:cid/decide", requirePerm("projects:read"), zValidator("json", ChangeDecisionInput), async (c) => {
        const p = await load(c, c.req.param("id"));
        const [ch] = await db.select().from(projectChanges).where(and(eq(projectChanges.id, c.req.param("cid")), eq(projectChanges.projectId, p.id)));
        if (!ch) throw new HTTPException(404, { message: "Žádost o změnu nenalezena" });
        if (ch.status !== "submitted") throw new HTTPException(409, { message: "O změně už bylo rozhodnuto" });
        const me = currentUser(c);
        if (!canApproveGate(c, p) || ch.requestedById === me.id) throw new HTTPException(403, { message: p.sponsorId ? "Změnu schvaluje sponzor projektu (ne žadatel)" : "Změnu schvaluje jiný uživatel než manažer a žadatel" });
        const v = c.req.valid("json");
        if (v.decision === "rejected" && !v.comment) throw new HTTPException(400, { message: "Uveďte důvod zamítnutí" });
        await db.transaction(async (tx) => {
          await tx.update(projectChanges).set({ status: v.decision, decidedById: me.id, decidedAt: new Date(), comment: v.comment }).where(eq(projectChanges.id, ch.id));
          if (v.decision === "approved") {
            const upd: Partial<typeof projects.$inferInsert> = {};
            if (ch.newEndDate) upd.endDate = ch.newEndDate;
            if (ch.budgetDelta !== null) upd.budget = String(Math.max(0, Number(p.budget ?? 0) + Number(ch.budgetDelta)));
            if (Object.keys(upd).length) await tx.update(projects).set({ ...upd, updatedAt: new Date() }).where(eq(projects.id, p.id));
          }
        });
        await audit(db, { c, user: me, action: `project.change_${v.decision}`, entityType: "project", entityId: p.id, details: { number: ch.number, title: ch.title, comment: v.comment } });
        return c.json(await detail(c, await load(c, p.id)));
      })
      /* ---- poučení (lessons learned) – i u uzavřeného projektu ---- */
      .post("/:id/lessons", requirePerm("projects:write"), zValidator("json", LessonInput), async (c) => {
        const p = await load(c, c.req.param("id"));
        if (!hasPermIn(c, "projects:write", p.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const v = c.req.valid("json");
        await db.insert(projectLessons).values({ ...v, projectId: p.id, createdById: currentUser(c).id });
        await audit(db, { c, user: currentUser(c), action: "project.lesson_added", entityType: "project", entityId: p.id, details: { kind: v.kind } });
        return c.json(await detail(c, p), 201);
      })
      .delete("/:id/lessons/:lid", requirePerm("projects:write"), async (c) => {
        const p = await load(c, c.req.param("id"));
        if (!hasPermIn(c, "projects:write", p.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const [x] = await db.delete(projectLessons).where(and(eq(projectLessons.id, c.req.param("lid")), eq(projectLessons.projectId, p.id))).returning();
        if (!x) throw new HTTPException(404, { message: "Záznam nenalezen" });
        return c.json(await detail(c, p));
      })
      /* ---- výstupy: stavová / závěrečná zpráva (HTML k tisku, Word) ---- */
      .get(
        "/:id/report",
        requirePerm("projects:read"),
        zValidator("query", z.object({ kind: z.enum(["status", "closure"]).default("status"), format: z.enum(["html", "docx"]).default("html"), lang: z.enum(["cs", "en"]).default("cs") })),
        async (c) => {
          const p = await load(c, c.req.param("id"));
          const { kind, format, lang } = c.req.valid("query");
          const d = await detail(c, p);
          const r = projectReportHtml(d, kind, lang);
          await audit(db, { c, user: currentUser(c), action: "project.report_generated", entityType: "project", entityId: p.id, details: { kind, format, lang } });
          const fname = `${r.title} – ${p.code ? `${p.code} ` : ""}${p.name}`.replace(/[\\/:*?"<>|]/g, "_");
          if (format === "docx") return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: p.name }), `${fname}.docx`);
          return c.html(r.page, 200, { "cache-control": "private, no-store" });
        },
      )
      .get("/:id/docs/:docId/file", requirePerm("projects:read"), async (c) => {
        const { d } = await loadDoc(c, c.req.param("id"), c.req.param("docId"));
        if (!d.content || !d.fileName) throw new HTTPException(404, { message: "Soubor nenalezen" });
        return new Response(new Uint8Array(d.content), {
          headers: {
            "content-type": d.fileMime ?? "application/octet-stream",
            "content-disposition": `attachment; filename="${d.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(d.fileName)}`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'",
            "cache-control": "private, no-store",
          },
        });
      })
  );
}

