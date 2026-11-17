import { mirrorSecTestCves } from "./cves";
import {
  ProbePollInput,
  ProbeResultInput,
  SecTestAssignInput,
  SecTestBatchInput,
  SecTestFindingPatch,
  SecTestFollowInput,
  SecTestImportInput,
  SecTestRunInput,
  SecTestScopeInput,
  SecTestTasksInput,
  SecTestScheduleInput,
  SecTestReportQuery,
  SecTestControlInput,
  type SecTestSummaryDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { getCompanies, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { assets, controls, secTestBatches, secTestFindings, secTestRuns, secTestSchedules, secTestScopes } from "../../db/schema";
import { printPage } from "../documents/render";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { secTestReport } from "./report";
import { runSchedule, scheduleDtos } from "./schedules";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { tFor } from "../i18n/service";
import { AiUnavailable, adviseFinding, autoAiAfterRun, summarizeBatch, summarizeRun } from "./ai";
import { createFindingTasks, closeFindingTasks } from "./tasks";
import { planBatch, assignFinding, batchDtos, createBatch, completeRun, findingDtos, ingestProbeResult, pollProbe, probeByToken, probeDtos, runDtos, scopeDtos, scopeProblem } from "./service";

/* ============================================================
 * Bezpečnostní testy (v1.56, ADR-153): rozsahy (schválení zvlášť), běhy pro sondu, import výstupů, nálezy, AI.
 * ============================================================ */

type Ctx = Context<AppEnv>;
const MAX_BYTES = 10 * 1024 * 1024;

/** POST /api/public/probe/poll a /result – Authorization: Bearer ctxp_… (token sondy). */
export function publicProbeRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike; onBackground?: (p: Promise<unknown>) => void }) {
  const { db } = deps;
  const auth = async (c: Context) => {
    const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
    const probe = m ? await probeByToken(db, m[1]!) : null;
    if (!probe) {
      c.header("www-authenticate", 'Bearer realm="contix"');
      throw new HTTPException(401, { message: "Neplatný nebo vypnutý token sondy" });
    }
    return probe;
  };
  const body = async (c: Context) => {
    if (Number(c.req.header("content-length") ?? 0) > MAX_BYTES) throw new HTTPException(413, { message: "Výstup je větší než 10 MB" });
    const text = await c.req.text();
    if (text.length > MAX_BYTES) throw new HTTPException(413, { message: "Výstup je větší než 10 MB" });
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HTTPException(400, { message: "Neplatný JSON" });
    }
  };
  return new Hono()
    .post("/poll", async (c) => {
      const probe = await auth(c);
      const p = ProbePollInput.safeParse(await body(c));
      if (!p.success) throw new HTTPException(400, { message: "Neplatné hlášení sondy" });
      const job = await pollProbe(db, probe, { version: p.data.version, hostname: p.data.hostname, tools: p.data.tools });
      if (job) await audit(db, { action: "sectest.run_started", entityType: "sec_test_run", entityId: job.runId, details: { probe: probe.name, testId: job.testId, targets: job.targets.slice(0, 20) } });
      return c.json(job);
    })
    .post("/result", async (c) => {
      const probe = await auth(c);
      const p = ProbeResultInput.safeParse(await body(c));
      if (!p.success) throw new HTTPException(400, { message: `Neplatný výsledek: ${p.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
      const stats = await ingestProbeResult(db, probe, p.data);
      if (!stats) throw new HTTPException(409, { message: "Úloha neexistuje, nepatří této sondě nebo už skončila" });
      await audit(db, { action: "sectest.run_finished", entityType: "sec_test_run", entityId: p.data.runId, details: { probe: probe.name, ...stats, error: p.data.error } });
      // automatická AI sady (rozbor nálezů, shrnutí) běží na pozadí – sonda nečeká na model
      const job = autoAiAfterRun(db, deps.config, p.data.runId, deps.fetchImpl).catch(() => null);
      deps.onBackground?.(job);
      return c.json(stats);
    });
}


export function secTestRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike }) {
  const { db, config } = deps;
  const ids = (c: Ctx, perm: "sectests:read" | "sectests:run" | "sectests:approve" = "sectests:read") => scopeOf(c).ids.filter((id) => hasPermIn(c, perm, id));
  const need = (c: Ctx, companyId: string, perm: "sectests:read" | "sectests:run" | "sectests:approve", what = "Záznam nenalezen") => {
    if (!ids(c).includes(companyId)) throw new HTTPException(404, { message: what });
    if (!hasPermIn(c, perm, companyId)) throw new HTTPException(403, { message: "Chybí oprávnění" });
  };
  const scopeRow = async (c: Ctx, id: string, perm: "sectests:read" | "sectests:run" | "sectests:approve") => {
    const [s] = await db.select().from(secTestScopes).where(eq(secTestScopes.id, id));
    need(c, s?.companyId ?? "", perm, "Rozsah nenalezen");
    return s!;
  };
  const runRow = async (c: Ctx, id: string, perm: "sectests:read" | "sectests:run") => {
    const [r] = await db.select().from(secTestRuns).where(eq(secTestRuns.id, id));
    need(c, r?.companyId ?? "", perm, "Běh nenalezen");
    return r!;
  };
  const inIds = (c: Ctx, col: Parameters<typeof inArray>[0]): SQL | undefined => {
    const list = ids(c);
    return list.length ? inArray(col, list) : sql`false`;
  };
  /** AI na pokyn uživatele: nedostupná AI → 400, chyba modelu → 502. */
  const viaAi = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiUnavailable) throw new HTTPException(400, { message: "AI asistent není zapnutý." });
      throw new HTTPException(502, { message: `AI: ${(e as Error).message}`.slice(0, 300) });
    }
  };
  const findingRow = async (c: Ctx, id: string, perm: "sectests:read" | "sectests:run") => {
    const [f] = await db.select().from(secTestFindings).where(eq(secTestFindings.id, id));
    need(c, f?.companyId ?? "", perm, "Nález nenalezen");
    return f!;
  };
  const batchRow = async (c: Ctx, id: string, perm: "sectests:read" | "sectests:run") => {
    const [b] = await db.select().from(secTestBatches).where(eq(secTestBatches.id, id));
    need(c, b?.companyId ?? "", perm, "Sada nenalezena");
    return b!;
  };

  /** Zpráva z testů za společnosti, kde smí uživatel číst (aktivní společnost, jinak všechny dostupné). */
  const reportFor = async (c: Ctx) => {
    const q = c.req.valid("query" as never) as SecTestReportQuery;
    const sc = scopeOf(c);
    const active = sc.active && hasPermIn(c, "sectests:read", sc.active) ? [sc.active] : ids(c);
    const name = (await getCompanies(db)).find((x) => x.id === (sc.active ?? active[0]))?.name ?? "";
    return secTestReport(db, active, q, name);
  };

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "sectests"))
      /* ---- rozsahy ---- */
      .get("/scopes", requirePerm("sectests:read"), async (c) => c.json(await scopeDtos(db, inIds(c, secTestScopes.companyId))))
      .post("/scopes", requirePerm("sectests:run"), zValidator("json", SecTestScopeInput), async (c) => {
        const i = c.req.valid("json");
        const companyId = targetCompany(c, i.companyId ?? null, "sectests:run");
        if (i.validTo < i.validFrom) throw new HTTPException(400, { message: "Konec platnosti je před začátkem" });
        const [s] = await db
          .insert(secTestScopes)
          .values({ companyId, name: i.name, targets: i.targets, exclusions: i.exclusions ?? [], validFrom: i.validFrom, validTo: i.validTo, authorization: i.authorization, categories: i.categories ?? [], note: i.note ?? null, createdById: currentUser(c).id })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "sectest.scope_created", entityType: "sec_test_scope", entityId: s!.id, details: { name: i.name, targets: i.targets.slice(0, 50) } });
        return c.json((await scopeDtos(db, eq(secTestScopes.id, s!.id)))[0], 201);
      })
      .put("/scopes/:id", requirePerm("sectests:run"), zValidator("json", SecTestScopeInput), async (c) => {
        const s = await scopeRow(c, c.req.param("id"), "sectests:run");
        const i = c.req.valid("json");
        if (i.validTo < i.validFrom) throw new HTTPException(400, { message: "Konec platnosti je před začátkem" });
        // změna rozsahu ruší schválení – nový rozsah musí někdo znovu schválit
        await db
          .update(secTestScopes)
          .set({ name: i.name, targets: i.targets, exclusions: i.exclusions ?? [], validFrom: i.validFrom, validTo: i.validTo, authorization: i.authorization, categories: i.categories ?? [], note: i.note ?? null, approvedAt: null, approvedById: null, updatedAt: new Date() })
          .where(eq(secTestScopes.id, s.id));
        await audit(db, { c, user: currentUser(c), action: "sectest.scope_updated", entityType: "sec_test_scope", entityId: s.id, details: { name: i.name, targets: i.targets.slice(0, 50) } });
        return c.json((await scopeDtos(db, eq(secTestScopes.id, s.id)))[0]);
      })
      .post("/scopes/:id/approve", requirePerm("sectests:approve"), async (c) => {
        const s = await scopeRow(c, c.req.param("id"), "sectests:approve");
        await db.update(secTestScopes).set({ approvedAt: new Date(), approvedById: currentUser(c).id, updatedAt: new Date() }).where(eq(secTestScopes.id, s.id));
        await audit(db, { c, user: currentUser(c), action: "sectest.scope_approved", entityType: "sec_test_scope", entityId: s.id, details: { name: s.name, targets: s.targets.slice(0, 50), validTo: s.validTo } });
        return c.json((await scopeDtos(db, eq(secTestScopes.id, s.id)))[0]);
      })
      .delete("/scopes/:id", requirePerm("sectests:approve"), async (c) => {
        const s = await scopeRow(c, c.req.param("id"), "sectests:approve");
        await db.delete(secTestScopes).where(eq(secTestScopes.id, s.id));
        await audit(db, { c, user: currentUser(c), action: "sectest.scope_deleted", entityType: "sec_test_scope", entityId: s.id, details: { name: s.name } });
        return c.body(null, 204);
      })

      /* ---- běhy ---- */
      .get("/runs", requirePerm("sectests:read"), async (c) => c.json(await runDtos(db, inIds(c, secTestRuns.companyId))))
      .get("/runs/:id", requirePerm("sectests:read"), async (c) => {
        const r = await runRow(c, c.req.param("id"), "sectests:read");
        const [dto] = await runDtos(db, eq(secTestRuns.id, r.id), 1);
        return c.json({ ...dto, outputs: r.outputs, findings: await findingDtos(db, eq(secTestFindings.runId, r.id)) });
      })
      .post("/runs", requirePerm("sectests:run"), zValidator("json", SecTestRunInput), async (c) => {
        const i = c.req.valid("json");
        const s = await scopeRow(c, i.scopeId, "sectests:run");
        const targets = [...new Set(i.targets.map((x) => x.trim()))];
        const why = scopeProblem(s, i.testId, targets);
        if (why) throw new HTTPException(400, { message: `Test nelze spustit: ${why}` });
        if (i.probeId) {
          const probes = await probeDtos(db, [s.companyId]);
          if (!probes.some((p) => p.id === i.probeId && p.enabled)) throw new HTTPException(400, { message: "Sonda nepatří společnosti rozsahu nebo je vypnutá" });
        }
        const [r] = await db
          .insert(secTestRuns)
          .values({ companyId: s.companyId, scopeId: s.id, testId: i.testId, targets, ports: i.ports ?? [], source: "probe", probeId: i.probeId ?? null, requestedById: currentUser(c).id })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "sectest.run_queued", entityType: "sec_test_run", entityId: r!.id, details: { testId: i.testId, scope: s.name, targets: targets.slice(0, 50) } });
        return c.json((await runDtos(db, eq(secTestRuns.id, r!.id), 1))[0], 201);
      })
      .post("/runs/:id/cancel", requirePerm("sectests:run"), async (c) => {
        const r = await runRow(c, c.req.param("id"), "sectests:run");
        if (r.status !== "queued") throw new HTTPException(400, { message: "Zrušit lze jen čekající úlohu" });
        await db.update(secTestRuns).set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() }).where(eq(secTestRuns.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "sectest.run_cancelled", entityType: "sec_test_run", entityId: r.id });
        return c.json((await runDtos(db, eq(secTestRuns.id, r.id), 1))[0]);
      })
      .post("/import", requirePerm("sectests:run"), zValidator("json", SecTestImportInput), async (c) => {
        const i = c.req.valid("json");
        const s = await scopeRow(c, i.scopeId, "sectests:run");
        // import nepouští nic – ale nálezy patří jen k cílům, které rozsah povoluje
        const target = i.target.trim();
        if (target) {
          const why = scopeProblem({ ...s, categories: s.categories }, i.testId, [target]);
          if (why) throw new HTTPException(400, { message: `Import nelze uložit: ${why}` });
        } else if (!s.approvedAt) throw new HTTPException(400, { message: "Import nelze uložit: rozsah není schválen" });
        const [r] = await db
          .insert(secTestRuns)
          .values({ companyId: s.companyId, scopeId: s.id, testId: i.testId, targets: target ? [target] : [], source: "import", status: "running", startedAt: new Date(), requestedById: currentUser(c).id })
          .returning();
        const stats = await completeRun(db, r!, [{ target, label: i.fileName, stdout: i.content }], null);
        await audit(db, { c, user: currentUser(c), action: "sectest.imported", entityType: "sec_test_run", entityId: r!.id, details: { testId: i.testId, file: i.fileName, scope: s.name, ...stats } });
        return c.json((await runDtos(db, eq(secTestRuns.id, r!.id), 1))[0], 201);
      })

      /* ---- nálezy ---- */
      .get("/findings", requirePerm("sectests:read"), async (c) => c.json(await findingDtos(db, inIds(c, secTestFindings.companyId))))
      .patch("/findings/:id", requirePerm("sectests:run"), zValidator("json", SecTestFindingPatch), async (c) => {
        const [f] = await db.select().from(secTestFindings).where(eq(secTestFindings.id, c.req.param("id")));
        need(c, f?.companyId ?? "", "sectests:run", "Nález nenalezen");
        const i = c.req.valid("json");
        await db
          .update(secTestFindings)
          .set({
            status: i.status,
            note: i.note ?? f!.note,
            fixedAt: i.status === "fixed" ? new Date() : null,
            // přijaté riziko (v1.64): kdo a do kdy – zobrazí se ve Výjimkách a přijatých rizicích
            acceptedById: i.status === "accepted" ? currentUser(c).id : null,
            acceptedAt: i.status === "accepted" ? new Date() : null,
            acceptedUntil: i.status === "accepted" ? (i.until ?? null) : null,
            updatedAt: new Date(),
          })
          .where(eq(secTestFindings.id, f!.id));
        if (i.status !== "open") {
          const today = new Date().toISOString().slice(0, 10);
          const note = i.status === "fixed" ? `Nález označen jako opravený (${today}).` : `Nález uzavřen jako „${i.status}“ (${today})${i.note ? `: ${i.note}` : ""}.`;
          await closeFindingTasks(db, [f!.id], i.status === "fixed" ? "done" : "cancelled", note.slice(0, 4000));
        }
        await mirrorSecTestCves(db, f!.companyId, [f!.id]);
        await audit(db, { c, user: currentUser(c), action: "sectest.finding_status", entityType: "sec_test_finding", entityId: f!.id, details: { from: f!.status, to: i.status, title: f!.title } });
        return c.json((await findingDtos(db, eq(secTestFindings.id, f!.id), 1))[0]);
      })
      /** Úkoly na odstranění nálezů – technickým garantům aktiv (v1.60, ADR-155). */
      .post("/findings/tasks", requirePerm("sectests:run"), requirePerm("actions:write"), zValidator("json", SecTestTasksInput), async (c) => {
        const ids = [...new Set(c.req.valid("json").ids)];
        const rows = await db.select({ id: secTestFindings.id, companyId: secTestFindings.companyId }).from(secTestFindings).where(inArray(secTestFindings.id, ids));
        if (rows.length !== ids.length) throw new HTTPException(404, { message: "Nález nenalezen" });
        for (const r of rows) need(c, r.companyId, "sectests:run", "Nález nenalezen");
        const { taskIds, ...res } = await createFindingTasks(db, ids, currentUser(c).id);
        if (res.created) await audit(db, { c, user: currentUser(c), action: "sectest.tasks_created", entityType: "sec_test_finding", entityId: ids[0]!, details: { ...res, findings: ids.length, taskIds: taskIds.slice(0, 50) } });
        return c.json(res);
      })
      .post("/findings/:id/advice", requirePerm("sectests:read"), requirePerm("ai:use"), async (c) => {
        const f = await findingRow(c, c.req.param("id"), "sectests:read");
        const t = await tFor(db, c);
        const advice = await viaAi(() => adviseFinding(db, config, f.id, t, deps.fetchImpl));
        await audit(db, { c, user: currentUser(c), action: "sectest.advice_generated", entityType: "sec_test_finding", entityId: f.id, details: { model: advice?.model } });
        return c.json((await findingDtos(db, eq(secTestFindings.id, f.id), 1))[0]);
      })
      .post("/runs/:id/summary", requirePerm("sectests:read"), requirePerm("ai:use"), async (c) => {
        const r = await runRow(c, c.req.param("id"), "sectests:read");
        const t = await tFor(db, c);
        const sm = await viaAi(() => summarizeRun(db, config, r.id, t, deps.fetchImpl));
        await audit(db, { c, user: currentUser(c), action: "sectest.summary_generated", entityType: "sec_test_run", entityId: r.id, details: { model: sm?.model } });
        return c.json((await runDtos(db, eq(secTestRuns.id, r.id), 1))[0]);
      })
      /** Ruční přiřazení nálezu k aktivu (v1.56.1). */
      .patch("/findings/:id/asset", requirePerm("sectests:run"), zValidator("json", SecTestAssignInput), async (c) => {
        const f = await findingRow(c, c.req.param("id"), "sectests:run");
        const i = c.req.valid("json");
        if (i.assetId) {
          const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, i.assetId));
          if (!a || a.companyId !== f.companyId) throw new HTTPException(400, { message: "Aktivum nepatří do stejné společnosti jako nález" });
        }
        // adresu do aktiva zapíše jen ten, kdo smí aktiva upravovat
        const r = await assignFinding(db, f, i.assetId, i.sameHost ?? true, (i.rememberAddress ?? true) && hasPermIn(c, "assets:write", f.companyId));
        await audit(db, { c, user: currentUser(c), action: "sectest.finding_assigned", entityType: "sec_test_finding", entityId: f.id, details: { assetId: i.assetId, host: f.host, ...r } });
        return c.json({ ...r, finding: (await findingDtos(db, eq(secTestFindings.id, f.id), 1))[0] });
      })
      /** Spustit navržené testy na cíl nálezu (z AI nebo navazujících) – v rozsahu běhu nálezu. */
      .post("/findings/:id/follow", requirePerm("sectests:run"), zValidator("json", SecTestFollowInput), async (c) => {
        const f = await findingRow(c, c.req.param("id"), "sectests:run");
        const [run] = await db.select().from(secTestRuns).where(eq(secTestRuns.id, f.runId));
        const scope = await scopeRow(c, run!.scopeId, "sectests:run");
        const r = await createBatch(db, scope, { name: `Navazující: ${f.title}`.slice(0, 200), testIds: c.req.valid("json").testIds, targets: [f.host], ports: f.port ? [f.port] : [], portsAll: true, probeId: run!.probeId, autoFollow: false, autoAi: false }, currentUser(c).id);
        if (r.error) throw new HTTPException(400, { message: `Test nelze spustit: ${r.error}` });
        await audit(db, { c, user: currentUser(c), action: "sectest.batch_queued", entityType: "sec_test_batch", entityId: r.batchId!, details: { from: f.id, testIds: c.req.valid("json").testIds } });
        return c.json((await batchDtos(db, eq(secTestBatches.id, r.batchId!), 1))[0], 201);
      })

      /* ---- sady (víc testů najednou, v1.56.1) ---- */
      .get("/batches", requirePerm("sectests:read"), async (c) => c.json(await batchDtos(db, inIds(c, secTestBatches.companyId))))
      .get("/batches/:id", requirePerm("sectests:read"), async (c) => {
        const b = await batchRow(c, c.req.param("id"), "sectests:read");
        const [dto] = await batchDtos(db, eq(secTestBatches.id, b.id), 1);
        const runIds = dto!.runs.map((r) => r.id);
        return c.json({ ...dto, findings: runIds.length ? await findingDtos(db, inArray(secTestFindings.runId, runIds)) : [] });
      })
      .post("/batches", requirePerm("sectests:run"), zValidator("json", SecTestBatchInput), async (c) => {
        const i = c.req.valid("json");
        const s = await scopeRow(c, i.scopeId, "sectests:run");
        if (i.probeId) {
          const probes = await probeDtos(db, [s.companyId]);
          if (!probes.some((p) => p.id === i.probeId && p.enabled)) throw new HTTPException(400, { message: "Sonda nepatří společnosti rozsahu nebo je vypnutá" });
        }
        const targets = [...new Set(i.targets.map((x) => x.trim()))];
        const r = await createBatch(db, s, { name: i.name ?? "", testIds: i.testIds, targets, ports: i.ports ?? [], probeId: i.probeId ?? null, autoFollow: i.autoFollow ?? true, autoAi: i.autoAi ?? false, autoTasks: i.autoTasks ?? false }, currentUser(c).id);
        if (r.error) throw new HTTPException(400, { message: `Testy nelze spustit: ${r.error}` });
        await audit(db, { c, user: currentUser(c), action: "sectest.batch_queued", entityType: "sec_test_batch", entityId: r.batchId!, details: { scope: s.name, testIds: i.testIds, targets: targets.slice(0, 50), autoFollow: i.autoFollow, autoAi: i.autoAi } });
        return c.json({ ...(await batchDtos(db, eq(secTestBatches.id, r.batchId!), 1))[0], skipped: r.skipped }, 201);
      })
      .post("/batches/:id/summary", requirePerm("sectests:read"), requirePerm("ai:use"), async (c) => {
        const b = await batchRow(c, c.req.param("id"), "sectests:read");
        const t = await tFor(db, c);
        const sm = await viaAi(() => summarizeBatch(db, config, b.id, t, deps.fetchImpl));
        await audit(db, { c, user: currentUser(c), action: "sectest.summary_generated", entityType: "sec_test_batch", entityId: b.id, details: { model: sm?.model } });
        return c.json((await batchDtos(db, eq(secTestBatches.id, b.id), 1))[0]);
      })
      /** Doporučené testy (AI shrnutí sady) na původní cíle sady. */
      .post("/batches/:id/next", requirePerm("sectests:run"), zValidator("json", SecTestFollowInput), async (c) => {
        const b = await batchRow(c, c.req.param("id"), "sectests:run");
        const scope = await scopeRow(c, b.scopeId, "sectests:run");
        const roots = await db.select({ targets: secTestRuns.targets, probeId: secTestRuns.probeId }).from(secTestRuns).where(and(eq(secTestRuns.batchId, b.id), sql`${secTestRuns.parentRunId} is null`));
        const targets = [...new Set(roots.flatMap((r) => r.targets))];
        const r = await createBatch(db, scope, { name: `Doporučené: ${b.name}`.slice(0, 200), testIds: c.req.valid("json").testIds, targets, ports: [], probeId: roots[0]?.probeId ?? null, autoFollow: b.autoFollow, autoAi: b.autoAi, autoTasks: b.autoTasks }, currentUser(c).id);
        if (r.error) throw new HTTPException(400, { message: `Testy nelze spustit: ${r.error}` });
        await audit(db, { c, user: currentUser(c), action: "sectest.batch_queued", entityType: "sec_test_batch", entityId: r.batchId!, details: { from: b.id, testIds: c.req.valid("json").testIds } });
        return c.json((await batchDtos(db, eq(secTestBatches.id, r.batchId!), 1))[0], 201);
      })

      /** Souhrn pro Přehled (v1.57): otevřené nálezy podle závažnosti, běhy za 30 dní, sondy online. */
      .get("/summary", requirePerm("sectests:read"), async (c) => {
        const list = ids(c);
        const empty: SecTestSummaryDto = { open: { critical: 0, high: 0, medium: 0, low: 0 }, accepted: 0, fixed30d: 0, runs30d: 0, active: 0, failed30d: 0, lastRunAt: null, probes: { total: 0, online: 0 }, scopesApproved: 0 };
        if (!list.length) return c.json(empty);
        const since = new Date(Date.now() - 30 * 86400_000).toISOString();
        const [f] = await db
          .select({
            critical: sql<number>`count(*) filter (where ${secTestFindings.status} = 'open' and ${secTestFindings.severity} = 'critical')::int`,
            high: sql<number>`count(*) filter (where ${secTestFindings.status} = 'open' and ${secTestFindings.severity} = 'high')::int`,
            medium: sql<number>`count(*) filter (where ${secTestFindings.status} = 'open' and ${secTestFindings.severity} = 'medium')::int`,
            low: sql<number>`count(*) filter (where ${secTestFindings.status} = 'open' and ${secTestFindings.severity} = 'low')::int`,
            accepted: sql<number>`count(*) filter (where ${secTestFindings.status} = 'accepted')::int`,
            fixed30d: sql<number>`count(*) filter (where ${secTestFindings.status} = 'fixed' and ${secTestFindings.fixedAt} >= ${since})::int`,
          })
          .from(secTestFindings)
          .where(inArray(secTestFindings.companyId, list));
        const [r] = await db
          .select({
            runs30d: sql<number>`count(*) filter (where ${secTestRuns.createdAt} >= ${since})::int`,
            active: sql<number>`count(*) filter (where ${secTestRuns.status} in ('queued', 'running'))::int`,
            failed30d: sql<number>`count(*) filter (where ${secTestRuns.status} = 'failed' and ${secTestRuns.createdAt} >= ${since})::int`,
            last: sql<Date | null>`max(${secTestRuns.finishedAt})`,
          })
          .from(secTestRuns)
          .where(inArray(secTestRuns.companyId, list));
        const probes = await probeDtos(db, list);
        const scopes = await scopeDtos(db, inArray(secTestScopes.companyId, list));
        const out: SecTestSummaryDto = {
          open: { critical: f!.critical, high: f!.high, medium: f!.medium, low: f!.low },
          accepted: f!.accepted,
          fixed30d: f!.fixed30d,
          runs30d: r!.runs30d,
          active: r!.active,
          failed30d: r!.failed30d,
          lastRunAt: r!.last ? new Date(r!.last).toISOString() : null,
          probes: { total: probes.length, online: probes.filter((p) => p.enabled && p.lastSeenAt && Date.now() - new Date(p.lastSeenAt).getTime() < 3 * 60_000).length },
          scopesApproved: scopes.filter((s) => s.status === "approved").length,
        };
        return c.json(out);
      })
      /* ---- sondy (stav; správa v Administraci → Konektory) ---- */
      /* ---- pravidelné testy (v1.63) ---- */
      .get("/schedules", requirePerm("sectests:read"), async (c) => c.json(await scheduleDtos(db, inIds(c, secTestSchedules.companyId))))
      .post("/schedules", requirePerm("sectests:run"), zValidator("json", SecTestScheduleInput), async (c) => {
        const i = c.req.valid("json");
        const s = await scopeRow(c, i.scopeId, "sectests:run");
        const plan = planBatch(s, i.testIds, i.targets, i.ports ?? []);
        if (plan.error) throw new HTTPException(400, { message: `Plán nelze uložit: ${plan.error}` });
        const [row] = await db
          .insert(secTestSchedules)
          .values({ companyId: s.companyId, scopeId: s.id, name: i.name, testIds: i.testIds, targets: i.targets, ports: i.ports ?? [], probeId: i.probeId ?? null, intervalDays: i.intervalDays ?? 7, autoFollow: i.autoFollow ?? true, autoAi: i.autoAi ?? false, autoTasks: i.autoTasks ?? true, enabled: i.enabled ?? true, nextRunAt: i.firstRunAt ? new Date(i.firstRunAt) : new Date(), createdById: currentUser(c).id })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "sectest.schedule_created", entityType: "sec_test_schedule", entityId: row!.id, details: { name: i.name, intervalDays: row!.intervalDays, testIds: i.testIds } });
        return c.json((await scheduleDtos(db, eq(secTestSchedules.id, row!.id)))[0], 201);
      })
      .put("/schedules/:id", requirePerm("sectests:run"), zValidator("json", SecTestScheduleInput), async (c) => {
        const [cur] = await db.select().from(secTestSchedules).where(eq(secTestSchedules.id, c.req.param("id")));
        need(c, cur?.companyId ?? "", "sectests:run", "Plán nenalezen");
        const i = c.req.valid("json");
        const s = await scopeRow(c, i.scopeId, "sectests:run");
        if (s.companyId !== cur!.companyId) throw new HTTPException(400, { message: "Rozsah patří jiné společnosti" });
        const plan = planBatch(s, i.testIds, i.targets, i.ports ?? []);
        if (plan.error) throw new HTTPException(400, { message: `Plán nelze uložit: ${plan.error}` });
        await db
          .update(secTestSchedules)
          .set({ scopeId: s.id, name: i.name, testIds: i.testIds, targets: i.targets, ports: i.ports ?? [], probeId: i.probeId ?? null, intervalDays: i.intervalDays ?? 7, autoFollow: i.autoFollow ?? true, autoAi: i.autoAi ?? false, autoTasks: i.autoTasks ?? true, enabled: i.enabled ?? true, ...(i.firstRunAt ? { nextRunAt: new Date(i.firstRunAt) } : {}), updatedAt: new Date() })
          .where(eq(secTestSchedules.id, cur!.id));
        await audit(db, { c, user: currentUser(c), action: "sectest.schedule_updated", entityType: "sec_test_schedule", entityId: cur!.id, details: { name: i.name, enabled: i.enabled } });
        return c.json((await scheduleDtos(db, eq(secTestSchedules.id, cur!.id)))[0]);
      })
      .delete("/schedules/:id", requirePerm("sectests:run"), async (c) => {
        const [cur] = await db.select().from(secTestSchedules).where(eq(secTestSchedules.id, c.req.param("id")));
        need(c, cur?.companyId ?? "", "sectests:run", "Plán nenalezen");
        await db.delete(secTestSchedules).where(eq(secTestSchedules.id, cur!.id));
        await audit(db, { c, user: currentUser(c), action: "sectest.schedule_deleted", entityType: "sec_test_schedule", entityId: cur!.id, details: { name: cur!.name } });
        return c.json({ ok: true });
      })
      .post("/schedules/:id/run", requirePerm("sectests:run"), async (c) => {
        const [cur] = await db.select().from(secTestSchedules).where(eq(secTestSchedules.id, c.req.param("id")));
        need(c, cur?.companyId ?? "", "sectests:run", "Plán nenalezen");
        const r = await runSchedule(db, cur!, new Date(), currentUser(c).id);
        if (r.error) throw new HTTPException(400, { message: `Testy nelze spustit: ${r.error}` });
        await audit(db, { c, user: currentUser(c), action: "sectest.schedule_run", entityType: "sec_test_schedule", entityId: cur!.id, details: { batchId: r.batchId } });
        return c.json((await scheduleDtos(db, eq(secTestSchedules.id, cur!.id)))[0]);
      })

      /* ---- zpráva z testů (v1.63) ---- */
      .get("/report.html", requirePerm("sectests:read"), zValidator("query", SecTestReportQuery), async (c) => {
        const r = await reportFor(c);
        return c.html(printPage(r.title, r.body), 200, { "cache-control": "private, no-store" });
      })
      .get("/report.docx", requirePerm("sectests:read"), zValidator("query", SecTestReportQuery), async (c) => {
        const r = await reportFor(c);
        return docxResponse(await htmlToDocx(r.body, { title: r.title }), `${r.title}.docx`);
      })

      /* ---- vazba nálezu na opatření (v1.63) ---- */
      .patch("/findings/:id/control", requirePerm("sectests:run"), zValidator("json", SecTestControlInput), async (c) => {
        const f = await findingRow(c, c.req.param("id"), "sectests:run");
        const { controlId } = c.req.valid("json");
        if (controlId) {
          const [ctl] = await db.select({ companyId: controls.companyId }).from(controls).where(eq(controls.id, controlId));
          if (!ctl || ctl.companyId !== f.companyId) throw new HTTPException(400, { message: "Opatření nepatří společnosti nálezu" });
        }
        await db.update(secTestFindings).set({ controlId, updatedAt: new Date() }).where(eq(secTestFindings.id, f.id));
        await audit(db, { c, user: currentUser(c), action: "sectest.finding_control", entityType: "sec_test_finding", entityId: f.id, details: { controlId, title: f.title } });
        return c.json((await findingDtos(db, eq(secTestFindings.id, f.id), 1))[0]);
      })
      .get("/by-control/:controlId", requirePerm("sectests:read"), async (c) => c.json(await findingDtos(db, and(inIds(c, secTestFindings.companyId), eq(secTestFindings.controlId, c.req.param("controlId"))), 200)))
      .get("/probes", requirePerm("sectests:read"), async (c) => c.json(await probeDtos(db, ids(c))))
      .get("/asset/:assetId", requirePerm("sectests:read"), async (c) => {
        const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, c.req.param("assetId")));
        need(c, a?.companyId ?? "", "sectests:read", "Aktivum nenalezeno");
        return c.json(await findingDtos(db, and(eq(secTestFindings.assetId, c.req.param("assetId")), inArray(secTestFindings.status, ["open", "accepted"]))));
      })
  );
}
