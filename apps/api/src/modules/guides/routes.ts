import { secTestPackageExtras } from "../sectests/report";
import { GuideConfig, ThreatProfileInput, type GuideConfigImportResult, STARTER_ITEMS, StarterInput, type StarterItem, type StarterResult, AUDIT_FRAMEWORKS, COVERAGE_LABELS, FRAMEWORKS, GUIDES, GUIDE_FACT_KEYS, GuideOwnerInput, auditSectionState, onboardingState, stepRefs, stepRequirements, type AuditFramework, type AuditReadinessDto, type AuditSectionDto, compliancePathSummary, evaluateGuide, guideById, guideWritePerm, type GuideDef, type ObligationItem, type Translate, incidentDeadlines, isAcceptable, profileOf, riskScore, type GroupGuideRow, type GuideDto, type GuideFacts } from "@contix/shared";
import { and, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { getCompanies, hasPermIn, scopeOf, settingsFor, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assetVulnerabilities, assets, guideOwners, incidentReports, incidents, ismsObjectives, orgUnits, policies, policyFiles, policyFolders, policyVersions, positions, risks, suppliers, threatProfiles, trainingCourses, vulnIntel } from "../../db/schema";
import { loadCourses } from "../awareness/routes";
import { riskBaseline } from "../risks/triggers";
import { detectionFor } from "../risks/scenarios";
import { loadPolicies } from "../policies/routes";
import { computeCoverage } from "../coverage/routes";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { buildAuditPackage } from "../assurance/package";
import type { Dispatch } from "../import/routes";
import { tFor } from "../i18n/service";
import { groupOverview } from "../companies/routes";
import { writeXlsx } from "../import/table";
import { loadSuppliers } from "../suppliers/routes";
import { loadExceptions } from "../exceptions/service";
import { doraRegisterOf } from "../suppliers/dora";
import { getVulnSla, vulnOverdueSql } from "../vulnerabilities/intel";

/* ============================================================
 * Postup krok za krokem (v1.42, ADR-139): fakta pro průvodce jedním dotazem (jen počty, jen čtení),
 * vyhodnocení `evaluateGuide` (shared). Průvodce jen pro zapnuté moduly a s oprávněním ve společnosti.
 * ============================================================ */

/** Počty pro průvodce za společnost – jeden dotaz se poddotazy, nic se neukládá. */
export async function guideFacts(db: Db, companyId: string, wanted?: Set<string>, now = new Date()): Promise<GuideFacts> {
  const c = sql`${companyId}::uuid`;
  const year = sql`now() - interval '365 days'`;
  const rows = (await db.execute(sql`
    select
      (select count(*) from position_holders ph join positions p on p.id = ph.position_id join org_units u on u.id = p.org_unit_id where u.company_id = ${c}) as "positionsHeld",
      (select count(*) from policies where company_id = ${c} and doc_type = 'policy' and status = 'active') as "policyActive",
      (select count(*) from isms_objectives where company_id = ${c} and status <> 'cancelled') as "objectives",
      (select count(*) from isms_objectives where company_id = ${c} and status <> 'cancelled' and (status = 'not_evaluated' or evaluated_at is null or evaluated_at < (${year})::date)) as "objectivesNotEvaluated",
      (select count(*) from document_versions where company_id = ${c} and kind = 'soa' and status = 'approved' and approved_at >= ${year}) as "soa12",
      (select count(*) from document_versions where company_id = ${c} and kind = 'risk_report' and status = 'approved' and approved_at >= ${year}) as "riskReport12",
      (select count(*) from document_versions where company_id = ${c} and kind = 'treatment_plan' and status = 'approved' and approved_at >= ${year}) as "treatmentPlan12",
      (select count(*) from document_versions where company_id = ${c} and kind = 'isms_review' and status = 'approved' and approved_at >= ${year}) as "ismsReview12",
      (select count(*) from assets where company_id = ${c} and lifecycle_status in ('active', 'maintenance') and asset_class = 'primary') as "primaryAssets",
      (select count(*) from assets where company_id = ${c} and lifecycle_status in ('active', 'maintenance') and asset_class = 'primary' and (confidentiality is null or integrity is null or availability is null)) as "primaryUnrated",
      (select count(*) from risk_appetite_approvals where company_id = ${c}) as "appetiteApproved",
      (select count(*) from risks where company_id = ${c} and status <> 'closed') as "risks",
      (select count(*) from risk_scenario_proposals where company_id = ${c} and status = 'proposed') as "scenariosOpen",
      (select count(*) from risks where company_id = ${c} and status <> 'closed' and impact is null and factor_values is null) as "risksUnrated",
      (select count(*) from risks where company_id = ${c} and status <> 'closed' and owner_position_id is null) as "risksNoOwner",
      (select count(*) from requirement_assessments where company_id = ${c}) as "reqAssessed",
      (select count(*) from controls where company_id = ${c} and status <> 'not_applicable') as "controls",
      (select count(*) from controls where company_id = ${c} and status <> 'not_applicable' and owner_position_id is null) as "controlsNoOwner",
      (select count(*) from controls where company_id = ${c} and status in ('not_implemented', 'planned', 'in_progress')) as "controlsNotImpl",
      (select count(*) from controls k where k.company_id = ${c} and k.status = 'implemented'
        and not exists (select 1 from control_tests t where t.control_id = k.id and t.status = 'completed' and t.performed_at >= (${year})::date)
        and not exists (select 1 from control_monitors m where m.control_id = k.id and m.enabled)) as "controlsImplUntested",
      (select count(*) from controls k where k.company_id = ${c} and k.status = 'implemented' and coalesce(k.evidence, '') = ''
        and not exists (select 1 from evidence_controls e where e.control_id = k.id)) as "controlsImplNoEvidence",
      (select count(*) from control_monitors where company_id = ${c} and enabled) as "monitors",
      (select count(*) from audits where company_id = ${c} and status <> 'cancelled' and extract(year from coalesce(performed_start, planned_start)) = extract(year from now())) as "auditsThisYear",
      (select count(*) from audits where company_id = ${c} and status = 'completed' and coalesce(performed_end, planned_end, updated_at::date) >= (${year})::date) as "auditsCompleted12",
      (select count(*) from audit_findings f join audits a on a.id = f.audit_id where a.company_id = ${c} and f.status in ('open', 'in_progress')) as "findingsOpen",
      (select count(*) from audit_findings f join audits a on a.id = f.audit_id where a.company_id = ${c} and f.status in ('open', 'in_progress') and f.due_date < current_date) as "findingsOverdue",
      (select count(*) from processes where company_id = ${c} and status = 'active') as "processes",
      (select count(*) from processes p where p.company_id = ${c} and p.status = 'active' and not exists (select 1 from bia_assessments b where b.process_id = p.id)) as "processesNoBia",
      (select count(*) from bia_assessments where company_id = ${c} and status = 'draft') as "biaDraft",
      (select count(*) from bia_assessments b where b.company_id = ${c} and (b.rto_hours is not null or b.mtpd_hours is not null)
        and not exists (select 1 from plan_processes pp join continuity_plans cp on cp.id = pp.plan_id where pp.process_id = b.process_id and cp.status = 'approved')) as "biaNoPlan",
      (select count(*) from continuity_plans cp where cp.company_id = ${c} and cp.status = 'approved'
        and not exists (select 1 from plan_tests t where t.plan_id = cp.id and t.tested_at >= (now() - make_interval(months => coalesce(cp.test_interval_months, 12)))::date)) as "plansUntested",
      (select count(*) from exercises where company_id = ${c} and status = 'completed' and ended_at >= ${year}) as "exercises12",
      (select count(*) from incidents where company_id = ${c} and kind = 'unassessed' and status not in ('resolved', 'closed')) as "incidentsUnassessed",
      (select count(*) from incidents where company_id = ${c} and kind = 'incident' and authority_decision = 'pending' and status <> 'closed') as "incidentsDecisionPending",
      (select count(*) from incidents where company_id = ${c} and kind = 'incident' and status in ('new', 'assessing', 'handling')) as "incidentsOpen",
      (select count(*) from incidents where company_id = ${c} and kind = 'incident' and status in ('resolved', 'closed') and coalesce(lessons_learned, '') = '' and detected_at >= ${year}) as "incidentsNoLessons",
      (select count(*) from suppliers where company_id = ${c}) as "suppliers",
      (select count(*) from suppliers where company_id = ${c} and significant) as "suppliersSignificant",
      (select count(*) from suppliers s where s.company_id = ${c} and s.significant
        and not exists (select 1 from supplier_contracts k where k.supplier_id = s.id and (k.valid_to is null or k.valid_to >= current_date))) as "significantNoContract",
      (select count(*) from suppliers s where s.company_id = ${c} and s.significant
        and not exists (select 1 from supplier_questionnaires q where q.supplier_id = s.id and q.status = 'evaluated' and q.evaluated_at >= ${year})
        and not exists (select 1 from supplier_reports r where r.supplier_id = s.id and r.valid_until >= current_date)) as "significantNoAssurance",
      (select count(*) from suppliers where company_id = ${c} and significant and (last_review_at is null or last_review_at < (now() - make_interval(months => review_interval_months))::date)) as "significantReviewDue",
      (select count(*) from processing_activities where company_id = ${c} and status <> 'retired') as "activities",
      (select count(*) from processing_activities where company_id = ${c} and status = 'draft') as "activitiesDraft",
      (select count(*) from processing_activities a where a.company_id = ${c} and a.status <> 'retired'
        and not exists (select 1 from activity_assets x where x.activity_id = a.id) and not exists (select 1 from activity_processes x where x.activity_id = a.id)) as "activitiesNoLinks",
      (select count(*) from processing_activities a where a.company_id = ${c} and a.status <> 'retired' and cardinality(a.special_categories) > 0
        and not exists (select 1 from dpias d where d.activity_id = a.id and d.status = 'completed')) as "dpiaMissing",
      (select count(*) from ai_systems where company_id = ${c} and status not in ('rejected', 'retired')) as "aiSystems",
      (select count(*) from ai_systems where company_id = ${c} and status not in ('rejected', 'retired') and screening is null) as "aiUnscreened",
      (select count(*) from ai_systems where company_id = ${c} and status = 'proposed') as "aiUndecided",
      (select count(*) from training_courses where company_id = ${c} and 'AI gramotnost' = any(topics)) as "aiLiteracyCourse",
      (select count(*) from cra_products where company_id = ${c}) as "craProducts",
      (select count(*) from cra_products where company_id = ${c} and conformity_module is null) as "craNoConformity",
      (select count(*) from cra_products p where p.company_id = ${c} and not exists (select 1 from cra_components k where k.product_id = p.id)) as "craNoSbom",
      (select count(*) from cra_findings where company_id = ${c} and status in ('under_investigation', 'affected') and not gone) as "craFindingsOpen",
      (select count(*) from legal_watch where company_id = ${c}) as "legalWatch",
      (select count(*) from legal_reviews where company_id = ${c} and status in ('new', 'in_review')) as "legalReviewsOpen",
      (select count(*) from legal_tasks where company_id = ${c} and status = 'open') as "legalTasksOpen",
      (select count(*) from assets where company_id = ${c} and lifecycle_status in ('active', 'maintenance')) as "assets",
      (select count(*) from assets where company_id = ${c} and lifecycle_status in ('active', 'maintenance') and owner_user_id is null and coalesce(owner_name, '') = '') as "assetsNoOwner",
      (select count(*) from asset_sources s join assets a on a.id = s.asset_id where a.company_id = ${c} and s.source_type <> 'manual') as "assetSources",
      (select count(*) from assets a where a.company_id = ${c} and a.lifecycle_status in ('active', 'maintenance') and a.asset_class <> 'primary'
        and not exists (select 1 from asset_dependencies d where d.from_id = a.id or d.to_id = a.id) and not exists (select 1 from asset_links l where l.supporting_id = a.id)) as "supportingUnlinked",
      (select count(*) from assets where company_id = ${c} and lifecycle_status in ('active', 'maintenance') and support_status = 'eol') as "assetsEol",
      (select count(*) from asset_vulnerabilities v join assets a on a.id = v.asset_id where a.company_id = ${c}) as "vulnData",
      (select count(*) from asset_vulnerabilities v join assets a on a.id = v.asset_id join vuln_intel i on i.cve_id = v.cve_id where a.company_id = ${c} and v.status = 'open' and i.kev) as "vulnKev",
      (select count(*) from asset_vulnerabilities v join assets a on a.id = v.asset_id where a.company_id = ${c} and v.status = 'open' and a.internet_facing and v.severity in ('critical', 'high')) as "vulnExposed",
      (select count(*) from policies where company_id = ${c} and status <> 'retired') as "policies",
      (select count(*) from policies where company_id = ${c} and status = 'active' and owner_position_id is null) as "policiesNoOwner",
      (select count(*) from training_courses where company_id = ${c} and active) as "trainingCourses",
      (select count(*) from training_sessions s join training_courses k on k.id = s.course_id where k.company_id = ${c} and s.status = 'held' and s.date >= (${year})::date) as "trainingSessions12",
      (select count(*) from identity_sources where company_id = ${c} and enabled) as "identitySources",
      (select count(*) from identity_findings where company_id = ${c} and status = 'open') as "identityFindingsOpen",
      (select count(*) from identity_accounts where company_id = ${c} and removed_at is null and enabled and privileged and mfa = false) as "privNoMfa",
      (select count(*) from access_reviews where company_id = ${c} and status <> 'cancelled' and (status = 'active' or closed_at >= ${year})) as "accessReviews12",
      (select count(*) from sod_violations where company_id = ${c} and status = 'open') as "sodOpen",
      (select count(*) from changes where company_id = ${c}) as "changes",
      (select count(*) from changes where company_id = ${c} and status = 'proposed') as "changesUnassessed",
      (select count(*) from changes where company_id = ${c} and significant and status in ('proposed', 'assessed')) as "changesSignificantPending",
      (select count(*) from changes where company_id = ${c} and significant and status in ('implemented', 'closed') and docs_updated_at is null) as "changesNoDocs",
      (select count(*) from companies where id = ${c} and dora_entity) as "doraEntity",
      (select count(*) from processing_activities where company_id = ${c} and status = 'active' and (last_reviewed_at is null or last_reviewed_at < (now() - make_interval(months => review_months))::date)) as "activitiesReviewDue",
      (select count(*) from soc_sources where company_id = ${c} and enabled) + (select count(*) from alert_suggestions where company_id = ${c} and source <> 'manual' and last_seen >= now() - interval '90 days') as "socSources",
      (select count(*) from alert_suggestions where company_id = ${c} and status = 'new' and acknowledged_at is null and first_seen < now() - interval '24 hours') as "alertsUntriaged",
      (select count(*) from soc_hunts where company_id = ${c} and enabled) as "socHunts",
      (select count(*) from iam_people where company_id = ${c}) as "iamPeople",
      (select count(*) from iam_resources where company_id = ${c} and active) as "iamResources",
      (select count(*) from iam_resources where company_id = ${c} and active and owner_id is null) as "iamResourcesNoOwner",
      (select count(*) from iam_roles where company_id = ${c} and active) as "iamRoles",
      (select count(*) from iam_requests where company_id = ${c} and status in ('pending', 'approved') and created_at < now() - interval '5 days') as "iamRequestsStale",
      (select count(*) from iam_certifications where company_id = ${c} and created_at >= ${year}) as "iamCertifications12",
      (select count(*) from iam_grants g join iam_people p on p.id = g.person_id where g.company_id = ${c} and g.revoked_at is null and p.end_date < current_date) as "iamLeaverGrants",
      (select count(*) from org_units where company_id = ${c}) as "orgUnits",
      (select count(*) from positions p join org_units u on u.id = p.org_unit_id where u.company_id = ${c}) as "positions",
      (select count(*) from positions p join org_units u on u.id = p.org_unit_id where u.company_id = ${c} and not exists (select 1 from position_holders h where h.position_id = p.id)) as "positionsUnfilled",
      (select count(*) from processes where company_id = ${c} and status = 'active' and owner_position_id is null) as "processesNoOwner",
      (select count(*) from processes p where p.company_id = ${c} and p.status = 'active' and not exists (select 1 from process_steps s where s.process_id = p.id)) as "processesNoSteps",
      (select count(*) from risks r where r.company_id = ${c} and r.status <> 'closed'
        and (r.threat_id is null or (not exists (select 1 from risk_assets a where a.risk_id = r.id) and not exists (select 1 from risk_processes p where p.risk_id = r.id)))) as "risksIncomplete",
      (select count(*) from continuity_plans where company_id = ${c} and status = 'approved'
        and (coalesce(activation, '') = '' or steps = '[]'::jsonb or contacts = '[]'::jsonb)) as "plansIncomplete",
      (select count(*) from soc2_engagements e join audits a on a.id = e.audit_id where a.company_id = ${c}) as "soc2Engagements",
      (select count(*) from soc2_engagements e join audits a on a.id = e.audit_id where a.company_id = ${c} and e.description = '{}'::jsonb) as "soc2NoDescription",
      (select count(distinct k.id) from controls k join control_requirements r on r.control_id = k.id where k.company_id = ${c} and r.requirement_id like 'soc2:%') as "soc2Controls",
      (select count(*) from control_tests t where t.status = 'completed' and t.performed_at >= (${year})::date
        and exists (select 1 from controls k join control_requirements r on r.control_id = k.id where k.id = t.control_id and k.company_id = ${c} and r.requirement_id like 'soc2:%')) as "soc2Tests12",
      (select count(*) from audit_findings f join audits a on a.id = f.audit_id where a.company_id = ${c} and a.audit_type = 'soc2' and f.status in ('open', 'in_progress')) as "soc2ExceptionsOpen",
      (select count(*) from soc2_engagements e join audits a on a.id = e.audit_id where a.company_id = ${c} and e.report_date is not null) as "soc2Reports",
      (select count(*) from answer_library where company_id = ${c}) as "trustLibrary",
      (select count(*) from trust_centers where company_id = ${c} and enabled) as "trustCenter",
      (select count(*) from customer_questionnaires where company_id = ${c} and status = 'in_progress' and due_date < current_date) as "trustQOverdue",
      (select count(*) from customer_questionnaires where company_id = ${c} and status = 'in_progress') as "trustQOpen",
      (select count(*) from trust_access_requests where company_id = ${c} and status = 'pending') as "trustRequestsPending",
      (select count(*) from sec_test_scopes where company_id = ${c} and approved_at is not null and valid_to >= current_date) as "secScopes",
      (select count(*) from sec_test_runs where company_id = ${c} and status = 'done' and created_at >= now() - interval '90 days') as "secRuns90",
      (select count(*) from sec_test_schedules where company_id = ${c} and enabled) as "secSchedules",
      (select count(*) from sec_test_findings where company_id = ${c} and status = 'open' and severity in ('critical', 'high')) as "secHighOpen",
      (select count(*) from sec_test_findings f where f.company_id = ${c} and f.status = 'open' and f.severity in ('critical', 'high')
        and not exists (select 1 from tasks t where t.source_kind = 'sectest_finding' and t.source_id = f.id and t.status in ('open', 'in_progress'))) as "secHighNoTask",
      (select count(*) from tasks where company_id = ${c} and source_kind in ('sectest_finding', 'host_finding') and status in ('open', 'in_progress') and due_date < current_date) as "secFindingTasksOverdue",
      (select count(*) from host_inventories where company_id = ${c}) as "hostInventories",
      (select count(*) from host_findings where company_id = ${c} and status = 'open' and severity = 'high') as "hostFindingsHigh",
      (select count(*) from assets a where a.company_id = ${c} and a.lifecycle_status in ('active', 'maintenance')
        and a.technical_owner_user_id is null and a.technical_deputy_user_id is null
        and (exists (select 1 from sec_test_findings f where f.asset_id = a.id and f.status = 'open') or exists (select 1 from host_findings h where h.asset_id = a.id and h.status = 'open'))) as "assetsNoTechOwner"
  `)) as unknown as Record<string, string | number>[];
  const r = rows[0] ?? {};
  const f = Object.fromEntries(GUIDE_FACT_KEYS.map((k) => [k, Number(r[k] ?? 0)])) as GuideFacts;
  const want = (id: string) => !wanted || wanted.has(id);
  const settings = await settingsFor(db, null, companyId);
  // rizika: nad akceptovatelnou úrovní bez zvládání, přehodnocení podle intervalu politiky
  if (want("risks")) {
    const p = settings.riskPolicy;
    const rs = await db.select().from(risks).where(and(eq(risks.companyId, companyId), ne(risks.status, "closed")));
    const limit = new Date(now);
    limit.setMonth(limit.getMonth() - p.reviewMonths);
    const rated = rs.filter((x) => x.impact != null || x.factorValues != null);
    f.risksUntreated = rated.filter((x) => (x.status === "identified" || x.status === "assessed") && !x.treatment && !isAcceptable(p, riskScore(p, x, x.scaleLevels).level, x.methodologyKey)).length;
    f.risksReviewDue = rated.filter((x) => !!x.assessedAt && riskBaseline(x) < limit).length;
  }
  // zranitelnosti po termínu podle lhůt oprav (ADR-050)
  if (want("vulnerabilities") && f.vulnData) {
    const sla = await getVulnSla(db);
    const [v] = await db
      .select({ n: sql<number>`count(*) filter (where ${vulnOverdueSql(sla)})::int` })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(eq(assets.companyId, companyId), eq(assetVulnerabilities.status, "open")));
    f.vulnOverdue = Number(v?.n ?? 0);
  }
  // dokumentace: přezkum podle intervalu dokumentu, oběh, seznámení
  if (want("policies") && f.policies) {
    const list = await loadPolicies(db, and(eq(policies.companyId, companyId), ne(policies.status, "retired")));
    f.policiesReviewOverdue = list.filter((x) => x.item.reviewOverdue).length;
    f.policiesWithGaps = list.filter((x) => x.row.status === "active" && x.item.gaps.length > 0).length;
    f.policiesInApproval = list.filter((x) => x.versions.some((v) => v.v.status === "review" || v.v.status === "approval")).length;
    f.ackMissing = list.filter((x) => x.row.status === "active" && x.row.requireAcknowledgement).reduce((s, x) => s + Math.max(0, x.item.ack.required - x.item.ack.done), 0);
  }
  // školení: osoby po termínu (stejně jako přehled kurzů)
  if (want("awareness") && f.trainingCourses) {
    const courses = await loadCourses(db, and(eq(trainingCourses.companyId, companyId), eq(trainingCourses.active, true)));
    f.trainingOverdue = courses.reduce((s, x) => s + x.item.stats.overdue, 0);
  }
  // incidenty: zmeškané lhůty hlášení podle profilu společnosti
  if (want("incidents")) {
    const inc = await db.select().from(incidents).where(and(eq(incidents.companyId, companyId), gte(incidents.detectedAt, new Date(now.getTime() - 365 * 86_400_000))));
    const reps = inc.length ? await db.select().from(incidentReports).where(inArray(incidentReports.incidentId, inc.map((x) => x.id))) : [];
    const prof = profileOf(settings);
    f.incidentsReportOverdue = inc.filter(
      (i) =>
        incidentDeadlines(
          { ...i, detectedAt: i.detectedAt.toISOString(), resolvedAt: i.resolvedAt?.toISOString() ?? null },
          reps.filter((x) => x.incidentId === i.id).map((x) => ({ reportType: x.reportType, submittedAt: x.submittedAt.toISOString() })),
          prof.incidentRegime,
          { trustService: settings.trustServiceProvider, legalRef: prof.incidentLegalRef, now },
        ).some((d) => d.state === "overdue"),
    ).length;
  }
  // SOC: slepá místa detekce technik scénářů (ADR-119), jen když se detekce měří
  if (want("soc") && f.socSources) {
    const det = await detectionFor(db, companyId, now);
    f.detectionMeasured = det.measured ? 1 : 0;
    f.detectionBlind = det.measured ? det.summary.blind : 0;
  }
  // dodavatelé: významní s mezerami § 9 (stejně jako seznam dodavatelů)
  if (want("suppliers") && f.suppliersSignificant) {
    f.suppliersWithGaps = (await loadSuppliers(db, and(eq(suppliers.companyId, companyId), eq(suppliers.significant, true)))).filter((x) => x.gaps.length > 0).length;
  }
  // výjimky a přijatá rizika (ADR-039)
  if (want("exceptions")) {
    const ids = [companyId];
    const ex = await loadExceptions(db, { identity_finding: ids, sod_violation: ids, vulnerability: ids, risk_accepted: ids, requirement_na: ids, soc_suppression: ids }, now.toISOString().slice(0, 10));
    f.exceptions = ex.length;
    f.exceptionsExpired = ex.filter((e) => e.state === "expired").length;
    f.exceptionsExpiring = ex.filter((e) => e.state === "expiring").length;
    f.exceptionsNoCompensating = ex.filter((e) => e.state !== "expired" && !e.compensating.length && !e.compensatingNote).length;
  }
  // DORA: registr informací jen u finančního subjektu
  if (want("dora") && f.doraEntity) {
    const reg = await doraRegisterOf(db, [companyId], companyId);
    f.doraLeiMissing = reg.entities.filter((e) => !e.valid).length;
    f.doraFunctions = reg.summary.functions;
    f.doraProviders = reg.summary.providers;
    f.doraContracts = reg.summary.contracts;
    f.doraFindings = reg.summary.findings;
  }
  return f;
}

const AuditQuery = z.object({ framework: z.enum(AUDIT_FRAMEWORKS).optional(), format: z.enum(["json", "html", "docx", "zip"]).default("json"), files: z.enum(["1", "0"]).default("1") });
const GUIDE_PERMS = [...new Set(GUIDES.map((g) => g.perm))];
const GUIDE_WRITE_PERMS = [...new Set(GUIDES.map((g) => guideWritePerm(g)))];

/** Garanti průvodců společnosti (průvodce → funkční místo). */
async function ownersOf(db: Db, companyIds: string[]) {
  if (!companyIds.length) return [];
  return db
    .select({ companyId: guideOwners.companyId, guideId: guideOwners.guideId, positionId: guideOwners.positionId, name: positions.name })
    .from(guideOwners)
    .innerJoin(positions, eq(positions.id, guideOwners.positionId))
    .where(inArray(guideOwners.companyId, companyIds));
}

/**
 * Další krok průvodců do Moje práce (v1.44, ADR-141): za každou společnost a průvodce s garantem jedna položka
 * s dalším krokem (bez termínu, naléhavost „brzy“). Jen zapnuté moduly; nic se neukládá.
 */
export async function guideStepObligations(db: Db, companyIds: string[], t: Translate): Promise<ObligationItem[]> {
  const owners = await ownersOf(db, companyIds);
  if (!owners.length) return [];
  const enabled = (await getSettings(db)).enabledModules as string[];
  const out: ObligationItem[] = [];
  for (const companyId of [...new Set(owners.map((o) => o.companyId))]) {
    const mine = owners.filter((o) => o.companyId === companyId);
    const list = mine.map((o) => guideById(o.guideId)).filter((g): g is GuideDef => !!g && enabled.includes(g.module));
    if (!list.length) continue;
    const facts = await guideFacts(db, companyId, new Set(list.map((g) => g.id)));
    for (const g of list) {
      if (g.applies && !g.applies(facts)) continue;
      const dto = evaluateGuide(g, facts);
      const step = dto.steps.find((x) => x.key === dto.next);
      if (!step) continue;
      const o = mine.find((x) => x.guideId === g.id)!;
      out.push({
        key: `guide_step:${companyId}:${g.id}`,
        kind: "guide_step",
        title: t("srv.obl.guideStep", { guide: t.dyn(`gd.${g.id}.title`, g.id), step: t.dyn(`gd.${g.id}.${step.key}.title`, step.key) }),
        detail: t.dyn(`gd.${g.id}.${step.key}.todo`, String(step.count), { n: step.count }),
        companyId,
        due: null,
        urgency: "soon",
        link: step.path,
        ownerPositionId: o.positionId,
        ownerName: o.name,
      });
    }
  }
  return out;
}

/** Krátká mezipaměť souhrnu skupiny (2 min) – přehled skupiny nepočítá fakta při každém zobrazení. */
const groupCache = new Map<string, { at: number; rows: GroupGuideRow[] }>();
const GROUP_TTL = 120_000;

/** Připravenost na audit podle rámce: oddíly rámce × shoda požadavků (pokrytí předpisu) × kroky průvodců. */
export async function auditReadiness(db: Db, companyId: string, fw: AuditFramework, guides: GuideDto[]): Promise<AuditReadinessDto> {
  const cov = await computeCoverage(db, companyId, fw, true);
  const bySec = new Map<string, typeof cov.rows>();
  for (const r of cov.rows) bySec.set(r.section, [...(bySec.get(r.section) ?? []), r]);
  const stepSecs = guides.flatMap((g) => g.steps.map((s) => ({ g, s, secs: new Set(stepRequirements(g.id, s.key, fw).map((r) => r.section)) })));
  const sections: AuditSectionDto[] = [...bySec.entries()].map(([section, rows]) => {
    const app = rows.filter((r) => r.applicable);
    // neposouzené (bez ruční míry shody a bez opatření) se nepočítají jako nesplněné (v1.46)
    const done = app.filter((r) => r.assessed !== false && r.compliance !== "not_assessed");
    const n = (k: string) => done.filter((r) => r.compliance === k).length;
    const assessed = done.length;
    const gaps: AuditSectionDto["gaps"] = {};
    for (const r of app) for (const g of r.gaps) if (g !== "not_compliant" || r.assessed !== false) gaps[g] = (gaps[g] ?? 0) + 1;
    return {
      section,
      title: rows[0]!.sectionTitle,
      requirements: rows.length,
      applicable: app.length,
      compliant: n("compliant"),
      partial: n("partial"),
      nonCompliant: n("non_compliant"),
      unassessed: app.length - assessed,
      controls: new Set(app.flatMap((r) => r.controls.map((x) => x.id))).size,
      docs: new Set(app.flatMap((r) => r.docs.map((x) => x.id))).size,
      readiness: assessed ? Math.round(((n("compliant") + n("partial") * 0.5) / assessed) * 100) : null,
      steps: stepSecs.filter((x) => x.secs.has(section)).map(({ g, s }) => ({ guide: g.id, key: s.key, state: s.state, count: s.count, path: s.path })),
      gaps,
    };
  });
  const rated = sections.filter((s) => s.readiness != null && s.applicable > 0);
  return {
    framework: fw,
    sections,
    summary: {
      readiness: rated.length ? Math.round(rated.reduce((a, s) => a + s.readiness! * (s.applicable - s.unassessed), 0) / Math.max(1, rated.reduce((a, s) => a + s.applicable - s.unassessed, 0))) : null,
      sections: sections.length,
      ready: sections.filter((s) => auditSectionState(s) === "ready").length,
      stepsTodo: new Set(sections.flatMap((s) => s.steps.filter((x) => x.state === "todo").map((x) => `${x.guide}.${x.key}`))).size,
    },
  };
}

/** Limit platných dokumentů v balíčku (vedle limitu důkazů v `buildAuditPackage`). */
const DOCS_MAX_BYTES = 150 * 1024 * 1024;
const slugName = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "x";

/** Platné dokumenty (aktuální soubor schválené verze) po oddílech rámce – pro balíček pro auditora (v1.46). */
async function sectionDocuments(db: Db, companyId: string, fw: AuditFramework): Promise<{ path: string; data: Uint8Array; note: string }[]> {
  const cov = await computeCoverage(db, companyId, fw, true);
  const bySec = new Map<string, Set<string>>();
  for (const r of cov.rows) for (const d of r.docs) bySec.set(r.section, (bySec.get(r.section) ?? new Set()).add(d.id));
  const ids = [...new Set([...bySec.values()].flatMap((x) => [...x]))];
  if (!ids.length) return [];
  const files = await db
    .select({ policyId: policyVersions.policyId, title: policies.title, code: policies.code, filename: policyFiles.filename, id: policyFiles.id, size: policyFiles.size })
    .from(policyFiles)
    .innerJoin(policyVersions, eq(policyVersions.id, policyFiles.versionId))
    .innerJoin(policies, eq(policies.id, policyVersions.policyId))
    .where(and(inArray(policyVersions.policyId, ids), eq(policyVersions.status, "approved"), isNull(policyFiles.supersededAt), eq(policies.companyId, companyId)));
  const out: { path: string; data: Uint8Array; note: string }[] = [];
  let total = 0;
  for (const [sec, set] of bySec) {
    for (const f of files.filter((x) => set.has(x.policyId))) {
      if (total + f.size > DOCS_MAX_BYTES) continue;
      const [row] = await db.select({ content: policyFiles.content }).from(policyFiles).where(eq(policyFiles.id, f.id));
      if (!row?.content) continue;
      total += f.size;
      out.push({ path: `dokumenty/${slugName(sec)}/${slugName(`${f.code ? `${f.code}_` : ""}${f.title}`)}_${slugName(f.filename)}`, data: new Uint8Array(row.content), note: `dokument: ${f.title} (${sec})` });
    }
  }
  return out;
}

/** Podklady pro audit (tisk / Word): oddíly rámce, připravenost, mezery a kroky k dokončení. */
export function auditReadinessHtml(d: AuditReadinessDto, t: Translate, companyName: string): string {
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fwName = FRAMEWORKS.find((f) => f.id === d.framework)?.name ?? d.framework;
  const state = { ready: t("gd.audit.state.ready"), partial: t("gd.audit.state.partial"), missing: t("gd.audit.state.missing") };
  const rows = d.sections
    .map((s) => {
      const todo = s.steps.filter((x) => x.state === "todo");
      const gaps = Object.entries(s.gaps)
        .map(([k, n]) => `${t.lbl(COVERAGE_LABELS.gap[k as keyof typeof COVERAGE_LABELS.gap])}: ${n}`)
        .join(", ");
      return [
        `<h2>${esc(s.section)} ${esc(s.title)}</h2>`,
        `<p><b>${esc(state[auditSectionState(s)])}</b> · ${esc(t("gd.audit.readiness"))}: ${s.readiness == null ? "–" : `${s.readiness} %`} · ${esc(t("gd.audit.reqs", { a: s.applicable, c: s.compliant, p: s.partial, n: s.nonCompliant, u: s.unassessed }))} · ${esc(t("gd.audit.ctlDocs", { c: s.controls, d: s.docs }))}</p>`,
        gaps ? `<p>${esc(t("gd.audit.gaps"))}: ${esc(gaps)}</p>` : "",
        todo.length ? `<ul>${todo.map((x) => `<li>${esc(t.dyn(`gd.${x.guide}.title`, x.guide))}: ${esc(t.dyn(`gd.${x.guide}.${x.key}.title`, x.key))} – ${esc(t.dyn(`gd.${x.guide}.${x.key}.todo`, String(x.count), { n: x.count }))}</li>`).join("")}</ul>` : "",
      ].join("\n");
    })
    .join("\n");
  return [
    `<h1>${esc(t("gd.audit.title"))}: ${esc(fwName)}</h1>`,
    `<p>${esc(companyName)} · ${new Date().toISOString().slice(0, 10)}</p>`,
    `<p>${esc(t("gd.audit.summary", { r: d.summary.readiness ?? "–", ready: d.summary.ready, n: d.summary.sections, todo: d.summary.stepsTodo }))}</p>`,
    `<p class="muted">${esc(t("gd.audit.note"))}</p>`,
    rows,
  ].join("\n");
}

/** Výchozí cíle ISMS do startovacího balíčku (měřitelné, k úpravě). */
const STARTER_OBJECTIVES = [
  { code: "C-01", title: "Zranitelnosti P1 opravené v termínu", metric: "Podíl zranitelností P1 opravených v lhůtě", target: "100 %" },
  { code: "C-02", title: "Proškolení zaměstnanců v bezpečnosti", metric: "Podíl zaměstnanců s platným školením", target: "≥ 95 %" },
  { code: "C-03", title: "Otestované plány kontinuity", metric: "Podíl kritických procesů s otestovaným plánem za rok", target: "100 %" },
];

export function guideRoutes(db: Db, deps?: { dispatch: () => Dispatch }) {
  /** Volání existujícího API jménem uživatele (stejné validace, oprávnění a audit). */
  const call = async (c: Context<AppEnv>, companyId: string, method: string, path: string, body?: unknown) => {
    const base = new URL(c.req.url);
    const res = await deps!.dispatch()(
      new Request(`${base.origin}/api${path}`, {
        method,
        headers: { "content-type": "application/json", cookie: c.req.header("cookie") ?? "", authorization: c.req.header("authorization") ?? "", origin: c.req.header("origin") ?? base.origin, "x-forwarded-for": c.req.header("x-forwarded-for") ?? "", "x-contix-company": companyId },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const out = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: res.ok, status: res.status, body: out };
  };
  const allowed = async (c: Context<AppEnv>, companyId: string) => {
    const s = await getSettings(db);
    return GUIDES.filter((g) => s.enabledModules.includes(g.module) && hasPermIn(c, g.perm, companyId));
  };
  /** Průvodci společnosti: povolené moduly a oprávnění, pak jen ty, kterých se týká (DORA); s garantem. */
  const evaluate = async (c: Context<AppEnv>, companyId: string, only?: string) => {
    const list = (await allowed(c, companyId)).filter((g) => !only || g.id === only);
    const facts = await guideFacts(db, companyId, new Set(list.map((g) => g.id)));
    const owners = await ownersOf(db, [companyId]);
    const fw = profileOf(await settingsFor(db, null, companyId)).defaultFramework;
    return list
      .filter((g) => !g.applies || g.applies(facts))
      .map((g) => {
        const o = owners.find((x) => x.guideId === g.id);
        const dto = evaluateGuide(g, facts);
        return { ...dto, steps: dto.steps.map((s) => ({ ...s, refs: stepRefs(g.id, s.key, fw) })), owner: o ? { positionId: o.positionId, name: o.name } : null, canEdit: hasPermIn(c, guideWritePerm(g), companyId) };
      });
  };
  /** Postup každé společnosti v rozsahu uživatele (mezipaměť 2 min, `fresh` ji obejde). */
  const groupRows = async (c: Context<AppEnv>, fresh: boolean): Promise<GroupGuideRow[]> => {
    const scope = scopeOf(c);
    const cacheKey = `${currentUser(c).id}|${scope.accessible.join(",")}`;
    const hit = groupCache.get(cacheKey);
    if (hit && Date.now() - hit.at < GROUP_TTL && !fresh) return hit.rows;
    const all = await getCompanies(db);
    const ids = scope.accessible.filter((id) => all.some((x) => x.id === id && x.active));
    const out: GroupGuideRow[] = [];
    for (const id of ids) {
      const guides = await evaluate(c, id);
      if (!guides.length) continue;
      out.push({ companyId: id, name: all.find((x) => x.id === id)!.name, summary: compliancePathSummary(guides), guides: Object.fromEntries(guides.map((g) => [g.id, { progress: g.progress, next: g.next, todo: g.steps.filter((x) => x.state === "todo").length }])) });
    }
    const rows = out.sort((a, b) => a.summary.progress - b.summary.progress || a.name.localeCompare(b.name));
    groupCache.set(cacheKey, { at: Date.now(), rows });
    return rows;
  };
  return new Hono<AppEnv>()
    .get("/", requirePerm(...GUIDE_PERMS), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      const guides: GuideDto[] = await evaluate(c, companyId);
      return c.json({ guides, summary: compliancePathSummary(guides), onboarding: onboardingState(guides) });
    })
    /** Skupina společností: postup každé společnosti v rozsahu uživatele (jen čtení, souhrn po průvodcích). */
    .get("/group", requirePerm(...GUIDE_PERMS), async (c) => c.json(await groupRows(c, c.req.query("fresh") === "1")))
    /** Přehled skupiny do Excelu: ukazatele společností + Cesta k souladu po oblastech (v1.48, ADR-145). */
    .get("/group.xlsx", requirePerm(...GUIDE_PERMS), async (c) => {
      const t = await tFor(db, c);
      const [ov, gr] = await Promise.all([groupOverview(db, c), groupRows(c, false)]);
      const path = new Map(gr.map((r) => [r.companyId, r]));
      const n = (v: number | null | undefined) => (v == null ? "" : String(v));
      const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");
      const head = ["gx.company", "gx.regime", "gx.framework", "gx.compliance", "gx.path", "gx.risks", "gx.critical", "gx.high", "gx.unacceptable", "gx.overdueActions", "gx.ale", "gx.openIncidents", "gx.overdueReports", "gx.suppliers", "gx.suppliersGaps", "gx.plans", "gx.reviewLast", "gx.reviewNext"] as const;
      const rows = ov.map((r) => [
        `${"  ".repeat(r.depth)}${r.name}`,
        r.regime,
        FRAMEWORKS.find((f) => f.id === r.framework)?.shortName ?? r.framework,
        r.compliance == null ? "" : String(Math.round(r.compliance)),
        n(path.get(r.id)?.summary.progress),
        n(r.risks?.total),
        n(r.risks?.critical),
        n(r.risks?.high),
        n(r.risks?.unacceptable),
        n(r.risks?.overdueActions),
        r.risks?.ale == null ? "" : String(Math.round(r.risks.ale)),
        n(r.incidents?.open),
        n(r.incidents?.overdueReports),
        n(r.suppliers?.significant),
        n(r.suppliers?.withGaps),
        n(r.plans?.approved),
        day(r.review?.lastApprovedAt),
        `${day(r.review?.nextDue)}${r.review?.overdue ? ` (${t("gx.overdue")})` : ""}`,
      ]);
      const guideIds = [...new Set(gr.flatMap((r) => Object.keys(r.guides)))].sort((a, b) => GUIDES.findIndex((g) => g.id === a) - GUIDES.findIndex((g) => g.id === b));
      const pathRows = gr.map((r) => [r.name, String(r.summary.progress), ...guideIds.map((g) => n(r.guides[g]?.progress))]);
      const xlsx = writeXlsx([
        { name: t("gx.sheet.overview"), rows: [head.map((k) => t(k)), ...rows], widths: [34, 10, 14, ...head.slice(3).map(() => 12)] },
        { name: t("gx.sheet.path"), rows: [[t("gx.company"), t("gx.path"), ...guideIds.map((g) => t.dyn(`gd.${g}.title`, g))], ...pathRows], widths: [34, 12, ...guideIds.map(() => 14)] },
      ]);
      await audit(db, { c, user: currentUser(c), action: "group.exported", entityType: "company", details: { companies: ov.length } });
      return c.body(xlsx as unknown as ArrayBuffer, 200, {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="contix-prehled-skupiny-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      });
    })
    /** Příprava na audit podle rámce (jen čtení; pokrytí předpisu vyžaduje controls:read). */
    .get("/audit", requirePerm("controls:read"), zValidator("query", AuditQuery), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      const q = c.req.valid("query");
      const format = q.format;
      // výchozí předpis podle regulatorního profilu společnosti (ADR-080)
      const dfw = profileOf(await settingsFor(db, null, companyId)).defaultFramework;
      const framework: AuditFramework = q.framework ?? ((AUDIT_FRAMEWORKS as readonly string[]).includes(dfw) ? (dfw as AuditFramework) : "nis2");
      const d = await auditReadiness(db, companyId, framework, await evaluate(c, companyId));
      if (format === "json") return c.json(d);
      const t = await tFor(db, c);
      const name = (await getCompanies(db)).find((x) => x.id === companyId)?.name ?? "";
      const html = auditReadinessHtml(d, t, name);
      await audit(db, { c, user: currentUser(c), action: "guide.audit_report", entityType: "company", entityId: companyId, details: { framework, format } });
      const fname = `${t("gd.audit.title")} – ${framework}`.replace(/[\\/:*?"<>|]/g, "_");
      if (format === "docx") return docxResponse(await htmlToDocx(html, { title: t("gd.audit.title"), headerLine: name }), `${fname}.docx`);
      if (format === "zip") {
        // balíček pro auditora (ADR-019) + zpráva o připravenosti a platné dokumenty po oddílech (v1.46, ADR-143)
        const page = `<!doctype html><meta charset="utf-8"><title>${fname}</title><style>body{font:14px Arial,sans-serif;margin:32px;max-width:1000px}.muted{color:#667}</style>${html}`;
        const extras: { path: string; data: Uint8Array; note: string }[] = [
          { path: "02_pripravenost_na_audit.html", data: new TextEncoder().encode(page), note: "připravenost" },
          { path: "02_pripravenost_na_audit.docx", data: new Uint8Array(await htmlToDocx(html, { title: t("gd.audit.title"), headerLine: name })), note: "připravenost" },
        ];
        if (q.files === "1") extras.push(...(await sectionDocuments(db, companyId, framework)));
        const periodTo = new Date().toISOString().slice(0, 10);
        const periodFrom = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
        if (((await getSettings(db)).enabledModules as string[]).includes("sectests") && hasPermIn(c, "sectests:read", companyId)) extras.push(...(await secTestPackageExtras(db, companyId, name, periodFrom, periodTo)));
        const r = await buildAuditPackage(db, { companyId, framework, periodFrom, periodTo, withFiles: q.files === "1", userName: currentUser(c).displayName, extras });
        return new Response(r.zip, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${r.filename}"`, "cache-control": "private, no-store" } });
      }
      return c.html(`<!doctype html><meta charset="utf-8"><title>${fname}</title><style>body{font:14px Arial,sans-serif;margin:32px;max-width:1000px}.muted{color:#667}</style>${html}`, 200, { "cache-control": "private, no-store" });
    })
    /**
     * Startovací balíček (v1.46, ADR-143): výchozí složky dokumentace, katalog opatření podle vyhlášky režimu,
     * koncept bezpečnostní politiky a vzorové cíle ISMS – přes existující API (každý krok ověří vlastní oprávnění).
     */
    .post("/starter", requirePerm(...GUIDE_WRITE_PERMS), zValidator("json", StarterInput), async (c) => {
      if (!deps) throw new HTTPException(500, { message: "Startovací balíček není k dispozici" });
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      const { items } = c.req.valid("json");
      const settings = await settingsFor(db, null, companyId);
      const enabled = settings.enabledModules as string[];
      const company = (await getCompanies(db)).find((x) => x.id === companyId);
      const out: StarterResult[] = [];
      const err = (item: StarterItem, r: { body: Record<string, unknown> | null; status: number }) => out.push({ item, status: r.status === 403 ? "skipped" : "error", detail: String(r.body?.error ?? r.status) });
      for (const item of items) {
        if (item === "folders") {
          if (!enabled.includes("policies")) out.push({ item, status: "skipped", detail: "module" });
          else {
            const [ex] = await db.select({ n: sql<number>`count(*)::int` }).from(policyFolders).where(eq(policyFolders.companyId, companyId));
            if (ex!.n) out.push({ item, status: "exists", detail: null });
            else {
              const r = await call(c, companyId, "POST", "/setup/doc-folders");
              r.ok ? out.push({ item, status: "created", detail: null }) : err(item, r);
            }
          }
        } else if (item === "catalog") {
          const regime = company?.regime;
          if (!enabled.includes("controls")) out.push({ item, status: "skipped", detail: "module" });
          else if (company?.pack !== "cz" || (regime !== "higher" && regime !== "lower")) out.push({ item, status: "skipped", detail: "regime" });
          else {
            const r = await call(c, companyId, "POST", "/controls/generate", { regime, includeCrosswalk: true });
            if (!r.ok) err(item, r);
            else out.push({ item, status: Number(r.body?.created ?? 0) > 0 ? "created" : "exists", detail: String(r.body?.created ?? 0) });
          }
        } else if (item === "policy") {
          if (!enabled.includes("policies")) out.push({ item, status: "skipped", detail: "module" });
          else {
            const [ex] = await db.select({ n: sql<number>`count(*)::int` }).from(policies).where(and(eq(policies.companyId, companyId), eq(policies.docType, "policy"), ne(policies.status, "retired")));
            if (ex!.n) out.push({ item, status: "exists", detail: null });
            else {
              const t = await tFor(db, c);
              const r = await call(c, companyId, "POST", "/policies", { title: t("gd.starter.policyTitle"), docType: "policy", system: "isms", status: "draft", description: t("gd.starter.policyDesc") });
              if (!r.ok) err(item, r);
              else {
                // první verze s osnovou podle hlavního předpisu společnosti (v1.47, ADR-144)
                const fw = profileOf(settings).defaultFramework;
                const fwName = FRAMEWORKS.find((f) => f.id === fw)?.name ?? fw;
                await call(c, companyId, "POST", `/policies/${r.body!.id}/versions`, { version: "0.1", changeSummary: t("gd.starter.policyVersion"), content: t("gd.starter.policyContent", { fw: fwName }) });
                out.push({ item, status: "created", detail: String(r.body?.id ?? "") });
              }
            }
          }
        } else {
          if (!enabled.includes("isms")) out.push({ item, status: "skipped", detail: "module" });
          else {
            const [ex] = await db.select({ n: sql<number>`count(*)::int` }).from(ismsObjectives).where(eq(ismsObjectives.companyId, companyId));
            if (ex!.n) out.push({ item, status: "exists", detail: null });
            else {
              let ok = 0;
              let last: { body: Record<string, unknown> | null; status: number } | null = null;
              for (const o of STARTER_OBJECTIVES) {
                const r = await call(c, companyId, "POST", "/isms/objectives", { ...o, companyId });
                if (r.ok) ok++;
                else last = r;
              }
              ok ? out.push({ item, status: "created", detail: String(ok) }) : err(item, last!);
            }
          }
        }
      }
      await audit(db, { c, user: currentUser(c), action: "guide.starter", entityType: "company", entityId: companyId, details: { results: out.map((x) => `${x.item}:${x.status}`) } });
      return c.json(out);
    })
    /** Přenos nastavení průvodců (garanti podle názvu místa, profil hrozeb) do jiné instalace – v1.47, ADR-144. */
    .get("/config/export", requirePerm(...GUIDE_WRITE_PERMS), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      const own = await db
        .select({ guide: guideOwners.guideId, position: positions.name, unit: orgUnits.name })
        .from(guideOwners)
        .innerJoin(positions, eq(positions.id, guideOwners.positionId))
        .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
        .where(eq(guideOwners.companyId, companyId));
      const [tp] = await db.select().from(threatProfiles).where(eq(threatProfiles.companyId, companyId));
      const cfg: GuideConfig = { format: "contix-guides", version: 1, owners: own, threatProfile: tp ? { sector: tp.sector, overrides: tp.overrides ?? {} } : null };
      await audit(db, { c, user: currentUser(c), action: "guide.config_exported", entityType: "company", entityId: companyId, details: { owners: own.length } });
      return new Response(JSON.stringify(cfg, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="contix-pruvodci.json"', "cache-control": "private, no-store" } });
    })
    .post("/config/import", requirePerm(...GUIDE_WRITE_PERMS), zValidator("json", GuideConfig), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      const cfg = c.req.valid("json");
      const user = currentUser(c);
      const pos = await db.select({ id: positions.id, name: positions.name, unit: orgUnits.name }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(orgUnits.companyId, companyId));
      const norm = (v: string | null) => (v ?? "").trim().toLocaleLowerCase("cs");
      const allowedIds = new Set((await allowed(c, companyId)).filter((g) => hasPermIn(c, guideWritePerm(g), companyId)).map((g) => g.id));
      const res: GuideConfigImportResult = { owners: [], threatProfile: "skipped" };
      for (const o of cfg.owners) {
        if (!guideById(o.guide) || !allowedIds.has(o.guide)) {
          res.owners.push({ guide: o.guide, position: o.position, status: "unknown_guide" });
          continue;
        }
        // přednost má shoda místa i útvaru, jinak jediné místo stejného názvu
        const exact = pos.filter((p) => norm(p.name) === norm(o.position) && norm(p.unit) === norm(o.unit));
        const byName = pos.filter((p) => norm(p.name) === norm(o.position));
        const hit = exact[0] ?? (byName.length === 1 ? byName[0] : undefined);
        if (!hit) {
          res.owners.push({ guide: o.guide, position: o.position, status: "unmatched" });
          continue;
        }
        const v = { positionId: hit.id, updatedById: user.id, updatedAt: new Date() };
        await db.insert(guideOwners).values({ companyId, guideId: o.guide, ...v }).onConflictDoUpdate({ target: [guideOwners.companyId, guideOwners.guideId], set: v });
        res.owners.push({ guide: o.guide, position: o.position, status: "applied" });
      }
      if (cfg.threatProfile && hasPermIn(c, "risks:write", companyId)) {
        const tp = ThreatProfileInput.safeParse(cfg.threatProfile);
        if (tp.success) {
          const values = { sector: tp.data.sector, overrides: tp.data.overrides, updatedById: user.id, updatedAt: new Date() };
          await db.insert(threatProfiles).values({ companyId, ...values }).onConflictDoUpdate({ target: threatProfiles.companyId, set: values });
          res.threatProfile = "applied";
        }
      }
      await audit(db, { c, user, action: "guide.config_imported", entityType: "company", entityId: companyId, details: { applied: res.owners.filter((x) => x.status === "applied").length, unmatched: res.owners.filter((x) => x.status !== "applied").length, threatProfile: res.threatProfile } });
      return c.json(res);
    })
    .get("/:id", requirePerm(...GUIDE_PERMS), async (c) => {
      const g = guideById(c.req.param("id"));
      if (!g) throw new HTTPException(404, { message: "Průvodce nenalezen" });
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      const [dto] = await evaluate(c, companyId, g.id);
      if (!dto) throw new HTTPException(404, { message: "Průvodce nenalezen" });
      return c.json(dto);
    })
    /** Garant postupu – funkční místo ze společnosti; jen s oprávněním k zápisu modulu. */
    .put("/:id/owner", requirePerm(...GUIDE_WRITE_PERMS), zValidator("json", GuideOwnerInput), async (c) => {
      const g = guideById(c.req.param("id"));
      if (!g) throw new HTTPException(404, { message: "Průvodce nenalezen" });
      const companyId = targetCompany(c, c.req.query("companyId") ?? null);
      if (!(await allowed(c, companyId)).includes(g) || !hasPermIn(c, guideWritePerm(g), companyId)) throw new HTTPException(403, { message: "Nemáte oprávnění" });
      const { positionId } = c.req.valid("json");
      const user = currentUser(c);
      if (positionId) {
        const [p] = await db.select({ id: positions.id }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(and(eq(positions.id, positionId), eq(orgUnits.companyId, companyId)));
        if (!p) throw new HTTPException(400, { message: "Funkční místo nepatří do společnosti" });
        const v = { positionId, updatedById: user.id, updatedAt: new Date() };
        await db.insert(guideOwners).values({ companyId, guideId: g.id, ...v }).onConflictDoUpdate({ target: [guideOwners.companyId, guideOwners.guideId], set: v });
      } else await db.delete(guideOwners).where(and(eq(guideOwners.companyId, companyId), eq(guideOwners.guideId, g.id)));
      await audit(db, { c, user, action: "guide.owner_set", entityType: "company", entityId: companyId, details: { guide: g.id, positionId } });
      const [dto] = await evaluate(c, companyId, g.id);
      return c.json(dto);
    });
}
