import type { BrandingDto } from "@contix/shared";
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { companies, companyBranding } from "../../db/schema";

/* ============================================================
 * Vzhled výstupů (v1.59, ADR-154). Nastavení se hledá u společnosti, pak u nadřazených.
 * Pro každý požadavek se načte do kontextu (AsyncLocalStorage) – tiskové stránky (printPage)
 * i převod do Wordu (htmlToDocx) ho použijí bez úprav jednotlivých exportů.
 * ============================================================ */

export interface Brand {
  companyName: string;
  logo: { data: Buffer; mime: "png" | "jpeg"; dataUrl: string; width: number; height: number } | null;
  accent: string | null;
  footerText: string;
  showName: boolean;
}

const store = new AsyncLocalStorage<Brand | null>();
/** Vzhled pro aktuální požadavek (null = výchozí vzhled CONTIX). */
export const currentBrand = (): Brand | null => store.getStore() ?? null;
/** Pro testy a dávkové výstupy: spustit s daným vzhledem. */
export const withBrand = <T>(b: Brand | null, fn: () => T) => store.run(b, fn);

/** Rozměry PNG / JPEG z hlavičky souboru (bez knihovny). */
export function imageSize(buf: Buffer): { width: number; height: number; mime: "png" | "jpeg" } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), mime: "png" };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      // SOF0–SOF15 kromě DHT (C4), JPG (C8), DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), mime: "jpeg" };
      i += 2 + len;
    }
  }
  return null;
}

type Row = typeof companyBranding.$inferSelect;
const cache = new Map<string, { at: number; brand: Brand | null }>();
const TTL = 60_000;
export const invalidateBrands = () => cache.clear();

/** Nastavení pro společnost: vlastní, jinak nejbližší nadřazené (nejvýš 10 úrovní). */
export async function resolveBranding(db: Db, companyId: string): Promise<{ row: Row | null; source: { id: string; name: string } | null; companyName: string }> {
  let id: string | null = companyId;
  let companyName = "";
  for (let depth = 0; id && depth < 10; depth++) {
    const [co] = await db.select({ id: companies.id, name: companies.name, parentId: companies.parentId }).from(companies).where(eq(companies.id, id));
    if (!co) break;
    if (depth === 0) companyName = co.name;
    const [row] = await db.select().from(companyBranding).where(eq(companyBranding.companyId, co.id));
    if (row) return { row, source: { id: co.id, name: co.name }, companyName };
    id = co.parentId;
  }
  return { row: null, source: null, companyName };
}

function toBrand(row: Row | null, companyName: string): Brand | null {
  if (!row) return null;
  let logo: Brand["logo"] = null;
  const m = row.logo?.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (m) {
    const data = Buffer.from(m[2]!, "base64");
    const size = imageSize(data);
    if (size) logo = { data, mime: size.mime, dataUrl: row.logo!, width: size.width, height: size.height };
  }
  return { companyName, logo, accent: row.accentColor, footerText: row.footerText, showName: row.showName };
}

export async function brandFor(db: Db, companyId: string): Promise<Brand | null> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL) return hit.brand;
  const r = await resolveBranding(db, companyId);
  const brand = toBrand(r.row, r.companyName);
  cache.set(companyId, { at: Date.now(), brand });
  return brand;
}

export async function brandingDto(db: Db, companyId: string): Promise<BrandingDto> {
  const r = await resolveBranding(db, companyId);
  const own = r.source?.id === companyId;
  return {
    companyId,
    own,
    sourceCompanyId: r.source?.id ?? null,
    sourceCompanyName: r.source?.name ?? null,
    logo: r.row?.logo ?? null,
    logoWidth: r.row?.logoWidth ?? null,
    logoHeight: r.row?.logoHeight ?? null,
    accentColor: r.row?.accentColor ?? null,
    footerText: r.row?.footerText ?? "",
    showName: r.row?.showName ?? true,
  };
}

/** Middleware: vzhled aktivní společnosti (nebo domovské) do kontextu požadavku. */
export const brandLoader =
  (db: Db): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const scope = c.get("auth")?.scope;
    const id = scope?.active ?? scope?.home ?? null;
    const brand = id ? await brandFor(db, id).catch(() => null) : null;
    await store.run(brand, () => next());
  };
