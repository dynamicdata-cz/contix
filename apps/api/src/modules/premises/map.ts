/**
 * Mapa lokalit (v1.114, ADR-206): mapové podklady a dohledání souřadnic jdou přes server CONTIXu – prohlížeč dál
 * nekomunikuje s cizími servery (CSP „self“). Dlaždice se drží v paměti serveru, dohledání adres je omezené
 * na 1 dotaz za sekundu (pravidla OpenStreetMap Nominatim).
 */
import { CONTIX_VERSION, MAP_SETTINGS_KEY, MapSettingsInput, type GeocodeResult, type MapSettings } from "@contix/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { appSettings } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";

const UA = `CONTIX/${CONTIX_VERSION} (+https://github.com/dynamicdata-cz/contix)`;

export async function mapSettings(db: Db): Promise<MapSettings> {
  const [r] = await db.select().from(appSettings).where(eq(appSettings.key, MAP_SETTINGS_KEY));
  return MapSettingsInput.parse(r?.value ?? {});
}
export async function saveMapSettings(db: Db, v: MapSettings) {
  await db.insert(appSettings).values({ key: MAP_SETTINGS_KEY, value: v }).onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: new Date() } });
  tiles.clear();
  return mapSettings(db);
}

/* ---------- dlaždice ---------- */
const TILE_TTL = 7 * 86_400_000;
const TILE_MAX = 3000;
const tiles = new Map<string, { body: Uint8Array; type: string; at: number }>();
export const tileCacheSize = () => tiles.size;

export class MapError extends Error {
  constructor(
    public status: 400 | 404 | 502,
    message: string,
  ) {
    super(message);
  }
}

export async function mapTile(db: Db, z: number, x: number, y: number, fetchImpl: FetchLike = fetch as FetchLike, now = Date.now()) {
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new MapError(400, "Neplatná dlaždice");
  const s = await mapSettings(db);
  if (!s.enabled) throw new MapError(404, "Mapa je vypnutá");
  const key = `${s.tileUrl}|${z}/${x}/${y}`;
  const hit = tiles.get(key);
  if (hit && now - hit.at < TILE_TTL) {
    tiles.delete(key);
    tiles.set(key, hit); // naposledy použitá na konec
    return hit;
  }
  const url = s.tileUrl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { method: "GET", headers: { "user-agent": UA, accept: "image/png,image/jpeg,image/webp" } } as never);
  } catch {
    throw new MapError(502, "Mapové podklady nejsou dostupné");
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (!res.ok || !["image/png", "image/jpeg", "image/webp"].includes(type)) throw new MapError(502, "Mapové podklady nejsou dostupné");
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length > 1_000_000) throw new MapError(502, "Mapové podklady nejsou dostupné");
  const t = { body, type, at: now };
  tiles.set(key, t);
  while (tiles.size > TILE_MAX) tiles.delete(tiles.keys().next().value!);
  return t;
}

/* ---------- dohledání souřadnic ---------- */
let lastGeocode = 0;
export async function geocode(db: Db, query: string, fetchImpl: FetchLike = fetch as FetchLike, now = Date.now()): Promise<GeocodeResult | null> {
  const s = await mapSettings(db);
  if (!s.geocode) throw new MapError(404, "Dohledání souřadnic je vypnuté");
  if (now - lastGeocode < 1000) throw new MapError(400, "Zkuste to znovu za chvíli");
  lastGeocode = now;
  const u = new URL(s.geocodeUrl);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "1");
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(u.toString(), { method: "GET", headers: { "user-agent": UA, accept: "application/json", "accept-language": "cs" } } as never);
  } catch {
    throw new MapError(502, "Služba pro dohledání souřadnic není dostupná");
  }
  if (!res.ok) throw new MapError(502, "Služba pro dohledání souřadnic není dostupná");
  const list = (await res.json().catch(() => null)) as { lat?: string; lon?: string; display_name?: string }[] | null;
  const hit = Array.isArray(list) ? list[0] : undefined;
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, label: String(hit.display_name ?? "").slice(0, 300) };
}
/** jen pro testy */
export const resetMapState = () => {
  tiles.clear();
  lastGeocode = 0;
};
