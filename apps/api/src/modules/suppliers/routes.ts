import {
  CLAUSE_LABELS,
  CLAUSE_SETS,
  ContractInput,
  ContractPatch,
  missingClauses,
  riskScore,
  SupplierInput,
  SupplierPatch,
  supplierGaps,
  type ClauseSet,
  type ContractDto,
  type SupplierDetail,
  type SupplierListItem,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, ilike, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, inScope, riskPolicies, scopeOf, settingsFor, targetCompany, visibleIds } from "../../auth/scope";
import type { Db } from "../../db/client";
import { tFor } from "../i18n/service";
import { assets, processes, risks, supplierAssets, supplierContracts, supplierProcesses, supplierRisks, suppliers } from "../../db/schema";

type Ctx = Context<AppEnv>;
type SupplierRow = typeof suppliers.$inferSelect;
type ContractRow = typeof supplierContracts.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);
const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function contractDto(k: ContractRow): ContractDto {
  const set = (k.clauseSet in CLAUSE_SETS ? k.clauseSet : "cz409") as ClauseSet;
  return {
    id: k.id,
    supplierId: k.supplierId,
    title: k.title,
    number: k.number,
    validFrom: k.validFrom,
    validTo: k.validTo,
    clauseSet: set,
    clauses: k.clauses,
    sla: k.sla,
    exitStrategy: k.exitStrategy,
    documentUrl: k.documentUrl,
    note: k.note,
    missingClauses: missingClauses(set, k.clauses),
    expired: !!k.validTo && k.validTo < today(),
  };
}

function reviewDue(s: SupplierRow) {
  if (s.status !== "active" || !s.significant) return false;
  if (!s.lastReviewAt) return true;
  const d = new Date(`${s.lastReviewAt}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + s.reviewIntervalMonths);
  return d.toISOString().slice(0, 10) < today();
}

/** Seznam dodavatelů s mezerami § 9 (použito i ve snímcích dokumentů). */
export async function loadSuppliers(db: Db, where?: ReturnType<typeof and>): Promise<(SupplierListItem & { _row: SupplierRow; _contracts: ContractDto[] })[]> {
  const rows = await db.select().from(suppliers).where(where).orderBy(asc(suppliers.name));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [contracts, ra, aa] = await Promise.all([
    db.select().from(supplierContracts).where(inArray(supplierContracts.supplierId, ids)).orderBy(asc(supplierContracts.title)),
    db.select().from(supplierRisks).where(inArray(supplierRisks.supplierId, ids)),
    db.select().from(supplierAssets).where(inArray(supplierAssets.supplierId, ids)),
  ]);
  return rows.map((s) => {
    const cs = contracts.filter((k) => k.supplierId === s.id).map(contractDto);
    const active = cs.filter((k) => !k.expired);
    const missing = active.reduce((n, k) => n + k.missingClauses, 0);
    const base = {
      significant: s.significant,
      status: s.status,
      notifiedAt: s.notifiedAt,
      riskAssessedAt: s.riskAssessedAt,
      rulesAcknowledgedAt: s.rulesAcknowledgedAt,
      reviewDue: reviewDue(s),
      contractCount: active.length,
      missingClauses: s.significant ? missing : 0,
    };
    return {
      id: s.id,
      companyId: s.companyId,
      name: s.name,
      ico: s.ico,
      country: s.country,
      significant: s.significant,
      status: s.status as "active" | "ended",
      dataOutsideCz: s.dataOutsideCz,
      notifiedAt: s.notifiedAt,
      lastReviewAt: s.lastReviewAt,
      reviewDue: base.reviewDue,
      contractCount: cs.length,
      missingClauses: missing,
      riskCount: ra.filter((x) => x.supplierId === s.id).length,
      assetCount: aa.filter((x) => x.supplierId === s.id).length,
      gaps: supplierGaps(base),
      updatedAt: s.updatedAt.toISOString(),
      _row: s,
      _contracts: cs,
    };
  });
}


/** Evidence dodavatelů a smluv – § 9 vyhl. č. 409/2025 Sb., § 3 odst. 5 vyhl. č. 410/2025 Sb. */
export function supplierRoutes(db: Db) {
  const list = (where?: ReturnType<typeof and>) => loadSuppliers(db, where);

  async function detail(c: Ctx, id: string): Promise<SupplierDetail> {
    const [item] = await list(eq(suppliers.id, id));
    if (!item || !(await visibleIds(db, c)).includes(item.companyId)) throw new HTTPException(404, { message: "Dodavatel nenalezen" });
    const policies = await riskPolicies(db, await getSettings(db));
    const [as, ps, rs] = await Promise.all([
      db.select({ id: assets.id, name: assets.name, assetType: assets.assetType }).from(supplierAssets).innerJoin(assets, eq(assets.id, supplierAssets.assetId)).where(eq(supplierAssets.supplierId, id)).orderBy(asc(assets.name)),
      db.select({ id: processes.id, code: processes.code, name: processes.name }).from(supplierProcesses).innerJoin(processes, eq(processes.id, supplierProcesses.processId)).where(eq(supplierProcesses.supplierId, id)),
      db.select({ r: risks }).from(supplierRisks).innerJoin(risks, eq(risks.id, supplierRisks.riskId)).where(eq(supplierRisks.supplierId, id)),
    ]);
    const { _row: s, _contracts, ...rest } = item;
    return {
      ...rest,
      address: s.address,
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      supplyDescription: s.supplyDescription,
      significanceReason: s.significanceReason,
      rulesAcknowledgedAt: s.rulesAcknowledgedAt,
      notificationRef: s.notificationRef,
      riskAssessedAt: s.riskAssessedAt,
      reviewIntervalMonths: s.reviewIntervalMonths,
      notes: s.notes,
      dora: s.dora ?? {},
      contracts: _contracts,
      assets: as,
      processes: ps,
      risks: rs.map(({ r }) => ({ id: r.id, code: r.code, name: r.name, level: riskScore(policies.get(r.companyId)!, r, r.scaleLevels).level })),
      canEdit: hasPerm(c, "suppliers:write") && scopeOf(c).ids.includes(item.companyId),
    };
  }

  async function setLinks(supplierId: string, v: { assetIds?: string[]; processIds?: string[]; riskIds?: string[] }) {
    if (v.assetIds) {
      await db.delete(supplierAssets).where(eq(supplierAssets.supplierId, supplierId));
      const ids = [...new Set(v.assetIds)];
      if (ids.length) await db.insert(supplierAssets).values(ids.map((assetId) => ({ supplierId, assetId })));
    }
    if (v.processIds) {
      await db.delete(supplierProcesses).where(eq(supplierProcesses.supplierId, supplierId));
      const ids = [...new Set(v.processIds)];
      if (ids.length) await db.insert(supplierProcesses).values(ids.map((processId) => ({ supplierId, processId })));
    }
    if (v.riskIds) {
      await db.delete(supplierRisks).where(eq(supplierRisks.supplierId, supplierId));
      const ids = [...new Set(v.riskIds)];
      if (ids.length) await db.insert(supplierRisks).values(ids.map((riskId) => ({ supplierId, riskId })));
    }
  }

  /** Dodavatel společnosti v rozsahu (zápis). */
  async function owned(c: Ctx, id: string) {
    const [r] = await db.select({ companyId: suppliers.companyId }).from(suppliers).where(eq(suppliers.id, id));
    assertScope(c, r?.companyId, "Dodavatel nenalezen");
  }

  function cleanClauses(set: ClauseSet, clauses: Record<string, string>) {
    const keys = new Set(CLAUSE_SETS[set].map((c) => c.key));
    return Object.fromEntries(Object.entries(clauses).filter(([k]) => keys.has(k))) as ContractRow["clauses"];
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "suppliers"))
      .get("/", requirePerm("suppliers:read"), zValidator("query", z.object({ q: z.string().optional(), significant: z.enum(["true", "false"]).optional() })), async (c) => {
        const q = c.req.valid("query");
        // withGroup: i dodavatelé nadřazených společností (skupinové smlouvy holdingu)
        const where = [c.req.query("withGroup") === "1" ? inArray(suppliers.companyId, await visibleIds(db, c)) : inScope(c, suppliers.companyId)];
        if (q.q) where.push(ilike(suppliers.name, `%${q.q}%`));
        if (q.significant) where.push(eq(suppliers.significant, q.significant === "true"));
        return c.json((await list(and(...where))).map(({ _row, _contracts, ...x }) => x));
      })
      .post("/", requirePerm("suppliers:write"), zValidator("json", SupplierInput), async (c) => {
        const { assetIds, processIds, riskIds, companyId: requested, ...input } = c.req.valid("json");
        const [s] = await db.insert(suppliers).values({ ...input, companyId: targetCompany(c, requested, "suppliers:write"), ico: input.ico || null }).returning();
        await setLinks(s!.id, { assetIds, processIds, riskIds });
        await audit(db, { c, user: currentUser(c), action: "supplier.created", entityType: "supplier", entityId: s!.id, details: { name: s!.name, significant: s!.significant } });
        return c.json(await detail(c, s!.id), 201);
      })
      .get("/:id", requirePerm("suppliers:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/:id", requirePerm("suppliers:write"), zValidator("json", SupplierPatch), async (c) => {
        const id = c.req.param("id");
        await owned(c, id);
        const { assetIds, processIds, riskIds, ...rest } = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<SupplierRow>;
        if ("ico" in input) input.ico = input.ico || null;
        if (Object.keys(input).length) {
          const [s] = await db.update(suppliers).set({ ...input, updatedAt: new Date() }).where(eq(suppliers.id, id)).returning({ id: suppliers.id });
          if (!s) throw new HTTPException(404, { message: "Dodavatel nenalezen" });
        }
        await setLinks(id, { assetIds, processIds, riskIds });
        await audit(db, { c, user: currentUser(c), action: "supplier.updated", entityType: "supplier", entityId: id, details: { ...input, assetIds, processIds, riskIds } });
        return c.json(await detail(c, id));
      })
      .delete("/:id", requirePerm("suppliers:write"), async (c) => {
        const id = c.req.param("id");
        await owned(c, id);
        const [s] = await db.delete(suppliers).where(eq(suppliers.id, id)).returning({ name: suppliers.name });
        if (!s) throw new HTTPException(404, { message: "Dodavatel nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "supplier.deleted", entityType: "supplier", entityId: id, details: s });
        return c.body(null, 204);
      })

      /* ---------- smlouvy ---------- */
      .post("/:id/contracts", requirePerm("suppliers:write"), zValidator("json", ContractInput), async (c) => {
        const supplierId = c.req.param("id");
        const input = c.req.valid("json");
        await owned(c, supplierId);
        const [k] = await db
          .insert(supplierContracts)
          .values({ ...input, supplierId, clauses: cleanClauses(input.clauseSet, input.clauses) })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "supplier.contract_created", entityType: "supplier", entityId: supplierId, details: { title: k!.title } });
        return c.json(await detail(c, supplierId), 201);
      })
      .patch("/:id/contracts/:contractId", requirePerm("suppliers:write"), zValidator("json", ContractPatch), async (c) => {
        const { id, contractId } = c.req.param();
        await owned(c, id);
        const [cur] = await db.select().from(supplierContracts).where(and(eq(supplierContracts.id, contractId), eq(supplierContracts.supplierId, id)));
        if (!cur) throw new HTTPException(404, { message: "Smlouva nenalezena" });
        const raw = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Partial<ContractRow>;
        const set = (input.clauseSet ?? cur.clauseSet) as ClauseSet;
        if (input.clauses) input.clauses = cleanClauses(set, input.clauses);
        const [k] = await db.update(supplierContracts).set({ ...input, updatedAt: new Date() }).where(eq(supplierContracts.id, contractId)).returning();
        await audit(db, { c, user: currentUser(c), action: "supplier.contract_updated", entityType: "supplier", entityId: id, details: { contractId, ...input } });
        void k;
        return c.json(await detail(c, id));
      })
      .delete("/:id/contracts/:contractId", requirePerm("suppliers:write"), async (c) => {
        const { id, contractId } = c.req.param();
        await owned(c, id);
        await db.delete(supplierContracts).where(and(eq(supplierContracts.id, contractId), eq(supplierContracts.supplierId, id)));
        await audit(db, { c, user: currentUser(c), action: "supplier.contract_deleted", entityType: "supplier", entityId: id, details: { contractId } });
        return c.body(null, 204);
      })

      /** Oznámení významnému dodavateli (§ 9 odst. 1 písm. e) a odst. 3 vyhl. 409/2025) – tisková podoba. */
      .get("/:id/notification.html", requirePerm("suppliers:read"), async (c) => {
        const d = await detail(c, c.req.param("id"));
        const s = await settingsFor(db, null, d.companyId);
        const t = await tFor(db, c);
        const ico = (v: string) => esc(t("srv.sup.icoLine", { ico: v }));
        const orgLine = `${esc(s.organizationName)}${s.organizationIco ? `, ${ico(s.organizationIco)}` : ""}${s.organizationAddress ? `, ${esc(s.organizationAddress)}` : ""}`;
        const supLine = `${esc(d.name)}${d.ico ? `, ${ico(d.ico)}` : ""}${d.address ? `, ${esc(d.address)}` : ""}`;
        const html = `<!doctype html><html lang="${esc(t.locale)}"><head><meta charset="utf-8"><title>${esc(t("srv.sup.noticePageTitle", { name: d.name }))}</title>
<style>body{font:11pt/1.5 system-ui,sans-serif;color:#1e293b;max-width:760px;margin:32px auto;padding:0 24px}h1{font-size:15pt}
.box{border:1px solid #cbd5e1;padding:10px 14px;margin:10px 0}.muted{color:#64748b;font-size:9.5pt}button{font:inherit;padding:6px 12px}@media print{button{display:none}body{margin:0}}</style></head>
<body><p style="text-align:right"><button onclick="window.print()">${esc(t("srv.sup.print"))}</button></p>
<p>${esc(s.organizationName)}${s.organizationIco ? `<br>${esc(t("srv.sup.icoLabel", { ico: s.organizationIco }))}` : ""}${s.organizationAddress ? `<br>${esc(s.organizationAddress)}` : ""}</p>
<p>${esc(d.name)}${d.ico ? `<br>${esc(t("srv.sup.icoLabel", { ico: d.ico }))}` : ""}${d.address ? `<br>${esc(d.address)}` : ""}${d.contactName ? `<br>${esc(t("srv.sup.attention", { name: d.contactName }))}` : ""}</p>
<h1>${esc(t("srv.sup.noticeTitle"))}</h1>
<p>${esc(t("srv.sup.noticeBasis"))}</p>
<div class="box">
<p><b>${esc(t("srv.sup.aLabel"))}</b> ${t("srv.sup.aText", { org: orgLine })}</p>
<p><b>${esc(t("srv.sup.bLabel"))}</b> ${s.regulatedServices ? esc(s.regulatedServices) : `<i>${esc(t("srv.sup.bMissing"))}</i>`}</p>
<p><b>${esc(t("srv.sup.cLabel"))}</b> ${supLine}</p>
<p><b>${esc(t("srv.sup.dLabel"))}</b> ${t("srv.sup.dText", { name: esc(d.name) })}</p>
${d.supplyDescription ? `<p class="muted">${esc(t("srv.sup.subject", { text: d.supplyDescription }))}</p>` : ""}
</div>
<p>${esc(t("srv.sup.placeDate"))}</p>
<p style="margin-top:48px">............................................................<br>${esc(t("srv.sup.signature"))}</p>
<p class="muted">${esc(t("srv.sup.footer"))}</p>
</body></html>`;
        await audit(db, { c, user: currentUser(c), action: "supplier.notification_generated", entityType: "supplier", entityId: d.id });
        return c.body(html, 200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
        });
      })
  );
}

export { CLAUSE_LABELS };
