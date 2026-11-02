import {
  ASSET_GRAPH_MAX_NODES,
  AssetDependencyInput,
  assetLayer,
  effectiveCia,
  riskScore,
  type AssetDepKind,
  type AssetGraphDto,
  type AssetGraphEdge,
  type AssetGraphNode,
  type Criticality,
  type HealthStatus,
  analyzeResilience,
  type ResilienceDto,
  type ResilienceNode,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, riskPolicies, visibleIds } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { alertSuggestions, assetDependencies, assetLinks, assets, assetVulnerabilities, biaAssessments, continuityPlans, planAssets, planProcesses, processAssets, processes, riskAssets, risks, vulnIntel, type AssetRow } from "../../db/schema";
import { vulnPrioritySql } from "../vulnerabilities/intel";

/* ============================================================
 * Graf vazeb aktiv (ADR-063): uzly a hrany pro vizualizaci, překryvy podle oprávnění,
 * technické závislosti mezi aktivy (zápis jen zde). Počítá se při čtení.
 * ============================================================ */

type Ctx = Context<AppEnv>;
const LEVEL_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function assetGraphRoutes(db: Db) {
  async function loadAsset(c: Ctx, id: string) {
    const [a] = await db.select().from(assets).where(eq(assets.id, id));
    if (!a || !(await visibleIds(db, c)).includes(a.companyId)) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
    return a;
  }
  const canEdit = (c: Ctx, a: Pick<AssetRow, "ownerUserId">) => hasPerm(c, "assets:write") || (hasPerm(c, "assets:write_own") && a.ownerUserId === currentUser(c).id);

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "assets"))
    .get(
      "/graph",
      requirePerm("assets:read"),
      zValidator("query", z.object({ retired: z.enum(["0", "1"]).default("0"), processes: z.enum(["0", "1"]).default("1") })),
      async (c) => {
        const q = c.req.valid("query");
        const vis = await visibleIds(db, c);
        const rows = await db
          .select()
          .from(assets)
          .where(and(inArray(assets.companyId, vis.length ? vis : ["00000000-0000-0000-0000-000000000000"]), q.retired === "1" ? undefined : notInArray(assets.lifecycleStatus, ["retired", "disposed"])))
          .orderBy(assets.name)
          .limit(ASSET_GRAPH_MAX_NODES + 1);
        const truncated = rows.length > ASSET_GRAPH_MAX_NODES;
        const list = rows.slice(0, ASSET_GRAPH_MAX_NODES);
        const ids = list.map((a) => a.id);
        const base = await getSettings(db);
        const mods = base.enabledModules as string[];
        const can = (perm: string, mod: string) => mods.includes(mod) && vis.some((id) => hasPermIn(c, perm as never, id));
        const overlays = { vulns: true, alerts: can("soc:read", "soc"), risks: can("risks:read", "risks"), processes: q.processes === "1" && can("processes:read", "processes") };
        const none = sql`false`;
        const inIds = (col: AnyPgColumn) => (ids.length ? inArray(col, ids) : none);

        const [links, deps, vulnRows, alertRows, riskRows, procRows] = await Promise.all([
          db.select().from(assetLinks).where(and(inIds(assetLinks.primaryId), inIds(assetLinks.supportingId))),
          db.select().from(assetDependencies).where(and(inIds(assetDependencies.fromId), inIds(assetDependencies.toId))),
          db
            .select({
              assetId: assetVulnerabilities.assetId,
              critical: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'critical')::int`,
              high: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'high')::int`,
              p1: sql<number>`count(*) filter (where ${vulnPrioritySql} = 1)::int`,
            })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
            .where(and(inIds(assetVulnerabilities.assetId), eq(assetVulnerabilities.status, "open")))
            .groupBy(assetVulnerabilities.assetId),
          overlays.alerts
            ? db
                .select({ assetId: alertSuggestions.assetId, companyId: alertSuggestions.companyId, n: sql<number>`count(*)::int` })
                .from(alertSuggestions)
                .where(and(inIds(alertSuggestions.assetId), inArray(alertSuggestions.status, ["new", "in_progress"])))
                .groupBy(alertSuggestions.assetId, alertSuggestions.companyId)
            : Promise.resolve([]),
          overlays.risks ? db.select({ assetId: riskAssets.assetId, r: risks }).from(riskAssets).innerJoin(risks, eq(risks.id, riskAssets.riskId)).where(and(inIds(riskAssets.assetId), sql`${risks.status} <> 'closed'`)) : Promise.resolve([]),
          overlays.processes
            ? db
                .selectDistinct({ processId: processes.id, code: processes.code, name: processes.name, companyId: processes.companyId, assetId: processAssets.assetId })
                .from(processAssets)
                .innerJoin(processes, eq(processes.id, processAssets.processId))
                .where(inIds(processAssets.assetId))
            : Promise.resolve([]),
        ]);

        const byId = new Map(list.map((a) => [a.id, a]));
        const primariesOf = new Map<string, AssetRow[]>();
        for (const l of links) primariesOf.set(l.supportingId, [...(primariesOf.get(l.supportingId) ?? []), byId.get(l.primaryId)!]);
        const vulns = new Map(vulnRows.map((v) => [v.assetId, v]));
        const alerts = new Map<string, number>();
        for (const a of alertRows) if (a.assetId && hasPermIn(c, "soc:read", a.companyId)) alerts.set(a.assetId, (alerts.get(a.assetId) ?? 0) + a.n);
        const policies = overlays.risks ? await riskPolicies(db, base) : new Map();
        const riskAgg = new Map<string, { count: number; level: string | null }>();
        for (const { assetId, r } of riskRows) {
          if (!hasPermIn(c, "risks:read", r.companyId)) continue;
          let level: string | null = null;
          try {
            const pol = policies.get(r.companyId);
            level = pol ? riskScore(pol, r, r.scaleLevels).level : null;
          } catch {
            level = null;
          }
          const cur = riskAgg.get(assetId) ?? { count: 0, level: null };
          cur.count++;
          if (level && (LEVEL_RANK[level] ?? 0) > (LEVEL_RANK[cur.level ?? ""] ?? 0)) cur.level = level;
          riskAgg.set(assetId, cur);
        }

        const nodes: AssetGraphNode[] = list.map((a) => {
          const eff = effectiveCia(a, primariesOf.get(a.id) ?? []);
          const v = vulns.get(a.id);
          return {
            id: a.id,
            kind: "asset",
            name: a.name,
            layer: assetLayer(a.assetType, a.assetClass),
            companyId: a.companyId,
            assetType: a.assetType,
            assetClass: a.assetClass,
            criticality: a.criticality as Criticality,
            healthStatus: a.healthStatus as HealthStatus,
            cia: { c: eff.confidentiality, i: eff.integrity, a: eff.availability },
            vulns: { critical: v?.critical ?? 0, high: v?.high ?? 0, p1: v?.p1 ?? 0 },
            alerts: overlays.alerts ? (alerts.get(a.id) ?? 0) : null,
            risks: overlays.risks ? (riskAgg.get(a.id) ?? { count: 0, level: null }) : null,
          };
        });
        const edges: AssetGraphEdge[] = [
          ...links.map((l) => ({ from: l.primaryId, to: l.supportingId, kind: "supports" as const, depKind: null, note: l.note })),
          ...deps.map((d) => ({ from: d.fromId, to: d.toId, kind: "depends" as const, depKind: d.kind as AssetDepKind, note: d.note })),
        ];
        const seenProc = new Set<string>();
        for (const p of procRows) {
          if (!hasPermIn(c, "processes:read", p.companyId)) continue;
          if (!seenProc.has(p.processId)) {
            seenProc.add(p.processId);
            nodes.push({ id: p.processId, kind: "process", name: `${p.code ? `${p.code} ` : ""}${p.name}`, layer: "process", companyId: p.companyId, assetType: null, assetClass: null, criticality: null, healthStatus: null, cia: null, vulns: null, alerts: null, risks: null });
          }
          edges.push({ from: p.processId, to: p.assetId, kind: "process", depKind: null, note: null });
        }
        const out: AssetGraphDto = { nodes, edges, overlays, truncated };
        return c.json(out);
      },
    )
    /** Analýza odolnosti (ADR-065): požadavky z BIA po grafu, jednotlivé body selhání a mezery v kontinuitě. */
    .get("/resilience", requirePerm("assets:read"), async (c) => c.json(await resilienceFor(db, c)))
    /** Aktiva, na kterých proces (tranzitivně) závisí, s nálezy – pro BIA. */
    .get("/resilience/process/:processId", requirePerm("assets:read", "bia:read"), async (c) => {
      const pid = c.req.param("processId");
      const r = await resilienceFor(db, c, pid);
      const assetsOf = new Set(r.requirements.filter((x) => x.processes.some((p) => p.id === pid)).map((x) => x.assetId));
      return c.json({ ...r, requirements: r.requirements.filter((x) => assetsOf.has(x.assetId)), findings: r.findings.filter((f) => assetsOf.has(f.nodeId) || f.nodeId === pid) });
    })
    /** Technická závislost: `fromId` závisí na `toId`. */
    .post("/dependencies", requirePerm("assets:write", "assets:write_own"), zValidator("json", AssetDependencyInput), async (c) => {
      const { fromId, toId, kind, note } = c.req.valid("json");
      if (fromId === toId) throw new HTTPException(400, { message: "Aktivum nemůže záviset samo na sobě" });
      const [f, t] = await Promise.all([loadAsset(c, fromId), loadAsset(c, toId)]);
      if (!canEdit(c, f) && !canEdit(c, t)) throw new HTTPException(403, { message: "Nemáte oprávnění upravovat toto aktivum" });
      const [back] = await db.select({ n: sql<number>`count(*)::int` }).from(assetDependencies).where(and(eq(assetDependencies.fromId, toId), eq(assetDependencies.toId, fromId)));
      if (back!.n) throw new HTTPException(400, { message: "Opačná závislost už existuje" });
      await db
        .insert(assetDependencies)
        .values({ fromId, toId, kind, note: note ?? null })
        .onConflictDoUpdate({ target: [assetDependencies.fromId, assetDependencies.toId], set: { kind, note: note ?? null } });
      await audit(db, { c, user: currentUser(c), action: "asset.dependency_added", entityType: "asset", entityId: fromId, details: { toId, toName: t.name, kind } });
      return c.json({ ok: true }, 201);
    })
    .delete("/dependencies", requirePerm("assets:write", "assets:write_own"), zValidator("query", z.object({ fromId: z.string().uuid(), toId: z.string().uuid() })), async (c) => {
      const { fromId, toId } = c.req.valid("query");
      const [f, t] = await Promise.all([loadAsset(c, fromId), loadAsset(c, toId)]);
      if (!canEdit(c, f) && !canEdit(c, t)) throw new HTTPException(403, { message: "Nemáte oprávnění upravovat toto aktivum" });
      await db.delete(assetDependencies).where(and(eq(assetDependencies.fromId, fromId), eq(assetDependencies.toId, toId)));
      await audit(db, { c, user: currentUser(c), action: "asset.dependency_removed", entityType: "asset", entityId: fromId, details: { toId } });
      return c.body(null, 204);
    });
}

/** Vstupy a výpočet analýzy odolnosti pro viditelné společnosti. */
export async function resilienceFor(db: Db, c: Ctx, onlyProcessId?: string): Promise<ResilienceDto> {
  const vis = await visibleIds(db, c);
  const ids0 = vis.length ? vis : ["00000000-0000-0000-0000-000000000000"];
  const base = await getSettings(db);
  const mods = base.enabledModules as string[];
  const biaOk = mods.includes("continuity") && mods.includes("processes");
  const list = await db.select().from(assets).where(and(inArray(assets.companyId, ids0), notInArray(assets.lifecycleStatus, ["retired", "disposed"]))).limit(ASSET_GRAPH_MAX_NODES);
  const ids = list.map((a) => a.id);
  const none = sql`false`;
  const inIds = (col: AnyPgColumn) => (ids.length ? inArray(col, ids) : none);
  const [links, deps, p1Rows, procRows, biaRows, planAssetRows, planProcRows] = await Promise.all([
    db.select({ from: assetLinks.primaryId, to: assetLinks.supportingId }).from(assetLinks).where(and(inIds(assetLinks.primaryId), inIds(assetLinks.supportingId))),
    db.select({ from: assetDependencies.fromId, to: assetDependencies.toId }).from(assetDependencies).where(and(inIds(assetDependencies.fromId), inIds(assetDependencies.toId))),
    db
      .select({ assetId: assetVulnerabilities.assetId, n: sql<number>`count(*)::int` })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(inIds(assetVulnerabilities.assetId), eq(assetVulnerabilities.status, "open"), sql`${vulnPrioritySql} = 1`))
      .groupBy(assetVulnerabilities.assetId),
    biaOk
      ? db.selectDistinct({ processId: processes.id, code: processes.code, name: processes.name, companyId: processes.companyId, assetId: processAssets.assetId }).from(processes).leftJoin(processAssets, eq(processAssets.processId, processes.id)).where(inArray(processes.companyId, ids0))
      : Promise.resolve([]),
    biaOk ? db.select({ processId: biaAssessments.processId, companyId: biaAssessments.companyId, rto: biaAssessments.rtoHours, rpo: biaAssessments.rpoHours }).from(biaAssessments).where(inArray(biaAssessments.companyId, ids0)) : Promise.resolve([]),
    biaOk ? db.select({ assetId: planAssets.assetId, rto: continuityPlans.rtoTargetHours }).from(planAssets).innerJoin(continuityPlans, eq(continuityPlans.id, planAssets.planId)).where(inIds(planAssets.assetId)) : Promise.resolve([]),
    biaOk ? db.select({ processId: planProcesses.processId, rto: continuityPlans.rtoTargetHours }).from(planProcesses).innerJoin(continuityPlans, eq(continuityPlans.id, planProcesses.planId)).where(inArray(continuityPlans.companyId, ids0)) : Promise.resolve([]),
  ]);
  const p1 = new Map(p1Rows.map((r) => [r.assetId, r.n]));
  const canBia = (companyId: string) => hasPermIn(c, "bia:read", companyId) && hasPermIn(c, "processes:read", companyId);
  const bia = new Map<string, { rtoHours: number | null; rpoHours: number | null }>();
  for (const b of biaRows) if (canBia(b.companyId) && (!onlyProcessId || b.processId === onlyProcessId)) bia.set(b.processId, { rtoHours: b.rto, rpoHours: b.rpo });
  const nodes: ResilienceNode[] = list.map((a) => ({ id: a.id, kind: "asset", name: a.name, criticality: a.criticality as Criticality, redundant: a.redundant, health: a.healthStatus, p1: p1.get(a.id) ?? 0 }));
  const edges = [...links, ...deps];
  const procIds = new Set<string>();
  for (const p of procRows) {
    if (!canBia(p.companyId) || !bia.has(p.processId)) continue;
    if (!procIds.has(p.processId)) {
      procIds.add(p.processId);
      nodes.push({ id: p.processId, kind: "process", name: `${p.code ? `${p.code} ` : ""}${p.name}`, criticality: null, redundant: false, health: null, p1: 0 });
    }
    if (p.assetId && ids.includes(p.assetId)) edges.push({ from: p.processId, to: p.assetId });
  }
  // pokrytí plánem: přímo aktivum, nebo proces, který na aktivu závisí (plán procesu kryje i jeho aktiva)
  const plans = new Map<string, number | null>();
  const setPlan = (assetId: string, rto: number | null) => {
    if (!plans.has(assetId)) plans.set(assetId, rto);
    else {
      const cur = plans.get(assetId)!;
      plans.set(assetId, cur == null ? rto : rto == null ? cur : Math.min(cur, rto));
    }
  };
  for (const r of planAssetRows) setPlan(r.assetId, r.rto);
  const procPlan = new Map<string, number | null>();
  for (const r of planProcRows) procPlan.set(r.processId, procPlan.has(r.processId) ? (r.rto == null ? procPlan.get(r.processId)! : Math.min(procPlan.get(r.processId) ?? r.rto, r.rto)) : r.rto);
  if (procPlan.size) {
    const outE = new Map<string, string[]>();
    for (const e of edges) outE.set(e.from, [...(outE.get(e.from) ?? []), e.to]);
    for (const [pid, rto] of procPlan) {
      const seen = new Set<string>();
      const q = [...(outE.get(pid) ?? [])];
      while (q.length) {
        const x = q.shift()!;
        if (seen.has(x)) continue;
        seen.add(x);
        q.push(...(outE.get(x) ?? []));
        if (ids.includes(x)) setPlan(x, rto);
      }
    }
  }
  return analyzeResilience({ nodes, edges, bia, plans });
}

/** Závislosti aktiva pro detail (na čem závisí / co závisí na něm). */
export async function dependenciesOf(db: Db, id: string) {
  const cols = (col: typeof assets.id) => ({ id: col, name: assets.name, assetType: assets.assetType, kind: assetDependencies.kind, note: assetDependencies.note });
  const [dependsOn, dependedBy] = await Promise.all([
    db.select(cols(assets.id)).from(assetDependencies).innerJoin(assets, eq(assets.id, assetDependencies.toId)).where(eq(assetDependencies.fromId, id)).orderBy(assets.name),
    db.select(cols(assets.id)).from(assetDependencies).innerJoin(assets, eq(assets.id, assetDependencies.fromId)).where(eq(assetDependencies.toId, id)).orderBy(assets.name),
  ]);
  return { dependsOn, dependedBy };
}

