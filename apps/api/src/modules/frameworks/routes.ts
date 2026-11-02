import {
  FRAMEWORK_EXPORT_FORMATS,
  FRAMEWORKS,
  FrameworkPack,
  isCustomFrameworkId,
  packOf,
  packToDto,
  registerCustomFrameworks,
  requirementsOf,
  type CustomFrameworkDto,
  type FrameworkLibraryItem,
  type FrameworkPackMetaInput,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { eq, like, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { controlRequirements, customFrameworks, evidenceRequirements, policyRequirements, requirementAssessments } from "../../db/schema";
import { FRAMEWORK_MAX_BYTES, parseFrameworkFile, serializeFramework } from "./format";

/* ============================================================
 * Knihovna rámců (ADR-079): vlastní rámce (zákony jiných států, normy, interní požadavky) – import, export, smazání.
 * Rámce jsou globální pro celou skupinu; registr (@contix/shared) se plní z DB a po každé změně se obnoví.
 * ============================================================ */

let loaded: Promise<void> | null = null;

/** Načte vlastní rámce z DB do registru (jednou za běh procesu, po změně znovu). */
export function ensureFrameworks(db: Db, force = false): Promise<void> {
  if (force) loaded = null;
  loaded ??= db
    .select()
    .from(customFrameworks)
    .then((rows) => {
      const ok: CustomFrameworkDto[] = [];
      for (const r of rows) {
        const p = FrameworkPack.safeParse(r.pack);
        if (p.success) ok.push(packToDto(p.data));
        else console.warn(`Rámec ${r.id} v DB je neplatný – přeskočen.`);
      }
      registerCustomFrameworks(ok);
    })
    .catch((e) => {
      loaded = null;
      throw e;
    });
  return loaded;
}
export const frameworkLoader = (db: Db): MiddlewareHandler => async (_c, next) => {
  await ensureFrameworks(db);
  await next();
};

/** Použití požadavků rámců (posouzení a vazby) podle ID rámce. */
async function usageByFramework(db: Db, onlyId?: string): Promise<Map<string, number>> {
  const fw = sql<string>`split_part(requirement_id, ':', 1)`;
  const tables = [requirementAssessments, controlRequirements, policyRequirements, evidenceRequirements] as const;
  const m = new Map<string, number>();
  for (const t of tables) {
    const q = db.select({ fw, n: sql<number>`count(*)::int` }).from(t);
    const rows = await (onlyId ? q.where(like(t.requirementId, `${onlyId}:%`)) : q).groupBy(fw);
    for (const r of rows) m.set(r.fw, (m.get(r.fw) ?? 0) + Number(r.n));
  }
  return m;
}

const READ = ["controls:read", "admin:settings"] as const;

export function frameworkRoutes(db: Db) {
  return (
    new Hono<AppEnv>()
      /** Vlastní rámce s požadavky pro registr ve webu – potřebuje každý přihlášený (výběry požadavků v celé aplikaci). */
      .get("/catalog", async (c) => {
        currentUser(c);
        return c.json(
          FRAMEWORKS.filter((f) => f.custom).map((meta) => ({ meta, requirements: requirementsOf(meta.id) }) satisfies CustomFrameworkDto),
        );
      })

      .get("/", requirePerm(...READ), async (c) => {
        const [rows, use] = await Promise.all([db.select({ id: customFrameworks.id, updatedAt: customFrameworks.updatedAt }).from(customFrameworks), usageByFramework(db)]);
        const imported = new Map(rows.map((r) => [r.id, r.updatedAt.toISOString()]));
        return c.json(
          FRAMEWORKS.map((f) => {
            const reqs = requirementsOf(f.id);
            return { ...f, requirements: reqs.length, sections: new Set(reqs.map((r) => r.section)).size, inScope: false, importedAt: imported.get(f.id) ?? null, assessed: use.get(f.id) ?? 0 } satisfies FrameworkLibraryItem;
          }),
        );
      })

      /** Import: náhled (mode=preview) nebo uložení (mode=commit). Metadata z formuláře doplní tabulku a přepíší hodnoty ze souboru. */
      .post("/import", requirePerm("admin:settings"), async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) throw new HTTPException(400, { message: "Vyberte soubor rámce." });
        if (file.size > FRAMEWORK_MAX_BYTES) throw new HTTPException(413, { message: "Soubor je větší než 15 MB" });
        let meta: Partial<FrameworkPackMetaInput> = {};
        if (typeof body.meta === "string" && body.meta.trim()) {
          try {
            const m = JSON.parse(body.meta) as Record<string, unknown>;
            meta = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== "" && v !== null && v !== undefined)) as Partial<FrameworkPackMetaInput>;
          } catch {
            throw new HTTPException(400, { message: "Neplatná metadata rámce." });
          }
        }
        const { pack, preview } = parseFrameworkFile(new Uint8Array(await file.arrayBuffer()), file.name, meta);
        if (preview.meta) {
          const id = preview.meta.id;
          const [cur] = await db.select().from(customFrameworks).where(eq(customFrameworks.id, id));
          preview.existing = !!cur;
          if (cur && pack) {
            const old = FrameworkPack.safeParse(cur.pack);
            const oldIds = new Set(old.success ? packToDto(old.data).requirements.map((r) => r.id) : []);
            const newIds = new Set(packToDto(pack).requirements.map((r) => r.id));
            const removed = [...oldIds].filter((x) => !newIds.has(x));
            let removedAssessed = 0;
            if (removed.length) {
              const [r] = await db.execute<{ n: number }>(
                sql`select count(*)::int as n from requirement_assessments where requirement_id in (${sql.join(
                  removed.map((x) => sql`${x}`),
                  sql`, `,
                )})`,
              );
              removedAssessed = Number(r?.n ?? 0);
            }
            preview.replace = { added: [...newIds].filter((x) => !oldIds.has(x)).length, removed: removed.length, kept: [...newIds].filter((x) => oldIds.has(x)).length, removedAssessed };
          }
        }
        if (body.mode !== "commit" || !pack) return c.json(preview);

        const id = preview.meta!.id;
        if (preview.existing && body.replace !== "true") throw new HTTPException(409, { message: "Rámec se stejným klíčem už v knihovně je – potvrďte nahrazení." });
        const user = currentUser(c);
        const values = { name: pack.name, pack: pack as unknown as Record<string, unknown>, requirementCount: pack.requirements.length, importedBy: user.id };
        if (preview.existing) await db.update(customFrameworks).set({ ...values, updatedAt: new Date() }).where(eq(customFrameworks.id, id));
        else await db.insert(customFrameworks).values({ id, ...values });
        await ensureFrameworks(db, true);
        await audit(db, {
          c,
          user,
          action: preview.existing ? "framework.replaced" : "framework.imported",
          entityType: "framework",
          entityId: id,
          details: { name: pack.name, jurisdiction: pack.jurisdiction, kind: pack.kind, format: preview.format, file: file.name, requirements: pack.requirements.length, mappings: preview.mappings, ...(preview.replace ? { replace: preview.replace } : {}) },
        });
        return c.json({ ...preview, ok: true }, preview.existing ? 200 : 201);
      })

      .get("/:id/export", requirePerm(...READ), zValidator("query", z.object({ format: z.enum(FRAMEWORK_EXPORT_FORMATS).default("yaml") })), async (c) => {
        const id = c.req.param("id");
        const meta = FRAMEWORKS.find((f) => f.id === id);
        if (!meta) throw new HTTPException(404, { message: "Rámec nenalezen" });
        const { format } = c.req.valid("query");
        const out = serializeFramework(packOf(meta, requirementsOf(meta.id)), format);
        const name = (meta.custom ? meta.id.slice(2) : meta.id).replace(/[^a-z0-9-]/g, "");
        return c.body(out.body, 200, { "content-type": out.mime, "content-disposition": `attachment; filename="contix-${name}.${out.ext}"` });
      })

      /** Smazání vlastního rámce; s posouzeními a vazbami jen s `force=true` (smažou se i ony). */
      .delete("/:id", requirePerm("admin:settings"), zValidator("query", z.object({ force: z.enum(["true", "false"]).default("false") })), async (c) => {
        const id = c.req.param("id");
        if (!isCustomFrameworkId(id)) throw new HTTPException(400, { message: "Vestavěný rámec nelze smazat." });
        const [cur] = await db.select({ id: customFrameworks.id, name: customFrameworks.name }).from(customFrameworks).where(eq(customFrameworks.id, id));
        if (!cur) throw new HTTPException(404, { message: "Rámec nenalezen" });
        const used = (await usageByFramework(db, id)).get(id) ?? 0;
        if (used && c.req.valid("query").force !== "true") throw new HTTPException(409, { message: "Rámec má posouzení nebo vazby – potvrďte smazání i s nimi." });
        await db.transaction(async (tx) => {
          for (const t of [requirementAssessments, controlRequirements, policyRequirements, evidenceRequirements]) await tx.delete(t).where(like(t.requirementId, `${id}:%`));
          await tx.delete(customFrameworks).where(eq(customFrameworks.id, id));
        });
        await ensureFrameworks(db, true);
        await audit(db, { c, user: currentUser(c), action: "framework.deleted", entityType: "framework", entityId: id, details: { name: cur.name, removedLinks: used } });
        return c.body(null, 204);
      })
  );
}
