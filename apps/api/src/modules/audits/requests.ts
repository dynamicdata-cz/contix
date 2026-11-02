/** Portál externího auditora (ADR-071): požadavky na podklady (PBC), soubory, připomínky, převzetí. */
import {
  AuditAuditorsInput,
  AuditCommentInput,
  AuditRequestBulk,
  AuditRequestInput,
  AuditRequestPatch,
  AuditReturnInput,
  parseRequestLines,
  requestCode,
  type AuditPortalDto,
  type AuditRequestDetail,
  type AuditRequestDto,
  type AuditRequestStatus,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { strToU8, zipSync, type Zippable } from "fflate";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, scopeOf } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { auditAuditors, auditRequestComments, auditRequestFiles, auditRequests, audits, positionHolders, positions, roles, userRoles, users } from "../../db/schema";
import { safeFilename } from "../assurance/routes";
import { mimeFor } from "../policies/mime";

type Ctx = Context<AppEnv>;
const MAX_BYTES = 25 * 1024 * 1024;
const ANY = ["audits:read", "audits:external"] as const;

interface Access {
  auditId: string;
  companyId: string;
  internal: boolean;
  manage: boolean;
  external: boolean;
  positions: Set<string>;
}

/** Přístup k auditu: interní (audits:read ve společnosti auditu), správa (audits:write), externí (audits:external + přidělen). */
async function accessTo(db: Db, c: Ctx, auditId: string): Promise<Access> {
  const [a] = await db.select({ id: audits.id, companyId: audits.companyId }).from(audits).where(eq(audits.id, auditId));
  if (!a) throw new HTTPException(404, { message: "Audit nenalezen" });
  const me = currentUser(c).id;
  const inScope = scopeOf(c).ids.includes(a.companyId);
  const internal = inScope && hasPermIn(c, "audits:read", a.companyId);
  const manage = inScope && hasPermIn(c, "audits:write", a.companyId);
  let external = false;
  if (hasPerm(c, "audits:external")) {
    const [m] = await db.select({ n: count() }).from(auditAuditors).where(and(eq(auditAuditors.auditId, a.id), eq(auditAuditors.userId, me)));
    external = (m?.n ?? 0) > 0;
  }
  if (!internal && !external) throw new HTTPException(404, { message: "Audit nenalezen" });
  const positionsHeld = new Set((await db.select({ p: positionHolders.positionId }).from(positionHolders).where(eq(positionHolders.userId, me))).map((x) => x.p));
  return { auditId: a.id, companyId: a.companyId, internal, manage, external, positions: positionsHeld };
}

type ReqRow = typeof auditRequests.$inferSelect;
const canProvide = (acc: Access, r: ReqRow) => acc.internal && (acc.manage || (!!r.ownerPositionId && acc.positions.has(r.ownerPositionId)));

export function auditRequestRoutes(db: Db) {
  const reqRow = async (c: Ctx, id: string) => {
    const [r] = await db.select().from(auditRequests).where(eq(auditRequests.id, id));
    if (!r) throw new HTTPException(404, { message: "Požadavek nenalezen" });
    const acc = await accessTo(db, c, r.auditId);
    return { r, acc };
  };
  const today = () => new Date().toISOString().slice(0, 10);

  async function listDtos(acc: Access, where = eq(auditRequests.auditId, acc.auditId)): Promise<AuditRequestDto[]> {
    const rows = await db.select({ r: auditRequests, ownerName: positions.name }).from(auditRequests).leftJoin(positions, eq(positions.id, auditRequests.ownerPositionId)).where(where).orderBy(asc(auditRequests.seq));
    const ids = rows.map((x) => x.r.id);
    const [fc, cc] = ids.length
      ? await Promise.all([
          db
            .select({ id: auditRequestFiles.requestId, n: count() })
            .from(auditRequestFiles)
            .where(acc.internal ? inArray(auditRequestFiles.requestId, ids) : and(inArray(auditRequestFiles.requestId, ids), eq(auditRequestFiles.shared, true)))
            .groupBy(auditRequestFiles.requestId),
          db.select({ id: auditRequestComments.requestId, n: count() }).from(auditRequestComments).where(inArray(auditRequestComments.requestId, ids)).groupBy(auditRequestComments.requestId),
        ])
      : [[], []];
    const fm = new Map(fc.map((x) => [x.id, x.n]));
    const cm = new Map(cc.map((x) => [x.id, x.n]));
    return rows
      .filter((x) => acc.internal || x.r.status !== "cancelled")
      .map(({ r, ownerName }) => ({
        id: r.id,
        auditId: r.auditId,
        code: requestCode(r.seq),
        title: r.title,
        description: r.description,
        reference: r.reference,
        ownerPositionId: r.ownerPositionId,
        ownerName: acc.internal ? ownerName : null,
        dueDate: r.dueDate,
        status: r.status as AuditRequestStatus,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        acceptedAt: r.acceptedAt?.toISOString() ?? null,
        files: fm.get(r.id) ?? 0,
        comments: cm.get(r.id) ?? 0,
        overdue: !!r.dueDate && r.dueDate < today() && (r.status === "open" || r.status === "returned"),
        canProvide: canProvide(acc, r) && (r.status === "open" || r.status === "returned"),
      }));
  }

  async function detailOf(acc: Access, r: ReqRow): Promise<AuditRequestDetail> {
    const [base] = await listDtos(acc, eq(auditRequests.id, r.id));
    if (!base) throw new HTTPException(404, { message: "Požadavek nenalezen" });
    const [files, comments] = await Promise.all([
      db
        .select({ id: auditRequestFiles.id, filename: auditRequestFiles.filename, size: auditRequestFiles.size, sha256: auditRequestFiles.sha256, shared: auditRequestFiles.shared, uploadedAt: auditRequestFiles.uploadedAt, uploadedByName: users.displayName })
        .from(auditRequestFiles)
        .leftJoin(users, eq(users.id, auditRequestFiles.uploadedById))
        .where(acc.internal ? eq(auditRequestFiles.requestId, r.id) : and(eq(auditRequestFiles.requestId, r.id), eq(auditRequestFiles.shared, true)))
        .orderBy(asc(auditRequestFiles.uploadedAt)),
      db
        .select({ id: auditRequestComments.id, body: auditRequestComments.body, external: auditRequestComments.external, createdAt: auditRequestComments.createdAt, authorName: users.displayName })
        .from(auditRequestComments)
        .leftJoin(users, eq(users.id, auditRequestComments.userId))
        .where(eq(auditRequestComments.requestId, r.id))
        .orderBy(asc(auditRequestComments.createdAt)),
    ]);
    return {
      ...base,
      fileList: files.map((f) => ({ ...f, uploadedAt: f.uploadedAt.toISOString(), uploadedByName: acc.internal ? f.uploadedByName : null })),
      commentList: comments.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
      canReview: acc.external && r.status === "submitted",
    };
  }

  const nextSeq = async (auditId: string) => ((await db.select({ m: max(auditRequests.seq) }).from(auditRequests).where(eq(auditRequests.auditId, auditId)))[0]?.m ?? 0) + 1;
  const positionOk = async (acc: Access, id: string | null | undefined) => {
    if (!id) return;
    const [p] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, id));
    if (!p) throw new HTTPException(400, { message: "Funkční místo nenalezeno" });
    void acc;
  };
  const trail = (c: Ctx, action: string, auditId: string, details: Record<string, unknown>) => audit(db, { c, user: currentUser(c), action: `audit_request.${action}`, entityType: "audit", entityId: auditId, details });

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "audits"))
      /** Audity, ke kterým je přihlášený přidělen jako externí auditor. */
      .get("/mine", requirePerm("audits:external"), async (c) => {
        const rows = await db
          .select({ id: audits.id, code: audits.code, title: audits.title, status: audits.status, plannedStart: audits.plannedStart, plannedEnd: audits.plannedEnd })
          .from(auditAuditors)
          .innerJoin(audits, eq(audits.id, auditAuditors.auditId))
          .where(eq(auditAuditors.userId, currentUser(c).id))
          .orderBy(desc(audits.plannedStart));
        const ids = rows.map((r) => r.id);
        const counts = ids.length ? await db.select({ id: auditRequests.auditId, status: auditRequests.status, n: count() }).from(auditRequests).where(inArray(auditRequests.auditId, ids)).groupBy(auditRequests.auditId, auditRequests.status) : [];
        return c.json(rows.map((r) => ({ ...r, counts: Object.fromEntries(counts.filter((x) => x.id === r.id).map((x) => [x.status, x.n])) })));
      })
      .get("/audits/:auditId", requirePerm(...ANY), async (c) => {
        const acc = await accessTo(db, c, c.req.param("auditId"));
        const [a] = await db.select().from(audits).where(eq(audits.id, acc.auditId));
        const requests = await listDtos(acc);
        const auditors = await db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(auditAuditors).innerJoin(users, eq(users.id, auditAuditors.userId)).where(eq(auditAuditors.auditId, acc.auditId));
        const summary = { open: 0, submitted: 0, returned: 0, accepted: 0, cancelled: 0, overdue: 0 } as AuditPortalDto["summary"];
        for (const r of requests) {
          summary[r.status]++;
          if (r.overdue) summary.overdue++;
        }
        const out: AuditPortalDto = {
          audit: { id: a!.id, code: a!.code, title: a!.title, status: a!.status, plannedStart: a!.plannedStart, plannedEnd: a!.plannedEnd },
          requests,
          auditors: acc.internal ? auditors : auditors.map((x) => ({ ...x, email: "" })),
          summary,
          role: acc.internal ? "internal" : "external",
          canManage: acc.manage,
        };
        return c.json(out);
      })
      /** Uživatelé s rolí obsahující audits:external (mimo správce) – kandidáti na přidělení. */
      .get("/auditor-candidates", requirePerm("audits:write"), async (c) => {
        const rows = await db
          .selectDistinct({ id: users.id, displayName: users.displayName, email: users.email })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .innerJoin(users, eq(users.id, userRoles.userId))
          .where(and(eq(users.isActive, true), sql`'audits:external' = any(${roles.permissions})`, sql`${roles.key} <> 'admin'`))
          .orderBy(asc(users.displayName));
        return c.json(rows);
      })
      .put("/audits/:auditId/auditors", requirePerm("audits:write"), zValidator("json", AuditAuditorsInput), async (c) => {
        const acc = await accessTo(db, c, c.req.param("auditId"));
        if (!acc.manage) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const ids = [...new Set(c.req.valid("json").userIds)];
        if (ids.length) {
          const ok = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), eq(users.isActive, true)));
          if (ok.length !== ids.length) throw new HTTPException(400, { message: "Neplatný uživatel" });
        }
        await db.delete(auditAuditors).where(eq(auditAuditors.auditId, acc.auditId));
        if (ids.length) await db.insert(auditAuditors).values(ids.map((userId) => ({ auditId: acc.auditId, userId })));
        await trail(c, "auditors_set", acc.auditId, { userIds: ids });
        return c.json({ ok: true });
      })
      .post("/audits/:auditId/requests", requirePerm("audits:write"), zValidator("json", AuditRequestInput), async (c) => {
        const acc = await accessTo(db, c, c.req.param("auditId"));
        if (!acc.manage) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const input = c.req.valid("json");
        await positionOk(acc, input.ownerPositionId);
        const [r] = await db.insert(auditRequests).values({ ...input, auditId: acc.auditId, seq: await nextSeq(acc.auditId), createdById: currentUser(c).id }).returning();
        await trail(c, "created", acc.auditId, { requestId: r!.id, title: r!.title });
        return c.json(await detailOf(acc, r!), 201);
      })
      .post("/audits/:auditId/requests/bulk", requirePerm("audits:write"), zValidator("json", AuditRequestBulk), async (c) => {
        const acc = await accessTo(db, c, c.req.param("auditId"));
        if (!acc.manage) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const { lines, ownerPositionId, dueDate } = c.req.valid("json");
        await positionOk(acc, ownerPositionId);
        const items = parseRequestLines(lines);
        if (!items.length) throw new HTTPException(400, { message: "Žádné požadavky k založení" });
        let seq = await nextSeq(acc.auditId);
        await db.insert(auditRequests).values(items.map((x) => ({ ...x, dueDate: x.dueDate ?? dueDate ?? null, ownerPositionId: ownerPositionId ?? null, auditId: acc.auditId, seq: seq++, createdById: currentUser(c).id })));
        await trail(c, "bulk_created", acc.auditId, { count: items.length });
        return c.json({ created: items.length }, 201);
      })
      .get("/audits/:auditId/export.zip", requirePerm(...ANY), async (c) => {
        const acc = await accessTo(db, c, c.req.param("auditId"));
        const reqs = await db.select().from(auditRequests).where(and(eq(auditRequests.auditId, acc.auditId), inArray(auditRequests.status, ["submitted", "accepted", "returned"]))).orderBy(asc(auditRequests.seq));
        const files: Zippable = {};
        let manifest = "kod;pozadavek;stav;soubor;sha256\r\n";
        if (reqs.length) {
          const fs = await db.select().from(auditRequestFiles).where(and(inArray(auditRequestFiles.requestId, reqs.map((r) => r.id)), eq(auditRequestFiles.shared, true)));
          for (const r of reqs)
            for (const f of fs.filter((x) => x.requestId === r.id)) {
              const name = `${requestCode(r.seq)}/${f.filename}`;
              files[files[name] ? `${requestCode(r.seq)}/${f.id.slice(0, 8)}-${f.filename}` : name] = new Uint8Array(f.content);
              manifest += `${requestCode(r.seq)};${r.title.replace(/[;\r\n]/g, " ")};${r.status};${f.filename.replace(/;/g, "_")};${f.sha256}\r\n`;
            }
        }
        files["manifest.csv"] = strToU8(manifest);
        await trail(c, "exported", acc.auditId, { requests: reqs.length });
        return new Response(zipSync(files), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="podklady-auditu.zip"`, "cache-control": "private, no-store" } });
      })
      .get("/requests/:id", requirePerm(...ANY), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (!acc.internal && r.status === "cancelled") throw new HTTPException(404, { message: "Požadavek nenalezen" });
        return c.json(await detailOf(acc, r));
      })
      .patch("/requests/:id", requirePerm("audits:write"), zValidator("json", AuditRequestPatch), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (!acc.manage) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        if (r.status === "accepted") throw new HTTPException(409, { message: "Převzatý požadavek nelze měnit" });
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<ReqRow>;
        await positionOk(acc, input.ownerPositionId);
        const [u] = await db.update(auditRequests).set({ ...input, updatedAt: new Date() }).where(eq(auditRequests.id, r.id)).returning();
        await trail(c, "updated", acc.auditId, { requestId: r.id, ...input });
        return c.json(await detailOf(acc, u!));
      })
      .post("/requests/:id/files", requirePerm("audits:read"), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (!canProvide(acc, r)) throw new HTTPException(403, { message: "Podklady nahrává vlastník požadavku nebo správce auditu" });
        if (r.status !== "open" && r.status !== "returned") throw new HTTPException(409, { message: "Podklady lze doplnit jen k otevřenému nebo vrácenému požadavku" });
        if (Number(c.req.header("content-length") ?? 0) > MAX_BYTES + 64 * 1024) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 25 MB)" });
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        if (file.size === 0) throw new HTTPException(400, { message: "Soubor je prázdný" });
        if (file.size > MAX_BYTES) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 25 MB)" });
        const buf = Buffer.from(await file.arrayBuffer());
        const filename = safeFilename(file.name);
        const sha256 = createHash("sha256").update(buf).digest("hex");
        await db.insert(auditRequestFiles).values({ requestId: r.id, filename, mime: mimeFor(filename), size: buf.length, sha256, content: buf, uploadedById: currentUser(c).id });
        await trail(c, "file_uploaded", acc.auditId, { requestId: r.id, filename, sha256 });
        return c.json(await detailOf(acc, r), 201);
      })
      .delete("/requests/:id/files/:fileId", requirePerm("audits:read"), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (!canProvide(acc, r)) throw new HTTPException(403, { message: "Podklady nahrává vlastník požadavku nebo správce auditu" });
        const [f] = await db.select({ id: auditRequestFiles.id, shared: auditRequestFiles.shared, filename: auditRequestFiles.filename }).from(auditRequestFiles).where(and(eq(auditRequestFiles.id, c.req.param("fileId")), eq(auditRequestFiles.requestId, r.id)));
        if (!f) throw new HTTPException(404, { message: "Soubor nenalezen" });
        if (f.shared) throw new HTTPException(409, { message: "Soubor už byl zpřístupněn auditorovi – nahrajte opravenou verzi" });
        await db.delete(auditRequestFiles).where(eq(auditRequestFiles.id, f.id));
        await trail(c, "file_deleted", acc.auditId, { requestId: r.id, filename: f.filename });
        return c.json(await detailOf(acc, r));
      })
      .get("/requests/:id/files/:fileId", requirePerm(...ANY), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        const [f] = await db.select().from(auditRequestFiles).where(and(eq(auditRequestFiles.id, c.req.param("fileId")), eq(auditRequestFiles.requestId, r.id)));
        if (!f || (!acc.internal && !f.shared)) throw new HTTPException(404, { message: "Soubor nenalezen" });
        await trail(c, "file_downloaded", acc.auditId, { requestId: r.id, fileId: f.id, filename: f.filename, external: !acc.internal });
        return new Response(new Uint8Array(f.content), {
          headers: {
            "content-type": f.mime,
            "content-length": String(f.size),
            "content-disposition": `attachment; filename="${f.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'",
            "cache-control": "private, no-store",
          },
        });
      })
      .post("/requests/:id/submit", requirePerm("audits:read"), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (!canProvide(acc, r)) throw new HTTPException(403, { message: "Podklady nahrává vlastník požadavku nebo správce auditu" });
        if (r.status !== "open" && r.status !== "returned") throw new HTTPException(409, { message: "Odeslat lze jen otevřený nebo vrácený požadavek" });
        const [n] = await db.select({ n: count() }).from(auditRequestFiles).where(eq(auditRequestFiles.requestId, r.id));
        const [m] = await db.select({ n: count() }).from(auditRequestComments).where(and(eq(auditRequestComments.requestId, r.id), eq(auditRequestComments.external, false)));
        if (!n?.n && !m?.n) throw new HTTPException(400, { message: "Přiložte soubor nebo napište komentář" });
        await db.update(auditRequestFiles).set({ shared: true }).where(eq(auditRequestFiles.requestId, r.id));
        const [u] = await db.update(auditRequests).set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() }).where(eq(auditRequests.id, r.id)).returning();
        await trail(c, "submitted", acc.auditId, { requestId: r.id, files: n?.n ?? 0 });
        return c.json(await detailOf(acc, u!));
      })
      .post("/requests/:id/comments", requirePerm(...ANY), zValidator("json", AuditCommentInput), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (r.status === "cancelled") throw new HTTPException(409, { message: "Požadavek je zrušen" });
        const { body } = c.req.valid("json");
        await db.insert(auditRequestComments).values({ requestId: r.id, userId: currentUser(c).id, external: !acc.internal, body });
        await trail(c, "commented", acc.auditId, { requestId: r.id, external: !acc.internal });
        return c.json(await detailOf(acc, r), 201);
      })
      .post("/requests/:id/accept", requirePerm("audits:external"), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (!acc.external) throw new HTTPException(403, { message: "Převzít podklady může jen přidělený auditor" });
        if (r.status !== "submitted") throw new HTTPException(409, { message: "Převzít lze jen odeslaný požadavek" });
        const [u] = await db.update(auditRequests).set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() }).where(eq(auditRequests.id, r.id)).returning();
        await trail(c, "accepted", acc.auditId, { requestId: r.id });
        return c.json(await detailOf(acc, u!));
      })
      .post("/requests/:id/return", requirePerm("audits:external"), zValidator("json", AuditReturnInput), async (c) => {
        const { r, acc } = await reqRow(c, c.req.param("id"));
        if (!acc.external) throw new HTTPException(403, { message: "Převzít podklady může jen přidělený auditor" });
        if (r.status !== "submitted") throw new HTTPException(409, { message: "Vrátit lze jen odeslaný požadavek" });
        await db.insert(auditRequestComments).values({ requestId: r.id, userId: currentUser(c).id, external: true, body: c.req.valid("json").comment });
        const [u] = await db.update(auditRequests).set({ status: "returned", updatedAt: new Date() }).where(eq(auditRequests.id, r.id)).returning();
        await trail(c, "returned", acc.auditId, { requestId: r.id });
        return c.json(await detailOf(acc, u!));
      })
  );
}

/** Otevřené a vrácené požadavky s termínem pro povinnosti vlastníků (`audit_request`). */
export async function auditRequestItems(db: Db, companyIds: string[]) {
  return db
    .select({ id: auditRequests.id, auditId: auditRequests.auditId, seq: auditRequests.seq, title: auditRequests.title, status: auditRequests.status, dueDate: auditRequests.dueDate, ownerPositionId: auditRequests.ownerPositionId, companyId: audits.companyId, auditTitle: audits.title })
    .from(auditRequests)
    .innerJoin(audits, eq(audits.id, auditRequests.auditId))
    .where(and(inArray(audits.companyId, companyIds), inArray(auditRequests.status, ["open", "returned"])));
}
