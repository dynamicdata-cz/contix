import {
  EnrichRunInput,
  MISP_MAX_ATTRIBUTES,
  MispShareInput,
  SocIntegrationsInput,
  cortexDataType,
  cortexReach,
  defang,
  enrichGuard,
  iocState,
  mispAttributeFor,
  mispLookupTaxonomies,
  parseMispAttributes,
  taxonomiesOf,
  verdictOf,
  type CortexAnalyzer,
  type EnrichLevel,
  type EnrichOptionsDto,
  type EnrichProvider,
  type EnrichStatus,
  type EnrichTaxonomy,
  type IntegrationCheck,
  type MispShareResult,
  type SocEnrichmentDto,
  type SocIntegrationsDto,
  type SocIocType,
  type TiRecord,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decrypt, encrypt } from "../../auth/crypto";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { alertSuggestions, appSettings, socEnrichments, socIocs, users } from "../../db/schema";

/* ============================================================
 * Cortex a MISP (ADR-073).
 * – Cortex: analyzátor se spouští jen na pokyn analytika, jen z allow-listu; ven jde jen hodnota IOC, datový typ, TLP a PAP.
 * – MISP: stažení atributů do zdrojů hrozeb (`mispPullRecords`, volá `refreshThreatIntel`), dotaz na hodnotu, sdílení IOC (soc:share).
 * – Interní adresy a jména se nikdy neodesílají (`enrichGuard`). API klíče jen šifrovaně, nikdy do odpovědí, chyb ani auditu.
 * ============================================================ */

type Ctx = Context<AppEnv>;
export type FetchTls = (input: string, init?: RequestInit & { tls?: { rejectUnauthorized?: boolean } }) => Promise<Response>;
type Deps = { db: Db; config: Config; fetchImpl?: FetchTls };

const KEY = "soc.integrations";
const REPORT_MAX = 200_000;
const WAIT_SECONDS = 40;

interface Stored {
  internalDomains: string[];
  cortex: Omit<SocIntegrationsDto["cortex"], "hasApiKey"> & { apiKeyEnc: string | null };
  misp: Omit<SocIntegrationsDto["misp"], "hasApiKey"> & { apiKeyEnc: string | null };
}
const DEFAULTS: Stored = {
  internalDomains: [],
  cortex: { enabled: false, url: "", verifyTls: true, apiKeyEnc: null, tlp: 2, pap: 2, allowed: [], analyzers: [], check: null },
  misp: {
    enabled: false,
    url: "",
    verifyTls: true,
    apiKeyEnc: null,
    lookup: true,
    pull: { enabled: true, days: 30, toIdsOnly: true, publishedOnly: true, tags: [], excludeTags: [] },
    share: { enabled: false, distribution: 0, tlp: "tlp:amber", threatLevel: 2, publish: false },
    check: null,
  },
};

export async function loadIntegrations(db: Db): Promise<Stored> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const v = (row?.value as Partial<Stored>) ?? {};
  return {
    internalDomains: v.internalDomains ?? [],
    cortex: { ...DEFAULTS.cortex, ...(v.cortex ?? {}) },
    misp: { ...DEFAULTS.misp, ...(v.misp ?? {}), pull: { ...DEFAULTS.misp.pull, ...(v.misp?.pull ?? {}) }, share: { ...DEFAULTS.misp.share, ...(v.misp?.share ?? {}) } },
  };
}
async function save(db: Db, next: Stored) {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}
function publicOf(s: Stored): SocIntegrationsDto {
  const { apiKeyEnc: ck, ...cortex } = s.cortex;
  const { apiKeyEnc: mk, ...misp } = s.misp;
  return { internalDomains: s.internalDomains, cortex: { ...cortex, hasApiKey: !!ck }, misp: { ...misp, hasApiKey: !!mk } };
}

/* ---------- HTTP ---------- */

interface Conn {
  kind: "cortex" | "misp";
  url: string;
  verifyTls: boolean;
  key: string;
}
function connOf(s: Stored, kind: "cortex" | "misp", config: Config): Conn {
  const c = s[kind];
  if (!c.enabled || !c.url) throw new HTTPException(400, { message: kind === "cortex" ? "Cortex není zapnutý." : "MISP není zapnutý." });
  if (!c.apiKeyEnc) throw new HTTPException(400, { message: "Chybí API klíč." });
  return { kind, url: c.url.replace(/\/+$/, ""), verifyTls: c.verifyTls, key: decrypt(c.apiKeyEnc, appSecret(config)) };
}

/** Volání Cortexu / MISP; klíč se do chybové zprávy nikdy nedostane. */
async function call(p: Conn, path: string, init: { method?: string; body?: unknown; timeoutMs?: number }, fetchImpl: FetchTls = fetch as FetchTls): Promise<any> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (p.kind === "cortex") headers.Authorization = `Bearer ${p.key}`;
  else headers.Authorization = p.key;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const scrub = (m: string) => m.replaceAll(p.key, "***");
  let res: Response;
  try {
    res = await fetchImpl(`${p.url}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
      tls: p.verifyTls ? undefined : { rejectUnauthorized: false },
    });
  } catch (e) {
    throw new Error(scrub(`Spojení selhalo: ${(e as Error).message}`).slice(0, 300));
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = "";
    try {
      const j = JSON.parse(text);
      msg = String(j.message ?? j.errors ?? j.name ?? "");
    } catch {
      msg = text.slice(0, 150);
    }
    throw new Error(scrub(`HTTP ${res.status}${res.status === 401 || res.status === 403 ? " – neplatný API klíč nebo chybí oprávnění" : ""}${msg ? `: ${msg}` : ""}`).slice(0, 300));
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Odpověď není JSON (je adresa správná?).");
  }
}

/* ---------- Cortex ---------- */

async function cortexCheck(d: Deps, s: Stored): Promise<{ check: IntegrationCheck; analyzers: CortexAnalyzer[] }> {
  const at = new Date().toISOString();
  try {
    const conn = connOf(s, "cortex", d.config);
    const st = await call(conn, "/api/status", {}, d.fetchImpl).catch(() => null);
    const list = await call(conn, "/api/analyzer?range=all", {}, d.fetchImpl);
    if (!Array.isArray(list)) throw new Error("Neočekávaná odpověď – seznam analyzátorů.");
    const analyzers: CortexAnalyzer[] = list.slice(0, 500).map((a: Record<string, any>) => ({
      id: String(a.id ?? a._id ?? a.name).slice(0, 200),
      name: String(a.name ?? a.id ?? "").slice(0, 200),
      dataTypes: (Array.isArray(a.dataTypeList) ? a.dataTypeList : []).map(String).slice(0, 20),
      description: String(a.description ?? "").slice(0, 300),
      reach: cortexReach(String(a.name ?? a.id ?? "")),
    }));
    return { check: { at, ok: true, error: null, version: st?.versions?.Cortex ? String(st.versions.Cortex).slice(0, 40) : null }, analyzers };
  } catch (e) {
    return { check: { at, ok: false, error: e instanceof HTTPException ? e.message : (e as Error).message.slice(0, 300), version: null }, analyzers: s.cortex.analyzers };
  }
}

const trimReport = (full: unknown) => {
  const j = JSON.stringify(full ?? null);
  return j.length > REPORT_MAX ? { truncated: true, size: j.length } : (full ?? null);
};
type Row = typeof socEnrichments.$inferSelect;

/** Promítne stav úlohy Cortexu do záznamu (Success / Failure; jinak dál probíhá). */
async function applyJob(db: Db, row: Row, job: any): Promise<Row> {
  const st = String(job?.status ?? "");
  if (st === "Success") {
    const tax = taxonomiesOf(job.report);
    const [r] = await db
      .update(socEnrichments)
      .set({ status: "done", taxonomies: tax as unknown as Record<string, unknown>[], verdict: verdictOf(tax), report: trimReport(job.report?.full), finishedAt: new Date() })
      .where(eq(socEnrichments.id, row.id))
      .returning();
    return r!;
  }
  if (st === "Failure" || st === "Deleted") {
    const [r] = await db
      .update(socEnrichments)
      .set({ status: "failed", error: String(job.report?.errorMessage ?? job.errorMessage ?? "Analyzátor skončil chybou.").slice(0, 1000), finishedAt: new Date() })
      .where(eq(socEnrichments.id, row.id))
      .returning();
    return r!;
  }
  return row;
}
async function fail(db: Db, row: Row, msg: string): Promise<Row> {
  const [r] = await db.update(socEnrichments).set({ status: "failed", error: msg.slice(0, 1000), finishedAt: new Date() }).where(eq(socEnrichments.id, row.id)).returning();
  return r!;
}

async function runCortex(d: Deps, s: Stored, row: Row, dataType: string, analyzerId: string): Promise<Row> {
  try {
    const conn = connOf(s, "cortex", d.config);
    // ven jde jen hodnota, datový typ, TLP / PAP a neutrální popis (žádná jména, poznámky ani kontext alertu)
    const job = await call(conn, `/api/analyzer/${encodeURIComponent(analyzerId)}/run`, { body: { data: row.value, dataType, tlp: s.cortex.tlp, pap: s.cortex.pap, message: "CONTIX", parameters: {} } }, d.fetchImpl);
    const jobId = String(job?.id ?? job?._id ?? "");
    if (!jobId) throw new Error("Cortex nevrátil ID úlohy.");
    const [r] = await d.db.update(socEnrichments).set({ jobId: jobId.slice(0, 100) }).where(eq(socEnrichments.id, row.id)).returning();
    const done = await call(conn, `/api/job/${encodeURIComponent(jobId)}/waitreport?atMost=${WAIT_SECONDS}second`, { timeoutMs: (WAIT_SECONDS + 15) * 1000 }, d.fetchImpl).catch(() => null);
    return done ? await applyJob(d.db, r!, done) : r!;
  } catch (e) {
    return fail(d.db, row, e instanceof HTTPException ? e.message : (e as Error).message);
  }
}

/** Dokončení běžících úloh Cortexu (plánovač, tlačítko „Obnovit“); po 24 h bez výsledku = chyba. */
export async function pollEnrichments(d: Deps, only?: Row[]): Promise<number> {
  const rows = only ?? (await d.db.select().from(socEnrichments).where(and(eq(socEnrichments.status, "running"), eq(socEnrichments.provider, "cortex"), isNotNull(socEnrichments.jobId), lt(socEnrichments.createdAt, new Date(Date.now() - 10_000)))).limit(50));
  if (!rows.length) return 0;
  const s = await loadIntegrations(d.db);
  let n = 0;
  for (const row of rows) {
    if (Date.now() - row.createdAt.getTime() > 864e5) {
      await fail(d.db, row, "Cortex nevrátil výsledek do 24 hodin.");
      continue;
    }
    try {
      const conn = connOf(s, "cortex", d.config);
      const job = await call(conn, `/api/job/${encodeURIComponent(row.jobId!)}/waitreport?atMost=1second`, {}, d.fetchImpl);
      if ((await applyJob(d.db, row, job)).status !== "running") n++;
    } catch {
      // Cortex nedostupný – zkusí se příště
    }
  }
  return n;
}

/* ---------- MISP ---------- */

async function mispCheck(d: Deps, s: Stored): Promise<IntegrationCheck> {
  const at = new Date().toISOString();
  try {
    const v = await call(connOf(s, "misp", d.config), "/servers/getVersion", {}, d.fetchImpl);
    return { at, ok: true, error: null, version: v?.version ? String(v.version).slice(0, 40) : null };
  } catch (e) {
    return { at, ok: false, error: e instanceof HTTPException ? e.message : (e as Error).message.slice(0, 300), version: null };
  }
}

const PULL_TYPES = ["ip-src", "ip-dst", "ip-src|port", "ip-dst|port", "domain", "hostname", "domain|ip", "url", "md5", "sha1", "sha256", "filename|md5", "filename|sha1", "filename|sha256", "email-src", "email-dst"];

/** Atributy z MISP pro zdroje hrozeb; null = stahování vypnuto. Chyba se propaguje (zapíše se do stavu zdroje). */
export async function mispPullRecords(d: Deps): Promise<TiRecord[] | null> {
  const s = await loadIntegrations(d.db);
  if (!s.misp.enabled || !s.misp.pull.enabled || !s.misp.url) return null;
  const conn = connOf(s, "misp", d.config);
  const p = s.misp.pull;
  const tags = [...p.tags, ...p.excludeTags.map((t) => `!${t}`)];
  const json = await call(
    conn,
    "/attributes/restSearch",
    {
      body: {
        returnFormat: "json",
        type: PULL_TYPES,
        last: `${p.days}d`,
        limit: MISP_MAX_ATTRIBUTES,
        page: 1,
        enforceWarninglist: true,
        ...(p.toIdsOnly ? { to_ids: 1 } : {}),
        ...(p.publishedOnly ? { published: 1 } : {}),
        ...(tags.length ? { tags } : {}),
      },
      timeoutMs: 180_000,
    },
    d.fetchImpl,
  );
  return parseMispAttributes(json, conn.url);
}

async function runMispLookup(d: Deps, s: Stored, row: Row): Promise<Row> {
  try {
    const conn = connOf(s, "misp", d.config);
    const json = await call(conn, "/attributes/restSearch", { body: { returnFormat: "json", value: row.value, limit: 50, page: 1 } }, d.fetchImpl);
    const tax = mispLookupTaxonomies(json);
    const events = [...new Set(((json?.response?.Attribute ?? []) as any[]).map((a) => String(a.event_id ?? "")).filter(Boolean))].slice(0, 20);
    const [r] = await d.db
      .update(socEnrichments)
      .set({ status: "done", taxonomies: tax as unknown as Record<string, unknown>[], verdict: verdictOf(tax), report: { events: events.map((id) => ({ id, url: `${conn.url}/events/view/${encodeURIComponent(id)}` })) }, finishedAt: new Date() })
      .where(eq(socEnrichments.id, row.id))
      .returning();
    return r!;
  } catch (e) {
    return fail(d.db, row, e instanceof HTTPException ? e.message : (e as Error).message);
  }
}

/* ---------- DTO ---------- */

async function dtos(db: Db, where: SQL | undefined, withReport = false): Promise<SocEnrichmentDto[]> {
  const rows = await db.select({ e: socEnrichments, by: users.displayName }).from(socEnrichments).leftJoin(users, eq(users.id, socEnrichments.createdById)).where(where).orderBy(desc(socEnrichments.createdAt)).limit(200);
  return rows.map(({ e, by }) => ({
    id: e.id,
    provider: e.provider as EnrichProvider,
    analyzer: e.analyzer,
    type: e.type as SocIocType,
    value: e.value,
    display: defang(e.type as SocIocType, e.value),
    status: e.status as EnrichStatus,
    verdict: (e.verdict as EnrichLevel | null) ?? null,
    taxonomies: (e.taxonomies as unknown as EnrichTaxonomy[]) ?? [],
    report: withReport || e.provider === "misp" ? (e.report ?? null) : null,
    error: e.error,
    alertId: e.alertId,
    iocId: e.iocId,
    createdByName: by,
    createdAt: e.createdAt.toISOString(),
    finishedAt: e.finishedAt?.toISOString() ?? null,
  }));
}

/* ---------- routy ---------- */

export function enrichRoutes(deps: Deps) {
  const { db, config } = deps;
  const ids = (c: Ctx, perm: "soc:read" | "soc:write" | "soc:share" = "soc:read") => scopeOf(c).ids.filter((id) => hasPermIn(c, perm, id));
  const forbid = () => new HTTPException(403, { message: "Nedostatečná oprávnění" });

  /** Společnost záznamu obohacení: podle alertu / IOC, jinak cílová společnost. */
  async function companyFor(c: Ctx, alertId?: string, iocId?: string): Promise<string> {
    if (iocId) {
      const [i] = await db.select({ companyId: socIocs.companyId }).from(socIocs).where(eq(socIocs.id, iocId));
      assertScope(c, i?.companyId, "IOC nenalezen");
      if (!hasPermIn(c, "soc:write", i!.companyId)) throw forbid();
      return i!.companyId;
    }
    if (alertId) {
      const [a] = await db.select({ companyId: alertSuggestions.companyId }).from(alertSuggestions).where(eq(alertSuggestions.id, alertId));
      assertScope(c, a?.companyId, "Alert nenalezen");
      if (!hasPermIn(c, "soc:write", a!.companyId)) throw forbid();
      return a!.companyId;
    }
    return targetCompany(c, undefined, "soc:write");
  }

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "soc"))
    .get("/integrations", requirePerm("admin:settings"), async (c) => c.json(publicOf(await loadIntegrations(db))))
    .put("/integrations", requirePerm("admin:settings"), zValidator("json", SocIntegrationsInput), async (c) => {
      const input = c.req.valid("json");
      const cur = await loadIntegrations(db);
      const secret = appSecret(config);
      const keyOf = (v: string | undefined, enc: string | null) => (v === undefined ? enc : v ? encrypt(v, secret) : null);
      const { apiKey: ck, ...cortex } = input.cortex ?? {};
      const { apiKey: mk, ...misp } = input.misp ?? {};
      const next = await save(db, {
        internalDomains: input.internalDomains ?? cur.internalDomains,
        cortex: { ...cur.cortex, ...cortex, apiKeyEnc: keyOf(ck, cur.cortex.apiKeyEnc) },
        misp: { ...cur.misp, ...misp, pull: misp.pull ?? cur.misp.pull, share: misp.share ?? cur.misp.share, apiKeyEnc: keyOf(mk, cur.misp.apiKeyEnc) },
      });
      const keyNote = (v: string | undefined) => (v === undefined ? "beze změny" : v ? "nastaven" : "smazán");
      await audit(db, { c, user: currentUser(c), action: "soc.integrations_updated", details: { internalDomains: input.internalDomains, cortex: input.cortex ? { ...cortex, apiKey: keyNote(ck) } : undefined, misp: input.misp ? { ...misp, apiKey: keyNote(mk) } : undefined } });
      return c.json(publicOf(next));
    })
    .post("/integrations/:kind/test", requirePerm("admin:settings"), async (c) => {
      const kind = c.req.param("kind");
      if (kind !== "cortex" && kind !== "misp") throw new HTTPException(404, { message: "Nenalezeno" });
      const s = await loadIntegrations(db);
      if (kind === "cortex") {
        const r = await cortexCheck(deps, s);
        // povolené analyzátory, které v Cortexu už nejsou, zůstanou v allow-listu (mohou být dočasně vypnuté)
        s.cortex = { ...s.cortex, check: r.check, analyzers: r.analyzers };
      } else s.misp = { ...s.misp, check: await mispCheck(deps, s) };
      await save(db, s);
      await audit(db, { c, user: currentUser(c), action: "soc.integration_tested", details: { kind, ok: s[kind].check?.ok, error: s[kind].check?.error } });
      return c.json(publicOf(s));
    })
    .get("/enrich/options", requirePerm("soc:read"), async (c) => {
      const s = await loadIntegrations(db);
      const ready = (k: "cortex" | "misp") => s[k].enabled && !!s[k].url && !!s[k].apiKeyEnc;
      const out: EnrichOptionsDto = {
        cortex: ready("cortex") ? s.cortex.analyzers.filter((a) => s.cortex.allowed.includes(a.id)).map(({ id, name, dataTypes, reach }) => ({ id, name, dataTypes, reach })) : [],
        mispLookup: ready("misp") && s.misp.lookup,
        mispShare: ready("misp") && s.misp.share.enabled,
      };
      return c.json(out);
    })
    .get("/enrichments", requirePerm("soc:read"), zValidator("query", z.object({ alertId: z.string().uuid().optional(), iocId: z.string().uuid().optional(), value: z.string().trim().max(2000).optional() })), async (c) => {
      const q = c.req.valid("query");
      const l = ids(c);
      if (!l.length || (!q.alertId && !q.iocId && !q.value)) return c.json([]);
      return c.json(await dtos(db, and(inArray(socEnrichments.companyId, l), q.alertId ? eq(socEnrichments.alertId, q.alertId) : undefined, q.iocId ? eq(socEnrichments.iocId, q.iocId) : undefined, q.value ? eq(socEnrichments.value, q.value) : undefined)));
    })
    .get("/enrichments/:id", requirePerm("soc:read"), async (c) => {
      const [r] = await dtos(db, and(eq(socEnrichments.id, c.req.param("id")), inArray(socEnrichments.companyId, ids(c).length ? ids(c) : ["00000000-0000-0000-0000-000000000000"])), true);
      if (!r) throw new HTTPException(404, { message: "Záznam nenalezen" });
      return c.json(r);
    })
    .post("/enrichments", requirePerm("soc:write"), zValidator("json", EnrichRunInput), async (c) => {
      const input = c.req.valid("json");
      const s = await loadIntegrations(db);
      const companyId = await companyFor(c, input.alertId, input.iocId);
      const g = enrichGuard(input.type, input.value, s.internalDomains);
      if ("reason" in g) throw new HTTPException(400, { message: g.reason === "invalid" ? "Neplatná hodnota." : "Interní adresy a jména se mimo CONTIX neodesílají." });
      let dataType = "";
      let analyzer = "misp";
      if (input.provider === "cortex") {
        const a = s.cortex.analyzers.find((x) => x.id === input.analyzerId);
        if (!a || !s.cortex.allowed.includes(a.id)) throw new HTTPException(400, { message: "Analyzátor není povolený." });
        const dt = cortexDataType(input.type, a.dataTypes);
        if (!dt) throw new HTTPException(400, { message: "Analyzátor tento typ hodnoty nepodporuje." });
        dataType = dt;
        analyzer = a.name;
      } else if (!s.misp.lookup) throw new HTTPException(400, { message: "Dotazy do MISP jsou vypnuté." });
      const [row] = await db
        .insert(socEnrichments)
        .values({ companyId, provider: input.provider, analyzer, type: input.type, value: g.value, alertId: input.alertId ?? null, iocId: input.iocId ?? null, createdById: currentUser(c).id })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "soc.enrichment_run", entityType: "soc_enrichment", entityId: row!.id, details: { provider: input.provider, analyzer, type: input.type, value: g.value, alertId: input.alertId, iocId: input.iocId } });
      const done = input.provider === "cortex" ? await runCortex(deps, s, row!, dataType, input.analyzerId!) : await runMispLookup(deps, s, row!);
      return c.json((await dtos(db, eq(socEnrichments.id, done.id), true))[0]!, 201);
    })
    .post("/enrichments/:id/refresh", requirePerm("soc:write"), async (c) => {
      const [row] = await db.select().from(socEnrichments).where(eq(socEnrichments.id, c.req.param("id")));
      assertScope(c, row?.companyId, "Záznam nenalezen");
      if (!hasPermIn(c, "soc:write", row!.companyId)) throw forbid();
      if (row!.status === "running" && row!.jobId) await pollEnrichments(deps, [row!]);
      return c.json((await dtos(db, eq(socEnrichments.id, row!.id), true))[0]!);
    })
    .post("/iocs/misp-share", requirePerm("soc:share"), zValidator("json", MispShareInput), async (c) => {
      const input = c.req.valid("json");
      const s = await loadIntegrations(db);
      if (!s.misp.share.enabled) throw new HTTPException(400, { message: "Sdílení do MISP je vypnuté." });
      const conn = connOf(s, "misp", config);
      const allowedCompanies = ids(c, "soc:share");
      const rows = await db.select().from(socIocs).where(and(inArray(socIocs.id, input.iocIds), allowedCompanies.length ? inArray(socIocs.companyId, allowedCompanies) : sql`false`));
      if (!rows.length) throw new HTTPException(404, { message: "IOC nenalezen" });
      const skipped: MispShareResult["skipped"] = [];
      const attrs: { type: string; category: string; value: string; to_ids: boolean; comment: string }[] = [];
      const shared: string[] = [];
      for (const r of rows) {
        if (iocState({ revokedAt: r.revokedAt, validUntil: r.validUntil }) !== "active") {
          skipped.push({ value: defang(r.type as SocIocType, r.value), reason: "revoked" });
          continue;
        }
        const g = enrichGuard(r.type as SocIocType, r.value, s.internalDomains);
        if ("reason" in g) {
          skipped.push({ value: defang(r.type as SocIocType, r.value), reason: g.reason });
          continue;
        }
        // poznámka analytika se nesdílí (může obsahovat interní údaje)
        attrs.push({ ...mispAttributeFor(r.type as SocIocType, g.value), to_ids: r.action === "block", comment: "CONTIX" });
        shared.push(r.id);
      }
      if (!attrs.length) throw new HTTPException(400, { message: "Žádný z vybraných IOC nelze sdílet." });
      const distribution = input.distribution ?? s.misp.share.distribution;
      const tlp = input.tlp ?? s.misp.share.tlp;
      let eventId = "";
      try {
        const res = await call(conn, "/events/add", { body: { Event: { info: input.info, distribution, threat_level_id: s.misp.share.threatLevel, analysis: 0, published: false, Tag: [{ name: tlp }], Attribute: attrs } } }, deps.fetchImpl);
        eventId = String(res?.Event?.id ?? "");
        if (!eventId) throw new Error("MISP nevrátil ID události.");
        if (s.misp.share.publish) await call(conn, `/events/publish/${encodeURIComponent(eventId)}`, { method: "POST", body: {} }, deps.fetchImpl);
      } catch (e) {
        await audit(db, { c, user: currentUser(c), action: "soc.misp_share_failed", details: { count: attrs.length, error: (e as Error).message } });
        throw new HTTPException(502, { message: `MISP: ${(e as Error).message}` });
      }
      await db.update(socIocs).set({ mispEventId: eventId.slice(0, 60), mispSharedAt: new Date(), updatedAt: new Date() }).where(inArray(socIocs.id, shared));
      await audit(db, { c, user: currentUser(c), action: "soc.misp_shared", details: { eventId, info: input.info, distribution, tlp, published: s.misp.share.publish, iocIds: shared, values: attrs.map((a) => a.value) } });
      const out: MispShareResult = { eventId, eventUrl: `${conn.url}/events/view/${encodeURIComponent(eventId)}`, shared: shared.length, skipped };
      return c.json(out);
    });
}
