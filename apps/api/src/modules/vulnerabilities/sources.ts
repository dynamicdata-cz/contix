import type { Severity } from "@contix/shared";
import { describeFetchError } from "../discovery/connectors/wazuh";

/**
 * Zdroje zranitelností z Wazuhu.
 *
 *  1) Wazuh 4.8+  → Wazuh Indexer (OpenSearch), index `wazuh-states-vulnerabilities-*`
 *     (stav "co je právě zranitelné"; dokument = agent × balíček × CVE).
 *  2) Wazuh ≤ 4.7 → Server API `GET /vulnerability/{agent_id}` (v 4.8 odstraněno).
 *
 * Oba zdroje se normalizují na VulnRecord. Mapování polí je tolerantní k rozdílům mezi verzemi.
 */

export interface VulnRecord {
  agentId: string;
  cveId: string;
  severity: Severity;
  cvssScore: number | null;
  packageName: string;
  packageVersion: string;
  description: string | null;
  reference: string | null;
  publishedAt: Date | null;
  detectedAt: Date | null;
}

type FetchLike = (input: string, init?: RequestInit & { tls?: { rejectUnauthorized?: boolean } }) => Promise<Response>;

export function normSeverity(v: unknown, score?: number | null): Severity {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("crit")) return "critical";
  if (s.startsWith("high") || s === "important") return "high";
  if (s.startsWith("med") || s === "moderate") return "medium";
  if (s.startsWith("low")) return "low";
  // bez textové závažnosti – odvodit z CVSS
  if (score != null && score > 0) return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low";
  return "unknown";
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const dt = (v: unknown) => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};
const str = (v: unknown, max = 4000) => (v == null || v === "" ? null : String(Array.isArray(v) ? v.join(", ") : v).slice(0, max));

/** Dokument z indexu wazuh-states-vulnerabilities → VulnRecord. */
export function fromIndexerDoc(src: any): VulnRecord | null {
  const v = src?.vulnerability ?? {};
  const pkg = src?.package ?? v.package ?? {};
  const agentId = src?.agent?.id;
  const cveId = v.id ?? v.cve;
  if (!agentId || !cveId) return null;
  const score = num(v.score?.base ?? v.cvss?.cvss3?.base_score ?? v.cvss?.cvss2?.base_score);
  return {
    agentId: String(agentId),
    cveId: String(cveId),
    cvssScore: score,
    severity: normSeverity(v.severity, score),
    packageName: String(pkg.name ?? ""),
    packageVersion: String(pkg.version ?? ""),
    description: str(v.description ?? v.title),
    reference: str(v.reference, 2000),
    publishedAt: dt(v.published_at ?? v.published),
    detectedAt: dt(v.detected_at ?? v.detection_time),
  };
}

/** Položka z Server API /vulnerability/{agent} (Wazuh ≤ 4.7) → VulnRecord. */
export function fromApiItem(agentId: string, it: any): VulnRecord | null {
  if (!it?.cve) return null;
  const score = num(it.cvss3_score ?? it.cvss2_score);
  return {
    agentId,
    cveId: String(it.cve),
    cvssScore: score,
    severity: normSeverity(it.severity, score),
    packageName: String(it.name ?? ""),
    packageVersion: String(it.version ?? ""),
    description: str(it.title),
    reference: str(it.external_references, 2000),
    publishedAt: dt(it.published),
    detectedAt: dt(it.detection_time),
  };
}

export interface IndexerParams {
  url: string;
  user: string;
  password: string;
  verifyTls: boolean;
  indexPattern: string;
}

export async function indexerCall(p: IndexerParams, path: string, body: unknown, fetchImpl: FetchLike, method = "POST") {
  const url = `${p.url.replace(/\/+$/, "")}${path}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Basic ${btoa(`${p.user}:${p.password}`)}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      tls: p.verifyTls ? undefined : { rejectUnauthorized: false },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(describeFetchError(e, url, "Wazuh Indexer"));
  }
  if (res.status === 401) throw new Error("Wazuh Indexer odmítl přihlášení – zkontrolujte uživatele a heslo indexeru (např. admin).");
  const alerts = p.indexPattern.startsWith("wazuh-alerts");
  if (res.status === 403) throw new Error(`Účet indexeru „${p.user}“ nemá právo číst index ${p.indexPattern} – doplňte ho do role (index permissions: read).`);
  if (res.status === 404) throw new Error(alerts ? `Index ${p.indexPattern} neexistuje – ukládá Wazuh alerty do indexeru?` : `Index ${p.indexPattern} neexistuje – je zapnutá detekce zranitelností (Wazuh 4.8+)?`);
  if (!res.ok) throw new Error(`Wazuh Indexer ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as any;
}

/** Počet dokumentů – pro test připojení. */
export async function testIndexer(p: IndexerParams, fetchImpl: FetchLike = fetch as FetchLike) {
  const r = await indexerCall(p, `/${encodeURIComponent(p.indexPattern).replace(/%2A/g, "*")}/_count`, undefined, fetchImpl, "GET");
  return { count: Number(r.count ?? 0) };
}

/** Streamuje všechny zranitelnosti z indexeru (scroll API, dávky po 1000). */
export async function* fetchIndexerVulns(
  p: IndexerParams,
  log: (m: string) => void,
  fetchImpl: FetchLike = fetch as FetchLike,
): AsyncGenerator<VulnRecord> {
  const index = encodeURIComponent(p.indexPattern).replace(/%2A/g, "*");
  let page = await indexerCall(
    p,
    `/${index}/_search?scroll=2m`,
    {
      size: 1000,
      _source: ["agent.id", "agent.name", "package.name", "package.version", "vulnerability"],
      query: { match_all: {} },
    },
    fetchImpl,
  );
  const total = page.hits?.total?.value ?? page.hits?.total ?? "?";
  log(`Wazuh Indexer: ${total} záznamů o zranitelnostech`);
  let scrollId: string | undefined = page._scroll_id;
  try {
    while (page.hits?.hits?.length) {
      for (const h of page.hits.hits) {
        const r = fromIndexerDoc(h._source);
        if (r) yield r;
      }
      if (!scrollId) break;
      page = await indexerCall(p, "/_search/scroll", { scroll: "2m", scroll_id: scrollId }, fetchImpl);
      scrollId = page._scroll_id ?? scrollId;
    }
  } finally {
    if (scrollId) await indexerCall(p, "/_search/scroll", { scroll_id: [scrollId] }, fetchImpl, "DELETE").catch(() => {});
  }
}

/** Wazuh ≤ 4.7: zranitelnosti přes Server API po agentech. */
export async function* fetchApiVulns(
  p: { url: string; user: string; password: string; verifyTls: boolean },
  agentIds: string[],
  log: (m: string) => void,
  fetchImpl: FetchLike = fetch as FetchLike,
): AsyncGenerator<VulnRecord> {
  const base = p.url.replace(/\/+$/, "");
  const tls = p.verifyTls ? undefined : { rejectUnauthorized: false };
  const auth = await fetchImpl(`${base}/security/user/authenticate`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${p.user}:${p.password}`)}` },
    tls,
  });
  if (!auth.ok) throw new Error(`Wazuh API autentizace selhala: HTTP ${auth.status}`);
  const token = ((await auth.json()) as any).data.token;
  for (const agentId of agentIds) {
    for (let offset = 0; ; offset += 500) {
      const res = await fetchImpl(`${base}/vulnerability/${agentId}?limit=500&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` },
        tls,
      });
      if (res.status === 404 || res.status === 405) {
        throw new Error(
          "Wazuh Server API nemá endpoint /vulnerability (Wazuh 4.8+). Vyplňte v Konektorech připojení k Wazuh Indexeru (port 9200).",
        );
      }
      if (!res.ok) {
        log(`agent ${agentId}: HTTP ${res.status}`);
        break;
      }
      const data = ((await res.json()) as any).data ?? {};
      const items: any[] = data.affected_items ?? [];
      for (const it of items) {
        const r = fromApiItem(agentId, it);
        if (r) yield r;
      }
      if (offset + items.length >= (data.total_affected_items ?? 0) || !items.length) break;
    }
  }
}
