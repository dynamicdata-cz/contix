import {
  ATTACK_ID_RE,
  SOC_OPEN_STATUSES,
  TI_FEEDS,
  TI_FEED_DEFAULTS,
  TiSettingsInput,
  iocCandidatesOf,
  isPrivateIp,
  normalizeIoc,
  parseFeed,
  tacticsFor,
  type SocIocType,
  type TiFeed,
  type TiFeedState,
  type TiMatch,
  type TiRecord,
  type TiSettingsDto,
  type TiStatusDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { decrypt, encrypt } from "../../auth/crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, appSettings, assets, assetSources, threatIntel } from "../../db/schema";
import { safeUnzip } from "../../lib/zip";
import { getAlertSettings } from "../alerts/routes";
import { getWazuhConfig } from "../connectors/config";
import type { FetchLike } from "../discovery/connectors/wazuh";
import type { Mailer, TeamsPoster } from "../notifications/service";
import { indexerCall } from "../vulnerabilities/sources";
import { loadIntegrations, mispPullRecords, pollEnrichments } from "./enrich";
import { refreshExposure } from "./exposure";
import { notifyNewAlerts } from "./response";
import { activeSuppressions, correlateAlerts, suppressGroup } from "./service";

/* ============================================================
 * Veřejné zdroje IOC (ADR-057). Jen stahování z abuse.ch / vlastních adres; porovnání s alerty a hledání
 * v alertech Wazuh Indexeru (jen čtení) běží lokálně. Shoda ve Wazuhu založí alert „Komunikace se známou hrozbou“.
 * ============================================================ */

const KEY = "soc.threatintel";
const MAX_BYTES = 200 * 1024 * 1024;
const HUNT_MAX_VALUES = 20_000;
const HUNT_FIRST_DAYS = 7;
type Deps = { db: Db; config: Config; fetchImpl?: FetchLike; mailer?: Mailer; teams?: TeamsPoster };

interface Stored extends Omit<TiSettingsDto, "hasAuthKey"> {
  authKeyEnc: string | null;
  state: Record<string, TiFeedState>;
  lastRefreshAt: string | null;
  lastHunt: TiStatusDto["lastHunt"];
}
const DEFAULTS: Stored = {
  autoRefresh: false,
  intervalHours: 6,
  hunt: true,
  feeds: Object.fromEntries(TI_FEEDS.map((f) => [f, { enabled: true, url: TI_FEED_DEFAULTS[f].url }])) as Stored["feeds"],
  custom: [],
  authKeyEnc: null,
  state: {},
  lastRefreshAt: null,
  lastHunt: null,
};

async function load(db: Db): Promise<Stored> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const v = (row?.value as Partial<Stored>) ?? {};
  return { ...DEFAULTS, ...v, feeds: { ...DEFAULTS.feeds, ...(v.feeds ?? {}) } };
}
async function save(db: Db, patch: Partial<Stored>) {
  const next = { ...(await load(db)), ...patch };
  await db
    .insert(appSettings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}
const publicOf = ({ authKeyEnc, state: _s, lastRefreshAt: _l, lastHunt: _h, ...s }: Stored): TiSettingsDto => ({ ...s, hasAuthKey: !!authKeyEnc });

/** Obsah staženého souboru – gzip i ZIP (první .csv / .txt) se rozbalí. */
export function decodeFeed(buf: Uint8Array): string {
  if (buf.length > MAX_BYTES) throw new Error("Soubor je příliš velký.");
  if (buf[0] === 0x1f && buf[1] === 0x8b) return new TextDecoder().decode(gunzipSync(buf, { maxOutputLength: MAX_BYTES }));
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const files = safeUnzip(buf, { maxBytes: MAX_BYTES, maxEntries: 20 });
    const name = Object.keys(files).find((n) => /\.(csv|txt|json)$/i.test(n)) ?? Object.keys(files)[0];
    if (!name) throw new Error("Archiv je prázdný.");
    return new TextDecoder().decode(files[name]);
  }
  return new TextDecoder().decode(buf);
}

/** Uloží záznamy zdroje – nahradí celý zdroj (co ze zdroje vypadlo, už se neporovnává). */
export async function storeFeed(db: Db, source: string, records: TiRecord[]): Promise<number> {
  const uniq = [...new Map(records.map((r) => [`${r.type}|${r.value}`, r])).values()];
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(threatIntel).where(eq(threatIntel.source, source));
    for (let i = 0; i < uniq.length; i += 2000)
      await tx.insert(threatIntel).values(
        uniq.slice(i, i + 2000).map((r) => ({ source, type: r.type, value: r.value, threat: r.threat, confidence: r.confidence, firstSeen: r.firstSeen ? new Date(r.firstSeen) : null, reference: r.reference, fetchedAt: now })),
      );
  });
  return uniq.length;
}

/** Stažení zapnutých zdrojů (chyba jednoho nebrání ostatním), pak porovnání s alerty. */
export async function refreshThreatIntel(d: Deps, only?: string) {
  const s = await load(d.db);
  const key = s.authKeyEnc ? decrypt(s.authKeyEnc, appSecret(d.config)) : null;
  const fetchImpl = d.fetchImpl ?? (fetch as FetchLike);
  const jobs: { source: string; url: string; needsKey: boolean }[] = [
    ...TI_FEEDS.filter((f) => s.feeds[f]?.enabled).map((f) => ({ source: f, url: s.feeds[f].url, needsKey: TI_FEED_DEFAULTS[f].needsKey || s.feeds[f].url.includes("{key}") })),
    ...s.custom.filter((c) => c.enabled).map((c) => ({ source: `custom:${c.id}`, url: c.url, needsKey: c.url.includes("{key}") })),
  ].filter((j) => !only || j.source === only);
  const state = { ...s.state };
  for (const j of jobs) {
    try {
      if (j.needsKey && !key) throw new Error("Chybí Auth-Key z auth.abuse.ch (SOC → Zdroje → Zdroje hrozeb).");
      const url = j.url.replace("{key}", encodeURIComponent(key ?? ""));
      const res = await fetchImpl(url, { headers: key ? { "Auth-Key": key } : {}, signal: AbortSignal.timeout(180_000) } as RequestInit);
      if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} – neplatný nebo chybějící Auth-Key`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const recs = parseFeed(j.source.startsWith("custom:") ? "custom" : j.source, decodeFeed(new Uint8Array(await res.arrayBuffer())));
      if (!recs.length) throw new Error("Zdroj neobsahuje žádné rozpoznané IOC (formát?).");
      state[j.source] = { at: new Date().toISOString(), count: await storeFeed(d.db, j.source, recs), error: null };
    } catch (e) {
      // adresu s klíčem do chyby nepsat
      state[j.source] = { at: new Date().toISOString(), count: state[j.source]?.count ?? 0, error: (e as Error).message.replaceAll(key ?? "\u0000", "***").slice(0, 300) };
    }
  }
  // MISP (ADR-073) – atributy jako další zdroj; vypnuté stahování = nic
  if (!only || only === "misp") {
    try {
      const recs = await mispPullRecords(d);
      if (recs) state.misp = { at: new Date().toISOString(), count: recs.length ? await storeFeed(d.db, "misp", recs) : 0, error: recs.length ? null : "MISP nevrátil žádné atributy (filtr, období?)." };
    } catch (e) {
      state.misp = { at: new Date().toISOString(), count: state.misp?.count ?? 0, error: (e instanceof HTTPException ? e.message : (e as Error).message).slice(0, 300) };
    }
  }
  await save(d.db, { state, lastRefreshAt: new Date().toISOString() });
  const matched = await matchAlerts(d.db);
  return { state, matched };
}

/** Ruční nahrání souboru zdroje (server bez internetu). */
export async function uploadFeed(db: Db, source: string, buf: Uint8Array) {
  const recs = parseFeed(source.startsWith("custom:") ? "custom" : source, decodeFeed(buf));
  if (!recs.length) throw new HTTPException(400, { message: "Soubor neobsahuje žádné rozpoznané IOC." });
  const s = await load(db);
  const n = await storeFeed(db, source, recs);
  await save(db, { state: { ...s.state, [source]: { at: new Date().toISOString(), count: n, error: null } } });
  return n;
}

/** Hodnoty z alertu k porovnání: zdrojová / cílová IP, odkazy, domény, odesílatel, hashe, hostitel. */
function valuesOf(a: typeof alertSuggestions.$inferSelect): { type: SocIocType; value: string }[] {
  const s = (a.sample ?? {}) as Record<string, unknown>;
  const out = iocCandidatesOf({ source: a.source, description: a.description, sample: a.sample ?? null }).map((c) => ({ type: c.type, value: c.value }));
  const ip = typeof s.dstip === "string" ? normalizeIoc("ip", s.dstip) : null;
  if (ip && !isPrivateIp(ip)) out.push({ type: "ip", value: ip });
  for (const u of out.filter((x) => x.type === "url")) {
    const h = normalizeIoc("domain", u.value.replace(/^https?:\/\//i, "").split(/[/:?#]/)[0] ?? "");
    if (h) out.push({ type: "domain", value: h });
  }
  for (const k of ["url", "hostname"]) {
    const v = typeof s[k] === "string" ? (s[k] as string) : null;
    if (!v) continue;
    const t = k === "url" ? "url" : "domain";
    const n = normalizeIoc(t, v);
    if (n) out.push({ type: t, value: n });
  }
  return out;
}

/** Porovná alerty za 14 dní se zdroji; uloží `intel` (shody) jen při změně. Vrací počet alertů se shodou. */
export async function matchAlerts(db: Db, days = 14): Promise<number> {
  const rows = await db.select().from(alertSuggestions).where(gte(alertSuggestions.lastSeen, new Date(Date.now() - days * 864e5)));
  const vals = new Map<string, { type: SocIocType; value: string }[]>();
  for (const a of rows) vals.set(a.id, valuesOf(a));
  const all = [...new Set([...vals.values()].flat().map((v) => v.value))];
  const hits = new Map<string, TiMatch[]>();
  for (let i = 0; i < all.length; i += 5000) {
    const part = all.slice(i, i + 5000);
    const r = await db.select().from(threatIntel).where(inArray(threatIntel.value, part));
    for (const x of r) hits.set(`${x.type}|${x.value}`, [...(hits.get(`${x.type}|${x.value}`) ?? []), { source: x.source, type: x.type as SocIocType, value: x.value, threat: x.threat, confidence: x.confidence }]);
  }
  let matched = 0;
  for (const a of rows) {
    const m = [...new Map((vals.get(a.id) ?? []).flatMap((v) => hits.get(`${v.type}|${v.value}`) ?? []).map((x) => [`${x.source}|${x.type}|${x.value}`, x])).values()].slice(0, 20);
    if (m.length) matched++;
    const next = m.length ? m : null;
    if (JSON.stringify(next) !== JSON.stringify(a.intel ?? null)) await db.update(alertSuggestions).set({ intel: next as unknown as Record<string, unknown>[] }).where(eq(alertSuggestions.id, a.id));
  }
  return matched;
}

const IP_FIELDS = ["data.srcip", "data.dstip", "data.src_ip", "data.dest_ip"];
const DOMAIN_FIELDS = ["data.dns.question.name", "data.hostname", "data.win.eventdata.queryName"];
const get = (o: any, p: string): unknown => p.split(".").reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);

/** Hledání IP a domén ze zdrojů v nových alertech Wazuh Indexeru (jen čtení). Shoda → alert SOC. */
export async function huntThreatIntel(d: Deps, now = new Date()) {
  const s = await load(d.db);
  const since = new Date(Math.max(s.lastHunt?.at ? new Date(s.lastHunt.at).getTime() : 0, now.getTime() - HUNT_FIRST_DAYS * 864e5));
  const result = { at: now.toISOString(), since: since.toISOString(), hits: 0, alerts: 0, error: null as string | null };
  try {
    const ti = await d.db
      .select({ type: threatIntel.type, value: threatIntel.value, source: threatIntel.source, threat: threatIntel.threat, confidence: threatIntel.confidence })
      .from(threatIntel)
      .where(inArray(threatIntel.type, ["ip", "domain"]))
      .orderBy(sql`${threatIntel.firstSeen} desc nulls last`)
      .limit(HUNT_MAX_VALUES * 2);
    if (!ti.length) return null;
    const w = await getWazuhConfig(d.db, d.config);
    if (!w.indexerUrl || !w.indexerUser || !w.indexerPassword) throw new Error("Wazuh Indexer není nastaven.");
    const al = await getAlertSettings(d.db);
    const ips = [...new Set(ti.filter((x) => x.type === "ip").map((x) => x.value))].slice(0, HUNT_MAX_VALUES);
    const domains = [...new Set(ti.filter((x) => x.type === "domain").map((x) => x.value))].slice(0, HUNT_MAX_VALUES);
    const should = [...(ips.length ? IP_FIELDS.map((f) => ({ terms: { [f]: ips } })) : []), ...(domains.length ? DOMAIN_FIELDS.map((f) => ({ terms: { [f]: domains } })) : [])];
    const res = await indexerCall(
      { url: w.indexerUrl, user: w.indexerUser, password: w.indexerPassword, verifyTls: w.indexerVerifyTls, indexPattern: al.alertsIndexPattern },
      `/${encodeURIComponent(al.alertsIndexPattern).replace(/%2A/g, "*")}/_search`,
      {
        size: 1000,
        sort: [{ timestamp: { order: "asc" } }],
        _source: ["timestamp", "agent.id", "agent.name", "rule.id", "rule.description", ...IP_FIELDS, ...DOMAIN_FIELDS],
        query: { bool: { filter: [{ range: { timestamp: { gt: since.toISOString() } } }, { bool: { should, minimum_should_match: 1 } }] } },
      },
      d.fetchImpl ?? (fetch as FetchLike),
    );
    const hits: any[] = res.hits?.hits ?? [];
    result.hits = hits.length;
    const byVal = new Map(ti.map((x) => [`${x.type}|${x.value}`, x]));
    type G = { type: SocIocType; value: string; agentId: string | null; agentName: string | null; first: Date; last: Date; n: number; rule: string; srcip: string | null; dstip: string | null; ti: (typeof ti)[number] };
    const groups = new Map<string, G>();
    for (const h of hits) {
      const a = h._source ?? {};
      const found: { type: SocIocType; value: string }[] = [];
      for (const f of IP_FIELDS) {
        const v = get(a, f);
        if (typeof v === "string" && byVal.has(`ip|${v}`)) found.push({ type: "ip", value: v });
      }
      for (const f of DOMAIN_FIELDS) {
        const v = get(a, f);
        const n = typeof v === "string" ? normalizeIoc("domain", v) : null;
        if (n && byVal.has(`domain|${n}`)) found.push({ type: "domain", value: n });
      }
      const ts = new Date(a.timestamp ?? now);
      const agentId = a.agent?.id != null ? String(a.agent.id) : null;
      for (const f of found) {
        const key = `ti:${f.type}:${f.value}:${agentId ?? "-"}`.slice(0, 200);
        const g = groups.get(key);
        if (g) {
          g.n++;
          if (ts < g.first) g.first = ts;
          if (ts > g.last) g.last = ts;
        } else
          groups.set(key, {
            ...f,
            agentId,
            agentName: a.agent?.name ? String(a.agent.name).slice(0, 255) : null,
            first: ts,
            last: ts,
            n: 1,
            rule: String(a.rule?.description ?? "").slice(0, 300),
            srcip: typeof get(a, "data.srcip") === "string" ? (get(a, "data.srcip") as string) : null,
            dstip: typeof get(a, "data.dstip") === "string" ? (get(a, "data.dstip") as string) : null,
            ti: byVal.get(`${f.type}|${f.value}`)!,
          });
      }
    }
    const suppressions = await activeSuppressions(d.db, now);
    const ids: string[] = [];
    for (const [key, g] of groups) {
      const [asset] = g.agentId
        ? await d.db
            .select({ id: assets.id, companyId: assets.companyId })
            .from(assetSources)
            .innerJoin(assets, eq(assets.id, assetSources.assetId))
            .where(and(eq(assetSources.sourceType, "wazuh"), eq(assetSources.sourceRef, g.agentId)))
        : [];
      const ruleId = `ti:${g.ti.source}`.slice(0, 50);
      if (suppressions.length && (await suppressGroup(d.db, suppressions, { companyId: asset?.companyId ?? null, ruleId, agentId: g.agentId, srcip: g.srcip, n: g.n, last: g.last }))) continue;
      const [open] = await d.db
        .select()
        .from(alertSuggestions)
        .where(and(eq(alertSuggestions.groupKey, key), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])))
        .limit(1);
      const match: TiMatch = { source: g.ti.source, type: g.type, value: g.value, threat: g.ti.threat, confidence: g.ti.confidence };
      if (open) {
        await d.db
          .update(alertSuggestions)
          .set({ count: open.count + g.n, lastSeen: g.last > open.lastSeen ? g.last : open.lastSeen, updatedAt: new Date() })
          .where(eq(alertSuggestions.id, open.id));
        ids.push(open.id);
        continue;
      }
      const mitreIds = ["T1071"].filter((m) => ATTACK_ID_RE.test(m));
      const [row] = await d.db
        .insert(alertSuggestions)
        .values({
          companyId: asset?.companyId ?? undefined,
          source: "threatintel",
          groupKey: key,
          ruleId,
          ruleLevel: 12,
          title: `Komunikace se známou hrozbou: ${g.value}${g.ti.threat ? ` (${g.ti.threat})` : ""}`.slice(0, 300),
          description: `${g.type === "ip" ? "IP adresa" : "Doména"} ${g.value} je ve veřejném zdroji ${g.ti.source}${g.ti.threat ? ` – ${g.ti.threat}` : ""}. Výskyt v alertu Wazuh: ${g.rule || "—"}.`.slice(0, 2000),
          agentId: g.agentId,
          agentName: g.agentName,
          assetId: asset?.id ?? null,
          firstSeen: g.first,
          lastSeen: g.last,
          count: g.n,
          mitreIds,
          mitreTactics: tacticsFor(mitreIds),
          intel: [match] as unknown as Record<string, unknown>[],
          sample: Object.fromEntries(Object.entries({ timestamp: g.last.toISOString(), srcip: g.srcip, dstip: g.dstip, tiValue: g.value, tiSource: g.ti.source }).filter(([, v]) => v != null)),
        })
        .returning({ id: alertSuggestions.id });
      ids.push(row!.id);
      result.alerts++;
    }
    if (ids.length) {
      await refreshExposure(d.db, ids);
      await correlateAlerts(d.db, now);
      if (result.alerts) await notifyNewAlerts(d).catch(() => {});
    }
  } catch (e) {
    result.error = (e as Error).message.slice(0, 300);
  }
  // při chybě se okno neposouvá (příště se hledá znovu od stejného okamžiku)
  await save(d.db, { lastHunt: result.error ? { ...result, at: s.lastHunt?.at ?? result.since } : result });
  return result;
}

/** Plánovač: stažení podle intervalu (je-li zapnuto), hledání ve Wazuhu při každém běhu. */
export async function processThreatIntel(d: Deps, now = new Date()) {
  const s = await load(d.db);
  if (s.autoRefresh && (!s.lastRefreshAt || now.getTime() - new Date(s.lastRefreshAt).getTime() >= s.intervalHours * 3600_000)) await refreshThreatIntel(d);
  if (s.hunt) await huntThreatIntel(d, now);
  // dokončení běžících analýz Cortexu (ADR-073)
  await pollEnrichments(d).catch(() => {});
}

export async function threatIntelStatus(db: Db): Promise<TiStatusDto> {
  const s = await load(db);
  const totals = (await db
    .select({ source: threatIntel.source, type: threatIntel.type, n: sql<number>`count(*)::int` })
    .from(threatIntel)
    .groupBy(threatIntel.source, threatIntel.type)) as TiStatusDto["totals"];
  const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(alertSuggestions).where(and(isNotNull(alertSuggestions.intel), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])));
  const integ = await loadIntegrations(db);
  return { ...publicOf(s), state: s.state, totals, lastHunt: s.lastHunt, matchedAlerts: m?.n ?? 0, mispEnabled: integ.misp.enabled && integ.misp.pull.enabled };
}

export function threatIntelRoutes(deps: Deps) {
  const { db, config } = deps;
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "soc"))
    .get("/threat-intel", requirePerm("soc:read"), async (c) => c.json(await threatIntelStatus(db)))
    .put("/threat-intel/settings", requirePerm("admin:settings"), zValidator("json", TiSettingsInput), async (c) => {
      const { authKey, ...input } = c.req.valid("json");
      const cur = await load(db);
      await save(db, { ...input, feeds: { ...cur.feeds, ...(input.feeds ?? {}) }, authKeyEnc: authKey === undefined ? cur.authKeyEnc : authKey ? encrypt(authKey, appSecret(config)) : null });
      await audit(db, { c, user: currentUser(c), action: "soc.threatintel_settings_updated", details: { ...input, authKey: authKey === undefined ? "beze změny" : authKey ? "nastaven" : "smazán" } });
      return c.json(await threatIntelStatus(db));
    })
    .post("/threat-intel/refresh", requirePerm("soc:write"), async (c) => {
      const r = await refreshThreatIntel(deps);
      const h = (await load(db)).hunt ? await huntThreatIntel(deps) : null;
      await audit(db, { c, user: currentUser(c), action: "soc.threatintel_refreshed", details: { feeds: Object.fromEntries(Object.entries(r.state).map(([k, v]) => [k, v.error ?? v.count])), matched: r.matched, huntAlerts: h?.alerts ?? null } });
      return c.json(await threatIntelStatus(db));
    })
    .post("/threat-intel/upload", requirePerm("admin:settings"), async (c) => {
      const body = await c.req.parseBody();
      const source = typeof body.source === "string" ? body.source : "";
      const s = await load(db);
      if (!(TI_FEEDS as readonly string[]).includes(source) && !s.custom.some((x) => `custom:${x.id}` === source)) throw new HTTPException(400, { message: "Neznámý zdroj." });
      const file = body.file instanceof File ? body.file : null;
      if (!file) throw new HTTPException(400, { message: "Chybí soubor." });
      const n = await uploadFeed(db, source, new Uint8Array(await file.arrayBuffer()));
      const matched = await matchAlerts(db);
      await audit(db, { c, user: currentUser(c), action: "soc.threatintel_uploaded", details: { source, count: n } });
      return c.json({ count: n, matched });
    })
    .get("/threat-intel/lookup", requirePerm("soc:read"), async (c) => {
      const v = (c.req.query("value") ?? "").trim().slice(0, 2000);
      if (!v) return c.json([]);
      const rows = await db.select().from(threatIntel).where(eq(threatIntel.value, v.toLowerCase())).limit(20);
      return c.json(rows.map((r) => ({ source: r.source, type: r.type, value: r.value, threat: r.threat, confidence: r.confidence, firstSeen: r.firstSeen?.toISOString() ?? null, reference: r.reference })));
    });
}

export type { TiFeed };
