import { HTTPException } from "hono/http-exception";
import {
  ACTION_KINDS,
  TASK_LABELS,
  TASK_SOURCES,
  TASK_STATUSES,
  TaskInput,
  TaskPatch,
  summarizeActions,
  taskSourceLink,
  type ActionKind,
  type Permission,
  type TaskDto,
  type TaskSource,
  type TaskPriority,
  type TaskStatus,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { currentUser, requirePerm } from "../../auth/middleware";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import { assertScope, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import { orgUnits, positionHolders, positions, tasks, users } from "../../db/schema";
import { ApiError } from "../../lib/apiError";
import { tFor } from "../i18n/service";
import { loadActionItems, sourceLabels, type ActionScope } from "./service";
import { onPlaybookTaskDone } from "../soc/playbooks";

/* Akce a úkoly (ADR-043). */

type Ctx = Context<AppEnv>;
type Row = typeof tasks.$inferSelect;

/** Kdo smí číst který druh akcí: oprávnění + zapnutý modul. */
export const ACTION_ACCESS: Record<ActionKind, { perm: Permission; module: string | null }> = {
  task: { perm: "actions:read", module: null },
  risk_action: { perm: "risks:read", module: "risks" },
  audit_finding: { perm: "audits:read", module: "audits" },
  legal_task: { perm: "legislation:read", module: "legislation" },
};
const READ_PERMS = [...new Set(Object.values(ACTION_ACCESS).map((a) => a.perm))];

async function scopeFor(db: Db, c: Ctx): Promise<ActionScope> {
  const mods = new Set((await getSettings(db)).enabledModules as string[]);
  const ids = scopeOf(c).ids;
  return Object.fromEntries(ACTION_KINDS.map((k) => [k, !ACTION_ACCESS[k].module || mods.has(ACTION_ACCESS[k].module!) ? ids.filter((id) => hasPermIn(c, ACTION_ACCESS[k].perm, id)) : []])) as ActionScope;
}

const creator = alias(users, "task_creator");
const today = () => new Date().toISOString().slice(0, 10);

export function actionRoutes(db: Db) {
  const myPositions = async (c: Ctx) => new Set((await db.select({ p: positionHolders.positionId }).from(positionHolders).where(eq(positionHolders.userId, currentUser(c).id))).map((r) => r.p));

  async function dtos(c: Ctx, rows: Row[]): Promise<TaskDto[]> {
    if (!rows.length) return [];
    const [labels, pos, mine, cr] = await Promise.all([
      sourceLabels(db, rows.map((r) => ({ kind: r.sourceKind, id: r.sourceId }))),
      db
        .select({ id: positions.id, name: positions.name })
        .from(positions)
        .where(inArray(positions.id, rows.map((r) => r.ownerPositionId).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"]))),
      myPositions(c),
      db
        .select({ id: tasks.id, name: creator.displayName })
        .from(tasks)
        .leftJoin(creator, eq(creator.id, tasks.createdById))
        .where(inArray(tasks.id, rows.map((r) => r.id))),
    ]);
    const posName = new Map(pos.map((p) => [p.id, p.name]));
    const crName = new Map(cr.map((x) => [x.id, x.name]));
    return rows.map((r) => {
      const kind = r.sourceKind as TaskSource | null;
      const manage = hasPermIn(c, "actions:write", r.companyId);
      return {
        id: r.id,
        companyId: r.companyId,
        code: `#${r.seq}`,
        title: r.title,
        description: r.description,
        sourceKind: kind,
        sourceId: r.sourceId,
        sourceLabel: kind && r.sourceId ? (labels.get(`${kind}:${r.sourceId}`)?.label ?? null) : null,
        sourceLink: taskSourceLink(kind, r.sourceId),
        ownerPositionId: r.ownerPositionId,
        ownerName: r.ownerPositionId ? (posName.get(r.ownerPositionId) ?? null) : null,
        dueDate: r.dueDate,
        priority: r.priority as TaskPriority,
        status: r.status as TaskStatus,
        completedAt: r.completedAt?.toISOString() ?? null,
        completionNote: r.completionNote,
        createdByName: crName.get(r.id) ?? null,
        createdAt: r.createdAt.toISOString(),
        canManage: manage,
        canEdit: manage || (!!r.ownerPositionId && mine.has(r.ownerPositionId)),
      };
    });
  }

  async function rowOf(c: Ctx, id: string) {
    const [r] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!r) throw new ApiError(404, "err.task.notFound");
    assertScope(c, r.companyId, "Úkol nenalezen");
    return r;
  }
  const canRead = async (c: Ctx, r: Row) => hasPermIn(c, "actions:read", r.companyId) || (!!r.ownerPositionId && (await myPositions(c)).has(r.ownerPositionId));

  return new Hono<AppEnv>()
    .get(
      "/",
      requirePerm(...READ_PERMS),
      zValidator("query", z.object({ kind: z.enum(ACTION_KINDS).optional(), status: z.enum(["active", "done", "all"]).default("active"), mine: z.enum(["1"]).optional(), overdue: z.enum(["1"]).optional(), q: z.string().max(200).optional() })),
      async (c) => {
        const scope = await scopeFor(db, c);
        const all = await loadActionItems(db, scope, await tFor(db, c));
        const q = c.req.valid("query");
        const mine = q.mine ? await myPositions(c) : null;
        const s = q.q?.trim().toLowerCase();
        const items = all.filter(
          (a) =>
            (!q.kind || a.kind === q.kind) &&
            (q.status === "all" || (q.status === "done" ? a.status === "done" || a.status === "cancelled" : a.status === "open" || a.status === "in_progress")) &&
            (!mine || (a.ownerPositionId && mine.has(a.ownerPositionId))) &&
            (!q.overdue || a.overdue) &&
            (!s || `${a.title} ${a.source ?? ""} ${a.ownerName ?? ""}`.toLowerCase().includes(s)),
        );
        return c.json({ items, summary: summarizeActions(all, today()), kinds: ACTION_KINDS.filter((k) => (scope[k]?.length ?? 0) > 0) });
      },
    )
    .get("/export", requirePerm(...READ_PERMS), async (c) => {
      const t = await tFor(db, c);
      const items = await loadActionItems(db, await scopeFor(db, c), t);
      const esc = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
      const head = [t("act.csv.kind"), t("act.csv.title"), t("act.csv.source"), t("act.csv.owner"), t("act.csv.due"), t("act.csv.status"), t("act.csv.overdue")];
      const rows = items.map((a) =>
        [t.lbl(TASK_LABELS.kind[a.kind]), a.title, a.source ?? "", a.ownerName ?? "", a.dueDate ?? "", t.lbl(TASK_LABELS.status[a.status]), a.overdue ? t("act.csv.yes") : ""].map(esc).join(";"),
      );
      await audit(db, { c, user: currentUser(c), action: "report.exported", details: { report: "actions", count: items.length } });
      return c.body(`﻿${[head.map(esc).join(";"), ...rows].join("\r\n")}\r\n`, 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="akce-a-ukoly.csv"',
      });
    })
    /** Úkoly navázané na záznam (karta „Úkoly“ u incidentu, dodavatele, změny…). */
    .get("/tasks", requirePerm("actions:read"), zValidator("query", z.object({ sourceKind: z.enum(TASK_SOURCES), sourceId: z.string().uuid().optional() })), async (c) => {
      const q = c.req.valid("query");
      const ids = scopeOf(c).ids.filter((id) => hasPermIn(c, "actions:read", id));
      if (!ids.length) return c.json([]);
      const rows = await db
        .select()
        .from(tasks)
        .where(and(inArray(tasks.companyId, ids), eq(tasks.sourceKind, q.sourceKind), q.sourceId ? eq(tasks.sourceId, q.sourceId) : undefined))
        .orderBy(desc(tasks.createdAt));
      return c.json(await dtos(c, rows));
    })
    .get("/tasks/:id", requirePerm("actions:read", "obligations:self"), async (c) => {
      const r = await rowOf(c, c.req.param("id"));
      if (!(await canRead(c, r))) throw new ApiError(404, "err.task.notFound");
      return c.json((await dtos(c, [r]))[0]);
    })
    .post("/tasks", requirePerm("actions:write"), zValidator("json", TaskInput), async (c) => {
      const input = c.req.valid("json");
      let companyId: string;
      if (input.sourceKind && input.sourceId) {
        const src = (await sourceLabels(db, [{ kind: input.sourceKind, id: input.sourceId }])).get(`${input.sourceKind}:${input.sourceId}`);
        if (!src) throw new ApiError(404, "err.task.sourceNotFound");
        assertScope(c, src.companyId, "Záznam nenalezen");
        companyId = src.companyId;
        if (!hasPermIn(c, "actions:write", companyId)) throw new ApiError(403, "err.task.forbidden");
      } else companyId = targetCompany(c, input.companyId, "actions:write");
      if (input.sourceKind && !input.sourceId && input.sourceKind !== "isms_review") throw new ApiError(400, "err.task.sourceMissing");
      const done = input.status === "done";
      const [r] = await db
        .insert(tasks)
        .values({
          companyId,
          title: input.title,
          description: input.description ?? null,
          sourceKind: input.sourceKind ?? null,
          sourceId: input.sourceKind ? (input.sourceId ?? null) : null,
          ownerPositionId: input.ownerPositionId ?? null,
          dueDate: input.dueDate ?? null,
          priority: input.priority,
          status: input.status,
          completedAt: done ? new Date() : null,
          completionNote: input.completionNote ?? null,
          createdById: currentUser(c).id,
        })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "task.created", entityType: "task", entityId: r!.id, details: { title: r!.title, source: r!.sourceKind } });
      return c.json((await dtos(c, [r!]))[0], 201);
    })
    .patch("/tasks/:id", requirePerm("actions:write", "obligations:self"), zValidator("json", TaskPatch), async (c) => {
      const cur = await rowOf(c, c.req.param("id"));
      const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<Row>;
      const manage = hasPermIn(c, "actions:write", cur.companyId);
      if (!manage) {
        // držitel funkčního místa vlastníka smí měnit jen stav a poznámku k plnění
        if (!cur.ownerPositionId || !(await myPositions(c)).has(cur.ownerPositionId)) throw new ApiError(403, "err.task.forbidden");
        if (Object.keys(input).some((k) => k !== "status" && k !== "completionNote")) throw new ApiError(403, "err.task.ownerOnlyStatus");
      }
      if (input.status && input.status !== cur.status) input.completedAt = input.status === "done" ? new Date() : null;
      const [r] = await db.update(tasks).set(input).where(eq(tasks.id, cur.id)).returning();
      // úkol z playbooku alertu SOC → hotový krok (ADR-060)
      if (input.status === "done" && cur.status !== "done") await onPlaybookTaskDone(db, r!, currentUser(c).id);
      await audit(db, { c, user: currentUser(c), action: "task.updated", entityType: "task", entityId: cur.id, details: { fields: Object.keys(input), status: r!.status } });
      return c.json((await dtos(c, [r!]))[0]);
    })
    /** Hromadná změna úkolů (v1.10): stav (i vlastník místa), termín a vlastník (jen actions:write); každý úkol se ověří zvlášť. */
    .post(
      "/tasks/bulk",
      requirePerm("actions:write", "obligations:self"),
      zValidator("json", z.object({ ids: z.array(z.string().uuid()).min(1).max(200), status: z.enum(TASK_STATUSES).optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), ownerPositionId: z.string().uuid().nullable().optional() })),
      async (c) => {
        const { ids, ...patchIn } = c.req.valid("json");
        if (!Object.values(patchIn).some((v) => v !== undefined)) throw new HTTPException(400, { message: "Není co změnit" });
        const mine = await myPositions(c);
        let updated = 0;
        const skipped: string[] = [];
        for (const id of [...new Set(ids)]) {
          const [cur] = await db.select().from(tasks).where(eq(tasks.id, id));
          if (!cur || !scopeOf(c).ids.includes(cur.companyId)) {
            skipped.push(id);
            continue;
          }
          const manage = hasPermIn(c, "actions:write", cur.companyId);
          const own = !!cur.ownerPositionId && mine.has(cur.ownerPositionId);
          const set: Partial<Row> = {};
          if (patchIn.status !== undefined && (manage || own)) {
            set.status = patchIn.status;
            if (patchIn.status !== cur.status) set.completedAt = patchIn.status === "done" ? new Date() : null;
          }
          if (manage && patchIn.dueDate !== undefined) set.dueDate = patchIn.dueDate;
          if (manage && patchIn.ownerPositionId !== undefined) {
            if (patchIn.ownerPositionId) {
              const [p] = await db.select({ companyId: orgUnits.companyId }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(positions.id, patchIn.ownerPositionId));
              if (!p || p.companyId !== cur.companyId) {
                skipped.push(id);
                continue;
              }
            }
            set.ownerPositionId = patchIn.ownerPositionId;
          }
          if (!Object.keys(set).length) {
            skipped.push(id);
            continue;
          }
          const [r] = await db.update(tasks).set(set).where(eq(tasks.id, cur.id)).returning();
          if (set.status === "done" && cur.status !== "done") await onPlaybookTaskDone(db, r!, currentUser(c).id);
          updated++;
        }
        await audit(db, { c, user: currentUser(c), action: "task.bulk_updated", details: { updated, skipped: skipped.length, ...patchIn } });
        return c.json({ updated, skipped });
      },
    )
    .delete("/tasks/:id", requirePerm("actions:write"), async (c) => {
      const cur = await rowOf(c, c.req.param("id"));
      if (!hasPermIn(c, "actions:write", cur.companyId)) throw new ApiError(403, "err.task.forbidden");
      await db.delete(tasks).where(eq(tasks.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "task.deleted", entityType: "task", entityId: cur.id, details: { title: cur.title } });
      return c.body(null, 204);
    });
}

export { TASK_STATUSES };
