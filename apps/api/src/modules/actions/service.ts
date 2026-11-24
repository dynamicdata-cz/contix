import { TASK_LABELS, actionOverdue, sortActions, taskSourceLink, type ActionItem, type ActionKind, type TaskSource, type TaskStatus, type Translate, IDENTITY_RULE_INFO, type IdentityRule } from "@contix/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { projectTasks, assetVulnerabilities, identityFindings, sodViolations, hostFindings, hostInventories, secTestFindings, aiSystems, craProducts, projects, soc2Engagements, alertSuggestions, exercises, infoFeedItems, infoItemReviews, assets, auditFindings, audits, changes, controls, incidents, legalTasks, policies, positions, processes, processingActivities, risks, riskTreatmentActions, suppliers, tasks, users } from "../../db/schema";
import { CS_T } from "../i18n/service";
import { hostFindingTitle } from "../collector/findings";
import { identitySubjectSql } from "../identity/query";

/* Akce a úkoly (ADR-043): sběr z modulů při čtení, persistují se jen samostatné úkoly (`tasks`). */

export type ActionScope = Partial<Record<ActionKind, string[]>>;

const code = (c: string | null | undefined, name: string) => (c ? `${c} ${name}` : name);

/** Popisky zdrojových záznamů úkolů (hromadně, bez dotazů v cyklu). */
export async function sourceLabels(db: Db, pairs: { kind: string | null; id: string | null }[]): Promise<Map<string, { label: string; companyId: string }>> {
  const by = new Map<string, string[]>();
  for (const p of pairs) if (p.kind && p.id) by.set(p.kind, [...(by.get(p.kind) ?? []), p.id]);
  const out = new Map<string, { label: string; companyId: string }>();
  const put = (kind: string, rows: { id: string; label: string; companyId: string }[]) => rows.forEach((r) => out.set(`${kind}:${r.id}`, { label: r.label, companyId: r.companyId }));
  const jobs: Promise<void>[] = [];
  const q = <T extends { id: string; companyId: string }>(kind: TaskSource, run: (ids: string[]) => Promise<T[]>, label: (r: T) => string) => {
    const ids = [...new Set(by.get(kind) ?? [])];
    if (ids.length) jobs.push(run(ids).then((rows) => put(kind, rows.map((r) => ({ id: r.id, companyId: r.companyId, label: label(r) })))));
  };
  q("incident", (ids) => db.select({ id: incidents.id, companyId: incidents.companyId, c: incidents.code, n: incidents.title }).from(incidents).where(inArray(incidents.id, ids)), (r) => code(r.c, r.n));
  q("supplier", (ids) => db.select({ id: suppliers.id, companyId: suppliers.companyId, n: suppliers.name }).from(suppliers).where(inArray(suppliers.id, ids)), (r) => r.n);
  q("change", (ids) => db.select({ id: changes.id, companyId: changes.companyId, c: changes.code, n: changes.title }).from(changes).where(inArray(changes.id, ids)), (r) => code(r.c, r.n));
  q("control", (ids) => db.select({ id: controls.id, companyId: controls.companyId, c: controls.code, n: controls.name }).from(controls).where(inArray(controls.id, ids)), (r) => code(r.c, r.n));
  q("asset", (ids) => db.select({ id: assets.id, companyId: assets.companyId, n: assets.name }).from(assets).where(inArray(assets.id, ids)), (r) => r.n);
  q("process", (ids) => db.select({ id: processes.id, companyId: processes.companyId, c: processes.code, n: processes.name }).from(processes).where(inArray(processes.id, ids)), (r) => code(r.c, r.n));
  q("risk", (ids) => db.select({ id: risks.id, companyId: risks.companyId, c: risks.code, n: risks.name }).from(risks).where(inArray(risks.id, ids)), (r) => code(r.c, r.n));
  q("policy", (ids) => db.select({ id: policies.id, companyId: policies.companyId, c: policies.code, n: policies.title }).from(policies).where(inArray(policies.id, ids)), (r) => code(r.c, r.n));
  q("audit", (ids) => db.select({ id: audits.id, companyId: audits.companyId, c: audits.code, n: audits.title }).from(audits).where(inArray(audits.id, ids)), (r) => code(r.c, r.n));
  q("processing", (ids) => db.select({ id: processingActivities.id, companyId: processingActivities.companyId, c: processingActivities.code, n: processingActivities.name }).from(processingActivities).where(inArray(processingActivities.id, ids)), (r) => code(r.c, r.n));
  q("exercise", (ids) => db.select({ id: exercises.id, companyId: exercises.companyId, n: exercises.title, seq: exercises.seq }).from(exercises).where(inArray(exercises.id, ids)), (r) => `CV-${r.seq} ${r.n}`);
  q("soc_alert", (ids) => db.select({ id: alertSuggestions.id, companyId: alertSuggestions.companyId, n: sql<string>`coalesce(${alertSuggestions.title}, ${alertSuggestions.description})` }).from(alertSuggestions).where(inArray(alertSuggestions.id, ids)), (r) => r.n.slice(0, 200));
  // informační servis (ADR-088): zdroj úkolu = posouzení položky za společnost
  q("info_item", (ids) => db.select({ id: infoItemReviews.id, companyId: infoItemReviews.companyId, n: infoFeedItems.title }).from(infoItemReviews).innerJoin(infoFeedItems, eq(infoFeedItems.id, infoItemReviews.itemId)).where(inArray(infoItemReviews.id, ids)), (r) => r.n.slice(0, 200));
  // AI Act, CRA, SOC 2 (v0.99)
  q("ai_system", (ids) => db.select({ id: aiSystems.id, companyId: aiSystems.companyId, c: aiSystems.code, n: aiSystems.name }).from(aiSystems).where(inArray(aiSystems.id, ids)), (r) => code(r.c, r.n));
  q("cra_product", (ids) => db.select({ id: craProducts.id, companyId: craProducts.companyId, c: craProducts.code, n: craProducts.name, v: craProducts.version }).from(craProducts).where(inArray(craProducts.id, ids)), (r) => code(r.c, r.v ? `${r.n} ${r.v}` : r.n));
  q("soc2", (ids) => db.select({ id: soc2Engagements.id, companyId: soc2Engagements.companyId, n: audits.title }).from(soc2Engagements).innerJoin(audits, eq(audits.id, soc2Engagements.auditId)).where(inArray(soc2Engagements.id, ids)), (r) => r.n);
  q("project", (ids) => db.select({ id: projects.id, companyId: projects.companyId, c: projects.code, n: projects.name }).from(projects).where(inArray(projects.id, ids)), (r) => code(r.c, r.n));
  // nálezy bezpečnostních testů (v1.60)
  q("sectest_finding", (ids) => db.select({ id: secTestFindings.id, companyId: secTestFindings.companyId, n: secTestFindings.title, h: secTestFindings.host, p: secTestFindings.port }).from(secTestFindings).where(inArray(secTestFindings.id, ids)), (r) => `${r.n} (${r.h}${r.p ? `:${r.p}` : ""})`.slice(0, 200));
  q("host_finding", (ids) => db.select({ id: hostFindings.id, companyId: hostFindings.companyId, code: hostFindings.code, s: hostFindings.subject, h: hostInventories.hostname }).from(hostFindings).innerJoin(hostInventories, eq(hostInventories.id, hostFindings.inventoryId)).where(inArray(hostFindings.id, ids)), (r) => `${hostFindingTitle(r.code, r.s)} (${r.h})`.slice(0, 200));
  // zranitelnosti, nálezy identit a SoD (v1.88)
  q("vulnerability", (ids) => db.select({ id: assetVulnerabilities.id, companyId: assets.companyId, c: assetVulnerabilities.cveId, a: assets.name }).from(assetVulnerabilities).innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId)).where(inArray(assetVulnerabilities.id, ids)), (r) => `${r.c} (${r.a})`);
  q("identity_finding", (ids) => db.select({ id: identityFindings.id, companyId: identityFindings.companyId, s: identitySubjectSql, r: identityFindings.rule }).from(identityFindings).where(inArray(identityFindings.id, ids)), (r) => `${IDENTITY_RULE_INFO[r.r as IdentityRule]?.title ?? r.r}: ${r.s}`.slice(0, 200));
  q("sod_violation", (ids) => db.select({ id: sodViolations.id, companyId: sodViolations.companyId, p: sodViolations.person, s: sodViolations.subject }).from(sodViolations).where(inArray(sodViolations.id, ids)), (r) => `SoD: ${r.p || r.s}`.slice(0, 200));
  await Promise.all(jobs);
  return out;
}

const FINDING_STATUS: Record<string, TaskStatus> = { open: "open", in_progress: "in_progress", closed: "done", accepted: "done" };
const RISK_ACTION_STATUS: Record<string, TaskStatus> = { planned: "open", in_progress: "in_progress", done: "done", cancelled: "cancelled" };
const LEGAL_STATUS: Record<string, TaskStatus> = { open: "open", done: "done", cancelled: "cancelled" };

export async function loadActionItems(db: Db, scope: ActionScope, t: Translate = CS_T, today = new Date().toISOString().slice(0, 10)): Promise<ActionItem[]> {
  const out: ActionItem[] = [];
  const has = (k: ActionKind) => (scope[k]?.length ?? 0) > 0;
  const posIds = new Set<string>();
  const mk = (x: Omit<ActionItem, "key" | "overdue" | "ownerName">) => {
    if (x.ownerPositionId) posIds.add(x.ownerPositionId);
    out.push({ ...x, key: `${x.kind}:${x.id}`, ownerName: null, overdue: actionOverdue(x, today) });
  };
  const jobs: Promise<void>[] = [];
  if (has("task"))
    jobs.push(
      (async () => {
        const rows = await db.select().from(tasks).where(inArray(tasks.companyId, scope.task!));
        const labels = await sourceLabels(db, rows.map((r) => ({ kind: r.sourceKind, id: r.sourceId })));
        for (const r of rows) {
          const kind = r.sourceKind as TaskSource | null;
          const src = kind && r.sourceId ? labels.get(`${kind}:${r.sourceId}`) : null;
          mk({
            kind: "task",
            id: r.id,
            companyId: r.companyId,
            title: r.title,
            source: kind ? `${t.lbl(TASK_LABELS.source[kind])}${src ? `: ${src.label}` : ""}` : null,
            link: `/actions?task=${r.id}`,
            ownerPositionId: r.ownerPositionId,
            assigneeUserId: r.assigneeUserId,
            dueDate: r.dueDate,
            status: r.status as TaskStatus,
            priority: r.priority as ActionItem["priority"],
            completedAt: r.completedAt?.toISOString() ?? null,
          });
        }
      })(),
    );
  if (has("risk_action"))
    jobs.push(
      db
        .select({ a: riskTreatmentActions, companyId: risks.companyId, rc: risks.code, rn: risks.name })
        .from(riskTreatmentActions)
        .innerJoin(risks, eq(risks.id, riskTreatmentActions.riskId))
        .where(inArray(risks.companyId, scope.risk_action!))
        .then((rows) => {
          for (const { a, companyId, rc, rn } of rows)
            mk({
              kind: "risk_action",
              id: a.id,
              companyId,
              title: a.title,
              source: `${t.lbl("Riziko")}: ${code(rc, rn)}`,
              link: `/risks/${a.riskId}`,
              ownerPositionId: a.ownerPositionId,
              dueDate: a.dueDate,
              status: RISK_ACTION_STATUS[a.status] ?? "open",
              priority: null,
              completedAt: a.completedAt?.toISOString() ?? null,
            });
        }),
    );
  if (has("audit_finding"))
    jobs.push(
      db
        .select({ f: auditFindings, companyId: audits.companyId, ac: audits.code, at: audits.title })
        .from(auditFindings)
        .innerJoin(audits, eq(audits.id, auditFindings.auditId))
        .where(inArray(audits.companyId, scope.audit_finding!))
        .then((rows) => {
          for (const { f, companyId, ac, at } of rows)
            mk({
              kind: "audit_finding",
              id: f.id,
              companyId,
              title: `${f.code ? `${f.code} ` : ""}${f.title}`,
              source: `${t.lbl("Audit")}: ${code(ac, at)}`,
              link: `/audits/${f.auditId}`,
              ownerPositionId: f.ownerPositionId,
              dueDate: f.dueDate,
              status: FINDING_STATUS[f.status] ?? "open",
              priority: f.severity === "major" ? "high" : null,
              completedAt: f.closedAt ? `${f.closedAt}T00:00:00.000Z` : null,
            });
        }),
    );
  if (has("legal_task"))
    jobs.push(
      db
        .select()
        .from(legalTasks)
        .where(inArray(legalTasks.companyId, scope.legal_task!))
        .then((rows) => {
          for (const r of rows)
            mk({
              kind: "legal_task",
              id: r.id,
              companyId: r.companyId,
              title: r.title,
              source: t.lbl("Úkol ze změny předpisu"),
              link: r.reviewId ? `/legislation/reviews/${r.reviewId}` : "/legislation",
              ownerPositionId: r.ownerPositionId,
              dueDate: r.dueDate,
              status: LEGAL_STATUS[r.status] ?? "open",
              priority: null,
              completedAt: r.doneAt?.toISOString() ?? null,
            });
        }),
    );
  // úkoly projektů (v1.88, ADR-183): vlastní evidence projektu, v Moje akce jen aktivní projekty
  if (has("project_task"))
    jobs.push(
      db
        .select({ t: projectTasks, p: projects })
        .from(projectTasks)
        .innerJoin(projects, eq(projects.id, projectTasks.projectId))
        .where(and(inArray(projects.companyId, scope.project_task!), eq(projects.status, "active")))
        .then((rows) => {
          for (const { t: r, p } of rows)
            mk({
              kind: "project_task",
              id: r.id,
              companyId: p.companyId,
              title: r.title,
              source: `${p.code ? `${p.code} ` : ""}${p.name}`,
              link: `/projects/${p.id}?tab=tasks`,
              ownerPositionId: null,
              assigneeUserId: r.assigneeId,
              dueDate: r.dueDate,
              status: r.status === "done" ? "done" : r.status === "todo" ? "open" : "in_progress",
              priority: (["low", "medium", "high"].includes(r.priority) ? r.priority : "medium") as "low" | "medium" | "high",
              completedAt: r.doneAt?.toISOString() ?? null,
            });
        }),
    );
  await Promise.all(jobs);
  if (posIds.size) {
    const names = new Map((await db.select({ id: positions.id, name: positions.name }).from(positions).where(inArray(positions.id, [...posIds]))).map((p) => [p.id, p.name]));
    for (const a of out) a.ownerName = a.ownerPositionId ? (names.get(a.ownerPositionId) ?? null) : null;
  }
  // úkol bez funkčního místa, přidělený přímo osobě (v1.62) – jméno osoby
  const asg = [...new Set(out.filter((a) => !a.ownerName && a.assigneeUserId).map((a) => a.assigneeUserId!))];
  if (asg.length) {
    const names = new Map((await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, asg))).map((u) => [u.id, u.name]));
    for (const a of out) if (!a.ownerName && a.assigneeUserId) a.ownerName = names.get(a.assigneeUserId) ?? null;
  }
  return sortActions(out);
}


