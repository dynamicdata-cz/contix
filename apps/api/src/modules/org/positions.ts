import { PositionHandoverInput, POSITION_USAGE_KINDS, type Permission, type PositionUsageDto, type PositionUsageKind } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { orgUnits, positionHolders, positions, users } from "../../db/schema";

/* ============================================================
 * Funkční místo: vše, co vlastní, a předání na jiné místo (v1.10, ADR-106).
 * Registr `USAGE` = tabulka + sloupec s odkazem na místo + popisek + odkaz + oprávnění ke čtení / předání.
 * Čte se a předává jen to, k čemu má uživatel oprávnění ve společnosti místa (a modul je zapnutý).
 * ============================================================ */

type Def = { table: string; col: string; label: string; link: string; read: Permission; write: Permission; module: string };
const code = (c = "x.code", n = "x.name") => `coalesce(${c} || ' ', '') || ${n}`;
export const USAGE: Record<PositionUsageKind, Def> = {
  process: { table: "processes", col: "owner_position_id", label: code(), link: "'/processes/' || x.id", read: "processes:read", write: "processes:write", module: "processes" },
  risk: { table: "risks", col: "owner_position_id", label: code(), link: "'/risks/' || x.id", read: "risks:read", write: "risks:write", module: "risks" },
  risk_action: { table: "risk_treatment_actions", col: "owner_position_id", label: "x.title", link: "'/risks/' || x.risk_id || '?tab=treatment'", read: "risks:read", write: "risks:write", module: "risks" },
  control: { table: "controls", col: "owner_position_id", label: code(), link: "'/controls/' || x.id", read: "controls:read", write: "controls:write", module: "controls" },
  requirement: { table: "requirement_assessments", col: "owner_position_id", label: "x.requirement_id", link: "'/controls/soa'", read: "controls:read", write: "controls:write", module: "controls" },
  policy_owner: { table: "policies", col: "owner_position_id", label: code("x.code", "x.title"), link: "'/policies/' || x.id", read: "policies:read", write: "policies:write", module: "policies" },
  policy_reviewer: { table: "policies", col: "reviewer_position_id", label: code("x.code", "x.title"), link: "'/policies/' || x.id", read: "policies:read", write: "policies:write", module: "policies" },
  policy_approver: { table: "policies", col: "approver_position_id", label: code("x.code", "x.title"), link: "'/policies/' || x.id", read: "policies:read", write: "policies:write", module: "policies" },
  task: { table: "tasks", col: "owner_position_id", label: "x.title", link: "'/actions?task=' || x.id", read: "actions:read", write: "actions:write", module: "risks" },
  incident: { table: "incidents", col: "owner_position_id", label: code("x.code", "x.title"), link: "'/incidents/' || x.id", read: "incidents:read", write: "incidents:write", module: "incidents" },
  change: { table: "changes", col: "owner_position_id", label: code("x.code", "x.title"), link: "'/isms/changes/' || x.id", read: "isms:read", write: "isms:write", module: "isms" },
  isms_objective: { table: "isms_objectives", col: "owner_position_id", label: code("x.code", "x.title"), link: "'/isms'", read: "isms:read", write: "isms:write", module: "isms" },
  audit_auditor: { table: "audits", col: "auditor_position_id", label: code("x.code", "x.title"), link: "'/audits/' || x.id", read: "audits:read", write: "audits:write", module: "audits" },
  audit_finding: { table: "audit_findings", col: "owner_position_id", label: code("x.code", "x.title"), link: "'/audits/' || x.audit_id", read: "audits:read", write: "audits:write", module: "audits" },
  audit_request: { table: "audit_requests", col: "owner_position_id", label: "'#' || x.seq || ' ' || x.title", link: "'/audits/' || x.audit_id", read: "audits:read", write: "audits:write", module: "audits" },
  plan: { table: "continuity_plans", col: "owner_position_id", label: code(), link: "'/continuity/plans/' || x.id", read: "bia:read", write: "bia:write", module: "continuity" },
  exercise: { table: "exercises", col: "facilitator_position_id", label: "'CV-' || x.seq || ' ' || x.title", link: "'/continuity/exercises/' || x.id", read: "bia:read", write: "bia:write", module: "continuity" },
  activity: { table: "processing_activities", col: "owner_position_id", label: code(), link: "'/gdpr/' || x.id", read: "gdpr:read", write: "gdpr:write", module: "gdpr" },
  ai_owner: { table: "ai_systems", col: "owner_position_id", label: code(), link: "'/aiact/' || x.id", read: "aiact:read", write: "aiact:write", module: "aiact" },
  ai_oversight: { table: "ai_systems", col: "oversight_position_id", label: code(), link: "'/aiact/' || x.id", read: "aiact:read", write: "aiact:write", module: "aiact" },
  cra_product: { table: "cra_products", col: "owner_position_id", label: code(), link: "'/cra/' || x.id", read: "cra:read", write: "cra:write", module: "cra" },
  legal_review: { table: "legal_reviews", col: "owner_position_id", label: "'Posouzení změny ' || left(x.id::text, 8)", link: "'/legislation/reviews/' || x.id", read: "legislation:read", write: "legislation:write", module: "legislation" },
  legal_task: { table: "legal_tasks", col: "owner_position_id", label: "x.title", link: "'/legislation'", read: "legislation:read", write: "legislation:write", module: "legislation" },
  legal_watch: { table: "legal_watch", col: "owner_position_id", label: "coalesce((select a.code || ' ' || a.title from legal_acts a where a.id = x.act_id), 'Předpis')", link: "'/legislation/acts/' || x.act_id", read: "legislation:read", write: "legislation:write", module: "legislation" },
  info_review: { table: "info_item_reviews", col: "owner_position_id", label: "coalesce((select i.title from info_feed_items i where i.id = x.item_id), 'Varování')", link: "'/infoservice'", read: "legislation:read", write: "legislation:write", module: "legislation" },
  training: { table: "training_courses", col: "owner_position_id", label: code("x.code", "x.title"), link: "'/awareness/' || x.id", read: "awareness:read", write: "awareness:write", module: "awareness" },
  access_review: { table: "access_reviews", col: "reviewer_position_id", label: "x.name", link: "'/identity/reviews/' || x.id", read: "identity:read", write: "identity:write", module: "identity" },
  cycle: { table: "assessment_cycles", col: "leader_position_id", label: "x.title", link: "'/cycles/' || x.id", read: "risks:read", write: "risks:write", module: "risks" },
};
/** legal_watch nemá vlastní id – klíčem je act_id. */
const idExpr = (k: PositionUsageKind) => (k === "legal_watch" ? "x.act_id" : k === "requirement" ? "x.requirement_id" : "x.id");

async function positionRow(db: Db, id: string) {
  const [p] = await db.select({ id: positions.id, name: positions.name, unitName: orgUnits.name, companyId: orgUnits.companyId }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(positions.id, id));
  return p;
}

export function positionRoutes(db: Db) {
  return new Hono<AppEnv>()
    .use("/positions/*", requireModule(db, "organization"))
    .get("/positions/:id/detail", requirePerm("org:read"), zValidator("param", z.object({ id: z.string().uuid() })), async (c) => {
      const p = await positionRow(db, c.req.valid("param").id);
      if (!p) throw new HTTPException(404, { message: "Funkční místo nenalezeno" });
      assertScope(c, p.companyId, "Funkční místo nenalezeno");
      const mods = new Set((await getSettings(db)).enabledModules as string[]);
      const holders = await db.select({ id: users.id, name: users.displayName }).from(positionHolders).innerJoin(users, eq(users.id, positionHolders.userId)).where(eq(positionHolders.positionId, p.id));
      const groups: PositionUsageDto["groups"] = [];
      for (const kind of POSITION_USAGE_KINDS) {
        const d = USAGE[kind];
        if (!mods.has(d.module) || !hasPermIn(c, d.read, p.companyId)) continue;
        const rows = (await db.execute<{ id: string; label: string; link: string; n: number }>(
          sql.raw(`select ${idExpr(kind)}::text as id, (${d.label})::text as label, (${d.link})::text as link, count(*) over ()::int as n from ${d.table} x where x.${d.col} = '${p.id}'::uuid order by 2 limit 200`),
        )) as unknown as { id: string; label: string; link: string; n: number }[];
        if (rows.length) groups.push({ kind, items: rows.map(({ id, label, link }) => ({ id, label, link })), total: rows[0]!.n, canHandover: hasPermIn(c, d.write, p.companyId) });
      }
      const raci = mods.has("processes") && hasPermIn(c, "processes:read", p.companyId)
        ? ((await db.execute<{ process_id: string; process_name: string; step_name: string; role: string }>(sql`
            select pr.id as process_id, pr.name as process_name, s.name as step_name, r.role
            from step_raci r join process_steps s on s.id = r.step_id join processes pr on pr.id = s.process_id
            where r.party_kind = 'position' and r.party_id = ${p.id} order by pr.name, s."order"`)) as unknown as { process_id: string; process_name: string; step_name: string; role: string }[])
        : [];
      const dto: PositionUsageDto = { position: { ...p, holders }, groups, raci: raci.map((r) => ({ processId: r.process_id, processName: r.process_name, stepName: r.step_name, role: r.role })) };
      return c.json(dto);
    })
    /** Předání odpovědnosti na jiné místo téže společnosti – jen druhy, ke kterým má uživatel oprávnění k zápisu. */
    .post("/positions/:id/handover", requirePerm("org:write"), zValidator("param", z.object({ id: z.string().uuid() })), zValidator("json", PositionHandoverInput), async (c) => {
      const src = await positionRow(db, c.req.valid("param").id);
      if (!src) throw new HTTPException(404, { message: "Funkční místo nenalezeno" });
      assertScope(c, src.companyId, "Funkční místo nenalezeno");
      const v = c.req.valid("json");
      const dst = await positionRow(db, v.targetPositionId);
      if (!dst || dst.companyId !== src.companyId) throw new HTTPException(400, { message: "Cílové funkční místo musí patřit do stejné společnosti" });
      if (dst.id === src.id) throw new HTTPException(400, { message: "Cílové funkční místo je stejné jako zdrojové" });
      const mods = new Set((await getSettings(db)).enabledModules as string[]);
      const denied = v.kinds.filter((k) => !mods.has(USAGE[k].module) || !hasPermIn(c, USAGE[k].write, src.companyId));
      if (denied.length) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
      const moved: Partial<Record<PositionUsageKind, number>> = {};
      await db.transaction(async (tx) => {
        for (const k of v.kinds) {
          const d = USAGE[k];
          const r = (await tx.execute(sql.raw(`update ${d.table} set ${d.col} = '${dst.id}'::uuid where ${d.col} = '${src.id}'::uuid`))) as unknown as { count?: number };
          moved[k] = Number(r.count ?? 0);
        }
      });
      await audit(db, { c, user: currentUser(c), action: "org.position_handover", entityType: "position", entityId: src.id, details: { to: dst.id, toName: dst.name, moved, note: v.note ?? null } });
      return c.json({ moved });
    });
}
