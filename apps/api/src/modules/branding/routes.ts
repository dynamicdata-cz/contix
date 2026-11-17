import { BRAND_LOGO_MAX_BYTES, BrandingInput } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { companies, companyBranding } from "../../db/schema";
import { brandingDto, imageSize, invalidateBrands } from "./service";

/* ============================================================
 * Vzhled výstupů (v1.59, ADR-154): GET / PUT / DELETE /api/branding/:companyId (Administrace → Společnosti).
 * ============================================================ */

export function brandingRoutes(db: Db) {
  const company = async (id: string) => {
    const [co] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, id));
    if (!co) throw new HTTPException(404, { message: "Společnost nenalezena" });
    return co;
  };
  return new Hono<AppEnv>()
    .get("/:companyId", requirePerm("admin:settings"), async (c) => {
      const co = await company(c.req.param("companyId"));
      return c.json(await brandingDto(db, co.id));
    })
    .put("/:companyId", requirePerm("admin:settings"), zValidator("json", BrandingInput), async (c) => {
      const co = await company(c.req.param("companyId"));
      const i = c.req.valid("json");
      const [prev] = await db.select().from(companyBranding).where(eq(companyBranding.companyId, co.id));
      let logo = prev?.logo ?? null;
      let logoWidth = prev?.logoWidth ?? null;
      let logoHeight = prev?.logoHeight ?? null;
      if (i.logo === null) logo = logoWidth = logoHeight = null;
      else if (i.logo) {
        const buf = Buffer.from(i.logo.split(",")[1]!, "base64");
        if (buf.length > BRAND_LOGO_MAX_BYTES) throw new HTTPException(400, { message: "Logo je větší než 400 kB" });
        const size = imageSize(buf);
        if (!size) throw new HTTPException(400, { message: "Logo se nepodařilo přečíst – nahrajte PNG nebo JPEG" });
        logo = i.logo;
        logoWidth = size.width;
        logoHeight = size.height;
      }
      const values = { logo, logoWidth, logoHeight, accentColor: i.accentColor ?? null, footerText: i.footerText ?? "", showName: i.showName ?? true, updatedAt: new Date() };
      await db.insert(companyBranding).values({ companyId: co.id, ...values }).onConflictDoUpdate({ target: companyBranding.companyId, set: values });
      invalidateBrands();
      await audit(db, { c, user: currentUser(c), action: "company.branding_updated", entityType: "company", entityId: co.id, details: { name: co.name, logo: !!logo, accentColor: values.accentColor, footerText: values.footerText } });
      return c.json(await brandingDto(db, co.id));
    })
    .delete("/:companyId", requirePerm("admin:settings"), async (c) => {
      const co = await company(c.req.param("companyId"));
      await db.delete(companyBranding).where(eq(companyBranding.companyId, co.id));
      invalidateBrands();
      await audit(db, { c, user: currentUser(c), action: "company.branding_removed", entityType: "company", entityId: co.id, details: { name: co.name } });
      return c.json(await brandingDto(db, co.id));
    });
}
