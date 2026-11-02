import {
  AuditPackageQuery,
  CompleteTestInput,
  ControlTestInput,
  ControlTestPatch,
  EVIDENCE_MAX_BYTES,
  EvidenceInput,
  EvidencePatch,
  SampleInput,
  deriveTestResult,
  effectivenessFromResult,
  evidenceValidity,
  recommendedSample,
  requirementById,
  type ControlTestDto,
  type EvidenceDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import {
  assertScope,
  hasPermIn,
  inScope,
  scopeOf,
  soleCompany,
  targetCompany,
} from "../../auth/scope";
import { buildAuditPackage } from "./package";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  controlTestSamples,
  controlTests,
  controls,
  evidence,
  evidenceControls,
  evidenceFiles,
  evidenceRequirements,
  users,
} from "../../db/schema";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * Důkazy a testování opatření (ADR-017)
 * ============================================================ */

type Ctx = Context<AppEnv>;
const creator = alias(users, "ev_creator");
const uploader = alias(users, "ev_uploader");

/** Bezpečný název souboru pro uložení a Content-Disposition. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "soubor";
  const clean = base
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "_")
    .trim()
    .slice(0, 200);
  return clean || "soubor";
}

const WRITE = ["controls:test", "controls:write"] as const;

/** Souhrn ověřování opatření pro dané společnosti (přehled, zpráva pro vedení). */
export async function assuranceStats(db: Db, companyIds: string[]) {
  const ids = companyIds.length
    ? companyIds
    : ["00000000-0000-0000-0000-000000000000"];
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [
    planned,
    overdue,
    recent,
    evTotal,
    evExpired,
    evExpiring,
    implemented,
    withEvidence,
    tested,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(controlTests)
      .where(
        and(
          inArray(controlTests.companyId, ids),
          inArray(controlTests.status, ["planned", "in_progress"]),
        ),
      ),
    db
      .select({ n: count() })
      .from(controlTests)
      .where(
        and(
          inArray(controlTests.companyId, ids),
          inArray(controlTests.status, ["planned", "in_progress"]),
          lt(controlTests.dueDate, today),
        ),
      ),
    db
      .select({ result: controlTests.result, n: count() })
      .from(controlTests)
      .where(
        and(
          inArray(controlTests.companyId, ids),
          eq(controlTests.status, "completed"),
          gte(controlTests.performedAt, yearAgo),
        ),
      )
      .groupBy(controlTests.result),
    db
      .select({ n: count() })
      .from(evidence)
      .where(inArray(evidence.companyId, ids)),
    db
      .select({ n: count() })
      .from(evidence)
      .where(
        and(inArray(evidence.companyId, ids), lt(evidence.validUntil, today)),
      ),
    db
      .select({ n: count() })
      .from(evidence)
      .where(
        and(
          inArray(evidence.companyId, ids),
          gte(evidence.validUntil, today),
          lt(evidence.validUntil, soon),
        ),
      ),
    db
      .select({ id: controls.id })
      .from(controls)
      .where(
        and(
          inArray(controls.companyId, ids),
          eq(controls.status, "implemented"),
        ),
      ),
    db
      .selectDistinct({ id: evidenceControls.controlId })
      .from(evidenceControls)
      .innerJoin(controls, eq(controls.id, evidenceControls.controlId))
      .where(inArray(controls.companyId, ids)),
    db
      .selectDistinct({ id: controlTests.controlId })
      .from(controlTests)
      .where(
        and(
          inArray(controlTests.companyId, ids),
          eq(controlTests.status, "completed"),
          gte(controlTests.performedAt, yearAgo),
        ),
      ),
  ]);
  const ev = new Set(withEvidence.map((x) => x.id));
  const te = new Set(tested.map((x) => x.id));
  return {
    testsOpen: planned[0]!.n,
    testsOverdue: overdue[0]!.n,
    testsLastYear: Object.fromEntries(
      recent.map((r) => [r.result ?? "not_tested", r.n]),
    ),
    evidenceTotal: evTotal[0]!.n,
    evidenceExpired: evExpired[0]!.n,
    evidenceExpiring: evExpiring[0]!.n,
    implementedControls: implemented.length,
    implementedWithoutEvidence: implemented.filter((x) => !ev.has(x.id)).length,
    implementedNotTested: implemented.filter((x) => !te.has(x.id)).length,
  };
}

export function assuranceRoutes(db: Db) {
  function assertWrite(c: Ctx, companyId: string) {
    if (!WRITE.some((p) => hasPermIn(c, p, companyId)))
      throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
  }

  async function controlRow(c: Ctx, id: string) {
    const [ctl] = await db.select().from(controls).where(eq(controls.id, id));
    if (!ctl) throw new HTTPException(404, { message: "Opatření nenalezeno" });
    assertScope(c, ctl.companyId, "Opatření nenalezeno");
    return ctl;
  }

  /* ---------------- důkazy ---------------- */

  async function loadEvidence(
    where: ReturnType<typeof and>,
  ): Promise<EvidenceDto[]> {
    const rows = await db
      .select({ e: evidence, createdByName: creator.displayName })
      .from(evidence)
      .leftJoin(creator, eq(creator.id, evidence.createdById))
      .where(where)
      .orderBy(desc(evidence.updatedAt))
      .limit(500);
    const ids = rows.map((r) => r.e.id);
    const [links, files, reqLinks] = ids.length
      ? await Promise.all([
          db
            .select({
              evidenceId: evidenceControls.evidenceId,
              id: controls.id,
              code: controls.code,
              name: controls.name,
            })
            .from(evidenceControls)
            .innerJoin(controls, eq(controls.id, evidenceControls.controlId))
            .where(inArray(evidenceControls.evidenceId, ids)),
          db
            .select({
              id: evidenceFiles.id,
              evidenceId: evidenceFiles.evidenceId,
              filename: evidenceFiles.filename,
              mime: evidenceFiles.mime,
              size: evidenceFiles.size,
              sha256: evidenceFiles.sha256,
              uploadedAt: evidenceFiles.uploadedAt,
              uploadedByName: uploader.displayName,
            })
            .from(evidenceFiles)
            .leftJoin(uploader, eq(uploader.id, evidenceFiles.uploadedById))
            .where(inArray(evidenceFiles.evidenceId, ids))
            .orderBy(desc(evidenceFiles.uploadedAt)),
          db.select().from(evidenceRequirements).where(inArray(evidenceRequirements.evidenceId, ids)),
        ])
      : [[], [], []];
    return rows.map(({ e, createdByName }) => ({
      id: e.id,
      companyId: e.companyId,
      title: e.title,
      description: e.description,
      kind: e.kind,
      url: e.url,
      collectedAt: e.collectedAt,
      periodFrom: e.periodFrom,
      periodTo: e.periodTo,
      validUntil: e.validUntil,
      validity: evidenceValidity(e.validUntil),
      controls: links
        .filter((l) => l.evidenceId === e.id)
        .map(({ id, code, name }) => ({ id, code, name })),
      requirements: reqLinks
        .filter((l) => l.evidenceId === e.id)
        .map((l) => {
          const r = requirementById(l.requirementId);
          return { id: l.requirementId, ref: r?.ref ?? l.requirementId, framework: r?.framework ?? l.requirementId.split(":")[0]! };
        }),
      files: files
        .filter((f) => f.evidenceId === e.id)
        .map((f) => ({
          id: f.id,
          filename: f.filename,
          mime: f.mime,
          size: f.size,
          sha256: f.sha256,
          uploadedAt: f.uploadedAt.toISOString(),
          uploadedByName: f.uploadedByName,
        })),
      createdByName,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    }));
  }

  async function evidenceRow(c: Ctx, id: string) {
    const [e] = await db.select().from(evidence).where(eq(evidence.id, id));
    if (!e) throw new HTTPException(404, { message: "Důkaz nenalezen" });
    assertScope(c, e.companyId, "Důkaz nenalezen");
    return e;
  }

  async function setEvidenceControls(
    c: Ctx,
    evidenceId: string,
    companyId: string,
    controlIds: string[],
  ) {
    const ids = [...new Set(controlIds)];
    if (ids.length) {
      const rows = await db
        .select({ id: controls.id, companyId: controls.companyId })
        .from(controls)
        .where(inArray(controls.id, ids));
      if (rows.length !== ids.length)
        throw new HTTPException(400, { message: "Neznámé opatření" });
      for (const r of rows) assertScope(c, r.companyId, "Opatření nenalezeno");
    }
    await db
      .delete(evidenceControls)
      .where(eq(evidenceControls.evidenceId, evidenceId));
    if (ids.length)
      await db
        .insert(evidenceControls)
        .values(ids.map((controlId) => ({ evidenceId, controlId })));
    void companyId;
  }

  async function setEvidenceRequirements(evidenceId: string, requirementIds: string[]) {
    const ids = [...new Set(requirementIds)];
    const unknown = ids.filter((id) => !requirementById(id));
    if (unknown.length) throw new ApiError(400, "err.req.unknownList", { ids: unknown.slice(0, 3).join(", ") });
    await db.delete(evidenceRequirements).where(eq(evidenceRequirements.evidenceId, evidenceId));
    if (ids.length) await db.insert(evidenceRequirements).values(ids.map((requirementId) => ({ evidenceId, requirementId })));
  }

  /* ---------------- testy ---------------- */

  async function loadTests(
    where: ReturnType<typeof and>,
    withSamples = false,
  ): Promise<ControlTestDto[]> {
    const rows = await db
      .select({
        t: controlTests,
        controlCode: controls.code,
        controlName: controls.name,
      })
      .from(controlTests)
      .innerJoin(controls, eq(controls.id, controlTests.controlId))
      .where(where)
      .orderBy(
        sql`coalesce(${controlTests.performedAt}, ${controlTests.dueDate}) desc nulls last`,
        desc(controlTests.createdAt),
      )
      .limit(500);
    const ids = rows.map((r) => r.t.id);
    const samples = ids.length
      ? await db
          .select({ s: controlTestSamples, evidenceTitle: evidence.title })
          .from(controlTestSamples)
          .leftJoin(evidence, eq(evidence.id, controlTestSamples.evidenceId))
          .where(inArray(controlTestSamples.testId, ids))
          .orderBy(
            asc(controlTestSamples.order),
            asc(controlTestSamples.createdAt),
          )
      : [];
    return rows.map(({ t, controlCode, controlName }) => {
      const own = samples.filter((s) => s.s.testId === t.id);
      return {
        id: t.id,
        companyId: t.companyId,
        controlId: t.controlId,
        controlCode,
        controlName,
        kind: t.kind,
        title: t.title,
        methods: t.methods,
        frequency: t.frequency ?? null,
        periodFrom: t.periodFrom,
        periodTo: t.periodTo,
        dueDate: t.dueDate,
        status: t.status,
        tester: t.tester,
        populationSize: t.populationSize,
        procedure: t.procedure,
        tolerableExceptions: t.tolerableExceptions,
        result: t.result,
        derivedResult: deriveTestResult(
          own.map((x) => x.s),
          t.tolerableExceptions,
        ),
        conclusion: t.conclusion,
        performedAt: t.performedAt,
        sampleCount: own.length,
        exceptions: own.filter((x) => x.s.result === "fail").length,
        recommended:
          t.kind === "operating" && t.frequency
            ? recommendedSample(t.frequency, t.populationSize)
            : null,
        samples: withSamples
          ? own.map(({ s, evidenceTitle }) => ({
              id: s.id,
              ref: s.ref,
              description: s.description,
              result: s.result,
              note: s.note,
              evidenceId: s.evidenceId,
              evidenceTitle,
            }))
          : [],
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      };
    });
  }

  async function testRow(c: Ctx, id: string) {
    const [t] = await db
      .select()
      .from(controlTests)
      .where(eq(controlTests.id, id));
    if (!t) throw new HTTPException(404, { message: "Test nenalezen" });
    assertScope(c, t.companyId, "Test nenalezen");
    return t;
  }
  const testDetail = async (id: string) =>
    (await loadTests(eq(controlTests.id, id), true))[0]!;

  async function assertEvidenceVisible(
    c: Ctx,
    evidenceId: string | null | undefined,
  ) {
    if (!evidenceId) return;
    await evidenceRow(c, evidenceId);
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "controls"))

      /* ---------- přehled ---------- */
      .get("/overview", requirePerm("controls:read"), async (c) =>
        c.json(await assuranceStats(db, scopeOf(c).ids)),
      )
      /** Balíček pro auditora (ZIP) – SoA, testy, důkazy, manifest s kontrolními součty. */
      .get("/package.zip", requirePerm("controls:read"), zValidator("query", AuditPackageQuery), async (c) => {
        const q = c.req.valid("query");
        const periodTo = q.periodTo ?? new Date().toISOString().slice(0, 10);
        const periodFrom = q.periodFrom ?? new Date(new Date(periodTo).getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
        if (periodFrom > periodTo) throw new HTTPException(400, { message: "Začátek období je po jeho konci" });
        const companyId = soleCompany(c, q.companyId);
        const r = await buildAuditPackage(db, { companyId, framework: q.framework, periodFrom, periodTo, withFiles: q.files === "1", userName: currentUser(c).displayName });
        await audit(db, { c, user: currentUser(c), action: "evidence.package_exported", details: { framework: q.framework, periodFrom, periodTo, ...r.stats } });
        return new Response(r.zip, {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${r.filename}"`,
            "cache-control": "private, no-store",
          },
        });
      })

      /* ---------- důkazy ---------- */
      .get(
        "/evidence",
        requirePerm("controls:read"),
        zValidator(
          "query",
          z.object({
            controlId: z.string().uuid().optional(),
            q: z.string().max(200).optional(),
            validity: z.enum(["expired", "expiring", "valid"]).optional(),
          }),
        ),
        async (c) => {
          const q = c.req.valid("query");
          const where = [inScope(c, evidence.companyId)];
          if (q.controlId)
            where.push(
              inArray(
                evidence.id,
                db
                  .select({ id: evidenceControls.evidenceId })
                  .from(evidenceControls)
                  .where(eq(evidenceControls.controlId, q.controlId)),
              ),
            );
          if (q.q)
            where.push(
              or(
                ilike(evidence.title, `%${q.q}%`),
                ilike(evidence.description, `%${q.q}%`),
              )!,
            );
          let rows = await loadEvidence(and(...where));
          if (q.validity) rows = rows.filter((r) => r.validity === q.validity);
          return c.json(rows);
        },
      )
      .get("/evidence/:id", requirePerm("controls:read"), async (c) => {
        const e = await evidenceRow(c, c.req.param("id"));
        return c.json((await loadEvidence(eq(evidence.id, e.id)))[0]);
      })
      .post(
        "/evidence",
        requirePerm(...WRITE),
        zValidator("json", EvidenceInput),
        async (c) => {
          const {
            controlIds,
            requirementIds,
            companyId: requested,
            ...input
          } = c.req.valid("json");
          let companyId = requested;
          if (!companyId && controlIds[0])
            companyId = (await controlRow(c, controlIds[0])).companyId;
          companyId = targetCompany(c, companyId);
          assertWrite(c, companyId);
          const [e] = await db
            .insert(evidence)
            .values({ ...input, companyId, createdById: currentUser(c).id })
            .returning();
          await setEvidenceControls(c, e!.id, companyId, controlIds);
          await setEvidenceRequirements(e!.id, requirementIds);
          await audit(db, {
            c,
            user: currentUser(c),
            action: "evidence.created",
            entityType: "evidence",
            entityId: e!.id,
            details: { title: e!.title, controlIds },
          });
          return c.json((await loadEvidence(eq(evidence.id, e!.id)))[0], 201);
        },
      )
      .patch(
        "/evidence/:id",
        requirePerm(...WRITE),
        zValidator("json", EvidencePatch),
        async (c) => {
          const cur = await evidenceRow(c, c.req.param("id"));
          assertWrite(c, cur.companyId);
          const {
            controlIds,
            requirementIds,
            companyId: _ignored,
            ...input
          } = c.req.valid("json");
          const set = Object.fromEntries(
            Object.entries(input).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(set).length)
            await db
              .update(evidence)
              .set({ ...set, updatedAt: new Date() })
              .where(eq(evidence.id, cur.id));
          if (controlIds)
            await setEvidenceControls(c, cur.id, cur.companyId, controlIds);
          if (requirementIds) await setEvidenceRequirements(cur.id, requirementIds);
          await audit(db, {
            c,
            user: currentUser(c),
            action: "evidence.updated",
            entityType: "evidence",
            entityId: cur.id,
            details: { ...set, controlIds },
          });
          return c.json((await loadEvidence(eq(evidence.id, cur.id)))[0]);
        },
      )
      .delete("/evidence/:id", requirePerm(...WRITE), async (c) => {
        const cur = await evidenceRow(c, c.req.param("id"));
        assertWrite(c, cur.companyId);
        const [used] = await db
          .select({ n: count() })
          .from(controlTestSamples)
          .where(eq(controlTestSamples.evidenceId, cur.id));
        if (used!.n > 0)
          throw new ApiError(409, "err.assurance.evidenceInSamples", { n: String(used!.n) });
        await db.delete(evidence).where(eq(evidence.id, cur.id));
        await audit(db, {
          c,
          user: currentUser(c),
          action: "evidence.deleted",
          entityType: "evidence",
          entityId: cur.id,
          details: { title: cur.title },
        });
        return c.json({ ok: true });
      })
      .post("/evidence/:id/files", requirePerm(...WRITE), async (c) => {
        const cur = await evidenceRow(c, c.req.param("id"));
        assertWrite(c, cur.companyId);
        const len = Number(c.req.header("content-length") ?? 0);
        if (len > EVIDENCE_MAX_BYTES + 64 * 1024)
          throw new HTTPException(413, {
            message: "Soubor je příliš velký (max. 25 MB)",
          });
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File))
          throw new HTTPException(400, {
            message: "Chybí soubor (pole „file“)",
          });
        if (file.size === 0)
          throw new HTTPException(400, { message: "Soubor je prázdný" });
        if (file.size > EVIDENCE_MAX_BYTES)
          throw new HTTPException(413, {
            message: "Soubor je příliš velký (max. 25 MB)",
          });
        const buf = Buffer.from(await file.arrayBuffer());
        const sha256 = createHash("sha256").update(buf).digest("hex");
        const type = file.type.split(";")[0]!.trim().toLowerCase();
        const mime = /^[\w.+-]+\/[\w.+-]+$/.test(type)
          ? type.slice(0, 150)
          : "application/octet-stream";
        const [f] = await db
          .insert(evidenceFiles)
          .values({
            evidenceId: cur.id,
            filename: safeFilename(file.name),
            mime,
            size: buf.length,
            sha256,
            content: buf,
            uploadedById: currentUser(c).id,
          })
          .returning({
            id: evidenceFiles.id,
            filename: evidenceFiles.filename,
          });
        await db
          .update(evidence)
          .set({
            updatedAt: new Date(),
            collectedAt:
              cur.collectedAt ?? new Date().toISOString().slice(0, 10),
          })
          .where(eq(evidence.id, cur.id));
        await audit(db, {
          c,
          user: currentUser(c),
          action: "evidence.file_uploaded",
          entityType: "evidence",
          entityId: cur.id,
          details: {
            fileId: f!.id,
            filename: f!.filename,
            size: buf.length,
            sha256,
          },
        });
        return c.json((await loadEvidence(eq(evidence.id, cur.id)))[0], 201);
      })
      .get(
        "/evidence/:id/files/:fileId",
        requirePerm("controls:read"),
        async (c) => {
          const cur = await evidenceRow(c, c.req.param("id"));
          const [f] = await db
            .select()
            .from(evidenceFiles)
            .where(
              and(
                eq(evidenceFiles.id, c.req.param("fileId")),
                eq(evidenceFiles.evidenceId, cur.id),
              ),
            );
          if (!f) throw new HTTPException(404, { message: "Soubor nenalezen" });
          await audit(db, {
            c,
            user: currentUser(c),
            action: "evidence.file_downloaded",
            entityType: "evidence",
            entityId: cur.id,
            details: { fileId: f.id, filename: f.filename },
          });
          return new Response(new Uint8Array(f.content), {
            headers: {
              "content-type": f.mime,
              "content-length": String(f.size),
              "content-disposition": `attachment; filename="${f.filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
              "x-content-type-options": "nosniff",
              "content-security-policy": "sandbox; default-src 'none'",
              "cache-control": "private, no-store",
            },
          });
        },
      )
      .delete(
        "/evidence/:id/files/:fileId",
        requirePerm(...WRITE),
        async (c) => {
          const cur = await evidenceRow(c, c.req.param("id"));
          assertWrite(c, cur.companyId);
          const [f] = await db
            .delete(evidenceFiles)
            .where(
              and(
                eq(evidenceFiles.id, c.req.param("fileId")),
                eq(evidenceFiles.evidenceId, cur.id),
              ),
            )
            .returning({
              filename: evidenceFiles.filename,
              sha256: evidenceFiles.sha256,
            });
          if (!f) throw new HTTPException(404, { message: "Soubor nenalezen" });
          await audit(db, {
            c,
            user: currentUser(c),
            action: "evidence.file_deleted",
            entityType: "evidence",
            entityId: cur.id,
            details: f,
          });
          return c.json((await loadEvidence(eq(evidence.id, cur.id)))[0]);
        },
      )

      /* ---------- testy ---------- */
      .get(
        "/tests",
        requirePerm("controls:read"),
        zValidator(
          "query",
          z.object({
            controlId: z.string().uuid().optional(),
            status: z.enum(["open", "completed", "all"]).default("all"),
            year: z.coerce.number().int().optional(),
          }),
        ),
        async (c) => {
          const q = c.req.valid("query");
          const where = [inScope(c, controlTests.companyId)];
          if (q.controlId) where.push(eq(controlTests.controlId, q.controlId));
          if (q.status === "open")
            where.push(
              inArray(controlTests.status, ["planned", "in_progress"]),
            );
          if (q.status === "completed")
            where.push(eq(controlTests.status, "completed"));
          if (q.year)
            where.push(
              or(
                and(
                  gte(controlTests.performedAt, `${q.year}-01-01`),
                  lt(controlTests.performedAt, `${q.year + 1}-01-01`),
                ),
                and(
                  isNull(controlTests.performedAt),
                  gte(controlTests.dueDate, `${q.year}-01-01`),
                  lt(controlTests.dueDate, `${q.year + 1}-01-01`),
                ),
              )!,
            );
          return c.json(await loadTests(and(...where)));
        },
      )
      .get("/tests/:id", requirePerm("controls:read"), async (c) => {
        const t = await testRow(c, c.req.param("id"));
        return c.json(await testDetail(t.id));
      })
      .post(
        "/tests",
        requirePerm(...WRITE),
        zValidator("json", ControlTestInput),
        async (c) => {
          const input = c.req.valid("json");
          const ctl = await controlRow(c, input.controlId);
          assertWrite(c, ctl.companyId);
          if (
            input.periodFrom &&
            input.periodTo &&
            input.periodFrom > input.periodTo
          )
            throw new HTTPException(400, {
              message: "Začátek období je po jeho konci",
            });
          const [t] = await db
            .insert(controlTests)
            .values({
              ...input,
              companyId: ctl.companyId,
              createdById: currentUser(c).id,
            })
            .returning();
          await audit(db, {
            c,
            user: currentUser(c),
            action: "control_test.created",
            entityType: "control",
            entityId: ctl.id,
            details: { testId: t!.id, kind: t!.kind },
          });
          return c.json(await testDetail(t!.id), 201);
        },
      )
      .patch(
        "/tests/:id",
        requirePerm(...WRITE),
        zValidator("json", ControlTestPatch),
        async (c) => {
          const cur = await testRow(c, c.req.param("id"));
          assertWrite(c, cur.companyId);
          if (cur.status === "completed")
            throw new HTTPException(409, {
              message:
                "Dokončený test nelze měnit – založte nový nebo ho znovu otevřete.",
            });
          const set = Object.fromEntries(
            Object.entries(c.req.valid("json")).filter(
              ([, v]) => v !== undefined,
            ),
          );
          await db
            .update(controlTests)
            .set({ ...set, updatedAt: new Date() })
            .where(eq(controlTests.id, cur.id));
          await audit(db, {
            c,
            user: currentUser(c),
            action: "control_test.updated",
            entityType: "control",
            entityId: cur.controlId,
            details: { testId: cur.id, ...set },
          });
          return c.json(await testDetail(cur.id));
        },
      )
      .post(
        "/tests/:id/complete",
        requirePerm(...WRITE),
        zValidator("json", CompleteTestInput),
        async (c) => {
          const cur = await testRow(c, c.req.param("id"));
          assertWrite(c, cur.companyId);
          if (cur.status === "completed")
            throw new HTTPException(409, { message: "Test je už dokončen." });
          const input = c.req.valid("json");
          const performedAt =
            input.performedAt ?? new Date().toISOString().slice(0, 10);
          await db
            .update(controlTests)
            .set({
              status: "completed",
              result: input.result,
              conclusion: input.conclusion,
              performedAt,
              updatedAt: new Date(),
            })
            .where(eq(controlTests.id, cur.id));
          const eff = input.applyEffectiveness
            ? effectivenessFromResult(input.result)
            : null;
          if (eff)
            await db
              .update(controls)
              .set({
                effectiveness: eff,
                lastReviewAt: performedAt,
                updatedAt: new Date(),
              })
              .where(eq(controls.id, cur.controlId));
          await audit(db, {
            c,
            user: currentUser(c),
            action: "control_test.completed",
            entityType: "control",
            entityId: cur.controlId,
            details: {
              testId: cur.id,
              result: input.result,
              effectiveness: eff,
            },
          });
          return c.json(await testDetail(cur.id));
        },
      )
      .post("/tests/:id/reopen", requirePerm(...WRITE), async (c) => {
        const cur = await testRow(c, c.req.param("id"));
        assertWrite(c, cur.companyId);
        if (cur.status !== "completed")
          throw new HTTPException(409, { message: "Test není dokončen." });
        await db
          .update(controlTests)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(controlTests.id, cur.id));
        await audit(db, {
          c,
          user: currentUser(c),
          action: "control_test.reopened",
          entityType: "control",
          entityId: cur.controlId,
          details: { testId: cur.id },
        });
        return c.json(await testDetail(cur.id));
      })
      .delete("/tests/:id", requirePerm(...WRITE), async (c) => {
        const cur = await testRow(c, c.req.param("id"));
        assertWrite(c, cur.companyId);
        if (cur.status === "completed")
          throw new HTTPException(409, {
            message:
              "Dokončený test je auditní záznam – nelze ho smazat (můžete ho znovu otevřít).",
          });
        await db.delete(controlTests).where(eq(controlTests.id, cur.id));
        await audit(db, {
          c,
          user: currentUser(c),
          action: "control_test.deleted",
          entityType: "control",
          entityId: cur.controlId,
          details: { testId: cur.id },
        });
        return c.json({ ok: true });
      })
      .post(
        "/tests/:id/samples",
        requirePerm(...WRITE),
        zValidator(
          "json",
          z.union([SampleInput, z.array(SampleInput).max(200)]),
        ),
        async (c) => {
          const cur = await testRow(c, c.req.param("id"));
          assertWrite(c, cur.companyId);
          if (cur.status === "completed")
            throw new HTTPException(409, {
              message: "Dokončený test nelze měnit.",
            });
          const list = [c.req.valid("json")].flat();
          for (const s of list) await assertEvidenceVisible(c, s.evidenceId);
          const [{ n }] = (await db
            .select({ n: count() })
            .from(controlTestSamples)
            .where(eq(controlTestSamples.testId, cur.id))) as [{ n: number }];
          if (list.length)
            await db
              .insert(controlTestSamples)
              .values(
                list.map((s, i) => ({ ...s, testId: cur.id, order: n + i })),
              );
          if (cur.status === "planned")
            await db
              .update(controlTests)
              .set({ status: "in_progress", updatedAt: new Date() })
              .where(eq(controlTests.id, cur.id));
          return c.json(await testDetail(cur.id), 201);
        },
      )
      .patch(
        "/tests/:id/samples/:sid",
        requirePerm(...WRITE),
        zValidator("json", SampleInput.partial()),
        async (c) => {
          const cur = await testRow(c, c.req.param("id"));
          assertWrite(c, cur.companyId);
          if (cur.status === "completed")
            throw new HTTPException(409, {
              message: "Dokončený test nelze měnit.",
            });
          const input = c.req.valid("json");
          await assertEvidenceVisible(c, input.evidenceId);
          const set = Object.fromEntries(
            Object.entries(input).filter(([, v]) => v !== undefined),
          );
          const [s] = await db
            .update(controlTestSamples)
            .set({ ...set, updatedAt: new Date() })
            .where(
              and(
                eq(controlTestSamples.id, c.req.param("sid")),
                eq(controlTestSamples.testId, cur.id),
              ),
            )
            .returning({ id: controlTestSamples.id });
          if (!s) throw new HTTPException(404, { message: "Vzorek nenalezen" });
          return c.json(await testDetail(cur.id));
        },
      )
      .delete("/tests/:id/samples/:sid", requirePerm(...WRITE), async (c) => {
        const cur = await testRow(c, c.req.param("id"));
        assertWrite(c, cur.companyId);
        if (cur.status === "completed")
          throw new HTTPException(409, {
            message: "Dokončený test nelze měnit.",
          });
        await db
          .delete(controlTestSamples)
          .where(
            and(
              eq(controlTestSamples.id, c.req.param("sid")),
              eq(controlTestSamples.testId, cur.id),
            ),
          );
        return c.json(await testDetail(cur.id));
      })
  );
}
