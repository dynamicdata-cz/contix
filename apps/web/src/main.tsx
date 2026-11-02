import { OverlayHost } from "@/components/ui/overlay";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RouteComponent, createRootRoute, createRoute, createRouter, lazyRouteComponent, Navigate, Outlet, RouterProvider, useRouterState } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Layout } from "./components/Layout";
import { setUnauthorizedHandler } from "./lib/api";
import { MeProvider, useMeQuery } from "./lib/auth";
import { AuditPortalPage } from "./components/auditRequests";
import { CycleDetailPage, CyclesPage } from "./pages/Cycles";
import { AssetFormPage } from "./pages/AssetForm";
import { ForcedMfaSetupScreen, ForcedPasswordChangeScreen, LoginScreen, MfaVerifyScreen } from "./pages/auth/AuthScreens";
import { SupplierReportPage } from "./components/supplierReports";
import type { FrameworkId, MeDto } from "@contix/shared";
import { I18nProvider, initialLocale, useT } from "./lib/i18n";
import "@fontsource-variable/inter";
import "./styles.css";
import { applyMode, applyTheme, getTheme } from "./lib/theme";

function PagePending() {
  return (
    <div className="space-y-4 pt-2" aria-busy="true">
      <div className="skeleton h-8 w-64" />
      <div className="skeleton h-4 w-96 max-w-full" />
      <div className="skeleton h-48 w-full" />
    </div>
  );
}

/* stránky se načítají po částech až při otevření (v1.09, ADR-105) */
const KnowledgeArticlePage = lazyRouteComponent(() => import("@/pages/Knowledge"), "KnowledgeArticlePage");
const PositionPage = lazyRouteComponent(() => import("@/pages/Position"), "PositionPage");
const KnowledgePage = lazyRouteComponent(() => import("@/pages/Knowledge"), "KnowledgePage");
const AdminLayout = lazyRouteComponent(() => import("./pages/admin/AdminLayout"), "AdminLayout");
const AdminAuditPage = lazyRouteComponent(() => import("./pages/admin/Audit"), "AdminAuditPage");
const AdminConnectorsPage = lazyRouteComponent(() => import("./pages/admin/Connectors"), "AdminConnectorsPage");
const AdminGroupsPage = lazyRouteComponent(() => import("./pages/admin/Groups"), "AdminGroupsPage");
const AdminRolesPage = lazyRouteComponent(() => import("./pages/admin/Roles"), "AdminRolesPage");
const AdminSettingsPage = lazyRouteComponent(() => import("./pages/admin/Settings"), "AdminSettingsPage");
const DoraPage = lazyRouteComponent(() => import("./pages/Dora"), "DoraPage");
const InfoServicePage = lazyRouteComponent(() => import("./pages/InfoService"), "InfoServicePage");
const CertificatesPage = lazyRouteComponent(() => import("./pages/Certificates"), "CertificatesPage");
const AdminCompaniesPage = lazyRouteComponent(() => import("./pages/admin/Companies"), "AdminCompaniesPage");
const AdminLoginPage = lazyRouteComponent(() => import("./pages/admin/Login"), "AdminLoginPage");
const FrameworkLibraryPage = lazyRouteComponent(() => import("./pages/FrameworkLibrary"), "FrameworkLibraryPage");
const AdminMethodologiesPage = lazyRouteComponent(() => import("./pages/admin/Methodologies"), "AdminMethodologiesPage");
const MethodologyEditorPage = lazyRouteComponent(() => import("./pages/admin/MethodologyEditor"), "MethodologyEditorPage");
const AdminNotificationsPage = lazyRouteComponent(() => import("./pages/admin/Notifications"), "AdminNotificationsPage");
const AdminAiPage = lazyRouteComponent(() => import("./pages/admin/Ai"), "AdminAiPage");
const AssurancePage = lazyRouteComponent(() => import("./pages/Assurance"), "AssurancePage");
const ManagementPage = lazyRouteComponent(() => import("./pages/Management"), "ManagementPage");
const AskPage = lazyRouteComponent(() => import("./pages/Ask"), "AskPage");
const DocDetailPage = lazyRouteComponent(() => import("./pages/Docs"), "DocDetailPage");
const DocsPage = lazyRouteComponent(() => import("./pages/Docs"), "DocsPage");
const ImportPage = lazyRouteComponent(() => import("./pages/Import"), "ImportPage");
const AssetDuplicatesPage = lazyRouteComponent(() => import("./pages/AssetDuplicates"), "AssetDuplicatesPage");
const GdprDetailPage = lazyRouteComponent(() => import("./pages/Gdpr"), "GdprDetailPage");
const GdprNewPage = lazyRouteComponent(() => import("./pages/Gdpr"), "GdprNewPage");
const GdprPage = lazyRouteComponent(() => import("./pages/Gdpr"), "GdprPage");
const AiActDetailPage = lazyRouteComponent(() => import("./pages/AiAct"), "AiActDetailPage");
const AiActNewPage = lazyRouteComponent(() => import("./pages/AiAct"), "AiActNewPage");
const AiActPage = lazyRouteComponent(() => import("./pages/AiAct"), "AiActPage");
const Soc2DetailPage = lazyRouteComponent(() => import("./pages/Soc2"), "Soc2DetailPage");
const Soc2Page = lazyRouteComponent(() => import("./pages/Soc2"), "Soc2Page");
const CraNewPage = lazyRouteComponent(() => import("./pages/Cra"), "CraNewPage");
const CraPage = lazyRouteComponent(() => import("./pages/Cra"), "CraPage");
const CraProductPage = lazyRouteComponent(() => import("./pages/Cra"), "CraProductPage");
const ControlTestPage = lazyRouteComponent(() => import("./pages/ControlTest"), "ControlTestPage");
const EvidenceDetailPage = lazyRouteComponent(() => import("./pages/EvidenceDetail"), "EvidenceDetailPage");
const AdminOpsPage = lazyRouteComponent(() => import("./pages/admin/Ops"), "AdminOpsPage");
const MyPage = lazyRouteComponent(() => import("./pages/My"), "MyPage");
const RiskQuantPage = lazyRouteComponent(() => import("./pages/RiskQuant"), "RiskQuantPage");
const RiskScenariosPage = lazyRouteComponent(() => import("./pages/RiskScenarios"), "RiskScenariosPage");
const RiskAppetitePage = lazyRouteComponent(() => import("./pages/RiskAppetite"), "RiskAppetitePage");
const PoliciesPage = lazyRouteComponent(() => import("./pages/Policies"), "PoliciesPage");
const PolicyDetailPage = lazyRouteComponent(() => import("./pages/Policies"), "PolicyDetailPage");
const PolicyNewPage = lazyRouteComponent(() => import("./pages/Policies"), "PolicyNewPage");
const LegalActPage = lazyRouteComponent(() => import("./pages/Legislation"), "LegalActPage");
const LegalReviewPage = lazyRouteComponent(() => import("./pages/Legislation"), "LegalReviewPage");
const LegislationPage = lazyRouteComponent(() => import("./pages/Legislation"), "LegislationPage");
const AwarenessPage = lazyRouteComponent(() => import("./pages/Awareness"), "AwarenessPage");
const CourseDetailPage = lazyRouteComponent(() => import("./pages/Awareness"), "CourseDetailPage");
const CourseNewPage = lazyRouteComponent(() => import("./pages/Awareness"), "CourseNewPage");
const GroupPage = lazyRouteComponent(() => import("./pages/Group"), "GroupPage");
const IdentityPage = lazyRouteComponent(() => import("./pages/Identity"), "IdentityPage");
const AccessReviewPage = lazyRouteComponent(() => import("./pages/IdentityGovernance"), "AccessReviewPage");
const AdminUsersPage = lazyRouteComponent(() => import("./pages/admin/Users"), "AdminUsersPage");
const AdminSetupPage = lazyRouteComponent(() => import("./pages/admin/Setup"), "AdminSetupPage");
const AssetDetailPage = lazyRouteComponent(() => import("./pages/AssetDetail"), "AssetDetailPage");
const AssetsPage = lazyRouteComponent(() => import("./pages/Assets"), "AssetsPage");
const Dashboard = lazyRouteComponent(() => import("./pages/Dashboard"), "Dashboard");
const DiscoveryPage = lazyRouteComponent(() => import("./pages/Discovery"), "DiscoveryPage");
const OrganizationPage = lazyRouteComponent(() => import("./pages/Organization"), "OrganizationPage");
const ProcessDetailPage = lazyRouteComponent(() => import("./pages/ProcessDetail"), "ProcessDetailPage");
const ProcessesPage = lazyRouteComponent(() => import("./pages/Processes"), "ProcessesPage");
const ProfilePage = lazyRouteComponent(() => import("./pages/Profile"), "ProfilePage");
const RiskCatalogPage = lazyRouteComponent(() => import("./pages/RiskCatalog"), "RiskCatalogPage");
const RiskDetailPage = lazyRouteComponent(() => import("./pages/RiskDetail"), "RiskDetailPage");
const RiskNewPage = lazyRouteComponent(() => import("./pages/RiskDetail"), "RiskNewPage");
const RisksPage = lazyRouteComponent(() => import("./pages/Risks"), "RisksPage");
const RiskPlanPage = lazyRouteComponent(() => import("./pages/RiskPlan"), "RiskPlanPage");
const ControlsPage = lazyRouteComponent(() => import("./pages/Controls"), "ControlsPage");
const ControlDetailPage = lazyRouteComponent(() => import("./pages/ControlDetail"), "ControlDetailPage");
const ControlNewPage = lazyRouteComponent(() => import("./pages/ControlDetail"), "ControlNewPage");
const SoaPage = lazyRouteComponent(() => import("./pages/Soa"), "SoaPage");
const CoveragePage = lazyRouteComponent(() => import("./pages/Coverage"), "CoveragePage");
const ExceptionsPage = lazyRouteComponent(() => import("./pages/Exceptions"), "ExceptionsPage");
const BiaDetailPage = lazyRouteComponent(() => import("./pages/Bia"), "BiaDetailPage");
const BiaListPage = lazyRouteComponent(() => import("./pages/Bia"), "BiaListPage");
const PlanDetailPage = lazyRouteComponent(() => import("./pages/Plans"), "PlanDetailPage");
const PlanNewPage = lazyRouteComponent(() => import("./pages/Plans"), "PlanNewPage");
const PlansPage = lazyRouteComponent(() => import("./pages/Plans"), "PlansPage");
const ChangeDetailPage = lazyRouteComponent(() => import("./pages/Isms"), "ChangeDetailPage");
const ChangeNewPage = lazyRouteComponent(() => import("./pages/Isms"), "ChangeNewPage");
const ChangesPage = lazyRouteComponent(() => import("./pages/Isms"), "ChangesPage");
const IsmsReviewPage = lazyRouteComponent(() => import("./pages/Isms"), "IsmsReviewPage");
const IncidentDetailPage = lazyRouteComponent(() => import("./pages/Incidents"), "IncidentDetailPage");
const IncidentReportPage = lazyRouteComponent(() => import("./pages/Incidents"), "IncidentReportPage");
const IncidentsPage = lazyRouteComponent(() => import("./pages/Incidents"), "IncidentsPage");
const AuditDetailPage = lazyRouteComponent(() => import("./pages/Audits"), "AuditDetailPage");
const AuditNewPage = lazyRouteComponent(() => import("./pages/Audits"), "AuditNewPage");
const AuditsPage = lazyRouteComponent(() => import("./pages/Audits"), "AuditsPage");
const SupplierDetailPage = lazyRouteComponent(() => import("./pages/Suppliers"), "SupplierDetailPage");
const SupplierNewPage = lazyRouteComponent(() => import("./pages/Suppliers"), "SupplierNewPage");
const SuppliersPage = lazyRouteComponent(() => import("./pages/Suppliers"), "SuppliersPage");
const PublicQuestionnairePage = lazyRouteComponent(() => import("./pages/PublicQuestionnaire"), "PublicQuestionnairePage");
const PublicTrustPage = lazyRouteComponent(() => import("./pages/PublicTrust"), "PublicTrustPage");
const CustomerQuestionnairePage = lazyRouteComponent(() => import("./pages/Trust"), "CustomerQuestionnairePage");
const TrustPage = lazyRouteComponent(() => import("./pages/Trust"), "TrustPage");
const ActionsPage = lazyRouteComponent(() => import("./pages/Actions"), "ActionsPage");
const SocPage = lazyRouteComponent(() => import("./pages/Soc"), "SocPage");
const SocAlertPage = lazyRouteComponent(() => import("./pages/SocAlert"), "SocAlertPage");
const PhishingReportPage = lazyRouteComponent(() => import("./pages/Phishing"), "PhishingReportPage");
const SocCasePage = lazyRouteComponent(() => import("./pages/SocCase"), "SocCasePage");
const SocHostPage = lazyRouteComponent(() => import("./pages/SocHost"), "SocHostPage");
const AssetGraphPage = lazyRouteComponent(() => import("./pages/AssetGraph"), "AssetGraphPage");
const ResiliencePage = lazyRouteComponent(() => import("./pages/Resilience"), "ResiliencePage");
const ExerciseDetailPage = lazyRouteComponent(() => import("./pages/Exercises"), "ExerciseDetailPage");
const ExercisesPage = lazyRouteComponent(() => import("./pages/Exercises"), "ExercisesPage");
const ScaPage = lazyRouteComponent(() => import("./pages/Sca"), "ScaPage");
const MonitoringPage = lazyRouteComponent(() => import("./pages/Monitoring"), "MonitoringPage");
const AdminLanguagesPage = lazyRouteComponent(() => import("./pages/admin/Languages"), "AdminLanguagesPage");
const VulnerabilitiesPage = lazyRouteComponent(() => import("./pages/Vulnerabilities"), "VulnerabilitiesPage");
const VulnCvePage = lazyRouteComponent(() => import("./pages/VulnCve"), "VulnCvePage");

applyTheme(getTheme());
applyMode();

/** Veřejné stránky (dotazník pro dodavatele /q/…) jsou mimo přihlášení i jazyk uživatele. */
function RootGate() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return path.startsWith("/q/") || path.startsWith("/t/") ? <Outlet /> : <AuthGate />;
}

/** Rozhoduje, co uživatel uvidí: přihlášení → MFA → změna hesla → aplikace. */
function AuthGate() {
  const { data: me, isLoading, error } = useMeQuery();
  return (
    <I18nProvider locale={me?.locale ?? initialLocale()}>
      <AuthGateInner me={me} isLoading={isLoading} error={error} />
    </I18nProvider>
  );
}
function AuthGateInner({ me, isLoading, error }: { me: MeDto | null | undefined; isLoading: boolean; error: unknown }) {
  const t = useT();
  if (isLoading) return <div className="grid h-full place-items-center text-sm text-slate-500">{t("common.loading")}</div>;
  if (error) return <div className="grid h-full place-items-center text-sm text-red-600">{t("app.apiUnavailable", { error: String(error) })}</div>;
  if (!me) return <LoginScreen />;
  if (me.mfaPending) return <MfaVerifyScreen />;
  if (me.mustChangePassword) return <ForcedPasswordChangeScreen />;
  if (me.mfaSetupRequired) return <ForcedMfaSetupScreen />;
  return (
    <MeProvider me={me}>
      <Outlet />
      <OverlayHost />
    </MeProvider>
  );
}

const root = createRootRoute({ component: RootGate });
const publicQuestionnaire = createRoute({ getParentRoute: () => root, path: "/q/$token", component: PublicQuestionnairePage });
const publicTrust = createRoute({ getParentRoute: () => root, path: "/t/$slug", component: PublicTrustPage });
const app = createRoute({ getParentRoute: () => root, id: "app", component: Layout });
const r = <P extends string>(path: P, component: RouteComponent) => createRoute({ getParentRoute: () => app, path, component });

const riskNew = createRoute({
  getParentRoute: () => app,
  path: "/risks/new",
  component: RiskNewPage,
  validateSearch: (s: Record<string, unknown>): { processId?: string; assetId?: string } => ({
    processId: typeof s.processId === "string" ? s.processId : undefined,
    assetId: typeof s.assetId === "string" ? s.assetId : undefined,
  }),
});

const soa = createRoute({
  getParentRoute: () => app,
  path: "/controls/soa",
  component: SoaPage,
  validateSearch: (s: Record<string, unknown>): { framework?: FrameworkId; section?: string } => ({
    framework: typeof s.framework === "string" ? (s.framework as FrameworkId) : undefined,
    section: typeof s.section === "string" ? s.section : undefined,
  }),
});

const coverage = createRoute({
  getParentRoute: () => app,
  path: "/controls/coverage",
  component: CoveragePage,
  validateSearch: (s: Record<string, unknown>): { framework?: FrameworkId; snapshot?: string } => ({
    framework: typeof s.framework === "string" ? (s.framework as FrameworkId) : undefined,
    snapshot: typeof s.snapshot === "string" ? s.snapshot : undefined,
  }),
});

const planNew = createRoute({
  getParentRoute: () => app,
  path: "/continuity/plans/new",
  component: PlanNewPage,
  validateSearch: (s: Record<string, unknown>): { processId?: string } => ({ processId: typeof s.processId === "string" ? s.processId : undefined }),
});

const actions = createRoute({
  getParentRoute: () => app,
  path: "/actions",
  component: ActionsPage,
  validateSearch: (s: Record<string, unknown>): { task?: string } => ({ task: typeof s.task === "string" ? s.task : undefined }),
});
const admin = createRoute({ getParentRoute: () => app, path: "/admin", component: AdminLayout });
const a = <P extends string>(path: P, component: RouteComponent) => createRoute({ getParentRoute: () => admin, path, component });

const methodologyEdit = createRoute({
  getParentRoute: () => admin,
  path: "/methodologies/edit",
  component: MethodologyEditorPage,
  validateSearch: (s: Record<string, unknown>): { from?: string; kind?: "risk" | "audit" } => ({
    from: typeof s.from === "string" ? s.from : undefined,
    kind: s.kind === "audit" || s.kind === "risk" ? s.kind : undefined,
  }),
});

const routeTree = root.addChildren([
  publicQuestionnaire,
  publicTrust,
  app.addChildren([
    r("/", Dashboard),
    r("/login", () => <Navigate to="/" />),
    r("/assets", AssetsPage),
    r("/assets/new", () => <AssetFormPage mode="create" />),
    r("/assets/duplicates", AssetDuplicatesPage),
    r("/assets/graph", AssetGraphPage),
    r("/assets/resilience", ResiliencePage),
    r("/assets/certificates", CertificatesPage),
    r("/audit-portal", AuditPortalPage),
    r("/controls/sca", ScaPage),
    r("/controls/monitoring", MonitoringPage),
    r("/assets/$assetId", AssetDetailPage),
    r("/assets/$assetId/edit", () => <AssetFormPage mode="edit" />),
    r("/discovery", DiscoveryPage),
    r("/vulnerabilities", VulnerabilitiesPage),
    r("/vulnerabilities/cve/$cveId", VulnCvePage),
    r("/organization", OrganizationPage),
    r("/organization/positions/$positionId", PositionPage),
    r("/processes", ProcessesPage),
    r("/processes/$processId", ProcessDetailPage),
    r("/risks", RisksPage),
    r("/risks/catalog", RiskCatalogPage),
    r("/risks/plan", RiskPlanPage),
    r("/risks/quant", RiskQuantPage),
    r("/risks/scenarios", RiskScenariosPage),
    r("/risks/appetite", RiskAppetitePage),
    r("/risks/cycles", () => <CyclesPage kind="risk" />),
    r("/bia/cycles", () => <CyclesPage kind="bia" />),
    r("/cycles/$cycleId", CycleDetailPage),
    r("/controls", ControlsPage),
    soa,
    coverage,
    r("/controls/new", ControlNewPage),
    r("/controls/assurance", AssurancePage),
    r("/controls/library", FrameworkLibraryPage),
    r("/controls/tests/$testId", ControlTestPage),
    r("/controls/evidence/$evidenceId", EvidenceDetailPage),
    r("/controls/$controlId", ControlDetailPage),
    r("/bia", BiaListPage),
    r("/bia/$biaId", BiaDetailPage),
    r("/continuity/plans", PlansPage),
    r("/continuity/exercises", ExercisesPage),
    r("/continuity/exercises/$exerciseId", ExerciseDetailPage),
    planNew,
    r("/continuity/plans/$planId", PlanDetailPage),
    actions,
    r("/isms", IsmsReviewPage),
    r("/isms/changes", ChangesPage),
    r("/isms/changes/new", ChangeNewPage),
    r("/isms/changes/$changeId", ChangeDetailPage),
    r("/incidents", IncidentsPage),
    r("/incidents/report", IncidentReportPage),
    r("/phishing", PhishingReportPage),
    r("/incidents/$incidentId", IncidentDetailPage),
    r("/audits", AuditsPage),
    r("/audits/new", AuditNewPage),
    r("/audits/$auditId", AuditDetailPage),
    r("/suppliers", SuppliersPage),
    r("/suppliers/dora", DoraPage),
    r("/suppliers/new", SupplierNewPage),
    r("/suppliers/reports/$reportId", SupplierReportPage),
    r("/trust", TrustPage),
    r("/trust/questionnaires/$qid", CustomerQuestionnairePage),
    r("/suppliers/$supplierId", SupplierDetailPage),
    riskNew,
    r("/risks/$riskId", RiskDetailPage),
    r("/profile", ProfilePage),
    r("/my", MyPage),
    r("/policies", PoliciesPage),
    r("/policies/new", PolicyNewPage),
    r("/policies/$policyId", PolicyDetailPage),
    r("/legislation", LegislationPage),
    r("/infoservice", InfoServicePage),
    r("/legislation/acts/$actId", LegalActPage),
    r("/legislation/reviews/$reviewId", LegalReviewPage),
    r("/awareness", AwarenessPage),
    r("/awareness/new", CourseNewPage),
    r("/awareness/$courseId", CourseDetailPage),
    r("/group", GroupPage),
    r("/management", ManagementPage),
    r("/ask", AskPage),
    r("/docs", DocsPage),
    r("/docs/$docId", DocDetailPage),
    r("/knowledge", KnowledgePage),
    r("/knowledge/$articleId", KnowledgeArticlePage),
    r("/import", ImportPage),
    r("/gdpr", GdprPage),
    r("/aiact", AiActPage),
    r("/soc2", Soc2Page),
    r("/cra", CraPage),
    r("/cra/new", CraNewPage),
    r("/cra/$productId", CraProductPage),
    r("/soc2/$engagementId", Soc2DetailPage),
    r("/identity", IdentityPage),
    r("/exceptions", ExceptionsPage),
    r("/soc", SocPage),
    r("/soc/cases/$caseId", SocCasePage),
    r("/soc/hosts/$hostKey", SocHostPage),
    r("/soc/$alertId", SocAlertPage),
    r("/identity/reviews/$reviewId", AccessReviewPage),
    r("/gdpr/new", GdprNewPage),
    r("/gdpr/$activityId", GdprDetailPage),
    r("/aiact/new", AiActNewPage),
    r("/aiact/$systemId", AiActDetailPage),
    admin.addChildren([
      a("/", () => <Navigate to="/admin/users" />),
      a("/setup", AdminSetupPage),
      a("/users", AdminUsersPage),
      a("/groups", AdminGroupsPage),
      a("/roles", AdminRolesPage),
      a("/settings", AdminSettingsPage),
      a("/companies", AdminCompaniesPage),
      a("/login", AdminLoginPage),
      a("/methodologies", AdminMethodologiesPage),
      methodologyEdit,
      a("/notifications", AdminNotificationsPage),
      a("/audit", AdminAuditPage),
      a("/connectors", AdminConnectorsPage),
      a("/ai", AdminAiPage),
      a("/ops", AdminOpsPage),
      a("/languages", AdminLanguagesPage),
    ]),
  ]),
]);

const router = createRouter({ routeTree, defaultPreload: "intent", defaultPendingComponent: PagePending, defaultPendingMs: 150 });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache(),
  defaultOptions: { queries: { staleTime: 10_000, retry: (n, e: any) => e?.status !== 401 && e?.status !== 403 && n < 1 } },
});
// Vypršelá relace → znovu načíst /me → zobrazí se přihlášení
setUnauthorizedHandler(() => queryClient.invalidateQueries({ queryKey: ["me"] }));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
