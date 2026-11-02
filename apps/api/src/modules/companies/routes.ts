import {
  BUILTIN_RISK_METHODOLOGY,
  regulatoryPack,
  profileOf,
  CompanyInput,
  CompanyPatch,
  companyTree,
  descendantsOf,
  isAcceptable,
  riskScore,
  ROOT_COMPANY_ID,
  type CompanyDto,
  type CompanyOverrides,
  validateBounds,
  TransferInput,
  portfolio,
} from "@contix/shared";
import { cycleStatus } from "../cycles/routes";
import { transferRecords } from "./transfer";
import { zValidator } from "@hono/zod-validator";
import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { companySettings, getCompanies, invalidateCompanies, scopeOf, type CompanyRow } from "../../auth/scope";
import { audit, getSettings, updateSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { companies, continuityPlans, incidents, risks, riskTreatmentActions, trendSnapshots, recordVectors } from "../../db/schema";
import { loadRequirementRows, summarize } from "../controls/routes";
import { reviewStatus } from "../isms/routes";
import { loadIncidents } from "../incidents/routes";
import { loadSuppliers } from "../suppliers/routes";

/** Vlastní metodika rizik společnosti musí existovat a mít platné hranice. */
function checkOverrides(o: CompanyOverrides | null | undefined) {
  const err = o?.riskPolicy ? validateBounds(o.riskPolicy) : null;
  if (err) throw new HTTPException(400, { message: err });
}

function dto(rows: CompanyRow[]): CompanyDto[] {
  return companyTree(rows).map((r) => ({
    id: r.id,
    parentId: r.parentId,
    kind: r.kind,
    name: r.name,
    shortName: r.shortName,
    ico: r.ico,
    address: r.address,
    regulatedServices: r.regulatedServices,
    regime: r.regime as CompanyDto["regime"],
    pack: (r.pack as CompanyDto["pack"]) ?? "cz",
    primaryFramework: r.primaryFramework ?? null,
    doraEntity: r.doraEntity ?? false,
    active: r.active,
    overrides: r.overrides ?? {},
    depth: r.depth,
    path: r.path,
  }));
}

/**
 * Změna balíčku kořenové společnosti (ADR-080): výchozí metodika rizik skupiny se přepne na doporučenou metodiku
 * nového balíčku – jen když se dosud používala výchozí metodika původního balíčku (vlastní volbu nemění).
 */
export async function switchRiskMethodology(db: Db, oldPack: string, newPack: string) {
  const s = await getSettings(db);
  const from = regulatoryPack(oldPack).riskMethodology;
  const to = regulatoryPack(newPack).riskMethodology;
  if (from !== to && (s.riskPolicy.methodology || BUILTIN_RISK_METHODOLOGY) === from) await updateSettings(db, { riskPolicy: { ...s.riskPolicy, methodology: to } });
}

/** Skupina společností: správa (Administrace → Společnosti) a souhrnný přehled skupiny. */
export function companyRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .get("/", requirePerm("admin:settings"), async (c) => c.json(dto(await getCompanies(db))))
      .post("/", requirePerm("admin:settings"), zValidator("json", CompanyInput), async (c) => {
        const input = c.req.valid("json");
        checkOverrides(input.overrides);
        const all = await getCompanies(db);
        const parentId = input.parentId ?? ROOT_COMPANY_ID;
        if (!all.some((x) => x.id === parentId)) throw new HTTPException(400, { message: "Nadřazená společnost neexistuje" });
        const [row] = await db
          .insert(companies)
          .values({ ...input, ...(input.pack === "generic" ? { regime: "none" } : {}), parentId, ico: input.ico || null })
          .returning();
        invalidateCompanies();
        await audit(db, { c, user: currentUser(c), action: "company.created", entityType: "company", entityId: row!.id, details: { name: row!.name } });
        return c.json(dto(await getCompanies(db)).find((x) => x.id === row!.id), 201);
      })
      .patch("/:id", requirePerm("admin:settings"), zValidator("json", CompanyPatch), async (c) => {
        const id = c.req.param("id");
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<CompanyRow>;
        checkOverrides(input.overrides);
        const all = await getCompanies(db);
        if (!all.some((x) => x.id === id)) throw new HTTPException(404, { message: "Společnost nenalezena" });
        if (id === ROOT_COMPANY_ID) {
          if (input.parentId) throw new HTTPException(400, { message: "Kořenová společnost nemá nadřazenou" });
          if (input.active === false) throw new HTTPException(400, { message: "Kořenovou společnost nelze deaktivovat" });
          delete input.parentId;
        } else if ("parentId" in input) {
          if (!input.parentId) throw new HTTPException(400, { message: "Společnost musí mít nadřazenou (holding)" });
          if (descendantsOf(all, id).includes(input.parentId)) throw new HTTPException(400, { message: "Společnost nemůže být podřízena sama sobě" });
          if (!all.some((x) => x.id === input.parentId)) throw new HTTPException(400, { message: "Nadřazená společnost neexistuje" });
        }
        if ("ico" in input) input.ico = input.ico || null;
        // obecný balíček nemá české úrovně povinností (ADR-080)
        if (input.pack === "generic") input.regime = "none";
        const prev = all.find((x) => x.id === id)!;
        await db.update(companies).set({ ...input, updatedAt: new Date() }).where(eq(companies.id, id));
        if (id === ROOT_COMPANY_ID && input.pack && input.pack !== prev.pack) await switchRiskMethodology(db, prev.pack, input.pack);
        invalidateCompanies();
        await audit(db, { c, user: currentUser(c), action: "company.updated", entityType: "company", entityId: id, details: input });
        return c.json(dto(await getCompanies(db)).find((x) => x.id === id));
      })
      .delete("/:id", requirePerm("admin:settings"), async (c) => {
        const id = c.req.param("id");
        if (id === ROOT_COMPANY_ID) throw new HTTPException(400, { message: "Kořenovou společnost nelze smazat" });
        const all = await getCompanies(db);
        if (all.some((x) => x.parentId === id)) throw new HTTPException(409, { message: "Společnost má dceřiné společnosti – nejdřív je přesuňte." });
        try {
          // odvozené snímky trendů se mažou se společností (jinak by bránily smazání prázdné společnosti)
          const [row] = await db.transaction(async (tx) => {
            await tx.delete(trendSnapshots).where(eq(trendSnapshots.companyId, id));
            await tx.delete(recordVectors).where(eq(recordVectors.companyId, id));
            return tx.delete(companies).where(eq(companies.id, id)).returning({ name: companies.name });
          });
          if (!row) throw new HTTPException(404, { message: "Společnost nenalezena" });
          invalidateCompanies();
          await audit(db, { c, user: currentUser(c), action: "company.deleted", entityType: "company", entityId: id, details: row });
          return c.body(null, 204);
        } catch (e) {
          if (e instanceof HTTPException) throw e;
          throw new HTTPException(409, { message: "Společnost má evidovaná data (aktiva, rizika, uživatele…). Deaktivujte ji místo smazání." });
        }
      })

      /** Souhrnný přehled skupiny – klíčové ukazatele za každou dostupnou společnost. */
      /** Přesun záznamů do jiné společnosti (oprávnění k zápisu ve zdrojové i cílové společnosti). */
      .post("/transfer", zValidator("json", TransferInput), async (c) => c.json(await transferRecords(db, c, c.req.valid("json"))))
      .get("/overview", async (c) => {
        const s = scopeOf(c);
        const ids = s.accessible;
        const all = await getCompanies(db);
        const base = await getSettings(db);
        const rows = companyTree(all.filter((x) => ids.includes(x.id) && x.active));
        const can = (id: string, p: string) => !!s.byCompany.get(id)?.has(p as never);
        const [riskRows, overdueActions, planRows, incidentRows, supplierRows] = await Promise.all([
          db.select().from(risks).where(inArray(risks.companyId, ids.length ? ids : [ROOT_COMPANY_ID])),
          db
            .select({ companyId: risks.companyId, n: sql<number>`count(*)::int` })
            .from(riskTreatmentActions)
            .innerJoin(risks, eq(risks.id, riskTreatmentActions.riskId))
            .where(sql`${riskTreatmentActions.dueDate} < current_date and ${riskTreatmentActions.status} in ('planned','in_progress')`)
            .groupBy(risks.companyId),
          db.select({ companyId: continuityPlans.companyId, status: continuityPlans.status }).from(continuityPlans),
          base.enabledModules.includes("incidents") ? loadIncidents(db, inArray(incidents.companyId, ids.length ? ids : [ROOT_COMPANY_ID])) : Promise.resolve([]),
          base.enabledModules.includes("suppliers") ? loadSuppliers(db) : Promise.resolve([]),
        ]);
        const out = [];
        for (const co of rows) {
          const cs = companySettings(base, all, co.id);
          const fw = profileOf(cs).defaultFramework;
          const compliance = base.enabledModules.includes("controls") && can(co.id, "controls:read") ? summarize(fw, await loadRequirementRows(db, co.id, fw)).score : null;
          const rs = riskRows.filter((r) => r.companyId === co.id && r.status !== "closed");
          const scored = rs.map((r) => ({ l: riskScore(cs.riskPolicy, r, r.scaleLevels).level, mk: r.methodologyKey }));
          const levels = scored.map((x) => x.l);
          const inc = incidentRows.filter((i) => i.companyId === co.id);
          const sup = supplierRows.filter((x) => x.companyId === co.id && x.significant && x.status === "active");
          const rev = base.enabledModules.includes("isms") ? await reviewStatus(db, co.id) : null;
          out.push({
            id: co.id,
            name: co.name,
            kind: co.kind,
            depth: co.depth,
            regime: cs.regime,
            framework: fw,
            compliance,
            risks: can(co.id, "risks:read")
              ? {
                  total: rs.length,
                  critical: levels.filter((l) => l === "critical").length,
                  high: levels.filter((l) => l === "high").length,
                  unacceptable: scored.filter((x) => x.l && !isAcceptable(cs.riskPolicy, x.l, x.mk)).length,
                  overdueActions: overdueActions.find((x) => x.companyId === co.id)?.n ?? 0,
                  ale: rs.some((r) => r.quant) ? (portfolio(rs.filter((r) => r.quant).map((r) => ({ key: r.id, q: r.quant! })), cs.riskPolicy.quant)?.mean ?? null) : null,
                  cycle: base.enabledModules.includes("risks") ? await cycleStatus(db, co.id, "risk") : null,
                }
              : null,
            incidents: can(co.id, "incidents:read")
              ? {
                  open: inc.filter((i) => i.kind === "incident" && i.status !== "closed").length,
                  overdueReports: inc.reduce((n, i) => n + i.overdueReports, 0),
                }
              : null,
            plans: can(co.id, "bia:read")
              ? { approved: planRows.filter((p) => p.companyId === co.id && p.status === "approved").length, biaCycle: base.enabledModules.includes("continuity") ? await cycleStatus(db, co.id, "bia") : null }
              : null,
            suppliers: can(co.id, "suppliers:read") ? { significant: sup.length, withGaps: sup.filter((x) => x.gaps.length).length } : null,
            review: rev && can(co.id, "isms:read") ? { lastApprovedAt: rev.lastReview?.approvedAt ?? null, nextDue: rev.nextReviewDue, overdue: rev.reviewOverdue } : null,
          });
        }
        return c.json(out);
      })
  );
}
