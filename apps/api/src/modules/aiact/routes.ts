import {
  AIACT_LABELS,
  AI_LITERACY_TOPIC,
  AI_OBLIGATIONS,
  AI_RISK_CLASSES,
  AI_SYSTEM_STATUSES,
  AiSystemDecisionInput,
  AiDirectiveInput,
  AiObligationInput,
  AiScreening,
  AiSystemInput,
  AiSystemPatch,
  DOC_CODE_PREFIX,
  EMPTY_AUDIENCE,
  FriaInput,
  aiDirectiveTemplate,
  aiObligationsFor,
  aiSystemGaps,
  classifyAiSystem,
  friaMissing,
  friaRequired,
  nextDocCode,
  type AiObligationState,
  type AiRiskClass,
  type AiRole,
  type AiSummaryDto,
  type AiSystemDto,
  type AiSystemStatus,
  type FriaData,
  type FriaStatus,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, inScope, scopeOf, settingsFor, soleCompany, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  aiSystemActivities,
  aiSystemAssets,
  aiSystemProcesses,
  aiSystemSuppliers,
  aiSystemRisks,
  risks,
  controls,
  aiSystemControls,
  aiSystems,
  assets,
  dpias,
  orgUnits,
  policies,
  policyQuizQuestions,
  policyVersions,
  positionHolders,
  positions,
  processes,
  processingActivities,
  suppliers,
  trainingCourses,
  users,
} from "../../db/schema";
import { loadCourses } from "../awareness/routes";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html as h, printPage } from "../documents/render";
import { tFor } from "../i18n/service";

/* ============================================================
 * AI Act (ADR-090): registr AI systémů, screening a klasifikace (čl. 5, 6, 50), povinnosti podle role,
 * FRIA (čl. 27), schválení použití, AI gramotnost (čl. 4) a šablona interní směrnice v DMS.
 * Klasifikace, povinnosti a mezery se počítají při čtení (shared/aiact.ts) – nepersistovat.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof aiSystems.$inferSelect;
const owner = alias(positions, "ai_owner");
const oversight = alias(positions, "ai_oversight");
const decider = alias(users, "ai_decider");
const friaApprover = alias(users, "ai_fria_approver");

const today = () => new Date().toISOString().slice(0, 10);
const addMonths = (d: string, m: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.toISOString().slice(0, 10);
};
/** Další přezkum AI systému (vyřazené a zamítnuté se nepřezkoumávají). */
export const aiNextReview = (a: { status: string; lastReviewedAt: string | null; reviewMonths: number; decidedAt: Date | null; createdAt: Date }) =>
  a.status === "retired" || a.status === "rejected" ? null : addMonths(a.lastReviewedAt ?? (a.decidedAt ?? a.createdAt).toISOString().slice(0, 10), a.reviewMonths);

const screeningOf = (r: Row) => (r.screening ? AiScreening.parse(r.screening) : null);

export function aiActRoutes(db: Db) {
  async function canEdit(c: Ctx, a: { ownerPositionId: string | null }) {
    if (hasPerm(c, "aiact:write")) return true;
    if (!a.ownerPositionId) return false;
    const [x] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(positionHolders)
      .where(and(eq(positionHolders.positionId, a.ownerPositionId), eq(positionHolders.userId, currentUser(c).id)));
    return x!.n > 0;
  }

  async function load(c: Ctx, where: SQL | undefined): Promise<AiSystemDto[]> {
    const rows = await db
      .select({ a: aiSystems, ownerName: owner.name, oversightName: oversight.name, deciderName: decider.displayName, friaByName: friaApprover.displayName })
      .from(aiSystems)
      .leftJoin(owner, eq(owner.id, aiSystems.ownerPositionId))
      .leftJoin(oversight, eq(oversight.id, aiSystems.oversightPositionId))
      .leftJoin(decider, eq(decider.id, aiSystems.decidedById))
      .leftJoin(friaApprover, eq(friaApprover.id, aiSystems.friaApprovedById))
      .where(where)
      .orderBy(asc(aiSystems.code), asc(aiSystems.name));
    const ids = rows.map((r) => r.a.id);
    const none = Promise.resolve([] as never[]);
    const [pr, as, su, ac, rk, ct] = await Promise.all([
      ids.length
        ? db.select({ sid: aiSystemProcesses.systemId, id: processes.id, code: processes.code, name: processes.name }).from(aiSystemProcesses).innerJoin(processes, eq(processes.id, aiSystemProcesses.targetId)).where(inArray(aiSystemProcesses.systemId, ids))
        : none,
      ids.length
        ? db.select({ sid: aiSystemAssets.systemId, id: assets.id, name: assets.name, assetType: assets.assetType }).from(aiSystemAssets).innerJoin(assets, eq(assets.id, aiSystemAssets.targetId)).where(inArray(aiSystemAssets.systemId, ids))
        : none,
      ids.length
        ? db.select({ sid: aiSystemSuppliers.systemId, id: suppliers.id, name: suppliers.name }).from(aiSystemSuppliers).innerJoin(suppliers, eq(suppliers.id, aiSystemSuppliers.targetId)).where(inArray(aiSystemSuppliers.systemId, ids))
        : none,
      ids.length
        ? db
            .select({ sid: aiSystemActivities.systemId, id: processingActivities.id, code: processingActivities.code, name: processingActivities.name, dpiaStatus: dpias.status })
            .from(aiSystemActivities)
            .innerJoin(processingActivities, eq(processingActivities.id, aiSystemActivities.targetId))
            .leftJoin(dpias, eq(dpias.activityId, processingActivities.id))
            .where(inArray(aiSystemActivities.systemId, ids))
        : none,
      ids.length ? db.select({ sid: aiSystemRisks.systemId, id: risks.id, code: risks.code, name: risks.name }).from(aiSystemRisks).innerJoin(risks, eq(risks.id, aiSystemRisks.targetId)).where(inArray(aiSystemRisks.systemId, ids)) : none,
      ids.length ? db.select({ sid: aiSystemControls.systemId, id: controls.id, code: controls.code, name: controls.name }).from(aiSystemControls).innerJoin(controls, eq(controls.id, aiSystemControls.targetId)).where(inArray(aiSystemControls.systemId, ids)) : none,
    ]);
    const now = today();
    const out: AiSystemDto[] = [];
    for (const { a, ownerName, oversightName, deciderName, friaByName } of rows) {
      const screening = screeningOf(a);
      const classification = classifyAiSystem(screening);
      const obligations = aiObligationsFor(a.role as AiRole, screening, a.obligations as Record<string, AiObligationState>);
      const fr = !!screening && friaRequired(screening, classification);
      const activities = ac.filter((x) => x.sid === a.id).map(({ id, code, name, dpiaStatus }) => ({ id, code, name, dpiaStatus }));
      const nextReview = aiNextReview(a);
      const status = a.status as AiSystemStatus;
      out.push({
        id: a.id,
        companyId: a.companyId,
        code: a.code,
        name: a.name,
        vendor: a.vendor,
        model: a.model,
        role: a.role as AiRole,
        source: a.source as AiSystemDto["source"],
        status,
        purpose: a.purpose,
        description: a.description,
        users: a.users,
        inputData: a.inputData,
        outputs: a.outputs,
        humanOversight: a.humanOversight,
        dataLocation: a.dataLocation,
        instructionsUrl: a.instructionsUrl,
        logRetentionMonths: a.logRetentionMonths,
        ownerPositionId: a.ownerPositionId,
        ownerPositionName: ownerName,
        oversightPositionId: a.oversightPositionId,
        oversightPositionName: oversightName,
        screening,
        screenedAt: a.screenedAt?.toISOString() ?? null,
        classification,
        obligations,
        fria: a.fria || a.friaStatus ? { ...((a.fria ?? {}) as FriaData), status: (a.friaStatus ?? "draft") as FriaStatus, approvedAt: a.friaApprovedAt?.toISOString() ?? null, approvedByName: friaByName } : null,
        friaRequired: fr,
        decision: a.decidedAt ? { at: a.decidedAt.toISOString(), byName: deciderName, note: a.decisionNote } : null,
        processes: pr.filter((x) => x.sid === a.id).map(({ id, code, name }) => ({ id, code, name })),
        assets: as.filter((x) => x.sid === a.id).map(({ id, name, assetType }) => ({ id, name, assetType })),
        suppliers: su.filter((x) => x.sid === a.id).map(({ id, name }) => ({ id, name })),
        activities,
        risks: rk.filter((x) => x.sid === a.id).map(({ id, code, name }) => ({ id, code, name })),
        controls: ct.filter((x) => x.sid === a.id).map(({ id, code, name }) => ({ id, code, name })),
        reviewMonths: a.reviewMonths,
        lastReviewedAt: a.lastReviewedAt,
        nextReview,
        gaps: aiSystemGaps({
          status,
          purpose: a.purpose,
          ownerPositionId: a.ownerPositionId,
          oversightPositionId: a.oversightPositionId,
          screening,
          obligations,
          friaStatus: (a.friaStatus as FriaStatus | null) ?? null,
          decided: !!a.decidedAt && status !== "rejected",
          dpiaCompleted: activities.length ? activities.some((x) => x.dpiaStatus === "completed") : null,
          nextReview,
          today: now,
        }),
        canEdit: await canEdit(c, a),
        updatedAt: a.updatedAt.toISOString(),
      });
    }
    return out;
  }

  async function row(c: Ctx, id: string): Promise<Row> {
    const [a] = await db.select().from(aiSystems).where(eq(aiSystems.id, id));
    if (!a) throw new HTTPException(404, { message: "AI systém nenalezen" });
    assertScope(c, a.companyId, "AI systém nenalezen");
    return a;
  }
  const one = async (c: Ctx, id: string) => (await load(c, eq(aiSystems.id, id)))[0]!;
  async function editable(c: Ctx, id: string) {
    const a = await row(c, id);
    if (!(await canEdit(c, a))) throw new HTTPException(403, { message: "AI systém upravuje jeho vlastník nebo správce AI" });
    return a;
  }

  async function setLinks(c: Ctx, id: string, v: { processIds?: string[]; assetIds?: string[]; supplierIds?: string[]; activityIds?: string[]; riskIds?: string[]; controlIds?: string[] }) {
    const sets = [
      { link: aiSystemProcesses, ids: v.processIds, t: processes },
      { link: aiSystemAssets, ids: v.assetIds, t: assets },
      { link: aiSystemSuppliers, ids: v.supplierIds, t: suppliers },
      { link: aiSystemActivities, ids: v.activityIds, t: processingActivities },
      { link: aiSystemRisks, ids: v.riskIds, t: risks },
      { link: aiSystemControls, ids: v.controlIds, t: controls },
    ] as const;
    for (const s of sets) {
      if (!s.ids) continue;
      const ids = [...new Set(s.ids)];
      if (ids.length) {
        const found = (await db.select({ id: s.t.id, companyId: s.t.companyId }).from(s.t as never).where(inArray(s.t.id, ids))) as { id: string; companyId: string }[];
        if (found.length !== ids.length) throw new HTTPException(400, { message: "Neznámý navázaný záznam" });
        for (const f of found) assertScope(c, f.companyId, "Navázaný záznam nenalezen");
      }
      await db.delete(s.link).where(eq(s.link.systemId, id));
      if (ids.length) await db.insert(s.link).values(ids.map((targetId) => ({ systemId: id, targetId })));
    }
  }

  async function positionsInCompany(companyId: string, ids: (string | null | undefined)[]) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (!want.length) return;
    const found = await db.select({ id: positions.id, companyId: orgUnits.companyId }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(inArray(positions.id, want));
    if (found.length !== want.length || found.some((p) => p.companyId !== companyId)) throw new HTTPException(400, { message: "Funkční místo nepatří do společnosti" });
  }

  /** Směrnice o AI vytvořená ze šablony (podle názvu v obou jazycích). */
  async function directiveOf(companyId: string) {
    const titles = [aiDirectiveTemplate({ org: "", tools: [], locale: "cs" }).directive.title, aiDirectiveTemplate({ org: "", tools: [], locale: "en" }).directive.title];
    const [p] = await db
      .select({ id: policies.id, title: policies.title, status: policies.status })
      .from(policies)
      .where(and(eq(policies.companyId, companyId), inArray(policies.title, titles)))
      .limit(1);
    return p ?? null;
  }

  async function summary(c: Ctx, companyIds: string[]): Promise<AiSummaryDto> {
    const list = await load(c, and(inScope(c, aiSystems.companyId), companyIds.length ? inArray(aiSystems.companyId, companyIds) : undefined));
    const byClass = Object.fromEntries(AI_RISK_CLASSES.map((k) => [k, 0])) as Record<AiRiskClass, number>;
    const byStatus = Object.fromEntries(AI_SYSTEM_STATUSES.map((k) => [k, 0])) as Record<AiSystemStatus, number>;
    for (const a of list) {
      byStatus[a.status]++;
      if (a.status !== "retired" && a.status !== "rejected") byClass[a.classification.cls]++;
    }
    const courses = await loadCourses(
      db,
      and(inArray(trainingCourses.companyId, companyIds.length ? companyIds : ["00000000-0000-0000-0000-000000000000"]), eq(trainingCourses.active, true), sql`${AI_LITERACY_TOPIC} = any(${trainingCourses.topics})`),
    );
    return {
      total: list.length,
      byClass,
      byStatus,
      withGaps: list.filter((a) => a.gaps.length).length,
      friaOpen: list.filter((a) => a.friaRequired && a.fria?.status !== "completed").length,
      literacy: courses.map(({ item }) => ({ id: item.id, title: item.title, required: item.required, ok: item.stats.ok + item.stats.due_soon, overdue: item.stats.overdue, missing: item.stats.missing })),
      directive: companyIds.length === 1 ? await directiveOf(companyIds[0]!) : null,
    };
  }

  /** Registr AI systémů – tisková podoba (pro audit a dozor). */
  async function registerHtml(c: Ctx, companyId: string) {
    const { esc, day, nl } = h;
    const t = await tFor(db, c);
    const title = t("srv.aiact.registerTitle");
    const s = await settingsFor(db, null, companyId);
    const list = (await load(c, eq(aiSystems.companyId, companyId))).filter((a) => a.status !== "rejected");
    const lbl = (x: string) => esc(t.lbl(x));
    const body = `<div class="muted small">${esc(s.organizationName)}</div>
<h1>${esc(title)}</h1>
<div class="muted">${esc(t("srv.aiact.registerBasis"))}</div>
<div class="meta"><span class="muted">${esc(t("srv.aiact.asOf"))}</span><span>${h.dt(new Date().toISOString())}</span><span class="muted">${esc(t("srv.aiact.count"))}</span><span>${list.length}</span></div>
<table><thead><tr><th>${esc(t("srv.aiact.system"))}</th><th>${esc(t("srv.aiact.role"))}</th><th>${esc(t("srv.aiact.class"))}</th><th>${esc(t("srv.aiact.status"))}</th><th>${esc(t("srv.aiact.owner"))}</th></tr></thead><tbody>
${list
  .map(
    (a) =>
      `<tr><td>${esc(a.code ?? "")} ${esc(a.name)}${a.vendor ? `<br><span class="muted small">${esc(a.vendor)}${a.model ? ` · ${esc(a.model)}` : ""}</span>` : ""}</td><td>${lbl(AIACT_LABELS.role[a.role])}</td><td>${lbl(AIACT_LABELS.cls[a.classification.cls])}</td><td>${lbl(AIACT_LABELS.status[a.status])}</td><td>${esc(a.ownerPositionName ?? "—")}</td></tr>`,
  )
  .join("")}
</tbody></table>
${list
  .map((a) => {
    const done = a.obligations.filter((o) => o.status === "done" || o.status === "na").length;
    return `<h2>${esc(a.code ?? "")} ${esc(a.name)}</h2>
<table><tbody>
<tr><th style="width:28%">${esc(t("srv.aiact.purpose"))}</th><td>${nl(a.purpose || "—")}</td></tr>
<tr><th>${esc(t("srv.aiact.class"))}</th><td>${lbl(AIACT_LABELS.cls[a.classification.cls])}${a.classification.reasons.length ? `<br><span class="muted small">${esc(a.classification.reasons.join("; "))}</span>` : ""}</td></tr>
<tr><th>${esc(t("srv.aiact.inputOutput"))}</th><td>${nl(a.inputData ?? "—")}<br>${nl(a.outputs ?? "")}</td></tr>
<tr><th>${esc(t("srv.aiact.oversight"))}</th><td>${esc(a.oversightPositionName ?? "—")}${a.humanOversight ? `<br>${nl(a.humanOversight)}` : ""}</td></tr>
<tr><th>${esc(t("srv.aiact.dataLocation"))}</th><td>${esc(a.dataLocation ?? "—")}</td></tr>
<tr><th>${esc(t("srv.aiact.obligations"))}</th><td>${esc(t("srv.aiact.obligationsDone", { done, total: a.obligations.length }))}${a.obligations
      .filter((o) => o.status !== "done" && o.status !== "na")
      .map((o) => `<br>• ${esc(o.ref)} – ${lbl(AIACT_LABELS.obligation[o.key as keyof typeof AIACT_LABELS.obligation])}`)
      .join("")}</td></tr>
<tr><th>FRIA</th><td>${a.friaRequired ? (a.fria ? lbl(AIACT_LABELS.friaStatus[a.fria.status]) : esc(t("srv.aiact.friaMissing"))) : esc(t("srv.aiact.friaNotRequired"))}</td></tr>
<tr><th>${esc(t("srv.aiact.decision"))}</th><td>${a.decision ? `${day(a.decision.at.slice(0, 10))} · ${esc(a.decision.byName ?? "—")}${a.decision.note ? `<br>${nl(a.decision.note)}` : ""}` : "—"}</td></tr>
<tr><th>${esc(t("srv.aiact.review"))}</th><td>${day(a.lastReviewedAt)} → ${day(a.nextReview)}</td></tr>
</tbody></table>`;
  })
  .join("")}`;
    return { html: printPage(title, body, t.locale), org: s.organizationName, title };
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "aiact"))
      .get("/", requirePerm("aiact:read"), zValidator("query", z.object({ status: z.enum([...AI_SYSTEM_STATUSES, "all"]).default("all") })), async (c) => {
        const { status } = c.req.valid("query");
        return c.json(await load(c, and(inScope(c, aiSystems.companyId), status === "all" ? undefined : eq(aiSystems.status, status))));
      })
      .get("/summary", requirePerm("aiact:read"), zValidator("query", z.object({ companyId: z.string().uuid().optional() })), async (c) => {
        const q = c.req.valid("query").companyId;
        const sc = scopeOf(c);
        return c.json(await summary(c, q ? [soleCompany(c, q)] : sc.active ? [sc.active] : sc.ids));
      })
      .get("/register.html", requirePerm("aiact:read"), zValidator("query", z.object({ companyId: z.string().uuid().optional() })), async (c) => {
        const r = await registerHtml(c, soleCompany(c, c.req.valid("query").companyId));
        return c.html(r.html, 200, { "cache-control": "private, no-store" });
      })
      .get("/register.docx", requirePerm("aiact:read"), zValidator("query", z.object({ companyId: z.string().uuid().optional() })), async (c) => {
        const r = await registerHtml(c, soleCompany(c, c.req.valid("query").companyId));
        await audit(db, { c, user: currentUser(c), action: "aiact.register_exported", details: { format: "docx" } });
        return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: r.org }), `${r.title}.docx`);
      })

      /* ---------- šablona směrnice + shrnutí + kurz AI gramotnosti ---------- */
      .post("/directive", requirePerm("aiact:write"), zValidator("json", AiDirectiveInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, input.companyId, "aiact:write");
        if (!hasPerm(c, "policies:write")) throw new HTTPException(403, { message: "Chybí oprávnění ke správě dokumentace" });
        if (input.course && !hasPerm(c, "awareness:write")) throw new HTTPException(403, { message: "Chybí oprávnění ke správě školení" });
        const existing = await directiveOf(companyId);
        if (existing) throw new HTTPException(409, { message: "Směrnice o AI už v dokumentaci je." });
        const t = await tFor(db, c);
        const s = await settingsFor(db, null, companyId);
        const tools = await db
          .select({ name: aiSystems.name, purpose: aiSystems.purpose })
          .from(aiSystems)
          .where(and(eq(aiSystems.companyId, companyId), inArray(aiSystems.status, ["approved", "in_use"])))
          .orderBy(asc(aiSystems.name));
        const tpl = aiDirectiveTemplate({ org: s.organizationName, tools, locale: t.locale === "en" ? "en" : "cs" });
        const user = currentUser(c);
        const out = await db.transaction(async (tx) => {
          const code = async (docType: "directive" | "guideline") => {
            const prefix = DOC_CODE_PREFIX[docType];
            const codes = await tx.select({ code: policies.code }).from(policies).where(and(eq(policies.companyId, companyId), ilike(policies.code, `${prefix}-%`)));
            return nextDocCode(prefix, codes.map((x) => x.code));
          };
          const [dir] = await tx
            .insert(policies)
            .values({
              companyId,
              code: await code("directive"),
              title: tpl.directive.title,
              docType: "directive",
              system: "general",
              description: tpl.directive.description,
              audience: { ...EMPTY_AUDIENCE, management: true },
              requireAcknowledgement: false,
            })
            .returning();
          const [sum] = await tx
            .insert(policies)
            .values({
              companyId,
              code: await code("guideline"),
              title: tpl.summary.title,
              docType: "guideline",
              system: "general",
              description: tpl.summary.description,
              audience: { ...EMPTY_AUDIENCE, all: true },
              requireAcknowledgement: true,
              retrainOnNewVersion: true,
              parentId: dir!.id,
            })
            .returning();
          await tx.insert(policyVersions).values([
            { policyId: dir!.id, version: "1.0", content: tpl.directive.content, changeSummary: t("srv.aiact.fromTemplate"), createdById: user.id },
            { policyId: sum!.id, version: "1.0", content: tpl.summary.content, changeSummary: t("srv.aiact.fromTemplate"), createdById: user.id },
          ]);
          await tx.insert(policyQuizQuestions).values(tpl.quiz.map((q, i) => ({ policyId: sum!.id, position: i, question: q.question, options: q.options, correct: q.correct })));
          let courseId: string | null = null;
          if (input.course) {
            const [course] = await tx
              .insert(trainingCourses)
              .values({
                companyId,
                title: tpl.courseTitle,
                kind: "periodic",
                form: "document",
                description: tpl.courseDescription,
                topics: [AI_LITERACY_TOPIC],
                audience: { ...EMPTY_AUDIENCE, all: true },
                intervalMonths: 12,
                dueDaysForNew: 30,
                policyId: sum!.id,
              })
              .returning();
            courseId = course!.id;
          }
          return { directiveId: dir!.id, summaryId: sum!.id, courseId };
        });
        await audit(db, { c, user, action: "aiact.directive_created", entityType: "policy", entityId: out.directiveId, details: { summaryId: out.summaryId, courseId: out.courseId, tools: tools.length } });
        return c.json(out, 201);
      })

      .get("/:id", requirePerm("aiact:read"), async (c) => {
        const a = await row(c, c.req.param("id"));
        return c.json(await one(c, a.id));
      })
      .post("/", requirePerm("aiact:write"), zValidator("json", AiSystemInput), async (c) => {
        const { processIds, assetIds, supplierIds, activityIds, riskIds, controlIds, companyId: requested, screening, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "aiact:write");
        if (input.status === "approved" || input.status === "rejected") throw new HTTPException(400, { message: "O schválení rozhoduje vlastník AI systému tlačítkem Rozhodnout." });
        await positionsInCompany(companyId, [input.ownerPositionId, input.oversightPositionId]);
        const [a] = await db
          .insert(aiSystems)
          .values({ ...input, companyId, ...(screening ? { screening, screenedAt: new Date() } : {}) })
          .returning();
        await setLinks(c, a!.id, { processIds, assetIds, supplierIds, activityIds, riskIds, controlIds });
        await audit(db, { c, user: currentUser(c), action: "aiact.system_created", entityType: "ai_system", entityId: a!.id, details: { name: a!.name, cls: classifyAiSystem(screening ?? null).cls } });
        return c.json(await one(c, a!.id), 201);
      })
      .patch("/:id", requirePerm("aiact:read"), zValidator("json", AiSystemPatch), async (c) => {
        const cur = await editable(c, c.req.param("id"));
        const { processIds, assetIds, supplierIds, activityIds, riskIds, controlIds, screening, ...input } = c.req.valid("json");
        const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<typeof aiSystems.$inferInsert>;
        if (set.status && set.status !== cur.status && (set.status === "approved" || set.status === "rejected")) throw new HTTPException(400, { message: "O schválení rozhoduje vlastník AI systému tlačítkem Rozhodnout." });
        if (set.status === "in_use" && cur.status !== "in_use") {
          if (!cur.decidedAt || cur.status === "rejected") throw new HTTPException(409, { message: "Do používání lze převést jen schválený AI systém." });
        }
        if (!hasPerm(c, "aiact:write")) delete set.ownerPositionId;
        await positionsInCompany(cur.companyId, [set.ownerPositionId, set.oversightPositionId]);
        if (screening !== undefined) {
          set.screening = screening;
          set.screenedAt = screening ? new Date() : null;
          // změna klasifikace zakázané praktiky v používaném systému – rozhodnutí se ruší
          if (screening && classifyAiSystem(screening).cls === "prohibited" && cur.decidedAt) Object.assign(set, { decidedAt: null, decidedById: null, decisionNote: null, status: cur.status === "in_use" || cur.status === "approved" ? "proposed" : cur.status });
        }
        if (Object.keys(set).length) await db.update(aiSystems).set({ ...set, updatedAt: new Date() }).where(eq(aiSystems.id, cur.id));
        await setLinks(c, cur.id, { processIds, assetIds, supplierIds, activityIds, riskIds, controlIds });
        await audit(db, { c, user: currentUser(c), action: "aiact.system_updated", entityType: "ai_system", entityId: cur.id, details: { ...set, screening: screening === undefined ? undefined : classifyAiSystem(screening).cls } });
        return c.json(await one(c, cur.id));
      })
      .delete("/:id", requirePerm("aiact:write"), async (c) => {
        const cur = await row(c, c.req.param("id"));
        if (cur.decidedAt && cur.status !== "rejected") throw new HTTPException(409, { message: "Schválený AI systém nelze smazat – vyřaďte ho (stav Vyřazeno)." });
        await db.delete(aiSystems).where(eq(aiSystems.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "aiact.system_deleted", entityType: "ai_system", entityId: cur.id, details: { name: cur.name } });
        return c.json({ ok: true });
      })

      /* ---------- rozhodnutí o použití ---------- */
      .post("/:id/decision", requirePerm("aiact:read"), zValidator("json", AiSystemDecisionInput), async (c) => {
        const cur = await row(c, c.req.param("id"));
        // rozhoduje držitel místa vlastníka nebo správce AI (aiact:write)
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "O použití rozhoduje vlastník AI systému nebo správce AI" });
        const { decision, note } = c.req.valid("json");
        const screening = screeningOf(cur);
        if (decision === "approve") {
          if (!screening) throw new HTTPException(409, { message: "Před schválením proveďte screening a klasifikaci rizika." });
          const cls = classifyAiSystem(screening);
          if (cls.cls === "prohibited") throw new HTTPException(409, { message: "Zakázanou praktiku podle čl. 5 AI Act nelze schválit." });
          if (cls.cls === "high" && !cur.oversightPositionId) throw new HTTPException(409, { message: "Vysoce rizikový systém vyžaduje pověřený lidský dohled (čl. 26 odst. 2)." });
        }
        const status: AiSystemStatus = decision === "reject" ? "rejected" : cur.status === "in_use" ? "in_use" : "approved";
        await db
          .update(aiSystems)
          .set({ status, decidedAt: new Date(), decidedById: currentUser(c).id, decisionNote: note ?? null, ...(decision === "approve" ? { lastReviewedAt: today() } : {}), updatedAt: new Date() })
          .where(eq(aiSystems.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: decision === "approve" ? "aiact.system_approved" : "aiact.system_rejected", entityType: "ai_system", entityId: cur.id, details: { note: note ?? null, cls: classifyAiSystem(screening).cls } });
        return c.json(await one(c, cur.id));
      })
      .post("/:id/review", requirePerm("aiact:read"), zValidator("json", z.object({ note: z.string().trim().max(2000).optional() })), async (c) => {
        const cur = await editable(c, c.req.param("id"));
        await db.update(aiSystems).set({ lastReviewedAt: today(), updatedAt: new Date() }).where(eq(aiSystems.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "aiact.system_reviewed", entityType: "ai_system", entityId: cur.id, details: { note: c.req.valid("json").note ?? null } });
        return c.json(await one(c, cur.id));
      })

      /* ---------- povinnosti ---------- */
      .put("/:id/obligations/:key", requirePerm("aiact:read"), zValidator("json", AiObligationInput), async (c) => {
        const cur = await editable(c, c.req.param("id"));
        const key = c.req.param("key");
        if (!AI_OBLIGATIONS.some((o) => o.key === key)) throw new HTTPException(404, { message: "Neznámá povinnost" });
        const applicable = aiObligationsFor(cur.role as AiRole, screeningOf(cur), {});
        if (!applicable.some((o) => o.key === key)) throw new HTTPException(409, { message: "Povinnost se na systém podle klasifikace nevztahuje." });
        const { status, note } = c.req.valid("json");
        const next = { ...(cur.obligations as Record<string, AiObligationState>), [key]: { status, note: note ?? null, at: today() } };
        await db.update(aiSystems).set({ obligations: next, updatedAt: new Date() }).where(eq(aiSystems.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "aiact.obligation_updated", entityType: "ai_system", entityId: cur.id, details: { key, status } });
        return c.json(await one(c, cur.id));
      })

      /* ---------- FRIA (čl. 27) ---------- */
      .put("/:id/fria", requirePerm("aiact:read"), zValidator("json", FriaInput), async (c) => {
        const cur = await editable(c, c.req.param("id"));
        if (cur.friaStatus === "completed") throw new HTTPException(409, { message: "FRIA je dokončené – pro úpravu ho znovu otevřete." });
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
        await db
          .update(aiSystems)
          .set({ fria: { ...((cur.fria ?? {}) as FriaData), ...input }, friaStatus: "draft", updatedAt: new Date() })
          .where(eq(aiSystems.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "aiact.fria_saved", entityType: "ai_system", entityId: cur.id, details: { fields: Object.keys(input) } });
        return c.json(await one(c, cur.id));
      })
      .post("/:id/fria/approve", requirePerm("aiact:write"), async (c) => {
        const cur = await row(c, c.req.param("id"));
        const missing = friaMissing(cur.fria as FriaData | null);
        if (missing.length) throw new HTTPException(400, { message: "Před dokončením FRIA vyplňte všechny prvky a–f (čl. 27 odst. 1)." });
        const fria = cur.fria as FriaData;
        await db
          .update(aiSystems)
          .set({
            friaStatus: "completed",
            friaApprovedAt: new Date(),
            friaApprovedById: currentUser(c).id,
            fria: { ...fria, nextReview: fria.nextReview ?? addMonths(today(), 12) },
            obligations: { ...(cur.obligations as Record<string, AiObligationState>), fria: { status: "done", note: null, at: today() } },
            updatedAt: new Date(),
          })
          .where(eq(aiSystems.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "aiact.fria_approved", entityType: "ai_system", entityId: cur.id });
        return c.json(await one(c, cur.id));
      })
      .post("/:id/fria/reopen", requirePerm("aiact:write"), async (c) => {
        const cur = await row(c, c.req.param("id"));
        if (cur.friaStatus !== "completed") throw new HTTPException(409, { message: "FRIA není dokončené." });
        await db
          .update(aiSystems)
          .set({ friaStatus: "draft", friaApprovedAt: null, friaApprovedById: null, obligations: { ...(cur.obligations as Record<string, AiObligationState>), fria: { status: "in_progress", note: null, at: today() } }, updatedAt: new Date() })
          .where(eq(aiSystems.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "aiact.fria_reopened", entityType: "ai_system", entityId: cur.id });
        return c.json(await one(c, cur.id));
      })
  );
}
