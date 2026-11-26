import type {
  IntegrationMapDto,
  FindingsQuery,
  FindingPlanViewDto,
  FindingEscalationDto,
  QualityDto,
  QualityFixInput,
  FindingsRemediationDto,
  RemediationQuery,
  UnifiedFindingsDto,
  HostFindingPatch,
  UserHandoverInput,
  UserResponsibilitiesDto,
  HealthDto,
  CapabilityDto,
  CapabilityDeclarationInput,
  ScenarioProposalDto,
  ThreatCoverageDto,
  DetectionDto,
  RiskAppetiteDto,
  GroupRiskRowDto,
  PlanSuggestionDto,
  CraAdvisoryDto,
  CraSupplyCheckStatus,
  NvdSettings,
  CraFindingDto,
  OsvStatusDto,
  VexStatus,
  VexJustification,
  CraProductDto,
  CraProductInput,
  CraReportDto,
  CraReportInput,
  CraReportSection,
  CraReportStage,
  CraReqStatus,
  CraComponentDto,
  Soc2DetailDto,
  Soc2EngagementInput,
  Soc2EngagementListItem,
  Soc2Conclusion,
  AiSystemDto,
  AiSystemInput,
  AiSummaryDto,
  AiObligationStatus,
  FriaInput,
  FeedItemKind,
  InfoAssessmentDto,
  InfoAssessmentInput,
  InfoAssessmentStatus,
  InfoAssetSuggestion,
  InfoLinkKind,
  IncidentMonthInput,
  IncidentStatsProposal,
  InfoFeedItemDto,
  InfoServiceDto,
  InfoServiceSettingsInput,
  ExerciseDto,
  ExerciseTemplate,
  ExerciseInput,
  ExercisePatch,
  ExerciseLogInput,
  ExerciseCompleteInput,
  ResilienceDto,
  ScaOverviewDto,
  ScaAssetDto,
  AssetGraphDto,
  AssetDependencyInput,
  AssetDependencyDto,
  SocHostListItem,
  SocHostDetail,
  SocPlaybookView,
  SocPlaybookDto,
  SocPlaybookInput,
  SocPlaybookPatch,
  SocPlaybookTasksInput,
  SocHuntDto,
  SocHuntTemplate,
  SocHuntInput,
  SocHuntPatch,
  SocHuntRun,
  RiskReassessmentDto,
  ExceptionDto,
  ExceptionKind,
  ExceptionsSummary,
  CoverageBatchStatus,
  CoverageDto,
  CoverageScoreInput,
  CoverageSnapshotDetail,
  CoverageSnapshotDto,
  CoverageSnapshotInput,
  ControlCrosswalkInput,
  ControlCrosswalkResult,
  LangPack,
  IdentityOverviewDto,
  IdentityFindingDto,
  BulkAcceptIdentityInput,
  IdentityFindingFacets,
  IdentityReportKind,
  IdentityReportScheduleDto,
  IdentityReportScheduleInput,
  IdentityAccountDto,
  IdentityComputerDto,
  IdentityComputerSummary,
  AccountActivity,
  IdentityInventory,
  WazuhAgentsDto,
  SecurityZoneDto,
  SecurityZoneInput,
  ZoneMapDto,
  IdentityAccountDetail,
  IdentitySourceDto,
  IdentitySourceInput,
  IdentityTestResult,
  AcceptIdentityFindingInput,
  SodRuleDto,
  ProvisioningPlan,
  ProvisioningResultDto,
  ControlAutomationDto,
  ControlAutomationInput,
  SodRuleInput,
  SodViolationDto,
  AccessReviewDto,
  AccessReviewDetail,
  AccessReviewInput,
  AccessReviewItemDto,
  AccessReviewDecisionInput,
  DpiaDto,
  DpiaInput,
  ProcessingActivityDto,
  ProcessingActivityInput,
  ProcessVersionDetail,
  ProcessVersionDto,
  ProcessVersionInput,
  DashboardDto,
  ManagementReport,
  CompleteTestInput,
  ControlTestDto,
  ControlTestInput,
  EvidenceDto,
  EvidenceInput,
  SampleInput,
  AiDecisionInput,
  AiLogRow,
  PolicyCommentDto,
  PolicyCommentInput,
  PolicyWorkflowInput,
  PortalDocDetail,
  PortalDocItem,
  QuizInput,
  ImportEntity,
  ImportPreviewDto,
  ImportResultDto,
  AiQueryDto,
  AiQueryInput,
  AiToolInfo,
  ApiTokenDto,
  ApiTokenInput,
  AssetDuplicatePair,
  AssetMergeInput,
  AiRequestInput,
  AiSettingsDto,
  AiSettingsInput,
  AiStatusDto,
  AiSuggestionDto,
  BackupRunDto,
  SystemStatusDto,
  AlertSettingsInput,
  AlertSuggestionDto,
  TransferInput,
  TransferResult,
  VulnRiskSuggestion,
  CycleKind,
  CycleListItem,
  CycleStatusDto,
  CycleDetail,
  CycleInput,
  CycleCompareRow,
  QuantPolicy,
  QuantStats,
  RiskLevel,
  CourseDetail,
  CourseInput,
  CourseListItem,
  MyPolicyItem,
  MyTrainingItem,
  PolicyCoverageRow,
  PolicyDetail,
  PolicyLinkKind,
  LegalActDto,
  LegalActDetail,
  LegalWatchInput,
  LegalManualActInput,
  LegalManualVersionInput,
  LegalFragmentDto,
  LegalReviewDto,
  LegalReviewDetail,
  LegalReviewPatch,
  LegalTaskDto,
  LegalTaskInput,
  DocImportOptions,
  DocImportPreviewDto,
  DocImportResultDto,
  PolicyRef,
  PolicyFolderDto,
  PolicyFolderInput,
  PolicyTemplateDto,
  RetentionRow,
  DisposeInput,
  VersionDiffDto,
  PolicySearchHit,
  OfficeOpenDto,
  SetupDto,
  SetupWizardDto,
  OrgUnitOverviewDto,
  AssetBulkInput,
  RiskBulkInput,
  ControlBulkInput,
  DemoStatusDto,
  ProcessBulkInput,
  SupplierBulkInput,
  BulkResultDto,
  DocQaAnswerDto,
  DocIndexStatusDto,
  PolicyInput,
  PolicyListItem,
  PolicyVersionInput,
  RecordInput,
  SessionInput,
  TrainingLogRow,
  ObligationItem,
  NotificationSettingsDto,
  NotificationSettingsInput,
  AuditChecklistDto,
  AuditCheckInput,
  FindingSeverity,
  ImportMethodologyInput,
  MethodologyDef,
  MethodologyDto,
  MethodologyFormat,
  AssetDto,
  AssetInput,
  AssetLinkInput,
  AssetListQuery,
  AssetPatch,
  AuditLogDto,
  ConnectorSettingsDto,
  WazuhConnectionDto,
  WazuhConnectionInput,
  CollectorConnectionDto,
  CollectorConnectionInput,
  ConcentratorConnectionDto,
  ConcentratorConnectionInput,
  AgentDto,
  CollectorInstallerInput,
  ProbeConnectionDto,
  ProbeConnectionInput,
  SecTestScopeDto,
  SecTestScopeInput,
  SecTestRunDto,
  SecTestRunInput,
  SecTestImportInput,
  SecTestFindingDto,
  SecTestFindingStatus,
  SecTestBatchDto,
  SecTestSummaryDto,
  BrandingDto,
  BrandingInput,
  RegulationAssessmentDto,
  RegistrationDto,
  RegistrationData,
  SecTestScheduleDto,
  SecTestScheduleInput,
  RegulationAssessmentInput,
  ResLookupDto,
  SecTestBatchInput,
  SecTestTasksResult,
  SecTestId,
  HostInventoryDto,
  HostDetailDto,
  HostSummaryDto,
  TagDto,
  TagInput,
  TagEntity,
  TaggedObjectDto,
  DataLocationDto,
  DataLocationInput,
  NetboxConnectionDto,
  NetboxConnectionInput,
  JiraConnectionDto,
  JiraConnectionInput,
  ExternalIssueDto,
  ConnectorTestResult,
  ScanSettingsInput,
  WazuhSettingsInput,
  AuthProviderInfo,
  DiscoveryRunDto,
  EffectiveCia,
  GroupDto,
  GroupInput,
  LinkedAssetDto,
  MeDto,
  NetworkScanRequest,
  Paged,
  RoleDto,
  RoleInput,
  Settings,
  UserCreate,
  UserDto,
  UserUpdate,
  VulnerabilityDto,
  VulnSummaryDto,
  VulnScanDto,
  CustomerQDto,
  CustomerQDetailDto,
  CustomerQPreviewDto,
  QaItemPatch,
  AnswerLibraryDto,
  AnswerLibraryInput,
  TrustSettingsDto,
  TrustSettingsInput,
  TrustAccessRequestDto,
  PublicTrustDto,
  TrustAccessRequestInput,
  SupplierReportDto,
  SupplierReportDetailDto,
  SupplierReportInput,
  SupplierReportPatch,
  SupplierReportItemInput,
  SupplierReportItemPatch,
  VulnMetricsDto,
  DefectDojoStatusDto,
  DefectDojoSettingsInput,
  ControlMonitorDto,
  ControlHardeningDto,
  ControlMonitorInput,
  MonitorRunDto,
  MonitorPeriodTestInput,
  VulnScanPreviewDto,
  VulnTriageInput,
  AcceptVulnInput,
  Severity,
  VulnStatus,
  CatalogItemDto,
  CatalogItemInput,
  OrgUnitDto,
  OrgUnitInput,
  PositionInput,
  ProcessDetail,
  ProcessInput,
  ProcessListItem,
  RiskDetail,
  RiskInput,
  RiskListItem,
  RiskSummaryDto,
  StepDto,
  StepInput,
  BiaDetail,
  BiaInput,
  BiaListItem,
  ComplianceSummary,
  ControlDetail,
  ControlInput,
  ControlListItem,
  FrameworkId,
  FrameworkMeta,
  RequirementAssessmentInput,
  RequirementRow,
  TreatmentActionDto,
  TreatmentActionInput,
  CreateDocumentInput,
  DocKind,
  DocumentVersionDto,
  PlanDetail,
  PlanInput,
  PlanListItem,
  PlanTestInput,
  SupplierDetail,
  SupplierInput,
  SupplierListItem,
  ContractInput,
  ChangeDetail,
  ChangeInput,
  ChangeListItem,
  IsmsOverviewDto,
  ObjectiveDto,
  ObjectiveInput,
  IncidentDetail,
  IncidentReportDraft,
  NetSegmentDto,
  NetSegmentInput,
  NetObservationDto,
  AuditPortalDto,
  AuditRequestDetail,
  AuditRequestInput,
  TlsOverview,
  TlsEndpointInput,
  TlsEndpointDto,
  DoraRegisterDto,
  DoraContractInput,
  DoraProvider,
  DoraEntity,
  ReportType,
  IncidentInput,
  IncidentListItem,
  IncidentReportInput,
  AuditCoverageRow,
  AuditScopeCoverageDto,
  AuditDetail,
  AuditInput,
  AuditListItem,
  FindingDto,
  FindingInput,
  CompanyDto,
  CompanyInput, AresSubject, TrendDto, RecordIndexStatusDto, RecordKind, RecordSearchResult, RecordSimilarResult, RecordAskAnswer,
  SocAdvisorAnswer,
  SocCaseCreate,
  SocCaseDetailDto,
  SocCaseDto,
  SocCasePatch,
  SocRuleStat,
  SocSettings,
  SocSettingsInput,
  SocSuppressionDto,
  SocSuppressionInput,
  SocAlertCreate,
  SocAlertDetailDto,
  SocAlertDto,
  SocAlertPatch,
  SocAnalyst,
  SocSeverity,
  SocSummaryDto,
  SocRiskSignals,
  SocSourceDto,
  SocMetricsDto,
  TiStatusDto,
  SavedViewDto,
  VulnCveDetail,
  VulnAdviceDto,
  SavedViewInput,
  ViewPage,
  SocIntegrationsDto,
  SocIntegrationsInput,
  EnrichOptionsDto,
  EnrichRunInput,
  SocEnrichmentDto,
  MispShareInput,
  MispShareResult,
  TiSettingsInput,
  IncidentSocEvidence,
  IncidentSocDraft,
  SocIocDto,
  SocActionDto,
  SocActionInput,
  SocResponseSettings,
  SocResponseSettingsInput,
  SocIocInput,
  SocIocPatch,
  SocIocCreateResult,
  SocIocCandidate,
  SocIocFeedDto,
  SocIocFeedSecret,
  SocSourceInput,
  SocSourcePatch,
  SocSourceSecret,
  PhishingReportResult,
  VulnFixPlanItem,
  VulnIntelSettingsInput,
  VulnIntelStatusDto,
  VulnPriority,
  SocVerdict, ActionItem, ActionSummary, ActionKind, TaskDto, TaskInput, TaskPatch, TaskSource, PublicQuestionnaireDto, QuestionnaireCreateInput, QuestionnaireDto, QuestionnaireEvaluateInput, QuestionnaireSaveInput, QuestionnaireSubmitInput, LoginAdminDto, AdLoginSourceInput, AdLoginSourceDto, AdLoginTestInput, AdLoginTestResult, SsoProviderInput, SsoProviderDto, CustomFrameworkDto, FrameworkLibraryItem, FrameworkImportPreview, FrameworkExportFormat,
  BacklinksDto,
  PositionUsageDto,
  PositionHandoverInput,
  KnowledgeArticleDto,
  KnowledgeArticleInput,
  RecordIndexItemDto,
  RecordIndexSettings,
  QuickHit,
  LinkTarget,
  CraLinksDto,
  CraLinksInput,
  TaskPriority,
  TaskStatus,
  ExceptionControlsInput,
  TuningProposalDto,
  TuningProposalInput,
  SiteMapDto,
  SiteMapDetailDto,
  PersonDto,
  PersonInput,
  PeopleImportDto,
  AccessResourceDto,
  AccessResourceInput,
  AccessRequestDto,
  AccessRequestInput,
  AccessGrantDto,
  ImportSettingsDto,
  ImportSettingsInput,
  CertificationDto,
  CertificationInput,
  CertItemDto,
  ReconDto,
  ProvisioningSettingsDto,
  ProvisioningSettingsInput,
  ProvisioningPlanItem,
  ProvisioningResult,
  ProvisioningGroupOp,
  AdGroupsDto,
  ImportAdGroupsInput,
  IdmOverviewDto,
  BusinessRoleDto,
  BusinessRoleInput,
  MatrixDto,
  PersonOverviewDto,
  SodConflict,
  JmlPreviewInput,
  JmlPreviewDto,
  JmlApplyInput,
  JmlResultDto,
  CraDocInfo,
  CraDocInfoInput,
  CraDocument,
  ProjectTemplateDto,
  ProjectTemplateInput,
  ProjectMemberInput,
  ProjectTaskInput,
  ProjectTaskPatch,
  MilestoneInput,
  ProjectIssueInput,
  StatusReportInput,
  ChangeRequestInput,
  ProjectCostInput,
  ProjectDto,
  ProjectDetailDto,
  ProjectInput,
  ProjectPatch,
  AttackPathsDto,
  AttackPathDecisionInput,
  CalibrationDto,
  ModelingOverviewDto,
  GuideDto,
  AuditReadinessDto,
  StarterItem,
  GuideConfigImportResult,
  StarterResult,
  GroupGuideRow,
  ThreatLandscapeDto,
  ThreatModelDto,
  ThreatModelInput,
  ThreatModelPatch,
  ThreatProfileInput,
  TmElement,
  TmThreat,
  CalendarDto,
  DashboardTechDto,
  CalendarFeedDto,
  CalendarFeedInput,
  ZoneSuggestionDto,
  ZoneFlowControlInput,
  LocationsDto,
  LocationDetailDto,
  PersonCertDto,
  VulnBulkSuppressInput,
  VulnSuppressRuleDto,
  VulnSuppressRuleInput,
  PersonCertListDto,
  PersonCertHoldersDto,
  PersonCertInput,
  LocationInput,
  LocationPatch,
} from "@contix/shared";
import { tt } from "./i18n";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Voláno při 401 – aplikace se přepne na přihlašovací obrazovku. */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

/* ---------- aktivní společnost skupiny ---------- */
const COMPANY_KEY = "contix.company";
let activeCompany: string | null = (() => {
  try {
    return localStorage.getItem(COMPANY_KEY);
  } catch {
    return null;
  }
})();
export const getActiveCompany = () => activeCompany;
/** id společnosti, `group` = souhrnný pohled, null = výchozí dle serveru. */
export function setActiveCompany(id: string | null) {
  activeCompany = id;
  try {
    if (id) localStorage.setItem(COMPANY_KEY, id);
    else localStorage.removeItem(COMPANY_KEY);
  } catch {
    /* prohlížeč bez úložiště – volba platí do obnovení stránky */
  }
}
/** Odkaz otevíraný mimo fetch (tisk, CSV) – nese aktivní společnost v parametru. */
export const withCompany = (url: string) => (activeCompany ? `${url}${url.includes("?") ? "&" : "?"}_co=${encodeURIComponent(activeCompany)}` : url);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (activeCompany) headers.set("x-contix-company", activeCompany);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: "include", ...init, headers });
  } catch {
    // spojení přerušené (server neodpověděl, proxy ukončila požadavek) – nikdy prázdná chyba
    throw new ApiError(0, tt("err.network"), null);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    let issue = (body as any)?.error?.issues?.[0];
    // zValidator vrací issues jako JSON v error.message
    if (!issue && typeof (body as any)?.error?.message === "string") {
      try {
        issue = JSON.parse((body as any).error.message)?.[0];
      } catch {
        /* není JSON */
      }
    }
    const msg = issue ? `${issue.path?.join(".") ?? ""}: ${issue.message}` : ((body as any)?.error || res.statusText || `HTTP ${res.status}`);
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(res.status, typeof msg === "string" ? msg : "Chyba požadavku", body);
  }
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
const patch = <T>(path: string, data: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(data) });
const del = <T = void>(path: string) => request<T>(path, { method: "DELETE" });
const put = <T>(path: string, data: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(data) });

export interface GroupOverviewRow {
  id: string;
  name: string;
  kind: "holding" | "company";
  depth: number;
  regime: "higher" | "lower" | "none";
  framework: "cz409" | "cz410";
  compliance: number | null;
  risks: { total: number; critical: number; high: number; unacceptable: number; overdueActions: number; ale: number | null; cycle: CycleStatusDto | null } | null;
  incidents: { open: number; overdueReports: number } | null;
  plans: { approved: number; biaCycle: CycleStatusDto | null } | null;
  suppliers: { significant: number; withGaps: number } | null;
  review: { lastApprovedAt: string | null; nextDue: string | null; overdue: boolean } | null;
}

export interface QuantOverview {
  policy: QuantPolicy;
  items: { id: string; companyId: string; code: string | null; name: string; level: RiskLevel | null; ale: number; p95: number; probAny: number; quantLevel: RiskLevel; residualAle: number | null; reduction: number | null; rosi: number | null; controlCostYear: number | null }[];
  portfolio: QuantStats | null;
  residualPortfolio: QuantStats | null;
  unquantified: number;
}

export type AssetListItem = AssetDto & { ownerDisplayName: string | null };

export type AssetDetail = AssetDto & {
  owner: { id: string; displayName: string; email: string } | null;
  technicalOwner?: { id: string; displayName: string; email: string } | null;
  technicalDeputy?: { id: string; displayName: string; email: string } | null;
  sources: { sourceType: string; sourceRef: string; lastSyncedAt: string }[];
  software: { name: string; version: string | null; vendor: string | null }[];
  supports: LinkedAssetDto[];
  supportedBy: LinkedAssetDto[];
  dependsOn: AssetDependencyDto[];
  dependedBy: AssetDependencyDto[];
  /** Umístění (v1.104): lokality a rack od kořene po bezprostřední kontejner. */
  locationPath?: { id: string; name: string; assetType: string }[];
  effectiveCia: EffectiveCia;
  canEdit: boolean;
  /** Smí nastavit sdílení se společnostmi holdingu (ADR-085). */
  canShare: boolean;
  sharedWith: string[];
  /** Vlastní společnost aktiva je v rozsahu (jinak je aktivum jen sdílené / ze skupiny). */
  ownedHere: boolean;
};

export interface ConnectorInfo {
  id: string;
  label: string;
  enabled: boolean;
  detail?: string;
  allowedCidrs?: string[];
  /** Wazuh: připojení, která lze synchronizovat (v1.49). */
  connections?: { id: string; name: string; url: string }[];
}

export interface DirectoryUser {
  id: string;
  displayName: string;
  email: string;
  jobTitle: string | null;
}

export type Stats = Record<"byType" | "byCriticality" | "bySource" | "byClass", { key: string; n: number }[]> & {
  withoutOwner: number;
};

export interface AdminSettings {
  settings: Settings;
  identityProviders: { id: string; label: string; issuer: string; redirectUri: string }[];
  appUrl: string;
}

const VIEW_BASE: Record<ViewPage, string> = { incidents: "/incidents", soc_alerts: "/soc", risks: "/risks", controls: "/controls", suppliers: "/suppliers" };
const qs = (q: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString();

/** Filtr nálezů identit (v1.89) – seznam, počty, exporty, reporty. */
export type BackupTestRequestDto = { pending: { requestedAt: string; by: string | null; stale: boolean } | null };
export type IdentityComputerFilter = { sourceId?: string; role?: string; q?: string; view?: "active" | "stale" | "eol" | "noAsset" | "unmonitored" | "findings" | "disabled"; removed?: "1" };
export type IdentityFindingFilter = { status?: string; severity?: string; rule?: string; sourceId?: string; accountId?: string; computerId?: string; q?: string };

export const api = {
  health: () => request<HealthDto>("/health"),

  i18n: {
    list: () =>
      request<{ defaultLocale: string; locales: { locale: string; name: string; nativeName: string; fallback: string | null; completeness: number; builtin: boolean; custom: boolean; helpTopics: number }[] }>("/i18n"),
    packs: (locale: string) => request<{ locale: string; packs: LangPack[] }>(`/i18n/packs/${encodeURIComponent(locale)}`),
    setMine: (locale: string | null) => request<{ locale: string | null }>("/i18n/me", { method: "PATCH", body: JSON.stringify({ locale }) }),
    upload: (file: File, meta: { locale?: string; name?: string; nativeName?: string; fallback?: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(meta)) if (v) fd.append(k, v);
      return request<{ locale: string; messages: number; ignored: number; completeness: number }>("/i18n/admin", { method: "POST", body: fd });
    },
    remove: (locale: string) => request<void>(`/i18n/admin/${encodeURIComponent(locale)}`, { method: "DELETE" }),
    exportUrl: (locale: string, format: "csv" | "json") => `/api/i18n/admin/${encodeURIComponent(locale)}/export?format=${format}`,
  },
  auth: {
    providers: () => request<{ organizationName: string; local: boolean; ad: boolean; oidc: AuthProviderInfo[] }>("/auth/providers"),
    me: () => request<MeDto>("/auth/me"),
    login: (email: string, password: string) => post<{ ok: boolean; mfaRequired: boolean }>("/auth/login", { email, password }),
    logout: () => post("/auth/logout"),
    verifyMfa: (code: string) => post("/auth/mfa/verify", { code }),
    setupMfa: () => post<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup"),
    enableMfa: (code: string) => post<{ recoveryCodes: string[] }>("/auth/mfa/enable", { code }),
    disableMfa: (password: string) => post("/auth/mfa/disable", { password }),
    changePassword: (currentPassword: string, newPassword: string) => post("/auth/password", { currentPassword, newPassword }),
    ssoStartUrl: (provider: string) => `/api/auth/oidc/${provider}/start`,
  },

  pbc: {
    mine: () => request<{ id: string; code: string | null; title: string; status: string; plannedStart: string | null; plannedEnd: string | null; counts: Record<string, number> }[]>("/pbc/mine"),
    portal: (auditId: string) => request<AuditPortalDto>(`/pbc/audits/${auditId}`),
    candidates: () => request<{ id: string; displayName: string; email: string }[]>("/pbc/auditor-candidates"),
    setAuditors: (auditId: string, userIds: string[]) => put<{ ok: true }>(`/pbc/audits/${auditId}/auditors`, { userIds }),
    create: (auditId: string, data: AuditRequestInput) => post<AuditRequestDetail>(`/pbc/audits/${auditId}/requests`, data),
    bulk: (auditId: string, data: { lines: string; ownerPositionId?: string | null; dueDate?: string | null }) => post<{ created: number }>(`/pbc/audits/${auditId}/requests/bulk`, data),
    get: (id: string) => request<AuditRequestDetail>(`/pbc/requests/${id}`),
    update: (id: string, data: Partial<AuditRequestInput> & { status?: "open" | "cancelled" }) => patch<AuditRequestDetail>(`/pbc/requests/${id}`, data),
    upload: (id: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<AuditRequestDetail>(`/pbc/requests/${id}/files`, { method: "POST", body: fd });
    },
    deleteFile: (id: string, fileId: string) => del(`/pbc/requests/${id}/files/${fileId}`),
    fileUrl: (id: string, fileId: string) => `/api/pbc/requests/${id}/files/${fileId}`,
    submit: (id: string) => post<AuditRequestDetail>(`/pbc/requests/${id}/submit`, {}),
    comment: (id: string, body: string) => post<AuditRequestDetail>(`/pbc/requests/${id}/comments`, { body }),
    accept: (id: string) => post<AuditRequestDetail>(`/pbc/requests/${id}/accept`, {}),
    returnBack: (id: string, comment: string) => post<AuditRequestDetail>(`/pbc/requests/${id}/return`, { comment }),
    exportUrl: (auditId: string) => `/api/pbc/audits/${auditId}/export.zip`,
  },
  certificates: {
    list: () => request<TlsOverview>("/assets/certificates"),
    candidates: () => request<{ id: string; name: string; hostname: string; assetType: string; companyId: string }[]>("/assets/certificates/candidates"),
    create: (data: TlsEndpointInput) => post<TlsEndpointDto>("/assets/certificates", data),
    update: (id: string, data: Partial<TlsEndpointInput>) => patch<TlsEndpointDto>(`/assets/certificates/${id}`, data),
    remove: (id: string) => del(`/assets/certificates/${id}`),
    scan: (id: string) => post<TlsEndpointDto>(`/assets/certificates/${id}/scan`, {}),
    scanAll: () => post<{ scanned: number }>("/assets/certificates/scan-all", {}),
  },
  assets: {
    /** withGroup = i aktiva nadřazených společností (sdílené služby holdingu) – pro výběr vazeb. */
    list: (q: Partial<AssetListQuery> & { withGroup?: "1" }) => request<Paged<AssetListItem>>(`/assets?${qs(q)}`),
    locations: () => request<string[]>("/assets/locations"),
    stats: () => request<Stats>("/assets/stats"),
    get: (id: string) => request<AssetDetail>(`/assets/${id}`),
    create: (data: AssetInput) => post<AssetDto>("/assets", data),
    update: (id: string, data: AssetPatch) => patch<AssetDto>(`/assets/${id}`, data),
    remove: (id: string) => del(`/assets/${id}`),
    share: (id: string, companyIds: string[]) => put<{ sharedWith: string[] }>(`/assets/${id}/companies`, { companyIds }),
    link: (data: AssetLinkInput) => post("/assets/links", data),
    unlink: (primaryId: string, supportingId: string) => del(`/assets/links?${qs({ primaryId, supportingId })}`),
    graph: (retired: boolean) => request<AssetGraphDto>(`/assets/graph?retired=${retired ? 1 : 0}`),
    resilience: () => request<ResilienceDto>("/assets/resilience"),
    resilienceProcess: (processId: string) => request<ResilienceDto>(`/assets/resilience/process/${processId}`),
    addDependency: (data: AssetDependencyInput) => post("/assets/dependencies", data),
    removeDependency: (fromId: string, toId: string) => del(`/assets/dependencies?${qs({ fromId, toId })}`),
    duplicates: () => request<AssetDuplicatePair[]>("/assets/duplicates"),
    dismissDuplicate: (a: string, b: string) => post<void>("/assets/duplicates/dismiss", { a, b }),
    merge: (data: AssetMergeInput) => post<{ keepId: string; moved: Record<string, number>; dropped: Record<string, number> }>("/assets/merge", data),
  },

  /** Žádosti o přístup (v1.26, ADR-123). */
  access: {
    summary: () => request<{ toApprove: number; pending: number; toFulfil: number; manage: boolean }>("/access/summary"),
    people: () => request<PersonDto[]>("/access/people"),
    createPerson: (data: PersonInput) => post<PersonDto>("/access/people", data),
    updatePerson: (id: string, data: PersonInput) => put<PersonDto>(`/access/people/${id}`, data),
    removePerson: (id: string) => del(`/access/people/${id}`),
    importPeople: (file: File, commit: boolean, missingAsLeft = false) => {
      const fd = new FormData();
      fd.append("file", file);
      if (commit) fd.append("commit", "1");
      if (missingAsLeft) fd.append("missingAsLeft", "1");
      return request<PeopleImportDto>("/access/people/import", { method: "POST", body: fd });
    },
    resources: () => request<AccessResourceDto[]>("/access/resources"),
    createResource: (data: AccessResourceInput) => post<AccessResourceDto>("/access/resources", data),
    updateResource: (id: string, data: AccessResourceInput) => put<AccessResourceDto>(`/access/resources/${id}`, data),
    removeResource: (id: string) => del(`/access/resources/${id}`),
    requests: (status?: string) => request<AccessRequestDto[]>(`/access/requests${status ? `?status=${status}` : ""}`),
    request: (id: string) => request<AccessRequestDto>(`/access/requests/${id}`),
    createRequest: (data: AccessRequestInput) => post<AccessRequestDto>("/access/requests", data),
    decide: (id: string, decision: "approved" | "rejected", comment?: string) => post<AccessRequestDto>(`/access/requests/${id}/decide`, { decision, comment }),
    fulfil: (id: string, note?: string) => post<AccessRequestDto>(`/access/requests/${id}/fulfil`, { note }),
    cancel: (id: string) => post<AccessRequestDto>(`/access/requests/${id}/cancel`),
    reassign: (id: string, approvalId: string, approverId: string) => post<AccessRequestDto>(`/access/requests/${id}/approvals/${approvalId}/reassign`, { approverId }),
    grants: (history = false) => request<AccessGrantDto[]>(`/access/grants${history ? "?history=1" : ""}`),
    runLifecycle: () => post<{ expiry: number; leaver: number; cancelled: number }>("/access/lifecycle/run"),
    importSettings: () => request<ImportSettingsDto>("/access/import-settings"),
    saveImportSettings: (data: ImportSettingsInput) => put<ImportSettingsDto>("/access/import-settings", data),
    runImport: () => post<ImportSettingsDto>("/access/import-settings/run"),
    certifications: () => request<CertificationDto[]>("/access/certifications"),
    certification: (id: string) => request<CertificationDto & { items: CertItemDto[] }>(`/access/certifications/${id}`),
    createCertification: (data: CertificationInput) => post<CertificationDto>("/access/certifications", data),
    certify: (id: string, itemId: string, decision: "keep" | "revoke", comment?: string) => post<CertificationDto & { items: CertItemDto[] }>(`/access/certifications/${id}/items/${itemId}`, { decision, comment }),
    closeCertification: (id: string) => post<CertificationDto>(`/access/certifications/${id}/close`),
    certificationCsvUrl: (id: string) => withCompany(`/api/access/certifications/${id}/export.csv`),
    reconcile: () => request<ReconDto>("/access/reconcile"),
    adopt: (resourceId: string, personIds: string[]) => post<ReconDto>("/access/reconcile/adopt", { resourceId, personIds }),
    reconcileRevoke: (resourceId: string, personId: string) => post<{ requestId: string }>("/access/reconcile/revoke", { resourceId, personId }),
    provisioning: () => request<ProvisioningSettingsDto>("/access/provisioning"),
    saveProvisioning: (data: ProvisioningSettingsInput) => put<ProvisioningSettingsDto>("/access/provisioning", data),
    provisioningPlan: () => request<ProvisioningPlanItem[]>("/access/provisioning/plan"),
    provisioningApply: (requestIds: string[], resourceIds: string[] = []) => post<ProvisioningResult[]>("/access/provisioning/apply", { requestIds, resourceIds }),
    provisioningGroups: () => request<ProvisioningGroupOp[]>("/access/provisioning/groups"),
    adGroups: () => request<AdGroupsDto>("/access/ad-groups"),
    importAdGroups: (data: ImportAdGroupsInput) => post<{ created: number; skipped: number; adopted: number }>("/access/resources/import-ad", data),
    provisioningVerify: () => post<{ fulfilled: number }>("/access/provisioning/verify"),
    /* IDM (v1.34, ADR-131) */
    overview: () => request<IdmOverviewDto>("/access/idm/overview"),
    roles: () => request<BusinessRoleDto[]>("/access/roles"),
    createRole: (data: BusinessRoleInput) => post<BusinessRoleDto>("/access/roles", data),
    updateRole: (id: string, data: BusinessRoleInput) => put<BusinessRoleDto>(`/access/roles/${id}`, data),
    removeRole: (id: string) => del(`/access/roles/${id}`),
    roleGaps: (id: string) => request<{ personId: string; personName: string; resourceId: string; resourceName: string }[]>(`/access/roles/${id}/gaps`),
    fillRole: (id: string, personIds?: string[]) => post<{ requests: number; skipped: number }>(`/access/roles/${id}/fill`, { personIds }),
    matrix: (f: { department?: string; roleId?: string; q?: string }) => {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
      return request<MatrixDto>(`/access/matrix${qs ? `?${qs}` : ""}`);
    },
    personOverview: (id: string) => request<PersonOverviewDto>(`/access/people/${id}/overview`),
    sodCheck: (personId: string, resourceIds: string[]) => post<Record<string, SodConflict[]>>("/access/sod-check", { personId, resourceIds }),
    jmlPreview: (data: JmlPreviewInput) => post<JmlPreviewDto>("/access/jml/preview", data),
    jmlApply: (data: JmlApplyInput) => post<JmlResultDto>("/access/jml/apply", data),
    /** Stáhne skript PowerShell (POST → soubor). */
    provisioningScript: async (requestIds: string[], resourceIds: string[] = []) => {
      const headers = new Headers({ "content-type": "application/json" });
      if (activeCompany) headers.set("x-contix-company", activeCompany);
      const res = await fetch("/api/access/provisioning/script", { method: "POST", credentials: "include", headers, body: JSON.stringify({ requestIds, resourceIds }) });
      if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as any)?.error ?? `HTTP ${res.status}`, null);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `contix-ad-${new Date().toISOString().slice(0, 10)}.ps1`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  },

  /** Mapy a půdorysy (v1.25, ADR-122). */
  maps: {
    list: () => request<SiteMapDto[]>("/assets/maps"),
    get: (id: string) => request<SiteMapDetailDto>(`/assets/maps/${id}`),
    byAsset: (assetId: string) => request<{ id: string; name: string; building: string | null; floor: string | null }[]>(`/assets/maps/by-asset/${assetId}`),
    upload: (file: File, data: { name: string; site?: string; building?: string; floor?: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(data)) if (v) fd.append(k, v);
      return request<SiteMapDetailDto>("/assets/maps", { method: "POST", body: fd });
    },
    update: (id: string, data: { name?: string; site?: string | null; building?: string | null; floor?: string | null }) => patch<SiteMapDetailDto>(`/assets/maps/${id}`, data),
    remove: (id: string) => del(`/assets/maps/${id}`),
    place: (id: string, assetId: string, x: number, y: number) => put<SiteMapDetailDto>(`/assets/maps/${id}/placements/${assetId}`, { x, y }),
    unplace: (id: string, assetId: string) => request<SiteMapDetailDto>(`/assets/maps/${id}/placements/${assetId}`, { method: "DELETE" }),
    imageUrl: (id: string, v?: string) => withCompany(`/api/assets/maps/${id}/image${v ? `?v=${encodeURIComponent(v)}` : ""}`),
    originalUrl: (id: string) => withCompany(`/api/assets/maps/${id}/original`),
  },

  vulns: {
    cve: (cveId: string) => request<VulnCveDetail>(`/vulnerabilities/cve/${encodeURIComponent(cveId)}`),
    advice: (cveId: string) => post<VulnAdviceDto>(`/vulnerabilities/cve/${encodeURIComponent(cveId)}/advice`),
    summary: () => request<VulnSummaryDto>("/vulnerabilities/summary"),
    list: (q: { assetId?: string; severity?: Severity; status?: VulnStatus; q?: string; priority?: VulnPriority; kev?: "1"; packageName?: string; overdue?: "1"; scanId?: string; scanner?: string; verified?: "1"; olderThanDays?: number; assetOfflineDays?: number; maxSeverity?: string; limit?: number; offset?: number }) =>
      request<Paged<VulnerabilityDto>>(`/vulnerabilities?${qs(q)}`),
    fixPlan: () => request<VulnFixPlanItem[]>("/vulnerabilities/fix-plan"),
    intel: () => request<VulnIntelStatusDto>("/vulnerabilities/intel"),
    saveIntel: (data: VulnIntelSettingsInput) => put<VulnIntelStatusDto>("/vulnerabilities/intel/settings", data),
    refreshIntel: () => post<{ kev: number; epss: number; errors: string[]; status: VulnIntelStatusDto }>("/vulnerabilities/intel/refresh"),
    uploadIntel: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<{ kind: "kev" | "epss"; entries: number; status: VulnIntelStatusDto }>("/vulnerabilities/intel/upload", { method: "POST", body: fd });
    },
    accept: (id: string, data: AcceptVulnInput) => post(`/vulnerabilities/${id}/accept`, data),
    reopen: (id: string) => post(`/vulnerabilities/${id}/reopen`),
    recompute: () => post("/vulnerabilities/recompute"),
    scans: () => request<VulnScanDto[]>("/vulnerabilities/scans"),
    scan: (id: string) => request<VulnScanDto>(`/vulnerabilities/scans/${id}`),
    importScan: (file: File, o: { mode: "preview" | "commit"; scanner?: string; name?: string; assetId?: string; closeMissing: boolean; external: boolean; includeInfo: boolean }) => {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") fd.append(k, String(v));
      return request<VulnScanPreviewDto | VulnScanDto>("/vulnerabilities/scans", { method: "POST", body: fd });
    },
    triage: (data: VulnTriageInput) => post<{ changed: number }>("/vulnerabilities/triage", data),
    suppress: (d: VulnBulkSuppressInput) => post<{ count: number; dryRun: boolean }>("/vulnerabilities/suppress", d),
    suppressionRules: () => request<VulnSuppressRuleDto[]>("/vulnerabilities/suppression-rules"),
    createSuppressionRule: (d: VulnSuppressRuleInput) => post<{ id: string; suppressed: number; released: number }>("/vulnerabilities/suppression-rules", d),
    updateSuppressionRule: (id: string, d: VulnSuppressRuleInput) => put<{ suppressed: number; released: number }>(`/vulnerabilities/suppression-rules/${id}`, d),
    deleteSuppressionRule: (id: string) => del<{ released: number }>(`/vulnerabilities/suppression-rules/${id}`),
    metrics: (months = 12) => request<VulnMetricsDto>(`/vulnerabilities/metrics?months=${months}`),
    defectDojo: () => request<DefectDojoStatusDto>("/vulnerabilities/defectdojo"),
    saveDefectDojo: (data: DefectDojoSettingsInput) => put<DefectDojoStatusDto>("/vulnerabilities/defectdojo", data),
    testDefectDojo: () => post<{ ok: boolean; activeFindings?: number; message?: string }>("/vulnerabilities/defectdojo/test"),
    syncDefectDojo: () => post<DefectDojoStatusDto>("/vulnerabilities/defectdojo/sync"),
  },

  org: {
    tree: () => request<OrgUnitDto[]>("/org"),
    createUnit: (data: OrgUnitInput) => post("/org/units", data),
    unitOverview: (id: string) => request<OrgUnitOverviewDto>(`/org/units/${id}/overview`),
    updateUnit: (id: string, data: Partial<OrgUnitInput>) => patch(`/org/units/${id}`, data),
    deleteUnit: (id: string) => del(`/org/units/${id}`),
    createPosition: (data: PositionInput) => post("/org/positions", data),
    updatePosition: (id: string, data: Partial<PositionInput>) => patch(`/org/positions/${id}`, data),
    deletePosition: (id: string) => del(`/org/positions/${id}`),
    positionDetail: (id: string) => request<PositionUsageDto>(`/org/positions/${id}/detail`),
    handover: (id: string, v: PositionHandoverInput) => post<{ moved: Record<string, number> }>(`/org/positions/${id}/handover`, v),
    positionUsage: (id: string) =>
      request<{
        ownedProcesses: { id: string; name: string; code: string | null }[];
        ownedRisks: { id: string; name: string; code: string | null }[];
        raci: { process_id: string; process_name: string; step_name: string; role: string }[];
      }>(`/org/positions/${id}/usage`),
  },

  processes: {
    list: (q: { q?: string; status?: string; assetId?: string; unit?: string } = {}) => request<ProcessListItem[]>(`/processes?${qs(q)}`),
    get: (id: string) => request<ProcessDetail>(`/processes/${id}`),
    create: (data: ProcessInput) => post<{ id: string }>("/processes", data),
    update: (id: string, data: Partial<ProcessInput>) => patch<ProcessDetail>(`/processes/${id}`, data),
    remove: (id: string) => del(`/processes/${id}`),
    createStep: (id: string, data: StepInput) => post(`/processes/${id}/steps`, data),
    updateStep: (id: string, stepId: string, data: Partial<StepInput>) => patch(`/processes/${id}/steps/${stepId}`, data),
    deleteStep: (id: string, stepId: string) => del(`/processes/${id}/steps/${stepId}`),
    reorder: (id: string, stepIds: string[]) => put<StepDto[]>(`/processes/${id}/steps/order`, { stepIds }),
    importSteps: (id: string, tasks: { name: string; stepType: StepDto["stepType"] }[]) =>
      post<{ added: number; skipped: number }>(`/processes/${id}/steps/import`, { tasks }),
    setAssets: (id: string, assetIds: string[]) => put<ProcessDetail>(`/processes/${id}/assets`, { assetIds }),
    addDocument: (id: string, data: { title: string; url?: string | null; docType?: string | null; stepId?: string | null }) =>
      post(`/processes/${id}/documents`, data),
    removeDocument: (id: string, docId: string) => del(`/processes/${id}/documents/${docId}`),
    bpmn: (id: string) => request<{ xml: string; generated: boolean }>(`/processes/${id}/bpmn`),
    generateBpmn: (id: string) => post<{ xml: string; generated: boolean }>(`/processes/${id}/bpmn/generate`),
    saveBpmn: (id: string, xml: string) => put(`/processes/${id}/bpmn`, { xml }),
    clearBpmn: (id: string) => del(`/processes/${id}/bpmn`),
    versions: (id: string) => request<ProcessVersionDto[]>(`/processes/${id}/versions`),
    version: (id: string, vid: string) => request<ProcessVersionDetail>(`/processes/${id}/versions/${vid}`),
    createVersion: (id: string, data: ProcessVersionInput) => post<ProcessVersionDto[]>(`/processes/${id}/versions`, data),
    approveVersion: (id: string, vid: string, note?: string) => post<ProcessVersionDto[]>(`/processes/${id}/versions/${vid}/approve`, { note }),
    deleteVersion: (id: string, vid: string) => request<ProcessVersionDto[]>(`/processes/${id}/versions/${vid}`, { method: "DELETE" }),
  },

  /** Informační servis regulátora (ADR-087). */
  infoService: {
    get: () => request<InfoServiceDto>("/legislation/infoservice"),
    items: (q: { kind?: string; q?: string; unreviewed?: "1"; publisher?: string; scope?: "all"; limit?: number }) => request<InfoFeedItemDto[]>(`/legislation/infoservice/items?${qs(q)}`),
    review: (id: string, note: string) => post<{ ok: true }>(`/legislation/infoservice/items/${id}/review`, { note }),
    item: (id: string) => request<InfoFeedItemDto>(`/legislation/infoservice/items/${id}`),
    assess: (id: string, data: InfoAssessmentInput) => put<InfoAssessmentDto>(`/legislation/infoservice/items/${id}/assessment`, data),
    suggestAssets: (id: string) => request<InfoAssetSuggestion[]>(`/legislation/infoservice/items/${id}/suggest-assets`),
    link: (id: string, kind: InfoLinkKind, targetId: string) => post<InfoAssessmentDto>(`/legislation/infoservice/items/${id}/links`, { kind, targetId }),
    byAsset: (assetId: string) => request<{ id: string; title: string; kind: FeedItemKind; link: string; publishedAt: string | null; status: InfoAssessmentStatus; companyId: string }[]>(`/legislation/infoservice/by-asset/${assetId}`),
    unreview: (id: string) => del(`/legislation/infoservice/items/${id}/review`),
    refresh: () => post<{ state: InfoServiceDto["state"] }>("/legislation/infoservice/refresh"),
    save: (data: InfoServiceSettingsInput) => put<{ ok: true }>("/legislation/infoservice/settings", data),
    upload: (source: string, file: File) => {
      const fd = new FormData();
      fd.append("source", source);
      fd.append("file", file);
      return request<{ count: number }>("/legislation/infoservice/upload", { method: "POST", body: fd });
    },
    month: (month: string) => request<{ month: string; classes: { name: string; count: number }[]; severities: { name: string; count: number }[] }>(`/legislation/infoservice/stats/manual/${month}`),
    saveMonth: (data: IncidentMonthInput) => put<{ ok: true }>("/legislation/infoservice/stats/manual", data),
    deleteMonth: (month: string) => del(`/legislation/infoservice/stats/manual/${month}`),
    suggest: (src: { itemId: string } | { month: string } | { file: File }) => {
      type R = IncidentStatsProposal & { sourceUrl: string; model: string };
      if (!("file" in src)) return post<R>("/legislation/infoservice/stats/suggest", src);
      const fd = new FormData();
      fd.append("file", src.file);
      return request<R>("/legislation/infoservice/stats/suggest", { method: "POST", body: fd });
    },
  },

  legislation: {
    status: () => request<{ apiConfigured: boolean; source: "api" | "opendata" | "off"; sourceLabel: string; eurlex: boolean; mode: "auto" | "opendata" | "web" | "api"; webFallback: boolean }>("/legislation/status"),
    suggested: () => request<{ code: string; staleUrl: string; title: string; source: "esbirka" | "eurlex"; reference: string; watched: boolean }[]>("/legislation/suggested"),
    acts: () => request<LegalActDto[]>("/legislation/acts"),
    act: (id: string) => request<LegalActDetail>(`/legislation/acts/${id}`),
    watch: (data: LegalWatchInput) => post<LegalActDto & { syncError: string | null }>("/legislation/watch", data),
    updateWatch: (actId: string, data: { ownerPositionId?: string | null; notes?: string | null }) => patch<LegalActDto>(`/legislation/watch/${actId}`, data),
    unwatch: (actId: string) => del(`/legislation/watch/${actId}`),
    createManual: (data: LegalManualActInput) => post<LegalActDto>("/legislation/acts/manual", data),
    removeManual: (id: string) => del(`/legislation/acts/${id}`),
    addVersion: (id: string, data: LegalManualVersionInput) => post<{ versionId: string | null; changeId: string | null }>(`/legislation/acts/${id}/versions`, data),
    addVersionFile: (id: string, file: File, label: string, effectiveFrom: string | null) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("label", label);
      if (effectiveFrom) fd.append("effectiveFrom", effectiveFrom);
      return request<{ versionId: string | null; changeId: string | null }>(`/legislation/acts/${id}/versions`, { method: "POST", body: fd });
    },
    sync: (id: string) => post<{ versionId: string | null; changeId: string | null }>(`/legislation/acts/${id}/sync`),
    fragments: (versionId: string) => request<LegalFragmentDto[]>(`/legislation/versions/${versionId}/fragments`),
    reviews: (status?: string) => request<LegalReviewDto[]>(`/legislation/reviews${status ? `?status=${status}` : ""}`),
    review: (id: string) => request<LegalReviewDetail>(`/legislation/reviews/${id}`),
    updateReview: (id: string, data: LegalReviewPatch) => patch<{ ok: true }>(`/legislation/reviews/${id}`, data),
    tasks: (all?: boolean) => request<LegalTaskDto[]>(`/legislation/tasks${all ? "?all=1" : ""}`),
    addTask: (reviewId: string, data: LegalTaskInput) => post<LegalTaskDto>(`/legislation/reviews/${reviewId}/tasks`, data),
    updateTask: (id: string, data: Partial<LegalTaskInput>) => patch<LegalTaskDto>(`/legislation/tasks/${id}`, data),
  },
  identity: {
    overview: () => request<IdentityOverviewDto>("/identity/overview"),
    findings: (q: IdentityFindingFilter) => request<IdentityFindingDto[]>(`/identity/findings?${qs(q)}`),
    findingsCsvUrl: (q: IdentityFindingFilter = {}) => withCompany(`/api/identity/findings.csv?${qs(q)}`),
    findingsXlsxUrl: (q: IdentityFindingFilter = {}) => withCompany(`/api/identity/findings.xlsx?${qs(q)}`),
    facets: (q: IdentityFindingFilter) => request<IdentityFindingFacets>(`/identity/findings/facets?${qs(q)}`),
    bulkAccept: (data: BulkAcceptIdentityInput) => post<{ accepted: number; skipped: number }>("/identity/findings/bulk-accept", data),
    reportUrl: (kind: IdentityReportKind, format: "html" | "docx" | "pdf", q: IdentityFindingFilter & { group?: string } = {}) => withCompany(`/api/identity/reports/${kind}.${format}?${qs(q)}`),
    reportSchedule: () => request<IdentityReportScheduleDto>("/identity/reports/schedule"),
    saveReportSchedule: (data: IdentityReportScheduleInput) => put<IdentityReportScheduleDto>("/identity/reports/schedule", data),
    sendReportNow: () => post<{ sent: number; status: string }>("/identity/reports/schedule/send", {}),
    accept: (id: string, data: AcceptIdentityFindingInput) => post<IdentityFindingDto>(`/identity/findings/${id}/accept`, data),
    reopen: (id: string) => post<IdentityFindingDto>(`/identity/findings/${id}/reopen`),
    accounts: (q: { sourceId?: string; q?: string; privileged?: "1" | "0"; enabled?: "1" | "0"; kind?: string; withFindings?: "1"; removed?: "1"; activity?: AccountActivity }) => request<IdentityAccountDto[]>(`/identity/accounts?${qs(q)}`),
    inventory: (sourceId?: string) => request<IdentityInventory>(`/identity/inventory?${qs({ sourceId })}`),
    computers: (q: IdentityComputerFilter) => request<{ items: IdentityComputerDto[]; total: number; summary: IdentityComputerSummary }>(`/identity/computers?${qs(q)}`),
    computersExportUrl: (format: "csv" | "xlsx", q: IdentityComputerFilter = {}) => withCompany(`/api/identity/computers/export.${format}?${qs(q)}`),
    computerAssets: (ids: string[]) => post<{ created: number; linked: number; skipped: number }>("/identity/computers/assets", { ids }),
    account: (id: string) => request<IdentityAccountDetail>(`/identity/accounts/${id}`),
    sources: () => request<IdentitySourceDto[]>("/identity/sources"),
    createSource: (data: IdentitySourceInput) => post<IdentitySourceDto>("/identity/sources", data),
    updateSource: (id: string, data: IdentitySourceInput) => put<IdentitySourceDto>(`/identity/sources/${id}`, data),
    removeSource: (id: string) => del(`/identity/sources/${id}`),
    testSource: (data: IdentitySourceInput & { id?: string }) => post<IdentityTestResult>("/identity/sources/test", data),
    groups: () => request<{ name: string; accounts: number; privileged: boolean }[]>("/identity/groups"),
    provisioningPreview: (id: string) => request<ProvisioningPlan & { managedUsers: number }>(`/identity/sources/${id}/provisioning`),
    runProvisioning: (id: string) => post<ProvisioningResultDto>(`/identity/sources/${id}/provisioning/run`),
    automations: () => request<ControlAutomationDto[]>("/identity/automations"),
    createAutomation: (data: ControlAutomationInput) => post<ControlAutomationDto>("/identity/automations", data),
    updateAutomation: (id: string, data: ControlAutomationInput) => put<ControlAutomationDto>(`/identity/automations/${id}`, data),
    removeAutomation: (id: string) => del(`/identity/automations/${id}`),
    runAutomation: (id: string) => post<ControlAutomationDto>(`/identity/automations/${id}/run`),
    sodRules: () => request<SodRuleDto[]>("/identity/sod/rules"),
    createSodRule: (data: SodRuleInput) => post<{ id: string; open: number }>("/identity/sod/rules", data),
    updateSodRule: (id: string, data: SodRuleInput) => put<{ id: string; open: number }>(`/identity/sod/rules/${id}`, data),
    removeSodRule: (id: string) => del(`/identity/sod/rules/${id}`),
    evaluateSod: () => post<{ opened: number; resolved: number; open: number }>("/identity/sod/evaluate"),
    sodViolations: (status: "open" | "accepted" | "resolved", ruleId?: string) => request<SodViolationDto[]>(`/identity/sod/violations?${qs({ status, ruleId })}`),
    acceptSod: (id: string, data: AcceptIdentityFindingInput) => post<SodViolationDto>(`/identity/sod/violations/${id}/accept`, data),
    reopenSod: (id: string) => post<SodViolationDto>(`/identity/sod/violations/${id}/reopen`),
    reviews: () => request<AccessReviewDto[]>("/identity/reviews"),
    review: (id: string) => request<AccessReviewDetail>(`/identity/reviews/${id}`),
    createReview: (data: AccessReviewInput) => post<AccessReviewDetail>("/identity/reviews", data),
    decide: (id: string, itemId: string, data: AccessReviewDecisionInput) => post<AccessReviewItemDto>(`/identity/reviews/${id}/items/${itemId}/decide`, data),
    remediated: (id: string, itemId: string, done: boolean) => post<AccessReviewItemDto>(`/identity/reviews/${id}/items/${itemId}/remediated`, { done }),
    reassign: (id: string, itemId: string, positionId: string) => post<AccessReviewItemDto>(`/identity/reviews/${id}/items/${itemId}/reassign`, { positionId }),
    closeReview: (id: string) => post<AccessReviewDetail>(`/identity/reviews/${id}/close`),
    cancelReview: (id: string) => post<AccessReviewDetail>(`/identity/reviews/${id}/cancel`),
    reviewReportUrl: (id: string, fmt: "html" | "docx") => withCompany(`/api/identity/reviews/${id}/report.${fmt}`),
    sync: (id: string) => post<{ ok: boolean; accounts: number; removed: number; findings: { opened: number; resolved: number; open: number }; notes: string[]; provisioning?: ProvisioningResultDto }>(`/identity/sources/${id}/sync`),
  },

  soc2: {
    list: () => request<Soc2EngagementListItem[]>("/soc2"),
    get: (id: string) => request<Soc2DetailDto>(`/soc2/${id}`),
    create: (data: Soc2EngagementInput) => post<Soc2DetailDto>("/soc2", data),
    update: (id: string, data: Partial<Soc2EngagementInput>) => patch<Soc2DetailDto>(`/soc2/${id}`, data),
    remove: (id: string) => del(`/soc2/${id}`),
    workpaper: (id: string, criterion: string, conclusion: Soc2Conclusion, note?: string | null) => put<Soc2DetailDto>(`/soc2/${id}/workpapers/${criterion}`, { conclusion, note }),
    exception: (id: string, data: { criterion: string; testId?: string | null; title: string; description?: string | null }) => post<Soc2DetailDto>(`/soc2/${id}/exceptions`, data),
    pbcTemplate: (id: string) => post<{ created: number }>(`/soc2/${id}/pbc-template`),
    monitorTests: (id: string) => post<{ created: number; skipped: number; failed: string[] }>(`/soc2/${id}/monitor-tests`),
    reportHtmlUrl: (id: string) => withCompany(`/api/soc2/${id}/report.html`),
    reportDocxUrl: (id: string) => withCompany(`/api/soc2/${id}/report.docx`),
  },
  cra: {
    list: () => request<CraProductDto[]>("/cra"),
    reports: (open = true) => request<CraReportDto[]>(`/cra/reports?open=${open ? "1" : "0"}`),
    get: (id: string) => request<CraProductDto>(`/cra/${id}`),
    docInfo: (id: string) => request<{ info: CraDocInfo; documents: { kind: CraDocument; allowed: boolean; missing: string[] }[] }>(`/cra/${id}/doc-info`),
    saveDocInfo: (id: string, info: CraDocInfoInput) => put<{ ok: boolean }>(`/cra/${id}/doc-info`, info),
    documentUrl: (id: string, kind: CraDocument, lang: string, format: "html" | "docx") => withCompany(`/api/cra/${id}/documents/${kind}?lang=${lang}&format=${format}`),
    create: (data: CraProductInput) => post<CraProductDto>("/cra", data),
    update: (id: string, data: Partial<CraProductInput>) => patch<CraProductDto>(`/cra/${id}`, data),
    remove: (id: string) => del(`/cra/${id}`),
    requirement: (id: string, key: string, status: CraReqStatus, note?: string | null) => put<CraProductDto>(`/cra/${id}/requirements/${key}`, { status, note }),
    components: (id: string) => request<CraComponentDto[]>(`/cra/${id}/components`),
    addComponent: (id: string, data: { name: string; version?: string | null; purl?: string | null; supplier?: string | null; license?: string | null }) => post<CraProductDto>(`/cra/${id}/components`, data),
    removeComponent: (id: string, cid: string) => request<CraProductDto>(`/cra/${id}/components/${cid}`, { method: "DELETE" }),
    sbom: (id: string, text: string, replace = true) => post<{ format: string; imported: number; matches: number }>(`/cra/${id}/sbom`, { text, replace }),
    productReports: (id: string) => request<CraReportDto[]>(`/cra/${id}/reports`),
    createReport: (id: string, data: CraReportInput) => post<CraReportDto>(`/cra/${id}/reports`, data),
    updateReport: (rid: string, data: Partial<CraReportInput>) => patch<CraReportDto>(`/cra/reports/${rid}`, data),
    removeReport: (rid: string) => del(`/cra/reports/${rid}`),
    findings: (id: string) => request<CraFindingDto[]>(`/cra/${id}/findings`),
    addFinding: (id: string, data: { vulnId: string; componentRef: string; summary?: string | null }) => post<CraFindingDto[]>(`/cra/${id}/findings`, data),
    links: (id: string) => request<CraLinksDto>(`/cra/${id}/links`),
    saveLinks: (id: string, data: CraLinksInput) => put<CraLinksDto>(`/cra/${id}/links`, data),
    riskFromFinding: (fid: string) => post<{ riskId: string }>(`/cra/findings/${fid}/risk`),
    updateFinding: (fid: string, data: { status?: VexStatus; justification?: VexJustification | null; impactStatement?: string | null; actionStatement?: string | null }) => patch<CraFindingDto>(`/cra/findings/${fid}`, data),
    match: (id: string) => post<{ products: number; matches: number }>(`/cra/${id}/match`),
    vexUrl: (id: string, format: "openvex" | "cyclonedx") => withCompany(`/api/cra/${id}/vex?format=${format}`),
    osv: () => request<OsvStatusDto>("/cra/osv"),
    saveOsv: (data: { ecosystems: string[]; autoRefresh: boolean; baseUrl: string }) => put<OsvStatusDto>("/cra/osv", data),
    refreshOsv: () => post<{ started: boolean; status: OsvStatusDto }>("/cra/osv/refresh"),
    uploadOsv: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<{ records: number; matches: number; status: OsvStatusDto }>("/cra/osv/upload", { method: "POST", body: fd });
    },
    // dovozce / distributor, oznámení výrobců CSAF, NVD (v1.16)
    supplyCheck: (id: string, key: string, data: { status: CraSupplyCheckStatus; note?: string | null; url?: string | null }) => put<CraProductDto>(`/cra/${id}/checks/${key}`, data),
    uploadFile: (id: string, file: File, checkKey?: string | null) => {
      const fd = new FormData();
      fd.append("file", file);
      if (checkKey) fd.append("checkKey", checkKey);
      return request<CraProductDto>(`/cra/${id}/files`, { method: "POST", body: fd });
    },
    fileUrl: (id: string, fid: string) => withCompany(`/api/cra/${id}/files/${fid}`),
    removeFile: (id: string, fid: string) => request<CraProductDto>(`/cra/${id}/files/${fid}`, { method: "DELETE" }),
    advisories: () => request<CraAdvisoryDto[]>("/cra/advisories"),
    uploadAdvisory: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<{ advisory: CraAdvisoryDto; vulnerabilities: number; matches: number }>("/cra/advisories", { method: "POST", body: fd });
    },
    removeAdvisory: (aid: string) => del(`/cra/advisories/${aid}`),
    nvd: () => request<NvdSettings>("/cra/nvd"),
    saveNvd: (data: NvdSettings) => put<NvdSettings>("/cra/nvd", data),
    nvdLookup: (id: string) => post<{ query: string; found: number; total: number; truncated: boolean }>(`/cra/${id}/nvd`),
    reportText: (rid: string, stage: CraReportStage, lang?: "cs" | "en") => request<{ stage: CraReportStage; sections: CraReportSection[] }>(`/cra/reports/${rid}/text?stage=${stage}${lang ? `&lang=${lang}` : ""}`),
  },
  aiact: {
    list: (status = "all") => request<AiSystemDto[]>(`/aiact?status=${status}`),
    summary: () => request<AiSummaryDto>("/aiact/summary"),
    get: (id: string) => request<AiSystemDto>(`/aiact/${id}`),
    create: (data: AiSystemInput) => post<AiSystemDto>("/aiact", data),
    update: (id: string, data: Partial<AiSystemInput>) => patch<AiSystemDto>(`/aiact/${id}`, data),
    remove: (id: string) => del(`/aiact/${id}`),
    decide: (id: string, decision: "approve" | "reject", note?: string | null) => post<AiSystemDto>(`/aiact/${id}/decision`, { decision, note }),
    review: (id: string, note?: string) => post<AiSystemDto>(`/aiact/${id}/review`, { note }),
    obligation: (id: string, key: string, status: AiObligationStatus, note?: string | null) => put<AiSystemDto>(`/aiact/${id}/obligations/${key}`, { status, note }),
    saveFria: (id: string, data: FriaInput) => put<AiSystemDto>(`/aiact/${id}/fria`, data),
    approveFria: (id: string) => post<AiSystemDto>(`/aiact/${id}/fria/approve`),
    reopenFria: (id: string) => post<AiSystemDto>(`/aiact/${id}/fria/reopen`),
    directive: (data: { companyId?: string; course: boolean }) => post<{ directiveId: string; summaryId: string; courseId: string | null }>("/aiact/directive", data),
    registerHtmlUrl: () => withCompany("/api/aiact/register.html"),
    registerDocxUrl: () => withCompany("/api/aiact/register.docx"),
  },
  gdpr: {
    list: (status: "active" | "draft" | "retired" | "all" = "all") => request<ProcessingActivityDto[]>(`/gdpr?status=${status}`),
    get: (id: string) => request<ProcessingActivityDto>(`/gdpr/${id}`),
    create: (data: ProcessingActivityInput) => post<ProcessingActivityDto>("/gdpr", data),
    update: (id: string, data: Partial<ProcessingActivityInput>) => patch<ProcessingActivityDto>(`/gdpr/${id}`, data),
    remove: (id: string) => del(`/gdpr/${id}`),
    review: (id: string, note?: string) => post<ProcessingActivityDto>(`/gdpr/${id}/review`, { note }),
    dpia: (id: string) => request<DpiaDto | null>(`/gdpr/${id}/dpia`),
    saveDpia: (id: string, data: DpiaInput) => put<DpiaDto>(`/gdpr/${id}/dpia`, data),
    approveDpia: (id: string) => post<DpiaDto>(`/gdpr/${id}/dpia/approve`),
    ropaHtmlUrl: () => withCompany("/api/gdpr/ropa.html"),
    ropaDocxUrl: () => withCompany("/api/gdpr/ropa.docx"),
  },

  // postup krok za krokem (v1.42, ADR-139)
  guides: {
    list: () => request<{ guides: GuideDto[]; summary: { progress: number; todo: number; done: number }; onboarding: { phase: string | null; phases: { key: string; progress: number; guides: string[] }[] } }>("/guides"),
    audit: (framework: string) => request<AuditReadinessDto>(`/guides/audit?framework=${framework}`),
    configExportUrl: () => withCompany("/api/guides/config/export"),
    groupXlsxUrl: "/api/guides/group.xlsx",
    importConfig: (cfg: unknown) => post<GuideConfigImportResult>("/guides/config/import", cfg),
    starter: (items: StarterItem[]) => post<StarterResult[]>("/guides/starter", { items }),
    auditReportUrl: (framework: string, format: "html" | "docx" | "zip") => withCompany(`/api/guides/audit?framework=${framework}&format=${format}`),
    get: (id: string) => request<GuideDto>(`/guides/${id}`),
    group: () => request<GroupGuideRow[]>("/guides/group"),
    setOwner: (id: string, positionId: string | null) => put<GuideDto>(`/guides/${id}/owner`, { positionId }),
  },
  // modelování hrozeb podle reality prostředí (v1.40, ADR-137)
  modeling: {
    overview: () => request<ModelingOverviewDto>("/risks/modeling/overview"),
    paths: () => request<AttackPathsDto>("/risks/modeling/paths"),
    decidePath: (key: string, data: AttackPathDecisionInput) => post<{ riskId?: string; ok?: boolean }>("/risks/modeling/paths/decision", { key, ...data }),
    calibration: () => request<CalibrationDto[]>("/risks/modeling/calibration"),
    applyCalibration: (riskId: string, data: { impact: number; threatLevel?: number; vulnLevel?: number; likelihood?: number; note?: string }) => post<{ ok: true }>(`/risks/modeling/calibration/${riskId}/apply`, data),
    landscape: () => request<ThreatLandscapeDto>("/risks/modeling/landscape"),
    saveProfile: (data: ThreatProfileInput) => put<ThreatLandscapeDto>("/risks/modeling/landscape/profile", data),
    models: () => request<ThreatModelDto[]>("/risks/modeling/models"),
    model: (id: string) => request<ThreatModelDto>(`/risks/modeling/models/${id}`),
    seed: (assetId: string) => request<{ elements: TmElement[]; threats: TmThreat[] }>(`/risks/modeling/models/seed?assetId=${assetId}`),
    createModel: (data: ThreatModelInput) => post<ThreatModelDto>("/risks/modeling/models", data),
    updateModel: (id: string, data: ThreatModelPatch) => patch<ThreatModelDto>(`/risks/modeling/models/${id}`, data),
    deleteModel: (id: string) => del<{ ok: true }>(`/risks/modeling/models/${id}`),
    threatRisk: (id: string, key: string) => post<{ riskId: string; model: ThreatModelDto }>(`/risks/modeling/models/${id}/threats/risk`, { key }),
    reportUrl: (id: string, format: "html" | "docx") => withCompany(`/api/risks/modeling/models/${id}/report?format=${format}`),
  },

  risks: {
    // rizikové scénáře z dat (v1.17, ADR-114)
    capabilities: () => request<CapabilityDto[]>("/risks/scenarios/capabilities"),
    declareCapability: (key: string, data: CapabilityDeclarationInput) => put<CapabilityDto[]>(`/risks/scenarios/capabilities/${key}`, data),
    removeDeclaration: (key: string) => request<CapabilityDto[]>(`/risks/scenarios/capabilities/${key}`, { method: "DELETE" }),
    scenarios: (status: "open" | "all" = "open") => request<ScenarioProposalDto[]>(`/risks/scenarios?status=${status}`),
    generateScenarios: () => post<{ created: number; updated: number; reopened: number; obsolete: number; primaryAssets: number }>("/risks/scenarios/generate"),
    acceptScenario: (id: string, data: { name?: string; impact?: number; threatLevel?: number; vulnLevel?: number; ownerPositionId?: string | null } = {}) => post<{ riskId: string; proposal: ScenarioProposalDto }>(`/risks/scenarios/${id}/accept`, data),
    threatCoverage: () => request<ThreatCoverageDto>("/risks/scenarios/coverage"),
    detection: () => request<DetectionDto>("/risks/scenarios/detection"),
    appetite: () => request<RiskAppetiteDto>("/risks/appetite"),
    groupOverview: () => request<GroupRiskRowDto[]>("/risks/appetite/group"),
    saveAppetite: (data: { items: { key: string; maxLevel: string; statement?: string | null }[] }) => put<RiskAppetiteDto>("/risks/appetite", data),
    approveAppetite: () => post<RiskAppetiteDto>("/risks/appetite/approve"),
    saveKri: (key: string, data: { enabled: boolean; warn: number; alert: number }) => put<RiskAppetiteDto>(`/risks/appetite/kri/${key}`, data),
    declareDetection: (technique: string, data: { source: string; note?: string | null }) => put<DetectionDto>(`/risks/scenarios/detection/${technique}`, data),
    removeDetection: (technique: string) => request<DetectionDto>(`/risks/scenarios/detection/${technique}`, { method: "DELETE" }),
    markNotRelevant: (assetId: string, catalogId: string, reason: string) => put<ThreatCoverageDto>(`/risks/scenarios/coverage/${assetId}/${catalogId}`, { reason }),
    unmarkNotRelevant: (assetId: string, catalogId: string) => request<ThreatCoverageDto>(`/risks/scenarios/coverage/${assetId}/${catalogId}`, { method: "DELETE" }),
    decideScenario: (id: string, data: { action: "reject"; reason: string } | { action: "link"; riskId: string; reason?: string } | { action: "reopen" }) => post<ScenarioProposalDto>(`/risks/scenarios/${id}/decision`, data),
    vulnSuggestions: () => request<VulnRiskSuggestion[]>("/risks/suggestions/vulns"),
    /** Bez `vulnerabilityIds` = všechny nepokryté kritické a vysoké zranitelnosti aktiva (vybere server). */
    fromPackage: (packageName: string, companyId?: string) => post<RiskDetail>("/risks/from-package", { packageName, companyId }),
    fromVulns: (assetId: string, vulnerabilityIds?: string[]) => post<RiskDetail>("/risks/from-vulns", { assetId, vulnerabilityIds }),
    quant: () => request<QuantOverview>("/risks/quant"),
    list: (q: { q?: string; level?: string; status?: string; assetId?: string; processId?: string; triggers?: "1"; unit?: string; limit?: number } = {}) =>
      request<{ items: RiskListItem[]; total: number }>(`/risks?${qs(q)}`),
    summary: () => request<RiskSummaryDto>("/risks/summary"),
    get: (id: string) => request<RiskDetail>(`/risks/${id}`),
    create: (data: RiskInput) => post<RiskDetail>("/risks", data),
    update: (id: string, data: Partial<RiskInput> & { reviewNote?: string }) => patch<RiskDetail>(`/risks/${id}`, data),
    reassessment: (id: string) => request<RiskReassessmentDto>(`/risks/${id}/reassessment`),
    review: (id: string, note: string) => post<RiskDetail>(`/risks/${id}/review`, { note }),
    remove: (id: string) => del(`/risks/${id}`),
    suggestImpact: (assetIds: string[], threatId?: string | null) =>
      post<{ suggestedImpact: number | null; decreeLevel: number | null }>("/risks/suggest-impact", { assetIds, threatId }),
    plan: (q: { status?: string; ownerPositionId?: string } = {}) => request<TreatmentActionDto[]>(`/risks/plan?${qs(q)}`),
    addAction: (riskId: string, data: TreatmentActionInput) => post<TreatmentActionDto>(`/risks/${riskId}/actions`, data),
    planSuggestions: (riskId: string) => request<PlanSuggestionDto[]>(`/risks/${riskId}/plan-suggestions`),
    applyPlanSuggestions: (riskId: string, data: { keys: string[]; ownerPositionId?: string | null; dueDate?: string | null }) => post<{ created: number }>(`/risks/${riskId}/plan-suggestions/apply`, data),
    updateAction: (id: string, data: Partial<TreatmentActionInput>) => patch(`/risks/actions/${id}`, data),
    deleteAction: (id: string) => del(`/risks/actions/${id}`),
    catalog: (kind?: "threat" | "weakness") => request<CatalogItemDto[]>(`/risks/catalog?${qs({ kind })}`),
    createCatalog: (kind: "threat" | "weakness", data: CatalogItemInput) => post(`/risks/catalog/${kind}`, data),
    updateCatalog: (id: string, data: Partial<CatalogItemInput>) => patch(`/risks/catalog/item/${id}`, data),
    deleteCatalog: (id: string) => del(`/risks/catalog/item/${id}`),
  },

  exceptions: {
    list: () => request<{ items: ExceptionDto[]; summary: ExceptionsSummary; kinds: ExceptionKind[] }>("/exceptions"),
    exportUrl: () => withCompany("/api/exceptions/export"),
    setControls: (kind: ExceptionKind, id: string, data: ExceptionControlsInput) => put<ExceptionDto>(`/exceptions/${kind}/${encodeURIComponent(id)}/controls`, data),
  },
  coverage: {
    get: (framework: FrameworkId) => request<CoverageDto & { batch: CoverageBatchStatus }>(`/coverage?framework=${framework}`),
    score: (data: CoverageScoreInput) => post<CoverageBatchStatus>("/coverage/score", data),
    scoreStatus: () => request<CoverageBatchStatus>("/coverage/score"),
    snapshots: (framework: FrameworkId) => request<CoverageSnapshotDto[]>(`/coverage/snapshots?framework=${framework}`),
    snapshot: (id: string) => request<CoverageSnapshotDetail>(`/coverage/snapshots/${id}`),
    createSnapshot: (data: CoverageSnapshotInput) => post<CoverageSnapshotDto>("/coverage/snapshots", data),
    exportUrl: (framework: FrameworkId, snapshot?: string | null) => withCompany(`/api/coverage/export?framework=${framework}${snapshot ? `&snapshot=${snapshot}` : ""}`),
  },
  exercises: {
    list: () => request<ExerciseDto[]>("/exercises"),
    templates: () => request<ExerciseTemplate[]>("/exercises/templates"),
    get: (id: string) => request<ExerciseDto>(`/exercises/${id}`),
    create: (data: ExerciseInput) => post<ExerciseDto>("/exercises", data),
    update: (id: string, data: ExercisePatch) => patch<ExerciseDto>(`/exercises/${id}`, data),
    start: (id: string) => post<ExerciseDto>(`/exercises/${id}/start`),
    cancel: (id: string) => post<ExerciseDto>(`/exercises/${id}/cancel`),
    log: (id: string, data: ExerciseLogInput) => post<ExerciseDto>(`/exercises/${id}/log`, data),
    complete: (id: string, data: ExerciseCompleteInput) => post<ExerciseDto>(`/exercises/${id}/complete`, data),
  },

  sca: {
    overview: () => request<ScaOverviewDto>("/sca"),
    sync: () => post<ScaOverviewDto>("/sca/sync"),
    asset: (assetId: string) => request<ScaAssetDto>(`/sca/assets/${assetId}`),
    automations: () => request<ControlAutomationDto[]>("/sca/automations"),
    createAutomation: (data: ControlAutomationInput) => post<ControlAutomationDto>("/sca/automations", data),
    updateAutomation: (id: string, data: ControlAutomationInput) => put<ControlAutomationDto>(`/sca/automations/${id}`, data),
    removeAutomation: (id: string) => del(`/sca/automations/${id}`),
    runAutomation: (id: string) => post<ControlAutomationDto>(`/sca/automations/${id}/run`),
  },

  controls: {
    frameworks: () => request<(FrameworkMeta & { inScope: boolean; summary: ComplianceSummary })[]>("/controls/frameworks"),
    requirements: (q: { framework: FrameworkId; section?: string; q?: string }) => request<RequirementRow[]>(`/controls/requirements?${qs(q)}`),
    assess: (requirementId: string, data: RequirementAssessmentInput) => put<RequirementRow>("/controls/assessments", { requirementId, ...data }),
    soaCsvUrl: (framework: FrameworkId) => withCompany(`/api/controls/soa.csv?framework=${framework}`),
    list: (q: { q?: string; status?: string; framework?: string; riskId?: string; withGroup?: "1"; unit?: string } = {}) => request<ControlListItem[]>(`/controls?${qs(q)}`),
    get: (id: string) => request<ControlDetail>(`/controls/${id}`),
    create: (data: ControlInput) => post<ControlDetail>("/controls", data),
    update: (id: string, data: Partial<ControlInput>) => patch<ControlDetail>(`/controls/${id}`, data),
    remove: (id: string) => del(`/controls/${id}`),
    crosswalk: (data: ControlCrosswalkInput) => post<ControlCrosswalkResult>("/controls/crosswalk", data),
    generate: (regime: "higher" | "lower", includeCrosswalk = true) => post<{ created: number; skipped: number }>("/controls/generate", { regime, includeCrosswalk }),
  },
  monitors: {
    list: (controlId?: string) => request<ControlMonitorDto[]>(`/monitors?${qs({ controlId })}`),
    controlHardening: (controlId: string) => request<ControlHardeningDto>(`/monitors/control-hardening/${controlId}`),
    create: (data: ControlMonitorInput) => post<ControlMonitorDto>("/monitors", data),
    update: (id: string, data: ControlMonitorInput) => put<ControlMonitorDto>(`/monitors/${id}`, data),
    remove: (id: string) => del(`/monitors/${id}`),
    run: (id: string) => post<MonitorRunDto>(`/monitors/${id}/run`),
    token: (id: string) => post<{ token: string }>(`/monitors/${id}/token`),
    runs: (id: string, q: { from?: string; to?: string } = {}) => request<MonitorRunDto[]>(`/monitors/${id}/runs?${qs(q)}`),
    periodTest: (id: string, data: MonitorPeriodTestInput) => post<{ testId: string; runs: number; expected: number; passed: number; failed: number; errors: number; coverage: number; result: string }>(`/monitors/${id}/period-test`, data),
  },

  cycles: {
    list: (kind: CycleKind) => request<CycleListItem[]>(`/cycles?kind=${kind}`),
    status: (kind: CycleKind) => request<(CycleStatusDto & { companyId: string })[]>(`/cycles/status?kind=${kind}`),
    get: (id: string) => request<CycleDetail>(`/cycles/${id}`),
    create: (data: CycleInput) => post<CycleDetail>("/cycles", data),
    update: (id: string, data: Partial<CycleInput>) => patch<CycleDetail>(`/cycles/${id}`, data),
    decide: (id: string, entityId: string, state: "confirmed" | "excluded" | "pending", note?: string | null) => put<CycleDetail>(`/cycles/${id}/items/${entityId}`, { state, note }),
    submit: (id: string) => post<CycleDetail>(`/cycles/${id}/submit`),
    reopen: (id: string) => post<CycleDetail>(`/cycles/${id}/reopen`),
    approve: (id: string, note?: string | null) => post<CycleDetail>(`/cycles/${id}/approve`, { note }),
    cancel: (id: string) => post<CycleDetail>(`/cycles/${id}/cancel`),
    compare: (id: string, withId?: string) => request<{ previousId: string | null; rows: CycleCompareRow[] }>(`/cycles/${id}/compare${withId ? `?with=${withId}` : ""}`),
  },

  bia: {
    list: () => request<{ items: BiaListItem[]; missing: { id: string; code: string | null; name: string; status: string; criticality: string }[] }>("/bia"),
    get: (id: string) => request<BiaDetail>(`/bia/${id}`),
    create: (data: BiaInput) => post<BiaDetail>("/bia", data),
    update: (id: string, data: Partial<Omit<BiaInput, "processId">>) => patch<BiaDetail>(`/bia/${id}`, data),
    remove: (id: string) => del(`/bia/${id}`),
  },

  documents: {
    list: (kind: DocKind, framework?: string | null) => request<DocumentVersionDto[]>(`/documents?${qs({ kind, framework: framework ?? undefined })}`),
    create: (data: CreateDocumentInput) => post<DocumentVersionDto>("/documents", data),
    approve: (id: string, note?: string | null) => post<DocumentVersionDto>(`/documents/${id}/approve`, { note: note || null }),
    acknowledge: (id: string) => post<DocumentVersionDto>(`/documents/${id}/acknowledge`),
    remove: (id: string) => del(`/documents/${id}`),
    htmlUrl: (id: string, lang?: string) => withCompany(`/api/documents/${id}/html${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`),
    docxUrl: (id: string, lang?: string) => withCompany(`/api/documents/${id}/docx${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`),
    previewDocxUrl: (kind: DocKind, framework?: string | null, lang?: string) => withCompany(`/api/documents/preview.docx?${qs({ kind, framework: framework ?? undefined, lang: lang || undefined })}`),
    previewUrl: (kind: DocKind, framework?: string | null, lang?: string) => withCompany(`/api/documents/preview.html?${qs({ kind, framework: framework ?? undefined, lang: lang || undefined })}`),
  },

  plans: {
    list: () => request<PlanListItem[]>("/continuity-plans"),
    get: (id: string) => request<PlanDetail>(`/continuity-plans/${id}`),
    create: (data: PlanInput) => post<PlanDetail>("/continuity-plans", data),
    update: (id: string, data: Partial<PlanInput>) => patch<PlanDetail>(`/continuity-plans/${id}`, data),
    remove: (id: string) => del(`/continuity-plans/${id}`),
    addTest: (id: string, data: PlanTestInput) => post<PlanDetail>(`/continuity-plans/${id}/tests`, data),
    deleteTest: (id: string, testId: string) => request<PlanDetail>(`/continuity-plans/${id}/tests/${testId}`, { method: "DELETE" }),
  },

  supplierReports: {
    list: (supplierId?: string) => request<SupplierReportDto[]>(`/suppliers/reports?${qs({ supplierId })}`),
    get: (id: string) => request<SupplierReportDetailDto>(`/suppliers/reports/${id}`),
    create: (data: SupplierReportInput) => post<SupplierReportDetailDto>("/suppliers/reports", data),
    update: (id: string, data: SupplierReportPatch) => patch<SupplierReportDetailDto>(`/suppliers/reports/${id}`, data),
    remove: (id: string) => del(`/suppliers/reports/${id}`),
    review: (id: string) => post<SupplierReportDetailDto>(`/suppliers/reports/${id}/review`),
    upload: (id: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<SupplierReportDetailDto & { note: string | null }>(`/suppliers/reports/${id}/file`, { method: "POST", body: fd });
    },
    fileUrl: (id: string) => withCompany(`/api/suppliers/reports/${id}/file`),
    setText: (id: string, text: string) => put<SupplierReportDetailDto>(`/suppliers/reports/${id}/text`, { text }),
    addItem: (id: string, data: SupplierReportItemInput) => post<SupplierReportDetailDto>(`/suppliers/reports/${id}/items`, data),
    updateItem: (id: string, itemId: string, data: SupplierReportItemPatch) => patch<SupplierReportDetailDto>(`/suppliers/reports/${id}/items/${itemId}`, data),
    removeItem: (id: string, itemId: string) => del<SupplierReportDetailDto>(`/suppliers/reports/${id}/items/${itemId}`),
    createRisk: (id: string, itemId: string) => post<{ riskId: string; report: SupplierReportDetailDto }>(`/suppliers/reports/${id}/items/${itemId}/risk`),
  },
  suppliers: {
    list: (q: { q?: string; significant?: "true" | "false"; withGroup?: "1"; unit?: string } = {}) => request<SupplierListItem[]>(`/suppliers?${qs(q)}`),
    dora: () => request<DoraRegisterDto>("/suppliers/dora"),
    doraContract: (id: string) => request<DoraContractInput>(`/suppliers/dora/contracts/${id}`),
    saveDoraContract: (id: string, data: DoraContractInput) => request<{ ok: true }>(`/suppliers/dora/contracts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    saveDoraProvider: (id: string, data: Partial<DoraProvider>) => request<{ ok: true }>(`/suppliers/dora/providers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    saveDoraEntity: (companyId: string, data: Partial<DoraEntity>) => request<{ ok: true }>(`/suppliers/dora/entities/${companyId}`, { method: "PUT", body: JSON.stringify(data) }),
    saveDoraFunction: (processId: string, activity: string) => request<{ ok: true }>(`/suppliers/dora/functions/${processId}`, { method: "PUT", body: JSON.stringify({ activity }) }),
    doraExportUrl: () => withCompany("/api/suppliers/dora/export.zip"),
    get: (id: string) => request<SupplierDetail>(`/suppliers/${id}`),
    create: (data: SupplierInput) => post<SupplierDetail>("/suppliers", data),
    update: (id: string, data: Partial<SupplierInput>) => patch<SupplierDetail>(`/suppliers/${id}`, data),
    remove: (id: string) => del(`/suppliers/${id}`),
    addContract: (id: string, data: ContractInput) => post<SupplierDetail>(`/suppliers/${id}/contracts`, data),
    updateContract: (id: string, contractId: string, data: Partial<ContractInput>) => patch<SupplierDetail>(`/suppliers/${id}/contracts/${contractId}`, data),
    deleteContract: (id: string, contractId: string) => del(`/suppliers/${id}/contracts/${contractId}`),
    notificationUrl: (id: string) => withCompany(`/api/suppliers/${id}/notification.html`),
    questionnaires: (id: string) => request<QuestionnaireDto[]>(`/suppliers/${id}/questionnaires`),
    createQuestionnaire: (id: string, data: QuestionnaireCreateInput) =>
      post<{ questionnaire: QuestionnaireDto; link: string; emailed: boolean; emailError: string | null }>(`/suppliers/${id}/questionnaires`, data),
    questionnaireLink: (id: string, qid: string, validDays: number) => post<{ questionnaire: QuestionnaireDto; link: string }>(`/suppliers/${id}/questionnaires/${qid}/link`, { validDays }),
    cancelQuestionnaire: (id: string, qid: string) => post<QuestionnaireDto>(`/suppliers/${id}/questionnaires/${qid}/cancel`),
    reopenQuestionnaire: (id: string, qid: string) => post<QuestionnaireDto>(`/suppliers/${id}/questionnaires/${qid}/reopen`),
    evaluateQuestionnaire: (id: string, qid: string, data: QuestionnaireEvaluateInput) => post<QuestionnaireDto>(`/suppliers/${id}/questionnaires/${qid}/evaluate`, data),
    questionnaireRisk: (id: string, qid: string) => post<{ riskId: string }>(`/suppliers/${id}/questionnaires/${qid}/risk`),
    deleteQuestionnaire: (id: string, qid: string) => del(`/suppliers/${id}/questionnaires/${qid}`),
    questionnaireReportUrl: (id: string, qid: string) => withCompany(`/api/suppliers/${id}/questionnaires/${qid}/report.html`),
    questionnaireFileUrl: (id: string, qid: string, fileId: string) => withCompany(`/api/suppliers/${id}/questionnaires/${qid}/files/${fileId}`),
  },
  /** Hledání v záznamech podle významu (ADR-044). */
  /** Zpětné vazby záznamu – kde je použit (v1.05, ADR-101). */
  /** Znalostní články (v1.07). */
  knowledge: {
    list: (q?: string) => request<KnowledgeArticleDto[]>(`/knowledge?${qs({ q })}`),
    get: (id: string) => request<KnowledgeArticleDto>(`/knowledge/${id}`),
    create: (v: KnowledgeArticleInput) => post<KnowledgeArticleDto>("/knowledge", v),
    update: (id: string, v: Partial<KnowledgeArticleInput>) => patch<KnowledgeArticleDto>(`/knowledge/${id}`, v),
    remove: (id: string) => del(`/knowledge/${id}`),
  },
  /** Rychlé hledání záznamů (Ctrl+K, v1.06). */
  quickSearch: (q: string) => request<QuickHit[]>(`/search/quick?${qs({ q })}`),
  links: (target: LinkTarget, id: string) => request<BacklinksDto>(`/links/${target}/${id}`),
  records: {
    status: () => request<RecordIndexStatusDto>("/records/status"),
    reindex: () => post<RecordIndexStatusDto>("/records/reindex"),
    indexSettings: () => request<RecordIndexSettings>("/records/index/settings"),
    saveIndexSettings: (v: RecordIndexSettings) => put<RecordIndexStatusDto>("/records/index/settings", v),
    indexItems: (q: { kind?: RecordKind; q?: string; excluded?: "1"; offset?: number }) => request<{ total: number; items: RecordIndexItemDto[] }>(`/records/index/items?${qs(q)}`),
    exclude: (v: { kind: RecordKind; refId: string; excluded: boolean }) => post<{ ok: boolean }>("/records/index/exclude", v),
    search: (q: string, kinds?: RecordKind[]) => request<RecordSearchResult>(`/records/search?${qs({ q, kinds: kinds?.join(",") })}`),
    similar: (kind: RecordKind, id: string) => request<RecordSimilarResult>(`/records/similar?${qs({ kind, id })}`),
    ask: (question: string) => post<RecordAskAnswer>("/records/ask", { question }),
    related: (text: string, kinds?: RecordKind[], exclude?: { kind: RecordKind; id: string }) => post<RecordSearchResult>("/records/related", { text, kinds, exclude }),
  },
  /** SOC – fronta alertů, triáž, AI poradci (ADR-046). */
  soc: {
    summary: () => request<SocSummaryDto>("/soc/summary"),
    alerts: (q: { status?: string; severity?: SocSeverity; mine?: "1"; unassigned?: "1"; tactic?: string; q?: string; ai?: "tp" | "fp" | "none"; intel?: "1"; source?: string; from?: string; to?: string } = {}) => request<SocAlertDto[]>(`/soc/alerts?${qs(q)}`),
    alert: (id: string) => request<SocAlertDetailDto>(`/soc/alerts/${id}`),
    analysts: () => request<SocAnalyst[]>("/soc/analysts"),
    create: (data: SocAlertCreate) => post<SocAlertDetailDto>("/soc/alerts", data),
    update: (id: string, data: SocAlertPatch) => patch<SocAlertDetailDto>(`/soc/alerts/${id}`, data),
    note: (id: string, text: string) => post<SocAlertDetailDto>(`/soc/alerts/${id}/notes`, { text }),
    close: (id: string, verdict: SocVerdict, reason: string, suppress?: { until: string; ip: boolean }) =>
      post<SocAlertDetailDto>(`/soc/alerts/${id}/close`, { verdict, reason, ...(suppress ? { suppressUntil: suppress.until, suppressIp: suppress.ip } : {}) }),
    reopen: (id: string) => post<SocAlertDetailDto>(`/soc/alerts/${id}/reopen`),
    escalate: (id: string, data: { kind?: "unassessed" | "event" | "incident"; title?: string; incidentId?: string }) => post<{ incidentId: string; alert: SocAlertDetailDto }>(`/soc/alerts/${id}/escalate`, data),
    advise: (id: string) => post<SocAlertDetailDto>(`/soc/alerts/${id}/advise`),
    triage: (id: string) => post<SocAlertDetailDto>(`/soc/alerts/${id}/triage`),
    responseSettings: () => request<SocResponseSettings>("/soc/response/settings"),
    saveResponseSettings: (data: SocResponseSettingsInput) => put<SocResponseSettings>("/soc/response/settings", data),
    actions: (q: { status?: "open" | "all"; alertId?: string } = {}) => request<SocActionDto[]>(`/soc/actions?${qs(q)}`),
    proposeAction: (data: SocActionInput) => post<SocActionDto>("/soc/actions", data),
    decideAction: (id: string, decision: "approve" | "reject", note: string) => post<SocActionDto>(`/soc/actions/${id}/decide`, { decision, note }),
    completeAction: (id: string, success: boolean, note: string) => post<SocActionDto>(`/soc/actions/${id}/complete`, { success, note }),
    cancelAction: (id: string) => post<SocActionDto>(`/soc/actions/${id}/cancel`),
    iocs: (q: { state?: "active" | "all"; type?: string; q?: string } = {}) => request<SocIocDto[]>(`/soc/iocs?${qs(q)}`),
    addIocs: (data: SocIocInput) => post<SocIocCreateResult>("/soc/iocs", data),
    updateIoc: (id: string, data: SocIocPatch) => patch<SocIocDto>(`/soc/iocs/${id}`, data),
    revokeIoc: (id: string) => post<SocIocDto>(`/soc/iocs/${id}/revoke`),
    huntIoc: (id: string, days: number) => post<SocIocDto>(`/soc/iocs/${id}/hunt`, { days }),
    alertIocs: (alertId: string) => request<SocIocCandidate[]>(`/soc/alerts/${alertId}/iocs`),
    iocExportUrl: (type: string | undefined, format: "txt" | "csv") => `/api/soc/iocs/export?${qs({ type, format })}`,
    iocFeeds: () => request<SocIocFeedDto[]>("/soc/ioc-feeds"),
    createIocFeed: (name: string) => post<SocIocFeedSecret>("/soc/ioc-feeds", { name }),
    deleteIocFeed: (id: string) => del(`/soc/ioc-feeds/${id}`),
    metrics: (days: number) => request<SocMetricsDto>(`/soc/metrics?days=${days}`),
    sources: () => request<SocSourceDto[]>("/soc/sources"),
    threatIntel: () => request<TiStatusDto>("/soc/threat-intel"),
    integrations: () => request<SocIntegrationsDto>("/soc/integrations"),
    saveIntegrations: (data: SocIntegrationsInput) => put<SocIntegrationsDto>("/soc/integrations", data),
    testIntegration: (kind: "cortex" | "misp") => post<SocIntegrationsDto>(`/soc/integrations/${kind}/test`),
    enrichOptions: () => request<EnrichOptionsDto>("/soc/enrich/options"),
    enrichments: (q: { alertId?: string; iocId?: string; value?: string }) => request<SocEnrichmentDto[]>(`/soc/enrichments?${qs(q)}`),
    enrichment: (id: string) => request<SocEnrichmentDto>(`/soc/enrichments/${id}`),
    runEnrichment: (data: EnrichRunInput) => post<SocEnrichmentDto>("/soc/enrichments", data),
    refreshEnrichment: (id: string) => post<SocEnrichmentDto>(`/soc/enrichments/${id}/refresh`),
    mispShare: (data: MispShareInput) => post<MispShareResult>("/soc/iocs/misp-share", data),
    playbooks: () => request<{ builtin: SocPlaybookView[]; custom: SocPlaybookDto[] }>("/soc/playbooks"),
    createPlaybook: (data: SocPlaybookInput) => post<SocPlaybookDto>("/soc/playbooks", data),
    updatePlaybook: (id: string, data: SocPlaybookPatch) => patch<SocPlaybookDto>(`/soc/playbooks/${id}`, data),
    deletePlaybook: (id: string) => del(`/soc/playbooks/${id}`),
    playbookTasks: (alertId: string, steps: SocPlaybookTasksInput["steps"]) => post<{ created: number; skipped: number; alert: SocAlertDetailDto }>(`/soc/alerts/${alertId}/playbook-tasks`, { steps }),
    hosts: (days: number, q?: string) => request<SocHostListItem[]>(`/soc/hosts?${qs({ days, q })}`),
    host: (key: string, days: number) => request<SocHostDetail>(`/soc/hosts/${encodeURIComponent(key)}?days=${days}`),
    hunts: () => request<SocHuntDto[]>("/soc/hunts"),
    huntTemplates: () => request<SocHuntTemplate[]>("/soc/hunts/templates"),
    createHunt: (data: SocHuntInput) => post<SocHuntDto>("/soc/hunts", data),
    updateHunt: (id: string, data: SocHuntPatch) => patch<SocHuntDto>(`/soc/hunts/${id}`, data),
    deleteHunt: (id: string) => del(`/soc/hunts/${id}`),
    runHunt: (id: string, dryRun: boolean) => post<{ run: SocHuntRun; hunt: SocHuntDto }>(`/soc/hunts/${id}/run?dryRun=${dryRun ? 1 : 0}`),
    saveThreatIntel: (data: TiSettingsInput) => put<TiStatusDto>("/soc/threat-intel/settings", data),
    refreshThreatIntel: () => post<TiStatusDto>("/soc/threat-intel/refresh"),
    uploadThreatIntel: (source: string, file: File) => {
      const fd = new FormData();
      fd.append("source", source);
      fd.append("file", file);
      return request<{ count: number; matched: number }>("/soc/threat-intel/upload", { method: "POST", body: fd });
    },
    createSource: (data: SocSourceInput) => post<SocSourceSecret>("/soc/sources", data),
    updateSource: (id: string, data: SocSourcePatch) => patch<SocSourceDto>(`/soc/sources/${id}`, data),
    pullSource: (id: string) => post<{ result: { fetched: number; created: number; updated: number; error: string | null }; source: SocSourceDto }>(`/soc/sources/${id}/pull`),
    rotateSource: (id: string) => post<SocSourceSecret>(`/soc/sources/${id}/rotate`),
    deleteSource: (id: string) => del(`/soc/sources/${id}`),
    reportPhishing: (data: { file?: File | null; note?: string; from?: string; subject?: string }) => {
      const fd = new FormData();
      if (data.file) fd.append("file", data.file);
      for (const k of ["note", "from", "subject"] as const) if (data[k]?.trim()) fd.append(k, data[k]!.trim());
      return request<PhishingReportResult>("/soc/phishing", { method: "POST", body: fd });
    },
    advisor: (question: string, alertId?: string) => post<SocAdvisorAnswer>("/soc/advisor", { question, alertId }),
    sync: () => post<{ created: number; updated: number; suppressed?: number; alerts?: number }>("/soc/sync"),
    settings: () => request<SocSettings>("/soc/settings"),
    saveSettings: (data: SocSettingsInput) => put<SocSettings>("/soc/settings", data),
    cases: (q: { status?: "open" | "escalated" | "closed" | "all"; mine?: "1" } = {}) => request<SocCaseDto[]>(`/soc/cases?${qs(q)}`),
    case: (id: string) => request<SocCaseDetailDto>(`/soc/cases/${id}`),
    createCase: (data: SocCaseCreate) => post<SocCaseDetailDto>("/soc/cases", data),
    updateCase: (id: string, data: SocCasePatch) => patch<SocCaseDetailDto>(`/soc/cases/${id}`, data),
    caseAlerts: (id: string, data: { add?: string[]; remove?: string[] }) => post<SocCaseDetailDto>(`/soc/cases/${id}/alerts`, data),
    caseNote: (id: string, text: string) => post<SocCaseDetailDto>(`/soc/cases/${id}/notes`, { text }),
    closeCase: (id: string, verdict: SocVerdict, reason: string) => post<SocCaseDetailDto>(`/soc/cases/${id}/close`, { verdict, reason }),
    reopenCase: (id: string) => post<SocCaseDetailDto>(`/soc/cases/${id}/reopen`),
    escalateCase: (id: string, data: { kind?: "unassessed" | "event" | "incident"; title?: string }) => post<{ incidentId: string; case: SocCaseDetailDto }>(`/soc/cases/${id}/escalate`, data),
    suppressions: (state: "active" | "all" = "active") => request<SocSuppressionDto[]>(`/soc/suppressions?${qs({ state })}`),
    createSuppression: (data: SocSuppressionInput) => post<SocSuppressionDto>("/soc/suppressions", data),
    revokeSuppression: (id: string) => post<SocSuppressionDto>(`/soc/suppressions/${id}/revoke`),
    riskSignals: (riskId: string, days = 90) => request<SocRiskSignals>(`/soc/risk-signals/${riskId}?${qs({ days })}`),
    ruleStats: (days = 90) => request<SocRuleStat[]>(`/soc/rule-stats?${qs({ days })}`),
    tuning: () => request<TuningProposalDto[]>("/soc/tuning"),
    tuningXmlUrl: () => withCompany("/api/soc/tuning/rules.xml"),
    createTuning: (data: TuningProposalInput) => post<TuningProposalDto>("/soc/tuning", data),
    suggestTuning: (ruleId: string, days = 30) => post<TuningProposalDto>("/soc/tuning/suggest", { ruleId, days }),
    simulateTuning: (id: string, days = 30) => post<TuningProposalDto>(`/soc/tuning/${id}/simulate`, { days }),
    decideTuning: (id: string, data: { decision: "approve" | "reject"; note?: string | null }) => post<TuningProposalDto>(`/soc/tuning/${id}/decision`, data),
    deleteTuning: (id: string) => del(`/soc/tuning/${id}`),
  },
  /** Akce a úkoly (ADR-043). */
  actions: {
    list: (q: { kind?: string; status?: "active" | "done" | "all"; mine?: "1"; overdue?: "1"; q?: string } = {}) =>
      request<{ items: ActionItem[]; summary: ActionSummary; kinds: ActionKind[] }>(`/actions?${qs(q)}`),
    exportUrl: () => withCompany("/api/actions/export"),
    tasks: (sourceKind: TaskSource, sourceId?: string) => request<TaskDto[]>(`/actions/tasks?${qs({ sourceKind, sourceId })}`),
    bulkTasks: (v: { ids: string[]; status?: TaskStatus; dueDate?: string | null; ownerPositionId?: string | null; priority?: TaskPriority; assigneeUserId?: string | null }) => post<{ updated: number; skipped: string[] }>("/actions/tasks/bulk", v),
    task: (id: string) => request<TaskDto>(`/actions/tasks/${id}`),
    create: (data: TaskInput) => post<TaskDto>("/actions/tasks", data),
    update: (id: string, data: TaskPatch) => patch<TaskDto>(`/actions/tasks/${id}`, data),
    remove: (id: string) => del(`/actions/tasks/${id}`),
  },
  /** Trendy ukazatelů aktivní společnosti (ADR-042). */
  trends: {
    get: (months = 12) => request<TrendDto>(`/trends?months=${months}`),
  },
  /** ARES – údaje o firmě podle IČO / názvu (ADR-041). */
  views: {
    list: (page: ViewPage) => request<SavedViewDto[]>(`${VIEW_BASE[page]}/views`),
    save: (page: ViewPage, data: SavedViewInput) => post<SavedViewDto>(`${VIEW_BASE[page]}/views`, data),
    remove: (page: ViewPage, id: string) => del(`${VIEW_BASE[page]}/views/${id}`),
  },
  ares: {
    status: () => request<{ enabled: boolean }>("/ares/status"),
    search: (q: string) => request<AresSubject[]>(`/ares/search?${qs({ q })}`),
    res: (ico: string) => request<ResLookupDto>(`/ares/res/${encodeURIComponent(ico)}`),
  },
  /** Určení regulace podle vyhl. 408/2025 (v1.61, ADR-156). */
  regulation: {
    list: (subjectKind: "company" | "supplier", subjectId: string) => request<RegulationAssessmentDto[]>(`/regulation/assessments?${qs({ subjectKind, subjectId })}`),
    save: (d: RegulationAssessmentInput) => post<RegulationAssessmentDto>("/regulation/assessments", d),
    registration: (companyId: string) => request<RegistrationDto>(`/regulation/registration/${companyId}`),
    saveRegistration: (companyId: string, d: Partial<RegistrationData>) => put<RegistrationDto>(`/regulation/registration/${companyId}`, d),
    notified: (companyId: string, d: { notifiedAt: string; notifiedRef: string; rebase?: boolean }) => post<RegistrationDto>(`/regulation/registration/${companyId}/notified`, d),
    clearNotified: (companyId: string) => del<RegistrationDto>(`/regulation/registration/${companyId}/notified`),
    saveDecision: (companyId: string, d: { deliveredAt: string | null; ref: string }) => put<RegistrationDto>(`/regulation/registration/${companyId}/decision`, d),
    uploadDecision: (companyId: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<RegistrationDto>(`/regulation/registration/${companyId}/decision/file`, { method: "POST", body: fd });
    },
    removeDecisionFile: (companyId: string) => del<RegistrationDto>(`/regulation/registration/${companyId}/decision/file`),
    decisionFileUrl: (companyId: string) => withCompany(`/api/regulation/registration/${companyId}/decision/file`),
    registrationUrl: (companyId: string, fmt: "html" | "docx") => withCompany(`/api/regulation/registration/${companyId}/print.${fmt}`),
  },
  /** Veřejný dotazník pro dodavatele (bez přihlášení, token v odkazu). */
  trust: {
    questionnaires: () => request<CustomerQDto[]>("/trust/questionnaires"),
    questionnaire: (id: string) => request<CustomerQDetailDto>(`/trust/questionnaires/${id}`),
    importQuestionnaire: (file: File, o: Record<string, string | number | undefined>) => {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") fd.append(k, String(v));
      return request<CustomerQPreviewDto | CustomerQDetailDto>("/trust/questionnaires", { method: "POST", body: fd });
    },
    removeQuestionnaire: (id: string) => del(`/trust/questionnaires/${id}`),
    patchItem: (id: string, itemId: string, data: QaItemPatch) => patch<CustomerQDetailDto>(`/trust/questionnaires/${id}/items/${itemId}`, data),
    fromLibrary: (id: string, itemId: string, libId: string) => post<CustomerQDetailDto>(`/trust/questionnaires/${id}/items/${itemId}/from-library/${libId}`),
    approveItems: (id: string, ids: string[]) => post<CustomerQDetailDto>(`/trust/questionnaires/${id}/approve-items`, { ids }),
    approve: (id: string) => post<CustomerQDetailDto>(`/trust/questionnaires/${id}/approve`),
    reopen: (id: string) => post<CustomerQDetailDto>(`/trust/questionnaires/${id}/reopen`),
    sent: (id: string) => post<CustomerQDetailDto>(`/trust/questionnaires/${id}/sent`),
    exportUrl: (id: string) => withCompany(`/api/trust/questionnaires/${id}/export.xlsx`),
    library: (q?: string) => request<AnswerLibraryDto[]>(`/trust/library?${qs({ q })}`),
    saveLibrary: (data: AnswerLibraryInput) => post<AnswerLibraryDto>("/trust/library", data),
    updateLibrary: (id: string, data: AnswerLibraryInput) => put<AnswerLibraryDto>(`/trust/library/${id}`, data),
    removeLibrary: (id: string) => del(`/trust/library/${id}`),
    center: () => request<TrustSettingsDto | null>("/trust/center"),
    saveCenter: (data: TrustSettingsInput) => put<TrustSettingsDto>("/trust/center", data),
    requests: () => request<TrustAccessRequestDto[]>("/trust/center/requests"),
    approveRequest: (id: string) => post<{ link: string; mailed: boolean; mailError: string | null; expiresAt: string }>(`/trust/center/requests/${id}/approve`),
    rejectRequest: (id: string) => post(`/trust/center/requests/${id}/reject`),
    revokeRequest: (id: string) => post(`/trust/center/requests/${id}/revoke`),
  },
  publicTrust: {
    get: (slug: string, token?: string | null) => request<PublicTrustDto>(`/public/trust/${encodeURIComponent(slug)}${token ? `?t=${encodeURIComponent(token)}` : ""}`),
    docUrl: (slug: string, policyId: string, token?: string | null) => `/api/public/trust/${encodeURIComponent(slug)}/docs/${policyId}${token ? `?t=${encodeURIComponent(token)}` : ""}`,
    request: (slug: string, data: TrustAccessRequestInput) => post<{ ok: true }>(`/public/trust/${encodeURIComponent(slug)}/requests`, data),
  },
  publicQuestionnaire: {
    get: (token: string) => request<PublicQuestionnaireDto>(`/public/questionnaires/${encodeURIComponent(token)}`),
    save: (token: string, data: QuestionnaireSaveInput) => put<PublicQuestionnaireDto>(`/public/questionnaires/${encodeURIComponent(token)}`, data),
    submit: (token: string, data: QuestionnaireSubmitInput) => post<PublicQuestionnaireDto>(`/public/questionnaires/${encodeURIComponent(token)}/submit`, data),
    upload: (token: string, file: File, questionKey: string | null) => {
      const fd = new FormData();
      fd.set("file", file);
      if (questionKey) fd.set("questionKey", questionKey);
      return request<PublicQuestionnaireDto>(`/public/questionnaires/${encodeURIComponent(token)}/files`, { method: "POST", body: fd });
    },
    removeFile: (token: string, fileId: string) => request<PublicQuestionnaireDto>(`/public/questionnaires/${encodeURIComponent(token)}/files/${fileId}`, { method: "DELETE" }),
  },

  isms: {
    overview: () => request<IsmsOverviewDto>("/isms/overview"),
    criteria: () => request<string[]>("/isms/criteria"),
    changes: (q: { q?: string; status?: "open" | "all" | "significant"; from?: string; to?: string } = {}) => request<ChangeListItem[]>(`/isms/changes?${qs(q)}`),
    change: (id: string) => request<ChangeDetail>(`/isms/changes/${id}`),
    createChange: (data: ChangeInput) => post<ChangeDetail>("/isms/changes", data),
    updateChange: (id: string, data: Partial<ChangeInput>) => patch<ChangeDetail>(`/isms/changes/${id}`, data),
    removeChange: (id: string) => del(`/isms/changes/${id}`),
    objectives: () => request<ObjectiveDto[]>("/isms/objectives"),
    createObjective: (data: ObjectiveInput) => post<ObjectiveDto>("/isms/objectives", data),
    updateObjective: (id: string, data: Partial<ObjectiveInput>) => patch<ObjectiveDto>(`/isms/objectives/${id}`, data),
    removeObjective: (id: string) => del(`/isms/objectives/${id}`),
  },

  incidents: {
    list: (q: { q?: string; view?: "open" | "all" | "incidents" | "reportable"; from?: string; to?: string } = {}) => request<IncidentListItem[]>(`/incidents?${qs(q)}`),
    get: (id: string) => request<IncidentDetail>(`/incidents/${id}`),
    soc: (id: string) => request<IncidentSocEvidence | null>(`/incidents/${id}/soc`),
    socDraft: (id: string) => request<IncidentSocDraft>(`/incidents/${id}/soc-draft`),
    recordUrl: (id: string, format: "html" | "docx") => `/api/incidents/${id}/record.${format}`,
    create: (data: IncidentInput) => post<IncidentDetail | { id: string; title: string }>("/incidents", data),
    update: (id: string, data: Partial<IncidentInput>) => patch<IncidentDetail>(`/incidents/${id}`, data),
    remove: (id: string) => del(`/incidents/${id}`),
    addReport: (id: string, data: IncidentReportInput) => post<IncidentDetail>(`/incidents/${id}/reports`, data),
    deleteReport: (id: string, reportId: string) => request<IncidentDetail>(`/incidents/${id}/reports/${reportId}`, { method: "DELETE" }),
    reportUrl: (id: string, type: string) => withCompany(`/api/incidents/${id}/report.html?type=${type}`),
    report: (id: string, type: ReportType) => request<IncidentReportDraft>(`/incidents/${id}/report?type=${type}`),
    reportTxtUrl: (id: string, type: string) => withCompany(`/api/incidents/${id}/report.txt?type=${type}`),
  },

  audits: {
    list: (status: "open" | "all" = "all") => request<AuditListItem[]>(`/audits?status=${status}`),
    coverage: () => request<AuditCoverageRow[]>("/audits/coverage"),
    scopeCoverage: (years = 3) => request<AuditScopeCoverageDto>(`/audits/scope-coverage?years=${years}`),
    findings: (status: "open" | "all" = "open") => request<FindingDto[]>(`/audits/findings?status=${status}`),
    get: (id: string) => request<AuditDetail>(`/audits/${id}`),
    create: (data: AuditInput) => post<AuditDetail>("/audits", data),
    update: (id: string, data: Partial<AuditInput>) => patch<AuditDetail>(`/audits/${id}`, data),
    remove: (id: string) => del(`/audits/${id}`),
    addFinding: (id: string, data: FindingInput) => post<AuditDetail>(`/audits/${id}/findings`, data),
    updateFinding: (id: string, findingId: string, data: Partial<FindingInput>) => patch<AuditDetail>(`/audits/${id}/findings/${findingId}`, data),
    deleteFinding: (id: string, findingId: string) => request<AuditDetail>(`/audits/${id}/findings/${findingId}`, { method: "DELETE" }),
    checklist: (id: string) => request<AuditChecklistDto>(`/audits/${id}/checklist`),
    check: (id: string, data: AuditCheckInput & { itemId: string }) => put<AuditChecklistDto>(`/audits/${id}/checklist`, data),
    findingFromCheck: (id: string, itemId: string, severity?: FindingSeverity) => post<AuditChecklistDto>(`/audits/${id}/checklist/finding`, { itemId, severity }),
  },

  policies: {
    list: () => request<PolicyListItem[]>("/policies"),
    /** Dokumenty útvaru včetně podřízených (v1.80). */
    listByUnit: (unit: string) => request<PolicyListItem[]>(`/policies?unit=${encodeURIComponent(unit)}`),
    coverage: (framework?: string) => request<PolicyCoverageRow[]>(`/policies/coverage${framework ? `?framework=${framework}` : ""}`),
    mine: () => request<MyPolicyItem[]>("/policies/mine"),
    get: (id: string) => request<PolicyDetail>(`/policies/${id}`),
    /** Hromadný import: ZIP s tabulkou metadat a soubory – náhled / založení. */
    importDocs: <M extends "preview" | "commit">(file: File, mode: M, options: DocImportOptions = {}) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      fd.append("options", JSON.stringify(options));
      return request<M extends "commit" ? DocImportResultDto : DocImportPreviewDto>("/policies/import", { method: "POST", body: fd });
    },
    /** Dokumenty navázané na proces / aktivum / riziko / dodavatele / opatření / požadavek. */
    linked: (kind: PolicyLinkKind, id: string) => request<PolicyRef[]>(`/policies/linked?${qs({ kind, id })}`),
    create: (data: PolicyInput) => post<PolicyDetail>("/policies", data),
    update: (id: string, data: Partial<PolicyInput>) => patch<PolicyDetail>(`/policies/${id}`, data),
    remove: (id: string) => del(`/policies/${id}`),
    review: (id: string, note: string | null) => post<PolicyDetail>(`/policies/${id}/review`, { note }),
    addVersion: (id: string, data: PolicyVersionInput) => post<PolicyDetail>(`/policies/${id}/versions`, data),
    updateVersion: (id: string, vid: string, data: Partial<PolicyVersionInput>) => patch<PolicyDetail>(`/policies/${id}/versions/${vid}`, data),
    deleteVersion: (id: string, vid: string) => request<PolicyDetail>(`/policies/${id}/versions/${vid}`, { method: "DELETE" }),
    approve: (id: string, vid: string) => post<PolicyDetail>(`/policies/${id}/versions/${vid}/approve`),
    content: (id: string, vid: string) =>
      request<{ title: string; code: string | null; version: string; status: string; content: string | null; location: string | null; classification: string }>(`/policies/${id}/versions/${vid}/content`),
    acknowledge: (id: string, vid: string) => post<MyPolicyItem[]>(`/policies/${id}/versions/${vid}/acknowledge`),
    workflow: (id: string, vid: string, data: PolicyWorkflowInput) => post<PolicyDetail>(`/policies/${id}/versions/${vid}/workflow`, data),
    uploadFile: (id: string, vid: string, file: File, replaceId?: string | null, note?: string | null) => {
      const fd = new FormData();
      fd.set("file", file);
      if (replaceId) fd.set("replaceId", replaceId);
      if (note) fd.set("note", note);
      return request<PolicyDetail>(`/policies/${id}/versions/${vid}/files`, { method: "POST", body: fd });
    },
    checkout: (id: string, vid: string) => post<PolicyDetail>(`/policies/${id}/versions/${vid}/checkout`),
    checkin: (id: string, vid: string, file: File | null, replaceId?: string | null, note?: string | null) => {
      const fd = new FormData();
      if (file) fd.set("file", file);
      if (replaceId) fd.set("replaceId", replaceId);
      if (note) fd.set("note", note);
      return request<PolicyDetail>(`/policies/${id}/versions/${vid}/checkin`, { method: "POST", body: fd });
    },
    unlock: (id: string, vid: string) => post<PolicyDetail>(`/policies/${id}/versions/${vid}/unlock`),
    fromTemplate: (id: string, vid: string, templateId: string) => post<PolicyDetail>(`/policies/${id}/versions/${vid}/from-template`, { templateId }),
    folders: () => request<PolicyFolderDto[]>("/policies/folders"),
    createFolder: (data: PolicyFolderInput) => post<PolicyFolderDto[]>("/policies/folders", data),
    updateFolder: (fid: string, data: Partial<PolicyFolderInput>) => patch<PolicyFolderDto[]>(`/policies/folders/${fid}`, data),
    deleteFolder: (fid: string) => request<PolicyFolderDto[]>(`/policies/folders/${fid}`, { method: "DELETE" }),
    templates: () => request<PolicyTemplateDto[]>("/policies/templates"),
    uploadTemplate: (file: File, name: string, docType: string | null) => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("name", name);
      if (docType) fd.set("docType", docType);
      return request<PolicyTemplateDto[]>("/policies/templates", { method: "POST", body: fd });
    },
    deleteTemplate: (tid: string) => request<PolicyTemplateDto[]>(`/policies/templates/${tid}`, { method: "DELETE" }),
    templateUrl: (tid: string) => withCompany(`/api/policies/templates/${tid}/file`),
    retention: () => request<RetentionRow[]>("/policies/retention"),
    pdfUrl: (id: string, vid: string, fid: string, download = false) => withCompany(`/api/policies/${id}/versions/${vid}/files/${fid}/pdf${download ? "?download=1" : ""}`),
    convert: (id: string, vid: string, fid: string) => post<PolicyDetail>(`/policies/${id}/versions/${vid}/files/${fid}/convert`),
    diff: (id: string, vid: string, base?: string) => request<VersionDiffDto>(`/policies/${id}/versions/${vid}/diff${base ? `?base=${base}` : ""}`),
    search: (q: string) => request<PolicySearchHit[]>(`/policies/search?q=${encodeURIComponent(q)}`),
    office: (id: string, vid: string, fid: string, mode: "edit" | "view") => post<OfficeOpenDto>(`/policies/${id}/versions/${vid}/files/${fid}/office`, { mode }),
    qaStatus: () => request<{ enabled: boolean }>("/policies/qa/status"),
    qa: (question: string) => post<DocQaAnswerDto>("/policies/qa", { question }),
    qaIndex: () => request<DocIndexStatusDto>("/policies/qa/index"),
    qaReindex: () => post<DocIndexStatusDto>("/policies/qa/reindex"),
    portalChanges: (id: string) => request<VersionDiffDto>(`/policies/portal/${id}/changes`),
    packageUrl: (id: string) => withCompany(`/api/policies/${id}/package`),
    dispose: (id: string, data: DisposeInput) => post<PolicyDetail>(`/policies/${id}/dispose`, data),
    deleteFile: (id: string, vid: string, fid: string) => request<PolicyDetail>(`/policies/${id}/versions/${vid}/files/${fid}`, { method: "DELETE" }),
    fileUrl: (id: string, vid: string, fid: string, inline = false) => withCompany(`/api/policies/${id}/versions/${vid}/files/${fid}${inline ? "?inline=1" : ""}`),
    saveQuiz: (id: string, data: QuizInput) => request<PolicyDetail>(`/policies/${id}/quiz`, { method: "PUT", body: JSON.stringify(data) }),
    resolveComment: (id: string, cid: string, status: "accepted" | "rejected", response: string) => post<PolicyDetail>(`/policies/${id}/comments/${cid}/resolve`, { status, response }),
    myRoles: () => request<PolicyListItem[]>("/policies/my-roles"),
    portal: (q?: string) => request<PortalDocItem[]>(`/policies/portal${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    portalDoc: (id: string) => request<PortalDocDetail>(`/policies/portal/${id}`),
    comment: (id: string, data: PolicyCommentInput) => post<PolicyCommentDto[]>(`/policies/portal/${id}/comments`, data),
    quiz: (id: string, answers: number[][]) => post<{ score: number; passed: boolean; correct: number; total: number; passPct: number }>(`/policies/portal/${id}/quiz`, { answers }),
  },

  awareness: {
    list: () => request<CourseListItem[]>("/awareness"),
    mine: () => request<MyTrainingItem[]>("/awareness/mine"),
    log: (from?: string, to?: string) => request<TrainingLogRow[]>(`/awareness/log?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`),
    get: (id: string) => request<CourseDetail>(`/awareness/${id}`),
    create: (data: CourseInput) => post<CourseDetail>("/awareness", data),
    update: (id: string, data: Partial<CourseInput>) => patch<CourseDetail>(`/awareness/${id}`, data),
    remove: (id: string) => del(`/awareness/${id}`),
    session: (id: string, sid: string) => request<{ id: string; date: string; status: string; trainer: string | null; location: string | null; note: string | null; effectiveness: string | null; participantIds: string[] }>(`/awareness/${id}/sessions/${sid}`),
    addSession: (id: string, data: SessionInput) => post<CourseDetail>(`/awareness/${id}/sessions`, data),
    updateSession: (id: string, sid: string, data: Partial<SessionInput>) => patch<CourseDetail>(`/awareness/${id}/sessions/${sid}`, data),
    deleteSession: (id: string, sid: string) => request<CourseDetail>(`/awareness/${id}/sessions/${sid}`, { method: "DELETE" }),
    addRecords: (id: string, data: RecordInput) => post<CourseDetail>(`/awareness/${id}/records`, data),
  },

  notifications: {
    mine: () => request<ObligationItem[]>("/notifications/mine"),
    team: () => request<ObligationItem[]>("/notifications/team"),
    settings: () => request<NotificationSettingsDto>("/notifications/settings"),
    saveSettings: (data: NotificationSettingsInput) => patch<NotificationSettingsDto>("/notifications/settings", data),
    test: (channel: "email" | "teams", to?: string) => post<{ ok: boolean; message: string }>("/notifications/test", { channel, to }),
    runNow: () => post<{ emails: number; teams: number }>("/notifications/run"),
  },

  /** Knihovna rámců (ADR-079). */
  frameworks: {
    catalog: () => request<CustomFrameworkDto[]>("/frameworks/catalog"),
    list: () => request<FrameworkLibraryItem[]>("/frameworks"),
    import: (file: File, meta: Record<string, unknown>, mode: "preview" | "commit", replace = false) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("meta", JSON.stringify(meta));
      fd.append("mode", mode);
      if (replace) fd.append("replace", "true");
      return request<FrameworkImportPreview>("/frameworks/import", { method: "POST", body: fd });
    },
    exportUrl: (id: string, format: FrameworkExportFormat) => `/api/frameworks/${encodeURIComponent(id)}/export?format=${format}`,
    remove: (id: string, force = false) => del(`/frameworks/${encodeURIComponent(id)}?force=${force}`),
  },

  methodologies: {
    list: () => request<MethodologyDto[]>("/methodologies"),
    validate: (data: ImportMethodologyInput) => post<{ ok: boolean; errors: string[]; definition: MethodologyDef | null }>("/methodologies/validate", data),
    import: (data: ImportMethodologyInput) => post<{ id: string; kind: string; name: string }>("/methodologies/import", data),
    remove: (id: string) => del(`/methodologies/${id}`),
    exportUrl: (id: string, format: MethodologyFormat) => `/api/methodologies/${encodeURIComponent(id)}/export?format=${format}`,
  },

  ai: {
    status: () => request<AiStatusDto>("/ai/status"),
    settings: () => request<AiSettingsDto>("/ai/settings"),
    saveSettings: (data: AiSettingsInput) => patch<AiSettingsDto>("/ai/settings", data),
    test: () => post<{ ok: boolean; message: string }>("/ai/test"),
    models: () => request<{ models: string[] }>("/ai/models"),
    request: (data: AiRequestInput) => post<AiSuggestionDto>("/ai/suggestions", data),
    forEntity: (entityId: string) => request<AiSuggestionDto[]>(`/ai/suggestions?entityId=${entityId}`),
    get: (id: string) => request<AiSuggestionDto>(`/ai/suggestions/${id}`),
    decide: (id: string, data: AiDecisionInput) => post<{ suggestion: AiSuggestionDto; createdActions?: number; addedRequirements?: number; updatedFields?: number; addedMeasures?: number; acknowledged?: number }>(`/ai/suggestions/${id}/decide`, data),
    log: () => request<AiLogRow[]>("/ai/log"),
    tools: () => request<AiToolInfo[]>("/ai/tools"),
    ask: (data: AiQueryInput) => post<AiQueryDto>("/ai/queries", data),
    queries: () => request<AiQueryDto[]>("/ai/queries"),
    query: (id: string) => request<AiQueryDto>(`/ai/queries/${id}`),
    queryLog: () => request<(AiQueryDto & { plan: { tool: string; args: Record<string, unknown> }[] })[]>("/ai/log/queries"),
  },

  import: {
    entities: () => request<ImportEntity[]>("/import/entities"),
    preview: (fd: FormData) => request<ImportPreviewDto>("/import/preview", { method: "POST", body: fd }),
    commit: (fd: FormData) => request<ImportResultDto>("/import/commit", { method: "POST", body: fd }),
    templateUrl: (entity: ImportEntity) => withCompany(`/api/import/template/${entity}.xlsx`),
  },

  tokens: {
    list: () => request<ApiTokenDto[]>("/tokens"),
    create: (data: ApiTokenInput) => post<{ token: string; item: ApiTokenDto }>("/tokens", data),
    revoke: (id: string) => post<ApiTokenDto[]>(`/tokens/${id}/revoke`),
    remove: (id: string) => request<ApiTokenDto[]>(`/tokens/${id}`, { method: "DELETE" }),
  },

  assurance: {
    overview: () =>
      request<{
        testsOpen: number;
        testsOverdue: number;
        testsLastYear: Record<string, number>;
        evidenceTotal: number;
        evidenceExpired: number;
        evidenceExpiring: number;
        implementedControls: number;
        implementedWithoutEvidence: number;
        implementedNotTested: number;
      }>("/assurance/overview"),
    evidence: (q: { controlId?: string; q?: string; validity?: string } = {}) => request<EvidenceDto[]>(`/assurance/evidence?${qs(q)}`),
    getEvidence: (id: string) => request<EvidenceDto>(`/assurance/evidence/${id}`),
    createEvidence: (data: EvidenceInput) => post<EvidenceDto>("/assurance/evidence", data),
    updateEvidence: (id: string, data: Partial<EvidenceInput>) => patch<EvidenceDto>(`/assurance/evidence/${id}`, data),
    deleteEvidence: (id: string) => del(`/assurance/evidence/${id}`),
    uploadFile: (id: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<EvidenceDto>(`/assurance/evidence/${id}/files`, { method: "POST", body: fd });
    },
    deleteFile: (id: string, fileId: string) => request<EvidenceDto>(`/assurance/evidence/${id}/files/${fileId}`, { method: "DELETE" }),
    fileUrl: (id: string, fileId: string) => withCompany(`/api/assurance/evidence/${id}/files/${fileId}`),
    packageUrl: (q: { framework: string; periodFrom?: string; periodTo?: string; files?: "1" | "0" }) => withCompany(`/api/assurance/package.zip?${qs(q)}`),
    tests: (q: { controlId?: string; status?: "open" | "completed" | "all"; year?: number } = {}) => request<ControlTestDto[]>(`/assurance/tests?${qs(q)}`),
    test: (id: string) => request<ControlTestDto>(`/assurance/tests/${id}`),
    createTest: (data: ControlTestInput) => post<ControlTestDto>("/assurance/tests", data),
    updateTest: (id: string, data: Partial<ControlTestInput>) => patch<ControlTestDto>(`/assurance/tests/${id}`, data),
    deleteTest: (id: string) => del(`/assurance/tests/${id}`),
    completeTest: (id: string, data: CompleteTestInput) => post<ControlTestDto>(`/assurance/tests/${id}/complete`, data),
    reopenTest: (id: string) => post<ControlTestDto>(`/assurance/tests/${id}/reopen`),
    addSamples: (id: string, data: SampleInput | SampleInput[]) => post<ControlTestDto>(`/assurance/tests/${id}/samples`, data),
    updateSample: (id: string, sid: string, data: Partial<SampleInput>) => patch<ControlTestDto>(`/assurance/tests/${id}/samples/${sid}`, data),
    deleteSample: (id: string, sid: string) => request<ControlTestDto>(`/assurance/tests/${id}/samples/${sid}`, { method: "DELETE" }),
  },

  dashboard: () => request<DashboardDto>("/dashboard"),
  /** Technické karty Přehledu jedním dotazem (v1.102). */
  dashboardTech: () => request<DashboardTechDto>("/dashboard/tech"),

  calendar: {
    feeds: () => request<CalendarFeedDto[]>("/calendar/feeds"),
    createFeed: (d: CalendarFeedInput) => post<{ feed: CalendarFeedDto; url: string }>("/calendar/feeds", d),
    revokeFeed: (id: string) => del<{ ok: true }>(`/calendar/feeds/${id}`),
    list: (q: { from?: string; to?: string; legal?: "0" | "1" } = {}) => request<CalendarDto>(`/calendar?${qs(q)}`),
    icsUrl: (q: { from?: string; to?: string; legal?: "0" | "1" } = {}) => withCompany(`/api/calendar/contix-lhuty.ics?${qs(q)}`),
  },

  reports: {
    management: (q: { periodFrom?: string; periodTo?: string } = {}) => request<ManagementReport>(`/reports/management?${qs(q)}`),
    managementHtmlUrl: (q: { periodFrom?: string; periodTo?: string; charts?: string; chart?: string; months?: string } = {}) => withCompany(`/api/reports/management.html?${qs(q)}`),
    managementDocxUrl: (q: { periodFrom?: string; periodTo?: string; charts?: string; chart?: string; months?: string } = {}) => withCompany(`/api/reports/management.docx?${qs(q)}`),
  },

  ops: {
    status: () => request<SystemStatusDto>("/ops/status"),
    backups: () => request<BackupRunDto[]>("/ops/backups"),
    backupTest: () => request<BackupTestRequestDto>("/ops/backup-test"),
    requestBackupTest: () => post<BackupTestRequestDto>("/ops/backup-test", {}),
    cancelBackupTest: () => del<BackupTestRequestDto>("/ops/backup-test"),
    sbomUrl: "/api/ops/sbom",
  },

  setup: {
    get: () => request<SetupDto>("/setup"),
    wizard: () => request<SetupWizardDto>("/setup/wizard"),
    wizardFinish: () => post<SetupWizardDto>("/setup/wizard/finish"),
    wizardReopen: () => post<SetupWizardDto>("/setup/wizard/reopen"),
    docFolders: () => post<SetupDto>("/setup/doc-folders"),
    protocolUrl: (format: "html" | "docx") => withCompany(`/api/setup/protocol.${format}`),
  },

  help: {
    manualUrl: (format: "html" | "docx", audience: string[]) => `/api/help/manual.${format}?audience=${encodeURIComponent(audience.join(","))}`,
  },

  tags: {
    list: () => request<TagDto[]>("/tags"),
    create: (data: TagInput) => post<TagDto[]>("/tags", data),
    update: (id: string, data: TagInput) => request<TagDto[]>(`/tags/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: string) => request<TagDto[]>(`/tags/${id}`, { method: "DELETE" }),
    of: (type: TagEntity, id: string) => request<string[]>(`/tags/of/${type}/${id}`),
    set: (type: TagEntity, id: string, names: string[]) => request<string[]>(`/tags/of/${type}/${id}`, { method: "PUT", body: JSON.stringify({ names }) }),
    objects: (id: string) => request<TaggedObjectDto[]>(`/tags/${id}/objects`),
  },

  dataLocations: {
    list: () => request<DataLocationDto[]>("/data-locations"),
    create: (data: DataLocationInput) => post<DataLocationDto>("/data-locations", data),
    update: (id: string, data: DataLocationInput) => request<DataLocationDto>(`/data-locations/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: string) => del(`/data-locations/${id}`),
  },

  jira: {
    issues: (entityId: string) => request<ExternalIssueDto[]>(`/jira/issues?entityType=task&entityId=${entityId}`),
    create: (entityId: string) => post<ExternalIssueDto[]>("/jira/issues", { entityType: "task", entityId }),
  },

  /** Vzhled výstupů – logo, barva, zápatí (v1.59, ADR-154). */
  branding: {
    get: (companyId: string) => request<BrandingDto>(`/branding/${companyId}`),
    save: (companyId: string, d: BrandingInput) => request<BrandingDto>(`/branding/${companyId}`, { method: "PUT", body: JSON.stringify(d) }),
    remove: (companyId: string) => request<BrandingDto>(`/branding/${companyId}`, { method: "DELETE" }),
  },

  /** Bezpečnostní testy (v1.56, ADR-153). */
  secTests: {
    scopes: () => request<SecTestScopeDto[]>("/security-tests/scopes"),
    createScope: (d: SecTestScopeInput) => post<SecTestScopeDto>("/security-tests/scopes", d),
    updateScope: (id: string, d: SecTestScopeInput) => request<SecTestScopeDto>(`/security-tests/scopes/${id}`, { method: "PUT", body: JSON.stringify(d) }),
    approveScope: (id: string) => post<SecTestScopeDto>(`/security-tests/scopes/${id}/approve`),
    deleteScope: (id: string) => del(`/security-tests/scopes/${id}`),
    runs: () => request<SecTestRunDto[]>("/security-tests/runs"),
    run: (id: string) => request<SecTestRunDto & { outputs: { target: string; port: number | null; exitCode: number | null; durationMs: number; stdout: string; truncated: boolean; stderr: string }[]; findings: SecTestFindingDto[] }>(`/security-tests/runs/${id}`),
    createRun: (d: SecTestRunInput) => post<SecTestRunDto>("/security-tests/runs", d),
    cancelRun: (id: string) => post<SecTestRunDto>(`/security-tests/runs/${id}/cancel`),
    importOutput: (d: SecTestImportInput) => post<SecTestRunDto>("/security-tests/import", d),
    summary: (id: string) => post<SecTestRunDto>(`/security-tests/runs/${id}/summary`),
    findings: () => request<SecTestFindingDto[]>("/security-tests/findings"),
    setFinding: (id: string, status: SecTestFindingStatus, note?: string | null, until?: string | null) => request<SecTestFindingDto>(`/security-tests/findings/${id}`, { method: "PATCH", body: JSON.stringify({ status, note, until }) }),
    advice: (id: string) => post<SecTestFindingDto>(`/security-tests/findings/${id}/advice`),
    probes: () => request<ProbeConnectionDto[]>("/security-tests/probes"),
    overview: () => request<SecTestSummaryDto>("/security-tests/summary"),
    batches: () => request<SecTestBatchDto[]>("/security-tests/batches"),
    batch: (id: string) => request<SecTestBatchDto & { findings: SecTestFindingDto[] }>(`/security-tests/batches/${id}`),
    createBatch: (d: SecTestBatchInput) => post<SecTestBatchDto & { skipped: string[] }>("/security-tests/batches", d),
    batchSummary: (id: string) => post<SecTestBatchDto>(`/security-tests/batches/${id}/summary`),
    batchNext: (id: string, testIds: SecTestId[]) => post<SecTestBatchDto>(`/security-tests/batches/${id}/next`, { testIds }),
    assignFinding: (id: string, assetId: string | null, sameHost = true, rememberAddress = true) =>
      request<{ updated: number; remembered: boolean; finding: SecTestFindingDto }>(`/security-tests/findings/${id}/asset`, { method: "PATCH", body: JSON.stringify({ assetId, sameHost, rememberAddress }) }),
    followFinding: (id: string, testIds: SecTestId[]) => post<SecTestBatchDto>(`/security-tests/findings/${id}/follow`, { testIds }),
    byAsset: (assetId: string) => request<SecTestFindingDto[]>(`/security-tests/asset/${assetId}`),
    createTasks: (ids: string[]) => post<SecTestTasksResult>("/security-tests/findings/tasks", { ids }),
    setControl: (id: string, controlId: string | null) => request<SecTestFindingDto>(`/security-tests/findings/${id}/control`, { method: "PATCH", body: JSON.stringify({ controlId }) }),
    byControl: (controlId: string) => request<SecTestFindingDto[]>(`/security-tests/by-control/${controlId}`),
    schedules: () => request<SecTestScheduleDto[]>("/security-tests/schedules"),
    createSchedule: (d: SecTestScheduleInput) => post<SecTestScheduleDto>("/security-tests/schedules", d),
    updateSchedule: (id: string, d: SecTestScheduleInput) => put<SecTestScheduleDto>(`/security-tests/schedules/${id}`, d),
    deleteSchedule: (id: string) => del(`/security-tests/schedules/${id}`),
    runSchedule: (id: string) => post<SecTestScheduleDto>(`/security-tests/schedules/${id}/run`),
    reportUrl: (q: { batchIds?: string; from?: string; to?: string; all?: "1" }, fmt: "html" | "docx" = "html") => withCompany(`/api/security-tests/report.${fmt}?${qs(q)}`),
  },

  zones: {
    list: () => request<SecurityZoneDto[]>("/zones"),
    map: (location?: string | null) => request<ZoneMapDto>(`/zones/map${location ? `?location=${location}` : ""}`),
    defaults: () => post<{ created: number; moved: number; zones: SecurityZoneDto[] }>("/zones/defaults", {}),
    assign: () => post<{ moved: number; zones: SecurityZoneDto[] }>("/zones/assign", {}),
    create: (d: SecurityZoneInput) => post<{ id: string; moved: number; zones: SecurityZoneDto[] }>("/zones", d),
    update: (id: string, d: SecurityZoneInput) => put<{ moved: number; zones: SecurityZoneDto[] }>(`/zones/${id}`, d),
    remove: (id: string) => del<{ moved: number; zones: SecurityZoneDto[] }>(`/zones/${id}`),
    setAssetZone: (assetId: string, zoneId: string | null) => put<{ zoneId: string | null; zoneManual: boolean }>(`/zones/assets/${assetId}`, { zoneId }),
    suggestions: () => request<ZoneSuggestionDto[]>("/zones/suggestions"),
    applySuggestions: (items: { cidr: string; zoneId: string }[]) => post<{ added: number; moved: number; zones: SecurityZoneDto[] }>("/zones/suggestions/apply", { items }),
    setFlow: (d: ZoneFlowControlInput) => put<ZoneMapDto>("/zones/flows", d),
    clearFlow: (fromId: string, toId: string) => del<ZoneMapDto>(`/zones/flows/${fromId}/${toId}`),
  },
  personCerts: {
    list: (q: { state?: string; supplierId?: string; userId?: string; personId?: string; q?: string } = {}) =>
      request<PersonCertListDto>(`/person-certificates?${new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][])}`),
    holders: () => request<PersonCertHoldersDto>("/person-certificates/holders"),
    create: (d: PersonCertInput) => post<PersonCertDto>("/person-certificates", d),
    update: (id: string, d: PersonCertInput) => put<PersonCertDto>(`/person-certificates/${id}`, d),
    remove: (id: string) => del(`/person-certificates/${id}`),
    upload: (id: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<PersonCertDto>(`/person-certificates/${id}/file`, { method: "POST", body: fd });
    },
    fileUrl: (id: string) => withCompany(`/api/person-certificates/${id}/file`),
  },
  premises: {
    list: () => request<LocationsDto>("/premises"),
    get: (id: string) => request<LocationDetailDto>(`/premises/${id}`),
    create: (d: LocationInput) => post<LocationDetailDto>("/premises", d),
    update: (id: string, d: LocationPatch) => patch<LocationDetailDto>(`/premises/${id}`, d),
    place: (id: string, assetIds: string[]) => post<LocationDetailDto>(`/premises/${id}/assets`, { assetIds }),
    unplace: (id: string, assetId: string) => del<LocationDetailDto>(`/premises/${id}/assets/${assetId}`),
    setMaps: (id: string, mapIds: string[]) => put<LocationDetailDto>(`/premises/${id}/maps`, { mapIds }),
  },
  integrations: {
    /** Mapa propojení (v1.86): zóny, uzly, spojení, stavy a pokrytí serverů. */
    map: () => request<IntegrationMapDto>("/integrations/map"),
    patchMonitoringFinding: (id: string, d: { status: "accepted" | "open"; note?: string; until?: string | null }) => patch<{ ok: true }>(`/integrations/monitoring-findings/${id}`, d),
    wazuhAgents: (id: string) => request<WazuhAgentsDto>(`/integrations/wazuh/${id}/agents`),
    wazuhAgentsExportUrl: (id: string, format: "csv" | "xlsx") => withCompany(`/api/integrations/wazuh/${id}/agents.${format}`),
  },
  hosts: {
    list: () => request<HostSummaryDto[]>("/hosts"),
    byAsset: (assetId: string) => request<HostInventoryDto[]>(`/hosts/by-asset/${assetId}`),
    get: (id: string) => request<HostDetailDto>(`/hosts/${id}`),
    /** Založení (null) / spárování aktiva pro server bez aktiva (agenti CONTIX). */
    attachAsset: (id: string, assetId: string | null) => post<HostDetailDto>(`/hosts/${id}/asset`, { assetId }),
    attachUnpaired: () => post<{ linked: number; created: number; ambiguous: string[] }>(`/hosts/attach-unpaired`, {}),
    patchFinding: (id: string, data: HostFindingPatch) => patch<{ ok: true }>(`/hosts/findings/${id}`, data),
    findingTasks: (ids: string[]) => post<SecTestTasksResult>("/hosts/findings/tasks", { ids }),
  },
  /** Hromadné úpravy v seznamech (v1.75, ADR-168). */
  /** Ukázková data z Administrace (v1.81). */
  demo: {
    status: () => request<DemoStatusDto>("/demo"),
    create: () => post<DemoStatusDto>("/demo"),
    remove: () => del<DemoStatusDto>("/demo"),
  },
  bulk: {
    assets: (d: AssetBulkInput) => post<BulkResultDto>("/bulk/assets", d),
    risks: (d: RiskBulkInput) => post<BulkResultDto>("/bulk/risks", d),
    controls: (d: ControlBulkInput) => post<BulkResultDto>("/bulk/controls", d),
    processes: (d: ProcessBulkInput) => post<BulkResultDto>("/bulk/processes", d),
    suppliers: (d: SupplierBulkInput) => post<BulkResultDto>("/bulk/suppliers", d),
  },
  quality: {
    get: () => request<QualityDto>("/quality"),
    fix: (data: QualityFixInput) => post<{ updated: number }>("/quality/fix", data),
  },
  findings: {
    tasks: (keys: string[]) => post<{ created: number; existing: number; unassigned: number; skipped: number }>("/findings/tasks", { keys }),
    list: (q: FindingsQuery = {}) => request<UnifiedFindingsDto>(`/findings?${new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "") as [string, string][]).toString()}`),
    plan: () => request<FindingPlanViewDto | null>("/findings/plan"),
    generatePlan: () => post<FindingPlanViewDto>("/findings/plan"),
    planTasks: (steps: number[]) => post<{ created: number; skipped: number; taskIds: string[] }>("/findings/plan/tasks", { steps }),
    escalations: () => request<FindingEscalationDto[]>("/findings/escalations"),
    remediation: (q: RemediationQuery = {}) => request<FindingsRemediationDto>(`/findings/remediation?${new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "") as [string, string][]).toString()}`),
  },

  alerts: {
    list: (status: "new" | "accepted" | "dismissed" | "all" = "new") => request<AlertSuggestionDto[]>(`/alerts?status=${status}`),
    settings: () => request<{ alertsEnabled: boolean; alertMinLevel: number; alertsIndexPattern: string; lastSyncAt: string | null; lastResult: string | null; indexerConfigured: boolean; connections?: { id: string; name: string; lastSyncAt: string | null; lastResult: string | null }[] }>("/alerts/settings"),
    saveSettings: (data: AlertSettingsInput) => put<unknown>("/alerts/settings", data),
    sync: () => post<{ created: number; updated: number; alerts?: number }>("/alerts/sync"),
    accept: (id: string, kind: "unassessed" | "event" | "incident" = "unassessed") => post<{ incidentId: string }>(`/alerts/${id}/accept`, { kind }),
    dismiss: (id: string, reason: string) => post<{ ok: boolean }>(`/alerts/${id}/dismiss`, { reason }),
  },

  companies: {
    transfer: (data: TransferInput) => post<TransferResult>("/companies/transfer", data),
    list: () => request<CompanyDto[]>("/companies"),
    create: (data: CompanyInput) => post<CompanyDto>("/companies", data),
    update: (id: string, data: Partial<CompanyInput>) => patch<CompanyDto>(`/companies/${id}`, data),
    remove: (id: string) => del(`/companies/${id}`),
    overview: () => request<GroupOverviewRow[]>("/companies/overview"),
  },

  directory: { users: () => request<DirectoryUser[]>("/directory/users") },

  /** Projekty s fázemi a branami (v1.31, ADR-128). */
  projects: {
    templates: () => request<ProjectTemplateDto[]>("/projects/templates"),
    createTemplate: (data: ProjectTemplateInput) => post<{ id: string }>("/projects/templates", data),
    updateTemplate: (id: string, data: ProjectTemplateInput) => put<{ ok: boolean }>(`/projects/templates/${id}`, data),
    removeTemplate: (id: string) => del(`/projects/templates/${id}`),
    addCost: (id: string, data: ProjectCostInput) => post<ProjectDetailDto>(`/projects/${id}/costs`, data),
    removeCost: (id: string, costId: string) => request<ProjectDetailDto>(`/projects/${id}/costs/${costId}`, { method: "DELETE" }),
    links: (id: string) => request<CraLinksDto>(`/projects/${id}/links`),
    saveLinks: (id: string, data: CraLinksInput) => put<CraLinksDto>(`/projects/${id}/links`, data),
    list: () => request<ProjectDto[]>("/projects"),
    get: (id: string) => request<ProjectDetailDto>(`/projects/${id}`),
    create: (data: ProjectInput) => post<ProjectDetailDto>("/projects", data),
    update: (id: string, data: ProjectPatch) => patch<ProjectDetailDto>(`/projects/${id}`, data),
    phase: (id: string, phaseId: string, data: { plannedStart?: string | null; plannedEnd?: string | null }) => patch<ProjectDetailDto>(`/projects/${id}/phases/${phaseId}`, data),
    approveGate: (id: string, phaseId: string, comment?: string) => post<ProjectDetailDto>(`/projects/${id}/phases/${phaseId}/approve`, { comment }),
    addDoc: (id: string, phaseId: string, name: string, required: boolean) => post<ProjectDetailDto>(`/projects/${id}/phases/${phaseId}/docs`, { name, required }),
    updateDoc: (id: string, docId: string, data: { status?: string; note?: string | null; url?: string | null }) => patch<ProjectDetailDto>(`/projects/${id}/docs/${docId}`, data),
    removeDoc: (id: string, docId: string) => request<ProjectDetailDto>(`/projects/${id}/docs/${docId}`, { method: "DELETE" }),
    uploadDoc: (id: string, docId: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<ProjectDetailDto>(`/projects/${id}/docs/${docId}/file`, { method: "POST", body: fd });
    },
    docFileUrl: (id: string, docId: string) => withCompany(`/api/projects/${id}/docs/${docId}/file`),
    /* v1.35 */
    addMember: (id: string, data: ProjectMemberInput) => post<ProjectDetailDto>(`/projects/${id}/members`, data),
    removeMember: (id: string, mid: string) => request<ProjectDetailDto>(`/projects/${id}/members/${mid}`, { method: "DELETE" }),
    addTask: (id: string, data: ProjectTaskInput) => post<ProjectDetailDto>(`/projects/${id}/tasks`, data),
    updateTask: (id: string, tid: string, data: ProjectTaskPatch) => patch<ProjectDetailDto>(`/projects/${id}/tasks/${tid}`, data),
    removeTask: (id: string, tid: string) => request<ProjectDetailDto>(`/projects/${id}/tasks/${tid}`, { method: "DELETE" }),
    addMilestone: (id: string, data: MilestoneInput) => post<ProjectDetailDto>(`/projects/${id}/milestones`, data),
    updateMilestone: (id: string, mid: string, data: MilestoneInput) => put<ProjectDetailDto>(`/projects/${id}/milestones/${mid}`, data),
    removeMilestone: (id: string, mid: string) => request<ProjectDetailDto>(`/projects/${id}/milestones/${mid}`, { method: "DELETE" }),
    addIssue: (id: string, data: ProjectIssueInput) => post<ProjectDetailDto>(`/projects/${id}/issues`, data),
    updateIssue: (id: string, iid: string, data: ProjectIssueInput) => put<ProjectDetailDto>(`/projects/${id}/issues/${iid}`, data),
    removeIssue: (id: string, iid: string) => request<ProjectDetailDto>(`/projects/${id}/issues/${iid}`, { method: "DELETE" }),
    addReport: (id: string, data: StatusReportInput) => post<ProjectDetailDto>(`/projects/${id}/reports`, data),
    addChange: (id: string, data: ChangeRequestInput) => post<ProjectDetailDto>(`/projects/${id}/changes`, data),
    decideChange: (id: string, cid: string, decision: "approved" | "rejected", comment?: string) => post<ProjectDetailDto>(`/projects/${id}/changes/${cid}/decide`, { decision, comment }),
    addLesson: (id: string, kind: "went_well" | "improve", text: string) => post<ProjectDetailDto>(`/projects/${id}/lessons`, { kind, text }),
    removeLesson: (id: string, lid: string) => request<ProjectDetailDto>(`/projects/${id}/lessons/${lid}`, { method: "DELETE" }),
    reportUrl: (id: string, kind: "status" | "closure", format: "html" | "docx", lang = "cs") => withCompany(`/api/projects/${id}/report?kind=${kind}&format=${format}&lang=${lang}`),
  },

  discovery: {
    segments: () => request<{ segments: NetSegmentDto[]; scan: { enabled: boolean; allowedCidrs: string[]; nmap: boolean } }>("/discovery/segments"),
    createSegment: (data: NetSegmentInput) => post<NetSegmentDto>("/discovery/segments", data),
    updateSegment: (id: string, data: Partial<NetSegmentInput>) => patch<NetSegmentDto>(`/discovery/segments/${id}`, data),
    deleteSegment: (id: string) => del(`/discovery/segments/${id}`),
    runSegment: (id: string) => post<{ runId: string }>(`/discovery/segments/${id}/run`, {}),
    observations: (q: { segmentId?: string; status?: string } = {}) => request<NetObservationDto[]>(`/discovery/segments/observations?${qs(q)}`),
    approveObs: (id: string, note: string | null) => post<NetObservationDto>(`/discovery/segments/observations/${id}/approve`, { note }),
    resetObs: (id: string) => post<NetObservationDto>(`/discovery/segments/observations/${id}/reset`, {}),
    createAssetFromObs: (id: string, data: { name?: string; assetType?: string }) => post<NetObservationDto>(`/discovery/segments/observations/${id}/create-asset`, data),
    linkObs: (id: string, assetId: string) => post<NetObservationDto>(`/discovery/segments/observations/${id}/link`, { assetId }),
    connectors: () => request<ConnectorInfo[]>("/discovery/connectors"),
    runs: () => request<DiscoveryRunDto[]>("/discovery/runs"),
    wazuh: (connectionId?: string) => post<{ runId: string; runIds: string[] }>("/discovery/wazuh", connectionId ? { connectionId } : {}),
    netbox: () => post<{ runId: string; runIds: string[] }>("/discovery/netbox", {}),
    scan: (body: NetworkScanRequest) => post<{ runId: string }>("/discovery/network-scan", body),
    importCsv: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return request<DiscoveryRunDto>("/discovery/import/csv", { method: "POST", body: fd });
    },
  },

  admin: {
    users: () => request<UserDto[]>("/admin/users"),
    createUser: (data: UserCreate) => post<UserDto>("/admin/users", data),
    updateUser: (id: string, data: UserUpdate) => patch<UserDto>(`/admin/users/${id}`, data),
    responsibilities: (id: string) => request<UserResponsibilitiesDto>(`/admin/users/${id}/responsibilities`),
    handover: (id: string, data: UserHandoverInput) => post<{ moved: Record<string, number> }>(`/admin/users/${id}/handover`, data),
    resetPassword: (id: string, password: string) => post(`/admin/users/${id}/reset-password`, { password }),
    resetMfa: (id: string) => post(`/admin/users/${id}/reset-mfa`),
    unlock: (id: string) => post(`/admin/users/${id}/unlock`),
    roles: () => request<RoleDto[]>("/admin/roles"),
    createRole: (data: RoleInput) => post<RoleDto>("/admin/roles", data),
    updateRole: (id: string, data: Partial<RoleInput>) => patch<RoleDto>(`/admin/roles/${id}`, data),
    deleteRole: (id: string) => del(`/admin/roles/${id}`),
    groups: () => request<GroupDto[]>("/admin/groups"),
    createGroup: (data: GroupInput) => post<GroupDto>("/admin/groups", data),
    updateGroup: (id: string, data: Partial<GroupInput>) => patch<GroupDto>(`/admin/groups/${id}`, data),
    deleteGroup: (id: string) => del(`/admin/groups/${id}`),
    settings: () => request<AdminSettings>("/admin/settings"),
    updateSettings: (data: Partial<Settings>) => patch<Settings>("/admin/settings", data),
    connectors: () => request<ConnectorSettingsDto>("/admin/connectors"),
    connections: () => request<{ wazuh: WazuhConnectionDto[]; collectors: CollectorConnectionDto[]; concentrators: ConcentratorConnectionDto[]; probes: ProbeConnectionDto[]; netbox: NetboxConnectionDto[]; jira: JiraConnectionDto[] }>("/admin/connections"),
    createProbe: (data: ProbeConnectionInput) => post<{ id: string; token: string; probes: ProbeConnectionDto[] }>("/admin/connections/probe", data),
    updateProbe: (id: string, data: ProbeConnectionInput) => request<{ probes: ProbeConnectionDto[] }>(`/admin/connections/probe/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    rotateProbe: (id: string) => post<{ token: string; probes: ProbeConnectionDto[] }>(`/admin/connections/probe/${id}/token`),
    deleteProbe: (id: string) => request<{ probes: ProbeConnectionDto[] }>(`/admin/connections/probe/${id}`, { method: "DELETE" }),
    /** Instalátor sondy (v1.56): POST → install-contix-probe.sh. */
    probeInstaller: async (id: string, data: CollectorInstallerInput) => {
      const res = await fetch(`/api/admin/connections/probe/${id}/installer`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as any)?.error ?? `HTTP ${res.status}`, null);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = "install-contix-probe.sh";
      a.click();
      URL.revokeObjectURL(a.href);
    },
    saveNetbox: (id: string | null, data: NetboxConnectionInput) => (id ? request<unknown>(`/admin/connections/netbox/${id}`, { method: "PUT", body: JSON.stringify(data) }) : post<unknown>("/admin/connections/netbox", data)),
    testNetbox: (data: NetboxConnectionInput & { id?: string }) => post<ConnectorTestResult>("/admin/connections/netbox/test", data),
    saveJira: (id: string | null, data: JiraConnectionInput) => (id ? request<unknown>(`/admin/connections/jira/${id}`, { method: "PUT", body: JSON.stringify(data) }) : post<unknown>("/admin/connections/jira", data)),
    testJira: (data: JiraConnectionInput & { id?: string }) => post<ConnectorTestResult>("/admin/connections/jira/test", data),
    deleteConnectionOf: (kind: "netbox" | "jira", id: string) => request<unknown>(`/admin/connections/${kind}/${id}`, { method: "DELETE" }),
    createConcentrator: (data: ConcentratorConnectionInput) => post<{ id: string; code: string; codeExpiresAt: string; concentrators: ConcentratorConnectionDto[] }>("/admin/connections/concentrator", data),
    updateConcentrator: (id: string, data: ConcentratorConnectionInput) => request<{ concentrators: ConcentratorConnectionDto[] }>(`/admin/connections/concentrator/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    renewConcentratorCode: (id: string) => post<{ code: string; codeExpiresAt: string; concentrators: ConcentratorConnectionDto[] }>(`/admin/connections/concentrator/${id}/code`),
    deleteConcentrator: (id: string) => request<{ concentrators: ConcentratorConnectionDto[] }>(`/admin/connections/concentrator/${id}`, { method: "DELETE" }),
    agents: () => request<{ agents: AgentDto[] }>("/admin/connections/agents"),
    setAgentStatus: (id: string, status: "approved" | "blocked") => post<{ agents: AgentDto[]; concentrators: ConcentratorConnectionDto[] }>(`/admin/connections/agents/${id}/status`, { status }),
    createCollector: (data: CollectorConnectionInput) => post<{ id: string; token: string; collectors: CollectorConnectionDto[] }>("/admin/connections/collector", data),
    updateCollector: (id: string, data: CollectorConnectionInput) => request<{ collectors: CollectorConnectionDto[] }>(`/admin/connections/collector/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    rotateCollector: (id: string) => post<{ token: string; collectors: CollectorConnectionDto[] }>(`/admin/connections/collector/${id}/token`),
    deleteCollector: (id: string) => request<{ collectors: CollectorConnectionDto[] }>(`/admin/connections/collector/${id}`, { method: "DELETE" }),
    collectorScriptUrl: "/api/admin/connections/collector/script",
    /** Instalátor sběrače (v1.54): POST → soubor install-contix-collect.sh. */
    collectorInstaller: async (id: string, data: CollectorInstallerInput) => {
      const res = await fetch(`/api/admin/connections/collector/${id}/installer`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as any)?.error ?? `HTTP ${res.status}`, null);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await res.blob());
      a.download = "install-contix-collect.sh";
      a.click();
      URL.revokeObjectURL(a.href);
    },
    /** Kořenový certifikát interní CA Caddy (jen režim TLS internal); null = není k dispozici. */
    contixCa: async (): Promise<string | null> => {
      const res = await fetch("/.well-known/contix-ca.pem", { credentials: "omit" }).catch(() => null);
      const text = res?.ok ? (await res.text()).trim() : "";
      return /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(text) ? text : null;
    },
    createConnection: (data: WazuhConnectionInput) => post<{ id: string; wazuh: WazuhConnectionDto[] }>("/admin/connections/wazuh", data),
    updateConnection: (id: string, data: WazuhConnectionInput) => request<{ id: string; wazuh: WazuhConnectionDto[] }>(`/admin/connections/wazuh/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteConnection: (id: string) => request<{ wazuh: WazuhConnectionDto[] }>(`/admin/connections/wazuh/${id}`, { method: "DELETE" }),
    testConnection: (data: WazuhConnectionInput & { id?: string }) => post<ConnectorTestResult>("/admin/connections/wazuh/test", data),
    testConnectionIndexer: (data: WazuhConnectionInput & { id?: string }) => post<ConnectorTestResult>("/admin/connections/wazuh/indexer-test", data),
    saveWazuh: (data: WazuhSettingsInput) => request<ConnectorSettingsDto>("/admin/connectors/wazuh", { method: "PUT", body: JSON.stringify(data) }),
    testWazuh: (data: WazuhSettingsInput) => post<ConnectorTestResult>("/admin/connectors/wazuh/test", data),
    testIndexer: (data: WazuhSettingsInput) => post<ConnectorTestResult>("/admin/connectors/wazuh/indexer-test", data),
    saveScan: (data: ScanSettingsInput) =>
      request<ConnectorSettingsDto>("/admin/connectors/network-scan", { method: "PUT", body: JSON.stringify(data) }),
    testScan: (nmapPath: string) => post<ConnectorTestResult>("/admin/connectors/network-scan/test", { nmapPath }),
    auditLog: (q: { q?: string; limit?: number; offset?: number }) => request<AuditLogDto[]>(`/admin/audit-log?${qs(q)}`),
    /** Administrace → Přihlášení (ADR-078). */
    login: () => request<LoginAdminDto>("/admin/login"),
    createAdLogin: (data: AdLoginSourceInput) => post<AdLoginSourceDto>("/admin/login/ad", data),
    updateAdLogin: (id: string, data: AdLoginSourceInput) => put<AdLoginSourceDto>(`/admin/login/ad/${id}`, data),
    testAdLogin: (id: string, data: AdLoginTestInput) => post<AdLoginTestResult>(`/admin/login/ad/${id}/test`, data),
    createSso: (data: SsoProviderInput) => post<SsoProviderDto>("/admin/login/sso", data),
    updateSso: (id: string, data: SsoProviderInput) => put<SsoProviderDto>(`/admin/login/sso/${id}`, data),
    deleteSso: (id: string) => del(`/admin/login/sso/${id}`),
  },
};
