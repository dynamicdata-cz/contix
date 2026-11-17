import {
  FINDING_SOURCES,
  FindingsQuery,
  FindingPlanTasksInput,
  RemediationQuery,
  UNIFIED_SEVERITIES,
  unifiedSeverity,
  findingPriority,
  findingSlaDue,
  unifiedStatus,
  type FindingSource,
  type Permission,
  type UnifiedFindingDto,
  type UnifiedFindingsDto,
  type UnifiedSeverity,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { currentUser } from "../../auth/middleware";
import { orgSnapshot } from "../org/hierarchy";
import { findingsRemediation } from "./metrics";
import { escalationsFor, findingEscalations } from "./escalation";
import { buildFindingPlan, createPlanTasks, lastFindingPlan, planView } from "./plan";
import { AiUnavailable } from "../sectests/ai";
import { tFor } from "../i18n/service";
import type { Config } from "../../config";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requirePerm } from "../../auth/middleware";
import { hasPermIn, scopeOf, soleCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, auditFindings, audits, hostFindings, hostInventories, positions, secTestFindings, users, vulnIntel } from "../../db/schema";
import { getVulnSla, vulnDueSql } from "../vulnerabilities/intel";
import { hostFindingTasks, hostFindingTitle } from "../collector/findings";
import { findingTasks } from "../sectests/tasks";

/* ============================================================
 * Jednotný přehled nálezů (v1.65, ADR-158) – čte čtyři zdroje v rozsahu a oprávněních uživatele:
 * testy (sectests:read), sběrač (assets:read), zranitelnosti (assets:read + modul vulnerabilities), audity (audits:read).
 * ============================================================ */

const ACCESS: Record<FindingSource, { perm: Permission; module: string }> = {
  sectest: { perm: "sectests:read", module: "sectests" },
  host: { perm: "assets:read", module: "assets" },
  vulnerability: { perm: "assets:read", module: "vulnerabilities" },
  audit: { perm: "audits:read", module: "audits" },
};
const LIMIT = 1500;

/** Termín nálezu: úkol z nálezu (otevřený i uzavřený), jinak lhůta podle závažnosti (v1.71, ADR-164). */
/** Nález po termínu: otevřený úkol po termínu, nebo bez úkolu po lhůtě podle závažnosti. */
const lateOf = (status: string, t: { dueDate: string | null; status: string } | null, sla: string, today: string) =>
  status === "open" && (t ? !!t.dueDate && t.dueDate < today && (t.status === "open" || t.status === "in_progress") : sla < today);
const dueOf = (t: { dueDate: string | null } | null, sla: string | null) => (t?.dueDate ? { dueDate: t.dueDate, dueFromSla: false } : { dueDate: sla, dueFromSla: !!sla });
const tech = alias(users, "fnd_tech");
const SRC_SEV: Record<FindingSource, (s: UnifiedSeverity) => string[]> = {
  sectest: (s) => [s],
  host: (s) => [s],
  vulnerability: (s) => (s === "info" ? ["unknown"] : [s]),
  audit: (s) => ({ critical: [], high: ["major"], medium: ["minor"], low: ["observation"], info: ["recommendation"] })[s],
};
/** Jednotný stav → stavy zdroje. */
function srcStatuses(source: FindingSource, st: string): string[] | null {
  if (st === "all") return null;
  const m: Record<string, Record<FindingSource, string[]>> = {
    active: { sectest: ["open"], host: ["open"], vulnerability: ["open"], audit: ["open", "in_progress"] },
    open: { sectest: ["open"], host: ["open"], vulnerability: ["open"], audit: ["open"] },
    in_progress: { sectest: [], host: [], vulnerability: [], audit: ["in_progress"] },
    accepted: { sectest: ["accepted"], host: ["accepted"], vulnerability: ["accepted"], audit: ["accepted"] },
    fixed: { sectest: ["fixed"], host: ["fixed"], vulnerability: ["resolved"], audit: ["closed"] },
    dismissed: { sectest: ["false_positive"], host: ["false_positive"], vulnerability: ["false_positive", "out_of_scope", "duplicate"], audit: [] },
  };
  return m[st]![source];
}

export function findingRoutes(db: Db, deps: { config: Config; fetchImpl?: FetchLike }) {
  const companiesFor = async (c: Context<AppEnv>) => {
    const mods = new Set((await getSettings(db)).enabledModules as string[]);
    const ids = scopeOf(c).ids;
    return Object.fromEntries(FINDING_SOURCES.map((s) => [s, mods.has(ACCESS[s].module) ? ids.filter((id) => hasPermIn(c, ACCESS[s].perm, id)) : []])) as Record<FindingSource, string[]>;
  };

  /** Jednotný seznam nálezů v rozsahu a oprávněních uživatele (stránka Nálezy, plán oprav). */
  const loadUnified = async (c: Context<AppEnv>, q: z.output<typeof FindingsQuery>): Promise<UnifiedFindingsDto> => {
    const scope = await companiesFor(c);
    // odpovědnost (v1.69): osoby a funkce, za které uživatel odpovídá (sám, nebo vedoucí útvarů)
    const resp = q.who ? await responsibility(db, currentUser(c).id, q.who) : null;
    const inIds = (col: SQL, ids: Set<string>) => (ids.size ? sql`${col} in (${sql.join([...ids].map((i) => sql`${i}::uuid`), sql`, `)})` : sql`false`);
    const assetOf = (assetCol: SQL) =>
      resp ? sql`exists (select 1 from assets ra where ra.id = ${assetCol} and (${inIds(sql`ra.technical_owner_user_id`, resp.users)} or ${inIds(sql`ra.technical_deputy_user_id`, resp.users)} or ${inIds(sql`ra.owner_user_id`, resp.users)}))` : undefined;
    const taskOf = (kind: string, idCol: SQL) =>
      resp ? sql`exists (select 1 from tasks rt where rt.source_kind = ${kind} and rt.source_id = ${idCol} and rt.status in ('open', 'in_progress') and (${inIds(sql`rt.assignee_user_id`, resp.users)} or ${inIds(sql`rt.owner_position_id`, resp.positions)}))` : undefined;
    const respSectest = resp ? or(assetOf(sql`${secTestFindings.assetId}`), taskOf("sectest_finding", sql`${secTestFindings.id}`)) : undefined;
    const respHost = resp ? or(assetOf(sql`${hostFindings.assetId}`), taskOf("host_finding", sql`${hostFindings.id}`)) : undefined;
    const respVuln = resp ? assetOf(sql`${assetVulnerabilities.assetId}`) : undefined;
    const respAudit = resp ? or(inIds(sql`${auditFindings.ownerPositionId}`, resp.positions), assetOf(sql`${auditFindings.assetId}`)) : undefined;
    const sources = FINDING_SOURCES.filter((s) => scope[s].length);
    const want = (s: FindingSource) => scope[s].length > 0 && (!q.source || q.source === s) && (!q.hostId || s === "host");
    const items: UnifiedFindingDto[] = [];
    const like = q.q ? `%${q.q.replace(/[%_\\]/g, "\\$&")}%` : null;
    const filt = (s: FindingSource, statusCol: SQL | unknown, sevCol: unknown): SQL[] => {
      const out: SQL[] = [];
      const st = srcStatuses(s, q.status);
      if (st) out.push(st.length ? inArray(statusCol as never, st) : sql`false`);
      if (q.severity) {
        const sv = SRC_SEV[s](q.severity);
        out.push(sv.length ? inArray(sevCol as never, sv) : sql`false`);
      }
      return out;
    };

    const jobs: Promise<void>[] = [];
    const today = new Date().toISOString().slice(0, 10);
    if (want("sectest"))
      jobs.push(
        (async () => {
          const rows = await db
            .select({ f: secTestFindings, assetName: assets.name, techName: tech.displayName, crit: assets.criticality, inet: assets.internetFacing })
            .from(secTestFindings)
            .leftJoin(assets, eq(assets.id, secTestFindings.assetId))
            .leftJoin(tech, eq(tech.id, sql`coalesce(${assets.technicalOwnerUserId}, ${assets.technicalDeputyUserId}, ${assets.ownerUserId})`))
            .where(
              and(
                inArray(secTestFindings.companyId, scope.sectest),
                q.assetId ? eq(secTestFindings.assetId, q.assetId) : undefined,
                respSectest,
                like ? or(ilike(secTestFindings.title, like), ilike(secTestFindings.host, like)) : undefined,
                ...filt("sectest", secTestFindings.status, secTestFindings.severity),
              ),
            )
            .orderBy(desc(secTestFindings.lastSeenAt))
            .limit(LIMIT);
          const tasks = await findingTasks(db, rows.map((r) => r.f.id));
          for (const { f, assetName, techName, crit, inet } of rows) {
            const t = tasks.get(f.id) ?? null;
            items.push({
              key: `sectest:${f.id}`,
              id: f.id,
              source: "sectest",
              companyId: f.companyId,
              title: f.title,
              detail: `${f.host}${f.port ? `:${f.port}` : ""}`,
              severity: unifiedSeverity("sectest", f.severity),
              status: unifiedStatus(f.status),
              assetId: f.assetId,
              assetName,
              ownerName: t?.assigneeName ?? techName,
              task: t ? { id: t.id, code: t.code, status: t.status, dueDate: t.dueDate, assigneeName: t.assigneeName ?? t.ownerName } : null,
              ...dueOf(t, f.status === "open" ? findingSlaDue(f.firstSeenAt, unifiedSeverity("sectest", f.severity)) : null),
              acceptedUntil: f.acceptedUntil,
              firstSeenAt: f.firstSeenAt.toISOString(),
              link: `/security-tests?finding=${f.id}`,
              priority: findingPriority({ severity: unifiedSeverity("sectest", f.severity), internetFacing: inet, criticality: crit, overdue: lateOf(f.status, t, findingSlaDue(f.firstSeenAt, unifiedSeverity("sectest", f.severity)), today) }),
            });
          }
        })(),
      );
    if (want("host"))
      jobs.push(
        (async () => {
          const rows = await db
            .select({ f: hostFindings, host: hostInventories.hostname, inv: hostInventories.id, assetName: assets.name, techName: tech.displayName, crit: assets.criticality, inet: assets.internetFacing })
            .from(hostFindings)
            .innerJoin(hostInventories, eq(hostInventories.id, hostFindings.inventoryId))
            .leftJoin(assets, eq(assets.id, hostFindings.assetId))
            .leftJoin(tech, eq(tech.id, sql`coalesce(${assets.technicalOwnerUserId}, ${assets.technicalDeputyUserId}, ${assets.ownerUserId})`))
            .where(
              and(
                inArray(hostFindings.companyId, scope.host),
                q.assetId ? eq(hostFindings.assetId, q.assetId) : undefined,
                q.hostId ? eq(hostFindings.inventoryId, q.hostId) : undefined,
                respHost,
                like ? or(ilike(hostInventories.hostname, like), ilike(hostFindings.subject, like), ilike(hostFindings.code, like)) : undefined,
                ...filt("host", hostFindings.status, hostFindings.severity),
              ),
            )
            .orderBy(desc(hostFindings.lastSeenAt))
            .limit(LIMIT);
          const tasks = await hostFindingTasks(db, rows.map((r) => r.f.id));
          for (const { f, host, inv, assetName, techName, crit, inet } of rows) {
            const t = tasks.get(f.id) ?? null;
            items.push({
              key: `host:${f.id}`,
              id: f.id,
              source: "host",
              companyId: f.companyId,
              title: hostFindingTitle(f.code, f.subject),
              detail: host,
              severity: unifiedSeverity("host", f.severity),
              status: unifiedStatus(f.status),
              assetId: f.assetId,
              assetName,
              ownerName: t?.assigneeName ?? techName,
              task: t ? { id: t.id, code: t.code, status: t.status, dueDate: t.dueDate, assigneeName: t.assigneeName ?? t.ownerName } : null,
              ...dueOf(t, f.status === "open" ? findingSlaDue(f.firstSeenAt, unifiedSeverity("host", f.severity)) : null),
              acceptedUntil: f.acceptedUntil,
              firstSeenAt: f.firstSeenAt.toISOString(),
              link: `/discovery/hosts/${inv}`,
              priority: findingPriority({ severity: unifiedSeverity("host", f.severity), internetFacing: inet, criticality: crit, overdue: lateOf(f.status, t, findingSlaDue(f.firstSeenAt, unifiedSeverity("host", f.severity)), today) }),
            });
          }
        })(),
      );
    if (want("vulnerability"))
      jobs.push(
        (async () => {
          const rows = await db
            .select({ v: assetVulnerabilities, companyId: assets.companyId, assetName: assets.name, techName: tech.displayName, crit: assets.criticality, inet: assets.internetFacing, due: vulnDueSql(await getVulnSla(db)) })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
            .leftJoin(tech, eq(tech.id, sql`coalesce(${assets.technicalOwnerUserId}, ${assets.technicalDeputyUserId}, ${assets.ownerUserId})`))
            .where(
              and(
                inArray(assets.companyId, scope.vulnerability),
                q.assetId ? eq(assetVulnerabilities.assetId, q.assetId) : undefined,
                respVuln,
                like ? or(ilike(assetVulnerabilities.cveId, like), ilike(assetVulnerabilities.packageName, like), ilike(assetVulnerabilities.title, like), ilike(assets.name, like)) : undefined,
                // bez filtru závažnosti jen střední a vyšší – nízkých bývají tisíce
                q.severity ? undefined : inArray(assetVulnerabilities.severity, ["critical", "high", "medium"]),
                ...filt("vulnerability", assetVulnerabilities.status, assetVulnerabilities.severity),
              ),
            )
            .orderBy(sql`case ${assetVulnerabilities.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`, desc(assetVulnerabilities.lastSeenAt))
            .limit(LIMIT);
          for (const { v, companyId, assetName, techName, crit, inet, due } of rows)
            items.push({
              key: `vulnerability:${v.id}`,
              id: v.id,
              source: "vulnerability",
              companyId,
              title: v.title ? `${v.cveId} – ${v.title}` : v.cveId,
              detail: [v.packageName, v.packageVersion].filter(Boolean).join(" ") || v.endpoint,
              severity: unifiedSeverity("vulnerability", v.severity),
              status: unifiedStatus(v.status),
              assetId: v.assetId,
              assetName,
              ownerName: techName,
              task: null,
              dueDate: v.status === "open" ? due : null,
              dueFromSla: v.status === "open" && !!due,
              acceptedUntil: v.acceptedUntil,
              firstSeenAt: v.firstSeenAt.toISOString(),
              link: `/assets/${v.assetId}`,
              priority: findingPriority({ severity: unifiedSeverity("vulnerability", v.severity), internetFacing: inet || v.exposed, criticality: crit, overdue: v.status === "open" && !!due && due < today }),
            });
        })(),
      );
    if (want("audit"))
      jobs.push(
        (async () => {
          const rows = await db
            .select({ f: auditFindings, companyId: audits.companyId, auditCode: audits.code, assetName: assets.name, owner: positions.name, crit: assets.criticality, inet: assets.internetFacing })
            .from(auditFindings)
            .innerJoin(audits, eq(audits.id, auditFindings.auditId))
            .leftJoin(assets, eq(assets.id, auditFindings.assetId))
            .leftJoin(positions, eq(positions.id, auditFindings.ownerPositionId))
            .where(
              and(
                inArray(audits.companyId, scope.audit),
                q.assetId ? eq(auditFindings.assetId, q.assetId) : undefined,
                respAudit,
                like ? or(ilike(auditFindings.title, like), ilike(auditFindings.code, like)) : undefined,
                ...filt("audit", auditFindings.status, auditFindings.severity),
              ),
            )
            .orderBy(desc(auditFindings.createdAt))
            .limit(LIMIT);
          for (const { f, companyId, auditCode, assetName, owner, crit, inet } of rows)
            items.push({
              key: `audit:${f.id}`,
              id: f.id,
              source: "audit",
              companyId,
              title: `${f.code ? `${f.code} ` : ""}${f.title}`,
              detail: auditCode ?? "",
              severity: unifiedSeverity("audit", f.severity),
              status: unifiedStatus(f.status),
              assetId: f.assetId,
              assetName,
              ownerName: owner,
              task: null,
              dueDate: f.dueDate,
              acceptedUntil: null,
              firstSeenAt: f.createdAt.toISOString(),
              link: `/audits/${f.auditId}`,
              priority: findingPriority({ severity: unifiedSeverity("audit", f.severity), internetFacing: inet, criticality: crit, overdue: !!f.dueDate && f.dueDate < today && (f.status === "open" || f.status === "in_progress") }),
            });
        })(),
      );

    // souhrn otevřených – bez filtru stavu a závažnosti
    const open = Object.fromEntries(FINDING_SOURCES.map((s) => [s, Object.fromEntries(UNIFIED_SEVERITIES.map((v) => [v, 0]))])) as UnifiedFindingsDto["open"];
    const cnt = async (s: FindingSource, rows: Promise<{ sev: string; n: number }[]>) => {
      for (const r of await rows) open[s][unifiedSeverity(s, r.sev)] += r.n;
    };
    const n = sql<number>`count(*)::int`;
    if (scope.sectest.length)
      jobs.push(cnt("sectest", db.select({ sev: secTestFindings.severity, n }).from(secTestFindings).where(and(inArray(secTestFindings.companyId, scope.sectest), eq(secTestFindings.status, "open"), q.assetId ? eq(secTestFindings.assetId, q.assetId) : undefined, respSectest)).groupBy(secTestFindings.severity)));
    if (scope.host.length)
      jobs.push(cnt("host", db.select({ sev: hostFindings.severity, n }).from(hostFindings).where(and(inArray(hostFindings.companyId, scope.host), eq(hostFindings.status, "open"), q.assetId ? eq(hostFindings.assetId, q.assetId) : undefined, q.hostId ? eq(hostFindings.inventoryId, q.hostId) : undefined, respHost)).groupBy(hostFindings.severity)));
    if (scope.vulnerability.length)
      jobs.push(
        cnt(
          "vulnerability",
          db
            .select({ sev: sql<string>`${assetVulnerabilities.severity}::text`, n })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .where(and(inArray(assets.companyId, scope.vulnerability), eq(assetVulnerabilities.status, "open"), q.assetId ? eq(assetVulnerabilities.assetId, q.assetId) : undefined, respVuln))
            .groupBy(assetVulnerabilities.severity),
        ),
      );
    if (scope.audit.length)
      jobs.push(
        cnt(
          "audit",
          db
            .select({ sev: sql<string>`${auditFindings.severity}::text`, n })
            .from(auditFindings)
            .innerJoin(audits, eq(audits.id, auditFindings.auditId))
            .where(and(inArray(audits.companyId, scope.audit), inArray(auditFindings.status, ["open", "in_progress"]), q.assetId ? eq(auditFindings.assetId, q.assetId) : undefined, respAudit))
            .groupBy(auditFindings.severity),
        ),
      );
    await Promise.all(jobs);

    const rank: Record<UnifiedSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    // pořadí: priorita opravy (závažnost, internet, kritičnost aktiva, po termínu), pak závažnost a novější
    items.sort((a, b) => b.priority - a.priority || rank[a.severity] - rank[b.severity] || (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? ""));
    const max = Math.min(q.limit ?? LIMIT, LIMIT);
    const truncated = items.length > max;
    return { items: items.slice(0, max), open, sources, truncated, total: Math.min(items.length, LIMIT) };
  };

  return new Hono<AppEnv>()
    .get("/", requirePerm("sectests:read", "assets:read", "audits:read"), zValidator("query", FindingsQuery), async (c) => c.json(await loadUnified(c, c.req.valid("query"))))
    /** Plán oprav (v1.70, ADR-163): poslední plán aktivní společnosti; položky jen ze zdrojů, které uživatel smí číst. */
    .get("/plan", requirePerm("sectests:read", "assets:read", "audits:read"), async (c) => {
      const companyId = soleCompany(c);
      const plan = await lastFindingPlan(db, companyId);
      if (!plan) return c.json(null);
      const scope = await companiesFor(c);
      const ok = (k: string) => scope[k.split(":")[0] as FindingSource]?.includes(companyId);
      return c.json(await planView(db, { ...plan, steps: plan.steps.map((st) => ({ ...st, items: st.items.filter((i) => ok(i.key)) })).filter((st) => st.items.length) }));
    })
    /** Úkoly z kroků plánu (v1.71, ADR-164): jeden úkol za krok, garant aktiva, termín podle náročnosti. */
    .post("/plan/tasks", requirePerm("actions:write"), zValidator("json", FindingPlanTasksInput), async (c) => {
      const companyId = soleCompany(c);
      if (!hasPermIn(c, "actions:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      const plan = await lastFindingPlan(db, companyId);
      if (!plan) throw new HTTPException(404, { message: "Plán oprav zatím není" });
      // kroky s nálezy, které uživatel nesmí číst, se nezakládají
      const scope = await companiesFor(c);
      const ok = (k: string) => scope[k.split(":")[0] as FindingSource]?.includes(companyId);
      const idx = c.req.valid("json").steps.filter((i) => plan.steps[i] && plan.steps[i]!.items.every((x) => ok(x.key)));
      const r = await createPlanTasks(db, plan, idx, currentUser(c).id, await tFor(db, c));
      await audit(db, { c, user: currentUser(c), action: "findings.plan_tasks", entityType: "company", entityId: companyId, details: { created: r.created, skipped: r.skipped, taskIds: r.taskIds } });
      return c.json({ ...r, skipped: r.skipped + (c.req.valid("json").steps.length - idx.length) });
    })
    .post("/plan", requirePerm("sectests:read", "assets:read", "audits:read"), requirePerm("ai:use"), async (c) => {
      const companyId = soleCompany(c);
      if (!hasPermIn(c, "ai:use", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      const d = await loadUnified(c, { status: "active" });
      try {
        const plan = await buildFindingPlan(db, deps.config, companyId, d.items, await tFor(db, c), deps.fetchImpl);
        await audit(db, { c, user: currentUser(c), action: "findings.plan_generated", entityType: "company", entityId: companyId, details: { model: plan.model, considered: plan.considered, steps: plan.steps.length } });
        return c.json(await planView(db, plan));
      } catch (e) {
        if (e instanceof AiUnavailable) throw new HTTPException(400, { message: "AI asistent není zapnutý." });
        throw new HTTPException(502, { message: `AI: ${(e as Error).message}`.slice(0, 300) });
      }
    })
    /** Eskalace na mě (v1.71, ADR-164): aktiva podřízených garantů s nálezy po termínu déle než týden. */
    .get("/escalations", requirePerm("sectests:read", "assets:read", "audits:read"), async (c) => {
      const scope = await companiesFor(c);
      const active = scopeOf(c).active;
      const ids = [...new Set([...scope.sectest, ...scope.host, ...scope.vulnerability])].filter((id) => !active || id === active);
      return c.json(escalationsFor(await findingEscalations(db, ids), currentUser(c).id));
    })
    /** Náprava nálezů (v1.69): otevřené, po termínu, opravené v období, doba opravy, podíl v termínu. */
    .get("/remediation", requirePerm("sectests:read", "assets:read", "audits:read"), zValidator("query", RemediationQuery), async (c) => {
      const q = c.req.valid("query");
      const to = q.to ?? new Date().toISOString().slice(0, 10);
      const from = q.from ?? new Date(new Date(`${to}T00:00:00Z`).getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
      if (from > to) throw new HTTPException(400, { message: "Začátek období je po jeho konci" });
      const active = scopeOf(c).active;
      const scope = await companiesFor(c);
      // aktivní společnost, jinak celý rozsah uživatele
      const narrowed = active ? (Object.fromEntries(FINDING_SOURCES.map((s) => [s, scope[s].filter((id) => id === active)])) as typeof scope) : scope;
      return c.json(await findingsRemediation(db, narrowed, from, to, q.assetId));
    });
}

/** Osoby a funkce, za které uživatel odpovídá: sám (moje), nebo podřízené útvary jeho vedoucích funkcí (tým). */
export async function responsibility(db: Db, userId: string, who: "mine" | "team") {
  const snap = await orgSnapshot(db);
  const mine = new Set(snap.positionsOfUser.get(userId) ?? []);
  if (who === "mine") return { users: new Set([userId]), positions: mine };
  // útvary, které uživatel vede, a všechny jejich podřízené útvary
  const led = new Set([...mine].filter((p) => snap.positions.get(p)?.isManager).map((p) => snap.positions.get(p)!.orgUnitId));
  const under = (unitId: string) => {
    for (let u: string | null | undefined = unitId, i = 0; u && i < 50; u = snap.units.get(u)?.parentId, i++) if (led.has(u)) return true;
    return false;
  };
  const positions = new Set([...snap.positions].filter(([, p]) => under(p.orgUnitId)).map(([id]) => id));
  const users = new Set<string>();
  for (const [uid, ps] of snap.positionsOfUser) if (ps.some((p) => positions.has(p))) users.add(uid);
  users.add(userId);
  for (const p of mine) positions.add(p);
  return { users, positions };
}
