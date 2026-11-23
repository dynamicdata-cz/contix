import { integrationRoutes } from "./modules/integrations/routes";
import { zoneRoutes } from "./modules/zones/routes";
import { positionRoutes } from "./modules/org/positions";
import { knowledgeRoutes } from "./modules/knowledge/routes";
import { quickSearchRoutes } from "./modules/search/quick";
import { linkRoutes } from "./modules/links/routes";
import { i18nPublicRoutes, i18nRoutes } from "./modules/i18n/routes";
import { tFor } from "./modules/i18n/service";
import { ApiError } from "./lib/apiError";
import { davRoutes } from "./modules/policies/webdav";
import { setupRoutes } from "./modules/setup/routes";
import { helpRoutes } from "./modules/help/routes";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { requireAuth, sessionMiddleware } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import { loginAdminRoutes } from "./modules/admin/login";
import type { AdAuthenticator } from "./modules/identity/ad";
import type { AppEnv } from "./auth/service";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { adminRoutes, directoryRoutes } from "./modules/admin/routes";
import { userHandoverRoutes } from "./modules/admin/handover";
import { findingRoutes } from "./modules/findings/routes";
import { bulkRoutes } from "./modules/bulk/routes";
import { qualityRoutes } from "./modules/quality/routes";
import { assetRoutes } from "./modules/assets/routes";
import { assetGraphRoutes } from "./modules/assets/graph";
import { siteMapRoutes, type MapImageConverter } from "./modules/assets/maps";
import { accessRoutes } from "./modules/access/routes";
import { accessReviewRoutes } from "./modules/access/review";
import { accessReconcileRoutes } from "./modules/access/reconcile";
import { accessAdGroupRoutes } from "./modules/access/adgroups";
import { accessIdmRoutes } from "./modules/access/idm";
import { projectRoutes } from "./modules/projects/routes";
import { accessProvisioningRoutes, type AdWriterFactory } from "./modules/access/provisioning";
import { scaRoutes } from "./modules/sca/routes";
import { connectorAdminRoutes } from "./modules/connectors/routes";
import { connectionAdminRoutes } from "./modules/connections/routes";
import { hostRoutes, publicHostRoutes } from "./modules/collector/routes";
import { publicAgentRoutes } from "./modules/agents/routes";
import { tagRoutes } from "./modules/tags/routes";
import { issueRoutes } from "./modules/connections/issues";
import { locationRoutes } from "./modules/locations/routes";
import { publicProbeRoutes, secTestRoutes } from "./modules/sectests/routes";
import { discoveryRoutes } from "./modules/discovery/routes";
import { orgRoutes } from "./modules/org/routes";
import { processRoutes } from "./modules/processes/routes";
import { riskRoutes } from "./modules/risks/routes";
import { scenarioRoutes } from "./modules/risks/scenarios";
import { modelingRoutes } from "./modules/risks/modeling";
import { appetiteRoutes } from "./modules/risks/appetite";
import { controlRoutes } from "./modules/controls/routes";
import { monitorRoutes } from "./modules/controls/monitors";
import { coverageRoutes } from "./modules/coverage/routes";
import { exceptionRoutes } from "./modules/exceptions/routes";
import { continuityRoutes } from "./modules/continuity/routes";
import { planRoutes } from "./modules/continuity/plans";
import { exerciseRoutes } from "./modules/continuity/exercises";
import { documentRoutes } from "./modules/documents/routes";
import { supplierRoutes } from "./modules/suppliers/routes";
import { netSegmentRoutes, type NetScanDeps } from "./modules/discovery/segments";
import { auditRequestRoutes } from "./modules/audits/requests";
import { certificateRoutes, type TlsDeps } from "./modules/assets/certificates";
import { doraRoutes } from "./modules/suppliers/dora";
import { aresRoutes, type AresFetch } from "./modules/ares/routes";
import { trendRoutes } from "./modules/trends/routes";
import { actionRoutes } from "./modules/actions/routes";
import { recordSearchRoutes } from "./modules/search/routes";
import { socRoutes } from "./modules/soc/routes";
import { socCaseRoutes } from "./modules/soc/cases";
import { publicSocIngestRoutes, socSourceRoutes } from "./modules/soc/sources";
import { publicSocFeedRoutes, socIocRoutes } from "./modules/soc/iocs";
import { socResponseRoutes } from "./modules/soc/response";
import { threatIntelRoutes } from "./modules/soc/threatIntel";
import { enrichRoutes } from "./modules/soc/enrich";
import { savedViewRoutes } from "./modules/views/routes";
import { socHuntRoutes } from "./modules/soc/hunts";
import { socTuningRoutes } from "./modules/soc/tuning";
import { socPlaybookRoutes } from "./modules/soc/playbooks";
import { socHostRoutes } from "./modules/soc/hosts";
import { publicQuestionnaireRoutes, questionnaireRoutes } from "./modules/suppliers/questionnaires";
import { supplierReportRoutes } from "./modules/suppliers/reports";
import { answerLibraryRoutes, trustQuestionnaireRoutes } from "./modules/trust/questionnaires";
import { publicTrustRoutes, trustCenterRoutes } from "./modules/trust/center";
import { ismsRoutes } from "./modules/isms/routes";
import { incidentRoutes } from "./modules/incidents/routes";
import { auditRoutes } from "./modules/audits/routes";
import { companyRoutes } from "./modules/companies/routes";
import { brandingRoutes } from "./modules/branding/routes";
import { regulationRoutes } from "./modules/regulation/routes";
import { brandLoader } from "./modules/branding/service";
import { methodologyLoader, methodologyRoutes } from "./modules/methodologies/routes";
import { frameworkLoader, frameworkRoutes } from "./modules/frameworks/routes";
import { policyRoutes } from "./modules/policies/routes";
import { awarenessRoutes } from "./modules/awareness/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { cycleRoutes } from "./modules/cycles/routes";
import { alertRoutes } from "./modules/alerts/routes";
import { aiRoutes } from "./modules/ai/routes";
import { assuranceRoutes } from "./modules/assurance/routes";
import { reportRoutes } from "./modules/reports/routes";
import { dashboardRoutes } from "./modules/dashboard/routes";
import { guideRoutes } from "./modules/guides/routes";
import { identityRoutes } from "./modules/identity/routes";
import { legislationRoutes } from "./modules/legislation/routes";
import { infoServiceRoutes } from "./modules/infoservice/routes";
import { gdprRoutes } from "./modules/gdpr/routes";
import { aiActRoutes } from "./modules/aiact/routes";
import { soc2Routes } from "./modules/soc2/routes";
import { craRoutes } from "./modules/cra/routes";
import { mcpRoutes, tokenRoutes } from "./modules/mcp/routes";
import { publicVulnScanRoutes } from "./modules/vulnerabilities/ci";
import { publicMonitorRoutes } from "./modules/controls/monitors";
import { defectDojoRoutes } from "./modules/vulnerabilities/defectdojo";
import { importRoutes } from "./modules/import/routes";
import { demoRoutes } from "./modules/demo/routes";
import { metricsAuthorized, metricsText, opsRoutes } from "./modules/ops/routes";
import { CONTIX_LICENSE, CONTIX_DEFAULT_SOURCE_URL, CONTIX_VERSION, type HealthDto } from "@contix/shared";
import type { FetchLike } from "./modules/discovery/connectors/wazuh";
import type { Mailer, TeamsPoster } from "./modules/notifications/service";
import { vulnerabilityRoutes } from "./modules/vulnerabilities/routes";
import { vulnAdviceRoutes } from "./modules/vulnerabilities/advice";

/**
 * Modulární monolit: každý doménový modul (assets, discovery, vulnerabilities, org, processes, risks;
 * později controls, audits, ai) exportuje vlastní Hono router a mountuje se sem.
 */
/** CSP odpovědí API (v1.12, ADR-108). */
export const API_CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/** Největší tělo požadavku (v1.72, ADR-165). */
export const MAX_JSON_BYTES = 32 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 160 * 1024 * 1024;

export function createApp(deps: { db: Db; config: Config; mailer?: Mailer; teams?: TeamsPoster; fetchImpl?: FetchLike; onBackground?: (p: Promise<unknown>) => void; esbirkaFetch?: (input: string, init?: RequestInit) => Promise<Response>; aresFetch?: AresFetch; intelFetch?: FetchLike; infoFetch?: FetchLike; pdfText?: (buf: Uint8Array) => Promise<string>; tls?: TlsDeps; netscan?: NetScanDeps; adAuth?: AdAuthenticator; toImage?: MapImageConverter; adWriter?: AdWriterFactory }) {
  const { db, config } = deps;
  const origins = [...new Set([...config.CORS_ORIGINS, new URL(config.APP_URL).origin])];

  // Chráněné moduly – vyžadují dokončené přihlášení; jemná oprávnění řeší jednotlivé routy.
  const protectedApi = new Hono<AppEnv>()
    .use("*", requireAuth(db))
    .use("*", methodologyLoader(db))
    .use("*", frameworkLoader(db))
    .use("*", brandLoader(db))
    .route("/frameworks", frameworkRoutes(db))
    .route("/sca", scaRoutes(deps))
    .route("/assets/certificates", certificateRoutes(db, deps.tls))
    .route("/assets/maps", siteMapRoutes(db, { toImage: deps.toImage }))
    .route("/access", accessRoutes(db))
    .route("/access", accessReviewRoutes(db, config))
    .route("/access", accessReconcileRoutes(db))
    .route("/access", accessAdGroupRoutes(db))
    .route("/access", accessIdmRoutes(db))
    .route("/projects", projectRoutes(db))
    .route("/access", accessProvisioningRoutes(db, config, { adWriter: deps.adWriter }))
    .route("/assets", assetGraphRoutes(db))
    .route("/assets", assetRoutes(db))
    .route("/discovery/segments", netSegmentRoutes(db, config, deps.netscan))
    .route("/discovery", discoveryRoutes(db, config))
    .route("/admin/connectors", connectorAdminRoutes(deps))
    .route("/admin/connections", connectionAdminRoutes(deps))
    .route("/hosts", hostRoutes(db))
    .route("/integrations", integrationRoutes(deps))
    .route("/zones", zoneRoutes(deps.db))
    .route("/quality", qualityRoutes(db))
    .route("/bulk", bulkRoutes(db))
    .route("/findings", findingRoutes(db, { config, fetchImpl: deps.fetchImpl }))
    .route("/tags", tagRoutes(db))
    .route("/jira", issueRoutes(db, config))
    .route("/data-locations", locationRoutes(db))
    .route("/security-tests", secTestRoutes({ db, config, fetchImpl: deps.fetchImpl }))
    .route("/admin/login", loginAdminRoutes(deps))
    .route("/admin", userHandoverRoutes(db))
    .route("/admin", adminRoutes(deps))
    .route("/directory", directoryRoutes(db))
    .route("/vulnerabilities/defectdojo", defectDojoRoutes({ db, config, fetchImpl: deps.intelFetch }))
    .route("/vulnerabilities", vulnAdviceRoutes(deps))
    .route("/vulnerabilities", vulnerabilityRoutes(db, deps.intelFetch))
    .route("/org", positionRoutes(db))
    .route("/org", orgRoutes(db))
    .route("/processes", processRoutes(db))
    // uložené pohledy dřív než routery s /:id (ADR-075)
    .route("/risks", savedViewRoutes(db, "risks", "risks", "risks:read"))
    .route("/controls", savedViewRoutes(db, "controls", "controls", "controls:read"))
    .route("/suppliers", savedViewRoutes(db, "suppliers", "suppliers", "suppliers:read"))
    // rizikové scénáře z dat (ADR-114) – před routerem s /:id
    .route("/risks/scenarios", scenarioRoutes(db, { dispatch: () => (req) => app.fetch(req) }))
    .route("/risks/modeling", modelingRoutes(db, { dispatch: () => (req) => app.fetch(req) }))
    .route("/risks/appetite", appetiteRoutes(db))
    .route("/risks", riskRoutes(db))
    .route("/monitors", monitorRoutes(deps))
    .route("/controls", controlRoutes(db))
    .route("/coverage", coverageRoutes(deps))
    .route("/exceptions", exceptionRoutes(db))
    .route("/bia", continuityRoutes(db))
    .route("/continuity-plans", planRoutes(db))
    .route("/exercises", exerciseRoutes(db))
    .route("/documents", documentRoutes(db))
    .route("/pbc", auditRequestRoutes(db))
    .route("/suppliers/dora", doraRoutes(db))
    .route("/suppliers/reports", supplierReportRoutes({ db, pdfText: deps.pdfText }))
    .route("/trust/questionnaires", trustQuestionnaireRoutes(db))
    .route("/trust/library", answerLibraryRoutes(db))
    .route("/trust/center", trustCenterRoutes({ db, config, mailer: deps.mailer }))
    .route("/suppliers", supplierRoutes(db))
    .route("/suppliers", questionnaireRoutes(deps))
    .route("/ares", aresRoutes(deps))
    .route("/trends", trendRoutes(db))
    .route("/actions", actionRoutes(db))
    .route("/records", recordSearchRoutes(deps))
    .route("/links", linkRoutes(db))
    .route("/search", quickSearchRoutes(db))
    .route("/knowledge", knowledgeRoutes(db))
    // uložené pohledy dřív než routery s /:id (ADR-075)
    .route("/soc", savedViewRoutes(db, "soc_alerts", "soc", "soc:read"))
    .route("/incidents", savedViewRoutes(db, "incidents", "incidents", "incidents:read"))
    .route("/soc", socRoutes(deps))
    .route("/soc", socCaseRoutes(db))
    .route("/soc", socSourceRoutes(deps))
    .route("/soc", socIocRoutes(deps))
    .route("/soc", socResponseRoutes(deps))
    .route("/soc", threatIntelRoutes(deps))
    .route("/soc", enrichRoutes(deps))
    .route("/soc", socHuntRoutes(deps))
    /** Ladění pravidel Wazuh – návrhy, simulace, schválení, export (ADR-111). */
    .route("/soc", socTuningRoutes(deps))
    .route("/soc", socPlaybookRoutes(db))
    .route("/soc", socHostRoutes(db))
    .route("/isms", ismsRoutes(db))
    .route("/incidents", incidentRoutes(db))
    .route("/audits", auditRoutes(db))
    .route("/companies", companyRoutes(db))
    .route("/branding", brandingRoutes(db))
    .route("/regulation", regulationRoutes(db))
    .route("/methodologies", methodologyRoutes(db))
    .route("/policies", policyRoutes(db, config))
    .route("/awareness", awarenessRoutes(db))
    .route("/notifications", notificationRoutes(deps))
    .route("/cycles", cycleRoutes(db))
    .route("/alerts", alertRoutes(deps))
    .route("/ai", aiRoutes(deps))
    .route("/assurance", assuranceRoutes(db))
    .route("/reports", reportRoutes(db))
    .route("/dashboard", dashboardRoutes(db))
    .route("/guides", guideRoutes(db, { dispatch: () => (req) => app.fetch(req) }))
    .route("/gdpr", gdprRoutes(db))
    .route("/aiact", aiActRoutes(db))
    .route("/soc2", soc2Routes(db))
    .route("/cra", craRoutes(db, { fetchImpl: deps.infoFetch ?? deps.intelFetch }))
    .route("/identity", identityRoutes(db, config))
    .route("/legislation/infoservice", infoServiceRoutes(db, config, { fetchImpl: deps.infoFetch ?? deps.intelFetch, aiFetch: deps.fetchImpl, pdfText: deps.pdfText }))
    .route("/legislation", legislationRoutes(db, config, { fetchImpl: deps.esbirkaFetch }))
    .route("/tokens", tokenRoutes(db))
    // import zapisuje přes stejná API jako ruční evidence (interní požadavek s relací uživatele)
    .route("/import", importRoutes({ db, dispatch: () => (req) => app.fetch(req) }))
    // ukázková data z Administrace – zakládají se přes stejná API (v1.81)
    .route("/demo", demoRoutes({ db, dispatch: () => (req) => app.fetch(req) }))
    .route("/ops", opsRoutes(deps))
    .route("/setup", setupRoutes(deps))
    .route("/help", helpRoutes(db))
    .route("/", i18nRoutes(db));

  const api = new Hono<AppEnv>()
    .get("/health", async (c) => {
      let dbOk = true;
      try {
        await db.execute(sql`select 1`);
      } catch {
        dbOk = false;
      }
      const body: HealthDto = { status: dbOk ? "ok" : "degraded", db: dbOk, version: CONTIX_VERSION, license: CONTIX_LICENSE, sourceUrl: config.CONTIX_SOURCE_URL ?? CONTIX_DEFAULT_SOURCE_URL, time: new Date().toISOString() };
      return c.json(body, dbOk ? 200 : 503);
    })
    /** Prometheus metriky – jen s METRICS_TOKEN (Authorization: Bearer …); bez tokenu 404. */
    .get("/metrics", async (c) => {
      if (!config.METRICS_TOKEN) return c.json({ error: "Nenalezeno" }, 404);
      if (!metricsAuthorized(c.req.header("authorization"), config.METRICS_TOKEN)) return c.json({ error: "Neautorizováno" }, 401);
      return c.text(await metricsText(db, config), 200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
    })
    .route("/auth", authRoutes(deps))
    .route("/i18n", i18nPublicRoutes(db))
    /** MCP server – vlastní autentizace osobním API tokenem (ne session cookie). */
    .route("/mcp", mcpRoutes(deps))
    /** Bezpečnostní dotazník pro dodavatele – bez přihlášení, autentizace tokenem v cestě (ADR-040). */
    .route("/public/questionnaires", publicQuestionnaireRoutes(db))
    /** Příjem alertů SOC z dalších nástrojů – autentizace tokenem zdroje (ADR-052). */
    .route("/public/soc", publicSocIngestRoutes(deps))
    /** Feed IOC k blokaci pro firewall / proxy – token v cestě (ADR-054). */
    .route("/public/soc", publicSocFeedRoutes(db))
    /** Trust Center – veřejná stránka důvěry, dokumenty po NDA (ADR-099). */
    .route("/public/trust", publicTrustRoutes(db))
    /** Import skenů zranitelností z CI/CD – osobní API token (ADR-097). */
    .route("/public/vulnerabilities", publicVulnScanRoutes(db))
    .route("/public/hosts", publicHostRoutes(db))
    .route("/public/agent/v1", publicAgentRoutes(db))
    .route("/public/probe", publicProbeRoutes({ db, config, fetchImpl: deps.fetchImpl, onBackground: deps.onBackground }))
    /** Výsledky externích kontrol opatření ze skriptů – token monitoru (ADR-109). */
    .route("/public/monitors", publicMonitorRoutes(db))
    .route("/", protectedApi);

  const app = new Hono<AppEnv>();
  // token v cestě /dav/… ani kód z SSO (/oidc/…/callback?code=) se do logu nezapisují
  if (config.NODE_ENV !== "test") app.use(async (c, next) => (c.req.path.startsWith("/dav/") || c.req.path.startsWith("/api/public/") || c.req.path.includes("/oidc/") ? next() : logger()(c, next)));
  // API vrací JSON, soubory ke stažení a tiskové HTML bez skriptů – nahraný soubor se nesmí spustit jako stránka (ADR-108)
  app.use(secureHeaders({ permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] } }));
  app.use(async (c, next) => {
    await next();
    // výchozí CSP jen tam, kde trasa nenastavila vlastní (stažení souborů mají `sandbox`)
    if (c.res.headers.has("content-security-policy")) return;
    try {
      c.res.headers.set("content-security-policy", API_CSP);
    } catch {
      c.res = new Response(c.res.body, c.res); // neměnné hlavičky (např. přeposlaná odpověď)
      c.res.headers.set("content-security-policy", API_CSP);
    }
  });
  app.use("/api/*", cors({ origin: origins, credentials: true }));
  // omezení velikosti požadavku (v1.72, ADR-165): JSON 32 MB, nahrávání souborů 160 MB (největší povolený soubor je 150 MB)
  const jsonLimit = bodyLimit({ maxSize: MAX_JSON_BYTES, onError: (c) => c.json({ error: "Požadavek je příliš velký" }, 413) });
  const fileLimit = bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ error: "Požadavek je příliš velký" }, 413) });
  app.use("/api/*", (c, next) => (c.req.method === "GET" || c.req.method === "HEAD" ? next() : (c.req.header("content-type") ?? "").includes("multipart/") ? fileLimit(c, next) : jsonLimit(c, next)));
  // Ochrana proti CSRF: změnové požadavky musí mít Origin naší aplikace (+ SameSite=Lax cookie).
  // výjimka: příjem alertů z jiných nástrojů – autentizace tokenem v hlavičce, bez cookies (ADR-052)
  const csrfMw = csrf({ origin: origins });
  app.use("/api/*", (c, next) => (c.req.path === "/api/public/soc/ingest" || c.req.path === "/api/public/vulnerabilities/scans" || c.req.path === "/api/public/monitors/result" || c.req.path === "/api/public/hosts/inventory" || c.req.path.startsWith("/api/public/agent/v1/") ? next() : csrfMw(c, next)));
  app.use("/api/*", sessionMiddleware(db));
  app.route("/api", api);
  /** RFC 9116 (v1.48, ADR-145): kontakt provozovatele (SECURITY_CONTACT), jinak soukromé hlášení u výrobce. */
  app.get("/.well-known/security.txt", (c) => {
    const src = config.CONTIX_SOURCE_URL ?? CONTIX_DEFAULT_SOURCE_URL;
    const expires = new Date(Date.now() + 180 * 86_400_000);
    expires.setUTCHours(0, 0, 0, 0);
    const lines = [
      `Contact: ${config.SECURITY_CONTACT ?? `${src}/security/advisories/new`}`,
      `Expires: ${expires.toISOString()}`,
      `Policy: ${src}/blob/main/SECURITY.md`,
      "Preferred-Languages: cs, en",
      ...(config.APP_URL ? [`Canonical: ${config.APP_URL.replace(/\/$/, "")}/.well-known/security.txt`] : []),
    ];
    return c.text(`${lines.join("\n")}\n`, 200, { "cache-control": "public, max-age=86400" });
  });
  /** WebDAV pro úpravy v desktopovém Office – autentizace tokenem v cestě (ADR-026), bez cookies a CSRF. */
  app.route("/dav", davRoutes(db, config));

  app.onError(async (err, c) => {
    if (err instanceof ApiError) {
      const t = await tFor(db, c as never).catch(() => null);
      return c.json({ error: t ? t(err.key, err.params) : err.message }, err.status);
    }
    // hlášky HTTPException jsou česky – přeloží se podle textu (lbl:<text> v jazykovém balíčku), jinak zůstanou
    const tr = async (msg: string) => (await tFor(db, c as never).catch(() => null))?.lbl(msg) ?? msg;
    if (err instanceof HTTPException) return c.json({ error: await tr(err.message) }, err.status);
    // neplatné ID v adrese (např. /api/risks/abc) = nenalezeno, ne chyba serveru
    const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === "22P02") return c.json({ error: await tr("Nenalezeno") }, 404);
    console.error(err);
    return c.json({ error: await tr("Interní chyba serveru") }, 500);
  });
  app.notFound(async (c) => c.json({ error: (await tFor(db, c as never).catch(() => null))?.lbl("Nenalezeno") ?? "Nenalezeno" }, 404));

  return app;
}

/** Typ API pro typově bezpečného klienta na frontendu (hono/client). */
export type AppType = ReturnType<typeof createApp>;
