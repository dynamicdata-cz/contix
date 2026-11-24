import { MONITORING_INFO, type MonitoringCode, IDENTITY_RULE_INFO, SECTEST_TASK_DUE_DAYS, SECTEST_TASK_PRIORITY, type IdentityRule, type SecTestFindingTask, type SecTestSeverity, type SecTestTasksResult } from "@contix/shared";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, identityFindings, monitoringFindings, positions, sodRules, sodViolations, tasks, users, vulnIntel } from "../../db/schema";
import { orgSnapshot } from "../org/hierarchy";
import { technicalAssignee } from "../sectests/tasks";
import { getVulnSla, vulnDueSql } from "../vulnerabilities/intel";
import { identitySubjectSql } from "../identity/query";

/* ============================================================
 * Úkoly z nálezů registru, které dosud úkol nezakládaly (v1.88, ADR-183): zranitelnosti (garant aktiva, termín
 * podle SLA zranitelností) a nálezy identit / SoD (bez aktiva – úkol bez řešitele, přidělí bezpečnostní tým).
 * Úkol se uzavře sám, když zdroj přestane být otevřený (`closeResolvedSourceTasks`).
 * ============================================================ */

export type SourceTaskKind = "vulnerability" | "identity_finding" | "sod_violation" | "monitoring_finding";
const OPEN = ["open", "in_progress"];
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const sevOf = (s: string): SecTestSeverity => (["critical", "high", "medium", "low"].includes(s) ? (s as SecTestSeverity) : "info");

/** Poslední úkol ke každému zdroji daného druhu. */
export async function sourceTasks(db: Db, kind: SourceTaskKind, ids: string[]): Promise<Map<string, SecTestFindingTask>> {
  const out = new Map<string, SecTestFindingTask>();
  if (!ids.length) return out;
  const rows = await db
    .select({ id: tasks.id, seq: tasks.seq, sourceId: tasks.sourceId, status: tasks.status, dueDate: tasks.dueDate, ownerPositionId: tasks.ownerPositionId, ownerName: positions.name, assigneeName: users.displayName })
    .from(tasks)
    .leftJoin(positions, eq(positions.id, tasks.ownerPositionId))
    .leftJoin(users, eq(users.id, tasks.assigneeUserId))
    .where(and(eq(tasks.sourceKind, kind), inArray(tasks.sourceId, ids)))
    .orderBy(desc(tasks.createdAt));
  for (const r of rows)
    if (r.sourceId && !out.has(r.sourceId)) out.set(r.sourceId, { id: r.id, code: `#${r.seq}`, status: r.status as SecTestFindingTask["status"], dueDate: r.dueDate, ownerPositionId: r.ownerPositionId, ownerName: r.ownerName, assigneeName: r.assigneeName });
  return out;
}

async function openTaskIds(db: Db, kind: SourceTaskKind, ids: string[]) {
  const rows = await db.select({ s: tasks.sourceId }).from(tasks).where(and(eq(tasks.sourceKind, kind), inArray(tasks.sourceId, ids), inArray(tasks.status, OPEN)));
  return new Set(rows.map((r) => r.s));
}

export async function createVulnTasks(db: Db, ids: string[], userId: string | null, allowed: (companyId: string) => boolean, now = new Date()): Promise<SecTestTasksResult & { taskIds: string[] }> {
  const res = { created: 0, existing: 0, unassigned: 0, skipped: 0, taskIds: [] as string[] };
  const uniq = [...new Set(ids)];
  if (!uniq.length) return res;
  const rows = await db
    .select({ v: assetVulnerabilities, companyId: assets.companyId, assetName: assets.name, ownerUserId: assets.ownerUserId, technicalOwnerUserId: assets.technicalOwnerUserId, technicalDeputyUserId: assets.technicalDeputyUserId, due: vulnDueSql(await getVulnSla(db)) })
    .from(assetVulnerabilities)
    .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
    .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
    .where(inArray(assetVulnerabilities.id, uniq));
  const has = await openTaskIds(db, "vulnerability", uniq);
  const snap = await orgSnapshot(db);
  for (const r of rows) {
    if (!allowed(r.companyId) || r.v.status !== "open") {
      res.skipped++;
      continue;
    }
    if (has.has(r.v.id)) {
      res.existing++;
      continue;
    }
    const who = technicalAssignee(snap, r, r.companyId);
    const s = sevOf(r.v.severity);
    const [t] = await db
      .insert(tasks)
      .values({
        companyId: r.companyId,
        title: `Opravit zranitelnost ${r.v.cveId} (${r.assetName})`.slice(0, 500),
        description: [`${r.v.cveId}${r.v.title ? ` – ${r.v.title}` : ""}`, [r.v.packageName, r.v.packageVersion].filter(Boolean).join(" "), r.v.fixedVersion ? `Opravená verze: ${r.v.fixedVersion}` : "", "Úkol se uzavře sám, jakmile zranitelnost nebude otevřená (oprava, výjimka)."].filter(Boolean).join("\n\n"),
        sourceKind: "vulnerability",
        sourceId: r.v.id,
        ownerPositionId: who.positionId,
        assigneeUserId: who.userId,
        dueDate: r.due ?? addDays(now, SECTEST_TASK_DUE_DAYS[s]),
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

export async function createIdentityTasks(db: Db, refs: { kind: "identity_finding" | "sod_violation"; id: string }[], userId: string | null, allowed: (companyId: string) => boolean, now = new Date()): Promise<SecTestTasksResult & { taskIds: string[] }> {
  const res = { created: 0, existing: 0, unassigned: 0, skipped: 0, taskIds: [] as string[] };
  const fIds = [...new Set(refs.filter((r) => r.kind === "identity_finding").map((r) => r.id))];
  const sIds = [...new Set(refs.filter((r) => r.kind === "sod_violation").map((r) => r.id))];
  const items: { kind: "identity_finding" | "sod_violation"; id: string; companyId: string; status: string; severity: string; title: string; description: string }[] = [];
  if (fIds.length)
    for (const { f, name } of await db.select({ f: identityFindings, name: identitySubjectSql }).from(identityFindings).where(inArray(identityFindings.id, fIds))) {
      const info = IDENTITY_RULE_INFO[f.rule as IdentityRule];
      items.push({ kind: "identity_finding", id: f.id, companyId: f.companyId, status: f.status, severity: f.severity, title: `${info?.title ?? f.rule}: ${name}`, description: [f.detail, info?.why, info?.fix ? `Náprava: ${info.fix}` : ""].filter(Boolean).join("\n\n") });
    }
  if (sIds.length)
    for (const { v, rule, sev } of await db.select({ v: sodViolations, rule: sodRules.name, sev: sodRules.severity }).from(sodViolations).innerJoin(sodRules, eq(sodRules.id, sodViolations.ruleId)).where(inArray(sodViolations.id, sIds)))
      items.push({ kind: "sod_violation", id: v.id, companyId: v.companyId, status: v.status, severity: sev, title: `Oddělení povinností – ${rule}: ${v.person || v.subject}`, description: "Osoba drží neslučitelná oprávnění. Odeberte jedno z nich, nebo výjimku zdůvodněte a přijměte s termínem." });
  const has = new Set([...(await openTaskIds(db, "identity_finding", fIds)), ...(await openTaskIds(db, "sod_violation", sIds))]);
  for (const x of items) {
    if (!allowed(x.companyId) || x.status !== "open") {
      res.skipped++;
      continue;
    }
    if (has.has(x.id)) {
      res.existing++;
      continue;
    }
    const s = sevOf(x.severity);
    const [t] = await db
      .insert(tasks)
      .values({
        companyId: x.companyId,
        title: x.title.slice(0, 500),
        description: `${x.description}\n\nÚkol se uzavře sám, jakmile nález nebude otevřený.`,
        sourceKind: x.kind,
        sourceId: x.id,
        dueDate: addDays(now, SECTEST_TASK_DUE_DAYS[s]),
        priority: SECTEST_TASK_PRIORITY[s],
        status: "open",
        createdById: userId,
      })
      .returning({ id: tasks.id });
    res.created++;
    res.unassigned++;
    res.taskIds.push(t!.id);
  }
  return res;
}

/** Úkoly z nálezů monitoringu (v1.96): garant aktiva, termín podle závažnosti. */
export async function createMonitoringTasks(db: Db, ids: string[], userId: string | null, allowed: (companyId: string) => boolean, now = new Date()): Promise<SecTestTasksResult & { taskIds: string[] }> {
  const res = { created: 0, existing: 0, unassigned: 0, skipped: 0, taskIds: [] as string[] };
  const uniq = [...new Set(ids)];
  if (!uniq.length) return res;
  const rows = await db
    .select({ f: monitoringFindings, assetName: assets.name, ownerUserId: assets.ownerUserId, technicalOwnerUserId: assets.technicalOwnerUserId, technicalDeputyUserId: assets.technicalDeputyUserId })
    .from(monitoringFindings)
    .leftJoin(assets, eq(assets.id, monitoringFindings.assetId))
    .where(inArray(monitoringFindings.id, uniq));
  const has = await openTaskIds(db, "monitoring_finding", uniq);
  const snap = await orgSnapshot(db);
  for (const r of rows) {
    if (!allowed(r.f.companyId) || r.f.status !== "open") {
      res.skipped++;
      continue;
    }
    if (has.has(r.f.id)) {
      res.existing++;
      continue;
    }
    const who = technicalAssignee(snap, { ownerUserId: r.ownerUserId ?? null, technicalOwnerUserId: r.technicalOwnerUserId ?? null, technicalDeputyUserId: r.technicalDeputyUserId ?? null }, r.f.companyId);
    const s = sevOf(r.f.severity);
    const info = MONITORING_INFO[r.f.code as MonitoringCode];
    const [t] = await db
      .insert(tasks)
      .values({
        companyId: r.f.companyId,
        title: `${info?.title ?? r.f.code}: ${r.f.subject}`.slice(0, 500),
        description: [r.f.detail, info?.fix ? `Náprava: ${info.fix}` : "", "Úkol se uzavře sám, jakmile nález nebude otevřený."].filter(Boolean).join("\n\n"),
        sourceKind: "monitoring_finding",
        sourceId: r.f.id,
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

/** Uzavření otevřených úkolů, jejichž zdroj (zranitelnost, nález identity, SoD) už není otevřený. */
export async function closeResolvedSourceTasks(db: Db, now = new Date()) {
  const close = async (kind: SourceTaskKind, stillOpen: string[]) => {
    const r = await db
      .update(tasks)
      .set({ status: "done", completedAt: now, completionNote: "Zdroj úkolu už není otevřený (opraveno, výjimka nebo zamítnuto).", updatedAt: now })
      .where(and(eq(tasks.sourceKind, kind), inArray(tasks.status, OPEN), stillOpen.length ? notInArray(tasks.sourceId, stillOpen) : undefined))
      .returning({ id: tasks.id });
    return r.length;
  };
  const ids = async (kind: SourceTaskKind) => (await db.select({ s: tasks.sourceId }).from(tasks).where(and(eq(tasks.sourceKind, kind), inArray(tasks.status, OPEN)))).map((x) => x.s!).filter(Boolean);
  let n = 0;
  const v = await ids("vulnerability");
  if (v.length) n += await close("vulnerability", (await db.select({ id: assetVulnerabilities.id }).from(assetVulnerabilities).where(and(inArray(assetVulnerabilities.id, v), eq(assetVulnerabilities.status, "open")))).map((x) => x.id));
  const f = await ids("identity_finding");
  if (f.length) n += await close("identity_finding", (await db.select({ id: identityFindings.id }).from(identityFindings).where(and(inArray(identityFindings.id, f), eq(identityFindings.status, "open")))).map((x) => x.id));
  const mf = await ids("monitoring_finding");
  if (mf.length) n += await close("monitoring_finding", (await db.select({ id: monitoringFindings.id }).from(monitoringFindings).where(and(inArray(monitoringFindings.id, mf), eq(monitoringFindings.status, "open")))).map((x) => x.id));
  const s = await ids("sod_violation");
  if (s.length) n += await close("sod_violation", (await db.select({ id: sodViolations.id }).from(sodViolations).where(and(inArray(sodViolations.id, s), eq(sodViolations.status, "open")))).map((x) => x.id));
  return n;
}
