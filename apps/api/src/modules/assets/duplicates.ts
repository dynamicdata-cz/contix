import { duplicateReasons, normalizeAssetName, normalizeMac, type AssetDuplicatePair, type DuplicateAsset } from "@contix/shared";
import { and, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assetDependencies, assetDuplicateDismissals, assetLinks, assetSources, assets, controlAssets, processAssets, riskAssets, type AssetRow } from "../../db/schema";

/* ============================================================
 * Duplicity aktiv (ADR-021): heuristika kandidátů (sériové číslo, MAC, hostname, IP, podobný název)
 * a sloučení – vazby se generickým způsobem přesunou na ponechané aktivum, slučované se smaže.
 * Nic se neslučuje automaticky; rozhoduje člověk.
 * ============================================================ */

const MAX_ASSETS = 10_000;
const MAX_PAIRS = 200;

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function findDuplicates(db: Db, companyIds: string[]): Promise<AssetDuplicatePair[]> {
  if (!companyIds.length) return [];
  const rows = await db
    .select({
      id: assets.id,
      companyId: assets.companyId,
      name: assets.name,
      hostname: assets.hostname,
      assetType: assets.assetType,
      serialNumber: assets.serialNumber,
      ipAddresses: assets.ipAddresses,
      macAddresses: assets.macAddresses,
      updatedAt: assets.updatedAt,
    })
    .from(assets)
    .where(and(inArray(assets.companyId, companyIds), ne(assets.lifecycleStatus, "retired")))
    .limit(MAX_ASSETS);

  // blokování: jen dvojice, které sdílejí aspoň jeden klíč (jinak by to bylo n²)
  const buckets = new Map<string, number[]>();
  const put = (k: string, i: number) => {
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  };
  rows.forEach((r, i) => {
    const co = r.companyId;
    if (r.serialNumber?.trim()) put(`${co}|sn|${r.serialNumber.trim().toLowerCase()}`, i);
    for (const m of r.macAddresses) if (normalizeMac(m).length === 12) put(`${co}|mac|${normalizeMac(m)}`, i);
    if (r.hostname) put(`${co}|hn|${normalizeAssetName(r.hostname)}`, i);
    for (const ip of r.ipAddresses) put(`${co}|ip|${ip}`, i);
    const n = normalizeAssetName(r.name);
    if (n.length >= 3) put(`${co}|nm|${n.slice(0, 4)}`, i);
  });

  const dismissed = new Set(
    (await db.select({ a: assetDuplicateDismissals.assetA, b: assetDuplicateDismissals.assetB }).from(assetDuplicateDismissals).where(inArray(assetDuplicateDismissals.companyId, companyIds))).map((d) => pairKey(d.a, d.b)),
  );
  const seen = new Set<string>();
  const found: { i: number; j: number; reasons: string[]; score: number }[] = [];
  for (const idx of buckets.values()) {
    if (idx.length < 2 || idx.length > 200) continue; // obří skupina (např. sdílená NAT IP) nic nevypovídá
    for (let x = 0; x < idx.length; x++)
      for (let y = x + 1; y < idx.length; y++) {
        const i = idx[x]!;
        const j = idx[y]!;
        const k = pairKey(rows[i]!.id, rows[j]!.id);
        if (seen.has(k)) continue;
        seen.add(k);
        if (dismissed.has(k)) continue;
        const r = duplicateReasons(rows[i]!, rows[j]!);
        if (r) found.push({ i, j, ...r });
      }
  }
  found.sort((p, q) => q.score - p.score);
  const top = found.slice(0, MAX_PAIRS);

  const ids = [...new Set(top.flatMap((p) => [rows[p.i]!.id, rows[p.j]!.id]))];
  const links = await linkCounts(db, ids);
  const sources = new Map<string, string>();
  if (ids.length) for (const s of await db.select({ assetId: assetSources.assetId, src: assetSources.sourceType }).from(assetSources).where(inArray(assetSources.assetId, ids))) sources.set(s.assetId, sources.has(s.assetId) && !sources.get(s.assetId)!.includes(s.src) ? `${sources.get(s.assetId)}, ${s.src}` : s.src);
  const dto = (i: number): DuplicateAsset => {
    const r = rows[i]!;
    return {
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      assetType: r.assetType,
      serialNumber: r.serialNumber,
      ipAddresses: r.ipAddresses,
      macAddresses: r.macAddresses,
      source: sources.get(r.id) ?? null,
      updatedAt: r.updatedAt.toISOString(),
      links: links.get(r.id) ?? 0,
    };
  };
  return top.map((p) => ({ a: dto(p.i), b: dto(p.j), reasons: p.reasons, score: p.score }));
}

/** Počet řídicích vazeb (procesy, rizika, opatření, vazby aktiv) – pomůže vybrat, které aktivum ponechat. */
async function linkCounts(db: Db, ids: string[]) {
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const add = (rows: { id: string; n: number }[]) => rows.forEach((r) => m.set(r.id, (m.get(r.id) ?? 0) + r.n));
  add(await db.select({ id: processAssets.assetId, n: count() }).from(processAssets).where(inArray(processAssets.assetId, ids)).groupBy(processAssets.assetId));
  add(await db.select({ id: riskAssets.assetId, n: count() }).from(riskAssets).where(inArray(riskAssets.assetId, ids)).groupBy(riskAssets.assetId));
  add(await db.select({ id: controlAssets.assetId, n: count() }).from(controlAssets).where(inArray(controlAssets.assetId, ids)).groupBy(controlAssets.assetId));
  for (const id of ids) {
    const [l] = await db.select({ n: count() }).from(assetLinks).where(or(eq(assetLinks.primaryId, id), eq(assetLinks.supportingId, id)));
    if (l!.n) m.set(id, (m.get(id) ?? 0) + l!.n);
  }
  return m;
}

/** Sloupce, které odkazují na assets.id (z katalogu Postgresu – zahrne i budoucí tabulky). */
async function assetForeignKeys(db: Db) {
  const r = await db.execute<{ tbl: string; col: string }>(sql`
    select cl.relname as tbl, a.attname as col
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f' and c.confrelid = 'assets'::regclass and cl.relname <> 'asset_duplicate_dismissals'`);
  return [...r];
}

const FILL: (keyof AssetRow)[] = ["description", "hostname", "fqdn", "osName", "osVersion", "manufacturer", "model", "serialNumber", "location", "ownerName", "ownerUserId", "confidentiality", "integrity", "availability", "environment", "osEolDate"];

/**
 * Sloučí `removeId` do `keepId`: přesune všechny vazby (řádek po řádku – kolize s jedinečností
 * znamená, že vazba už u ponechaného aktiva je, takže se řádek smaže), doplní prázdná pole a smaže slučované aktivum.
 */
export async function mergeAssets(db: Db, keep: AssetRow, remove: AssetRow, fillEmpty: boolean) {
  const fks = await assetForeignKeys(db);
  const moved: Record<string, number> = {};
  const dropped: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const { tbl, col } of fks) {
      const t = sql.identifier(tbl);
      const cl = sql.identifier(col);
      const rows = [...(await tx.execute<{ ctid: string }>(sql`select ctid::text as ctid from ${t} where ${cl} = ${remove.id}`))];
      for (const r of rows) {
        try {
          await tx.transaction(async (sp) => {
            await sp.execute(sql`update ${t} set ${cl} = ${keep.id} where ctid = ${r.ctid}::tid`);
          });
          moved[tbl] = (moved[tbl] ?? 0) + 1;
        } catch {
          await tx.execute(sql`delete from ${t} where ctid = ${r.ctid}::tid`);
          dropped[tbl] = (dropped[tbl] ?? 0) + 1;
        }
      }
    }
    // vazba aktivum → samo na sebe nedává smysl
    await tx.delete(assetLinks).where(and(eq(assetLinks.primaryId, keep.id), eq(assetLinks.supportingId, keep.id)));
    await tx.delete(assetDependencies).where(and(eq(assetDependencies.fromId, keep.id), eq(assetDependencies.toId, keep.id)));
    const patch: Partial<AssetRow> = { updatedAt: new Date() };
    if (fillEmpty) {
      for (const f of FILL) if ((keep[f] == null || keep[f] === "") && remove[f] != null && remove[f] !== "") (patch as Record<string, unknown>)[f] = remove[f];
      patch.ipAddresses = [...new Set([...keep.ipAddresses, ...remove.ipAddresses])];
      patch.macAddresses = [...new Set([...keep.macAddresses, ...remove.macAddresses])];
      patch.tags = [...new Set([...keep.tags, ...remove.tags])];
      patch.attributes = { ...remove.attributes, ...keep.attributes };
      const min = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b));
      const max = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));
      patch.firstSeenAt = min(keep.firstSeenAt, remove.firstSeenAt);
      patch.lastSeenAt = max(keep.lastSeenAt, remove.lastSeenAt);
    }
    await tx.update(assets).set(patch).where(eq(assets.id, keep.id));
    await tx.delete(assets).where(eq(assets.id, remove.id));
  });
  return { moved, dropped };
}
