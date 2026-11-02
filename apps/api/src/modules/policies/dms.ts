import {
  folderTree,
  retentionOf,
  POLICY_TYPES,
  PolicyFolderInput,
  PolicyFolderPatch,
  type DisposalMode,
  type PolicyFolderDto,
  type PolicyTemplateDto,
  type RetentionMark,
  type RetentionRow,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { policies, policyFiles, policyFolders, policyTemplates, policyVersions, users } from "../../db/schema";
import { safeFilename } from "../assurance/routes";
import { isWordTemplate } from "./docxTemplate";
import { mimeFor } from "./mime";

/* ============================================================
 * DMS II (ADR-024): složky dokumentace, šablony Wordu, přehled skartačních lhůt.
 * Montuje se do routeru /policies před /:id.
 * ============================================================ */

type PolicyRow = typeof policies.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

/** Cesty složek dokumentace pro dané společnosti (id → „Rodič / Složka“). */
export async function folderPaths(db: Db, companyIds: string[]) {
  if (!companyIds.length) return new Map<string, string>();
  const list = await db.select().from(policyFolders).where(inArray(policyFolders.companyId, [...new Set(companyIds)]));
  return new Map(folderTree(list).map((f) => [f.id, f.path]));
}

/** Datum zrušení (u dokumentů zrušených před v0.23 bez zapsaného data = poslední změna). */
const retiredOf = (p: PolicyRow) => p.retiredAt ?? (p.status === "retired" ? p.updatedAt.toISOString().slice(0, 10) : null);
export const retentionFor = (p: PolicyRow) =>
  retentionOf({ docType: p.docType, status: p.status, retentionYears: p.retentionYears, retentionMark: p.retentionMark as RetentionMark | null, retiredAt: retiredOf(p), disposedAt: p.disposedAt?.toISOString() ?? null }, today());

const TEMPLATE_MAX = 10 * 1024 * 1024;
const TemplateMeta = z.object({ name: z.string().trim().min(1).max(200), docType: z.enum(POLICY_TYPES).nullable() });

export function dmsRoutes(db: Db) {
  async function folderRow(c: Parameters<typeof assertScope>[0], id: string) {
    const [f] = await db.select().from(policyFolders).where(eq(policyFolders.id, id));
    if (!f) throw new HTTPException(404, { message: "Složka nenalezena" });
    assertScope(c, f.companyId, "Složka nenalezena");
    if (!hasPermIn(c, "policies:write", f.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return f;
  }

  /** Nadřazená složka ve stejné společnosti a bez cyklu. */
  async function checkParent(companyId: string, parentId: string | null | undefined, self?: string) {
    if (!parentId) return;
    const all = await db.select({ id: policyFolders.id, parentId: policyFolders.parentId, companyId: policyFolders.companyId }).from(policyFolders).where(eq(policyFolders.companyId, companyId));
    if (!all.some((f) => f.id === parentId)) throw new HTTPException(400, { message: "Nadřazená složka nepatří do stejné společnosti." });
    for (let cur: string | null | undefined = parentId, i = 0; cur && i < 50; cur = all.find((f) => f.id === cur)?.parentId, i++)
      if (cur === self) throw new HTTPException(400, { message: "Složku nelze přesunout do vlastní podsložky." });
  }

  async function folders(companyIds: string[]): Promise<PolicyFolderDto[]> {
    if (!companyIds.length) return [];
    const list = await db.select().from(policyFolders).where(inArray(policyFolders.companyId, companyIds));
    const counts = new Map(
      (
        await db
          .select({ f: policies.folderId, n: sql<number>`count(*)::int` })
          .from(policies)
          .where(and(inArray(policies.companyId, companyIds), sql`${policies.folderId} is not null`, sql`${policies.disposedAt} is null`))
          .groupBy(policies.folderId)
      ).map((r) => [r.f, Number(r.n)]),
    );
    return folderTree(list).map((f) => ({ id: f.id, companyId: f.companyId, parentId: f.parentId, name: f.name, codePrefix: f.codePrefix, position: f.position, path: f.path, depth: f.depth, documents: counts.get(f.id) ?? 0 }));
  }

  async function templates(companyIds: string[]): Promise<PolicyTemplateDto[]> {
    if (!companyIds.length) return [];
    const rows = await db
      .select({ t: { id: policyTemplates.id, companyId: policyTemplates.companyId, name: policyTemplates.name, docType: policyTemplates.docType, filename: policyTemplates.filename, size: policyTemplates.size, uploadedAt: policyTemplates.uploadedAt }, by: users.displayName })
      .from(policyTemplates)
      .leftJoin(users, eq(users.id, policyTemplates.uploadedById))
      .where(inArray(policyTemplates.companyId, companyIds))
      .orderBy(asc(policyTemplates.name));
    return rows.map(({ t, by }) => ({ ...t, uploadedAt: t.uploadedAt.toISOString(), uploadedByName: by }));
  }

  const ANY = ["policies:read", "obligations:self"] as const;

  return (
    new Hono<AppEnv>()
      /* ---------- složky ---------- */
      .get("/folders", requirePerm(...ANY), async (c) => c.json(await folders(scopeOf(c).ids)))
      .post("/folders", requirePerm("policies:write"), zValidator("json", PolicyFolderInput), async (c) => {
        const { companyId: requested, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "policies:write");
        await checkParent(companyId, input.parentId);
        const [f] = await db.insert(policyFolders).values({ ...input, companyId }).returning();
        await audit(db, { c, user: currentUser(c), action: "policy_folder.created", entityType: "policy_folder", entityId: f!.id, details: { name: f!.name } });
        return c.json(await folders(scopeOf(c).ids), 201);
      })
      .patch("/folders/:fid", requirePerm("policies:write"), zValidator("json", PolicyFolderPatch), async (c) => {
        const f = await folderRow(c, c.req.param("fid"));
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
        if ("parentId" in input) await checkParent(f.companyId, input.parentId as string | null, f.id);
        await db.update(policyFolders).set({ ...input, updatedAt: new Date() }).where(eq(policyFolders.id, f.id));
        await audit(db, { c, user: currentUser(c), action: "policy_folder.updated", entityType: "policy_folder", entityId: f.id, details: input });
        return c.json(await folders(scopeOf(c).ids));
      })
      .delete("/folders/:fid", requirePerm("policies:write"), async (c) => {
        const f = await folderRow(c, c.req.param("fid"));
        const [sub] = await db.select({ id: policyFolders.id }).from(policyFolders).where(eq(policyFolders.parentId, f.id)).limit(1);
        const [doc] = await db.select({ id: policies.id }).from(policies).where(eq(policies.folderId, f.id)).limit(1);
        if (sub || doc) throw new HTTPException(409, { message: "Smazat lze jen prázdnou složku (bez dokumentů a podsložek)." });
        await db.delete(policyFolders).where(eq(policyFolders.id, f.id));
        await audit(db, { c, user: currentUser(c), action: "policy_folder.deleted", entityType: "policy_folder", entityId: f.id, details: { name: f.name } });
        return c.json(await folders(scopeOf(c).ids));
      })

      /* ---------- šablony ---------- */
      .get("/templates", requirePerm(...ANY), async (c) => c.json(await templates(scopeOf(c).ids)))
      .post("/templates", requirePerm("policies:write"), async (c) => {
        const companyId = targetCompany(c, null, "policies:write");
        if (Number(c.req.header("content-length") ?? 0) > TEMPLATE_MAX + 64 * 1024) throw new HTTPException(413, { message: "Šablona je příliš velká (max. 10 MB)" });
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Vyberte soubor šablony" });
        if (file.size > TEMPLATE_MAX) throw new HTTPException(413, { message: "Šablona je příliš velká (max. 10 MB)" });
        const meta = TemplateMeta.safeParse({ name: typeof body.name === "string" && body.name.trim() ? body.name : file.name.replace(/\.\w+$/, ""), docType: typeof body.docType === "string" && body.docType ? body.docType : null });
        if (!meta.success) throw new HTTPException(400, { message: "Neplatný název nebo druh dokumentu" });
        const buf = Buffer.from(await file.arrayBuffer());
        const word = isWordTemplate(buf);
        const mime = word ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : mimeFor(file.name);
        const [t] = await db
          .insert(policyTemplates)
          .values({ companyId, name: meta.data.name, docType: meta.data.docType, filename: safeFilename(file.name), mime, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), content: buf, uploadedById: currentUser(c).id })
          .returning({ id: policyTemplates.id });
        await audit(db, { c, user: currentUser(c), action: "policy_template.created", entityType: "policy_template", entityId: t!.id, details: { name: meta.data.name, word } });
        return c.json(await templates(scopeOf(c).ids), 201);
      })
      .delete("/templates/:tid", requirePerm("policies:write"), async (c) => {
        const [t] = await db.select({ id: policyTemplates.id, companyId: policyTemplates.companyId, name: policyTemplates.name }).from(policyTemplates).where(eq(policyTemplates.id, c.req.param("tid")));
        if (!t) throw new HTTPException(404, { message: "Šablona nenalezena" });
        assertScope(c, t.companyId, "Šablona nenalezena");
        if (!hasPermIn(c, "policies:write", t.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        await db.delete(policyTemplates).where(eq(policyTemplates.id, t.id));
        await audit(db, { c, user: currentUser(c), action: "policy_template.deleted", entityType: "policy_template", entityId: t.id, details: { name: t.name } });
        return c.json(await templates(scopeOf(c).ids));
      })
      .get("/templates/:tid/file", requirePerm(...ANY), async (c) => {
        const [t] = await db.select().from(policyTemplates).where(eq(policyTemplates.id, c.req.param("tid")));
        if (!t || !scopeOf(c).accessible.includes(t.companyId)) throw new HTTPException(404, { message: "Šablona nenalezena" });
        await audit(db, { c, user: currentUser(c), action: "policy_template.downloaded", entityType: "policy_template", entityId: t.id, details: { name: t.name } });
        return new Response(new Uint8Array(t.content), {
          headers: {
            "content-type": t.mime,
            "content-length": String(t.size),
            "content-disposition": `attachment; filename="${t.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(t.filename)}`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'",
            "cache-control": "private, no-store",
          },
        });
      })

      /* ---------- skartační lhůty ---------- */
      /** Zrušené a skartované dokumenty se stavem skartační lhůty. */
      .get("/retention", requirePerm("policies:read"), async (c) => {
        const rows = await db
          .select({ p: policies, by: users.displayName })
          .from(policies)
          .leftJoin(users, eq(users.id, policies.disposedById))
          .where(and(inScope(c, policies.companyId), sql`(${policies.status} = 'retired' or ${policies.disposedAt} is not null)`))
          .orderBy(asc(policies.code), asc(policies.title));
        if (!rows.length) return c.json([]);
        const ids = rows.map((r) => r.p.id);
        const [vs, fs, paths] = await Promise.all([
          db.select({ pid: policyVersions.policyId, n: sql<number>`count(*)::int` }).from(policyVersions).where(inArray(policyVersions.policyId, ids)).groupBy(policyVersions.policyId),
          db
            .select({ pid: policyVersions.policyId, n: sql<number>`count(*)::int` })
            .from(policyFiles)
            .innerJoin(policyVersions, eq(policyVersions.id, policyFiles.versionId))
            .where(inArray(policyVersions.policyId, ids))
            .groupBy(policyVersions.policyId),
          folderPaths(
            db,
            rows.map((r) => r.p.companyId),
          ),
        ]);
        const vn = new Map(vs.map((x) => [x.pid, Number(x.n)]));
        const fn = new Map(fs.map((x) => [x.pid, Number(x.n)]));
        const out: RetentionRow[] = rows.map(({ p, by }) => ({
          id: p.id,
          companyId: p.companyId,
          code: p.code,
          title: p.title,
          docType: p.docType,
          folderPath: p.folderId ? (paths.get(p.folderId) ?? null) : null,
          versions: vn.get(p.id) ?? 0,
          files: fn.get(p.id) ?? 0,
          retention: retentionFor(p),
          disposal: p.disposedAt ? { at: p.disposedAt.toISOString(), byName: by, mode: p.disposalMode as DisposalMode, note: p.disposalNote, reference: p.disposalReference } : null,
        }));
        const order = { due: 0, running: 1, active: 2, disposed: 3 } as const;
        out.sort((a, b) => order[a.retention.state] - order[b.retention.state] || (a.retention.dueAt ?? "").localeCompare(b.retention.dueAt ?? ""));
        return c.json(out);
      })
  );
}

