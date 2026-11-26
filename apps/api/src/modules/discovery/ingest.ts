import { and, eq, isNull, or, sql } from "drizzle-orm";
import { defaultAssetClass } from "@contix/shared";
import type { Db } from "../../db/client";
import { assetSoftware, assetSources, assets } from "../../db/schema";
import { identityMacs, isIdentityIp, mergeTechnical, normalizeMac, normalizeSerial, pickMatch, shortHost } from "./reconcile";
import type { DiscoveredAsset } from "./types";

export type IngestResult =
  | { action: "created"; assetId: string }
  | { action: "updated"; assetId: string; reason: string }
  | { action: "conflict"; candidates: string[] }
  | { action: "unmatched" };

/** Zapíše jednu nalezenou položku do inventáře (vytvoří / aktualizuje / nahlásí konflikt). */
export async function ingestDiscovered(db: Db, item: DiscoveredAsset, companyId?: string): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const now = item.seenAt ?? new Date();
    const macs = (item.macAddresses ?? []).map((m) => normalizeMac(m)).filter((m): m is string => !!m);

    // 1) Známe tento záznam ze stejného zdroje?
    const [bySource] = await tx
      .select({ assetId: assetSources.assetId })
      .from(assetSources)
      .where(and(eq(assetSources.sourceType, item.sourceType), eq(assetSources.sourceRef, item.sourceRef), item.connectionId ? eq(assetSources.connectionId, item.connectionId) : isNull(assetSources.connectionId)));
    const targetCompany = item.companyId ?? companyId;

    let assetId = bySource?.assetId;
    let reason = "source";
    const host = shortHost(item.hostname);

    // Oprava dřívějšího chybného spojení (v1.103.1): dva záznamy stejného zdroje (např. dva agenti Wazuhu)
    // ukazují na jedno aktivum a tenhle má jiné jméno než aktivum → odpojit a párovat znovu.
    if (assetId && host) {
      const [cur] = await tx.select({ name: assets.name, hostname: assets.hostname, ipAddresses: assets.ipAddresses, macAddresses: assets.macAddresses }).from(assets).where(eq(assets.id, assetId));
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(assetSources)
        .where(and(eq(assetSources.assetId, assetId), eq(assetSources.sourceType, item.sourceType), sql`${assetSources.sourceRef} <> ${item.sourceRef}`));
      if (cur && (others?.n ?? 0) > 0 && shortHost(cur.name) !== host && shortHost(cur.name) !== null) {
        const mine = new Set([...(item.ipAddresses ?? []), ...macs]);
        await tx
          .update(assets)
          .set({ ipAddresses: cur.ipAddresses.filter((x) => !mine.has(x)), macAddresses: cur.macAddresses.filter((x) => !mine.has(normalizeMac(x) ?? x)), ...(shortHost(cur.hostname) === host ? { hostname: null, osName: null, osVersion: null, serialNumber: null } : {}) })
          .where(eq(assets.id, assetId));
        assetId = undefined;
      }
    }

    // 2) Heuristická shoda přes sériové číslo / MAC / hostname
    if (!assetId) {
      const serial = normalizeSerial(item.serialNumber);
      const idMacs = identityMacs(macs);
      const ips = item.matchByIp ? (item.ipAddresses ?? []).filter(isIdentityIp) : [];
      const arr = (xs: string[]) => sql`ARRAY[${sql.join(xs.map((m) => sql`${m}`), sql`, `)}]::text[]`;
      const conds = [
        serial ? eq(assets.serialNumber, serial) : undefined,
        idMacs.length ? sql`${assets.macAddresses} && ${arr(idMacs)}` : undefined,
        host ? sql`split_part(lower(${assets.hostname}), '.', 1) = ${host}` : undefined,
        ips.length ? sql`${assets.ipAddresses} && ${arr(ips)}` : undefined,
      ].filter((c) => c !== undefined);

      if (conds.length) {
        const candidates = await tx
          .select({
            id: assets.id,
            serialNumber: assets.serialNumber,
            macAddresses: assets.macAddresses,
            hostname: assets.hostname,
            ipAddresses: assets.ipAddresses,
          })
          .from(assets)
          .where(item.matchInCompany && targetCompany ? and(eq(assets.companyId, targetCompany), or(...conds)) : or(...conds))
          .limit(20);
        const match = pickMatch(item, candidates);
        if (match && "ambiguous" in match) return { action: "conflict", candidates: match.ambiguous };
        if (match) {
          assetId = match.id;
          reason = match.reason;
        }
      }
    }

    if (!assetId && item.createIfMissing === false) return { action: "unmatched" };
    if (assetId) {
      const [existing] = await tx.select().from(assets).where(eq(assets.id, assetId));
      if (!existing) throw new Error(`asset ${assetId} disappeared`);
      await tx.update(assets).set(mergeTechnical(existing, item)).where(eq(assets.id, assetId));
    } else {
      const [created] = await tx
        .insert(assets)
        .values({
          ...(targetCompany ? { companyId: targetCompany } : {}),
          name: item.name,
          assetType: item.assetType,
          assetClass: defaultAssetClass(item.assetType),
          hostname: item.hostname ?? null,
          fqdn: item.fqdn ?? null,
          ipAddresses: item.ipAddresses ?? [],
          macAddresses: macs,
          osName: item.osName ?? null,
          osVersion: item.osVersion ?? null,
          manufacturer: item.manufacturer ?? null,
          model: item.model ?? null,
          serialNumber: normalizeSerial(item.serialNumber),
          attributes: item.attributes ?? {},
          ...item.governance,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .returning({ id: assets.id });
      assetId = created!.id;
    }

    await tx
      .insert(assetSources)
      .values({ assetId, sourceType: item.sourceType, sourceRef: item.sourceRef, connectionId: item.connectionId ?? null, raw: item.raw, lastSyncedAt: now })
      .onConflictDoUpdate({
        target: [assetSources.sourceType, assetSources.sourceRef, assetSources.connectionId],
        set: { assetId, raw: item.raw, lastSyncedAt: now },
      });

    if (item.software) {
      await tx
        .delete(assetSoftware)
        .where(and(eq(assetSoftware.assetId, assetId), eq(assetSoftware.sourceType, item.sourceType)));
      for (let i = 0; i < item.software.length; i += 500) {
        const chunk = item.software.slice(i, i + 500).map((s) => ({
          assetId: assetId!,
          name: s.name,
          version: s.version ?? null,
          vendor: s.vendor ?? null,
          sourceType: item.sourceType,
        }));
        if (chunk.length) await tx.insert(assetSoftware).values(chunk);
      }
    }

    return bySource || reason !== "source"
      ? { action: "updated", assetId, reason }
      : { action: "created", assetId };
  });
}
