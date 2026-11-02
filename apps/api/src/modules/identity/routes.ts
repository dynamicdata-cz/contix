import {
  AcceptIdentityFindingInput,
  AdSourceConfig,
  EntraSourceConfig,
  IDENTITY_FINDING_STATUSES,
  IDENTITY_RULE_INFO,
  IDENTITY_RULES,
  IDENTITY_SEVERITIES,
  IdentitySourceInput,
  IdentitySourceTestInput,
  identitySeverityRank,
  type IdentityAccountDetail,
  type IdentityAccountDto,
  type IdentityFindingDto,
  type IdentityOverviewDto,
  type IdentityRule,
  type IdentitySeverity,
  type IdentityTestResult,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { encrypt } from "../../auth/crypto";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { tFor } from "../i18n/service";
import { identityAccounts, identityFindings, identitySnapshots, identitySources, roles, users } from "../../db/schema";
import { applyProvisioning, managedUsers, planFor, provisioningOf } from "./provisioning";
import { testAd } from "./ad";
import { testEntra } from "./entra";
import { groupList, reviewRoutes, sodRoutes } from "./reviews";
import { automationRoutes } from "./automations";
import { isSyncRunning, sourceDto, sourceSecret, sourceStats, syncSource, type SourceRow } from "./service";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * Identity a přístupy – /api/identity (ADR-029).
 * Čtení identity:read, výjimky a ruční synchronizace identity:write, nastavení zdrojů admin:settings.
 * ============================================================ */

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

const FindingQuery = z.object({
  status: z.enum(IDENTITY_FINDING_STATUSES).optional(),
  severity: z.enum(IDENTITY_SEVERITIES).optional(),
  rule: z.enum(IDENTITY_RULES).optional(),
  sourceId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
});
const AccountQuery = z.object({
  sourceId: z.string().uuid().optional(),
  q: z.string().trim().max(200).optional(),
  privileged: z.enum(["1", "0"]).optional(),
  enabled: z.enum(["1", "0"]).optional(),
  kind: z.enum(["user", "service", "guest"]).optional(),
  withFindings: z.enum(["1"]).optional(),
  removed: z.enum(["1"]).optional(),
});

export function identityRoutes(db: Db, config: Config) {
  async function sourceRow(c: Context<AppEnv>, id: string): Promise<SourceRow> {
    const [row] = await db.select().from(identitySources).where(eq(identitySources.id, id));
    if (!row) throw new HTTPException(404, { message: "Zdroj nenalezen" });
    assertScope(c, row.companyId, "Zdroj nenalezen");
    return row;
  }

  async function findings(c: Context<AppEnv>, where: SQL[], limit = 2000): Promise<IdentityFindingDto[]> {
    const rows = await db
      .select({
        f: identityFindings,
        sourceName: identitySources.name,
        sourceKind: identitySources.kind,
        acc: { id: identityAccounts.id, login: identityAccounts.login, displayName: identityAccounts.displayName, kind: identityAccounts.kind, privileged: identityAccounts.privileged },
        acceptedByName: users.displayName,
      })
      .from(identityFindings)
      .innerJoin(identitySources, eq(identitySources.id, identityFindings.sourceId))
      .leftJoin(identityAccounts, eq(identityAccounts.id, identityFindings.accountId))
      .leftJoin(users, eq(users.id, identityFindings.acceptedBy))
      .where(and(inScope(c, identityFindings.companyId), ...where))
      .orderBy(sql`case ${identityFindings.severity} when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end`, asc(identityFindings.rule), asc(identityAccounts.login))
      .limit(limit);
    return rows.map((r) => ({
      id: r.f.id,
      sourceId: r.f.sourceId,
      sourceName: r.sourceName,
      sourceKind: r.sourceKind,
      rule: r.f.rule as IdentityRule,
      severity: r.f.severity,
      subject: r.f.accountId ? (r.acc?.login ?? r.f.subject) : r.f.subject.replace(/^group:/, ""),
      detail: r.f.detail,
      status: r.f.status,
      account: r.acc?.id ? { id: r.acc.id, login: r.acc.login, displayName: r.acc.displayName, kind: r.acc.kind, privileged: r.acc.privileged } : null,
      acceptedByName: r.acceptedByName ?? null,
      acceptedReason: r.f.acceptedReason,
      acceptedUntil: r.f.acceptedUntil,
      firstSeenAt: r.f.firstSeenAt.toISOString(),
      lastSeenAt: r.f.lastSeenAt.toISOString(),
      resolvedAt: iso(r.f.resolvedAt),
    }));
  }

  async function accounts(c: Context<AppEnv>, where: SQL[], limit = 1000): Promise<(IdentityAccountDto & { _row: typeof identityAccounts.$inferSelect })[]> {
    const open = db
      .select({
        accountId: identityFindings.accountId,
        n: count().as("n"),
        maxRank: sql<number>`max(case ${identityFindings.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end)`.as("max_rank"),
      })
      .from(identityFindings)
      .where(eq(identityFindings.status, "open"))
      .groupBy(identityFindings.accountId)
      .as("open_f");
    const rows = await db
      .select({ a: identityAccounts, sourceName: identitySources.name, sourceKind: identitySources.kind, u: { id: users.id, name: users.displayName, active: users.isActive }, n: open.n, maxRank: open.maxRank })
      .from(identityAccounts)
      .innerJoin(identitySources, eq(identitySources.id, identityAccounts.sourceId))
      .leftJoin(users, eq(users.id, identityAccounts.userId))
      .leftJoin(open, eq(open.accountId, identityAccounts.id))
      .where(and(inScope(c, identityAccounts.companyId), ...where))
      .orderBy(desc(sql`coalesce(${open.maxRank}, 0)`), desc(identityAccounts.privileged), asc(identityAccounts.login))
      .limit(limit);
    const sevOf = (rank: number | null): IdentitySeverity | null => (rank ? (["low", "medium", "high", "critical"] as const)[Number(rank) - 1]! : null);
    return rows.map((r) => ({
      _row: r.a,
      id: r.a.id,
      sourceId: r.a.sourceId,
      sourceName: r.sourceName,
      sourceKind: r.sourceKind,
      login: r.a.login,
      displayName: r.a.displayName,
      email: r.a.email,
      kind: r.a.kind,
      enabled: r.a.enabled,
      privileged: r.a.privileged,
      privilegedVia: r.a.privilegedVia,
      lastLogonAt: iso(r.a.lastLogonAt),
      pwdLastSetAt: iso(r.a.pwdLastSetAt),
      createdAt: iso(r.a.dirCreatedAt),
      mfa: r.a.mfa,
      department: r.a.department,
      title: r.a.title,
      contixUser: r.u?.id ? { id: r.u.id, name: r.u.name, active: !!r.u.active } : null,
      openFindings: Number(r.n ?? 0),
      maxSeverity: sevOf(r.maxRank),
      removedAt: iso(r.a.removedAt),
    }));
  }

  /** Synchronizace uživatelů zakládá účty a role – vyžaduje správu uživatelů a rolí; skupina a role musí existovat. */
  async function checkProvisioning(c: Context<AppEnv>, p: { enabled: boolean; group: string; defaultRoleKey: string }, prev?: { enabled?: boolean } | null) {
    if (!p.enabled) return;
    if (!prev?.enabled && !(hasPerm(c, "admin:users") && hasPerm(c, "admin:roles"))) throw new HTTPException(403, { message: "Zapnout synchronizaci uživatelů smí jen správce uživatelů a rolí." });
    if (!p.group.trim()) throw new HTTPException(400, { message: "Pro synchronizaci uživatelů zadejte skupinu, jejíž členové budou uživateli CONTIXu." });
    const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, p.defaultRoleKey));
    if (!r) throw new ApiError(400, "err.identity.roleNotFound", { role: String(p.defaultRoleKey) });
  }

  const strip = <T extends { _row: unknown }>({ _row, ...rest }: T) => rest;

  /** Uložení tajemství: nové zašifrovat, prázdné = ponechat. */
  const secretEnc = (secret: string | undefined, prev: string | null) => (secret ? encrypt(secret, appSecret(config)) : prev);

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "identity"))

      .get("/overview", requirePerm("identity:read"), async (c) => {
        const sc = inScope(c, identityFindings.companyId);
        const since = new Date(Date.now() - 180 * 86_400_000);
        const [sources, bySev, [acc], byRule, [accepted], snaps] = await Promise.all([
          db.select().from(identitySources).where(inScope(c, identitySources.companyId)).orderBy(asc(identitySources.name)),
          db.select({ s: identityFindings.severity, n: count() }).from(identityFindings).where(and(sc, eq(identityFindings.status, "open"))).groupBy(identityFindings.severity),
          db
            .select({
              accounts: sql<number>`count(*) filter (where ${identityAccounts.enabled})`.mapWith(Number),
              privileged: sql<number>`count(*) filter (where ${identityAccounts.enabled} and ${identityAccounts.privileged})`.mapWith(Number),
            })
            .from(identityAccounts)
            .where(and(inScope(c, identityAccounts.companyId), isNull(identityAccounts.removedAt))),
          db
            .select({ rule: identityFindings.rule, n: count(), max: sql<number>`max(case ${identityFindings.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end)` })
            .from(identityFindings)
            .where(and(sc, eq(identityFindings.status, "open")))
            .groupBy(identityFindings.rule),
          db.select({ n: count() }).from(identityFindings).where(and(sc, eq(identityFindings.status, "accepted"))),
          db
            .select({ sourceId: identitySnapshots.sourceId, at: identitySnapshots.at, stats: identitySnapshots.stats })
            .from(identitySnapshots)
            .where(and(inScope(c, identitySnapshots.companyId), gte(identitySnapshots.at, since)))
            .orderBy(asc(identitySnapshots.at)),
        ]);
        const open = Object.fromEntries(IDENTITY_SEVERITIES.map((s) => [s, 0])) as Record<IdentitySeverity, number>;
        for (const r of bySev) open[r.s] = r.n;
        // trend: po dnech poslední stav každého zdroje, sečtený
        const days = new Map<string, Map<string, (typeof snaps)[number]["stats"]>>();
        for (const s of snaps) {
          const d = s.at.toISOString().slice(0, 10);
          if (!days.has(d)) days.set(d, new Map());
          days.get(d)!.set(s.sourceId, s.stats);
        }
        const last = new Map<string, (typeof snaps)[number]["stats"]>();
        const trend: IdentityOverviewDto["trend"] = [];
        for (const [day, m] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
          for (const [id, st] of m) last.set(id, st);
          const sum = { day, critical: 0, high: 0, medium: 0, low: 0 };
          for (const st of last.values()) for (const k of IDENTITY_SEVERITIES) sum[k] += st.findings[k] ?? 0;
          trend.push(sum);
        }
        const sevByRank = ["low", "medium", "high", "critical"] as const;
        const dto: IdentityOverviewDto = {
          sources: sources.map(sourceDto),
          open,
          accepted: accepted?.n ?? 0,
          byRule: byRule
            .map((r) => ({ rule: r.rule as IdentityRule, open: r.n, severity: sevByRank[Number(r.max) - 1]! }))
            .sort((a, b) => identitySeverityRank(b.severity) - identitySeverityRank(a.severity) || b.open - a.open),
          privileged: acc?.privileged ?? 0,
          accounts: acc?.accounts ?? 0,
          trend: trend.slice(-60),
        };
        return c.json(dto);
      })

      .get("/rules", requirePerm("identity:read"), (c) => c.json(IDENTITY_RULE_INFO))

      .get("/groups", requirePerm("identity:read"), async (c) => c.json(await groupList(db, inScope(c, identityAccounts.companyId))))
      .route("/sod", sodRoutes(db))
      .route("/reviews", reviewRoutes(db))
      .route("/automations", automationRoutes(db))

      /* ---------- nálezy ---------- */

      .get("/findings", requirePerm("identity:read"), zValidator("query", FindingQuery), async (c) => {
        const q = c.req.valid("query");
        const where: SQL[] = [eq(identityFindings.status, q.status ?? "open")];
        if (q.severity) where.push(eq(identityFindings.severity, q.severity));
        if (q.rule) where.push(eq(identityFindings.rule, q.rule));
        if (q.sourceId) where.push(eq(identityFindings.sourceId, q.sourceId));
        if (q.accountId) where.push(eq(identityFindings.accountId, q.accountId));
        if (q.q) {
          const like = `%${likeEsc(q.q)}%`;
          where.push(or(ilike(identityAccounts.login, like), ilike(identityAccounts.displayName, like), ilike(identityFindings.detail, like))!);
        }
        return c.json(await findings(c, where));
      })

      /** Export nálezů pro auditora (CSV, středník, UTF-8 s BOM). */
      .get("/findings.csv", requirePerm("identity:read"), zValidator("query", FindingQuery), async (c) => {
        const q = c.req.valid("query");
        const where: SQL[] = [eq(identityFindings.status, q.status ?? "open")];
        if (q.sourceId) where.push(eq(identityFindings.sourceId, q.sourceId));
        const rows = await findings(c, where, 50_000);
        const t = await tFor(db, c);
        const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = [
          [
            t("srv.idn.colSource"),
            t("srv.idn.colRule"),
            t("srv.idn.colSeverity"),
            t("srv.idn.colSubject"),
            t("srv.idn.colName"),
            t("srv.idn.colDetail"),
            t("srv.idn.colStatus"),
            t("srv.idn.colFirstSeen"),
            t("srv.idn.colLastSeen"),
            t("srv.idn.colAcceptedUntil"),
            t("srv.idn.colAcceptedReason"),
          ].map(cell).join(";"),
          ...rows.map((f) =>
            [f.sourceName, t.lbl(IDENTITY_RULE_INFO[f.rule]?.title) ?? f.rule, f.severity, f.subject, f.account?.displayName ?? "", f.detail, f.status, f.firstSeenAt.slice(0, 10), f.lastSeenAt.slice(0, 10), f.acceptedUntil ?? "", f.acceptedReason ?? ""]
              .map(cell)
              .join(";"),
          ),
        ];
        await audit(db, { c, user: currentUser(c), action: "identity.exported", entityType: "identity", details: { rows: rows.length, status: q.status ?? "open" } });
        return c.body(`﻿${lines.join("\r\n")}\r\n`, 200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="nalezy-identity-${new Date().toISOString().slice(0, 10)}.csv"`,
        });
      })

      .post("/findings/:id/accept", requirePerm("identity:write"), zValidator("json", AcceptIdentityFindingInput), async (c) => {
        const input = c.req.valid("json");
        const [f] = await db.select().from(identityFindings).where(eq(identityFindings.id, c.req.param("id")));
        if (!f) throw new HTTPException(404, { message: "Nález nenalezen" });
        assertScope(c, f.companyId, "Nález nenalezen");
        if (f.status === "resolved") throw new HTTPException(409, { message: "Vyřešený nález nelze akceptovat." });
        const today = new Date().toISOString().slice(0, 10);
        const max = new Date(Date.now() + 731 * 86_400_000).toISOString().slice(0, 10);
        if (input.until <= today || input.until > max) throw new HTTPException(400, { message: "Výjimka musí platit do budoucího data, nejdéle 2 roky." });
        await db
          .update(identityFindings)
          .set({ status: "accepted", acceptedBy: currentUser(c).id, acceptedReason: input.reason, acceptedUntil: input.until })
          .where(eq(identityFindings.id, f.id));
        await audit(db, { c, user: currentUser(c), action: "identity.finding_accepted", entityType: "identity_finding", entityId: f.id, details: { rule: f.rule, until: input.until, reason: input.reason } });
        await refreshStats(f.sourceId);
        return c.json((await findings(c, [eq(identityFindings.id, f.id)]))[0]);
      })

      .post("/findings/:id/reopen", requirePerm("identity:write"), async (c) => {
        const [f] = await db.select().from(identityFindings).where(eq(identityFindings.id, c.req.param("id")));
        if (!f) throw new HTTPException(404, { message: "Nález nenalezen" });
        assertScope(c, f.companyId, "Nález nenalezen");
        if (f.status !== "accepted") throw new HTTPException(409, { message: "Znovu otevřít lze jen nález s výjimkou." });
        await db.update(identityFindings).set({ status: "open", acceptedBy: null, acceptedReason: null, acceptedUntil: null }).where(eq(identityFindings.id, f.id));
        await audit(db, { c, user: currentUser(c), action: "identity.finding_reopened", entityType: "identity_finding", entityId: f.id, details: { rule: f.rule } });
        await refreshStats(f.sourceId);
        return c.json((await findings(c, [eq(identityFindings.id, f.id)]))[0]);
      })

      /* ---------- účty ---------- */

      .get("/accounts", requirePerm("identity:read"), zValidator("query", AccountQuery), async (c) => {
        const q = c.req.valid("query");
        const where: SQL[] = [q.removed ? sql`${identityAccounts.removedAt} is not null` : isNull(identityAccounts.removedAt)];
        if (q.sourceId) where.push(eq(identityAccounts.sourceId, q.sourceId));
        if (q.privileged) where.push(eq(identityAccounts.privileged, q.privileged === "1"));
        if (q.enabled) where.push(eq(identityAccounts.enabled, q.enabled === "1"));
        if (q.kind) where.push(eq(identityAccounts.kind, q.kind));
        if (q.withFindings) where.push(sql`exists (select 1 from ${identityFindings} where ${identityFindings.accountId} = ${identityAccounts.id} and ${identityFindings.status} = 'open')`);
        if (q.q) {
          const like = `%${likeEsc(q.q)}%`;
          where.push(or(ilike(identityAccounts.login, like), ilike(identityAccounts.displayName, like), ilike(identityAccounts.email, like), ilike(identityAccounts.department, like))!);
        }
        return c.json((await accounts(c, where)).map(strip));
      })

      .get("/accounts/:id", requirePerm("identity:read"), async (c) => {
        const [a] = await accounts(c, [eq(identityAccounts.id, c.req.param("id"))], 1);
        if (!a) throw new HTTPException(404, { message: "Účet nenalezen" });
        const all = await findings(c, [eq(identityFindings.accountId, a.id), inArray(identityFindings.status, ["open", "accepted", "resolved"])]);
        const { _row, ...dto } = a;
        const detail: IdentityAccountDetail = { ...dto, dn: _row.dn, groups: _row.groups, flags: _row.flags, findings: all };
        return c.json(detail);
      })

      /* ---------- zdroje ---------- */

      .get("/sources", requirePerm("identity:read"), async (c) => {
        const rows = await db.select().from(identitySources).where(inScope(c, identitySources.companyId)).orderBy(asc(identitySources.name));
        return c.json(rows.map(sourceDto));
      })

      .post("/sources", requirePerm("admin:settings"), zValidator("json", IdentitySourceInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, input.companyId);
        if (!input.secret) throw new HTTPException(400, { message: input.kind === "ad" ? "Zadejte heslo účtu pro čtení." : "Zadejte tajný klíč aplikace." });
        await checkProvisioning(c, input.provisioning);
        const [row] = await db
          .insert(identitySources)
          .values({ companyId, kind: input.kind, name: input.name, enabled: input.enabled, config: input.config, secretEnc: secretEnc(input.secret, null), policy: input.policy, provisioning: input.provisioning, syncHours: input.syncHours })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "identity.source_created", entityType: "identity_source", entityId: row!.id, details: { kind: input.kind, name: input.name, config: publicConfig(input.config) } });
        return c.json(sourceDto(row!), 201);
      })

      .put("/sources/:id", requirePerm("admin:settings"), zValidator("json", IdentitySourceInput), async (c) => {
        const prev = await sourceRow(c, c.req.param("id"));
        const input = c.req.valid("json");
        if (input.kind !== prev.kind) throw new HTTPException(400, { message: "Druh zdroje nelze změnit – založte nový zdroj." });
        const companyId = input.companyId ? targetCompany(c, input.companyId) : prev.companyId;
        await checkProvisioning(c, input.provisioning, prev.provisioning);
        const [row] = await db
          .update(identitySources)
          .set({ companyId, name: input.name, enabled: input.enabled, config: input.config, secretEnc: secretEnc(input.secret, prev.secretEnc), policy: input.policy, provisioning: input.provisioning, syncHours: input.syncHours, updatedAt: new Date() })
          .where(eq(identitySources.id, prev.id))
          .returning();
        if (companyId !== prev.companyId)
          for (const t of [identityAccounts, identityFindings, identitySnapshots]) await db.update(t).set({ companyId }).where(eq(t.sourceId, prev.id));
        await audit(db, {
          c,
          user: currentUser(c),
          action: "identity.source_updated",
          entityType: "identity_source",
          entityId: prev.id,
          details: { name: input.name, enabled: input.enabled, config: publicConfig(input.config), secretChanged: !!input.secret, policy: input.policy, provisioning: input.provisioning },
        });
        return c.json(sourceDto(row!));
      })

      .delete("/sources/:id", requirePerm("admin:settings"), async (c) => {
        const prev = await sourceRow(c, c.req.param("id"));
        if (isSyncRunning(prev.id)) throw new HTTPException(409, { message: "Synchronizace právě probíhá – zkuste to za chvíli." });
        await db.delete(identitySources).where(eq(identitySources.id, prev.id));
        await audit(db, { c, user: currentUser(c), action: "identity.source_deleted", entityType: "identity_source", entityId: prev.id, details: { name: prev.name, kind: prev.kind } });
        return c.json({ ok: true });
      })

      /** Test připojení s hodnotami z formuláře (bez uložení); prázdné tajemství = uložené. */
      .post("/sources/test", requirePerm("admin:settings"), zValidator("json", IdentitySourceTestInput), async (c) => {
        const input = c.req.valid("json");
        let secret = input.secret;
        if (!secret && input.id) secret = sourceSecret(await sourceRow(c, input.id), config) ?? undefined;
        if (!secret) throw new HTTPException(400, { message: input.kind === "ad" ? "Zadejte heslo účtu pro čtení." : "Zadejte tajný klíč aplikace." });
        let result: IdentityTestResult;
        try {
          if (input.kind === "ad") {
            const r = await testAd({ config: AdSourceConfig.parse(input.config), password: secret });
            result = { ok: true, message: (await tFor(db, c))("srv.idn.testAdOk", { users: String(r.users), groups: String(r.groups) }) };
          } else {
            const r = await testEntra({ config: EntraSourceConfig.parse(input.config), secret, env: config });
            result = { ok: true, message: (await tFor(db, c))("srv.idn.testEntraOk", { users: String(r.users) }), notes: r.notes };
          }
        } catch (e) {
          result = { ok: false, message: (e as Error).message };
        }
        await audit(db, { c, user: currentUser(c), action: "identity.source_tested", entityType: "identity_source", entityId: input.id, details: { kind: input.kind, ok: result.ok } });
        return c.json(result);
      })

      /** Náhled synchronizace uživatelů podle posledních načtených účtů (nic nemění). */
      .get("/sources/:id/provisioning", requirePerm("admin:settings"), async (c) => {
        const row = await sourceRow(c, c.req.param("id"));
        const plan = await planFor(db, { ...row, provisioning: { ...provisioningOf(row), enabled: true } });
        return c.json({ ...plan, managedUsers: await managedUsers(db, row.id) });
      })
      .post("/sources/:id/provisioning/run", requirePerm("admin:settings", "admin:users"), async (c) => {
        const row = await sourceRow(c, c.req.param("id"));
        if (!provisioningOf(row).enabled) throw new HTTPException(409, { message: "Synchronizace uživatelů není u zdroje zapnutá." });
        if (!(hasPerm(c, "admin:users") && hasPerm(c, "admin:settings"))) throw new HTTPException(403, { message: "Nemáte oprávnění" });
        return c.json(await applyProvisioning(db, row, { actor: currentUser(c) }));
      })

      .post("/sources/:id/sync", requirePerm("identity:write"), async (c) => {
        const row = await sourceRow(c, c.req.param("id"));
        if (isSyncRunning(row.id)) throw new HTTPException(409, { message: "Synchronizace už probíhá." });
        try {
          const r = await syncSource(db, config, row.id);
          await audit(db, { c, user: currentUser(c), action: "identity.synced", entityType: "identity_source", entityId: row.id, details: { accounts: r.accounts, opened: r.findings.opened, resolved: r.findings.resolved } });
          return c.json({ ok: true, ...r });
        } catch (e) {
          await audit(db, { c, user: currentUser(c), action: "identity.sync_failed", entityType: "identity_source", entityId: row.id, details: { error: (e as Error).message } });
          return c.json({ ok: false, error: (e as Error).message }, 502);
        }
      })
  );

  async function refreshStats(sourceId: string) {
    await db.update(identitySources).set({ stats: await sourceStats(db, sourceId) }).where(eq(identitySources.id, sourceId));
  }
}

/** Konfigurace do auditního záznamu (bez certifikátu). */
function publicConfig(cfg: Record<string, unknown>) {
  const { caCert, ...rest } = cfg as { caCert?: string };
  return { ...rest, caCert: caCert ? "(vložen)" : "" };
}
