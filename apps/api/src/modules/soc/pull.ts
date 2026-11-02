import { SOC_PULL_FIRST_HOURS, SOC_PULL_PRESETS, SocPullInput, type SocPullConfig, type SocPullDto, type SocSeverity, type SocSourcePreset } from "@contix/shared";
import { eq } from "drizzle-orm";
import { decrypt } from "../../auth/crypto";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { socSources } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import type { Mailer, TeamsPoster } from "../notifications/service";
import { ingestEvents, normalizeEvents } from "./ingest";
import { notifyNewAlerts } from "./response";

/* ============================================================
 * Stahování alertů ze SIEM (ADR-062): Microsoft Sentinel (incidenty přes Azure Resource Manager,
 * přihlášení aplikace client credentials, role Microsoft Sentinel Reader) a Elastic Security
 * (detekční alerty z indexu .alerts-security.*, API klíč nebo uživatel s právem čtení).
 * Jen čtení; normalizace a zápis stejně jako u webhooku (`normalizeEvents` / `ingestEvents`).
 * Kurzor = čas posledního staženého záznamu; při chybě se neposouvá.
 * ============================================================ */

type Deps = { db: Db; config: Config; fetchImpl?: FetchLike; mailer?: Mailer; teams?: TeamsPoster };
type Row = typeof socSources.$inferSelect;
type Obj = Record<string, unknown>;
const MAX_PAGES = 10;

export function pullConfigOf(r: Row): SocPullConfig | null {
  if (!r.pullConfig || !(SOC_PULL_PRESETS as readonly string[]).includes(r.preset)) return null;
  const p = SocPullInput.safeParse(r.pullConfig);
  return p.success ? p.data : null;
}

export function pullDto(r: Row): SocPullDto | null {
  const config = pullConfigOf(r);
  if (!config) return null;
  return {
    config,
    hasSecret: !!r.secretEnc,
    lastPullAt: r.lastPullAt?.toISOString() ?? null,
    cursor: r.pullCursor?.toISOString() ?? null,
    lastResult: (r.lastPull as SocPullDto["lastResult"]) ?? null,
  };
}

function netError(e: unknown, url: string, what: string) {
  const err = e as { code?: string; name?: string; message?: string };
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  const msg = `${err.code ?? err.name ?? ""} ${err.message ?? String(e)}`;
  if (/certificate|self.signed|UNABLE_TO_VERIFY|CERT_/i.test(msg)) return `${what}: TLS certifikát serveru ${host} nelze ověřit.`;
  if (/timeout|timed out/i.test(msg)) return `${what}: vypršel časový limit spojení s ${host}.`;
  return `${what}: nelze se spojit s ${host} (${msg.trim().slice(0, 150)}).`;
}

async function call(fetchImpl: FetchLike, url: string, init: RequestInit & { tls?: { rejectUnauthorized?: boolean } }, what: string): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new Error(netError(e, url, what));
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${what} odmítl přístup (HTTP ${res.status}) – zkontrolujte přihlašovací údaje a oprávnění ke čtení.`);
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Microsoft Sentinel – incidenty změněné od kurzoru (vzestupně), stránkování přes nextLink. */
async function pullSentinel(cfg: NonNullable<SocPullConfig["sentinel"]>, secret: string, since: Date, fetchImpl: FetchLike): Promise<Obj[]> {
  const tok = await call(
    fetchImpl,
    `${cfg.authorityUrl.replace(/\/+$/, "")}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: secret, scope: `${cfg.managementUrl.replace(/\/+$/, "")}/.default` }).toString(),
    },
    "Microsoft Entra ID",
  );
  if (!tok?.access_token) throw new Error("Microsoft Entra ID nevrátil přístupový token.");
  const base = `${cfg.managementUrl.replace(/\/+$/, "")}/subscriptions/${encodeURIComponent(cfg.subscriptionId)}/resourceGroups/${encodeURIComponent(cfg.resourceGroup)}/providers/Microsoft.OperationalInsights/workspaces/${encodeURIComponent(cfg.workspace)}/providers/Microsoft.SecurityInsights/incidents`;
  const q = new URLSearchParams({ "api-version": "2024-03-01", $filter: `properties/lastModifiedTimeUtc gt ${since.toISOString()}`, $orderby: "properties/lastModifiedTimeUtc asc", $top: "200" });
  let url: string | null = `${base}?${q.toString()}`;
  const out: Obj[] = [];
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const page: any = await call(fetchImpl, url, { headers: { Authorization: `Bearer ${tok.access_token}` } }, "Microsoft Sentinel");
    out.push(...((page?.value ?? []) as Obj[]));
    // stránkovat jen v rámci stejné služby (nextLink nesmí vést jinam)
    url = typeof page?.nextLink === "string" && page.nextLink.startsWith(cfg.managementUrl.replace(/\/+$/, "")) ? page.nextLink : null;
  }
  return out;
}

/** Elastic Security – alerty novější než kurzor (vzestupně podle @timestamp, search_after). */
async function pullElastic(cfg: NonNullable<SocPullConfig["elastic"]>, secret: string, since: Date, fetchImpl: FetchLike): Promise<Obj[]> {
  const auth = cfg.authType === "apikey" ? `ApiKey ${secret}` : `Basic ${btoa(`${cfg.username}:${secret}`)}`;
  const url = `${cfg.url.replace(/\/+$/, "")}/${cfg.index.split(",").map(encodeURIComponent).join(",").replace(/%2A/g, "*")}/_search`;
  const out: Obj[] = [];
  let after: unknown[] | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const body = {
      size: 500,
      sort: [{ "@timestamp": "asc" }, { _id: "asc" }],
      ...(after ? { search_after: after } : {}),
      query: { bool: { filter: [{ range: { "@timestamp": { gt: since.toISOString() } } }, ...(cfg.openOnly ? [{ term: { "kibana.alert.workflow_status": "open" } }] : [])] } },
    };
    const res: any = await call(
      fetchImpl,
      url,
      { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body), tls: cfg.verifyTls ? undefined : { rejectUnauthorized: false } },
      "Elasticsearch",
    );
    const hits: Obj[] = res?.hits?.hits ?? [];
    out.push(...hits);
    if (hits.length < 500) break;
    after = (hits.at(-1) as { sort?: unknown[] }).sort;
    if (!after) break;
  }
  return out;
}

const tsOf = (preset: string, o: Obj): Date | null => {
  const v =
    preset === "sentinel"
      ? ((o.properties as Obj | undefined)?.lastModifiedTimeUtc ?? (o.properties as Obj | undefined)?.createdTimeUtc)
      : ((o._source as Obj | undefined)?.["@timestamp"] ?? o["@timestamp"]);
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** Jedno stažení ze zdroje. */
export async function pullSource(d: Deps, src: Row, now = new Date()) {
  const cfg = pullConfigOf(src);
  const result = { at: now.toISOString(), fetched: 0, created: 0, updated: 0, error: null as string | null };
  if (!cfg) return { ...result, error: "Zdroj nemá nastavené stahování." };
  const since = src.pullCursor ?? new Date(now.getTime() - SOC_PULL_FIRST_HOURS * 3600_000);
  let cursor = src.pullCursor;
  try {
    if (!src.secretEnc) throw new Error("Chybí tajemství pro přihlášení ke zdroji.");
    const secret = decrypt(src.secretEnc, appSecret(d.config));
    const fetchImpl = d.fetchImpl ?? (fetch as FetchLike);
    let items: Obj[];
    if (src.preset === "sentinel") {
      if (!cfg.sentinel) throw new Error("Chybí nastavení Microsoft Sentinel.");
      items = await pullSentinel(cfg.sentinel, secret, since, fetchImpl);
    } else {
      if (!cfg.elastic) throw new Error("Chybí nastavení Elasticsearch.");
      items = await pullElastic(cfg.elastic, secret, since, fetchImpl);
    }
    result.fetched = items.length;
    for (const o of items) {
      const t = tsOf(src.preset, o);
      if (t && (!cursor || t > cursor)) cursor = t;
    }
    const norm = normalizeEvents(src.preset as SocSourcePreset, items, src.defaultSeverity as SocSeverity, now);
    if (norm.length) {
      const r = await ingestEvents(d.db, src, norm, items.length - norm.length, now);
      result.created = r.created;
      result.updated = r.updated;
      if (r.created) void notifyNewAlerts(d).catch(() => {});
    }
  } catch (e) {
    result.error = (e as Error).message.slice(0, 500);
  }
  await d.db
    .update(socSources)
    .set({ lastPullAt: now, lastPull: result, ...(result.error ? { lastError: result.error } : { pullCursor: cursor ?? since, lastError: null }), updatedAt: new Date() })
    .where(eq(socSources.id, src.id));
  return result;
}

/** Plánovač: zdroje se zapnutým stahováním, kterým uplynul interval. */
export async function processPullSources(d: Deps, now = new Date()): Promise<number> {
  const rows = await d.db.select().from(socSources).where(eq(socSources.enabled, true));
  let n = 0;
  for (const r of rows) {
    const cfg = pullConfigOf(r);
    if (!cfg?.enabled) continue;
    if (r.lastPullAt && now.getTime() - r.lastPullAt.getTime() < cfg.intervalMinutes * 60_000) continue;
    await pullSource(d, r, now);
    n++;
  }
  return n;
}
