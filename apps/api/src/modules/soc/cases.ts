import {
  SOC_CASE_OPEN,
  SOC_OPEN_STATUSES,
  SocCaseAlertsInput,
  SocCaseCloseInput,
  SocCaseCreate,
  SocCasePatch,
  SocEscalateInput,
  SocNoteInput,
  SocSettingsInput,
  SocSuppressionInput,
  ruleAdvice,
  type SocCaseDetailDto,
  type SocRuleStat,
  type SocSuppressionDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { alertSuggestions, incidents, socCases, socSuppressions, users } from "../../db/schema";
import { escalateAlert } from "../alerts/routes";
import { alertBase, alertDtos, validUntil } from "./routes";
import { linkedRisks } from "./grc";
import { caseDtos, getSocSettings, saveSocSettings } from "./service";

/* SOC II (ADR-047): případy, potlačení, statistika pravidel, nastavení lhůt. */

type Ctx = Context<AppEnv>;
type CaseRow = typeof socCases.$inferSelect;
const OPEN_ALERT = [...SOC_OPEN_STATUSES];
const OPEN_CASE = [...SOC_CASE_OPEN] as string[];
const creator = alias(users, "soc_sup_creator");

export function socCaseRoutes(db: Db) {
  const socIds = (c: Ctx, perm: "soc:read" | "soc:write" = "soc:read") => scopeOf(c).ids.filter((id) => hasPermIn(c, perm, id));
  const inIds = (col: Parameters<typeof inArray>[0], ids: string[]): SQL => (ids.length ? inArray(col, ids) : sql`false`);

  async function loadCase(c: Ctx, id: string, write = false, open = false): Promise<CaseRow> {
    const [r] = await db.select().from(socCases).where(eq(socCases.id, id));
    assertScope(c, r?.companyId, "Případ nenalezen");
    if (!hasPermIn(c, "soc:read", r!.companyId)) throw new HTTPException(404, { message: "Případ nenalezen" });
    if (write && !hasPermIn(c, "soc:write", r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    if (open && !OPEN_CASE.includes(r!.status)) throw new HTTPException(409, { message: "Případ je už uzavřený nebo eskalovaný." });
    return r!;
  }

  async function caseDetail(c: Ctx, r: CaseRow): Promise<SocCaseDetailDto> {
    const settings = await getSocSettings(db);
    const [[dto], rows] = await Promise.all([caseDtos(db, [r], settings), alertBase(db).where(eq(alertSuggestions.caseId, r.id)).orderBy(alertSuggestions.firstSeen)]);
    const noteUsers = [...new Set(r.notes.map((n) => n.userId).filter((x): x is string => !!x))];
    const names = noteUsers.length ? new Map((await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, noteUsers))).map((u) => [u.id, u.n])) : new Map<string, string>();
    return {
      ...dto!,
      alerts: alertDtos(rows, settings),
      risks: await linkedRisks(db, c, r.companyId, rows.map((x) => x.s.assetId).filter((x): x is string => !!x)),
      notes: r.notes.map((n) => ({ ...n, userName: n.userId ? (names.get(n.userId) ?? null) : null })),
      canWrite: hasPermIn(c, "soc:write", r.companyId),
      canEscalate: hasPermIn(c, "soc:write", r.companyId) && hasPermIn(c, "incidents:write", r.companyId),
    };
  }

  /** Alerty, které lze přidat do případu: stejná společnost, otevřené, zapisovatelné. */
  async function alertsFor(c: Ctx, companyId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await db.select().from(alertSuggestions).where(inArray(alertSuggestions.id, ids));
    if (rows.length !== new Set(ids).size || rows.some((a) => a.companyId !== companyId)) throw new HTTPException(400, { message: "Alerty musí patřit do stejné společnosti jako případ." });
    if (rows.some((a) => !(OPEN_ALERT as string[]).includes(a.status))) throw new HTTPException(409, { message: "Alert je už uzavřený nebo eskalovaný." });
    return rows;
  }

  async function suppressionDtos(where: SQL | undefined): Promise<SocSuppressionDto[]> {
    const rows = await db.select({ s: socSuppressions, by: creator.displayName }).from(socSuppressions).leftJoin(creator, eq(creator.id, socSuppressions.createdById)).where(where).orderBy(desc(socSuppressions.createdAt)).limit(500);
    const rules = [...new Set(rows.map((r) => r.s.ruleId))];
    const meta = rules.length
      ? await db
          .selectDistinctOn([alertSuggestions.ruleId, alertSuggestions.agentId], { ruleId: alertSuggestions.ruleId, agentId: alertSuggestions.agentId, d: alertSuggestions.description, agentName: alertSuggestions.agentName })
          .from(alertSuggestions)
          .where(inArray(alertSuggestions.ruleId, rules))
          .orderBy(alertSuggestions.ruleId, alertSuggestions.agentId, desc(alertSuggestions.lastSeen))
      : [];
    const today = new Date().toISOString().slice(0, 10);
    return rows.map(({ s, by }) => ({
      id: s.id,
      companyId: s.companyId,
      ruleId: s.ruleId,
      ruleDescription: meta.find((m) => m.ruleId === s.ruleId)?.d ?? null,
      agentId: s.agentId,
      agentName: s.agentId ? (meta.find((m) => m.ruleId === s.ruleId && m.agentId === s.agentId)?.agentName ?? null) : null,
      srcip: s.srcip,
      reason: s.reason,
      until: s.until,
      state: s.revokedAt ? "revoked" : s.until < today ? "expired" : "active",
      hits: s.hits,
      lastHitAt: s.lastHitAt?.toISOString() ?? null,
      createdByName: by,
      createdAt: s.createdAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
    }));
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "soc"))
      /* ---------- nastavení lhůt ---------- */
      .get("/settings", requirePerm("soc:read"), async (c) => c.json(await getSocSettings(db)))
      .put("/settings", requirePerm("admin:settings"), zValidator("json", SocSettingsInput), async (c) => {
        const input = c.req.valid("json");
        const cur = await getSocSettings(db);
        const next = { ...cur, ...input, ackMinutes: { ...cur.ackMinutes, ...(input.ackMinutes ?? {}) }, resolveHours: { ...cur.resolveHours, ...(input.resolveHours ?? {}) } };
        await saveSocSettings(db, next);
        await audit(db, { c, user: currentUser(c), action: "soc.settings_updated", details: input });
        return c.json(next);
      })

      /* ---------- případy ---------- */
      .get("/cases", requirePerm("soc:read"), zValidator("query", z.object({ status: z.enum(["open", "escalated", "closed", "all"]).default("open"), mine: z.literal("1").optional() })), async (c) => {
        const q = c.req.valid("query");
        const w: (SQL | undefined)[] = [inIds(socCases.companyId, socIds(c))];
        if (q.status === "open") w.push(inArray(socCases.status, OPEN_CASE));
        else if (q.status !== "all") w.push(eq(socCases.status, q.status));
        if (q.mine) w.push(eq(socCases.assigneeId, currentUser(c).id));
        const rows = await db.select().from(socCases).where(and(...w)).orderBy(desc(socCases.updatedAt)).limit(300);
        const list = await caseDtos(db, rows, await getSocSettings(db));
        const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
        return c.json(list.sort((a, b) => Number(!OPEN_CASE.includes(a.status)) - Number(!OPEN_CASE.includes(b.status)) || rank[a.severity] - rank[b.severity] || (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "")));
      })
      .get("/cases/:id", requirePerm("soc:read"), async (c) => c.json(await caseDetail(c, await loadCase(c, c.req.param("id")))))
      .post("/cases", requirePerm("soc:write"), zValidator("json", SocCaseCreate), async (c) => {
        const input = c.req.valid("json");
        const [first] = await db.select({ companyId: alertSuggestions.companyId }).from(alertSuggestions).where(eq(alertSuggestions.id, input.alertIds[0]!));
        assertScope(c, first?.companyId, "Alert nenalezen");
        const companyId = targetCompany(c, first!.companyId, "soc:write");
        const alerts = await alertsFor(c, companyId, input.alertIds);
        const user = currentUser(c);
        const [row] = await db.insert(socCases).values({ companyId, title: input.title, description: input.description ?? "", createdById: user.id }).returning();
        await db.update(alertSuggestions).set({ caseId: row!.id, updatedAt: new Date() }).where(inArray(alertSuggestions.id, alerts.map((a) => a.id)));
        await audit(db, { c, user, action: "soc.case_created", entityType: "soc_case", entityId: row!.id, details: { title: input.title, alerts: alerts.length } });
        return c.json(await caseDetail(c, row!), 201);
      })
      .patch("/cases/:id", requirePerm("soc:write"), zValidator("json", SocCasePatch), async (c) => {
        const r = await loadCase(c, c.req.param("id"), true, true);
        const input = c.req.valid("json");
        const set: Partial<typeof socCases.$inferInsert> = { updatedAt: new Date() };
        if (input.title) set.title = input.title;
        if (input.description !== undefined) set.description = input.description;
        if (input.assigneeId !== undefined) {
          if (input.assigneeId) {
            const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.assigneeId), eq(users.isActive, true)));
            if (!u) throw new HTTPException(400, { message: "Analytik nenalezen" });
            set.status = "in_progress";
            if (!r.acknowledgedAt) set.acknowledgedAt = new Date();
            // nepřevzaté otevřené alerty případu převezme stejný analytik
            await db
              .update(alertSuggestions)
              .set({ assigneeId: input.assigneeId, status: "in_progress", acknowledgedAt: sql`coalesce(${alertSuggestions.acknowledgedAt}, now())`, updatedAt: new Date() })
              .where(and(eq(alertSuggestions.caseId, r.id), inArray(alertSuggestions.status, OPEN_ALERT), sql`${alertSuggestions.assigneeId} is null`));
          }
          set.assigneeId = input.assigneeId;
        }
        if (input.status) {
          set.status = input.status;
          if (input.status === "in_progress" && !r.acknowledgedAt) set.acknowledgedAt = new Date();
        }
        const [row] = await db.update(socCases).set(set).where(eq(socCases.id, r.id)).returning();
        await audit(db, { c, user: currentUser(c), action: "soc.case_updated", entityType: "soc_case", entityId: r.id, details: input });
        return c.json(await caseDetail(c, row!));
      })
      .post("/cases/:id/alerts", requirePerm("soc:write"), zValidator("json", SocCaseAlertsInput), async (c) => {
        const r = await loadCase(c, c.req.param("id"), true, true);
        const { add, remove } = c.req.valid("json");
        const toAdd = await alertsFor(c, r.companyId, add ?? []);
        if (toAdd.length) await db.update(alertSuggestions).set({ caseId: r.id, updatedAt: new Date() }).where(inArray(alertSuggestions.id, toAdd.map((a) => a.id)));
        if (remove?.length) await db.update(alertSuggestions).set({ caseId: null, updatedAt: new Date() }).where(and(eq(alertSuggestions.caseId, r.id), inArray(alertSuggestions.id, remove)));
        await audit(db, { c, user: currentUser(c), action: "soc.case_alerts", entityType: "soc_case", entityId: r.id, details: { add, remove } });
        return c.json(await caseDetail(c, r));
      })
      .post("/cases/:id/notes", requirePerm("soc:write"), zValidator("json", SocNoteInput), async (c) => {
        const r = await loadCase(c, c.req.param("id"), true);
        const user = currentUser(c);
        const notes = [...r.notes, { at: new Date().toISOString(), userId: user.id, text: c.req.valid("json").text }].slice(-200);
        const [row] = await db.update(socCases).set({ notes, updatedAt: new Date() }).where(eq(socCases.id, r.id)).returning();
        await audit(db, { c, user, action: "soc.case_note_added", entityType: "soc_case", entityId: r.id });
        return c.json(await caseDetail(c, row!), 201);
      })
      .post("/cases/:id/close", requirePerm("soc:write"), zValidator("json", SocCaseCloseInput), async (c) => {
        const r = await loadCase(c, c.req.param("id"), true, true);
        const user = currentUser(c);
        const { verdict, reason } = c.req.valid("json");
        const now = new Date();
        await db
          .update(alertSuggestions)
          .set({ status: "dismissed", verdict, dismissReason: reason, decidedById: user.id, decidedAt: now, acknowledgedAt: sql`coalesce(${alertSuggestions.acknowledgedAt}, now())`, updatedAt: now })
          .where(and(eq(alertSuggestions.caseId, r.id), inArray(alertSuggestions.status, OPEN_ALERT)));
        const [row] = await db
          .update(socCases)
          .set({ status: "closed", verdict, closeReason: reason, closedAt: now, acknowledgedAt: r.acknowledgedAt ?? now, assigneeId: r.assigneeId ?? user.id, updatedAt: now })
          .where(eq(socCases.id, r.id))
          .returning();
        await audit(db, { c, user, action: "soc.case_closed", entityType: "soc_case", entityId: r.id, details: { verdict, reason } });
        return c.json(await caseDetail(c, row!));
      })
      .post("/cases/:id/reopen", requirePerm("soc:write"), async (c) => {
        const r = await loadCase(c, c.req.param("id"), true);
        if (r.status !== "closed") throw new HTTPException(409, { message: "Znovu otevřít lze jen uzavřený případ." });
        const [row] = await db.update(socCases).set({ status: "in_progress", verdict: null, closeReason: null, closedAt: null, updatedAt: new Date() }).where(eq(socCases.id, r.id)).returning();
        await audit(db, { c, user: currentUser(c), action: "soc.case_reopened", entityType: "soc_case", entityId: r.id });
        return c.json(await caseDetail(c, row!));
      })
      /** Eskalace případu: jeden incident pro všechny otevřené alerty případu (nebo připojení k existujícímu). */
      .post("/cases/:id/escalate", requirePerm("soc:write"), zValidator("json", SocEscalateInput), async (c) => {
        const r = await loadCase(c, c.req.param("id"), true, true);
        if (!hasPermIn(c, "incidents:write", r.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const input = c.req.valid("json");
        if (input.incidentId) {
          const [inc] = await db.select({ companyId: incidents.companyId }).from(incidents).where(eq(incidents.id, input.incidentId));
          if (!inc || inc.companyId !== r.companyId) throw new HTTPException(404, { message: "Incident nenalezen" });
        }
        const open = await db.select().from(alertSuggestions).where(and(eq(alertSuggestions.caseId, r.id), inArray(alertSuggestions.status, OPEN_ALERT))).orderBy(alertSuggestions.firstSeen);
        if (!open.length) throw new HTTPException(409, { message: "Případ nemá otevřené alerty." });
        const user = currentUser(c);
        const [first, ...rest] = open;
        const [dto] = await caseDtos(db, [r], await getSocSettings(db));
        const incidentId = await escalateAlert(db, { ...first!, title: r.title, mitreIds: dto!.mitreIds }, user, { title: input.title ?? `${dto!.code} ${r.title}`, kind: input.kind, incidentId: input.incidentId });
        for (const a of rest) await escalateAlert(db, a, user, { incidentId });
        const now = new Date();
        const [row] = await db
          .update(socCases)
          .set({ status: "escalated", incidentId, verdict: "true_positive", closedAt: now, acknowledgedAt: r.acknowledgedAt ?? now, assigneeId: r.assigneeId ?? user.id, updatedAt: now })
          .where(eq(socCases.id, r.id))
          .returning();
        await audit(db, { c, user, action: "soc.case_escalated", entityType: "incident", entityId: incidentId, details: { caseId: r.id, alerts: open.length } });
        return c.json({ incidentId, case: await caseDetail(c, row!) }, 201);
      })

      /* ---------- potlačení ---------- */
      .get("/suppressions", requirePerm("soc:read"), zValidator("query", z.object({ state: z.enum(["active", "all"]).default("active") })), async (c) => {
        const { state } = c.req.valid("query");
        const today = new Date().toISOString().slice(0, 10);
        return c.json(await suppressionDtos(and(inIds(socSuppressions.companyId, socIds(c)), state === "active" ? and(sql`${socSuppressions.revokedAt} is null`, gte(socSuppressions.until, today)) : undefined)));
      })
      .post("/suppressions", requirePerm("soc:write"), zValidator("json", SocSuppressionInput), async (c) => {
        const input = c.req.valid("json");
        validUntil(input.until);
        const companyId = targetCompany(c, input.companyId, "soc:write");
        const user = currentUser(c);
        const [row] = await db
          .insert(socSuppressions)
          .values({ companyId, ruleId: input.ruleId, agentId: input.agentId || null, srcip: input.srcip || null, reason: input.reason, until: input.until, createdById: user.id })
          .returning();
        await audit(db, { c, user, action: "soc.suppression_created", entityType: "soc_suppression", entityId: row!.id, details: input });
        const [dto] = await suppressionDtos(eq(socSuppressions.id, row!.id));
        return c.json(dto, 201);
      })
      .post("/suppressions/:id/revoke", requirePerm("soc:write"), async (c) => {
        const [s] = await db.select().from(socSuppressions).where(eq(socSuppressions.id, c.req.param("id")));
        assertScope(c, s?.companyId, "Potlačení nenalezeno");
        if (!hasPermIn(c, "soc:write", s!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        if (s!.revokedAt) throw new HTTPException(409, { message: "Potlačení už bylo zrušeno." });
        const user = currentUser(c);
        await db.update(socSuppressions).set({ revokedAt: new Date(), revokedById: user.id, updatedAt: new Date() }).where(eq(socSuppressions.id, s!.id));
        await audit(db, { c, user, action: "soc.suppression_revoked", entityType: "soc_suppression", entityId: s!.id });
        const [dto] = await suppressionDtos(eq(socSuppressions.id, s!.id));
        return c.json(dto);
      })

      /* ---------- statistika pravidel (ladění detekce) ---------- */
      .get("/rule-stats", requirePerm("soc:read"), zValidator("query", z.object({ days: z.coerce.number().int().min(7).max(365).default(90) })), async (c) => {
        const { days } = c.req.valid("query");
        const ids = socIds(c);
        const since = new Date(Date.now() - days * 864e5);
        const today = new Date().toISOString().slice(0, 10);
        const [rows, sups] = await Promise.all([
          db
            .select({
              ruleId: alertSuggestions.ruleId,
              description: sql<string>`(array_agg(${alertSuggestions.description} order by ${alertSuggestions.lastSeen} desc))[1]`,
              level: sql<number>`max(${alertSuggestions.ruleLevel})::int`,
              alerts: sql<number>`count(*)::int`,
              events: sql<number>`coalesce(sum(${alertSuggestions.count}), 0)::int`,
              open: sql<number>`count(*) filter (where ${alertSuggestions.status} in ('new','in_progress'))::int`,
              escalated: sql<number>`count(*) filter (where ${alertSuggestions.status} = 'accepted')::int`,
              tp: sql<number>`count(*) filter (where ${alertSuggestions.verdict} = 'true_positive')::int`,
              fp: sql<number>`count(*) filter (where ${alertSuggestions.verdict} = 'false_positive')::int`,
              benign: sql<number>`count(*) filter (where ${alertSuggestions.verdict} = 'benign')::int`,
              decided: sql<number>`count(*) filter (where ${alertSuggestions.status} in ('accepted','dismissed'))::int`,
              lastSeen: sql<string>`max(${alertSuggestions.lastSeen})`,
            })
            .from(alertSuggestions)
            .where(and(inIds(alertSuggestions.companyId, ids), eq(alertSuggestions.source, "wazuh"), gte(alertSuggestions.lastSeen, since)))
            .groupBy(alertSuggestions.ruleId),
          db.select().from(socSuppressions).where(inIds(socSuppressions.companyId, ids)),
        ]);
        const out: SocRuleStat[] = rows.map((r) => {
          const s = sups.filter((x) => x.ruleId === r.ruleId);
          const fpRate = r.decided ? (r.fp + r.benign) / r.decided : null;
          const base = { decided: r.decided, fpRate, escalated: r.escalated };
          return {
            ruleId: r.ruleId,
            description: r.description,
            level: r.level,
            alerts: r.alerts,
            events: r.events,
            open: r.open,
            escalated: r.escalated,
            decided: r.decided,
            truePositive: r.tp,
            falsePositive: r.fp,
            benign: r.benign,
            fpRate: fpRate == null ? null : Math.round(fpRate * 100) / 100,
            suppressedHits: s.reduce((a, x) => a + x.hits, 0),
            activeSuppressions: s.filter((x) => !x.revokedAt && x.until >= today).length,
            lastSeen: new Date(r.lastSeen).toISOString(),
            advice: ruleAdvice(base),
          };
        });
        const rank = { tune: 0, review: 1, keep: 3 } as const;
        return c.json(out.sort((a, b) => (a.advice ? rank[a.advice] : 2) - (b.advice ? rank[b.advice] : 2) || b.events + b.suppressedHits - (a.events + a.suppressedHits)));
      })
  );
}
