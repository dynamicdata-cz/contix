import {
  AcceptSuggestionInput,
  AlertSettingsInput,
  categoryFromGroups,
  DismissSuggestionInput,
  SOC_OPEN_STATUSES,
  tacticsFor,
  techniquesFromGroups,
  ATTACK_ID_RE,
  type AlertSuggestionDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, appSettings, assets, assetSources, incidentAssets, incidents } from "../../db/schema";
import { getWazuhConfig } from "../connectors/config";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { indexerCall } from "../vulnerabilities/sources";
import { activeSuppressions, correlateAlerts, suppressGroup } from "../soc/service";
import { refreshExposure } from "../soc/exposure";

/* ============================================================
 * Wazuh alerty → návrhy bezpečnostních událostí (ke schválení člověkem).
 * Alerty nad prahem úrovně z indexu wazuh-alerts-* se seskupí podle pravidla a agenta.
 * ============================================================ */

const KEY = "alerts.wazuh";
interface Stored {
  alertsEnabled: boolean;
  alertMinLevel: number;
  alertsIndexPattern: string;
  lastSyncAt: string | null;
  lastResult: string | null;
}
const DEFAULTS: Stored = { alertsEnabled: false, alertMinLevel: 10, alertsIndexPattern: "wazuh-alerts-*", lastSyncAt: null, lastResult: null };

export async function getAlertSettings(db: Db): Promise<Stored> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return { ...DEFAULTS, ...((r?.value as Partial<Stored>) ?? {}) };
}
async function storeAlertSettings(db: Db, v: Stored) {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: v })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
}

/** Po zamítnutí se stejné pravidlo na stejném agentovi 7 dní nenavrhuje znovu (jen se navýší počet). */
const SUPPRESS_DAYS = 7;

/** Načte nové alerty z indexeru a založí / aktualizuje návrhy. */
export async function syncAlerts(db: Db, config: Config, fetchImpl: FetchLike = fetch as FetchLike, now = new Date()) {
  const s = await getAlertSettings(db);
  if (!s.alertsEnabled) return { created: 0, updated: 0, skipped: "vypnuto" };
  const w = await getWazuhConfig(db, config);
  if (!w.indexerUrl || !w.indexerUser || !w.indexerPassword) throw new Error("Není nastaven Wazuh Indexer (Administrace → Konektory).");
  const since = s.lastSyncAt ?? new Date(now.getTime() - 24 * 3600_000).toISOString();
  const index = encodeURIComponent(s.alertsIndexPattern).replace(/%2A/g, "*");
  const res = await indexerCall(
    { url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword, verifyTls: w.indexerVerifyTls, indexPattern: s.alertsIndexPattern },
    `/${index}/_search`,
    {
      size: 1000,
      sort: [{ timestamp: { order: "asc" } }],
      _source: ["timestamp", "rule.id", "rule.level", "rule.description", "rule.groups", "rule.mitre.id", "rule.mitre.tactic", "data.vulnerability.cve", "agent.id", "agent.name", "data.srcip", "data.srcuser", "location"],
      query: { bool: { filter: [{ range: { "rule.level": { gte: s.alertMinLevel } } }, { range: { timestamp: { gt: since } } }] } },
    },
    fetchImpl,
  );
  const hits: any[] = res.hits?.hits ?? [];
  // seskupit
  type G = { ruleId: string; level: number; desc: string; groups: string[]; mitre: string[]; tactics: string[]; agentId: string | null; agentName: string | null; first: Date; last: Date; n: number; sample: Record<string, unknown> };
  const strs = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
  const groups = new Map<string, G>();
  let maxTs = since;
  for (const h of hits) {
    const a = h._source ?? {};
    const ruleId = String(a.rule?.id ?? "");
    if (!ruleId) continue;
    const ts = new Date(a.timestamp ?? now);
    if (a.timestamp && a.timestamp > maxTs) maxTs = a.timestamp;
    const agentId = a.agent?.id != null ? String(a.agent.id) : null;
    const key = `${ruleId}:${agentId ?? "-"}`;
    const g = groups.get(key);
    if (!g)
      groups.set(key, {
        ruleId,
        level: Number(a.rule?.level ?? 0),
        desc: String(a.rule?.description ?? `Pravidlo ${ruleId}`).slice(0, 2000),
        groups: Array.isArray(a.rule?.groups) ? a.rule.groups.map(String).slice(0, 20) : [],
        mitre: strs(a.rule?.mitre?.id).map((x) => x.trim().toUpperCase()).filter((x) => ATTACK_ID_RE.test(x)).slice(0, 20),
        tactics: strs(a.rule?.mitre?.tactic).slice(0, 20),
        agentId,
        agentName: a.agent?.name ? String(a.agent.name).slice(0, 255) : null,
        first: ts,
        last: ts,
        n: 1,
        sample: { timestamp: a.timestamp, srcip: a.data?.srcip ?? null, srcuser: a.data?.srcuser ?? null, location: a.location ?? null, ...(a.data?.vulnerability?.cve ? { cve: String(a.data.vulnerability.cve).slice(0, 50) } : {}) },
      });
    else {
      g.n++;
      if (ts < g.first) g.first = ts;
      if (ts > g.last) g.last = ts;
    }
  }
  let created = 0;
  let updated = 0;
  let suppressed = 0;
  const suppressions = await activeSuppressions(db, now);
  for (const [key, g] of groups) {
    // aktivum podle agenta Wazuh (discovery)
    const [asset] = g.agentId
      ? await db
          .select({ id: assets.id, companyId: assets.companyId })
          .from(assetSources)
          .innerJoin(assets, eq(assets.id, assetSources.assetId))
          .where(and(eq(assetSources.sourceType, "wazuh"), eq(assetSources.sourceRef, g.agentId)))
      : [];
    // potlačení opakovaných falešných poplachů (SOC, ADR-047) – alert se nezaloží, jen se připíše zásah
    if (suppressions.length && (await suppressGroup(db, suppressions, { companyId: asset?.companyId ?? null, ruleId: g.ruleId, agentId: g.agentId, srcip: typeof g.sample.srcip === "string" ? g.sample.srcip : null, n: g.n, last: g.last }))) {
      suppressed += g.n;
      continue;
    }
    const [open] = await db.select().from(alertSuggestions).where(and(eq(alertSuggestions.groupKey, key), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES]))).limit(1);
    const [recent] = open
      ? []
      : await db
          .select()
          .from(alertSuggestions)
          .where(and(eq(alertSuggestions.groupKey, key), inArray(alertSuggestions.status, ["dismissed", "accepted"]), gte(alertSuggestions.decidedAt, new Date(now.getTime() - SUPPRESS_DAYS * 864e5))))
          .orderBy(desc(alertSuggestions.decidedAt))
          .limit(1);
    const target = open ?? recent;
    if (target) {
      await db
        .update(alertSuggestions)
        .set({ count: target.count + g.n, lastSeen: g.last > target.lastSeen ? g.last : target.lastSeen, ruleLevel: Math.max(target.ruleLevel, g.level), updatedAt: new Date() })
        .where(eq(alertSuggestions.id, target.id));
      updated++;
    } else {
      const mitreIds = g.mitre.length ? g.mitre : techniquesFromGroups(g.groups);
      await db.insert(alertSuggestions).values({
        mitreIds,
        mitreTactics: tacticsFor(mitreIds, g.tactics),
        companyId: asset?.companyId ?? undefined,
        groupKey: key,
        ruleId: g.ruleId,
        ruleLevel: g.level,
        description: g.desc,
        groups: g.groups,
        agentId: g.agentId,
        agentName: g.agentName,
        assetId: asset?.id ?? null,
        firstSeen: g.first,
        lastSeen: g.last,
        count: g.n,
        sample: g.sample,
      });
      created++;
    }
  }
  // korelace do případů SOC (stejný hostitel / zdrojová IP)
  if (((await getSettings(db)).enabledModules as string[]).includes("soc")) {
    await refreshExposure(db);
    await correlateAlerts(db, now);
  }
  const fresh = await getAlertSettings(db);
  await storeAlertSettings(db, { ...fresh, lastSyncAt: maxTs, lastResult: `Načteno ${hits.length} alertů, nové návrhy ${created}, aktualizované ${updated}${suppressed ? `, potlačeno ${suppressed}` : ""}` });
  return { created, updated, suppressed, alerts: hits.length };
}

/**
 * Eskalace alertu na bezpečnostní událost / incident (návrhy u incidentů i fronta SOC).
 * Nový záznam, nebo připojení k existujícímu incidentu (`incidentId`, stejná společnost – ověří volající).
 */
export async function escalateAlert(
  db: Db,
  s: typeof alertSuggestions.$inferSelect,
  user: { id: string; displayName: string },
  opts: { title?: string; kind?: "unassessed" | "event" | "incident"; incidentId?: string },
): Promise<string> {
  const mitre = s.mitreIds.length ? `; MITRE ATT&CK: ${s.mitreIds.join(", ")}` : "";
  const what = s.source === "manual" ? `Alert SOC (ruční): ${s.title ?? s.description}` : `Návrh z Wazuh: pravidlo ${s.ruleId} (úroveň ${s.ruleLevel})`;
  let incidentId = opts.incidentId;
  if (incidentId) {
    const [inc] = await db.select({ id: incidents.id, timeline: incidents.timeline }).from(incidents).where(eq(incidents.id, incidentId));
    if (!inc) throw new HTTPException(404, { message: "Incident nenalezen" });
    const tl = (inc.timeline as { at: string; text: string }[] | null) ?? [];
    await db
      .update(incidents)
      .set({ timeline: [...tl, { at: new Date().toISOString(), text: `Připojen alert SOC: ${s.title ?? s.description} (${user.displayName})` }], updatedAt: new Date() } as never)
      .where(eq(incidents.id, incidentId));
  } else {
    const [inc] = await db
      .insert(incidents)
      .values({
        companyId: s.companyId,
        title: (opts.title ?? `${s.title ?? s.description}${s.agentName ? ` – ${s.agentName}` : ""}`).slice(0, 300),
        description: `${what}, ${s.count}× mezi ${s.firstSeen.toISOString()} a ${s.lastSeen.toISOString()}${s.groups.length ? `; skupiny: ${s.groups.join(", ")}` : ""}${mitre}.`,
        kind: opts.kind ?? "unassessed",
        category: categoryFromGroups(s.groups),
        detectedAt: s.firstSeen,
        reportedBy: `${s.source === "manual" ? "SOC" : "Wazuh"} (návrh schválil ${user.displayName})`,
        createdById: user.id,
        timeline: [
          { at: s.firstSeen.toISOString(), text: s.source === "manual" ? `Alert SOC založen` : `První alert Wazuh (pravidlo ${s.ruleId})` },
          { at: new Date().toISOString(), text: `Eskalováno na incident (${user.displayName})` },
        ],
      } as typeof incidents.$inferInsert)
      .returning();
    incidentId = inc!.id;
  }
  if (s.assetId) await db.insert(incidentAssets).values({ incidentId, targetId: s.assetId }).onConflictDoNothing();
  await db
    .update(alertSuggestions)
    .set({ status: "accepted", verdict: s.verdict ?? "true_positive", incidentId, decidedById: user.id, decidedAt: new Date(), acknowledgedAt: s.acknowledgedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(alertSuggestions.id, s.id));
  return incidentId;
}

export function alertRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike }) {
  const { db, config } = deps;
  async function load(where: ReturnType<typeof and>): Promise<AlertSuggestionDto[]> {
    const rows = await db
      .select({ s: alertSuggestions, assetName: assets.name })
      .from(alertSuggestions)
      .leftJoin(assets, eq(assets.id, alertSuggestions.assetId))
      .where(where)
      .orderBy(desc(alertSuggestions.ruleLevel), desc(alertSuggestions.lastSeen))
      .limit(500);
    return rows.map(({ s, assetName }) => ({
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
    }));
  }
  async function row(c: Parameters<typeof assertScope>[0], id: string) {
    const [s] = await db.select().from(alertSuggestions).where(eq(alertSuggestions.id, id));
    if (!s) throw new HTTPException(404, { message: "Návrh nenalezen" });
    assertScope(c, s.companyId, "Návrh nenalezen");
    if (!hasPermIn(c, "incidents:write", s.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    if (!(SOC_OPEN_STATUSES as readonly string[]).includes(s.status)) throw new HTTPException(409, { message: "O návrhu už bylo rozhodnuto." });
    return s;
  }
  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "incidents"))
      .get("/", requirePerm("incidents:read"), zValidator("query", z.object({ status: z.enum(["new", "accepted", "dismissed", "all"]).default("new") })), async (c) => {
        const { status } = c.req.valid("query");
        return c.json(await load(and(inScope(c, alertSuggestions.companyId), status === "all" ? undefined : eq(alertSuggestions.status, status))));
      })
      .get("/settings", requirePerm("incidents:read"), async (c) => {
        const s = await getAlertSettings(db);
        const w = await getWazuhConfig(db, config);
        return c.json({ ...s, indexerConfigured: !!(w.indexerUrl && w.indexerUser && w.indexerPassword) });
      })
      .put("/settings", requirePerm("admin:settings"), zValidator("json", AlertSettingsInput), async (c) => {
        const input = c.req.valid("json");
        const cur = await getAlertSettings(db);
        await storeAlertSettings(db, { ...cur, ...input });
        await audit(db, { c, user: currentUser(c), action: "alerts.settings_updated", details: input });
        return c.json({ ...(await getAlertSettings(db)) });
      })
      .post("/sync", requirePerm("incidents:write"), async (c) => {
        try {
          const r = await syncAlerts(db, config, deps.fetchImpl);
          await audit(db, { c, user: currentUser(c), action: "alerts.synced", details: r });
          return c.json(r);
        } catch (e) {
          throw new HTTPException(502, { message: (e as Error).message });
        }
      })
      /** Přijetí návrhu → evidovaná bezpečnostní událost (kvalifikaci provede správce incidentů). */
      .post("/:id/accept", requirePerm("incidents:write"), zValidator("json", AcceptSuggestionInput), async (c) => {
        const s = await row(c, c.req.param("id"));
        const user = currentUser(c);
        const incidentId = await escalateAlert(db, s, user, c.req.valid("json"));
        await audit(db, { c, user, action: "alerts.accepted", entityType: "incident", entityId: incidentId, details: { suggestionId: s.id, ruleId: s.ruleId } });
        return c.json({ incidentId }, 201);
      })
      .post("/:id/dismiss", requirePerm("incidents:write"), zValidator("json", DismissSuggestionInput), async (c) => {
        const s = await row(c, c.req.param("id"));
        const user = currentUser(c);
        await db.update(alertSuggestions).set({ status: "dismissed", dismissReason: c.req.valid("json").reason, decidedById: user.id, decidedAt: new Date(), updatedAt: new Date() }).where(eq(alertSuggestions.id, s.id));
        await audit(db, { c, user, action: "alerts.dismissed", details: { suggestionId: s.id, ruleId: s.ruleId, reason: c.req.valid("json").reason } });
        return c.json({ ok: true });
      })
  );
}


