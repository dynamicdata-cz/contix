import {
  SOC_PLAYBOOKS,
  ancestorsOf,
  SocPlaybookInput,
  SocPlaybookPatch,
  SocPlaybookTasksInput,
  builtinView,
  customPlaybookId,
  customPlaybookKey,
  pickPlaybook,
  playbookView,
  type SocPlaybookDto,
  type SocPlaybookTask,
  type SocPlaybookView,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, getCompanies, hasPermIn, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { alertSuggestions, orgUnits, positions, socPlaybooks, tasks } from "../../db/schema";

/* ============================================================
 * Playbooky s úkoly pro tým (ADR-060): vlastní playbooky společnosti a úkoly z kroků alertu.
 * Úkoly jsou běžné `tasks` (zdroj `soc_alert`, `source_step`), splnění úkolu = hotový krok playbooku.
 * ============================================================ */

type Row = typeof socPlaybooks.$inferSelect;
type Ctx = Context<AppEnv>;

/** Funkční místa společnosti nebo nadřazených společností (sdílené role holdingu). */
async function positionsIn(db: Db, ids: string[], companyId: string) {
  const lineage = [companyId, ...ancestorsOf(await getCompanies(db), companyId)];
  return db.select({ id: positions.id }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(and(inArray(positions.id, ids), inArray(orgUnits.companyId, lineage)));
}

const viewOf = (r: Row): SocPlaybookView => ({
  key: customPlaybookKey(r.id),
  name: r.name,
  nameEn: null,
  custom: true,
  techniques: r.techniques,
  tactics: r.tactics,
  steps: r.steps.map((s) => ({ text: s.text, textEn: null, ownerPositionId: s.ownerPositionId, dueHours: s.dueHours })),
});
const dtoOf = (r: Row): SocPlaybookDto => ({ ...viewOf(r), id: r.id, companyId: r.companyId, description: r.description, enabled: r.enabled, basedOn: r.basedOn, updatedAt: r.updatedAt.toISOString() });

/** Zapnuté vlastní playbooky společnosti (pro výběr a návrh). */
export async function customPlaybooks(db: Db, companyId: string): Promise<SocPlaybookView[]> {
  const rows = await db.select().from(socPlaybooks).where(and(eq(socPlaybooks.companyId, companyId), eq(socPlaybooks.enabled, true))).orderBy(asc(socPlaybooks.name));
  return rows.map(viewOf);
}

/** Playbook alertu: uložený klíč (vestavěný nebo vlastní společnosti), jinak návrh podle ATT&CK. */
export async function resolvePlaybook(db: Db, a: { companyId: string; playbookKey: string | null; mitreIds: string[]; mitreTactics: string[] }): Promise<SocPlaybookView> {
  const custom = await customPlaybooks(db, a.companyId);
  // vypnutý vlastní playbook, který už alert používá, zůstane zobrazený
  const id = customPlaybookId(a.playbookKey);
  if (id && !custom.some((c) => c.key === a.playbookKey)) {
    const [r] = await db.select().from(socPlaybooks).where(and(eq(socPlaybooks.id, id), eq(socPlaybooks.companyId, a.companyId)));
    if (r) return viewOf(r);
  }
  return playbookView(a.playbookKey, custom) ?? pickPlaybook(a.mitreIds, a.mitreTactics, custom);
}

/** Úkoly z kroků playbooku alertu. */
export async function playbookTasks(db: Db, alertId: string): Promise<SocPlaybookTask[]> {
  const rows = await db
    .select({ t: tasks, pos: positions.name })
    .from(tasks)
    .leftJoin(positions, eq(positions.id, tasks.ownerPositionId))
    .where(and(eq(tasks.sourceKind, "soc_alert"), eq(tasks.sourceId, alertId), isNotNull(tasks.sourceStep)))
    .orderBy(asc(tasks.sourceStep), asc(tasks.seq));
  return rows.map(({ t, pos }) => ({ step: t.sourceStep!, taskId: t.id, seq: t.seq, status: t.status, ownerPositionId: t.ownerPositionId, ownerPositionName: pos, dueDate: t.dueDate }));
}

/** Po splnění úkolu z playbooku označí krok alertu jako hotový (volá se z modulu Akce a úkoly). */
export async function onPlaybookTaskDone(db: Db, task: { sourceKind: string | null; sourceId: string | null; sourceStep: number | null; seq: number; title: string }, userId: string) {
  if (task.sourceKind !== "soc_alert" || !task.sourceId || task.sourceStep == null) return;
  const [a] = await db.select({ done: alertSuggestions.playbookDone, notes: alertSuggestions.notes }).from(alertSuggestions).where(eq(alertSuggestions.id, task.sourceId));
  if (!a) return;
  const done = [...new Set([...a.done, task.sourceStep])].sort((x, y) => x - y);
  const notes = [...a.notes, { at: new Date().toISOString(), userId, text: `Úkol Ú-${task.seq} splněn – krok ${task.sourceStep + 1} playbooku: ${task.title}`.slice(0, 2000) }].slice(-200);
  await db.update(alertSuggestions).set({ playbookDone: done, notes, updatedAt: new Date() }).where(eq(alertSuggestions.id, task.sourceId));
}

/** Zadání úkolů z kroků playbooku – jen kroky, které nejsou hotové a nemají otevřený úkol. */
export async function createPlaybookTasks(
  db: Db,
  c: Ctx,
  a: typeof alertSuggestions.$inferSelect,
  input: SocPlaybookTasksInput,
): Promise<{ created: number; skipped: number }> {
  const pb = await resolvePlaybook(db, a);
  const existing = await playbookTasks(db, a.id);
  const busy = new Set(existing.filter((x) => x.status === "open" || x.status === "in_progress").map((x) => x.step));
  const posIds = [...new Set(input.steps.map((s) => s.ownerPositionId).filter((x): x is string => !!x))];
  if (posIds.length) {
    const ok = await positionsIn(db, posIds, a.companyId);
    if (ok.length !== posIds.length) throw new HTTPException(400, { message: "Funkční místo nepatří do společnosti alertu." });
  }
  const user = currentUser(c);
  const title = a.title ?? a.description;
  const priority = a.ruleLevel >= 10 ? "high" : a.ruleLevel >= 7 ? "medium" : "low";
  let created = 0;
  let skipped = 0;
  const lines: string[] = [];
  for (const s of input.steps) {
    const step = pb.steps[s.index];
    if (!step || busy.has(s.index) || a.playbookDone.includes(s.index)) {
      skipped++;
      continue;
    }
    const [t] = await db
      .insert(tasks)
      .values({
        companyId: a.companyId,
        title: step.text.slice(0, 500),
        description: `Krok ${s.index + 1} playbooku „${pb.name}“ k alertu SOC: ${title}`.slice(0, 5000),
        sourceKind: "soc_alert",
        sourceId: a.id,
        sourceStep: s.index,
        ownerPositionId: s.ownerPositionId,
        dueDate: s.dueDate,
        priority,
        createdById: user.id,
      })
      .returning({ id: tasks.id, seq: tasks.seq });
    busy.add(s.index);
    created++;
    lines.push(`Ú-${t!.seq} (krok ${s.index + 1})`);
  }
  if (created) {
    const notes = [...a.notes, { at: new Date().toISOString(), userId: user.id, text: `Zadány úkoly týmu: ${lines.join(", ")}` }].slice(-200);
    await db.update(alertSuggestions).set({ notes, playbookKey: a.playbookKey ?? pb.key, updatedAt: new Date() }).where(eq(alertSuggestions.id, a.id));
    await audit(db, { c, user, action: "soc.playbook_tasks_created", entityType: "soc_alert", entityId: a.id, details: { playbook: pb.key, tasks: lines } });
  }
  return { created, skipped };
}

export function socPlaybookRoutes(db: Db) {
  const inIds = (c: Ctx): SQL => {
    const l = scopeOf(c).ids.filter((id) => hasPermIn(c, "soc:read", id));
    return l.length ? inArray(socPlaybooks.companyId, l) : sql`false`;
  };
  async function load(c: Ctx, id: string): Promise<Row> {
    const [r] = await db.select().from(socPlaybooks).where(eq(socPlaybooks.id, id));
    assertScope(c, r?.companyId, "Playbook nenalezen");
    if (!hasPermIn(c, "soc:write", r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r!;
  }
  async function assertPositions(companyId: string, steps: { ownerPositionId: string | null }[] | undefined) {
    const ids = [...new Set((steps ?? []).map((s) => s.ownerPositionId).filter((x): x is string => !!x))];
    if (!ids.length) return;
    const ok = await positionsIn(db, ids, companyId);
    if (ok.length !== ids.length) throw new HTTPException(400, { message: "Funkční místo nepatří do společnosti playbooku." });
  }

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "soc"))
    /** Vestavěné playbooky + vlastní playbooky společností v rozsahu. */
    .get("/playbooks", requirePerm("soc:read"), async (c) => {
      const rows = await db.select().from(socPlaybooks).where(inIds(c)).orderBy(asc(socPlaybooks.name));
      return c.json({ builtin: SOC_PLAYBOOKS.map(builtinView), custom: rows.map(dtoOf) });
    })
    .post("/playbooks", requirePerm("soc:write"), zValidator("json", SocPlaybookInput), async (c) => {
      const { companyId: requested, ...input } = c.req.valid("json");
      const companyId = targetCompany(c, requested, "soc:write");
      if (input.basedOn && !SOC_PLAYBOOKS.some((p) => p.key === input.basedOn)) throw new HTTPException(400, { message: "Neznámý playbook" });
      await assertPositions(companyId, input.steps);
      const [r] = await db
        .insert(socPlaybooks)
        .values({ ...input, basedOn: input.basedOn ?? null, companyId, createdById: currentUser(c).id })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "soc.playbook_created", entityType: "soc_playbook", entityId: r!.id, details: { name: r!.name, steps: r!.steps.length } });
      return c.json(dtoOf(r!), 201);
    })
    .patch("/playbooks/:id", requirePerm("soc:write"), zValidator("json", SocPlaybookPatch), async (c) => {
      const cur = await load(c, c.req.param("id"));
      const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<Row>;
      await assertPositions(cur.companyId, input.steps);
      const [r] = await db.update(socPlaybooks).set({ ...input, updatedAt: new Date() }).where(eq(socPlaybooks.id, cur.id)).returning();
      await audit(db, { c, user: currentUser(c), action: "soc.playbook_updated", entityType: "soc_playbook", entityId: cur.id, details: { fields: Object.keys(input) } });
      return c.json(dtoOf(r!));
    })
    .delete("/playbooks/:id", requirePerm("soc:write"), async (c) => {
      const cur = await load(c, c.req.param("id"));
      const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(alertSuggestions).where(eq(alertSuggestions.playbookKey, customPlaybookKey(cur.id)));
      // používaný playbook se jen vypne (alerty si ho dál zobrazují)
      if (used!.n > 0) await db.update(socPlaybooks).set({ enabled: false, updatedAt: new Date() }).where(eq(socPlaybooks.id, cur.id));
      else await db.delete(socPlaybooks).where(eq(socPlaybooks.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: used!.n > 0 ? "soc.playbook_disabled" : "soc.playbook_deleted", entityType: "soc_playbook", entityId: cur.id, details: { name: cur.name } });
      return c.json({ deleted: used!.n === 0 });
    });
}
