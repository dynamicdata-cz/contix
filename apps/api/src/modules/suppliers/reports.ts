import {
  EVIDENCE_MAX_BYTES,
  SupplierReportInput,
  SupplierReportItemInput,
  SupplierReportItemPatch,
  SupplierReportPatch,
  defaultReportValidity,
  supplierReportGaps,
  type ReportItemKind,
  type SupplierReportDetailDto,
  type SupplierReportDto,
  type SupplierReportItemDto,
  BUILTIN_RISK_METHODOLOGY,
} from "@contix/shared";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, settingsFor } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { controls, risks, supplierReportItems, supplierReports, supplierRisks, suppliers, users } from "../../db/schema";
import { safeFilename } from "../assurance/routes";
import { converterEnabled, pdfToText } from "../policies/convert";

/* ============================================================
 * Zprávy o ujištění od dodavatelů (ADR-098). Soubor se ukládá s SHA-256, stažení jen jako příloha;
 * text pro AI z PDF jen převodní službou (interní síť) nebo vložený ručně. Mezery `supplierReportGaps` při čtení.
 * Riziko z výjimky vzniká jen na pokyn uživatele (risks:write) a naváže se na dodavatele (`supplier_risks`).
 * ============================================================ */

const TEXT_MAX = 400_000;
const SupplierReportTextInput = z.object({ text: z.string().min(20).max(TEXT_MAX) });
const policyMethod = (p: { methodology?: string | null }) => p.methodology || BUILTIN_RISK_METHODOLOGY;

/** Prostý text z HTML / textového souboru. */
const plain = (s: string) =>
  s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function supplierReportRoutes(deps: { db: Db; pdfText?: (buf: Uint8Array) => Promise<string> }) {
  const { db } = deps;
  const pdfText = deps.pdfText ?? (converterEnabled() ? pdfToText : null);

  async function load(c: Context<AppEnv>, id: string) {
    const [r] = await db.select().from(supplierReports).where(eq(supplierReports.id, id));
    if (!r) throw new HTTPException(404, { message: "Zpráva nenalezena" });
    assertScope(c, r.companyId, "Zpráva nenalezena");
    return r;
  }
  const canWrite = (c: Context<AppEnv>, companyId: string) => {
    if (!hasPermIn(c, "suppliers:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
  };

  async function itemsOf(reportIds: string[]): Promise<Map<string, SupplierReportItemDto[]>> {
    const out = new Map<string, SupplierReportItemDto[]>();
    if (!reportIds.length) return out;
    const rows = await db
      .select({ i: supplierReportItems, cName: controls.name, cCode: controls.code, cStatus: controls.status, cEff: controls.effectiveness, rName: risks.name })
      .from(supplierReportItems)
      .leftJoin(controls, eq(controls.id, supplierReportItems.controlId))
      .leftJoin(risks, eq(risks.id, supplierReportItems.riskId))
      .where(inArray(supplierReportItems.reportId, reportIds))
      .orderBy(supplierReportItems.kind, supplierReportItems.ref, supplierReportItems.createdAt);
    for (const { i, cName, cCode, cStatus, cEff, rName } of rows) {
      const l = out.get(i.reportId) ?? [];
      l.push({
        id: i.id,
        kind: i.kind,
        ref: i.ref,
        text: i.text,
        criterion: i.criterion,
        controlId: i.controlId,
        controlName: cName ? `${cCode ? `${cCode} ` : ""}${cName}` : null,
        controlStatus: cStatus ?? null,
        controlEffectiveness: cEff ?? null,
        status: i.status,
        severity: i.severity,
        managementResponse: i.managementResponse,
        note: i.note,
        riskId: i.riskId,
        riskName: rName ?? null,
        source: i.source,
      });
      out.set(i.reportId, l);
    }
    return out;
  }

  async function dtos(where: SQL | undefined): Promise<(SupplierReportDto & { _items: SupplierReportItemDto[]; _text: string | null })[]> {
    const rows = await db
      .select({ r: supplierReports, supplierName: suppliers.name, reviewer: users.displayName })
      .from(supplierReports)
      .innerJoin(suppliers, eq(suppliers.id, supplierReports.supplierId))
      .leftJoin(users, eq(users.id, supplierReports.reviewedById))
      .where(where)
      .orderBy(desc(supplierReports.periodTo), desc(supplierReports.createdAt))
      .limit(500);
    const im = await itemsOf(rows.map((x) => x.r.id));
    return rows.map(({ r, supplierName, reviewer }) => {
      const items = im.get(r.id) ?? [];
      const counts = { cuec: 0, exception: 0, csoc: 0 } as Record<ReportItemKind, number>;
      for (const i of items) counts[i.kind]++;
      return {
        id: r.id,
        companyId: r.companyId,
        supplierId: r.supplierId,
        supplierName,
        kind: r.kind,
        title: r.title,
        serviceAuditor: r.serviceAuditor,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        asOf: r.asOf,
        opinion: r.opinion,
        validUntil: r.validUntil,
        bridgeUntil: r.bridgeUntil,
        subserviceOrgs: r.subserviceOrgs,
        notes: r.notes,
        fileName: r.fileName,
        hasText: !!r.text,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewedByName: reviewer ?? null,
        counts,
        gaps: supplierReportGaps({ ...r, hasFile: !!r.fileName }, items),
        createdAt: r.createdAt.toISOString(),
        _items: items,
        _text: r.text,
      };
    });
  }
  const strip = ({ _items, _text, ...d }: SupplierReportDto & { _items: SupplierReportItemDto[]; _text: string | null }): SupplierReportDto => d;
  async function detail(id: string): Promise<SupplierReportDetailDto> {
    const [d] = await dtos(eq(supplierReports.id, id));
    const { _items, _text, ...rest } = d!;
    return { ...rest, items: _items, textPreview: _text ? _text.slice(0, 1500) : null };
  }
  async function controlOk(companyId: string, controlId: string | null | undefined) {
    if (!controlId) return;
    const [ctl] = await db.select({ companyId: controls.companyId }).from(controls).where(eq(controls.id, controlId));
    if (!ctl || ctl.companyId !== companyId) throw new HTTPException(400, { message: "Opatření nenalezeno" });
  }
  const validity = (i: { validUntil?: string | null; periodTo?: string | null; asOf?: string | null }) => i.validUntil ?? defaultReportValidity(i);

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "suppliers"))
      .get("/", requirePerm("suppliers:read"), async (c) => {
        const supplierId = c.req.query("supplierId");
        return c.json((await dtos(and(inScope(c, supplierReports.companyId), supplierId ? eq(supplierReports.supplierId, supplierId) : undefined))).map(strip));
      })
      .post("/", requirePerm("suppliers:write"), zValidator("json", SupplierReportInput), async (c) => {
        const i = c.req.valid("json");
        const [s] = await db.select({ companyId: suppliers.companyId }).from(suppliers).where(eq(suppliers.id, i.supplierId));
        if (!s) throw new HTTPException(400, { message: "Dodavatel nenalezen" });
        assertScope(c, s.companyId, "Dodavatel nenalezen");
        canWrite(c, s.companyId);
        const [r] = await db
          .insert(supplierReports)
          .values({ ...i, companyId: s.companyId, validUntil: validity(i), createdById: currentUser(c).id })
          .returning({ id: supplierReports.id });
        await audit(db, { c, user: currentUser(c), action: "supplier_report.created", entityType: "supplier", entityId: i.supplierId, details: { reportId: r!.id, kind: i.kind, title: i.title } });
        return c.json(await detail(r!.id), 201);
      })
      .get("/:id", requirePerm("suppliers:read"), async (c) => {
        const r = await load(c, c.req.param("id"));
        return c.json(await detail(r.id));
      })
      .patch("/:id", requirePerm("suppliers:write"), zValidator("json", SupplierReportPatch), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        const i = c.req.valid("json");
        const next = { ...r, ...i };
        // platnost se dopočítá, když ji uživatel nezadal a mění období
        const validUntil = i.validUntil !== undefined ? i.validUntil : (i.periodTo !== undefined || i.asOf !== undefined) && !r.validUntil ? defaultReportValidity(next) : undefined;
        await db
          .update(supplierReports)
          .set({ ...i, ...(validUntil !== undefined ? { validUntil } : {}), updatedAt: new Date() })
          .where(eq(supplierReports.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "supplier_report.updated", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id, ...i } });
        return c.json(await detail(r.id));
      })
      .delete("/:id", requirePerm("suppliers:write"), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        await db.delete(supplierReports).where(eq(supplierReports.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "supplier_report.deleted", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id, title: r.title } });
        return c.json({ ok: true });
      })
      /** Posouzení zprávy dokončeno (kdo a kdy). */
      .post("/:id/review", requirePerm("suppliers:write"), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        await db.update(supplierReports).set({ reviewedById: currentUser(c).id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(supplierReports.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "supplier_report.reviewed", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id } });
        return c.json(await detail(r.id));
      })

      /* ---------- soubor a text ---------- */
      .post("/:id/file", requirePerm("suppliers:write"), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        if (file.size > EVIDENCE_MAX_BYTES) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 25 MB)" });
        const buf = Buffer.from(await file.arrayBuffer());
        const name = safeFilename(file.name);
        const isPdf = /\.pdf$/i.test(name) || buf.subarray(0, 5).toString() === "%PDF-";
        let text: string | null = null;
        let note: string | null = null;
        if (isPdf) {
          if (pdfText) text = await pdfText(new Uint8Array(buf)).catch(() => null);
          if (!text) note = "Text z PDF se nepodařilo získat (převodní služba není nastavená nebo PDF je sken) – vložte potřebné části zprávy ručně.";
        } else if (/\.(txt|md|html?|csv)$/i.test(name)) text = plain(buf.toString("utf8"));
        const mime = isPdf ? "application/pdf" : /\.html?$/i.test(name) ? "text/html" : "text/plain";
        await db
          .update(supplierReports)
          .set({ fileName: name, fileMime: mime, fileSize: buf.length, fileSha256: createHash("sha256").update(buf).digest("hex"), fileContent: buf, ...(text ? { text: text.slice(0, TEXT_MAX) } : {}), updatedAt: new Date() })
          .where(eq(supplierReports.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "supplier_report.file_uploaded", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id, file: name, size: buf.length, text: !!text } });
        return c.json({ ...(await detail(r.id)), note });
      })
      .get("/:id/file", requirePerm("suppliers:read"), async (c) => {
        const r = await load(c, c.req.param("id"));
        if (!r.fileContent || !r.fileName) throw new HTTPException(404, { message: "Soubor nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "supplier_report.file_downloaded", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id, file: r.fileName } });
        return new Response(new Uint8Array(r.fileContent), {
          headers: {
            "content-type": r.fileMime ?? "application/octet-stream",
            "content-disposition": `attachment; filename="${r.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'",
            "cache-control": "private, no-store",
          },
        });
      })
      /** Ručně vložený text (např. kapitola CUEC a výsledky testů) – pro AI. */
      .put("/:id/text", requirePerm("suppliers:write"), zValidator("json", SupplierReportTextInput), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        await db.update(supplierReports).set({ text: c.req.valid("json").text.slice(0, TEXT_MAX), updatedAt: new Date() }).where(eq(supplierReports.id, r.id));
        return c.json(await detail(r.id));
      })

      /* ---------- položky: CUEC, výjimky, CSOC ---------- */
      .post("/:id/items", requirePerm("suppliers:write"), zValidator("json", SupplierReportItemInput), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        const i = c.req.valid("json");
        await controlOk(r.companyId, i.controlId);
        const [it] = await db.insert(supplierReportItems).values({ ...i, reportId: r.id }).returning({ id: supplierReportItems.id });
        await audit(db, { c, user: currentUser(c), action: "supplier_report.item_created", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id, itemId: it!.id, kind: i.kind } });
        return c.json(await detail(r.id), 201);
      })
      .patch("/:id/items/:itemId", requirePerm("suppliers:write"), zValidator("json", SupplierReportItemPatch), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        const i = c.req.valid("json");
        await controlOk(r.companyId, i.controlId);
        const res = await db.update(supplierReportItems).set({ ...i, updatedAt: new Date() }).where(and(eq(supplierReportItems.id, c.req.param("itemId")), eq(supplierReportItems.reportId, r.id))).returning({ id: supplierReportItems.id });
        if (!res.length) throw new HTTPException(404, { message: "Položka nenalezena" });
        await audit(db, { c, user: currentUser(c), action: "supplier_report.item_updated", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id, itemId: res[0]!.id, ...i } });
        return c.json(await detail(r.id));
      })
      .delete("/:id/items/:itemId", requirePerm("suppliers:write"), async (c) => {
        const r = await load(c, c.req.param("id"));
        canWrite(c, r.companyId);
        await db.delete(supplierReportItems).where(and(eq(supplierReportItems.id, c.req.param("itemId")), eq(supplierReportItems.reportId, r.id)));
        await audit(db, { c, user: currentUser(c), action: "supplier_report.item_deleted", entityType: "supplier", entityId: r.supplierId, details: { reportId: r.id, itemId: c.req.param("itemId") } });
        return c.json(await detail(r.id));
      })
      /** Riziko dodavatele z výjimky (na pokyn uživatele, neohodnocené – ohodnotí vlastník rizika). */
      .post("/:id/items/:itemId/risk", requirePerm("risks:write"), async (c) => {
        const r = await load(c, c.req.param("id"));
        if (!hasPermIn(c, "risks:write", r.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const [it] = await db.select().from(supplierReportItems).where(and(eq(supplierReportItems.id, c.req.param("itemId")), eq(supplierReportItems.reportId, r.id)));
        if (!it) throw new HTTPException(404, { message: "Položka nenalezena" });
        if (it.riskId) throw new HTTPException(409, { message: "K položce už riziko existuje." });
        const [s] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, r.supplierId));
        const policy = (await settingsFor(db, c, r.companyId)).riskPolicy;
        const [risk] = await db
          .insert(risks)
          .values({
            companyId: r.companyId,
            name: `Dodavatel ${s?.name ?? ""}: ${it.text.split(/[.\n]/)[0]!.slice(0, 200)}`.slice(0, 300),
            description: [
              `Výjimka ze zprávy „${r.title}“ (${r.serviceAuditor ?? "auditor neuveden"}${r.periodTo ? `, období do ${r.periodTo}` : ""})${it.criterion ? `, kritérium ${it.criterion}` : ""}.`,
              it.text,
              it.managementResponse ? `Odpověď vedení dodavatele: ${it.managementResponse}` : null,
              "Návrh ze zprávy o ujištění dodavatele – ohodnoťte dopad a pravděpodobnost, zvažte kompenzační opatření na naší straně.",
            ]
              .filter(Boolean)
              .join("\n\n"),
            scaleLevels: policy.levels,
            methodologyKey: policyMethod(policy),
          })
          .returning({ id: risks.id });
        await db.insert(supplierRisks).values({ supplierId: r.supplierId, riskId: risk!.id }).onConflictDoNothing();
        await db.update(supplierReportItems).set({ riskId: risk!.id, updatedAt: new Date() }).where(eq(supplierReportItems.id, it.id));
        await audit(db, { c, user: currentUser(c), action: "risk.created_from_supplier_report", entityType: "risk", entityId: risk!.id, details: { reportId: r.id, itemId: it.id, supplierId: r.supplierId } });
        return c.json({ riskId: risk!.id, report: await detail(r.id) }, 201);
      })
  );
}
