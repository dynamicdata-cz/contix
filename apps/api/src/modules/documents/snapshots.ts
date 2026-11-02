/**
 * Snímky (snapshoty) dokumentů ISMS – zmrazený obsah v okamžiku vytvoření verze.
 * Snímek je čistá data (JSON); HTML se z něj vykresluje v render.ts.
 */
import { profileOf, portfolio, reportBasisFor, reportBasisOf, type ReportBasis,
  type QuantPolicy,
  BUILTIN_RISK_METHODOLOGY,
  getRiskMethodology,
  residualValues,
  scoreMethodology,
  type FactorValues,
  type RiskMethodologyDef,
  BUILTIN_THREATS,
  BUILTIN_WEAKNESSES,
  complianceScore,
  CONTROL_LABELS,
  effectiveBounds,
  FRAMEWORKS,
  isAcceptable,
  maxScore,
  RISK_LEVELS,
  riskScore,
  scaleFor,
  type ComplianceSummary,
  type FrameworkId,
  type RequirementRow,
  type RiskLevel,
  type RiskPolicy,
  type ScaleLevels,
  type ScaleStep,
  type Settings,
  type TreatmentActionDto,
  nextTestDate,
  ancestorsOf,
  type DocKind,
  type ObjectiveDto,
  type RiskDataReport,
  type RiskAppetiteDto,
} from "@contix/shared";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../../db/client";
import { biaAssessments, riskReviews, changes, continuityPlans, documentVersions, planTests, positions, riskCatalog, risks, suppliers } from "../../db/schema";
import { loadChanges, loadObjectives, periodWhere } from "../isms/routes";
import { loadSuppliers } from "../suppliers/routes";
import { getCompanies } from "../../auth/scope";
import { incidentSummary, type IncidentSummary } from "../incidents/routes";
import { auditSummary, type AuditSummary } from "../audits/routes";
import { loadRequirementRows, summarize } from "../controls/routes";
import { quantOf } from "../risks/quant";
import { loadActions } from "../risks/routes";
import { riskTriggers } from "../risks/triggers";
import { infoItemsForReport, type InfoReportItem } from "../infoservice/routes";

export interface SnapshotMeta {
  organizationName: string;
  organizationIco: string;
  organizationAddress: string;
  regulatedServices: string;
  generatedAt: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  /** Rámec a právní základ výstupu (ADR-086); starší snímky ho nemají = vyhláška 409. */
  basis?: ReportBasis;
}

export interface SoaSnapshot {
  type: "soa";
  meta: SnapshotMeta;
  framework: { id: FrameworkId; name: string; source: string; fullText: boolean };
  summary: ComplianceSummary;
  rows: (Pick<
    RequirementRow,
    "id" | "section" | "sectionTitle" | "ref" | "lead" | "text" | "points" | "applicable" | "justification" | "compensating" | "implementationNote" | "compliance" | "priority" | "dueDate" | "ownerPositionName"
  > & { controls: { code: string | null; name: string; status: string }[] })[];
}

export interface RiskRow {
  code: string | null;
  name: string;
  status: string;
  threat: string | null;
  weakness: string | null;
  owner: string | null;
  assets: string[];
  processes: string[];
  impact: number | null;
  threatLevel: number | null;
  vulnLevel: number | null;
  likelihood: number | null;
  score: number | null;
  level: RiskLevel | null;
  acceptable: boolean | null;
  treatment: string | null;
  treatmentDue: string | null;
  residualScore: number | null;
  residualLevel: RiskLevel | null;
  scaleLevels: number;
  assessedAt: string | null;
  description: string | null;
  /** Metodika hodnocení rizika a hodnoty faktorů (u importovaných metodik, např. OCTAVE). */
  methodologyKey?: string;
  factorValues?: FactorValues | null;
  /** Název úrovně v metodice (např. „Pool 1“). */
  levelLabel?: string | null;
}

export interface RiskReportSnapshot {
  type: "risk_report";
  meta: SnapshotMeta;
  policy: RiskPolicy;
  /** Zmrazená definice importované metodiky (u vestavěné metodiky dle vyhlášky chybí). */
  methodology?: RiskMethodologyDef;
  maxScore: number;
  bounds: { maxLow: number; maxMedium: number; maxHigh: number };
  scales: { impact: ScaleStep[]; threat: ScaleStep[]; vulnerability: ScaleStep[]; likelihood: ScaleStep[] };
  inputs: Record<string, string>;
  counts: { total: number; byLevel: Record<RiskLevel | "unassessed", number>; residualByLevel: Record<RiskLevel | "unassessed", number>; unacceptable: number; untreated: number };
  matrix: number[][];
  risks: RiskRow[];
  /** Pokrytí kategorií přílohy č. 3: kolik rizik se ke kategorii váže. */
  coverage: { kind: "threat" | "weakness"; code: string; name: string; risks: number }[];
  actions: TreatmentActionDto[];
  /** Kvantitativní analýza (FAIR) – jen pokud jsou některá rizika kvantifikována. */
  quant?: {
    policy: QuantPolicy;
    items: { code: string | null; name: string; ale: number; p95: number; level: RiskLevel; residualAle: number | null; rosi: number | null }[];
    portfolio: { mean: number; p95: number; p99: number } | null;
    residualPortfolio: { mean: number; p95: number } | null;
  };
  /** Významné změny z evidence (§ 11) za hodnocené období – pokud je modul Řízení ISMS zapnutý. */
  significantChanges?: { code: string | null; title: string; status: string; day: string | null }[];
  /** Varování a upozornění regulátora (informační servis, ADR-088) za období s výsledkem posouzení. */
  infoItems?: InfoReportItem[];
  /** Incidenty v období (bod 5 vstupů) – pokud je modul Incidenty zapnutý. */
  incidents?: { code: string | null; title: string; category: string; detectedAt: string; significant: boolean }[];
  /** Dokončené audity a otevřená zjištění (bod 6 vstupů) – pokud je modul Audity zapnutý. */
  audits?: { audits: { code: string | null; title: string; performedEnd: string | null; findings: Record<string, number> }[]; openFindings: number; overdueFindings: number };
  /** Analýza rizik z dat – schopnosti, pokrytí katalogu hrozeb, scénáře, přehodnocení (v1.19, ADR-116). */
  dataDriven?: RiskDataReport;
  /** Ochota riskovat a KRI ke dni vytvoření (v1.23, ADR-120). */
  appetite?: RiskAppetiteDto;
}

export interface PlanSnapshot {
  type: "treatment_plan";
  meta: SnapshotMeta;
  actions: TreatmentActionDto[];
  totals: { open: number; done: number; overdue: number; cost: number };
}

export interface IsmsReviewSnapshot {
  type: "isms_review";
  meta: SnapshotMeta;
  regime: string;
  inputs: Record<string, string>;
  modules: string[];
  objectives: ObjectiveDto[];
  plan: { open: number; done: number; overdue: number; cancelled: number; cost: number; overdueActions: TreatmentActionDto[] } | null;
  risks: { total: number; byLevel: Record<RiskLevel | "unassessed", number>; unacceptable: number; untreated: number; notAssessedInPeriod: number; reviewMonths: number;
    /** Přehodnocení z podnětů (ADR-058): čekající rozhodnutí a rozhodnutí v období (od v0.63). */
    reassessment?: { pending: number; changed: number; confirmed: number; pendingRisks: { code: string | null; name: string; triggers: number; kinds: string[] }[] };
  } | null;
  compliance: { framework: string; name: string; score: number; applicable: number; compliant: number; partial: number; nonCompliant: number; notAssessed: number }[];
  controls: { total: number; byStatus: Record<string, number>; byEffectiveness: Record<string, number> } | null;
  documents: { kind: DocKind; framework: string; title: string; version: number; approvedAt: string | null; acknowledgements: number }[];
  continuity: { bia: number; plans: number; approved: number; testOverdue: number; neverTested: number; lastTests: { plan: string; testedAt: string; result: string; rtoMet: boolean | null }[] } | null;
  suppliers: { significant: number; withGaps: { name: string; gaps: string[] }[] } | null;
  changes: { total: number; significant: { code: string | null; title: string; status: string; day: string | null; gaps: string[] }[] } | null;
  previous: { version: number; approvedAt: string | null; conclusions: string | null; updates: string | null; metrics: Record<string, number> } | null;
  /** Bod 6 – incidenty v období (modul Incidenty). */
  incidents?: IncidentSummary | null;
  /** Bod 4 – audity a kontroly (modul Audity). */
  audits?: AuditSummary | null;
  /** Varování a upozornění regulátora (informační servis, ADR-088). */
  infoItems?: InfoReportItem[];
  /** Ochota riskovat a KRI (v1.23, ADR-120). */
  appetite?: RiskAppetiteDto;
}

export type Snapshot = SoaSnapshot | RiskReportSnapshot | PlanSnapshot | IsmsReviewSnapshot;

export function metaOf(s: Settings, period?: { periodFrom?: string | null; periodTo?: string | null }): SnapshotMeta {
  return {
    organizationName: s.organizationName,
    organizationIco: s.organizationIco,
    organizationAddress: s.organizationAddress,
    regulatedServices: s.regulatedServices,
    generatedAt: new Date().toISOString(),
    periodFrom: period?.periodFrom ?? null,
    periodTo: period?.periodTo ?? null,
    basis: reportBasisOf(profileOf(s)),
  };
}

export async function soaSnapshot(db: Db, meta: SnapshotMeta, companyId: string, fw: FrameworkId): Promise<SoaSnapshot> {
  const rows = await loadRequirementRows(db, companyId, fw);
  const f = FRAMEWORKS.find((x) => x.id === fw)!;
  // SoA se vede podle rámce, za který je sestavené (ADR-086)
  return {
    type: "soa",
    meta: { ...meta, basis: meta.basis?.id === fw ? meta.basis : reportBasisFor(fw) },
    framework: { id: f.id, name: f.name, source: f.source, fullText: f.fullText },
    summary: summarize(fw, rows),
    rows: rows.map((r) => ({
      id: r.id,
      section: r.section,
      sectionTitle: r.sectionTitle,
      ref: r.ref,
      lead: r.lead,
      text: r.text,
      points: r.points,
      applicable: r.applicable,
      justification: r.justification,
      compensating: r.compensating,
      implementationNote: r.implementationNote,
      compliance: r.compliance,
      priority: r.priority,
      dueDate: r.dueDate,
      ownerPositionName: r.ownerPositionName,
      controls: r.controls.map((c) => ({ code: c.code, name: c.name, status: CONTROL_LABELS.status[c.status] })),
    })),
  };
}

export async function riskReportSnapshot(db: Db, meta: SnapshotMeta, policy: RiskPolicy, inputs: Record<string, string>, companyId: string): Promise<RiskReportSnapshot> {
  const threat = alias(riskCatalog, "t");
  const weakness = alias(riskCatalog, "w");
  const rows = await db
    .select({
      r: risks,
      threat: sql<string | null>`case when ${threat.code} is null then ${threat.name} else ${threat.code} || ' – ' || ${threat.name} end`,
      weakness: sql<string | null>`case when ${weakness.code} is null then ${weakness.name} else ${weakness.code} || ' – ' || ${weakness.name} end`,
      // další hrozby a zranitelnosti scénáře (ADR-085)
      moreThreats: sql<string[]>`coalesce((select array_agg(case when k.code is null then k.name else k.code || ' – ' || k.name end order by k.code, k.name) from risk_catalog_links l join risk_catalog k on k.id = l.catalog_id where l.risk_id = ${risks.id} and k.kind = 'threat'), '{}')`,
      moreWeaknesses: sql<string[]>`coalesce((select array_agg(case when k.code is null then k.name else k.code || ' – ' || k.name end order by k.code, k.name) from risk_catalog_links l join risk_catalog k on k.id = l.catalog_id where l.risk_id = ${risks.id} and k.kind = 'weakness'), '{}')`,
      owner: positions.name,
      assets: sql<string[]>`coalesce((select array_agg(a.name order by a.name) from risk_assets ra join assets a on a.id = ra.asset_id where ra.risk_id = ${risks.id}), '{}')`,
      processes: sql<string[]>`coalesce((select array_agg(coalesce(p.code || ' ', '') || p.name order by p.name) from risk_processes rp join processes p on p.id = rp.process_id where rp.risk_id = ${risks.id}), '{}')`,
    })
    .from(risks)
    .leftJoin(threat, eq(threat.id, risks.threatId))
    .leftJoin(weakness, eq(weakness.id, risks.weaknessId))
    .leftJoin(positions, eq(positions.id, risks.ownerPositionId))
    .where(eq(risks.companyId, companyId))
    .orderBy(asc(risks.code), asc(risks.name));
  const actions = await loadActions(db, policy, eq(risks.companyId, companyId));
  const withActions = new Set(actions.filter((a) => a.status !== "cancelled").map((a) => a.riskId));
  const empty = () => Object.fromEntries([...RISK_LEVELS, "unassessed"].map((l) => [l, 0])) as Record<RiskLevel | "unassessed", number>;
  const counts = { total: 0, byLevel: empty(), residualByLevel: empty(), unacceptable: 0, untreated: 0 };
  const N = policy.levels;
  const matrix = Array.from({ length: N }, () => Array.from({ length: N }, () => 0));
  const out: RiskRow[] = [];
  for (const x of rows) {
    const r = x.r;
    const cur = riskScore(policy, r, r.scaleLevels);
    const res = riskScore(policy, residualValues(r), r.scaleLevels);
    const acceptable = cur.level ? isAcceptable(policy, cur.level, r.methodologyKey) : null;
    const mdef = r.methodologyKey !== BUILTIN_RISK_METHODOLOGY ? getRiskMethodology(r.methodologyKey) : null;
    if (r.status !== "closed") {
      counts.total++;
      counts.byLevel[cur.level ?? "unassessed"]++;
      counts.residualByLevel[res.level ?? "unassessed"]++;
      if (acceptable === false) {
        counts.unacceptable++;
        if (!r.treatment && !withActions.has(r.id) && r.status !== "accepted") counts.untreated++;
      }
      if (!mdef && r.methodologyKey === (policy.methodology || BUILTIN_RISK_METHODOLOGY) && r.scaleLevels === N && r.impact) {
        const l = policy.method === "two_factor" ? r.likelihood : r.threatLevel && r.vulnLevel ? Math.round(Math.sqrt(r.threatLevel * r.vulnLevel)) : null;
        if (l && r.impact <= N && l <= N) matrix[r.impact - 1]![l - 1]!++;
      }
    }
    out.push({
      code: r.code,
      name: r.name,
      status: r.status,
      threat: [x.threat, ...(x.moreThreats ?? [])].filter(Boolean).join("; ") || null,
      weakness: [x.weakness, ...(x.moreWeaknesses ?? [])].filter(Boolean).join("; ") || null,
      owner: x.owner,
      assets: x.assets,
      processes: x.processes,
      impact: r.impact,
      threatLevel: r.threatLevel,
      vulnLevel: r.vulnLevel,
      likelihood: r.likelihood,
      score: cur.score,
      level: cur.level,
      acceptable,
      treatment: r.treatment,
      treatmentDue: r.treatmentDue,
      residualScore: res.score,
      residualLevel: res.level,
      scaleLevels: r.scaleLevels,
      assessedAt: r.assessedAt?.toISOString() ?? null,
      description: r.description,
      methodologyKey: r.methodologyKey,
      factorValues: r.factorValues ?? null,
      levelLabel: mdef ? (mdef.levels.find((l) => l.key === scoreMethodology(mdef, r.factorValues).levelKey)?.label ?? null) : null,
    });
  }
  // pokrytí kategorií přílohy č. 3 (aktivní výchozí položky dle 409)
  const usage = await db.execute<{ kind: string; code: string; n: number }>(sql`
    select c.kind, c.code, count(r.id)::int as n
    from risk_catalog c left join risks r on (r.threat_id = c.id or r.weakness_id = c.id) and r.status <> 'closed' and r.company_id = ${companyId}
    where c.is_builtin and c.code is not null group by c.kind, c.code`);
  const n = new Map([...usage].map((u) => [`${u.kind}:${u.code}`, Number(u.n)]));
  const coverage = [
    ...BUILTIN_THREATS.map((t) => ({ kind: "threat" as const, code: t.code, name: t.name, risks: n.get(`threat:${t.code}`) ?? 0 })),
    ...BUILTIN_WEAKNESSES.map((w) => ({ kind: "weakness" as const, code: w.code, name: w.name, risks: n.get(`weakness:${w.code}`) ?? 0 })),
  ];
  const lv = policy.levels as ScaleLevels;
  const quantRows = rows.map((x) => x.r).filter((r) => r.quant && r.status !== "closed");
  return {
    type: "risk_report",
    meta,
    policy,
    ...(policy.methodology && policy.methodology !== BUILTIN_RISK_METHODOLOGY && getRiskMethodology(policy.methodology)
      ? { methodology: getRiskMethodology(policy.methodology)! }
      : {}),
    maxScore: maxScore(policy.method, lv),
    bounds: effectiveBounds(policy),
    scales: { impact: scaleFor("impact", lv), threat: scaleFor("threat", lv), vulnerability: scaleFor("vulnerability", lv), likelihood: scaleFor("likelihood", lv) },
    inputs,
    counts,
    matrix,
    risks: out,
    coverage,
    actions,
    ...(quantRows.length
      ? {
          quant: {
            policy: policy.quant,
            items: quantRows
              .map((r) => {
                const q = quantOf(r.id, r.quant, policy.quant)!;
                return { code: r.code, name: r.name, ale: q.inherent.mean, p95: q.inherent.p95, level: q.level, residualAle: q.residual?.mean ?? null, rosi: q.rosi };
              })
              .sort((a, b) => b.ale - a.ale),
            portfolio: (() => {
              const p = portfolio(quantRows.map((r) => ({ key: r.id, q: r.quant! })), policy.quant);
              return p ? { mean: p.mean, p95: p.p95, p99: p.p99 } : null;
            })(),
            residualPortfolio: (() => {
              if (!quantRows.some((r) => r.quant!.residualLef || r.quant!.residualLm)) return null;
              const p = portfolio(quantRows.map((r) => ({ key: r.id, q: r.quant! })), policy.quant, true);
              return p ? { mean: p.mean, p95: p.p95 } : null;
            })(),
          },
        }
      : {}),
  };
}

export async function planSnapshot(db: Db, meta: SnapshotMeta, policy: RiskPolicy, companyId: string): Promise<PlanSnapshot> {
  const actions = await loadActions(db, policy, eq(risks.companyId, companyId));
  const open = actions.filter((a) => a.status === "planned" || a.status === "in_progress");
  return {
    type: "treatment_plan",
    meta,
    actions,
    totals: {
      open: open.length,
      done: actions.filter((a) => a.status === "done").length,
      overdue: actions.filter((a) => a.overdue).length,
      cost: open.reduce((s, a) => s + (a.costEstimate ?? 0), 0),
    },
  };
}

/** Klíčové ukazatele pro seznam verzí (porovnání v čase). */
export function metricsOf(s: Snapshot): Record<string, number> {
  if (s.type === "soa")
    return {
      score: s.summary.score,
      total: s.summary.total,
      applicable: s.summary.applicable,
      compliant: s.summary.byCompliance.compliant,
      partial: s.summary.byCompliance.partial,
      nonCompliant: s.summary.byCompliance.non_compliant,
    };
  if (s.type === "isms_review")
    return {
      objectives: s.objectives.filter((o) => o.status !== "cancelled").length,
      objectivesMet: s.objectives.filter((o) => o.status === "met").length,
      openActions: s.plan?.open ?? 0,
      overdueActions: s.plan?.overdue ?? 0,
      unacceptable: s.risks?.unacceptable ?? 0,
      significantChanges: s.changes?.significant.length ?? 0,
      changeGaps: s.changes?.significant.filter((c) => c.gaps.length).length ?? 0,
      ...(s.incidents ? { incidents: s.incidents.incidents, significantIncidents: s.incidents.significant } : {}),
      ...(s.audits ? { openFindings: s.audits.openFindings, overdueFindings: s.audits.overdueFindings } : {}),
      ...(s.compliance[0] ? { score: s.compliance[0].score } : {}),
    };
  if (s.type === "risk_report")
    return {
      total: s.counts.total,
      critical: s.counts.byLevel.critical,
      high: s.counts.byLevel.high,
      unacceptable: s.counts.unacceptable,
      untreated: s.counts.untreated,
      ...(s.dataDriven?.coverage.summary.assessedShare != null ? { threatCoverage: Math.round(s.dataDriven.coverage.summary.assessedShare * 100), unassessedThreats: s.dataDriven.coverage.summary.unassessed } : {}),
    };
  return { open: s.totals.open, done: s.totals.done, overdue: s.totals.overdue, cost: s.totals.cost };
}

export { complianceScore };

/** Podklad pro vyhodnocení účinnosti ISMS a zprávu o přezkoumání (§ 3 písm. f) a g) vyhl. 409/2025). */
export async function ismsReviewSnapshot(db: Db, meta: SnapshotMeta, settings: Settings, inputs: Record<string, string>, companyId: string): Promise<IsmsReviewSnapshot> {
  const only = [companyId];
  const mods = settings.enabledModules as string[];
  const on = (m: string) => mods.includes(m);
  const policy = settings.riskPolicy;
  const from = meta.periodFrom ?? null;
  const to = meta.periodTo ?? null;

  let plan: IsmsReviewSnapshot["plan"] = null;
  let riskPart: IsmsReviewSnapshot["risks"] = null;
  if (on("risks")) {
    const rr = await riskReportSnapshot(db, meta, policy, {}, companyId);
    const acts = rr.actions;
    const open = acts.filter((a) => a.status === "planned" || a.status === "in_progress");
    plan = {
      open: open.length,
      done: acts.filter((a) => a.status === "done").length,
      overdue: acts.filter((a) => a.overdue).length,
      cancelled: acts.filter((a) => a.status === "cancelled").length,
      cost: open.reduce((n, a) => n + (a.costEstimate ?? 0), 0),
      overdueActions: acts.filter((a) => a.overdue),
    };
    const since = new Date();
    since.setMonth(since.getMonth() - policy.reviewMonths);
    riskPart = {
      total: rr.counts.total,
      byLevel: rr.counts.byLevel,
      unacceptable: rr.counts.unacceptable,
      untreated: rr.counts.untreated,
      notAssessedInPeriod: rr.risks.filter((r) => r.status !== "closed" && (!r.assessedAt || new Date(r.assessedAt) < since)).length,
      reviewMonths: policy.reviewMonths,
    };
    const openRisks = await db.select({ id: risks.id, code: risks.code, name: risks.name }).from(risks).where(and(eq(risks.companyId, companyId), sql`${risks.status} <> 'closed'`));
    const trig = await riskTriggers(db, openRisks.map((r) => r.id));
    const pending = openRisks.filter((r) => trig.get(r.id)?.length).map((r) => ({ code: r.code, name: r.name, triggers: trig.get(r.id)!.length, kinds: [...new Set(trig.get(r.id)!.map((x) => x.kind))] }));
    const dec = await db
      .select({ decision: riskReviews.decision, n: sql<number>`count(*)::int` })
      .from(riskReviews)
      .where(and(eq(riskReviews.companyId, companyId), gte(riskReviews.createdAt, from ? new Date(from) : since), to ? lt(riskReviews.createdAt, new Date(`${to}T23:59:59Z`)) : undefined))
      .groupBy(riskReviews.decision);
    riskPart.reassessment = {
      pending: pending.length,
      changed: dec.find((d) => d.decision === "changed")?.n ?? 0,
      confirmed: dec.find((d) => d.decision === "confirmed")?.n ?? 0,
      pendingRisks: pending.sort((a, b) => b.triggers - a.triggers).slice(0, 30),
    };
  }

  const compliance: IsmsReviewSnapshot["compliance"] = [];
  let controlsPart: IsmsReviewSnapshot["controls"] = null;
  if (on("controls")) {
    const fws: FrameworkId[] = [profileOf(settings).defaultFramework];
    for (const fw of fws) {
      const sum = summarize(fw, await loadRequirementRows(db, companyId, fw));
      const f = FRAMEWORKS.find((x) => x.id === fw)!;
      compliance.push({
        framework: fw,
        name: f.name,
        score: sum.score,
        applicable: sum.applicable,
        compliant: sum.byCompliance.compliant,
        partial: sum.byCompliance.partial,
        nonCompliant: sum.byCompliance.non_compliant,
        notAssessed: sum.byCompliance.not_assessed,
      });
    }
    const rows = await db.execute<{ status: string; effectiveness: string; n: number }>(sql`select status, effectiveness, count(*)::int as n from controls where company_id = ${companyId} group by status, effectiveness`);
    const byStatus: Record<string, number> = {};
    const byEffectiveness: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const n = Number(r.n);
      total += n;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + n;
      byEffectiveness[r.effectiveness] = (byEffectiveness[r.effectiveness] ?? 0) + n;
    }
    controlsPart = { total, byStatus, byEffectiveness };
  }

  // platné (poslední schválené) dokumenty ISMS a počet seznámení
  const docs = await db.execute<{ kind: DocKind; framework: string; title: string; version: number; approved_at: Date | null; acks: number }>(sql`
    select distinct on (d.kind, d.framework) d.kind, d.framework, d.title, d.version, d.approved_at,
      (select count(*)::int from document_acknowledgements a where a.version_id = d.id) as acks
    from document_versions d where d.status = 'approved' and d.kind <> 'isms_review' and d.company_id = ${companyId}
    order by d.kind, d.framework, d.version desc`);

  let continuity: IsmsReviewSnapshot["continuity"] = null;
  if (on("continuity")) {
    const [bia] = await db.select({ n: sql<number>`count(*)::int` }).from(biaAssessments).where(eq(biaAssessments.companyId, companyId));
    const plans = await db.select().from(continuityPlans).where(eq(continuityPlans.companyId, companyId));
    const tests = await db
      .select({ planId: planTests.planId, testedAt: planTests.testedAt, result: planTests.result, achieved: planTests.achievedRtoHours })
      .from(planTests)
      .orderBy(desc(planTests.testedAt));
    const today = new Date().toISOString().slice(0, 10);
    let overdue = 0;
    let never = 0;
    const lastTests: { plan: string; testedAt: string; result: string; rtoMet: boolean | null }[] = [];
    for (const p of plans.filter((x) => x.status === "approved")) {
      const last = tests.find((t) => t.planId === p.id);
      if (!last) never++;
      const next = nextTestDate(last?.testedAt ?? null, p.approvedAt?.toISOString() ?? null, p.testIntervalMonths);
      if (next && next < today) overdue++;
    }
    for (const t of tests.filter((x) => (!from || x.testedAt >= from) && (!to || x.testedAt <= to))) {
      const p = plans.find((x) => x.id === t.planId);
      lastTests.push({
        plan: `${p?.code ? `${p.code} ` : ""}${p?.name ?? ""}`,
        testedAt: t.testedAt,
        result: t.result,
        rtoMet: p?.rtoTargetHours != null && t.achieved != null ? t.achieved <= p.rtoTargetHours : null,
      });
    }
    continuity = { bia: Number(bia?.n ?? 0), plans: plans.filter((p) => p.status !== "retired").length, approved: plans.filter((p) => p.status === "approved").length, testOverdue: overdue, neverTested: never, lastTests };
  }

  let supplierPart: IsmsReviewSnapshot["suppliers"] = null;
  if (on("suppliers")) {
    const list = await loadSuppliers(db, eq(suppliers.companyId, companyId));
    const sig = list.filter((s) => s.significant && s.status === "active");
    supplierPart = { significant: sig.length, withGaps: sig.filter((s) => s.gaps.length).map((s) => ({ name: s.name, gaps: s.gaps })) };
  }

  let changePart: IsmsReviewSnapshot["changes"] = null;
  if (on("isms")) {
    const all = await loadChanges(db, and(eq(changes.companyId, companyId), periodWhere(from, to)));
    changePart = {
      total: all.length,
      significant: all
        .filter((c) => c.significant)
        .map((c) => ({ code: c.code, title: c.title, status: c.status, day: c.implementedAt ?? c.plannedAt, gaps: c.gaps })),
    };
  }

  const incidentPart = on("incidents") ? await incidentSummary(db, from, to, only) : null;
  const auditPart = on("audits") ? await auditSummary(db, profileOf(settings).defaultFramework, from, to, only) : null;

  const [prev] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.companyId, companyId), eq(documentVersions.kind, "isms_review"), sql`${documentVersions.status} in ('approved','superseded')`))
    .orderBy(desc(documentVersions.approvedAt))
    .limit(1);
  const prevInputs = (prev?.snapshot as IsmsReviewSnapshot | undefined)?.inputs ?? {};

  return {
    type: "isms_review",
    meta,
    regime: settings.regime,
    inputs,
    modules: mods,
    // cíle společnosti + skupinové cíle nadřazených společností
    objectives: on("isms") ? await loadObjectives(db, ancestorsOf(await getCompanies(db), companyId)) : [],
    plan,
    risks: riskPart,
    compliance,
    controls: controlsPart,
    documents: [...docs].map((d) => ({ kind: d.kind, framework: d.framework, title: d.title, version: Number(d.version), approvedAt: d.approved_at ? new Date(d.approved_at).toISOString() : null, acknowledgements: Number(d.acks) })),
    continuity,
    suppliers: supplierPart,
    changes: changePart,
    incidents: incidentPart,
    audits: auditPart,
    ...(on("legislation") ? { infoItems: await infoItemsForReport(db, companyId, meta.periodFrom, meta.periodTo) } : {}),
    previous: prev
      ? { version: prev.version, approvedAt: prev.approvedAt?.toISOString() ?? null, conclusions: prevInputs.conclusions ?? null, updates: prevInputs.updates ?? null, metrics: prev.metrics }
      : null,
  };
}
