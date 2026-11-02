import { profileLabelKey, profileOf, CONTIX_VERSION, DEFAULT_DOC_FOLDERS, SETUP_LABELS, type SetupDto, type SetupStepDto, type Translate } from "@contix/shared";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { currentUser, requirePerm } from "../../auth/middleware";
import { providersFor } from "../../auth/oidc";
import { adLoginSources } from "../../auth/adLogin";
import { inScope, scopeOf, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import {
  assets,
  orgUnits,
  policies,
  policyFolders,
  policyTemplates,
  policyVersions,
  positionHolders,
  positions,
  requirementAssessments,
  risks,
  roles,
  trainingCourses,
  userRoles,
  users,
  identitySources,
} from "../../db/schema";
import { getAiSettings } from "../ai/service";
import { getWazuhConfig, wazuhReady } from "../connectors/config";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html, printPage } from "../documents/render";
import { getNotificationSettings } from "../notifications/service";
import { systemStatus } from "../ops/routes";
import { CS_T, tFor } from "../i18n/service";

/* ============================================================
 * Průvodce prvním nastavením a předávací protokol (ADR-027). Stav kroků se počítá z dat – nic se neukládá.
 * ============================================================ */

const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);

export function setupRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;

  async function computeSetup(c: Parameters<typeof scopeOf>[0], t: Translate = CS_T): Promise<SetupDto> {
    const s = await getSettings(db);
    const mod = (k: string) => s.enabledModules.includes(k);
    const ids = scopeOf(c).ids;
    const inCo = <T extends Parameters<typeof inScope>[1]>(col: T) => inScope(c, col);
    const [
      unitsN,
      positionsN,
      heldN,
      secRoles,
      usersN,
      noRole,
      admins,
      employeesN,
      assetsN,
      noOwnerAssets,
      risksN,
      noOwnerRisks,
      assessN,
      foldersN,
      templatesN,
      policyDoc,
      docsN,
      coursesN,
      notif,
      ai,
      wazuh,
      ops,
    ] = await Promise.all([
      n(db.select({ n: count() }).from(orgUnits).where(inCo(orgUnits.companyId))),
      n(db.select({ n: count() }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(inCo(orgUnits.companyId))),
      n(
        db
          .select({ n: sql<number>`count(distinct ${positionHolders.positionId})::int` })
          .from(positionHolders)
          .innerJoin(positions, eq(positions.id, positionHolders.positionId))
          .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
          .where(inCo(orgUnits.companyId)),
      ),
      db
        .select({ roles: positions.securityRoles })
        .from(positions)
        .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
        .where(and(inCo(orgUnits.companyId), sql`cardinality(${positions.securityRoles}) > 0`)),
      n(db.select({ n: count() }).from(users).where(and(eq(users.isActive, true), inCo(users.companyId)))),
      n(db.select({ n: count() }).from(users).where(and(eq(users.isActive, true), inCo(users.companyId), sql`not exists (select 1 from user_roles r where r.user_id = ${users.id})`))),
      db
        .select({ email: users.email, name: users.displayName, mfa: users.mfaEnabled, provider: users.authProvider, hasPassword: sql<boolean>`${users.passwordHash} is not null` })
        .from(users)
        .innerJoin(userRoles, eq(userRoles.userId, users.id))
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(eq(roles.key, "admin"), eq(users.isActive, true))),
      n(db.select({ n: sql<number>`count(distinct ${userRoles.userId})::int` }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(roles.key, "employee"))),
      n(db.select({ n: count() }).from(assets).where(and(inCo(assets.companyId), ne(assets.lifecycleStatus, "retired")))),
      n(db.select({ n: count() }).from(assets).where(and(inCo(assets.companyId), ne(assets.lifecycleStatus, "retired"), isNull(assets.ownerUserId), isNull(assets.ownerName)))),
      n(db.select({ n: count() }).from(risks).where(inCo(risks.companyId))),
      n(db.select({ n: count() }).from(risks).where(and(inCo(risks.companyId), isNull(risks.ownerPositionId)))),
      n(db.select({ n: count() }).from(requirementAssessments).where(inCo(requirementAssessments.companyId))),
      n(db.select({ n: count() }).from(policyFolders).where(inCo(policyFolders.companyId))),
      n(db.select({ n: count() }).from(policyTemplates).where(inCo(policyTemplates.companyId))),
      db
        .select({ id: policies.id, status: policies.status, approved: sql<boolean>`exists (select 1 from policy_versions v where v.policy_id = ${policies.id} and v.status = 'approved')` })
        .from(policies)
        .where(and(inCo(policies.companyId), eq(policies.docType, "policy"), ne(policies.status, "retired"))),
      n(db.select({ n: count() }).from(policies).innerJoin(policyVersions, and(eq(policyVersions.policyId, policies.id), eq(policyVersions.status, "approved"))).where(inCo(policies.companyId))),
      n(db.select({ n: count() }).from(trainingCourses).where(and(inCo(trainingCourses.companyId), eq(trainingCourses.active, true)))),
      getNotificationSettings(db),
      getAiSettings(db),
      getWazuhConfig(db, config),
      systemStatus(db, config, t),
    ]);
    const providers = await providersFor(db, config);
    const adLogins = await adLoginSources(db);
    const roleSet = new Set(secRoles.flatMap((r) => r.roles));
    const steps: SetupStepDto[] = [];
    const add = (st: Omit<SetupStepDto, "status"> & { status: SetupStepDto["status"] }) => steps.push(st);
    const skip = (key: string) => !mod(key);

    // 1. organizace
    const orgMissing = [
      s.organizationName && s.organizationName !== "Moje organizace" ? null : t("srv.setup.org.missingName"),
      s.organizationIco ? null : t("srv.setup.org.missingIco"),
      s.regulatedServices ? null : t("srv.setup.org.missingServices"),
    ].filter(Boolean) as string[];
    add({
      key: "organization",
      title: t("srv.setup.org.title"),
      why: t("srv.setup.org.why"),
      status: orgMissing.length === 0 ? "done" : orgMissing.length < 3 ? "partial" : "todo",
      detail: [
        t(s.organizationIco ? "srv.setup.org.detailIco" : "srv.setup.org.detail", {
          org: s.organizationName,
          ico: s.organizationIco ?? "",
          regime: (() => {
            const l = profileLabelKey(profileOf(s));
            return t(l.key, { main: l.main });
          })(),
        }),
        ...(orgMissing.length ? [t("srv.setup.org.fillIn", { fields: orgMissing.join(", ") })] : []),
      ],
      link: "/admin/settings",
      optional: false,
      helpTopic: "admin-setup",
    });

    // 2. zabezpečení
    const localAdminsNoMfa = admins.filter((a) => a.hasPassword && !a.mfa);
    const secIssues = [
      config.APP_SECRET ? null : t("srv.setup.sec.noSecret"),
      localAdminsNoMfa.length ? t("srv.setup.sec.adminsNoMfa", { emails: localAdminsNoMfa.map((a) => a.email).join(", ") }) : null,
      s.mfaRequired ? null : t("srv.setup.sec.mfaNotRequired"),
    ].filter(Boolean) as string[];
    add({
      key: "security",
      title: t("srv.setup.sec.title"),
      why: t("srv.setup.sec.why"),
      status: !config.APP_SECRET || localAdminsNoMfa.length ? "todo" : secIssues.length ? "partial" : "done",
      detail: secIssues.length ? secIssues : [t("srv.setup.sec.allOk")],
      link: "/admin/settings",
      optional: false,
      helpTopic: "admin-users",
    });

    // 3. SSO
    const google = providers.some((p) => p.id === "google");
    add({
      key: "sso",
      title: t("srv.setup.sso.title"),
      why: t("srv.setup.sso.why"),
      status: !providers.length && !adLogins.length ? "todo" : google && !s.oidcAllowedDomains?.length ? "partial" : "done",
      detail: providers.length || adLogins.length
        ? [
            ...(adLogins.length ? [t("srv.setup.sso.ad", { sources: adLogins.map((x) => x.name).join(", ") })] : []),
            ...(providers.length ? [t("srv.setup.sso.configured", { providers: providers.map((p) => p.label).join(", ") })] : []),
            s.oidcAllowedDomains?.length ? t("srv.setup.sso.domains", { domains: s.oidcAllowedDomains.join(", ") }) : t("srv.setup.sso.domainsAny"),
            s.oidcAutoProvision ? t("srv.setup.sso.autoProvision", { role: s.oidcDefaultRoleKey }) : t("srv.setup.sso.adminCreates"),
          ]
        : [t("srv.setup.sso.notSet")],
      link: "/admin/login",
      optional: true,
      helpTopic: "admin-users",
    });

    // 4. organizační struktura
    if (skip("organization")) add({ key: "structure", title: t("srv.setup.structure.skippedTitle"), why: "", status: "skipped", detail: [], link: "/admin/settings", optional: true });
    else {
      const missingRoles = ["Manažer kybernetické bezpečnosti", "Architekt kybernetické bezpečnosti", "Auditor kybernetické bezpečnosti"].filter((r) => !roleSet.has(r));
      add({
        key: "structure",
        title: t("srv.setup.structure.title"),
        why: t("srv.setup.structure.why"),
        status: !unitsN || !positionsN ? "todo" : heldN < positionsN * 0.5 || missingRoles.length ? "partial" : "done",
        detail: [
          t("srv.setup.structure.counts", { units: unitsN, positions: positionsN, held: heldN }),
          ...(missingRoles.length ? [t("srv.setup.structure.missingRoles", { roles: missingRoles.map((r) => t.lbl(r)).join(", ") })] : [t("srv.setup.structure.rolesOk")]),
        ],
        link: "/organization",
        optional: false,
        helpTopic: "organization",
      });
    }

    // 5. uživatelé
    add({
      key: "users",
      title: t("srv.setup.users.title"),
      why: t("srv.setup.users.why"),
      status: usersN <= 1 ? "todo" : noRole > 0 || employeesN === 0 ? "partial" : "done",
      detail: [t("srv.setup.users.counts", { users: usersN, employees: employeesN }), ...(noRole ? [t("srv.setup.users.noRole", { n: noRole })] : [])],
      link: "/admin/users",
      optional: false,
      helpTopic: "admin-users",
    });

    // 6. aktiva
    if (skip("assets")) add({ key: "assets", title: t("srv.setup.assets.skippedTitle"), why: "", status: "skipped", detail: [], link: "/admin/settings", optional: true });
    else
      add({
        key: "assets",
        title: t("srv.setup.assets.title"),
        why: t("srv.setup.assets.why"),
        status: !assetsN ? "todo" : noOwnerAssets > assetsN * 0.2 || (mod("discovery") && !wazuhReady(wazuh)) ? "partial" : "done",
        detail: [
          noOwnerAssets ? t("srv.setup.assets.countNoOwner", { n: assetsN, noOwner: noOwnerAssets }) : t("srv.setup.assets.count", { n: assetsN }),
          wazuhReady(wazuh) ? t("srv.setup.assets.wazuhOk") : t("srv.setup.assets.wazuhMissing"),
        ],
        link: wazuhReady(wazuh) || !mod("discovery") ? "/assets" : "/admin/connectors",
        optional: false,
        helpTopic: "assets",
      });

    // 7. rizika
    if (skip("risks")) add({ key: "risks", title: t("srv.setup.risks.skippedTitle"), why: "", status: "skipped", detail: [], link: "/admin/settings", optional: true });
    else
      add({
        key: "risks",
        title: t("srv.setup.risks.title"),
        why: t("srv.setup.risks.why"),
        status: !risksN ? "todo" : noOwnerRisks ? "partial" : "done",
        detail: [noOwnerRisks ? t("srv.setup.risks.countNoOwner", { n: risksN, noOwner: noOwnerRisks }) : t("srv.setup.risks.count", { n: risksN })],
        link: "/risks",
        optional: false,
        helpTopic: "risks",
      });

    // 8. opatření a SoA
    if (skip("controls")) add({ key: "controls", title: t("srv.setup.controls.skippedTitle"), why: "", status: "skipped", detail: [], link: "/admin/settings", optional: true });
    else
      add({
        key: "controls",
        title: t("srv.setup.controls.title"),
        why: t("srv.setup.controls.why"),
        status: assessN === 0 ? "todo" : assessN < 50 ? "partial" : "done",
        detail: [t("srv.setup.controls.count", { n: assessN })],
        link: "/controls",
        optional: false,
        helpTopic: "controls",
      });

    // 9. dokumentace
    if (skip("policies")) add({ key: "documentation", title: t("srv.setup.docs.skippedTitle"), why: "", status: "skipped", detail: [], link: "/admin/settings", optional: true });
    else {
      const politika = policyDoc.find((p) => p.approved && p.status === "active");
      add({
        key: "documentation",
        title: t("srv.setup.docs.title"),
        why: t("srv.setup.docs.why"),
        status: politika && foldersN ? "done" : docsN || foldersN || policyDoc.length ? "partial" : "todo",
        detail: [
          politika ? t("srv.setup.docs.policyApproved") : policyDoc.length ? t("srv.setup.docs.policyDraft") : t("srv.setup.docs.policyMissing"),
          t("srv.setup.docs.counts", { docs: docsN, folders: foldersN, templates: templatesN }),
        ],
        link: "/policies",
        optional: false,
        helpTopic: "dms-admin",
      });
    }

    // 10. povědomí
    if (skip("awareness")) add({ key: "awareness", title: t("srv.setup.awareness.skippedTitle"), why: "", status: "skipped", detail: [], link: "/admin/settings", optional: true });
    else
      add({
        key: "awareness",
        title: t("srv.setup.awareness.title"),
        why: t("srv.setup.awareness.why"),
        status: coursesN ? "done" : "todo",
        detail: [t("srv.setup.awareness.count", { n: coursesN })],
        link: "/awareness",
        optional: true,
        helpTopic: "training",
      });

    // 11. upozornění
    add({
      key: "notifications",
      title: t("srv.setup.notif.title"),
      why: t("srv.setup.notif.why"),
      status: notif.emailEnabled || notif.teamsEnabled ? "done" : "todo",
      detail: [notif.emailEnabled ? t("srv.setup.notif.emailOn") : t("srv.setup.notif.emailOff"), notif.teamsEnabled ? t("srv.setup.notif.teamsOn") : t("srv.setup.notif.teamsOff")],
      link: "/admin/notifications",
      optional: false,
      helpTopic: "admin-integrations",
    });

    // 12. AI
    add({
      key: "ai",
      title: t("srv.setup.ai.title"),
      why: t("srv.setup.ai.why"),
      status: !ai.enabled ? "todo" : ai.lastTestResult?.startsWith("Spojení funguje") ? "done" : "partial",
      detail: ai.enabled ? [`${ai.model} @ ${ai.baseUrl}`, ai.lastTestResult ?? t("srv.setup.ai.notTested")] : [t("srv.setup.ai.off")],
      link: "/admin/ai",
      optional: true,
      helpTopic: "ai",
    });

    // 12b. identity a přístupy
    if (skip("identity")) add({ key: "identity", title: t("srv.setup.identity.skippedTitle"), why: "", status: "skipped", detail: [], link: "/admin/settings", optional: true });
    else {
      const src = await db.select().from(identitySources);
      const ok = src.filter((x) => x.enabled && x.lastStatus === "ok");
      add({
        key: "identity",
        title: t("srv.setup.identity.title"),
        why: t("srv.setup.identity.why"),
        status: ok.length ? "done" : src.length ? "partial" : "todo",
        detail: src.length
          ? src.map((x) =>
              x.lastStatus === "ok"
                ? t("srv.setup.identity.synced", { name: x.name, date: String(x.lastSyncAt?.toISOString().slice(0, 10)) })
                : x.lastStatus === "error"
                  ? t("srv.setup.identity.error", { name: x.name, error: x.lastError ?? "" })
                  : t("srv.setup.identity.notSynced", { name: x.name }),
            )
          : [t("srv.setup.identity.none")],
        link: "/identity",
        optional: true,
        helpTopic: "identity",
      });
    }

    // 13. provoz
    const opsKeys = ["backup", "scheduler", "converter", "secret", "db"];
    const opsChecks = ops.checks.filter((x) => opsKeys.includes(x.key) && x.level !== "off");
    add({
      key: "operations",
      title: t("srv.setup.ops.title"),
      why: t("srv.setup.ops.why"),
      status: opsChecks.some((x) => x.level === "error") ? "todo" : opsChecks.some((x) => x.level === "warning") ? "partial" : "done",
      detail: opsChecks.map((x) => `${x.label}: ${x.detail}`),
      link: "/admin/ops",
      optional: false,
      helpTopic: "admin-ops",
    });

    const required = steps.filter((x) => !x.optional && x.status !== "skipped");
    const done = required.filter((x) => x.status === "done").length;
    return { steps, done, total: required.length, ready: done === required.length, canCreateDocFolders: mod("policies") && foldersN === 0 };
  }

  /** Předávací protokol – HTML podmnožina pro tisk i Word. */
  async function protocolHtml(c: Parameters<typeof scopeOf>[0], t: Translate = CS_T) {
    const s = await getSettings(db);
    const setup = await computeSetup(c, t);
    const ops = await systemStatus(db, config, t);
    const admins = await db
      .select({ email: users.email, name: users.displayName, mfa: users.mfaEnabled, provider: users.authProvider })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(roles.key, "admin"), eq(users.isActive, true)));
    const e = html.esc;
    const row = (a: string, b: string) => `<tr><td><b>${e(a)}</b></td><td>${b}</td></tr>`;
    const body = `
<h1>${e(t("srv.setup.proto.title"))}</h1>
<p class="muted">${s.organizationIco ? e(t("srv.setup.proto.orgIco", { org: s.organizationName, ico: s.organizationIco })) : e(s.organizationName)}${s.organizationAddress ? `, ${e(s.organizationAddress)}` : ""}</p>
<table>
${row(t("srv.setup.proto.date"), e(new Date().toLocaleString(t.locale)))}
${row(t("srv.setup.proto.version"), e(CONTIX_VERSION))}
${row(t("srv.setup.proto.appUrl"), e(config.APP_URL))}
${row(t("srv.setup.proto.setupState"), e(t(setup.ready ? "srv.setup.proto.stepsDoneReady" : "srv.setup.proto.stepsDone", { done: setup.done, total: setup.total })))}
${row(t("srv.setup.proto.issuedBy"), e(currentUser(c).displayName))}
</table>
<h2>${e(t("srv.setup.proto.h1"))}</h2>
<table>
<tr><td><b>${e(t("srv.setup.proto.step"))}</b></td><td><b>${e(t("srv.setup.proto.state"))}</b></td><td><b>${e(t("srv.setup.proto.details"))}</b></td></tr>
${setup.steps.map((st) => `<tr><td>${e(st.title)}${st.optional ? ` <span class="small">${e(t("srv.setup.proto.optional"))}</span>` : ""}</td><td>${e(t.lbl(SETUP_LABELS.status[st.status]))}</td><td>${st.detail.map(e).join("<br>")}</td></tr>`).join("\n")}
</table>
<h2>${e(t("srv.setup.proto.h2"))}</h2>
<table>
<tr><td><b>${e(t("srv.setup.proto.check"))}</b></td><td><b>${e(t("srv.setup.proto.state"))}</b></td><td><b>${e(t("srv.setup.proto.details"))}</b></td></tr>
${ops.checks.map((ch) => `<tr><td>${e(ch.label)}</td><td>${e(ch.level === "ok" ? "OK" : ch.level === "warning" ? t("srv.setup.proto.levelWarning") : ch.level === "error" ? t("srv.setup.proto.levelError") : t("srv.setup.proto.levelOff"))}</td><td>${e(ch.detail)}</td></tr>`).join("\n")}
</table>
<p class="small">${e(t("srv.setup.proto.dbLine", { version: ops.database.version ?? "?", migrations: ops.database.migrations ?? "?", backup: ops.lastSuccessfulBackupAt ? new Date(ops.lastSuccessfulBackupAt).toLocaleString(t.locale) : t("srv.setup.proto.noBackup") }))}</p>
<h2>${e(t("srv.setup.proto.h3"))}</h2>
<table>
<tr><td><b>${e(t("srv.setup.proto.name"))}</b></td><td><b>${e(t("srv.setup.proto.email"))}</b></td><td><b>${e(t("srv.setup.proto.signIn"))}</b></td></tr>
${admins.map((a) => `<tr><td>${e(a.name)}</td><td>${e(a.email)}</td><td>${a.provider === "local" ? e(a.mfa ? t("srv.setup.proto.pwdMfa") : t("srv.setup.proto.pwdOnly")) : "SSO"}</td></tr>`).join("\n")}
</table>
<h2>${e(t("srv.setup.proto.h4"))}</h2>
<ul>
${(["srv.setup.proto.li1", "srv.setup.proto.li2", "srv.setup.proto.li3", "srv.setup.proto.li4", "srv.setup.proto.li5", "srv.setup.proto.li6", "srv.setup.proto.li7"] as const).map((k) => `<li>${e(t(k))}</li>`).join("\n")}
</ul>
<h2>${e(t("srv.setup.proto.h5"))}</h2>
<p>${e(t("srv.setup.proto.restoreTest"))} ……………………………………………………</p>
<p>${e(t("srv.setup.proto.openItems"))} ……………………………………………………………………………………</p>
<p>&nbsp;</p>
<table>
<tr><td><b>${e(t("srv.setup.proto.handedBy"))}</b></td><td><b>${e(t("srv.setup.proto.takenBy"))}</b></td></tr>
<tr><td>${e(t("srv.setup.proto.nameField"))} ……………………………<br>${e(t("srv.setup.proto.signField"))} ……………………………</td><td>${e(t("srv.setup.proto.nameField"))} ……………………………<br>${e(t("srv.setup.proto.signField"))} ……………………………</td></tr>
</table>`;
    return { html: printPage(t("srv.setup.proto.title"), body), org: s.organizationName, title: t("srv.setup.proto.title"), fileName: t("srv.setup.proto.fileName", { date: new Date().toISOString().slice(0, 10) }) };
  }

  return new Hono<AppEnv>()
    .get("/", requirePerm("admin:settings"), async (c) => c.json(await computeSetup(c, await tFor(db, c))))
    .get("/protocol.html", requirePerm("admin:settings"), async (c) => {
      const r = await protocolHtml(c, await tFor(db, c));
      await audit(db, { c, user: currentUser(c), action: "setup.protocol_exported", details: { format: "html" } });
      return c.html(r.html, 200, { "cache-control": "private, no-store" });
    })
    .get("/protocol.docx", requirePerm("admin:settings"), async (c) => {
      const r = await protocolHtml(c, await tFor(db, c));
      await audit(db, { c, user: currentUser(c), action: "setup.protocol_exported", details: { format: "docx" } });
      return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: r.org }), r.fileName);
    })
    /** Výchozí struktura složek dokumentace (jen pokud zatím žádné nejsou). */
    .post("/doc-folders", requirePerm("policies:write"), async (c) => {
      const companyId = targetCompany(c, null, "policies:write");
      const [exists] = await db.select({ id: policyFolders.id }).from(policyFolders).where(eq(policyFolders.companyId, companyId)).limit(1);
      if (!exists)
        await db.transaction(async (tx) => {
          let pos = 0;
          for (const f of DEFAULT_DOC_FOLDERS) {
            const [row] = await tx.insert(policyFolders).values({ companyId, name: f.name, codePrefix: f.codePrefix, position: pos++ }).returning({ id: policyFolders.id });
            let sub = 0;
            for (const ch of f.children ?? []) await tx.insert(policyFolders).values({ companyId, parentId: row!.id, name: ch.name, codePrefix: ch.codePrefix ?? null, position: sub++ });
          }
        });
      await audit(db, { c, user: currentUser(c), action: "setup.doc_folders_created", details: { created: !exists } });
      return c.json(await computeSetup(c, await tFor(db, c)));
    });
}

