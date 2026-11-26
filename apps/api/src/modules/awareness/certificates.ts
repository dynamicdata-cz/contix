import { PERSON_CERT_FILE_MAX, PERSON_CERT_FILE_TYPES, PersonCertInput, personCertState, type PersonCertDto, type PersonCertKind, type PersonCertListDto, type PersonCertState } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { createHash } from "node:crypto";
import { and, asc, eq, getTableColumns, inArray, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { iamPeople, personCertificates, suppliers, trainingCourses, trainingRecords, users } from "../../db/schema";
import { safeFilename } from "../assurance/routes";

/* Certifikáty a osvědčení osob – /api/person-certificates (v1.105, ADR-199). */

type Row = typeof personCertificates.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);

/** DTO bez obsahu souboru; jména držitelů, dodavatelů a kurzů se dotahují hromadně. */
export async function certDtos(db: Db, rows: Row[], now = today()): Promise<PersonCertDto[]> {
  const ids = <K extends keyof Row>(k: K) => [...new Set(rows.map((r) => r[k]).filter((x): x is NonNullable<Row[K]> => !!x))] as string[];
  const [us, ps, ss, cs] = await Promise.all([
    ids("userId").length ? db.select({ id: users.id, name: users.displayName, email: users.email }).from(users).where(inArray(users.id, ids("userId"))) : [],
    ids("personId").length ? db.select({ id: iamPeople.id, first: iamPeople.firstName, last: iamPeople.lastName, kind: iamPeople.kind, job: iamPeople.jobTitle }).from(iamPeople).where(inArray(iamPeople.id, ids("personId"))) : [],
    ids("supplierId").length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, ids("supplierId"))) : [],
    ids("courseId").length ? db.select({ id: trainingCourses.id, title: trainingCourses.title, code: trainingCourses.code }).from(trainingCourses).where(inArray(trainingCourses.id, ids("courseId"))) : [],
  ]);
  const U = new Map(us.map((x) => [x.id, x]));
  const P = new Map(ps.map((x) => [x.id, x]));
  const S = new Map(ss.map((x) => [x.id, x]));
  const C = new Map(cs.map((x) => [x.id, x]));
  return rows.map((r) => {
    const st = personCertState(r.validUntil, now);
    const u = r.userId ? U.get(r.userId) : undefined;
    const p = r.personId ? P.get(r.personId) : undefined;
    const holder: PersonCertDto["holder"] = u
      ? { type: "user", id: u.id, name: u.name, detail: u.email }
      : p
        ? { type: "person", id: p.id, name: `${p.first} ${p.last}`, detail: p.job ?? null }
        : { type: "external", id: null, name: r.holderName ?? "", detail: null };
    const s = r.supplierId ? S.get(r.supplierId) : undefined;
    const c = r.courseId ? C.get(r.courseId) : undefined;
    return {
      id: r.id,
      companyId: r.companyId,
      holder,
      supplier: s ? { id: s.id, name: s.name } : null,
      name: r.name,
      kind: r.kind as PersonCertKind,
      issuer: r.issuer,
      credentialId: r.credentialId,
      issuedAt: r.issuedAt,
      validUntil: r.validUntil,
      state: st.state,
      daysLeft: st.daysLeft,
      course: c ? { id: c.id, title: `${c.code ? `${c.code} ` : ""}${c.title}` } : null,
      note: r.note,
      file: r.fileName ? { name: r.fileName, mime: r.fileMime ?? "application/octet-stream", size: r.fileSize ?? 0 } : null,
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/** Sloupce bez obsahu souboru (seznam nesmí tahat PDF). */
const { fileContent: _content, ...META } = getTableColumns(personCertificates);

export function personCertRoutes(db: Db) {
  const load = async (c: Context<AppEnv>, id: string) => {
    const [r] = await db.select().from(personCertificates).where(eq(personCertificates.id, id));
    assertScope(c, r?.companyId, "Certifikát nenalezen");
    return r!;
  };
  const canWrite = (c: Context<AppEnv>, companyId: string) => {
    if (!hasPermIn(c, "awareness:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
  };
  /** Držitel, dodavatel a kurz musí patřit do stejné společnosti jako certifikát. */
  const checkRefs = async (companyId: string, v: z.infer<typeof PersonCertInput>) => {
    if (v.personId) {
      const [p] = await db.select({ id: iamPeople.id }).from(iamPeople).where(and(eq(iamPeople.id, v.personId), eq(iamPeople.companyId, companyId)));
      if (!p) throw new HTTPException(400, { message: "Osoba nepatří do společnosti" });
    }
    if (v.userId) {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, v.userId));
      if (!u) throw new HTTPException(400, { message: "Uživatel nenalezen" });
    }
    if (v.supplierId) {
      const [s] = await db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.id, v.supplierId), eq(suppliers.companyId, companyId)));
      if (!s) throw new HTTPException(400, { message: "Dodavatel nepatří do společnosti" });
    }
    if (v.courseId) {
      const [k] = await db.select({ id: trainingCourses.id }).from(trainingCourses).where(and(eq(trainingCourses.id, v.courseId), eq(trainingCourses.companyId, companyId)));
      if (!k) throw new HTTPException(400, { message: "Kurz nepatří do společnosti" });
    }
  };
  /** Absolvování kurzu z osvědčení: založí / aktualizuje / zruší záznam v přehledu absolvování (§ 10 odst. 5). */
  const syncRecord = async (row: Row, by: string) => {
    const want = row.courseId && row.userId ? { courseId: row.courseId, userId: row.userId, completedAt: row.issuedAt ?? today() } : null;
    if (row.trainingRecordId) {
      if (want) {
        await db.update(trainingRecords).set({ ...want, note: `Certifikát: ${row.name}` }).where(eq(trainingRecords.id, row.trainingRecordId));
        return;
      }
      await db.delete(trainingRecords).where(eq(trainingRecords.id, row.trainingRecordId));
      await db.update(personCertificates).set({ trainingRecordId: null }).where(eq(personCertificates.id, row.id));
      return;
    }
    if (!want) return;
    const [rec] = await db.insert(trainingRecords).values({ ...want, passed: true, note: `Certifikát: ${row.name}`, recordedById: by }).returning({ id: trainingRecords.id });
    await db.update(personCertificates).set({ trainingRecordId: rec!.id }).where(eq(personCertificates.id, row.id));
  };
  const Id = z.object({ id: z.string().uuid() });
  const List = z.object({
    state: z.enum(["valid", "expiring", "expired", "no_expiry"]).optional(),
    supplierId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    personId: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
  });
  return new Hono<AppEnv>()
    .use(requireModule(db, "awareness"))
    .get("/", requirePerm("awareness:read"), zValidator("query", List), async (c) => {
      const q = c.req.valid("query");
      const where: SQL[] = [inScope(c, personCertificates.companyId)];
      if (q.supplierId) where.push(eq(personCertificates.supplierId, q.supplierId));
      if (q.userId) where.push(eq(personCertificates.userId, q.userId));
      if (q.personId) where.push(eq(personCertificates.personId, q.personId));
      const rows = (await db
        .select(META)
        .from(personCertificates)
        .where(and(...where))
        .orderBy(asc(personCertificates.validUntil), asc(personCertificates.name))).map((r) => ({ ...r, fileContent: null }));
      let items = await certDtos(db, rows);
      const counts: Record<PersonCertState, number> = { valid: 0, expiring: 0, expired: 0, no_expiry: 0 };
      for (const i of items) counts[i.state]++;
      if (q.state) items = items.filter((i) => i.state === q.state);
      if (q.q) {
        const n = q.q.toLowerCase();
        items = items.filter((i) => [i.name, i.issuer, i.holder.name, i.supplier?.name ?? ""].some((x) => x.toLowerCase().includes(n)));
      }
      return c.json({ items, counts } satisfies PersonCertListDto);
    })
    /** Výběr držitele: uživatelé, osoby z personální evidence (včetně externistů) a dodavatelé. */
    .get("/holders", requirePerm("awareness:read"), async (c) => {
      const ids = scopeOf(c).ids;
      const [us, ps, ss] = await Promise.all([
        db.select({ id: users.id, name: users.displayName, email: users.email }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.displayName)).limit(2000),
        ids.length
          ? db.select({ id: iamPeople.id, first: iamPeople.firstName, last: iamPeople.lastName, kind: iamPeople.kind, job: iamPeople.jobTitle, end: iamPeople.endDate }).from(iamPeople).where(inArray(iamPeople.companyId, ids)).orderBy(asc(iamPeople.lastName)).limit(5000)
          : [],
        ids.length ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.companyId, ids)).orderBy(asc(suppliers.name)).limit(2000) : [],
      ]);
      return c.json({
        users: us,
        people: ps.filter((p) => !p.end || p.end >= today()).map((p) => ({ id: p.id, name: `${p.first} ${p.last}`, kind: p.kind, detail: p.job })),
        suppliers: ss,
      });
    })
    .post("/", requirePerm("awareness:write"), zValidator("json", PersonCertInput), async (c) => {
      const v = c.req.valid("json");
      const companyId = targetCompany(c, null, "awareness:write");
      await checkRefs(companyId, v);
      const [row] = await db
        .insert(personCertificates)
        .values({ ...v, holderName: v.holderName?.trim() || null, companyId, createdById: currentUser(c).id })
        .returning();
      await syncRecord(row!, currentUser(c).id);
      await audit(db, { c, user: currentUser(c), action: "person_cert.created", entityType: "person_certificate", entityId: row!.id, details: { name: v.name, validUntil: v.validUntil } });
      const [fresh] = await db.select().from(personCertificates).where(eq(personCertificates.id, row!.id));
      return c.json((await certDtos(db, [fresh!]))[0], 201);
    })
    .put("/:id", requirePerm("awareness:write"), zValidator("param", Id), zValidator("json", PersonCertInput), async (c) => {
      const cur = await load(c, c.req.param("id"));
      canWrite(c, cur.companyId);
      const v = c.req.valid("json");
      await checkRefs(cur.companyId, v);
      const [row] = await db
        .update(personCertificates)
        .set({ ...v, holderName: v.holderName?.trim() || null, updatedAt: new Date() })
        .where(eq(personCertificates.id, cur.id))
        .returning();
      await syncRecord(row!, currentUser(c).id);
      await audit(db, { c, user: currentUser(c), action: "person_cert.updated", entityType: "person_certificate", entityId: cur.id, details: { name: v.name, validUntil: v.validUntil } });
      const [fresh] = await db.select().from(personCertificates).where(eq(personCertificates.id, cur.id));
      return c.json((await certDtos(db, [fresh!]))[0]);
    })
    .delete("/:id", requirePerm("awareness:write"), zValidator("param", Id), async (c) => {
      const cur = await load(c, c.req.param("id"));
      canWrite(c, cur.companyId);
      if (cur.trainingRecordId) await db.delete(trainingRecords).where(eq(trainingRecords.id, cur.trainingRecordId));
      await db.delete(personCertificates).where(eq(personCertificates.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "person_cert.deleted", entityType: "person_certificate", entityId: cur.id, details: { name: cur.name } });
      return c.body(null, 204);
    })
    /** Soubor osvědčení (PDF, PNG, JPG do 10 MB); nový soubor nahradí předchozí. */
    .post("/:id/file", requirePerm("awareness:write"), zValidator("param", Id), async (c) => {
      const cur = await load(c, c.req.param("id"));
      canWrite(c, cur.companyId);
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
      if (file.size > PERSON_CERT_FILE_MAX) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 10 MB)" });
      const name = safeFilename(file.name);
      const mime = PERSON_CERT_FILE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""];
      if (!mime) throw new HTTPException(400, { message: "Nepodporovaný formát – nahrajte PDF, PNG nebo JPG" });
      const buf = Buffer.from(await file.arrayBuffer());
      await db
        .update(personCertificates)
        .set({ fileName: name, fileMime: mime, fileSize: buf.length, fileSha256: createHash("sha256").update(buf).digest("hex"), fileContent: buf, updatedAt: new Date() })
        .where(eq(personCertificates.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "person_cert.file_uploaded", entityType: "person_certificate", entityId: cur.id, details: { file: name, size: buf.length } });
      const [fresh] = await db.select().from(personCertificates).where(eq(personCertificates.id, cur.id));
      return c.json((await certDtos(db, [fresh!]))[0]);
    })
    .get("/:id/file", requirePerm("awareness:read"), zValidator("param", Id), async (c) => {
      const cur = await load(c, c.req.param("id"));
      if (!cur.fileContent || !cur.fileName) throw new HTTPException(404, { message: "Soubor není nahraný" });
      return new Response(new Uint8Array(cur.fileContent), {
        headers: {
          "content-type": cur.fileMime ?? "application/octet-stream",
          "content-disposition": `attachment; filename="${cur.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(cur.fileName)}`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'",
          "cache-control": "private, no-store",
        },
      });
    });
}
