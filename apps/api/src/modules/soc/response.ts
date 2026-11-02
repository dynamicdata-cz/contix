import {
  SEVERITY_LEVEL,
  SOC_ACTION_LABELS,
  SOC_ACTION_OPEN,
  SOC_AUTOMATED_ACTIONS,
  SOC_LABELS,
  SOC_OPEN_STATUSES,
  SOC_RESPONSE_DEFAULTS,
  SocActionComplete,
  SocActionDecision,
  SocActionInput,
  SocResponseSettingsInput,
  effectiveLevel,
  isPrivateIp,
  normalizeIoc,
  socSeverity,
  type SocActionDto,
  type SocActionKind,
  type SocActionStatus,
  type SocAiTriage,
  type SocResponseSettings,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decrypt, encrypt } from "../../auth/crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, appSettings, incidents, socActions, socCases, socIocs, users } from "../../db/schema";
import { getWazuhConfig } from "../connectors/config";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { sendSocNotices, type Mailer, type SocNotice, type TeamsPoster } from "../notifications/service";
import { effLevelSql } from "./exposure";
import { getSocSettings } from "./service";

/* ============================================================
 * Reakce s potvrzením (ADR-055). Zásah se nikdy neprovede bez schválení člověkem s `soc:respond`
 * (výchozí čtyři oči: schvaluje jiný než navrhovatel). Automaticky jen blokace IP přes Wazuh Active Response
 * se samostatným účtem; účty v AD a další zásahy provede člověk – CONTIX vede záznam (kdo, kdy, proč, výsledek).
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof socActions.$inferSelect;
type Deps = { db: Db; config: Config; fetchImpl?: FetchLike; mailer?: Mailer; teams?: TeamsPoster };
const KEY = "soc.response";
type Stored = Omit<SocResponseSettings, "hasWazuhPassword"> & { wazuhPasswordEnc: string | null };

async function loadStored(db: Db): Promise<Stored> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const { hasWazuhPassword: _h, ...def } = SOC_RESPONSE_DEFAULTS;
  return { ...def, wazuhPasswordEnc: null, ...((row?.value as Partial<Stored>) ?? {}) };
}
export async function getResponseSettings(db: Db): Promise<SocResponseSettings> {
  const { wazuhPasswordEnc, ...s } = await loadStored(db);
  return { ...s, hasWazuhPassword: !!wazuhPasswordEnc };
}

/* ---------- okamžitá upozornění na nové závažné alerty ---------- */

/** Nové otevřené alerty od nastavené závažnosti (za 24 h) → analytikům SOC; duplicity hlídá notification_log. */
export async function notifyNewAlerts(d: Deps, now = new Date()) {
  const s = await getResponseSettings(d.db);
  if (s.notifyMinSeverity === "off") return { emails: 0, teams: 0, errors: [] as string[] };
  const min = SEVERITY_LEVEL[s.notifyMinSeverity];
  const rows = await d.db
    .select()
    .from(alertSuggestions)
    .where(and(inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES]), gte(effLevelSql, min), gte(alertSuggestions.createdAt, new Date(now.getTime() - 24 * 3600_000))))
    .orderBy(desc(effLevelSql))
    .limit(50);
  const soc = await getSocSettings(d.db);
  const notices: SocNotice[] = rows.map((a) => {
    const sev = socSeverity(effectiveLevel(a.ruleLevel, a.exposure));
    const tr = a.aiTriage as unknown as SocAiTriage | null;
    return {
      key: `soc_alert:${a.id}`,
      companyId: a.companyId,
      perm: "soc:write",
      link: `/soc/${a.id}`,
      title: (t) => t("srv.soc.newAlert", { sev: t.lbl(SOC_LABELS.severity[sev]), title: a.title ?? a.description }),
      lines: (t) =>
        [
          t("srv.soc.source", { src: t.lbl(SOC_LABELS.source[a.source] ?? a.source), host: a.agentName ?? "—", n: a.count }),
          a.exposure?.exploit ? t("srv.soc.exploit", { cves: a.exposure.cves.join(", ") }) : "",
          tr?.verdict ? t("srv.soc.ai", { v: t.lbl(SOC_LABELS.verdict[tr.verdict]), c: t.lbl(SOC_LABELS.confidence[tr.confidence ?? "low"]) }) : "",
          t("srv.soc.ack", { min: soc.ackMinutes[sev] }),
        ].filter(Boolean),
    };
  });
  return sendSocNotices(d, notices);
}

/* ---------- Wazuh Active Response ---------- */

/** Blokace IP na agentech přes Wazuh Server API (PUT /active-response). Vrací text výsledku; chyba = výjimka. */
export async function wazuhBlockIp(db: Db, config: Config, ip: string, agentIds: string[], fetchImpl: FetchLike = fetch as FetchLike): Promise<string> {
  const st = await loadStored(db);
  if (!st.activeResponseEnabled) throw new Error("Blokace přes Wazuh Active Response je vypnutá (SOC → Reakce).");
  const password = st.wazuhPasswordEnc ? decrypt(st.wazuhPasswordEnc, appSecret(config)) : null;
  if (!st.wazuhUser || !password) throw new Error("Chybí účet Wazuh API pro Active Response (SOC → Reakce).");
  const w = await getWazuhConfig(db, config);
  if (!w.url) throw new Error("Není nastavena adresa Wazuh Server API (Administrace → Konektory).");
  const base = w.url.replace(/\/+$/, "");
  const tls = w.verifyTls === false ? { rejectUnauthorized: false } : undefined;
  const call = async (url: string, init: RequestInit) => {
    try {
      return await fetchImpl(url, { ...init, tls, signal: AbortSignal.timeout(20_000) } as never);
    } catch (e) {
      throw new Error(`Wazuh API nedostupné: ${(e as Error).message}`);
    }
  };
  const auth = await call(`${base}/security/user/authenticate`, { method: "POST", headers: { Authorization: `Basic ${btoa(`${st.wazuhUser}:${password}`)}` } });
  if (auth.status === 401) throw new Error("Wazuh odmítl přihlášení účtu pro Active Response.");
  if (!auth.ok) throw new Error(`Wazuh autentizace: HTTP ${auth.status}`);
  const token = ((await auth.json()) as any)?.data?.token as string;
  const res = await call(`${base}/active-response?agents_list=${agentIds.map(encodeURIComponent).join(",")}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ command: st.blockCommand, arguments: [], alert: { data: { srcip: ip } } }),
  });
  if (res.status === 403) throw new Error("Účet Wazuh API nemá oprávnění active-response:command.");
  const body = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(`Wazuh Active Response: HTTP ${res.status} ${JSON.stringify(body?.detail ?? body?.title ?? "").slice(0, 200)}`);
  const ok: string[] = (body?.data?.affected_items ?? []).map(String);
  const failed: { id: string[]; error: { message?: string } }[] = body?.data?.failed_items ?? [];
  if (!ok.length) throw new Error(`Wazuh Active Response neprovedl příkaz na žádném agentovi${failed.length ? `: ${failed.map((f) => `${f.id.join(",")} – ${f.error?.message ?? "chyba"}`).join("; ")}` : ""}.`);
  return `Příkaz ${st.blockCommand} pro ${ip} odeslán na agenty ${ok.join(", ")}${failed.length ? `; selhalo: ${failed.map((f) => f.id.join(",")).join(", ")}` : ""}.`;
}

/* ---------- API ---------- */

export function socResponseRoutes(deps: Deps) {
  const { db, config } = deps;
  const requester = alias(users, "requester");
  const decider = alias(users, "decider");
  const executor = alias(users, "executor");
  const ids = (c: Ctx) => scopeOf(c).ids.filter((id) => hasPermIn(c, "soc:read", id));

  async function dtos(c: Ctx, where: SQL | undefined): Promise<SocActionDto[]> {
    const fourEyes = (await getResponseSettings(db)).fourEyes;
    const me = currentUser(c).id;
    const rows = await db
      .select({ a: socActions, alertTitle: sql<string | null>`coalesce(${alertSuggestions.title}, ${alertSuggestions.description})`, rq: requester.displayName, dc: decider.displayName, ex: executor.displayName })
      .from(socActions)
      .leftJoin(alertSuggestions, eq(alertSuggestions.id, socActions.alertId))
      .leftJoin(requester, eq(requester.id, socActions.requestedById))
      .leftJoin(decider, eq(decider.id, socActions.decidedById))
      .leftJoin(executor, eq(executor.id, socActions.executedById))
      .where(where)
      .orderBy(desc(socActions.createdAt))
      .limit(500);
    return rows.map(({ a, alertTitle, rq, dc, ex }) => {
      const respond = hasPermIn(c, "soc:respond", a.companyId);
      const automated = SOC_AUTOMATED_ACTIONS.includes(a.kind as SocActionKind);
      return {
        id: a.id,
        companyId: a.companyId,
        kind: a.kind as SocActionKind,
        automated,
        target: a.target,
        agentIds: a.agentIds,
        reason: a.reason,
        status: a.status as SocActionStatus,
        alertId: a.alertId,
        alertTitle,
        caseId: a.caseId,
        requestedById: a.requestedById,
        requestedByName: rq,
        decidedByName: dc,
        decidedAt: a.decidedAt?.toISOString() ?? null,
        decisionNote: a.decisionNote,
        executedByName: ex,
        executedAt: a.executedAt?.toISOString() ?? null,
        result: a.result,
        createdAt: a.createdAt.toISOString(),
        canDecide: respond && a.status === "proposed" && (!fourEyes || a.requestedById !== me),
        canComplete: respond && (a.status === "approved" ? !automated : a.status === "failed" && automated),
        canCancel: a.status === "proposed" && (a.requestedById === me || respond),
      };
    });
  }
  const one = async (c: Ctx, id: string) => (await dtos(c, eq(socActions.id, id)))[0]!;
  async function load(c: Ctx, id: string): Promise<Row> {
    const [r] = await db.select().from(socActions).where(eq(socActions.id, id));
    assertScope(c, r?.companyId, "Zásah nenalezen");
    if (!hasPermIn(c, "soc:read", r!.companyId)) throw new HTTPException(404, { message: "Zásah nenalezen" });
    return r!;
  }
  /** Záznam do poznámek alertu a do časové osy incidentu (stopa pro audit, do AI se neposílá). */
  async function trail(r: Row, userId: string, text: string) {
    if (!r.alertId) return;
    const [a] = await db.select({ notes: alertSuggestions.notes, incidentId: alertSuggestions.incidentId }).from(alertSuggestions).where(eq(alertSuggestions.id, r.alertId));
    if (!a) return;
    await db
      .update(alertSuggestions)
      .set({ notes: [...a.notes, { at: new Date().toISOString(), userId, text }], updatedAt: new Date() })
      .where(eq(alertSuggestions.id, r.alertId));
    if (a.incidentId) {
      const [inc] = await db.select({ timeline: incidents.timeline }).from(incidents).where(eq(incidents.id, a.incidentId));
      const tl = (inc?.timeline as { at: string; text: string }[] | null) ?? [];
      await db.update(incidents).set({ timeline: [...tl, { at: new Date().toISOString(), text }], updatedAt: new Date() } as never).where(eq(incidents.id, a.incidentId));
    }
  }
  /** Provedení automatického zásahu (po schválení nebo opakování). */
  async function execute(c: Ctx, r: Row): Promise<void> {
    const user = currentUser(c);
    let status: SocActionStatus = "done";
    let result: string;
    try {
      result = await wazuhBlockIp(db, config, r.target, r.agentIds, deps.fetchImpl);
      // zablokovaná IP do seznamu IOC (feed pro firewall)
      const [ex] = await db.select({ id: socIocs.id }).from(socIocs).where(and(eq(socIocs.companyId, r.companyId), eq(socIocs.type, "ip"), eq(socIocs.value, r.target)));
      if (ex) await db.update(socIocs).set({ action: "block", revokedAt: null, updatedAt: new Date() }).where(eq(socIocs.id, ex.id));
      else await db.insert(socIocs).values({ companyId: r.companyId, type: "ip", value: r.target, action: "block", note: r.reason.slice(0, 1000), sourceAlertId: r.alertId, validUntil: new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), createdById: user.id });
    } catch (e) {
      status = "failed";
      result = (e as Error).message.slice(0, 1000);
    }
    await db.update(socActions).set({ status, result, executedById: user.id, executedAt: new Date(), updatedAt: new Date() }).where(eq(socActions.id, r.id));
    await audit(db, { c, user, action: status === "done" ? "soc.action_executed" : "soc.action_failed", entityType: "soc_action", entityId: r.id, details: { kind: r.kind, target: r.target, agents: r.agentIds, result } });
    await trail(r, user.id, `Zásah ${SOC_ACTION_LABELS.kind[r.kind as SocActionKind]} (${r.target}): ${status === "done" ? "provedeno" : "SELHALO"} – ${result}`);
    if (status === "failed")
      void sendSocNotices(deps, [
        { key: `soc_action_failed:${r.id}:${Date.now()}`, companyId: r.companyId, perm: "soc:respond", link: r.alertId ? `/soc/${r.alertId}` : "/soc?tab=response", title: (t) => t("srv.soc.actionFailed", { target: r.target }), lines: () => [result] },
      ]).catch(() => {});
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "soc"))
      .get("/response/settings", requirePerm("soc:read"), async (c) => c.json(await getResponseSettings(db)))
      .put("/response/settings", requirePerm("admin:settings"), zValidator("json", SocResponseSettingsInput), async (c) => {
        const input = c.req.valid("json");
        const cur = await loadStored(db);
        const { wazuhPassword, ...rest } = input;
        const next: Stored = { ...cur, ...rest, wazuhPasswordEnc: wazuhPassword === undefined ? cur.wazuhPasswordEnc : wazuhPassword ? encrypt(wazuhPassword, appSecret(config)) : null };
        await db
          .insert(appSettings)
          .values({ key: KEY, value: next })
          .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
        await audit(db, { c, user: currentUser(c), action: "soc.response_settings_updated", details: { ...rest, wazuhPassword: wazuhPassword === undefined ? "beze změny" : wazuhPassword ? "nastaveno" : "smazáno" } });
        return c.json(await getResponseSettings(db));
      })
      .get("/actions", requirePerm("soc:read"), zValidator("query", z.object({ status: z.enum(["open", "all"]).default("open"), alertId: z.string().uuid().optional() })), async (c) => {
        const q = c.req.valid("query");
        const l = ids(c);
        return c.json(await dtos(c, and(l.length ? inArray(socActions.companyId, l) : sql`false`, q.status === "open" ? inArray(socActions.status, SOC_ACTION_OPEN) : undefined, q.alertId ? eq(socActions.alertId, q.alertId) : undefined)));
      })
      .post("/actions", requirePerm("soc:write"), zValidator("json", SocActionInput), async (c) => {
        const input = c.req.valid("json");
        const user = currentUser(c);
        let companyId = targetCompany(c, input.companyId, "soc:write");
        if (input.alertId) {
          const [a] = await db.select({ companyId: alertSuggestions.companyId }).from(alertSuggestions).where(eq(alertSuggestions.id, input.alertId));
          assertScope(c, a?.companyId, "Alert nenalezen");
          companyId = a!.companyId;
        }
        if (input.caseId) {
          const [k] = await db.select({ companyId: socCases.companyId }).from(socCases).where(eq(socCases.id, input.caseId));
          assertScope(c, k?.companyId, "Případ nenalezen");
          if (k!.companyId !== companyId) throw new HTTPException(400, { message: "Případ patří jiné společnosti." });
        }
        if (!hasPermIn(c, "soc:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        let target = input.target;
        if (input.kind === "block_ip") {
          const ip = normalizeIoc("ip", target);
          if (!ip) throw new HTTPException(400, { message: "Neplatná IP adresa." });
          if (isPrivateIp(ip)) throw new HTTPException(400, { message: "Interní adresu nelze blokovat." });
          target = ip;
        }
        const [row] = await db
          .insert(socActions)
          .values({ companyId, kind: input.kind, target, agentIds: input.kind === "block_ip" ? [...new Set(input.agentIds)] : [], reason: input.reason, alertId: input.alertId ?? null, caseId: input.caseId ?? null, requestedById: user.id })
          .returning();
        await audit(db, { c, user, action: "soc.action_proposed", entityType: "soc_action", entityId: row!.id, details: { kind: input.kind, target, agents: row!.agentIds, alertId: input.alertId } });
        await trail(row!, user.id, `Navržen zásah ${SOC_ACTION_LABELS.kind[input.kind]} (${target}): ${input.reason}`);
        void sendSocNotices(deps, [
          {
            key: `soc_action:${row!.id}`,
            companyId,
            perm: "soc:respond",
            link: input.alertId ? `/soc/${input.alertId}` : "/soc?tab=response",
            title: (t) => t("srv.soc.actionProposed", { kind: t.lbl(SOC_ACTION_LABELS.kind[input.kind]), target }),
            lines: (t) => [input.reason, t("srv.soc.actionApprove")],
          },
        ]).catch(() => {});
        return c.json(await one(c, row!.id), 201);
      })
      .post("/actions/:id/decide", requirePerm("soc:respond"), zValidator("json", SocActionDecision), async (c) => {
        const r = await load(c, c.req.param("id"));
        const input = c.req.valid("json");
        const user = currentUser(c);
        if (!hasPermIn(c, "soc:respond", r.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        if (r.status !== "proposed") throw new HTTPException(409, { message: "O zásahu už bylo rozhodnuto." });
        if ((await getResponseSettings(db)).fourEyes && r.requestedById === user.id) throw new HTTPException(403, { message: "Zásah musí schválit jiný člověk než navrhovatel (princip čtyř očí)." });
        if (input.decision === "reject" && input.note.length < 3) throw new HTTPException(400, { message: "Uveďte důvod zamítnutí." });
        const status: SocActionStatus = input.decision === "approve" ? "approved" : "rejected";
        await db.update(socActions).set({ status, decidedById: user.id, decidedAt: new Date(), decisionNote: input.note || null, updatedAt: new Date() }).where(eq(socActions.id, r.id));
        await audit(db, { c, user, action: input.decision === "approve" ? "soc.action_approved" : "soc.action_rejected", entityType: "soc_action", entityId: r.id, details: { kind: r.kind, target: r.target, note: input.note } });
        await trail(r, user.id, `Zásah ${SOC_ACTION_LABELS.kind[r.kind as SocActionKind]} (${r.target}) ${input.decision === "approve" ? "schválen" : "zamítnut"}${input.note ? `: ${input.note}` : ""}`);
        if (status === "approved" && SOC_AUTOMATED_ACTIONS.includes(r.kind as SocActionKind)) await execute(c, { ...r, status });
        return c.json(await one(c, r.id));
      })
      /** Ruční zásah provedl člověk (nebo opakování selhaného automatického). */
      .post("/actions/:id/complete", requirePerm("soc:respond"), zValidator("json", SocActionComplete), async (c) => {
        const r = await load(c, c.req.param("id"));
        const input = c.req.valid("json");
        const user = currentUser(c);
        if (!hasPermIn(c, "soc:respond", r.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const automated = SOC_AUTOMATED_ACTIONS.includes(r.kind as SocActionKind);
        if (automated && r.status === "failed" && input.success) {
          await execute(c, r);
          return c.json(await one(c, r.id));
        }
        if (r.status !== "approved" || automated) throw new HTTPException(409, { message: "Zásah není schválený ruční zásah." });
        const status: SocActionStatus = input.success ? "done" : "failed";
        await db.update(socActions).set({ status, result: input.note, executedById: user.id, executedAt: new Date(), updatedAt: new Date() }).where(eq(socActions.id, r.id));
        await audit(db, { c, user, action: input.success ? "soc.action_executed" : "soc.action_failed", entityType: "soc_action", entityId: r.id, details: { kind: r.kind, target: r.target, note: input.note } });
        await trail(r, user.id, `Zásah ${SOC_ACTION_LABELS.kind[r.kind as SocActionKind]} (${r.target}): ${input.success ? "provedeno" : "nepodařilo se"} – ${input.note}`);
        return c.json(await one(c, r.id));
      })
      .post("/actions/:id/cancel", requirePerm("soc:write"), async (c) => {
        const r = await load(c, c.req.param("id"));
        const user = currentUser(c);
        if (r.status !== "proposed") throw new HTTPException(409, { message: "Zrušit lze jen zásah, o kterém se ještě nerozhodlo." });
        if (r.requestedById !== user.id && !hasPermIn(c, "soc:respond", r.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        await db.update(socActions).set({ status: "cancelled", updatedAt: new Date() }).where(eq(socActions.id, r.id));
        await audit(db, { c, user, action: "soc.action_cancelled", entityType: "soc_action", entityId: r.id });
        await trail(r, user.id, `Návrh zásahu ${SOC_ACTION_LABELS.kind[r.kind as SocActionKind]} (${r.target}) zrušen`);
        return c.json(await one(c, r.id));
      })
  );
}
