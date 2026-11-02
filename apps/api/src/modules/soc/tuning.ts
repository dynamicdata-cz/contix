import {
  TUNING_RULE_ID_BASE,
  TUNING_RULE_ID_MAX,
  TuningDecisionInput,
  TuningProposalInput,
  TuningProposalPatch,
  conditionForPath,
  conditionsMatch,
  tuningIndexPath,
  tuningRuleXml,
  tuningRulesFile,
  type TuningCondition,
  type TuningProposalDto,
  type TuningSimulation,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, socRuleTunings, users } from "../../db/schema";
import { getAlertSettings } from "../alerts/routes";
import { getWazuhConfig } from "../connectors/config";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { indexerCall } from "../vulnerabilities/sources";
import { getResponseSettings } from "./response";

/* ============================================================
 * Ladění pravidel Wazuh (v1.14, ADR-111): návrhy výjimek / změn úrovně, simulace nad Wazuh Indexerem,
 * schválení (soc:respond, čtyři oči) a export local_rules.xml. Indexer se jen čte, do Wazuhu se nic nezapisuje.
 * „Chráněné“ alerty = verdikt skutečný útok nebo eskalace – návrh, který by skryl jejich události, se bez
 * výslovného zdůvodnění neschválí.
 * ============================================================ */

type Deps = { db: Db; config: Config; fetchImpl?: FetchLike };
type Row = typeof socRuleTunings.$inferSelect;
type Ctx = Context<AppEnv>;

const DAY = 86_400_000;
const ref = (seq: number) => `LP-${seq}`;
const wazuhRuleIdOf = (seq: number) => Math.min(TUNING_RULE_ID_BASE + seq, TUNING_RULE_ID_MAX);
/** Lucene regexp je vždy ukotvený – kotvy pcre2 se odstraní. */
const luceneRe = (re: string) => re.replace(/^\^/, "").replace(/\$$/, "");
const condFilter = (c: TuningCondition) => (c.op === "equals" ? { term: { [tuningIndexPath(c)]: c.value } } : { regexp: { [tuningIndexPath(c)]: { value: luceneRe(c.value) } } });
/** Pole vzorku alertu CONTIXu (bez indexeru jen IP, uživatel a umístění). */
const samplePath: Record<string, string> = { "data.srcip": "srcip", "data.srcuser": "srcuser", location: "location" };

export function socTuningRoutes(deps: Deps) {
  const { db, config } = deps;
  const fetchImpl = deps.fetchImpl ?? (fetch as FetchLike);
  const creator = alias(users, "tuning_creator");
  const decider = alias(users, "tuning_decider");

  const idsOf = (c: Ctx, perm: "soc:read" | "soc:write" | "soc:respond" = "soc:read") => scopeOf(c).ids.filter((id) => hasPermIn(c, perm, id));
  const inIds = (ids: string[]): SQL => (ids.length ? inArray(socRuleTunings.companyId, ids) : sql`false`);

  async function indexer() {
    const w = await getWazuhConfig(db, config);
    if (!w.indexerUrl || !w.indexerUser || !w.indexerPassword) return null;
    const al = await getAlertSettings(db);
    const p = { url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword, verifyTls: w.indexerVerifyTls, indexPattern: al.alertsIndexPattern };
    const path = `/${encodeURIComponent(al.alertsIndexPattern).replace(/%2A/g, "*")}/_search`;
    return { search: (body: unknown) => indexerCall(p, path, body, fetchImpl) };
  }
  const base = (ruleId: string, since: Date, until: Date) => [{ term: { "rule.id": ruleId } }, { range: { timestamp: { gte: since.toISOString(), lte: until.toISOString() } } }];
  const totalOf = (r: any) => Number(typeof r?.hits?.total === "object" ? r.hits.total.value : r?.hits?.total) || 0;

  /** Alerty CONTIXu k pravidlu, které se nesmí skrýt (skutečný útok nebo eskalace). */
  async function protectedAlerts(companyId: string, ruleId: string, since: Date) {
    return db
      .select({ id: alertSuggestions.id, title: alertSuggestions.description, verdict: alertSuggestions.verdict, status: alertSuggestions.status, agentId: alertSuggestions.agentId, first: alertSuggestions.firstSeen, last: alertSuggestions.lastSeen, sample: alertSuggestions.sample, count: alertSuggestions.count })
      .from(alertSuggestions)
      .where(and(eq(alertSuggestions.companyId, companyId), eq(alertSuggestions.ruleId, ruleId), eq(alertSuggestions.source, "wazuh"), gte(alertSuggestions.lastSeen, since), or(eq(alertSuggestions.verdict, "true_positive"), eq(alertSuggestions.status, "accepted"))))
      .orderBy(desc(alertSuggestions.lastSeen))
      .limit(30);
  }

  /** Kolik událostí by podmínky skryly a zda zasahují do chráněných alertů. */
  async function simulate(companyId: string, ruleId: string, conditions: TuningCondition[], days: number, now = new Date()): Promise<TuningSimulation> {
    const since = new Date(now.getTime() - days * DAY);
    const prot = await protectedAlerts(companyId, ruleId, since);
    const idx = await indexer();
    if (idx) {
      const count = async (extra: unknown[]) => totalOf(await idx.search({ size: 0, track_total_hits: true, query: { bool: { filter: [...base(ruleId, since, now), ...extra] } } }));
      const conds = conditions.map(condFilter);
      const [total, matched] = await Promise.all([count([]), count(conds)]);
      const hit: TuningSimulation["protectedAlerts"] = [];
      for (const a of prot) {
        // události chráněného alertu = stejný agent v jeho časovém okně
        const win = { range: { timestamp: { gte: new Date(a.first.getTime() - 60_000).toISOString(), lte: new Date(a.last.getTime() + 60_000).toISOString() } } };
        const n = await count([...conds, win, ...(a.agentId ? [{ term: { "agent.id": a.agentId } }] : [])]);
        if (n > 0) hit.push({ id: a.id, title: a.title, verdict: a.verdict, status: a.status });
      }
      return { at: now.toISOString(), days, source: "indexer", total, matched, protectedAlerts: hit, note: null };
    }
    // bez indexeru: jen vzorky alertů CONTIXu (IP, uživatel, umístění)
    const all = await db
      .select({ id: alertSuggestions.id, title: alertSuggestions.description, verdict: alertSuggestions.verdict, status: alertSuggestions.status, sample: alertSuggestions.sample, count: alertSuggestions.count })
      .from(alertSuggestions)
      .where(and(eq(alertSuggestions.companyId, companyId), eq(alertSuggestions.ruleId, ruleId), eq(alertSuggestions.source, "wazuh"), gte(alertSuggestions.lastSeen, since)));
    let total = 0;
    let matched = 0;
    let unknown = 0;
    const hit: TuningSimulation["protectedAlerts"] = [];
    for (const a of all) {
      total += a.count;
      const s = (a.sample ?? {}) as Record<string, unknown>;
      const m = conditionsMatch(conditions, (p) => (samplePath[p] && s[samplePath[p]!] != null ? String(s[samplePath[p]!]) : null));
      if (m === null) unknown += a.count;
      if (m) {
        matched += a.count;
        if (a.verdict === "true_positive" || a.status === "accepted") hit.push({ id: a.id, title: a.title, verdict: a.verdict, status: a.status });
      }
    }
    return { at: now.toISOString(), days, source: "contix", total, matched, protectedAlerts: hit, note: unknown ? `Wazuh Indexer není nastaven – ${unknown} událostí nelze ověřit (podmínka na pole, které vzorek alertu nemá).` : null };
  }

  /**
   * Návrh výjimky z dat: nejčastější hodnota pole v událostech pravidla, která nezasahuje do chráněných alertů.
   * Kandidátní pole = IP, uživatel, program, hostitel, umístění + textová pole `data.*` ze vzorku událostí.
   */
  async function suggest(companyId: string, ruleId: string, days: number, now = new Date()) {
    const idx = await indexer();
    if (!idx) throw new HTTPException(409, { message: "Návrh z dat vyžaduje Wazuh Indexer (Administrace → Konektory)." });
    const since = new Date(now.getTime() - days * DAY);
    const [st] = await db
      .select({
        decided: sql<number>`count(*) filter (where ${alertSuggestions.status} in ('accepted','dismissed'))::int`,
        fp: sql<number>`count(*) filter (where ${alertSuggestions.verdict} in ('false_positive','benign'))::int`,
        desc: sql<string>`(array_agg(${alertSuggestions.description} order by ${alertSuggestions.lastSeen} desc))[1]`,
      })
      .from(alertSuggestions)
      .where(and(eq(alertSuggestions.companyId, companyId), eq(alertSuggestions.ruleId, ruleId), eq(alertSuggestions.source, "wazuh"), gte(alertSuggestions.lastSeen, since)));
    const fpRate = st?.decided ? st.fp / st.decided : 0;
    if (!st || st.decided < 3 || fpRate < 0.5) throw new HTTPException(409, { message: "Málo podkladů – pravidlo potřebuje aspoň 3 uzavřené alerty a podíl falešných poplachů aspoň 50 %." });
    // pole ze vzorku událostí
    const sample = await idx.search({ size: 20, query: { bool: { filter: base(ruleId, since, now) } }, _source: ["data", "predecoder", "location"] });
    const paths = new Set(["data.srcip", "data.srcuser", "predecoder.program_name", "predecoder.hostname", "location"]);
    const walk = (o: unknown, prefix: string, depth: number) => {
      if (!o || typeof o !== "object" || depth > 5) return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        const p = `${prefix}.${k}`;
        if (typeof v === "string" && v.length <= 300 && conditionForPath(p, v)) paths.add(p);
        else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p, depth + 1);
      }
    };
    for (const h of (sample?.hits?.hits ?? []) as any[]) walk(h._source?.data, "data", 0);
    const fields = [...paths].slice(0, 20);
    const aggs = Object.fromEntries(fields.map((f, i) => [`f${i}`, { terms: { field: f, size: 3 } }]));
    const r = await idx.search({ size: 0, track_total_hits: true, query: { bool: { filter: base(ruleId, since, now) } }, aggs });
    const total = totalOf(r);
    if (!total) throw new HTTPException(409, { message: "Pravidlo nemá ve Wazuh Indexeru za zvolené období žádné události." });
    const cands: { c: TuningCondition; n: number }[] = [];
    fields.forEach((f, i) => {
      for (const b of (r.aggregations?.[`f${i}`]?.buckets ?? []) as any[]) {
        const c = conditionForPath(f, String(b.key));
        if (c && Number(b.doc_count) / total >= 0.4 && TuningProposalInput.safeParse({ ruleId, kind: "exclude", conditions: [c] }).success) cands.push({ c, n: Number(b.doc_count) });
      }
    });
    cands.sort((a, b) => b.n - a.n);
    for (const k of cands.slice(0, 8)) {
      const sim = await simulate(companyId, ruleId, [k.c], days, now);
      if (sim.protectedAlerts.length) continue;
      return { condition: k.c, simulation: sim, description: st.desc ?? "", fpRate, decided: st.decided };
    }
    throw new HTTPException(409, { message: "Nenašel se společný znak falešných poplachů, který by nezasáhl alerty se skutečným útokem nebo eskalací – navrhněte úpravu ručně." });
  }

  async function dtos(c: Ctx, where: SQL): Promise<TuningProposalDto[]> {
    const rows = await db
      .select({ t: socRuleTunings, by: creator.displayName, dec: decider.displayName })
      .from(socRuleTunings)
      .leftJoin(creator, eq(creator.id, socRuleTunings.createdById))
      .leftJoin(decider, eq(decider.id, socRuleTunings.decidedById))
      .where(where)
      .orderBy(desc(socRuleTunings.createdAt));
    const fourEyes = (await getResponseSettings(db)).fourEyes;
    const me = currentUser(c).id;
    return rows.map(({ t, by, dec }) => ({
      id: t.id,
      companyId: t.companyId,
      ref: ref(t.seq),
      wazuhRuleId: wazuhRuleIdOf(t.seq),
      ruleId: t.ruleId,
      ruleDescription: t.ruleDescription,
      kind: t.kind,
      conditions: t.conditions,
      newLevel: t.newLevel,
      rationale: t.rationale,
      source: t.source,
      status: t.status,
      simulation: t.simulation ?? null,
      xml: tuningRuleXml({ wazuhRuleId: wazuhRuleIdOf(t.seq), ruleId: t.ruleId, kind: t.kind, conditions: t.conditions, newLevel: t.newLevel, description: t.ruleDescription || `pravidlo ${t.ruleId}`, ref: ref(t.seq) }),
      createdByName: by,
      decidedByName: dec,
      decidedAt: t.decidedAt?.toISOString() ?? null,
      decisionNote: t.decisionNote,
      canDecide: t.status === "draft" && hasPermIn(c, "soc:respond", t.companyId) && (!fourEyes || t.createdById !== me),
      createdAt: t.createdAt.toISOString(),
    }));
  }
  async function load(c: Ctx, id: string, perm: "soc:write" | "soc:respond" = "soc:write"): Promise<Row> {
    const [r] = await db.select().from(socRuleTunings).where(eq(socRuleTunings.id, id));
    assertScope(c, r?.companyId, "Návrh nenalezen");
    if (!hasPermIn(c, perm, r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r!;
  }
  async function ruleDescription(companyId: string, ruleId: string) {
    const [a] = await db.select({ d: alertSuggestions.description }).from(alertSuggestions).where(and(eq(alertSuggestions.companyId, companyId), eq(alertSuggestions.ruleId, ruleId))).orderBy(desc(alertSuggestions.lastSeen)).limit(1);
    return a?.d ?? "";
  }

  const Days = z.object({ days: z.number().int().min(7).max(365).default(30) });
  return new Hono<AppEnv>()
    .use("/tuning", requireModule(db, "soc"))
    .use("/tuning/*", requireModule(db, "soc"))
    .get("/tuning", requirePerm("soc:read"), async (c) => c.json(await dtos(c, inIds(idsOf(c)))))
    /** Schválené návrhy jako soubor pravidel pro ruční nasazení na manager Wazuh. */
    .get("/tuning/rules.xml", requirePerm("soc:read"), async (c) => {
      const list = (await dtos(c, and(inIds(idsOf(c)), eq(socRuleTunings.status, "approved"))!)).sort((a, b) => a.wazuhRuleId - b.wazuhRuleId);
      await audit(db, { c, user: currentUser(c), action: "report.exported", details: { report: "wazuh_tuning_rules", count: list.length } });
      return c.body(tuningRulesFile(list.map((x) => x.xml), new Date().toISOString().slice(0, 16)), 200, { "content-type": "application/xml; charset=utf-8", "content-disposition": 'attachment; filename="contix_tuning.xml"' });
    })
    .post("/tuning", requirePerm("soc:write"), zValidator("json", TuningProposalInput), async (c) => {
      const v = c.req.valid("json");
      const companyId = targetCompany(c, v.companyId);
      if (!hasPermIn(c, "soc:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      const [r] = await db
        .insert(socRuleTunings)
        .values({ companyId, ruleId: v.ruleId, ruleDescription: await ruleDescription(companyId, v.ruleId), kind: v.kind, conditions: v.conditions, newLevel: v.kind === "level" ? (v.newLevel ?? null) : null, rationale: v.rationale, createdById: currentUser(c).id })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "soc.tuning_created", entityType: "soc_rule_tuning", entityId: r!.id, details: { ruleId: v.ruleId, kind: v.kind } });
      return c.json((await dtos(c, eq(socRuleTunings.id, r!.id)))[0], 201);
    })
    /** Návrh výjimky z dat indexeru (nejčastější znak falešných poplachů bez zásahu do skutečných útoků). */
    .post("/tuning/suggest", requirePerm("soc:write"), zValidator("json", z.object({ ruleId: z.string().regex(/^\d{1,9}$/), companyId: z.string().uuid().optional(), days: z.number().int().min(7).max(365).default(30) })), async (c) => {
      const v = c.req.valid("json");
      const companyId = targetCompany(c, v.companyId);
      if (!hasPermIn(c, "soc:write", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      const s = await suggest(companyId, v.ruleId, v.days);
      const share = s.simulation.total ? Math.round((s.simulation.matched / s.simulation.total) * 100) : 0;
      const path = tuningIndexPath(s.condition);
      const rationale = `${share} % událostí pravidla ${v.ruleId} za ${v.days} dní (${s.simulation.matched} z ${s.simulation.total}) má ${path} = „${s.condition.value}“; žádná z nich nespadá do alertů označených jako skutečný útok nebo eskalovaných. Podíl falešných poplachů pravidla: ${Math.round(s.fpRate * 100)} % z ${s.decided} uzavřených alertů.`;
      const [r] = await db
        .insert(socRuleTunings)
        .values({ companyId, ruleId: v.ruleId, ruleDescription: s.description, kind: "exclude", conditions: [s.condition], rationale, source: "auto", simulation: s.simulation, createdById: currentUser(c).id })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "soc.tuning_suggested", entityType: "soc_rule_tuning", entityId: r!.id, details: { ruleId: v.ruleId, field: path, matched: s.simulation.matched, total: s.simulation.total } });
      return c.json((await dtos(c, eq(socRuleTunings.id, r!.id)))[0], 201);
    })
    .patch("/tuning/:id", requirePerm("soc:write"), zValidator("json", TuningProposalPatch), async (c) => {
      const cur = await load(c, c.req.param("id"));
      if (cur.status !== "draft") throw new HTTPException(409, { message: "Upravit lze jen návrh – rozhodnutý návrh je neměnný." });
      const v = c.req.valid("json");
      const next = TuningProposalInput.safeParse({ ruleId: cur.ruleId, kind: v.kind ?? cur.kind, conditions: v.conditions ?? cur.conditions, newLevel: v.newLevel !== undefined ? v.newLevel : cur.newLevel, rationale: v.rationale ?? cur.rationale });
      if (!next.success) throw new HTTPException(400, { message: next.error.issues[0]?.message ?? "Neplatný návrh" });
      const n = next.data;
      // změna podmínek zneplatní simulaci
      await db.update(socRuleTunings).set({ kind: n.kind, conditions: n.conditions, newLevel: n.kind === "level" ? (n.newLevel ?? null) : null, rationale: n.rationale, simulation: null, updatedAt: new Date() }).where(eq(socRuleTunings.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "soc.tuning_updated", entityType: "soc_rule_tuning", entityId: cur.id, details: { fields: Object.keys(v) } });
      return c.json((await dtos(c, eq(socRuleTunings.id, cur.id)))[0]);
    })
    .post("/tuning/:id/simulate", requirePerm("soc:write"), zValidator("json", Days), async (c) => {
      const cur = await load(c, c.req.param("id"));
      const sim = await simulate(cur.companyId, cur.ruleId, cur.conditions, c.req.valid("json").days);
      if (cur.status === "draft") await db.update(socRuleTunings).set({ simulation: sim, updatedAt: new Date() }).where(eq(socRuleTunings.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "soc.tuning_simulated", entityType: "soc_rule_tuning", entityId: cur.id, details: { matched: sim.matched, total: sim.total, protected: sim.protectedAlerts.length } });
      return c.json(cur.status === "draft" ? (await dtos(c, eq(socRuleTunings.id, cur.id)))[0] : { ...(await dtos(c, eq(socRuleTunings.id, cur.id)))[0]!, simulation: sim });
    })
    .post("/tuning/:id/decision", requirePerm("soc:respond"), zValidator("json", TuningDecisionInput), async (c) => {
      const cur = await load(c, c.req.param("id"), "soc:respond");
      if (cur.status !== "draft") throw new HTTPException(409, { message: "O návrhu už bylo rozhodnuto." });
      const v = c.req.valid("json");
      const user = currentUser(c);
      if ((await getResponseSettings(db)).fourEyes && cur.createdById === user.id) throw new HTTPException(403, { message: "Návrh musí schválit jiný člověk než navrhovatel (princip čtyř očí)." });
      if (v.decision === "approve") {
        const sim = cur.simulation;
        if (!sim || Date.now() - new Date(sim.at).getTime() > 7 * DAY) throw new HTTPException(409, { message: "Před schválením spusťte simulaci (nejvýše 7 dní stará)." });
        if (sim.protectedAlerts.length && (v.note?.trim().length ?? 0) < 10) throw new HTTPException(409, { message: "Úprava by skryla události alertů se skutečným útokem nebo eskalací – schválit lze jen s odůvodněním (aspoň 10 znaků)." });
      }
      await db.update(socRuleTunings).set({ status: v.decision === "approve" ? "approved" : "rejected", decidedById: user.id, decidedAt: new Date(), decisionNote: v.note ?? null, updatedAt: new Date() }).where(eq(socRuleTunings.id, cur.id));
      await audit(db, { c, user, action: v.decision === "approve" ? "soc.tuning_approved" : "soc.tuning_rejected", entityType: "soc_rule_tuning", entityId: cur.id, details: { ruleId: cur.ruleId, protected: cur.simulation?.protectedAlerts.length ?? null, note: v.note ?? null } });
      return c.json((await dtos(c, eq(socRuleTunings.id, cur.id)))[0]);
    })
    .delete("/tuning/:id", requirePerm("soc:write"), async (c) => {
      const cur = await load(c, c.req.param("id"));
      if (cur.status !== "draft") throw new HTTPException(409, { message: "Smazat lze jen návrh – rozhodnutý návrh zůstává jako záznam." });
      await db.delete(socRuleTunings).where(eq(socRuleTunings.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "soc.tuning_deleted", entityType: "soc_rule_tuning", entityId: cur.id, details: { ruleId: cur.ruleId } });
      return c.json({ ok: true });
    });
}
