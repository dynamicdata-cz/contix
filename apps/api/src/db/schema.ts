import {
  type NetScanSummary,
  type TuningKind,
  type TuningCondition,
  type TuningStatus,
  type TuningSimulation,
  type ControlMonitorKind,
  type SupplierReportKind,
  type CustomerQStatus,
  type QaAnswer,
  type QaSource,
  type QaItemStatus,
  type TrustSettings,
  type TrustRequestStatus,
  type ReportOpinion,
  type ReportItemKind,
  type ReportItemStatus,
  type ReportItemSeverity,
  type MonitorFrequency,
  type MonitorParams,
  type MonitorResult,
  type TlsScanResult,
  type DoraContract,
  type DoraEntity,
  type DoraProvider,
  ORG_UNIT_TYPES,
  PROCESS_STATUSES,
  PROCESS_TYPES,
  RACI,
  RISK_STATUSES,
  STEP_TYPES,
  TREATMENTS,
  CONTROL_CATEGORIES,
  CONTROL_STATUSES,
  EFFECTIVENESS,
  COMPLIANCE,
  ACTION_STATUSES,
  BIA_STATUSES,
  DOC_KINDS,
  DOC_STATUSES,
  PLAN_TYPES,
  PLAN_STATUSES,
  TEST_TYPES,
  TEST_RESULTS,
  CHANGE_TYPES,
  CHANGE_STATUSES,
  CHANGE_DECISIONS,
  OBJECTIVE_STATUSES,
  INCIDENT_KINDS,
  INCIDENT_STATUSES,
  INCIDENT_CATEGORIES,
  INCIDENT_CAUSES,
  AUTHORITY_DECISIONS,
  REPORT_TYPES,
  REPORT_RECIPIENTS,
  REPORT_CHANNELS,
  AUDIT_TYPES,
  AUDIT_STATUSES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type TimelineEntry,
  AUDIT_CHECK_RESULTS,
  POLICY_TYPES,
  POLICY_STATUSES,
  POLICY_VERSION_STATUSES,
  CLASSIFICATIONS,
  MANAGEMENT_SYSTEMS,
  EMPTY_AUDIENCE,
  type Audience,
  COURSE_KINDS,
  COURSE_FORMS,
  SESSION_STATUSES,
  CYCLE_KINDS,
  ALERT_SUGGESTION_STATUSES,
  CYCLE_STATUSES,
  CYCLE_REASONS,
  CYCLE_ITEM_STATES,
  type CycleItemSnapshot,
  type QuantInput,
  type FactorValues,
  type RiskTrigger,
  type MethodologyDef,
  COMPANY_KINDS,
  ROOT_COMPANY_ID,
  type CompanyOverrides,
  type ClauseState,
  type PlanContact,
  type PlanStep,
  HEALTH_STATUSES,
  SEVERITIES,
  SUPPORT_STATUSES,
  VULN_STATUSES,
  ASSET_CLASSES,
  ASSET_TYPES,
  CRITICALITIES,
  DISCOVERY_CONNECTORS,
  ENVIRONMENTS,
  LIFECYCLE_STATUSES,
  RUN_STATUSES,
  SOURCE_TYPES,
  AI_SUGGESTION_STATUSES,
  EVIDENCE_KINDS,
  TEST_KINDS,
  TEST_STATUSES,
  CONTROL_TEST_RESULTS,
  SAMPLE_RESULTS,
  type TestMethod,
  type ControlFrequency,
  IDENTITY_SOURCE_KINDS,
  IDENTITY_ACCOUNT_KINDS,
  IDENTITY_SEVERITIES,
  IDENTITY_FINDING_STATUSES,
  type AccountFlags,
  type IdentityPolicy,
  type IdentitySourceStats,
  type SodSide,
  type ProvisioningConfig,
  type AdLoginConfig,
  CONTROL_AUTOMATION_KINDS,
  type AutomationFrequency,
  type IdentityRule,
  ACCESS_REVIEW_STATUSES,
  ACCESS_REVIEW_DECISIONS,
  ACCESS_REVIEWER_MODES,
  LEGAL_SOURCES,
  LEGAL_REVIEW_STATUSES,
  LEGAL_IMPACTS,
  LEGAL_TASK_STATUSES,
} from "@contix/shared";
import { sql } from "drizzle-orm";
import {
  customType,
  bigint,
  boolean,
  date,
  serial,
  index,
  real,
  integer,
  jsonb,
  primaryKey,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const assetTypeEnum = pgEnum("asset_type", ASSET_TYPES);
export const criticalityEnum = pgEnum("criticality", CRITICALITIES);
export const lifecycleStatusEnum = pgEnum("lifecycle_status", LIFECYCLE_STATUSES);
export const environmentEnum = pgEnum("environment", ENVIRONMENTS);
export const sourceTypeEnum = pgEnum("source_type", SOURCE_TYPES);
export const connectorEnum = pgEnum("discovery_connector", DISCOVERY_CONNECTORS);
export const runStatusEnum = pgEnum("run_status", RUN_STATUSES);
export const assetClassEnum = pgEnum("asset_class", ASSET_CLASSES);
export const authProviderEnum = pgEnum("auth_provider", ["local", "oidc", "ad"]);
export const roleSourceEnum = pgEnum("role_source", ["manual", "idp"]);
export const severityEnum = pgEnum("vuln_severity", SEVERITIES);
export const vulnStatusEnum = pgEnum("vuln_status", VULN_STATUSES);
export const healthStatusEnum = pgEnum("health_status", HEALTH_STATUSES);
export const supportStatusEnum = pgEnum("support_status", SUPPORT_STATUSES);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ============ Skupina společností ============ */

export const companyKindEnum = pgEnum("company_kind", COMPANY_KINDS);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id"),
  kind: companyKindEnum("kind").notNull().default("company"),
  name: varchar("name", { length: 300 }).notNull(),
  shortName: varchar("short_name", { length: 50 }),
  ico: varchar("ico", { length: 20 }),
  address: text("address"),
  regulatedServices: text("regulated_services"),
  regime: varchar("regime", { length: 10 }).notNull().default("higher"),
  /** Regulatorní balíček (ADR-080): cz | generic. */
  pack: varchar("pack", { length: 20 }).notNull().default("cz"),
  /** Hlavní rámec z knihovny (neregulovaná úroveň / obecný balíček). */
  primaryFramework: varchar("primary_framework", { length: 50 }),
  /** Finanční subjekt podle DORA (ADR-084). */
  doraEntity: boolean("dora_entity").notNull().default(false),
  active: boolean("active").notNull().default(true),
  overrides: jsonb("overrides").$type<CompanyOverrides>().notNull().default({}),
  /** DORA – údaje finančního subjektu pro registr informací (ADR-069). */
  dora: jsonb("dora").$type<Partial<DoraEntity>>().notNull().default({}),
  ...timestamps,
});

/** Příslušnost záznamu ke společnosti (výchozí = kořenová společnost). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const companyRef = () =>
  uuid("company_id")
    .notNull()
    .default(ROOT_COMPANY_ID)
    .references(() => companies.id, { onDelete: "restrict" });


/* ================================================================
 * Identity a přístup
 * ================================================================ */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    jobTitle: varchar("job_title", { length: 200 }),
    authProvider: authProviderEnum("auth_provider").notNull().default("local"),
    /** OIDC: "<provider>:<sub>" – stabilní identita u IdP. */
    externalId: varchar("external_id", { length: 500 }),
    passwordHash: text("password_hash"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /** TOTP tajemství šifrované AES-256-GCM (APP_SECRET). */
    mfaSecretEnc: text("mfa_secret_enc"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    /** Poslední použitý TOTP krok – ochrana proti opakovanému použití kódu. */
    mfaLastStep: integer("mfa_last_step"),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Jazyk ovládání (BCP 47, např. cs, en, sr-Latn); null = výchozí jazyk organizace. */
    locale: varchar("locale", { length: 20 }),
    /** Uživatel založený synchronizací z adresáře (Identity a přístupy) – spravuje ho tento zdroj. */
    directorySourceId: uuid("directory_source_id").references((): AnyPgColumn => identitySources.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), uniqueIndex("users_external_uq").on(t.externalId)],
);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  externalGroups: text("external_groups").array().notNull().default(sql`'{}'::text[]`),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps,
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    /** manual = přidělil admin, idp = odvozeno ze skupin Entra ID / AD při přihlášení. */
    source: roleSourceEnum("source").notNull().default("manual"),
    /** Společnost, pro kterou role platí (i pro její dceřiné společnosti). */
    companyId: companyRef(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId, t.source, t.companyId] })],
);

/** Organizační skupiny/týmy – členové dědí role skupiny. */
export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull().unique(),
  description: text("description"),
  ...timestamps,
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const groupRoles = pgTable(
  "group_roles",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    companyId: companyRef(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.roleId, t.companyId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 hash tokenu z cookie – samotný token se neukládá. */
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    /** Přihlášení přes IdP – MFA řeší IdP (např. Conditional Access v Entra ID). */
    viaIdp: boolean("via_idp").notNull().default(false),
    ip: varchar("ip", { length: 100 }),
    userAgent: varchar("user_agent", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const mfaRecoveryCodes = pgTable("mfa_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/** Rozpracované OIDC přihlášení (state, nonce, PKCE) – krátká životnost. */
export const authFlows = pgTable("auth_flows", {
  state: varchar("state", { length: 100 }).primaryKey(),
  provider: varchar("provider", { length: 50 }).notNull(),
  nonce: varchar("nonce", { length: 100 }).notNull(),
  codeVerifier: varchar("code_verifier", { length: 200 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userEmail: varchar("user_email", { length: 320 }),
    action: varchar("action", { length: 100 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }),
    entityId: varchar("entity_id", { length: 100 }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    ip: varchar("ip", { length: 100 }),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_entity_idx").on(t.entityType, t.entityId)],
);

/** Jazykové balíčky nahrané správcem (doplňují / přepisují vestavěné cs, en) – ADR-036. */
export const languagePacks = pgTable("language_packs", {
  locale: varchar("locale", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 60 }).notNull(),
  nativeName: varchar("native_name", { length: 60 }).notNull(),
  fallback: varchar("fallback", { length: 20 }),
  messages: jsonb("messages").$type<Record<string, string>>().notNull(),
  help: jsonb("help").$type<Record<string, { title: string; summary: string; body: string }>>(),
  updatedBy: uuid("updated_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ================================================================
 * Aktiva
 * ================================================================ */

/** Aktivum – "zlatý záznam" sjednocený ze všech zdrojů. */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    name: varchar("name", { length: 255 }).notNull(),
    assetType: assetTypeEnum("asset_type").notNull(),
    assetClass: assetClassEnum("asset_class").notNull().default("supporting"),
    description: text("description"),
    hostname: varchar("hostname", { length: 255 }),
    fqdn: varchar("fqdn", { length: 255 }),
    ipAddresses: text("ip_addresses").array().notNull().default(sql`'{}'::text[]`),
    macAddresses: text("mac_addresses").array().notNull().default(sql`'{}'::text[]`),
    osName: varchar("os_name", { length: 255 }),
    osVersion: varchar("os_version", { length: 255 }),
    manufacturer: varchar("manufacturer", { length: 255 }),
    model: varchar("model", { length: 255 }),
    serialNumber: varchar("serial_number", { length: 255 }),
    location: varchar("location", { length: 255 }),
    /** Volný text (např. z importu), pokud vlastník není uživatel systému. */
    ownerName: varchar("owner_name", { length: 255 }),
    /** Garant / vlastník aktiva – uživatel CONTIX. */
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    criticality: criticalityEnum("criticality").notNull().default("medium"),
    confidentiality: smallint("confidentiality"),
    integrity: smallint("integrity"),
    availability: smallint("availability"),
    lifecycleStatus: lifecycleStatusEnum("lifecycle_status").notNull().default("active"),
    /** Redundantní aktivum (cluster, HA) – není jediným bodem selhání (ADR-065). */
    redundant: boolean("redundant").notNull().default(false),
    /** Aktivum dosažitelné z internetu (ADR-095) – zvyšuje prioritu kritických a vysokých zranitelností. */
    internetFacing: boolean("internet_facing").notNull().default(false),
    environment: environmentEnum("environment"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // --- semafor (přepočítává se po synchronizaci zranitelností / změně aktiva) ---
    healthStatus: healthStatusEnum("health_status").notNull().default("unknown"),
    healthReasons: jsonb("health_reasons").$type<{ level: "red" | "orange"; code: string; text: string }[]>().notNull().default([]),
    healthUpdatedAt: timestamp("health_updated_at", { withTimezone: true }),
    vulnCritical: integer("vuln_critical").notNull().default(0),
    vulnHigh: integer("vuln_high").notNull().default(0),
    vulnMedium: integer("vuln_medium").notNull().default(0),
    vulnLow: integer("vuln_low").notNull().default(0),
    supportStatus: supportStatusEnum("support_status").notNull().default("unknown"),
    osEolDate: date("os_eol_date"),
    ...timestamps,
  },
  (t) => [
    index("assets_type_idx").on(t.assetType),
    index("assets_health_idx").on(t.healthStatus),
    index("assets_class_idx").on(t.assetClass),
    index("assets_owner_idx").on(t.ownerUserId),
    index("assets_hostname_idx").on(sql`lower(${t.hostname})`),
    index("assets_serial_idx").on(t.serialNumber),
    index("assets_ip_gin").using("gin", t.ipAddresses),
    index("assets_mac_gin").using("gin", t.macAddresses),
  ],
);

/** Odkud aktivum známe (1 aktivum : N zdrojů). Klíč pro deduplikaci a synchronizaci. */
export const assetSources = pgTable(
  "asset_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    /** ID v cizím systému – např. Wazuh agent ID, MAC/IP ze skenu, řádek importu. */
    sourceRef: varchar("source_ref", { length: 255 }).notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("asset_sources_ref_uq").on(t.sourceType, t.sourceRef),
    index("asset_sources_asset_idx").on(t.assetId),
  ],
);

/** Zranitelnost (CVE) nalezená na aktivu – typicky z Wazuh vulnerability detection. */
/**
 * Veřejné zdroje hrozeb ke CVE (ADR-049): katalog CISA KEV a skóre EPSS. Globální data (ne společnosti),
 * plní jen `refreshVulnIntel` / ruční nahrání; EPSS jen pro CVE z evidence, KEV celý.
 */
export const vulnIntel = pgTable("vuln_intel", {
  cveId: varchar("cve_id", { length: 30 }).primaryKey(),
  kev: boolean("kev").notNull().default(false),
  kevName: text("kev_name"),
  kevDateAdded: date("kev_date_added"),
  kevDueDate: date("kev_due_date"),
  kevRansomware: boolean("kev_ransomware").notNull().default(false),
  epss: real("epss"),
  epssPercentile: real("epss_percentile"),
  epssDate: date("epss_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assetVulnerabilities = pgTable(
  "asset_vulnerabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    cveId: varchar("cve_id", { length: 100 }).notNull(),
    severity: severityEnum("severity").notNull().default("unknown"),
    cvssScore: real("cvss_score"),
    packageName: varchar("package_name", { length: 500 }).notNull().default(""),
    packageVersion: varchar("package_version", { length: 255 }).notNull().default(""),
    description: text("description"),
    reference: text("reference"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    detectedAt: timestamp("detected_at", { withTimezone: true }),
    sourceType: sourceTypeEnum("source_type").notNull().default("wazuh"),
    status: vulnStatusEnum("status").notNull().default("open"),
    /** Výjimka (akceptace rizika) – kdo, proč a do kdy. */
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedReason: text("accepted_reason"),
    acceptedUntil: date("accepted_until"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /* import skenů (ADR-095) – u Wazuhu prázdné */
    /** Stálý klíč nálezu skeneru (skener + pravidlo + endpoint + komponenta) – párování při reimportu. */
    findingKey: varchar("finding_key", { length: 64 }).notNull().default(""),
    scanner: varchar("scanner", { length: 30 }).notNull().default(""),
    scanId: uuid("scan_id").references(() => vulnScans.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }),
    cwe: integer("cwe"),
    endpoint: varchar("endpoint", { length: 500 }).notNull().default(""),
    relatedCves: text("related_cves").array().notNull().default(sql`'{}'::text[]`),
    fixedVersion: varchar("fixed_version", { length: 255 }),
    remediation: text("remediation"),
    /** Nález z externího skenu = dosažitelný z internetu. */
    exposed: boolean("exposed").notNull().default(false),
    /* triáž */
    verified: boolean("verified").notNull().default(false),
    duplicateOfId: uuid("duplicate_of_id"),
    triageReason: text("triage_reason"),
    triagedBy: uuid("triaged_by").references(() => users.id, { onDelete: "set null" }),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("asset_vuln_uq").on(t.assetId, t.cveId, t.packageName, t.packageVersion, t.findingKey),
    index("asset_vuln_scanner_idx").on(t.scanner, t.assetId),
    index("asset_vuln_status_idx").on(t.status, t.severity),
    index("asset_vuln_cve_idx").on(t.cveId),
  ],
);

/** Import výstupu skeneru (ADR-095) – jeden import = jeden „test“ v pojetí DefectDojo. */
export const vulnScans = pgTable(
  "vuln_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    scanner: varchar("scanner", { length: 30 }).notNull(),
    name: varchar("name", { length: 200 }).notNull().default(""),
    fileName: varchar("file_name", { length: 255 }).notNull().default(""),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull().default(""),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    external: boolean("external").notNull().default(false),
    closeMissing: boolean("close_missing").notNull().default(true),
    stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
    unmatchedHosts: text("unmatched_hosts").array().notNull().default(sql`'{}'::text[]`),
    importedById: uuid("imported_by_id").references(() => users.id, { onDelete: "set null" }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("vuln_scans_company_idx").on(t.companyId, t.importedAt)],
);

/** AI rozbor zranitelnosti a postup odstranění (ADR-076) – návrh pro tým, jeden na CVE, společnost a jazyk. */
export const vulnAdvice = pgTable(
  "vuln_advice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    cveId: varchar("cve_id", { length: 30 }).notNull(),
    locale: varchar("locale", { length: 10 }).notNull().default("cs"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    model: varchar("model", { length: 200 }).notNull().default(""),
    durationMs: integer("duration_ms").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vuln_advice_uq").on(t.companyId, t.cveId, t.locale)],
);

/** Sdílené aktivum holdingu (ADR-085): vlastník = `assets.company_id`, další společnosti skupiny ho vidí a používají ve vazbách. */
export const assetCompanies = pgTable(
  "asset_companies",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.companyId] }), index("asset_companies_company_idx").on(t.companyId)],
);

/** Vazba podpůrné aktivum → primární aktivum, které podporuje (N:M). */
export const assetLinks = pgTable(
  "asset_links",
  {
    primaryId: uuid("primary_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    supportingId: uuid("supporting_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    note: varchar("note", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.primaryId, t.supportingId] }), index("asset_links_supporting_idx").on(t.supportingId)],
);

/** Technické závislosti mezi aktivy (ADR-063): zdroj závisí na cíli (aplikace běží na serveru…). */
export const assetDependencies = pgTable(
  "asset_dependencies",
  {
    fromId: uuid("from_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    toId: uuid("to_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull().default("uses"),
    note: varchar("note", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fromId, t.toId] }), index("asset_dependencies_to_idx").on(t.toId)],
);

/** Síťové segmenty pro plánované skeny (ADR-072). */
export const netSegments = pgTable("net_segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: companyRef(),
  name: varchar("name", { length: 200 }).notNull(),
  cidrs: text("cidrs").array().notNull().default(sql`'{}'::text[]`),
  exclude: text("exclude").array().notNull().default(sql`'{}'::text[]`),
  profile: varchar("profile", { length: 20 }).notNull().default("ping"),
  mode: varchar("mode", { length: 20 }).notNull().default("monitor"),
  schedule: varchar("schedule", { length: 20 }).notNull().default("manual"),
  scheduleTime: varchar("schedule_time", { length: 5 }).notNull().default("02:00"),
  scheduleWeekday: smallint("schedule_weekday").notNull().default(1),
  alertLevel: smallint("alert_level").notNull().default(8),
  enabled: boolean("enabled").notNull().default(true),
  note: varchar("note", { length: 1000 }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunId: uuid("last_run_id"),
  lastSummary: jsonb("last_summary").$type<NetScanSummary>(),
  ...timestamps,
});

/** Hostitelé nalezení skenem segmentu a jejich vztah k evidenci (ADR-072). */
export const netObservations = pgTable(
  "net_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => netSegments.id, { onDelete: "cascade" }),
    hostKey: varchar("host_key", { length: 80 }).notNull(),
    ip: varchar("ip", { length: 45 }),
    mac: varchar("mac", { length: 17 }),
    hostname: varchar("hostname", { length: 255 }),
    vendor: varchar("vendor", { length: 255 }),
    osName: varchar("os_name", { length: 255 }),
    openPorts: jsonb("open_ports").$type<{ port: number; protocol: string; service?: string; product?: string }[]>().notNull().default([]),
    status: varchar("status", { length: 20 }).notNull().default("unknown"),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    alertId: uuid("alert_id").references(() => alertSuggestions.id, { onDelete: "set null" }),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    seenCount: integer("seen_count").notNull().default(1),
    note: varchar("note", { length: 1000 }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("net_observations_uq").on(t.segmentId, t.hostKey), index("net_observations_status_idx").on(t.status)],
);

/** TLS koncové body a výsledek poslední kontroly certifikátu (ADR-070). */
export const tlsEndpoints = pgTable(
  "tls_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    host: varchar("host", { length: 253 }).notNull(),
    port: integer("port").notNull().default(443),
    serverName: varchar("server_name", { length: 253 }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    note: varchar("note", { length: 500 }),
    enabled: boolean("enabled").notNull().default(true),
    lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
    notAfter: timestamp("not_after", { withTimezone: true }),
    result: jsonb("result").$type<TlsScanResult>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("tls_endpoints_uq").on(t.companyId, t.host, t.port), index("tls_endpoints_asset_idx").on(t.assetId)],
);

/** Běh discovery / importu – auditní stopa, statistiky, chyby. */
export const discoveryRuns = pgTable("discovery_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
  connector: connectorEnum("connector").notNull(),
  status: runStatusEnum("status").notNull().default("queued"),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default({}),
  error: text("error"),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
});

/** Nainstalovaný software (z Wazuh syscollectoru) – základ pro vazbu na zranitelnosti. */
export const assetSoftware = pgTable(
  "asset_software",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 500 }).notNull(),
    version: varchar("version", { length: 255 }),
    vendor: varchar("vendor", { length: 255 }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    ...timestamps,
  },
  (t) => [index("asset_software_asset_idx").on(t.assetId)],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
export type DiscoveryRunRow = typeof discoveryRuns.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

/* ================================================================
 * Organizace
 * ================================================================ */

export const orgUnitTypeEnum = pgEnum("org_unit_type", ORG_UNIT_TYPES);

export const orgUnits = pgTable(
  "org_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    parentId: uuid("parent_id").references((): AnyPgColumn => orgUnits.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 50 }),
    unitType: orgUnitTypeEnum("unit_type").notNull().default("department"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    directorySourceId: uuid("directory_source_id").references((): AnyPgColumn => identitySources.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("org_units_parent_idx").on(t.parentId)],
);

/** Funkční místo v útvaru – přežije personální změny (vazby RACI jdou na místo, ne na osobu). */
export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgUnitId: uuid("org_unit_id")
      .notNull()
      .references(() => orgUnits.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 50 }),
    description: text("description"),
    isManager: boolean("is_manager").notNull().default(false),
    securityRoles: text("security_roles").array().notNull().default(sql`'{}'::text[]`),
    /** Funkční místo spravované synchronizací z adresáře (obsazení podle atributu title). */
    directorySourceId: uuid("directory_source_id").references((): AnyPgColumn => identitySources.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("positions_unit_idx").on(t.orgUnitId)],
);

export const positionHolders = pgTable(
  "position_holders",
  {
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    since: date("since"),
  },
  (t) => [primaryKey({ columns: [t.positionId, t.userId] })],
);

/* ================================================================
 * Procesy
 * ================================================================ */

export const processTypeEnum = pgEnum("process_type", PROCESS_TYPES);
export const processStatusEnum = pgEnum("process_status", PROCESS_STATUSES);
export const stepTypeEnum = pgEnum("step_type", STEP_TYPES);
export const raciEnum = pgEnum("raci_role", RACI);
export const partyKindEnum = pgEnum("party_kind", ["position", "org_unit"]);

export const processes = pgTable(
  "processes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    parentId: uuid("parent_id").references((): AnyPgColumn => processes.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 255 }).notNull(),
    processType: processTypeEnum("process_type").notNull().default("core"),
    status: processStatusEnum("status").notNull().default("draft"),
    purpose: text("purpose"),
    description: text("description"),
    trigger: text("trigger"),
    inputs: text("inputs"),
    outputs: text("outputs"),
    kpis: text("kpis"),
    frequency: varchar("frequency", { length: 255 }),
    legislation: text("legislation"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    orgUnitId: uuid("org_unit_id").references(() => orgUnits.id, { onDelete: "set null" }),
    criticality: criticalityEnum("criticality").notNull().default("medium"),
    bpmnXml: text("bpmn_xml"),
    version: integer("version").notNull().default(1),
    /** DORA – stálé číslo funkce (identifikátor F<n> v registru informací, ADR-069). */
    functionNo: integer("function_no").generatedByDefaultAsIdentity(),
    /** DORA – licencovaná činnost funkce (B_06.01.0020); prázdné = podpůrná funkce. */
    doraActivity: varchar("dora_activity", { length: 300 }),
    ...timestamps,
  },
  (t) => [index("processes_parent_idx").on(t.parentId)],
);

export const processSteps = pgTable(
  "process_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    order: integer("order").notNull().default(0),
    name: varchar("name", { length: 255 }).notNull(),
    stepType: stepTypeEnum("step_type").notNull().default("task"),
    description: text("description"),
    inputs: text("inputs"),
    outputs: text("outputs"),
    duration: varchar("duration", { length: 255 }),
    systems: text("systems"),
    ...timestamps,
  },
  (t) => [index("process_steps_process_idx").on(t.processId, t.order)],
);

export const stepRaci = pgTable(
  "step_raci",
  {
    stepId: uuid("step_id")
      .notNull()
      .references(() => processSteps.id, { onDelete: "cascade" }),
    partyKind: partyKindEnum("party_kind").notNull(),
    partyId: uuid("party_id").notNull(),
    role: raciEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.stepId, t.partyKind, t.partyId, t.role] })],
);

/** Aktivum použité procesem (volitelně konkrétním krokem). */
export const processAssets = pgTable(
  "process_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").references(() => processSteps.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("process_assets_uq").on(t.processId, t.assetId, sql`coalesce(${t.stepId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index("process_assets_asset_idx").on(t.assetId),
  ],
);

export const processDocuments = pgTable("process_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  processId: uuid("process_id")
    .notNull()
    .references(() => processes.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => processSteps.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 500 }).notNull(),
  url: text("url"),
  docType: varchar("doc_type", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ================================================================
 * Rizika
 * ================================================================ */

export const catalogKindEnum = pgEnum("risk_catalog_kind", ["threat", "weakness"]);
export const riskStatusEnum = pgEnum("risk_status", RISK_STATUSES);
export const treatmentEnum = pgEnum("risk_treatment", TREATMENTS);

/** Katalog hrozeb a zranitelností (slabých míst) – výchozí dle vyhlášky, rozšiřitelný. */
export const riskCatalog = pgTable(
  "risk_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: catalogKindEnum("kind").notNull(),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 500 }).notNull(),
    category: varchar("category", { length: 200 }),
    description: text("description"),
    affectsC: boolean("affects_c").notNull().default(true),
    affectsI: boolean("affects_i").notNull().default(true),
    affectsA: boolean("affects_a").notNull().default(true),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /** Původ položky (např. vyhl. č. 409/2025 Sb., příl. č. 3). */
    source: varchar("source", { length: 200 }),
    ...timestamps,
  },
  (t) => [uniqueIndex("risk_catalog_code_uq").on(t.kind, t.code)],
);

export const risks = pgTable(
  "risks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 500 }).notNull(),
    description: text("description"),
    threatId: uuid("threat_id").references(() => riskCatalog.id, { onDelete: "set null" }),
    weaknessId: uuid("weakness_id").references(() => riskCatalog.id, { onDelete: "set null" }),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    status: riskStatusEnum("status").notNull().default("identified"),
    impact: smallint("impact"),
    threatLevel: smallint("threat_level"),
    vulnLevel: smallint("vuln_level"),
    likelihood: smallint("likelihood"),
    treatment: treatmentEnum("treatment"),
    treatmentPlan: text("treatment_plan"),
    treatmentDue: date("treatment_due"),
    residualImpact: smallint("residual_impact"),
    residualThreatLevel: smallint("residual_threat_level"),
    residualVulnLevel: smallint("residual_vuln_level"),
    residualLikelihood: smallint("residual_likelihood"),
    /** Počet úrovní stupnice, ve které bylo riziko hodnoceno (3/4/5). */
    scaleLevels: smallint("scale_levels").notNull().default(4),
    /** Metodika, ve které bylo riziko hodnoceno („zkb409“ = příloha č. 4 vyhl. 409; jinak id importované metodiky). */
    methodologyKey: varchar("methodology_key", { length: 40 }).notNull().default("zkb409"),
    factorValues: jsonb("factor_values").$type<FactorValues>(),
    residualFactorValues: jsonb("residual_factor_values").$type<FactorValues>(),
    /** Kvantitativní analýza FAIR (rozpětí četnosti a ztráty). */
    quant: jsonb("quant").$type<QuantInput>(),
    /** Kdy bylo naposledy změněno hodnocení (pro pravidelné hodnocení dle § 8 odst. 1 písm. c). */
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    /** Poslední rozhodnutí vlastníka o přehodnocení (změna nebo potvrzení beze změny, ADR-058). */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("risks_status_idx").on(t.status)],
);

export const riskAssets = pgTable(
  "risk_assets",
  {
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.riskId, t.assetId] }), index("risk_assets_asset_idx").on(t.assetId)],
);

/** Další hrozby a zranitelnosti rizikového scénáře (ADR-085) – hlavní zůstávají v `risks.threat_id` / `weakness_id`. */
export const riskCatalogLinks = pgTable(
  "risk_catalog_links",
  {
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    catalogId: uuid("catalog_id")
      .notNull()
      .references(() => riskCatalog.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.riskId, t.catalogId] }), index("risk_catalog_links_catalog_idx").on(t.catalogId)],
);

export const riskProcesses = pgTable(
  "risk_processes",
  {
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.riskId, t.processId] }), index("risk_processes_process_idx").on(t.processId)],
);

/** Konkrétní CVE (zranitelnost z Wazuhu) podkládající riziko. */
export const riskCves = pgTable(
  "risk_cves",
  {
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    vulnerabilityId: uuid("vulnerability_id")
      .notNull()
      .references(() => assetVulnerabilities.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.riskId, t.vulnerabilityId] })],
);

/* ================================================================
 * Opatření a shoda (SoA)
 * ================================================================ */

export const controlCategoryEnum = pgEnum("control_category", CONTROL_CATEGORIES);
export const controlStatusEnum = pgEnum("control_status", CONTROL_STATUSES);
export const effectivenessEnum = pgEnum("control_effectiveness", EFFECTIVENESS);
export const complianceEnum = pgEnum("compliance_level", COMPLIANCE);
export const actionStatusEnum = pgEnum("treatment_action_status", ACTION_STATUSES);
export const biaStatusEnum = pgEnum("bia_status", BIA_STATUSES);

/** Bezpečnostní opatření organizace. */
export const controls = pgTable(
  "controls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 500 }).notNull(),
    description: text("description"),
    category: controlCategoryEnum("category").notNull().default("organizational"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    status: controlStatusEnum("status").notNull().default("not_implemented"),
    implementation: text("implementation"),
    evidence: text("evidence"),
    effectiveness: effectivenessEnum("effectiveness").notNull().default("not_assessed"),
    plannedDate: date("planned_date"),
    priority: smallint("priority"),
    lastReviewAt: date("last_review_at"),
    ...timestamps,
  },
  (t) => [index("controls_status_idx").on(t.status)],
);

/** Opatření ↔ požadavek rámce (ID požadavku z packages/shared/frameworks). */
export const controlRequirements = pgTable(
  "control_requirements",
  {
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
    requirementId: varchar("requirement_id", { length: 100 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.controlId, t.requirementId] }), index("control_req_req_idx").on(t.requirementId)],
);

export const controlAssets = pgTable(
  "control_assets",
  {
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.controlId, t.assetId] })],
);

export const riskControls = pgTable(
  "risk_controls",
  {
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.riskId, t.controlId] }), index("risk_controls_control_idx").on(t.controlId)],
);

/** Historie přehodnocení rizika – rozhodnutí vlastníka s podněty v okamžiku rozhodnutí (ADR-058). */
export const riskReviews = pgTable(
  "risk_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    decision: varchar("decision", { length: 20 }).notNull(),
    note: text("note"),
    triggers: jsonb("triggers").$type<RiskTrigger[]>().notNull().default([]),
    levelBefore: varchar("level_before", { length: 20 }),
    levelAfter: varchar("level_after", { length: 20 }),
    scoreBefore: integer("score_before"),
    scoreAfter: integer("score_after"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("risk_reviews_risk_idx").on(t.riskId, t.createdAt)],
);

/** Posouzení požadavku – prohlášení o aplikovatelnosti / přehled bezpečnostních opatření. */
export const requirementAssessments = pgTable("requirement_assessments", {
  companyId: companyRef(),
  requirementId: varchar("requirement_id", { length: 100 }).notNull(),
  applicable: boolean("applicable").notNull().default(true),
  justification: text("justification"),
  compensating: text("compensating"),
  compliance: complianceEnum("compliance"),
  implementationNote: text("implementation_note"),
  priority: smallint("priority"),
  dueDate: date("due_date"),
  ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
}, (t) => [primaryKey({ columns: [t.companyId, t.requirementId] })]);

/** Plán zvládání rizik – akce (§ 8 odst. 1 písm. g vyhl. 409/2025). */
export const riskTreatmentActions = pgTable(
  "risk_treatment_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
    controlId: uuid("control_id").references(() => controls.id, { onDelete: "set null" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    objective: text("objective"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    resourcesHuman: text("resources_human"),
    resourcesFinancial: text("resources_financial"),
    resourcesTechnical: text("resources_technical"),
    costEstimate: real("cost_estimate"),
    dueDate: date("due_date"),
    realization: text("realization"),
    status: actionStatusEnum("status").notNull().default("planned"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("rta_risk_idx").on(t.riskId), index("rta_due_idx").on(t.dueDate)],
);

/* ================================================================
 * Kontinuita – analýza dopadů (BIA), § 15 vyhl. 409/2025
 * ================================================================ */

export const biaAssessments = pgTable(
  "bia_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    status: biaStatusEnum("status").notNull().default("draft"),
    assessedAt: date("assessed_at"),
    impacts: jsonb("impacts").$type<Record<string, Record<string, number>>>().notNull().default({}),
    mtpdHours: real("mtpd_hours"),
    rtoHours: real("rto_hours"),
    rpoHours: real("rpo_hours"),
    minServiceLevel: text("min_service_level"),
    peakPeriods: text("peak_periods"),
    dependencies: text("dependencies"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [uniqueIndex("bia_process_uq").on(t.processId)],
);

/* ================================================================
 * Verze dokumentů ISMS (SoA, zpráva o hodnocení rizik, plán zvládání)
 * ================================================================ */

export const docKindEnum = pgEnum("doc_kind", DOC_KINDS);
export const docStatusEnum = pgEnum("doc_status", DOC_STATUSES);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    kind: docKindEnum("kind").notNull(),
    /** Rámec u SoA (cz409, cz410, …); u ostatních prázdný řetězec. */
    framework: varchar("framework", { length: 20 }).notNull().default(""),
    version: integer("version").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    status: docStatusEnum("status").notNull().default("draft"),
    note: text("note"),
    snapshot: jsonb("snapshot").notNull(),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    ...timestamps,
  },
  (t) => [uniqueIndex("document_versions_uq").on(t.companyId, t.kind, t.framework, t.version)],
);

/** Prokazatelné seznámení (§ 4 odst. 2 vyhl. 409/2025). */
export const documentAcknowledgements = pgTable(
  "document_acknowledgements",
  {
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.userId] })],
);

/* ================================================================
 * Plány kontinuity a obnovy (§ 15 písm. e vyhl. 409/2025)
 * ================================================================ */

export const planTypeEnum = pgEnum("plan_type", PLAN_TYPES);
export const planStatusEnum = pgEnum("plan_status", PLAN_STATUSES);
export const testTypeEnum = pgEnum("plan_test_type", TEST_TYPES);
export const testResultEnum = pgEnum("plan_test_result", TEST_RESULTS);

export const continuityPlans = pgTable("continuity_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
  code: varchar("code", { length: 50 }),
  name: varchar("name", { length: 300 }).notNull(),
  planType: planTypeEnum("plan_type").notNull().default("continuity"),
  status: planStatusEnum("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
  purpose: text("purpose"),
  scope: text("scope"),
  activation: text("activation"),
  strategy: text("strategy"),
  steps: jsonb("steps").$type<PlanStep[]>().notNull().default([]),
  contacts: jsonb("contacts").$type<PlanContact[]>().notNull().default([]),
  resources: text("resources"),
  rtoTargetHours: real("rto_target_hours"),
  testIntervalMonths: integer("test_interval_months").notNull().default(12),
  lastReviewAt: date("last_review_at"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const planProcesses = pgTable(
  "plan_processes",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => continuityPlans.id, { onDelete: "cascade" }),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.planId, t.processId] })],
);

export const planAssets = pgTable(
  "plan_assets",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => continuityPlans.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.planId, t.assetId] })],
);

export const planTests = pgTable(
  "plan_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => continuityPlans.id, { onDelete: "cascade" }),
    testedAt: date("tested_at").notNull(),
    testType: testTypeEnum("test_type").notNull(),
    scenario: text("scenario"),
    participants: text("participants"),
    result: testResultEnum("result").notNull(),
    achievedRtoHours: real("achieved_rto_hours"),
    findings: text("findings"),
    improvements: text("improvements"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plan_tests_plan_idx").on(t.planId, t.testedAt)],
);

/** Cvičení a tabletop scénáře (ADR-066). */
export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    seq: serial("seq").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    exerciseType: testTypeEnum("exercise_type").notNull().default("tabletop"),
    scenarioKey: varchar("scenario_key", { length: 40 }),
    scenario: text("scenario").notNull().default(""),
    objectives: jsonb("objectives").$type<{ text: string; met: boolean | null; note: string }[]>().notNull().default([]),
    injects: jsonb("injects").$type<{ offsetMin: number; text: string; expected: string }[]>().notNull().default([]),
    participants: jsonb("participants").$type<{ positionId: string | null; name: string; role: string }[]>().notNull().default([]),
    plannedAt: date("planned_at"),
    facilitatorPositionId: uuid("facilitator_position_id").references(() => positions.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).notNull().default("planned"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    log: jsonb("log").$type<{ at: string; kind: string; text: string; userId: string | null; injectIndex?: number }[]>().notNull().default([]),
    result: testResultEnum("result"),
    achievedRtoHours: real("achieved_rto_hours"),
    findings: text("findings").notNull().default(""),
    lessons: text("lessons").notNull().default(""),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("exercises_company_idx").on(t.companyId, t.status)],
);

export const exercisePlans = pgTable(
  "exercise_plans",
  {
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => continuityPlans.id, { onDelete: "cascade" }),
    planTestId: uuid("plan_test_id").references(() => planTests.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.exerciseId, t.planId] })],
);

/* ================================================================
 * Dodavatelé (§ 9 vyhl. 409/2025, § 3 odst. 5 vyhl. 410/2025)
 * ================================================================ */

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
  name: varchar("name", { length: 300 }).notNull(),
  ico: varchar("ico", { length: 20 }),
  address: text("address"),
  country: varchar("country", { length: 100 }),
  contactName: varchar("contact_name", { length: 200 }),
  contactEmail: varchar("contact_email", { length: 200 }),
  contactPhone: varchar("contact_phone", { length: 50 }),
  supplyDescription: text("supply_description"),
  significant: boolean("significant").notNull().default(false),
  significanceReason: text("significance_reason"),
  dataOutsideCz: boolean("data_outside_cz").notNull().default(false),
  rulesAcknowledgedAt: date("rules_acknowledged_at"),
  notifiedAt: date("notified_at"),
  notificationRef: varchar("notification_ref", { length: 200 }),
  riskAssessedAt: date("risk_assessed_at"),
  lastReviewAt: date("last_review_at"),
  reviewIntervalMonths: integer("review_interval_months").notNull().default(12),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  notes: text("notes"),
  /** DORA – poskytovatel služeb IKT (ADR-069). */
  dora: jsonb("dora").$type<Partial<DoraProvider>>().notNull().default({}),
  ...timestamps,
});

export const supplierContracts = pgTable("supplier_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 300 }).notNull(),
  number: varchar("number", { length: 100 }),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  clauseSet: varchar("clause_set", { length: 10 }).notNull().default("cz409"),
  clauses: jsonb("clauses").$type<Record<string, ClauseState>>().notNull().default({}),
  sla: text("sla"),
  exitStrategy: text("exit_strategy"),
  documentUrl: text("document_url"),
  note: text("note"),
  /** DORA – údaje smluvního ujednání pro registr informací (ADR-069). */
  dora: jsonb("dora").$type<Partial<DoraContract>>().notNull().default({}),
  ...timestamps,
});

/** DORA – funkce (procesy) podporované smluvním ujednáním (B_02.02.0050). */
export const supplierContractProcesses = pgTable(
  "supplier_contract_processes",
  {
    contractId: uuid("contract_id")
      .notNull()
      .references(() => supplierContracts.id, { onDelete: "cascade" }),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contractId, t.processId] }), index("supplier_contract_processes_process_idx").on(t.processId)],
);

/** Přílohy dodavatele k bezpečnostnímu dotazníku (ADR-040) – nahrává dodavatel přes odkaz, typ podle přípony. */
export const supplierQuestionnaireFiles = pgTable(
  "supplier_questionnaire_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionnaireId: uuid("questionnaire_id")
      .notNull()
      .references(() => supplierQuestionnaires.id, { onDelete: "cascade" }),
    /** Otázka, ke které soubor patří (null = obecná příloha). */
    questionKey: varchar("question_key", { length: 60 }),
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 150 }).notNull(),
    size: integer("size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("supplier_questionnaire_files_q_idx").on(t.questionnaireId)],
);

/** Úkoly (ADR-043) – samostatné nebo navázané na libovolný záznam; v přehledu akcí spolu s akcemi z jiných modulů. */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    /** Pořadové číslo v rámci instance (Ú-1, Ú-2…). */
    seq: serial("seq").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    sourceKind: varchar("source_kind", { length: 30 }),
    sourceId: uuid("source_id"),
    /** Krok playbooku alertu SOC (ADR-060). */
    sourceStep: smallint("source_step"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    priority: varchar("priority", { length: 10 }).notNull().default("medium"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completionNote: text("completion_note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("tasks_source_idx").on(t.sourceKind, t.sourceId), index("tasks_due_idx").on(t.dueDate)],
);

/** Měsíční snímky ukazatelů (trendy, ADR-042); snímek běžného měsíce se přepisuje, uzavřené měsíce se nemění. */
export const trendSnapshots = pgTable(
  "trend_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    period: varchar("period", { length: 7 }).notNull(),
    values: jsonb("values").$type<Record<string, number | null>>().notNull().default({}),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trend_snapshots_company_period_uq").on(t.companyId, t.period)],
);

/** Bezpečnostní dotazníky pro dodavatele (ADR-040); odkaz pro dodavatele = token, v DB jen SHA-256. */
export const supplierQuestionnaires = pgTable(
  "supplier_questionnaires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 300 }).notNull(),
    template: varchar("template", { length: 10 }).notNull().default("cz409"),
    locale: varchar("locale", { length: 5 }).notNull().default("cs"),
    status: varchar("status", { length: 20 }).notNull().default("sent"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    sentTo: varchar("sent_to", { length: 200 }),
    message: text("message"),
    answers: jsonb("answers").$type<Record<string, { value: "yes" | "partial" | "no" | "na"; comment?: string | null; evidence?: string | null }>>().notNull().default({}),
    respondentName: varchar("respondent_name", { length: 200 }),
    respondentEmail: varchar("respondent_email", { length: 200 }),
    respondentRole: varchar("respondent_role", { length: 200 }),
    generalNote: text("general_note"),
    lastSavedAt: timestamp("last_saved_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    evaluatedById: uuid("evaluated_by_id").references(() => users.id, { onDelete: "set null" }),
    evaluationNote: text("evaluation_note"),
    riskId: uuid("risk_id").references(() => risks.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("supplier_questionnaires_token_uq").on(t.tokenHash), index("supplier_questionnaires_supplier_idx").on(t.supplierId)],
);

export const supplierAssets = pgTable(
  "supplier_assets",
  {
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.assetId] })],
);

export const supplierProcesses = pgTable(
  "supplier_processes",
  {
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.processId] })],
);

export const supplierRisks = pgTable(
  "supplier_risks",
  {
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    riskId: uuid("risk_id")
      .notNull()
      .references(() => risks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.riskId] })],
);

/** Zpráva o ujištění od dodavatele – SOC 2, SOC 1, ISO 27001, pentest (v1.03, ADR-098). */
export const supplierReports = pgTable(
  "supplier_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).$type<SupplierReportKind>().notNull().default("soc2_type2"),
    title: varchar("title", { length: 300 }).notNull(),
    serviceAuditor: varchar("service_auditor", { length: 300 }),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    asOf: date("as_of"),
    opinion: varchar("opinion", { length: 20 }).$type<ReportOpinion>(),
    validUntil: date("valid_until"),
    bridgeUntil: date("bridge_until"),
    subserviceOrgs: text("subservice_orgs").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    fileName: varchar("file_name", { length: 255 }),
    fileMime: varchar("file_mime", { length: 100 }),
    fileSize: integer("file_size"),
    fileSha256: varchar("file_sha256", { length: 64 }),
    fileContent: bytea("file_content"),
    /** Text zprávy pro AI (z PDF přes převodní službu, nebo vložený ručně). */
    text: text("text"),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("supplier_reports_supplier_idx").on(t.supplierId), index("supplier_reports_company_idx").on(t.companyId, t.validUntil)],
);

export const supplierReportItems = pgTable(
  "supplier_report_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => supplierReports.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).$type<ReportItemKind>().notNull(),
    ref: varchar("ref", { length: 100 }),
    text: text("text").notNull(),
    criterion: varchar("criterion", { length: 50 }),
    controlId: uuid("control_id").references(() => controls.id, { onDelete: "set null" }),
    status: varchar("status", { length: 20 }).$type<ReportItemStatus>().notNull().default("open"),
    severity: varchar("severity", { length: 10 }).$type<ReportItemSeverity>(),
    managementResponse: text("management_response"),
    note: text("note"),
    riskId: uuid("risk_id").references(() => risks.id, { onDelete: "set null" }),
    source: varchar("source", { length: 10 }).$type<"manual" | "ai">().notNull().default("manual"),
    ...timestamps,
  },
  (t) => [index("supplier_report_items_report_idx").on(t.reportId), index("supplier_report_items_control_idx").on(t.controlId)],
);

/* ============ Dotazníky zákazníků a Trust Center (v1.04, ADR-099) ============ */

export const customerQuestionnaires = pgTable(
  "customer_questionnaires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    customer: varchar("customer", { length: 200 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    dueDate: date("due_date"),
    status: varchar("status", { length: 20 }).$type<CustomerQStatus>().notNull().default("in_progress"),
    fileName: varchar("file_name", { length: 255 }),
    fileContent: bytea("file_content"),
    sheet: varchar("sheet", { length: 100 }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("customer_q_company_idx").on(t.companyId, t.status)],
);

export const customerQuestionnaireItems = pgTable(
  "customer_questionnaire_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionnaireId: uuid("questionnaire_id")
      .notNull()
      .references(() => customerQuestionnaires.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** Řádek v původním souboru (pro export). */
    sourceRow: integer("source_row"),
    ref: varchar("ref", { length: 100 }),
    section: varchar("section", { length: 300 }),
    question: text("question").notNull(),
    answer: varchar("answer", { length: 10 }).$type<QaAnswer>(),
    answerText: text("answer_text"),
    sources: jsonb("sources").$type<QaSource[]>().notNull().default([]),
    status: varchar("status", { length: 10 }).$type<QaItemStatus>().notNull().default("empty"),
    confidence: varchar("confidence", { length: 10 }).$type<"low" | "medium" | "high">(),
    answeredBy: varchar("answered_by", { length: 10 }).$type<"ai" | "user" | "library">(),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("customer_q_items_q_idx").on(t.questionnaireId, t.seq)],
);

/** Knihovna schválených odpovědí – plní se schválením dotazníku nebo ručně. */
export const answerLibrary = pgTable(
  "answer_library",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    question: text("question").notNull(),
    /** Normalizovaná otázka (párování při ukládání bez duplicit). */
    questionKey: varchar("question_key", { length: 500 }).notNull(),
    answer: varchar("answer", { length: 10 }).$type<QaAnswer>(),
    answerText: text("answer_text"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    sources: jsonb("sources").$type<QaSource[]>().notNull().default([]),
    usage: integer("usage").notNull().default(0),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("answer_library_key_uq").on(t.companyId, t.questionKey)],
);

export const trustCenters = pgTable(
  "trust_centers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef().unique(),
    enabled: boolean("enabled").notNull().default(false),
    slug: varchar("slug", { length: 50 }).notNull().unique(),
    settings: jsonb("settings").$type<TrustSettings>().notNull(),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
);

export const trustAccessRequests = pgTable(
  "trust_access_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trustCenterId: uuid("trust_center_id")
      .notNull()
      .references(() => trustCenters.id, { onDelete: "cascade" }),
    companyId: companyRef(),
    name: varchar("name", { length: 200 }).notNull(),
    email: varchar("email", { length: 200 }).notNull(),
    organization: varchar("organization", { length: 200 }).notNull(),
    reason: text("reason"),
    ndaAcceptedAt: timestamp("nda_accepted_at", { withTimezone: true }).notNull(),
    ip: varchar("ip", { length: 64 }),
    status: varchar("status", { length: 20 }).$type<TrustRequestStatus>().notNull().default("pending"),
    /** SHA-256 přístupového tokenu (token jen v odkazu pro žadatele). */
    tokenHash: varchar("token_hash", { length: 64 }).unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    downloads: integer("downloads").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("trust_requests_tc_idx").on(t.trustCenterId, t.status), index("trust_requests_email_idx").on(t.email)],
);

/* ============ Řízení ISMS: změny (§ 11 vyhl. 409), cíle ISMS ============ */

export const changeTypeEnum = pgEnum("change_type", CHANGE_TYPES);
export const changeStatusEnum = pgEnum("change_status", CHANGE_STATUSES);
export const changeDecisionEnum = pgEnum("change_decision", CHANGE_DECISIONS);
export const objectiveStatusEnum = pgEnum("objective_status", OBJECTIVE_STATUSES);

export const changes = pgTable(
  "changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    changeType: changeTypeEnum("change_type").notNull().default("technical"),
    status: changeStatusEnum("status").notNull().default("proposed"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    requestedBy: varchar("requested_by", { length: 200 }),
    plannedAt: date("planned_at"),
    implementedAt: date("implemented_at"),
    affectsSecurity: boolean("affects_security").notNull().default(false),
    significant: boolean("significant").notNull().default(false),
    criteria: jsonb("criteria").$type<string[]>().notNull().default([]),
    significanceReason: text("significance_reason"),
    riskAssessment: text("risk_assessment"),
    measures: text("measures"),
    docsUpdatedAt: date("docs_updated_at"),
    docsNote: text("docs_note"),
    testedAt: date("tested_at"),
    testResult: text("test_result"),
    rollbackPlan: text("rollback_plan"),
    pentest: changeDecisionEnum("pentest").notNull().default("not_assessed"),
    pentestNote: text("pentest_note"),
    audit: changeDecisionEnum("audit").notNull().default("not_assessed"),
    auditNote: text("audit_note"),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("changes_status_idx").on(t.status), index("changes_significant_idx").on(t.significant)],
);

const changeLink = <N extends string>(name: N, col: string, target: () => any) =>
  pgTable(
    name,
    {
      changeId: uuid("change_id")
        .notNull()
        .references(() => changes.id, { onDelete: "cascade" }),
      targetId: uuid(col)
        .notNull()
        .references(target, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.changeId, t.targetId] })],
  );

export const changeAssets = changeLink("change_assets", "asset_id", () => assets.id);
export const changeProcesses = changeLink("change_processes", "process_id", () => processes.id);
export const changeRisks = changeLink("change_risks", "risk_id", () => risks.id);
export const changeControls = changeLink("change_controls", "control_id", () => controls.id);
export const changeSuppliers = changeLink("change_suppliers", "supplier_id", () => suppliers.id);

export const ismsObjectives = pgTable("isms_objectives", {
  id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
  code: varchar("code", { length: 50 }),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  metric: varchar("metric", { length: 500 }),
  target: varchar("target", { length: 200 }),
  currentValue: varchar("current_value", { length: 200 }),
  status: objectiveStatusEnum("status").notNull().default("not_evaluated"),
  evaluation: text("evaluation"),
  evaluatedAt: date("evaluated_at"),
  dueDate: date("due_date"),
  ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
  ...timestamps,
});

/* ============ Incidenty (§ 14 vyhl. 409, § 15–16 zákona) ============ */

export const incidentKindEnum = pgEnum("incident_kind", INCIDENT_KINDS);
export const incidentStatusEnum = pgEnum("incident_status", INCIDENT_STATUSES);
export const incidentCategoryEnum = pgEnum("incident_category", INCIDENT_CATEGORIES);
export const incidentCauseEnum = pgEnum("incident_cause", INCIDENT_CAUSES);
export const authorityDecisionEnum = pgEnum("authority_decision", AUTHORITY_DECISIONS);
export const reportTypeEnum = pgEnum("incident_report_type", REPORT_TYPES);
export const reportRecipientEnum = pgEnum("incident_report_recipient", REPORT_RECIPIENTS);
export const reportChannelEnum = pgEnum("incident_report_channel", REPORT_CHANNELS);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    kind: incidentKindEnum("kind").notNull().default("unassessed"),
    status: incidentStatusEnum("status").notNull().default("new"),
    category: incidentCategoryEnum("category").notNull().default("other"),
    cause: incidentCauseEnum("cause").notNull().default("unknown"),
    reportedBy: varchar("reported_by", { length: 200 }),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    inScope: boolean("in_scope").notNull().default(true),
    cyberOrigin: boolean("cyber_origin").notNull().default(true),
    intentExcluded: boolean("intent_excluded").notNull().default(false),
    toleranceExceeded: boolean("tolerance_exceeded").notNull().default(false),
    significanceAreas: jsonb("significance_areas").$type<Record<string, boolean>>().notNull().default({}),
    significanceNote: text("significance_note"),
    authorityDecision: authorityDecisionEnum("authority_decision").notNull().default("pending"),
    suspectedUnlawful: boolean("suspected_unlawful").notNull().default(false),
    crossBorder: boolean("cross_border").notNull().default(false),
    personalDataBreach: boolean("personal_data_breach").notNull().default(false),
    affectedUsers: integer("affected_users"),
    downtimeHours: real("downtime_hours"),
    financialLoss: real("financial_loss"),
    impactDescription: text("impact_description"),
    indicators: text("indicators"),
    evidence: text("evidence"),
    containment: text("containment"),
    rootCause: text("root_cause"),
    lessonsLearned: text("lessons_learned"),
    timeline: jsonb("timeline").$type<TimelineEntry[]>().notNull().default([]),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("incidents_detected_idx").on(t.detectedAt), index("incidents_status_idx").on(t.status)],
);

export const incidentReports = pgTable("incident_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  reportType: reportTypeEnum("report_type").notNull(),
  recipient: reportRecipientEnum("recipient").notNull().default("nukib"),
  channel: reportChannelEnum("channel").notNull().default("portal"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
  reference: varchar("reference", { length: 200 }),
  summary: text("summary"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const incidentLink = <N extends string>(name: N, col: string, target: () => any) =>
  pgTable(
    name,
    {
      incidentId: uuid("incident_id")
        .notNull()
        .references(() => incidents.id, { onDelete: "cascade" }),
      targetId: uuid(col)
        .notNull()
        .references(target, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.incidentId, t.targetId] })],
  );

export const incidentAssets = incidentLink("incident_assets", "asset_id", () => assets.id);
export const incidentProcesses = incidentLink("incident_processes", "process_id", () => processes.id);
export const incidentRisks = incidentLink("incident_risks", "risk_id", () => risks.id);
export const incidentControls = incidentLink("incident_controls", "control_id", () => controls.id);
export const incidentSuppliers = incidentLink("incident_suppliers", "supplier_id", () => suppliers.id);

/* ============ Audity kybernetické bezpečnosti (§ 16 vyhl. 409) ============ */

export const auditTypeEnum = pgEnum("audit_type", AUDIT_TYPES);
export const auditStatusEnum = pgEnum("audit_status", AUDIT_STATUSES);
export const findingSeverityEnum = pgEnum("finding_severity", FINDING_SEVERITIES);
export const findingStatusEnum = pgEnum("finding_status", FINDING_STATUSES);

export const audits = pgTable("audits", {
  id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
  code: varchar("code", { length: 50 }),
  title: varchar("title", { length: 300 }).notNull(),
  auditType: auditTypeEnum("audit_type").notNull().default("regular"),
  status: auditStatusEnum("status").notNull().default("planned"),
  sections: jsonb("sections").$type<string[]>().notNull().default([]),
  scope: text("scope"),
  plannedStart: date("planned_start"),
  plannedEnd: date("planned_end"),
  performedStart: date("performed_start"),
  performedEnd: date("performed_end"),
  auditorName: varchar("auditor_name", { length: 200 }),
  auditorPositionId: uuid("auditor_position_id").references(() => positions.id, { onDelete: "set null" }),
  auditorExternal: boolean("auditor_external").notNull().default(false),
  auditorQualified: boolean("auditor_qualified").notNull().default(false),
  auditorIndependent: boolean("auditor_independent").notNull().default(false),
  conclusion: text("conclusion"),
  reportRef: varchar("report_ref", { length: 300 }),
  managementInformedAt: date("management_informed_at"),
  /** Metodika auditu (kontrolní seznam) – id vestavěné nebo importované metodiky. */
  methodologyKey: varchar("methodology_key", { length: 60 }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  ...timestamps,
});

export const auditChanges = pgTable(
  "audit_changes",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    changeId: uuid("change_id")
      .notNull()
      .references(() => changes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.auditId, t.changeId] })],
);

/** Portál externího auditora (ADR-071): přidělení auditoři, požadavky na podklady, soubory, připomínky. */
export const auditAuditors = pgTable(
  "audit_auditors",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.auditId, t.userId] }), index("audit_auditors_user_idx").on(t.userId)],
);

export const auditRequests = pgTable(
  "audit_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    reference: varchar("reference", { length: 100 }),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("audit_requests_seq_uq").on(t.auditId, t.seq), index("audit_requests_owner_idx").on(t.ownerPositionId)],
);

export const auditRequestFiles = pgTable(
  "audit_request_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => auditRequests.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 150 }).notNull(),
    size: integer("size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    /** Soubor je zpřístupněn auditorovi (nastaví se při odeslání požadavku). */
    shared: boolean("shared").notNull().default(false),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_request_files_req_idx").on(t.requestId)],
);

export const auditRequestComments = pgTable(
  "audit_request_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => auditRequests.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    external: boolean("external").notNull().default(false),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_request_comments_req_idx").on(t.requestId)],
);

export const auditFindings = pgTable("audit_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  auditId: uuid("audit_id")
    .notNull()
    .references(() => audits.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 50 }),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  severity: findingSeverityEnum("severity").notNull().default("minor"),
  status: findingStatusEnum("status").notNull().default("open"),
  requirementId: varchar("requirement_id", { length: 100 }),
  correctiveAction: text("corrective_action"),
  ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  closedAt: date("closed_at"),
  verification: text("verification"),
  riskId: uuid("risk_id").references(() => risks.id, { onDelete: "set null" }),
  awareness: boolean("awareness").notNull().default(false),
  /** Opatření, kterého se zjištění týká (v1.05). */
  controlId: uuid("control_id").references(() => controls.id, { onDelete: "set null" }),
  /** Výjimka zprávy SOC 2 zjištěná testem opatření (ADR-091). */
  controlTestId: uuid("control_test_id").references((): AnyPgColumn => controlTests.id, { onDelete: "set null" }),
  ...timestamps,
});

/* ============ Metodiky (YAML / JSON / XML) ============ */

export const methodologies = pgTable("methodologies", {
  /** Id z definice (slug). */
  id: varchar("id", { length: 40 }).primaryKey(),
  kind: varchar("kind", { length: 10 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  version: varchar("version", { length: 50 }).notNull().default("1.0"),
  format: varchar("format", { length: 10 }).notNull(),
  /** Původní text importu (pro export a audit změn). */
  source: text("source").notNull(),
  definition: jsonb("definition").$type<MethodologyDef>().notNull(),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const auditCheckResultEnum = pgEnum("audit_check_result", AUDIT_CHECK_RESULTS);

/** Výsledky položek kontrolního seznamu auditu. */
export const auditChecks = pgTable(
  "audit_checks",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    itemId: varchar("item_id", { length: 60 }).notNull(),
    result: auditCheckResultEnum("result").notNull().default("not_checked"),
    note: text("note"),
    findingId: uuid("finding_id").references(() => auditFindings.id, { onDelete: "set null" }),
    checkedById: uuid("checked_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.auditId, t.itemId] })],
);

/* ================================================================
 * Bezpečnostní politika a dokumentace (§ 6 vyhl. 409/2025)
 * ================================================================ */

export const policyTypeEnum = pgEnum("policy_type", POLICY_TYPES);
export const policyStatusEnum = pgEnum("policy_status", POLICY_STATUSES);
export const policyVersionStatusEnum = pgEnum("policy_version_status", POLICY_VERSION_STATUSES);
export const classificationEnum = pgEnum("classification", CLASSIFICATIONS);
export const managementSystemEnum = pgEnum("management_system", MANAGEMENT_SYSTEMS);

export const policies = pgTable(
  "policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    title: varchar("title", { length: 300 }).notNull(),
    docType: policyTypeEnum("doc_type").notNull().default("directive"),
    /** Systém řízení / oblast (v0.33). */
    system: managementSystemEnum("system").notNull().default("isms"),
    status: policyStatusEnum("status").notNull().default("draft"),
    description: text("description"),
    sections: text("sections").array().notNull().default(sql`'{}'::text[]`),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    reviewerPositionId: uuid("reviewer_position_id").references(() => positions.id, { onDelete: "set null" }),
    approverPositionId: uuid("approver_position_id").references(() => positions.id, { onDelete: "set null" }),
    ackDueDays: smallint("ack_due_days").notNull().default(14),
    retrainOnNewVersion: boolean("retrain_on_new_version").notNull().default(false),
    quizPassPct: smallint("quiz_pass_pct").notNull().default(80),
    reviewMonths: smallint("review_months").notNull().default(12),
    classification: classificationEnum("classification").notNull().default("internal"),
    location: text("location"),
    audience: jsonb("audience").$type<Audience>().notNull().default(EMPTY_AUDIENCE),
    requireAcknowledgement: boolean("require_acknowledgement").notNull().default(true),
    lastReviewedAt: date("last_reviewed_at"),
    lastReviewNote: text("last_review_note"),
    folderId: uuid("folder_id").references((): AnyPgColumn => policyFolders.id, { onDelete: "set null" }),
    /** Nadřazený dokument (hierarchie dokumentace). */
    parentId: uuid("parent_id").references((): AnyPgColumn => policies.id, { onDelete: "set null" }),
    retentionYears: smallint("retention_years"),
    retentionMark: varchar("retention_mark", { length: 1 }),
    /** Spouštěcí událost skartační lhůty (zrušení dokumentu). */
    retiredAt: date("retired_at"),
    disposedAt: timestamp("disposed_at", { withTimezone: true }),
    disposedById: uuid("disposed_by_id").references(() => users.id, { onDelete: "set null" }),
    disposalMode: varchar("disposal_mode", { length: 20 }),
    disposalReference: varchar("disposal_reference", { length: 200 }),
    disposalNote: text("disposal_note"),
    ...timestamps,
  },
  (t) => [index("policies_company_idx").on(t.companyId)],
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    version: varchar("version", { length: 20 }).notNull(),
    status: policyVersionStatusEnum("status").notNull().default("draft"),
    changeSummary: text("change_summary"),
    content: text("content"),
    effectiveFrom: date("effective_from"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Rezervace k úpravě (check-out). */
    lockedById: uuid("locked_by_id").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("policy_versions_uq").on(t.policyId, t.version)],
);

export const policyAcknowledgements = pgTable(
  "policy_acknowledgements",
  {
    versionId: uuid("version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.userId] })],
);

export const policyControls = pgTable(
  "policy_controls",
  {
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.controlId] })],
);

/** Vazby dokumentu na další záznamy (v0.31) – dokument ↔ cíl, index na cíl pro zobrazení na jeho kartě. */
const policyLink = <N extends string>(name: N, col: string, target: () => any) =>
  pgTable(
    name,
    {
      policyId: uuid("policy_id")
        .notNull()
        .references(() => policies.id, { onDelete: "cascade" }),
      targetId: uuid(col)
        .notNull()
        .references(target, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.policyId, t.targetId] }), index(`${name}_target_idx`).on(t.targetId)],
  );
/** Související dokumenty – uloženo jednou, čte se v obou směrech. */
export const policyRelated = policyLink("policy_related", "related_id", () => policies.id);
export const policyProcesses = policyLink("policy_processes", "process_id", () => processes.id);
export const policyAssets = policyLink("policy_assets", "asset_id", () => assets.id);
export const policyRisks = policyLink("policy_risks", "risk_id", () => risks.id);
export const policySuppliers = policyLink("policy_suppliers", "supplier_id", () => suppliers.id);
export const policyRequirements = pgTable(
  "policy_requirements",
  {
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    requirementId: varchar("requirement_id", { length: 100 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.requirementId] }), index("policy_req_req_idx").on(t.requirementId)],
);

/* ================================================================
 * Bezpečnostní povědomí a školení (§ 10 vyhl. 409/2025)
 * ================================================================ */

export const courseKindEnum = pgEnum("course_kind", COURSE_KINDS);
export const courseFormEnum = pgEnum("course_form", COURSE_FORMS);
export const sessionStatusEnum = pgEnum("training_session_status", SESSION_STATUSES);

export const trainingCourses = pgTable(
  "training_courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    title: varchar("title", { length: 300 }).notNull(),
    kind: courseKindEnum("kind").notNull().default("periodic"),
    form: courseFormEnum("form").notNull().default("elearning"),
    description: text("description"),
    topics: text("topics").array().notNull().default(sql`'{}'::text[]`),
    audience: jsonb("audience").$type<Audience>().notNull().default(EMPTY_AUDIENCE),
    intervalMonths: smallint("interval_months"),
    dueDaysForNew: smallint("due_days_for_new"),
    durationHours: real("duration_hours"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("training_courses_company_idx").on(t.companyId)],
);

export const trainingSessions = pgTable("training_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => trainingCourses.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: sessionStatusEnum("status").notNull().default("planned"),
  trainer: varchar("trainer", { length: 200 }),
  location: varchar("location", { length: 300 }),
  note: text("note"),
  effectiveness: text("effectiveness"),
  ...timestamps,
});

export const trainingRecords = pgTable(
  "training_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => trainingCourses.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => trainingSessions.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    completedAt: date("completed_at").notNull(),
    score: real("score"),
    passed: boolean("passed").notNull().default(true),
    note: text("note"),
    recordedById: uuid("recorded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("training_records_course_user_idx").on(t.courseId, t.userId)],
);

export const trainingSessionParticipants = pgTable(
  "training_session_participants",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);

/* ================================================================
 * Odeslaná upozornění (deduplikace e-mailů / Teams)
 * ================================================================ */

export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Klíč povinnosti nebo souhrnu, např. "incident_report:<id>:early" / "digest:2026-10-02". */
    key: varchar("key", { length: 200 }).notNull(),
    channel: varchar("channel", { length: 20 }).notNull(),
    /** E-mail příjemce nebo "teams". */
    recipient: varchar("recipient", { length: 320 }).notNull(),
    urgency: varchar("urgency", { length: 20 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
  },
  (t) => [uniqueIndex("notification_log_uq").on(t.key, t.channel, t.recipient, t.urgency)],
);

/* ================================================================
 * Hodnotící cykly (roční hodnocení rizik a BIA)
 * ================================================================ */

export const cycleKindEnum = pgEnum("cycle_kind", CYCLE_KINDS);
export const cycleStatusEnum = pgEnum("cycle_status", CYCLE_STATUSES);
export const cycleReasonEnum = pgEnum("cycle_reason", CYCLE_REASONS);
export const cycleItemStateEnum = pgEnum("cycle_item_state", CYCLE_ITEM_STATES);

export const assessmentCycles = pgTable(
  "assessment_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    kind: cycleKindEnum("kind").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    reason: cycleReasonEnum("reason").notNull().default("regular"),
    status: cycleStatusEnum("status").notNull().default("in_progress"),
    changeId: uuid("change_id").references(() => changes.id, { onDelete: "set null" }),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    dueDate: date("due_date"),
    leaderPositionId: uuid("leader_position_id").references(() => positions.id, { onDelete: "set null" }),
    team: text("team"),
    scope: text("scope"),
    /** Metodika rizik v okamžiku zahájení. */
    methodologyKey: varchar("methodology_key", { length: 40 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvalNote: text("approval_note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("assessment_cycles_company_idx").on(t.companyId, t.kind)],
);

export const assessmentCycleItems = pgTable(
  "assessment_cycle_items",
  {
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => assessmentCycles.id, { onDelete: "cascade" }),
    /** Id rizika nebo BIA (bez FK – položka přežije smazání rizika jako historický záznam). */
    entityId: uuid("entity_id").notNull(),
    name: varchar("name", { length: 500 }).notNull(),
    code: varchar("code", { length: 50 }),
    state: cycleItemStateEnum("state").notNull().default("pending"),
    note: text("note"),
    before: jsonb("before").$type<CycleItemSnapshot>(),
    after: jsonb("after").$type<CycleItemSnapshot>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.entityId] })],
);

/* ================================================================
 * Návrhy událostí z Wazuh alertů
 * ================================================================ */

export const alertSuggestionStatusEnum = pgEnum("alert_suggestion_status", ALERT_SUGGESTION_STATUSES);

export const alertSuggestions = pgTable(
  "alert_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    source: varchar("source", { length: 20 }).notNull().default("wazuh"),
    /** Seskupení: pravidlo + agent. */
    groupKey: varchar("group_key", { length: 200 }).notNull(),
    ruleId: varchar("rule_id", { length: 50 }).notNull(),
    ruleLevel: smallint("rule_level").notNull(),
    description: text("description").notNull(),
    groups: text("groups").array().notNull().default(sql`'{}'::text[]`),
    agentId: varchar("agent_id", { length: 50 }),
    agentName: varchar("agent_name", { length: 255 }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
    status: alertSuggestionStatusEnum("status").notNull().default("new"),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    dismissReason: text("dismiss_reason"),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    sample: jsonb("sample").$type<Record<string, unknown>>(),
    /* ---- SOC (v0.51, ADR-046) ---- */
    /** Název ručně založeného alertu (u Wazuh = popis pravidla). */
    title: varchar("title", { length: 300 }),
    /** Analytik, který alert převzal. */
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    /** Verdikt při uzavření (SOC_VERDICTS). */
    verdict: varchar("verdict", { length: 20 }),
    mitreIds: text("mitre_ids").array().notNull().default(sql`'{}'::text[]`),
    mitreTactics: text("mitre_tactics").array().notNull().default(sql`'{}'::text[]`),
    playbookKey: varchar("playbook_key", { length: 40 }),
    playbookDone: jsonb("playbook_done").$type<number[]>().notNull().default([]),
    notes: jsonb("notes").$type<{ at: string; userId: string | null; text: string }[]>().notNull().default([]),
    aiAdvice: jsonb("ai_advice").$type<{ text: string; model: string | null; at: string; durationMs: number }>(),
    /** Shody s veřejnými zdroji IOC (ADR-057). */
    intel: jsonb("intel").$type<Record<string, unknown>[]>(),
    /** AI předběžná triáž (ADR-051) – jen návrh, nikdy se neaplikuje sám. */
    aiTriage: jsonb("ai_triage").$type<Record<string, unknown>>(),
    /** Vazba na otevřené zranitelnosti aktiva (ADR-048) – zvýšení závažnosti při pokusu o zneužití. */
    exposure: jsonb("exposure").$type<{ exploit: boolean; reason: "cve_match" | "exploit_technique" | "vulnerable_asset"; cves: string[]; highVulns: number }>(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Zdroj alertu přijatého webhookem (v0.57, ADR-052). */
    sourceId: uuid("source_id").references((): AnyPgColumn => socSources.id, { onDelete: "set null" }),
    /** Případ SOC, do kterého alert patří (v0.52). */
    caseId: uuid("case_id").references((): AnyPgColumn => socCases.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("alert_suggestions_key_idx").on(t.groupKey, t.status), index("alert_suggestions_company_idx").on(t.companyId, t.status), index("alert_suggestions_case_idx").on(t.caseId)],
);

/** Případ SOC – více souvisejících alertů (ADR-047); závažnost a lhůty se počítají při čtení. */
export const socCases = pgTable(
  "soc_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    seq: serial("seq").notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description").notNull().default(""),
    /** open | in_progress | escalated | closed */
    status: varchar("status", { length: 20 }).notNull().default("open"),
    /** Založen korelací (true) nebo analytikem. */
    auto: boolean("auto").notNull().default(false),
    /** Klíč korelace (host:<agent> / ip:<adresa>) u automatických případů. */
    correlationKey: varchar("correlation_key", { length: 200 }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    verdict: varchar("verdict", { length: 20 }),
    closeReason: text("close_reason"),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
    notes: jsonb("notes").$type<{ at: string; userId: string | null; text: string }[]>().notNull().default([]),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("soc_cases_company_idx").on(t.companyId, t.status)],
);

/** Informační servis regulátora (ADR-087): položky RSS (globální, párování zdroj + guid). */
export const infoFeedItems = pgTable(
  "info_feed_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedId: varchar("feed_id", { length: 40 }).notNull(),
    guid: varchar("guid", { length: 500 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    link: varchar("link", { length: 1000 }).notNull().default(""),
    summary: text("summary").notNull().default(""),
    category: varchar("category", { length: 200 }).notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("info_feed_items_uq").on(t.feedId, t.guid), index("info_feed_items_pub_idx").on(t.publishedAt)],
);

/** Posouzení položky informačního servisu za společnost (seznámení, zohlednění varování v hodnocení rizik). */
export const infoItemReviews = pgTable(
  "info_item_reviews",
  {
    /** Posouzení dopadu (ADR-088) – vlastní ID pro úkoly a vazby. */
    id: uuid("id").notNull().defaultRandom().unique(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => infoFeedItems.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Stav posouzení (INFO_ASSESSMENT_STATUSES); starší záznamy = vyřešeno. */
    status: varchar("status", { length: 20 }).notNull().default("resolved"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.companyId] })],
);

/** Dotčená aktiva posouzení (ADR-088). */
export const infoAssessmentAssets = pgTable(
  "info_assessment_assets",
  {
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => infoItemReviews.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.assessmentId, t.assetId] }), index("info_assessment_assets_asset_idx").on(t.assetId)],
);

/** Záznamy vzniklé z posouzení – riziko, úkol, bezpečnostní událost (ADR-088). */
export const infoAssessmentLinks = pgTable(
  "info_assessment_links",
  {
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => infoItemReviews.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assessmentId, t.kind, t.targetId] })],
);

/** Otevřená data o nahlášených incidentech (NÚKIB) – agregace měsíc × klasifikace × závažnost; nahrazuje se celý zdroj. */
export const infoIncidentStats = pgTable(
  "info_incident_stats",
  {
    source: varchar("source", { length: 40 }).notNull(),
    month: varchar("month", { length: 7 }).notNull(),
    classification: varchar("classification", { length: 100 }).notNull(),
    severity: varchar("severity", { length: 100 }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.month, t.classification, t.severity] })],
);

/** Veřejné zdroje IOC (ADR-057) – globální, nahrazuje se celý zdroj při stažení. */
export const threatIntel = pgTable(
  "threat_intel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: varchar("source", { length: 40 }).notNull(),
    type: varchar("type", { length: 10 }).notNull(),
    value: varchar("value", { length: 2000 }).notNull(),
    threat: varchar("threat", { length: 200 }),
    confidence: smallint("confidence"),
    firstSeen: timestamp("first_seen", { withTimezone: true }),
    reference: varchar("reference", { length: 500 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("threat_intel_uq").on(t.source, t.type, t.value), index("threat_intel_value_idx").on(t.type, t.value)],
);

/** Zásahy SOC se schválením (ADR-055) – návrh, rozhodnutí, provedení; nic se nemaže (záznam pro audit). */
export const socActions = pgTable(
  "soc_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    kind: varchar("kind", { length: 30 }).notNull(),
    target: varchar("target", { length: 500 }).notNull(),
    agentIds: text("agent_ids").array().notNull().default(sql`'{}'::text[]`),
    reason: text("reason").notNull(),
    /** proposed | approved | done | failed | rejected | cancelled */
    status: varchar("status", { length: 20 }).notNull().default("proposed"),
    alertId: uuid("alert_id").references(() => alertSuggestions.id, { onDelete: "set null" }),
    caseId: uuid("case_id").references(() => socCases.id, { onDelete: "set null" }),
    requestedById: uuid("requested_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    executedById: uuid("executed_by_id").references(() => users.id, { onDelete: "set null" }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: text("result"),
    ...timestamps,
  },
  (t) => [index("soc_actions_company_idx").on(t.companyId, t.status), index("soc_actions_alert_idx").on(t.alertId)],
);

/** Indikátory kompromitace (ADR-054) – jedna hodnota daného typu na společnost; platnost, akce, poslední hledání. */
export const socIocs = pgTable(
  "soc_iocs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    /** ip | domain | url | hash | email */
    type: varchar("type", { length: 10 }).notNull(),
    value: varchar("value", { length: 2000 }).notNull(),
    /** block | monitor */
    action: varchar("action", { length: 10 }).notNull().default("block"),
    note: text("note").notNull().default(""),
    validUntil: date("valid_until"),
    sourceAlertId: uuid("source_alert_id").references(() => alertSuggestions.id, { onDelete: "set null" }),
    lastHunt: jsonb("last_hunt").$type<Record<string, unknown>>(),
    /** Událost MISP, do které byl IOC sdílen (ADR-073). */
    mispEventId: varchar("misp_event_id", { length: 60 }),
    mispSharedAt: timestamp("misp_shared_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: uuid("revoked_by_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("soc_iocs_value_uq").on(t.companyId, t.type, t.value), index("soc_iocs_alert_idx").on(t.sourceAlertId)],
);

/** Obohacení IOC – běh analyzátoru Cortexu nebo dotaz do MISP (ADR-073); záznam se nemění, jen dokončí. */
export const socEnrichments = pgTable(
  "soc_enrichments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    /** cortex | misp */
    provider: varchar("provider", { length: 10 }).notNull(),
    analyzer: varchar("analyzer", { length: 200 }).notNull(),
    type: varchar("type", { length: 10 }).notNull(),
    value: varchar("value", { length: 2000 }).notNull(),
    /** running | done | failed */
    status: varchar("status", { length: 10 }).notNull().default("running"),
    jobId: varchar("job_id", { length: 100 }),
    verdict: varchar("verdict", { length: 12 }),
    taxonomies: jsonb("taxonomies").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
    report: jsonb("report").$type<unknown>(),
    error: text("error"),
    alertId: uuid("alert_id").references(() => alertSuggestions.id, { onDelete: "set null" }),
    iocId: uuid("ioc_id").references(() => socIocs.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("soc_enrichments_alert_idx").on(t.alertId), index("soc_enrichments_ioc_idx").on(t.iocId), index("soc_enrichments_value_idx").on(t.type, t.value)],
);

/** Vlastní playbooky SOC společnosti (ADR-060) – kroky s odpovědným funkčním místem a lhůtou. */
export const socPlaybooks = pgTable(
  "soc_playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    name: varchar("name", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    techniques: text("techniques").array().notNull().default(sql`'{}'::text[]`),
    tactics: text("tactics").array().notNull().default(sql`'{}'::text[]`),
    steps: jsonb("steps").$type<{ text: string; ownerPositionId: string | null; dueHours: number | null }[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    basedOn: varchar("based_on", { length: 40 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("soc_playbooks_company_idx").on(t.companyId)],
);

/** Plánované hledání hrozeb (ADR-059) – uložený dotaz do alertů Wazuh Indexeru. */
export const socHunts = pgTable(
  "soc_hunts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    name: varchar("name", { length: 200 }).notNull(),
    hypothesis: text("hypothesis").notNull().default(""),
    query: text("query").notNull(),
    groupBy: varchar("group_by", { length: 100 }).notNull().default("agent.id"),
    threshold: integer("threshold").notNull().default(1),
    intervalHours: integer("interval_hours").notNull().default(24),
    lookbackHours: integer("lookback_hours").notNull().default(24),
    severity: varchar("severity", { length: 10 }).notNull().default("medium"),
    mitreIds: text("mitre_ids").array().notNull().default(sql`'{}'::text[]`),
    enabled: boolean("enabled").notNull().default(true),
    templateKey: varchar("template_key", { length: 40 }),
    /** Poslední skutečný běh (zkušební běhy se neukládají). */
    lastRun: jsonb("last_run").$type<Record<string, unknown>>(),
    /** Konec okna, odkud pokračuje další běh (při chybě se neposouvá). */
    windowEnd: timestamp("window_end", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("soc_hunts_company_idx").on(t.companyId)],
);

/** Feedy IOC pro firewall / proxy (URL s tokenem, ukládá se jen SHA-256). */
export const socIocFeeds = pgTable(
  "soc_ioc_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    name: varchar("name", { length: 120 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
    fetches: integer("fetches").notNull().default(0),
    lastFetchAt: timestamp("last_fetch_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("soc_ioc_feeds_token_uq").on(t.tokenHash)],
);

/** Zdroje alertů SOC přijímané webhookem s tokenem (ADR-052); token se ukládá jen jako SHA-256. */
export const socSources = pgTable(
  "soc_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    name: varchar("name", { length: 120 }).notNull(),
    /** generic | suricata | defender | sentinel | elastic */
    preset: varchar("preset", { length: 20 }).notNull(),
    defaultSeverity: varchar("default_severity", { length: 10 }).notNull().default("medium"),
    enabled: boolean("enabled").notNull().default(true),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
    eventsTotal: integer("events_total").notNull().default(0),
    alertsCreated: integer("alerts_created").notNull().default(0),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    lastError: text("last_error"),
    /** Stahování ze SIEM (ADR-062): konfigurace bez tajemství, tajemství šifrovaně, kurzor = čas posledního staženého záznamu. */
    pullConfig: jsonb("pull_config").$type<Record<string, unknown>>(),
    secretEnc: text("secret_enc"),
    pullCursor: timestamp("pull_cursor", { withTimezone: true }),
    lastPullAt: timestamp("last_pull_at", { withTimezone: true }),
    lastPull: jsonb("last_pull").$type<Record<string, unknown>>(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("soc_sources_token_uq").on(t.tokenHash), index("soc_sources_company_idx").on(t.companyId)],
);

/** Pravidla potlačení opakovaných falešných poplachů (pravidlo + volitelně hostitel a IP, vždy s platností). */
/** Návrhy úprav pravidel Wazuh (v1.14, ADR-111) – strukturovaně, XML se generuje; do Wazuhu se nic nezapisuje. */
export const socRuleTunings = pgTable(
  "soc_rule_tunings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    seq: serial("seq").notNull(),
    ruleId: varchar("rule_id", { length: 20 }).notNull(),
    ruleDescription: text("rule_description").notNull().default(""),
    kind: varchar("kind", { length: 20 }).$type<TuningKind>().notNull(),
    conditions: jsonb("conditions").$type<TuningCondition[]>().notNull().default([]),
    newLevel: smallint("new_level"),
    rationale: text("rationale").notNull().default(""),
    source: varchar("source", { length: 10 }).$type<"manual" | "auto">().notNull().default("manual"),
    status: varchar("status", { length: 20 }).$type<TuningStatus>().notNull().default("draft"),
    simulation: jsonb("simulation").$type<TuningSimulation>(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (t) => [index("soc_rule_tunings_company_idx").on(t.companyId, t.status), index("soc_rule_tunings_rule_idx").on(t.ruleId)],
);

export const socSuppressions = pgTable(
  "soc_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    ruleId: varchar("rule_id", { length: 50 }).notNull(),
    agentId: varchar("agent_id", { length: 50 }),
    srcip: varchar("srcip", { length: 64 }),
    reason: text("reason").notNull(),
    until: date("until").notNull(),
    hits: integer("hits").notNull().default(0),
    lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
    sourceAlertId: uuid("source_alert_id").references(() => alertSuggestions.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: uuid("revoked_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("soc_suppressions_rule_idx").on(t.ruleId)],
);

/* ================================================================
 * AI asistent (v0.14) – návrhy ke schválení člověkem, auditní stopa
 * ================================================================ */

export const aiSuggestionStatusEnum = pgEnum("ai_suggestion_status", AI_SUGGESTION_STATUSES);

export const aiSuggestions = pgTable(
  "ai_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    useCase: varchar("use_case", { length: 50 }).notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(),
    entityId: uuid("entity_id").notNull(),
    status: aiSuggestionStatusEnum("status").notNull().default("proposed"),
    provider: varchar("provider", { length: 20 }).notNull(),
    model: varchar("model", { length: 200 }).notNull(),
    /** Minimalizovaný kontext odeslaný modelu (pro audit). */
    input: jsonb("input").notNull(),
    rawOutput: text("raw_output"),
    summary: text("summary"),
    items: jsonb("items").$type<unknown[]>().notNull().default([]),
    acceptedItems: jsonb("accepted_items").$type<number[]>().notNull().default([]),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps,
  },
  (t) => [index("ai_suggestions_entity_idx").on(t.entityType, t.entityId), index("ai_suggestions_created_idx").on(t.createdAt)],
);

/* ================================================================
 * Provoz – evidence záloh (zapisuje infra/scripts/backup.sh)
 * ================================================================ */

export const backupRuns = pgTable(
  "backup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: varchar("status", { length: 10 }).notNull(),
    file: varchar("file", { length: 500 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    encrypted: boolean("encrypted").notNull().default(false),
    host: varchar("host", { length: 200 }),
    message: text("message"),
  },
  (t) => [index("backup_runs_started_idx").on(t.startedAt)],
);

/* ================================================================
 * Důkazy a testování opatření (v0.15)
 * ================================================================ */


export const evidenceKindEnum = pgEnum("evidence_kind", EVIDENCE_KINDS);
export const testKindEnum = pgEnum("control_test_kind", TEST_KINDS);
export const testStatusEnum = pgEnum("control_test_status", TEST_STATUSES);
export const controlTestResultEnum = pgEnum("control_test_result", CONTROL_TEST_RESULTS);
export const sampleResultEnum = pgEnum("control_sample_result", SAMPLE_RESULTS);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    kind: evidenceKindEnum("kind").notNull().default("document"),
    url: varchar("url", { length: 2000 }),
    collectedAt: date("collected_at"),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    validUntil: date("valid_until"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("evidence_company_idx").on(t.companyId), index("evidence_valid_idx").on(t.validUntil)],
);

/** Soubory důkazů – v DB (zálohují se s databází, neměnné; nová verze = nový soubor). */
export const evidenceFiles = pgTable(
  "evidence_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 150 }).notNull(),
    size: integer("size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_files_ev_idx").on(t.evidenceId)],
);

export const evidenceControls = pgTable(
  "evidence_controls",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.evidenceId, t.controlId] }), index("evidence_controls_ctl_idx").on(t.controlId)],
);

/** Důkaz přímo k požadavku rámce (např. kritérium SOC 2) – doplňuje vazbu přes opatření. */
export const evidenceRequirements = pgTable(
  "evidence_requirements",
  {
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    requirementId: varchar("requirement_id", { length: 100 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.evidenceId, t.requirementId] }), index("evidence_req_req_idx").on(t.requirementId)],
);

export const controlTests = pgTable(
  "control_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
    kind: testKindEnum("kind").notNull().default("operating"),
    title: varchar("title", { length: 300 }),
    methods: jsonb("methods").$type<TestMethod[]>().notNull().default([]),
    frequency: varchar("frequency", { length: 20 }).$type<ControlFrequency>(),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    dueDate: date("due_date"),
    status: testStatusEnum("status").notNull().default("planned"),
    tester: varchar("tester", { length: 200 }),
    populationSize: integer("population_size"),
    procedure: text("procedure"),
    tolerableExceptions: integer("tolerable_exceptions").notNull().default(0),
    result: controlTestResultEnum("result"),
    conclusion: text("conclusion"),
    performedAt: date("performed_at"),
    /** Test složený z běhů monitoru (ADR-096). */
    monitorId: uuid("monitor_id").references((): AnyPgColumn => controlMonitors.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("control_tests_ctl_idx").on(t.controlId), index("control_tests_due_idx").on(t.dueDate)],
);

export const controlTestSamples = pgTable(
  "control_test_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    testId: uuid("test_id")
      .notNull()
      .references(() => controlTests.id, { onDelete: "cascade" }),
    ref: varchar("ref", { length: 200 }).notNull(),
    description: text("description"),
    result: sampleResultEnum("result").notNull().default("pass"),
    note: text("note"),
    evidenceId: uuid("evidence_id").references(() => evidence.id, { onDelete: "set null" }),
    order: integer("order").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("control_test_samples_test_idx").on(t.testId)],
);

/* ================================================================
 * Verze procesů (v0.19)
 * ================================================================ */

export const processVersions = pgTable(
  "process_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    processId: uuid("process_id")
      .notNull()
      .references(() => processes.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    changeSummary: text("change_summary").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note"),
    ...timestamps,
  },
  (t) => [uniqueIndex("process_versions_uq").on(t.processId, t.number)],
);

/* ================================================================
 * GDPR – záznamy o činnostech zpracování (čl. 30) a DPIA (čl. 35) (v0.19)
 * ================================================================ */

export const processingActivities = pgTable(
  "processing_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 300 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    role: varchar("role", { length: 20 }).notNull().default("controller"),
    purpose: text("purpose").notNull().default(""),
    legalBasis: varchar("legal_basis", { length: 30 }),
    legalBasisNote: text("legal_basis_note"),
    dataSubjects: text("data_subjects").array().notNull().default(sql`'{}'::text[]`),
    dataCategories: text("data_categories").array().notNull().default(sql`'{}'::text[]`),
    specialCategories: text("special_categories").array().notNull().default(sql`'{}'::text[]`),
    recipients: text("recipients"),
    thirdCountryTransfers: text("third_country_transfers"),
    retention: text("retention"),
    securityMeasures: text("security_measures"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    dpiaCriteria: text("dpia_criteria").array().notNull().default(sql`'{}'::text[]`),
    reviewMonths: smallint("review_months").notNull().default(12),
    lastReviewedAt: date("last_reviewed_at"),
    ...timestamps,
  },
  (t) => [index("processing_activities_company_idx").on(t.companyId)],
);

const activityLink = <N extends string>(name: N, col: string, target: () => any) =>
  pgTable(
    name,
    {
      activityId: uuid("activity_id")
        .notNull()
        .references(() => processingActivities.id, { onDelete: "cascade" }),
      targetId: uuid(col)
        .notNull()
        .references(target, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.activityId, t.targetId] })],
  );

export const activityProcesses = activityLink("activity_processes", "process_id", () => processes.id);
export const activityAssets = activityLink("activity_assets", "asset_id", () => assets.id);
export const activitySuppliers = activityLink("activity_suppliers", "supplier_id", () => suppliers.id);
export const activityControls = activityLink("activity_controls", "control_id", () => controls.id);

export const dpias = pgTable("dpias", {
  id: uuid("id").primaryKey().defaultRandom(),
  activityId: uuid("activity_id")
    .notNull()
    .unique()
    .references(() => processingActivities.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  description: text("description"),
  necessity: text("necessity"),
  risks: jsonb("risks").$type<unknown[]>().notNull().default([]),
  dpoOpinion: text("dpo_opinion"),
  conclusion: text("conclusion"),
  priorConsultation: boolean("prior_consultation").notNull().default(false),
  nextReview: date("next_review"),
  approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  ...timestamps,
});

/* ================================================================
 * AI Act – registr AI systémů, klasifikace, povinnosti, FRIA (v0.95, ADR-090)
 * ================================================================ */

export const aiSystems = pgTable(
  "ai_systems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 300 }).notNull(),
    vendor: varchar("vendor", { length: 300 }),
    model: varchar("model", { length: 300 }),
    /** deployer | provider | provider_deployer */
    role: varchar("role", { length: 30 }).notNull().default("deployer"),
    source: varchar("source", { length: 20 }).notNull().default("saas"),
    /** proposed | approved | in_use | rejected | retired */
    status: varchar("status", { length: 20 }).notNull().default("proposed"),
    purpose: text("purpose").notNull().default(""),
    description: text("description"),
    users: text("users"),
    inputData: text("input_data"),
    outputs: text("outputs"),
    humanOversight: text("human_oversight"),
    dataLocation: varchar("data_location", { length: 500 }),
    instructionsUrl: text("instructions_url"),
    logRetentionMonths: smallint("log_retention_months"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    oversightPositionId: uuid("oversight_position_id").references(() => positions.id, { onDelete: "set null" }),
    /** Odpovědi screeningu (AiScreening) – třída rizika se počítá při čtení (classifyAiSystem). */
    screening: jsonb("screening").$type<Record<string, unknown>>(),
    screenedAt: timestamp("screened_at", { withTimezone: true }),
    /** Stav povinností { klíč: { status, note, at } } – seznam povinností se počítá z role a klasifikace. */
    obligations: jsonb("obligations").$type<Record<string, unknown>>().notNull().default({}),
    /** FRIA (čl. 27) – prvky a–f, oznámení orgánu dozoru, další přezkum. */
    fria: jsonb("fria").$type<Record<string, unknown>>(),
    friaStatus: varchar("fria_status", { length: 20 }),
    friaApprovedAt: timestamp("fria_approved_at", { withTimezone: true }),
    friaApprovedById: uuid("fria_approved_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    reviewMonths: smallint("review_months").notNull().default(12),
    lastReviewedAt: date("last_reviewed_at"),
    ...timestamps,
  },
  (t) => [index("ai_systems_company_idx").on(t.companyId)],
);

const aiSystemLink = <N extends string>(name: N, col: string, target: () => any) =>
  pgTable(
    name,
    {
      systemId: uuid("system_id")
        .notNull()
        .references(() => aiSystems.id, { onDelete: "cascade" }),
      targetId: uuid(col)
        .notNull()
        .references(target, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.systemId, t.targetId] })],
  );

export const aiSystemProcesses = aiSystemLink("ai_system_processes", "process_id", () => processes.id);
export const aiSystemAssets = aiSystemLink("ai_system_assets", "asset_id", () => assets.id);
export const aiSystemSuppliers = aiSystemLink("ai_system_suppliers", "supplier_id", () => suppliers.id);
export const aiSystemActivities = aiSystemLink("ai_system_activities", "activity_id", () => processingActivities.id);
/** AI systém ↔ rizika a opatření (v1.11, ADR-107). */
export const aiSystemRisks = aiSystemLink("ai_system_risks", "risk_id", () => risks.id);
export const aiSystemControls = aiSystemLink("ai_system_controls", "control_id", () => controls.id);

/**
 * Kompenzační opatření k výjimce nebo přijatému riziku (v1.11, ADR-107). Výjimka žije u svého záznamu,
 * proto klíč (druh, id záznamu) – id je text (neaplikované ustanovení má složený klíč společnost:požadavek).
 */
export const exceptionControls = pgTable(
  "exception_controls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    kind: varchar("kind", { length: 30 }).notNull(),
    recordId: varchar("record_id", { length: 200 }).notNull(),
    /** Název výjimky v době navázání (zpětné vazby u opatření). */
    title: varchar("title", { length: 500 }).notNull(),
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("exception_controls_uq").on(t.kind, t.recordId, t.controlId), index("exception_controls_control_idx").on(t.controlId)],
);

/* ================================================================
 * SOC 2 – zakázka auditora a zpráva Type I / Type II (v0.96, ADR-091)
 * ================================================================ */

export const soc2Engagements = pgTable(
  "soc2_engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    auditId: uuid("audit_id")
      .notNull()
      .unique()
      .references(() => audits.id, { onDelete: "cascade" }),
    reportType: varchar("report_type", { length: 10 }).notNull().default("type2"),
    categories: text("categories").array().notNull().default(sql`'{CC}'::text[]`),
    asOf: date("as_of"),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    systemName: varchar("system_name", { length: 300 }).notNull().default(""),
    serviceOrg: varchar("service_org", { length: 300 }),
    serviceAuditor: varchar("service_auditor", { length: 300 }),
    signatory: varchar("signatory", { length: 200 }),
    reportDate: date("report_date"),
    reportPlace: varchar("report_place", { length: 100 }),
    opinion: varchar("opinion", { length: 20 }).notNull().default("unmodified"),
    opinionBasis: text("opinion_basis"),
    assertion: text("assertion"),
    /** Oddíly popisu systému { klíč: text }. */
    description: jsonb("description").$type<Record<string, string>>().notNull().default({}),
    cuecs: jsonb("cuecs").$type<unknown[]>().notNull().default([]),
    subservice: jsonb("subservice").$type<unknown[]>().notNull().default([]),
    /** Pracovní papíry ke kritériím { kritérium: { conclusion, note, byId, at } }. */
    workpapers: jsonb("workpapers").$type<Record<string, unknown>>().notNull().default({}),
    otherInfo: text("other_info"),
    ...timestamps,
  },
  (t) => [index("soc2_engagements_company_idx").on(t.companyId)],
);

/* ================================================================
 * CRA – produkty s digitálními prvky, SBOM, hlášení čl. 14 (v0.97, ADR-092)
 * ================================================================ */

export const craProducts = pgTable(
  "cra_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    code: varchar("code", { length: 50 }),
    name: varchar("name", { length: 300 }).notNull(),
    version: varchar("version", { length: 100 }),
    productType: varchar("product_type", { length: 20 }).notNull().default("software"),
    role: varchar("role", { length: 20 }).notNull().default("manufacturer"),
    status: varchar("status", { length: 20 }).notNull().default("development"),
    oss: boolean("oss").notNull().default(false),
    description: text("description"),
    intendedPurpose: text("intended_purpose"),
    category: varchar("category", { length: 20 }),
    categoryItem: varchar("category_item", { length: 40 }),
    onMarketSince: date("on_market_since"),
    supportUntil: date("support_until"),
    supportJustification: text("support_justification"),
    conformityModule: varchar("conformity_module", { length: 10 }),
    harmonisedStandards: text("harmonised_standards"),
    notifiedBody: varchar("notified_body", { length: 300 }),
    ceMarkedAt: date("ce_marked_at"),
    docIssuedAt: date("doc_issued_at"),
    securityContact: varchar("security_contact", { length: 500 }),
    cvdPolicyUrl: text("cvd_policy_url"),
    manufacturerName: varchar("manufacturer_name", { length: 300 }),
    /** CPE 2.3 produktu – párování oznámení výrobce (CSAF) a NVD bez SBOM (v1.16, ADR-113). */
    cpe: varchar("cpe", { length: 500 }),
    memberStates: text("member_states").array().notNull().default(sql`'{}'::text[]`),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    /** Stav požadavků { klíč: { status, note, at } }. */
    requirements: jsonb("requirements").$type<Record<string, unknown>>().notNull().default({}),
    /** Dovozce / distributor: ověření dokladů výrobce { klíč: { status, note, url, at, byName } } (v1.16). */
    supplyChecks: jsonb("supply_checks").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("cra_products_company_idx").on(t.companyId)],
);

/* ================================================================
 * Rizikové scénáře z dat (v1.17, ADR-114)
 * ================================================================ */

/** Deklarace bezpečnostní schopnosti, kterou nelze změřit z dat (s důkazem) – za společnost. */
export const capabilityDeclarations = pgTable(
  "capability_declarations",
  {
    companyId: companyRef(),
    key: varchar("key", { length: 40 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    product: varchar("product", { length: 200 }),
    note: text("note"),
    url: text("url"),
    validUntil: date("valid_until"),
    declaredById: uuid("declared_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

/** Ochota riskovat po kategoriích (v1.23, ADR-120). */
export const riskAppetite = pgTable(
  "risk_appetite",
  {
    companyId: companyRef(),
    category: varchar("category", { length: 30 }).notNull(),
    maxLevel: varchar("max_level", { length: 20 }).notNull(),
    statement: text("statement"),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.category] })],
);

/** Schválení ochoty riskovat vedením (v1.23, ADR-120) – poslední schválení za společnost. */
export const riskAppetiteApprovals = pgTable("risk_appetite_approvals", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

/** Nastavení klíčových ukazatelů rizik a okamžik překročení (v1.23, ADR-120). Hodnota se nepersistuje. */
export const kriSettings = pgTable(
  "kri_settings",
  {
    companyId: companyRef(),
    key: varchar("key", { length: 40 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    warn: real("warn"),
    alert: real("alert"),
    breachedSince: timestamp("breached_since", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

/** Deklarace detekce techniky ATT&CK (pravidlo SIEM / EDR mimo data CONTIXu) – v1.22, ADR-119. */
export const detectionDeclarations = pgTable(
  "detection_declarations",
  {
    companyId: companyRef(),
    technique: varchar("technique", { length: 20 }).notNull(),
    source: varchar("source", { length: 300 }).notNull(),
    note: text("note"),
    declaredById: uuid("declared_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.technique] })],
);

/** Návrh rizikového scénáře (šablona × primární aktivum) se snímkem důkazů; rozhoduje člověk. */
export const riskScenarioProposals = pgTable(
  "risk_scenario_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    templateKey: varchar("template_key", { length: 40 }).notNull(),
    primaryAssetId: uuid("primary_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull().default("proposed"),
    levels: smallint("levels").notNull(),
    impact: smallint("impact").notNull(),
    threatLevel: smallint("threat_level").notNull(),
    vulnLevel: smallint("vuln_level").notNull(),
    likelihood: smallint("likelihood").notNull(),
    lowConfidence: boolean("low_confidence").notNull().default(false),
    /** Snímek důkazů: signály, schopnosti, alerty, zdůvodnění, podpůrná aktiva, opatření. */
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    fingerprint: text("fingerprint").notNull(),
    /** Kdy se otisk (doložené skutečnosti) naposledy změnil – podnět k přehodnocení rizika (v1.18). */
    fingerprintChangedAt: timestamp("fingerprint_changed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Otisk v okamžiku rozhodnutí (změna dat po rozhodnutí). */
    decidedFingerprint: text("decided_fingerprint"),
    riskId: uuid("risk_id").references(() => risks.id, { onDelete: "set null" }),
    reason: text("reason"),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex("risk_scenario_proposals_uq").on(t.companyId, t.templateKey, t.primaryAssetId), index("risk_scenario_proposals_risk_idx").on(t.riskId)],
);

/** Posouzení hrozby z katalogu u primárního aktiva jako nerelevantní (se zdůvodněním) – pokrytí katalogu (v1.18, ADR-115). */
export const threatAssessments = pgTable(
  "threat_assessments",
  {
    companyId: companyRef(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    catalogId: uuid("catalog_id")
      .notNull()
      .references(() => riskCatalog.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    decidedById: uuid("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.catalogId] }), index("threat_assessments_company_idx").on(t.companyId)],
);

/** Doklady k produktu (prohlášení o shodě, pokyny výrobce…) – v1.16, ADR-113. Stažení jen jako příloha. */
export const craProductFiles = pgTable(
  "cra_product_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => craProducts.id, { onDelete: "cascade" }),
    checkKey: varchar("check_key", { length: 40 }),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileMime: varchar("file_mime", { length: 100 }).notNull(),
    fileSize: integer("file_size").notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cra_product_files_product_idx").on(t.productId)],
);

/** Oznámení výrobců ve formátu CSAF 2.0 (nahraná, nic se neodesílá) – v1.16, ADR-113. */
export const craAdvisories = pgTable(
  "cra_advisories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    publisher: varchar("publisher", { length: 300 }).notNull(),
    namespace: varchar("namespace", { length: 300 }).notNull(),
    trackingId: varchar("tracking_id", { length: 200 }).notNull(),
    version: varchar("version", { length: 50 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    currentRelease: varchar("current_release", { length: 40 }),
    /** Zpracovaný obsah (`CsafAdvisory`) – originál se neukládá. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    fileSha256: varchar("file_sha256", { length: 64 }).notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("cra_advisories_uq").on(t.companyId, t.namespace, t.trackingId)],
);

/** Vazby produktu CRA na zbytek platformy (v1.05, ADR-101): aktiva, na kterých běží / ze kterých se skládá, dodavatelé, procesy, rizika. */
const craLink = <N extends string>(name: N, col: string, target: () => any) =>
  pgTable(
    name,
    {
      productId: uuid("product_id")
        .notNull()
        .references(() => craProducts.id, { onDelete: "cascade" }),
      targetId: uuid(col)
        .notNull()
        .references(target, { onDelete: "cascade" }),
    },
    (t) => [primaryKey({ columns: [t.productId, t.targetId] }), index(`${name}_target_idx`).on(t.targetId)],
  );
export const craProductAssets = craLink("cra_product_assets", "asset_id", () => assets.id);
export const craProductSuppliers = craLink("cra_product_suppliers", "supplier_id", () => suppliers.id);
export const craProductProcesses = craLink("cra_product_processes", "process_id", () => processes.id);
export const craProductRisks = craLink("cra_product_risks", "risk_id", () => risks.id);

export const craComponents = pgTable(
  "cra_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => craProducts.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 300 }).notNull(),
    version: varchar("version", { length: 100 }),
    purl: varchar("purl", { length: 500 }),
    supplier: varchar("supplier", { length: 300 }),
    license: varchar("license", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cra_components_product_idx").on(t.productId)],
);

export const craReports = pgTable(
  "cra_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    productId: uuid("product_id")
      .notNull()
      .references(() => craProducts.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    title: varchar("title", { length: 300 }).notNull(),
    awareAt: timestamp("aware_at", { withTimezone: true }).notNull(),
    cveIds: text("cve_ids").array().notNull().default(sql`'{}'::text[]`),
    malicious: boolean("malicious"),
    memberStates: text("member_states").array().notNull().default(sql`'{}'::text[]`),
    description: text("description"),
    severity: text("severity"),
    mitigation: text("mitigation"),
    userMeasures: text("user_measures"),
    sensitivity: text("sensitivity"),
    rootCause: text("root_cause"),
    actorInfo: text("actor_info"),
    srpRef: varchar("srp_ref", { length: 100 }),
    earlyWarningAt: timestamp("early_warning_at", { withTimezone: true }),
    notificationAt: timestamp("notification_at", { withTimezone: true }),
    correctiveAvailableAt: timestamp("corrective_available_at", { withTimezone: true }),
    finalReportAt: timestamp("final_report_at", { withTimezone: true }),
    usersInformedAt: timestamp("users_informed_at", { withTimezone: true }),
    closed: boolean("closed").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("cra_reports_product_idx").on(t.productId)],
);

/* ================================================================
 * CRA – offline databáze OSV a zranitelnosti komponent / VEX (v0.98, ADR-093)
 * ================================================================ */

/** Globální záznamy OSV (jen stažené / nahrané, nic se neodesílá). */
export const osvRecords = pgTable("osv_records", {
  id: varchar("id", { length: 100 }).primaryKey(),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  summary: text("summary"),
  severity: varchar("severity", { length: 200 }),
  modified: timestamp("modified", { withTimezone: true }),
  withdrawn: boolean("withdrawn").notNull().default(false),
  affected: jsonb("affected").$type<unknown[]>().notNull().default([]),
  ecosystems: text("ecosystems").array().notNull().default(sql`'{}'::text[]`),
});

/** Index balíčků pro párování (ekosystém + název → záznam). */
export const osvPackages = pgTable(
  "osv_packages",
  {
    osvId: varchar("osv_id", { length: 100 })
      .notNull()
      .references(() => osvRecords.id, { onDelete: "cascade" }),
    ecosystem: varchar("ecosystem", { length: 40 }).notNull(),
    name: varchar("name", { length: 300 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.osvId, t.ecosystem, t.name] }), index("osv_packages_lookup_idx").on(t.ecosystem, t.name)],
);

export const craFindings = pgTable(
  "cra_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    productId: uuid("product_id")
      .notNull()
      .references(() => craProducts.id, { onDelete: "cascade" }),
    /** Stálý odkaz na komponentu: purl, jinak „název@verze“ (komponenty se při importu SBOM nahrazují). */
    componentRef: varchar("component_ref", { length: 500 }).notNull(),
    vulnId: varchar("vuln_id", { length: 100 }).notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    summary: text("summary"),
    severity: varchar("severity", { length: 200 }),
    /** osv | manual | csaf | nvd */
    source: varchar("source", { length: 10 }).notNull().default("osv"),
    status: varchar("status", { length: 30 }).notNull().default("under_investigation"),
    /** Stav podle oznámení výrobce (CSAF); vlastní `status` ho může přepsat (v1.16). */
    vendorStatus: varchar("vendor_status", { length: 30 }),
    justification: varchar("justification", { length: 60 }),
    impactStatement: text("impact_statement"),
    actionStatement: text("action_statement"),
    /** Komponenta / verze už v SBOM není nebo záznam OSV už verzi nezasahuje. */
    gone: boolean("gone").notNull().default(false),
    /** Riziko založené z nálezu (v1.05, ADR-101). */
    riskId: uuid("risk_id").references(() => risks.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("cra_findings_uq").on(t.productId, t.componentRef, t.vulnId), index("cra_findings_company_idx").on(t.companyId)],
);

/* ================================================================
 * AI II – dotazy v přirozeném jazyce, osobní API tokeny (MCP), duplicity aktiv (v0.20)
 * ================================================================ */

export const aiQueries = pgTable(
  "ai_queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** running | done | error */
    status: varchar("status", { length: 20 }).notNull().default("running"),
    /** Plán modelu: [{tool, args}] – jen nástroje z katalogu (modules/ai/tools.ts). */
    plan: jsonb("plan").$type<{ tool: string; args: Record<string, unknown> }[]>().notNull().default([]),
    /** Výsledky nástrojů (tabulky s odkazy) – zobrazují se uživateli, nejsou výstupem modelu. */
    results: jsonb("results").$type<unknown[]>().notNull().default([]),
    /** Úryvky dokumentace a záznamy (v0.50) – citace [n] v odpovědi. */
    sources: jsonb("sources").$type<unknown[]>().notNull().default([]),
    answer: text("answer"),
    provider: varchar("provider", { length: 20 }),
    model: varchar("model", { length: 200 }),
    error: text("error"),
    durationMs: integer("duration_ms"),
    ...timestamps,
  },
  (t) => [index("ai_queries_user_idx").on(t.userId, t.createdAt)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    /** SHA-256 tokenu (hex); samotný token se ukládá jen u uživatele. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    prefix: varchar("prefix", { length: 16 }).notNull(),
    /** Volitelné omezení na jednu společnost. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedIp: varchar("last_used_ip", { length: 64 }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

export const assetDuplicateDismissals = pgTable(
  "asset_duplicate_dismissals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    /** Dvojice uložená seřazeně (assetA < assetB). */
    assetA: uuid("asset_a")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    assetB: uuid("asset_b")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    dismissedById: uuid("dismissed_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("asset_dup_pair_uq").on(t.assetA, t.assetB)],
);

/* ================================================================
 * DMS – soubory verzí, schvalovací workflow, připomínky, test porozumění (v0.22)
 * ================================================================ */

export const policyFiles = pgTable(
  "policy_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 150 }).notNull(),
    size: integer("size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    revision: smallint("revision").notNull().default(1),
    replacesId: uuid("replaces_id").references((): AnyPgColumn => policyFiles.id, { onDelete: "set null" }),
    /** Nahrazeno novější revizí (zůstává v historii). */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    note: text("note"),
    /** Převod (ADR-025): pending → ok / failed / native (soubor je PDF) / none (nepřevádí se). */
    pdfStatus: varchar("pdf_status", { length: 20 }).notNull().default("pending"),
    pdfError: text("pdf_error"),
    /** PDF vytvořené převodní službou (bez razítka – razítko se přidává při stažení). */
    pdf: bytea("pdf"),
    pdfAt: timestamp("pdf_at", { withTimezone: true }),
    /** Text souboru pro vyhledávání a porovnání verzí; `search_text` = normalizovaný (malá písmena, bez diakritiky). */
    text: text("text"),
    searchText: text("search_text"),
  },
  (t) => [index("policy_files_version_idx").on(t.versionId)],
);

/* DMS IV (v0.25) – úpravy v desktopovém Office přes WebDAV (odkaz s jednorázovým tokenem) */
export const policyEditSessions = pgTable(
  "policy_edit_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** SHA-256 tokenu z odkazu (token sám se neukládá). */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    /** edit = úprava (rezervace verze), view = jen čtení. */
    mode: varchar("mode", { length: 10 }).notNull(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    /** Soubor, který se otevřel. */
    fileId: uuid("file_id")
      .notNull()
      .references(() => policyFiles.id, { onDelete: "cascade" }),
    /** Revize vytvořená uložením v této relaci (další uložení ji přepisují). */
    revisionFileId: uuid("revision_file_id").references(() => policyFiles.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lockToken: varchar("lock_token", { length: 100 }),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    saves: smallint("saves").notNull().default(0),
    lastSavedAt: timestamp("last_saved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("policy_edit_sessions_token_uq").on(t.tokenHash), index("policy_edit_sessions_version_idx").on(t.versionId)],
);

/* Zeptej se dokumentace (v0.27) – úseky platných dokumentů s vektory pro vyhledávání podle významu */
/** pgvector bez pevné dimenze (model lze změnit; při změně se dokumentace přeindexuje). */
const tsvector = customType<{ data: string; driverData: string }>({ dataType: () => "tsvector" });
const vectorAny = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (v) => `[${v.join(",")}]`,
  fromDriver: (v) => (typeof v === "string" ? v.slice(1, -1).split(",").map(Number) : (v as unknown as number[])),
});

export const docChunks = pgTable(
  "doc_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    /** Zdroj: název souboru nebo „text verze“. */
    source: varchar("source", { length: 255 }).notNull(),
    ordinal: integer("ordinal").notNull(),
    /** Nejbližší nadpis / článek nad úsekem. */
    heading: varchar("heading", { length: 300 }),
    text: text("text").notNull(),
    /** Normalizovaný text (bez diakritiky) pro doplňkové hledání slov. */
    searchText: text("search_text").notNull(),
    embedding: vectorAny("embedding"),
    model: varchar("model", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("doc_chunks_policy_idx").on(t.policyId), index("doc_chunks_company_idx").on(t.companyId)],
);

/** Stav indexace dokumentu (platná verze, model, kdy, chyba). */
export const docIndexState = pgTable("doc_index_state", {
  policyId: uuid("policy_id")
    .primaryKey()
    .references(() => policies.id, { onDelete: "cascade" }),
  versionId: uuid("version_id"),
  model: varchar("model", { length: 200 }),
  chunks: integer("chunks").notNull().default(0),
  /** Otisk zdrojových textů – změna (nový převod souboru) = přeindexovat. */
  sourceHash: varchar("source_hash", { length: 64 }),
  indexedAt: timestamp("indexed_at", { withTimezone: true }),
  error: text("error"),
});

/** Vektorový index záznamů (ADR-044): rizika, zranitelnosti (CVE za společnost), incidenty, výjimky – hledání podle významu, podobné záznamy. */
export const recordVectors = pgTable(
  "record_vectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    kind: varchar("kind", { length: 20 }).notNull(),
    /** ID záznamu (u zranitelnosti „společnost:CVE“, u výjimky klíč výjimky). */
    refId: varchar("ref_id", { length: 200 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    /** Text pro embedding a citace (bez jmen osob). */
    text: text("text").notNull(),
    searchText: text("search_text").notNull(),
    link: varchar("link", { length: 500 }).notNull(),
    meta: jsonb("meta").$type<Record<string, string | number | null>>().notNull().default({}),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    embedding: vectorAny("embedding"),
    model: varchar("model", { length: 200 }),
    error: text("error"),
    /** Vyřazeno správcem z indexu (v1.07) – nehledá se, nevrací se modelu; přežije přeindexování. */
    excluded: boolean("excluded").notNull().default(false),
    /** Fulltext (v1.07): normalizovaný text bez diakritiky, konfigurace simple + předpony slov v dotazu. */
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(sql`to_tsvector('simple', search_text)`),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("record_vectors_ref_uq").on(t.kind, t.refId), index("record_vectors_company_idx").on(t.companyId), index("record_vectors_tsv_idx").using("gin", t.searchTsv)],
);

/** Znalostní články (v1.07, ADR-103) – vlastní postupy, FAQ a runbooky; indexují se do vektorů po úsecích. */
export const knowledgeArticles = pgTable(
  "knowledge_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    title: varchar("title", { length: 300 }).notNull(),
    body: text("body").notNull().default(""),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("knowledge_articles_company_idx").on(t.companyId)],
);

/* DMS II (v0.23) – složky dokumentace a šablony */
export const policyFolders = pgTable(
  "policy_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    parentId: uuid("parent_id").references((): AnyPgColumn => policyFolders.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    codePrefix: varchar("code_prefix", { length: 15 }),
    position: smallint("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("policy_folders_company_idx").on(t.companyId)],
);

export const policyTemplates = pgTable(
  "policy_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    name: varchar("name", { length: 200 }).notNull(),
    docType: policyTypeEnum("doc_type"),
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 150 }).notNull(),
    size: integer("size").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("policy_templates_company_idx").on(t.companyId)],
);

export const policyEvents = pgTable(
  "policy_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 30 }).notNull(),
    fromStatus: varchar("from_status", { length: 20 }).notNull(),
    toStatus: varchar("to_status", { length: 20 }).notNull(),
    note: text("note"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("policy_events_version_idx").on(t.versionId)],
);

export const policyComments = pgTable(
  "policy_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").references(() => policyVersions.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    reference: varchar("reference", { length: 200 }),
    text: text("text").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    response: text("response"),
    respondedById: uuid("responded_by_id").references(() => users.id, { onDelete: "set null" }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("policy_comments_policy_idx").on(t.policyId)],
);

export const policyQuizQuestions = pgTable(
  "policy_quiz_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => policies.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    question: text("question").notNull(),
    options: text("options").array().notNull(),
    correct: integer("correct").array().notNull(),
  },
  (t) => [index("policy_quiz_policy_idx").on(t.policyId)],
);

export const policyQuizAttempts = pgTable(
  "policy_quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => policyVersions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    score: smallint("score").notNull(),
    passed: boolean("passed").notNull(),
    answers: jsonb("answers").$type<number[][]>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("policy_quiz_attempts_idx").on(t.versionId, t.userId)],
);


/* ================================================================
 * Identity a přístupy (v0.28) – účty z AD / Entra ID a nálezy kontrol (ADR-029)
 * ================================================================ */

export const identitySourceKindEnum = pgEnum("identity_source_kind", IDENTITY_SOURCE_KINDS);
export const identityAccountKindEnum = pgEnum("identity_account_kind", IDENTITY_ACCOUNT_KINDS);
export const identitySeverityEnum = pgEnum("identity_severity", IDENTITY_SEVERITIES);
export const identityFindingStatusEnum = pgEnum("identity_finding_status", IDENTITY_FINDING_STATUSES);

/** Adresář (AD doména / Entra tenant) – připojení jen pro čtení; tajemství šifrovaně. */
export const identitySources = pgTable("identity_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: companyRef(),
  kind: identitySourceKindEnum("kind").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  secretEnc: text("secret_enc"),
  policy: jsonb("policy").$type<IdentityPolicy>().notNull(),
  provisioning: jsonb("provisioning").$type<ProvisioningConfig>(),
  /** Přihlášení do CONTIXu účty tohoto AD (ADR-078); null = vypnuto. */
  login: jsonb("login").$type<AdLoginConfig>(),
  syncHours: integer("sync_hours").notNull().default(24),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastStatus: varchar("last_status", { length: 20 }),
  lastError: text("last_error"),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  stats: jsonb("stats").$type<IdentitySourceStats>(),
  ...timestamps,
});

/** Vlastní rámce knihovny (ADR-079) – globální pro celou skupinu; požadavky jako balíček (jsonb). */
export const customFrameworks = pgTable("custom_frameworks", {
  /** „x-<klíč>“ */
  id: varchar("id", { length: 50 }).primaryKey(),
  name: varchar("name", { length: 300 }).notNull(),
  pack: jsonb("pack").$type<Record<string, unknown>>().notNull(),
  requirementCount: integer("requirement_count").notNull().default(0),
  importedBy: uuid("imported_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

/** Poskytovatelé SSO (OIDC) nastavení v administraci (ADR-078); tajemství jen šifrovaně. */
export const ssoProviders = pgTable("sso_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: varchar("kind", { length: 20 }).notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  tenantId: varchar("tenant_id", { length: 100 }).notNull().default(""),
  issuer: varchar("issuer", { length: 500 }).notNull().default(""),
  clientId: varchar("client_id", { length: 300 }).notNull(),
  secretEnc: text("secret_enc"),
  scopes: varchar("scopes", { length: 300 }).notNull().default("openid profile email"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

export const identityAccounts = pgTable(
  "identity_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => identitySources.id, { onDelete: "cascade" }),
    companyId: companyRef(),
    externalId: varchar("external_id", { length: 200 }).notNull(),
    login: varchar("login", { length: 300 }).notNull(),
    displayName: varchar("display_name", { length: 300 }).notNull().default(""),
    email: varchar("email", { length: 320 }),
    kind: identityAccountKindEnum("kind").notNull().default("user"),
    enabled: boolean("enabled").notNull(),
    privileged: boolean("privileged").notNull().default(false),
    privilegedVia: text("privileged_via").array().notNull().default(sql`'{}'::text[]`),
    groups: text("groups").array().notNull().default(sql`'{}'::text[]`),
    flags: jsonb("flags").$type<AccountFlags>().notNull(),
    mfa: boolean("mfa"),
    dn: text("dn"),
    dirCreatedAt: timestamp("dir_created_at", { withTimezone: true }),
    lastLogonAt: timestamp("last_logon_at", { withTimezone: true }),
    pwdLastSetAt: timestamp("pwd_last_set_at", { withTimezone: true }),
    department: varchar("department", { length: 300 }),
    title: varchar("title", { length: 300 }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("identity_accounts_uq").on(t.sourceId, t.externalId), index("identity_accounts_company_idx").on(t.companyId, t.privileged)],
);

export const identityFindings = pgTable(
  "identity_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => identitySources.id, { onDelete: "cascade" }),
    companyId: companyRef(),
    accountId: uuid("account_id").references(() => identityAccounts.id, { onDelete: "cascade" }),
    /** Účet (id) nebo skupina (group:<název>) – klíč nálezu spolu se zdrojem a pravidlem. */
    subject: varchar("subject", { length: 400 }).notNull(),
    rule: varchar("rule", { length: 50 }).notNull(),
    severity: identitySeverityEnum("severity").notNull(),
    detail: text("detail").notNull().default(""),
    status: identityFindingStatusEnum("status").notNull().default("open"),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedReason: text("accepted_reason"),
    acceptedUntil: date("accepted_until"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("identity_findings_uq").on(t.sourceId, t.rule, t.subject), index("identity_findings_status_idx").on(t.companyId, t.status, t.severity)],
);

/** Souhrn po každé synchronizaci – trend pro přehled a doklad pro audit. */
export const identitySnapshots = pgTable("identity_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => identitySources.id, { onDelete: "cascade" }),
  companyId: companyRef(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  stats: jsonb("stats").$type<IdentitySourceStats>().notNull(),
});

/* ---------- v0.29: toxické kombinace (SoD) a přezkum přístupů ---------- */

export const sodRules = pgTable("sod_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: companyRef(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description").notNull().default(""),
  severity: identitySeverityEnum("severity").notNull().default("high"),
  sideA: jsonb("side_a").$type<SodSide>().notNull(),
  sideB: jsonb("side_b").$type<SodSide>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

export const sodViolations = pgTable(
  "sod_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => sodRules.id, { onDelete: "cascade" }),
    companyId: companyRef(),
    /** user:<id> nebo account:<id> */
    subject: varchar("subject", { length: 100 }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    person: varchar("person", { length: 300 }).notNull().default(""),
    accountIds: uuid("account_ids").array().notNull().default(sql`'{}'::uuid[]`),
    matchA: text("match_a").array().notNull().default(sql`'{}'::text[]`),
    matchB: text("match_b").array().notNull().default(sql`'{}'::text[]`),
    status: identityFindingStatusEnum("status").notNull().default("open"),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedReason: text("accepted_reason"),
    acceptedUntil: date("accepted_until"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sod_violations_uq").on(t.ruleId, t.subject), index("sod_violations_status_idx").on(t.companyId, t.status)],
);

export const accessReviewStatusEnum = pgEnum("access_review_status", ACCESS_REVIEW_STATUSES);
export const accessReviewDecisionEnum = pgEnum("access_review_decision", ACCESS_REVIEW_DECISIONS);
export const accessReviewerModeEnum = pgEnum("access_reviewer_mode", ACCESS_REVIEWER_MODES);

/** Kampaň přezkumu přístupů – rozsah a položky se zmrazí při zahájení; uzavřená je neměnná (doklad). */
export const accessReviews = pgTable("access_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: companyRef(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description").notNull().default(""),
  status: accessReviewStatusEnum("status").notNull().default("active"),
  scope: jsonb("scope").$type<{ sourceIds: string[]; groups: string[]; privilegedOnly: boolean }>().notNull(),
  reviewerMode: accessReviewerModeEnum("reviewer_mode").notNull().default("position"),
  reviewerPositionId: uuid("reviewer_position_id").references(() => positions.id, { onDelete: "set null" }),
  dueDate: date("due_date").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const accessReviewItems = pgTable(
  "access_review_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => accessReviews.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => identityAccounts.id, { onDelete: "set null" }),
    /** Snímek účtu při zahájení (zůstane i po odstranění účtu). */
    login: varchar("login", { length: 300 }).notNull(),
    displayName: varchar("display_name", { length: 300 }).notNull().default(""),
    sourceName: varchar("source_name", { length: 200 }).notNull().default(""),
    kind: identityAccountKindEnum("kind").notNull().default("user"),
    access: text("access").array().notNull().default(sql`'{}'::text[]`),
    privilegedVia: text("privileged_via").array().notNull().default(sql`'{}'::text[]`),
    lastLogonAt: timestamp("last_logon_at", { withTimezone: true }),
    reviewerPositionId: uuid("reviewer_position_id").references(() => positions.id, { onDelete: "set null" }),
    decision: accessReviewDecisionEnum("decision").notNull().default("pending"),
    note: text("note").notNull().default(""),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    remediatedAt: timestamp("remediated_at", { withTimezone: true }),
    remediatedBy: uuid("remediated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("access_review_items_review_idx").on(t.reviewId, t.reviewerPositionId)],
);

/* ---------- v0.30: automatické testy opatření ---------- */

export const controlAutomationKindEnum = pgEnum("control_automation_kind", CONTROL_AUTOMATION_KINDS);

/** Automatický test opatření – výsledek kontrol účtů / přezkumu přístupů se zapíše jako test a důkaz. */
export const controlAutomations = pgTable("control_automations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: companyRef(),
  controlId: uuid("control_id")
    .notNull()
    .references(() => controls.id, { onDelete: "cascade" }),
  kind: controlAutomationKindEnum("kind").notNull(),
  frequency: varchar("frequency", { length: 20 }).$type<AutomationFrequency>().notNull().default("monthly"),
  sourceIds: uuid("source_ids").array().notNull().default(sql`'{}'::uuid[]`),
  rules: text("rules").array().$type<IdentityRule[]>().notNull().default(sql`'{}'::text[]`),
  maxCritical: integer("max_critical").notNull().default(0),
  maxHigh: integer("max_high").notNull().default(0),
  applyEffectiveness: boolean("apply_effectiveness").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  /** SCA (ADR-064): politiky v rozsahu a prahy skóre shody. */
  scaPolicies: text("sca_policies").array().notNull().default(sql`'{}'::text[]`),
  scaMinScore: integer("sca_min_score").notNull().default(80),
  scaWarnScore: integer("sca_warn_score").notNull().default(60),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastResult: varchar("last_result", { length: 40 }),
  lastTestId: uuid("last_test_id").references(() => controlTests.id, { onDelete: "set null" }),
  lastError: text("last_error"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

/* ================================================================
 * Průběžné monitorování opatření (v1.01, ADR-096)
 * ================================================================ */

export const controlMonitors = pgTable(
  "control_monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    controlId: uuid("control_id")
      .notNull()
      .references(() => controls.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).$type<ControlMonitorKind>().notNull(),
    name: varchar("name", { length: 200 }).notNull().default(""),
    frequency: varchar("frequency", { length: 20 }).$type<MonitorFrequency>().notNull().default("daily"),
    params: jsonb("params").$type<MonitorParams>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastResult: varchar("last_result", { length: 10 }).$type<MonitorResult>(),
    lastSummary: text("last_summary"),
    /** Při nesplnění založit úkol vlastníkovi opatření (v1.13, ADR-109). */
    autoTask: boolean("auto_task").notNull().default(false),
    openTaskId: uuid("open_task_id").references(() => tasks.id, { onDelete: "set null" }),
    /** SHA-256 tokenu externí kontroly – hodnota se ukáže jen při vydání. */
    tokenHash: varchar("token_hash", { length: 64 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("control_monitors_company_idx").on(t.companyId), index("control_monitors_control_idx").on(t.controlId)],
);

/** Běh monitoru – neměnný záznam (vzorek pro test za období). */
export const controlMonitorRuns = pgTable(
  "control_monitor_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => controlMonitors.id, { onDelete: "cascade" }),
    companyId: companyRef(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    result: varchar("result", { length: 10 }).$type<MonitorResult>().notNull(),
    value: real("value"),
    threshold: real("threshold"),
    population: integer("population"),
    exceptions: integer("exceptions"),
    summary: text("summary").notNull().default(""),
    details: jsonb("details").$type<{ ref: string; detail: string }[]>().notNull().default([]),
  },
  (t) => [index("control_monitor_runs_monitor_idx").on(t.monitorId, t.runAt)],
);

/* ================================================================
 * Shoda konfigurace – Wazuh SCA (v0.69, ADR-064)
 * ================================================================ */

/** Výsledek politiky SCA na aktivu (poslední sken). */
export const scaResults = pgTable(
  "sca_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    agentId: varchar("agent_id", { length: 50 }).notNull(),
    policyId: varchar("policy_id", { length: 100 }).notNull(),
    policyName: varchar("policy_name", { length: 300 }).notNull(),
    pass: integer("pass").notNull().default(0),
    fail: integer("fail").notNull().default(0),
    na: integer("na").notNull().default(0),
    score: integer("score"),
    /** Konec skenu ve Wazuhu – změna = nové načtení kontrol. */
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sca_results_asset_policy_uq").on(t.assetId, t.policyId), index("sca_results_company_idx").on(t.companyId)],
);

/** Definice kontroly politiky (sdílené, bez vazby na společnost). */
export const scaCheckDefs = pgTable(
  "sca_check_defs",
  {
    policyId: varchar("policy_id", { length: 100 }).notNull(),
    checkId: integer("check_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    rationale: text("rationale"),
    remediation: text("remediation"),
    compliance: jsonb("compliance").$type<Record<string, string[]>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.checkId] })],
);

/** Výsledek kontroly na aktivu (poslední sken). */
export const scaCheckResults = pgTable(
  "sca_check_results",
  {
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    policyId: varchar("policy_id", { length: 100 }).notNull(),
    checkId: integer("check_id").notNull(),
    result: varchar("result", { length: 20 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.policyId, t.checkId] }), index("sca_check_results_check_idx").on(t.policyId, t.checkId, t.result)],
);

/* ================================================================
 * Legislativa (v0.34, ADR-035): sledované předpisy, znění, fragmenty, změny, posouzení dopadu, úkoly
 * ================================================================ */

export const legalSourceEnum = pgEnum("legal_source", LEGAL_SOURCES);
export const legalReviewStatusEnum = pgEnum("legal_review_status", LEGAL_REVIEW_STATUSES);
export const legalImpactEnum = pgEnum("legal_impact", LEGAL_IMPACTS);
export const legalTaskStatusEnum = pgEnum("legal_task_status", LEGAL_TASK_STATUSES);

/** Předpis: veřejný z e-Sbírky (company_id null, sdílený všemi společnostmi) nebo ručně vedený (soukromý pro společnost – např. licencovaná norma). */
export const legalActs = pgTable(
  "legal_acts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    source: legalSourceEnum("source").notNull(),
    code: varchar("code", { length: 100 }).notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    /** Stálá URL bez data znění (/sb/2025/264) – jen e-Sbírka. */
    staleUrl: varchar("stale_url", { length: 200 }),
    frameworkId: varchar("framework_id", { length: 20 }),
    currentVersionId: uuid("current_version_id"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastStatus: varchar("last_status", { length: 20 }),
    lastError: text("last_error"),
    /** Poslední metadata ze zdroje (surová odpověď – pro budoucí změny schématu). */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [uniqueIndex("legal_acts_stale_uq").on(t.staleUrl), index("legal_acts_company_idx").on(t.companyId)],
);

export const legalVersions = pgTable(
  "legal_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actId: uuid("act_id")
      .notNull()
      .references(() => legalActs.id, { onDelete: "cascade" }),
    /** Identifikace znění u zdroje (stálá URL s datem / ruční označení). */
    versionKey: varchar("version_key", { length: 200 }).notNull(),
    effectiveFrom: date("effective_from"),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    fragmentCount: integer("fragment_count").notNull().default(0),
    /** Verze formátu dat konektoru (při změně struktury zdroje se zvýší). */
    schemaVersion: smallint("schema_version").notNull().default(1),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex("legal_versions_uq").on(t.actId, t.versionKey, t.contentHash), index("legal_versions_act_idx").on(t.actId)],
);

export const legalFragments = pgTable(
  "legal_fragments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => legalVersions.id, { onDelete: "cascade" }),
    /** Vlastní identita fragmentu odvozená z citace (par_19-odst_1-pism_a). */
    key: varchar("key", { length: 200 }).notNull(),
    label: varchar("label", { length: 500 }).notNull(),
    text: text("text").notNull(),
    depth: smallint("depth").notNull().default(0),
    kind: varchar("kind", { length: 60 }).notNull().default(""),
    position: integer("position").notNull(),
    /** ID fragmentu u zdroje – jen informativně, identita se na něm nestaví. */
    sourceId: varchar("source_id", { length: 60 }),
  },
  (t) => [index("legal_fragments_version_idx").on(t.versionId, t.position)],
);

/** Sledování předpisu společností (odpovědné funkční místo). */
export const legalWatch = pgTable(
  "legal_watch",
  {
    companyId: companyRef(),
    actId: uuid("act_id")
      .notNull()
      .references(() => legalActs.id, { onDelete: "cascade" }),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.companyId, t.actId] })],
);

/** Změna předpisu = nové znění oproti předchozímu (globální událost). */
export const legalChanges = pgTable(
  "legal_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actId: uuid("act_id")
      .notNull()
      .references(() => legalActs.id, { onDelete: "cascade" }),
    fromVersionId: uuid("from_version_id").references(() => legalVersions.id, { onDelete: "set null" }),
    toVersionId: uuid("to_version_id")
      .notNull()
      .references(() => legalVersions.id, { onDelete: "cascade" }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    added: integer("added").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    modified: integer("modified").notNull().default(0),
  },
  (t) => [index("legal_changes_act_idx").on(t.actId)],
);

/** Posouzení dopadu změny ve společnosti (gestor potvrzuje; AI jen navrhuje shrnutí a úkoly). */
export const legalReviews = pgTable(
  "legal_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    changeId: uuid("change_id")
      .notNull()
      .references(() => legalChanges.id, { onDelete: "cascade" }),
    status: legalReviewStatusEnum("status").notNull().default("new"),
    impact: legalImpactEnum("impact"),
    assessment: text("assessment"),
    aiSummary: text("ai_summary"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    assessedById: uuid("assessed_by_id").references(() => users.id, { onDelete: "set null" }),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("legal_reviews_uq").on(t.companyId, t.changeId)],
);

export const legalTasks = pgTable(
  "legal_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    reviewId: uuid("review_id").references(() => legalReviews.id, { onDelete: "set null" }),
    title: varchar("title", { length: 300 }).notNull(),
    description: text("description"),
    ownerPositionId: uuid("owner_position_id").references(() => positions.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    status: legalTaskStatusEnum("status").notNull().default("open"),
    policyId: uuid("policy_id").references(() => policies.id, { onDelete: "set null" }),
    controlId: uuid("control_id").references(() => controls.id, { onDelete: "set null" }),
    requirementId: varchar("requirement_id", { length: 100 }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("legal_tasks_company_idx").on(t.companyId), index("legal_tasks_review_idx").on(t.reviewId)],
);

/* ================================================================
 * Pokrytí předpisu (v0.42, ADR-038) – neměnné snímky matice pro audit
 * ================================================================ */
export const coverageSnapshots = pgTable(
  "coverage_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: companyRef(),
    framework: varchar("framework", { length: 20 }).notNull(),
    note: text("note"),
    summary: jsonb("summary").notNull(),
    rows: jsonb("rows").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coverage_snapshots_company_idx").on(t.companyId, t.framework, t.createdAt)],
);

/** Uložené pohledy seznamů (ADR-075) – filtry, řazení, seskupení; sdílený pohled vidí všichni se čtením stránky. */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    page: varchar("page", { length: 40 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    shared: boolean("shared").notNull().default(false),
    ...timestamps,
  },
  (t) => [uniqueIndex("saved_views_uq").on(t.userId, t.page, t.name), index("saved_views_page_idx").on(t.page)],
);
