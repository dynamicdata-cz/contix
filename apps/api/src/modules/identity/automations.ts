import {
  AUTOMATION_DAYS,
  AUTOMATION_LABELS,
  ControlAutomationInput,
  IDENTITY_LABELS,
  IDENTITY_RULES,
  IDENTITY_RULE_INFO,
  IDENTITY_SEVERITIES,
  effectivenessFromResult,
  identityCheckResult,
  type ControlAutomationDto,
  type IdentityRule,
  type IdentitySeverity,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, eq, inArray, isNull, ne, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHash } from "node:crypto";
import { currentUser, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  accessReviewItems,
  accessReviews,
  controlAutomations,
  controls,
  controlTests,
  controlTestSamples,
  evidence,
  evidenceControls,
  evidenceFiles,
  identityAccounts,
  identityFindings,
  identitySources,
} from "../../db/schema";
import { loadItems, reviewReportHtml } from "./reviews";

/* ============================================================
 * Automatické testy opatření (ADR-031): výsledek kontrol účtů a uzavřený přezkum přístupů se zapíše
 * jako dokončený test opatření s důkazem (CSV nálezů / protokol přezkumu). Účinnost opatření se mění
 * jen u automatizace s výslovně zapnutým `applyEffectiveness`.
 * ============================================================ */

type AutomationRow = typeof controlAutomations.$inferSelect;
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const TESTER = "CONTIX – automatický test";

export async function storeAutomationEvidence(db: Db, a: AutomationRow, e: { title: string; description: string; kind: "export" | "report"; periodFrom: string; periodTo: string; validUntil: string; filename: string; mime: string; content: Uint8Array }) {
  const [ev] = await db
    .insert(evidence)
    .values({ companyId: a.companyId, title: e.title.slice(0, 300), description: e.description, kind: e.kind, collectedAt: e.periodTo, periodFrom: e.periodFrom, periodTo: e.periodTo, validUntil: e.validUntil, createdById: a.createdById })
    .returning({ id: evidence.id });
  await db.insert(evidenceFiles).values({
    evidenceId: ev!.id,
    filename: e.filename,
    mime: e.mime,
    size: e.content.byteLength,
    sha256: createHash("sha256").update(e.content).digest("hex"),
    content: Buffer.from(e.content),
    uploadedById: a.createdById,
  });
  await db.insert(evidenceControls).values({ evidenceId: ev!.id, controlId: a.controlId });
  return ev!.id;
}

export async function finishAutomationTest(db: Db, a: AutomationRow, t: { title: string; procedure: string; population: number; result: "effective" | "effective_with_exceptions" | "ineffective"; conclusion: string; periodFrom: string; periodTo: string; tolerable: number; samples: { ref: string; description: string; result: "pass" | "fail"; evidenceId: string }[] }) {
  const [test] = await db
    .insert(controlTests)
    .values({
      companyId: a.companyId,
      controlId: a.controlId,
      kind: "operating",
      title: t.title.slice(0, 300),
      methods: ["reperformance"],
      frequency: a.kind !== "access_review" ? a.frequency : null,
      periodFrom: t.periodFrom,
      periodTo: t.periodTo,
      status: "completed",
      tester: TESTER,
      populationSize: t.population,
      procedure: t.procedure,
      tolerableExceptions: t.tolerable,
      result: t.result,
      conclusion: t.conclusion,
      performedAt: t.periodTo,
      createdById: a.createdById,
    })
    .returning({ id: controlTests.id });
  if (t.samples.length) await db.insert(controlTestSamples).values(t.samples.map((s, i) => ({ testId: test!.id, ref: s.ref.slice(0, 200), description: s.description, result: s.result, evidenceId: s.evidenceId, order: i })));
  const eff = a.applyEffectiveness ? effectivenessFromResult(t.result) : null;
  if (eff) await db.update(controls).set({ effectiveness: eff, lastReviewAt: t.periodTo, updatedAt: new Date() }).where(eq(controls.id, a.controlId));
  await db.update(controlAutomations).set({ lastRunAt: new Date(), lastResult: t.result, lastTestId: test!.id, lastError: null, updatedAt: new Date() }).where(eq(controlAutomations.id, a.id));
  await audit(db, { email: "system@contix", action: "control_test.automated", entityType: "control", entityId: a.controlId, details: { automationId: a.id, kind: a.kind, testId: test!.id, result: t.result, effectiveness: eff } });
  return test!.id;
}

/** Automatická kontrola účtů: otevřené nálezy v rozsahu → test se vzorkem za každé pravidlo + CSV důkaz. */
export async function runIdentityCheck(db: Db, a: AutomationRow, now = new Date()) {
  const srcWhere = and(eq(identitySources.companyId, a.companyId), eq(identitySources.enabled, true), a.sourceIds.length ? inArray(identitySources.id, a.sourceIds) : undefined);
  const sources = await db.select().from(identitySources).where(srcWhere);
  const fail = async (msg: string) => {
    await db.update(controlAutomations).set({ lastError: msg, updatedAt: new Date() }).where(eq(controlAutomations.id, a.id));
    throw new Error(msg);
  };
  if (!sources.length) return fail("V rozsahu není žádný zapnutý zdroj (AD / Entra ID).");
  const broken = sources.filter((s) => s.lastStatus !== "ok");
  if (broken.length) return fail(`Zdroj bez úspěšné synchronizace: ${broken.map((s) => s.name).join(", ")} – test se neprovede, aby nevycházel z neúplných dat.`);
  const ids = sources.map((s) => s.id);
  const rules: IdentityRule[] = a.rules.length ? a.rules : [...IDENTITY_RULES];
  const where: SQL = and(inArray(identityFindings.sourceId, ids), eq(identityFindings.status, "open"), inArray(identityFindings.rule, rules))!;
  const [findings, [pop], bySev] = await Promise.all([
    db
      .select({ rule: identityFindings.rule, severity: identityFindings.severity, detail: identityFindings.detail, subject: identityFindings.subject, login: identityAccounts.login, source: identitySources.name, since: identityFindings.firstSeenAt })
      .from(identityFindings)
      .innerJoin(identitySources, eq(identitySources.id, identityFindings.sourceId))
      .leftJoin(identityAccounts, eq(identityAccounts.id, identityFindings.accountId))
      .where(where)
      .orderBy(asc(identityFindings.rule)),
    db.select({ n: count() }).from(identityAccounts).where(and(inArray(identityAccounts.sourceId, ids), isNull(identityAccounts.removedAt), eq(identityAccounts.enabled, true))),
    db.select({ s: identityFindings.severity, n: count() }).from(identityFindings).where(where).groupBy(identityFindings.severity),
  ]);
  const open = Object.fromEntries(IDENTITY_SEVERITIES.map((s) => [s, 0])) as Record<IdentitySeverity, number>;
  for (const r of bySev) open[r.s] = r.n;
  const result = identityCheckResult(open, a);
  const days = AUTOMATION_DAYS[a.frequency];
  const periodTo = day(now);
  const periodFrom = day(a.lastRunAt && a.lastRunAt < now ? a.lastRunAt : addDays(now, -days));
  const [ctl] = await db.select({ name: controls.name, code: controls.code }).from(controls).where(eq(controls.id, a.controlId));
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    ["Zdroj", "Pravidlo", "Závažnost", "Účet / skupina", "Detail", "Otevřeno od"].map(cell).join(";"),
    ...findings.map((f) => [f.source, IDENTITY_RULE_INFO[f.rule as IdentityRule]?.title ?? f.rule, IDENTITY_LABELS.severity[f.severity], f.login ?? f.subject.replace(/^group:/, ""), f.detail, day(f.since)].map(cell).join(";")),
  ].join("\r\n");
  const summary = IDENTITY_SEVERITIES.map((s) => `${IDENTITY_LABELS.severity[s].toLowerCase()} ${open[s]}`).join(", ");
  const evidenceId = await storeAutomationEvidence(db, a, {
    title: `Kontrola účtů v adresáři ${periodTo}${ctl ? ` – ${ctl.code ? `${ctl.code} ` : ""}${ctl.name}` : ""}`,
    description: `Automatický export otevřených nálezů (${sources.map((s) => s.name).join(", ")}): ${summary}. Účtů v rozsahu ${pop?.n ?? 0}.`,
    kind: "export",
    periodFrom,
    periodTo,
    validUntil: day(addDays(now, days * 2)),
    filename: `kontrola-uctu-${periodTo}.csv`,
    mime: "text/csv",
    content: new TextEncoder().encode(`﻿${csv}\r\n`),
  });
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  return finishAutomationTest(db, a, {
    title: `Automatická kontrola účtů ${periodTo}`,
    procedure: `CONTIX načetl účty ze zdrojů ${sources.map((s) => `${s.name} (synchronizace ${s.lastSyncAt ? day(s.lastSyncAt) : "?"})`).join(", ")} a vyhodnotil pravidla: ${rules.map((r) => IDENTITY_RULE_INFO[r].title).join(", ")}. Tolerance: kritické ${a.maxCritical}, vysoké ${a.maxHigh}. Výjimky schválené s odůvodněním se nezapočítávají.`,
    population: pop?.n ?? 0,
    result,
    conclusion:
      result === "effective"
        ? `Bez otevřených nálezů v rozsahu (${pop?.n ?? 0} účtů).`
        : `Otevřené nálezy: ${summary}. ${result === "ineffective" ? "Překročena tolerance kritických / vysokých nálezů – opatření neplní účel, vyřešte nálezy nebo udělte odůvodněné výjimky." : "V toleranci; nálezy řešte v Identity a přístupy."}`,
    periodFrom,
    periodTo,
    tolerable: a.maxCritical + a.maxHigh,
    samples: rules.map((r) => ({ ref: IDENTITY_RULE_INFO[r].title, description: `${counts.get(r) ?? 0} otevřených nálezů`, result: counts.get(r) ? ("fail" as const) : ("pass" as const), evidenceId })),
  });
}

/** Po uzavření přezkumu přístupů: test opatření s protokolem jako důkazem (u automatizací téže společnosti). */
export async function runAccessReviewAutomations(db: Db, reviewId: string) {
  const [r] = await db.select().from(accessReviews).where(eq(accessReviews.id, reviewId));
  if (!r || r.status !== "closed") return [];
  const autos = (await db.select().from(controlAutomations).where(and(eq(controlAutomations.companyId, r.companyId), eq(controlAutomations.kind, "access_review"), eq(controlAutomations.enabled, true)))).filter(
    (a) => !a.sourceIds.length || !r.scope.sourceIds.length || a.sourceIds.some((s) => r.scope.sourceIds.includes(s)),
  );
  if (!autos.length) return [];
  const items = await loadItems(db, eq(accessReviewItems.reviewId, reviewId));
  const report = await reviewReportHtml(db, reviewId);
  const revoke = items.filter((i) => i.decision === "revoke");
  const pendingRevoke = revoke.filter((i) => !i.remediated);
  const result = pendingRevoke.length ? ("effective_with_exceptions" as const) : ("effective" as const);
  const out: string[] = [];
  for (const a of autos) {
    const evidenceId = await storeAutomationEvidence(db, a, {
      title: `Protokol přezkumu přístupů – ${r.name}`,
      description: `Uzavřený přezkum: ${items.length} účtů, ponechat ${items.length - revoke.length}, odebrat ${revoke.length} (provedeno ${revoke.length - pendingRevoke.length}).`,
      kind: "report",
      periodFrom: day(r.createdAt),
      periodTo: day(r.closedAt ?? new Date()),
      validUntil: day(addDays(r.closedAt ?? new Date(), 400)),
      filename: `prezkum-pristupu-${day(r.closedAt ?? new Date())}.html`,
      mime: "text/html",
      content: new TextEncoder().encode(report.html),
    });
    const samples = items.slice(0, 500).map((i) => ({
      ref: i.login,
      description: `${i.access.join(", ") || "účet"} – ${i.decision === "keep" ? "ponechat" : `odebrat${i.note ? ` (${i.note})` : ""}`}`,
      result: i.decision === "revoke" && !i.remediated ? ("fail" as const) : ("pass" as const),
      evidenceId,
    }));
    out.push(
      await finishAutomationTest(db, a, {
        title: `Přezkum přístupů: ${r.name}`,
        procedure: `Recenzenti (${AUTOMATION_LABELS.kind.access_review.toLowerCase()}) potvrdili u každého účtu v rozsahu, zda přístup ponechat, nebo odebrat; odebrání ověřeno podle stavu adresáře nebo potvrzeno správcem.`,
        population: items.length,
        result,
        conclusion: pendingRevoke.length
          ? `Přezkum dokončen; ${pendingRevoke.length} z ${revoke.length} odebrání zatím neprovedeno (${pendingRevoke.slice(0, 10).map((i) => i.login).join(", ")}${pendingRevoke.length > 10 ? "…" : ""}).`
          : `Přezkum dokončen, všechna rozhodnutí o odebrání provedena (${revoke.length}).`,
        periodFrom: day(r.createdAt),
        periodTo: day(r.closedAt ?? new Date()),
        tolerable: 0,
        samples,
      }),
    );
  }
  return out;
}

/** Plánovač: automatické kontroly účtů, kterým uplynul interval. */
export async function processAutomations(db: Db, now = new Date()): Promise<string[]> {
  const rows = await db.select().from(controlAutomations).where(and(eq(controlAutomations.kind, "identity_checks"), eq(controlAutomations.enabled, true)));
  const errors: string[] = [];
  for (const a of rows) {
    if (a.lastRunAt && now.getTime() - a.lastRunAt.getTime() < AUTOMATION_DAYS[a.frequency] * 86_400_000 - 3_600_000) continue;
    await runIdentityCheck(db, a, now).catch((e) => errors.push((e as Error).message));
  }
  return errors;
}

/* ---------------- API ---------------- */

export function automationRoutes(db: Db) {
  async function row(c: Context<AppEnv>, id: string) {
    const [a] = await db.select().from(controlAutomations).where(eq(controlAutomations.id, id));
    if (!a || a.kind === "sca") throw new HTTPException(404, { message: "Automatizace nenalezena" });
    assertScope(c, a.companyId, "Automatizace nenalezena");
    return a;
  }
  async function controlFor(c: Context<AppEnv>, id: string) {
    const [ctl] = await db.select({ id: controls.id, companyId: controls.companyId }).from(controls).where(eq(controls.id, id));
    if (!ctl) throw new HTTPException(400, { message: "Opatření nenalezeno" });
    assertScope(c, ctl.companyId, "Opatření nenalezeno");
    if (!hasPermIn(c, "controls:test", ctl.companyId)) throw new HTTPException(403, { message: "K automatickým testům opatření je potřeba oprávnění testovat opatření." });
    return ctl;
  }
  async function list(where: SQL | undefined): Promise<ControlAutomationDto[]> {
    const rows = await db.select({ a: controlAutomations, name: controls.name, code: controls.code }).from(controlAutomations).innerJoin(controls, eq(controls.id, controlAutomations.controlId)).where(where).orderBy(asc(controls.code), asc(controls.name));
    return rows.map(({ a, name, code }) => ({
      id: a.id,
      companyId: a.companyId,
      controlId: a.controlId,
      controlName: `${code ? `${code} ` : ""}${name}`,
      kind: a.kind,
      frequency: a.frequency,
      sourceIds: a.sourceIds,
      rules: a.rules,
      maxCritical: a.maxCritical,
      maxHigh: a.maxHigh,
      applyEffectiveness: a.applyEffectiveness,
      enabled: a.enabled,
      scaPolicies: a.scaPolicies,
      scaMinScore: a.scaMinScore,
      scaWarnScore: a.scaWarnScore,
      lastRunAt: a.lastRunAt?.toISOString() ?? null,
      lastResult: a.lastResult,
      lastTestId: a.lastTestId,
      lastError: a.lastError,
    }));
  }
  const values = (i: ReturnType<typeof ControlAutomationInput.parse>) => ({
    controlId: i.controlId,
    kind: i.kind,
    frequency: i.frequency,
    sourceIds: i.sourceIds,
    rules: i.rules,
    maxCritical: i.maxCritical,
    maxHigh: i.maxHigh,
    applyEffectiveness: i.applyEffectiveness,
    enabled: i.enabled,
    scaPolicies: i.scaPolicies,
    scaMinScore: i.scaMinScore,
    scaWarnScore: i.scaWarnScore,
  });

  return new Hono<AppEnv>()
    .get("/", requirePerm("identity:read"), async (c) => c.json(await list(and(inScope(c, controlAutomations.companyId), ne(controlAutomations.kind, "sca")))))
    .post("/", requirePerm("identity:write"), zValidator("json", ControlAutomationInput), async (c) => {
      const input = c.req.valid("json");
      if (input.kind === "sca") throw new HTTPException(400, { message: "Automatický test shody konfigurace se nastavuje v Opatření → Shoda konfigurace." });
      const ctl = await controlFor(c, input.controlId);
      const [a] = await db.insert(controlAutomations).values({ ...values(input), companyId: ctl.companyId, createdById: currentUser(c).id }).returning();
      await audit(db, { c, user: currentUser(c), action: "control_automation.created", entityType: "control", entityId: ctl.id, details: { automationId: a!.id, ...values(input) } });
      return c.json((await list(eq(controlAutomations.id, a!.id)))[0], 201);
    })
    .put("/:id", requirePerm("identity:write"), zValidator("json", ControlAutomationInput), async (c) => {
      const prev = await row(c, c.req.param("id"));
      const input = c.req.valid("json");
      if (input.kind === "sca" || prev.kind === "sca") throw new HTTPException(400, { message: "Automatický test shody konfigurace se nastavuje v Opatření → Shoda konfigurace." });
      const ctl = await controlFor(c, input.controlId);
      await db.update(controlAutomations).set({ ...values(input), companyId: ctl.companyId, updatedAt: new Date() }).where(eq(controlAutomations.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "control_automation.updated", entityType: "control", entityId: ctl.id, details: { automationId: prev.id, ...values(input) } });
      return c.json((await list(eq(controlAutomations.id, prev.id)))[0]);
    })
    .delete("/:id", requirePerm("identity:write"), async (c) => {
      const prev = await row(c, c.req.param("id"));
      await db.delete(controlAutomations).where(eq(controlAutomations.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "control_automation.deleted", entityType: "control", entityId: prev.controlId, details: { automationId: prev.id } });
      return c.json({ ok: true });
    })
    .post("/:id/run", requirePerm("identity:write"), async (c) => {
      const a = await row(c, c.req.param("id"));
      await controlFor(c, a.controlId);
      if (a.kind !== "identity_checks") throw new HTTPException(409, { message: "Test z přezkumu přístupů vznikne automaticky při jeho uzavření." });
      try {
        const testId = await runIdentityCheck(db, a);
        return c.json((await list(eq(controlAutomations.id, a.id)))[0] ?? { testId });
      } catch (e) {
        throw new HTTPException(409, { message: (e as Error).message });
      }
    });
}
