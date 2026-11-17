import { SECTEST_AUTO_TASK_SEVERITIES, SECTEST_TASK_DUE_DAYS, SECTEST_TASK_PRIORITY, secTestDef, type SecTestFindingTask, type SecTestSeverity, type SecTestTaskAssignee, type SecTestTasksResult } from "@contix/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, positions, secTestFindings, secTestRuns, tasks, users } from "../../db/schema";
import { orgSnapshot, positionOfUser, type OrgSnapshot } from "../org/hierarchy";

/* ============================================================
 * Úkoly na odstranění nálezů bezpečnostních testů (v1.60, ADR-155).
 * Odpovědný = funkce technického garanta aktiva → zástupce → business vlastníka. Termín podle závažnosti.
 * Jeden otevřený úkol na nález; po ověření opravy (opakovaný test) se úkol sám uzavře.
 * ============================================================ */

export const SECTEST_TASK_SOURCE = "sectest_finding" as const;
const OPEN = ["open", "in_progress"];

type AssetOwners = { ownerUserId: string | null; technicalOwnerUserId: string | null; technicalDeputyUserId: string | null };

/**
 * Komu úkol připadne (v1.62): osoba = technický garant, jinak zástupce, jinak business vlastník aktiva;
 * funkce = funkční místo této osoby (je-li), jinak první osoby z pořadí, která funkci má.
 */
export function technicalAssignee(snap: OrgSnapshot, a: AssetOwners | null | undefined, companyId: string): { userId: string | null; positionId: string | null; via: SecTestTaskAssignee } {
  if (!a) return { userId: null, positionId: null, via: "none" };
  const order: [string | null, SecTestTaskAssignee][] = [
    [a.technicalOwnerUserId, "technical"],
    [a.technicalDeputyUserId, "deputy"],
    [a.ownerUserId, "business"],
  ];
  const first = order.find(([uid]) => !!uid);
  if (!first) return { userId: null, positionId: null, via: "none" };
  const own = positionOfUser(snap, first[0], companyId);
  const anyPos = own ?? order.map(([uid]) => positionOfUser(snap, uid, companyId)).find((p) => !!p) ?? null;
  return { userId: first[0], positionId: anyPos, via: first[1] };
}

/** Funkce business vlastníka aktiva (pro zjištění z auditu). */
export function businessAssignee(snap: OrgSnapshot, a: AssetOwners | null | undefined, companyId: string): string | null {
  return a ? positionOfUser(snap, a.ownerUserId, companyId) : null;
}

const addDays = (d: Date, n: number) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/** Založí úkoly k nálezům (jen otevřeným, bez existujícího otevřeného úkolu). */
export async function createFindingTasks(db: Db, findingIds: string[], userId: string | null, now = new Date(), severities?: SecTestSeverity[]): Promise<SecTestTasksResult & { taskIds: string[] }> {
  const res = { created: 0, existing: 0, unassigned: 0, skipped: 0, taskIds: [] as string[] };
  const ids = [...new Set(findingIds)];
  if (!ids.length) return res;
  const rows = await db
    .select({ f: secTestFindings, ownerUserId: assets.ownerUserId, technicalOwnerUserId: assets.technicalOwnerUserId, technicalDeputyUserId: assets.technicalDeputyUserId, assetName: assets.name })
    .from(secTestFindings)
    .leftJoin(assets, eq(assets.id, secTestFindings.assetId))
    .where(inArray(secTestFindings.id, ids));
  const open = await db
    .select({ sourceId: tasks.sourceId })
    .from(tasks)
    .where(and(eq(tasks.sourceKind, SECTEST_TASK_SOURCE), inArray(tasks.sourceId, ids), inArray(tasks.status, OPEN)));
  const hasTask = new Set(open.map((o) => o.sourceId));
  const snap = await orgSnapshot(db);
  const existingIds: string[] = [];
  for (const r of rows) {
    const f = r.f;
    const sev = f.severity as SecTestSeverity;
    if (f.status !== "open" || (severities && !severities.includes(sev))) {
      res.skipped++;
      continue;
    }
    if (hasTask.has(f.id)) {
      res.existing++;
      existingIds.push(f.id);
      continue;
    }
    const who = technicalAssignee(snap, f.assetId ? r : null, f.companyId);
    const where = `${f.host}${f.port ? `:${f.port}` : ""}`;
    const test = secTestDef(f.testId)?.name ?? f.testId;
    const description = [
      `${f.title} – ${where}${r.assetName ? ` (aktivum ${r.assetName})` : ""}`,
      f.detail,
      f.evidence ? `Důkaz:\n${f.evidence.slice(0, 1500)}` : "",
      `Test: ${test}. Po opravě spusťte test znovu – úkol se uzavře sám, jakmile nález zmizí.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const [t] = await db
      .insert(tasks)
      .values({
        companyId: f.companyId,
        title: `Odstranit nález: ${f.title} (${where})`.slice(0, 500),
        description,
        sourceKind: SECTEST_TASK_SOURCE,
        sourceId: f.id,
        ownerPositionId: who.positionId,
        assigneeUserId: who.userId,
        dueDate: addDays(now, SECTEST_TASK_DUE_DAYS[sev] ?? 30),
        priority: SECTEST_TASK_PRIORITY[sev] ?? "medium",
        status: "open",
        createdById: userId,
      })
      .returning({ id: tasks.id });
    res.created++;
    res.taskIds.push(t!.id);
    if (!who.userId) res.unassigned++;
  }
  // existující otevřené úkoly (např. z verze bez odpovědné osoby) dostanou aktuálního garanta / vlastníka
  if (existingIds.length) await reassignFindingTasks(db, { findingIds: existingIds });
  return res;
}

/** Automatické úkoly po běhu sady s `autoTasks` (střední a vyšší závažnost). */
export async function autoTasksForRun(db: Db, runId: string, userId: string | null, now = new Date()) {
  const rows = await db
    .select({ id: secTestFindings.id })
    .from(secTestFindings)
    .where(and(eq(secTestFindings.runId, runId), eq(secTestFindings.status, "open"), inArray(secTestFindings.severity, SECTEST_AUTO_TASK_SEVERITIES)));
  return createFindingTasks(db, rows.map((r) => r.id), userId, now, SECTEST_AUTO_TASK_SEVERITIES);
}

/** Uzavře otevřené úkoly nálezů – opraveno (ověřeno testem) = splněno, přijato / falešně pozitivní = zrušeno. */
export async function closeFindingTasks(db: Db, findingIds: string[], outcome: "done" | "cancelled", note: string, now = new Date()) {
  if (!findingIds.length) return 0;
  const r = await db
    .update(tasks)
    .set({ status: outcome, completedAt: now, completionNote: note, updatedAt: now })
    .where(and(eq(tasks.sourceKind, SECTEST_TASK_SOURCE), inArray(tasks.sourceId, findingIds), inArray(tasks.status, OPEN)))
    .returning({ id: tasks.id });
  return r.length;
}

/**
 * Přepočet odpovědných u otevřených úkolů nálezů (v1.62) – po přiřazení nálezu k aktivu nebo změně vlastníka / garanta aktiva.
 * Mění jen úkoly, které dosud nikdo nepřevzal ručně (stav „open“).
 */
export async function reassignFindingTasks(db: Db, where: { assetId: string } | { findingIds: string[] }) {
  const ids =
    "assetId" in where
      ? (await db.select({ id: secTestFindings.id }).from(secTestFindings).where(eq(secTestFindings.assetId, where.assetId))).map((r) => r.id)
      : where.findingIds;
  if (!ids.length) return 0;
  const rows = await db
    .select({ taskId: tasks.id, companyId: tasks.companyId, ownerUserId: assets.ownerUserId, technicalOwnerUserId: assets.technicalOwnerUserId, technicalDeputyUserId: assets.technicalDeputyUserId, hasAsset: assets.id })
    .from(tasks)
    .innerJoin(secTestFindings, eq(secTestFindings.id, tasks.sourceId))
    .leftJoin(assets, eq(assets.id, secTestFindings.assetId))
    .where(and(eq(tasks.sourceKind, SECTEST_TASK_SOURCE), inArray(tasks.sourceId, ids), eq(tasks.status, "open")));
  if (!rows.length) return 0;
  const snap = await orgSnapshot(db);
  let n = 0;
  for (const r of rows) {
    const who = technicalAssignee(snap, r.hasAsset ? r : null, r.companyId);
    await db.update(tasks).set({ ownerPositionId: who.positionId, assigneeUserId: who.userId, updatedAt: new Date() }).where(eq(tasks.id, r.taskId));
    n++;
  }
  return n;
}

/** Poslední úkol ke každému nálezu (pro DTO). */
export async function findingTasks(db: Db, findingIds: string[]): Promise<Map<string, SecTestFindingTask>> {
  const out = new Map<string, SecTestFindingTask>();
  if (!findingIds.length) return out;
  const rows = await db
    .select({ id: tasks.id, seq: tasks.seq, sourceId: tasks.sourceId, status: tasks.status, dueDate: tasks.dueDate, ownerPositionId: tasks.ownerPositionId, ownerName: positions.name, assigneeUserId: tasks.assigneeUserId, assigneeName: users.displayName })
    .from(tasks)
    .leftJoin(positions, eq(positions.id, tasks.ownerPositionId))
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(and(eq(tasks.sourceKind, SECTEST_TASK_SOURCE), inArray(tasks.sourceId, findingIds)))
    .orderBy(desc(tasks.createdAt));
  for (const r of rows)
    if (r.sourceId && !out.has(r.sourceId))
      out.set(r.sourceId, { id: r.id, code: `#${r.seq}`, status: r.status as SecTestFindingTask["status"], dueDate: r.dueDate, ownerPositionId: r.ownerPositionId, ownerName: r.ownerName, assigneeName: r.assigneeName });
  return out;
}

const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);

/** Po dokončení opakovaného testu: nález trvá (nebo test selhal) → úkol zpět odpovědné osobě. Uzavření při opravě řeší closeFindingTasks. */
export async function afterRetest(db: Db, run: typeof secTestRuns.$inferSelect, error: string | null, now = new Date()) {
  if (!run.retestFindingId) return;
  const [f] = await db.select({ status: secTestFindings.status, lastSeenAt: secTestFindings.lastSeenAt }).from(secTestFindings).where(eq(secTestFindings.id, run.retestFindingId));
  if (!f || f.status !== "open") return; // opraveno (úkoly uzavřené) nebo přijato
  const still = !error && f.lastSeenAt.getTime() >= now.getTime() - 1000;
  const text = error ? `Opakovaný test ${dayOf(now)} selhal (${error.slice(0, 200)}) – ověřte opravu znovu.` : `Opakovaný test ${dayOf(now)} nález stále nachází – oprava nebyla úspěšná.`;
  const open = await db.select().from(tasks).where(and(eq(tasks.sourceKind, SECTEST_TASK_SOURCE), eq(tasks.sourceId, run.retestFindingId), inArray(tasks.status, ["in_progress", "done"])));
  for (const t of open)
    await db
      .update(tasks)
      .set({ status: "open", completedAt: null, completionNote: [t.completionNote, still || error ? text : `Opakovaný test ${dayOf(now)} cíl neověřil – zkontrolujte.`].filter(Boolean).join("\n").slice(-4000), updatedAt: now })
      .where(eq(tasks.id, t.id));
}
