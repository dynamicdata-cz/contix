import {
  SOC2_CONCLUSIONS,
  SOC2_PBC_TEMPLATE,
  Soc2EngagementInput,
  Soc2EngagementPatch,
  Soc2ExceptionInput,
  Soc2WorkpaperInput,
  soc2CriteriaFor,
  soc2Progress,
  soc2Readiness,
  soc2TestInScope,
  tscCrosswalk,
  type Soc2Category,
  type Soc2Conclusion,
  type Soc2CriterionRow,
  type Soc2Cuec,
  type Soc2DetailDto,
  type Soc2EngagementDto,
  type Soc2EngagementListItem,
  type Soc2Opinion,
  type Soc2ReportType,
  type Soc2Subservice,
  type Soc2TestRow,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { soc2MonitorTests } from "../controls/monitors";
import { assertScope, hasPermIn, inScope, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { auditFindings, auditRequests, audits, controlRequirements, controlTestSamples, controlTests, controls, soc2Engagements, users } from "../../db/schema";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html as h, printPage } from "../documents/render";
import { tFor } from "../i18n/service";
import { soc2ReportBody } from "./report";

/* ============================================================
 * SOC 2 – zakázka auditora a zpráva Type I / II (ADR-091).
 * Zakázka = audit typu soc2 (PBC portál, auditoři, zjištění = výjimky) + soc2_engagements.
 * Matice kritérium → opatření (control_requirements „soc2:…“) → testy v rozsahu → výjimky se počítá při čtení.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof soc2Engagements.$inferSelect;
type WpState = { conclusion: Soc2Conclusion; note: string | null; byId: string | null; at: string | null };

const dto = (e: Row, a: typeof audits.$inferSelect): Soc2EngagementDto => ({
  id: e.id,
  companyId: e.companyId,
  auditId: e.auditId,
  auditStatus: a.status,
  title: a.title,
  reportType: e.reportType as Soc2ReportType,
  categories: e.categories as Soc2Category[],
  asOf: e.asOf,
  periodFrom: e.periodFrom,
  periodTo: e.periodTo,
  systemName: e.systemName,
  serviceOrg: e.serviceOrg,
  serviceAuditor: e.serviceAuditor,
  signatory: e.signatory,
  reportDate: e.reportDate,
  reportPlace: e.reportPlace,
  opinion: e.opinion as Soc2Opinion,
  opinionBasis: e.opinionBasis,
  assertion: e.assertion,
  description: e.description,
  cuecs: e.cuecs as Soc2Cuec[],
  subservice: e.subservice as Soc2Subservice[],
  otherInfo: e.otherInfo,
  updatedAt: e.updatedAt.toISOString(),
});

/** Matice kritérií zakázky (nepersistovat). */
export async function soc2Matrix(db: Db, e: Row): Promise<Soc2CriterionRow[]> {
  const crit = soc2CriteriaFor(e.categories);
  const reqIds = crit.map((c) => `soc2:${c.id}`);
  const links = await db
    .select({ req: controlRequirements.requirementId, id: controls.id, code: controls.code, name: controls.name, description: controls.description })
    .from(controlRequirements)
    .innerJoin(controls, eq(controls.id, controlRequirements.controlId))
    .where(and(inArray(controlRequirements.requirementId, reqIds), eq(controls.companyId, e.companyId)));
  const ctlIds = [...new Set(links.map((l) => l.id))];
  const tests = ctlIds.length ? await db.select().from(controlTests).where(and(inArray(controlTests.controlId, ctlIds), eq(controlTests.companyId, e.companyId))) : [];
  const scope = { reportType: e.reportType as Soc2ReportType, asOf: e.asOf, periodFrom: e.periodFrom, periodTo: e.periodTo };
  const inScopeTests = tests.filter((t) => soc2TestInScope(t, scope));
  const tIds = inScopeTests.map((t) => t.id);
  const samples = tIds.length
    ? await db
        .select({ testId: controlTestSamples.testId, n: sql<number>`count(*)::int`, failed: sql<number>`count(*) filter (where ${controlTestSamples.result} = 'fail')::int` })
        .from(controlTestSamples)
        .where(inArray(controlTestSamples.testId, tIds))
        .groupBy(controlTestSamples.testId)
    : [];
  const sm = new Map(samples.map((s) => [s.testId, s]));
  const findings = await db.select().from(auditFindings).where(eq(auditFindings.auditId, e.auditId));
  const pbc = await db
    .select({ ref: auditRequests.reference, status: auditRequests.status, n: sql<number>`count(*)::int` })
    .from(auditRequests)
    .where(and(eq(auditRequests.auditId, e.auditId), isNotNull(auditRequests.reference)))
    .groupBy(auditRequests.reference, auditRequests.status);
  const wp = e.workpapers as Record<string, WpState>;
  const byIds = [...new Set(Object.values(wp).map((w) => w.byId).filter((x): x is string => !!x))];
  const names = byIds.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, byIds))).map((u) => [u.id, u.n])) : new Map<string, string>();
  return crit.map((c) => {
    const ctl = links.filter((l) => l.req === `soc2:${c.id}`);
    const cIds = new Set(ctl.map((x) => x.id));
    const ts: Soc2TestRow[] = inScopeTests
      .filter((t) => cIds.has(t.controlId))
      .map((t) => ({
        id: t.id,
        controlId: t.controlId,
        kind: t.kind,
        title: t.title,
        methods: t.methods,
        procedure: t.procedure,
        periodFrom: t.periodFrom,
        periodTo: t.periodTo,
        performedAt: t.performedAt,
        status: t.status,
        result: t.result,
        populationSize: t.populationSize,
        samples: sm.get(t.id)?.n ?? 0,
        failed: sm.get(t.id)?.failed ?? 0,
        tester: t.tester,
      }));
    const tSet = new Set(ts.map((t) => t.id));
    const exc = findings
      .filter((f) => f.requirementId === `soc2:${c.id}` || (f.controlTestId && tSet.has(f.controlTestId) && !f.requirementId?.startsWith("soc2:")))
      .map((f) => ({ id: f.id, code: f.code, title: f.title, description: f.description, status: f.status, severity: f.severity, managementResponse: f.correctiveAction, testId: f.controlTestId }));
    const refs = pbc.filter((p) => p.ref?.split(/[\s,;]+/).includes(c.id));
    const cnt = (s: string) => refs.filter((p) => p.status === s).reduce((n, p) => n + p.n, 0);
    const w = wp[c.id];
    return {
      ...c,
      ...tscCrosswalk(c.id),
      controls: [...new Map(ctl.map((x) => [x.id, { id: x.id, code: x.code, name: x.name, description: x.description }])).values()],
      tests: ts,
      exceptions: exc,
      pbc: { total: refs.filter((p) => p.status !== "cancelled").reduce((n, p) => n + p.n, 0), open: cnt("open"), submitted: cnt("submitted"), accepted: cnt("accepted") },
      workpaper: { conclusion: w?.conclusion ?? "pending", note: w?.note ?? null, byName: w?.byId ? (names.get(w.byId) ?? null) : null, at: w?.at ?? null },
    };
  });
}

export function soc2Routes(db: Db) {
  async function load(c: Ctx, id: string) {
    const [r] = await db.select({ e: soc2Engagements, a: audits }).from(soc2Engagements).innerJoin(audits, eq(audits.id, soc2Engagements.auditId)).where(eq(soc2Engagements.id, id));
    if (!r) throw new HTTPException(404, { message: "Zakázka SOC 2 nenalezena" });
    assertScope(c, r.e.companyId, "Zakázka SOC 2 nenalezena");
    return r;
  }
  async function detail(c: Ctx, id: string): Promise<Soc2DetailDto> {
    const { e, a } = await load(c, id);
    const d = dto(e, a);
    const criteria = await soc2Matrix(db, e);
    return { ...d, criteria, progress: soc2Progress(criteria), readiness: soc2Readiness(d, criteria) };
  }

  async function reportOf(c: Ctx, id: string) {
    const d = await detail(c, id);
    const t = await tFor(db, c);
    const s = await settingsFor(db, null, d.companyId);
    const r = soc2ReportBody(d, { org: s.organizationName, locale: t.locale, lbl: (x) => t.lbl(x), fmtDay: (v) => h.day(v) });
    return { ...r, html: printPage(r.title, r.body, t.locale), org: d.serviceOrg?.trim() || s.organizationName };
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "soc2"))
      .get("/", requirePerm("audits:read"), async (c) => {
        const rows = await db.select({ e: soc2Engagements, a: audits }).from(soc2Engagements).innerJoin(audits, eq(audits.id, soc2Engagements.auditId)).where(inScope(c, soc2Engagements.companyId)).orderBy(desc(soc2Engagements.createdAt));
        const out: Soc2EngagementListItem[] = [];
        for (const { e, a } of rows) {
          const d = dto(e, a);
          out.push({ id: d.id, companyId: d.companyId, auditId: d.auditId, auditStatus: d.auditStatus, title: d.title, reportType: d.reportType, categories: d.categories, asOf: d.asOf, periodFrom: d.periodFrom, periodTo: d.periodTo, systemName: d.systemName, progress: soc2Progress(await soc2Matrix(db, e)) });
        }
        return c.json(out);
      })
      .post("/", requirePerm("audits:write"), zValidator("json", Soc2EngagementInput), async (c) => {
        const { companyId: requested, title, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "audits:write");
        const categories = [...new Set(["CC", ...input.categories])] as Soc2Category[];
        const id = await db.transaction(async (tx) => {
          const [a] = await tx
            .insert(audits)
            .values({
              companyId,
              title,
              auditType: "soc2",
              status: "planned",
              scope: `SOC 2 ${input.reportType === "type1" ? "Type I" : "Type II"} – ${input.systemName || title}`,
              plannedStart: input.reportType === "type1" ? input.asOf : input.periodFrom,
              plannedEnd: input.reportType === "type1" ? input.asOf : input.periodTo,
              auditorName: input.serviceAuditor ?? null,
              auditorExternal: true,
              auditorIndependent: true,
            })
            .returning();
          const [e] = await tx.insert(soc2Engagements).values({ ...input, categories, companyId, auditId: a!.id }).returning();
          return e!.id;
        });
        await audit(db, { c, user: currentUser(c), action: "soc2.engagement_created", entityType: "soc2_engagement", entityId: id, details: { title, reportType: input.reportType, categories } });
        return c.json(await detail(c, id), 201);
      })
      .get("/:id", requirePerm("audits:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/:id", requirePerm("audits:write"), zValidator("json", Soc2EngagementPatch), async (c) => {
        const { e } = await load(c, c.req.param("id"));
        const { title, ...rest } = c.req.valid("json");
        const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<typeof soc2Engagements.$inferInsert>;
        if (set.categories) set.categories = [...new Set(["CC", ...set.categories])];
        if (Object.keys(set).length) await db.update(soc2Engagements).set({ ...set, updatedAt: new Date() }).where(eq(soc2Engagements.id, e.id));
        // údaje auditu (název, plán) drží zakázku a seznam auditů v souladu
        const type = set.reportType ?? e.reportType;
        const from = type === "type1" ? (set.asOf !== undefined ? set.asOf : e.asOf) : set.periodFrom !== undefined ? set.periodFrom : e.periodFrom;
        const to = type === "type1" ? (set.asOf !== undefined ? set.asOf : e.asOf) : set.periodTo !== undefined ? set.periodTo : e.periodTo;
        await db
          .update(audits)
          .set({ ...(title ? { title } : {}), plannedStart: from ?? null, plannedEnd: to ?? null, ...(set.serviceAuditor !== undefined ? { auditorName: set.serviceAuditor } : {}), updatedAt: new Date() })
          .where(eq(audits.id, e.auditId));
        await audit(db, { c, user: currentUser(c), action: "soc2.engagement_updated", entityType: "soc2_engagement", entityId: e.id, details: { fields: Object.keys(set), title } });
        return c.json(await detail(c, e.id));
      })
      .delete("/:id", requirePerm("audits:write"), async (c) => {
        const { e, a } = await load(c, c.req.param("id"));
        if (a.status === "completed") throw new HTTPException(409, { message: "Dokončenou zakázku SOC 2 nelze smazat." });
        await db.delete(audits).where(eq(audits.id, e.auditId));
        await audit(db, { c, user: currentUser(c), action: "soc2.engagement_deleted", entityType: "soc2_engagement", entityId: e.id, details: { title: a.title } });
        return c.json({ ok: true });
      })

      /* ---------- pracovní papíry ke kritériím ---------- */
      .put("/:id/workpapers/:criterion", requirePerm("audits:write"), zValidator("json", Soc2WorkpaperInput), async (c) => {
        const { e } = await load(c, c.req.param("id"));
        const crit = c.req.param("criterion");
        if (!soc2CriteriaFor(e.categories).some((x) => x.id === crit)) throw new HTTPException(404, { message: "Kritérium není v rozsahu zakázky" });
        const { conclusion, note } = c.req.valid("json");
        if (!(SOC2_CONCLUSIONS as readonly string[]).includes(conclusion)) throw new HTTPException(400, { message: "Neplatný závěr" });
        const next = { ...(e.workpapers as Record<string, WpState>), [crit]: { conclusion, note: note ?? null, byId: currentUser(c).id, at: new Date().toISOString() } };
        await db.update(soc2Engagements).set({ workpapers: next, updatedAt: new Date() }).where(eq(soc2Engagements.id, e.id));
        await audit(db, { c, user: currentUser(c), action: "soc2.workpaper_updated", entityType: "soc2_engagement", entityId: e.id, details: { criterion: crit, conclusion } });
        return c.json(await detail(c, e.id));
      })

      /* ---------- výjimka (zjištění auditu) z testu ---------- */
      .post("/:id/exceptions", requirePerm("audits:write"), zValidator("json", Soc2ExceptionInput), async (c) => {
        const { e } = await load(c, c.req.param("id"));
        const input = c.req.valid("json");
        if (!soc2CriteriaFor(e.categories).some((x) => x.id === input.criterion)) throw new HTTPException(404, { message: "Kritérium není v rozsahu zakázky" });
        if (input.testId) {
          const [t] = await db.select({ companyId: controlTests.companyId }).from(controlTests).where(eq(controlTests.id, input.testId));
          if (!t || t.companyId !== e.companyId) throw new HTTPException(404, { message: "Test nenalezen" });
        }
        const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(auditFindings).where(eq(auditFindings.auditId, e.auditId));
        const [f] = await db
          .insert(auditFindings)
          .values({ auditId: e.auditId, code: `EX-${String((n?.n ?? 0) + 1).padStart(2, "0")}`, title: input.title, description: input.description ?? null, severity: "minor", requirementId: `soc2:${input.criterion}`, controlTestId: input.testId ?? null })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "soc2.exception_created", entityType: "soc2_engagement", entityId: e.id, details: { findingId: f!.id, criterion: input.criterion } });
        return c.json(await detail(c, e.id), 201);
      })

      /* ---------- standardní požadavky na podklady ---------- */
      .post("/:id/pbc-template", requirePerm("audits:write"), async (c) => {
        const { e } = await load(c, c.req.param("id"));
        const t = await tFor(db, c);
        const crit = new Set(soc2CriteriaFor(e.categories).map((x) => x.id));
        const existing = await db.select({ title: auditRequests.title, seq: auditRequests.seq }).from(auditRequests).where(eq(auditRequests.auditId, e.auditId));
        const have = new Set(existing.map((x) => x.title));
        let seq = existing.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
        const items = SOC2_PBC_TEMPLATE.filter((p) => crit.has(p.ref) && (e.reportType === "type2" || !p.type2))
          .map((p) => ({ title: t.locale === "en" ? p.en : p.cs, reference: p.ref }))
          .filter((p) => !have.has(p.title));
        if (items.length) await db.insert(auditRequests).values(items.map((x) => ({ ...x, auditId: e.auditId, seq: seq++, createdById: currentUser(c).id })));
        await audit(db, { c, user: currentUser(c), action: "soc2.pbc_template_applied", entityType: "soc2_engagement", entityId: e.id, details: { created: items.length } });
        return c.json({ created: items.length });
      })

      /** Testy provozní účinnosti za období zprávy z průběžného monitorování (ADR-096). */
      .post("/:id/monitor-tests", requirePerm("audits:write"), async (c) => {
        const { e } = await load(c, c.req.param("id"));
        if (e.reportType !== "type2" || !e.periodFrom || !e.periodTo) throw new HTTPException(400, { message: "Testy z monitorování jsou pro zprávu Type II s vyplněným obdobím." });
        if (!hasPermIn(c, "controls:test", e.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const reqIds = soc2CriteriaFor(e.categories).map((x) => `soc2:${x.id}`);
        const ctl = await db.selectDistinct({ id: controlRequirements.controlId }).from(controlRequirements).innerJoin(controls, eq(controls.id, controlRequirements.controlId)).where(and(inArray(controlRequirements.requirementId, reqIds), eq(controls.companyId, e.companyId)));
        const r = await soc2MonitorTests(db, e.companyId, ctl.map((x) => x.id), e.periodFrom, e.periodTo, currentUser(c).id);
        await audit(db, { c, user: currentUser(c), action: "soc2.monitor_tests", entityType: "soc2_engagement", entityId: e.id, details: { created: r.created.length, skipped: r.skipped, failed: r.failed.length } });
        return c.json({ created: r.created.length, skipped: r.skipped, failed: r.failed });
      })

      /* ---------- zpráva ---------- */
      .get("/:id/report.html", requirePerm("audits:read"), async (c) => {
        const r = await reportOf(c, c.req.param("id"));
        return c.html(r.html, 200, { "cache-control": "private, no-store" });
      })
      .get("/:id/report.docx", requirePerm("audits:read"), async (c) => {
        const id = c.req.param("id");
        const r = await reportOf(c, id);
        await audit(db, { c, user: currentUser(c), action: "soc2.report_exported", entityType: "soc2_engagement", entityId: id, details: { format: "docx" } });
        return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: r.org }), `${r.title}.docx`);
      })
  );
}
