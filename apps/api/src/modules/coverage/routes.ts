import { profileOf, bestDocState,
  COVERAGE_LABELS,
  coverageGaps,
  CoverageScoreInput,
  CoverageSnapshotInput,
  FrameworkIdSchema,
  gapScore,
  summarizeCoverage,
  type CoverageBatchStatus,
  type CoverageDoc,
  type CoverageDto,
  type CoverageRow,
  type CoverageSnapshotDetail,
  type CoverageSnapshotDto,
  type CoverageSummary,
  type FrameworkId,
  type GapItem,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, settingsFor, soleCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { aiSuggestions, coverageSnapshots, policies, policyRequirements, policyVersions, users } from "../../db/schema";
import { ApiError } from "../../lib/apiError";
import { getAiSettings, prepareRequest, runSuggestion } from "../ai/service";
import { loadRequirementRows } from "../controls/routes";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { tFor } from "../i18n/service";

/* ============================================================
 * Pokrytí předpisu (ADR-038) – /api/coverage
 * Matice ustanovení × dokumenty (AI verdikt lokálního modelu) × opatření, hromadné AI skóre dokumentů (sekvenčně, na pozadí)
 * a neměnné snímky pro audit. Stav se počítá při čtení, ukládají se jen snímky.
 * ============================================================ */

type Ctx = Context<AppEnv>;
const DONE_STATUSES = ["proposed", "accepted", "partially_accepted", "rejected"] as const;
const FrameworkQuery = z.object({ framework: FrameworkIdSchema });

/** Matice pokrytí rámce pro společnost. `withDocs` = uživatel smí číst dokumentaci (jinak se dokumenty neukazují ani nehodnotí). */
export async function computeCoverage(db: Db, companyId: string, fw: FrameworkId, withDocs: boolean): Promise<CoverageDto> {
  const reqRows = await loadRequirementRows(db, companyId, fw);
  const docsByReq = new Map<string, CoverageDoc[]>();
  const documents: CoverageDto["documents"] = [];
  if (withDocs) {
    const settings = await settingsFor(db, null, companyId);
    const decree = profileOf(settings).defaultFramework;
    const list = await db
      .select({ id: policies.id, code: policies.code, title: policies.title, status: policies.status, system: policies.system, sections: policies.sections })
      .from(policies)
      .where(and(eq(policies.companyId, companyId), inArray(policies.status, ["draft", "active"])));
    const ids = list.map((p) => p.id);
    const [links, versions, scores] = ids.length
      ? await Promise.all([
          db.select().from(policyRequirements).where(inArray(policyRequirements.policyId, ids)),
          db.select({ id: policyVersions.id, policyId: policyVersions.policyId }).from(policyVersions).where(inArray(policyVersions.policyId, ids)).orderBy(desc(policyVersions.createdAt)),
          db
            .select({ entityId: aiSuggestions.entityId, items: aiSuggestions.items, input: aiSuggestions.input, at: aiSuggestions.updatedAt })
            .from(aiSuggestions)
            .where(and(eq(aiSuggestions.useCase, "policy_review"), inArray(aiSuggestions.entityId, ids), inArray(aiSuggestions.status, [...DONE_STATUSES])))
            .orderBy(desc(aiSuggestions.createdAt)),
        ])
      : [[], [], []];
    const latestVersion = new Map<string, string>();
    for (const v of versions) if (!latestVersion.has(v.policyId)) latestVersion.set(v.policyId, v.id);
    const latestScore = new Map<string, (typeof scores)[number]>();
    for (const s of scores) if (!latestScore.has(s.entityId)) latestScore.set(s.entityId, s);
    const reqIds = new Set(reqRows.map((r) => r.id));
    for (const p of list) {
      const via = new Map<string, "section" | "link">();
      if (fw === decree && p.system === "isms") for (const r of reqRows) if (p.sections.includes(r.section)) via.set(r.id, "section");
      for (const l of links) if (l.policyId === p.id && reqIds.has(l.requirementId)) via.set(l.requirementId, "link");
      if (!via.size) continue;
      const sc = latestScore.get(p.id);
      const items = ((sc?.items ?? []) as GapItem[]).filter((i) => reqIds.has(i.requirementId));
      const verdict = new Map(items.map((i) => [i.requirementId, i]));
      const stale = !!sc && (sc.input as { versionId?: string }).versionId !== latestVersion.get(p.id);
      const status = p.status as "draft" | "active";
      for (const [rid, how] of via) {
        const v = verdict.get(rid);
        const d: CoverageDoc = { id: p.id, code: p.code, title: p.title, status, via: how, ai: v?.status ?? null, aiStale: !!v && stale, aiReason: v?.reason ?? null, aiAt: v ? sc!.at.toISOString() : null };
        docsByReq.set(rid, [...(docsByReq.get(rid) ?? []), d]);
      }
      documents.push({ id: p.id, code: p.code, title: p.title, status, requirements: via.size, scored: !!sc, stale, score: gapScore(items) });
    }
  }
  const rows: CoverageRow[] = reqRows.map((r) => {
    const docs = (docsByReq.get(r.id) ?? []).sort((a, b) => (a.code ?? a.title).localeCompare(b.code ?? b.title, "cs", { numeric: true }));
    const row: CoverageRow = {
      id: r.id,
      section: r.section,
      sectionTitle: r.sectionTitle,
      ref: r.ref,
      text: r.text,
      applicable: r.applicable,
      compliance: r.compliance,
      controls: r.controls,
      docs,
      docState: bestDocState(docs),
      gaps: [],
    };
    row.gaps = coverageGaps(row).filter((g) => withDocs || !g.startsWith("ai_") && g !== "no_document");
    return row;
  });
  documents.sort((a, b) => (a.code ?? a.title).localeCompare(b.code ?? b.title, "cs", { numeric: true }));
  return { framework: fw, rows, summary: summarizeCoverage(rows), documents };
}

/** Stav hromadného hodnocení podle společnosti (v paměti procesu – po restartu se běh nedokončí, výsledky hotových dokumentů zůstávají). */
const batches = new Map<string, CoverageBatchStatus>();
const idle = (): CoverageBatchStatus => ({ running: false, framework: null, total: 0, done: 0, failed: 0, current: null, errors: [], startedAt: null, finishedAt: null });

export function coverageRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike; onBackground?: (p: Promise<unknown>) => void }) {
  const { db, config } = deps;
  const docsAllowed = async (c: Ctx, companyId: string) => hasPermIn(c, "policies:read", companyId) && ((await getSettings(db)).enabledModules as string[]).includes("policies");

  /** Spustí hodnocení dokumentů jeden po druhém (lokální model zvládne jen omezený souběh). */
  async function runBatch(c: Ctx, companyId: string, fw: FrameworkId, docs: CoverageDto["documents"]) {
    const st = batches.get(companyId)!;
    const s = await getAiSettings(db);
    const user = currentUser(c);
    for (const d of docs) {
      st.current = d.code ? `${d.code} ${d.title}` : d.title;
      try {
        const [busy] = await db
          .select({ id: aiSuggestions.id })
          .from(aiSuggestions)
          .where(and(eq(aiSuggestions.entityId, d.id), eq(aiSuggestions.status, "running")));
        if (busy) throw new Error("Hodnocení dokumentu už běží.");
        const prep = await prepareRequest(db, "policy_review", d.id, { instructions: s.instructions });
        if (!prep) throw new Error("Dokument nenalezen.");
        const [row] = await db
          .insert(aiSuggestions)
          .values({ companyId: prep.companyId, useCase: "policy_review", entityType: prep.entityType, entityId: d.id, status: "running", provider: s.provider, model: s.model, input: prep.input, createdById: user.id })
          .returning();
        await audit(db, { c, user, action: "ai.requested", entityType: prep.entityType, entityId: d.id, details: { useCase: "policy_review", model: s.model, suggestionId: row!.id, batch: fw } });
        await runSuggestion(db, config, row!.id, prep, deps.fetchImpl);
        const [res] = await db.select({ status: aiSuggestions.status, error: aiSuggestions.error }).from(aiSuggestions).where(eq(aiSuggestions.id, row!.id));
        if (res?.status === "failed") throw new Error(res.error ?? "Model nevrátil výsledek.");
      } catch (e) {
        st.failed++;
        st.errors.push({ document: st.current, error: (e as Error).message.slice(0, 300) });
      }
      st.done++;
    }
    st.running = false;
    st.current = null;
    st.finishedAt = new Date().toISOString();
  }

  const snapshotDto = (r: typeof coverageSnapshots.$inferSelect, name: string | null): CoverageSnapshotDto => ({
    id: r.id,
    framework: r.framework as FrameworkId,
    note: r.note,
    summary: r.summary as CoverageSummary,
    createdAt: r.createdAt.toISOString(),
    createdByName: name,
  });

  async function snapshotFor(c: Ctx, id: string, companyId: string): Promise<CoverageSnapshotDetail> {
    const [r] = await db
      .select({ s: coverageSnapshots, name: users.displayName })
      .from(coverageSnapshots)
      .leftJoin(users, eq(users.id, coverageSnapshots.createdById))
      .where(and(eq(coverageSnapshots.id, id), eq(coverageSnapshots.companyId, companyId)));
    if (!r) throw new ApiError(404, "err.cov.snapshotNotFound");
    return { ...snapshotDto(r.s, r.name), rows: r.s.rows as CoverageRow[] };
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "controls"))
      .get("/", requirePerm("controls:read"), zValidator("query", FrameworkQuery), async (c) => {
        const companyId = soleCompany(c);
        const { framework } = c.req.valid("query");
        return c.json({ ...(await computeCoverage(db, companyId, framework, await docsAllowed(c, companyId))), batch: batches.get(companyId) ?? idle() });
      })

      /* ---------- hromadné AI skóre dokumentů ---------- */
      .get("/score", requirePerm("controls:read"), (c) => c.json(batches.get(soleCompany(c)) ?? idle()))
      .post("/score", requirePerm("ai:use"), zValidator("json", CoverageScoreInput), async (c) => {
        const companyId = soleCompany(c);
        const { framework, onlyStale } = c.req.valid("json");
        if (!(await docsAllowed(c, companyId))) throw new ApiError(403, "err.forbidden");
        if (!(await getAiSettings(db)).enabled) throw new ApiError(409, "err.cov.aiOff");
        if (batches.get(companyId)?.running) throw new ApiError(409, "err.cov.batchRunning");
        const cov = await computeCoverage(db, companyId, framework, true);
        const targets = cov.documents.filter((d) => !onlyStale || !d.scored || d.stale);
        if (!targets.length) throw new ApiError(409, "err.cov.nothingToScore");
        const st: CoverageBatchStatus = { ...idle(), running: true, framework, total: targets.length, startedAt: new Date().toISOString() };
        batches.set(companyId, st);
        await audit(db, { c, user: currentUser(c), action: "coverage.ai_scored", details: { framework, documents: targets.length, onlyStale } });
        const job = runBatch(c, companyId, framework, targets).catch((e) => {
          st.running = false;
          st.errors.push({ document: "", error: (e as Error).message });
        });
        deps.onBackground?.(job);
        return c.json(st, 202);
      })

      /* ---------- snímky pro audit ---------- */
      .get("/snapshots", requirePerm("controls:read"), zValidator("query", FrameworkQuery), async (c) => {
        const companyId = soleCompany(c);
        const rows = await db
          .select({ s: { id: coverageSnapshots.id, framework: coverageSnapshots.framework, note: coverageSnapshots.note, summary: coverageSnapshots.summary, createdAt: coverageSnapshots.createdAt }, name: users.displayName })
          .from(coverageSnapshots)
          .leftJoin(users, eq(users.id, coverageSnapshots.createdById))
          .where(and(eq(coverageSnapshots.companyId, companyId), eq(coverageSnapshots.framework, c.req.valid("query").framework)))
          .orderBy(desc(coverageSnapshots.createdAt))
          .limit(100);
        return c.json(rows.map((r) => snapshotDto({ ...r.s, companyId, rows: [], createdById: null } as typeof coverageSnapshots.$inferSelect, r.name)));
      })
      .post("/snapshots", requirePerm("controls:write"), zValidator("json", CoverageSnapshotInput), async (c) => {
        const companyId = soleCompany(c);
        const { framework, note } = c.req.valid("json");
        const cov = await computeCoverage(db, companyId, framework, await docsAllowed(c, companyId));
        const [row] = await db
          .insert(coverageSnapshots)
          .values({ companyId, framework, note: note ?? null, summary: cov.summary, rows: cov.rows, createdById: currentUser(c).id })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "coverage.snapshot_created", entityType: "coverage_snapshot", entityId: row!.id, details: { framework, ...cov.summary } });
        return c.json(snapshotDto(row!, currentUser(c).displayName), 201);
      })
      .get("/snapshots/:id", requirePerm("controls:read"), async (c) => c.json(await snapshotFor(c, c.req.param("id"), soleCompany(c))))

      /* ---------- export CSV (aktuální stav nebo snímek) ---------- */
      .get("/export", requirePerm("controls:read"), zValidator("query", FrameworkQuery.extend({ snapshot: z.string().uuid().optional() })), async (c) => {
        const companyId = soleCompany(c);
        const { framework, snapshot } = c.req.valid("query");
        const rows = snapshot ? (await snapshotFor(c, snapshot, companyId)).rows : (await computeCoverage(db, companyId, framework, await docsAllowed(c, companyId))).rows;
        const t = await tFor(db, c);
        const esc = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
        const line = (cells: string[]) => cells.map((x) => `"${esc(x)}"`).join(";");
        const head = ["ref", "requirement", "applicable", "documents", "ai", "controls", "compliance", "gaps"].map((k) => t.dyn(`cov.csv.${k}`, k));
        const body = rows.map((r) =>
          line([
            r.ref,
            r.text,
            r.applicable ? t("common.yes") : t("common.no"),
            r.docs.map((d) => `${d.code ?? d.title}${d.ai ? ` (${t.dyn(`enum.coverage.docState.${d.ai}`, COVERAGE_LABELS.docState[d.ai])}${d.aiStale ? "*" : ""})` : ""}`).join(", "),
            t.dyn(`enum.coverage.docState.${r.docState}`, COVERAGE_LABELS.docState[r.docState]),
            r.controls.map((x) => x.code ?? x.name).join(", "),
            t.dyn(`enum.compliance.${r.compliance}`, r.compliance),
            r.gaps.map((g) => t.dyn(`enum.coverage.gap.${g}`, COVERAGE_LABELS.gap[g])).join(", "),
          ]),
        );
        await audit(db, { c, user: currentUser(c), action: "report.exported", details: { report: "coverage", framework, snapshot: snapshot ?? null } });
        return c.body(`﻿${[line(head), ...body].join("\r\n")}\r\n`, 200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="pokryti-${framework}${snapshot ? "-snimek" : ""}.csv"`,
        });
      })
  );
}
