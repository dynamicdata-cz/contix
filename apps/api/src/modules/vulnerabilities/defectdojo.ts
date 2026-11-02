import { DefectDojoSettingsInput, cvesIn, cweOf, severityFromText, type DefectDojoStatusDto, type ScanFinding, type VulnScanStats } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { decrypt, encrypt } from "../../auth/crypto";
import { assertScope } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { appSettings } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { recomputeHealth } from "./service";
import { commitScan, planScan } from "./scans";

/* ============================================================
 * Konektor DefectDojo (ADR-097): jen čtení aktivních nálezů přes API v2 (`/api/v2/findings/?active=true`).
 * Nález DefectDojo = nález CONTIXu se skenerem „defectdojo“ a klíčem podle ID nálezu; hostitel z endpointu,
 * bez endpointu volitelně aktivum podle názvu produktu. Reimport s uzavřením: co v DefectDojo přestalo být aktivní,
 * je v CONTIXu vyřešené. Klíč šifrovaně, nikdy do odpovědí, chyb ani auditu. Do DefectDojo se nic nezapisuje.
 * ============================================================ */

const KEY = "vuln.defectdojo";
interface Stored {
  enabled: boolean;
  url: string;
  apiKeyEnc: string | null;
  companyId: string | null;
  intervalHours: number;
  verifiedOnly: boolean;
  productAsAsset: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  lastStats: VulnScanStats | null;
  lastScanId: string | null;
}
const DEFAULTS: Stored = { enabled: false, url: "", apiKeyEnc: null, companyId: null, intervalHours: 24, verifiedOnly: false, productAsAsset: true, lastSyncAt: null, lastError: null, lastStats: null, lastScanId: null };
const MAX_PAGES = 400;

async function load(db: Db): Promise<Stored> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return { ...DEFAULTS, ...((r?.value as Partial<Stored>) ?? {}) };
}
async function store(db: Db, patch: Partial<Stored>) {
  const v = { ...(await load(db)), ...patch };
  await db.insert(appSettings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
  return v;
}
const dto = (s: Stored): DefectDojoStatusDto => ({
  enabled: s.enabled,
  url: s.url,
  hasKey: !!s.apiKeyEnc,
  companyId: s.companyId,
  intervalHours: s.intervalHours,
  verifiedOnly: s.verifiedOnly,
  productAsAsset: s.productAsAsset,
  lastSyncAt: s.lastSyncAt,
  lastError: s.lastError,
  lastStats: s.lastStats,
  lastScanId: s.lastScanId,
});

interface DdEndpoint {
  host?: string | null;
  port?: number | null;
  path?: string | null;
  protocol?: string | null;
}
interface DdFinding {
  id: number;
  title?: string;
  severity?: string;
  cwe?: number | null;
  cvssv3_score?: number | null;
  vulnerability_ids?: { vulnerability_id?: string }[];
  cve?: string | null;
  component_name?: string | null;
  component_version?: string | null;
  description?: string | null;
  mitigation?: string | null;
  references?: string | null;
  file_path?: string | null;
  endpoints?: (number | DdEndpoint)[];
  test?: number | { engagement?: number | { product?: number | { name?: string } } };
  related_fields?: { test?: { engagement?: { product?: { name?: string } } } };
}

/** Převod nálezu DefectDojo (s předanými endpointy a produktem) na `ScanFinding` – čistá funkce. */
export function ddToFindings(f: DdFinding, endpoints: Map<number, DdEndpoint>, productName: string | null): ScanFinding[] {
  const s = severityFromText(f.severity);
  const eps = (f.endpoints ?? []).map((e) => (typeof e === "number" ? endpoints.get(e) : e)).filter((e): e is DdEndpoint => !!e && !!e.host);
  const common = {
    ip: null,
    ruleId: `DD-${f.id}`,
    cves: cvesIn((f.vulnerability_ids ?? []).map((v) => v.vulnerability_id), f.cve),
    title: String(f.title ?? `DefectDojo #${f.id}`).slice(0, 500),
    severity: s.severity,
    info: s.info,
    cvss: typeof f.cvssv3_score === "number" ? f.cvssv3_score : null,
    cwe: cweOf(f.cwe ?? null),
    packageName: String(f.component_name ?? "").slice(0, 500),
    packageVersion: String(f.component_version ?? "").slice(0, 255),
    fixedVersion: null,
    description: f.description ? String(f.description).slice(0, 20_000) : null,
    remediation: f.mitigation ? String(f.mitigation).slice(0, 20_000) : null,
    reference: f.references ? String(f.references).split(/\s+/)[0]!.slice(0, 1000) : null,
  };
  if (!eps.length) return [{ ...common, host: productName ?? "", endpoint: String(f.file_path ?? "").slice(0, 500) }];
  return eps.map((e) => ({ ...common, host: String(e.host), endpoint: [e.port ? String(e.port) : "", e.path ?? ""].filter(Boolean).join(" ").slice(0, 500) }));
}

async function ddFetch(fetchImpl: FetchLike, url: string, key: string) {
  const res = await fetchImpl(url, { headers: { authorization: `Token ${key}`, accept: "application/json" }, signal: AbortSignal.timeout(60_000) } as RequestInit).catch((e: Error) => {
    throw new Error(`DefectDojo není dostupný (${e.message}).`);
  });
  if (res.status === 401 || res.status === 403) throw new Error("DefectDojo odmítl API klíč (HTTP " + res.status + ").");
  if (!res.ok) throw new Error(`DefectDojo: HTTP ${res.status}`);
  return (await res.json()) as { count?: number; next?: string | null; results?: DdFinding[]; prefetch?: { endpoints?: Record<string, DdEndpoint>; product?: Record<string, { name?: string }>; test?: Record<string, { engagement?: number }>; engagement?: Record<string, { product?: number }> } };
}

/** Stáhne aktivní nálezy (stránkování, předané endpointy a produkty). */
export async function fetchDefectDojo(fetchImpl: FetchLike, base: string, key: string, verifiedOnly: boolean) {
  const root = base.replace(/\/+$/, "");
  let url: string | null = `${root}/api/v2/findings/?active=true&duplicate=false&false_p=false&limit=500${verifiedOnly ? "&verified=true" : ""}&prefetch=endpoints&related_fields=true`;
  const out: { f: DdFinding; product: string | null }[] = [];
  const endpoints = new Map<number, DdEndpoint>();
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const page = await ddFetch(fetchImpl, url, key);
    for (const [id, e] of Object.entries(page.prefetch?.endpoints ?? {})) endpoints.set(Number(id), e);
    for (const f of page.results ?? []) {
      // related_fields=true vrací test → engagement → product jako objekty
      const t = f.test;
      const nested = typeof t === "object" && t && typeof t.engagement === "object" && t.engagement && typeof t.engagement.product === "object" ? (t.engagement.product?.name ?? null) : null;
      const product = f.related_fields?.test?.engagement?.product?.name ?? nested;
      out.push({ f, product });
    }
    url = page.next ?? null;
    // další stránka jen na stejném serveru (ochrana proti přesměrování klíče jinam)
    if (url && !url.startsWith(root)) throw new Error("DefectDojo vrátil odkaz na jiný server – synchronizace zastavena.");
  }
  return { findings: out, endpoints };
}

export async function syncDefectDojo(db: Db, config: Config, fetchImpl: FetchLike = fetch as FetchLike, userId: string | null = null) {
  const s = await load(db);
  if (!s.url || !s.apiKeyEnc || !s.companyId) throw new Error("Konektor DefectDojo není nastavený (adresa, API klíč, společnost).");
  const companyId = s.companyId;
  try {
    const key = decrypt(s.apiKeyEnc, appSecret(config));
    const { findings, endpoints } = await fetchDefectDojo(fetchImpl, s.url, key, s.verifiedOnly);
    const all = findings.flatMap(({ f, product }) => ddToFindings(f, endpoints, s.productAsAsset ? product : null));
    const plan = await planScan(db, companyId, "defectdojo", all, { includeInfo: false });
    const r = await commitScan(db, { companyId, userId, scanner: "defectdojo", name: `DefectDojo ${new Date().toISOString().slice(0, 10)}`, fileName: s.url.slice(0, 255), sha256: "", assetId: null, closeMissing: true, external: false, plan, closeAllOfScanner: true });
    await recomputeHealth(db);
    await store(db, { lastSyncAt: new Date().toISOString(), lastError: null, lastStats: r.stats, lastScanId: r.scanId });
    return r;
  } catch (e) {
    await store(db, { lastSyncAt: new Date().toISOString(), lastError: (e as Error).message.slice(0, 500) });
    throw e;
  }
}

/** Plánovač: synchronizace podle intervalu. */
export async function maybeSyncDefectDojo(db: Db, config: Config, fetchImpl?: FetchLike, now = new Date()) {
  const s = await load(db);
  if (!s.enabled || !s.url || !s.apiKeyEnc || !s.companyId) return false;
  if (s.lastSyncAt && now.getTime() - new Date(s.lastSyncAt).getTime() < s.intervalHours * 3_600_000 - 60_000) return false;
  await syncDefectDojo(db, config, fetchImpl);
  return true;
}

export function defectDojoRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike }) {
  const { db, config } = deps;
  const f = deps.fetchImpl ?? (fetch as FetchLike);
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "vulnerabilities"))
    .get("/", requirePerm("admin:settings"), async (c) => c.json(dto(await load(db))))
    .put("/", requirePerm("admin:settings"), zValidator("json", DefectDojoSettingsInput), async (c) => {
      const i = c.req.valid("json");
      if (i.companyId) {
        assertScope(c, i.companyId, "Společnost nenalezena");
      }
      const { apiKey, ...rest } = i;
      const patch: Partial<Stored> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (apiKey) patch.apiKeyEnc = encrypt(apiKey, appSecret(config));
      const s = await store(db, patch);
      await audit(db, { c, user: currentUser(c), action: "defectdojo.settings_updated", details: { ...rest, apiKeyChanged: !!apiKey } });
      return c.json(dto(s));
    })
    .post("/test", requirePerm("admin:settings"), async (c) => {
      const s = await load(db);
      if (!s.url || !s.apiKeyEnc) throw new HTTPException(400, { message: "Vyplňte adresu a API klíč DefectDojo." });
      try {
        const page = await ddFetch(f, `${s.url.replace(/\/+$/, "")}/api/v2/findings/?active=true&limit=1`, decrypt(s.apiKeyEnc, appSecret(config)));
        return c.json({ ok: true, activeFindings: page.count ?? 0 });
      } catch (e) {
        return c.json({ ok: false, message: (e as Error).message });
      }
    })
    .post("/sync", requirePerm("admin:settings"), async (c) => {
      try {
        const r = await syncDefectDojo(db, config, f, currentUser(c).id);
        await audit(db, { c, user: currentUser(c), action: "defectdojo.synced", entityType: "vuln_scan", entityId: r.scanId, details: { ...r.stats } });
        return c.json({ ...dto(await load(db)) });
      } catch (e) {
        throw new HTTPException(502, { message: (e as Error).message });
      }
    });
}

/** Plánovač volá jen při zapnutém modulu. */
export async function processDefectDojo(db: Db, config: Config) {
  if (!((await getSettings(db)).enabledModules as string[]).includes("vulnerabilities")) return false;
  return maybeSyncDefectDojo(db, config).catch((e) => {
    console.error("DefectDojo:", (e as Error).message);
    return false;
  });
}
