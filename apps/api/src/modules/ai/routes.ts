import { recordAccessFor } from "../search/routes";
import { searchRecords } from "../search/records";
import { actionableItems, AI_USE_CASES, AI_USE_CASE_MODULE, AiDecisionInput, AiQueryInput, type AiToolInfo, type Permission, AiRequestInput, AiSettingsInput, type AiItem, type AiLogRow, type AiStatusDto, type AiSuggestionDto, type AiUseCase } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, scopeOf } from "../../auth/scope";
import { queryDto, runQuery } from "./query";
import { sourceRetriever } from "./retrieve";
import { qaBatch, type QaDocs, type QaSemantic } from "./usecasesTrust";
import { docMeta, retrieveDocChunks } from "../policies/qa";
import { docVisibility } from "../policies/routes";
import { toolsFor, type ToolCtx } from "./tools";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { aiQueries, aiSuggestions, aiSystems, craProducts, assets, auditFindings, audits, controls, incidents, legalReviews, policies, positionHolders, risks, users, vulnScans, supplierReports, customerQuestionnaires } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { aiSettingsDto, applyItems, getAiSettings, listAiModels, prepareRequest, runSuggestion, saveAiSettings, testAi } from "./service";

type Ctx = Context<AppEnv>;
const creator = alias(users, "ai_creator");
const decider = alias(users, "ai_decider");

const USE_CASE_MODULE = AI_USE_CASE_MODULE;
/** Oprávnění ke čtení záznamu (pro vyžádání návrhu) a k jeho úpravě (pro přijetí). */
const READ_PERM: Record<AiUseCase, Permission> = {
  risk_treatment: "risks:read",
  control_mapping: "controls:read",
  asset_classification: "assets:read",
  finding_remediation: "audits:read",
  incident_summary: "incidents:read",
  policy_review: "policies:read",
  legal_change: "legislation:read",
  ai_act_screening: "aiact:read",
  vex_triage: "cra:read",
  incident_triage: "incidents:read",
  vuln_scan_triage: "assets:read",
  supplier_report_extract: "suppliers:read",
  questionnaire_answer: "trust:read",
};

/** AI asistent – nastavení (admin), vyžádání návrhu, rozhodnutí člověka, auditní přehled. */
export function aiRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike; onBackground?: (p: Promise<unknown>) => void }) {
  const { db, config } = deps;

  async function load(where: ReturnType<typeof and>, limit = 50) {
    const rows = await db
      .select({ s: aiSuggestions, createdByName: creator.displayName, decidedByName: decider.displayName })
      .from(aiSuggestions)
      .leftJoin(creator, eq(creator.id, aiSuggestions.createdById))
      .leftJoin(decider, eq(decider.id, aiSuggestions.decidedById))
      .where(where)
      .orderBy(desc(aiSuggestions.createdAt))
      .limit(limit);
    return rows;
  }

  const toDto = (r: Awaited<ReturnType<typeof load>>[number]): AiSuggestionDto => ({
    id: r.s.id,
    companyId: r.s.companyId,
    useCase: r.s.useCase as AiUseCase,
    entityType: r.s.entityType,
    entityId: r.s.entityId,
    status: r.s.status,
    provider: r.s.provider,
    model: r.s.model,
    summary: r.s.summary,
    items: r.s.items as AiItem[],
    acceptedItems: r.s.acceptedItems,
    error: r.s.error,
    durationMs: r.s.durationMs,
    createdByName: r.createdByName,
    createdAt: r.s.createdAt.toISOString(),
    decidedByName: r.decidedByName,
    decidedAt: r.s.decidedAt?.toISOString() ?? null,
    decisionNote: r.s.decisionNote,
  });

  /** Uvízlé běhy (restart serveru během dotazu) označí jako chybné. */
  async function expireStale() {
    const s = await getAiSettings(db);
    await db
      .update(aiSuggestions)
      .set({ status: "failed", error: "Dotaz nebyl dokončen (vypršel čas nebo restart serveru)." })
      .where(and(eq(aiSuggestions.status, "running"), lt(aiSuggestions.createdAt, new Date(Date.now() - (s.timeoutSec + 60) * 1000))));
  }

  /** Kontext nástrojů: rozsah a oprávnění uživatele v okamžiku dotazu. */
  async function toolCtx(c: Ctx): Promise<ToolCtx> {
    const sc = scopeOf(c);
    return { db, companyIds: sc.ids, byCompany: sc.byCompany, enabledModules: (await getSettings(db)).enabledModules };
  }

  async function expireStaleQueries() {
    const s = await getAiSettings(db);
    await db
      .update(aiQueries)
      .set({ status: "error", error: "Dotaz nebyl dokončen (vypršel čas nebo restart serveru)." })
      .where(and(eq(aiQueries.status, "running"), lt(aiQueries.createdAt, new Date(Date.now() - (2 * s.timeoutSec + 60) * 1000))));
  }

  /** Smí uživatel návrh aplikovat? (stejná pravidla jako ruční úprava) */
  async function canApply(c: Ctx, row: typeof aiSuggestions.$inferSelect) {
    const uc = row.useCase as AiUseCase;
    if (uc === "control_mapping") return hasPermIn(c, "controls:write", row.companyId);
    if (uc === "finding_remediation") return hasPermIn(c, "audits:write", row.companyId);
    if (uc === "incident_summary" || uc === "incident_triage") return hasPermIn(c, "incidents:write", row.companyId);
    if (uc === "vuln_scan_triage") return hasPermIn(c, "assets:write", row.companyId);
    if (uc === "supplier_report_extract") return hasPermIn(c, "suppliers:write", row.companyId);
    if (uc === "questionnaire_answer") return hasPermIn(c, "trust:write", row.companyId);
    if (uc === "ai_act_screening" || uc === "vex_triage") {
      const write = uc === "ai_act_screening" ? "aiact:write" : "cra:write";
      if (hasPermIn(c, write, row.companyId)) return true;
      const [o] = uc === "ai_act_screening" ? await db.select({ owner: aiSystems.ownerPositionId }).from(aiSystems).where(eq(aiSystems.id, row.entityId)) : await db.select({ owner: craProducts.ownerPositionId }).from(craProducts).where(eq(craProducts.id, row.entityId));
      if (!o?.owner) return false;
      const [h] = await db.select({ n: count() }).from(positionHolders).where(and(eq(positionHolders.positionId, o.owner), eq(positionHolders.userId, currentUser(c).id)));
      return h!.n > 0;
    }
    if (uc === "policy_review") return hasPermIn(c, "policies:read", row.companyId);
    if (uc === "legal_change") {
      if (hasPermIn(c, "legislation:write", row.companyId)) return true;
      const [rv] = await db.select({ owner: legalReviews.ownerPositionId }).from(legalReviews).where(eq(legalReviews.id, row.entityId));
      if (!rv?.owner) return false;
      const [h] = await db.select({ n: count() }).from(positionHolders).where(and(eq(positionHolders.positionId, rv.owner), eq(positionHolders.userId, currentUser(c).id)));
      return h!.n > 0;
    }
    if (uc === "asset_classification") {
      if (hasPermIn(c, "assets:write", row.companyId)) return true;
      const [a] = await db.select({ owner: assets.ownerUserId }).from(assets).where(eq(assets.id, row.entityId));
      return hasPermIn(c, "assets:write_own", row.companyId) && a?.owner === currentUser(c).id;
    }
    if (hasPermIn(c, "risks:write", row.companyId)) return true;
    const [r] = await db.select({ owner: risks.ownerPositionId }).from(risks).where(eq(risks.id, row.entityId));
    if (!r?.owner) return false;
    const [h] = await db
      .select({ n: count() })
      .from(positionHolders)
      .where(and(eq(positionHolders.positionId, r.owner), eq(positionHolders.userId, currentUser(c).id)));
    return h!.n > 0;
  }

  async function questionnaireDocs(qid: string, companyId: string, c: Ctx): Promise<QaDocs> {
    const visible = docVisibility(db, c);
    const out: QaDocs = new Map();
    for (const b of await qaBatch(db, qid)) {
      try {
        const { picked, mode } = await retrieveDocChunks(db, config, { question: b.question, companyIds: [companyId], visible, topK: 2 }, deps.fetchImpl);
        const hits = picked.filter((h) => h.score >= (mode === "semantic" ? 0.35 : 0.25));
        const meta = await docMeta(db, hits.map((h) => h.policyId));
        out.set(b.id, hits.filter((h) => meta.has(h.policyId)).map((h) => ({ policyId: h.policyId, title: `${meta.get(h.policyId)!.code ? `${meta.get(h.policyId)!.code} ` : ""}${meta.get(h.policyId)!.title}`, heading: h.heading, text: h.text })));
      } catch {
        /* bez dokumentace – návrh vznikne z knihovny a opatření */
      }
    }
    return out;
  }
  /** Kandidáti z knihovny odpovědí a opatření podle významu (v1.07) – jen čitelné záznamy společnosti dotazníku. */
  async function questionnaireSemantic(qid: string, companyId: string, c: Ctx): Promise<QaSemantic> {
    const acc = await recordAccessFor(db, c);
    const only = (ids?: string[]) => (ids ?? []).filter((x) => x === companyId);
    const access = { kinds: { qa_answer: only(acc.kinds.qa_answer), control: only(acc.kinds.control) }, exceptionSub: {} };
    const out: QaSemantic = new Map();
    for (const b of await qaBatch(db, qid)) {
      try {
        const r = await searchRecords(db, config, b.question, access, { kinds: ["qa_answer", "control"], limit: 6 }, deps.fetchImpl);
        if (r.mode !== "semantic") continue;
        const hits = r.hits.filter((h) => h.score >= 0.5);
        out.set(b.id, { library: hits.filter((h) => h.kind === "qa_answer").map((h) => h.refId), controls: hits.filter((h) => h.kind === "control").map((h) => h.refId) });
      } catch {
        /* bez vektorů – zůstane podobnost slov */
      }
    }
    return out;
  }

  async function entityCompany(useCase: AiUseCase, entityId: string): Promise<string | undefined> {
    switch (useCase) {
      case "risk_treatment":
        return (await db.select({ companyId: risks.companyId }).from(risks).where(eq(risks.id, entityId)))[0]?.companyId;
      case "control_mapping":
        return (await db.select({ companyId: controls.companyId }).from(controls).where(eq(controls.id, entityId)))[0]?.companyId;
      case "asset_classification":
        return (await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, entityId)))[0]?.companyId;
      case "finding_remediation":
        return (await db.select({ companyId: audits.companyId }).from(auditFindings).innerJoin(audits, eq(audits.id, auditFindings.auditId)).where(eq(auditFindings.id, entityId)))[0]?.companyId;
      case "ai_act_screening":
        return (await db.select({ companyId: aiSystems.companyId }).from(aiSystems).where(eq(aiSystems.id, entityId)))[0]?.companyId;
      case "vex_triage":
        return (await db.select({ companyId: craProducts.companyId }).from(craProducts).where(eq(craProducts.id, entityId)))[0]?.companyId;
      case "questionnaire_answer":
        return (await db.select({ companyId: customerQuestionnaires.companyId }).from(customerQuestionnaires).where(eq(customerQuestionnaires.id, entityId)))[0]?.companyId;
      case "supplier_report_extract":
        return (await db.select({ companyId: supplierReports.companyId }).from(supplierReports).where(eq(supplierReports.id, entityId)))[0]?.companyId;
      case "vuln_scan_triage":
        return (await db.select({ companyId: vulnScans.companyId }).from(vulnScans).where(eq(vulnScans.id, entityId)))[0]?.companyId;
      case "incident_triage":
      case "incident_summary":
        return (await db.select({ companyId: incidents.companyId }).from(incidents).where(eq(incidents.id, entityId)))[0]?.companyId;
      case "policy_review":
        return (await db.select({ companyId: policies.companyId }).from(policies).where(eq(policies.id, entityId)))[0]?.companyId;
      case "legal_change":
        return (await db.select({ companyId: legalReviews.companyId }).from(legalReviews).where(eq(legalReviews.id, entityId)))[0]?.companyId;
    }
  }

  return (
    new Hono<AppEnv>()
      /* ---------- stav pro uživatele ---------- */
      .get("/status", requirePerm("ai:use"), async (c) => {
        const [s, base] = await Promise.all([getAiSettings(db), getSettings(db)]);
        const dto: AiStatusDto = {
          enabled: s.enabled,
          mcpEnabled: s.mcpEnabled,
          model: s.enabled ? s.model : null,
          useCases: s.enabled ? AI_USE_CASES.filter((u) => base.enabledModules.includes(USE_CASE_MODULE[u] as never)) : [],
          docQa: s.enabled && s.docQaEnabled && base.enabledModules.includes("policies"),
          recordSearch: s.enabled && s.recordSearchEnabled,
        };
        return c.json(dto);
      })

      /* ---------- nastavení ---------- */
      .get("/settings", requirePerm("admin:settings"), async (c) => c.json(aiSettingsDto(await getAiSettings(db))))
      .patch("/settings", requirePerm("admin:settings"), zValidator("json", AiSettingsInput), async (c) => {
        const input = c.req.valid("json");
        try {
          const s = await saveAiSettings(db, config, input);
          const { apiKey, ...logged } = input;
          await audit(db, { c, user: currentUser(c), action: "ai.settings_updated", details: { ...logged, apiKey: apiKey !== undefined ? "***" : undefined } });
          return c.json(aiSettingsDto(s));
        } catch (e) {
          throw new HTTPException(400, { message: (e as Error).message });
        }
      })
      .post("/test", requirePerm("admin:settings"), async (c) => {
        const r = await testAi(db, config, deps.fetchImpl);
        await audit(db, { c, user: currentUser(c), action: "ai.tested", details: r });
        return c.json(r);
      })
      .get("/models", requirePerm("admin:settings"), async (c) => {
        try {
          return c.json({ models: await listAiModels(db, config, deps.fetchImpl) });
        } catch (e) {
          throw new HTTPException(502, { message: (e as Error).message });
        }
      })

      /* ---------- návrhy ---------- */
      .post("/suggestions", requirePerm("ai:use"), zValidator("json", AiRequestInput), async (c) => {
        const input = c.req.valid("json");
        const s = await getAiSettings(db);
        if (!s.enabled) throw new HTTPException(409, { message: "AI asistent je vypnutý (Administrace → AI asistent)." });
        const base = await getSettings(db);
        if (!base.enabledModules.includes(USE_CASE_MODULE[input.useCase] as never)) throw new HTTPException(409, { message: "Modul pro tuto úlohu je vypnutý." });
        const companyId = await entityCompany(input.useCase, input.entityId);
        if (!companyId) throw new HTTPException(404, { message: "Záznam nenalezen" });
        assertScope(c, companyId);
        if (!hasPermIn(c, READ_PERM[input.useCase], companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        await expireStale();
        const [busy] = await db
          .select({ id: aiSuggestions.id })
          .from(aiSuggestions)
          .where(and(eq(aiSuggestions.entityId, input.entityId), eq(aiSuggestions.status, "running")));
        if (busy) throw new HTTPException(409, { message: "Pro tento záznam už návrh běží – počkejte na výsledek." });

        let prep: Awaited<ReturnType<typeof prepareRequest>>;
        try {
          prep = await prepareRequest(db, input.useCase, input.entityId, {
            note: input.note,
            framework: input.framework,
            instructions: s.instructions,
            access: input.useCase === "incident_triage" ? await recordAccessFor(db, c) : undefined,
            // dotazník: úryvky dokumentace, kterou uživatel smí číst (dohledání v kontextu požadavku)
            docs: input.useCase === "questionnaire_answer" && s.docQaEnabled ? await questionnaireDocs(input.entityId, companyId, c) : undefined,
            semantic: input.useCase === "questionnaire_answer" && s.recordSearchEnabled ? await questionnaireSemantic(input.entityId, companyId, c) : undefined,
          });
        } catch (e) {
          throw new HTTPException(400, { message: (e as Error).message });
        }
        if (!prep) throw new HTTPException(404, { message: "Záznam nenalezen" });
        const [row] = await db
          .insert(aiSuggestions)
          .values({
            companyId: prep.companyId,
            useCase: input.useCase,
            entityType: prep.entityType,
            entityId: input.entityId,
            status: "running",
            provider: s.provider,
            model: s.model,
            input: prep.input,
            createdById: currentUser(c).id,
          })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "ai.requested", entityType: prep.entityType, entityId: input.entityId, details: { useCase: input.useCase, model: s.model, suggestionId: row!.id } });
        const job = runSuggestion(db, config, row!.id, prep, deps.fetchImpl);
        deps.onBackground?.(job);
        const [full] = await load(eq(aiSuggestions.id, row!.id), 1);
        return c.json(toDto(full!), 202);
      })
      .get(
        "/suggestions",
        requirePerm("ai:use", "risks:read", "controls:read", "assets:read", "audits:read", "incidents:read", "policies:read", "legislation:read"),
        zValidator("query", z.object({ entityId: z.string().uuid() })),
        async (c) => {
          await expireStale();
          const rows = await load(and(eq(aiSuggestions.entityId, c.req.valid("query").entityId), inScope(c, aiSuggestions.companyId)), 20);
          // jen návrhy k evidencím, které smí uživatel číst
          return c.json(rows.filter((r) => hasPermIn(c, READ_PERM[r.s.useCase as AiUseCase], r.s.companyId)).map(toDto));
        },
      )
      .get("/suggestions/:id", requirePerm("ai:use", "risks:read", "controls:read", "assets:read", "audits:read", "incidents:read", "policies:read", "legislation:read"), async (c) => {
        const [r] = await load(eq(aiSuggestions.id, c.req.param("id")), 1);
        if (!r) throw new HTTPException(404, { message: "Návrh nenalezen" });
        assertScope(c, r.s.companyId, "Návrh nenalezen");
        if (!hasPermIn(c, READ_PERM[r.s.useCase as AiUseCase], r.s.companyId)) throw new HTTPException(404, { message: "Návrh nenalezen" });
        return c.json(toDto(r));
      })
      .post("/suggestions/:id/decide", requirePerm("ai:use"), zValidator("json", AiDecisionInput), async (c) => {
        const [r] = await load(eq(aiSuggestions.id, c.req.param("id")), 1);
        if (!r) throw new HTTPException(404, { message: "Návrh nenalezen" });
        assertScope(c, r.s.companyId, "Návrh nenalezen");
        if (r.s.status !== "proposed") throw new HTTPException(409, { message: "O návrhu už bylo rozhodnuto." });
        const { accept, note, acknowledge } = c.req.valid("json");
        const items = r.s.items as AiItem[];
        const valid = [...new Set(accept)].filter((i) => i < items.length).sort((a, b) => a - b);
        // přijmout i zamítnout smí jen ten, kdo smí záznam upravit
        if (!(await canApply(c, r.s))) throw new HTTPException(403, { message: "Návrh může přijmout jen ten, kdo smí záznam upravit." });
        const result = valid.length ? await applyItems(db, r.s, valid, currentUser(c).id) : {};
        // stav podle položek k rozhodnutí (u skóre dokumentu jen náměty); bez námětů / „vzít na vědomí“ = přijato
        const actionable = new Set(actionableItems(items));
        const chosen = valid.filter((i) => actionable.has(i)).length;
        const status = valid.length === 0 ? (acknowledge ? "accepted" : "rejected") : chosen >= actionable.size ? "accepted" : "partially_accepted";
        await db
          .update(aiSuggestions)
          .set({ status, acceptedItems: valid, decidedById: currentUser(c).id, decidedAt: new Date(), decisionNote: note ?? null, updatedAt: new Date() })
          .where(eq(aiSuggestions.id, r.s.id));
        await audit(db, { c, user: currentUser(c), action: "ai.decided", entityType: r.s.entityType, entityId: r.s.entityId, details: { suggestionId: r.s.id, status, accepted: valid, total: items.length, ...result } });
        const [fresh] = await load(eq(aiSuggestions.id, r.s.id), 1);
        return c.json({ suggestion: toDto(fresh!), ...result });
      })

      /* ---------- dotazy v přirozeném jazyce (v0.20) ---------- */
      .get("/tools", requirePerm("ai:use"), async (c) => {
        const tools = toolsFor(await toolCtx(c)).map((t): AiToolInfo => ({ name: t.name, title: t.title, description: t.description }));
        return c.json(tools);
      })
      .get("/queries", requirePerm("ai:use"), async (c) => {
        await expireStaleQueries();
        const rows = await db.select().from(aiQueries).where(eq(aiQueries.userId, currentUser(c).id)).orderBy(desc(aiQueries.createdAt)).limit(20);
        return c.json(rows.map((r) => queryDto(r)));
      })
      .get("/queries/:id", requirePerm("ai:use"), async (c) => {
        const [r] = await db.select().from(aiQueries).where(eq(aiQueries.id, c.req.param("id")));
        if (!r || r.userId !== currentUser(c).id) throw new HTTPException(404, { message: "Dotaz nenalezen" });
        return c.json(queryDto(r));
      })
      .post("/queries", requirePerm("ai:use"), zValidator("json", AiQueryInput), async (c) => {
        const { question } = c.req.valid("json");
        const s = await getAiSettings(db);
        if (!s.enabled) throw new HTTPException(409, { message: "AI asistent je vypnutý (Administrace → AI asistent)." });
        await expireStaleQueries();
        const user = currentUser(c);
        const [busy] = await db.select({ id: aiQueries.id }).from(aiQueries).where(and(eq(aiQueries.userId, user.id), eq(aiQueries.status, "running")));
        if (busy) throw new HTTPException(409, { message: "Předchozí dotaz ještě běží – počkejte na odpověď." });
        const ctx = await toolCtx(c);
        const sc = scopeOf(c);
        const [row] = await db
          .insert(aiQueries)
          .values({ companyId: sc.active ?? (sc.ids.includes(sc.home) ? sc.home : (sc.ids[0] ?? sc.home)), userId: user.id, question, provider: s.provider, model: s.model })
          .returning();
        await audit(db, { c, user, action: "ai.query", entityType: "ai_query", entityId: row!.id, details: { question, model: s.model, companies: ctx.companyIds.length } });
        const job = runQuery(db, config, row!.id, question, ctx, deps.fetchImpl, await sourceRetriever(db, config, c, question, deps.fetchImpl));
        deps.onBackground?.(job);
        return c.json(queryDto(row!), 202);
      })
      .get("/log/queries", requirePerm("admin:settings", "audit_log:read"), async (c) => {
        const rows = await db
          .select({ q: aiQueries, userName: users.displayName })
          .from(aiQueries)
          .leftJoin(users, eq(users.id, aiQueries.userId))
          .where(inScope(c, aiQueries.companyId))
          .orderBy(desc(aiQueries.createdAt))
          .limit(200);
        return c.json(rows.map((r) => ({ ...queryDto(r.q, r.userName), plan: r.q.plan })));
      })

      /* ---------- auditní přehled AI (AI Act – záznamy) ---------- */
      .get("/log", requirePerm("admin:settings", "audit_log:read"), async (c) => {
        const rows = await load(inScope(c, aiSuggestions.companyId), 200);
        const riskIds = rows.filter((r) => r.s.entityType === "risk").map((r) => r.s.entityId);
        const ctlIds = rows.filter((r) => r.s.entityType === "control").map((r) => r.s.entityId);
        const names = new Map<string, string>();
        if (riskIds.length) for (const x of await db.select({ id: risks.id, name: risks.name, code: risks.code }).from(risks).where(inArray(risks.id, riskIds))) names.set(x.id, x.code ? `${x.code} ${x.name}` : x.name);
        if (ctlIds.length) for (const x of await db.select({ id: controls.id, name: controls.name, code: controls.code }).from(controls).where(inArray(controls.id, ctlIds))) names.set(x.id, x.code ? `${x.code} ${x.name}` : x.name);
        const byType = (t: string) => rows.filter((r) => r.s.entityType === t).map((r) => r.s.entityId);
        const add = (list: { id: string; name: string; code?: string | null }[]) => list.forEach((x) => names.set(x.id, x.code ? `${x.code} ${x.name}` : x.name));
        if (byType("asset").length) add(await db.select({ id: assets.id, name: assets.name }).from(assets).where(inArray(assets.id, byType("asset"))));
        if (byType("finding").length) add(await db.select({ id: auditFindings.id, name: auditFindings.title, code: auditFindings.code }).from(auditFindings).where(inArray(auditFindings.id, byType("finding"))));
        if (byType("incident").length) add(await db.select({ id: incidents.id, name: incidents.title, code: incidents.code }).from(incidents).where(inArray(incidents.id, byType("incident"))));
        if (byType("policy").length) add(await db.select({ id: policies.id, name: policies.title, code: policies.code }).from(policies).where(inArray(policies.id, byType("policy"))));
        if (byType("ai_system").length) add(await db.select({ id: aiSystems.id, name: aiSystems.name, code: aiSystems.code }).from(aiSystems).where(inArray(aiSystems.id, byType("ai_system"))));
        if (byType("cra_product").length) add(await db.select({ id: craProducts.id, name: craProducts.name, code: craProducts.code }).from(craProducts).where(inArray(craProducts.id, byType("cra_product"))));
        if (byType("customer_questionnaire").length) add(await db.select({ id: customerQuestionnaires.id, name: customerQuestionnaires.title }).from(customerQuestionnaires).where(inArray(customerQuestionnaires.id, byType("customer_questionnaire"))));
        if (byType("supplier_report").length) add(await db.select({ id: supplierReports.id, name: supplierReports.title }).from(supplierReports).where(inArray(supplierReports.id, byType("supplier_report"))));
        if (byType("vuln_scan").length) add(await db.select({ id: vulnScans.id, name: vulnScans.name }).from(vulnScans).where(inArray(vulnScans.id, byType("vuln_scan"))));
        const out: AiLogRow[] = rows.map((r) => ({ ...toDto(r), input: r.s.input, rawOutput: r.s.rawOutput, entityName: names.get(r.s.entityId) ?? null }));
        return c.json(out);
      })
  );
}
