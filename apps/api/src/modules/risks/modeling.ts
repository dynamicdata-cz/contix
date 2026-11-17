import { findingsOtherSql, findingsSeriousSql } from "../controls/findings";
import {
  AttackPathDecisionInput,
  CalibrationApplyInput,
  IDENTITY_NODE,
  SCENARIO_TEMPLATES,
  STRIDE_CATALOG,
  TM_LABELS,
  ThreatModelInput,
  ThreatModelPatch,
  ThreatProfileInput,
  attackPaths,
  calibrateRisk,
  evidencedEffectiveness,
  attackTechnique,
  sectorDelta,
  seedElements,
  segmentOf,
  strideThreats,
  suggestMtpd,
  threatModelSummary,
  modelingSteps,
  readinessItems,
  type ModelingOverviewDto,
  type AttackPathDto,
  type AttackPathsDto,
  type CalibrationDto,
  type CalibrationInput,
  type PathEdge,
  type PathNode,
  type ThreatLandscapeDto,
  type ThreatModelDto,
  type TmElement,
  type TmThreat,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, inScope, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  activityAssets,
  activityProcesses,
  alertSuggestions,
  assetSources,
  identityAccounts,
  assetDependencies,
  assetLinks,
  assetVulnerabilities,
  assets,
  attackPathDecisions,
  biaAssessments,
  controls,
  incidentAssets,
  incidentRisks,
  incidents,
  netSegments,
  processAssets,
  processes,
  processingActivities,
  projects,
  riskAssets,
  riskCatalog,
  riskControls,
  riskProcesses,
  risks,
  threatModels,
  threatProfiles,
  users,
  vulnIntel,
} from "../../db/schema";
import { docxResponse, htmlToDocx } from "../documents/docx";
import type { Dispatch } from "../import/routes";
import { threatLandscape } from "./landscape";
import { capabilityDtos, detectionFor, measureCompany } from "./scenarios";

/* ============================================================
 * Modelování hrozeb podle reality prostředí (v1.40, ADR-137) – útočné cesty, kalibrace, aktéři, threat modely.
 * Výpočty jen čtou data CONTIXu; riziko vzniká jen na pokyn člověka přes POST /api/risks (stejné validace a audit),
 * kalibrace se použije jen na pokyn přes PATCH /api/risks/:id se zdůvodněním (historie přehodnocení, ADR-058).
 * ============================================================ */

type Ctx = Context<AppEnv>;
const day = 86_400_000;
const NONE = ["00000000-0000-0000-0000-000000000000"];
const ids = (l: string[]) => (l.length ? l : NONE);
const clamp = (v: number, n: number) => Math.min(n, Math.max(1, Math.round(v)));
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Otevřené zranitelnosti po aktivech (KEV / kritické / vysoké). */
async function vulnCounts(db: Db, assetIds: string[]) {
  if (!assetIds.length) return new Map<string, { kev: number; critical: number; high: number }>();
  const rows = await db
    .select({
      assetId: assetVulnerabilities.assetId,
      kev: sql<number>`count(*) filter (where coalesce(${vulnIntel.kev}, false))::int`,
      critical: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'critical')::int`,
      high: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'high')::int`,
    })
    .from(assetVulnerabilities)
    .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
    .where(and(inArray(assetVulnerabilities.assetId, assetIds), eq(assetVulnerabilities.status, "open")))
    .groupBy(assetVulnerabilities.assetId);
  return new Map(rows.map((r) => [r.assetId, r]));
}

/* ---------- kalibrace ---------- */

type CalBase = Omit<CalibrationInput, "levels" | "sectorDelta" | "sectorActors">;

/** Podklady kalibrace pro skupiny aktiv / procesů (klíč = riziko nebo cíl cesty) – dávkově. */
export async function calibrationInputs(db: Db, companyId: string, groups: Map<string, { assetIds: string[]; processIds: string[]; riskId?: string }>, now = new Date()): Promise<Map<string, CalBase>> {
  const allAssets = [...new Set([...groups.values()].flatMap((g) => g.assetIds))];
  const aRows = allAssets.length
    ? await db.select({ id: assets.id, c: assets.confidentiality, i: assets.integrity, a: assets.availability, crit: assets.criticality, internet: assets.internetFacing }).from(assets).where(inArray(assets.id, allAssets))
    : [];
  const aById = new Map(aRows.map((a) => [a.id, a]));
  const pa = allAssets.length ? await db.select({ assetId: processAssets.assetId, processId: processAssets.processId }).from(processAssets).where(inArray(processAssets.assetId, allAssets)) : [];
  const procOf = (g: { assetIds: string[]; processIds: string[] }) => [...new Set([...g.processIds, ...pa.filter((x) => g.assetIds.includes(x.assetId)).map((x) => x.processId)])];
  const allProc = [...new Set([...groups.values()].flatMap(procOf))];
  const bia = allProc.length
    ? await db
        .select({ processId: biaAssessments.processId, name: processes.name, mtpd: biaAssessments.mtpdHours, impacts: biaAssessments.impacts })
        .from(biaAssessments)
        .innerJoin(processes, eq(processes.id, biaAssessments.processId))
        .where(inArray(biaAssessments.processId, allProc))
    : [];
  const maxOf = (o: Record<string, number> | undefined) => {
    const v = Object.values(o ?? {}).filter((x) => typeof x === "number");
    return v.length ? Math.max(...v) : null;
  };
  // osobní údaje: záznamy o zpracování navázané na aktiva / procesy
  const actA = allAssets.length ? await db.select({ t: activityAssets.targetId, special: processingActivities.specialCategories }).from(activityAssets).innerJoin(processingActivities, eq(processingActivities.id, activityAssets.activityId)).where(inArray(activityAssets.targetId, allAssets)) : [];
  const actP = allProc.length ? await db.select({ t: activityProcesses.targetId, special: processingActivities.specialCategories }).from(activityProcesses).innerJoin(processingActivities, eq(processingActivities.id, activityProcesses.activityId)).where(inArray(activityProcesses.targetId, allProc)) : [];
  // incidenty za 12 měsíců
  const since = new Date(now.getTime() - 365 * day);
  const incCols = { id: incidents.id, kind: incidents.kind, tol: incidents.toleranceExceeded, auth: incidents.authorityDecision, down: incidents.downtimeHours, loss: incidents.financialLoss };
  const incA = allAssets.length ? await db.select({ ...incCols, t: incidentAssets.targetId }).from(incidentAssets).innerJoin(incidents, eq(incidents.id, incidentAssets.incidentId)).where(and(inArray(incidentAssets.targetId, allAssets), gte(incidents.detectedAt, since))) : [];
  const riskIds = [...groups.values()].map((g) => g.riskId).filter((x): x is string => !!x);
  const incR = riskIds.length ? await db.select({ ...incCols, t: incidentRisks.targetId }).from(incidentRisks).innerJoin(incidents, eq(incidents.id, incidentRisks.incidentId)).where(and(inArray(incidentRisks.targetId, riskIds), gte(incidents.detectedAt, since))) : [];
  // alerty SOC za 90 dní na aktivech
  const al = allAssets.length
    ? await db
        .select({ assetId: alertSuggestions.assetId, n: sql<number>`count(*)::int` })
        .from(alertSuggestions)
        .where(and(eq(alertSuggestions.companyId, companyId), inArray(alertSuggestions.assetId, allAssets), gte(alertSuggestions.lastSeen, new Date(now.getTime() - 90 * day)), ne(alertSuggestions.status, "dismissed"), or(isNull(alertSuggestions.verdict), ne(alertSuggestions.verdict, "false_positive"))))
        .groupBy(alertSuggestions.assetId)
    : [];
  const vc = await vulnCounts(db, allAssets);
  // opatření rizika s důkazy účinnosti (ADR-117)
  const ctl = riskIds.length
    ? await db
        .select({
          riskId: riskControls.riskId,
          code: controls.code,
          name: controls.name,
          status: controls.status,
          effectiveness: controls.effectiveness,
          lastTestResult: sql<string | null>`(select t.result from control_tests t where t.control_id = ${controls.id} and t.status = 'completed' and t.result is not null order by t.performed_at desc nulls last, t.updated_at desc limit 1)`,
          monitorFailing: sql<boolean>`exists (select 1 from control_monitors m where m.control_id = ${controls.id} and m.enabled and m.last_result = 'fail')`,
  findingsSerious: findingsSeriousSql(controls.id),
  findingsOther: findingsOtherSql(controls.id),
        })
        .from(riskControls)
        .innerJoin(controls, eq(controls.id, riskControls.controlId))
        .where(inArray(riskControls.riskId, riskIds))
    : [];
  const out = new Map<string, CalBase>();
  for (const [key, g] of groups) {
    const procs = procOf(g);
    const as = g.assetIds.map((id) => aById.get(id)).filter((a): a is NonNullable<typeof a> => !!a);
    const ciaMax = (k: "c" | "i" | "a") => {
      const v = as.map((a) => a[k]).filter((x): x is number => x != null);
      return v.length ? Math.max(...v) : null;
    };
    const crits = as.map((a) => a.crit);
    const crit = (["critical", "high", "medium", "low"] as const).find((c) => crits.includes(c)) ?? null;
    const acts = [...actA.filter((x) => g.assetIds.includes(x.t)), ...actP.filter((x) => procs.includes(x.t))];
    const inc = new Map<string, (typeof incA)[number]>();
    for (const x of [...incA.filter((y) => g.assetIds.includes(y.t)), ...incR.filter((y) => y.t === g.riskId)]) inc.set(x.id, x);
    const incList = [...inc.values()].filter((x) => x.kind !== "event");
    const v = g.assetIds.map((id) => vc.get(id)).filter(Boolean) as { kev: number; critical: number; high: number }[];
    const cl = ctl.filter((x) => x.riskId === g.riskId && x.status === "implemented").map((x) => evidencedEffectiveness(x).effectiveness);
    out.set(key, {
      cia: as.length ? { c: ciaMax("c"), i: ciaMax("i"), a: ciaMax("a") } : null,
      criticality: crit,
      bia: bia.filter((b) => procs.includes(b.processId)).map((b) => ({ process: b.name, mtpdHours: b.mtpd ?? suggestMtpd(b.impacts ?? {}), maxImpact: maxOf(Object.fromEntries(Object.entries(b.impacts ?? {}).flatMap(([area, o]) => Object.entries(o ?? {}).map(([tp, val]) => [`${area}:${tp}`, val])))), financial: maxOf(b.impacts?.financial) })),
      personalData: { any: acts.length > 0, special: acts.some((x) => (x.special ?? []).length > 0) },
      incidents: {
        total: incList.length,
        significant: incList.filter((x) => x.tol || x.auth === "significant").length,
        downtimeHours: incList.reduce((s, x) => s + (x.down ?? 0), 0),
        financialLoss: incList.reduce((s, x) => s + (x.loss ?? 0), 0),
      },
      alerts: al.filter((x) => x.assetId && g.assetIds.includes(x.assetId)).reduce((s, x) => s + x.n, 0),
      exposure: { internet: as.some((a) => a.internet), kev: v.reduce((s, x) => s + x.kev, 0), critical: v.reduce((s, x) => s + x.critical, 0) },
      controls: { total: cl.length, effective: cl.filter((e) => e === "effective").length, partial: cl.filter((e) => e === "partially_effective").length, ineffective: cl.filter((e) => e === "ineffective").length },
    });
  }
  return out;
}

/** Techniky ATT&CK šablon scénářů s danou hrozbou katalogu (pro váhu aktérů u rizika). */
const techniquesOfThreat = (code: string | null) => (code ? [...new Set(SCENARIO_TEMPLATES.filter((t) => t.threat === code || t.moreThreats.includes(code)).flatMap((t) => t.attack))] : []);

export async function calibrationFor(db: Db, companyId: string, land: ThreatLandscapeDto, riskId?: string, now = new Date()): Promise<CalibrationDto[]> {
  const policy = (await settingsFor(db, null, companyId)).riskPolicy;
  const levels = policy.levels;
  const rs = await db
    .select({ r: risks, threatCode: riskCatalog.code })
    .from(risks)
    .leftJoin(riskCatalog, eq(riskCatalog.id, risks.threatId))
    .where(and(eq(risks.companyId, companyId), ne(risks.status, "closed"), riskId ? eq(risks.id, riskId) : undefined))
    .orderBy(risks.code, risks.name)
    .limit(500);
  if (!rs.length) return [];
  const rIds = rs.map((x) => x.r.id);
  const ra = await db.select({ riskId: riskAssets.riskId, assetId: riskAssets.assetId }).from(riskAssets).where(inArray(riskAssets.riskId, rIds));
  const rp = await db.select({ riskId: riskProcesses.riskId, processId: riskProcesses.processId }).from(riskProcesses).where(inArray(riskProcesses.riskId, rIds));
  const groups = new Map(rs.map(({ r }) => [r.id, { riskId: r.id, assetIds: ra.filter((x) => x.riskId === r.id).map((x) => x.assetId), processIds: rp.filter((x) => x.riskId === r.id).map((x) => x.processId) }]));
  const inputs = await calibrationInputs(db, companyId, groups, now);
  const builtin = policy.methodology === "zkb409" || !policy.methodology;
  return rs.map(({ r, threatCode }) => {
    const sec = sectorDelta(techniquesOfThreat(threatCode), land.actors, !!land.sector);
    const proposed = calibrateRisk({ ...inputs.get(r.id)!, levels, sectorDelta: sec.delta, sectorActors: sec.actors });
    const curL = r.likelihood ?? (r.threatLevel != null && r.vulnLevel != null ? Math.round((r.threatLevel + r.vulnLevel) / 2) : null);
    const outdated = !builtin || r.methodologyKey !== "zkb409" || r.scaleLevels !== levels;
    return {
      riskId: r.id,
      riskCode: r.code,
      riskName: r.name,
      companyId: r.companyId,
      levels,
      method: policy.method,
      current: { impact: r.impact, threatLevel: r.threatLevel, vulnLevel: r.vulnLevel, likelihood: curL },
      proposed,
      drift: { impact: r.impact == null ? null : proposed.impact - r.impact, likelihood: curL == null ? null : proposed.likelihood - curL },
      outdated,
    };
  });
}

/* ---------- postup a připravenost dat (v1.41) ---------- */

const n0 = (r: { n: number }[] | undefined) => Number(r?.[0]?.n ?? 0);

/** Přehled postupu: připravenost dat, stav kroků a počty k rozhodnutí – jen čtení. */
export async function modelingOverview(db: Db, companyId: string, now = new Date()): Promise<ModelingOverviewDto> {
  const active = and(eq(assets.companyId, companyId), inArray(assets.lifecycleStatus, ["active", "maintenance"]));
  const cnt = sql<number>`count(*)::int`;
  const crown = n0(await db.select({ n: cnt }).from(assets).where(and(active, eq(assets.assetClass, "primary"), sql`(${assets.criticality} in ('high','critical') or greatest(coalesce(${assets.confidentiality},0), coalesce(${assets.integrity},0), coalesce(${assets.availability},0)) >= 3)`)));
  const internet = n0(await db.select({ n: cnt }).from(assets).where(and(active, eq(assets.internetFacing, true))));
  const supporting = n0(await db.select({ n: cnt }).from(assets).where(and(active, ne(assets.assetClass, "primary"))));
  const linked = n0(
    await db
      .select({ n: cnt })
      .from(assets)
      .where(
        and(
          active,
          ne(assets.assetClass, "primary"),
          sql`(exists (select 1 from asset_dependencies d where d.from_id = ${assets.id} or d.to_id = ${assets.id}) or exists (select 1 from asset_links l where l.supporting_id = ${assets.id}))`,
        ),
      ),
  );
  const segments = n0(await db.select({ n: cnt }).from(netSegments).where(and(eq(netSegments.companyId, companyId), eq(netSegments.enabled, true))));
  const vulnData = n0(await db.select({ n: cnt }).from(assetVulnerabilities).innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId)).where(eq(assets.companyId, companyId))) > 0;
  const ident = n0(await db.select({ n: cnt }).from(identityAccounts).where(and(eq(identityAccounts.companyId, companyId), isNull(identityAccounts.removedAt))));
  const edr = n0(await db.select({ n: cnt }).from(assetSources).innerJoin(assets, eq(assets.id, assetSources.assetId)).where(and(eq(assets.companyId, companyId), eq(assetSources.sourceType, "wazuh")))) > 0;
  const procRows = await db
    .selectDistinct({ id: processAssets.processId, bia: sql<boolean>`exists (select 1 from bia_assessments b where b.process_id = ${processAssets.processId} and (b.mtpd_hours is not null or b.impacts <> '{}'::jsonb))` })
    .from(processAssets)
    .innerJoin(assets, eq(assets.id, processAssets.assetId))
    .where(and(active, eq(assets.assetClass, "primary")));
  const yearAgo = new Date(now.getTime() - 365 * day).toISOString().slice(0, 10);
  const ctl = await db
    .select({
      id: controls.id,
      ev: sql<boolean>`(exists (select 1 from control_tests t where t.control_id = ${controls.id} and t.status = 'completed' and t.performed_at >= ${yearAgo}::date) or exists (select 1 from control_monitors m where m.control_id = ${controls.id} and m.enabled))`,
    })
    .from(controls)
    .where(and(eq(controls.companyId, companyId), eq(controls.status, "implemented")));
  const readiness = readinessItems({
    crownJewels: crown,
    internetFacing: internet,
    supporting,
    supportingLinked: linked,
    segments,
    vulnData,
    identityAccounts: ident,
    edrMeasured: edr,
    primaryProcesses: new Set(procRows.map((p) => p.id)).size,
    primaryProcessesWithBia: new Set(procRows.filter((p) => p.bia).map((p) => p.id)).size,
    controlsImplemented: ctl.length,
    controlsEvidenced: ctl.filter((x) => x.ev).length,
  });
  const paths = await attackPathsFor(db, companyId, now);
  const land = await threatLandscape(db, companyId, await detectionFor(db, companyId, now), now);
  const cal = await calibrationFor(db, companyId, land, undefined, now);
  const models = await db.select({ threats: threatModels.threats, status: threatModels.status }).from(threatModels).where(eq(threatModels.companyId, companyId));
  const counts = {
    paths: paths.paths.length,
    pathsOpen: paths.paths.filter((p) => !p.decision).length,
    drift: cal.filter((c) => !c.outdated && c.drift.impact != null && c.drift.likelihood != null && (c.drift.impact !== 0 || c.drift.likelihood !== 0)).length,
    unrated: cal.filter((c) => !c.outdated && (c.drift.impact == null || c.drift.likelihood == null)).length,
    models: models.length,
    openThreats: models.filter((m) => m.status !== "done").reduce((s, m) => s + (m.threats as TmThreat[]).filter((t) => t.status === "open").length, 0),
  };
  return { sector: land.sector, readiness, counts, ...modelingSteps({ sector: land.sector, readiness, counts }) };
}

/* ---------- útočné cesty ---------- */

export async function attackPathsFor(db: Db, companyId: string, now = new Date()): Promise<AttackPathsDto> {
  const m = await measureCompany(db, companyId, now);
  const caps = await capabilityDtos(db, companyId, m);
  const capOf = (k: string) => caps.find((c) => c.key === k);
  const policy = (await settingsFor(db, null, companyId)).riskPolicy;
  const levels = policy.levels;
  const aIds = [...m.assets.keys()];
  const ipRows = aIds.length ? await db.select({ id: assets.id, ips: assets.ipAddresses }).from(assets).where(inArray(assets.id, aIds)) : [];
  const segs = await db.select({ name: netSegments.name, cidrs: netSegments.cidrs }).from(netSegments).where(and(eq(netSegments.companyId, companyId), eq(netSegments.enabled, true)));
  const ips = new Map(ipRows.map((r) => [r.id, r.ips]));
  const vc = await vulnCounts(db, aIds);
  const nodes: PathNode[] = [...m.assets.values()].map((a) => {
    const v = vc.get(a.id);
    const s = m.assetSignals.get(a.id) ?? {};
    return {
      id: a.id,
      name: a.name,
      assetType: a.assetType,
      assetClass: a.assetClass,
      criticality: a.criticality,
      cia: { c: a.c, i: a.i, a: a.a },
      internetFacing: a.internetFacing,
      kev: v?.kev ?? 0,
      critical: v?.critical ?? 0,
      high: v?.high ?? 0,
      noEdr: (s.no_edr ?? 0) > 0,
      eol: (s.eol_os ?? 0) > 0,
      segment: segs.length ? segmentOf(ips.get(a.id) ?? [], segs) : null,
    };
  });
  const deps = aIds.length ? await db.select({ from: assetDependencies.fromId, to: assetDependencies.toId, kind: assetDependencies.kind }).from(assetDependencies).where(inArray(assetDependencies.fromId, aIds)) : [];
  const links = aIds.length ? await db.select({ p: assetLinks.primaryId, s: assetLinks.supportingId }).from(assetLinks).where(inArray(assetLinks.primaryId, aIds)) : [];
  const edges: PathEdge[] = [
    ...deps.map((d) => ({ from: d.from, to: d.to, kind: (["runs_on", "uses", "network", "located_in", "backup"].includes(d.kind) ? d.kind : "uses") as PathEdge["kind"] })),
    ...links.map((l) => ({ from: l.p, to: l.s, kind: "link" as const })),
  ];
  const priv = capOf("privileged_access");
  const metric = (k: string) => priv?.metrics.find((x) => x.key === k)?.value ?? 0;
  const identity = {
    known: !!priv && priv.status !== "unknown",
    privileged: metric("privileged"),
    privNoMfa: metric("privileged_no_mfa"),
    mfaGap: m.companySignals.mfa_gap?.count ?? 0,
    kerberosWeak: m.companySignals.kerberos_weak?.count ?? 0,
  };
  const segmentation = capOf("segmentation")?.status ?? "unknown";
  const res = attackPaths({ nodes, edges, identity, segmentation, levels, maxPaths: 30 });
  // dopad cíle z kalibrace (BIA, osobní údaje, incidenty) a aktéři pro odvětví
  const targets = [...new Set(res.paths.map((p) => p.targetId))];
  const cal = await calibrationInputs(db, companyId, new Map(targets.map((t) => [t, { assetIds: [t], processIds: [] }])), now);
  const land = await threatLandscape(db, companyId, await detectionFor(db, companyId, now), now);
  const dec = await db
    .select({ d: attackPathDecisions, risk: risks.name, by: users.displayName })
    .from(attackPathDecisions)
    .leftJoin(risks, eq(risks.id, attackPathDecisions.riskId))
    .leftJoin(users, eq(users.id, attackPathDecisions.decidedById))
    .where(eq(attackPathDecisions.companyId, companyId));
  const paths: AttackPathDto[] = res.paths.map((p) => {
    const d = dec.find((x) => x.d.pathKey === p.key);
    const impact = calibrateRisk({ ...cal.get(p.targetId)!, levels, sectorDelta: 0 }).impact;
    return {
      ...p,
      impact,
      sector: sectorDelta(p.techniques, land.actors, !!land.sector),
      decision: d ? { status: d.d.status as "risk" | "accepted", riskId: d.d.riskId, riskName: d.risk, reason: d.d.reason, byName: d.by, at: d.d.decidedAt.toISOString() } : null,
    };
  });
  return { levels, paths, chokepoints: res.chokepoints, entries: res.entries, targets: res.targets, lowConfidence: res.lowConfidence, segmentation, identityKnown: identity.known };
}

/* ---------- threat modely ---------- */

async function scopeName(db: Db, scope: string, id: string | null) {
  if (!id) return null;
  if (scope === "process") return (await db.select({ n: processes.name }).from(processes).where(eq(processes.id, id)))[0]?.n ?? null;
  if (scope === "project") return (await db.select({ n: projects.name }).from(projects).where(eq(projects.id, id)))[0]?.n ?? null;
  return (await db.select({ n: assets.name }).from(assets).where(eq(assets.id, id)))[0]?.n ?? null;
}

function modelDto(r: typeof threatModels.$inferSelect, by: string | null, scopeN: string | null): ThreatModelDto {
  const threats = r.threats as TmThreat[];
  return {
    id: r.id,
    companyId: r.companyId,
    name: r.name,
    scope: r.scope as ThreatModelDto["scope"],
    scopeId: r.scopeId,
    scopeName: scopeN,
    description: r.description,
    status: r.status as ThreatModelDto["status"],
    elements: r.elements as TmElement[],
    threats,
    summary: threatModelSummary(threats),
    createdByName: by,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Prvky musí mít jedinečná id a toky musí vést mezi existujícími prvky. */
function assertElements(el: TmElement[]) {
  const idsSet = new Set<string>();
  for (const e of el) {
    if (idsSet.has(e.id)) throw new HTTPException(400, { message: "Prvky modelu musí mít jedinečné označení." });
    idsSet.add(e.id);
  }
  for (const e of el.filter((x) => x.kind === "flow")) {
    if (!e.from || !e.to || !idsSet.has(e.from) || !idsSet.has(e.to) || e.from === e.to) throw new HTTPException(400, { message: "Datový tok musí vést mezi dvěma prvky modelu." });
  }
}

export function threatModelHtml(m: ThreatModelDto): string {
  const L = TM_LABELS;
  const elName = (id: string | null) => m.elements.find((e) => e.id === id)?.name ?? "–";
  const rows = (xs: string[][]) => xs.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`).join("");
  const sev = ["", "Nízká", "Střední", "Vysoká", "Kritická"];
  const req = m.threats.filter((t) => t.status === "mitigate");
  return [
    `<h1>Threat model: ${escHtml(m.name)}</h1>`,
    `<p>Rozsah: ${escHtml(L.scope[m.scope])}${m.scopeName ? ` – ${escHtml(m.scopeName)}` : ""} · Stav: ${escHtml(L.status[m.status])} · Aktualizováno: ${m.updatedAt.slice(0, 10)}</p>`,
    m.description ? `<p>${escHtml(m.description)}</p>` : "",
    `<h2>Souhrn</h2><p>Hrozeb: ${m.summary.threats}, vysoké a kritické: ${m.summary.high}, neposouzené: ${m.summary.open}, bezpečnostních požadavků: ${m.summary.requirements}, rizik v registru: ${m.summary.risks}.</p>`,
    `<h2>Prvky a datové toky</h2><table><tr><th>Prvek</th><th>Typ</th><th>Zóna</th><th>Data</th><th>Ověření</th><th>Tok</th></tr>${rows(m.elements.map((e) => [e.name, L.kind[e.kind], L.zone[e.zone], L.data[e.data], L.auth[e.auth], e.kind === "flow" ? `${elName(e.from)} → ${elName(e.to)}` : ""]))}</table>`,
    `<h2>Hrozby (STRIDE)</h2><table><tr><th>Hrozba</th><th>Kategorie</th><th>Prvek</th><th>Závažnost</th><th>ATT&amp;CK</th><th>Rozhodnutí</th></tr>${rows(m.threats.map((t) => [t.title, L.stride[t.stride], elName(t.elementId), sev[t.severity] ?? String(t.severity), t.attack.join(", "), `${L.threatStatus[t.status]}${t.note ? ` – ${t.note}` : ""}`]))}</table>`,
    `<h2>Bezpečnostní požadavky</h2>${req.length ? `<ol>${req.map((t) => `<li>${escHtml(t.requirement)} <i>(${escHtml(t.title)})</i></li>`).join("")}</ol>` : "<p>Žádné hrozby nejsou označené ke zmírnění.</p>"}`,
  ].join("\n");
}

/* ---------- vytvoření rizika přes POST /api/risks ---------- */

async function createRisk(c: Ctx, dispatch: Dispatch, companyId: string, payload: Record<string, unknown>) {
  const base = new URL(c.req.url);
  const res = await dispatch(
    new Request(`${base.origin}/api/risks`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: c.req.header("cookie") ?? "", authorization: c.req.header("authorization") ?? "", origin: c.req.header("origin") ?? base.origin, "x-forwarded-for": c.req.header("x-forwarded-for") ?? "", "x-contix-company": companyId },
      body: JSON.stringify({ companyId, ...payload }),
    }),
  );
  const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
  if (!res.ok || !body?.id) throw new HTTPException(res.status === 403 ? 403 : 400, { message: body?.error ?? "Riziko se nepodařilo založit." });
  return body.id;
}

/** Hodnoty pro POST/PATCH rizika podle metodiky společnosti (jen vestavěná metodika a stejná stupnice). */
async function scoredFor(db: Db, companyId: string, v: { impact: number; threatLevel: number; vulnLevel: number; likelihood: number }) {
  const policy = (await settingsFor(db, null, companyId)).riskPolicy;
  const builtin = policy.methodology === "zkb409" || !policy.methodology;
  if (!builtin) return {};
  return policy.method === "two_factor" ? { impact: v.impact, likelihood: v.likelihood } : { impact: v.impact, threatLevel: v.threatLevel, vulnLevel: v.vulnLevel };
}

async function catalogIds(db: Db, codes: string[]) {
  const cat = codes.length ? await db.select({ id: riskCatalog.id, code: riskCatalog.code, kind: riskCatalog.kind }).from(riskCatalog).where(inArray(riskCatalog.code, codes)) : [];
  return (code: string, kind: "threat" | "weakness") => cat.find((x) => x.code === code && x.kind === kind)?.id ?? null;
}

const techLabel = (id: string) => {
  const t = attackTechnique(id);
  return t ? `${id} ${t.name}` : id;
};

export function modelingRoutes(db: Db, deps: { dispatch: () => Dispatch }) {
  async function loadModel(c: Ctx, id: string) {
    const [r] = await db.select().from(threatModels).where(eq(threatModels.id, id));
    if (!r) throw new HTTPException(404, { message: "Threat model nenalezen" });
    assertScope(c, r.companyId, "Threat model nenalezen");
    return r;
  }
  async function dto(r: typeof threatModels.$inferSelect) {
    const [u] = r.createdById ? await db.select({ n: users.displayName }).from(users).where(eq(users.id, r.createdById)) : [];
    return modelDto(r, u?.n ?? null, await scopeName(db, r.scope, r.scopeId));
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "risks"))
      .get("/overview", requirePerm("risks:read"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null);
        return c.json(await modelingOverview(db, companyId));
      })
      /* ---- útočné cesty ---- */
      .get("/paths", requirePerm("risks:read"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null);
        return c.json(await attackPathsFor(db, companyId));
      })
      .post("/paths/decision", requirePerm("risks:write"), zValidator("json", z.object({ key: z.string().min(3).max(200), companyId: z.string().uuid().optional() }).and(AttackPathDecisionInput)), async (c) => {
        const v = c.req.valid("json");
        const companyId = targetCompany(c, v.companyId ?? null, "risks:write");
        const user = currentUser(c);
        if (v.action === "reopen") {
          await db.delete(attackPathDecisions).where(and(eq(attackPathDecisions.companyId, companyId), eq(attackPathDecisions.pathKey, v.key)));
          await audit(db, { c, user, action: "risk.attack_path_reopened", entityType: "company", entityId: companyId, details: { key: v.key } });
          return c.json({ ok: true });
        }
        const [prev] = await db.select().from(attackPathDecisions).where(and(eq(attackPathDecisions.companyId, companyId), eq(attackPathDecisions.pathKey, v.key)));
        if (prev) throw new HTTPException(409, { message: "O útočné cestě už bylo rozhodnuto." });
        if (v.action === "accept") {
          await db.insert(attackPathDecisions).values({ companyId, pathKey: v.key, status: "accepted", reason: v.reason, decidedById: user.id });
          await audit(db, { c, user, action: "risk.attack_path_accepted", entityType: "company", entityId: companyId, details: { key: v.key, reason: v.reason } });
          return c.json({ ok: true });
        }
        // riziko z aktuálně spočítané cesty (data se mohla od zobrazení změnit)
        const all = await attackPathsFor(db, companyId);
        const p = all.paths.find((x) => x.key === v.key);
        if (!p) throw new HTTPException(404, { message: "Útočná cesta už v aktuálních datech neexistuje." });
        const last = p.steps.at(-1)!.technique;
        const threat = last === "T1486" ? "H05" : "H09";
        const more = [p.entry === "phishing" ? "H16" : null, p.steps.some((s) => s.assetId === IDENTITY_NODE) ? "H03" : null].filter((x): x is string => !!x && x !== threat);
        const vulnWeak = p.steps.some((s) => /kev|critical|eol|high/i.test(s.reason.text));
        const weak = [vulnWeak ? "Z17" : "Z11", "Z03", p.steps.some((s) => s.assetId === IDENTITY_NODE) ? "Z06" : null].filter((x): x is string => !!x);
        const idOf = await catalogIds(db, [threat, ...more, ...weak]);
        const n = all.levels;
        const threatLevel = clamp(Math.ceil(n / 2) + p.sector.delta, n);
        const desc = [
          `Útočná cesta z grafu aktiv (ADR-137), pravděpodobnost cesty ${Math.round(p.probability * 100)} %.`,
          ...p.steps.map((s, i) => `${i + 1}. ${s.assetName}: ${techLabel(s.technique)} (snadnost ${Math.round(s.ease * 100)} %)`),
          p.sector.actors.length ? `Relevantní aktéři: ${p.sector.actors.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        const riskId = await createRisk(c, deps.dispatch(), companyId, {
          name: (v.name ?? `Útočná cesta: ${p.steps[0]!.assetName} → ${p.targetName}`).slice(0, 500),
          description: desc.slice(0, 10000),
          threatId: idOf(threat, "threat"),
          weaknessId: idOf(weak[0]!, "weakness"),
          moreThreatIds: more.map((x) => idOf(x, "threat")).filter(Boolean),
          moreWeaknessIds: weak.slice(1).map((x) => idOf(x, "weakness")).filter(Boolean),
          ownerPositionId: v.ownerPositionId ?? null,
          assetIds: p.assetIds,
          ...(await scoredFor(db, companyId, { impact: p.impact, threatLevel, vulnLevel: p.level, likelihood: clamp((threatLevel + p.level) / 2, n) })),
        });
        await db.insert(attackPathDecisions).values({ companyId, pathKey: v.key, status: "risk", riskId, decidedById: user.id });
        await audit(db, { c, user, action: "risk.attack_path_risk", entityType: "risk", entityId: riskId, details: { key: v.key } });
        return c.json({ riskId }, 201);
      })
      /* ---- kalibrace ---- */
      .get("/calibration", requirePerm("risks:read"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null);
        const land = await threatLandscape(db, companyId, await detectionFor(db, companyId));
        return c.json(await calibrationFor(db, companyId, land, c.req.query("riskId") || undefined));
      })
      .post("/calibration/:riskId/apply", requirePerm("risks:write"), zValidator("json", CalibrationApplyInput), async (c) => {
        const [r] = await db.select({ id: risks.id, companyId: risks.companyId }).from(risks).where(eq(risks.id, c.req.param("riskId")));
        if (!r) throw new HTTPException(404, { message: "Riziko nenalezeno" });
        assertScope(c, r.companyId, "Riziko nenalezeno");
        const v = c.req.valid("json");
        const policy = (await settingsFor(db, null, r.companyId)).riskPolicy;
        const body =
          policy.method === "two_factor"
            ? { impact: v.impact, likelihood: v.likelihood ?? (v.threatLevel != null && v.vulnLevel != null ? Math.round((v.threatLevel + v.vulnLevel) / 2) : undefined) }
            : { impact: v.impact, threatLevel: v.threatLevel, vulnLevel: v.vulnLevel };
        const base = new URL(c.req.url);
        const res = await deps.dispatch()(
          new Request(`${base.origin}/api/risks/${r.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json", cookie: c.req.header("cookie") ?? "", authorization: c.req.header("authorization") ?? "", origin: c.req.header("origin") ?? base.origin, "x-forwarded-for": c.req.header("x-forwarded-for") ?? "", "x-contix-company": r.companyId },
            body: JSON.stringify({ ...body, reviewNote: `Kalibrace z dat (ADR-137)${v.note ? `: ${v.note}` : ""}`.slice(0, 5000) }),
          }),
        );
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new HTTPException(res.status === 403 ? 403 : 400, { message: out?.error ?? "Hodnocení se nepodařilo uložit." });
        await audit(db, { c, user: currentUser(c), action: "risk.calibration_applied", entityType: "risk", entityId: r.id, details: body });
        return c.json({ ok: true });
      })
      /* ---- aktéři hrozeb pro odvětví ---- */
      .get("/landscape", requirePerm("risks:read"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null);
        return c.json(await threatLandscape(db, companyId, await detectionFor(db, companyId)));
      })
      .put("/landscape/profile", requirePerm("risks:write"), zValidator("json", ThreatProfileInput.extend({ companyId: z.string().uuid().optional() })), async (c) => {
        const v = c.req.valid("json");
        const companyId = targetCompany(c, v.companyId ?? null, "risks:write");
        const user = currentUser(c);
        const values = { sector: v.sector, overrides: v.overrides, updatedById: user.id, updatedAt: new Date() };
        await db.insert(threatProfiles).values({ companyId, ...values }).onConflictDoUpdate({ target: threatProfiles.companyId, set: values });
        await audit(db, { c, user, action: "risk.threat_profile_updated", entityType: "company", entityId: companyId, details: { sector: v.sector, overrides: Object.keys(v.overrides) } });
        return c.json(await threatLandscape(db, companyId, await detectionFor(db, companyId)));
      })
      /* ---- threat modely ---- */
      .get("/models", requirePerm("risks:read"), async (c) => {
        const rows = await db.select({ r: threatModels, by: users.displayName }).from(threatModels).leftJoin(users, eq(users.id, threatModels.createdById)).where(inScope(c, threatModels.companyId)).orderBy(desc(threatModels.updatedAt)).limit(300);
        const out: ThreatModelDto[] = [];
        for (const x of rows) out.push(modelDto(x.r, x.by, await scopeName(db, x.r.scope, x.r.scopeId)));
        return c.json(out);
      })
      .get("/models/seed", requirePerm("risks:read"), zValidator("query", z.object({ assetId: z.string().uuid() })), async (c) => {
        const { assetId } = c.req.valid("query");
        const [a] = await db.select({ id: assets.id, name: assets.name, assetType: assets.assetType, internetFacing: assets.internetFacing, c: assets.confidentiality, companyId: assets.companyId }).from(assets).where(eq(assets.id, assetId));
        if (!a) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
        assertScope(c, a.companyId, "Aktivum nenalezeno");
        const out = await db.select({ id: assets.id, name: assets.name, assetType: assets.assetType, internetFacing: assets.internetFacing, kind: assetDependencies.kind }).from(assetDependencies).innerJoin(assets, eq(assets.id, assetDependencies.toId)).where(eq(assetDependencies.fromId, assetId));
        const inn = await db.select({ id: assets.id, name: assets.name, assetType: assets.assetType, internetFacing: assets.internetFacing, kind: assetDependencies.kind }).from(assetDependencies).innerJoin(assets, eq(assets.id, assetDependencies.fromId)).where(eq(assetDependencies.toId, assetId));
        const sup = await db.select({ id: assets.id, name: assets.name, assetType: assets.assetType, internetFacing: assets.internetFacing }).from(assetLinks).innerJoin(assets, eq(assets.id, assetLinks.supportingId)).where(eq(assetLinks.primaryId, assetId));
        const deps2 = [...out.map((x) => ({ ...x, dir: "out" as const })), ...inn.map((x) => ({ ...x, dir: "in" as const })), ...sup.map((x) => ({ ...x, kind: "uses", dir: "out" as const }))];
        const uniq = deps2.filter((x, i) => deps2.findIndex((y) => y.id === x.id) === i);
        const elements = seedElements(a, uniq);
        return c.json({ elements, threats: strideThreats(elements) });
      })
      .post("/models", requirePerm("risks:write"), zValidator("json", ThreatModelInput), async (c) => {
        const v = c.req.valid("json");
        const companyId = targetCompany(c, v.companyId ?? null, "risks:write");
        assertElements(v.elements);
        const threats = strideThreats(v.elements, v.threats);
        const [r] = await db.insert(threatModels).values({ companyId, name: v.name, scope: v.scope, scopeId: v.scopeId ?? null, description: v.description ?? null, status: v.status, elements: v.elements, threats, createdById: currentUser(c).id }).returning();
        await audit(db, { c, user: currentUser(c), action: "threat_model.created", entityType: "threat_model", entityId: r!.id, details: { name: v.name } });
        return c.json(await dto(r!), 201);
      })
      .get("/models/:id", requirePerm("risks:read"), async (c) => c.json(await dto(await loadModel(c, c.req.param("id")))))
      .patch("/models/:id", requirePerm("risks:write"), zValidator("json", ThreatModelPatch), async (c) => {
        const r = await loadModel(c, c.req.param("id"));
        const v = c.req.valid("json");
        const elements = (v.elements ?? r.elements) as TmElement[];
        if (v.elements) assertElements(v.elements);
        const given = (v.threats ?? r.threats) as TmThreat[];
        // riziko u hrozby smí nastavit jen server (vytvoření rizika) – klient ho nepřepíše
        const prevRisk = new Map((r.threats as TmThreat[]).map((t) => [t.key, t.riskId]));
        const merged = given.map((t) => ({ ...t, riskId: prevRisk.get(t.key) ?? null, status: t.status === "risk" && !prevRisk.get(t.key) ? ("open" as const) : t.status }));
        const threats = v.elements ? strideThreats(elements, merged) : merged;
        const [u] = await db
          .update(threatModels)
          .set({ ...(v.name != null ? { name: v.name } : {}), ...(v.scope ? { scope: v.scope } : {}), ...(v.scopeId !== undefined ? { scopeId: v.scopeId } : {}), ...(v.description !== undefined ? { description: v.description } : {}), ...(v.status ? { status: v.status } : {}), elements, threats, updatedAt: new Date() })
          .where(eq(threatModels.id, r.id))
          .returning();
        await audit(db, { c, user: currentUser(c), action: "threat_model.updated", entityType: "threat_model", entityId: r.id, details: { fields: Object.keys(v) } });
        return c.json(await dto(u!));
      })
      .delete("/models/:id", requirePerm("risks:write"), async (c) => {
        const r = await loadModel(c, c.req.param("id"));
        await db.delete(threatModels).where(eq(threatModels.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "threat_model.deleted", entityType: "threat_model", entityId: r.id, details: { name: r.name } });
        return c.json({ ok: true });
      })
      .post("/models/:id/threats/risk", requirePerm("risks:write"), zValidator("json", z.object({ key: z.string().max(120), name: z.string().trim().min(1).max(500).optional() })), async (c) => {
        const r = await loadModel(c, c.req.param("id"));
        const { key, name } = c.req.valid("json");
        const threats = r.threats as TmThreat[];
        const t = threats.find((x) => x.key === key);
        if (!t) throw new HTTPException(404, { message: "Hrozba nenalezena" });
        if (t.riskId) throw new HTTPException(409, { message: "Hrozba už je v registru rizik." });
        const el = (r.elements as TmElement[]).find((e) => e.id === t.elementId);
        const cat = STRIDE_CATALOG[t.stride];
        const idOf = await catalogIds(db, [cat.threat, cat.weakness]);
        const policy = (await settingsFor(db, null, r.companyId)).riskPolicy;
        const n = policy.levels;
        const impact = clamp((t.severity / 4) * n, n);
        const assetIds = [...new Set([el?.assetId, r.scope === "asset" || r.scope === "application" ? r.scopeId : null].filter((x): x is string => !!x))];
        const own = assetIds.length ? await db.select({ id: assets.id }).from(assets).where(and(inArray(assets.id, assetIds), eq(assets.companyId, r.companyId))) : [];
        const riskId = await createRisk(c, deps.dispatch(), r.companyId, {
          name: (name ?? `${r.name}: ${t.title}`).slice(0, 500),
          description: [`Hrozba z threat modelu „${r.name}“ (STRIDE: ${TM_LABELS.stride[t.stride]}, ADR-137).`, `Prvek: ${el?.name ?? "–"}`, `ATT&CK: ${t.attack.map(techLabel).join(", ")}`, `Bezpečnostní požadavek: ${t.requirement}`].join("\n").slice(0, 10000),
          threatId: idOf(cat.threat, "threat"),
          weaknessId: idOf(cat.weakness, "weakness"),
          assetIds: own.map((x) => x.id),
          processIds: r.scope === "process" && r.scopeId ? [r.scopeId] : [],
          ...(await scoredFor(db, r.companyId, { impact, threatLevel: Math.ceil(n / 2), vulnLevel: Math.ceil(n / 2), likelihood: Math.ceil(n / 2) })),
        });
        const next = threats.map((x) => (x.key === key ? { ...x, riskId, status: "risk" as const } : x));
        await db.update(threatModels).set({ threats: next, updatedAt: new Date() }).where(eq(threatModels.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "threat_model.risk_created", entityType: "risk", entityId: riskId, details: { modelId: r.id, key } });
        return c.json({ riskId, model: await dto({ ...r, threats: next }) }, 201);
      })
      .get("/models/:id/report", requirePerm("risks:read"), zValidator("query", z.object({ format: z.enum(["html", "docx"]).default("docx") })), async (c) => {
        const m = await dto(await loadModel(c, c.req.param("id")));
        const html = threatModelHtml(m);
        await audit(db, { c, user: currentUser(c), action: "threat_model.report", entityType: "threat_model", entityId: m.id, details: {} });
        const fname = `Threat model – ${m.name}`.replace(/[\\/:*?"<>|]/g, "_");
        if (c.req.valid("query").format === "docx") return docxResponse(await htmlToDocx(html, { title: `Threat model: ${m.name}`, headerLine: m.name }), `${fname}.docx`);
        return c.html(`<!doctype html><meta charset="utf-8"><title>${escHtml(fname)}</title><style>body{font:14px Arial,sans-serif;margin:32px;max-width:1000px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:4px 6px;text-align:left;vertical-align:top}</style>${html}`, 200, { "cache-control": "private, no-store" });
      })
  );
}
