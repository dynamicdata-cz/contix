import { methodologyMatrix, ACTION_STATUSES,
  BUILTIN_THREATS,
  BUILTIN_WEAKNESSES,
  CATALOG_SOURCE_409,
  CATALOG_SOURCE_82,
  fromDecreeLevel,
  isAcceptable,
  LEGACY_82_CODES,
  maxScore,
  TreatmentActionInput,
  TreatmentActionPatch,
  type RiskLevel,
  type TreatmentActionDto,
  CatalogItemInput,
  matrixLikelihood,
  patchOf,
  RISK_LEVELS,
  RISK_STATUSES,
  RiskInput,
  RiskListQuery,
  RiskPatch,
  riskScore,
  residualValues,
  RiskFromVulnsInput,
  RiskFromPackageInput,
  type VulnRiskSuggestion,
  suggestResidual,
  portfolio,
  BUILTIN_RISK_METHODOLOGY,
  getRiskMethodology,
  factorErrors,
  type FactorValues,
  type CatalogItemDto,
  type RiskDetail,
  type RiskListItem,
  type RiskPolicy,
  type RiskSummaryDto,
  RiskReviewInput,
  suggestFromTriggers,
  triggerDue,
  planSuggestions,
  PlanSuggestionApplyInput,
  type CapabilityKey,
  type CapabilityStatus,
  type RiskReassessmentDto,
  type RiskReviewDecision,
  type RiskTrigger,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { quantOf } from "./quant";
import { riskBaseline, riskTriggers } from "./triggers";
import { markConfirmed, markReassessed } from "../cycles/routes";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, inScope, riskPolicies, settingsFor, targetCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import {
  assets,
  assetVulnerabilities,
  controls,
  riskControls,
  riskTreatmentActions,
  positionHolders,
  positions,
  processes,
  riskAssets,
  riskCatalog,
  riskCatalogLinks,
  riskCves,
  riskProcesses,
  riskReviews,
  riskScenarioProposals,
  risks,
  users,
} from "../../db/schema";
import { ApiError } from "../../lib/apiError";

type Ctx = Context<AppEnv>;
type RiskRow = typeof risks.$inferSelect;

/**
 * Doplní výchozí katalog hrozeb a zranitelností dle přílohy č. 3 vyhl. č. 409/2025 Sb. (idempotentně).
 * Výchozí položky z vyhl. č. 82/2018 Sb. (bez zdroje, kódy H01–H17 / Z01–Z12) se převedou na historické:
 * kód dostane příponu „-82“, položka se deaktivuje a zůstane navázaná na existující rizika.
 */
export async function seedRiskCatalog(db: Db) {
  const legacy = await db
    .select({ id: riskCatalog.id, kind: riskCatalog.kind, code: riskCatalog.code })
    .from(riskCatalog)
    .where(and(eq(riskCatalog.isBuiltin, true), isNull(riskCatalog.source)));
  for (const x of legacy) {
    if (!x.code || !LEGACY_82_CODES[x.kind].includes(x.code)) continue;
    await db
      .update(riskCatalog)
      .set({ code: `${x.code}-82`, isActive: false, source: CATALOG_SOURCE_82, updatedAt: new Date() })
      .where(eq(riskCatalog.id, x.id));
  }
  const rows = [
    ...BUILTIN_THREATS.map((t) => ({
      kind: "threat" as const,
      code: t.code,
      name: t.name,
      category: t.category,
      affectsC: t.c,
      affectsI: t.i,
      affectsA: t.a,
      isBuiltin: true,
      source: CATALOG_SOURCE_409,
    })),
    ...BUILTIN_WEAKNESSES.map((w) => ({ kind: "weakness" as const, code: w.code, name: w.name, category: w.category, isBuiltin: true, source: CATALOG_SOURCE_409 })),
  ];
  await db.insert(riskCatalog).values(rows).onConflictDoNothing();
}

/**
 * Návrh dopadu: nejvyšší hodnocení těch složek CIA dotčených aktiv, které hrozba ohrožuje.
 * (Bez hrozby → všechny složky.) Vrací úroveň vyhlášky 1–4 (hodnocení aktiv dle přílohy č. 1);
 * na stupnici metodiky se převádí funkcí `fromDecreeLevel`.
 */

/** Opatření rizika s důkazy účinnosti – poslední dokončený test a nesplněný monitor (v1.20, ADR-117). */
const controlEvidenceCols = {
  id: controls.id,
  code: controls.code,
  name: controls.name,
  status: controls.status,
  effectiveness: controls.effectiveness,
  lastTestResult: sql<string | null>`(select t.result from control_tests t where t.control_id = ${controls.id} and t.status = 'completed' and t.result is not null order by t.performed_at desc nulls last, t.updated_at desc limit 1)`,
  monitorFailing: sql<boolean>`exists (select 1 from control_monitors m where m.control_id = ${controls.id} and m.enabled and m.last_result = 'fail')`,
};

export function suggestImpact(
  affected: { c: boolean; i: boolean; a: boolean } | null,
  assetCia: { confidentiality: number | null; integrity: number | null; availability: number | null }[],
): number | null {
  const f = affected ?? { c: true, i: true, a: true };
  const vals = assetCia.flatMap((x) => [f.c ? x.confidentiality : null, f.i ? x.integrity : null, f.a ? x.availability : null]);
  const nums = vals.filter((v): v is number => v != null);
  return nums.length ? Math.max(...nums) : null;
}

function scoreOf(policy: RiskPolicy, r: RiskRow) {
  const cur = riskScore(policy, r, r.scaleLevels);
  const res = riskScore(policy, residualValues(r), r.scaleLevels);
  return { score: cur.score, level: cur.level, residualScore: res.score, residualLevel: res.level, max: cur.max };
}

const today = () => new Date().toISOString().slice(0, 10);
const SCORE_FIELDS = ["impact", "threatLevel", "vulnLevel", "likelihood", "residualImpact", "residualThreatLevel", "residualVulnLevel", "residualLikelihood"] as const;

function reviewDue(policy: RiskPolicy, r: RiskRow) {
  if (r.status === "closed" || !r.assessedAt) return false;
  const limit = new Date();
  limit.setMonth(limit.getMonth() - policy.reviewMonths);
  // potvrzení hodnocení beze změny (ADR-058) se počítá jako pravidelné hodnocení
  return riskBaseline(r) < limit;
}

const FACTOR_FIELDS = ["factorValues", "residualFactorValues"] as const;
const policyMethod = (p: RiskPolicy) => p.methodology || BUILTIN_RISK_METHODOLOGY;
/** Riziko hodnocené v jiné metodice / stupnici, než je aktuální politika společnosti. */
const isOutdated = (p: RiskPolicy, r: RiskRow) =>
  r.methodologyKey !== policyMethod(p) || (r.methodologyKey === BUILTIN_RISK_METHODOLOGY && r.scaleLevels !== p.levels);

/** Hodnoty hodnocení musí odpovídat metodice politiky (stupnice vyhlášky, nebo faktory importované metodiky). */
function assertScale(input: Record<string, unknown>, policy: RiskPolicy) {
  const mk = policyMethod(policy);
  if (mk !== BUILTIN_RISK_METHODOLOGY) {
    const def = getRiskMethodology(mk);
    if (!def) throw new ApiError(400, "err.risks.methUnavailable", { key: String(mk) });
    const errs = FACTOR_FIELDS.flatMap((k) => factorErrors(def, input[k] as FactorValues | null | undefined));
    if (errs.length) throw new HTTPException(400, { message: errs.join(" ") });
    return;
  }
  const levels = policy.levels;
  for (const k of SCORE_FIELDS) {
    const v = input[k];
    if (typeof v === "number" && v > levels)
      throw new ApiError(400, "err.risks.scoreOutOfScale", { field: String(k), value: String(v), levels: String(levels) });
  }
}

/** Akce plánu zvládání rizik (s názvem rizika, opatření a odpovědného místa). */
/** `policy` = jedna politika, nebo mapa politik podle společnosti rizika. */
export async function loadActions(db: Db, policy: RiskPolicy | Map<string, RiskPolicy>, where: SQL | undefined): Promise<TreatmentActionDto[]> {
  const ctl = alias(controls, "ctl");
  const rows = await db
    .select({ a: riskTreatmentActions, r: risks, controlCode: ctl.code, controlName: ctl.name, ownerPositionName: positions.name })
    .from(riskTreatmentActions)
    .innerJoin(risks, eq(risks.id, riskTreatmentActions.riskId))
    .leftJoin(ctl, eq(ctl.id, riskTreatmentActions.controlId))
    .leftJoin(positions, eq(positions.id, riskTreatmentActions.ownerPositionId))
    .where(where)
    .orderBy(asc(riskTreatmentActions.dueDate), asc(riskTreatmentActions.createdAt));
  const t = today();
  return rows.map(({ a, r, controlCode, controlName, ownerPositionName }) => ({
    id: a.id,
    riskId: r.id,
    riskCode: r.code,
    riskName: r.name,
    riskLevel: riskScore(policy instanceof Map ? policy.get(r.companyId)! : policy, r, r.scaleLevels).level as RiskLevel | null,
    controlId: a.controlId,
    controlCode,
    controlName,
    title: a.title,
    description: a.description,
    objective: a.objective,
    ownerPositionId: a.ownerPositionId,
    ownerPositionName,
    resourcesHuman: a.resourcesHuman,
    resourcesFinancial: a.resourcesFinancial,
    resourcesTechnical: a.resourcesTechnical,
    costEstimate: a.costEstimate,
    dueDate: a.dueDate,
    realization: a.realization,
    status: a.status,
    completedAt: a.completedAt?.toISOString() ?? null,
    overdue: !!a.dueDate && a.dueDate < t && (a.status === "planned" || a.status === "in_progress"),
  }));
}

export function riskRoutes(db: Db) {
  async function planSuggestionsFor(riskId: string) {
    const [ctrls, acts, props] = await Promise.all([
      db.select(controlEvidenceCols).from(riskControls).innerJoin(controls, eq(controls.id, riskControls.controlId)).where(eq(riskControls.riskId, riskId)).orderBy(asc(controls.code)),
      db.select({ title: riskTreatmentActions.title, controlId: riskTreatmentActions.controlId, status: riskTreatmentActions.status }).from(riskTreatmentActions).where(eq(riskTreatmentActions.riskId, riskId)),
      db.select({ evidence: riskScenarioProposals.evidence }).from(riskScenarioProposals).where(and(eq(riskScenarioProposals.riskId, riskId), inArray(riskScenarioProposals.status, ["accepted", "linked"]))),
    ]);
    const caps = props.flatMap((p) => (((p.evidence as Record<string, unknown>)?.capabilities ?? []) as { key: CapabilityKey; status: CapabilityStatus }[]));
    return planSuggestions({ controls: ctrls, capabilities: caps, actions: acts });
  }

  const threat = alias(riskCatalog, "threat");
  const weakness = alias(riskCatalog, "weakness");

  async function canEdit(c: Ctx, r: { ownerPositionId: string | null }) {
    if (hasPerm(c, "risks:write")) return true;
    if (!r.ownerPositionId) return false;
    const [h] = await db
      .select({ n: count() })
      .from(positionHolders)
      .where(and(eq(positionHolders.positionId, r.ownerPositionId), eq(positionHolders.userId, currentUser(c).id)));
    return h!.n > 0;
  }

  async function listRows(where: ReturnType<typeof and> | undefined) {
    return db
      .select({
        r: risks,
        threatName: threat.name,
        weaknessName: weakness.name,
        moreThreatNames: sql<string[]>`coalesce((select array_agg(k.name order by k.code, k.name) from risk_catalog_links l join risk_catalog k on k.id = l.catalog_id where l.risk_id = ${risks.id} and k.kind = 'threat'), '{}')`,
        moreWeaknessNames: sql<string[]>`coalesce((select array_agg(k.name order by k.code, k.name) from risk_catalog_links l join risk_catalog k on k.id = l.catalog_id where l.risk_id = ${risks.id} and k.kind = 'weakness'), '{}')`,
        ownerPositionName: positions.name,
        assetCount: sql<number>`(select count(*)::int from risk_assets x where x.risk_id = ${risks.id})`,
        processCount: sql<number>`(select count(*)::int from risk_processes x where x.risk_id = ${risks.id})`,
      })
      .from(risks)
      .leftJoin(threat, eq(threat.id, risks.threatId))
      .leftJoin(weakness, eq(weakness.id, risks.weaknessId))
      .leftJoin(positions, eq(positions.id, risks.ownerPositionId))
      .where(where)
      .orderBy(asc(risks.code), asc(risks.name));
  }

  function toListItem(policy: RiskPolicy, x: Awaited<ReturnType<typeof listRows>>[number], triggers = 0): RiskListItem {
    const s = scoreOf(policy, x.r);
    return {
      id: x.r.id,
      companyId: x.r.companyId,
      code: x.r.code,
      name: x.r.name,
      status: x.r.status,
      threatName: x.threatName,
      weaknessName: x.weaknessName,
      moreThreatNames: x.moreThreatNames ?? [],
      moreWeaknessNames: x.moreWeaknessNames ?? [],
      ownerPositionName: x.ownerPositionName,
      score: s.score,
      level: s.level,
      residualScore: s.residualScore,
      residualLevel: s.residualLevel,
      treatment: x.r.treatment,
      treatmentDue: x.r.treatmentDue,
      assetCount: x.assetCount,
      processCount: x.processCount,
      scaleLevels: x.r.scaleLevels,
      outdatedScale: isOutdated(policy, x.r) && !!s.score,
      acceptable: s.level ? isAcceptable(policy, s.level, x.r.methodologyKey) : null,
      assessedAt: x.r.assessedAt?.toISOString() ?? null,
      reviewDue: reviewDue(policy, x.r),
      triggers,
      reviewedAt: x.r.reviewedAt?.toISOString() ?? null,
      updatedAt: x.r.updatedAt.toISOString(),
      ale: x.r.quant ? (quantOf(x.r.id, x.r.quant, policy.quant)?.inherent.mean ?? null) : null,
      quantLevel: x.r.quant ? (quantOf(x.r.id, x.r.quant, policy.quant)?.level ?? null) : null,
    };
  }

  async function detail(c: Ctx, id: string): Promise<RiskDetail> {
    const [row] = await listRows(eq(risks.id, id));
    if (!row) throw new HTTPException(404, { message: "Riziko nenalezeno" });
    assertScope(c, row.r.companyId, "Riziko nenalezeno");
    const policy = (await settingsFor(db, c, row.r.companyId)).riskPolicy;
    const r = row.r;
    const [assetRows, procRows, cveRows, threatRow, controlRows, actions, trig, scenario] = await Promise.all([
      db
        .select({
          id: assets.id,
          name: assets.name,
          assetType: assets.assetType,
          healthStatus: assets.healthStatus,
          confidentiality: assets.confidentiality,
          integrity: assets.integrity,
          availability: assets.availability,
        })
        .from(riskAssets)
        .innerJoin(assets, eq(assets.id, riskAssets.assetId))
        .where(eq(riskAssets.riskId, id))
        .orderBy(asc(assets.name)),
      db
        .select({ id: processes.id, code: processes.code, name: processes.name })
        .from(riskProcesses)
        .innerJoin(processes, eq(processes.id, riskProcesses.processId))
        .where(eq(riskProcesses.riskId, id))
        .orderBy(asc(processes.name)),
      db
        .select({ id: assetVulnerabilities.id, cveId: assetVulnerabilities.cveId, severity: assetVulnerabilities.severity, status: assetVulnerabilities.status, assetName: assets.name })
        .from(riskCves)
        .innerJoin(assetVulnerabilities, eq(assetVulnerabilities.id, riskCves.vulnerabilityId))
        .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
        .where(eq(riskCves.riskId, id)),
      r.threatId ? db.select().from(riskCatalog).where(eq(riskCatalog.id, r.threatId)) : ([] as (typeof riskCatalog.$inferSelect)[]),
      db
        .select(controlEvidenceCols)
        .from(riskControls)
        .innerJoin(controls, eq(controls.id, riskControls.controlId))
        .where(eq(riskControls.riskId, id))
        .orderBy(asc(controls.code)),
      loadActions(db, policy, eq(riskTreatmentActions.riskId, id)),
      riskTriggers(db, [id]),
      db
        .select({ id: riskCatalog.id, kind: riskCatalog.kind, affectsC: riskCatalog.affectsC, affectsI: riskCatalog.affectsI, affectsA: riskCatalog.affectsA })
        .from(riskCatalogLinks)
        .innerJoin(riskCatalog, eq(riskCatalog.id, riskCatalogLinks.catalogId))
        .where(eq(riskCatalogLinks.riskId, id))
        .orderBy(asc(riskCatalog.code)),
    ]);
    // dopad na C/I/A ze všech hrozeb scénáře (hlavní + další, ADR-085)
    const threats = [...threatRow, ...scenario.filter((x) => x.kind === "threat")];
    const t = threats.length ? { affectsC: threats.some((x) => x.affectsC), affectsI: threats.some((x) => x.affectsI), affectsA: threats.some((x) => x.affectsA) } : undefined;
    return {
      ...toListItem(policy, row, trig.get(id)?.length ?? 0),
      description: r.description,
      threatId: r.threatId,
      weaknessId: r.weaknessId,
      moreThreatIds: scenario.filter((x) => x.kind === "threat").map((x) => x.id),
      moreWeaknessIds: scenario.filter((x) => x.kind === "weakness").map((x) => x.id),
      ownerPositionId: r.ownerPositionId,
      impact: r.impact,
      threatLevel: r.threatLevel,
      vulnLevel: r.vulnLevel,
      likelihood: r.likelihood,
      treatmentPlan: r.treatmentPlan,
      residualImpact: r.residualImpact,
      residualThreatLevel: r.residualThreatLevel,
      residualVulnLevel: r.residualVulnLevel,
      residualLikelihood: r.residualLikelihood,
      methodologyKey: r.methodologyKey,
      factorValues: r.factorValues ?? null,
      residualFactorValues: r.residualFactorValues ?? null,
      policy,
      quant: r.quant ?? null,
      residualSuggestion:
        r.methodologyKey === BUILTIN_RISK_METHODOLOGY && policyMethod(policy) === BUILTIN_RISK_METHODOLOGY && controlRows.length
          ? suggestResidual(r, controlRows, policy.method)
          : null,
      quantResult: quantOf(r.id, r.quant, policy.quant, actions.filter((a) => a.status !== "cancelled").reduce((n, a) => n + (a.costEstimate ?? 0), 0)),
      assets: assetRows,
      processes: procRows,
      cves: cveRows,
      suggestedImpact: fromDecreeLevel(suggestImpact(t ? { c: t.affectsC, i: t.affectsI, a: t.affectsA } : null, assetRows), policy.levels as 3 | 4 | 5),
      method: policy.method,
      maxScore: maxScore(policy.method, r.scaleLevels),
      controls: controlRows,
      actions,
      canEdit: await canEdit(c, r),
    };
  }

  async function setLinks(riskId: string, v: { assetIds?: string[]; processIds?: string[]; cveIds?: string[]; controlIds?: string[] }) {
    if (v.controlIds) {
      await db.delete(riskControls).where(eq(riskControls.riskId, riskId));
      const ids = [...new Set(v.controlIds)];
      if (ids.length) await db.insert(riskControls).values(ids.map((controlId) => ({ riskId, controlId })));
    }
    if (v.assetIds) {
      await db.delete(riskAssets).where(eq(riskAssets.riskId, riskId));
      const ids = [...new Set(v.assetIds)];
      if (ids.length) await db.insert(riskAssets).values(ids.map((assetId) => ({ riskId, assetId })));
    }
    if (v.processIds) {
      await db.delete(riskProcesses).where(eq(riskProcesses.riskId, riskId));
      const ids = [...new Set(v.processIds)];
      if (ids.length) await db.insert(riskProcesses).values(ids.map((processId) => ({ riskId, processId })));
    }
    if (v.cveIds) {
      await db.delete(riskCves).where(eq(riskCves.riskId, riskId));
      const ids = [...new Set(v.cveIds)];
      // po dávkách (aktivum může mít tisíce zranitelností; limit parametrů PostgreSQL)
      for (let i = 0; i < ids.length; i += 5000) await db.insert(riskCves).values(ids.slice(i, i + 5000).map((vulnerabilityId) => ({ riskId, vulnerabilityId })));
    }
  }

  async function loadReviews(riskId: string) {
    const rows = await db
      .select({ r: riskReviews, userName: users.displayName })
      .from(riskReviews)
      .leftJoin(users, eq(users.id, riskReviews.userId))
      .where(eq(riskReviews.riskId, riskId))
      .orderBy(desc(riskReviews.createdAt))
      .limit(50);
    return rows.map(({ r, userName }) => ({
      id: r.id,
      decision: r.decision as RiskReviewDecision,
      note: r.note,
      triggers: r.triggers,
      levelBefore: r.levelBefore,
      levelAfter: r.levelAfter,
      scoreBefore: r.scoreBefore,
      scoreAfter: r.scoreAfter,
      userName,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  type Score = ReturnType<typeof scoreOf>;
  async function writeReview(c: Ctx, r: RiskRow, decision: RiskReviewDecision, note: string | null, triggers: RiskTrigger[], before: Score, after: Score) {
    await db.insert(riskReviews).values({
      companyId: r.companyId,
      riskId: r.id,
      decision,
      note,
      triggers,
      levelBefore: before.level,
      levelAfter: after.level,
      scoreBefore: before.score,
      scoreAfter: after.score,
      userId: currentUser(c).id,
    });
  }

  async function assertCatalogKind(id: string | null | undefined | string[], kind: "threat" | "weakness") {
    const ids = [...new Set(Array.isArray(id) ? id : id ? [id] : [])];
    if (!ids.length) return;
    const rows = await db.select({ kind: riskCatalog.kind }).from(riskCatalog).where(inArray(riskCatalog.id, ids));
    if (rows.length !== ids.length || rows.some((x) => x.kind !== kind)) throw new HTTPException(400, { message: kind === "threat" ? "Neplatná hrozba" : "Neplatná zranitelnost" });
  }

  /** Další hrozby / zranitelnosti scénáře (ADR-085); `undefined` = beze změny. Hlavní položka se mezi další neukládá. */
  async function setScenario(riskId: string, kind: "threat" | "weakness", ids: string[] | undefined, primary: string | null) {
    if (!ids) return;
    const cur = await db
      .select({ id: riskCatalogLinks.catalogId })
      .from(riskCatalogLinks)
      .innerJoin(riskCatalog, eq(riskCatalog.id, riskCatalogLinks.catalogId))
      .where(and(eq(riskCatalogLinks.riskId, riskId), eq(riskCatalog.kind, kind)));
    if (cur.length) await db.delete(riskCatalogLinks).where(and(eq(riskCatalogLinks.riskId, riskId), inArray(riskCatalogLinks.catalogId, cur.map((x) => x.id))));
    const next = [...new Set(ids)].filter((x) => x !== primary);
    if (next.length) await db.insert(riskCatalogLinks).values(next.map((catalogId) => ({ riskId, catalogId })));
  }

  const CatalogPatch = patchOf(CatalogItemInput);

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "risks"))

      /* ---------- katalog hrozeb / zranitelností ---------- */
      .get("/catalog", requirePerm("risks:read"), zValidator("query", z.object({ kind: z.enum(["threat", "weakness"]).optional() })), async (c) => {
        const { kind } = c.req.valid("query");
        const rows = await db
          .select({
            x: riskCatalog,
            riskCount: sql<number>`(select count(*)::int from risks r where r.threat_id = ${riskCatalog.id} or r.weakness_id = ${riskCatalog.id})`,
          })
          .from(riskCatalog)
          .where(kind ? eq(riskCatalog.kind, kind) : undefined)
          .orderBy(asc(riskCatalog.kind), asc(riskCatalog.code), asc(riskCatalog.name));
        return c.json(
          rows.map(
            ({ x, riskCount }): CatalogItemDto => ({
              id: x.id,
              kind: x.kind,
              code: x.code,
              name: x.name,
              category: x.category,
              description: x.description,
              affectsC: x.affectsC,
              affectsI: x.affectsI,
              affectsA: x.affectsA,
              isBuiltin: x.isBuiltin,
              isActive: x.isActive,
              source: x.source,
              riskCount,
            }),
          ),
        );
      })
      .post("/catalog/:kind{threat|weakness}", requirePerm("risks:catalog"), zValidator("json", CatalogItemInput), async (c) => {
        const kind = c.req.param("kind") as "threat" | "weakness";
        const input = c.req.valid("json");
        const [x] = await db
          .insert(riskCatalog)
          .values({ ...input, kind })
          .onConflictDoNothing()
          .returning();
        if (!x) throw new ApiError(409, "err.risks.catalogCodeExists", { code: String(input.code) });
        await audit(db, { c, user: currentUser(c), action: "risk.catalog_created", entityType: "risk_catalog", entityId: x.id, details: { kind, name: x.name } });
        return c.json(x, 201);
      })
      .patch("/catalog/item/:id", requirePerm("risks:catalog"), zValidator("json", CatalogPatch), async (c) => {
        const id = c.req.param("id");
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
        if (!Object.keys(input).length) throw new HTTPException(400, { message: "Nic ke změně" });
        const [x] = await db.update(riskCatalog).set({ ...input, updatedAt: new Date() }).where(eq(riskCatalog.id, id)).returning();
        if (!x) throw new HTTPException(404, { message: "Položka katalogu nenalezena" });
        await audit(db, { c, user: currentUser(c), action: "risk.catalog_updated", entityType: "risk_catalog", entityId: id, details: input });
        return c.json(x);
      })
      .delete("/catalog/item/:id", requirePerm("risks:catalog"), async (c) => {
        const id = c.req.param("id");
        const [x] = await db.select().from(riskCatalog).where(eq(riskCatalog.id, id));
        if (!x) throw new HTTPException(404, { message: "Položka katalogu nenalezena" });
        if (x.isBuiltin) throw new HTTPException(409, { message: "Výchozí položku katalogu nelze smazat – můžete ji deaktivovat." });
        const [used] = await db
          .select({ n: count() })
          .from(risks)
          .where(or(eq(risks.threatId, id), eq(risks.weaknessId, id), sql`exists (select 1 from risk_catalog_links l where l.risk_id = ${risks.id} and l.catalog_id = ${id})`));
        if (used!.n > 0) throw new ApiError(409, "err.risks.catalogItemInUse", { n: String(used!.n) });
        await db.delete(riskCatalog).where(eq(riskCatalog.id, id));
        await audit(db, { c, user: currentUser(c), action: "risk.catalog_deleted", entityType: "risk_catalog", entityId: id, details: { name: x.name } });
        return c.body(null, 204);
      })

      /* ---------- přehled ---------- */
      .get("/summary", requirePerm("risks:read"), async (c) => {
        const policy = (await settingsFor(db, c)).riskPolicy;
        const policies = await riskPolicies(db, await getSettings(db));
        const [rows, withActions] = await Promise.all([
          db.select().from(risks).where(inScope(c, risks.companyId)),
          db.selectDistinct({ riskId: riskTreatmentActions.riskId }).from(riskTreatmentActions).where(sql`${riskTreatmentActions.status} <> 'cancelled'`),
        ]);
        const hasActions = new Set(withActions.map((x) => x.riskId));
        const N = policy.levels;
        const empty = () => Object.fromEntries([...RISK_LEVELS, "unassessed"].map((l) => [l, 0])) as RiskSummaryDto["byLevel"];
        const out: RiskSummaryDto = {
          byLevel: empty(),
          residualByLevel: empty(),
          byStatus: Object.fromEntries(RISK_STATUSES.map((s) => [s, 0])) as RiskSummaryDto["byStatus"],
          matrix: Array.from({ length: N }, () => Array.from({ length: N }, () => 0)),
          levels: N,
          untreated: 0,
          reviewDue: 0,
          outdatedScale: 0,
          overdue: 0,
          method: policy.method,
          policy,
          customMatrix: null,
        };
        // maticová metodika (5 × 5, importovaná s osami) – teplotní mapa z hodnot faktorů
        const mk = policyMethod(policy);
        const mm = mk !== BUILTIN_RISK_METHODOLOGY ? methodologyMatrix(getRiskMethodology(mk)) : null;
        if (mm) out.customMatrix = { methodology: mk, counts: mm.y.scale.map(() => mm.x.scale.map(() => 0)) };
        const t = today();
        for (const r of rows) {
          out.byStatus[r.status]++;
          if (r.status === "closed") continue; // uzavřená rizika se do profilu nepočítají
          const pol = policies.get(r.companyId) ?? policy;
          const s = scoreOf(pol, r);
          out.byLevel[s.level ?? "unassessed"]++;
          out.residualByLevel[s.residualLevel ?? "unassessed"]++;
          if (isOutdated(pol, r)) {
            if (s.score) out.outdatedScale++;
          } else if (r.methodologyKey === BUILTIN_RISK_METHODOLOGY && pol.levels === N && policyMethod(policy) === BUILTIN_RISK_METHODOLOGY) {
            const l = matrixLikelihood(policy, r);
            if (r.impact && l && r.impact <= N && l <= N) out.matrix[r.impact - 1]![l - 1]!++;
          } else if (mm && r.methodologyKey === mk) {
            const cell = mm.cellOf(r.factorValues);
            if (cell) out.customMatrix!.counts[cell[0]]![cell[1]]!++;
          }
          if (reviewDue(pol, r)) out.reviewDue++;
          if (s.level && !isAcceptable(pol, s.level, r.methodologyKey) && !r.treatment && !hasActions.has(r.id) && r.status !== "accepted") out.untreated++;
          if (r.treatmentDue && r.treatmentDue < t && (r.status === "identified" || r.status === "assessed" || r.status === "treatment")) out.overdue++;
        }
        return c.json(out);
      })

      /** Návrhy rizik z otevřených kritických a vysokých zranitelností aktiv, které nejsou navázané na žádné riziko. */
      .get("/suggestions/vulns", requirePerm("risks:read", "assets:read"), async (c) => {
        if (!(await getSettings(db)).enabledModules.includes("vulnerabilities")) return c.json([]);
        const rows = await db
          .select({
            id: assetVulnerabilities.id,
            cveId: assetVulnerabilities.cveId,
            severity: assetVulnerabilities.severity,
            packageName: assetVulnerabilities.packageName,
            assetId: assets.id,
            assetName: assets.name,
            companyId: assets.companyId,
            c: assets.confidentiality,
            i: assets.integrity,
            a: assets.availability,
          })
          .from(assetVulnerabilities)
          .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
          .where(
            and(
              inScope(c, assets.companyId),
              eq(assetVulnerabilities.status, "open"),
              inArray(assetVulnerabilities.severity, ["critical", "high"]),
              sql`not exists (select 1 from risk_cves rc where rc.vulnerability_id = ${assetVulnerabilities.id})`,
            ),
          )
          .orderBy(asc(assets.name));
        const pol = await riskPolicies(db, await getSettings(db));
        const by = new Map<string, VulnRiskSuggestion>();
        for (const r of rows) {
          const lv = (pol.get(r.companyId)?.levels ?? 4) as 3 | 4 | 5;
          let s = by.get(r.assetId);
          if (!s) {
            s = {
              assetId: r.assetId,
              assetName: r.assetName,
              companyId: r.companyId,
              cves: [],
              cveCount: 0,
              criticalCount: 0,
              maxSeverity: r.severity,
              suggestedVulnLevel: 0,
              suggestedImpact: fromDecreeLevel(suggestImpact(null, [{ confidentiality: r.c, integrity: r.i, availability: r.a }]), lv),
            };
            by.set(r.assetId, s);
          }
          s.cveCount++;
          if (r.severity === "critical") s.criticalCount++;
          // ukázka: kritické přednostně, nejvýše 8 (celý seznam by u velkých aktiv měl tisíce položek)
          if (s.cves.length < 8 || (r.severity === "critical" && s.cves.some((x) => x.severity !== "critical"))) {
            if (s.cves.length >= 8) s.cves.splice(s.cves.findIndex((x) => x.severity !== "critical"), 1);
            s.cves.push({ id: r.id, cveId: r.cveId, severity: r.severity, packageName: r.packageName });
          }
          if (r.severity === "critical") s.maxSeverity = "critical";
          s.suggestedVulnLevel = fromDecreeLevel(s.maxSeverity === "critical" ? 4 : 3, lv)!;
        }
        for (const s of by.values()) s.cves.sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical") || a.cveId.localeCompare(b.cveId));
        return c.json([...by.values()].sort((a, b) => b.criticalCount - a.criticalCount || b.cveCount - a.cveCount));
      })
      /** Založí riziko ze zranitelností aktiva (zranitelnost Z17 přílohy č. 3, vazby na aktivum a CVE). */
      .post("/from-vulns", requirePerm("risks:write"), zValidator("json", RiskFromVulnsInput), async (c) => {
        const { assetId, vulnerabilityIds } = c.req.valid("json");
        const [a] = await db.select().from(assets).where(eq(assets.id, assetId));
        if (!a) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
        assertScope(c, a.companyId, "Aktivum nenalezeno");
        const vs = vulnerabilityIds
          ? await db.select().from(assetVulnerabilities).where(and(inArray(assetVulnerabilities.id, vulnerabilityIds), eq(assetVulnerabilities.assetId, assetId)))
          : // všechny otevřené kritické a vysoké zranitelnosti aktiva, které ještě nejsou navázané na riziko
            await db
              .select()
              .from(assetVulnerabilities)
              .where(
                and(
                  eq(assetVulnerabilities.assetId, assetId),
                  eq(assetVulnerabilities.status, "open"),
                  inArray(assetVulnerabilities.severity, ["critical", "high"]),
                  sql`not exists (select 1 from risk_cves rc where rc.vulnerability_id = ${assetVulnerabilities.id})`,
                ),
              );
        if (vulnerabilityIds && vs.length !== new Set(vulnerabilityIds).size) throw new HTTPException(400, { message: "Zranitelnost nepatří k aktivu" });
        if (!vs.length) throw new HTTPException(400, { message: "Aktivum nemá žádné nepokryté kritické ani vysoké zranitelnosti." });
        vs.sort((x, y) => Number(y.severity === "critical") - Number(x.severity === "critical") || (y.cvssScore ?? 0) - (x.cvssScore ?? 0));
        const companyId = targetCompany(c, a.companyId, "risks:write");
        const policy = (await settingsFor(db, c, companyId)).riskPolicy;
        const lv = policy.levels as 3 | 4 | 5;
        const [weak] = await db.select({ id: riskCatalog.id }).from(riskCatalog).where(and(eq(riskCatalog.kind, "weakness"), eq(riskCatalog.code, "Z17"), eq(riskCatalog.isBuiltin, true)));
        const [threat] = await db.select({ id: riskCatalog.id }).from(riskCatalog).where(and(eq(riskCatalog.kind, "threat"), eq(riskCatalog.code, "H09"), eq(riskCatalog.isBuiltin, true)));
        const critical = vs.some((v) => v.severity === "critical");
        const builtin = policyMethod(policy) === BUILTIN_RISK_METHODOLOGY;
        const impact = fromDecreeLevel(suggestImpact({ c: true, i: true, a: false }, [{ confidentiality: a.confidentiality, integrity: a.integrity, availability: a.availability }]), lv);
        const vuln = fromDecreeLevel(critical ? 4 : 3, lv);
        const values = builtin
          ? policy.method === "three_factor"
            ? { impact, threatLevel: fromDecreeLevel(2, lv), vulnLevel: vuln }
            : { impact, likelihood: fromDecreeLevel(critical ? 3 : 2, lv), threatLevel: fromDecreeLevel(2, lv), vulnLevel: vuln }
          : {};
        const scored = builtin && impact != null;
        const [r] = await db
          .insert(risks)
          .values({
            companyId,
            name: `Zneužití zranitelností – ${a.name}`.slice(0, 300),
            description: `Neošetřené zranitelnosti (${vs.length}${vs.length > 10 ? `, nejzávažnější: ${vs.map((v) => v.cveId).slice(0, 10).join(", ")}…` : `: ${vs.map((v) => v.cveId).join(", ")}`}). Návrh z evidence zranitelností – ověřte úroveň hrozby a dopad.`,
            weaknessId: weak?.id ?? null,
            threatId: threat?.id ?? null,
            ...values,
            scaleLevels: policy.levels,
            methodologyKey: policyMethod(policy),
            assessedAt: scored ? new Date() : null,
          })
          .returning();
        await setLinks(r!.id, { assetIds: [assetId], cveIds: vs.map((v) => v.id) });
        await audit(db, { c, user: currentUser(c), action: "risk.created_from_vulns", entityType: "risk", entityId: r!.id, details: { assetId, count: vs.length, cves: vs.map((v) => v.cveId).slice(0, 50) } });
        return c.json(await detail(c, r!.id), 201);
      })

      /** Riziko za zranitelný balíček (ADR-049): aktiva a nepokryté kritické / vysoké CVE balíčku ve společnosti. */
      .post("/from-package", requirePerm("risks:write"), zValidator("json", RiskFromPackageInput), async (c) => {
        const { packageName } = c.req.valid("json");
        const companyId = targetCompany(c, c.req.valid("json").companyId, "risks:write");
        const vs = await db
          .select({ v: assetVulnerabilities, a: assets })
          .from(assetVulnerabilities)
          .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
          .where(
            and(
              eq(assets.companyId, companyId),
              eq(assetVulnerabilities.packageName, packageName),
              eq(assetVulnerabilities.status, "open"),
              inArray(assetVulnerabilities.severity, ["critical", "high"]),
              sql`not exists (select 1 from risk_cves rc where rc.vulnerability_id = ${assetVulnerabilities.id})`,
            ),
          );
        if (!vs.length) throw new HTTPException(400, { message: "Balíček nemá žádné nepokryté kritické ani vysoké zranitelnosti." });
        const assetMap = new Map(vs.map((x) => [x.a.id, x.a]));
        const policy = (await settingsFor(db, c, companyId)).riskPolicy;
        const lv = policy.levels as 3 | 4 | 5;
        const [weak] = await db.select({ id: riskCatalog.id }).from(riskCatalog).where(and(eq(riskCatalog.kind, "weakness"), eq(riskCatalog.code, "Z17"), eq(riskCatalog.isBuiltin, true)));
        const [threat] = await db.select({ id: riskCatalog.id }).from(riskCatalog).where(and(eq(riskCatalog.kind, "threat"), eq(riskCatalog.code, "H09"), eq(riskCatalog.isBuiltin, true)));
        const critical = vs.some((x) => x.v.severity === "critical");
        const builtin = policyMethod(policy) === BUILTIN_RISK_METHODOLOGY;
        const impact = fromDecreeLevel(suggestImpact({ c: true, i: true, a: false }, [...assetMap.values()].map((a) => ({ confidentiality: a.confidentiality, integrity: a.integrity, availability: a.availability }))), lv);
        const vuln = fromDecreeLevel(critical ? 4 : 3, lv);
        const values = builtin
          ? policy.method === "three_factor"
            ? { impact, threatLevel: fromDecreeLevel(2, lv), vulnLevel: vuln }
            : { impact, likelihood: fromDecreeLevel(critical ? 3 : 2, lv), threatLevel: fromDecreeLevel(2, lv), vulnLevel: vuln }
          : {};
        const cves = [...new Set(vs.sort((x, y) => Number(y.v.severity === "critical") - Number(x.v.severity === "critical") || (y.v.cvssScore ?? 0) - (x.v.cvssScore ?? 0)).map((x) => x.v.cveId))];
        const [r] = await db
          .insert(risks)
          .values({
            companyId,
            name: `Zranitelný balíček ${packageName} (${assetMap.size} ${assetMap.size === 1 ? "aktivum" : assetMap.size < 5 ? "aktiva" : "aktiv"})`.slice(0, 300),
            description: `Neošetřené zranitelnosti balíčku ${packageName}: ${cves.length} CVE${cves.length > 10 ? `, nejzávažnější ${cves.slice(0, 10).join(", ")}…` : ` (${cves.join(", ")})`}. Opravou (aktualizací) balíčku se odstraní na všech dotčených aktivech. Návrh z plánu oprav – ověřte úroveň hrozby a dopad.`,
            weaknessId: weak?.id ?? null,
            threatId: threat?.id ?? null,
            ...values,
            scaleLevels: policy.levels,
            methodologyKey: policyMethod(policy),
            assessedAt: builtin && impact != null ? new Date() : null,
          })
          .returning();
        await setLinks(r!.id, { assetIds: [...assetMap.keys()], cveIds: vs.map((x) => x.v.id) });
        await audit(db, { c, user: currentUser(c), action: "risk.created_from_package", entityType: "risk", entityId: r!.id, details: { packageName, assets: assetMap.size, count: vs.length } });
        return c.json(await detail(c, r!.id), 201);
      })

      /** Kvantitativní přehled (FAIR): rizika s odhadem ztrát, portfolio a ochota nést riziko. */
      .get("/quant", requirePerm("risks:read"), async (c) => {
        const policy = (await settingsFor(db, c)).riskPolicy;
        const rows = await db.select().from(risks).where(and(inScope(c, risks.companyId), sql`${risks.quant} is not null`, sql`${risks.status} <> 'closed'`));
        const pol = await riskPolicies(db, await getSettings(db));
        const costs = rows.length
          ? await db
              .select({ riskId: riskTreatmentActions.riskId, cost: sql<number>`coalesce(sum(${riskTreatmentActions.costEstimate}),0)::float` })
              .from(riskTreatmentActions)
              .where(and(inArray(riskTreatmentActions.riskId, rows.map((r) => r.id)), sql`${riskTreatmentActions.status} <> 'cancelled'`))
              .groupBy(riskTreatmentActions.riskId)
          : [];
        const costBy = new Map(costs.map((x) => [x.riskId, Number(x.cost)]));
        const items = rows.map((r) => {
          const q = quantOf(r.id, r.quant, (pol.get(r.companyId) ?? policy).quant, costBy.get(r.id) ?? null)!;
          const s = scoreOf(pol.get(r.companyId) ?? policy, r);
          return {
            id: r.id,
            companyId: r.companyId,
            code: r.code,
            name: r.name,
            level: s.level,
            ale: q.inherent.mean,
            p95: q.inherent.p95,
            probAny: q.inherent.probAny,
            quantLevel: q.level,
            residualAle: q.residual?.mean ?? null,
            reduction: q.reduction,
            rosi: q.rosi,
            controlCostYear: q.controlCostYear,
          };
        });
        items.sort((a, b) => b.ale - a.ale);
        const qp = policy.quant;
        return c.json({
          policy: qp,
          items,
          portfolio: portfolio(rows.map((r) => ({ key: r.id, q: r.quant! })), qp),
          residualPortfolio: rows.some((r) => r.quant!.residualLef || r.quant!.residualLm) ? portfolio(rows.map((r) => ({ key: r.id, q: r.quant! })), qp, true) : null,
          unquantified: (await db.select({ n: sql<number>`count(*)::int` }).from(risks).where(and(inScope(c, risks.companyId), sql`${risks.quant} is null`, sql`${risks.status} <> 'closed'`)))[0]!.n,
        });
      })

      /** Návrh dopadu pro formulář (před uložením). */
      .post(
        "/suggest-impact",
        requirePerm("risks:read"),
        zValidator("json", z.object({ assetIds: z.array(z.string().uuid()).max(500), threatId: z.string().uuid().nullable().optional() })),
        async (c) => {
          const { assetIds, threatId } = c.req.valid("json");
          const [cia, t] = await Promise.all([
            assetIds.length
              ? db
                  .select({ confidentiality: assets.confidentiality, integrity: assets.integrity, availability: assets.availability })
                  .from(assets)
                  .where(inArray(assets.id, assetIds))
              : [],
            threatId ? db.select().from(riskCatalog).where(eq(riskCatalog.id, threatId)) : [],
          ]);
          const th = t[0];
          const levels = (await settingsFor(db, c)).riskPolicy.levels;
          const decree = suggestImpact(th ? { c: th.affectsC, i: th.affectsI, a: th.affectsA } : null, cia);
          return c.json({ suggestedImpact: fromDecreeLevel(decree, levels), decreeLevel: decree });
        },
      )

      /* ---------- plán zvládání rizik (§ 8 odst. 1 písm. g) ---------- */
      .get(
        "/plan",
        requirePerm("risks:read"),
        zValidator("query", z.object({ status: z.enum(ACTION_STATUSES).optional(), ownerPositionId: z.string().uuid().optional() })),
        async (c) => {
          const q = c.req.valid("query");
          const policy = await riskPolicies(db, await getSettings(db));
          const where = [inScope(c, risks.companyId)];
          if (q.status) where.push(eq(riskTreatmentActions.status, q.status));
          if (q.ownerPositionId) where.push(eq(riskTreatmentActions.ownerPositionId, q.ownerPositionId));
          return c.json(await loadActions(db, policy, where.length ? and(...where) : undefined));
        },
      )
      .post("/:id/actions", requirePerm("risks:read"), zValidator("json", TreatmentActionInput), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(risks).where(eq(risks.id, id));
        if (!cur) throw new HTTPException(404, { message: "Riziko nenalezeno" });
        assertScope(c, cur.companyId, "Riziko nenalezeno");
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "Plán zvládání upravuje vlastník rizika nebo správce rizik" });
        const input = c.req.valid("json");
        const [a] = await db
          .insert(riskTreatmentActions)
          .values({ ...input, riskId: id, completedAt: input.status === "done" ? new Date() : null })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "risk.action_created", entityType: "risk", entityId: id, details: { title: a!.title } });
        return c.json(a, 201);
      })
      /** Návrhy akcí plánu zvládání z dat (v1.20, ADR-117) – nic se nezakládá samo. */
      .get("/:id/plan-suggestions", requirePerm("risks:read"), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(risks).where(eq(risks.id, id));
        assertScope(c, cur?.companyId, "Riziko nenalezeno");
        return c.json(await planSuggestionsFor(id));
      })
      .post("/:id/plan-suggestions/apply", requirePerm("risks:read"), zValidator("json", PlanSuggestionApplyInput), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(risks).where(eq(risks.id, id));
        if (!cur) throw new HTTPException(404, { message: "Riziko nenalezeno" });
        assertScope(c, cur.companyId, "Riziko nenalezeno");
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "Plán zvládání upravuje vlastník rizika nebo správce rizik" });
        const v = c.req.valid("json");
        if (v.ownerPositionId) {
          const [pos] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, v.ownerPositionId));
          if (!pos) throw new HTTPException(400, { message: "Funkční místo nenalezeno" });
        }
        const picked = (await planSuggestionsFor(id)).filter((x) => v.keys.includes(x.key) && !x.existing);
        if (!picked.length) throw new HTTPException(409, { message: "Vybrané návrhy už v plánu jsou nebo neplatí." });
        const rows = await db
          .insert(riskTreatmentActions)
          .values(picked.map((x) => ({ riskId: id, controlId: x.controlId, title: x.title.slice(0, 500), objective: x.objective, ownerPositionId: v.ownerPositionId ?? cur.ownerPositionId ?? null, dueDate: v.dueDate ?? null, status: "planned" as const })))
          .returning({ id: riskTreatmentActions.id, title: riskTreatmentActions.title });
        for (const r of rows) await audit(db, { c, user: currentUser(c), action: "risk.action_created", entityType: "risk", entityId: id, details: { title: r.title, source: "plan_suggestion" } });
        return c.json({ created: rows.length }, 201);
      })
      .patch("/actions/:actionId", requirePerm("risks:read"), zValidator("json", TreatmentActionPatch), async (c) => {
        const actionId = c.req.param("actionId");
        const [row] = await db
          .select({ a: riskTreatmentActions, r: risks })
          .from(riskTreatmentActions)
          .innerJoin(risks, eq(risks.id, riskTreatmentActions.riskId))
          .where(eq(riskTreatmentActions.id, actionId));
        if (!row) throw new HTTPException(404, { message: "Akce nenalezena" });
        assertScope(c, row.r.companyId, "Akce nenalezena");
        if (!(await canEdit(c, row.r))) throw new HTTPException(403, { message: "Plán zvládání upravuje vlastník rizika nebo správce rizik" });
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<typeof riskTreatmentActions.$inferInsert>;
        if (input.status) input.completedAt = input.status === "done" ? (row.a.completedAt ?? new Date()) : null;
        const [a] = await db.update(riskTreatmentActions).set({ ...input, updatedAt: new Date() }).where(eq(riskTreatmentActions.id, actionId)).returning();
        await audit(db, { c, user: currentUser(c), action: "risk.action_updated", entityType: "risk", entityId: row.r.id, details: { actionId, ...input } });
        return c.json(a);
      })
      .delete("/actions/:actionId", requirePerm("risks:read"), async (c) => {
        const actionId = c.req.param("actionId");
        const [row] = await db
          .select({ a: riskTreatmentActions, r: risks })
          .from(riskTreatmentActions)
          .innerJoin(risks, eq(risks.id, riskTreatmentActions.riskId))
          .where(eq(riskTreatmentActions.id, actionId));
        if (!row) throw new HTTPException(404, { message: "Akce nenalezena" });
        assertScope(c, row.r.companyId, "Akce nenalezena");
        if (!(await canEdit(c, row.r))) throw new HTTPException(403, { message: "Plán zvládání upravuje vlastník rizika nebo správce rizik" });
        await db.delete(riskTreatmentActions).where(eq(riskTreatmentActions.id, actionId));
        await audit(db, { c, user: currentUser(c), action: "risk.action_deleted", entityType: "risk", entityId: row.r.id, details: { title: row.a.title } });
        return c.body(null, 204);
      })

      /* ---------- registr rizik ---------- */
      .get("/", requirePerm("risks:read"), zValidator("query", RiskListQuery), async (c) => {
        const q = c.req.valid("query");
        const policies = await riskPolicies(db, await getSettings(db));
        const where = [inScope(c, risks.companyId)];
        if (q.q) where.push(or(ilike(risks.name, `%${q.q}%`), ilike(risks.code, `%${q.q}%`))!);
        if (q.status) where.push(eq(risks.status, q.status));
        if (q.threatId) where.push(or(eq(risks.threatId, q.threatId), sql`exists (select 1 from risk_catalog_links l where l.risk_id = ${risks.id} and l.catalog_id = ${q.threatId})`)!);
        if (q.assetId) where.push(sql`exists (select 1 from risk_assets x where x.risk_id = ${risks.id} and x.asset_id = ${q.assetId})`);
        if (q.processId) where.push(sql`exists (select 1 from risk_processes x where x.risk_id = ${risks.id} and x.process_id = ${q.processId})`);
        const rows = await listRows(and(...where));
        const trig = await riskTriggers(db, rows.map((x) => x.r.id));
        let items = rows.map((x) => toListItem(policies.get(x.r.companyId)!, x, trig.get(x.r.id)?.length ?? 0));
        if (q.level) items = items.filter((i) => i.level === q.level);
        if (q.triggers) items = items.filter((i) => i.triggers > 0);
        // nejvyšší riziko nahoře
        items.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        return c.json({ items: items.slice(q.offset, q.offset + q.limit), total: items.length });
      })

      .post("/", requirePerm("risks:write"), zValidator("json", RiskInput), async (c) => {
        const { assetIds, processIds, cveIds, controlIds, companyId: requested, moreThreatIds, moreWeaknessIds, ...input } = c.req.valid("json");
        await assertCatalogKind(input.threatId, "threat");
        await assertCatalogKind(input.weaknessId, "weakness");
        await assertCatalogKind(moreThreatIds, "threat");
        await assertCatalogKind(moreWeaknessIds, "weakness");
        const companyId = targetCompany(c, requested, "risks:write");
        const policy = (await settingsFor(db, c, companyId)).riskPolicy;
        assertScale(input, policy);
        const scored = [...SCORE_FIELDS, ...FACTOR_FIELDS].some((k) => input[k] != null);
        const [r] = await db
          .insert(risks)
          .values({ ...input, companyId, scaleLevels: policy.levels, methodologyKey: policyMethod(policy), assessedAt: scored ? new Date() : null })
          .returning();
        await setLinks(r!.id, { assetIds, processIds, cveIds, controlIds });
        await setScenario(r!.id, "threat", moreThreatIds, r!.threatId);
        await setScenario(r!.id, "weakness", moreWeaknessIds, r!.weaknessId);
        await audit(db, { c, user: currentUser(c), action: "risk.created", entityType: "risk", entityId: r!.id, details: { name: r!.name } });
        return c.json(await detail(c, r!.id), 201);
      })

      .get("/:id", requirePerm("risks:read"), async (c) => c.json(await detail(c, c.req.param("id"))))

      /** Podněty k přehodnocení, návrh nových hodnot a historie rozhodnutí (ADR-058). */
      .get("/:id/reassessment", requirePerm("risks:read"), async (c) => {
        const id = c.req.param("id");
        const [r] = await db.select().from(risks).where(eq(risks.id, id));
        assertScope(c, r?.companyId, "Riziko nenalezeno");
        const policy = (await settingsFor(db, c, r!.companyId)).riskPolicy;
        const triggers = (await riskTriggers(db, [id])).get(id) ?? [];
        const builtin = r!.methodologyKey === BUILTIN_RISK_METHODOLOGY && policyMethod(policy) === BUILTIN_RISK_METHODOLOGY;
        const out: RiskReassessmentDto = {
          baseline: r!.status === "closed" ? null : riskBaseline(r!).toISOString(),
          triggers,
          due: triggerDue(triggers),
          suggestion: builtin ? suggestFromTriggers(r!, triggers, policy.method) : [],
          reviews: await loadReviews(id),
        };
        return c.json(out);
      })

      /** Vlastník rizika potvrzuje hodnocení beze změny se zdůvodněním – podněty se tím uzavřou. */
      .post("/:id/review", requirePerm("risks:read"), zValidator("json", RiskReviewInput), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(risks).where(eq(risks.id, id));
        assertScope(c, cur?.companyId, "Riziko nenalezeno");
        if (!(await canEdit(c, cur!))) throw new HTTPException(403, { message: "Riziko může upravovat jen vlastník nebo správce rizik" });
        if (cur!.status === "closed") throw new HTTPException(400, { message: "Uzavřené riziko se nepřehodnocuje" });
        const policy = (await settingsFor(db, c, cur!.companyId)).riskPolicy;
        const { note } = c.req.valid("json");
        const triggers = (await riskTriggers(db, [id])).get(id) ?? [];
        const s = scoreOf(policy, cur!);
        await writeReview(c, cur!, "confirmed", note, triggers, s, s);
        await db.update(risks).set({ reviewedAt: new Date() }).where(eq(risks.id, id));
        await markConfirmed(db, "risk", id, currentUser(c).id);
        await audit(db, { c, user: currentUser(c), action: "risk.reviewed", entityType: "risk", entityId: id, details: { decision: "confirmed", note, triggers: triggers.length } });
        return c.json(await detail(c, id));
      })

      .patch("/:id", requirePerm("risks:read"), zValidator("json", RiskPatch), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select().from(risks).where(eq(risks.id, id));
        if (!cur) throw new HTTPException(404, { message: "Riziko nenalezeno" });
        assertScope(c, cur.companyId, "Riziko nenalezeno");
        if (!(await canEdit(c, cur))) throw new HTTPException(403, { message: "Riziko může upravovat jen vlastník nebo správce rizik" });
        const { assetIds, processIds, cveIds, controlIds, reviewNote, moreThreatIds, moreWeaknessIds, ...rest } = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<RiskRow>;
        const policy = (await settingsFor(db, c, cur.companyId)).riskPolicy;
        assertScale(input, policy);
        // Změna hodnocení = nové hodnocení v aktuální stupnici metodiky (§ 8 odst. 1 písm. c).
        if (
          SCORE_FIELDS.some((k) => k in input && input[k] !== cur[k]) ||
          [...FACTOR_FIELDS, "quant" as const].some((k) => k in input && JSON.stringify(input[k] ?? null) !== JSON.stringify(cur[k] ?? null))
        ) {
          input.scaleLevels = policy.levels;
          input.methodologyKey = policyMethod(policy);
          input.assessedAt = new Date();
        }
        if (!hasPerm(c, "risks:write") && "ownerPositionId" in input)
          throw new HTTPException(403, { message: "Vlastníka rizika mění správce rizik" });
        await assertCatalogKind(input.threatId, "threat");
        await assertCatalogKind(input.weaknessId, "weakness");
        await assertCatalogKind(moreThreatIds, "threat");
        await assertCatalogKind(moreWeaknessIds, "weakness");
        // změna hodnocení = rozhodnutí o přehodnocení; podněty k tomuto okamžiku se uloží do historie (ADR-058)
        const triggers = input.assessedAt ? ((await riskTriggers(db, [id])).get(id) ?? []) : [];
        if (input.assessedAt) input.reviewedAt = input.assessedAt;
        if (Object.keys(input).length) await db.update(risks).set({ ...input, updatedAt: new Date() }).where(eq(risks.id, id));
        await setLinks(id, { assetIds, processIds, cveIds, controlIds });
        await setScenario(id, "threat", moreThreatIds, input.threatId !== undefined ? (input.threatId ?? null) : cur.threatId);
        await setScenario(id, "weakness", moreWeaknessIds, input.weaknessId !== undefined ? (input.weaknessId ?? null) : cur.weaknessId);
        if (input.assessedAt) {
          const [after] = await db.select().from(risks).where(eq(risks.id, id));
          await writeReview(c, cur, "changed", reviewNote || null, triggers, scoreOf(policy, cur), scoreOf(policy, after!));
          await markReassessed(db, "risk", id, currentUser(c).id);
        }
        await audit(db, {
          c,
          user: currentUser(c),
          action: "risk.updated",
          entityType: "risk",
          entityId: id,
          details: { ...input, ...(moreThreatIds && { moreThreatIds }), ...(moreWeaknessIds && { moreWeaknessIds }), ...(assetIds && { assetIds }), ...(processIds && { processIds }), ...(cveIds && { cveIds }), ...(controlIds && { controlIds }) },
        });
        return c.json(await detail(c, id));
      })

      .delete("/:id", requirePerm("risks:write"), async (c) => {
        const id = c.req.param("id");
        const [cur] = await db.select({ companyId: risks.companyId }).from(risks).where(eq(risks.id, id));
        assertScope(c, cur?.companyId, "Riziko nenalezeno");
        const [r] = await db.delete(risks).where(eq(risks.id, id)).returning({ name: risks.name });
        if (!r) throw new HTTPException(404, { message: "Riziko nenalezeno" });
        await audit(db, { c, user: currentUser(c), action: "risk.deleted", entityType: "risk", entityId: id, details: r });
        return c.body(null, 204);
      })
  );
}
