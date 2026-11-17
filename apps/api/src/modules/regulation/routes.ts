import {
  REGULATED_SERVICES,
  RegulationAssessmentInput,
  RegistrationData,
  RegistrationNotifiedInput,
  evaluateRegulation,
  regulatedService,
  sizeFromInput,
  type EnterpriseSize,
  type RegulationAssessmentDto,
  type RsResult,
  type RsSubjectKind,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requirePerm } from "../../auth/middleware";
import { getCompanies, hasPermIn, invalidateCompanies } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { companies, orgUnits, positions, regulationAssessments, suppliers, users } from "../../db/schema";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html, printPage } from "../documents/render";
import { markNotified, registrationDto, registrationHtml, saveRegistration, touchRegistration } from "./registration";

/* ============================================================
 * Určení regulace (v1.61, ADR-156): sebeidentifikace podle přílohy vyhl. 408/2025 – vlastní společnost
 * (výsledek lze zapsat do regulatorního profilu) nebo dodavatel (zda je sám poskytovatelem regulované služby).
 * Velikost a režim počítá server znovu (stejná funkce jako náhled v prohlížeči). Historie posouzení se nemaže.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof regulationAssessments.$inferSelect;

export function regulationRoutes(db: Db) {
  /** Společnost záznamu a ověření oprávnění (čtení / zápis). */
  const subjectCompany = async (c: Ctx, kind: RsSubjectKind, id: string, write: boolean): Promise<{ companyId: string; name: string; pack?: string }> => {
    if (kind === "company") {
      const co = (await getCompanies(db)).find((x) => x.id === id);
      if (!co || !hasPermIn(c, "admin:settings", co.id)) throw new HTTPException(404, { message: "Společnost nenalezena" });
      return { companyId: co.id, name: co.name, pack: co.pack };
    }
    const [s] = await db.select({ id: suppliers.id, companyId: suppliers.companyId, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, id));
    if (!s || !hasPermIn(c, write ? "suppliers:write" : "suppliers:read", s.companyId)) throw new HTTPException(404, { message: "Dodavatel nenalezen" });
    return { companyId: s.companyId, name: s.name };
  };
  const ownCompany = async (c: Ctx, id: string) => {
    const co = (await getCompanies(db)).find((x) => x.id === id);
    if (!co || !hasPermIn(c, "admin:settings", co.id)) throw new HTTPException(404, { message: "Společnost nenalezena" });
    return co;
  };
  const dto = (r: Row, by: string | null): RegulationAssessmentDto => ({
    id: r.id,
    companyId: r.companyId,
    subjectKind: r.subjectKind as RsSubjectKind,
    subjectId: r.subjectId,
    ico: r.ico,
    staff: r.staff,
    turnoverMCzk: r.turnoverMCzk,
    balanceMCzk: r.balanceMCzk,
    eurRate: r.eurRate,
    sizeOverride: r.sizeOverride as EnterpriseSize | null,
    size: r.size as EnterpriseSize | null,
    sizeBasis: r.sizeBasis as RegulationAssessmentDto["sizeBasis"],
    linkedNote: r.linkedNote,
    services: r.services,
    result: r.result as unknown as RsResult,
    note: r.note,
    res: r.res ?? null,
    applied: r.applied,
    assessedByName: by,
    assessedAt: r.assessedAt.toISOString(),
  });

  return new Hono<AppEnv>()
    .get("/assessments", requirePerm("admin:settings", "suppliers:read"), zValidator("query", z.object({ subjectKind: z.enum(["company", "supplier"]), subjectId: z.string().uuid() })), async (c) => {
      const q = c.req.valid("query");
      if (!hasPerm(c, q.subjectKind === "company" ? "admin:settings" : "suppliers:read")) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      await subjectCompany(c, q.subjectKind, q.subjectId, false);
      const rows = await db
        .select({ r: regulationAssessments, by: users.displayName })
        .from(regulationAssessments)
        .leftJoin(users, eq(users.id, regulationAssessments.assessedById))
        .where(and(eq(regulationAssessments.subjectKind, q.subjectKind), eq(regulationAssessments.subjectId, q.subjectId)))
        .orderBy(desc(regulationAssessments.assessedAt))
        .limit(50);
      return c.json(rows.map(({ r, by }) => dto(r, by)));
    })
    .post("/assessments", requirePerm("admin:settings", "suppliers:write"), zValidator("json", RegulationAssessmentInput), async (c) => {
      const i = c.req.valid("json");
      if (!hasPerm(c, i.subjectKind === "company" ? "admin:settings" : "suppliers:write")) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      const subj = await subjectCompany(c, i.subjectKind, i.subjectId, true);
      const unknown = i.services.find((s) => !regulatedService(s.code));
      if (unknown) throw new HTTPException(400, { message: `Neznámá služba ${unknown.code}` });
      if (i.apply && i.subjectKind !== "company") throw new HTTPException(400, { message: "Režim lze zapsat jen vlastní společnosti" });
      if (i.apply && subj.pack !== "cz") throw new HTTPException(400, { message: "Režim podle vyhl. 408 lze zapsat jen společnosti s českým regulatorním balíčkem" });
      const sz = sizeFromInput(i);
      const result = evaluateRegulation(sz.size, i.services);
      const me = currentUser(c);
      const [row] = await db
        .insert(regulationAssessments)
        .values({
          companyId: subj.companyId,
          subjectKind: i.subjectKind,
          subjectId: i.subjectId,
          ico: i.ico,
          staff: i.staff,
          turnoverMCzk: i.turnoverMCzk,
          balanceMCzk: i.balanceMCzk,
          eurRate: i.eurRate,
          sizeOverride: i.sizeOverride,
          size: sz.size,
          sizeBasis: sz.basis,
          linkedNote: i.linkedNote,
          services: i.services,
          result: result as unknown as Record<string, unknown>,
          regime: result.regime,
          note: i.note,
          res: i.res,
          applied: i.apply,
          assessedById: me.id,
        })
        .returning();
      if (i.apply) {
        const regulated = result.services.filter((s) => s.regime);
        const text = regulated.length ? regulated.map((s) => `${s.code} ${REGULATED_SERVICES.find((d) => d.code === s.code)!.name} (${s.regime === "higher" ? "vyšší" : "nižší"} povinnosti)`).join("\n") : "Žádná regulovaná služba podle vyhl. 408/2025";
        await db.update(companies).set({ regime: result.regime, regulatedServices: text, updatedAt: new Date() }).where(eq(companies.id, i.subjectId));
        invalidateCompanies();
        await touchRegistration(db, i.subjectId);
      }
      await audit(db, { c, user: me, action: "regulation.assessed", entityType: i.subjectKind, entityId: i.subjectId, details: { name: subj.name, regime: result.regime, size: sz.size, services: result.services.filter((s) => s.regime).map((s) => `${s.code}:${s.regime}`), applied: i.apply } });
      return c.json(dto(row!, me.displayName ?? null), 201);
    })

    /* ---- ohlášení regulované služby NÚKIB (v1.63) ---- */
    .get("/registration/:companyId", requirePerm("admin:settings"), async (c) => {
      const co = await ownCompany(c, c.req.param("companyId"));
      return c.json(await registrationDto(db, co.id));
    })
    .put("/registration/:companyId", requirePerm("admin:settings"), zValidator("json", RegistrationData), async (c) => {
      const co = await ownCompany(c, c.req.param("companyId"));
      const data = c.req.valid("json");
      if (data.responsiblePositionId) {
        const [p] = await db.select({ companyId: orgUnits.companyId }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(positions.id, data.responsiblePositionId));
        if (!p) throw new HTTPException(400, { message: "Funkční místo neexistuje" });
      }
      await saveRegistration(db, co.id, data);
      await audit(db, { c, user: currentUser(c), action: "regulation.registration_saved", entityType: "company", entityId: co.id, details: { name: co.name } });
      return c.json(await registrationDto(db, co.id));
    })
    .post("/registration/:companyId/notified", requirePerm("admin:settings"), zValidator("json", RegistrationNotifiedInput), async (c) => {
      const co = await ownCompany(c, c.req.param("companyId"));
      const i = c.req.valid("json");
      const d = await markNotified(db, co.id, i.notifiedAt, i.notifiedRef);
      await audit(db, { c, user: currentUser(c), action: "regulation.notified", entityType: "company", entityId: co.id, details: { name: co.name, notifiedAt: i.notifiedAt, ref: i.notifiedRef } });
      return c.json(d);
    })
    .get("/registration/:companyId/print.html", requirePerm("admin:settings"), async (c) => {
      const co = await ownCompany(c, c.req.param("companyId"));
      const r = registrationHtml((await registrationDto(db, co.id))!, html.esc);
      return c.html(printPage(r.title, r.body), 200, { "cache-control": "private, no-store" });
    })
    .get("/registration/:companyId/print.docx", requirePerm("admin:settings"), async (c) => {
      const co = await ownCompany(c, c.req.param("companyId"));
      const r = registrationHtml((await registrationDto(db, co.id))!, html.esc);
      return docxResponse(await htmlToDocx(r.body, { title: r.title }), `${r.title}.docx`);
    });
}
