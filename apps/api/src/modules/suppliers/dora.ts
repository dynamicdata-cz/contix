/** DORA – registr informací (ADR-069): sestavení z dodavatelů, smluv, procesů a BIA; doplňkové údaje; export CSV šablon. */
import {
  buildDoraRegister,
  DoraContractInput,
  DoraEntity,
  DoraFunctionInput,
  DoraProvider,
  doraCsv,
  type DoraContractIn,
  type DoraFunctionIn,
  type DoraProviderIn,
  type DoraRegister,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray } from "drizzle-orm";
import { strToU8, zipSync, type Zippable } from "fflate";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, getCompanies, hasPermIn, inScope, invalidateCompanies, scopeOf } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { biaAssessments, companies, processes, supplierContractProcesses, supplierContracts, suppliers } from "../../db/schema";

type Ctx = Context<AppEnv>;

/** Vstupy registru pro společnosti v rozsahu uživatele. */
export async function doraRegisterFor(db: Db, c: Ctx): Promise<DoraRegister> {
  const s = scopeOf(c);
  const all = await getCompanies(db);
  const reporting = s.active ?? (s.ids.includes(s.home) ? s.home : (s.ids[0] ?? all[0]!.id));
  return doraRegisterOf(db, s.ids, reporting);
}

/** Registr za zadané společnosti (zpráva pro vedení – KPI třetích stran IKT, ADR-086). */
export async function doraRegisterOf(db: Db, companyIds: string[], reporting: string): Promise<DoraRegister> {
  const all = await getCompanies(db);
  const supRows = companyIds.length ? await db.select().from(suppliers).where(inArray(suppliers.companyId, companyIds)) : [];
  const supIds = supRows.map((x) => x.id);
  const conRows = supIds.length ? await db.select().from(supplierContracts).where(inArray(supplierContracts.supplierId, supIds)) : [];
  const conIds = conRows.map((x) => x.id);
  const links = conIds.length ? await db.select().from(supplierContractProcesses).where(inArray(supplierContractProcesses.contractId, conIds)) : [];
  const procIds = [...new Set(links.map((l) => l.processId))];
  const [procRows, biaRows] = procIds.length
    ? await Promise.all([db.select().from(processes).where(inArray(processes.id, procIds)), db.select().from(biaAssessments).where(inArray(biaAssessments.processId, procIds))])
    : [[], []];
  const bia = new Map(biaRows.map((b) => [b.processId, b]));
  const providers: DoraProviderIn[] = supRows.map((x) => ({ supplierId: x.id, companyId: x.companyId, name: x.name, ico: x.ico, dora: x.dora ?? {} }));
  const contracts: DoraContractIn[] = conRows.map((k) => ({
    contractId: k.id,
    supplierId: k.supplierId,
    title: k.title,
    number: k.number,
    validFrom: k.validFrom,
    validTo: k.validTo,
    exitStrategy: k.exitStrategy,
    processIds: links.filter((l) => l.contractId === k.id).map((l) => l.processId),
    dora: k.dora ?? {},
  }));
  const functions: DoraFunctionIn[] = procRows.map((p) => {
    const b = bia.get(p.id);
    return {
      processId: p.id,
      companyId: p.companyId,
      functionNo: p.functionNo,
      name: p.name,
      criticality: p.criticality,
      activity: p.doraActivity,
      bia: b ? { assessedAt: b.assessedAt, rtoHours: b.rtoHours, rpoHours: b.rpoHours, approved: b.status === "approved" } : null,
    };
  });
  return buildDoraRegister({
    entities: all.map((co) => ({ companyId: co.id, name: co.name, ico: co.ico, parentCompanyId: co.parentId, dora: co.dora ?? {} })),
    providers,
    contracts,
    functions,
    reportingCompanyId: reporting,
  });
}

export function doraRoutes(db: Db) {
  const supplierOf = async (c: Ctx, id: string) => {
    const [r] = await db.select({ id: suppliers.id, companyId: suppliers.companyId, dora: suppliers.dora }).from(suppliers).where(eq(suppliers.id, id));
    assertScope(c, r?.companyId, "Dodavatel nenalezen");
    if (!hasPermIn(c, "suppliers:write", r!.companyId)) throw new HTTPException(403, { message: "Nemáte oprávnění v této společnosti" });
    return r!;
  };
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "suppliers"))
    .get("/", requirePerm("suppliers:read"), async (c) => {
      const { templates, ...r } = await doraRegisterFor(db, c);
      void templates;
      const all = await getCompanies(db);
      const scope = scopeOf(c).ids;
      // dodavatelé, kteří (zatím) nejsou poskytovatelem IKT – významní podle vyhlášky první (kandidáti na zařazení)
      const others = (await db.select({ id: suppliers.id, name: suppliers.name, significant: suppliers.significant, dora: suppliers.dora, status: suppliers.status }).from(suppliers).where(inScope(c, suppliers.companyId)))
        .filter((x) => !x.dora?.ict && x.status === "active")
        .sort((a, b) => Number(b.significant) - Number(a.significant) || a.name.localeCompare(b.name))
        .map(({ id, name, significant }) => ({ id, name, significant }));
      return c.json({ ...r, others, companies: all.filter((x) => scope.includes(x.id)).map((x) => ({ id: x.id, name: x.name, dora: x.dora ?? {} })) });
    })
    .get("/export.zip", requirePerm("suppliers:read"), async (c) => {
      const r = await doraRegisterFor(db, c);
      const files: Zippable = {};
      for (const [code, rows] of Object.entries(r.templates)) files[`${code}.csv`] = strToU8(doraCsv(rows));
      files["README.txt"] = strToU8(
        "Registr informaci DORA (prováděcí nařízení Komise (EU) 2024/2956) - soubory CSV v rozvržení sloupcu šablon B_01-B_07.\r\n" +
          "Ciselniky jsou uvedeny poradovym cislem moznosti podle ITS (ano/ne = true/false). Prevod do balicku xBRL-CSV pro podani provede nastroj pro vykaznictvi.\r\n",
      );
      await audit(db, { c, user: currentUser(c), action: "dora.exported", entityType: "supplier", details: { contracts: r.summary.contracts, findings: r.summary.findings } });
      return new Response(zipSync(files), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="dora-registr-informaci.zip"` } });
    })
    .put("/entities/:companyId", requirePerm("suppliers:write"), zValidator("json", DoraEntity), async (c) => {
      const companyId = c.req.param("companyId");
      assertScope(c, companyId, "Společnost nenalezena");
      if (!hasPermIn(c, "suppliers:write", companyId)) throw new HTTPException(403, { message: "Nemáte oprávnění v této společnosti" });
      const dora = c.req.valid("json");
      await db.update(companies).set({ dora, updatedAt: new Date() }).where(eq(companies.id, companyId));
      invalidateCompanies();
      await audit(db, { c, user: currentUser(c), action: "dora.entity_updated", entityType: "company", entityId: companyId, details: dora });
      return c.json({ ok: true });
    })
    .put("/providers/:supplierId", requirePerm("suppliers:write"), zValidator("json", DoraProvider), async (c) => {
      const s = await supplierOf(c, c.req.param("supplierId"));
      const dora = c.req.valid("json");
      await db.update(suppliers).set({ dora, updatedAt: new Date() }).where(eq(suppliers.id, s.id));
      await audit(db, { c, user: currentUser(c), action: "dora.provider_updated", entityType: "supplier", entityId: s.id, details: dora });
      return c.json({ ok: true });
    })
    .get("/contracts/:contractId", requirePerm("suppliers:read"), async (c) => {
      const [k] = await db.select().from(supplierContracts).where(eq(supplierContracts.id, c.req.param("contractId")));
      if (!k) throw new HTTPException(404, { message: "Smlouva nenalezena" });
      const [s] = await db.select({ companyId: suppliers.companyId }).from(suppliers).where(eq(suppliers.id, k.supplierId));
      assertScope(c, s?.companyId, "Smlouva nenalezena");
      const links = await db.select().from(supplierContractProcesses).where(eq(supplierContractProcesses.contractId, k.id));
      return c.json({ ...k.dora, processIds: links.map((l) => l.processId) });
    })
    .put("/contracts/:contractId", requirePerm("suppliers:write"), zValidator("json", DoraContractInput), async (c) => {
      const contractId = c.req.param("contractId");
      const [k] = await db.select({ id: supplierContracts.id, supplierId: supplierContracts.supplierId }).from(supplierContracts).where(eq(supplierContracts.id, contractId));
      if (!k) throw new HTTPException(404, { message: "Smlouva nenalezena" });
      const s = await supplierOf(c, k.supplierId);
      const { processIds, ...dora } = c.req.valid("json");
      const ids = [...new Set(processIds)];
      if (ids.length) {
        const ok = await db.select({ id: processes.id, companyId: processes.companyId }).from(processes).where(inArray(processes.id, ids));
        if (ok.length !== ids.length) throw new HTTPException(400, { message: "Neplatný proces" });
        for (const p of ok) assertScope(c, p.companyId, "Neplatný proces");
      }
      if (dora.overarchingContractId) {
        if (dora.overarchingContractId === contractId) throw new HTTPException(400, { message: "Smlouva nemůže zastřešovat sama sebe" });
        const [o] = await db.select({ id: supplierContracts.id }).from(supplierContracts).where(and(eq(supplierContracts.id, dora.overarchingContractId), inArray(supplierContracts.supplierId, [s.id])));
        if (!o) throw new HTTPException(400, { message: "Zastřešující smlouva musí patřit stejnému dodavateli" });
      }
      await db.update(supplierContracts).set({ dora, updatedAt: new Date() }).where(eq(supplierContracts.id, contractId));
      await db.delete(supplierContractProcesses).where(eq(supplierContractProcesses.contractId, contractId));
      if (ids.length) await db.insert(supplierContractProcesses).values(ids.map((processId) => ({ contractId, processId })));
      await audit(db, { c, user: currentUser(c), action: "dora.contract_updated", entityType: "supplier", entityId: s.id, details: { contractId, ...dora, processIds: ids } });
      return c.json({ ok: true });
    })
    .put("/functions/:processId", requirePerm("processes:write"), zValidator("json", DoraFunctionInput), async (c) => {
      const id = c.req.param("processId");
      const [p] = await db.select({ companyId: processes.companyId }).from(processes).where(eq(processes.id, id));
      assertScope(c, p?.companyId, "Proces nenalezen");
      const activity = c.req.valid("json").activity || null;
      await db.update(processes).set({ doraActivity: activity, updatedAt: new Date() }).where(eq(processes.id, id));
      await audit(db, { c, user: currentUser(c), action: "dora.function_updated", entityType: "process", entityId: id, details: { activity } });
      return c.json({ ok: true });
    });
}
