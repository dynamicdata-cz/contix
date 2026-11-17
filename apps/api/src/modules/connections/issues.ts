import { EXTERNAL_ISSUE_ENTITIES } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { hasPermIn } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { externalIssues, tasks } from "../../db/schema";
import { issueDtos, jiraClient, jiraFor } from "./jira";

/* ============================================================
 * Issue v JIRA k úkolům CONTIXu (v1.53, ADR-150): založení (oprávnění k úpravě úkolu) a přehled u úkolu.
 * ============================================================ */

const IssueInput = z.object({ entityType: z.enum(EXTERNAL_ISSUE_ENTITIES), entityId: z.string().uuid(), connectionId: z.string().uuid().optional() });

export function issueRoutes(db: Db, config: Config) {
  async function task(c: Context<AppEnv>, id: string, write: boolean) {
    const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!t || !hasPermIn(c, "actions:read", t.companyId)) throw new HTTPException(404, { message: "Úkol nenalezen" });
    if (write && !hasPermIn(c, "actions:write", t.companyId)) throw new HTTPException(403, { message: "Chybí oprávnění k úpravě úkolu" });
    return t;
  }
  return new Hono<AppEnv>()
    .get("/issues", requirePerm("actions:read"), zValidator("query", IssueInput.omit({ connectionId: true })), async (c) => {
      const q = c.req.valid("query");
      await task(c, q.entityId, false);
      return c.json(await issueDtos(db, q.entityType, q.entityId));
    })
    .post("/issues", requirePerm("actions:write"), zValidator("json", IssueInput), async (c) => {
      const i = c.req.valid("json");
      const t = await task(c, i.entityId, true);
      const conn = await jiraFor(db, config, t.companyId, i.connectionId);
      if (!conn) throw new HTTPException(400, { message: "JIRA není nastavena (Administrace → Konektory)." });
      if ((await issueDtos(db, i.entityType, i.entityId)).some((x) => x.connectionId === conn.id)) throw new HTTPException(409, { message: "Úkol už v této JIRA issue má." });
      const desc = [t.description ?? "", "", `CONTIX: úkol ${t.id}${t.dueDate ? `, termín ${t.dueDate}` : ""}`].join("\n").trim();
      let key: string;
      try {
        key = (await jiraClient(conn).create({ project: { key: conn.projectKey }, summary: t.title.slice(0, 250), description: desc, issuetype: { name: conn.issueType }, ...(t.dueDate ? { duedate: t.dueDate } : {}) })).key;
      } catch (e) {
        throw new HTTPException(502, { message: (e as Error).message });
      }
      await db.insert(externalIssues).values({ connectionId: conn.id, companyId: t.companyId, entityType: i.entityType, entityId: t.id, issueKey: key, issueUrl: `${conn.url}/browse/${key}`, createdById: currentUser(c).id });
      await audit(db, { c, user: currentUser(c), action: "jira.issue_created", entityType: "task", entityId: t.id, details: { issue: key, connection: conn.name } });
      return c.json(await issueDtos(db, i.entityType, i.entityId), 201);
    });
}
