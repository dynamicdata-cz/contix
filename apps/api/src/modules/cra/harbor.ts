import { HARBOR_DEFAULTS_KEY, parseHarborRef, type HarborSettingsDto, type HarborSettingsInput, type HarborVulnItem } from "@contix/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { decrypt, encrypt } from "../../auth/crypto";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { appSettings, craFindings, craProducts } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";

/* ============================================================
 * Harbor (v1.107, ADR-201): výsledek skenu obrazu (Trivy v Harboru) → nálezy produktu CRA s opravenou verzí
 * a odkazy. Jen čtení přes API Harboru (robotický účet s právem pull / čtení artefaktů). Nález, který v novém
 * skenu obrazu není, se označí jako zmizelý („gone“) a navrhne se stav VEX „opraveno“.
 * ============================================================ */

type Stored = { url: string; username: string; passwordEnc: string | null; verifyTls: boolean; autoSyncHours: number };
const DEF: Stored = { url: "", username: "", passwordEnc: null, verifyTls: true, autoSyncHours: 24 };
const VULN_MIME = "application/vnd.security.vulnerability.report; version=1.1";

async function stored(db: Db): Promise<Stored> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, HARBOR_DEFAULTS_KEY));
  return { ...DEF, ...((r?.value as Partial<Stored>) ?? {}) };
}
export async function harborSettings(db: Db): Promise<HarborSettingsDto> {
  const s = await stored(db);
  return { url: s.url, username: s.username, verifyTls: s.verifyTls, autoSyncHours: s.autoSyncHours, hasPassword: !!s.passwordEnc };
}
export async function saveHarborSettings(db: Db, config: Config, v: Required<Omit<HarborSettingsInput, "password">> & { password?: string }) {
  const cur = await stored(db);
  const next: Stored = { url: v.url.replace(/\/+$/, ""), username: v.username, verifyTls: v.verifyTls, autoSyncHours: v.autoSyncHours, passwordEnc: v.password ? encrypt(v.password, appSecret(config)) : v.password === "" && !v.username ? null : cur.passwordEnc };
  await db.insert(appSettings).values({ key: HARBOR_DEFAULTS_KEY, value: next }).onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  return harborSettings(db);
}

const sevOf = (s: string | undefined) => {
  const v = (s ?? "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(v) ? v.toUpperCase() : v === "negligible" || v === "none" ? "LOW" : v ? v.toUpperCase().slice(0, 50) : null;
};
/** Ekosystém z balíčku Harboru: obraz kontejneru hlásí OS balíčky (deb/apk/rpm) i jazykové knihovny – podle „type“, jinak neznámý. */
const ecoOf = (it: HarborVulnItem & { type?: string; purl?: string }) => {
  const p = it.purl?.match(/^pkg:([a-z0-9.+-]+)\//i)?.[1];
  return (p ?? it.type ?? "pkg").toLowerCase().replace(/[^a-z0-9.+-]/g, "").slice(0, 20) || "pkg";
};

/** Načte sken obrazu z Harboru a promítne ho do nálezů produktu. */
export async function syncHarborProduct(db: Db, config: Config, productId: string, fetchImpl: FetchLike = fetch as FetchLike, now = new Date()) {
  const [p] = await db.select().from(craProducts).where(eq(craProducts.id, productId));
  if (!p?.harborRef) throw new Error("Produkt nemá nastavený obraz v Harboru");
  const s = await stored(db);
  if (!s.url) throw new Error("Harbor není nastaven (Administrace → CRA → Harbor)");
  const ref = parseHarborRef(p.harborRef);
  if (!ref) throw new Error("Neplatný odkaz na obraz – zadejte „projekt/repozitář:tag“");
  const headers: Record<string, string> = { accept: "application/json" };
  if (s.username && s.passwordEnc) headers.authorization = `Basic ${Buffer.from(`${s.username}:${decrypt(s.passwordEnc, appSecret(config))}`).toString("base64")}`;
  const tls = s.verifyTls ? undefined : { rejectUnauthorized: false };
  const base = `${s.url}/api/v2.0/projects/${encodeURIComponent(ref.project)}/repositories/${encodeURIComponent(encodeURIComponent(ref.repository))}/artifacts/${encodeURIComponent(ref.reference)}`;
  const get = async (url: string, accept?: string) => {
    const res = await fetchImpl(url, { method: "GET", headers: accept ? { ...headers, "x-accept-vulnerabilities": accept } : headers, tls } as never);
    if (res.status === 401 || res.status === 403) throw new Error(`Harbor odmítl přístup (HTTP ${res.status}) – zkontrolujte robotický účet`);
    if (res.status === 404) throw new Error("Obraz v Harboru nenalezen (projekt, repozitář nebo tag)");
    if (!res.ok) throw new Error(`Harbor HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  type State = { digest?: string | null; scannedAt?: string | null; syncedAt?: string; error?: string | null; vulns?: number; fixable?: number };
  let state: State;
  try {
    const art = await get(`${base}?with_scan_overview=true`);
    const overview = (art.scan_overview as Record<string, { end_time?: string; scan_status?: string }> | undefined) ?? {};
    const ov = overview[VULN_MIME] ?? Object.values(overview)[0];
    const rep = await get(`${base}/additions/vulnerabilities`, VULN_MIME);
    const report = (rep[VULN_MIME] ?? Object.values(rep)[0]) as { vulnerabilities?: (HarborVulnItem & { type?: string; purl?: string })[] } | undefined;
    const items = (report?.vulnerabilities ?? []).filter((v) => typeof v.id === "string" && typeof v.package === "string").slice(0, 20_000);
    const seen = new Set<string>();
    const rows = new Map<string, typeof craFindings.$inferInsert>();
    for (const it of items) {
      const componentRef = `harbor:${ecoOf(it)}:${it.package}@${it.version ?? ""}`.slice(0, 500);
      const vulnId = it.id.slice(0, 100);
      const key = `${componentRef}|${vulnId}`;
      seen.add(key);
      rows.set(key, {
        companyId: p.companyId,
        productId: p.id,
        componentRef,
        vulnId,
        aliases: [],
        summary: it.description ? it.description.slice(0, 1000) : null,
        severity: sevOf(it.severity),
        source: "harbor",
        fixedVersion: it.fix_version ? it.fix_version.slice(0, 255) : null,
        fixLinks: (it.links ?? []).filter((l) => /^https?:\/\//.test(l)).slice(0, 12).map((l) => l.slice(0, 500)),
      });
    }
    const list = [...rows.values()];
    for (let i = 0; i < list.length; i += 500)
      for (const r of list.slice(i, i + 500))
        await db
          .insert(craFindings)
          .values(r)
          .onConflictDoUpdate({ target: [craFindings.productId, craFindings.componentRef, craFindings.vulnId], set: { summary: r.summary, severity: r.severity, fixedVersion: r.fixedVersion, fixLinks: r.fixLinks, gone: false, updatedAt: now } });
    // nálezy, které v novém skenu nejsou → zmizelé (návrh VEX „opraveno“)
    const prev = await db.select({ id: craFindings.id, ref: craFindings.componentRef, vulnId: craFindings.vulnId }).from(craFindings).where(and(eq(craFindings.productId, p.id), eq(craFindings.source, "harbor"), eq(craFindings.gone, false)));
    const goneIds = prev.filter((x) => !seen.has(`${x.ref}|${x.vulnId}`)).map((x) => x.id);
    if (goneIds.length) await db.update(craFindings).set({ gone: true, updatedAt: now }).where(inArray(craFindings.id, goneIds));
    state = { digest: typeof art.digest === "string" ? art.digest : null, scannedAt: ov?.end_time ?? null, syncedAt: now.toISOString(), error: ov?.scan_status && ov.scan_status !== "Success" ? `Sken v Harboru: ${ov.scan_status}` : null, vulns: list.length, fixable: list.filter((x) => x.fixedVersion).length };
    await db.update(craProducts).set({ harborState: state }).where(eq(craProducts.id, p.id));
    return { ...state, gone: goneIds.length };
  } catch (e) {
    state = { ...(p.harborState ?? {}), syncedAt: now.toISOString(), error: (e as Error).message.slice(0, 500) };
    await db.update(craProducts).set({ harborState: state }).where(eq(craProducts.id, p.id));
    throw e;
  }
}

/** Plánovač: produkty s obrazem v Harboru, u kterých od posledního načtení uplynulo `autoSyncHours`. */
export async function autoHarborSync(db: Db, config: Config, fetchImpl?: FetchLike, now = new Date()) {
  const s = await stored(db);
  if (!s.url || !s.autoSyncHours) return 0;
  const list = await db.select({ id: craProducts.id, st: craProducts.harborState }).from(craProducts).where(isNotNull(craProducts.harborRef));
  let n = 0;
  for (const p of list) {
    const last = p.st?.syncedAt ? Date.parse(p.st.syncedAt) : 0;
    if (now.getTime() - last < s.autoSyncHours * 3_600_000) continue;
    await syncHarborProduct(db, config, p.id, fetchImpl, now).catch(() => undefined);
    n++;
  }
  return n;
}
