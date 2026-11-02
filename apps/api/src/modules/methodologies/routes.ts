import { auditableFrameworks, FRAMEWORK_CHECKLIST_PREFIX, BUILTIN_AUDIT_METHODOLOGIES,
  BUILTIN_METHODOLOGIES,
  BUILTIN_RISK_METHODOLOGY,
  getMethodology,
  ImportMethodologyInput,
  MethodologyDef,
  METHODOLOGY_FORMATS,
  registerMethodologies,
  unregisterMethodology,
  ZKB409_INFO,
  type MethodologyDto,
  type MethodologyFormat,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { getCompanies } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { audits, methodologies, risks } from "../../db/schema";
import { parseMethodology, serializeMethodology } from "./format";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * Metodiky analýzy rizik a auditu jako balíčky YAML / JSON / XML.
 * Definice se validuje (zod + kontrola vzorce a vazeb) a registruje do sdíleného
 * registru (@contix/shared), takže výpočet je stejný v API, dokumentech i UI.
 * ============================================================ */

let loaded: Promise<void> | null = null;

/** Načte importované metodiky z DB do registru (jednou za běh procesu). */
export function ensureMethodologies(db: Db): Promise<void> {
  loaded ??= db
    .select()
    .from(methodologies)
    .then((rows) => {
      const ok: MethodologyDef[] = [];
      for (const r of rows) {
        const p = MethodologyDef.safeParse(r.definition);
        if (p.success) ok.push(p.data);
        else console.warn(`Metodika ${r.id} v DB je neplatná – přeskočena.`);
      }
      registerMethodologies(ok);
    })
    .catch((e) => {
      loaded = null;
      throw e;
    });
  return loaded;
}
export const methodologyLoader = (db: Db): MiddlewareHandler => async (_c, next) => {
  await ensureMethodologies(db);
  await next();
};

const BUILTIN_IDS = new Set([BUILTIN_RISK_METHODOLOGY, ...BUILTIN_METHODOLOGIES.map((b) => b.id), ...BUILTIN_AUDIT_METHODOLOGIES.map((b) => b.id)]);
/** Číst metodiky smí, kdo pracuje s riziky nebo audity (libovolné z oprávnění). */
const READ = ["risks:read", "audits:read", "admin:settings"] as const;
const MIME: Record<MethodologyFormat, string> = { json: "application/json", yaml: "application/yaml", xml: "application/xml" };

export function methodologyRoutes(db: Db) {
  /** Počty použití: společnosti (politika rizik), rizika, audity. */
  async function usage(): Promise<Map<string, number>> {
    const [base, cos, r, a] = await Promise.all([
      getSettings(db),
      getCompanies(db),
      db.select({ k: risks.methodologyKey, n: sql<number>`count(*)::int` }).from(risks).groupBy(risks.methodologyKey),
      db.select({ k: audits.methodologyKey, n: sql<number>`count(*)::int` }).from(audits).groupBy(audits.methodologyKey),
    ]);
    const m = new Map<string, number>();
    const add = (k: string | null | undefined, n = 1) => k && m.set(k, (m.get(k) ?? 0) + Number(n));
    add(base.riskPolicy.methodology);
    for (const co of cos) add(co.overrides?.riskPolicy?.methodology);
    for (const x of [...r, ...a]) add(x.k, x.n);
    return m;
  }


  return new Hono<AppEnv>()
    .get("/", requirePerm(...READ), async (c) => {
      const [rows, use] = await Promise.all([db.select().from(methodologies), usage()]);
      const out: MethodologyDto[] = [
        { ...ZKB409_INFO, source: ZKB409_INFO.source, builtin: true, usage: use.get(ZKB409_INFO.id) ?? 0, definition: null, updatedAt: null },
        ...[...BUILTIN_METHODOLOGIES, ...BUILTIN_AUDIT_METHODOLOGIES].map((d) => ({
          id: d.id,
          kind: d.kind,
          name: d.name,
          version: d.version,
          description: d.description ?? null,
          source: d.source ?? null,
          builtin: true,
          usage: use.get(d.id) ?? 0,
          definition: d,
          updatedAt: null,
        })),
        // kontrolní seznamy auditu z rámců knihovny (ADR-080) – položky se generují z požadavků, definice se neposílá
        ...auditableFrameworks().map((f) => ({
          id: `${FRAMEWORK_CHECKLIST_PREFIX}${f.id}`,
          kind: "audit" as const,
          name: `Audit – ${f.name}`,
          version: f.version || "1",
          description: f.description || null,
          source: f.source || null,
          builtin: true,
          usage: use.get(`${FRAMEWORK_CHECKLIST_PREFIX}${f.id}`) ?? 0,
          definition: null,
          updatedAt: null,
        })),
        ...rows
          .sort((a, b) => a.name.localeCompare(b.name, "cs"))
          .map((r) => ({
            id: r.id,
            kind: r.kind as MethodologyDto["kind"],
            name: r.name,
            version: r.version,
            description: r.definition.description ?? null,
            source: r.definition.source ?? null,
            builtin: false,
            usage: use.get(r.id) ?? 0,
            definition: r.definition,
            updatedAt: r.updatedAt.toISOString(),
          })),
      ];
      return c.json(out);
    })
    .post("/validate", requirePerm("admin:settings"), zValidator("json", ImportMethodologyInput), async (c) => {
      const { format, content } = c.req.valid("json");
      const { def, errors } = parseMethodology(format, content);
      return c.json({ ok: !!def, errors, definition: def });
    })
    .post("/import", requirePerm("admin:settings"), zValidator("json", ImportMethodologyInput), async (c) => {
      const { format, content, replace } = c.req.valid("json");
      const { def, errors } = parseMethodology(format, content);
      if (!def) throw new ApiError(400, "err.meth.invalid", { errors: errors.join(" · ") });
      if (BUILTIN_IDS.has(def.id)) throw new ApiError(409, "err.meth.builtinId", { id: String(def.id) });
      const [cur] = await db.select({ id: methodologies.id, kind: methodologies.kind }).from(methodologies).where(eq(methodologies.id, def.id));
      if (cur && !replace) throw new ApiError(409, "err.meth.exists", { id: String(def.id) });
      if (cur && cur.kind !== def.kind) throw new HTTPException(409, { message: "Nahrazením nelze změnit druh metodiky." });
      const user = currentUser(c);
      const values = { kind: def.kind, name: def.name, version: def.version, format, source: content, definition: def };
      if (cur) await db.update(methodologies).set({ ...values, updatedAt: new Date() }).where(eq(methodologies.id, def.id));
      else await db.insert(methodologies).values({ id: def.id, ...values, createdById: user.id });
      registerMethodologies([def]);
      await audit(db, { c, user, action: cur ? "methodology.replaced" : "methodology.imported", entityType: "methodology", entityId: def.id, details: { name: def.name, version: def.version, format } });
      return c.json({ id: def.id, kind: def.kind, name: def.name }, cur ? 200 : 201);
    })
    .get("/:id/export", requirePerm(...READ), zValidator("query", z.object({ format: z.enum(METHODOLOGY_FORMATS).default("yaml") })), async (c) => {
      const id = c.req.param("id");
      const def = getMethodology(id);
      if (!def) throw new HTTPException(404, { message: "Metodika nenalezena (vestavěnou metodiku dle vyhlášky nastavíte v Nastavení)" });
      const { format } = c.req.valid("query");
      return c.body(serializeMethodology(def, format), 200, {
        "content-type": `${MIME[format]}; charset=utf-8`,
        "content-disposition": `attachment; filename="${def.id}.${format === "yaml" ? "yaml" : format}"`,
      });
    })
    .delete("/:id", requirePerm("admin:settings"), async (c) => {
      const id = c.req.param("id");
      if (BUILTIN_IDS.has(id)) throw new HTTPException(409, { message: "Vestavěnou metodiku nelze smazat." });
      const n = (await usage()).get(id) ?? 0;
      if (n) throw new ApiError(409, "err.meth.inUse", { n: String(n) });
      const [row] = await db.delete(methodologies).where(eq(methodologies.id, id)).returning({ name: methodologies.name });
      if (!row) throw new HTTPException(404, { message: "Metodika nenalezena" });
      unregisterMethodology(id);
      await audit(db, { c, user: currentUser(c), action: "methodology.deleted", entityType: "methodology", entityId: id, details: row });
      return c.body(null, 204);
    });
}
