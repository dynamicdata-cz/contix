import { OSV_DEFAULTS, OSV_ECOSYSTEMS, osvAffects, parseOsvRecord, purlToOsv, type OsvAffected, type OsvRecord, type OsvSettings, type OsvStatusDto } from "@contix/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Unzip, UnzipInflate, strFromU8 } from "fflate";
import type { Db } from "../../db/client";
import { appSettings, craComponents, craFindings, craProducts, osvPackages, osvRecords } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { acquireLease, leaseHolder, releaseLease } from "../ops/lease";

/* ============================================================
 * Offline databáze OSV a párování komponent produktů (ADR-093).
 * Jen stahování (GET bucketu OSV po ekosystémech) nebo ruční nahrání ZIP / JSON – nic se neodesílá.
 * Zápis jen `storeOsvRecords`, párování jen `matchProducts` (nové shody = „prošetřuje se“, zmizelé = gone).
 * ============================================================ */

const KEY = "cra.osv";
const MAX_ZIP = 1024 * 1024 * 1024;

export async function getOsvSettings(db: Db): Promise<OsvSettings> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  return { ...OSV_DEFAULTS, ...((r?.value as Partial<OsvSettings>) ?? {}) };
}
export async function storeOsvSettings(db: Db, patch: Partial<OsvSettings>) {
  const v = { ...(await getOsvSettings(db)), ...patch };
  await db.insert(appSettings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
  return v;
}
export async function osvStatus(db: Db): Promise<OsvStatusDto> {
  const s = await getOsvSettings(db);
  // „běží“ jen dokud platí lease (pád serveru uprostřed stahování nenechá stav viset)
  if (s.runningSince) {
    const l = await leaseHolder(db, LEASE);
    if (!l || new Date(l.until).getTime() < Date.now()) s.runningSince = null;
  }
  const counts = await db.select({ ecosystem: osvPackages.ecosystem, records: sql<number>`count(distinct ${osvPackages.osvId})::int` }).from(osvPackages).groupBy(osvPackages.ecosystem);
  return { ...s, counts: counts.sort((a, b) => a.ecosystem.localeCompare(b.ecosystem)) };
}

/** Uloží záznamy (upsert podle ID, index balíčků se přepíše). */
export async function storeOsvRecords(db: Db, records: OsvRecord[]) {
  const known = new Set<string>(OSV_ECOSYSTEMS);
  for (let i = 0; i < records.length; i += 500) {
    const part = records.slice(i, i + 500);
    await db.transaction(async (tx) => {
      await tx
        .insert(osvRecords)
        .values(part.map((r) => ({ id: r.id, aliases: r.aliases, summary: r.summary, severity: r.severity, modified: r.modified ? new Date(r.modified) : null, withdrawn: r.withdrawn, affected: r.affected, ecosystems: [...new Set(r.affected.map((a) => a.ecosystem))] })))
        .onConflictDoUpdate({
          target: osvRecords.id,
          set: { aliases: sql`excluded.aliases`, summary: sql`excluded.summary`, severity: sql`excluded.severity`, modified: sql`excluded.modified`, withdrawn: sql`excluded.withdrawn`, affected: sql`excluded.affected`, ecosystems: sql`excluded.ecosystems` },
        });
      await tx.delete(osvPackages).where(inArray(osvPackages.osvId, part.map((r) => r.id)));
      const pk = new Map<string, { osvId: string; ecosystem: string; name: string }>();
      for (const r of part) for (const a of r.affected) if (known.has(a.ecosystem)) pk.set(`${r.id}|${a.ecosystem}|${a.name}`, { osvId: r.id, ecosystem: a.ecosystem, name: a.name.slice(0, 300) });
      if (pk.size) await tx.insert(osvPackages).values([...pk.values()]).onConflictDoNothing();
    });
  }
  return records.length;
}

/** Záznamy z archivu ZIP (bucket OSV „all.zip“) – po souborech, bez rozbalení celého archivu do paměti. */
export function osvRecordsFromZip(buf: Uint8Array): OsvRecord[] {
  const out: OsvRecord[] = [];
  let failed: Error | null = null;
  const uz = new Unzip((file) => {
    if (!file.name.endsWith(".json")) return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, data, final) => {
      if (err) {
        failed = err;
        return;
      }
      size += data.length;
      if (size > 5 * 1024 * 1024) return; // jeden záznam > 5 MB přeskočit
      chunks.push(data);
      if (final) {
        const all = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          all.set(c, o);
          o += c.length;
        }
        const r = parseOsvRecord(strFromU8(all));
        if (r) out.push(r);
      }
    };
    file.start();
  });
  uz.register(UnzipInflate);
  uz.push(buf, true);
  if (failed) throw failed;
  return out;
}

/** Soubor z nahrání: ZIP (více záznamů), pole JSON nebo jeden záznam. */
export function osvRecordsFromUpload(buf: Uint8Array): OsvRecord[] {
  if (buf[0] === 0x50 && buf[1] === 0x4b) return osvRecordsFromZip(buf);
  const text = strFromU8(buf);
  const t = text.trimStart();
  if (t.startsWith("[")) {
    const arr = JSON.parse(text) as unknown[];
    return arr.map((x) => parseOsvRecord(JSON.stringify(x))).filter((x): x is OsvRecord => !!x);
  }
  const r = parseOsvRecord(text);
  return r ? [r] : [];
}

export const componentRefOf = (c: { purl: string | null; name: string; version: string | null }) => c.purl?.trim() || `${c.name}@${c.version ?? ""}`;

/** Párování komponent produktů se záznamy OSV (všechny produkty, nebo vybrané). */
export async function matchProducts(db: Db, productIds?: string[]) {
  const products = await db.select({ id: craProducts.id, companyId: craProducts.companyId }).from(craProducts).where(productIds ? inArray(craProducts.id, productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]) : undefined);
  let found = 0;
  for (const p of products) {
    const comps = await db.select().from(craComponents).where(eq(craComponents.productId, p.id));
    const keys = comps.map((c) => ({ c, o: purlToOsv(c.purl, c.version) })).filter((x) => x.o?.version) as { c: (typeof comps)[number]; o: NonNullable<ReturnType<typeof purlToOsv>> }[];
    const matches = new Map<string, { ref: string; rec: typeof osvRecords.$inferSelect }>();
    if (keys.length) {
      const names = [...new Set(keys.map((k) => k.o.name))];
      const pk = await db.select().from(osvPackages).where(inArray(osvPackages.name, names));
      const ids = [...new Set(pk.map((x) => x.osvId))];
      const recs = ids.length ? await db.select().from(osvRecords).where(and(inArray(osvRecords.id, ids), eq(osvRecords.withdrawn, false))) : [];
      const byId = new Map(recs.map((r) => [r.id, r]));
      for (const k of keys) {
        for (const x of pk.filter((y) => y.ecosystem === k.o.ecosystem && y.name === k.o.name)) {
          const rec = byId.get(x.osvId);
          if (!rec) continue;
          const aff = (rec.affected as OsvAffected[]).filter((a) => a.ecosystem === k.o.ecosystem && a.name === k.o.name);
          if (aff.some((a) => osvAffects(a, k.o.version))) matches.set(`${componentRefOf(k.c)}|${rec.id}`, { ref: componentRefOf(k.c), rec });
        }
      }
    }
    const now = new Date();
    for (const { ref, rec } of matches.values()) {
      await db
        .insert(craFindings)
        .values({ companyId: p.companyId, productId: p.id, componentRef: ref.slice(0, 500), vulnId: rec.id, aliases: rec.aliases, summary: rec.summary, severity: rec.severity, source: "osv" })
        .onConflictDoUpdate({ target: [craFindings.productId, craFindings.componentRef, craFindings.vulnId], set: { aliases: rec.aliases, summary: rec.summary, severity: rec.severity, gone: false, updatedAt: now } });
    }
    // shody, které už neplatí (komponenta odebrána, jiná verze, záznam opraven / stažen)
    const keep = [...matches.keys()];
    const stale = await db.select({ id: craFindings.id, ref: craFindings.componentRef, vulnId: craFindings.vulnId }).from(craFindings).where(and(eq(craFindings.productId, p.id), eq(craFindings.source, "osv"), eq(craFindings.gone, false)));
    const goneIds = stale.filter((s) => !keep.includes(`${s.ref}|${s.vulnId}`)).map((s) => s.id);
    if (goneIds.length) await db.update(craFindings).set({ gone: true, updatedAt: now }).where(inArray(craFindings.id, goneIds));
    found += matches.size;
  }
  return { products: products.length, matches: found };
}

/** Stažení zvolených ekosystémů z bucketu OSV (jen GET) a nové párování. */
export async function refreshOsv(db: Db, fetchImpl: FetchLike = fetch as FetchLike) {
  const s = await getOsvSettings(db);
  const errors: string[] = [];
  let records = 0;
  for (const eco of s.ecosystems) {
    try {
      const res = await fetchImpl(`${s.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(eco)}/all.zip`, { method: "GET" } as never);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > MAX_ZIP) throw new Error("archiv je příliš velký");
      records += await storeOsvRecords(db, osvRecordsFromZip(buf));
    } catch (e) {
      errors.push(`${eco}: ${(e as Error).message}`);
    }
  }
  const m = await matchProducts(db);
  await storeOsvSettings(db, { lastRunAt: new Date().toISOString(), lastError: errors.length ? errors.join(" · ").slice(0, 1000) : null });
  return { records, ...m, errors };
}

/* ---------------- stahování na pozadí (ADR-100) ----------------
 * Velké ekosystémy (npm, PyPI) se stahují a ukládají minuty – déle, než vydrží HTTP požadavek (Bun idleTimeout, proxy).
 * Ruční „Stáhnout nyní“ proto jen spustí úlohu a vrátí 202; stav `runningSince` / `lastResult` čte UI dotazováním.
 * Souběh (ruční × plánovač × více instancí) hlídá lease. */
const LEASE = "cra.osv.refresh";
const LEASE_TTL = 3 * 3600_000;
let current: Promise<unknown> | null = null;

/** Probíhající úloha této instance (pro testy a čisté ukončení). */
export const osvRefreshPending = () => current;

async function runOsvRefresh(db: Db, fetchImpl?: FetchLike) {
  try {
    const r = await refreshOsv(db, fetchImpl);
    await storeOsvSettings(db, { runningSince: null, lastResult: { records: r.records, matches: r.matches, errors: r.errors } });
    return r;
  } catch (e) {
    await storeOsvSettings(db, { runningSince: null, lastRunAt: new Date().toISOString(), lastError: (e as Error).message.slice(0, 1000) });
    throw e;
  } finally {
    await releaseLease(db, LEASE);
    current = null;
  }
}

/** Spustí stažení na pozadí; false = už běží (zde nebo v jiné instanci). */
export async function startOsvRefresh(db: Db, fetchImpl?: FetchLike, onDone?: (r: Awaited<ReturnType<typeof refreshOsv>>) => Promise<void>): Promise<boolean> {
  if (current || !(await acquireLease(db, LEASE, LEASE_TTL))) return false;
  await storeOsvSettings(db, { runningSince: new Date().toISOString(), lastResult: null });
  current = runOsvRefresh(db, fetchImpl)
    .then((r) => onDone?.(r))
    .catch((e) => console.error("OSV:", (e as Error).message));
  return true;
}

/** Plánovač: jednou denně, je-li zapnuto. */
export async function maybeRefreshOsv(db: Db, fetchImpl?: FetchLike, now = new Date()) {
  const s = await getOsvSettings(db);
  if (!s.autoRefresh || !s.ecosystems.length) return null;
  if (s.lastRunAt && now.getTime() - new Date(s.lastRunAt).getTime() < 24 * 3600_000) return null;
  if (current || !(await acquireLease(db, LEASE, LEASE_TTL))) return null;
  await storeOsvSettings(db, { runningSince: new Date().toISOString(), lastResult: null });
  return (current = runOsvRefresh(db, fetchImpl));
}
