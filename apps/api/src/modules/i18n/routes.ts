import { BUILTIN_PACKS, CS, LangPackInput, LOCALE_RE, localeChain, packCompleteness, type LangPack } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { languagePacks, users } from "../../db/schema";
import { readTable } from "../import/table";
import { allPacks, invalidatePacks, tFor } from "./service";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * Jazykové verze (ADR-036)
 *  veřejné: seznam jazyků, nahrané balíčky (přihlašovací obrazovka je potřebuje před přihlášením)
 *  přihlášené: volba jazyka uživatele; správa: nahrání / export / smazání balíčku (admin:settings)
 * ============================================================ */

const BUILTIN = new Set(BUILTIN_PACKS.map((p) => p.locale));
const MAX_FILE = 10 * 1024 * 1024;

export function i18nPublicRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const { packs, custom } = await allPacks(db);
      const s = await getSettings(db);
      return c.json({
        defaultLocale: packs.has(s.defaultLocale) ? s.defaultLocale : "cs",
        locales: [...packs.values()]
          .map((p) => ({ locale: p.locale, name: p.name, nativeName: p.nativeName, fallback: p.fallback ?? null, completeness: packCompleteness(p), builtin: BUILTIN.has(p.locale), custom: custom.has(p.locale), helpTopics: Object.keys(p.help ?? {}).length }))
          .sort((a, b) => (a.locale === "cs" ? -1 : b.locale === "cs" ? 1 : a.nativeName.localeCompare(b.nativeName))),
      });
    })
    /** Balíčky pro daný jazyk a jeho náhradní jazyky – jen ty, které nejsou celé vestavěné (klient má vestavěné v sobě). */
    .get("/packs/:locale", async (c) => {
      const locale = c.req.param("locale");
      if (!LOCALE_RE.test(locale)) throw new HTTPException(400, { message: "Neplatný jazyk" });
      const { packs, custom } = await allPacks(db);
      const chain = localeChain(locale, packs).filter((l) => custom.has(l));
      return c.json({ locale, packs: chain.map((l) => packs.get(l)!) }, 200, { "cache-control": "no-cache" });
    });
}

const MeLocaleInput = z.object({ locale: z.string().regex(LOCALE_RE).nullable() });

export function i18nRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      .patch("/i18n/me", zValidator("json", MeLocaleInput), async (c) => {
        const { locale } = c.req.valid("json");
        const { packs } = await allPacks(db);
        const t = await tFor(db, c);
        if (locale && !packs.has(locale)) throw new HTTPException(400, { message: t("err.i18n.unknownLocale") });
        await db.update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, currentUser(c).id));
        return c.json({ locale });
      })

      /** Šablona / export pro překladatele: klíč, čeština, angličtina, překlad. JSON = plný balíček včetně nápovědy. */
      .get("/i18n/admin/:locale/export", requirePerm("admin:settings"), async (c) => {
        const locale = c.req.param("locale");
        if (!LOCALE_RE.test(locale)) throw new HTTPException(400, { message: "Neplatný jazyk" });
        const { packs } = await allPacks(db);
        const p = packs.get(locale);
        const en = packs.get("en")!;
        if (c.req.query("format") === "json") {
          const pack: LangPack = p ?? { locale, name: locale, nativeName: locale, fallback: "en", messages: {}, help: {} };
          return c.body(JSON.stringify({ locale: pack.locale, name: pack.name, nativeName: pack.nativeName, fallback: pack.fallback ?? null, messages: pack.messages, help: pack.help ?? {} }, null, 2), 200, {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="contix-${locale}.json"`,
          });
        }
        const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
        const lines = [["key", "cs", "en", locale].map(esc).join(";")];
        for (const k of Object.keys(CS)) lines.push([k, CS[k as keyof typeof CS], en.messages[k] ?? "", p?.messages[k] ?? ""].map(esc).join(";"));
        return c.body(`﻿${lines.join("\r\n")}\r\n`, 200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="contix-${locale}.csv"`,
        });
      })

      /** Nahrání balíčku: JSON (celý balíček) nebo CSV/XLSX (sloupce key + sloupec s kódem jazyka). */
      .post("/i18n/admin", requirePerm("admin:settings"), async (c) => {
        const body = await c.req.parseBody();
        const f = body.file;
        if (!(f instanceof File) || !f.size) throw new HTTPException(400, { message: "Vyberte soubor (JSON, CSV nebo XLSX)." });
        if (f.size > MAX_FILE) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 10 MB)." });
        const buf = new Uint8Array(await f.arrayBuffer());
        let input: unknown;
        if (/\.json$/i.test(f.name)) {
          try {
            input = JSON.parse(new TextDecoder().decode(buf));
          } catch {
            throw new HTTPException(400, { message: "Soubor není platný JSON." });
          }
        } else {
          const locale = String(body.locale ?? "").trim();
          const tbl = readTable(buf, f.name);
          const ki = tbl.headers.findIndex((h) => h.toLowerCase() === "key");
          const vi = tbl.headers.findIndex((h) => h === locale);
          if (ki < 0 || vi < 0) throw locale ? new ApiError(400, "err.i18n.missingColumns", { locale }) : new ApiError(400, "err.i18n.missingColumnsNoLocale");
          const messages: Record<string, string> = {};
          for (const r of tbl.rows) if (r[ki] && r[vi]) messages[r[ki]!] = r[vi]!;
          input = { locale, name: body.name, nativeName: body.nativeName, fallback: body.fallback || null, messages };
        }
        const p = LangPackInput.safeParse(input);
        if (!p.success) throw new ApiError(400, "err.i18n.invalidPack", { path: String(p.error.issues[0]?.path.join(".")), issue: String(p.error.issues[0]?.message) });
        const v = p.data;
        // neznámé klíče se zahodí (překlep ani starý klíč nic nerozbije)
        const known = new Set(Object.keys(CS));
        const messages = Object.fromEntries(Object.entries(v.messages).filter(([k, m]) => known.has(k) && m.trim()));
        const ignored = Object.keys(v.messages).length - Object.keys(messages).length;
        await db
          .insert(languagePacks)
          .values({ locale: v.locale, name: v.name, nativeName: v.nativeName, fallback: v.fallback ?? null, messages, help: v.help ?? null, updatedBy: currentUser(c).id })
          .onConflictDoUpdate({ target: languagePacks.locale, set: { name: v.name, nativeName: v.nativeName, fallback: v.fallback ?? null, messages, help: v.help ?? null, updatedBy: currentUser(c).id, updatedAt: new Date() } });
        invalidatePacks();
        const { packs } = await allPacks(db);
        await audit(db, { c, user: currentUser(c), action: "i18n.pack_uploaded", entityType: "language_pack", details: { locale: v.locale, messages: Object.keys(messages).length, ignored } });
        return c.json({ locale: v.locale, messages: Object.keys(messages).length, ignored, completeness: packCompleteness(packs.get(v.locale)!) }, 201);
      })
      .delete("/i18n/admin/:locale", requirePerm("admin:settings"), async (c) => {
        const locale = c.req.param("locale");
        await db.delete(languagePacks).where(eq(languagePacks.locale, locale));
        invalidatePacks();
        await audit(db, { c, user: currentUser(c), action: "i18n.pack_deleted", entityType: "language_pack", details: { locale } });
        return c.body(null, 204);
      })
  );
}
