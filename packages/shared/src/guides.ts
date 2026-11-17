import { z } from "zod";
import type { Permission } from "./auth";
import { relatedRequirements, requirementsOf, type Requirement } from "./frameworks";
import type { CoverageGap } from "./coverage";
import type { ModuleKey } from "./modules";

/* ============================================================
 * Postup krok za krokem (v1.42, ADR-139): průvodci moduly a „Cesta k souladu“.
 * Stav kroků se počítá jen z dat (fakta `GuideFacts`, při čtení, nepersistovat) – `evaluateGuide`.
 * Texty kroků jsou v i18n `gd.<průvodce>.<krok>.title | hint | todo`.
 * ============================================================ */

export const GUIDE_FACT_KEYS = [
  // ISMS
  "positionsHeld",
  "policyActive",
  "objectives",
  "objectivesNotEvaluated",
  "soa12",
  "riskReport12",
  "treatmentPlan12",
  "ismsReview12",
  // rizika
  "primaryAssets",
  "primaryUnrated",
  "appetiteApproved",
  "risks",
  "scenariosOpen",
  "risksUnrated",
  "risksNoOwner",
  "risksUntreated",
  "risksReviewDue",
  // opatření
  "reqAssessed",
  "controls",
  "controlsNoOwner",
  "controlsNotImpl",
  "controlsImplUntested",
  "controlsImplNoEvidence",
  "monitors",
  // audity
  "auditsThisYear",
  "auditsCompleted12",
  "findingsOpen",
  "findingsOverdue",
  // kontinuita
  "processes",
  "processesNoBia",
  "biaDraft",
  "biaNoPlan",
  "plansUntested",
  "exercises12",
  // incidenty
  "incidentsUnassessed",
  "incidentsDecisionPending",
  "incidentsOpen",
  "incidentsNoLessons",
  // dodavatelé
  "suppliers",
  "suppliersSignificant",
  "significantNoContract",
  "significantNoAssurance",
  "significantReviewDue",
  // GDPR
  "activities",
  "activitiesDraft",
  "activitiesNoLinks",
  "dpiaMissing",
  // AI Act
  "aiSystems",
  "aiUnscreened",
  "aiUndecided",
  "aiLiteracyCourse",
  // CRA
  "craProducts",
  "craNoConformity",
  "craNoSbom",
  "craFindingsOpen",
  // legislativa
  "legalWatch",
  "legalReviewsOpen",
  "legalTasksOpen",
  // v1.43: aktiva a zranitelnosti
  "assets",
  "assetsNoOwner",
  "assetSources",
  "supportingUnlinked",
  "assetsEol",
  "vulnData",
  "vulnKev",
  "vulnExposed",
  "vulnOverdue",
  // dokumentace
  "policies",
  "policiesNoOwner",
  "policiesReviewOverdue",
  "policiesInApproval",
  "ackMissing",
  // školení
  "trainingCourses",
  "trainingSessions12",
  "trainingOverdue",
  // identity
  "identitySources",
  "identityFindingsOpen",
  "privNoMfa",
  "accessReviews12",
  "sodOpen",
  // významné změny
  "changes",
  "changesUnassessed",
  "changesSignificantPending",
  "changesNoDocs",
  // DORA
  "doraEntity",
  "doraLeiMissing",
  "doraFunctions",
  "doraProviders",
  "doraContracts",
  "doraFindings",
  // přesnější lhůty
  "incidentsReportOverdue",
  "activitiesReviewDue",
  // v1.44: SOC
  "socSources",
  "alertsUntriaged",
  "socHunts",
  "detectionMeasured",
  "detectionBlind",
  // žádosti o přístup (IDM)
  "iamPeople",
  "iamResources",
  "iamResourcesNoOwner",
  "iamRoles",
  "iamRequestsStale",
  "iamCertifications12",
  "iamLeaverGrants",
  // v1.45: organizace a procesy, výjimky, kvalita záznamů
  "orgUnits",
  "positions",
  "positionsUnfilled",
  "processesNoOwner",
  "processesNoSteps",
  "exceptions",
  "exceptionsExpired",
  "exceptionsExpiring",
  "exceptionsNoCompensating",
  "risksIncomplete",
  "plansIncomplete",
  "policiesWithGaps",
  "suppliersWithGaps",
  // v1.47: SOC 2 a Trust Center
  "soc2Engagements",
  "soc2NoDescription",
  "soc2Controls",
  "soc2Tests12",
  "soc2ExceptionsOpen",
  "soc2Reports",
  "trustLibrary",
  "trustCenter",
  "trustQOverdue",
  "trustQOpen",
  "trustRequestsPending",
  // v1.66 (ADR-159): bezpečnostní testy a nálezy serverů
  "secScopes",
  "secRuns90",
  "secSchedules",
  "secHighOpen",
  "secHighNoTask",
  "secFindingTasksOverdue",
  "hostInventories",
  "hostFindingsHigh",
  "assetsNoTechOwner",
] as const;
export type GuideFactKey = (typeof GUIDE_FACT_KEYS)[number];
export type GuideFacts = Record<GuideFactKey, number>;

type F = GuideFacts;
export interface GuideStepDef {
  key: string;
  /** Kam krok vede. */
  path: string;
  /** Hotovo podle dat. */
  done: (f: F) => boolean;
  /** Počet položek k vyřízení (pro text „todo“). */
  count: (f: F) => number;
  /** Krok zatím nedává smysl (chybí předchozí data) – nečeká se na něj. */
  waiting?: (f: F) => boolean;
}
export interface GuideDef {
  id: string;
  module: ModuleKey;
  perm: Permission;
  /** Hlavní stránka modulu (kde je panel). */
  path: string;
  steps: GuideStepDef[];
  /** Oprávnění k nastavení garanta (výchozí: `<modul>:write` odvozené z `perm`). */
  writePerm?: Permission;
  /** Průvodce se týká jen některých společností (např. DORA jen finanční subjekt). */
  applies?: (f: GuideFacts) => boolean;
}

const exists = (k: GuideFactKey): Pick<GuideStepDef, "done" | "count"> => ({ done: (f) => f[k] > 0, count: (f) => (f[k] > 0 ? 0 : 1) });
const none = (k: GuideFactKey): Pick<GuideStepDef, "done" | "count"> => ({ done: (f) => f[k] === 0, count: (f) => f[k] });

export const GUIDES: GuideDef[] = [
  {
    id: "isms",
    module: "isms",
    perm: "isms:read",
    path: "/isms",
    steps: [
      { key: "roles", path: "/organization", ...exists("positionsHeld") },
      { key: "policy", path: "/policies", ...exists("policyActive") },
      { key: "objectives", path: "/isms", done: (f) => f.objectives > 0 && f.objectivesNotEvaluated === 0, count: (f) => (f.objectives ? f.objectivesNotEvaluated : 1) },
      { key: "soa", path: "/controls/soa", ...exists("soa12") },
      { key: "riskReport", path: "/risks", ...exists("riskReport12") },
      { key: "review", path: "/isms", ...exists("ismsReview12") },
    ],
  },
  {
    id: "risks",
    module: "risks",
    perm: "risks:read",
    path: "/risks",
    steps: [
      { key: "assets", path: "/assets", done: (f) => f.primaryAssets > 0 && f.primaryUnrated === 0, count: (f) => (f.primaryAssets ? f.primaryUnrated : 1) },
      { key: "appetite", path: "/risks/appetite", ...exists("appetiteApproved") },
      { key: "identify", path: "/risks/scenarios", done: (f) => f.risks > 0 && f.scenariosOpen === 0, count: (f) => f.scenariosOpen || (f.risks ? 0 : 1) },
      { key: "scenario", path: "/risks", ...none("risksIncomplete"), waiting: (f) => f.risks === 0 },
      { key: "assess", path: "/risks", ...none("risksUnrated"), waiting: (f) => f.risks === 0 },
      { key: "owners", path: "/risks", ...none("risksNoOwner"), waiting: (f) => f.risks === 0 },
      { key: "treat", path: "/risks/plan", ...none("risksUntreated"), waiting: (f) => f.risks === 0 },
      { key: "plan", path: "/risks/plan", ...exists("treatmentPlan12"), waiting: (f) => f.risks === 0 },
      { key: "review", path: "/risks", ...none("risksReviewDue"), waiting: (f) => f.risks === 0 },
    ],
  },
  {
    id: "controls",
    module: "controls",
    perm: "controls:read",
    path: "/controls",
    steps: [
      { key: "scope", path: "/controls/coverage", ...exists("reqAssessed") },
      { key: "catalog", path: "/controls", ...exists("controls") },
      { key: "owners", path: "/controls", ...none("controlsNoOwner"), waiting: (f) => f.controls === 0 },
      { key: "implement", path: "/controls", ...none("controlsNotImpl"), waiting: (f) => f.controls === 0 },
      { key: "test", path: "/controls/assurance", ...none("controlsImplUntested"), waiting: (f) => f.controls === 0 },
      { key: "evidence", path: "/controls/assurance", ...none("controlsImplNoEvidence"), waiting: (f) => f.controls === 0 },
      { key: "monitor", path: "/controls/monitoring", ...exists("monitors"), waiting: (f) => f.controls === 0 },
    ],
  },
  {
    id: "audits",
    module: "audits",
    perm: "audits:read",
    path: "/audits",
    steps: [
      { key: "plan", path: "/audits", ...exists("auditsThisYear") },
      { key: "conduct", path: "/audits", ...exists("auditsCompleted12") },
      { key: "findings", path: "/audits", ...none("findingsOpen") },
      { key: "overdue", path: "/audits", ...none("findingsOverdue") },
    ],
  },
  {
    id: "continuity",
    module: "continuity",
    perm: "bia:read",
    path: "/bia",
    steps: [
      { key: "processes", path: "/processes", ...exists("processes") },
      { key: "bia", path: "/bia", ...none("processesNoBia"), waiting: (f) => f.processes === 0 },
      { key: "approve", path: "/bia", ...none("biaDraft"), waiting: (f) => f.processes === 0 },
      { key: "plans", path: "/continuity/plans", ...none("biaNoPlan"), waiting: (f) => f.processes === 0 },
      { key: "planQuality", path: "/continuity/plans", ...none("plansIncomplete"), waiting: (f) => f.processes === 0 },
      { key: "test", path: "/continuity/plans", ...none("plansUntested"), waiting: (f) => f.processes === 0 },
      { key: "exercise", path: "/continuity/exercises", ...exists("exercises12"), waiting: (f) => f.processes === 0 },
    ],
  },
  {
    id: "incidents",
    module: "incidents",
    perm: "incidents:read",
    path: "/incidents",
    steps: [
      { key: "assess", path: "/incidents", ...none("incidentsUnassessed") },
      { key: "report", path: "/incidents", ...none("incidentsDecisionPending") },
      { key: "deadlines", path: "/incidents", ...none("incidentsReportOverdue") },
      { key: "handle", path: "/incidents", ...none("incidentsOpen") },
      { key: "lessons", path: "/incidents", ...none("incidentsNoLessons") },
    ],
  },
  {
    id: "suppliers",
    module: "suppliers",
    perm: "suppliers:read",
    path: "/suppliers",
    steps: [
      { key: "register", path: "/suppliers", ...exists("suppliers") },
      { key: "significant", path: "/suppliers", ...exists("suppliersSignificant"), waiting: (f) => f.suppliers === 0 },
      { key: "contracts", path: "/suppliers", ...none("significantNoContract"), waiting: (f) => f.suppliersSignificant === 0 },
      { key: "quality", path: "/suppliers", ...none("suppliersWithGaps"), waiting: (f) => f.suppliersSignificant === 0 },
      { key: "assurance", path: "/suppliers", ...none("significantNoAssurance"), waiting: (f) => f.suppliersSignificant === 0 },
      { key: "review", path: "/suppliers", ...none("significantReviewDue"), waiting: (f) => f.suppliersSignificant === 0 },
    ],
  },
  {
    id: "gdpr",
    module: "gdpr",
    perm: "gdpr:read",
    path: "/gdpr",
    steps: [
      { key: "ropa", path: "/gdpr", ...exists("activities") },
      { key: "complete", path: "/gdpr", ...none("activitiesDraft"), waiting: (f) => f.activities === 0 },
      { key: "links", path: "/gdpr", ...none("activitiesNoLinks"), waiting: (f) => f.activities === 0 },
      { key: "dpia", path: "/gdpr", ...none("dpiaMissing"), waiting: (f) => f.activities === 0 },
      { key: "review", path: "/gdpr", ...none("activitiesReviewDue"), waiting: (f) => f.activities === 0 },
    ],
  },
  {
    id: "aiact",
    module: "aiact",
    perm: "aiact:read",
    path: "/aiact",
    steps: [
      { key: "inventory", path: "/aiact", ...exists("aiSystems") },
      { key: "screen", path: "/aiact", ...none("aiUnscreened"), waiting: (f) => f.aiSystems === 0 },
      { key: "decide", path: "/aiact", ...none("aiUndecided"), waiting: (f) => f.aiSystems === 0 },
      { key: "literacy", path: "/awareness", ...exists("aiLiteracyCourse"), waiting: (f) => f.aiSystems === 0 },
    ],
  },
  {
    id: "cra",
    module: "cra",
    perm: "cra:read",
    path: "/cra",
    steps: [
      { key: "products", path: "/cra", ...exists("craProducts") },
      { key: "conformity", path: "/cra", ...none("craNoConformity"), waiting: (f) => f.craProducts === 0 },
      { key: "sbom", path: "/cra", ...none("craNoSbom"), waiting: (f) => f.craProducts === 0 },
      { key: "vulns", path: "/cra", ...none("craFindingsOpen"), waiting: (f) => f.craProducts === 0 },
    ],
  },
  {
    id: "legislation",
    module: "legislation",
    perm: "legislation:read",
    path: "/legislation",
    steps: [
      { key: "watch", path: "/legislation", ...exists("legalWatch") },
      { key: "review", path: "/legislation", ...none("legalReviewsOpen"), waiting: (f) => f.legalWatch === 0 },
      { key: "tasks", path: "/legislation", ...none("legalTasksOpen"), waiting: (f) => f.legalWatch === 0 },
    ],
  },
  {
    id: "assets",
    module: "assets",
    perm: "assets:read",
    path: "/assets",
    steps: [
      { key: "inventory", path: "/assets", ...exists("assets") },
      { key: "sources", path: "/discovery", ...exists("assetSources"), waiting: (f) => f.assets === 0 },
      { key: "owners", path: "/assets", ...none("assetsNoOwner"), waiting: (f) => f.assets === 0 },
      { key: "primary", path: "/assets", done: (f) => f.primaryAssets > 0 && f.primaryUnrated === 0, count: (f) => (f.primaryAssets ? f.primaryUnrated : 1), waiting: (f) => f.assets === 0 },
      { key: "links", path: "/assets/graph", ...none("supportingUnlinked"), waiting: (f) => f.assets === 0 },
      { key: "eol", path: "/assets", ...none("assetsEol"), waiting: (f) => f.assets === 0 },
      { key: "serverFindings", path: "/findings?source=host", ...none("hostFindingsHigh"), waiting: (f) => f.hostInventories === 0 },
    ],
  },
  {
    id: "sectests",
    module: "sectests",
    perm: "sectests:read",
    path: "/security-tests",
    steps: [
      { key: "scope", path: "/security-tests?tab=scopes", ...exists("secScopes") },
      { key: "run", path: "/security-tests?tab=runs", ...exists("secRuns90"), waiting: (f) => f.secScopes === 0 },
      { key: "schedule", path: "/security-tests?tab=schedules", ...exists("secSchedules"), waiting: (f) => f.secScopes === 0 },
      { key: "owners", path: "/assets", ...none("assetsNoTechOwner"), waiting: (f) => f.secRuns90 === 0 },
      { key: "tasks", path: "/findings?source=sectest", ...none("secHighNoTask"), waiting: (f) => f.secRuns90 === 0 },
      { key: "overdue", path: "/findings", ...none("secFindingTasksOverdue"), waiting: (f) => f.secRuns90 === 0 },
    ],
  },
  {
    id: "vulnerabilities",
    module: "vulnerabilities",
    perm: "assets:read",
    path: "/vulnerabilities",
    steps: [
      { key: "scan", path: "/vulnerabilities", ...exists("vulnData") },
      { key: "kev", path: "/vulnerabilities", ...none("vulnKev"), waiting: (f) => f.vulnData === 0 },
      { key: "exposed", path: "/vulnerabilities", ...none("vulnExposed"), waiting: (f) => f.vulnData === 0 },
      { key: "overdue", path: "/vulnerabilities", ...none("vulnOverdue"), waiting: (f) => f.vulnData === 0 },
    ],
  },
  {
    id: "policies",
    module: "policies",
    perm: "policies:read",
    path: "/policies",
    steps: [
      { key: "policy", path: "/policies", ...exists("policyActive") },
      { key: "owners", path: "/policies", ...none("policiesNoOwner"), waiting: (f) => f.policies === 0 },
      { key: "quality", path: "/policies", ...none("policiesWithGaps"), waiting: (f) => f.policies === 0 },
      { key: "approval", path: "/policies", ...none("policiesInApproval"), waiting: (f) => f.policies === 0 },
      { key: "review", path: "/policies", ...none("policiesReviewOverdue"), waiting: (f) => f.policies === 0 },
      { key: "ack", path: "/policies", ...none("ackMissing"), waiting: (f) => f.policies === 0 },
    ],
  },
  {
    id: "awareness",
    module: "awareness",
    perm: "awareness:read",
    path: "/awareness",
    steps: [
      { key: "plan", path: "/awareness", ...exists("trainingCourses") },
      { key: "sessions", path: "/awareness", ...exists("trainingSessions12"), waiting: (f) => f.trainingCourses === 0 },
      { key: "overdue", path: "/awareness", ...none("trainingOverdue"), waiting: (f) => f.trainingCourses === 0 },
    ],
  },
  {
    id: "identity",
    module: "identity",
    perm: "identity:read",
    path: "/identity",
    steps: [
      { key: "source", path: "/identity", ...exists("identitySources") },
      { key: "findings", path: "/identity", ...none("identityFindingsOpen"), waiting: (f) => f.identitySources === 0 },
      { key: "mfa", path: "/identity", ...none("privNoMfa"), waiting: (f) => f.identitySources === 0 },
      { key: "sod", path: "/identity", ...none("sodOpen"), waiting: (f) => f.identitySources === 0 },
      { key: "review", path: "/identity", ...exists("accessReviews12"), waiting: (f) => f.identitySources === 0 },
    ],
  },
  {
    id: "changes",
    module: "isms",
    perm: "isms:read",
    path: "/isms/changes",
    steps: [
      { key: "register", path: "/isms/changes", ...exists("changes") },
      { key: "assess", path: "/isms/changes", ...none("changesUnassessed"), waiting: (f) => f.changes === 0 },
      { key: "approve", path: "/isms/changes", ...none("changesSignificantPending"), waiting: (f) => f.changes === 0 },
      { key: "docs", path: "/isms/changes", ...none("changesNoDocs"), waiting: (f) => f.changes === 0 },
    ],
  },
  {
    id: "dora",
    module: "suppliers",
    perm: "suppliers:read",
    path: "/suppliers/dora",
    applies: (f) => f.doraEntity > 0,
    steps: [
      { key: "entity", path: "/admin/companies", ...none("doraLeiMissing") },
      { key: "functions", path: "/processes", ...exists("doraFunctions") },
      { key: "providers", path: "/suppliers", ...exists("doraProviders") },
      { key: "contracts", path: "/suppliers", ...exists("doraContracts"), waiting: (f) => f.doraProviders === 0 },
      { key: "complete", path: "/suppliers/dora", ...none("doraFindings"), waiting: (f) => f.doraProviders === 0 },
    ],
  },
  {
    id: "soc",
    module: "soc",
    perm: "soc:read",
    writePerm: "soc:write",
    path: "/soc",
    steps: [
      { key: "sources", path: "/soc", ...exists("socSources") },
      { key: "triage", path: "/soc", ...none("alertsUntriaged"), waiting: (f) => f.socSources === 0 },
      { key: "hunts", path: "/soc", ...exists("socHunts"), waiting: (f) => f.socSources === 0 },
      { key: "detection", path: "/risks/scenarios?tab=detection", done: (f) => f.detectionMeasured > 0 && f.detectionBlind === 0, count: (f) => (f.detectionMeasured ? f.detectionBlind : 1), waiting: (f) => f.socSources === 0 },
    ],
  },
  {
    id: "access",
    module: "access",
    perm: "access:manage",
    writePerm: "access:manage",
    path: "/access",
    steps: [
      { key: "people", path: "/access", ...exists("iamPeople") },
      { key: "catalog", path: "/access", ...exists("iamResources"), waiting: (f) => f.iamPeople === 0 },
      { key: "owners", path: "/access", ...none("iamResourcesNoOwner"), waiting: (f) => f.iamResources === 0 },
      { key: "roles", path: "/access", ...exists("iamRoles"), waiting: (f) => f.iamResources === 0 },
      { key: "requests", path: "/access", ...none("iamRequestsStale"), waiting: (f) => f.iamResources === 0 },
      { key: "leavers", path: "/access", ...none("iamLeaverGrants"), waiting: (f) => f.iamPeople === 0 },
      { key: "certify", path: "/access", ...exists("iamCertifications12"), waiting: (f) => f.iamResources === 0 },
    ],
  },
  {
    id: "org",
    module: "organization",
    perm: "org:read",
    path: "/organization",
    steps: [
      { key: "units", path: "/organization", ...exists("orgUnits") },
      { key: "positions", path: "/organization", ...exists("positions"), waiting: (f) => f.orgUnits === 0 },
      { key: "holders", path: "/organization", ...none("positionsUnfilled"), waiting: (f) => f.positions === 0 },
      { key: "processOwners", path: "/processes", ...none("processesNoOwner"), waiting: (f) => f.processes === 0 },
      { key: "processSteps", path: "/processes", ...none("processesNoSteps"), waiting: (f) => f.processes === 0 },
    ],
  },
  {
    id: "exceptions",
    module: "risks",
    perm: "risks:read",
    path: "/exceptions",
    steps: [
      { key: "expired", path: "/exceptions", ...none("exceptionsExpired") },
      { key: "expiring", path: "/exceptions", ...none("exceptionsExpiring") },
      { key: "compensating", path: "/exceptions", ...none("exceptionsNoCompensating") },
    ],
  },
  {
    id: "soc2",
    module: "soc2",
    perm: "audits:read",
    writePerm: "audits:write",
    path: "/soc2",
    steps: [
      { key: "engagement", path: "/soc2", ...exists("soc2Engagements") },
      { key: "description", path: "/soc2", ...none("soc2NoDescription"), waiting: (f) => f.soc2Engagements === 0 },
      { key: "mapping", path: "/controls", ...exists("soc2Controls"), waiting: (f) => f.soc2Engagements === 0 },
      { key: "tests", path: "/controls/assurance", ...exists("soc2Tests12"), waiting: (f) => f.soc2Controls === 0 },
      { key: "exceptions", path: "/audits", ...none("soc2ExceptionsOpen"), waiting: (f) => f.soc2Engagements === 0 },
      { key: "report", path: "/soc2", ...exists("soc2Reports"), waiting: (f) => f.soc2Engagements === 0 },
    ],
  },
  {
    id: "trust",
    module: "trust",
    perm: "trust:read",
    path: "/trust",
    steps: [
      { key: "library", path: "/trust", ...exists("trustLibrary") },
      { key: "questionnaires", path: "/trust", ...none("trustQOverdue") },
      { key: "inProgress", path: "/trust", ...none("trustQOpen") },
      { key: "center", path: "/trust", ...exists("trustCenter"), waiting: (f) => f.trustLibrary === 0 },
      { key: "requests", path: "/trust", ...none("trustRequestsPending"), waiting: (f) => f.trustCenter === 0 },
    ],
  },
];
export type GuideId = (typeof GUIDES)[number]["id"];
export const guideById = (id: string) => GUIDES.find((g) => g.id === id) ?? null;

export interface GuideStepDto {
  key: string;
  path: string;
  /** Odkazy na předpis hlavního rámce společnosti (v1.45). */
  refs?: string[];
  state: "done" | "todo" | "waiting";
  count: number;
}
export interface GuideDto {
  id: string;
  /** Garant postupu (funkční místo) – dostává další krok do Moje práce. */
  owner?: { positionId: string; name: string } | null;
  /** Smí uživatel nastavit garanta. */
  canEdit?: boolean;
  module: string;
  path: string;
  steps: GuideStepDto[];
  /** Doporučený další krok (první nehotový, na který se nečeká). */
  next: string | null;
  /** Podíl hotových kroků 0–100 (čekající se nepočítají). */
  progress: number;
}

export function evaluateGuide(g: GuideDef, f: GuideFacts): GuideDto {
  const steps: GuideStepDto[] = g.steps.map((s) => {
    // krok, na který se čeká, není hotový ani „k vyřízení“ (např. vlastníci rizik bez rizik)
    const waiting = !!s.waiting?.(f);
    const done = !waiting && s.done(f);
    return { key: s.key, path: s.path, state: done ? "done" : waiting ? "waiting" : "todo", count: done ? 0 : s.count(f) };
  });
  const progress = steps.length ? Math.round((steps.filter((s) => s.state === "done").length / steps.length) * 100) : 0;
  return { id: g.id, module: g.module, path: g.path, steps, next: steps.find((s) => s.state === "todo")?.key ?? null, progress };
}

/** Celkový stav cesty k souladu: průměr postupu průvodců. */
export function compliancePathSummary(list: GuideDto[]): { progress: number; todo: number; done: number } {
  return {
    progress: list.length ? Math.round(list.reduce((s, g) => s + g.progress, 0) / list.length) : 0,
    todo: list.reduce((s, g) => s + g.steps.filter((x) => x.state === "todo").length, 0),
    done: list.reduce((s, g) => s + g.steps.filter((x) => x.state === "done").length, 0),
  };
}

/** Řádek přehledu skupiny: postup společnosti celkem a po průvodcích. */
export interface GroupGuideRow {
  companyId: string;
  name: string;
  summary: { progress: number; todo: number; done: number };
  guides: Record<string, { progress: number; next: string | null; todo: number }>;
}

/** Oprávnění k úpravám průvodce (garant): explicitní, jinak `<modul>:write`. */
export const guideWritePerm = (g: GuideDef): Permission => g.writePerm ?? (g.perm.replace(/:read$/, ":write") as Permission);

export const GuideOwnerInput = z.object({ positionId: z.string().uuid().nullable() });

/* ---------- vazba kroků na předpisy (v1.45, ADR-142) ---------- */

/**
 * Kroky průvodců → § vyhlášky 409/2025 (oddíly). Ostatní rámce (410, ISO 27001, NIS2, DORA, SOC 2, CIS) se odvodí
 * přes `relatedRequirements` (crosswalk ve `frameworks`). Kroky mimo kybernetickou bezpečnost (GDPR, AI Act, CRA) nemají.
 */
export const GUIDE_SECTIONS_409: Record<string, string[]> = {
  "isms.roles": ["5"], "isms.policy": ["6"], "isms.objectives": ["3"], "isms.soa": ["3"], "isms.riskReport": ["8"], "isms.review": ["3", "4"],
  "changes.register": ["11"], "changes.assess": ["11"], "changes.approve": ["11"], "changes.docs": ["11", "6"],
  "risks.assets": ["7"], "risks.appetite": ["8"], "risks.identify": ["8"], "risks.scenario": ["8"], "risks.assess": ["8"], "risks.owners": ["8"], "risks.treat": ["8"], "risks.plan": ["8"], "risks.review": ["8"],
  "controls.scope": ["3"], "controls.catalog": ["3"], "controls.owners": ["5"], "controls.implement": ["3"], "controls.test": ["3", "16"], "controls.evidence": ["3"], "controls.monitor": ["21"],
  "audits.plan": ["16"], "audits.conduct": ["16"], "audits.findings": ["16", "3"], "audits.overdue": ["16"],
  "continuity.processes": ["15"], "continuity.bia": ["15"], "continuity.approve": ["15"], "continuity.plans": ["15"], "continuity.planQuality": ["15"], "continuity.test": ["15"], "continuity.exercise": ["15"],
  "incidents.assess": ["23"], "incidents.report": ["14"], "incidents.deadlines": ["14"], "incidents.handle": ["14"], "incidents.lessons": ["14"],
  "suppliers.register": ["9"], "suppliers.significant": ["9"], "suppliers.contracts": ["9"], "suppliers.quality": ["9"], "suppliers.assurance": ["9"], "suppliers.review": ["9"],
  "assets.inventory": ["7"], "assets.sources": ["7"], "assets.owners": ["7"], "assets.primary": ["7"], "assets.links": ["7"], "assets.eol": ["12"],
  "vulnerabilities.scan": ["12"], "vulnerabilities.kev": ["12"], "vulnerabilities.exposed": ["12", "18"], "vulnerabilities.overdue": ["12"],
  "policies.policy": ["6"], "policies.owners": ["6"], "policies.quality": ["6"], "policies.approval": ["6"], "policies.review": ["6"], "policies.ack": ["6", "10"],
  "awareness.plan": ["10"], "awareness.sessions": ["10"], "awareness.overdue": ["10"],
  "identity.source": ["19"], "identity.findings": ["19"], "identity.mfa": ["19"], "identity.sod": ["20"], "identity.review": ["20"],
  "access.people": ["10"], "access.catalog": ["20"], "access.owners": ["20"], "access.roles": ["20"], "access.requests": ["13", "20"], "access.leavers": ["10", "20"], "access.certify": ["20"],
  "soc.sources": ["21"], "soc.triage": ["23"], "soc.hunts": ["21"], "soc.detection": ["21"],
  "org.units": ["5"], "org.positions": ["5"], "org.holders": ["5"], "org.processOwners": ["3"], "org.processSteps": ["3"],
  "soc2.engagement": ["16"], "soc2.description": ["3"], "soc2.mapping": ["3"], "soc2.tests": ["3", "16"], "soc2.exceptions": ["16"], "soc2.report": ["16"],
  "exceptions.expired": ["3"], "exceptions.expiring": ["3"], "exceptions.compensating": ["3"],
};
/** Přímé odkazy mimo crosswalk (DORA registr informací). */
export const GUIDE_DIRECT_REFS: Record<string, string[]> = {
  "dora.entity": ["dora:28"], "dora.functions": ["dora:28"], "dora.providers": ["dora:28"], "dora.contracts": ["dora:28", "dora:30"], "dora.complete": ["dora:28"],
};

/** Požadavky rámce, ke kterým krok průvodce patří. */
export function stepRequirements(guideId: string, stepKey: string, fw: string): Requirement[] {
  const k = `${guideId}.${stepKey}`;
  const secs = GUIDE_SECTIONS_409[k] ?? [];
  const out = new Map<string, Requirement>();
  if (fw === "cz409") for (const r of requirementsOf("cz409")) if (secs.includes(r.section.replace("§ ", ""))) out.set(r.id, r);
  for (const sec of secs) for (const r of relatedRequirements(sec)) if (r.framework === fw) out.set(r.id, r);
  for (const id of GUIDE_DIRECT_REFS[k] ?? []) for (const r of requirementsOf(fw)) if (r.id === id || r.id.startsWith(`${id}/`)) out.set(r.id, r);
  return [...out.values()];
}

/**
 * Odkazy kroků mimo kybernetickou bezpečnost (v1.46, ADR-143) – nezávisle na hlavním rámci společnosti:
 * GDPR (nařízení 2016/679), AI Act (nařízení 2024/1689), CRA (nařízení 2024/2847).
 */
export const GUIDE_STATIC_REFS: Record<string, string[]> = {
  "gdpr.ropa": ["GDPR čl. 30"],
  "gdpr.complete": ["GDPR čl. 30 odst. 1"],
  "gdpr.links": ["GDPR čl. 30", "čl. 32"],
  "gdpr.dpia": ["GDPR čl. 35"],
  "gdpr.review": ["GDPR čl. 24 odst. 1"],
  "aiact.inventory": ["AI Act čl. 26"],
  "aiact.screen": ["AI Act čl. 5", "čl. 6", "příl. III"],
  "aiact.decide": ["AI Act čl. 26"],
  "aiact.literacy": ["AI Act čl. 4"],
  "cra.products": ["CRA čl. 13"],
  "cra.conformity": ["CRA čl. 32"],
  "cra.sbom": ["CRA příl. I část II bod 1"],
  "cra.vulns": ["CRA čl. 14", "příl. I část II"],
};

/** Krátké odkazy kroku (oddíly u vyhlášek, jinak citace) – nejvýš 3. */
export function stepRefs(guideId: string, stepKey: string, fw: string): string[] {
  const fixed = GUIDE_STATIC_REFS[`${guideId}.${stepKey}`];
  if (fixed) return fixed;
  const reqs = stepRequirements(guideId, stepKey, fw);
  const decree = fw === "cz409" || fw === "cz410" || fw === "zkb";
  const labels = [...new Set(reqs.map((r) => (decree ? r.section : r.ref)))];
  return labels.slice(0, 3).concat(labels.length > 3 ? ["…"] : []);
}

/* ---------- příprava na audit (v1.45, ADR-142) ---------- */

export const AUDIT_FRAMEWORKS = ["cz409", "cz410", "nis2", "iso27001", "dora"] as const;
export type AuditFramework = (typeof AUDIT_FRAMEWORKS)[number];

export interface AuditSectionDto {
  section: string;
  title: string;
  requirements: number;
  applicable: number;
  compliant: number;
  partial: number;
  nonCompliant: number;
  unassessed: number;
  controls: number;
  docs: number;
  /** Připravenost 0–100: shoda požadavků (částečná = polovina) – null, když nic neposouzeno. */
  readiness: number | null;
  steps: { guide: string; key: string; state: GuideStepDto["state"]; count: number; path: string }[];
  /** Mezery požadavků oddílu podle druhu (pokrytí předpisu, ADR-038). */
  gaps: Partial<Record<CoverageGap, number>>;
}
export interface AuditReadinessDto {
  framework: AuditFramework;
  sections: AuditSectionDto[];
  summary: { readiness: number | null; sections: number; ready: number; stepsTodo: number };
}

/** Stav oddílu: připraven (≥ 80 % a žádný otevřený krok), částečně, nepřipraven. */
export function auditSectionState(s: Pick<AuditSectionDto, "readiness" | "steps">): "ready" | "partial" | "missing" {
  const todo = s.steps.some((x) => x.state === "todo");
  if (s.readiness != null && s.readiness >= 80 && !todo) return "ready";
  if ((s.readiness ?? 0) >= 40 || s.steps.some((x) => x.state === "done")) return "partial";
  return "missing";
}

/* ---------- úvodní cesta (v1.45, ADR-142) ---------- */

/** Doporučené pořadí zavádění: fáze → průvodci (jen zapnuté se zobrazí). */
export const ONBOARDING_PHASES: { key: string; guides: string[] }[] = [
  { key: "foundation", guides: ["org", "isms", "assets"] },
  { key: "analysis", guides: ["continuity", "risks", "suppliers"] },
  { key: "measures", guides: ["controls", "policies", "awareness", "identity", "access"] },
  { key: "operations", guides: ["vulnerabilities", "incidents", "soc", "changes", "exceptions"] },
  { key: "verification", guides: ["audits", "soc2", "trust", "dora", "gdpr", "aiact", "cra", "legislation"] },
];

/** Aktuální fáze zavádění: první, ve které některý průvodce není na 100 %. */
export function onboardingState(list: Pick<GuideDto, "id" | "progress">[]): { phase: string | null; phases: { key: string; progress: number; guides: string[] }[] } {
  const phases = ONBOARDING_PHASES.map((p) => {
    const gs = list.filter((g) => p.guides.includes(g.id));
    return { key: p.key, guides: gs.map((g) => g.id), progress: gs.length ? Math.round(gs.reduce((s, g) => s + g.progress, 0) / gs.length) : 100 };
  }).filter((p) => p.guides.length);
  return { phase: phases.find((p) => p.progress < 100)?.key ?? null, phases };
}

/* ---------- startovací balíček (v1.46, ADR-143) ---------- */

export const STARTER_ITEMS = ["folders", "catalog", "policy", "objectives"] as const;
export type StarterItem = (typeof STARTER_ITEMS)[number];
export const StarterInput = z.object({ items: z.array(z.enum(STARTER_ITEMS)).min(1).max(4) });
export interface StarterResult {
  item: StarterItem;
  status: "created" | "exists" | "skipped" | "error";
  detail: string | null;
}

/* ---------- přenos nastavení průvodců mezi instalacemi (v1.47, ADR-144) ---------- */

export const GuideConfig = z.object({
  format: z.literal("contix-guides"),
  version: z.literal(1),
  /** Garanti podle názvu funkčního místa a útvaru (ID se mezi instalacemi liší). */
  owners: z.array(z.object({ guide: z.string().max(40), position: z.string().max(300), unit: z.string().max(300).nullable() })).max(100),
  /** Profil hrozeb (odvětví a ruční rozhodnutí o aktérech). */
  threatProfile: z.object({ sector: z.string().max(40).nullable(), overrides: z.record(z.string().max(40), z.object({ relevant: z.boolean(), reason: z.string().max(1000) })) }).nullable(),
});
export type GuideConfig = z.infer<typeof GuideConfig>;
export interface GuideConfigImportResult {
  owners: { guide: string; position: string; status: "applied" | "unmatched" | "unknown_guide" }[];
  threatProfile: "applied" | "skipped";
}
