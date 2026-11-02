import {
  AssetDismissInput,
  AssetInput,
  AssetMergeInput,
  AssetLinkInput,
  AssetListQuery,
  AssetPatch,
  AssetShareInput,
  defaultAssetClass,
  effectiveCia,
  type LinkedAssetDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, exists, getTableColumns, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import { assertScope, hasPermIn, inScope, scopeOf, targetCompany, visibleIds } from "../../auth/scope";
import { findDuplicates, mergeAssets } from "./duplicates";
import { dependenciesOf } from "./graph";
import { recomputeHealth } from "../vulnerabilities/service";
import type { Db } from "../../db/client";
import { assetCompanies, assetDuplicateDismissals, assetLinks, assetSoftware, assetSources, assets, users, type AssetRow } from "../../db/schema";
import { ApiError } from "../../lib/apiError";

/** Aktivum sdílené do některé ze společností (ADR-085) – podmínka pro dotazy nad `assets`. */
export function sharedInto(ids: string[]): SQL {
  if (!ids.length) return sql`false`;
  return sql`exists (select 1 from asset_companies ac where ac.asset_id = ${assets.id} and ac.company_id in (${sql.join(
    ids.map((x) => sql`${x}`),
    sql`, `,
  )}))`;
}
/** Společnosti, se kterými je aktivum sdílené (pole UUID jako text). */
export const sharedWithSql = sql<string[]>`coalesce((select array_agg(ac.company_id::text order by ac.company_id) from asset_companies ac where ac.asset_id = ${assets.id}), '{}')`;

/** Vidí požadavek aktivum? Vlastní společnost v rozsahu (u `group` i nadřazené), nebo sdílené do rozsahu. */
export async function assetVisible(db: Db, c: Context<AppEnv>, a: { id: string; companyId: string }, group = true): Promise<boolean> {
  const own = group ? (await visibleIds(db, c)).includes(a.companyId) : scopeOf(c).ids.includes(a.companyId);
  if (own) return true;
  const ids = scopeOf(c).ids;
  if (!ids.length) return false;
  const [x] = await db.select({ n: count() }).from(assetCompanies).where(and(eq(assetCompanies.assetId, a.id), inArray(assetCompanies.companyId, ids)));
  return (x?.n ?? 0) > 0;
}

export function assetRoutes(db: Db) {
  async function loadAsset(id: string) {
    const [a] = await db.select().from(assets).where(eq(assets.id, id));
    if (!a) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
    return a;
  }
  /** Aktivum v rozsahu požadavku (jinak 404). */
  async function scopedAsset(c: Context<AppEnv>, id: string) {
    const a = await loadAsset(id);
    assertScope(c, a.companyId, "Aktivum nenalezeno");
    return a;
  }

  /** assets:write = vše; assets:write_own = jen aktiva, kde je uživatel vlastníkem. */
  function assertCanEdit(c: Context<AppEnv>, a: Pick<AssetRow, "ownerUserId">) {
    if (hasPerm(c, "assets:write")) return;
    if (hasPerm(c, "assets:write_own") && a.ownerUserId === currentUser(c).id) return;
    throw new HTTPException(403, { message: "Nemáte oprávnění upravovat toto aktivum" });
  }

  const linkedCols = {
    id: assets.id,
    name: assets.name,
    assetType: assets.assetType,
    assetClass: assets.assetClass,
    criticality: assets.criticality,
    confidentiality: assets.confidentiality,
    integrity: assets.integrity,
    availability: assets.availability,
    note: assetLinks.note,
  };

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "assets"))
      .get("/", requirePerm("assets:read"), zValidator("query", AssetListQuery), async (c) => {
        const q = c.req.valid("query");
        const where: SQL[] = [];
        // withGroup: i aktiva nadřazených společností (sdílené služby holdingu) – pro výběr vazeb
        if (c.req.query("withGroup") === "1") where.push(or(inArray(assets.companyId, await visibleIds(db, c)), sharedInto(scopeOf(c).ids))!);
        // sdílená aktiva holdingu (ADR-085) patří do seznamu i společnostem, se kterými jsou sdílená
        else if (q.shared === "exclude") where.push(inScope(c, assets.companyId));
        else where.push(or(inScope(c, assets.companyId), sharedInto(scopeOf(c).ids))!);
        if (q.assetType) where.push(eq(assets.assetType, q.assetType));
        if (q.assetClass) where.push(eq(assets.assetClass, q.assetClass));
        if (q.criticality) where.push(eq(assets.criticality, q.criticality));
        if (q.ownerUserId) where.push(eq(assets.ownerUserId, q.ownerUserId));
        if (q.health) where.push(eq(assets.healthStatus, q.health));
        if (q.source)
          where.push(
            exists(
              db
                .select({ one: sql`1` })
                .from(assetSources)
                .where(and(eq(assetSources.assetId, assets.id), eq(assetSources.sourceType, q.source))),
            ),
          );
        if (q.q) {
          const like = `%${q.q}%`;
          where.push(
            or(
              ilike(assets.name, like),
              ilike(assets.hostname, like),
              ilike(assets.serialNumber, like),
              sql`array_to_string(${assets.ipAddresses}, ' ') ilike ${like}`,
            )!,
          );
        }
        const cond = where.length ? and(...where) : undefined;
        const [items, [total]] = await Promise.all([
          db
            .select({ ...getTableColumns(assets), ownerDisplayName: users.displayName, sharedWith: sharedWithSql })
            .from(assets)
            .leftJoin(users, eq(users.id, assets.ownerUserId))
            .where(cond)
            .orderBy(
              ...(q.sort === "risk"
                ? [
                    sql`case ${assets.healthStatus} when 'red' then 3 when 'orange' then 2 when 'green' then 1 else 0 end desc`,
                    desc(assets.vulnCritical),
                    desc(assets.vulnHigh),
                    asc(assets.name),
                  ]
                : [asc(assets.name)]),
            )
            .limit(q.limit)
            .offset(q.offset),
          db.select({ n: count() }).from(assets).where(cond),
        ]);
        return c.json({ items, total: total?.n ?? 0, limit: q.limit, offset: q.offset });
      })

      .get("/stats", requirePerm("assets:read"), async (c) => {
        const [byType, byCriticality, bySource, byClass, [noOwner]] = await Promise.all([
          db.select({ key: assets.assetType, n: count() }).from(assets).where(inScope(c, assets.companyId)).groupBy(assets.assetType),
          db.select({ key: assets.criticality, n: count() }).from(assets).where(inScope(c, assets.companyId)).groupBy(assets.criticality),
          db
            .select({ key: assetSources.sourceType, n: count() })
            .from(assetSources)
            .innerJoin(assets, eq(assets.id, assetSources.assetId))
            .where(inScope(c, assets.companyId))
            .groupBy(assetSources.sourceType),
          db.select({ key: assets.assetClass, n: count() }).from(assets).where(inScope(c, assets.companyId)).groupBy(assets.assetClass),
          db
            .select({ n: count() })
            .from(assets)
            .where(and(inScope(c, assets.companyId), sql`${assets.ownerUserId} is null and ${assets.ownerName} is null`)),
        ]);
        return c.json({ byType, byCriticality, bySource, byClass, withoutOwner: noOwner?.n ?? 0 });
      })

      /* ---------- duplicity (v0.20) ---------- */
      .get("/duplicates", requirePerm("assets:read"), async (c) => c.json(await findDuplicates(db, scopeOf(c).ids)))
      .post("/duplicates/dismiss", requirePerm("assets:write"), zValidator("json", AssetDismissInput), async (c) => {
        const { a, b } = c.req.valid("json");
        const [x, y] = await Promise.all([scopedAsset(c, a), scopedAsset(c, b)]);
        if (x.companyId !== y.companyId || a === b) throw new HTTPException(400, { message: "Neplatná dvojice" });
        const [lo, hi] = a < b ? [a, b] : [b, a];
        await db.insert(assetDuplicateDismissals).values({ companyId: x.companyId, assetA: lo, assetB: hi, dismissedById: currentUser(c).id }).onConflictDoNothing();
        await audit(db, { c, user: currentUser(c), action: "asset.duplicate_dismissed", entityType: "asset", entityId: a, details: { other: b, names: [x.name, y.name] } });
        return c.body(null, 204);
      })
      .post("/merge", requirePerm("assets:delete"), zValidator("json", AssetMergeInput), async (c) => {
        const { keepId, removeId, fillEmpty } = c.req.valid("json");
        if (keepId === removeId) throw new HTTPException(400, { message: "Vyberte dvě různá aktiva" });
        const [keep, remove] = await Promise.all([scopedAsset(c, keepId), scopedAsset(c, removeId)]);
        if (keep.companyId !== remove.companyId) throw new HTTPException(400, { message: "Sloučit lze jen aktiva téže společnosti" });
        if (!hasPermIn(c, "assets:write", keep.companyId) || !hasPermIn(c, "assets:delete", keep.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const r = await mergeAssets(db, keep, remove, fillEmpty ?? true);
        await recomputeHealth(db);
        await audit(db, { c, user: currentUser(c), action: "asset.merged", entityType: "asset", entityId: keep.id, details: { removedId: remove.id, removedName: remove.name, keptName: keep.name, ...r } });
        return c.json({ keepId: keep.id, ...r });
      })

      /* ---------- vazby primární ↔ podpůrná ---------- */
      .post("/links", zValidator("json", AssetLinkInput), async (c) => {
        const { primaryId, supportingId, note } = c.req.valid("json");
        if (primaryId === supportingId) throw new HTTPException(400, { message: "Aktivum nemůže podporovat samo sebe" });
        const [p, s] = await Promise.all([loadAsset(primaryId), loadAsset(supportingId)]);
        const vis = await visibleIds(db, c);
        if (!vis.includes(p.companyId) || !vis.includes(s.companyId)) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
        if (p.assetClass !== "primary") throw new ApiError(400, "err.assets.notPrimary", { name: String(p.name) });
        if (s.assetClass !== "supporting") throw new ApiError(400, "err.assets.notSupporting", { name: String(s.name) });
        try {
          assertCanEdit(c, p);
        } catch {
          assertCanEdit(c, s);
        }
        await db
          .insert(assetLinks)
          .values({ primaryId, supportingId, note: note ?? null })
          .onConflictDoUpdate({ target: [assetLinks.primaryId, assetLinks.supportingId], set: { note: note ?? null } });
        await recomputeHealth(db);
        await audit(db, { c, user: currentUser(c), action: "asset.linked", entityType: "asset", entityId: primaryId, details: { supportingId } });
        return c.json({ ok: true }, 201);
      })

      .delete(
        "/links",
        zValidator("query", z.object({ primaryId: z.string().uuid(), supportingId: z.string().uuid() })),
        async (c) => {
          const { primaryId, supportingId } = c.req.valid("query");
          const [p, s] = await Promise.all([loadAsset(primaryId), loadAsset(supportingId)]);
          try {
            assertCanEdit(c, p);
          } catch {
            assertCanEdit(c, s);
          }
          await db.delete(assetLinks).where(and(eq(assetLinks.primaryId, primaryId), eq(assetLinks.supportingId, supportingId)));
          await recomputeHealth(db);
          await audit(db, { c, user: currentUser(c), action: "asset.unlinked", entityType: "asset", entityId: primaryId, details: { supportingId } });
          return c.body(null, 204);
        },
      )

      .get("/:id", requirePerm("assets:read"), async (c) => {
        const id = c.req.param("id");
        const asset = await loadAsset(id);
        if (!(await assetVisible(db, c, asset))) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
        const sharedWith = (await db.select({ id: assetCompanies.companyId }).from(assetCompanies).where(eq(assetCompanies.assetId, id))).map((x) => x.id).sort();
        // sdílené aktivum upravuje jen vlastní společnost (ADR-085)
        const ownerInScope = scopeOf(c).ids.includes(asset.companyId);
        const owner = alias(users, "owner");
        const [sources, software, supports, supportedBy, [ownerRow]] = await Promise.all([
          db
            .select({ sourceType: assetSources.sourceType, sourceRef: assetSources.sourceRef, lastSyncedAt: assetSources.lastSyncedAt })
            .from(assetSources)
            .where(eq(assetSources.assetId, id))
            .orderBy(desc(assetSources.lastSyncedAt)),
          db
            .select({ name: assetSoftware.name, version: assetSoftware.version, vendor: assetSoftware.vendor })
            .from(assetSoftware)
            .where(eq(assetSoftware.assetId, id))
            .orderBy(asc(assetSoftware.name))
            .limit(1000),
          // primární aktiva, která toto (podpůrné) aktivum podporuje
          db
            .select(linkedCols)
            .from(assetLinks)
            .innerJoin(assets, eq(assets.id, assetLinks.primaryId))
            .where(eq(assetLinks.supportingId, id))
            .orderBy(asc(assets.name)),
          // podpůrná aktiva tohoto (primárního) aktiva
          db
            .select(linkedCols)
            .from(assetLinks)
            .innerJoin(assets, eq(assets.id, assetLinks.supportingId))
            .where(eq(assetLinks.primaryId, id))
            .orderBy(asc(assets.name)),
          asset.ownerUserId
            ? db
                .select({ id: owner.id, displayName: owner.displayName, email: owner.email })
                .from(owner)
                .where(eq(owner.id, asset.ownerUserId))
            : Promise.resolve([]),
        ]);
        return c.json({
          ...asset,
          owner: ownerRow ?? null,
          sources,
          software,
          supports: supports as LinkedAssetDto[],
          supportedBy: supportedBy as LinkedAssetDto[],
          ...(await dependenciesOf(db, id)),
          effectiveCia: effectiveCia(asset, supports),
          sharedWith,
          ownedHere: ownerInScope,
          canEdit: ownerInScope && (hasPerm(c, "assets:write") || (hasPerm(c, "assets:write_own") && asset.ownerUserId === currentUser(c).id)),
          canShare: ownerInScope && hasPermIn(c, "assets:write", asset.companyId),
        });
      })

      /** Sdílení aktiva s dalšími společnostmi holdingu (ADR-085) – nastavuje vlastní společnost aktiva. */
      .put("/:id/companies", requirePerm("assets:write"), zValidator("json", AssetShareInput), async (c) => {
        const a = await scopedAsset(c, c.req.param("id"));
        if (!hasPermIn(c, "assets:write", a.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        const ids = [...new Set(c.req.valid("json").companyIds)].filter((x) => x !== a.companyId);
        const accessible = scopeOf(c).accessible;
        if (ids.some((x) => !accessible.includes(x))) throw new HTTPException(400, { message: "Aktivum lze sdílet jen se společnostmi skupiny, ke kterým máte přístup." });
        const before = (await db.select({ id: assetCompanies.companyId }).from(assetCompanies).where(eq(assetCompanies.assetId, a.id))).map((x) => x.id);
        await db.transaction(async (tx) => {
          await tx.delete(assetCompanies).where(eq(assetCompanies.assetId, a.id));
          if (ids.length) await tx.insert(assetCompanies).values(ids.map((companyId) => ({ assetId: a.id, companyId })));
        });
        await audit(db, { c, user: currentUser(c), action: "asset.shared", entityType: "asset", entityId: a.id, details: { name: a.name, before, after: ids } });
        return c.json({ sharedWith: ids.sort() });
      })

      .post("/", requirePerm("assets:write", "assets:write_own"), zValidator("json", AssetInput), async (c) => {
        const { companyId: requested, ...input } = c.req.valid("json");
        const me = currentUser(c);
        const companyId = targetCompany(c, requested);
        // vlastník aktiva smí zakládat jen aktiva, kde je sám vlastníkem
        const ownerUserId = hasPerm(c, "assets:write") ? input.ownerUserId : me.id;
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(assets)
            .values({ ...input, companyId, ownerUserId, assetClass: input.assetClass ?? defaultAssetClass(input.assetType) })
            .returning();
          await tx.insert(assetSources).values({ assetId: row!.id, sourceType: "manual", sourceRef: row!.id });
          return row!;
        });
        await recomputeHealth(db);
        await audit(db, { c, user: me, action: "asset.created", entityType: "asset", entityId: created.id, details: { name: created.name } });
        return c.json(created, 201);
      })

      .patch("/:id", zValidator("json", AssetPatch), async (c) => {
        const existing = await scopedAsset(c, c.req.param("id"));
        assertCanEdit(c, existing);
        const patch = c.req.valid("json");
        if (!hasPerm(c, "assets:write") && patch.ownerUserId !== undefined && patch.ownerUserId !== existing.ownerUserId)
          throw new HTTPException(403, { message: "Vlastníka může měnit jen správce aktiv" });
        if (patch.assetClass && patch.assetClass !== existing.assetClass) {
          const [n] = await db
            .select({ n: count() })
            .from(assetLinks)
            .where(or(eq(assetLinks.primaryId, existing.id), eq(assetLinks.supportingId, existing.id)));
          if (n!.n > 0) throw new HTTPException(409, { message: "Třídu nelze změnit, dokud má aktivum vazby. Nejdřív je odeberte." });
        }
        if (!Object.keys(patch).length) return c.json(existing);
        const [row] = await db.update(assets).set(patch).where(eq(assets.id, existing.id)).returning();
        await recomputeHealth(db);
        const [fresh] = await db.select().from(assets).where(eq(assets.id, existing.id));
        await audit(db, { c, user: currentUser(c), action: "asset.updated", entityType: "asset", entityId: existing.id, details: patch });
        return c.json(fresh ?? row);
      })

      .delete("/:id", requirePerm("assets:delete"), async (c) => {
        await scopedAsset(c, c.req.param("id"));
        const [row] = await db
          .delete(assets)
          .where(eq(assets.id, c.req.param("id")))
          .returning({ id: assets.id, name: assets.name });
        if (!row) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
        await audit(db, { c, user: currentUser(c), action: "asset.deleted", entityType: "asset", entityId: row.id, details: { name: row.name } });
        return c.body(null, 204);
      })
  );
}
