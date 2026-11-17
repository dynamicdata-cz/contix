import {
  MAP_CONVERT_EXTENSIONS,
  MAP_FILE_EXTENSIONS,
  MAP_MAX_BYTES,
  MapPlacementInput,
  SOC_OPEN_STATUSES,
  SiteMapInput,
  isAcceptable,
  markerCounts,
  markerStatus,
  riskScore,
  type MapPlacementDto,
  type SiteMapDetailDto,
  type SiteMapDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { alertSuggestions, assetVulnerabilities, assets, incidentAssets, incidents, mapPlacements, riskAssets, risks, siteMaps, vulnIntel } from "../../db/schema";
import { safeFilename } from "../assurance/routes";
import { convertToImage, converterEnabled } from "../policies/convert";
import { effLevelSql } from "../soc/exposure";

/* ============================================================
 * Mapy a půdorysy (v1.25, ADR-122): podklad + umístění aktiv; semafor `markerStatus` se počítá při čtení
 * z incidentů, alertů SOC, zranitelností, rizik a stavu aktiva. PDF / DXF / DWG převádí převodní služba.
 * ============================================================ */

type Ctx = Context<AppEnv>;
export type MapImageConverter = (buf: Uint8Array, filename: string) => Promise<{ data: Uint8Array; mime: string }>;

const RASTER: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };

/** Semafor pro zadaná aktiva – dávkově (bez dotazů v cyklu). */
export async function markerData(db: Db, companyId: string, assetIds: string[]) {
  const out = new Map<string, ReturnType<typeof markerStatus>>();
  if (!assetIds.length) return out;
  const policy = (await settingsFor(db, null, companyId)).riskPolicy;
  const [health, inc, al, vul, rk] = await Promise.all([
    db.select({ id: assets.id, h: assets.healthStatus }).from(assets).where(inArray(assets.id, assetIds)),
    db
      .select({ id: incidentAssets.targetId, n: sql<number>`count(distinct ${incidents.id})::int` })
      .from(incidentAssets)
      .innerJoin(incidents, eq(incidents.id, incidentAssets.incidentId))
      .where(and(inArray(incidentAssets.targetId, assetIds), notInArray(incidents.status, ["resolved", "closed"]), ne(incidents.kind, "event")))
      .groupBy(incidentAssets.targetId),
    db
      .select({ id: alertSuggestions.assetId, n: sql<number>`count(*)::int`, high: sql<number>`count(*) filter (where ${effLevelSql} >= 10)::int` })
      .from(alertSuggestions)
      .where(and(inArray(alertSuggestions.assetId, assetIds), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])))
      .groupBy(alertSuggestions.assetId),
    db
      .select({
        id: assetVulnerabilities.assetId,
        kev: sql<number>`count(*) filter (where coalesce(${vulnIntel.kev}, false))::int`,
        crit: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} in ('critical', 'high'))::int`,
      })
      .from(assetVulnerabilities)
      .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
      .where(and(inArray(assetVulnerabilities.assetId, assetIds), eq(assetVulnerabilities.status, "open")))
      .groupBy(assetVulnerabilities.assetId),
    db
      .select({ id: riskAssets.assetId, r: risks })
      .from(riskAssets)
      .innerJoin(risks, eq(risks.id, riskAssets.riskId))
      .where(and(inArray(riskAssets.assetId, assetIds), ne(risks.status, "closed"))),
  ]);
  const unacc = new Map<string, number>();
  for (const x of rk) {
    const lvl = riskScore(policy, x.r, x.r.scaleLevels).level;
    if (lvl && !isAcceptable(policy, lvl, x.r.methodologyKey)) unacc.set(x.id, (unacc.get(x.id) ?? 0) + 1);
  }
  for (const a of health) {
    const i = inc.find((x) => x.id === a.id);
    const l = al.find((x) => x.id === a.id);
    const v = vul.find((x) => x.id === a.id);
    out.set(a.id, markerStatus({ health: a.h, openIncidents: i?.n ?? 0, alerts: l?.n ?? 0, alertsHigh: l?.high ?? 0, kev: v?.kev ?? 0, critVulns: v?.crit ?? 0, risksUnacceptable: unacc.get(a.id) ?? 0 }));
  }
  return out;
}

export function siteMapRoutes(db: Db, deps: { toImage?: MapImageConverter } = {}) {
  const meta = {
    id: siteMaps.id,
    companyId: siteMaps.companyId,
    name: siteMaps.name,
    site: siteMaps.site,
    building: siteMaps.building,
    floor: siteMaps.floor,
    fileName: siteMaps.fileName,
    imageMime: siteMaps.imageMime,
    createdAt: siteMaps.createdAt,
  };
  type MetaRow = { id: string; companyId: string; name: string; site: string | null; building: string | null; floor: string | null; fileName: string; imageMime: string; createdAt: Date };

  async function load(c: Ctx, id: string, write = false) {
    const [m] = await db.select(meta).from(siteMaps).where(eq(siteMaps.id, id));
    if (!m) throw new HTTPException(404, { message: "Mapa nenalezena" });
    assertScope(c, m.companyId, "Mapa nenalezena");
    if (write && !hasPermIn(c, "assets:write", m.companyId)) throw new HTTPException(403, { message: "Nedostatečné oprávnění" });
    return m;
  }

  async function placementsOf(mapIds: string[]) {
    if (!mapIds.length) return [];
    return db
      .select({ mapId: mapPlacements.mapId, assetId: mapPlacements.assetId, x: mapPlacements.x, y: mapPlacements.y, name: assets.name, assetType: assets.assetType, companyId: assets.companyId })
      .from(mapPlacements)
      .innerJoin(assets, eq(assets.id, mapPlacements.assetId))
      .where(inArray(mapPlacements.mapId, mapIds))
      .orderBy(asc(assets.name));
  }

  async function dtos(rows: MetaRow[], withPlacements: boolean): Promise<SiteMapDetailDto[]> {
    const pl = await placementsOf(rows.map((r) => r.id));
    const byCompany = new Map<string, string[]>();
    for (const p of pl) byCompany.set(p.companyId, [...(byCompany.get(p.companyId) ?? []), p.assetId]);
    const status = new Map<string, ReturnType<typeof markerStatus>>();
    for (const [co, ids] of byCompany) for (const [k, v] of await markerData(db, co, [...new Set(ids)])) status.set(k, v);
    return rows.map((m) => {
      const placements: MapPlacementDto[] = pl
        .filter((p) => p.mapId === m.id)
        .map((p) => {
          const s = status.get(p.assetId) ?? { status: "unknown" as const, reasons: [] };
          return { assetId: p.assetId, name: p.name, assetType: p.assetType, x: p.x, y: p.y, status: s.status, reasons: s.reasons };
        });
      return { ...m, createdAt: m.createdAt.toISOString(), counts: markerCounts(placements), placements: withPlacements ? placements : [] };
    });
  }

  const toImage: MapImageConverter | null = deps.toImage ?? (converterEnabled() ? convertToImage : null);

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "assets"))
    .get("/", requirePerm("assets:read"), async (c) => {
      const rows = await db.select(meta).from(siteMaps).where(inScope(c, siteMaps.companyId)).orderBy(asc(siteMaps.site), asc(siteMaps.building), asc(siteMaps.floor), asc(siteMaps.name));
      const list = await dtos(rows, false);
      return c.json(list.map(({ placements: _, ...x }) => x) as SiteMapDto[]);
    })
    /** Mapy, na kterých je aktivum umístěné (detail aktiva). */
    .get("/by-asset/:assetId", requirePerm("assets:read"), async (c) => {
      const rows = await db
        .select({ id: siteMaps.id, name: siteMaps.name, building: siteMaps.building, floor: siteMaps.floor, companyId: siteMaps.companyId })
        .from(mapPlacements)
        .innerJoin(siteMaps, eq(siteMaps.id, mapPlacements.mapId))
        .where(and(eq(mapPlacements.assetId, c.req.param("assetId")), inScope(c, siteMaps.companyId)));
      return c.json(rows);
    })
    .post("/", requirePerm("assets:write"), async (c) => {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
      if (file.size > MAP_MAX_BYTES) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 30 MB)" });
      const v = SiteMapInput.safeParse({ name: body.name, site: body.site || null, building: body.building || null, floor: body.floor || null });
      if (!v.success) throw new HTTPException(400, { message: "Vyplňte název mapy" });
      const companyId = targetCompany(c, typeof body.companyId === "string" && body.companyId ? body.companyId : null, "assets:write");
      const name = safeFilename(file.name);
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      if (!(MAP_FILE_EXTENSIONS as readonly string[]).includes(ext)) throw new HTTPException(400, { message: "Nepodporovaný formát – PDF, PNG, JPG, SVG, WEBP, DXF nebo DWG" });
      const buf = Buffer.from(await file.arrayBuffer());
      let image: Buffer;
      let imageMime: string;
      if ((MAP_CONVERT_EXTENSIONS as readonly string[]).includes(ext)) {
        if (!toImage) throw new HTTPException(409, { message: "Převodní služba není nastavena (CONVERTER_URL) – nahrajte mapu jako PNG, JPG nebo SVG." });
        try {
          const r = await toImage(new Uint8Array(buf), name);
          image = Buffer.from(r.data);
          imageMime = r.mime;
        } catch (e) {
          throw new HTTPException(422, { message: `Podklad se nepodařilo převést: ${(e as Error).message}`.slice(0, 300) });
        }
      } else {
        image = buf;
        imageMime = RASTER[ext]!;
      }
      const [m] = await db
        .insert(siteMaps)
        .values({ ...v.data, companyId, fileName: name, fileMime: (MAP_CONVERT_EXTENSIONS as readonly string[]).includes(ext) ? (ext === "pdf" ? "application/pdf" : `image/vnd.${ext}`) : imageMime, fileSha256: createHash("sha256").update(buf).digest("hex"), original: buf, image, imageMime, createdById: currentUser(c).id })
        .returning({ id: siteMaps.id });
      await audit(db, { c, user: currentUser(c), action: "map.created", entityType: "site_map", entityId: m!.id, details: { name: v.data.name, file: name, size: buf.length } });
      return c.json((await dtos([await load(c, m!.id)], true))[0], 201);
    })
    .get("/:id", requirePerm("assets:read"), async (c) => c.json((await dtos([await load(c, c.req.param("id"))], true))[0]))
    /** Obrázek pro zobrazení – jen jako obrázek (SVG bez skriptů: CSP sandbox). */
    .get("/:id/image", requirePerm("assets:read"), async (c) => {
      const m = await load(c, c.req.param("id"));
      const [row] = await db.select({ image: siteMaps.image }).from(siteMaps).where(eq(siteMaps.id, m.id));
      return new Response(new Uint8Array(row!.image), {
        headers: {
          "content-type": m.imageMime,
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
          "cache-control": "private, max-age=300",
        },
      });
    })
    /** Původní soubor (PDF, DWG…) – jen jako příloha. */
    .get("/:id/original", requirePerm("assets:read"), async (c) => {
      const m = await load(c, c.req.param("id"));
      const [row] = await db.select({ original: siteMaps.original, mime: siteMaps.fileMime }).from(siteMaps).where(eq(siteMaps.id, m.id));
      return new Response(new Uint8Array(row!.original), {
        headers: {
          "content-type": row!.mime,
          "content-disposition": `attachment; filename="${m.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(m.fileName)}`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'",
          "cache-control": "private, no-store",
        },
      });
    })
    .patch("/:id", requirePerm("assets:write"), zValidator("json", SiteMapInput.partial()), async (c) => {
      const m = await load(c, c.req.param("id"), true);
      const v = c.req.valid("json");
      await db.update(siteMaps).set({ ...v, updatedAt: new Date() }).where(eq(siteMaps.id, m.id));
      await audit(db, { c, user: currentUser(c), action: "map.updated", entityType: "site_map", entityId: m.id, details: v });
      return c.json((await dtos([await load(c, m.id)], true))[0]);
    })
    .delete("/:id", requirePerm("assets:write"), async (c) => {
      const m = await load(c, c.req.param("id"), true);
      await db.delete(siteMaps).where(eq(siteMaps.id, m.id));
      await audit(db, { c, user: currentUser(c), action: "map.deleted", entityType: "site_map", entityId: m.id, details: { name: m.name } });
      return c.json({ ok: true });
    })
    .put("/:id/placements/:assetId", requirePerm("assets:write"), zValidator("json", MapPlacementInput), async (c) => {
      const m = await load(c, c.req.param("id"), true);
      const [a] = await db.select({ id: assets.id, companyId: assets.companyId }).from(assets).where(eq(assets.id, c.req.param("assetId")));
      if (!a || a.companyId !== m.companyId) throw new HTTPException(400, { message: "Aktivum nepatří do společnosti mapy" });
      const v = c.req.valid("json");
      await db
        .insert(mapPlacements)
        .values({ mapId: m.id, assetId: a.id, x: v.x, y: v.y })
        .onConflictDoUpdate({ target: [mapPlacements.mapId, mapPlacements.assetId], set: { x: v.x, y: v.y, updatedAt: new Date() } });
      await audit(db, { c, user: currentUser(c), action: "map.asset_placed", entityType: "site_map", entityId: m.id, details: { assetId: a.id } });
      return c.json((await dtos([m], true))[0]);
    })
    .delete("/:id/placements/:assetId", requirePerm("assets:write"), async (c) => {
      const m = await load(c, c.req.param("id"), true);
      await db.delete(mapPlacements).where(and(eq(mapPlacements.mapId, m.id), eq(mapPlacements.assetId, c.req.param("assetId"))));
      await audit(db, { c, user: currentUser(c), action: "map.asset_removed", entityType: "site_map", entityId: m.id, details: { assetId: c.req.param("assetId") } });
      return c.json((await dtos([m], true))[0]);
    });
}
