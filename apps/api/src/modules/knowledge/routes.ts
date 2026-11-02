import { KnowledgeArticleInput, patchOf, type KnowledgeArticleDto, type KnowledgeStatus } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { knowledgeArticles, users } from "../../db/schema";

/* ============================================================
 * Znalostní články (v1.07, ADR-103): vlastní postupy, FAQ, runbooky. Zveřejněné se indexují do vektorů
 * (`collectRecordDocs`, druh knowledge, po úsecích) a slouží jako podklad hledání a odpovědí AI.
 * Koncepty vidí jen autoři (knowledge:write).
 * ============================================================ */

type Ctx = Context<AppEnv>;
const Patch = patchOf(KnowledgeArticleInput.omit({ companyId: true }));

export function knowledgeRoutes(db: Db) {
  const upd = alias(users, "kb_upd");
  async function list(c: Ctx, where?: ReturnType<typeof eq>): Promise<KnowledgeArticleDto[]> {
    const rows = await db
      .select({ a: knowledgeArticles, by: upd.displayName })
      .from(knowledgeArticles)
      .leftJoin(upd, eq(upd.id, knowledgeArticles.updatedById))
      .where(and(inScope(c, knowledgeArticles.companyId), where))
      .orderBy(desc(knowledgeArticles.updatedAt));
    return rows
      .filter(({ a }) => hasPermIn(c, "knowledge:read", a.companyId) && (a.status === "published" || hasPermIn(c, "knowledge:write", a.companyId)))
      .map(({ a, by }) => ({ id: a.id, companyId: a.companyId, title: a.title, body: a.body, tags: a.tags, status: a.status as KnowledgeStatus, updatedAt: a.updatedAt.toISOString(), updatedByName: by, canEdit: hasPermIn(c, "knowledge:write", a.companyId) }));
  }
  async function one(c: Ctx, id: string) {
    const [x] = await list(c, eq(knowledgeArticles.id, id));
    if (!x) throw new HTTPException(404, { message: "Článek nenalezen" });
    return x;
  }
  async function editable(c: Ctx, id: string) {
    const [a] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, id));
    if (!a) throw new HTTPException(404, { message: "Článek nenalezen" });
    assertScope(c, a.companyId, "Článek nenalezen");
    if (!hasPermIn(c, "knowledge:write", a.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return a;
  }
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "knowledge"))
    .get("/", requirePerm("knowledge:read"), zValidator("query", z.object({ q: z.string().trim().max(200).optional() })), async (c) => {
      const q = c.req.valid("query").q?.toLowerCase();
      const rows = await list(c);
      return c.json(q ? rows.filter((r) => `${r.title}\n${r.tags.join(" ")}\n${r.body}`.toLowerCase().includes(q)) : rows);
    })
    .get("/:id", requirePerm("knowledge:read"), zValidator("param", z.object({ id: z.string().uuid() })), async (c) => c.json(await one(c, c.req.valid("param").id)))
    .post("/", requirePerm("knowledge:write"), zValidator("json", KnowledgeArticleInput), async (c) => {
      const { companyId: requested, ...v } = c.req.valid("json");
      const companyId = targetCompany(c, requested, "knowledge:write");
      const me = currentUser(c);
      const [a] = await db.insert(knowledgeArticles).values({ ...v, companyId, createdById: me.id, updatedById: me.id }).returning({ id: knowledgeArticles.id });
      await audit(db, { c, user: me, action: "knowledge.created", entityType: "knowledge_article", entityId: a!.id, details: { title: v.title, status: v.status } });
      return c.json(await one(c, a!.id), 201);
    })
    .patch("/:id", requirePerm("knowledge:write"), zValidator("param", z.object({ id: z.string().uuid() })), zValidator("json", Patch), async (c) => {
      const a = await editable(c, c.req.valid("param").id);
      const set = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
      await db.update(knowledgeArticles).set({ ...set, updatedById: currentUser(c).id, updatedAt: new Date() }).where(eq(knowledgeArticles.id, a.id));
      await audit(db, { c, user: currentUser(c), action: "knowledge.updated", entityType: "knowledge_article", entityId: a.id, details: { fields: Object.keys(set), status: set.status } });
      return c.json(await one(c, a.id));
    })
    .delete("/:id", requirePerm("knowledge:write"), zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
      const a = await editable(c, c.req.valid("param").id);
      await db.delete(knowledgeArticles).where(eq(knowledgeArticles.id, a.id));
      // vektory článku zmizí při další synchronizaci indexu (zaniklé záznamy)
      await db.execute(sql`delete from record_vectors where kind = 'knowledge' and ref_id like ${`${a.id}#%`}`);
      await audit(db, { c, user: currentUser(c), action: "knowledge.deleted", entityType: "knowledge_article", entityId: a.id, details: { title: a.title } });
      return c.body(null, 204);
    });
}
