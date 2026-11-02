import {
  DpiaInput,
  GDPR_LABELS,
  ProcessingActivityInput,
  ProcessingActivityPatch,
  activityGaps,
  dpiaRequired,
  type DpiaCriterion,
  type DpiaDto,
  type DpiaRisk,
  type ProcessingActivityDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, inScope, settingsFor, soleCompany, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { tFor } from "../i18n/service";
import {
  activityAssets,
  activityControls,
  activityProcesses,
  activitySuppliers,
  assets,
  controls,
  dpias,
  positionHolders,
  positions,
  processes,
  processingActivities,
  suppliers,
  users,
} from "../../db/schema";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html as h, printPage } from "../documents/render";

/* ============================================================
 * GDPR: záznamy o činnostech zpracování (čl. 30) a DPIA (čl. 35) – ADR-020.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof processingActivities.$inferSelect;
const approver = alias(users, "dpia_approver");

const addMonths = (d: string, m: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x.toISOString().slice(0, 10);
};
export const activityNextReview = (a: { lastReviewedAt: string | null; reviewMonths: number; createdAt: Date }) => addMonths(a.lastReviewedAt ?? a.createdAt.toISOString().slice(0, 10), a.reviewMonths);

const maxResidual = (risks: DpiaRisk[]) =>
  risks.length ? Math.max(...risks.map((r) => (r.residualLikelihood ?? r.likelihood) * (r.residualSeverity ?? r.severity))) : null;

export function gdprRoutes(db: Db) {
  async function canEdit(c: Ctx, a: { ownerPositionId: string | null }) {
    if (hasPerm(c, "gdpr:write")) return true;
    if (!a.ownerPositionId) return false;
    const [h] = await db
      .select({ n: count() })
      .from(positionHolders)
      .where(and(eq(positionHolders.positionId, a.ownerPositionId), eq(positionHolders.userId, currentUser(c).id)));
    return h!.n > 0;
  }

  async function load(c: Ctx, where: ReturnType<typeof and>): Promise<ProcessingActivityDto[]> {
    const rows = await db
      .select({ a: processingActivities, ownerPositionName: positions.name })
      .from(processingActivities)
      .leftJoin(positions, eq(positions.id, processingActivities.ownerPositionId))
      .where(where)
      .orderBy(asc(processingActivities.code), asc(processingActivities.name));
    const ids = rows.map((r) => r.a.id);
    const none = Promise.resolve([] as never[]);
    const [pr, as, su, ct, dp] = await Promise.all([
      ids.length
        ? db.select({ aid: activityProcesses.activityId, id: processes.id, code: processes.code, name: processes.name }).from(activityProcesses).innerJoin(processes, eq(processes.id, activityProcesses.targetId)).where(inArray(activityProcesses.activityId, ids))
        : none,
      ids.length
        ? db.select({ aid: activityAssets.activityId, id: assets.id, name: assets.name, assetType: assets.assetType }).from(activityAssets).innerJoin(assets, eq(assets.id, activityAssets.targetId)).where(inArray(activityAssets.activityId, ids))
        : none,
      ids.length
        ? db.select({ aid: activitySuppliers.activityId, id: suppliers.id, name: suppliers.name }).from(activitySuppliers).innerJoin(suppliers, eq(suppliers.id, activitySuppliers.targetId)).where(inArray(activitySuppliers.activityId, ids))
        : none,
      ids.length
        ? db.select({ aid: activityControls.activityId, id: controls.id, code: controls.code, name: controls.name }).from(activityControls).innerJoin(controls, eq(controls.id, activityControls.targetId)).where(inArray(activityControls.activityId, ids))
        : none,
      ids.length ? db.select().from(dpias).where(inArray(dpias.activityId, ids)) : none,
    ]);
    const out: ProcessingActivityDto[] = [];
    for (const { a, ownerPositionName } of rows) {
      const d = dp.find((x) => x.activityId === a.id);
      const ctl = ct.filter((x) => x.aid === a.id).map(({ id, code, name }) => ({ id, code, name }));
      const base = {
        status: a.status,
        role: a.role,
        purpose: a.purpose,
        legalBasis: a.legalBasis,
        dataSubjects: a.dataSubjects,
        dataCategories: a.dataCategories,
        specialCategories: a.specialCategories,
        retention: a.retention,
        securityMeasures: a.securityMeasures,
        controlCount: ctl.length,
        dpiaCriteria: a.dpiaCriteria,
        dpia: d ? { status: d.status } : null,
        thirdCountryTransfers: a.thirdCountryTransfers,
      };
      out.push({
        id: a.id,
        companyId: a.companyId,
        code: a.code,
        name: a.name,
        status: a.status as ProcessingActivityDto["status"],
        role: a.role as ProcessingActivityDto["role"],
        purpose: a.purpose,
        legalBasis: a.legalBasis as ProcessingActivityDto["legalBasis"],
        legalBasisNote: a.legalBasisNote,
        dataSubjects: a.dataSubjects,
        dataCategories: a.dataCategories,
        specialCategories: a.specialCategories,
        recipients: a.recipients,
        thirdCountryTransfers: a.thirdCountryTransfers,
        retention: a.retention,
        securityMeasures: a.securityMeasures,
        ownerPositionId: a.ownerPositionId,
        ownerPositionName,
        processes: pr.filter((x) => x.aid === a.id).map(({ id, code, name }) => ({ id, code, name })),
        assets: as.filter((x) => x.aid === a.id).map(({ id, name, assetType }) => ({ id, name, assetType })),
        suppliers: su.filter((x) => x.aid === a.id).map(({ id, name }) => ({ id, name })),
        controls: ctl,
        dpiaCriteria: a.dpiaCriteria as DpiaCriterion[],
        dpiaRequired: dpiaRequired(a.dpiaCriteria).required,
        dpia: d ? { id: d.id, status: d.status as DpiaDto["status"], nextReview: d.nextReview, approvedAt: d.approvedAt?.toISOString() ?? null } : null,
        reviewMonths: a.reviewMonths,
        lastReviewedAt: a.lastReviewedAt,
        nextReview: a.status === "retired" ? null : activityNextReview(a),
        gaps: a.status === "retired" ? [] : activityGaps(base),
        canEdit: await canEdit(c, a),
        updatedAt: a.updatedAt.toISOString(),
      });
    }
    return out;
  }

  async function row(c: Ctx, id: string): Promise<Row> {
    const [a] = await db.select().from(processingActivities).where(eq(processingActivities.id, id));
    if (!a) throw new HTTPException(404, { message: "Činnost zpracování nenalezena" });
    assertScope(c, a.companyId, "Činnost zpracování nenalezena");
    return a;
  }
  const one = async (c: Ctx, id: string) => (await load(c, eq(processingActivities.id, id)))[0]!;

  async function setLinks(c: Ctx, id: string, v: { processIds?: string[]; assetIds?: string[]; supplierIds?: string[]; controlIds?: string[] }) {
    const sets = [
      { link: activityProcesses, ids: v.processIds, t: processes },
      { link: activityAssets, ids: v.assetIds, t: assets },
      { link: activitySuppliers, ids: v.supplierIds, t: suppliers },
      { link: activityControls, ids: v.controlIds, t: controls },
    ] as const;
    for (const s of sets) {
      if (!s.ids) continue;
      const ids = [...new Set(s.ids)];
      if (ids.length) {
        const found = (await db.select({ id: s.t.id, companyId: s.t.companyId }).from(s.t as never).where(inArray(s.t.id, ids))) as { id: string; companyId: string }[];
        if (found.length !== ids.length) throw new HTTPException(400, { message: "Neznámý navázaný záznam" });
        for (const f of found) assertScope(c, f.companyId, "Navázaný záznam nenalezen");
      }
      await db.delete(s.link).where(eq(s.link.activityId, id));
      if (ids.length) await db.insert(s.link).values(ids.map((targetId) => ({ activityId: id, targetId })));
    }
  }

  async function dpiaDto(a: Row): Promise<DpiaDto | null> {
    const [r] = await db.select({ d: dpias, approvedByName: approver.displayName }).from(dpias).leftJoin(approver, eq(approver.id, dpias.approvedById)).where(eq(dpias.activityId, a.id));
    if (!r) return null;
    const risks = r.d.risks as DpiaRisk[];
    return {
      id: r.d.id,
      activityId: a.id,
      activityName: a.name,
      status: r.d.status as DpiaDto["status"],
      description: r.d.description,
      necessity: r.d.necessity,
      risks,
      dpoOpinion: r.d.dpoOpinion,
      conclusion: r.d.conclusion,
      priorConsultation: r.d.priorConsultation,
      nextReview: r.d.nextReview,
      approvedByName: r.approvedByName,
      approvedAt: r.d.approvedAt?.toISOString() ?? null,
      updatedAt: r.d.updatedAt.toISOString(),
      maxResidual: maxResidual(risks),
    };
  }

  /** Záznamy o činnostech zpracování – tisková podoba (čl. 30 odst. 1). */
  async function ropaHtml(c: Ctx, companyId: string) {
    const { esc, day, nl } = h;
    const t = await tFor(db, c);
    const title = t("srv.gdpr.ropaTitle");
    const s = await settingsFor(db, null, companyId);
    const list = (await load(c, and(eq(processingActivities.companyId, companyId), inArray(processingActivities.status, ["active", "draft"])))) ?? [];
    const lst = (v: string[]) => (v.length ? v.map(esc).join(", ") : "—");
    const body = `<div class="muted small">${esc(s.organizationName)}${s.organizationIco ? `, ${esc(t("srv.gdpr.ico", { ico: s.organizationIco }))}` : ""}${s.organizationAddress ? `, ${esc(s.organizationAddress)}` : ""}</div>
<h1>${esc(title)}</h1>
<div class="muted">${esc(t("srv.gdpr.ropaBasis"))}</div>
<div class="meta"><span class="muted">${esc(t("srv.gdpr.asOf"))}</span><span>${h.dt(new Date().toISOString())}</span><span class="muted">${esc(t("srv.gdpr.activityCount"))}</span><span>${list.length}</span></div>
${list
  .map(
    (a) => `<h2>${esc(a.code ?? "")} ${esc(a.name)}</h2>
<table><tbody>
<tr><th style="width:28%">${esc(t("srv.gdpr.role"))}</th><td>${esc(t.lbl(GDPR_LABELS.role[a.role]))}${a.status === "draft" ? ` ${esc(t("srv.gdpr.draftSuffix"))}` : ""}</td></tr>
<tr><th>${esc(t("srv.gdpr.purpose"))}</th><td>${nl(a.purpose || "—")}</td></tr>
<tr><th>${esc(t("srv.gdpr.legalBasis"))}</th><td>${a.legalBasis ? esc(t.lbl(GDPR_LABELS.legalBasis[a.legalBasis])) : "—"}${a.legalBasisNote ? `<br>${nl(a.legalBasisNote)}` : ""}</td></tr>
<tr><th>${esc(t("srv.gdpr.dataSubjects"))}</th><td>${lst(a.dataSubjects)}</td></tr>
<tr><th>${esc(t("srv.gdpr.dataCategories"))}</th><td>${lst(a.dataCategories)}</td></tr>
<tr><th>${esc(t("srv.gdpr.specialCategories"))}</th><td>${lst(a.specialCategories)}</td></tr>
<tr><th>${esc(t("srv.gdpr.recipients"))}</th><td>${nl(a.recipients ?? "—")}${a.suppliers.length ? `<br>${esc(t("srv.gdpr.processors", { list: a.suppliers.map((x) => x.name).join(", ") }))}` : ""}</td></tr>
<tr><th>${esc(t("srv.gdpr.transfers"))}</th><td>${nl(a.thirdCountryTransfers || t("srv.gdpr.noTransfers"))}</td></tr>
<tr><th>${esc(t("srv.gdpr.retention"))}</th><td>${nl(a.retention ?? "—")}</td></tr>
<tr><th>${esc(t("srv.gdpr.security"))}</th><td>${nl(a.securityMeasures ?? "")}${a.controls.length ? `<br>${esc(t("srv.gdpr.controlsList", { list: a.controls.map((x) => `${x.code ?? ""} ${x.name}`).join("; ") }))}` : ""}</td></tr>
<tr><th>${esc(t("srv.gdpr.processesSystems"))}</th><td>${[...a.processes.map((x) => esc(x.name)), ...a.assets.map((x) => esc(x.name))].join(", ") || "—"}</td></tr>
<tr><th>DPIA</th><td>${a.dpiaRequired ? (a.dpia ? esc(t("srv.gdpr.dpiaRequiredStatus", { status: t.lbl(GDPR_LABELS.dpiaStatus[a.dpia.status]) })) : esc(t("srv.gdpr.dpiaRequiredMissing"))) : esc(t("srv.gdpr.dpiaNotRequired"))}</td></tr>
<tr><th>${esc(t("srv.gdpr.ownerReview"))}</th><td>${esc(t("srv.gdpr.ownerReviewValue", { owner: a.ownerPositionName ?? "—", last: day(a.lastReviewedAt), next: day(a.nextReview) }))}</td></tr>
</tbody></table>`,
  )
  .join("")}`;
    return { html: printPage(title, body, t.locale), org: s.organizationName, title };
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "gdpr"))
      .get("/", requirePerm("gdpr:read"), zValidator("query", z.object({ status: z.enum(["active", "draft", "retired", "all"]).default("all") })), async (c) => {
        const { status } = c.req.valid("query");
        return c.json(await load(c, and(inScope(c, processingActivities.companyId), status === "all" ? undefined : eq(processingActivities.status, status))));
      })
      .get("/ropa.html", requirePerm("gdpr:read"), zValidator("query", z.object({ companyId: z.string().uuid().optional() })), async (c) => {
        const r = await ropaHtml(c, soleCompany(c, c.req.valid("query").companyId));
        return c.html(r.html, 200, { "cache-control": "private, no-store" });
      })
      .get("/ropa.docx", requirePerm("gdpr:read"), zValidator("query", z.object({ companyId: z.string().uuid().optional() })), async (c) => {
        const r = await ropaHtml(c, soleCompany(c, c.req.valid("query").companyId));
        await audit(db, { c, user: currentUser(c), action: "gdpr.ropa_exported", details: { format: "docx" } });
        return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: r.org }), `${r.title}.docx`);
      })
      .get("/:id", requirePerm("gdpr:read"), async (c) => {
        const a = await row(c, c.req.param("id"));
        return c.json(await one(c, a.id));
      })
      .post("/", requirePerm("gdpr:write"), zValidator("json", ProcessingActivityInput), async (c) => {
        const { processIds, assetIds, supplierIds, controlIds, companyId: requested, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "gdpr:write");
        const [a] = await db.insert(processingActivities).values({ ...input, companyId }).returning();
        await setLinks(c, a!.id, { processIds, assetIds, supplierIds, controlIds });
        await audit(db, { c, user: currentUser(c), action: "gdpr.activity_created", entityType: "processing_activity", entityId: a!.id, details: { name: a!.name } });
        return c.json(await one(c, a!.id), 201);
      })
      .patch("/:id", requirePerm("gdpr:read"), zValidator("json", ProcessingActivityPatch), async (c) => {
        const cur = await row(c, c.req.param("id"));
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "Záznam upravuje vlastník nebo správce GDPR" });
        const { processIds, assetIds, supplierIds, controlIds, companyId: _c, ...input } = c.req.valid("json");
        const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        if (!hasPerm(c, "gdpr:write")) delete (set as Record<string, unknown>).ownerPositionId;
        if (Object.keys(set).length) await db.update(processingActivities).set({ ...set, updatedAt: new Date() }).where(eq(processingActivities.id, cur.id));
        await setLinks(c, cur.id, { processIds, assetIds, supplierIds, controlIds });
        await audit(db, { c, user: currentUser(c), action: "gdpr.activity_updated", entityType: "processing_activity", entityId: cur.id, details: set });
        return c.json(await one(c, cur.id));
      })
      .post("/:id/review", requirePerm("gdpr:read"), zValidator("json", z.object({ note: z.string().trim().max(2000).optional() })), async (c) => {
        const cur = await row(c, c.req.param("id"));
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "Přezkum potvrzuje vlastník nebo správce GDPR" });
        const today = new Date().toISOString().slice(0, 10);
        await db.update(processingActivities).set({ lastReviewedAt: today, updatedAt: new Date() }).where(eq(processingActivities.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "gdpr.activity_reviewed", entityType: "processing_activity", entityId: cur.id, details: { note: c.req.valid("json").note ?? null } });
        return c.json(await one(c, cur.id));
      })
      .delete("/:id", requirePerm("gdpr:write"), async (c) => {
        const cur = await row(c, c.req.param("id"));
        await db.delete(processingActivities).where(eq(processingActivities.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "gdpr.activity_deleted", entityType: "processing_activity", entityId: cur.id, details: { name: cur.name } });
        return c.json({ ok: true });
      })

      /* ---------- DPIA ---------- */
      .get("/:id/dpia", requirePerm("gdpr:read"), async (c) => c.json(await dpiaDto(await row(c, c.req.param("id")))))
      .put("/:id/dpia", requirePerm("gdpr:read"), zValidator("json", DpiaInput), async (c) => {
        const cur = await row(c, c.req.param("id"));
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "DPIA zpracovává vlastník nebo správce GDPR" });
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<typeof dpias.$inferInsert>;
        const [existing] = await db.select().from(dpias).where(eq(dpias.activityId, cur.id));
        if (existing?.approvedAt && input.status !== "in_progress") throw new HTTPException(409, { message: "DPIA je schválené – pro úpravu ho vraťte do stavu „Zpracovává se“." });
        if (existing) await db.update(dpias).set({ ...input, ...(input.status === "in_progress" ? { approvedAt: null, approvedById: null } : {}), updatedAt: new Date() }).where(eq(dpias.id, existing.id));
        else await db.insert(dpias).values({ ...input, activityId: cur.id });
        await audit(db, { c, user: currentUser(c), action: "gdpr.dpia_saved", entityType: "processing_activity", entityId: cur.id, details: { status: input.status } });
        return c.json(await dpiaDto(cur));
      })
      .post("/:id/dpia/approve", requirePerm("gdpr:write"), async (c) => {
        const cur = await row(c, c.req.param("id"));
        const [d] = await db.select().from(dpias).where(eq(dpias.activityId, cur.id));
        if (!d) throw new HTTPException(404, { message: "DPIA nenalezeno" });
        if (!(d.risks as unknown[]).length || !d.conclusion?.trim()) throw new HTTPException(400, { message: "Před schválením doplňte rizika a závěr." });
        const next = d.nextReview ?? addMonths(new Date().toISOString().slice(0, 10), 12);
        await db.update(dpias).set({ status: "completed", approvedById: currentUser(c).id, approvedAt: new Date(), nextReview: next, updatedAt: new Date() }).where(eq(dpias.id, d.id));
        await audit(db, { c, user: currentUser(c), action: "gdpr.dpia_approved", entityType: "processing_activity", entityId: cur.id, details: { maxResidual: maxResidual(d.risks as DpiaRisk[]) } });
        return c.json(await dpiaDto(cur));
      })
  );
}
