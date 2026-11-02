import { DEFAULT_EPSS_URL, DEFAULT_KEV_URL, EPSS_P1, EPSS_P2, VULN_SLA_DEFAULTS, parseEpss, parseKev, type VulnIntelSettingsInput, type VulnIntelStatusDto, type VulnSla } from "@contix/shared";
import { count, eq, isNotNull, sql } from "drizzle-orm";
import { gunzipSync } from "node:zlib";
import type { Db } from "../../db/client";
import { appSettings, assets, assetVulnerabilities, vulnIntel } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { recomputeHealth } from "./service";

/* ============================================================
 * Veřejné zdroje hrozeb pro prioritizaci zranitelností (ADR-049): CISA KEV + EPSS.
 * Jen stahování veřejných souborů (nebo ruční nahrání pro servery bez internetu) – nic se neodesílá.
 * ============================================================ */

const KEY = "vuln.intel";
const MAX_BYTES = 80 * 1024 * 1024;

interface Stored {
  autoRefresh: boolean;
  kevUrl: string;
  epssUrl: string;
  kevUpdatedAt: string | null;
  epssUpdatedAt: string | null;
  kevVersion: string | null;
  epssDate: string | null;
  lastError: string | null;
  /** Lhůty oprav podle priority (ADR-050). */
  sla: VulnSla;
}
const DEFAULTS: Stored = { autoRefresh: true, kevUrl: DEFAULT_KEV_URL, epssUrl: DEFAULT_EPSS_URL, kevUpdatedAt: null, epssUpdatedAt: null, kevVersion: null, epssDate: null, lastError: null, sla: VULN_SLA_DEFAULTS };

export async function getIntelSettings(db: Db): Promise<Stored> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return { ...DEFAULTS, ...((r?.value as Partial<Stored>) ?? {}) };
}
async function store(db: Db, patch: Partial<Stored>) {
  const v = { ...(await getIntelSettings(db)), ...patch };
  await db.insert(appSettings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
  return v;
}
export async function saveIntelSettings(db: Db, input: VulnIntelSettingsInput) {
  return store(db, Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<Stored>);
}

export async function intelStatus(db: Db): Promise<VulnIntelStatusDto> {
  const s = await getIntelSettings(db);
  const [[kev], [epss]] = await Promise.all([
    db.select({ n: count() }).from(vulnIntel).where(eq(vulnIntel.kev, true)),
    db.select({ n: count() }).from(vulnIntel).where(isNotNull(vulnIntel.epss)),
  ]);
  return {
    autoRefresh: s.autoRefresh,
    kevUrl: s.kevUrl,
    epssUrl: s.epssUrl,
    kevUpdatedAt: s.kevUpdatedAt,
    epssUpdatedAt: s.epssUpdatedAt,
    kevVersion: s.kevVersion,
    epssDate: s.epssDate,
    kevEntries: kev?.n ?? 0,
    epssEntries: epss?.n ?? 0,
    lastError: s.lastError,
    sla: s.sla,
  };
}

/** Obsah souboru jako text; gzip (EPSS) se rozbalí podle hlavičky 1F 8B. */
export function decodeFile(buf: Uint8Array): string {
  if (buf.length > MAX_BYTES) throw new Error("Soubor je příliš velký.");
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf, { maxOutputLength: MAX_BYTES }) : buf;
  return new TextDecoder().decode(raw);
}

async function download(url: string, fetchImpl: FetchLike): Promise<string> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) } as RequestInit);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return decodeFile(new Uint8Array(await res.arrayBuffer()));
}

/** Uloží katalog KEV: celý (≈ tisíce záznamů); co z katalogu vypadlo, přestane být KEV. */
export async function storeKev(db: Db, text: string) {
  const { version, entries } = parseKev(text);
  if (!entries.length) throw new Error("Katalog KEV je prázdný.");
  await db.transaction(async (tx) => {
    await tx.update(vulnIntel).set({ kev: false, kevRansomware: false }).where(eq(vulnIntel.kev, true));
    for (let i = 0; i < entries.length; i += 1000) {
      const part = entries.slice(i, i + 1000);
      await tx
        .insert(vulnIntel)
        .values(part.map((e) => ({ cveId: e.cveId, kev: true, kevName: e.name, kevDateAdded: e.dateAdded, kevDueDate: e.dueDate, kevRansomware: e.ransomware })))
        .onConflictDoUpdate({
          target: vulnIntel.cveId,
          set: { kev: true, kevName: sql`excluded.kev_name`, kevDateAdded: sql`excluded.kev_date_added`, kevDueDate: sql`excluded.kev_due_date`, kevRansomware: sql`excluded.kev_ransomware`, updatedAt: new Date() },
        });
    }
  });
  await store(db, { kevUpdatedAt: new Date().toISOString(), kevVersion: version });
  await recomputeHealth(db); // priorita P1 ovlivňuje semafor (ADR-050)
  return entries.length;
}

/** Uloží skóre EPSS jen pro CVE z evidence zranitelností (soubor má stovky tisíc řádků). */
export async function storeEpss(db: Db, text: string) {
  const ours = new Set((await db.selectDistinct({ id: assetVulnerabilities.cveId }).from(assetVulnerabilities)).map((r) => r.id.toUpperCase()));
  const { date, scores } = parseEpss(text, ours);
  for (let i = 0; i < scores.length; i += 1000) {
    const part = scores.slice(i, i + 1000);
    await db
      .insert(vulnIntel)
      .values(part.map((s) => ({ cveId: s.cveId, epss: s.epss, epssPercentile: s.percentile, epssDate: date })))
      .onConflictDoUpdate({ target: vulnIntel.cveId, set: { epss: sql`excluded.epss`, epssPercentile: sql`excluded.epss_percentile`, epssDate: sql`excluded.epss_date`, updatedAt: new Date() } });
  }
  await store(db, { epssUpdatedAt: new Date().toISOString(), epssDate: date });
  await recomputeHealth(db);
  return scores.length;
}

/** Stažení obou zdrojů; chyba jednoho nebrání druhému. */
export async function refreshVulnIntel(db: Db, fetchImpl: FetchLike = fetch as FetchLike) {
  const s = await getIntelSettings(db);
  const errors: string[] = [];
  let kev = 0,
    epss = 0;
  try {
    kev = await storeKev(db, await download(s.kevUrl, fetchImpl));
  } catch (e) {
    errors.push(`KEV: ${(e as Error).message}`);
  }
  try {
    epss = await storeEpss(db, await download(s.epssUrl, fetchImpl));
  } catch (e) {
    errors.push(`EPSS: ${(e as Error).message}`);
  }
  await store(db, { lastError: errors.length ? errors.join(" · ").slice(0, 1000) : null });
  return { kev, epss, errors };
}

/** Plánovač: jednou denně, je-li zapnuto (server bez internetu → chyba ve stavu, ruční nahrání). */
export async function maybeRefreshVulnIntel(db: Db, fetchImpl?: FetchLike, now = new Date()) {
  const s = await getIntelSettings(db);
  if (!s.autoRefresh) return null;
  const last = Math.min(...[s.kevUpdatedAt, s.epssUpdatedAt].map((x) => (x ? new Date(x).getTime() : 0)));
  // po chybě zkusit znovu nejdřív za 6 h (lastError se ukládá s časem posledního pokusu přes updatedAt nastavení)
  if (now.getTime() - last < 24 * 3600_000) return null;
  const [row] = await db.select({ u: appSettings.updatedAt }).from(appSettings).where(eq(appSettings.key, KEY));
  if (s.lastError && row && now.getTime() - row.u.getTime() < 6 * 3600_000) return null;
  return refreshVulnIntel(db, fetchImpl);
}

export const getVulnSla = async (db: Db): Promise<VulnSla> => ({ ...VULN_SLA_DEFAULTS, ...(await getIntelSettings(db)).sla });

/* ---------- priorita v SQL (stejná pravidla jako `vulnPriority`) ---------- */

/** Číslo priority 1–4 pro řazení a filtr; potřebuje join `vuln_intel` (left) a `assets`. */
export const vulnPrioritySql = sql<number>`(case
  when coalesce(${vulnIntel.kev}, false) or coalesce(${vulnIntel.epss}, 0) >= ${EPSS_P1} then 1
  when coalesce(${vulnIntel.epss}, 0) >= ${EPSS_P2} or (${assetVulnerabilities.severity} = 'critical' and ${assets.criticality} in ('high', 'critical'))
    or (${assetVulnerabilities.severity} in ('critical', 'high') and (${assets.internetFacing} or ${assetVulnerabilities.exposed})) then 2
  when ${assetVulnerabilities.severity} in ('critical', 'high') then 3
  else 4 end)`;

/**
 * Termín opravy v SQL (stejně jako `vulnDue`): od prvního zjištění, u KEV nejdřív od zařazení do katalogu,
 * + lhůta podle priority; null = priorita bez lhůty. Potřebuje stejné joiny jako `vulnPrioritySql`.
 */
export function vulnDueSql(sla: VulnSla) {
  const d = (n: number | null) => (n == null ? sql`null` : sql`${n}`);
  return sql<string | null>`(greatest(${assetVulnerabilities.firstSeenAt}, coalesce(${vulnIntel.kevDateAdded}::timestamptz, ${assetVulnerabilities.firstSeenAt}))
    + (case ${vulnPrioritySql} when 1 then ${d(sla.p1)}::int when 2 then ${d(sla.p2)}::int when 3 then ${d(sla.p3)}::int else ${d(sla.p4)}::int end) * interval '1 day')::date`;
}
/** Otevřená zranitelnost po termínu opravy. */
export const vulnOverdueSql = (sla: VulnSla) => sql`(${assetVulnerabilities.status} = 'open' and ${vulnDueSql(sla)} < current_date)`;
