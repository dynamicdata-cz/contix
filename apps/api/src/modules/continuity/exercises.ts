import {
  BCM_LABELS,
  EXERCISE_LABELS,
  EXERCISE_TEMPLATES,
  ExerciseCompleteInput,
  ExerciseInput,
  ExerciseLogInput,
  ExercisePatch,
  exerciseCode,
  type ExerciseDto,
  type ExerciseLogKind,
  type ExerciseStatus,
  type Settings,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, getCompanies, inScope, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { continuityPlans, exercisePlans, exercises, orgUnits, planTests, positionHolders, positions, tasks, users } from "../../db/schema";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html as h, printPage } from "../documents/render";
import { tFor } from "../i18n/service";

/* ============================================================
 * Cvičení a tabletop scénáře (ADR-066): plán, průběh (záznam s časem), vyhodnocení → test navázaných plánů
 * kontinuity (`plan_tests`) a nápravná opatření jako úkoly; záznam pro audit (tisk / Word).
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof exercises.$inferSelect;

export function exerciseRoutes(db: Db) {
  async function canEdit(c: Ctx, e: Pick<Row, "facilitatorPositionId">) {
    if (hasPerm(c, "bia:write")) return true;
    if (!e.facilitatorPositionId) return false;
    const rows = await db.select({ u: positionHolders.userId }).from(positionHolders).where(eq(positionHolders.positionId, e.facilitatorPositionId));
    return rows.some((r) => r.u === currentUser(c).id);
  }
  async function row(c: Ctx, id: string) {
    const [e] = await db.select().from(exercises).where(eq(exercises.id, id));
    if (!e) throw new HTTPException(404, { message: "Cvičení nenalezeno" });
    assertScope(c, e.companyId, "Cvičení nenalezeno");
    return e;
  }
  async function writable(c: Ctx, id: string, statuses: ExerciseStatus[]) {
    const e = await row(c, id);
    if (!(await canEdit(c, e))) throw new HTTPException(403, { message: "Cvičení řídí facilitátor nebo správce kontinuity" });
    if (!statuses.includes(e.status as ExerciseStatus)) throw new HTTPException(409, { message: "V tomto stavu cvičení nelze tuto akci provést." });
    return e;
  }
  async function assertPlans(companyId: string, ids: string[]) {
    if (!ids.length) return;
    const ok = await db.select({ id: continuityPlans.id }).from(continuityPlans).where(and(inArray(continuityPlans.id, ids), eq(continuityPlans.companyId, companyId)));
    if (ok.length !== new Set(ids).size) throw new HTTPException(400, { message: "Plán nepatří do společnosti cvičení." });
  }
  async function setPlans(id: string, ids: string[] | undefined) {
    if (!ids) return;
    await db.delete(exercisePlans).where(eq(exercisePlans.exerciseId, id));
    if (ids.length) await db.insert(exercisePlans).values([...new Set(ids)].map((planId) => ({ exerciseId: id, planId })));
  }

  async function dto(c: Ctx, e: Row): Promise<ExerciseDto> {
    const posIds = [...new Set([e.facilitatorPositionId, ...e.participants.map((p) => p.positionId)].filter((x): x is string => !!x))];
    const userIds = [...new Set(e.log.map((l) => l.userId).filter((x): x is string => !!x))];
    const [plans, pos, us, tk] = await Promise.all([
      db.select({ id: continuityPlans.id, code: continuityPlans.code, name: continuityPlans.name }).from(exercisePlans).innerJoin(continuityPlans, eq(continuityPlans.id, exercisePlans.planId)).where(eq(exercisePlans.exerciseId, e.id)).orderBy(asc(continuityPlans.name)),
      posIds.length ? db.select({ id: positions.id, name: positions.name }).from(positions).where(inArray(positions.id, posIds)) : Promise.resolve([]),
      userIds.length ? db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
      db.select({ id: tasks.id, seq: tasks.seq, title: tasks.title, status: tasks.status }).from(tasks).where(and(eq(tasks.sourceKind, "exercise"), eq(tasks.sourceId, e.id))).orderBy(asc(tasks.seq)),
    ]);
    const pn = new Map(pos.map((p) => [p.id, p.name]));
    const un = new Map(us.map((u) => [u.id, u.n]));
    return {
      id: e.id,
      companyId: e.companyId,
      code: exerciseCode(e.seq),
      title: e.title,
      exerciseType: e.exerciseType,
      scenarioKey: e.scenarioKey,
      scenario: e.scenario,
      objectives: e.objectives,
      injects: e.injects,
      participants: e.participants.map((p) => ({ ...p, positionName: p.positionId ? (pn.get(p.positionId) ?? null) : null })),
      plannedAt: e.plannedAt,
      facilitatorPositionId: e.facilitatorPositionId,
      facilitatorPositionName: e.facilitatorPositionId ? (pn.get(e.facilitatorPositionId) ?? null) : null,
      plans: plans.map((p) => ({ id: p.id, name: `${p.code ? `${p.code} ` : ""}${p.name}` })),
      status: e.status as ExerciseStatus,
      startedAt: e.startedAt?.toISOString() ?? null,
      endedAt: e.endedAt?.toISOString() ?? null,
      log: e.log.map((l) => ({ ...l, kind: l.kind as ExerciseLogKind, userName: l.userId ? (un.get(l.userId) ?? null) : null })),
      result: e.result,
      achievedRtoHours: e.achievedRtoHours,
      findings: e.findings,
      lessons: e.lessons,
      tasks: tk,
      canEdit: await canEdit(c, e),
    };
  }
  const one = async (c: Ctx, id: string) => dto(c, await row(c, id));
  const addLog = (e: Row, entry: Row["log"][number]) => [...e.log, entry].slice(-500);

  async function recordOf(c: Ctx, id: string) {
    const d = await one(c, id);
    const s = await settingsFor(db, null, d.companyId);
    return exerciseRecordHtml(d, s, (await tFor(db, c)).locale);
  }

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "continuity"))
    .get("/templates", requirePerm("bia:read"), (c) => c.json(EXERCISE_TEMPLATES))
    .get("/", requirePerm("bia:read"), async (c) => {
      const rows = await db.select().from(exercises).where(inScope(c, exercises.companyId)).orderBy(desc(exercises.plannedAt), desc(exercises.createdAt)).limit(500);
      return c.json(await Promise.all(rows.map((e) => dto(c, e))));
    })
    .post("/", requirePerm("bia:write"), zValidator("json", ExerciseInput), async (c) => {
      const { companyId: requested, planIds, ...input } = c.req.valid("json");
      const companyId = targetCompany(c, requested, "bia:write");
      await assertPlans(companyId, planIds);
      const [e] = await db.insert(exercises).values({ ...input, scenarioKey: input.scenarioKey ?? null, plannedAt: input.plannedAt ?? null, facilitatorPositionId: input.facilitatorPositionId ?? null, companyId, createdById: currentUser(c).id }).returning();
      await setPlans(e!.id, planIds);
      await audit(db, { c, user: currentUser(c), action: "exercise.created", entityType: "exercise", entityId: e!.id, details: { title: e!.title, scenarioKey: e!.scenarioKey } });
      return c.json(await one(c, e!.id), 201);
    })
    .get("/:id", requirePerm("bia:read"), async (c) => c.json(await one(c, c.req.param("id"))))
    .patch("/:id", requirePerm("bia:read"), zValidator("json", ExercisePatch), async (c) => {
      const e = await writable(c, c.req.param("id"), ["planned", "running"]);
      const { planIds, ...input } = c.req.valid("json");
      if (planIds) await assertPlans(e.companyId, planIds);
      const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length) await db.update(exercises).set({ ...set, updatedAt: new Date() }).where(eq(exercises.id, e.id));
      await setPlans(e.id, planIds);
      await audit(db, { c, user: currentUser(c), action: "exercise.updated", entityType: "exercise", entityId: e.id, details: { fields: Object.keys(set), planIds } });
      return c.json(await one(c, e.id));
    })
    .post("/:id/start", requirePerm("bia:read"), async (c) => {
      const e = await writable(c, c.req.param("id"), ["planned"]);
      const now = new Date();
      await db.update(exercises).set({ status: "running", startedAt: now, log: addLog(e, { at: now.toISOString(), kind: "note", text: "Cvičení zahájeno.", userId: currentUser(c).id }), updatedAt: now }).where(eq(exercises.id, e.id));
      await audit(db, { c, user: currentUser(c), action: "exercise.started", entityType: "exercise", entityId: e.id });
      return c.json(await one(c, e.id));
    })
    .post("/:id/log", requirePerm("bia:read"), zValidator("json", ExerciseLogInput), async (c) => {
      const e = await writable(c, c.req.param("id"), ["running"]);
      const { kind, text, injectIndex } = c.req.valid("json");
      if (injectIndex != null && !e.injects[injectIndex]) throw new HTTPException(400, { message: "Neznámý vstup scénáře." });
      await db.update(exercises).set({ log: addLog(e, { at: new Date().toISOString(), kind, text, userId: currentUser(c).id, ...(injectIndex != null ? { injectIndex } : {}) }), updatedAt: new Date() }).where(eq(exercises.id, e.id));
      return c.json(await one(c, e.id));
    })
    .post("/:id/cancel", requirePerm("bia:read"), async (c) => {
      const e = await writable(c, c.req.param("id"), ["planned", "running"]);
      await db.update(exercises).set({ status: "cancelled", updatedAt: new Date() }).where(eq(exercises.id, e.id));
      await audit(db, { c, user: currentUser(c), action: "exercise.cancelled", entityType: "exercise", entityId: e.id });
      return c.json(await one(c, e.id));
    })
    /** Vyhodnocení: test do navázaných plánů, nápravná opatření jako úkoly; dokončené cvičení je neměnné. */
    .post("/:id/complete", requirePerm("bia:read"), zValidator("json", ExerciseCompleteInput), async (c) => {
      const e = await writable(c, c.req.param("id"), ["running"]);
      const input = c.req.valid("json");
      const user = currentUser(c);
      const now = new Date();
      const objectives = e.objectives.map((o, i) => ({ ...o, met: input.objectives[i]?.met ?? o.met, note: input.objectives[i]?.note ?? o.note }));
      // funkční místa úkolů jen ze společnosti cvičení (nebo nadřazených)
      const posIds = [...new Set(input.actions.map((a) => a.ownerPositionId).filter((x): x is string => !!x))];
      if (posIds.length) {
        const lineage = [e.companyId, ...ancestorsOfCompany(await getCompanies(db), e.companyId)];
        const ok = await db.select({ id: positions.id }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(and(inArray(positions.id, posIds), inArray(orgUnits.companyId, lineage)));
        if (ok.length !== posIds.length) throw new HTTPException(400, { message: "Funkční místo nepatří do společnosti cvičení." });
      }
      await db
        .update(exercises)
        .set({ status: "completed", endedAt: now, result: input.result, achievedRtoHours: input.achievedRtoHours ?? null, findings: input.findings, lessons: input.lessons, objectives, log: addLog(e, { at: now.toISOString(), kind: "note", text: "Cvičení ukončeno a vyhodnoceno.", userId: user.id }), updatedAt: now })
        .where(eq(exercises.id, e.id));
      const participants = e.participants.map((p) => [p.name, p.role].filter(Boolean).join(" – ")).filter(Boolean).join(", ");
      const linked = await db.select().from(exercisePlans).where(eq(exercisePlans.exerciseId, e.id));
      for (const l of linked) {
        const [t] = await db
          .insert(planTests)
          .values({
            planId: l.planId,
            testedAt: (e.startedAt ?? now).toISOString().slice(0, 10),
            testType: e.exerciseType,
            scenario: `${exerciseCode(e.seq)} ${e.title}${e.scenario ? ` – ${e.scenario}` : ""}`.slice(0, 10000),
            participants: participants || null,
            result: input.result,
            achievedRtoHours: input.achievedRtoHours ?? null,
            findings: input.findings || null,
            improvements: input.lessons || null,
            createdById: user.id,
          })
          .returning({ id: planTests.id });
        await db.update(exercisePlans).set({ planTestId: t!.id }).where(and(eq(exercisePlans.exerciseId, e.id), eq(exercisePlans.planId, l.planId)));
      }
      for (const a of input.actions)
        await db.insert(tasks).values({ companyId: e.companyId, title: a.title, description: `Nápravné opatření ze cvičení ${exerciseCode(e.seq)} ${e.title}`.slice(0, 5000), sourceKind: "exercise", sourceId: e.id, ownerPositionId: a.ownerPositionId, dueDate: a.dueDate, priority: input.result === "failed" ? "high" : "medium", createdById: user.id });
      await audit(db, { c, user, action: "exercise.completed", entityType: "exercise", entityId: e.id, details: { result: input.result, planTests: linked.length, tasks: input.actions.length } });
      return c.json(await one(c, e.id));
    })
    .get("/:id/record.html", requirePerm("bia:read"), async (c) => {
      const r = await recordOf(c, c.req.param("id"));
      return c.html(printPage(r.title, r.html, (await tFor(db, c)).locale), 200, { "cache-control": "private, no-store" });
    })
    .get("/:id/record.docx", requirePerm("bia:read"), async (c) => {
      const r = await recordOf(c, c.req.param("id"));
      return docxResponse(await htmlToDocx(r.html, { title: r.title, headerLine: r.org }), `${r.title}.docx`);
    });
}

function ancestorsOfCompany(rows: { id: string; parentId: string | null }[], id: string): string[] {
  const out: string[] = [];
  let cur = rows.find((r) => r.id === id)?.parentId ?? null;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = rows.find((r) => r.id === cur)?.parentId ?? null;
  }
  return out;
}

/** Záznam o cvičení pro audit (podmnožina HTML pro tisk i Word). */
export function exerciseRecordHtml(d: ExerciseDto, s: Settings, locale = "cs") {
  const { esc, nl } = h;
  const loc = locale === "cs" ? "cs-CZ" : locale;
  const dt = (v: string | null) => (v ? new Date(v).toLocaleString(loc, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Prague" }) : "—");
  const row = (k: string, v: string) => `<tr><th style="width:30%">${esc(k)}</th><td>${v}</td></tr>`;
  const txt = (v: string) => (v.trim() ? nl(v) : `<span class="muted">neuvedeno</span>`);
  const title = `Záznam o cvičení ${d.code}`;
  const parts: string[] = [];
  parts.push(`<div class="muted small">${esc(s.organizationName)}</div><h1>${esc(title)}</h1><div class="muted">Test plánů kontinuity a reakce na incidenty – § 15 vyhl. č. 409/2025 Sb.</div>`);
  parts.push(`<h2>1. Identifikace</h2><table><tbody>
${row("Název", esc(d.title))}
${row("Druh cvičení", esc(BCM_LABELS.testType[d.exerciseType]))}
${row("Stav", esc(EXERCISE_LABELS.status[d.status]))}
${row("Plánováno", esc(d.plannedAt ?? "—"))}
${row("Průběh", `${esc(dt(d.startedAt))} – ${esc(dt(d.endedAt))}`)}
${row("Facilitátor", esc(d.facilitatorPositionName ?? "—"))}
${row("Testované plány", esc(d.plans.map((p) => p.name).join(", ") || "—"))}
</tbody></table>`);
  parts.push(`<h2>2. Scénář</h2><p>${txt(d.scenario)}</p>`);
  parts.push(`<h2>3. Účastníci</h2>${d.participants.length ? `<table><tbody>${d.participants.map((p) => `<tr><td>${esc(p.name || p.positionName || "—")}</td><td>${esc(p.role)}</td><td>${esc(p.positionName ?? "")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">neuvedeno</p>`}`);
  parts.push(`<h2>4. Cíle a jejich splnění</h2>${d.objectives.length ? `<table><tbody>${d.objectives.map((o) => `<tr><td>${esc(o.text)}</td><td>${esc(o.met == null ? "nehodnoceno" : o.met ? "splněno" : "nesplněno")}</td><td>${esc(o.note)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">neuvedeno</p>`}`);
  parts.push(`<h2>5. Průběh</h2>${d.log.length ? `<table><tbody>${d.log.map((l) => `<tr><th style="width:22%">${esc(dt(l.at))}</th><td>${esc(EXERCISE_LABELS.logKind[l.kind])}</td><td>${nl(l.text)}${l.userName ? `<br><span class="small muted">${esc(l.userName)}</span>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">bez záznamů</p>`}`);
  parts.push(`<h2>6. Vyhodnocení</h2><table><tbody>
${row("Výsledek", esc(d.result ? BCM_LABELS.result[d.result] : "—"))}
${row("Dosažené RTO (h)", esc(d.achievedRtoHours != null ? String(d.achievedRtoHours) : "—"))}
${row("Zjištění", txt(d.findings))}
${row("Poučení a doporučení", txt(d.lessons))}
</tbody></table>`);
  parts.push(`<h2>7. Nápravná opatření</h2>${d.tasks.length ? `<ul>${d.tasks.map((t) => `<li>Ú-${t.seq} ${esc(t.title)} (${esc(t.status)})</li>`).join("")}</ul>` : `<p class="muted">bez nápravných opatření</p>`}`);
  return { title, org: s.organizationName, html: parts.join("\n") };
}
