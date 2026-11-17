import {
  AccessDecisionInput,
  AccessFulfilInput,
  AccessReassignInput,
  AccessRequestInput,
  AccessResourceInput,
  PersonInput,
  approvalSteps,
  adGroupNameError,
  allowedOuError,
  parentDn,
  isPeopleHeader,
  sensitiveColumns,
  parsePersonRow,
  peopleMapping,
  personStatus,
  requestStatusFrom,
  validityError,
  type AccessApprovalDto,
  type AccessGrantDto,
  type AccessRequestDto,
  type AccessResourceDto,
  type ApprovalKind,
  type PeopleImportDto,
  type PeopleImportRow,
  type PersonDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, scopeOf, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, iamApprovals, iamGrants, iamPeople, iamRequests, iamResources, users } from "../../db/schema";
import { readTable } from "../import/table";
import { sodCheck } from "./sodcheck";

/* ============================================================
 * Žádosti o přístup (v1.26, ADR-123): osoby, katalog oprávnění, žádosti se schválením, přidělení, životní cyklus.
 * Pravidla: žadatel ani dotčená osoba nesmí žádost schválit ani vyřídit; žádat lze za sebe a přímé podřízené
 * (správce přístupů za kohokoli); odebrání se neschvaluje, jde rovnou k vyřízení.
 * ============================================================ */

type Ctx = Context<AppEnv>;
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);
const OPEN = ["pending", "approved"];
export const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`;

/** Aktivní uživatel CONTIXu podle e-mailu osoby. */
export async function userByEmail(db: Db, email: string | null) {
  if (!email) return null;
  const [u] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${lower(email)}`, eq(users.isActive, true)));
  return u?.id ?? null;
}

/** Osoby, které odpovídají přihlášenému uživateli (podle e-mailu). */
async function myPersonIds(db: Db, email: string) {
  return (await db.select({ id: iamPeople.id }).from(iamPeople).where(sql`lower(${iamPeople.email}) = ${lower(email)}`)).map((x) => x.id);
}

/** Osoby, za které smí uživatel bez správy přístupů žádat: on sám a jeho přímí podřízení. */
async function requestablePersonIds(db: Db, email: string) {
  const me = await myPersonIds(db, email);
  if (!me.length) return [];
  const reports = await db.select({ id: iamPeople.id }).from(iamPeople).where(inArray(iamPeople.managerId, me));
  return [...me, ...reports.map((r) => r.id)];
}

/* ---------------- DTO ---------------- */

async function peopleDtos(db: Db, where: SQL | undefined, today = todayIso()): Promise<PersonDto[]> {
  const mgr = sql<string | null>`(select m.first_name || ' ' || m.last_name from iam_people m where m.id = "iam_people"."manager_id")`;
  const grants = sql<number>`(select count(*)::int from iam_grants g where g.person_id = "iam_people"."id" and g.revoked_at is null)`;
  const rows = await db.select({ p: iamPeople, managerName: mgr, grants }).from(iamPeople).where(where).orderBy(asc(iamPeople.lastName), asc(iamPeople.firstName)).limit(5000);
  return rows.map(({ p, managerName, grants }) => ({
    id: p.id,
    companyId: p.companyId,
    personalNumber: p.personalNumber,
    firstName: p.firstName,
    lastName: p.lastName,
    name: fullName(p),
    email: p.email,
    login: p.login,
    department: p.department,
    jobTitle: p.jobTitle,
    kind: p.kind as PersonDto["kind"],
    managerId: p.managerId,
    managerName,
    startDate: p.startDate,
    endDate: p.endDate,
    status: personStatus(p, today),
    source: p.source,
    grants,
  }));
}

async function resourceDtos(db: Db, where: SQL | undefined): Promise<AccessResourceDto[]> {
  const rows = await db
    .select({
      r: iamResources,
      assetName: assets.name,
      ownerName: users.displayName,
      grants: sql<number>`(select count(*)::int from iam_grants g where g.resource_id = "iam_resources"."id" and g.revoked_at is null)`,
    })
    .from(iamResources)
    .leftJoin(assets, eq(assets.id, iamResources.assetId))
    .leftJoin(users, eq(users.id, iamResources.ownerId))
    .where(where)
    .orderBy(asc(iamResources.name));
  return rows.map(({ r, assetName, ownerName, grants }) => ({
    id: r.id,
    companyId: r.companyId,
    name: r.name,
    kind: r.kind as AccessResourceDto["kind"],
    description: r.description,
    assetId: r.assetId,
    assetName,
    adGroup: r.adGroup,
    ownerId: r.ownerId,
    ownerName,
    approvalManager: r.approvalManager,
    approvalOwner: r.approvalOwner,
    maxDays: r.maxDays,
    privileged: r.privileged,
    active: r.active,
    adCreate: r.adCreate,
    grants,
  }));
}

export type ReqRow = typeof iamRequests.$inferSelect;

async function requestDtos(db: Db, c: Ctx, rows: ReqRow[]): Promise<AccessRequestDto[]> {
  if (!rows.length) return [];
  const me = currentUser(c);
  const ids = rows.map((r) => r.id);
  const [people, resources, approvals, names] = await Promise.all([
    db.select().from(iamPeople).where(inArray(iamPeople.id, [...new Set(rows.map((r) => r.personId))])),
    db.select().from(iamResources).where(inArray(iamResources.id, [...new Set(rows.map((r) => r.resourceId))])),
    db.select().from(iamApprovals).where(inArray(iamApprovals.requestId, ids)).orderBy(asc(iamApprovals.step)),
    (async () => {
      const uids = new Set<string>();
      for (const r of rows) for (const u of [r.requestedById, r.fulfilledById]) if (u) uids.add(u);
      return uids;
    })(),
  ]);
  for (const a of approvals) for (const u of [a.approverId, a.decidedById]) if (u) names.add(u);
  const nameOf = new Map((names.size ? await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, [...names])) : []).map((u) => [u.id, u.n]));
  return rows.map((r) => {
    const p = people.find((x) => x.id === r.personId)!;
    const res = resources.find((x) => x.id === r.resourceId)!;
    const ap = approvals.filter((a) => a.requestId === r.id);
    const current = r.status === "pending" ? ap.find((a) => !a.decision) : undefined;
    const subjectIsMe = !!p.email && lower(p.email) === lower(me.email);
    const manage = hasPermIn(c, "access:manage", r.companyId);
    const canDecide =
      current && !subjectIsMe && r.requestedById !== me.id && (current.approverId ? current.approverId === me.id : manage) ? current.id : null;
    return {
      id: r.id,
      companyId: r.companyId,
      personId: r.personId,
      personName: fullName(p),
      resourceId: r.resourceId,
      resourceName: res.name,
      resourceKind: res.kind as AccessRequestDto["resourceKind"],
      privileged: res.privileged,
      adGroup: res.adGroup,
      action: r.action as AccessRequestDto["action"],
      origin: r.origin as AccessRequestDto["origin"],
      justification: r.justification,
      validUntil: r.validUntil,
      status: r.status as AccessRequestDto["status"],
      requestedByName: r.requestedById ? (nameOf.get(r.requestedById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      fulfilledByName: r.fulfilledById ? (nameOf.get(r.fulfilledById) ?? null) : null,
      fulfilledAt: r.fulfilledAt?.toISOString() ?? null,
      fulfilNote: r.fulfilNote,
      approvals: ap.map(
        (a): AccessApprovalDto => ({
          id: a.id,
          kind: a.kind as ApprovalKind,
          approverId: a.approverId,
          approverName: a.approverId ? (nameOf.get(a.approverId) ?? null) : null,
          decision: a.decision as AccessApprovalDto["decision"],
          comment: a.comment,
          decidedAt: a.decidedAt?.toISOString() ?? null,
          decidedByName: a.decidedById ? (nameOf.get(a.decidedById) ?? null) : null,
        }),
      ),
      canDecide,
      canFulfil: r.status === "approved" && manage && !subjectIsMe,
      canCancel: OPEN.includes(r.status) && (r.requestedById === me.id || manage),
      sodConflicts: r.sodConflicts ?? [],
    };
  });
}

/* ---------------- založení žádosti (ručně i automaticky) ---------------- */

/**
 * Založí žádost a kroky schválení. Vedoucí, který žádá sám, svůj krok má rovnou schválený; vlastník oprávnění, který
 * je zároveň žadatelem, se jako schvalovatel neurčí (rozhodne správce přístupů) – čtyři oči.
 */
export async function createRequest(
  db: Db,
  o: { companyId: string; person: typeof iamPeople.$inferSelect; resource: typeof iamResources.$inferSelect; action: "grant" | "revoke"; origin: "request" | "expiry" | "leaver" | "review" | "reconcile" | "role" | "jml"; justification: string; validUntil: string | null; requestedById: string | null },
) {
  const steps = approvalSteps(o.resource, o.action);
  const approvers: { kind: ApprovalKind; approverId: string | null; auto: boolean }[] = [];
  const subjectUser = await userByEmail(db, o.person.email);
  for (const kind of steps) {
    let id: string | null = null;
    if (kind === "manager" && o.person.managerId) {
      const [m] = await db.select({ email: iamPeople.email }).from(iamPeople).where(eq(iamPeople.id, o.person.managerId));
      id = await userByEmail(db, m?.email ?? null);
    }
    if (kind === "owner") id = o.resource.ownerId;
    if (id && id === subjectUser) id = null;
    const auto = kind === "manager" && !!id && id === o.requestedById;
    if (kind === "owner" && id && id === o.requestedById) id = null;
    approvers.push({ kind, approverId: id, auto });
  }
  const sod = o.action === "grant" ? ((await sodCheck(db, o.person, [o.resource]))[o.resource.id] ?? []) : [];
  // konflikt SoD: žádost vždy projde schválením správce, ani vedoucí si ji sám neschválí
  if (sod.length)
    for (const a of approvers)
      if (a.auto) {
        a.auto = false;
        a.approverId = null;
      }
  if (sod.length && !approvers.length) approvers.push({ kind: "owner", approverId: null, auto: false });
  const status = approvers.length === 0 || approvers.every((a) => a.auto) ? "approved" : "pending";
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(iamRequests)
      .values({ companyId: o.companyId, personId: o.person.id, resourceId: o.resource.id, action: o.action, origin: o.origin, justification: o.justification, validUntil: o.validUntil, status, requestedById: o.requestedById, sodConflicts: sod })
      .returning();
    if (approvers.length)
      await tx.insert(iamApprovals).values(
        approvers.map((a, i) => ({
          requestId: r!.id,
          step: i + 1,
          kind: a.kind,
          approverId: a.approverId,
          ...(a.auto ? { decision: "approved", decidedById: a.approverId, decidedAt: new Date(), comment: "Žádá přímo vedoucí" } : {}),
        })),
      );
    return r!;
  });
}

/** Vyřízení schválené žádosti: přidělení / odebrání v evidenci a stav „vyřízeno“ (ručně, z AD nebo ověřením synchronizací). */
export async function fulfilRequest(db: Db, r: ReqRow, userId: string | null, note: string | null) {
  await db.transaction(async (tx) => {
    if (r.action === "grant") {
      const [active] = await tx.select().from(iamGrants).where(and(eq(iamGrants.personId, r.personId), eq(iamGrants.resourceId, r.resourceId), isNull(iamGrants.revokedAt)));
      if (active) await tx.update(iamGrants).set({ validUntil: r.validUntil, requestId: r.id }).where(eq(iamGrants.id, active.id));
      else await tx.insert(iamGrants).values({ companyId: r.companyId, personId: r.personId, resourceId: r.resourceId, since: todayIso(), validUntil: r.validUntil, requestId: r.id });
    } else
      await tx
        .update(iamGrants)
        .set({ revokedAt: new Date(), revokeRequestId: r.id })
        .where(and(eq(iamGrants.personId, r.personId), eq(iamGrants.resourceId, r.resourceId), isNull(iamGrants.revokedAt)));
    await tx.update(iamRequests).set({ status: "done", fulfilledById: userId, fulfilledAt: new Date(), fulfilNote: note, updatedAt: new Date() }).where(and(eq(iamRequests.id, r.id), eq(iamRequests.status, "approved")));
  });
}

/* ---------------- životní cyklus: konec platnosti a odchod ---------------- */

/** Denně: přidělení po platnosti a přidělení odešlých osob → žádost o odebrání (rovnou k vyřízení). Nevyřízené žádosti odešlých se zruší. */
export async function processAccessLifecycle(db: Db, now = new Date()) {
  const today = todayIso(now);
  const active = await db
    .select({ g: iamGrants, p: iamPeople, r: iamResources })
    .from(iamGrants)
    .innerJoin(iamPeople, eq(iamPeople.id, iamGrants.personId))
    .innerJoin(iamResources, eq(iamResources.id, iamGrants.resourceId))
    .where(and(isNull(iamGrants.revokedAt), or(lt(iamGrants.validUntil, today), lt(iamPeople.endDate, today))));
  let expiry = 0;
  let leaver = 0;
  for (const { g, p, r } of active) {
    const [open] = await db
      .select({ id: iamRequests.id })
      .from(iamRequests)
      .where(and(eq(iamRequests.personId, p.id), eq(iamRequests.resourceId, r.id), eq(iamRequests.action, "revoke"), inArray(iamRequests.status, OPEN)));
    if (open) continue;
    const left = !!p.endDate && p.endDate < today;
    await createRequest(db, {
      companyId: g.companyId,
      person: p,
      resource: r,
      action: "revoke",
      origin: left ? "leaver" : "expiry",
      justification: left ? `Osoba ukončila spolupráci ${p.endDate}` : `Skončila platnost přidělení (do ${g.validUntil})`,
      validUntil: null,
      requestedById: null,
    });
    if (left) leaver++;
    else expiry++;
  }
  const leavers = db.select({ id: iamPeople.id }).from(iamPeople).where(lt(iamPeople.endDate, today));
  const cancelled = await db
    .update(iamRequests)
    .set({ status: "cancelled", fulfilNote: "Zrušeno – osoba ukončila spolupráci", updatedAt: new Date() })
    .where(and(eq(iamRequests.action, "grant"), inArray(iamRequests.status, OPEN), inArray(iamRequests.personId, leavers)))
    .returning({ id: iamRequests.id });
  if (expiry + leaver + cancelled.length) await audit(db, { action: "access.lifecycle", entityType: "access_request", details: { expiry, leaver, cancelled: cancelled.length } });
  return { expiry, leaver, cancelled: cancelled.length };
}

/** Rozhodnutí čekající na uživatele (pro Moje práce): aktuální krok, kde je určeným schvalovatelem. */
export async function pendingApprovalsFor(db: Db, userId: string) {
  const rows = await db
    .select({ a: iamApprovals, r: iamRequests, p: iamPeople, res: iamResources })
    .from(iamApprovals)
    .innerJoin(iamRequests, eq(iamRequests.id, iamApprovals.requestId))
    .innerJoin(iamPeople, eq(iamPeople.id, iamRequests.personId))
    .innerJoin(iamResources, eq(iamResources.id, iamRequests.resourceId))
    .where(and(eq(iamApprovals.approverId, userId), isNull(iamApprovals.decision), eq(iamRequests.status, "pending")));
  const out: { requestId: string; companyId: string; person: string; resource: string; created: Date }[] = [];
  for (const x of rows) {
    const [earlier] = await db
      .select({ id: iamApprovals.id })
      .from(iamApprovals)
      .where(and(eq(iamApprovals.requestId, x.r.id), lt(iamApprovals.step, x.a.step), isNull(iamApprovals.decision)));
    if (!earlier && x.r.requestedById !== userId) out.push({ requestId: x.r.id, companyId: x.r.companyId, person: fullName(x.p), resource: x.res.name, created: x.r.createdAt });
  }
  return out;
}

/** Nová skupina AD (adCreate): typ skupina AD, úplné DN a platný název. */
function newGroupCheck(v: { adCreate?: boolean; kind?: string; adGroup?: string | null }) {
  if (!v.adCreate) return;
  if (v.kind !== "ad_group") throw new HTTPException(400, { message: "Vytvořit v AD lze jen oprávnění typu skupina AD" });
  const dn = v.adGroup ?? "";
  const name = dn.match(/^\s*CN=((?:\\,|[^,])+),/i)?.[1];
  if (!name || allowedOuError(parentDn(dn))) throw new HTTPException(400, { message: "U nové skupiny zadejte název a OU, kde se má vytvořit" });
  const err = adGroupNameError(name);
  if (err) throw new HTTPException(400, { message: err });
}

/* ---------------- routy ---------------- */

export function accessRoutes(db: Db) {
  const manage = (c: Ctx, companyId: string) => {
    if (!hasPermIn(c, "access:manage", companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
  };
  const loadPerson = async (c: Ctx, id: string) => {
    const [p] = await db.select().from(iamPeople).where(eq(iamPeople.id, id));
    assertScope(c, p?.companyId, "Osoba nenalezena");
    return p!;
  };
  const loadResource = async (c: Ctx, id: string) => {
    const [r] = await db.select().from(iamResources).where(eq(iamResources.id, id));
    assertScope(c, r?.companyId, "Oprávnění nenalezeno");
    return r!;
  };
  const loadRequest = async (c: Ctx, id: string) => {
    const [r] = await db.select().from(iamRequests).where(eq(iamRequests.id, id));
    assertScope(c, r?.companyId, "Žádost nenalezena");
    return r!;
  };
  /** Vidí žádost: správce přístupů, žadatel, schvalovatel, dotčená osoba. */
  const assertSeesRequest = async (c: Ctx, r: ReqRow) => {
    if (hasPermIn(c, "access:manage", r.companyId)) return;
    const me = currentUser(c);
    if (r.requestedById === me.id) return;
    if ((await myPersonIds(db, me.email)).includes(r.personId)) return;
    const [a] = await db.select({ id: iamApprovals.id }).from(iamApprovals).where(and(eq(iamApprovals.requestId, r.id), eq(iamApprovals.approverId, me.id)));
    if (!a) throw new HTTPException(404, { message: "Žádost nenalezena" });
  };
  const managerCheck = async (c: Ctx, companyId: string, managerId: string | null, selfId?: string) => {
    if (!managerId) return;
    if (managerId === selfId) throw new HTTPException(400, { message: "Osoba nemůže být sama sobě nadřízenou" });
    const [m] = await db.select({ companyId: iamPeople.companyId }).from(iamPeople).where(eq(iamPeople.id, managerId));
    if (!m || m.companyId !== companyId) throw new HTTPException(400, { message: "Nadřízený musí být osobou téže společnosti" });
  };

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "access"))
      /* ---- přehled ---- */
      .get("/summary", requirePerm("access:request", "access:manage"), async (c) => {
        const me = currentUser(c);
        const [counts] = await db
          .select({
            pending: sql<number>`count(*) filter (where ${iamRequests.status} = 'pending')::int`,
            toFulfil: sql<number>`count(*) filter (where ${iamRequests.status} = 'approved')::int`,
          })
          .from(iamRequests)
          .where(inScope(c, iamRequests.companyId));
        return c.json({
          toApprove: (await pendingApprovalsFor(db, me.id)).length,
          pending: counts?.pending ?? 0,
          toFulfil: counts?.toFulfil ?? 0,
          manage: scopeOf(c).ids.some((id) => hasPermIn(c, "access:manage", id)),
        });
      })

      /* ---- osoby ---- */
      .get("/people", requirePerm("access:request", "access:manage"), async (c) => {
        const me = currentUser(c);
        const all = await peopleDtos(db, inScope(c, iamPeople.companyId));
        const mine = new Set(await requestablePersonIds(db, me.email));
        return c.json(all.filter((p) => hasPermIn(c, "access:manage", p.companyId) || mine.has(p.id)));
      })
      .post("/people", requirePerm("access:manage"), zValidator("json", PersonInput), async (c) => {
        const v = c.req.valid("json");
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        await managerCheck(c, companyId, v.managerId);
        if (v.personalNumber) {
          const [dup] = await db.select({ id: iamPeople.id }).from(iamPeople).where(and(eq(iamPeople.companyId, companyId), eq(iamPeople.personalNumber, v.personalNumber)));
          if (dup) throw new HTTPException(409, { message: "Osoba s tímto osobním číslem už existuje" });
        }
        const [p] = await db.insert(iamPeople).values({ ...v, companyId }).returning();
        await audit(db, { c, user: currentUser(c), action: "access.person_created", entityType: "iam_person", entityId: p!.id, details: { name: fullName(p!) } });
        return c.json((await peopleDtos(db, eq(iamPeople.id, p!.id)))[0], 201);
      })
      .put("/people/:id", requirePerm("access:manage"), zValidator("json", PersonInput), async (c) => {
        const p = await loadPerson(c, c.req.param("id"));
        manage(c, p.companyId);
        const v = c.req.valid("json");
        await managerCheck(c, p.companyId, v.managerId, p.id);
        await db.update(iamPeople).set({ ...v, updatedAt: new Date() }).where(eq(iamPeople.id, p.id));
        await audit(db, { c, user: currentUser(c), action: "access.person_updated", entityType: "iam_person", entityId: p.id, details: { name: `${v.firstName} ${v.lastName}`, endDate: v.endDate } });
        return c.json((await peopleDtos(db, eq(iamPeople.id, p.id)))[0]);
      })
      .delete("/people/:id", requirePerm("access:manage"), async (c) => {
        const p = await loadPerson(c, c.req.param("id"));
        manage(c, p.companyId);
        const [g] = await db.select({ id: iamGrants.id }).from(iamGrants).where(and(eq(iamGrants.personId, p.id), isNull(iamGrants.revokedAt)));
        if (g) throw new HTTPException(409, { message: "Osoba má přidělená oprávnění – vyplňte datum ukončení, oprávnění se odeberou žádostmi" });
        await db.delete(iamPeople).where(eq(iamPeople.id, p.id));
        await audit(db, { c, user: currentUser(c), action: "access.person_deleted", entityType: "iam_person", entityId: p.id, details: { name: fullName(p) } });
        return c.json({ ok: true });
      })
      /** Import z personálního systému (CSV / XLSX): náhled, potom commit=1. */
      .post("/people/import", requirePerm("access:manage"), async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        if (file.size > 10 * 1024 * 1024) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 10 MB)" });
        const companyId = targetCompany(c, typeof body.companyId === "string" && body.companyId ? body.companyId : null, "access:manage");
        const commit = body.commit === "1" || body.commit === "true";
        const missingAsLeft = body.missingAsLeft === "1" || body.missingAsLeft === "true";
        let table;
        try {
          table = readTable(new Uint8Array(await file.arrayBuffer()), file.name, null, isPeopleHeader);
        } catch (e) {
          throw new HTTPException(400, { message: (e as Error).message });
        }
        const result = await importPeople(db, companyId, table.headers, table.rows, table.lines, commit, { missingAsLeft });
        if (commit) await audit(db, { c, user: currentUser(c), action: "access.people_imported", entityType: "iam_person", details: { file: file.name, ...result.counts } });
        return c.json(result);
      })

      /* ---- katalog oprávnění ---- */
      .get("/resources", requirePerm("access:request", "access:manage"), async (c) => {
        const all = await resourceDtos(db, inScope(c, iamResources.companyId));
        return c.json(all.filter((r) => r.active || hasPermIn(c, "access:manage", r.companyId)));
      })
      .post("/resources", requirePerm("access:manage"), zValidator("json", AccessResourceInput), async (c) => {
        const v = c.req.valid("json");
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        newGroupCheck(v);
        if (v.assetId) {
          const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, v.assetId));
          if (!a || a.companyId !== companyId) throw new HTTPException(400, { message: "Aktivum nepatří do společnosti" });
        }
        const [dup] = await db.select({ id: iamResources.id }).from(iamResources).where(and(eq(iamResources.companyId, companyId), sql`lower(${iamResources.name}) = ${lower(v.name)}`));
        if (dup) throw new HTTPException(409, { message: "Oprávnění s tímto názvem už existuje" });
        const [r] = await db.insert(iamResources).values({ ...v, companyId }).returning();
        await audit(db, { c, user: currentUser(c), action: "access.resource_created", entityType: "iam_resource", entityId: r!.id, details: { name: r!.name, adGroup: r!.adGroup, privileged: r!.privileged } });
        return c.json((await resourceDtos(db, eq(iamResources.id, r!.id)))[0], 201);
      })
      .put("/resources/:id", requirePerm("access:manage"), zValidator("json", AccessResourceInput), async (c) => {
        const r = await loadResource(c, c.req.param("id"));
        manage(c, r.companyId);
        const v = c.req.valid("json");
        newGroupCheck(v);
        if (v.assetId) {
          const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, v.assetId));
          if (!a || a.companyId !== r.companyId) throw new HTTPException(400, { message: "Aktivum nepatří do společnosti" });
        }
        await db.update(iamResources).set({ ...v, updatedAt: new Date() }).where(eq(iamResources.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "access.resource_updated", entityType: "iam_resource", entityId: r.id, details: { name: v.name, adGroup: v.adGroup, approvalManager: v.approvalManager, approvalOwner: v.approvalOwner, maxDays: v.maxDays } });
        return c.json((await resourceDtos(db, eq(iamResources.id, r.id)))[0]);
      })
      .delete("/resources/:id", requirePerm("access:manage"), async (c) => {
        const r = await loadResource(c, c.req.param("id"));
        manage(c, r.companyId);
        const [g] = await db.select({ id: iamGrants.id }).from(iamGrants).where(eq(iamGrants.resourceId, r.id));
        if (g) throw new HTTPException(409, { message: "Oprávnění má historii přidělení – místo smazání ho vyřaďte (neaktivní)" });
        await db.delete(iamResources).where(eq(iamResources.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "access.resource_deleted", entityType: "iam_resource", entityId: r.id, details: { name: r.name } });
        return c.json({ ok: true });
      })

      /* ---- žádosti ---- */
      .get("/requests", requirePerm("access:request", "access:manage"), async (c) => {
        const me = currentUser(c);
        const status = c.req.query("status");
        const conds: SQL[] = [inScope(c, iamRequests.companyId)];
        if (status) conds.push(inArray(iamRequests.status, status.split(",")));
        const rows = await db.select().from(iamRequests).where(and(...conds)).orderBy(desc(iamRequests.createdAt)).limit(1000);
        const mine = new Set(await myPersonIds(db, me.email));
        const approverOf = new Set(
          rows.length ? (await db.select({ r: iamApprovals.requestId }).from(iamApprovals).where(and(inArray(iamApprovals.requestId, rows.map((r) => r.id)), eq(iamApprovals.approverId, me.id)))).map((x) => x.r) : [],
        );
        const visible = rows.filter((r) => hasPermIn(c, "access:manage", r.companyId) || r.requestedById === me.id || mine.has(r.personId) || approverOf.has(r.id));
        return c.json(await requestDtos(db, c, visible));
      })
      .get("/requests/:id", requirePerm("access:request", "access:manage"), async (c) => {
        const r = await loadRequest(c, c.req.param("id"));
        await assertSeesRequest(c, r);
        return c.json((await requestDtos(db, c, [r]))[0]);
      })
      .post("/requests", requirePerm("access:request", "access:manage"), zValidator("json", AccessRequestInput), async (c) => {
        const me = currentUser(c);
        const v = c.req.valid("json");
        const person = await loadPerson(c, v.personId);
        const resource = await loadResource(c, v.resourceId);
        if (resource.companyId !== person.companyId) throw new HTTPException(400, { message: "Oprávnění patří jiné společnosti než osoba" });
        if (!hasPermIn(c, "access:manage", person.companyId)) {
          if (!hasPermIn(c, "access:request", person.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
          if (!(await requestablePersonIds(db, me.email)).includes(person.id))
            throw new HTTPException(403, { message: "Žádat můžete jen za sebe a za své přímé podřízené" });
        }
        const today = todayIso();
        if (personStatus(person, today) === "leaver") throw new HTTPException(400, { message: "Osoba už ukončila spolupráci" });
        const [active] = await db.select().from(iamGrants).where(and(eq(iamGrants.personId, person.id), eq(iamGrants.resourceId, resource.id), isNull(iamGrants.revokedAt)));
        if (v.action === "grant") {
          if (!resource.active) throw new HTTPException(400, { message: "Oprávnění je vyřazené – nelze o něj žádat" });
          if (active && (!active.validUntil || (v.validUntil && v.validUntil <= active.validUntil))) throw new HTTPException(409, { message: "Osoba už toto oprávnění má" });
          const err = validityError(resource.maxDays, v.validUntil, today);
          if (err) throw new HTTPException(400, { message: err });
        } else if (!active) throw new HTTPException(409, { message: "Osoba toto oprávnění nemá" });
        const [open] = await db
          .select({ id: iamRequests.id })
          .from(iamRequests)
          .where(and(eq(iamRequests.personId, person.id), eq(iamRequests.resourceId, resource.id), eq(iamRequests.action, v.action), inArray(iamRequests.status, OPEN)));
        if (open) throw new HTTPException(409, { message: "Pro tuto osobu a oprávnění už je otevřená žádost" });
        const r = await createRequest(db, { companyId: person.companyId, person, resource, action: v.action, origin: "request", justification: v.justification, validUntil: v.action === "grant" ? v.validUntil : null, requestedById: me.id });
        await audit(db, { c, user: me, action: "access.requested", entityType: "access_request", entityId: r.id, details: { person: fullName(person), resource: resource.name, action: v.action, validUntil: v.validUntil } });
        return c.json((await requestDtos(db, c, [r]))[0], 201);
      })
      .post("/requests/:id/decide", requirePerm("access:request", "access:manage"), zValidator("json", AccessDecisionInput), async (c) => {
        const r = await loadRequest(c, c.req.param("id"));
        const [dto] = await requestDtos(db, c, [r]);
        if (!dto!.canDecide) throw new HTTPException(403, { message: "O této žádosti teď nerozhodujete" });
        const v = c.req.valid("json");
        if (v.decision === "rejected" && !v.comment) throw new HTTPException(400, { message: "Uveďte důvod zamítnutí" });
        if (v.decision === "approved" && r.sodConflicts?.length && !v.comment) throw new HTTPException(400, { message: "Žádost vytváří toxickou kombinaci (SoD) – při schválení uveďte zdůvodnění" });
        const me = currentUser(c);
        await db.update(iamApprovals).set({ decision: v.decision, comment: v.comment, decidedById: me.id, decidedAt: new Date() }).where(and(eq(iamApprovals.id, dto!.canDecide), isNull(iamApprovals.decision)));
        const decisions = (await db.select({ d: iamApprovals.decision }).from(iamApprovals).where(eq(iamApprovals.requestId, r.id))).map((x) => x.d);
        await db.update(iamRequests).set({ status: requestStatusFrom(decisions), updatedAt: new Date() }).where(eq(iamRequests.id, r.id));
        await audit(db, { c, user: me, action: `access.${v.decision}`, entityType: "access_request", entityId: r.id, details: { person: dto!.personName, resource: dto!.resourceName, comment: v.comment } });
        return c.json((await requestDtos(db, c, [await loadRequest(c, r.id)]))[0]);
      })
      .post("/requests/:id/approvals/:aid/reassign", requirePerm("access:manage"), zValidator("json", AccessReassignInput), async (c) => {
        const r = await loadRequest(c, c.req.param("id"));
        manage(c, r.companyId);
        if (r.status !== "pending") throw new HTTPException(409, { message: "Žádost už není ke schválení" });
        const { approverId } = c.req.valid("json");
        if (approverId === r.requestedById) throw new HTTPException(400, { message: "Žadatel nemůže schvalovat vlastní žádost" });
        const [u] = await db.select({ id: users.id, email: users.email, active: users.isActive }).from(users).where(eq(users.id, approverId));
        if (!u?.active) throw new HTTPException(400, { message: "Uživatel nenalezen" });
        const [p] = await db.select({ email: iamPeople.email }).from(iamPeople).where(eq(iamPeople.id, r.personId));
        if (p?.email && lower(p.email) === lower(u.email)) throw new HTTPException(400, { message: "Dotčená osoba nemůže schvalovat přístup sama sobě" });
        const done = await db
          .update(iamApprovals)
          .set({ approverId })
          .where(and(eq(iamApprovals.id, c.req.param("aid")), eq(iamApprovals.requestId, r.id), isNull(iamApprovals.decision)))
          .returning({ id: iamApprovals.id });
        if (!done.length) throw new HTTPException(404, { message: "Krok schválení nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "access.reassigned", entityType: "access_request", entityId: r.id, details: { approverId } });
        return c.json((await requestDtos(db, c, [r]))[0]);
      })
      .post("/requests/:id/fulfil", requirePerm("access:manage"), zValidator("json", AccessFulfilInput), async (c) => {
        const r = await loadRequest(c, c.req.param("id"));
        const [dto] = await requestDtos(db, c, [r]);
        if (!dto!.canFulfil) throw new HTTPException(r.status === "approved" ? 403 : 409, { message: r.status === "approved" ? "Přístup sobě vyřizovat nelze" : "Žádost není schválená" });
        const me = currentUser(c);
        const note = c.req.valid("json").note;
        await fulfilRequest(db, r, me.id, note);
        await audit(db, { c, user: me, action: r.action === "grant" ? "access.granted" : "access.revoked", entityType: "access_request", entityId: r.id, details: { person: dto!.personName, resource: dto!.resourceName, adGroup: dto!.adGroup, validUntil: r.validUntil, note } });
        return c.json((await requestDtos(db, c, [await loadRequest(c, r.id)]))[0]);
      })
      .post("/requests/:id/cancel", requirePerm("access:request", "access:manage"), async (c) => {
        const r = await loadRequest(c, c.req.param("id"));
        const [dto] = await requestDtos(db, c, [r]);
        if (!dto!.canCancel) throw new HTTPException(403, { message: "Žádost nemůžete zrušit" });
        await db.update(iamRequests).set({ status: "cancelled", updatedAt: new Date() }).where(eq(iamRequests.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "access.cancelled", entityType: "access_request", entityId: r.id, details: { person: dto!.personName, resource: dto!.resourceName } });
        return c.json((await requestDtos(db, c, [await loadRequest(c, r.id)]))[0]);
      })

      /* ---- přidělení ---- */
      .get("/grants", requirePerm("access:request", "access:manage"), async (c) => {
        const me = currentUser(c);
        const conds: SQL[] = [inScope(c, iamGrants.companyId)];
        if (c.req.query("history") !== "1") conds.push(isNull(iamGrants.revokedAt));
        const pid = c.req.query("personId");
        if (pid) conds.push(eq(iamGrants.personId, pid));
        const rid = c.req.query("resourceId");
        if (rid) conds.push(eq(iamGrants.resourceId, rid));
        const rows = await db
          .select({ g: iamGrants, p: iamPeople, r: iamResources })
          .from(iamGrants)
          .innerJoin(iamPeople, eq(iamPeople.id, iamGrants.personId))
          .innerJoin(iamResources, eq(iamResources.id, iamGrants.resourceId))
          .where(and(...conds))
          .orderBy(asc(iamPeople.lastName), asc(iamResources.name))
          .limit(5000);
        const allowed = new Set(await requestablePersonIds(db, me.email));
        const today = todayIso();
        return c.json(
          rows
            .filter(({ g }) => hasPermIn(c, "access:manage", g.companyId) || allowed.has(g.personId))
            .map(
              ({ g, p, r }): AccessGrantDto => ({
                id: g.id,
                personId: p.id,
                personName: fullName(p),
                personStatus: personStatus(p, today),
                resourceId: r.id,
                resourceName: r.name,
                resourceKind: r.kind as AccessGrantDto["resourceKind"],
                privileged: r.privileged,
                since: g.since,
                validUntil: g.validUntil,
                expired: !!g.validUntil && g.validUntil < today,
                requestId: g.requestId,
              }),
            ),
        );
      })
      /** Ruční spuštění denní kontroly (konec platnosti, odchody). */
      .post("/lifecycle/run", requirePerm("access:manage"), async (c) => c.json(await processAccessLifecycle(db)))
  );
}

/* ---------------- import osob ---------------- */

const PERSON_FIELDS = ["personalNumber", "firstName", "lastName", "email", "login", "department", "jobTitle", "kind", "startDate", "endDate"] as const;

export async function importPeople(
  db: Db,
  companyId: string,
  headers: string[],
  rows: string[][],
  lines: number[],
  commit: boolean,
  opts: { missingAsLeft?: boolean; now?: Date } = {},
): Promise<PeopleImportDto> {
  const now = opts.now ?? new Date();
  // citlivé sloupce (rodné číslo, adresa, mzda…) se nenačítají nikdy
  const ignoredSensitive = sensitiveColumns(headers);
  const mapping = peopleMapping(headers).map((m, i) => (ignoredSensitive.includes(headers[i]!) ? null : m));
  if (!isPeopleHeader(headers.map((h, i) => (mapping[i] ? h : ""))))
    throw new HTTPException(400, { message: "V souboru nejsou rozpoznané sloupce se jménem a příjmením osoby" });
  const today = todayIso(now);
  const existing = await db.select().from(iamPeople).where(eq(iamPeople.companyId, companyId));
  const byNumber = new Map(existing.filter((p) => p.personalNumber).map((p) => [p.personalNumber!, p]));
  const byEmail = new Map(existing.filter((p) => p.email).map((p) => [lower(p.email), p]));
  const seen = new Set<string>();
  const fileNumbers = new Set<string>();
  const fileEmails = new Set<string>();
  const parsed = rows.map((row, i) => ({ line: lines[i] ?? i + 2, ...parsePersonRow(mapping, row) }));
  for (const x of parsed) {
    if (x.data.personalNumber) fileNumbers.add(x.data.personalNumber);
    if (x.data.email) fileEmails.add(lower(x.data.email));
  }
  const out: (PeopleImportRow & { data: Record<string, string | null>; matchId: string | null })[] = [];
  for (const x of parsed) {
    const errors = [...x.errors];
    const warnings: string[] = [];
    const key = x.data.personalNumber ?? (x.data.email ? `@${lower(x.data.email)}` : null);
    if (key && seen.has(key)) errors.push("Osoba je v souboru vícekrát");
    if (key) seen.add(key);
    const match = (x.data.personalNumber && byNumber.get(x.data.personalNumber)) || (x.data.email && byEmail.get(lower(x.data.email))) || null;
    const m = x.data.manager;
    if (m && !fileNumbers.has(m) && !byNumber.has(m) && !fileEmails.has(lower(m)) && !byEmail.has(lower(m))) warnings.push(`Nadřízený „${m}“ nenalezen`);
    if (x.data.endDate && x.data.endDate < today) warnings.push("Osoba už odešla – přidělená oprávnění se odeberou");
    const changes: string[] = [];
    if (match)
      for (const f of PERSON_FIELDS) {
        const nv = x.data[f];
        if (nv !== undefined && nv !== null && String((match as Record<string, unknown>)[f] ?? "") !== nv) changes.push(f);
      }
    const name = [x.data.firstName, x.data.lastName].filter(Boolean).join(" ") || `řádek ${x.line}`;
    out.push({ row: x.line, name, action: errors.length ? "skip" : match ? (changes.length || m ? "update" : "skip") : "create", changes, errors, warnings, data: x.data, matchId: match?.id ?? null });
  }
  // nadřízený: změna jen pokud se nadřízený najde a liší se od současného
  for (const r of out) {
    if (r.action !== "update" || r.changes.length) continue;
    const cur = existing.find((p) => p.id === r.matchId);
    const m = r.data.manager!;
    const mgr = existing.find((p) => p.personalNumber === m || (!!p.email && lower(p.email) === lower(m)));
    const inFileOnly = !mgr && (fileNumbers.has(m) || fileEmails.has(lower(m)));
    if ((mgr && cur?.managerId !== mgr.id) || inFileOnly) r.changes.push("manager");
    else r.action = "skip";
  }
  // osoby z dřívějšího importu, které v souboru chybí (export jen aktivních zaměstnanců → odešlé)
  const inFile = new Set(out.map((r) => r.matchId).filter(Boolean));
  const missing = existing.filter((p) => p.source === "import" && !inFile.has(p.id) && (!p.endDate || p.endDate >= today));
  if (opts.missingAsLeft && missing.length && out.length < existing.filter((p) => p.source === "import" && (!p.endDate || p.endDate >= today)).length / 2)
    throw new HTTPException(400, { message: "Soubor obsahuje méně než polovinu dříve importovaných osob – chybějící se neoznačí jako odešlé (zkontrolujte úplnost exportu)" });
  if (commit) {
    await db.transaction(async (tx) => {
      if (opts.missingAsLeft && missing.length) {
        const yesterday = todayIso(new Date(now.getTime() - 86_400_000));
        await tx.update(iamPeople).set({ endDate: yesterday, updatedAt: new Date() }).where(inArray(iamPeople.id, missing.map((p) => p.id)));
      }
      const ids = new Map<number, string>();
      for (const r of out) {
        if (r.action === "skip" && !r.matchId) continue;
        if (r.errors.length) continue;
        const vals: Record<string, string | null> = {};
        for (const f of PERSON_FIELDS) if (r.data[f] !== undefined) vals[f] = r.data[f]!;
        if (r.action === "create") {
          const [p] = await tx.insert(iamPeople).values({ ...(vals as { firstName: string; lastName: string }), companyId, source: "import" }).returning({ id: iamPeople.id });
          ids.set(r.row, p!.id);
        } else {
          if (r.action === "update" && r.changes.some((ch) => ch !== "manager")) await tx.update(iamPeople).set({ ...vals, updatedAt: new Date() }).where(eq(iamPeople.id, r.matchId!));
          ids.set(r.row, r.matchId!);
        }
      }
      const all = await tx.select({ id: iamPeople.id, n: iamPeople.personalNumber, e: iamPeople.email }).from(iamPeople).where(eq(iamPeople.companyId, companyId));
      for (const r of out) {
        const id = ids.get(r.row);
        const m = r.data.manager;
        if (!id || !m) continue;
        const mgr = all.find((p) => p.n === m) ?? all.find((p) => p.e && lower(p.e) === lower(m));
        if (mgr && mgr.id !== id) await tx.update(iamPeople).set({ managerId: mgr.id }).where(eq(iamPeople.id, id));
      }
    });
  }
  const counts = {
    create: out.filter((r) => r.action === "create").length,
    update: out.filter((r) => r.action === "update").length,
    skip: out.filter((r) => r.action === "skip" && !r.errors.length).length,
    errors: out.filter((r) => r.errors.length).length,
    leavers: out.filter((r) => !r.errors.length && r.data.endDate && r.data.endDate < today).length,
    missing: missing.length,
  };
  return { headers, mapping, total: out.length, counts, missingNames: missing.slice(0, 50).map(fullName), rows: out.slice(0, 500).map(({ data: _d, matchId: _m, ...r }) => r), committed: commit, ignoredSensitive };
}
