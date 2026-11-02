import { allRequirements, FrameworkIdSchema, type FrameworkId, profileOf, AuditInput,
  AuditPatch,
  auditGaps,
  coverageState,
  FindingInput,
  FindingPatch,
  FINDING_SEVERITIES,
  requirementById,
  requirementsOf,
  type AuditCoverageRow,
  type AuditDetail,
  type AuditListItem,
  type FindingDto,
  type FindingSeverity,
  AUDIT_CHECK_RESULTS,
  AuditCheckInput,
  checklistFor,
  getMethodology,
  type AuditChecklistDto,
  type AuditCheckResult,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit as auditLog, type AppEnv } from "../../auth/service";
import { assertScope, inScope, scopeOf, settingsFor, targetCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import { auditChanges, auditChecks, auditFindings, audits, changes, controls, positions, risks, suppliers } from "../../db/schema";
import { ApiError } from "../../lib/apiError";

type Ctx = Context<AppEnv>;
type AuditRow = typeof audits.$inferSelect;
type FindingRow = typeof auditFindings.$inferSelect;

const AUDITOR_ROLE = "Auditor kybernetické bezpečnosti";
const today = () => new Date().toISOString().slice(0, 10);
const isNc = (s: FindingSeverity) => s === "major" || s === "minor";
const openStatus = (s: string) => s === "open" || s === "in_progress";

export async function loadFindings(db: Db, where?: SQL): Promise<FindingDto[]> {
  const rows = await db
    .select({ f: auditFindings, a: { id: audits.id, code: audits.code, title: audits.title }, owner: positions.name, risk: risks.name, ctlCode: controls.code, ctlName: controls.name })
    .from(auditFindings)
    .innerJoin(audits, eq(audits.id, auditFindings.auditId))
    .leftJoin(positions, eq(positions.id, auditFindings.ownerPositionId))
    .leftJoin(risks, eq(risks.id, auditFindings.riskId))
    .leftJoin(controls, eq(controls.id, auditFindings.controlId))
    .where(where)
    .orderBy(asc(auditFindings.code), asc(auditFindings.createdAt));
  const t = today();
  return rows.map(({ f, a, owner, risk, ctlCode, ctlName }) => ({
    id: f.id,
    auditId: a.id,
    auditCode: a.code,
    auditTitle: a.title,
    code: f.code,
    title: f.title,
    description: f.description,
    severity: f.severity,
    status: f.status,
    requirementId: f.requirementId,
    requirementRef: f.requirementId ? (requirementById(f.requirementId)?.ref ?? f.requirementId) : null,
    correctiveAction: f.correctiveAction,
    ownerPositionId: f.ownerPositionId,
    ownerPositionName: owner,
    dueDate: f.dueDate,
    closedAt: f.closedAt,
    verification: f.verification,
    riskId: f.riskId,
    riskName: risk,
    controlId: f.controlId,
    controlLabel: ctlName ? (ctlCode ? `${ctlCode} ${ctlName}` : ctlName) : null,
    awareness: f.awareness,
    overdue: openStatus(f.status) && !!f.dueDate && f.dueDate < t,
  }));
}

/** Seznam auditů s počty zjištění a mezerami (použito i ve snímcích dokumentů). */
export async function loadAudits(db: Db, where?: SQL) {
  const rows = await db.select().from(audits).where(where).orderBy(desc(sql`coalesce(${audits.performedEnd}, ${audits.plannedStart})`), desc(audits.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const posIds = [...new Set(rows.map((r) => r.auditorPositionId).filter((x): x is string => !!x))];
  const [findings, pos] = await Promise.all([
    loadFindings(db, inArray(auditFindings.auditId, ids)),
    posIds.length ? db.select({ id: positions.id, name: positions.name, roles: positions.securityRoles }).from(positions).where(inArray(positions.id, posIds)) : [],
  ]);
  return rows.map((a) => {
    const f = findings.filter((x) => x.auditId === a.id);
    const counts = Object.fromEntries(FINDING_SEVERITIES.map((s) => [s, f.filter((x) => x.severity === s).length])) as Record<FindingSeverity, number>;
    const p = pos.find((x) => x.id === a.auditorPositionId);
    const item: AuditListItem = {
      id: a.id,
      companyId: a.companyId,
      code: a.code,
      title: a.title,
      auditType: a.auditType,
      status: a.status,
      sections: a.sections,
      plannedStart: a.plannedStart,
      performedEnd: a.performedEnd,
      auditorName: a.auditorName ?? p?.name ?? null,
      findings: counts,
      openFindings: f.filter((x) => openStatus(x.status)).length,
      overdueFindings: f.filter((x) => x.overdue).length,
      gaps: auditGaps({
        ...a,
        auditorName: a.auditorName ?? p?.name ?? null,
        auditorOtherRoles: (p?.roles ?? []).filter((r) => r !== AUDITOR_ROLE),
        findingsWithoutAction: f.filter((x) => isNc(x.severity) && openStatus(x.status) && !x.correctiveAction).length,
      }),
      updatedAt: a.updatedAt.toISOString(),
    };
    return { ...item, _row: a, _findings: f, _positionName: p?.name ?? null };
  });
}

/** Pokrytí oddílů vyhl. 409 dokončenými audity (§ 16 odst. 4 písm. b) a odst. 5). */
export async function auditCoverage(db: Db, companyIds: string[] | undefined, fw: FrameworkId): Promise<AuditCoverageRow[]> {
  const done = await db
    .select({ id: audits.id, sections: audits.sections, end: audits.performedEnd, type: audits.auditType })
    .from(audits)
    .where(and(eq(audits.status, "completed"), inArray(audits.auditType, ["regular", "partial", "change"]), companyIds ? inArray(audits.companyId, companyIds) : undefined));
  const sections = [...new Map(requirementsOf(fw).map((r) => [r.section, r.sectionTitle])).entries()];
  return sections.map(([section, title]) => {
    let last: { at: string; id: string } | null = null;
    for (const a of done) {
      if (!a.end) continue;
      const covers = a.type === "regular" && !a.sections.length ? true : a.sections.includes(section);
      if (covers && (!last || a.end > last.at)) last = { at: a.end, id: a.id };
    }
    return { section, title, lastAudit: last?.at ?? null, lastAuditId: last?.id ?? null, state: coverageState(last?.at ?? null) };
  });
}

export const auditPeriod = (from?: string | null, to?: string | null) =>
  and(eq(audits.status, "completed"), from ? gte(audits.performedEnd, from) : undefined, to ? lte(audits.performedEnd, to) : undefined);

/** Souhrn auditů a zjištění pro zprávu o hodnocení rizik a přezkoumání ISMS. */
export async function auditSummary(db: Db, fw: FrameworkId, from?: string | null, to?: string | null, companyIds?: string[]) {
  const co = companyIds ? inArray(audits.companyId, companyIds) : undefined;
  const [done, openF, coverage] = await Promise.all([
    loadAudits(db, and(auditPeriod(from, to), co)),
    loadFindings(db, and(or(eq(auditFindings.status, "open"), eq(auditFindings.status, "in_progress")), co)),
    auditCoverage(db, companyIds, fw),
  ]);
  return {
    audits: done.map((a) => ({ code: a.code, title: a.title, type: a.auditType, performedEnd: a.performedEnd, auditor: a.auditorName, findings: a.findings, conclusion: a._row.conclusion, managementInformedAt: a._row.managementInformedAt })),
    openFindings: openF.length,
    overdueFindings: openF.filter((f) => f.overdue).length,
    openMajor: openF.filter((f) => f.severity === "major").length,
    overdueList: openF.filter((f) => f.overdue).map((f) => ({ audit: f.auditCode ?? f.auditTitle, title: f.title, severity: f.severity, dueDate: f.dueDate, owner: f.ownerPositionName })),
    coverage: { ok: coverage.filter((c) => c.state === "ok").length, partial: coverage.filter((c) => c.state === "partial").length, overdue: coverage.filter((c) => c.state === "overdue").length, total: coverage.length },
  };
}
export type AuditSummary = Awaited<ReturnType<typeof auditSummary>>;

/** Audity kybernetické bezpečnosti – § 16 vyhl. č. 409/2025 Sb. */
export function auditRoutes(db: Db) {
  /** Riziko a opatření zjištění jen ze společnosti auditu (v1.05). */
  async function sameCompany(companyId: string, riskId?: string | null, controlId?: string | null) {
    if (riskId) {
      const [r] = await db.select({ companyId: risks.companyId }).from(risks).where(eq(risks.id, riskId));
      if (!r || r.companyId !== companyId) throw new HTTPException(400, { message: "Riziko nepatří do společnosti auditu" });
    }
    if (controlId) {
      const [x] = await db.select({ companyId: controls.companyId }).from(controls).where(eq(controls.id, controlId));
      if (!x || x.companyId !== companyId) throw new HTTPException(400, { message: "Opatření nepatří do společnosti auditu" });
    }
  }
  async function detail(c: Ctx, id: string): Promise<AuditDetail> {
    const [item] = await loadAudits(db, eq(audits.id, id));
    if (!item) throw new HTTPException(404, { message: "Audit nenalezen" });
    assertScope(c, item.companyId, "Audit nenalezen");
    const { _row: a, _findings, _positionName, ...rest } = item;
    const [ch, sup] = await Promise.all([
      db.select({ id: changes.id, code: changes.code, title: changes.title }).from(auditChanges).innerJoin(changes, eq(changes.id, auditChanges.changeId)).where(eq(auditChanges.auditId, id)),
      a.supplierId ? db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, a.supplierId)) : [],
    ]);
    return {
      ...rest,
      scope: a.scope,
      plannedEnd: a.plannedEnd,
      performedStart: a.performedStart,
      auditorPositionId: a.auditorPositionId,
      auditorPositionName: _positionName,
      auditorExternal: a.auditorExternal,
      auditorQualified: a.auditorQualified,
      auditorIndependent: a.auditorIndependent,
      conclusion: a.conclusion,
      reportRef: a.reportRef,
      managementInformedAt: a.managementInformedAt,
      supplierId: a.supplierId,
      supplierName: sup[0]?.name ?? null,
      changes: ch,
      findingList: _findings,
      methodologyKey: a.methodologyKey,
      methodologyName: a.methodologyKey ? (getMethodology(a.methodologyKey)?.name ?? a.methodologyKey) : null,
      canEdit: hasPerm(c, "audits:write"),
    };
  }

  /** Dokončený audit při významné změně splní u navázaných změn krok § 16 odst. 4 písm. a). */
  async function syncChanges(a: AuditRow) {
    if (a.status !== "completed") return;
    const links = await db.select().from(auditChanges).where(eq(auditChanges.auditId, a.id));
    if (links.length) await db.update(changes).set({ audit: "done", updatedAt: new Date() }).where(inArray(changes.id, links.map((l) => l.changeId)));
  }

  async function setChanges(auditId: string, ids?: string[]) {
    if (!ids) return;
    await db.delete(auditChanges).where(eq(auditChanges.auditId, auditId));
    const u = [...new Set(ids)];
    if (u.length) await db.insert(auditChanges).values(u.map((changeId) => ({ auditId, changeId })));
  }

  /** Metodika auditu musí být kontrolní seznam (vestavěný nebo importovaný). */
  const assertAuditMethodology = (key: string | null | undefined) => {
    if (key && getMethodology(key)?.kind !== "audit") throw new ApiError(400, "err.audits.methNotFound", { key: String(key) });
  };

  async function checklist(c: Ctx, id: string): Promise<AuditChecklistDto> {
    const [a] = await db.select().from(audits).where(eq(audits.id, id));
    if (!a) throw new HTTPException(404, { message: "Audit nenalezen" });
    assertScope(c, a.companyId, "Audit nenalezen");
    const def = getMethodology(a.methodologyKey);
    const summary = Object.fromEntries(AUDIT_CHECK_RESULTS.map((r) => [r, 0])) as Record<AuditCheckResult, number>;
    if (!def || def.kind !== "audit") return { methodologyKey: a.methodologyKey, methodologyName: null, items: [], summary };
    const rows = await db
      .select({ k: auditChecks, findingCode: auditFindings.code })
      .from(auditChecks)
      .leftJoin(auditFindings, eq(auditFindings.id, auditChecks.findingId))
      .where(eq(auditChecks.auditId, id));
    const byItem = new Map(rows.map((r) => [r.k.itemId, r]));
    const items = checklistFor(def, a.sections).map((i) => {
      const r = byItem.get(i.id);
      const result = r?.k.result ?? "not_checked";
      summary[result]++;
      return {
        itemId: i.id,
        section: i.section ?? null,
        ref: i.ref ?? null,
        requirementId: i.requirementId ?? null,
        question: i.question,
        guidance: i.guidance ?? null,
        result,
        note: r?.k.note ?? null,
        findingId: r?.k.findingId ?? null,
        findingCode: r?.findingCode ?? null,
      };
    });
    return { methodologyKey: def.id, methodologyName: def.name, items, summary };
  }

  async function checkItem(c: Ctx, id: string, itemId: string) {
    const list = await checklist(c, id);
    const item = list.items.find((i) => i.itemId === itemId);
    if (!item) throw new HTTPException(404, { message: "Položka kontrolního seznamu nenalezena" });
    return item;
  }

  const cleanSections = (s?: string[]) => {
    if (!s) return s;
    // oddíly libovolného rámce (rozsah auditu podle hlavního rámce profilu nebo zvoleného kontrolního seznamu)
    const known = new Set(allRequirements().map((r) => r.section));
    return [...new Set(s)].filter((x) => known.has(x));
  };

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "audits"))
      .get("/", requirePerm("audits:read"), zValidator("query", z.object({ status: z.enum(["open", "all"]).optional() })), async (c) => {
        const { status } = c.req.valid("query");
        const rows = await loadAudits(db, and(inScope(c, audits.companyId), status === "open" ? inArray(audits.status, ["planned", "in_progress"]) : undefined));
        return c.json(rows.map(({ _row, _findings, _positionName, ...x }) => x));
      })
      /** Pokrytí oddílů vyhlášky dle režimu společnosti (vyšší povinnosti = 409, nižší = 410). */
      .get("/coverage", requirePerm("audits:read"), zValidator("query", z.object({ framework: FrameworkIdSchema.optional() })), async (c) => {
        const fw = c.req.valid("query").framework ?? profileOf(await settingsFor(db, c)).defaultFramework;
        return c.json(await auditCoverage(db, scopeOf(c).ids, fw));
      })
      .get("/findings", requirePerm("audits:read"), zValidator("query", z.object({ status: z.enum(["open", "all"]).optional() })), async (c) => {
        const { status } = c.req.valid("query");
        return c.json(
          await loadFindings(db, and(inScope(c, audits.companyId), status === "all" ? undefined : or(eq(auditFindings.status, "open"), eq(auditFindings.status, "in_progress")))),
        );
      })
      .post("/", requirePerm("audits:write"), zValidator("json", AuditInput), async (c) => {
        const { changeIds, sections, companyId: requested, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "audits:write");
        assertAuditMethodology(input.methodologyKey);
        const [row] = await db.insert(audits).values({ ...input, companyId, sections: cleanSections(sections) ?? [] }).returning();
        await setChanges(row!.id, changeIds);
        await syncChanges(row!);
        await auditLog(db, { c, user: currentUser(c), action: "audit.created", entityType: "audit", entityId: row!.id, details: { title: row!.title, type: row!.auditType } });
        return c.json(await detail(c, row!.id), 201);
      })
      .get("/:id", requirePerm("audits:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
      .patch("/:id", requirePerm("audits:write"), zValidator("json", AuditPatch), async (c) => {
        const id = c.req.param("id");
        await detail(c, id);
        const { changeIds, sections, ...rest } = c.req.valid("json");
        const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<AuditRow>;
        if (sections) input.sections = cleanSections(sections)!;
        assertAuditMethodology(input.methodologyKey);
        if (input.status === "completed" && !input.performedEnd) {
          const [cur] = await db.select({ end: audits.performedEnd }).from(audits).where(eq(audits.id, id));
          if (!cur?.end) input.performedEnd = today();
        }
        const [row] = await db.update(audits).set({ ...input, updatedAt: new Date() }).where(eq(audits.id, id)).returning();
        if (!row) throw new HTTPException(404, { message: "Audit nenalezen" });
        await setChanges(id, changeIds);
        await syncChanges(row);
        await auditLog(db, { c, user: currentUser(c), action: "audit.updated", entityType: "audit", entityId: id, details: { ...input, changeIds } });
        return c.json(await detail(c, id));
      })
      .delete("/:id", requirePerm("audits:write"), async (c) => {
        const id = c.req.param("id");
        await detail(c, id);
        const [row] = await db.delete(audits).where(eq(audits.id, id)).returning({ title: audits.title });
        if (!row) throw new HTTPException(404, { message: "Audit nenalezen" });
        await auditLog(db, { c, user: currentUser(c), action: "audit.deleted", entityType: "audit", entityId: id, details: row });
        return c.body(null, 204);
      })

      /* ---------- kontrolní seznam (metodika auditu) ---------- */
      .get("/:id/checklist", requirePerm("audits:read"), async (c) => c.json(await checklist(c, c.req.param("id"))))
      .put("/:id/checklist", requirePerm("audits:write"), zValidator("json", AuditCheckInput.extend({ itemId: z.string().min(1).max(60) })), async (c) => {
        const id = c.req.param("id");
        const { itemId, result, note } = c.req.valid("json");
        await checkItem(c, id, itemId);
        const user = currentUser(c);
        await db
          .insert(auditChecks)
          .values({ auditId: id, itemId, result, note: note ?? null, checkedById: user.id })
          .onConflictDoUpdate({ target: [auditChecks.auditId, auditChecks.itemId], set: { result, note: note ?? null, checkedById: user.id, updatedAt: new Date() } });
        await auditLog(db, { c, user, action: "audit.check_updated", entityType: "audit", entityId: id, details: { itemId, result } });
        return c.json(await checklist(c, id));
      })
      /** Zjištění z neshody položky kontrolního seznamu (s vazbou na požadavek). */
      .post(
        "/:id/checklist/finding",
        requirePerm("audits:write"),
        zValidator("json", z.object({ itemId: z.string().min(1).max(60), severity: z.enum(FINDING_SEVERITIES).optional() })),
        async (c) => {
          const id = c.req.param("id");
          const { itemId, severity } = c.req.valid("json");
          const item = await checkItem(c, id, itemId);
          if (item.findingId) throw new HTTPException(409, { message: "Ke položce již zjištění existuje" });
          const sev: FindingSeverity = severity ?? (item.result === "nonconform" ? "minor" : "observation");
          const q = item.question.length > 250 ? `${item.question.slice(0, 247)}…` : item.question;
          const [f] = await db
            .insert(auditFindings)
            .values({
              auditId: id,
              title: `${item.ref ? `${item.ref}: ` : ""}${q}`.slice(0, 300),
              description: item.note,
              severity: sev,
              requirementId: item.requirementId && requirementById(item.requirementId) ? item.requirementId : null,
            })
            .returning();
          await db
            .insert(auditChecks)
            .values({ auditId: id, itemId, result: item.result === "not_checked" ? "nonconform" : item.result, note: item.note, findingId: f!.id })
            .onConflictDoUpdate({ target: [auditChecks.auditId, auditChecks.itemId], set: { findingId: f!.id, updatedAt: new Date() } });
          await auditLog(db, { c, user: currentUser(c), action: "audit.finding_created", entityType: "audit", entityId: id, details: { findingId: f!.id, severity: sev, itemId } });
          return c.json(await checklist(c, id), 201);
        },
      )

      /* ---------- zjištění a nápravná opatření ---------- */
      .post("/:id/findings", requirePerm("audits:write"), zValidator("json", FindingInput), async (c) => {
        const auditId = c.req.param("id");
        const au = await detail(c, auditId);
        const input = c.req.valid("json");
        if (input.requirementId && !requirementById(input.requirementId)) throw new HTTPException(400, { message: "Neznámý požadavek" });
        await sameCompany(au.companyId, input.riskId, input.controlId);
        const [f] = await db.insert(auditFindings).values({ ...input, auditId }).returning();
        await auditLog(db, { c, user: currentUser(c), action: "audit.finding_created", entityType: "audit", entityId: auditId, details: { findingId: f!.id, severity: f!.severity } });
        return c.json(await detail(c, auditId), 201);
      })
      .patch("/:id/findings/:findingId", requirePerm("audits:write"), zValidator("json", FindingPatch), async (c) => {
        const { id, findingId } = c.req.param();
        const au = await detail(c, id);
        const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<FindingRow>;
        await sameCompany(au.companyId, input.riskId, input.controlId);
        if (input.requirementId && !requirementById(input.requirementId)) throw new HTTPException(400, { message: "Neznámý požadavek" });
        if ((input.status === "closed" || input.status === "accepted") && !input.closedAt) input.closedAt = today();
        const [f] = await db.update(auditFindings).set({ ...input, updatedAt: new Date() }).where(and(eq(auditFindings.id, findingId), eq(auditFindings.auditId, id))).returning();
        if (!f) throw new HTTPException(404, { message: "Zjištění nenalezeno" });
        await auditLog(db, { c, user: currentUser(c), action: "audit.finding_updated", entityType: "audit", entityId: id, details: { findingId, ...input } });
        return c.json(await detail(c, id));
      })
      .delete("/:id/findings/:findingId", requirePerm("audits:write"), async (c) => {
        const { id, findingId } = c.req.param();
        await detail(c, id);
        await db.delete(auditFindings).where(and(eq(auditFindings.id, findingId), eq(auditFindings.auditId, id)));
        await auditLog(db, { c, user: currentUser(c), action: "audit.finding_deleted", entityType: "audit", entityId: id, details: { findingId } });
        return c.json(await detail(c, id));
      })
  );
}
