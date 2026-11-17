import type { SecTestId, SecTestScheduleDto } from "@contix/shared";
import { and, desc, eq, inArray, lte, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { secTestBatches, secTestSchedules, secTestScopes } from "../../db/schema";
import { acquireLease } from "../ops/lease";
import { batchDtos, createBatch } from "./service";

/* ============================================================
 * Pravidelné bezpečnostní testy (v1.63, ADR-157): plán = parametry sady + interval. Plánovač zakládá sady
 * stejnou cestou jako ruční spuštění (createBatch → kontrola rozsahu); rozdíl proti minulému stavu počítá batchDtos.
 * ============================================================ */

type Row = typeof secTestSchedules.$inferSelect;
const DAY = 86_400_000;

export async function scheduleDtos(db: Db, where: SQL | undefined): Promise<SecTestScheduleDto[]> {
  const rows = await db.select({ s: secTestSchedules, scopeName: secTestScopes.name }).from(secTestSchedules).innerJoin(secTestScopes, eq(secTestScopes.id, secTestSchedules.scopeId)).where(where).orderBy(secTestSchedules.name);
  if (!rows.length) return [];
  // poslední sada každého plánu
  const latest = await db
    .selectDistinctOn([secTestBatches.scheduleId], { id: secTestBatches.id, scheduleId: secTestBatches.scheduleId })
    .from(secTestBatches)
    .where(inArray(secTestBatches.scheduleId, rows.map((r) => r.s.id)))
    .orderBy(secTestBatches.scheduleId, desc(secTestBatches.createdAt));
  const batches = latest.length ? await batchDtos(db, inArray(secTestBatches.id, latest.map((l) => l.id)), latest.length) : [];
  return rows.map(({ s, scopeName }) => {
    const lb = batches.find((b) => b.scheduleId === s.id);
    return {
      id: s.id,
      companyId: s.companyId,
      scopeId: s.scopeId,
      scopeName,
      name: s.name,
      testIds: s.testIds as SecTestId[],
      targets: s.targets,
      ports: s.ports,
      probeId: s.probeId,
      intervalDays: s.intervalDays,
      autoFollow: s.autoFollow,
      autoAi: s.autoAi,
      autoTasks: s.autoTasks,
      enabled: s.enabled,
      nextRunAt: s.nextRunAt.toISOString(),
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastError: s.lastError,
      lastBatch: lb ? { id: lb.id, createdAt: lb.createdAt, status: lb.status, stats: lb.stats, diff: lb.diff } : null,
    };
  });
}

/** Spustí plán (z plánovače nebo ručně „Spustit nyní“); další termín = teď + interval. */
export async function runSchedule(db: Db, s: Row, now = new Date(), userId: string | null = null) {
  const [scope] = await db.select().from(secTestScopes).where(eq(secTestScopes.id, s.scopeId));
  const next = new Date(now.getTime() + s.intervalDays * DAY);
  if (!scope) {
    await db.update(secTestSchedules).set({ lastError: "Rozsah testů neexistuje", nextRunAt: next, updatedAt: now }).where(eq(secTestSchedules.id, s.id));
    return { batchId: null, error: "Rozsah testů neexistuje" };
  }
  const r = await createBatch(
    db,
    scope,
    { name: `${s.name} – ${now.toISOString().slice(0, 10)}`.slice(0, 200), testIds: s.testIds as SecTestId[], targets: s.targets, ports: s.ports, probeId: s.probeId, autoFollow: s.autoFollow, autoAi: s.autoAi, autoTasks: s.autoTasks, scheduleId: s.id },
    userId ?? s.createdById,
  );
  await db
    .update(secTestSchedules)
    .set({ lastRunAt: now, nextRunAt: next, lastError: r.error ? r.error.slice(0, 500) : null, updatedAt: now })
    .where(eq(secTestSchedules.id, s.id));
  return { batchId: r.batchId, error: r.error };
}

/** Plánovač: splatné plány (zapnuté, termín v minulosti). */
export async function processSecTestSchedules(db: Db, now = new Date()) {
  if (!(await acquireLease(db, "sectest-schedules", 10 * 60_000))) return 0;
  const due = await db.select().from(secTestSchedules).where(and(eq(secTestSchedules.enabled, true), lte(secTestSchedules.nextRunAt, now)));
  for (const s of due) await runSchedule(db, s, now).catch((e) => console.error("Pravidelný test:", (e as Error).message));
  return due.length;
}
