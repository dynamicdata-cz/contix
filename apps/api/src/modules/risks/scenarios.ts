import {
  CAPABILITY_KEYS,
  CapabilityDeclarationInput,
  RISK_SCENARIO_LABELS,
  SCENARIO_TEMPLATES,
  ScenarioAcceptInput,
  ThreatAssessmentInput,
  threatCellState,
  threatCoverageSummary,
  triggerDue,
  ATTACK_TECHNIQUES,
  DetectionDeclarationInput,
  detectionState,
  detectionSummary,
  scenarioTechniques,
  techniqueMatches,
  type DetectionDto,
  type RiskDataReport,
  type ThreatCoverageCell,
  type ThreatCoverageDto,
  ScenarioDecisionInput,
  capabilityRequirementIds,
  coverageStatus,
  evaluateScenario,
  scenarioFingerprint,
  scenarioTriggered,
  templateApplies,
  templateByKey,
  type CapabilityDto,
  type CapabilityKey,
  type CapabilityMetric,
  type CapabilityStatus,
  type ScenarioEvaluation,
  type ScenarioProposalDto,
  type ScenarioStatus,
  type SignalHit,
  type SignalKey,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  alertSuggestions,
  assetDependencies,
  assetLinks,
  assetSources,
  assetVulnerabilities,
  assets,
  biaAssessments,
  capabilityDeclarations,
  companies,
  controlMonitors,
  controlRequirements,
  detectionDeclarations,
  socHunts,
  controls,
  identityAccounts,
  identityFindings,
  netObservations,
  netSegments,
  planProcesses,
  planTests,
  processAssets,
  riskAssets,
  riskCatalog,
  riskCatalogLinks,
  riskReviews,
  riskScenarioProposals,
  risks,
  scaResults,
  supplierAssets,
  supplierProcesses,
  supplierReports,
  suppliers,
  threatAssessments,
  users,
  vulnIntel,
} from "../../db/schema";
import type { Dispatch } from "../import/routes";
import { getVulnSla, vulnOverdueSql } from "../vulnerabilities/intel";
import { riskBaselineSql, riskTriggers } from "./triggers";

/* ============================================================
 * Rizikové scénáře z dat (v1.17, ADR-114): profil schopností `measureCompany`, návrhy `generateProposals`.
 * Vše jen čte data CONTIXu; riziko vznikne jen na pokyn člověka (přes POST /api/risks – stejné validace a audit).
 * ============================================================ */

type Ctx = Context<AppEnv>;
const ENDPOINT_TYPES = new Set(["server", "workstation", "laptop", "virtual_machine"]);
const AGENT_FRESH_DAYS = 7;
const MAX_ITEMS = 8;
const COMPONENT_TYPES = new Set(["application", "container", "saas_service", "database"]);
const REDUNDANCY_TYPES = new Set(["server", "virtual_machine", "network_device", "security_device", "storage", "application", "database"]);
const day = 86_400_000;

type AssetRow = {
  id: string;
  name: string;
  assetType: string;
  assetClass: string;
  criticality: "low" | "medium" | "high" | "critical";
  c: number | null;
  i: number | null;
  a: number | null;
  internetFacing: boolean;
  supportStatus: string;
  attributes: Record<string, unknown>;
  lastSeenAt: Date | null;
  redundant: boolean;
};

interface Measurement {
  capabilities: Map<CapabilityKey, { status: CapabilityStatus; coverage: number | null; metrics: CapabilityMetric[]; links: { label: string; path: string }[] }>;
  assets: Map<string, AssetRow>;
  /** Signály za aktivum (asset-level) – počty a doklady. */
  assetSignals: Map<string, Partial<Record<SignalKey, number>>>;
  companySignals: Partial<Record<SignalKey, SignalHit>>;
  edrMeasured: boolean;
  /** Primární aktivum → podpůrná aktiva (vazby + jeden krok technických závislostí). */
  supporting: Map<string, string[]>;
  /** Aktivum → procesy, kritické procesy bez úspěšně otestované obnovy. */
  untestedProcessesFor: (assetIds: string[]) => { total: number; untested: { label: string; path: string }[] };
  suppliersWithoutAssurance: (assetIds: string[]) => { label: string; path: string }[];
}

/** Profil schopností a signály společnosti – jen čtení. */
export async function measureCompany(db: Db, companyId: string, now = new Date()): Promise<Measurement> {
  const aRows = (await db
    .select({
      id: assets.id,
      name: assets.name,
      assetType: assets.assetType,
      assetClass: assets.assetClass,
      criticality: assets.criticality,
      c: assets.confidentiality,
      i: assets.integrity,
      a: assets.availability,
      internetFacing: assets.internetFacing,
      supportStatus: assets.supportStatus,
      attributes: assets.attributes,
      lastSeenAt: assets.lastSeenAt,
      redundant: assets.redundant,
    })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), inArray(assets.lifecycleStatus, ["active", "maintenance"])))) as AssetRow[];
  const byId = new Map(aRows.map((a) => [a.id, a]));
  const ids = aRows.map((a) => a.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const idList = ids.length ? ids : none;
  const caps: Measurement["capabilities"] = new Map();
  const assetSignals = new Map<string, Partial<Record<SignalKey, number>>>();
  const bump = (assetId: string, k: SignalKey, n = 1) => {
    const m = assetSignals.get(assetId) ?? {};
    m[k] = (m[k] ?? 0) + n;
    assetSignals.set(assetId, m);
  };

  // --- EDR / agent (Wazuh) ---
  const wazuh = await db.select({ assetId: assetSources.assetId }).from(assetSources).where(and(eq(assetSources.sourceType, "wazuh"), inArray(assetSources.assetId, idList)));
  const withAgentSource = new Set(wazuh.map((w) => w.assetId));
  const endpoints = aRows.filter((a) => ENDPOINT_TYPES.has(a.assetType));
  const edrMeasured = withAgentSource.size > 0;
  if (edrMeasured) {
    const fresh = (a: AssetRow) => {
      const w = (a.attributes?.wazuh ?? {}) as { status?: string };
      return withAgentSource.has(a.id) && w.status === "active" && !!a.lastSeenAt && now.getTime() - a.lastSeenAt.getTime() < AGENT_FRESH_DAYS * day;
    };
    const covered = endpoints.filter(fresh);
    for (const a of endpoints) if (!fresh(a)) bump(a.id, "no_edr");
    const cov = endpoints.length ? covered.length / endpoints.length : null;
    caps.set("edr", { status: coverageStatus(cov), coverage: cov, metrics: [{ key: "endpoints_covered", value: covered.length, total: endpoints.length }], links: [{ label: "rsc.link.assets", path: "/assets" }] });
  } else caps.set("edr", { status: "unknown", coverage: null, metrics: [{ key: "endpoints", value: endpoints.length }], links: [{ label: "rsc.link.connectors", path: "/admin/connectors" }] });

  // --- zranitelnosti ---
  const sla = await getVulnSla(db);
  const vRows = ids.length
    ? await db
        .select({
          assetId: assetVulnerabilities.assetId,
          kev: sql<number>`count(*) filter (where coalesce(${vulnIntel.kev}, false))::int`,
          crit: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} in ('critical', 'high'))::int`,
          overdue: sql<number>`count(*) filter (where ${vulnOverdueSql(sla)})::int`,
        })
        .from(assetVulnerabilities)
        .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
        .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
        .where(and(inArray(assetVulnerabilities.assetId, ids), eq(assetVulnerabilities.status, "open")))
        .groupBy(assetVulnerabilities.assetId)
    : [];
  const [anyVuln] = ids.length ? await db.select({ n: sql<number>`count(*)::int` }).from(assetVulnerabilities).where(inArray(assetVulnerabilities.assetId, ids)) : [{ n: 0 }];
  const vulnMeasured = (anyVuln?.n ?? 0) > 0 || edrMeasured;
  let kevExposed = 0;
  let overdueAssets = 0;
  for (const v of vRows) {
    const a = byId.get(v.assetId);
    if (!a) continue;
    if (a.internetFacing && v.kev > 0) (bump(a.id, "kev_exposed", v.kev), kevExposed++);
    else if (a.internetFacing && v.crit > 0) bump(a.id, "critical_exposed", v.crit);
    if (v.overdue > 0) (bump(a.id, "vuln_overdue", v.overdue), overdueAssets++);
  }
  for (const a of aRows) {
    if (a.supportStatus === "eol") bump(a.id, "eol_os");
    if (a.internetFacing) bump(a.id, "internet_exposed");
  }
  // v1.21 (ADR-118): komponenty, OT / IoT, redundance důležitých podpůrných aktiv
  const vByAsset = new Map(vRows.map((v) => [v.assetId, v]));
  for (const a of aRows) {
    const v = vByAsset.get(a.id);
    if (COMPONENT_TYPES.has(a.assetType) && v && v.crit > 0) bump(a.id, "component_vuln", v.crit);
    if (a.assetType === "iot_ot" && ((v && (v.kev > 0 || v.crit > 0)) || a.supportStatus === "eol" || a.internetFacing)) bump(a.id, "ot_vulnerable");
    if (REDUNDANCY_TYPES.has(a.assetType) && a.assetClass !== "primary" && !a.redundant && ((a.a ?? 0) >= 3 || a.criticality === "high" || a.criticality === "critical")) bump(a.id, "no_redundancy");
  }
  const eol = aRows.filter((a) => a.supportStatus === "eol").length;
  if (vulnMeasured) {
    const scanned = Math.max(endpoints.length, vRows.length, 1);
    const cov = 1 - Math.min(1, (overdueAssets + eol) / scanned);
    const status: CapabilityStatus = kevExposed > 0 ? "weak" : coverageStatus(cov);
    caps.set("vuln_mgmt", {
      status,
      coverage: cov,
      metrics: [
        { key: "kev_exposed_assets", value: kevExposed },
        { key: "overdue_assets", value: overdueAssets },
        { key: "eol_assets", value: eol },
      ],
      links: [{ label: "rsc.link.vulns", path: "/vulnerabilities" }],
    });
  } else caps.set("vuln_mgmt", { status: "unknown", coverage: null, metrics: [], links: [{ label: "rsc.link.vulns", path: "/vulnerabilities" }] });

  // --- hardening (Wazuh SCA) ---
  const sca = await db.select({ assetId: scaResults.assetId, score: sql<number>`min(${scaResults.score})::int` }).from(scaResults).where(eq(scaResults.companyId, companyId)).groupBy(scaResults.assetId);
  const scored = sca.filter((x) => x.score != null);
  for (const x of scored) if (x.assetId && x.score < 60) bump(x.assetId, "sca_low");
  if (scored.length) {
    const avg = scored.reduce((s, x) => s + x.score, 0) / scored.length;
    caps.set("hardening", { status: avg >= 80 ? "strong" : avg >= 60 ? "partial" : "weak", coverage: avg / 100, metrics: [{ key: "sca_avg", value: Math.round(avg) }, { key: "sca_low_assets", value: scored.filter((x) => x.score < 60).length, total: scored.length }], links: [{ label: "rsc.link.sca", path: "/sca" }] });
  } else caps.set("hardening", { status: "unknown", coverage: null, metrics: [], links: [{ label: "rsc.link.sca", path: "/sca" }] });

  // --- identity: MFA a privilegované účty ---
  const companySignals: Partial<Record<SignalKey, SignalHit>> = {};
  const acc = await db
    .select({ id: identityAccounts.id, login: identityAccounts.login, mfa: identityAccounts.mfa, privileged: identityAccounts.privileged })
    .from(identityAccounts)
    .where(and(eq(identityAccounts.companyId, companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.enabled, true), eq(identityAccounts.kind, "user")));
  const withMfaInfo = acc.filter((a) => a.mfa != null);
  if (withMfaInfo.length) {
    const noMfa = withMfaInfo.filter((a) => a.mfa === false);
    const cov = 1 - noMfa.length / withMfaInfo.length;
    caps.set("mfa", { status: coverageStatus(cov), coverage: cov, metrics: [{ key: "users_mfa", value: withMfaInfo.length - noMfa.length, total: withMfaInfo.length }], links: [{ label: "rsc.link.identity", path: "/identity" }] });
    if (cov < 0.95) companySignals.mfa_gap = { key: "mfa_gap", count: noMfa.length, items: [{ label: "rsc.item.identity", path: "/identity" }] };
  } else caps.set("mfa", { status: "unknown", coverage: null, metrics: [], links: [{ label: "rsc.link.identity", path: "/identity" }] });
  if (acc.length) {
    const priv = acc.filter((a) => a.privileged);
    const privNoMfa = priv.filter((a) => a.mfa === false);
    const findings = await db
      .select({ rule: identityFindings.rule, n: sql<number>`count(*)::int` })
      .from(identityFindings)
      .where(and(eq(identityFindings.companyId, companyId), eq(identityFindings.status, "open")))
      .groupBy(identityFindings.rule);
    const f = (rules: string[]) => findings.filter((x) => rules.includes(x.rule)).reduce((s, x) => s + x.n, 0);
    const hygiene = f(["privileged_pwd_old", "privileged_group_size", "stale", "leaver"]);
    const kerb = f(["kerberoastable", "unconstrained_delegation", "preauth_disabled", "pwd_not_required"]);
    if (privNoMfa.length) companySignals.priv_no_mfa = { key: "priv_no_mfa", count: privNoMfa.length, items: [{ label: "rsc.item.identity", path: "/identity" }] };
    if (hygiene) companySignals.priv_hygiene = { key: "priv_hygiene", count: hygiene, items: [{ label: "rsc.item.identity", path: "/identity" }] };
    if (kerb) companySignals.kerberos_weak = { key: "kerberos_weak", count: kerb, items: [{ label: "rsc.item.identity", path: "/identity" }] };
    const issues = privNoMfa.length + hygiene + kerb;
    caps.set("privileged_access", {
      status: issues === 0 ? "strong" : privNoMfa.length > 0 || issues > 5 ? "weak" : "partial",
      coverage: priv.length ? 1 - privNoMfa.length / priv.length : null,
      metrics: [
        { key: "privileged", value: priv.length },
        { key: "privileged_no_mfa", value: privNoMfa.length },
        { key: "identity_findings", value: hygiene + kerb },
      ],
      links: [{ label: "rsc.link.identity", path: "/identity" }],
    });
  } else caps.set("privileged_access", { status: "unknown", coverage: null, metrics: [], links: [{ label: "rsc.link.identity", path: "/identity" }] });

  // --- segmentace (síťové segmenty, neevidovaná zařízení) ---
  const [seg] = await db.select({ n: sql<number>`count(*)::int` }).from(netSegments).where(and(eq(netSegments.companyId, companyId), eq(netSegments.enabled, true)));
  const [unk] = await db.select({ n: sql<number>`count(*)::int` }).from(netObservations).where(and(eq(netObservations.companyId, companyId), eq(netObservations.status, "unknown"), isNull(netObservations.decidedAt)));
  if (unk!.n) companySignals.unmanaged_devices = { key: "unmanaged_devices", count: unk!.n, items: [{ label: "rsc.item.discovery", path: "/discovery" }] };
  // Microsoft Secure Score pod prahem – nesplněný monitor opatření (v1.21, ADR-118)
  const ss = await db
    .select({ controlId: controlMonitors.controlId, name: controlMonitors.name })
    .from(controlMonitors)
    .where(and(eq(controlMonitors.companyId, companyId), eq(controlMonitors.kind, "m365_secure_score"), eq(controlMonitors.enabled, true), eq(controlMonitors.lastResult, "fail")));
  if (ss.length) companySignals.secure_score_low = { key: "secure_score_low", count: ss.length, items: ss.map((x) => ({ label: x.name || "Secure Score", path: `/controls/${x.controlId}` })) };
  caps.set("segmentation", {
    status: seg!.n === 0 ? "unknown" : unk!.n > 0 ? "weak" : seg!.n >= 2 ? "partial" : "unknown",
    coverage: null,
    metrics: [
      { key: "segments", value: seg!.n },
      { key: "unmanaged_devices", value: unk!.n },
    ],
    links: [{ label: "rsc.link.discovery", path: "/discovery" }],
  });

  // --- zálohy a obnova (BIA + testy plánů) ---
  const pa = ids.length ? await db.select({ processId: processAssets.processId, assetId: processAssets.assetId }).from(processAssets).where(inArray(processAssets.assetId, ids)) : [];
  const bia = await db.select({ processId: biaAssessments.processId, rto: biaAssessments.rtoHours }).from(biaAssessments).where(and(eq(biaAssessments.companyId, companyId), sql`${biaAssessments.rtoHours} is not null`));
  const rtoBy = new Map<string, number>();
  for (const b of bia) rtoBy.set(b.processId, Math.min(rtoBy.get(b.processId) ?? Infinity, b.rto!));
  const procIds = [...rtoBy.keys()];
  const tests = procIds.length
    ? await db
        .select({ processId: planProcesses.processId, result: planTests.result, rto: planTests.achievedRtoHours })
        .from(planTests)
        .innerJoin(planProcesses, eq(planProcesses.planId, planTests.planId))
        .where(and(inArray(planProcesses.processId, procIds), gte(planTests.testedAt, new Date(now.getTime() - 365 * day).toISOString().slice(0, 10))))
    : [];
  const okProc = new Set(tests.filter((x) => x.result === "passed" && (x.rto == null || x.rto <= (rtoBy.get(x.processId) ?? Infinity))).map((x) => x.processId));
  if (procIds.length) {
    const cov = okProc.size / procIds.length;
    caps.set("backup_recovery", { status: coverageStatus(cov), coverage: cov, metrics: [{ key: "processes_restore_tested", value: okProc.size, total: procIds.length }], links: [{ label: "rsc.link.continuity", path: "/continuity" }] });
  } else caps.set("backup_recovery", { status: "unknown", coverage: null, metrics: [], links: [{ label: "rsc.link.continuity", path: "/continuity" }] });
  const procOfAsset = new Map<string, Set<string>>();
  for (const x of pa) procOfAsset.set(x.assetId, (procOfAsset.get(x.assetId) ?? new Set()).add(x.processId));

  // --- dodavatelé ---
  const sig = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(and(eq(suppliers.companyId, companyId), eq(suppliers.significant, true)));
  const today = now.toISOString().slice(0, 10);
  const valid = sig.length ? new Set((await db.select({ id: supplierReports.supplierId }).from(supplierReports).where(and(inArray(supplierReports.supplierId, sig.map((s) => s.id)), gte(supplierReports.validUntil, today)))).map((x) => x.id)) : new Set<string>();
  if (sig.length) {
    const cov = valid.size / sig.length;
    caps.set("supplier_assurance", { status: coverageStatus(cov), coverage: cov, metrics: [{ key: "suppliers_assured", value: valid.size, total: sig.length }], links: [{ label: "rsc.link.suppliers", path: "/suppliers" }] });
  } else caps.set("supplier_assurance", { status: "unknown", coverage: null, metrics: [], links: [{ label: "rsc.link.suppliers", path: "/suppliers" }] });
  const supA = ids.length ? await db.select({ supplierId: supplierAssets.supplierId, assetId: supplierAssets.assetId }).from(supplierAssets).where(inArray(supplierAssets.assetId, ids)) : [];
  const allProc = [...new Set(pa.map((x) => x.processId))];
  const supP = allProc.length ? await db.select({ supplierId: supplierProcesses.supplierId, processId: supplierProcesses.processId }).from(supplierProcesses).where(inArray(supplierProcesses.processId, allProc)) : [];
  const sigById = new Map(sig.map((s) => [s.id, s.name]));

  // --- primární aktivum → podpůrná (vazby + jeden krok závislostí) ---
  const links = ids.length ? await db.select({ p: assetLinks.primaryId, s: assetLinks.supportingId }).from(assetLinks).where(inArray(assetLinks.primaryId, ids)) : [];
  const deps = ids.length ? await db.select({ from: assetDependencies.fromId, to: assetDependencies.toId }).from(assetDependencies).where(inArray(assetDependencies.fromId, ids)) : [];
  const supporting = new Map<string, string[]>();
  for (const a of aRows.filter((x) => x.assetClass === "primary")) {
    const direct = links.filter((l) => l.p === a.id).map((l) => l.s);
    const more = deps.filter((d) => direct.includes(d.from)).map((d) => d.to);
    supporting.set(a.id, [...new Set([...direct, ...more])].filter((x) => x !== a.id && byId.has(x)));
  }

  return {
    capabilities: caps,
    assets: byId,
    assetSignals,
    companySignals,
    edrMeasured,
    supporting,
    untestedProcessesFor: (assetIds) => {
      const procs = new Set(assetIds.flatMap((x) => [...(procOfAsset.get(x) ?? [])]).filter((p) => rtoBy.has(p)));
      return { total: procs.size, untested: [...procs].filter((p) => !okProc.has(p)).map((p) => ({ label: "rsc.item.process", path: `/processes/${p}` })) };
    },
    suppliersWithoutAssurance: (assetIds) => {
      const procs = new Set(assetIds.flatMap((x) => [...(procOfAsset.get(x) ?? [])]));
      const sids = new Set([...supA.filter((x) => assetIds.includes(x.assetId)).map((x) => x.supplierId), ...supP.filter((x) => procs.has(x.processId)).map((x) => x.supplierId)]);
      return [...sids].filter((s) => sigById.has(s) && !valid.has(s)).map((s) => ({ label: sigById.get(s)!, path: `/suppliers/${s}` }));
    },
  };
}

/** Výsledná schopnost: změřený stav má přednost, deklarace doplní neznámé (s nižší jistotou). */
export async function capabilityDtos(db: Db, companyId: string, m: Measurement): Promise<CapabilityDto[]> {
  const decl = await db.select({ d: capabilityDeclarations, by: users.displayName }).from(capabilityDeclarations).leftJoin(users, eq(users.id, capabilityDeclarations.declaredById)).where(eq(capabilityDeclarations.companyId, companyId));
  const today = new Date().toISOString().slice(0, 10);
  const rank: Record<CapabilityStatus, number> = { unknown: 0, weak: 1, partial: 2, strong: 3 };
  return CAPABILITY_KEYS.map((key) => {
    const meas = m.capabilities.get(key)!;
    const d = decl.find((x) => x.d.key === key);
    const expired = !!d?.d.validUntil && d.d.validUntil < today;
    const declared = d && !expired ? (d.d.status as CapabilityStatus) : null;
    const status: CapabilityStatus = meas.status !== "unknown" ? meas.status : (declared ?? "unknown");
    return {
      key,
      status,
      confidence: meas.status !== "unknown" ? "measured" : declared ? "declared" : "none",
      measuredStatus: meas.status,
      coverage: meas.coverage,
      metrics: meas.metrics,
      links: meas.links,
      declaration: d ? { status: d.d.status as CapabilityStatus, product: d.d.product, note: d.d.note, url: d.d.url, validUntil: d.d.validUntil, byName: d.by, at: d.d.updatedAt.toISOString(), expired } : null,
      conflict: !!declared && meas.status !== "unknown" && rank[declared] > rank[meas.status],
      requirements: capabilityRequirementIds(key),
    };
  });
}

const hitsOf = (counts: Partial<Record<SignalKey, number>>, items: Partial<Record<SignalKey, { label: string; path: string | null }[]>>): SignalHit[] =>
  (Object.entries(counts) as [SignalKey, number][]).filter(([, n]) => n > 0).map(([key, count]) => ({ key, count, items: (items[key] ?? []).slice(0, MAX_ITEMS) }));

/** Pokrytí technik ATT&CK ze šablon detekcí – alerty za 90 dní, zapnutá hledání, deklarace (v1.22, ADR-119). Jen čtení. */
export async function detectionFor(db: Db, companyId: string, now = new Date()): Promise<DetectionDto> {
  const [alerts, everAlert, hunts, decl] = await Promise.all([
    db
      .select({ mitre: alertSuggestions.mitreIds })
      .from(alertSuggestions)
      .where(and(eq(alertSuggestions.companyId, companyId), gte(alertSuggestions.lastSeen, new Date(now.getTime() - 90 * day)), or(isNull(alertSuggestions.verdict), ne(alertSuggestions.verdict, "false_positive")))),
    db.select({ n: sql<number>`count(*)::int` }).from(alertSuggestions).where(eq(alertSuggestions.companyId, companyId)),
    db.select({ id: socHunts.id, name: socHunts.name, mitre: socHunts.mitreIds }).from(socHunts).where(and(eq(socHunts.companyId, companyId), eq(socHunts.enabled, true))),
    db
      .select({ d: detectionDeclarations, by: users.displayName })
      .from(detectionDeclarations)
      .leftJoin(users, eq(users.id, detectionDeclarations.declaredById))
      .where(eq(detectionDeclarations.companyId, companyId)),
  ]);
  const name = new Map(ATTACK_TECHNIQUES.map((t) => [t.id, t.name]));
  const declOf = new Map(decl.map((x) => [x.d.technique, x]));
  const techniques = scenarioTechniques().map((id) => {
    const a = alerts.filter((x) => x.mitre.some((m) => techniqueMatches(m, id))).length;
    const h = hunts.filter((x) => x.mitre.some((m) => techniqueMatches(m, id)));
    const d = declOf.get(id);
    return {
      id,
      name: name.get(id) ?? null,
      state: detectionState({ alerts: a, hunts: h.length, declared: !!d }),
      alerts: a,
      hunts: h.map((x) => ({ id: x.id, name: x.name })),
      declaration: d ? { source: d.d.source, note: d.d.note, byName: d.by, at: d.d.updatedAt.toISOString() } : null,
      templates: SCENARIO_TEMPLATES.filter((t) => t.attack.includes(id)).map((t) => t.key),
    };
  });
  return { measured: (everAlert[0]?.n ?? 0) > 0 || hunts.length > 0 || decl.length > 0, techniques, summary: detectionSummary(techniques.map((t) => t.state)) };
}

/** Vygeneruje / aktualizuje návrhy pro primární aktiva společnosti. Rozhodnuté návrhy se jen aktualizují (důkazy), zamítnuté se při změně dat znovu otevřou. */
export async function generateProposals(db: Db, companyId: string, now = new Date()) {
  const m = await measureCompany(db, companyId, now);
  const capDtos = await capabilityDtos(db, companyId, m);
  const caps = Object.fromEntries(capDtos.map((c) => [c.key, c.status])) as Partial<Record<CapabilityKey, CapabilityStatus>>;
  const policy = (await settingsFor(db, null, companyId)).riskPolicy;
  const levels = policy.levels;

  // útoky v SOC za 90 dní (techniky ATT&CK) – bez zamítnutých a falešných poplachů
  const alerts = await db
    .select({ mitre: alertSuggestions.mitreIds })
    .from(alertSuggestions)
    .where(and(eq(alertSuggestions.companyId, companyId), gte(alertSuggestions.lastSeen, new Date(now.getTime() - 90 * day)), ne(alertSuggestions.status, "dismissed"), or(isNull(alertSuggestions.verdict), ne(alertSuggestions.verdict, "false_positive"))));
  const alertCount = (attack: string[]) => alerts.filter((a) => a.mitre.some((t) => attack.some((x) => t === x || t.startsWith(`${x}.`)))).length;

  // opatření společnosti mapovaná na požadavky schopností
  const reqIds = new Map<CapabilityKey, { ids: string[]; prefixes: string[] }>();
  for (const c of capDtos) reqIds.set(c.key, { ids: c.requirements.ids, prefixes: [...c.requirements.decree409.map((p) => `cz409:${p}`), ...c.requirements.decree410.map((p) => `cz410:${p}`)] });
  const ctlRows = await db
    .select({ id: controls.id, code: controls.code, name: controls.name, status: controls.status, effectiveness: controls.effectiveness, req: controlRequirements.requirementId })
    .from(controls)
    .innerJoin(controlRequirements, eq(controlRequirements.controlId, controls.id))
    .where(eq(controls.companyId, companyId));
  const controlsFor = (keys: CapabilityKey[]) => {
    const out = new Map<string, ScenarioProposalDto["controls"][number]>();
    for (const r of ctlRows)
      for (const k of keys) {
        const q = reqIds.get(k)!;
        if (q.ids.includes(r.req) || q.prefixes.some((p) => r.req === p || r.req.startsWith(`${p}/`))) out.set(r.id, { id: r.id, code: r.code, name: r.name, status: r.status, effectiveness: r.effectiveness });
      }
    return [...out.values()];
  };

  const det = await detectionFor(db, companyId, now);
  const blindOf = (attack: string[]) => (det.measured ? { blind: attack.filter((id) => det.techniques.find((x) => x.id === id)?.state === "blind").length, total: attack.length } : null);
  const existing = await db.select().from(riskScenarioProposals).where(eq(riskScenarioProposals.companyId, companyId));
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  let reopened = 0;
  for (const [primaryId, supp] of m.supporting) {
    const primary = m.assets.get(primaryId)!;
    const scope = [primaryId, ...supp];
    const counts: Partial<Record<SignalKey, number>> = {};
    const items: Partial<Record<SignalKey, { label: string; path: string | null }[]>> = {};
    for (const aid of scope) {
      const s = m.assetSignals.get(aid) ?? {};
      for (const [k, n] of Object.entries(s) as [SignalKey, number][]) {
        counts[k] = (counts[k] ?? 0) + n;
        (items[k] ??= []).push({ label: m.assets.get(aid)!.name, path: `/assets/${aid}` });
      }
    }
    for (const h of Object.values(m.companySignals)) {
      counts[h!.key] = h!.count;
      items[h!.key] = h!.items;
    }
    const untested = m.untestedProcessesFor(scope);
    if (untested.untested.length) {
      counts.restore_untested = untested.untested.length;
      items.restore_untested = untested.untested;
    }
    const sup = m.suppliersWithoutAssurance(scope);
    if (sup.length) {
      counts.supplier_no_assurance = sup.length;
      items.supplier_no_assurance = sup;
    }
    const hits = hitsOf(counts, items);
    for (const t of SCENARIO_TEMPLATES) {
      const key = `${t.key}|${primaryId}`;
      seen.add(key);
      const cur = existing.find((e) => e.templateKey === t.key && e.primaryAssetId === primaryId);
      const relevant = hits.filter((h) => h.key in t.signals);
      const scopeAssets = scope.map((id) => m.assets.get(id)).filter((a): a is AssetRow => !!a);
      if (!templateApplies(t, scopeAssets) || !scenarioTriggered(t, relevant, caps)) {
        if (cur && cur.status === "proposed") await db.update(riskScenarioProposals).set({ status: "obsolete", generatedAt: now, updatedAt: now }).where(eq(riskScenarioProposals.id, cur.id));
        continue;
      }
      const capList = t.capabilities.map((k) => ({ key: k, status: caps[k] ?? ("unknown" as CapabilityStatus) }));
      const al = alertCount(t.attack);
      const ev: ScenarioEvaluation = evaluateScenario(t, { levels, cia: { c: primary.c, i: primary.i, a: primary.a }, criticality: primary.criticality, hits: relevant, capabilities: caps, alerts: al, detection: blindOf(t.attack) });
      const fp = scenarioFingerprint(relevant, caps, t);
      const evidence = { hits: relevant, capabilities: capList, alerts: al, reasons: ev.reasons, controls: controlsFor(t.capabilities), supportingAssets: supp.map((id) => ({ id, name: m.assets.get(id)!.name })) };
      const values = { levels, impact: ev.impact, threatLevel: ev.threatLevel, vulnLevel: ev.vulnLevel, likelihood: ev.likelihood, lowConfidence: ev.lowConfidence, evidence, fingerprint: fp, generatedAt: now, updatedAt: now };
      if (!cur) {
        await db.insert(riskScenarioProposals).values({ ...values, companyId, templateKey: t.key, primaryAssetId: primaryId, status: "proposed" });
        created++;
      } else {
        const reopen = (cur.status === "rejected" && cur.decidedFingerprint !== fp) || cur.status === "obsolete";
        await db
          .update(riskScenarioProposals)
          .set({ ...values, ...(cur.fingerprint !== fp ? { fingerprintChangedAt: now } : {}), ...(reopen ? { status: "proposed" as ScenarioStatus } : {}) })
          .where(eq(riskScenarioProposals.id, cur.id));
        if (reopen && cur.status === "rejected") reopened++;
        else updated++;
      }
    }
  }
  // primární aktivum už není primární / bylo vyřazeno → otevřené návrhy jsou neaktuální
  const stale = existing.filter((e) => e.status === "proposed" && !seen.has(`${e.templateKey}|${e.primaryAssetId}`)).map((e) => e.id);
  if (stale.length) await db.update(riskScenarioProposals).set({ status: "obsolete", updatedAt: now }).where(inArray(riskScenarioProposals.id, stale));
  return { created, updated, reopened, obsolete: stale.length, primaryAssets: m.supporting.size };
}

/* ============================================================
 * Pokrytí katalogu hrozeb (v1.18, ADR-115) – jen čtení; „nerelevantní“ ukládá člověk se zdůvodněním.
 * ============================================================ */

export async function threatCoverage(db: Db, companyId: string): Promise<ThreatCoverageDto> {
  const prim = await db
    .select({ id: assets.id, name: assets.name, criticality: assets.criticality })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), eq(assets.assetClass, "primary"), inArray(assets.lifecycleStatus, ["active", "maintenance"])))
    .orderBy(assets.name);
  const threats = await db
    .select({ id: riskCatalog.id, code: riskCatalog.code, name: riskCatalog.name, category: riskCatalog.category })
    .from(riskCatalog)
    .where(and(eq(riskCatalog.kind, "threat"), eq(riskCatalog.isActive, true)))
    .orderBy(riskCatalog.code, riskCatalog.name);
  const primIds = prim.map((a) => a.id);
  if (!primIds.length || !threats.length) return { threats, assets: prim.map((a) => ({ ...a, cells: {}, assessed: 0 })), summary: threatCoverageSummary([]) };

  // primární aktivum → podpůrná (vazby + jeden krok technických závislostí), stejně jako u návrhů scénářů
  const links = await db.select({ p: assetLinks.primaryId, s: assetLinks.supportingId }).from(assetLinks).where(inArray(assetLinks.primaryId, primIds));
  const direct = [...new Set(links.map((l) => l.s))];
  const deps = direct.length ? await db.select({ from: assetDependencies.fromId, to: assetDependencies.toId }).from(assetDependencies).where(inArray(assetDependencies.fromId, direct)) : [];
  const scopeOf = new Map<string, Set<string>>();
  for (const id of primIds) {
    const d = links.filter((l) => l.p === id).map((l) => l.s);
    scopeOf.set(id, new Set([id, ...d, ...deps.filter((x) => d.includes(x.from)).map((x) => x.to)]));
  }
  const allAssets = [...new Set([...scopeOf.values()].flatMap((x) => [...x]))];

  // rizika společnosti (mimo uzavřená) na aktivech rozsahu – hlavní i další hrozby
  const ra = await db
    .select({ riskId: risks.id, name: risks.name, threatId: risks.threatId, assetId: riskAssets.assetId })
    .from(riskAssets)
    .innerJoin(risks, eq(risks.id, riskAssets.riskId))
    .where(and(eq(risks.companyId, companyId), ne(risks.status, "closed"), inArray(riskAssets.assetId, allAssets)));
  const riskIds = [...new Set(ra.map((r) => r.riskId))];
  const more = riskIds.length ? await db.select({ riskId: riskCatalogLinks.riskId, catalogId: riskCatalogLinks.catalogId }).from(riskCatalogLinks).where(inArray(riskCatalogLinks.riskId, riskIds)) : [];
  const threatsOfRisk = new Map<string, Set<string>>();
  for (const r of ra) if (r.threatId) (threatsOfRisk.get(r.riskId) ?? threatsOfRisk.set(r.riskId, new Set()).get(r.riskId)!).add(r.threatId);
  for (const l of more) (threatsOfRisk.get(l.riskId) ?? threatsOfRisk.set(l.riskId, new Set()).get(l.riskId)!).add(l.catalogId);
  const riskName = new Map(ra.map((r) => [r.riskId, r.name]));
  const risksOnAsset = new Map<string, Set<string>>();
  for (const r of ra) (risksOnAsset.get(r.assetId) ?? risksOnAsset.set(r.assetId, new Set()).get(r.assetId)!).add(r.riskId);

  // otevřené návrhy scénářů z dat → hrozby šablony
  const codeToId = new Map(threats.filter((t) => t.code).map((t) => [t.code!, t.id]));
  const props = await db
    .select({ id: riskScenarioProposals.id, templateKey: riskScenarioProposals.templateKey, assetId: riskScenarioProposals.primaryAssetId })
    .from(riskScenarioProposals)
    .where(and(eq(riskScenarioProposals.companyId, companyId), eq(riskScenarioProposals.status, "proposed")));

  const na = await db
    .select({ assetId: threatAssessments.assetId, catalogId: threatAssessments.catalogId, reason: threatAssessments.reason, by: users.displayName, at: threatAssessments.decidedAt })
    .from(threatAssessments)
    .leftJoin(users, eq(users.id, threatAssessments.decidedById))
    .where(eq(threatAssessments.companyId, companyId));
  const naOf = new Map(na.map((x) => [`${x.assetId}|${x.catalogId}`, x]));

  const states: ThreatCoverageCell["state"][] = [];
  const rows = prim.map((a) => {
    const scope = scopeOf.get(a.id)!;
    const rset = new Set([...scope].flatMap((x) => [...(risksOnAsset.get(x) ?? [])]));
    const propsByThreat = new Map<string, string[]>();
    for (const p of props.filter((x) => x.assetId === a.id)) {
      const t = templateByKey(p.templateKey);
      if (!t) continue;
      for (const code of [t.threat, ...t.moreThreats]) {
        const id = codeToId.get(code);
        if (id) propsByThreat.set(id, [...(propsByThreat.get(id) ?? []), p.id]);
      }
    }
    const cells: Record<string, ThreatCoverageCell> = {};
    let assessed = 0;
    for (const t of threats) {
      const rs = [...rset].filter((r) => threatsOfRisk.get(r)?.has(t.id));
      const ps = propsByThreat.get(t.id) ?? [];
      const n = naOf.get(`${a.id}|${t.id}`);
      const state = threatCellState({ risks: rs.length, proposals: ps.length, notRelevant: !!n });
      states.push(state);
      if (state !== "unassessed") assessed++;
      cells[t.id] = { state, risks: rs.map((id) => ({ id, name: riskName.get(id)! })), proposalIds: ps, reason: n?.reason ?? null, decidedByName: n?.by ?? null, decidedAt: n?.at.toISOString() ?? null };
    }
    return { ...a, cells, assessed };
  });
  return { threats, assets: rows, summary: threatCoverageSummary(states) };
}

/* ============================================================
 * Analýza rizik z dat pro zprávu o hodnocení rizik (v1.19, ADR-116) – jen čtení, výsledek se zmrazí ve snímku.
 * Vrací null, když společnost nemá primární aktiva ani scénáře z dat (část se do zprávy nepřidá).
 * ============================================================ */

export async function riskDataReport(db: Db, companyId: string, period: { from?: string | null; to?: string | null } = {}, now = new Date()): Promise<RiskDataReport | null> {
  const cov = await threatCoverage(db, companyId);
  const [{ n: proposalCount } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(riskScenarioProposals).where(eq(riskScenarioProposals.companyId, companyId));
  if (!cov.assets.length && !proposalCount) return null;
  const caps = await capabilityDtos(db, companyId, await measureCompany(db, companyId, now));
  const label = (t: { code: string | null; name: string }) => (t.code ? `${t.code} – ${t.name}` : t.name);
  const threatById = new Map(cov.threats.map((t) => [t.id, t]));
  const notRelevant: RiskDataReport["coverage"]["notRelevant"] = [];
  const assetsOut = cov.assets.map((a) => {
    const cells = Object.entries(a.cells);
    const by = (st: string) => cells.filter(([, c]) => c.state === st);
    for (const [id, c] of cells)
      if (c.reason) notRelevant.push({ asset: a.name, threat: label(threatById.get(id)!), reason: c.reason, by: c.decidedByName, at: c.decidedAt, });
    return {
      name: a.name,
      criticality: a.criticality,
      risk: by("risk").length,
      proposed: by("proposed").length,
      notRelevant: by("not_relevant").length,
      unassessed: by("unassessed").length,
      unassessedCodes: by("unassessed").map(([id]) => threatById.get(id)!.code ?? threatById.get(id)!.name),
    };
  });

  const props = await db
    .select({ p: riskScenarioProposals, asset: assets.name, risk: risks.name, riskCode: risks.code, by: users.displayName, baseline: sql<Date | null>`case when ${risks.id} is null then null else ${riskBaselineSql} end` })
    .from(riskScenarioProposals)
    .innerJoin(assets, eq(assets.id, riskScenarioProposals.primaryAssetId))
    .leftJoin(risks, eq(risks.id, riskScenarioProposals.riskId))
    .leftJoin(users, eq(users.id, riskScenarioProposals.decidedById))
    .where(eq(riskScenarioProposals.companyId, companyId))
    .orderBy(assets.name, riskScenarioProposals.templateKey);
  const counts = { proposed: 0, accepted: 0, linked: 0, rejected: 0, obsolete: 0 } as Record<ScenarioStatus, number>;
  for (const x of props) counts[x.p.status as ScenarioStatus]++;
  const tpl = (k: string) => RISK_SCENARIO_LABELS.template[k as keyof typeof RISK_SCENARIO_LABELS.template] ?? k;
  const decided = props
    .filter((x) => ["accepted", "linked", "rejected"].includes(x.p.status))
    .map((x) => ({
      template: tpl(x.p.templateKey),
      asset: x.asset,
      status: x.p.status as ScenarioStatus,
      risk: x.risk ? `${x.riskCode ? `${x.riskCode} ` : ""}${x.risk}` : null,
      reason: x.p.reason,
      by: x.by,
      at: x.p.decidedAt?.toISOString() ?? null,
      changed: !!x.p.decidedFingerprint && x.p.decidedFingerprint !== x.p.fingerprint && x.p.status !== "rejected" && (!x.baseline || x.p.fingerprintChangedAt.getTime() > new Date(x.baseline).getTime()),
    }));

  const rv = await db
    .select({ r: riskReviews, name: risks.name, code: risks.code, by: users.displayName })
    .from(riskReviews)
    .innerJoin(risks, eq(risks.id, riskReviews.riskId))
    .leftJoin(users, eq(users.id, riskReviews.userId))
    .where(
      and(
        eq(riskReviews.companyId, companyId),
        period.from ? gte(riskReviews.createdAt, new Date(`${period.from}T00:00:00Z`)) : undefined,
        period.to ? sql`${riskReviews.createdAt} < (${period.to}::date + 1)` : undefined,
      ),
    )
    .orderBy(riskReviews.createdAt);
  const open = await db.select({ id: risks.id, name: risks.name, code: risks.code }).from(risks).where(and(eq(risks.companyId, companyId), ne(risks.status, "closed")));
  const trig = await riskTriggers(db, open.map((r) => r.id));
  const nm = (r: { code: string | null; name: string }) => `${r.code ? `${r.code} ` : ""}${r.name}`;
  const det = await detectionFor(db, companyId, now);
  return {
    ...(det.measured ? { detection: { summary: det.summary, blind: det.techniques.filter((x) => x.state === "blind").map((x) => (x.name ? `${x.id} ${x.name}` : x.id)) } } : {}),
    generatedAt: now.toISOString(),
    capabilities: caps.map((c) => ({ key: c.key, status: c.status, confidence: c.confidence, coverage: c.coverage, product: c.declaration?.product ?? null, note: c.declaration?.note ?? null, validUntil: c.declaration?.validUntil ?? null, conflict: c.conflict, metrics: c.metrics })),
    coverage: { summary: cov.summary, threats: cov.threats.length, assets: assetsOut, notRelevant },
    scenarios: { counts, decided },
    reviews: rv.map((x) => ({ risk: nm(x), decision: x.r.decision as "confirmed" | "changed", note: x.r.note, kinds: [...new Set((x.r.triggers ?? []).map((t) => t.kind))], levelBefore: x.r.levelBefore, levelAfter: x.r.levelAfter, by: x.by, at: x.r.createdAt.toISOString() })),
    pending: open
      .filter((r) => trig.get(r.id)?.length)
      .map((r) => {
        const l = trig.get(r.id)!;
        return { risk: nm(r), kinds: [...new Set(l.map((t) => t.kind))], strong: l.some((t) => t.strong), due: triggerDue(l) };
      }),
  };
}

/* ============================================================
 * Denní obnova návrhů (v1.18, ADR-115) – jen u společností, které scénáře z dat už používají
 * (mají aspoň jeden návrh). Mění jen návrhy, nikdy rizika.
 * ============================================================ */

let refreshing = false;
export async function processScenarioRefresh(db: Db, now = new Date()) {
  if (refreshing) return { companies: 0 };
  refreshing = true;
  try {
    const last = await db
      .select({ companyId: riskScenarioProposals.companyId, at: sql<Date>`max(${riskScenarioProposals.generatedAt})` })
      .from(riskScenarioProposals)
      .innerJoin(companies, eq(companies.id, riskScenarioProposals.companyId))
      .groupBy(riskScenarioProposals.companyId);
    let n = 0;
    for (const r of last) {
      if (now.getTime() - new Date(r.at).getTime() < day) continue;
      await generateProposals(db, r.companyId, now).catch((e) => console.error("Rizikové scénáře z dat:", (e as Error).message));
      n++;
    }
    return { companies: n };
  } finally {
    refreshing = false;
  }
}

export function scenarioRoutes(db: Db, deps: { dispatch: () => Dispatch }) {
  async function proposalDtos(where: ReturnType<typeof and>): Promise<ScenarioProposalDto[]> {
    const rows = await db
      .select({ p: riskScenarioProposals, asset: assets.name, risk: risks.name, baseline: sql<Date | null>`case when ${risks.id} is null then null else ${riskBaselineSql} end`, by: users.displayName })
      .from(riskScenarioProposals)
      .innerJoin(assets, eq(assets.id, riskScenarioProposals.primaryAssetId))
      .leftJoin(risks, eq(risks.id, riskScenarioProposals.riskId))
      .leftJoin(users, eq(users.id, riskScenarioProposals.decidedById))
      .where(where)
      .orderBy(sql`${riskScenarioProposals.impact} * ${riskScenarioProposals.likelihood} desc`, assets.name);
    return rows.map(({ p, asset, risk, baseline, by }) => {
      const e = p.evidence as Record<string, any>;
      return {
        id: p.id,
        companyId: p.companyId,
        templateKey: p.templateKey,
        primaryAssetId: p.primaryAssetId,
        primaryAssetName: asset,
        status: p.status as ScenarioStatus,
        levels: p.levels,
        impact: p.impact,
        threatLevel: p.threatLevel,
        vulnLevel: p.vulnLevel,
        likelihood: p.likelihood,
        lowConfidence: p.lowConfidence,
        hits: e.hits ?? [],
        capabilities: e.capabilities ?? [],
        alerts: e.alerts ?? 0,
        reasons: e.reasons ?? [],
        controls: e.controls ?? [],
        supportingAssets: e.supportingAssets ?? [],
        riskId: p.riskId,
        riskName: risk,
        reason: p.reason,
        decidedByName: by,
        decidedAt: p.decidedAt?.toISOString() ?? null,
        changedSinceDecision:
          !!p.decidedFingerprint && p.decidedFingerprint !== p.fingerprint && (p.status === "accepted" || p.status === "linked") && (!baseline || p.fingerprintChangedAt.getTime() > new Date(baseline).getTime()),
        generatedAt: p.generatedAt.toISOString(),
      };
    });
  }
  async function proposal(c: Ctx, id: string) {
    const [p] = await db.select().from(riskScenarioProposals).where(eq(riskScenarioProposals.id, id));
    if (!p) throw new HTTPException(404, { message: "Návrh nenalezen" });
    assertScope(c, p.companyId, "Návrh nenalezen");
    return p;
  }
  const decided = (c: Ctx, fp: string) => ({ decidedById: currentUser(c).id, decidedAt: new Date(), decidedFingerprint: fp, updatedAt: new Date() });

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "risks"))
    .get("/capabilities", requirePerm("risks:read"), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      return c.json(await capabilityDtos(db, companyId, await measureCompany(db, companyId)));
    })
    .put("/capabilities/:key", requirePerm("risks:write"), zValidator("json", CapabilityDeclarationInput), async (c) => {
      const key = c.req.param("key") as CapabilityKey;
      if (!CAPABILITY_KEYS.includes(key)) throw new HTTPException(404, { message: "Neznámá schopnost" });
      const companyId = targetCompany(c, null, "risks:write");
      const v = c.req.valid("json");
      const row = { status: v.status, product: v.product ?? null, note: v.note ?? null, url: v.url ?? null, validUntil: v.validUntil ?? null, declaredById: currentUser(c).id, updatedAt: new Date() };
      await db
        .insert(capabilityDeclarations)
        .values({ ...row, companyId, key })
        .onConflictDoUpdate({ target: [capabilityDeclarations.companyId, capabilityDeclarations.key], set: row });
      await audit(db, { c, user: currentUser(c), action: "risk.capability_declared", entityType: "company", entityId: companyId, details: { key, status: v.status, product: v.product ?? null } });
      return c.json(await capabilityDtos(db, companyId, await measureCompany(db, companyId)));
    })
    .delete("/capabilities/:key", requirePerm("risks:write"), async (c) => {
      const companyId = targetCompany(c, null, "risks:write");
      await db.delete(capabilityDeclarations).where(and(eq(capabilityDeclarations.companyId, companyId), eq(capabilityDeclarations.key, c.req.param("key"))));
      await audit(db, { c, user: currentUser(c), action: "risk.capability_declaration_removed", entityType: "company", entityId: companyId, details: { key: c.req.param("key") } });
      return c.json(await capabilityDtos(db, companyId, await measureCompany(db, companyId)));
    })
    .get("/detection", requirePerm("risks:read"), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      return c.json(await detectionFor(db, companyId));
    })
    .put("/detection/:technique", requirePerm("risks:write"), zValidator("json", DetectionDeclarationInput), async (c) => {
      const technique = c.req.param("technique");
      if (!scenarioTechniques().includes(technique)) throw new HTTPException(404, { message: "Technika není v rozsahu scénářů" });
      const companyId = targetCompany(c, null, "risks:write");
      const v = c.req.valid("json");
      const row = { source: v.source, note: v.note ?? null, declaredById: currentUser(c).id, updatedAt: new Date() };
      await db.insert(detectionDeclarations).values({ ...row, companyId, technique }).onConflictDoUpdate({ target: [detectionDeclarations.companyId, detectionDeclarations.technique], set: row });
      await audit(db, { c, user: currentUser(c), action: "risk.detection_declared", entityType: "company", entityId: companyId, details: { technique, source: v.source } });
      return c.json(await detectionFor(db, companyId));
    })
    .delete("/detection/:technique", requirePerm("risks:write"), async (c) => {
      const companyId = targetCompany(c, null, "risks:write");
      await db.delete(detectionDeclarations).where(and(eq(detectionDeclarations.companyId, companyId), eq(detectionDeclarations.technique, c.req.param("technique"))));
      await audit(db, { c, user: currentUser(c), action: "risk.detection_declaration_removed", entityType: "company", entityId: companyId, details: { technique: c.req.param("technique") } });
      return c.json(await detectionFor(db, companyId));
    })
    .get("/coverage", requirePerm("risks:read"), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      return c.json(await threatCoverage(db, companyId));
    })
    .put("/coverage/:assetId/:catalogId", requirePerm("risks:write"), zValidator("json", ThreatAssessmentInput), async (c) => {
      const { assetId, catalogId } = c.req.param();
      const [a] = await db.select({ id: assets.id, companyId: assets.companyId, assetClass: assets.assetClass }).from(assets).where(eq(assets.id, assetId));
      if (!a) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
      assertScope(c, a.companyId, "Aktivum nenalezeno");
      if (!hasPermIn(c, "risks:write", a.companyId)) throw new HTTPException(403, { message: "Nedostatečné oprávnění" });
      if (a.assetClass !== "primary") throw new HTTPException(400, { message: "Pokrytí hrozeb se posuzuje u primárních aktiv." });
      const [t] = await db.select({ id: riskCatalog.id, kind: riskCatalog.kind }).from(riskCatalog).where(eq(riskCatalog.id, catalogId));
      if (!t || t.kind !== "threat") throw new HTTPException(404, { message: "Hrozba v katalogu nenalezena" });
      const v = c.req.valid("json");
      const row = { reason: v.reason, decidedById: currentUser(c).id, decidedAt: new Date() };
      await db
        .insert(threatAssessments)
        .values({ ...row, companyId: a.companyId, assetId, catalogId })
        .onConflictDoUpdate({ target: [threatAssessments.assetId, threatAssessments.catalogId], set: row });
      await audit(db, { c, user: currentUser(c), action: "risk.threat_not_relevant", entityType: "asset", entityId: assetId, details: { catalogId, reason: v.reason } });
      return c.json(await threatCoverage(db, a.companyId));
    })
    .delete("/coverage/:assetId/:catalogId", requirePerm("risks:write"), async (c) => {
      const { assetId, catalogId } = c.req.param();
      const [r] = await db.select({ companyId: threatAssessments.companyId }).from(threatAssessments).where(and(eq(threatAssessments.assetId, assetId), eq(threatAssessments.catalogId, catalogId)));
      if (!r) throw new HTTPException(404, { message: "Posouzení nenalezeno" });
      assertScope(c, r.companyId, "Posouzení nenalezeno");
      if (!hasPermIn(c, "risks:write", r.companyId)) throw new HTTPException(403, { message: "Nedostatečné oprávnění" });
      await db.delete(threatAssessments).where(and(eq(threatAssessments.assetId, assetId), eq(threatAssessments.catalogId, catalogId)));
      await audit(db, { c, user: currentUser(c), action: "risk.threat_not_relevant_removed", entityType: "asset", entityId: assetId, details: { catalogId } });
      return c.json(await threatCoverage(db, r.companyId));
    })
    .get("/", requirePerm("risks:read"), zValidator("query", z.object({ status: z.enum(["open", "all"]).default("open") })), async (c) => {
      const open = c.req.valid("query").status === "open";
      return c.json(await proposalDtos(and(inScope(c, riskScenarioProposals.companyId), open ? inArray(riskScenarioProposals.status, ["proposed"]) : undefined)));
    })
    .post("/generate", requirePerm("risks:write"), async (c) => {
      const companyId = targetCompany(c, null, "risks:write");
      const r = await generateProposals(db, companyId);
      await audit(db, { c, user: currentUser(c), action: "risk.scenarios_generated", entityType: "company", entityId: companyId, details: r });
      return c.json(r);
    })
    /** Přijetí návrhu = nové riziko přes POST /api/risks (stejné validace, audit a vazby). */
    .post("/:id/accept", requirePerm("risks:write"), zValidator("json", ScenarioAcceptInput), async (c) => {
      const p = await proposal(c, c.req.param("id"));
      if (p.status !== "proposed") throw new HTTPException(409, { message: "Návrh už byl rozhodnut." });
      const t = templateByKey(p.templateKey);
      if (!t) throw new HTTPException(409, { message: "Šablona scénáře už neexistuje." });
      const o = c.req.valid("json");
      const e = p.evidence as Record<string, any>;
      const cat = await db.select({ id: riskCatalog.id, code: riskCatalog.code, kind: riskCatalog.kind }).from(riskCatalog).where(inArray(riskCatalog.code, [t.threat, ...t.moreThreats, ...t.weaknesses]));
      const idOf = (code: string, kind: string) => cat.find((x) => x.code === code && x.kind === kind)?.id ?? null;
      const policy = (await settingsFor(db, null, p.companyId)).riskPolicy;
      const [asset] = await db.select({ name: assets.name }).from(assets).where(eq(assets.id, p.primaryAssetId));
      const impact = o.impact ?? p.impact;
      const threatLevel = o.threatLevel ?? p.threatLevel;
      const vulnLevel = o.vulnLevel ?? p.vulnLevel;
      const builtin = policy.methodology === "zkb409" || !policy.methodology;
      const levelsOk = p.levels === policy.levels;
      const scored = builtin && levelsOk ? (policy.method === "two_factor" ? { impact, likelihood: Math.round((threatLevel + vulnLevel) / 2) } : { impact, threatLevel, vulnLevel }) : {};
      const evidenceText = [
        "Návrh z dat CONTIXu (rizikové scénáře, ADR-114).",
        ...((e.hits ?? []) as { key: SignalKey; count: number }[]).map((h) => `• ${RISK_SCENARIO_LABELS.signal[h.key] ?? h.key}: ${h.count}`),
        e.alerts ? `• alerty SOC se stejnými technikami ATT&CK za 90 dní: ${e.alerts}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const payload = {
        companyId: p.companyId,
        name: o.name ?? `${RISK_SCENARIO_LABELS.template[t.key as keyof typeof RISK_SCENARIO_LABELS.template] ?? t.key}: ${asset?.name ?? ""}`.slice(0, 500),
        description: evidenceText.slice(0, 10000),
        threatId: idOf(t.threat, "threat"),
        weaknessId: idOf(t.weaknesses[0]!, "weakness"),
        moreThreatIds: t.moreThreats.map((x) => idOf(x, "threat")).filter(Boolean),
        moreWeaknessIds: t.weaknesses.slice(1).map((x) => idOf(x, "weakness")).filter(Boolean),
        ownerPositionId: o.ownerPositionId ?? null,
        assetIds: [p.primaryAssetId, ...((e.supportingAssets ?? []) as { id: string }[]).map((x) => x.id)],
        controlIds: ((e.controls ?? []) as { id: string }[]).map((x) => x.id),
        ...scored,
      };
      const base = new URL(c.req.url);
      const res = await deps.dispatch()(
        new Request(`${base.origin}/api/risks`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: c.req.header("cookie") ?? "", authorization: c.req.header("authorization") ?? "", origin: c.req.header("origin") ?? base.origin, "x-forwarded-for": c.req.header("x-forwarded-for") ?? "", "x-contix-company": p.companyId },
          body: JSON.stringify(payload),
        }),
      );
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !body?.id) throw new HTTPException(res.status === 403 ? 403 : 400, { message: body?.error ?? "Riziko se nepodařilo založit." });
      await db.update(riskScenarioProposals).set({ status: "accepted", riskId: body.id, ...decided(c, p.fingerprint) }).where(eq(riskScenarioProposals.id, p.id));
      await audit(db, { c, user: currentUser(c), action: "risk.scenario_accepted", entityType: "risk", entityId: body.id, details: { proposalId: p.id, template: p.templateKey, assetId: p.primaryAssetId } });
      return c.json({ riskId: body.id, proposal: (await proposalDtos(eq(riskScenarioProposals.id, p.id)))[0] }, 201);
    })
    .post("/:id/decision", requirePerm("risks:write"), zValidator("json", ScenarioDecisionInput), async (c) => {
      const p = await proposal(c, c.req.param("id"));
      const v = c.req.valid("json");
      if (v.action === "reopen") {
        if (p.status !== "rejected") throw new HTTPException(409, { message: "Znovu otevřít lze jen zamítnutý návrh." });
        await db.update(riskScenarioProposals).set({ status: "proposed", reason: null, decidedById: null, decidedAt: null, decidedFingerprint: null, updatedAt: new Date() }).where(eq(riskScenarioProposals.id, p.id));
      } else {
        if (p.status !== "proposed") throw new HTTPException(409, { message: "Návrh už byl rozhodnut." });
        if (v.action === "link") {
          const [r] = await db.select({ id: risks.id, companyId: risks.companyId }).from(risks).where(eq(risks.id, v.riskId));
          if (!r || r.companyId !== p.companyId) throw new HTTPException(400, { message: "Riziko nepatří do společnosti návrhu." });
          await db.update(riskScenarioProposals).set({ status: "linked", riskId: r.id, reason: v.reason ?? null, ...decided(c, p.fingerprint) }).where(eq(riskScenarioProposals.id, p.id));
        } else await db.update(riskScenarioProposals).set({ status: "rejected", reason: v.reason, ...decided(c, p.fingerprint) }).where(eq(riskScenarioProposals.id, p.id));
      }
      await audit(db, { c, user: currentUser(c), action: `risk.scenario_${v.action === "link" ? "linked" : v.action === "reject" ? "rejected" : "reopened"}`, entityType: "company", entityId: p.companyId, details: { proposalId: p.id, template: p.templateKey, assetId: p.primaryAssetId, ...(v.action === "link" ? { riskId: v.riskId } : {}), ...(v.action === "reject" ? { reason: v.reason } : {}) } });
      return c.json((await proposalDtos(eq(riskScenarioProposals.id, p.id)))[0]);
    });
}
