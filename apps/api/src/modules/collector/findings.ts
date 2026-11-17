import { HOST_FINDING_GUIDE, HOST_FINDING_LABELS, SECTEST_TASK_DUE_DAYS, SECTEST_TASK_PRIORITY, type HostFinding, type HostFindingCode, type SecTestFindingTask, type SecTestSeverity, type SecTestTasksResult } from "@contix/shared";
import { and, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "../../db/client";
import { assets, hostFindings, hostInventories, positions, tasks, users } from "../../db/schema";
import { orgSnapshot } from "../org/hierarchy";
import { technicalAssignee } from "../sectests/tasks";

/* ============================================================
 * Nálezy serveru ze sběrače s životním cyklem (v1.65, ADR-158) – stejná pravidla jako nálezy bezpečnostních testů:
 * nový = otevřený, chybí v dalším hlášení = opravený (úkoly se uzavřou), přijatý zůstává do termínu.
 * Úkol jde technickému garantovi aktiva (jinak zástupci / business vlastníkovi); vysoké nálezy dostanou úkol samy.
 * ============================================================ */

export const HOST_TASK_SOURCE = "host_finding" as const;
const OPEN = ["open", "in_progress"];
/** Závažnost sběrače (high / medium / low) → stupnice nálezů. */
const sev = (s: string): SecTestSeverity => (s === "high" ? "high" : s === "medium" ? "medium" : "low");
const keyOf = (f: HostFinding) => createHash("sha256").update(`${f.code}\u0000${f.subject ?? ""}`).digest("hex").slice(0, 64);
const addDays = (d: Date, n: number) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const hostFindingTitle = (code: string, subject: string | null) => `${HOST_FINDING_LABELS[code as HostFindingCode] ?? code}${subject ? ` – ${subject}` : ""}`;

/** Zápis nálezů z hlášení sběrače: upsert, opravené, znovu otevřené; automatické úkoly k vysokým nálezům. */
export async function syncHostFindings(db: Db, inv: { id: string; companyId: string; assetId: string | null }, findings: HostFinding[], now = new Date()) {
  const keys: string[] = [];
  for (const f of findings) {
    const key = keyOf(f);
    keys.push(key);
    await db
      .insert(hostFindings)
      .values({ companyId: inv.companyId, inventoryId: inv.id, assetId: inv.assetId, key, code: f.code, severity: f.severity, subject: f.subject?.slice(0, 500) ?? null, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [hostFindings.inventoryId, hostFindings.key],
        set: {
          companyId: inv.companyId,
          assetId: inv.assetId ?? sql`${hostFindings.assetId}`,
          severity: f.severity,
          lastSeenAt: now,
          status: sql`case when ${hostFindings.status} = 'fixed' or (${hostFindings.status} = 'accepted' and ${hostFindings.acceptedUntil} < current_date) then 'open' else ${hostFindings.status} end`,
          fixedAt: sql`case when ${hostFindings.status} = 'fixed' then null else ${hostFindings.fixedAt} end`,
          updatedAt: now,
        },
      });
  }
  const fixed = await db
    .update(hostFindings)
    .set({ status: "fixed", fixedAt: now, updatedAt: now })
    .where(and(eq(hostFindings.inventoryId, inv.id), eq(hostFindings.status, "open"), keys.length ? notInArray(hostFindings.key, keys) : undefined))
    .returning({ id: hostFindings.id });
  await closeHostFindingTasks(db, fixed.map((x) => x.id), "done", `Oprava ověřena dalším hlášením sběrače ${now.toISOString().slice(0, 10)}.`, now);
  // vysoké otevřené nálezy bez úkolu → úkol odpovědné osobě aktiva (jen když aktivum má odpovědné)
  if (inv.assetId) {
    const high = await db.select({ id: hostFindings.id }).from(hostFindings).where(and(eq(hostFindings.inventoryId, inv.id), eq(hostFindings.status, "open"), eq(hostFindings.severity, "high")));
    if (high.length) await createHostFindingTasks(db, high.map((h) => h.id), null, now, true);
  }
  return { fixed: fixed.length };
}

export async function createHostFindingTasks(db: Db, ids: string[], userId: string | null, now = new Date(), onlyAssigned = false): Promise<SecTestTasksResult & { taskIds: string[] }> {
  const res = { created: 0, existing: 0, unassigned: 0, skipped: 0, taskIds: [] as string[] };
  const uniq = [...new Set(ids)];
  if (!uniq.length) return res;
  const rows = await db
    .select({ f: hostFindings, hostname: hostInventories.hostname, assetName: assets.name, ownerUserId: assets.ownerUserId, technicalOwnerUserId: assets.technicalOwnerUserId, technicalDeputyUserId: assets.technicalDeputyUserId })
    .from(hostFindings)
    .innerJoin(hostInventories, eq(hostInventories.id, hostFindings.inventoryId))
    .leftJoin(assets, eq(assets.id, hostFindings.assetId))
    .where(inArray(hostFindings.id, uniq));
  const open = await db.select({ sourceId: tasks.sourceId }).from(tasks).where(and(eq(tasks.sourceKind, HOST_TASK_SOURCE), inArray(tasks.sourceId, uniq), inArray(tasks.status, OPEN)));
  const has = new Set(open.map((o) => o.sourceId));
  const snap = await orgSnapshot(db);
  for (const r of rows) {
    const f = r.f;
    if (f.status !== "open") {
      res.skipped++;
      continue;
    }
    if (has.has(f.id)) {
      res.existing++;
      continue;
    }
    const who = technicalAssignee(snap, f.assetId ? r : null, f.companyId);
    if (onlyAssigned && !who.userId) {
      res.skipped++;
      continue;
    }
    const s = sev(f.severity);
    const g = HOST_FINDING_GUIDE[f.code as HostFindingCode];
    const [t] = await db
      .insert(tasks)
      .values({
        companyId: f.companyId,
        title: `Odstranit nález serveru: ${hostFindingTitle(f.code, f.subject)} (${r.hostname})`.slice(0, 500),
        description: [`${hostFindingTitle(f.code, f.subject)} – server ${r.hostname}${r.assetName ? ` (aktivum ${r.assetName})` : ""}`, g?.why, g?.fix ? `Náprava: ${g.fix}` : "", "Po opravě se úkol uzavře sám, jakmile další hlášení sběrače nález nenajde."].filter(Boolean).join("\n\n"),
        sourceKind: HOST_TASK_SOURCE,
        sourceId: f.id,
        ownerPositionId: who.positionId,
        assigneeUserId: who.userId,
        dueDate: addDays(now, SECTEST_TASK_DUE_DAYS[s]),
        priority: SECTEST_TASK_PRIORITY[s],
        status: "open",
        createdById: userId,
      })
      .returning({ id: tasks.id });
    res.created++;
    res.taskIds.push(t!.id);
    if (!who.userId) res.unassigned++;
  }
  return res;
}

export async function closeHostFindingTasks(db: Db, ids: string[], outcome: "done" | "cancelled", note: string, now = new Date()) {
  if (!ids.length) return 0;
  const r = await db
    .update(tasks)
    .set({ status: outcome, completedAt: now, completionNote: note, updatedAt: now })
    .where(and(eq(tasks.sourceKind, HOST_TASK_SOURCE), inArray(tasks.sourceId, ids), inArray(tasks.status, OPEN)))
    .returning({ id: tasks.id });
  return r.length;
}

/** Přepočet odpovědných u otevřených úkolů (změna odpovědných osob aktiva, přesun aktiva). */
export async function reassignHostFindingTasks(db: Db, where: { assetId: string }) {
  const rows = await db
    .select({ taskId: tasks.id, companyId: tasks.companyId, ownerUserId: assets.ownerUserId, technicalOwnerUserId: assets.technicalOwnerUserId, technicalDeputyUserId: assets.technicalDeputyUserId })
    .from(tasks)
    .innerJoin(hostFindings, eq(hostFindings.id, tasks.sourceId))
    .innerJoin(assets, eq(assets.id, hostFindings.assetId))
    .where(and(eq(tasks.sourceKind, HOST_TASK_SOURCE), eq(hostFindings.assetId, where.assetId), eq(tasks.status, "open")));
  if (!rows.length) return 0;
  const snap = await orgSnapshot(db);
  for (const r of rows) {
    const who = technicalAssignee(snap, r, r.companyId);
    await db.update(tasks).set({ ownerPositionId: who.positionId, assigneeUserId: who.userId, updatedAt: new Date() }).where(eq(tasks.id, r.taskId));
  }
  return rows.length;
}

/** Poslední úkol ke každému nálezu serveru. */
export async function hostFindingTasks(db: Db, ids: string[]): Promise<Map<string, SecTestFindingTask>> {
  const out = new Map<string, SecTestFindingTask>();
  if (!ids.length) return out;
  const rows = await db
    .select({ id: tasks.id, seq: tasks.seq, sourceId: tasks.sourceId, status: tasks.status, dueDate: tasks.dueDate, ownerPositionId: tasks.ownerPositionId, ownerName: positions.name, assigneeName: users.displayName })
    .from(tasks)
    .leftJoin(positions, eq(positions.id, tasks.ownerPositionId))
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(and(eq(tasks.sourceKind, HOST_TASK_SOURCE), inArray(tasks.sourceId, ids)))
    .orderBy(desc(tasks.createdAt));
  for (const r of rows)
    if (r.sourceId && !out.has(r.sourceId)) out.set(r.sourceId, { id: r.id, code: `#${r.seq}`, status: r.status as SecTestFindingTask["status"], dueDate: r.dueDate, ownerPositionId: r.ownerPositionId, ownerName: r.ownerName, assigneeName: r.assigneeName });
  return out;
}

/** Přijaté nálezy po termínu se znovu otevřou (i bez nového hlášení). */
export async function reopenExpiredHostFindings(db: Db) {
  await db.update(hostFindings).set({ status: "open", updatedAt: new Date() }).where(and(eq(hostFindings.status, "accepted"), lt(hostFindings.acceptedUntil, sql`current_date`)));
}
