import {
  celexOf,
  codeOfCelex,
  codeOfStaleUrl,
  EU_SUGGESTED,
  euStaleUrl,
  LEGAL_SUGGESTED,
  LegalManualActInput,
  LegalManualVersionInput,
  LegalReviewPatch,
  LegalTaskInput,
  LegalTaskPatch,
  LegalWatchInput,
  LegalWatchPatch,
  LEGAL_REVIEW_STATUSES,
  requirementById,
  staleUrlOf,
  type LegalActDetail,
  type LegalActDto,
  type LegalReviewDetail,
  type LegalReviewDto,
  type LegalTaskDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "../../lib/apiError";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, scopeOf, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { controls, legalActs, legalChanges, legalReviews, legalTasks, legalVersions, legalWatch, policies, positionHolders, positions, users } from "../../db/schema";
import { officeText } from "../policies/convert";
import { esbirkaConfigured, type FetchLike } from "./esbirka";
import { eurlexEnabled, LEGAL_SOURCE_LABEL, legalSourceKind } from "./source";
import { addManualVersion, affectedOf, changeDiff, effectiveLegalConfig, fragmentsOf, syncAct, versionSource } from "./service";

/* ============================================================
 * Legislativa – /api/legislation (ADR-035). Čtení legislation:read, správa a posouzení legislation:write
 * (posouzení a úkoly smí měnit i držitel odpovědného funkčního místa).
 * ============================================================ */

type Ctx = Context<AppEnv>;
type MetaOf = { rss?: { repeal?: LegalActDto["repeal"] }; endOfValidity?: string | null; inForce?: boolean | null } | null;
/** Zrušení: RSS e-Sbírky (nastavené datum zrušení), u předpisů EU konec platnosti z CELLAR. */
const repealOf = (a: { source: string; meta: unknown }): LegalActDto["repeal"] => {
  const m = a.meta as MetaOf;
  if (a.source === "eurlex") return m?.endOfValidity ? { date: m.endOfValidity, title: "EUR-Lex: konec platnosti" } : m?.inForce === false ? { date: null, title: "EUR-Lex: není v platnosti" } : null;
  return m?.rss?.repeal ?? null;
};
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const assessor = alias(users, "legal_assessor");
const DIFF_MAX = 400;

export function legislationRoutes(db: Db, config: Config, deps: { fetchImpl?: FetchLike } = {}) {
  async function holds(c: Ctx, positionId: string | null) {
    if (!positionId) return false;
    const [h] = await db.select({ n: count() }).from(positionHolders).where(and(eq(positionHolders.positionId, positionId), eq(positionHolders.userId, currentUser(c).id)));
    return h!.n > 0;
  }

  /** Předpis viditelný pro uživatele: veřejný sledovaný v jeho rozsahu, nebo soukromý jeho společnosti. */
  async function actFor(c: Ctx, id: string) {
    const [a] = await db.select().from(legalActs).where(eq(legalActs.id, id));
    if (!a) throw new ApiError(404, "err.leg.actNotFound");
    if (a.companyId) assertScope(c, a.companyId, "Předpis nenalezen");
    return a;
  }

  async function actDtos(c: Ctx, where?: ReturnType<typeof eq>): Promise<LegalActDto[]> {
    const ids = scopeOf(c).ids;
    const active = scopeOf(c).active;
    const watches = await db
      .select({ w: legalWatch, posName: positions.name })
      .from(legalWatch)
      .leftJoin(positions, eq(positions.id, legalWatch.ownerPositionId))
      .where(inScope(c, legalWatch.companyId));
    const actIds = [...new Set(watches.map((w) => w.w.actId))];
    const acts = await db
      .select({ a: legalActs, v: legalVersions })
      .from(legalActs)
      .leftJoin(legalVersions, eq(legalVersions.id, legalActs.currentVersionId))
      .where(and(or(actIds.length ? inArray(legalActs.id, actIds) : sql`false`, ids.length ? inArray(legalActs.companyId, ids) : sql`false`), where));
    const open = acts.length
      ? await db
          .select({ actId: legalChanges.actId, n: count() })
          .from(legalReviews)
          .innerJoin(legalChanges, eq(legalChanges.id, legalReviews.changeId))
          .where(and(inScope(c, legalReviews.companyId), inArray(legalReviews.status, ["new", "in_review"]), inArray(legalChanges.actId, acts.map((x) => x.a.id))))
          .groupBy(legalChanges.actId)
      : [];
    return acts
      .map(({ a, v }) => {
        const w = watches.find((x) => x.w.actId === a.id && (!active || x.w.companyId === active)) ?? watches.find((x) => x.w.actId === a.id);
        return {
          id: a.id,
          source: a.source,
          companyId: a.companyId,
          code: a.code,
          title: a.title,
          staleUrl: a.staleUrl,
          frameworkId: a.frameworkId,
          currentVersion: v ? { id: v.id, label: v.versionKey, effectiveFrom: v.effectiveFrom, fetchedAt: v.fetchedAt.toISOString(), textSource: a.source === "esbirka" || a.source === "eurlex" ? versionSource(a, v.meta) : null } : null,
          lastCheckedAt: iso(a.lastCheckedAt),
          lastStatus: (a.lastStatus as "ok" | "error" | null) ?? null,
          lastError: a.lastError,
          repeal: repealOf(a),
          watch: w ? { companyId: w.w.companyId, ownerPositionId: w.w.ownerPositionId, ownerPositionName: w.posName, notes: w.w.notes } : null,
          openReviews: Number(open.find((o) => o.actId === a.id)?.n ?? 0),
        };
      })
      .sort((x, y) => x.code.localeCompare(y.code, "cs", { numeric: true }));
  }

  async function reviewDtos(c: Ctx, where: ReturnType<typeof and>): Promise<(LegalReviewDto & { _act: typeof legalActs.$inferSelect; _change: typeof legalChanges.$inferSelect })[]> {
    const fromV = alias(legalVersions, "legal_from");
    const toV = alias(legalVersions, "legal_to");
    const rows = await db
      .select({ r: legalReviews, ch: legalChanges, a: legalActs, f: fromV, t: toV, posName: positions.name, by: assessor.displayName })
      .from(legalReviews)
      .innerJoin(legalChanges, eq(legalChanges.id, legalReviews.changeId))
      .innerJoin(legalActs, eq(legalActs.id, legalChanges.actId))
      .innerJoin(toV, eq(toV.id, legalChanges.toVersionId))
      .leftJoin(fromV, eq(fromV.id, legalChanges.fromVersionId))
      .leftJoin(positions, eq(positions.id, legalReviews.ownerPositionId))
      .leftJoin(assessor, eq(assessor.id, legalReviews.assessedById))
      .where(and(inScope(c, legalReviews.companyId), where))
      .orderBy(desc(legalChanges.detectedAt));
    return rows.map(({ r, ch, a, f, t, posName, by }) => ({
      id: r.id,
      companyId: r.companyId,
      status: r.status,
      impact: r.impact,
      assessment: r.assessment,
      aiSummary: r.aiSummary,
      ownerPositionId: r.ownerPositionId,
      ownerPositionName: posName,
      dueDate: r.dueDate,
      assessedByName: by,
      assessedAt: iso(r.assessedAt),
      createdAt: r.createdAt.toISOString(),
      act: { id: a.id, code: a.code, title: a.title },
      change: { id: ch.id, detectedAt: ch.detectedAt.toISOString(), from: f?.versionKey ?? null, to: t.versionKey, effectiveFrom: t.effectiveFrom, added: ch.added, removed: ch.removed, modified: ch.modified },
      _act: a,
      _change: ch,
    }));
  }

  async function taskDtos(c: Ctx, where?: ReturnType<typeof and>): Promise<LegalTaskDto[]> {
    const rows = await db
      .select({ t: legalTasks, posName: positions.name, p: { id: policies.id, code: policies.code, title: policies.title }, ctl: { id: controls.id, code: controls.code, name: controls.name }, a: { id: legalActs.id, code: legalActs.code } })
      .from(legalTasks)
      .leftJoin(positions, eq(positions.id, legalTasks.ownerPositionId))
      .leftJoin(policies, eq(policies.id, legalTasks.policyId))
      .leftJoin(controls, eq(controls.id, legalTasks.controlId))
      .leftJoin(legalReviews, eq(legalReviews.id, legalTasks.reviewId))
      .leftJoin(legalChanges, eq(legalChanges.id, legalReviews.changeId))
      .leftJoin(legalActs, eq(legalActs.id, legalChanges.actId))
      .where(and(inScope(c, legalTasks.companyId), where))
      .orderBy(asc(legalTasks.status), asc(legalTasks.dueDate), desc(legalTasks.createdAt));
    return rows.map(({ t, posName, p, ctl, a }) => ({
      id: t.id,
      reviewId: t.reviewId,
      companyId: t.companyId,
      title: t.title,
      description: t.description,
      ownerPositionId: t.ownerPositionId,
      ownerPositionName: posName,
      dueDate: t.dueDate,
      status: t.status,
      policy: p?.id ? p : null,
      control: ctl?.id ? ctl : null,
      requirementId: t.requirementId,
      createdAt: t.createdAt.toISOString(),
      doneAt: iso(t.doneAt),
      act: a?.id ? a : null,
    }));
  }

  async function reviewRow(c: Ctx, id: string) {
    const [r] = await reviewDtos(c, eq(legalReviews.id, id));
    if (!r) throw new ApiError(404, "err.leg.reviewNotFound");
    return r;
  }
  const canEditReview = async (c: Ctx, r: { companyId: string; ownerPositionId: string | null }) => hasPermIn(c, "legislation:write", r.companyId) || (await holds(c, r.ownerPositionId));

  async function checkTaskLinks(companyId: string, t: { policyId?: string | null; controlId?: string | null; requirementId?: string | null }) {
    if (t.policyId) {
      const [p] = await db.select({ companyId: policies.companyId }).from(policies).where(eq(policies.id, t.policyId));
      if (p?.companyId !== companyId) throw new ApiError(400, "err.leg.docCompany");
    }
    if (t.controlId) {
      const [x] = await db.select({ companyId: controls.companyId }).from(controls).where(eq(controls.id, t.controlId));
      if (x?.companyId !== companyId) throw new ApiError(400, "err.leg.controlCompany");
    }
    if (t.requirementId && !requirementById(t.requirementId)) throw new ApiError(400, "err.leg.unknownReq");
  }

  const ReviewQuery = z.object({ status: z.enum([...LEGAL_REVIEW_STATUSES, "open"]).optional() });

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "legislation"))
      .get("/status", requirePerm("legislation:read"), async (c) => {
        const eff = await effectiveLegalConfig(db, config);
        return c.json({ apiConfigured: esbirkaConfigured(config), source: legalSourceKind(eff), sourceLabel: LEGAL_SOURCE_LABEL[legalSourceKind(eff)], eurlex: eurlexEnabled(eff), mode: (await getSettings(db)).legalTextSource, webFallback: (eff.ESBIRKA_WEB_FALLBACK ?? "on") !== "off" });
      })
      .get("/suggested", requirePerm("legislation:read"), async (c) => {
        const watched = new Set((await actDtos(c)).filter((a) => a.watch).map((a) => a.staleUrl));
        return c.json([
          ...LEGAL_SUGGESTED.map((s) => ({ ...s, source: "esbirka" as const, reference: s.code, watched: watched.has(s.staleUrl) })),
          ...EU_SUGGESTED.map((s) => ({ code: s.code, title: s.title, source: "eurlex" as const, reference: s.celex, staleUrl: euStaleUrl(s.celex), watched: watched.has(euStaleUrl(s.celex)) || watched.has(euStaleUrl(s.celex, "en")) })),
        ]);
      })

      /* ---------- sledované předpisy ---------- */
      .get("/acts", requirePerm("legislation:read"), async (c) => c.json(await actDtos(c)))
      .post("/watch", requirePerm("legislation:write"), zValidator("json", LegalWatchInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, undefined, "legislation:write");
        // předpis EU: výslovně zvolený zdroj nebo odkaz, který není číslem ze Sbírky (CELEX, EUR-Lex, ELI EU)
        const eu = input.source === "eurlex" || (!input.source && !staleUrlOf(input.reference) && !!celexOf(input.reference));
        let staleUrl: string | null;
        let fresh: { source: "esbirka" | "eurlex"; code: string; title: string };
        if (eu) {
          if (!eurlexEnabled(config)) throw new ApiError(409, "err.leg.eurlexOff");
          const celex = celexOf(input.reference);
          if (!celex) throw new ApiError(400, "err.leg.badCelex");
          const lang = input.lang ?? "cs";
          staleUrl = euStaleUrl(celex, lang);
          const sug = EU_SUGGESTED.find((x) => x.celex === celex);
          fresh = { source: "eurlex", code: `${sug?.code ?? codeOfCelex(celex)}${lang === "cs" ? "" : ` [${lang.toUpperCase()}]`}`, title: (lang === "cs" ? sug?.title : null) ?? sug?.code ?? codeOfCelex(celex) };
        } else {
          staleUrl = staleUrlOf(input.reference);
          if (!staleUrl) throw new ApiError(400, "err.leg.badReference");
          const sug = LEGAL_SUGGESTED.find((x) => x.staleUrl === staleUrl);
          fresh = { source: "esbirka", code: codeOfStaleUrl(staleUrl), title: sug?.title ?? codeOfStaleUrl(staleUrl) };
        }
        let [act] = await db.select().from(legalActs).where(eq(legalActs.staleUrl, staleUrl));
        if (!act) [act] = await db.insert(legalActs).values({ ...fresh, staleUrl }).returning();
        await db
          .insert(legalWatch)
          .values({ companyId, actId: act!.id, ownerPositionId: input.ownerPositionId ?? null, notes: input.notes ?? null })
          .onConflictDoUpdate({ target: [legalWatch.companyId, legalWatch.actId], set: { ownerPositionId: input.ownerPositionId ?? null, notes: input.notes ?? null, updatedAt: new Date() } });
        await audit(db, { c, user: currentUser(c), action: "legislation.watched", entityType: "legal_act", entityId: act!.id, details: { code: act!.code, companyId } });
        // první stažení znění hned (bez klíče zůstane předpis „čeká na připojení“)
        let syncError: string | null = null;
        const canSync = act!.source === "eurlex" ? eurlexEnabled(config) : legalSourceKind(await effectiveLegalConfig(db, config)) !== "off";
        if (canSync && !act!.currentVersionId) await syncAct(db, config, act!.id, { fetchImpl: deps.fetchImpl }).catch((e) => (syncError = (e as Error).message));
        const [dto] = await actDtos(c, eq(legalActs.id, act!.id));
        return c.json({ ...dto!, syncError }, 201);
      })
      .patch("/watch/:actId", requirePerm("legislation:write"), zValidator("json", LegalWatchPatch), async (c) => {
        const companyId = targetCompany(c, undefined, "legislation:write");
        const input = c.req.valid("json");
        const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        const r = await db.update(legalWatch).set({ ...set, updatedAt: new Date() }).where(and(eq(legalWatch.companyId, companyId), eq(legalWatch.actId, c.req.param("actId")))).returning();
        if (!r.length) throw new ApiError(404, "err.leg.notWatched");
        await audit(db, { c, user: currentUser(c), action: "legislation.watch_updated", entityType: "legal_act", entityId: c.req.param("actId"), details: set });
        return c.json((await actDtos(c, eq(legalActs.id, c.req.param("actId"))))[0]);
      })
      .delete("/watch/:actId", requirePerm("legislation:write"), async (c) => {
        const companyId = targetCompany(c, undefined, "legislation:write");
        await db.delete(legalWatch).where(and(eq(legalWatch.companyId, companyId), eq(legalWatch.actId, c.req.param("actId"))));
        await audit(db, { c, user: currentUser(c), action: "legislation.unwatched", entityType: "legal_act", entityId: c.req.param("actId"), details: { companyId } });
        return c.body(null, 204);
      })

      /* ---------- ručně vedené předpisy a normy (soukromé pro společnost) ---------- */
      .post("/acts/manual", requirePerm("legislation:write"), zValidator("json", LegalManualActInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, undefined, "legislation:write");
        const [act] = await db.insert(legalActs).values({ source: "manual", companyId, code: input.code, title: input.title, frameworkId: input.frameworkId ?? null }).returning();
        await db.insert(legalWatch).values({ companyId, actId: act!.id, ownerPositionId: input.ownerPositionId ?? null });
        await audit(db, { c, user: currentUser(c), action: "legislation.manual_created", entityType: "legal_act", entityId: act!.id, details: { code: act!.code } });
        return c.json((await actDtos(c, eq(legalActs.id, act!.id)))[0], 201);
      })
      .post("/acts/:id/versions", requirePerm("legislation:write"), async (c) => {
        const act = await actFor(c, c.req.param("id"));
        if (act.source !== "manual" || !act.companyId) throw new ApiError(409, "err.leg.manualOnly");
        if (!hasPermIn(c, "legislation:write", act.companyId)) throw new ApiError(403, "err.forbidden");
        let input: z.infer<typeof LegalManualVersionInput>;
        if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
          const body = await c.req.parseBody();
          const f = body.file;
          if (!(f instanceof File) || !f.size) throw new ApiError(400, "err.leg.chooseFile");
          if (f.size > 20 * 1024 * 1024) throw new ApiError(413, "err.fileTooLarge20");
          const buf = new Uint8Array(await f.arrayBuffer());
          const text = /\.(txt|md)$/i.test(f.name) ? new TextDecoder().decode(buf) : officeText(buf, f.name);
          if (!text?.trim()) throw new ApiError(400, "err.leg.noText");
          const p = LegalManualVersionInput.safeParse({ label: body.label, effectiveFrom: body.effectiveFrom || null, text });
          if (!p.success) throw new ApiError(400, "err.leg.versionLabel");
          input = p.data;
        } else {
          const p = LegalManualVersionInput.safeParse(await c.req.json().catch(() => null));
          if (!p.success) throw new ApiError(400, "err.leg.badVersion");
          input = p.data;
        }
        const r = await addManualVersion(db, act, { label: input.label, effectiveFrom: input.effectiveFrom ?? null, text: input.text });
        await audit(db, { c, user: currentUser(c), action: "legislation.version_added", entityType: "legal_act", entityId: act.id, details: { label: input.label, changed: !!r.changeId } });
        return c.json({ ...r }, 201);
      })
      .delete("/acts/:id", requirePerm("legislation:write"), async (c) => {
        const act = await actFor(c, c.req.param("id"));
        if (act.source !== "manual" || !act.companyId) throw new ApiError(409, "err.leg.cannotDelete");
        if (!hasPermIn(c, "legislation:write", act.companyId)) throw new ApiError(403, "err.forbidden");
        await db.delete(legalActs).where(eq(legalActs.id, act.id));
        await audit(db, { c, user: currentUser(c), action: "legislation.manual_deleted", entityType: "legal_act", entityId: act.id, details: { code: act.code } });
        return c.body(null, 204);
      })
      .post("/acts/:id/sync", requirePerm("legislation:write"), async (c) => {
        const act = await actFor(c, c.req.param("id"));
        if (act.source === "manual") throw new ApiError(409, "err.leg.manualNoSync");
        try {
          const r = await syncAct(db, config, act.id, { force: true, fetchImpl: deps.fetchImpl });
          await audit(db, { c, user: currentUser(c), action: "legislation.synced", entityType: "legal_act", entityId: act.id, details: r });
          return c.json(r);
        } catch (e) {
          throw new HTTPException(502, { message: (e as Error).message });
        }
      })
      .get("/acts/:id", requirePerm("legislation:read"), async (c) => {
        const act = await actFor(c, c.req.param("id"));
        const [dto] = await actDtos(c, eq(legalActs.id, act.id));
        if (!dto) throw new ApiError(404, "err.leg.actNotFound");
        const [versions, changes] = await Promise.all([
          db.select().from(legalVersions).where(eq(legalVersions.actId, act.id)).orderBy(desc(legalVersions.fetchedAt)),
          db.select().from(legalChanges).where(eq(legalChanges.actId, act.id)).orderBy(desc(legalChanges.detectedAt)),
        ]);
        const reviews = changes.length ? await db.select({ id: legalReviews.id, changeId: legalReviews.changeId, companyId: legalReviews.companyId }).from(legalReviews).where(and(inArray(legalReviews.changeId, changes.map((x) => x.id)), inScope(c, legalReviews.companyId))) : [];
        const active = scopeOf(c).active;
        const vk = new Map(versions.map((v) => [v.id, v.versionKey]));
        const out: LegalActDetail = {
          ...dto,
          versions: versions.map((v) => ({ id: v.id, label: v.versionKey, effectiveFrom: v.effectiveFrom, sourceUrl: v.sourceUrl, fetchedAt: v.fetchedAt.toISOString(), fragments: v.fragmentCount, contentHash: v.contentHash })),
          changes: changes.map((ch) => ({
            id: ch.id,
            detectedAt: ch.detectedAt.toISOString(),
            from: ch.fromVersionId ? (vk.get(ch.fromVersionId) ?? null) : null,
            to: vk.get(ch.toVersionId) ?? "",
            added: ch.added,
            removed: ch.removed,
            modified: ch.modified,
            reviewId: (reviews.find((r) => r.changeId === ch.id && r.companyId === active) ?? reviews.find((r) => r.changeId === ch.id))?.id ?? null,
          })),
        };
        return c.json(out);
      })
      .get("/versions/:id/fragments", requirePerm("legislation:read"), async (c) => {
        const [v] = await db.select().from(legalVersions).where(eq(legalVersions.id, c.req.param("id")));
        if (!v) throw new ApiError(404, "err.leg.versionNotFound");
        await actFor(c, v.actId);
        return c.json(await fragmentsOf(db, v.id));
      })

      /* ---------- posouzení změn ---------- */
      .get("/reviews", requirePerm("legislation:read"), zValidator("query", ReviewQuery), async (c) => {
        const { status } = c.req.valid("query");
        const where = status === "open" ? inArray(legalReviews.status, ["new", "in_review"]) : status ? eq(legalReviews.status, status) : undefined;
        return c.json((await reviewDtos(c, and(where))).map(({ _act, _change, ...r }) => r));
      })
      .get("/reviews/:id", requirePerm("legislation:read"), async (c) => {
        const { _act, _change, ...r } = await reviewRow(c, c.req.param("id"));
        const diff = await changeDiff(db, _change, _act);
        const [affected, tasks] = await Promise.all([affectedOf(db, r.companyId, _act, diff), taskDtos(c, eq(legalTasks.reviewId, r.id))]);
        const out: LegalReviewDetail = { ...r, diff: diff.slice(0, DIFF_MAX), diffTotal: diff.length, affected, tasks, canEdit: await canEditReview(c, r) };
        return c.json(out);
      })
      .patch("/reviews/:id", requirePerm("legislation:read"), zValidator("json", LegalReviewPatch), async (c) => {
        const r = await reviewRow(c, c.req.param("id"));
        if (!(await canEditReview(c, r))) throw new ApiError(403, "err.leg.reviewEditor");
        const input = c.req.valid("json");
        if (r.status === "closed" && input.status !== "in_review") throw new ApiError(409, "err.leg.reviewClosed");
        const set: Partial<typeof legalReviews.$inferInsert> = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        if (input.ownerPositionId !== undefined && !hasPermIn(c, "legislation:write", r.companyId)) delete set.ownerPositionId;
        if (input.status === "assessed" || input.status === "closed") {
          const impact = input.impact ?? r.impact;
          const assessment = input.assessment ?? r.assessment;
          if (!impact || !assessment?.trim()) throw new ApiError(400, "err.leg.reviewNeedsImpact");
          if (input.status === "assessed" || !r.assessedAt) {
            set.assessedById = currentUser(c).id;
            set.assessedAt = new Date();
          }
        }
        if (input.status === "closed") {
          const [open] = await db.select({ n: count() }).from(legalTasks).where(and(eq(legalTasks.reviewId, r.id), eq(legalTasks.status, "open")));
          if (open!.n > 0) throw new ApiError(409, "err.leg.openTasks", { n: open!.n });
        }
        await db.update(legalReviews).set({ ...set, updatedAt: new Date() }).where(eq(legalReviews.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "legislation.review_updated", entityType: "legal_review", entityId: r.id, details: { ...input, act: r.act.code } });
        return c.json({ ok: true });
      })

      /* ---------- úkoly ---------- */
      .get("/tasks", requirePerm("legislation:read"), async (c) => c.json(await taskDtos(c, c.req.query("all") ? undefined : and(eq(legalTasks.status, "open")))))
      .post("/reviews/:id/tasks", requirePerm("legislation:read"), zValidator("json", LegalTaskInput), async (c) => {
        const r = await reviewRow(c, c.req.param("id"));
        if (!(await canEditReview(c, r))) throw new ApiError(403, "err.leg.taskCreator");
        const input = c.req.valid("json");
        await checkTaskLinks(r.companyId, input);
        const [t] = await db.insert(legalTasks).values({ ...input, companyId: r.companyId, reviewId: r.id, createdById: currentUser(c).id, doneAt: input.status === "done" ? new Date() : null }).returning();
        await audit(db, { c, user: currentUser(c), action: "legislation.task_created", entityType: "legal_task", entityId: t!.id, details: { title: t!.title, review: r.id } });
        return c.json((await taskDtos(c, eq(legalTasks.id, t!.id)))[0], 201);
      })
      .patch("/tasks/:id", requirePerm("legislation:read"), zValidator("json", LegalTaskPatch), async (c) => {
        const [t] = await db.select().from(legalTasks).where(eq(legalTasks.id, c.req.param("id")));
        if (!t) throw new ApiError(404, "err.leg.taskNotFound");
        assertScope(c, t.companyId, "Úkol nenalezen");
        if (!hasPermIn(c, "legislation:write", t.companyId) && !(await holds(c, t.ownerPositionId))) throw new ApiError(403, "err.leg.taskEditor");
        const input = c.req.valid("json");
        await checkTaskLinks(t.companyId, input);
        const set: Partial<typeof legalTasks.$inferInsert> = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        if (input.status) set.doneAt = input.status === "done" ? new Date() : null;
        await db.update(legalTasks).set({ ...set, updatedAt: new Date() }).where(eq(legalTasks.id, t.id));
        await audit(db, { c, user: currentUser(c), action: "legislation.task_updated", entityType: "legal_task", entityId: t.id, details: input });
        return c.json((await taskDtos(c, eq(legalTasks.id, t.id)))[0]);
      })
  );
}

