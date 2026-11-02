import {
  SOC_SUPPRESSIBLE_SOURCES,
  computeSocMetrics,
  SEVERITY_LEVEL,
  SOC_CASE_OPEN,
  SOC_OPEN_STATUSES,
  SOC_SUPPRESSION_MAX_DAYS,
  SOC_SEVERITIES,
  SocAdvisorInput,
  SocAlertCreate,
  SocAlertPatch,
  SocCloseInput,
  SocEscalateInput,
  SocNoteInput,
  playbookView,
  SocPlaybookTasksInput,
  socSeverity,
  effectiveLevel,
  tacticsFor,
  type SocAlertDetailDto,
  type SocAlertDto,
  type SocAnalyst,
  type SocSeverity,
  type SocSettings,
  type SocSummaryDto,
  type SocRiskSignals,
  type SocAiTriage, type TiMatch,
  type SocVerdict,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, lte, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, assetVulnerabilities, incidents, roles, socCases, socSuppressions, userRoles, users, riskAssets, risks } from "../../db/schema";
import { getAiSettings } from "../ai/service";
import { escalateAlert, getAlertSettings, syncAlerts } from "../alerts/routes";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { tFor } from "../i18n/service";
import { adviseAlert, askAdvisor } from "./advisor";
import { effLevelSql, refreshExposure } from "./exposure";
import { linkedRisks, metricRows } from "./grc";
import { triageAlert } from "./triage";
import { alertSla, caseCode, correlateAlerts, getSocSettings, socSlaItems } from "./service";
import { createPlaybookTasks, customPlaybooks, playbookTasks, resolvePlaybook } from "./playbooks";

/* SOC – fronta alertů, triáž, ATT&CK, playbooky, AI poradci (ADR-046). */

type Ctx = Context<AppEnv>;
type Row = typeof alertSuggestions.$inferSelect;
const assignee = alias(users, "soc_assignee");
const OPEN = [...SOC_OPEN_STATUSES];
const DAY = 864e5;
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

const ListQuery = z.object({
  status: z.enum(["open", "new", "in_progress", "accepted", "dismissed", "all"]).default("open"),
  severity: z.enum(SOC_SEVERITIES).optional(),
  mine: z.literal("1").optional(),
  unassigned: z.literal("1").optional(),
  tactic: z.string().regex(/^TA\d{4}$/).optional(),
  q: z.string().trim().max(200).optional(),
  intel: z.literal("1").optional(),
  /** Návrh AI předběžné triáže: tp = eskalovat, fp = falešný / neškodný, none = zatím bez návrhu. */
  ai: z.enum(["tp", "fp", "none"]).optional(),
  /** Zdroj alertu (wazuh, manual, phishing…) a období posledního výskytu (ADR-075). */
  source: z.string().trim().regex(/^[a-z0-9_-]{1,30}$/).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

const caseRef = alias(socCases, "soc_case_ref");
type BaseRow = { s: Row; assetName: string | null; assigneeName: string | null; incidentTitle: string | null; caseSeq: number | null };

/** Výběr alertů s názvem aktiva, analytika, incidentu a případu. */
export const alertBase = (db: Db) =>
  db
    .select({ s: alertSuggestions, assetName: assets.name, assigneeName: assignee.displayName, incidentTitle: incidents.title, caseSeq: caseRef.seq })
    .from(alertSuggestions)
    .leftJoin(assets, eq(assets.id, alertSuggestions.assetId))
    .leftJoin(assignee, eq(assignee.id, alertSuggestions.assigneeId))
    .leftJoin(incidents, eq(incidents.id, alertSuggestions.incidentId))
    .leftJoin(caseRef, eq(caseRef.id, alertSuggestions.caseId));

export function alertDtos(rows: BaseRow[], settings: SocSettings, now = new Date()): SocAlertDto[] {
  return rows.map(({ s, assetName, assigneeName, incidentTitle, caseSeq }) => ({
      id: s.id,
      companyId: s.companyId,
      ruleId: s.ruleId,
      ruleLevel: s.ruleLevel,
      description: s.description,
      groups: s.groups,
      agentId: s.agentId,
      agentName: s.agentName,
      assetId: s.assetId,
      assetName,
      firstSeen: s.firstSeen.toISOString(),
      lastSeen: s.lastSeen.toISOString(),
      count: s.count,
      status: s.status,
      incidentId: s.incidentId,
      dismissReason: s.dismissReason,
      sample: s.sample ?? null,
      title: s.title ?? s.description,
      severity: socSeverity(effectiveLevel(s.ruleLevel, s.exposure)),
      exposure: s.exposure ?? null,
      aiTriage: (s.aiTriage as SocAiTriage | null) ?? null,
      intel: (s.intel as unknown as TiMatch[] | null) ?? null,
      source: s.source,
      assigneeId: s.assigneeId,
      assigneeName,
      verdict: (s.verdict as SocVerdict | null) ?? null,
      mitreIds: s.mitreIds,
      mitreTactics: s.mitreTactics,
      playbookKey: s.playbookKey,
      acknowledgedAt: s.acknowledgedAt?.toISOString() ?? null,
      decidedAt: s.decidedAt?.toISOString() ?? null,
      incidentTitle,
      caseId: s.caseId,
      caseCode: caseSeq != null ? caseCode(caseSeq) : null,
      sla: alertSla(s, settings, now),
  }));
}

/** Platnost potlačení: dnes až SOC_SUPPRESSION_MAX_DAYS dní. */
export function validUntil(until: string) {
  const today = new Date().toISOString().slice(0, 10);
  const max = new Date(Date.now() + SOC_SUPPRESSION_MAX_DAYS * 864e5).toISOString().slice(0, 10);
  if (until < today || until > max) throw new HTTPException(400, { message: "Platnost potlačení musí být od dneška nejvýše na rok." });
}

export function socRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike }) {
  const { db, config } = deps;

  async function load(c: Ctx, id: string): Promise<Row> {
    const [s] = await db.select().from(alertSuggestions).where(eq(alertSuggestions.id, id));
    assertScope(c, s?.companyId, "Alert nenalezen");
    if (!hasPermIn(c, "soc:read", s!.companyId)) throw new HTTPException(404, { message: "Alert nenalezen" });
    return s!;
  }
  /** Zápis: soc:write ve společnosti alertu a alert je otevřený (pokud `open`). */
  async function writable(c: Ctx, id: string, open = true) {
    const s = await load(c, id);
    if (!hasPermIn(c, "soc:write", s.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    if (open && !(OPEN as string[]).includes(s.status)) throw new HTTPException(409, { message: "Alert je už uzavřený nebo eskalovaný." });
    return s;
  }

  async function detail(c: Ctx, s: Row): Promise<SocAlertDetailDto> {
    const [[row], hist, vulns] = await Promise.all([
      alertBase(db).where(eq(alertSuggestions.id, s.id)),
      db
        .select({ status: alertSuggestions.status, verdict: alertSuggestions.verdict, n: sql<number>`count(*)::int` })
        .from(alertSuggestions)
        .where(and(eq(alertSuggestions.groupKey, s.groupKey), sql`${alertSuggestions.id} <> ${s.id}`))
        .groupBy(alertSuggestions.status, alertSuggestions.verdict),
      s.assetId && hasPermIn(c, "assets:read", s.companyId)
        ? db
            .select({ cveId: assetVulnerabilities.cveId, severity: assetVulnerabilities.severity, cvss: assetVulnerabilities.cvssScore })
            .from(assetVulnerabilities)
            .where(and(eq(assetVulnerabilities.assetId, s.assetId), eq(assetVulnerabilities.status, "open")))
            .orderBy(sql`${assetVulnerabilities.cvssScore} desc nulls last`)
            .limit(8)
        : Promise.resolve([]),
    ]);
    const [dto] = alertDtos([row!], await getSocSettings(db));
    const pb = await resolvePlaybook(db, s);
    const noteUsers = [...new Set(s.notes.map((n) => n.userId).filter((x): x is string => !!x))];
    const names = noteUsers.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, noteUsers))).map((u) => [u.id, u.n])) : new Map<string, string>();
    const byVerdict: Partial<Record<SocVerdict, number>> = {};
    for (const h of hist) if (h.verdict) byVerdict[h.verdict as SocVerdict] = (byVerdict[h.verdict as SocVerdict] ?? 0) + h.n;
    return {
      ...dto!,
      playbookKey: pb.key,
      playbook: pb,
      playbookDone: s.playbookDone,
      playbookTasks: await playbookTasks(db, s.id),
      notes: s.notes.map((n) => ({ ...n, userName: n.userId ? (names.get(n.userId) ?? null) : null })),
      aiAdvice: s.aiAdvice ?? null,
      history: { total: hist.reduce((a, h) => a + h.n, 0), byVerdict, escalated: hist.filter((h) => h.status === "accepted").reduce((a, h) => a + h.n, 0) },
      assetVulns: vulns.map((v) => ({ cveId: v.cveId, severity: v.severity, cvss: v.cvss })),
      risks: await linkedRisks(db, c, s.companyId, s.assetId ? [s.assetId] : []),
      canWrite: hasPermIn(c, "soc:write", s.companyId),
      canEscalate: hasPermIn(c, "soc:write", s.companyId) && hasPermIn(c, "incidents:write", s.companyId),
    };
  }

  /** Společnosti v rozsahu, kde má uživatel soc:read. */
  const socIds = (c: Ctx) => scopeOf(c).ids.filter((id) => hasPermIn(c, "soc:read", id));
  const inSoc = (c: Ctx): SQL => {
    const ids = socIds(c);
    return ids.length ? inArray(alertSuggestions.companyId, ids) : sql`false`;
  };

  async function summary(c: Ctx): Promise<SocSummaryDto> {
    const me = currentUser(c).id;
    const since = new Date(Date.now() - 30 * DAY);
    const [open, recent, st] = await Promise.all([
      db.select({ status: alertSuggestions.status, level: effLevelSql, assigneeId: alertSuggestions.assigneeId }).from(alertSuggestions).where(and(inSoc(c), inArray(alertSuggestions.status, OPEN))),
      db
        .select({ status: alertSuggestions.status, verdict: alertSuggestions.verdict, tactics: alertSuggestions.mitreTactics, createdAt: alertSuggestions.createdAt, ack: alertSuggestions.acknowledgedAt, decidedAt: alertSuggestions.decidedAt })
        .from(alertSuggestions)
        .where(and(inSoc(c), gte(alertSuggestions.lastSeen, since))),
      getAlertSettings(db),
    ]);
    const [late, [oc]] = await Promise.all([
      socSlaItems(db, socIds(c), 1),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(socCases)
        .where(and(socIds(c).length ? inArray(socCases.companyId, socIds(c)) : sql`false`, inArray(socCases.status, [...SOC_CASE_OPEN]))),
    ]);
    const bySeverity = Object.fromEntries(SOC_SEVERITIES.map((s) => [s, 0])) as Record<SocSeverity, number>;
    for (const o of open) bySeverity[socSeverity(o.level)]++;
    const tactics30: Record<string, number> = {};
    const closed30: Partial<Record<SocVerdict, number>> = {};
    const tta: number[] = [];
    let escalated30 = 0;
    for (const r of recent) {
      for (const t of r.tactics) tactics30[t] = (tactics30[t] ?? 0) + 1;
      if (r.decidedAt && r.decidedAt >= since) {
        if (r.status === "accepted") escalated30++;
        if (r.status === "dismissed" && r.verdict) closed30[r.verdict as SocVerdict] = (closed30[r.verdict as SocVerdict] ?? 0) + 1;
      }
      if (r.ack) tta.push((r.ack.getTime() - r.createdAt.getTime()) / 3600_000);
    }
    tta.sort((a, b) => a - b);
    const mid = tta.length ? (tta.length % 2 ? tta[(tta.length - 1) / 2]! : (tta[tta.length / 2 - 1]! + tta[tta.length / 2]!) / 2) : null;
    return {
      open: open.length,
      new: open.filter((o) => o.status === "new").length,
      inProgress: open.filter((o) => o.status === "in_progress").length,
      unassigned: open.filter((o) => !o.assigneeId).length,
      mine: open.filter((o) => o.assigneeId === me).length,
      bySeverity,
      escalated30,
      closed30,
      mttaHours: mid == null ? null : Math.round(Math.max(0, mid) * 10) / 10,
      tactics30,
      lastSyncAt: st.lastSyncAt,
      syncEnabled: st.alertsEnabled,
      slaBreached: late.filter((i) => i.urgency === "overdue").length,
      openCases: oc?.n ?? 0,
    };
  }

  const aiReady = async () => {
    const s = await getAiSettings(db);
    if (!s.enabled) throw new HTTPException(409, { message: "AI asistent je vypnutý (Administrace → AI asistent)." });
  };

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "soc"))
      .get("/summary", requirePerm("soc:read"), async (c) => c.json(await summary(c)))
      .get("/alerts", requirePerm("soc:read"), zValidator("query", ListQuery), async (c) => {
        const q = c.req.valid("query");
        const w: (SQL | undefined)[] = [inSoc(c)];
        if (q.status === "open") w.push(inArray(alertSuggestions.status, OPEN));
        else if (q.status !== "all") w.push(eq(alertSuggestions.status, q.status));
        if (q.severity) w.push(gte(effLevelSql, SEVERITY_LEVEL[q.severity]));
        if (q.mine) w.push(eq(alertSuggestions.assigneeId, currentUser(c).id));
        if (q.unassigned) w.push(isNull(alertSuggestions.assigneeId));
        if (q.tactic) w.push(sql`${q.tactic} = any(${alertSuggestions.mitreTactics})`);
        if (q.ai === "tp") w.push(sql`${alertSuggestions.aiTriage}->>'verdict' = 'true_positive'`);
        if (q.ai === "fp") w.push(sql`${alertSuggestions.aiTriage}->>'verdict' in ('false_positive', 'benign')`);
        if (q.intel) w.push(sql`${alertSuggestions.intel} is not null`);
        if (q.source) w.push(eq(alertSuggestions.source, q.source));
        if (q.from) w.push(gte(alertSuggestions.lastSeen, new Date(`${q.from}T00:00:00Z`)));
        if (q.to) w.push(lte(alertSuggestions.lastSeen, new Date(`${q.to}T23:59:59Z`)));
        if (q.ai === "none") w.push(sql`(${alertSuggestions.aiTriage} is null or ${alertSuggestions.aiTriage}->>'verdict' is null)`);
        if (q.q) w.push(or(ilike(alertSuggestions.description, likeOf(q.q)), ilike(alertSuggestions.title, likeOf(q.q)), ilike(alertSuggestions.agentName, likeOf(q.q)), ilike(alertSuggestions.ruleId, likeOf(q.q))));
        const rows = await alertBase(db)
          .where(and(...w))
          .orderBy(sql`case when ${alertSuggestions.status} in ('new','in_progress') then 0 else 1 end`, desc(effLevelSql), desc(alertSuggestions.lastSeen))
          .limit(500);
        return c.json(alertDtos(rows, await getSocSettings(db)));
      })
      /** Úspěšnost SOC a AI za období (ADR-053) – počítá se při čtení. */
      .get("/metrics", requirePerm("soc:read"), zValidator("query", z.object({ days: z.coerce.number().int().min(7).max(365).default(90) })), async (c) => {
        const { days } = c.req.valid("query");
        return c.json(computeSocMetrics(await metricRows(db, and(inSoc(c), gte(alertSuggestions.createdAt, new Date(Date.now() - days * 864e5)))!), await getSocSettings(db), days));
      })
      .get("/alerts/:id", requirePerm("soc:read"), async (c) => c.json(await detail(c, await load(c, c.req.param("id")))))
      /** Signály SOC k riziku: alerty na aktivech rizika za období (ADR-048). */
      .get("/risk-signals/:riskId", requirePerm("soc:read"), zValidator("query", z.object({ days: z.coerce.number().int().min(7).max(365).default(90) })), async (c) => {
        const [r] = await db.select({ id: risks.id, companyId: risks.companyId }).from(risks).where(eq(risks.id, c.req.param("riskId")));
        assertScope(c, r?.companyId, "Riziko nenalezeno");
        if (!hasPermIn(c, "risks:read", r!.companyId) || !hasPermIn(c, "soc:read", r!.companyId)) throw new HTTPException(404, { message: "Riziko nenalezeno" });
        const { days } = c.req.valid("query");
        const assetIds = (await db.select({ a: riskAssets.assetId }).from(riskAssets).where(eq(riskAssets.riskId, r!.id))).map((x) => x.a);
        const empty: SocRiskSignals = { days, alerts: 0, open: 0, truePositive: 0, escalated: 0, falsePositive: 0, exploitAttempts: 0, tactics: {}, lastSeen: null, reassess: false, recent: [] };
        if (!assetIds.length) return c.json(empty);
        const rows = await alertBase(db)
          .where(and(eq(alertSuggestions.companyId, r!.companyId), inArray(alertSuggestions.assetId, assetIds), gte(alertSuggestions.lastSeen, new Date(Date.now() - days * DAY))))
          .orderBy(desc(alertSuggestions.lastSeen))
          .limit(500);
        const dtos = alertDtos(rows, await getSocSettings(db));
        const out: SocRiskSignals = { ...empty };
        out.alerts = dtos.length;
        for (const a of dtos) {
          if ((OPEN as string[]).includes(a.status)) out.open++;
          if (a.status === "accepted") out.escalated++;
          if (a.verdict === "true_positive" && a.status !== "accepted") out.truePositive++;
          if (a.verdict === "false_positive" || a.verdict === "benign") out.falsePositive++;
          if (a.exposure?.exploit) out.exploitAttempts++;
          for (const t of a.mitreTactics) out.tactics[t] = (out.tactics[t] ?? 0) + 1;
        }
        out.lastSeen = dtos[0]?.lastSeen ?? null;
        out.reassess = out.escalated + out.truePositive + out.exploitAttempts > 0;
        out.recent = dtos.slice(0, 10);
        return c.json(out);
      })
      .get("/analysts", requirePerm("soc:read"), async (c) => {
        const rows = await db
          .selectDistinct({ id: users.id, displayName: users.displayName })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(and(eq(users.isActive, true), sql`'soc:write' = any(${roles.permissions})`))
          .orderBy(asc(users.displayName));
        const me = currentUser(c);
        const meWrites = scopeOf(c).ids.some((id) => hasPermIn(c, "soc:write", id));
        const list: SocAnalyst[] = rows.some((r) => r.id === me.id) || !meWrites ? rows : [{ id: me.id, displayName: me.displayName }, ...rows];
        return c.json(list);
      })
      .post("/alerts", requirePerm("soc:write"), zValidator("json", SocAlertCreate), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, input.companyId, "soc:write");
        if (input.assetId) {
          const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, input.assetId));
          if (!a || a.companyId !== companyId) throw new HTTPException(400, { message: "Aktivum nepatří do zvolené společnosti." });
        }
        const at = input.detectedAt ? new Date(input.detectedAt) : new Date();
        const user = currentUser(c);
        const mitreIds = input.mitreIds ?? [];
        const [row] = await db
          .insert(alertSuggestions)
          .values({
            companyId,
            source: "manual",
            groupKey: `manual:${randomUUID()}`,
            ruleId: "manual",
            ruleLevel: SEVERITY_LEVEL[input.severity ?? "medium"],
            title: input.title,
            description: input.description || input.title,
            assetId: input.assetId ?? null,
            firstSeen: at,
            lastSeen: at,
            count: 1,
            mitreIds,
            mitreTactics: tacticsFor(mitreIds),
            createdById: user.id,
          })
          .returning();
        await audit(db, { c, user, action: "soc.alert_created", entityType: "soc_alert", entityId: row!.id, details: { title: input.title, severity: input.severity } });
        await refreshExposure(db, [row!.id]);
        await correlateAlerts(db);
        return c.json(await detail(c, await load(c, row!.id)), 201);
      })
      .patch("/alerts/:id", requirePerm("soc:write"), zValidator("json", SocAlertPatch), async (c) => {
        const s = await writable(c, c.req.param("id"));
        const input = c.req.valid("json");
        const set: Partial<typeof alertSuggestions.$inferInsert> = { updatedAt: new Date() };
        if (input.assigneeId !== undefined) {
          if (input.assigneeId) {
            const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigneeId), eq(users.isActive, true)));
            if (!u) throw new HTTPException(400, { message: "Analytik nenalezen" });
            set.status = "in_progress";
            if (!s.acknowledgedAt) set.acknowledgedAt = new Date();
          }
          set.assigneeId = input.assigneeId;
        }
        if (input.status) {
          set.status = input.status;
          if (input.status === "in_progress" && !s.acknowledgedAt) set.acknowledgedAt = new Date();
        }
        if (input.mitreIds) {
          set.mitreIds = [...new Set(input.mitreIds)];
          set.mitreTactics = tacticsFor(set.mitreIds);
        }
        if (input.playbookKey !== undefined) {
          if (input.playbookKey && !playbookView(input.playbookKey, await customPlaybooks(db, s.companyId))) throw new HTTPException(400, { message: "Neznámý playbook" });
          set.playbookKey = input.playbookKey;
          if (input.playbookKey !== s.playbookKey) set.playbookDone = [];
        }
        if (input.playbookDone) {
          const pb = await resolvePlaybook(db, { companyId: s.companyId, playbookKey: set.playbookKey ?? s.playbookKey, mitreIds: set.mitreIds ?? s.mitreIds, mitreTactics: set.mitreTactics ?? s.mitreTactics });
          set.playbookKey ??= s.playbookKey ?? pb.key;
          set.playbookDone = [...new Set(input.playbookDone)].filter((i) => i < pb.steps.length).sort((a, b) => a - b);
        }
        const [row] = await db.update(alertSuggestions).set(set).where(eq(alertSuggestions.id, s.id)).returning();
        await audit(db, { c, user: currentUser(c), action: "soc.alert_updated", entityType: "soc_alert", entityId: s.id, details: input });
        return c.json(await detail(c, row!));
      })
      /** Úkoly týmu z kroků playbooku (ADR-060). */
      .post("/alerts/:id/playbook-tasks", requirePerm("soc:write"), zValidator("json", SocPlaybookTasksInput), async (c) => {
        const s = await writable(c, c.req.param("id"));
        const r = await createPlaybookTasks(db, c, s, c.req.valid("json"));
        const [row] = await db.select().from(alertSuggestions).where(eq(alertSuggestions.id, s.id));
        return c.json({ ...r, alert: await detail(c, row!) });
      })
      .post("/alerts/:id/notes", requirePerm("soc:write"), zValidator("json", SocNoteInput), async (c) => {
        const s = await writable(c, c.req.param("id"), false);
        const user = currentUser(c);
        const notes = [...s.notes, { at: new Date().toISOString(), userId: user.id, text: c.req.valid("json").text }].slice(-200);
        const [row] = await db.update(alertSuggestions).set({ notes, updatedAt: new Date() }).where(eq(alertSuggestions.id, s.id)).returning();
        await audit(db, { c, user, action: "soc.note_added", entityType: "soc_alert", entityId: s.id });
        return c.json(await detail(c, row!), 201);
      })
      .post("/alerts/:id/close", requirePerm("soc:write"), zValidator("json", SocCloseInput), async (c) => {
        const s = await writable(c, c.req.param("id"));
        const user = currentUser(c);
        const { verdict, reason, suppressUntil, suppressIp } = c.req.valid("json");
        if (suppressUntil) {
          if (!SOC_SUPPRESSIBLE_SOURCES.includes(s.source)) throw new HTTPException(400, { message: "Potlačit lze jen alerty z Wazuhu a napojených nástrojů." });
          validUntil(suppressUntil);
        }
        const [row] = await db
          .update(alertSuggestions)
          .set({ status: "dismissed", verdict, dismissReason: reason, decidedById: user.id, decidedAt: new Date(), acknowledgedAt: s.acknowledgedAt ?? new Date(), assigneeId: s.assigneeId ?? user.id, updatedAt: new Date() })
          .where(eq(alertSuggestions.id, s.id))
          .returning();
        await audit(db, { c, user, action: "soc.alert_closed", entityType: "soc_alert", entityId: s.id, details: { verdict, reason } });
        if (suppressUntil) {
          const ip = (s.sample as Record<string, unknown> | null)?.srcip;
          const [sup] = await db
            .insert(socSuppressions)
            .values({ companyId: s.companyId, ruleId: s.ruleId, agentId: s.agentId, srcip: suppressIp && typeof ip === "string" ? ip : null, reason, until: suppressUntil, sourceAlertId: s.id, createdById: user.id })
            .returning();
          await audit(db, { c, user, action: "soc.suppression_created", entityType: "soc_suppression", entityId: sup!.id, details: { ruleId: s.ruleId, agentId: s.agentId, until: suppressUntil } });
        }
        return c.json(await detail(c, row!));
      })
      .post("/alerts/:id/reopen", requirePerm("soc:write"), async (c) => {
        const s = await writable(c, c.req.param("id"), false);
        if (s.status !== "dismissed") throw new HTTPException(409, { message: "Znovu otevřít lze jen uzavřený alert." });
        const [row] = await db
          .update(alertSuggestions)
          .set({ status: "in_progress", verdict: null, dismissReason: null, decidedById: null, decidedAt: null, updatedAt: new Date() })
          .where(eq(alertSuggestions.id, s.id))
          .returning();
        await audit(db, { c, user: currentUser(c), action: "soc.alert_reopened", entityType: "soc_alert", entityId: s.id });
        return c.json(await detail(c, row!));
      })
      .post("/alerts/:id/escalate", requirePerm("soc:write"), zValidator("json", SocEscalateInput), async (c) => {
        const s = await writable(c, c.req.param("id"));
        if (!hasPermIn(c, "incidents:write", s.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const input = c.req.valid("json");
        if (input.incidentId) {
          const [inc] = await db.select({ companyId: incidents.companyId }).from(incidents).where(eq(incidents.id, input.incidentId));
          if (!inc || inc.companyId !== s.companyId) throw new HTTPException(404, { message: "Incident nenalezen" });
        }
        const user = currentUser(c);
        const incidentId = await escalateAlert(db, { ...s, assigneeId: s.assigneeId ?? user.id }, user, input);
        if (!s.assigneeId) await db.update(alertSuggestions).set({ assigneeId: user.id }).where(eq(alertSuggestions.id, s.id));
        await audit(db, { c, user, action: "soc.alert_escalated", entityType: "incident", entityId: incidentId, details: { alertId: s.id, linked: !!input.incidentId } });
        return c.json({ incidentId, alert: await detail(c, await load(c, s.id)) }, 201);
      })
      /** AI předběžná triáž na pokyn (znovu) – jen návrh (ADR-051). */
      .post("/alerts/:id/triage", requirePerm("soc:write"), requirePerm("ai:use"), async (c) => {
        await aiReady();
        const s = await writable(c, c.req.param("id"), false);
        const tr = await triageAlert(db, config, s, await tFor(db, c), deps.fetchImpl);
        const [row] = await db.update(alertSuggestions).set({ aiTriage: tr as unknown as Record<string, unknown> }).where(eq(alertSuggestions.id, s.id)).returning();
        await audit(db, { c, user: currentUser(c), action: "soc.ai_triage", entityType: "soc_alert", entityId: s.id, details: { verdict: tr.verdict, confidence: tr.confidence, model: tr.model, error: tr.error } });
        return c.json(await detail(c, row!));
      })
      .post("/alerts/:id/advise", requirePerm("soc:write"), requirePerm("ai:use"), async (c) => {
        await aiReady();
        const s = await writable(c, c.req.param("id"), false);
        let advice;
        try {
          advice = await adviseAlert(db, config, s, await tFor(db, c), deps.fetchImpl);
        } catch (e) {
          throw new HTTPException(503, { message: (e as Error).message });
        }
        const [row] = await db.update(alertSuggestions).set({ aiAdvice: advice, updatedAt: new Date() }).where(eq(alertSuggestions.id, s.id)).returning();
        await audit(db, { c, user: currentUser(c), action: "soc.ai_advice", entityType: "soc_alert", entityId: s.id, details: { model: advice.model, ms: advice.durationMs } });
        return c.json(await detail(c, row!));
      })
      .post("/advisor", requirePerm("soc:read"), requirePerm("ai:use"), zValidator("json", SocAdvisorInput), async (c) => {
        await aiReady();
        const { question, alertId } = c.req.valid("json");
        const alert = alertId ? await load(c, alertId) : null;
        const mods = new Set((await getSettings(db)).enabledModules as string[]);
        const vulnCompanyIds = mods.has("vulnerabilities") ? scopeOf(c).ids.filter((id) => hasPermIn(c, "assets:read", id)) : [];
        try {
          const r = await askAdvisor(db, config, { question, alert, vulnCompanyIds, tactics30: (await summary(c)).tactics30 }, await tFor(db, c), deps.fetchImpl);
          await audit(db, { c, user: currentUser(c), action: "soc.advisor_asked", details: { question: question.slice(0, 300), alertId: alertId ?? null, model: r.model, ms: r.durationMs } });
          return c.json(r);
        } catch (e) {
          throw new HTTPException(503, { message: (e as Error).message });
        }
      })
      .post("/sync", requirePerm("soc:write"), async (c) => {
        try {
          const r = await syncAlerts(db, config, deps.fetchImpl);
          await audit(db, { c, user: currentUser(c), action: "alerts.synced", details: r });
          return c.json(r);
        } catch (e) {
          throw new HTTPException(502, { message: (e as Error).message });
        }
      })
  );
}

