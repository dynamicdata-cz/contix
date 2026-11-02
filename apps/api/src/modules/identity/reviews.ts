import {
  AccessReviewDecisionInput,
  AccessReviewInput,
  ACCESS_REVIEW_LABELS,
  AcceptIdentityFindingInput,
  SodRuleInput,
  revokeRemediated,
  type AccessReviewDetail,
  type AccessReviewDto,
  type AccessReviewItemDto,
  type SodRuleDto,
  type SodViolationDto,
  type Translate,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requirePerm } from "../../auth/middleware";
import { assertScope, inScope, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { CS_T, tFor } from "../i18n/service";
import { accessReviewItems, accessReviews, identityAccounts, identitySources, orgUnits, positionHolders, positions, sodRules, sodViolations, users } from "../../db/schema";
import { docxResponse, htmlToDocx } from "../documents/docx";
import { html as h, printPage } from "../documents/render";
import { evaluateSod } from "./sod";
import { runAccessReviewAutomations } from "./automations";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * Toxické kombinace (SoD) a přezkum přístupů (recertifikace) – /api/identity/sod, /api/identity/reviews (ADR-030).
 * ============================================================ */

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- SoD ---------------- */

export function sodRoutes(db: Db) {
  async function ruleRow(c: Context<AppEnv>, id: string) {
    const [r] = await db.select().from(sodRules).where(eq(sodRules.id, id));
    if (!r) throw new HTTPException(404, { message: "Pravidlo nenalezeno" });
    assertScope(c, r.companyId, "Pravidlo nenalezeno");
    return r;
  }
  async function checkPositions(ids: string[]) {
    if (!ids.length) return;
    const found = await db.select({ id: positions.id }).from(positions).where(inArray(positions.id, ids));
    if (found.length !== new Set(ids).size) throw new HTTPException(400, { message: "Neznámé funkční místo v pravidle." });
  }
  async function violations(c: Context<AppEnv>, where: SQL[]): Promise<SodViolationDto[]> {
    const acc = alias(users, "acc_by");
    const rows = await db
      .select({ v: sodViolations, ruleName: sodRules.name, severity: sodRules.severity, acceptedByName: acc.displayName })
      .from(sodViolations)
      .innerJoin(sodRules, eq(sodRules.id, sodViolations.ruleId))
      .leftJoin(acc, eq(acc.id, sodViolations.acceptedBy))
      .where(and(inScope(c, sodViolations.companyId), ...where))
      .orderBy(sql`case ${sodRules.severity} when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end`, asc(sodRules.name), asc(sodViolations.person))
      .limit(2000);
    const accIds = [...new Set(rows.flatMap((r) => r.v.accountIds))];
    const accs = accIds.length
      ? await db.select({ id: identityAccounts.id, login: identityAccounts.login, sourceName: identitySources.name }).from(identityAccounts).innerJoin(identitySources, eq(identitySources.id, identityAccounts.sourceId)).where(inArray(identityAccounts.id, accIds))
      : [];
    const byId = new Map(accs.map((a) => [a.id, a]));
    return rows.map((r) => ({
      id: r.v.id,
      ruleId: r.v.ruleId,
      ruleName: r.ruleName,
      severity: r.severity,
      subject: r.v.subject,
      person: r.v.person,
      contixUserId: r.v.userId,
      accounts: r.v.accountIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x),
      matchA: r.v.matchA,
      matchB: r.v.matchB,
      status: r.v.status,
      acceptedByName: r.acceptedByName ?? null,
      acceptedReason: r.v.acceptedReason,
      acceptedUntil: r.v.acceptedUntil,
      firstSeenAt: r.v.firstSeenAt.toISOString(),
      resolvedAt: iso(r.v.resolvedAt),
    }));
  }

  return new Hono<AppEnv>()
    .get("/rules", requirePerm("identity:read"), async (c) => {
      const rules = await db.select().from(sodRules).where(inScope(c, sodRules.companyId)).orderBy(asc(sodRules.name));
      const open = await db.select({ ruleId: sodViolations.ruleId, n: count() }).from(sodViolations).where(and(inScope(c, sodViolations.companyId), eq(sodViolations.status, "open"))).groupBy(sodViolations.ruleId);
      const posIds = [...new Set(rules.flatMap((r) => [...r.sideA.positionIds, ...r.sideB.positionIds]))];
      const names = posIds.length ? await db.select({ id: positions.id, name: positions.name }).from(positions).where(inArray(positions.id, posIds)) : [];
      const positionNames = Object.fromEntries(names.map((p) => [p.id, p.name]));
      return c.json(
        rules.map(
          (r): SodRuleDto => ({ id: r.id, companyId: r.companyId, name: r.name, description: r.description, severity: r.severity, sideA: r.sideA, sideB: r.sideB, enabled: r.enabled, open: open.find((x) => x.ruleId === r.id)?.n ?? 0, positionNames }),
        ),
      );
    })
    .post("/rules", requirePerm("identity:write"), zValidator("json", SodRuleInput), async (c) => {
      const input = c.req.valid("json");
      const companyId = targetCompany(c, input.companyId, "identity:write");
      await checkPositions([...input.sideA.positionIds, ...input.sideB.positionIds]);
      const [r] = await db.insert(sodRules).values({ companyId, name: input.name, description: input.description, severity: input.severity, sideA: input.sideA, sideB: input.sideB, enabled: input.enabled }).returning();
      await audit(db, { c, user: currentUser(c), action: "identity.sod_rule_created", entityType: "sod_rule", entityId: r!.id, details: { name: input.name, sideA: input.sideA, sideB: input.sideB } });
      const result = await evaluateSod(db, { ruleId: r!.id });
      return c.json({ id: r!.id, ...result }, 201);
    })
    .put("/rules/:id", requirePerm("identity:write"), zValidator("json", SodRuleInput), async (c) => {
      const prev = await ruleRow(c, c.req.param("id"));
      const input = c.req.valid("json");
      await checkPositions([...input.sideA.positionIds, ...input.sideB.positionIds]);
      await db.update(sodRules).set({ name: input.name, description: input.description, severity: input.severity, sideA: input.sideA, sideB: input.sideB, enabled: input.enabled, updatedAt: new Date() }).where(eq(sodRules.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "identity.sod_rule_updated", entityType: "sod_rule", entityId: prev.id, details: { name: input.name, enabled: input.enabled, sideA: input.sideA, sideB: input.sideB } });
      return c.json({ id: prev.id, ...(await evaluateSod(db, { ruleId: prev.id })) });
    })
    .delete("/rules/:id", requirePerm("identity:write"), async (c) => {
      const prev = await ruleRow(c, c.req.param("id"));
      await db.delete(sodRules).where(eq(sodRules.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "identity.sod_rule_deleted", entityType: "sod_rule", entityId: prev.id, details: { name: prev.name } });
      return c.json({ ok: true });
    })
    .post("/evaluate", requirePerm("identity:write"), async (c) => {
      const s = (await db.select({ id: sodRules.id, companyId: sodRules.companyId }).from(sodRules).where(inScope(c, sodRules.companyId))).map((x) => x.id);
      let total = { opened: 0, resolved: 0, open: 0 };
      for (const id of s) {
        const r = await evaluateSod(db, { ruleId: id });
        total = { opened: total.opened + r.opened, resolved: total.resolved + r.resolved, open: total.open + r.open };
      }
      return c.json(total);
    })
    .get("/violations", requirePerm("identity:read"), zValidator("query", z.object({ status: z.enum(["open", "accepted", "resolved"]).default("open"), ruleId: z.string().uuid().optional() })), async (c) => {
      const q = c.req.valid("query");
      return c.json(await violations(c, [eq(sodViolations.status, q.status), ...(q.ruleId ? [eq(sodViolations.ruleId, q.ruleId)] : [])]));
    })
    .post("/violations/:id/accept", requirePerm("identity:write"), zValidator("json", AcceptIdentityFindingInput), async (c) => {
      const input = c.req.valid("json");
      const [v] = await db.select().from(sodViolations).where(eq(sodViolations.id, c.req.param("id")));
      if (!v) throw new HTTPException(404, { message: "Porušení nenalezeno" });
      assertScope(c, v.companyId, "Porušení nenalezeno");
      if (v.status === "resolved") throw new HTTPException(409, { message: "Vyřešené porušení nelze akceptovat." });
      const max = new Date(Date.now() + 731 * 86_400_000).toISOString().slice(0, 10);
      if (input.until <= today() || input.until > max) throw new HTTPException(400, { message: "Výjimka musí platit do budoucího data, nejdéle 2 roky." });
      await db.update(sodViolations).set({ status: "accepted", acceptedBy: currentUser(c).id, acceptedReason: input.reason, acceptedUntil: input.until }).where(eq(sodViolations.id, v.id));
      await audit(db, { c, user: currentUser(c), action: "identity.sod_accepted", entityType: "sod_violation", entityId: v.id, details: { ruleId: v.ruleId, person: v.person, until: input.until, reason: input.reason } });
      return c.json((await violations(c, [eq(sodViolations.id, v.id)]))[0]);
    })
    .post("/violations/:id/reopen", requirePerm("identity:write"), async (c) => {
      const [v] = await db.select().from(sodViolations).where(eq(sodViolations.id, c.req.param("id")));
      if (!v) throw new HTTPException(404, { message: "Porušení nenalezeno" });
      assertScope(c, v.companyId, "Porušení nenalezeno");
      if (v.status !== "accepted") throw new HTTPException(409, { message: "Znovu otevřít lze jen porušení s výjimkou." });
      await db.update(sodViolations).set({ status: "open", acceptedBy: null, acceptedReason: null, acceptedUntil: null }).where(eq(sodViolations.id, v.id));
      await audit(db, { c, user: currentUser(c), action: "identity.sod_reopened", entityType: "sod_violation", entityId: v.id });
      return c.json((await violations(c, [eq(sodViolations.id, v.id)]))[0]);
    });
}

/* ---------------- přezkum přístupů ---------------- */

/** Recenzent účtu v režimu „vedoucí útvaru“: vedoucí místo útvaru, kde držitel účtu působí (u vedoucího nadřízený útvar). */
async function managerResolver(db: Db) {
  const [units, pos, holders] = await Promise.all([
    db.select({ id: orgUnits.id, parentId: orgUnits.parentId }).from(orgUnits),
    db.select({ id: positions.id, orgUnitId: positions.orgUnitId, isManager: positions.isManager }).from(positions),
    db.select({ positionId: positionHolders.positionId, userId: positionHolders.userId }).from(positionHolders),
  ]);
  const parent = new Map(units.map((u) => [u.id, u.parentId]));
  const managerOf = new Map<string, string>();
  for (const p of pos) if (p.isManager && !managerOf.has(p.orgUnitId)) managerOf.set(p.orgUnitId, p.id);
  const posById = new Map(pos.map((p) => [p.id, p]));
  const held = new Map<string, string[]>();
  for (const h of holders) held.set(h.userId, [...(held.get(h.userId) ?? []), h.positionId]);
  return (userId: string | null): string | null => {
    if (!userId) return null;
    for (const pid of held.get(userId) ?? []) {
      const p = posById.get(pid);
      if (!p) continue;
      let unit: string | null | undefined = p.orgUnitId;
      for (let depth = 0; unit && depth < 20; depth++) {
        const m = managerOf.get(unit);
        if (m && m !== pid) return m;
        unit = parent.get(unit) ?? null;
      }
    }
    return null;
  };
}

export async function reviewDtos(db: Db, where: SQL | undefined): Promise<AccessReviewDto[]> {
  const rows = await db
    .select({ r: accessReviews, createdByName: users.displayName })
    .from(accessReviews)
    .leftJoin(users, eq(users.id, accessReviews.createdBy))
    .where(where)
    .orderBy(desc(accessReviews.createdAt));
  if (!rows.length) return [];
  const items = await loadItems(db, inArray(accessReviewItems.reviewId, rows.map((r) => r.r.id)));
  return rows.map(({ r, createdByName }) => {
    const mine = items.filter((i) => i.reviewId === r.id);
    return {
      id: r.id,
      companyId: r.companyId,
      name: r.name,
      description: r.description,
      status: r.status,
      scope: r.scope,
      reviewerMode: r.reviewerMode,
      reviewerPositionId: r.reviewerPositionId ?? "",
      dueDate: r.dueDate,
      createdByName: createdByName ?? null,
      createdAt: r.createdAt.toISOString(),
      closedAt: iso(r.closedAt),
      counts: {
        total: mine.length,
        pending: mine.filter((i) => i.decision === "pending").length,
        keep: mine.filter((i) => i.decision === "keep").length,
        revoke: mine.filter((i) => i.decision === "revoke").length,
        remediated: mine.filter((i) => i.decision === "revoke" && i.remediated).length,
      },
    };
  });
}

export async function loadItems(db: Db, where: SQL): Promise<(AccessReviewItemDto & { reviewId: string })[]> {
  const dec = alias(users, "dec_by");
  const rows = await db
    .select({ i: accessReviewItems, reviewerName: positions.name, decidedByName: dec.displayName, acc: { enabled: identityAccounts.enabled, removedAt: identityAccounts.removedAt, groups: identityAccounts.groups } })
    .from(accessReviewItems)
    .leftJoin(positions, eq(positions.id, accessReviewItems.reviewerPositionId))
    .leftJoin(dec, eq(dec.id, accessReviewItems.decidedBy))
    .leftJoin(identityAccounts, eq(identityAccounts.id, accessReviewItems.accountId))
    .where(where)
    .orderBy(asc(accessReviewItems.login));
  return rows.map(({ i, reviewerName, decidedByName, acc }) => ({
    reviewId: i.reviewId,
    id: i.id,
    accountId: i.accountId,
    login: i.login,
    displayName: i.displayName,
    sourceName: i.sourceName,
    kind: i.kind,
    access: i.access,
    privilegedVia: i.privilegedVia,
    lastLogonAt: iso(i.lastLogonAt),
    reviewerPositionId: i.reviewerPositionId ?? "",
    reviewerName: reviewerName ?? "—",
    decision: i.decision,
    note: i.note,
    decidedByName: decidedByName ?? null,
    decidedAt: iso(i.decidedAt),
    remediatedManually: !!i.remediatedAt,
    remediated:
      i.decision !== "revoke"
        ? null
        : !!i.remediatedAt || revokeRemediated(i.access, acc?.groups ? { enabled: !!acc.enabled, removed: !!acc.removedAt, groups: acc.groups } : null),
  }));
}


/** Protokol přezkumu (celý, bez ohledu na oprávnění volajícího – volající oprávnění ověřuje). */
export async function reviewReportHtml(db: Db, id: string, t: Translate = CS_T) {
  const [dto] = await reviewDtos(db, eq(accessReviews.id, id));
  if (!dto) throw new HTTPException(404, { message: "Přezkum nenalezen" });
  const d = { ...dto, items: await loadItems(db, eq(accessReviewItems.reviewId, id)) };
  const { esc, day } = h;
  const [co] = await db.select({ n: positions.name }).from(positions).where(eq(positions.id, d.reviewerPositionId));
  const rows = d.items
    .map(
      (i) =>
        `<tr><td>${esc(i.login)}<br><span class="small muted">${esc(i.displayName)} · ${esc(i.sourceName)}</span></td><td class="small">${esc(i.access.join(", ") || "—")}</td><td>${esc(i.reviewerName)}</td><td>${esc(t.lbl(ACCESS_REVIEW_LABELS.decision[i.decision]))}${i.note ? `<br><span class="small">${esc(i.note)}</span>` : ""}</td><td class="small">${esc(i.decidedByName ?? "")}${i.decidedAt ? `<br>${day(i.decidedAt)}` : ""}</td><td class="small">${i.decision === "revoke" ? esc(i.remediated ? t("srv.idn.revDone") : t("srv.idn.revPending")) : ""}</td></tr>`,
    )
    .join("");
  const body = `<h1>${esc(t("srv.idn.revReportTitle"))}</h1>
<div class="muted">${esc(d.name)}</div>
<div class="meta"><span class="muted">${esc(t("srv.idn.revStatus"))}</span><span>${esc(t.lbl(ACCESS_REVIEW_LABELS.status[d.status]))}</span>
<span class="muted">${esc(t("srv.idn.revStarted"))}</span><span>${day(d.createdAt)}${d.createdByName ? ` (${esc(d.createdByName)})` : ""}</span>
<span class="muted">${esc(t("srv.idn.revDue"))}</span><span>${day(d.dueDate)}</span>
<span class="muted">${esc(t("srv.idn.revClosed"))}</span><span>${d.closedAt ? day(d.closedAt) : "—"}</span>
<span class="muted">${esc(t("srv.idn.revReviewers"))}</span><span>${esc(t.lbl(ACCESS_REVIEW_LABELS.reviewerMode[d.reviewerMode]))}${co ? ` – ${esc(co.n)}` : ""}</span>
<span class="muted">${esc(t("srv.idn.revScope"))}</span><span>${esc(d.scope.privilegedOnly ? t("srv.idn.revScopePrivileged") : t("srv.idn.revScopeEnabled"))}${d.scope.groups.length ? esc(t("srv.idn.revScopeGroups", { groups: d.scope.groups.join(", ") })) : ""}</span>
<span class="muted">${esc(t("srv.idn.revResult"))}</span><span>${esc(t("srv.idn.revResultValue", { total: String(d.counts.total), keep: String(d.counts.keep), revoke: String(d.counts.revoke), remediated: String(d.counts.remediated), pending: String(d.counts.pending) }))}</span></div>
${d.description ? `<p>${esc(d.description)}</p>` : ""}
<table><thead><tr><th>${esc(t("srv.idn.revColAccount"))}</th><th>${esc(t("srv.idn.revColAccess"))}</th><th>${esc(t("srv.idn.revColReviewer"))}</th><th>${esc(t("srv.idn.revColDecision"))}</th><th>${esc(t("srv.idn.revColWho"))}</th><th>${esc(t("srv.idn.revColRemoval"))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  const title = t("srv.idn.revPageTitle", { name: d.name });
  return { html: printPage(title, body, t.locale), name: d.name, title };
}


export function reviewRoutes(db: Db) {
  async function myPositions(c: Context<AppEnv>) {
    return (await db.select({ p: positionHolders.positionId }).from(positionHolders).where(eq(positionHolders.userId, currentUser(c).id))).map((x) => x.p);
  }

  /** Kampaň + přístup: identity:read v rozsahu, nebo recenzent (držitel místa s položkou) – pak jen jeho položky. */
  async function access(c: Context<AppEnv>, id: string) {
    const [r] = await db.select().from(accessReviews).where(eq(accessReviews.id, id));
    if (!r) throw new HTTPException(404, { message: "Přezkum nenalezen" });
    const full = hasPerm(c, "identity:read") && (() => {
      try {
        assertScope(c, r.companyId);
        return true;
      } catch {
        return false;
      }
    })();
    const mine = await myPositions(c);
    if (!full) {
      const [has] = mine.length ? await db.select({ n: count() }).from(accessReviewItems).where(and(eq(accessReviewItems.reviewId, r.id), inArray(accessReviewItems.reviewerPositionId, mine))) : [{ n: 0 }];
      if (!has?.n) throw new HTTPException(404, { message: "Přezkum nenalezen" });
    }
    return { r, full, mine, canWrite: full && hasPerm(c, "identity:write") };
  }

  async function detail(c: Context<AppEnv>, id: string): Promise<AccessReviewDetail> {
    const a = await access(c, id);
    const [dto] = await reviewDtos(db, eq(accessReviews.id, id));
    const items = await loadItems(db, and(eq(accessReviewItems.reviewId, id), a.full ? undefined : inArray(accessReviewItems.reviewerPositionId, a.mine))!);
    return { ...dto!, items: items.map(({ reviewId, ...i }) => i), canDecideAll: a.canWrite, myPositionIds: a.mine };
  }

  return (
    new Hono<AppEnv>()
      /** Seznam: celý rozsah s identity:read, jinak jen kampaně, kde má uživatel co rozhodnout. */
      .get("/", requirePerm("identity:read", "obligations:self"), async (c) => {
        if (hasPerm(c, "identity:read")) return c.json(await reviewDtos(db, inScope(c, accessReviews.companyId)));
        const mine = await myPositions(c);
        if (!mine.length) return c.json([]);
        const ids = (await db.selectDistinct({ id: accessReviewItems.reviewId }).from(accessReviewItems).where(inArray(accessReviewItems.reviewerPositionId, mine))).map((x) => x.id);
        return c.json(ids.length ? await reviewDtos(db, inArray(accessReviews.id, ids)) : []);
      })

      .post("/", requirePerm("identity:write"), zValidator("json", AccessReviewInput), async (c) => {
        const input = c.req.valid("json");
        const companyId = targetCompany(c, input.companyId, "identity:write");
        if (input.dueDate < today()) throw new HTTPException(400, { message: "Termín přezkumu musí být v budoucnu." });
        const [pos] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, input.reviewerPositionId));
        if (!pos) throw new HTTPException(400, { message: "Zvolte funkční místo recenzenta." });
        const where: SQL[] = [eq(identityAccounts.companyId, companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.enabled, true)];
        if (input.sourceIds.length) where.push(inArray(identityAccounts.sourceId, input.sourceIds));
        if (input.privilegedOnly) where.push(eq(identityAccounts.privileged, true));
        const lower = input.groups.map((g) => g.toLowerCase());
        if (lower.length)
          where.push(sql`exists (select 1 from unnest(${identityAccounts.groups}) g where lower(g) in (${sql.join(lower.map((g) => sql`${g}`), sql`, `)}))`);
        const accounts = await db
          .select({ a: identityAccounts, sourceName: identitySources.name })
          .from(identityAccounts)
          .innerJoin(identitySources, eq(identitySources.id, identityAccounts.sourceId))
          .where(and(...where))
          .orderBy(asc(identityAccounts.login))
          .limit(20_000);
        if (!accounts.length) throw new HTTPException(400, { message: "Rozsahu neodpovídá žádný povolený účet – zkontrolujte zdroje, skupiny a synchronizaci." });
        const manager = input.reviewerMode === "manager" ? await managerResolver(db) : () => null;
        const [r] = await db
          .insert(accessReviews)
          .values({ companyId, name: input.name, description: input.description, scope: { sourceIds: input.sourceIds, groups: input.groups, privilegedOnly: input.privilegedOnly }, reviewerMode: input.reviewerMode, reviewerPositionId: input.reviewerPositionId, dueDate: input.dueDate, createdBy: currentUser(c).id })
          .returning();
        for (let i = 0; i < accounts.length; i += 1000) {
          await db.insert(accessReviewItems).values(
            accounts.slice(i, i + 1000).map(({ a, sourceName }) => ({
              reviewId: r!.id,
              accountId: a.id,
              login: a.login,
              displayName: a.displayName,
              sourceName,
              kind: a.kind,
              access: lower.length ? a.groups.filter((g) => lower.includes(g.toLowerCase())) : input.privilegedOnly ? a.privilegedVia : a.groups,
              privilegedVia: a.privilegedVia,
              lastLogonAt: a.lastLogonAt,
              reviewerPositionId: manager(a.userId) ?? input.reviewerPositionId,
            })),
          );
        }
        await audit(db, { c, user: currentUser(c), action: "identity.review_started", entityType: "access_review", entityId: r!.id, details: { name: input.name, items: accounts.length, scope: r!.scope, reviewerMode: input.reviewerMode, dueDate: input.dueDate } });
        return c.json(await detail(c, r!.id), 201);
      })

      .get("/:id", requirePerm("identity:read", "obligations:self"), async (c) => c.json(await detail(c, c.req.param("id"))))

      .post("/:id/items/:itemId/decide", requirePerm("identity:read", "obligations:self"), zValidator("json", AccessReviewDecisionInput), async (c) => {
        const a = await access(c, c.req.param("id"));
        if (a.r.status !== "active") throw new HTTPException(409, { message: "Přezkum je uzavřený." });
        const [item] = await db.select().from(accessReviewItems).where(and(eq(accessReviewItems.id, c.req.param("itemId")), eq(accessReviewItems.reviewId, a.r.id)));
        if (!item) throw new HTTPException(404, { message: "Položka nenalezena" });
        if (!a.canWrite && !(item.reviewerPositionId && a.mine.includes(item.reviewerPositionId))) throw new HTTPException(403, { message: "O této položce rozhoduje jiný recenzent." });
        const input = c.req.valid("json");
        await db.update(accessReviewItems).set({ decision: input.decision, note: input.note, decidedBy: currentUser(c).id, decidedAt: new Date(), remediatedAt: null, remediatedBy: null }).where(eq(accessReviewItems.id, item.id));
        await audit(db, { c, user: currentUser(c), action: "identity.review_decided", entityType: "access_review_item", entityId: item.id, details: { reviewId: a.r.id, login: item.login, decision: input.decision, note: input.note } });
        const [dto] = await loadItems(db, eq(accessReviewItems.id, item.id));
        return c.json(dto);
      })

      .post("/:id/items/:itemId/remediated", requirePerm("identity:write"), zValidator("json", z.object({ done: z.boolean() })), async (c) => {
        const a = await access(c, c.req.param("id"));
        if (!a.canWrite) throw new HTTPException(403, { message: "Nemáte oprávnění" });
        const [item] = await db.select().from(accessReviewItems).where(and(eq(accessReviewItems.id, c.req.param("itemId")), eq(accessReviewItems.reviewId, a.r.id)));
        if (!item || item.decision !== "revoke") throw new HTTPException(409, { message: "Provedení lze potvrdit jen u položky s rozhodnutím Odebrat." });
        const done = c.req.valid("json").done;
        await db.update(accessReviewItems).set({ remediatedAt: done ? new Date() : null, remediatedBy: done ? currentUser(c).id : null }).where(eq(accessReviewItems.id, item.id));
        await audit(db, { c, user: currentUser(c), action: "identity.review_remediated", entityType: "access_review_item", entityId: item.id, details: { reviewId: a.r.id, login: item.login, done } });
        const [dto] = await loadItems(db, eq(accessReviewItems.id, item.id));
        return c.json(dto);
      })

      .post("/:id/items/:itemId/reassign", requirePerm("identity:write"), zValidator("json", z.object({ positionId: z.string().uuid() })), async (c) => {
        const a = await access(c, c.req.param("id"));
        if (!a.canWrite || a.r.status !== "active") throw new HTTPException(409, { message: "Recenzenta lze změnit jen u probíhajícího přezkumu." });
        const [pos] = await db.select({ id: positions.id }).from(positions).where(eq(positions.id, c.req.valid("json").positionId));
        if (!pos) throw new HTTPException(400, { message: "Neznámé funkční místo." });
        const r = await db.update(accessReviewItems).set({ reviewerPositionId: pos.id }).where(and(eq(accessReviewItems.id, c.req.param("itemId")), eq(accessReviewItems.reviewId, a.r.id))).returning({ id: accessReviewItems.id, login: accessReviewItems.login });
        if (!r.length) throw new HTTPException(404, { message: "Položka nenalezena" });
        await audit(db, { c, user: currentUser(c), action: "identity.review_reassigned", entityType: "access_review_item", entityId: r[0]!.id, details: { reviewId: a.r.id, login: r[0]!.login, positionId: pos.id } });
        const [dto] = await loadItems(db, eq(accessReviewItems.id, r[0]!.id));
        return c.json(dto);
      })

      .post("/:id/close", requirePerm("identity:write"), async (c) => {
        const a = await access(c, c.req.param("id"));
        if (!a.canWrite) throw new HTTPException(403, { message: "Nemáte oprávnění" });
        if (a.r.status !== "active") throw new HTTPException(409, { message: "Přezkum už není aktivní." });
        const [p] = await db.select({ n: count() }).from(accessReviewItems).where(and(eq(accessReviewItems.reviewId, a.r.id), eq(accessReviewItems.decision, "pending")));
        if (p?.n) throw new ApiError(409, "err.identity.reviewPending", { n: String(p.n) });
        await db.update(accessReviews).set({ status: "closed", closedAt: new Date(), closedBy: currentUser(c).id, updatedAt: new Date() }).where(eq(accessReviews.id, a.r.id));
        await audit(db, { c, user: currentUser(c), action: "identity.review_closed", entityType: "access_review", entityId: a.r.id, details: { name: a.r.name } });
        // automatické testy opatření navázané na přezkum přístupů (důkaz = protokol)
        await runAccessReviewAutomations(db, a.r.id).catch((e) => console.error("Automatický test z přezkumu:", (e as Error).message));
        return c.json(await detail(c, a.r.id));
      })

      .post("/:id/cancel", requirePerm("identity:write"), async (c) => {
        const a = await access(c, c.req.param("id"));
        if (!a.canWrite) throw new HTTPException(403, { message: "Nemáte oprávnění" });
        if (a.r.status !== "active") throw new HTTPException(409, { message: "Přezkum už není aktivní." });
        await db.update(accessReviews).set({ status: "cancelled", closedAt: new Date(), closedBy: currentUser(c).id, updatedAt: new Date() }).where(eq(accessReviews.id, a.r.id));
        await audit(db, { c, user: currentUser(c), action: "identity.review_cancelled", entityType: "access_review", entityId: a.r.id, details: { name: a.r.name } });
        return c.json(await detail(c, a.r.id));
      })

      .get("/:id/report.html", requirePerm("identity:read"), async (c) => {
        const a = await access(c, c.req.param("id"));
        if (!a.full) throw new HTTPException(404, { message: "Přezkum nenalezen" });
        return c.html((await reviewReportHtml(db, a.r.id, await tFor(db, c))).html, 200, { "cache-control": "private, no-store" });
      })
      .get("/:id/report.docx", requirePerm("identity:read"), async (c) => {
        const a = await access(c, c.req.param("id"));
        if (!a.full) throw new HTTPException(404, { message: "Přezkum nenalezen" });
        const t = await tFor(db, c);
        const r = await reviewReportHtml(db, a.r.id, t);
        await audit(db, { c, user: currentUser(c), action: "identity.review_exported", entityType: "access_review", entityId: a.r.id });
        return docxResponse(await htmlToDocx(r.html, { title: t("srv.idn.revReportTitle"), headerLine: r.name, landscape: true }), `${r.title}.docx`);
      })
  );
}

/** Seznam skupin / rolí v rozsahu (pro výběr v pravidlech a přezkumech). */
export async function groupList(db: Db, scopeWhere: SQL) {
  const rows = await db.execute<{ g: string; n: number; privileged: boolean }>(sql`
    select g, count(*)::int as n, bool_or(g = any(${identityAccounts.privilegedVia})) as privileged
    from ${identityAccounts}, unnest(${identityAccounts.groups}) as g
    where ${scopeWhere} and ${identityAccounts.removedAt} is null and ${identityAccounts.enabled}
    group by g order by privileged desc, n desc, g limit 2000`);
  return (rows as unknown as { g: string; n: number; privileged: boolean }[]).map((r) => ({ name: r.g, accounts: r.n, privileged: !!r.privileged }));
}
