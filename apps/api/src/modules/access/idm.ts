import {
  JmlApplyInput,
  JmlPreviewInput,
  BusinessRoleInput,
  jmlPlan,
  matchAccounts,
  matrixState,
  personStatus,
  roleMatches,
  groupKey,
  type IdmOverviewDto,
  type JmlItem,
  type JmlPreviewDto,
  type MatrixDto,
  type MatrixState,
  type PersonOverviewDto,
  type BusinessRoleDto,
  type SodConflict,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import {
  iamCertificationItems,
  iamCertifications,
  iamGrants,
  iamPeople,
  iamRequests,
  iamResources,
  iamRoleResources,
  iamRoles,
  identityAccounts,
  identitySources,
  sodViolations,
  users,
} from "../../db/schema";
import { reconcileCompany } from "./reconcile";
import { pendingCertificationsFor } from "./review";
import { createRequest, fullName, pendingApprovalsFor, todayIso } from "./routes";
import { sodCheck } from "./sodcheck";

/* ============================================================
 * IDM (v1.34, ADR-131): přehled, business role, matice osoby × oprávnění, detail osoby 360°, JML průvodce, SoD při žádosti.
 * Vše jen nad evidencí CONTIXu a posledním načtením AD (čtení); zápisy do AD dál jen přes žádosti a provisioning.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Person = typeof iamPeople.$inferSelect;
const OPEN = ["pending", "approved"];
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function rolesWithResources(db: Db, companyId: string) {
  const roles = await db.select().from(iamRoles).where(eq(iamRoles.companyId, companyId)).orderBy(asc(iamRoles.name));
  const links = roles.length ? await db.select().from(iamRoleResources).where(inArray(iamRoleResources.roleId, roles.map((r) => r.id))) : [];
  return roles.map((r) => ({ ...r, resourceIds: links.filter((l) => l.roleId === r.id).map((l) => l.resourceId) }));
}
type RoleRow = Awaited<ReturnType<typeof rolesWithResources>>[number];

async function companyState(db: Db, companyId: string) {
  const [people, resources, grants, open, roles] = await Promise.all([
    db.select().from(iamPeople).where(eq(iamPeople.companyId, companyId)).orderBy(asc(iamPeople.lastName), asc(iamPeople.firstName)),
    db.select().from(iamResources).where(eq(iamResources.companyId, companyId)).orderBy(asc(iamResources.name)),
    db.select().from(iamGrants).where(and(eq(iamGrants.companyId, companyId), isNull(iamGrants.revokedAt))),
    db
      .select({ personId: iamRequests.personId, resourceId: iamRequests.resourceId, action: iamRequests.action })
      .from(iamRequests)
      .where(and(eq(iamRequests.companyId, companyId), inArray(iamRequests.status, OPEN))),
    rolesWithResources(db, companyId),
  ]);
  const k = (p: string, r: string) => `${p}:${r}`;
  const granted = new Set(grants.map((g) => k(g.personId, g.resourceId)));
  const openGrant = new Set(open.filter((o) => o.action === "grant").map((o) => k(o.personId, o.resourceId)));
  const openRevoke = new Set(open.filter((o) => o.action === "revoke").map((o) => k(o.personId, o.resourceId)));
  return { people, resources, grants, roles, granted, openGrant, openRevoke, k };
}

/** Chybějící přidělení z rolí: osoba (aktivní / nastupující) × oprávnění role, bez přidělení a bez otevřené žádosti. */
function roleGaps(st: Awaited<ReturnType<typeof companyState>>, today: string, roleIds?: Set<string>) {
  const out: { personId: string; resourceId: string; role: string }[] = [];
  const activeRes = new Set(st.resources.filter((r) => r.active).map((r) => r.id));
  for (const role of st.roles) {
    if (!role.active || (roleIds && !roleIds.has(role.id))) continue;
    for (const p of st.people) {
      if (personStatus(p, today) === "leaver" || !roleMatches(role, p)) continue;
      for (const rid of role.resourceIds) {
        if (!activeRes.has(rid)) continue;
        const key = st.k(p.id, rid);
        if (!st.granted.has(key) && !st.openGrant.has(key) && !out.some((x) => x.personId === p.id && x.resourceId === rid)) out.push({ personId: p.id, resourceId: rid, role: role.name });
      }
    }
  }
  return out;
}

async function roleDtos(db: Db, companyId: string, today = todayIso()): Promise<BusinessRoleDto[]> {
  const st = await companyState(db, companyId);
  const owners = new Map(
    (st.roles.some((r) => r.ownerId) ? await db.select({ id: users.id, n: users.displayName }).from(users).where(inArray(users.id, st.roles.flatMap((r) => (r.ownerId ? [r.ownerId] : [])))) : []).map((u) => [u.id, u.n]),
  );
  return st.roles.map((r) => {
    const members = st.people.filter((p) => personStatus(p, today) !== "leaver" && roleMatches(r, p));
    return {
      id: r.id,
      companyId: r.companyId,
      name: r.name,
      description: r.description,
      ownerId: r.ownerId,
      ownerName: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
      department: r.department,
      jobTitle: r.jobTitle,
      active: r.active,
      resources: r.resourceIds.map((id) => st.resources.find((x) => x.id === id)!).filter(Boolean).map((x) => ({ id: x.id, name: x.name, privileged: x.privileged, active: x.active })),
      members: members.length,
      gaps: roleGaps(st, today, new Set([r.id])).length,
    };
  });
}

/** Členství ve skupinách AD podle posledního načtení: "personId:resourceId" → v AD ano / ne; null = nelze ověřit. */
async function adMembership(db: Db, companyId: string) {
  const rec = await reconcileCompany(db, companyId);
  const hasSource = rec.sources.some((s) => s.lastSyncAt);
  const inAd = new Map<string, boolean>();
  const withGroup = new Set<string>();
  for (const r of rec.resources) {
    withGroup.add(r.resourceId);
    for (const i of r.items) {
      if (!i.personId) continue;
      if (i.type === "unapproved" || i.type === "leaver_in_ad") inAd.set(`${i.personId}:${r.resourceId}`, true);
      if (i.type === "missing") inAd.set(`${i.personId}:${r.resourceId}`, false);
    }
  }
  return { rec, hasSource, inAd, withGroup };
}

export function accessIdmRoutes(db: Db) {
  const loadPerson = async (c: Ctx, id: string) => {
    const [p] = await db.select().from(iamPeople).where(eq(iamPeople.id, id));
    assertScope(c, p?.companyId, "Osoba nenalezena");
    if (!hasPermIn(c, "access:manage", p!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return p!;
  };
  const loadRole = async (c: Ctx, id: string) => {
    const [r] = await db.select().from(iamRoles).where(eq(iamRoles.id, id));
    assertScope(c, r?.companyId, "Role nenalezena");
    if (!hasPermIn(c, "access:manage", r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r!;
  };
  const checkResources = async (companyId: string, ids: string[]) => {
    if (!ids.length) return [];
    const rows = await db.select().from(iamResources).where(and(inArray(iamResources.id, ids), eq(iamResources.companyId, companyId)));
    if (rows.length !== new Set(ids).size) throw new HTTPException(400, { message: "Oprávnění nepatří do společnosti" });
    return rows;
  };
  const saveRole = async (c: Ctx, companyId: string, v: z.output<typeof BusinessRoleInput>, id?: string) => {
    await checkResources(companyId, v.resourceIds);
    if (v.ownerId) {
      const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, v.ownerId), eq(users.isActive, true)));
      if (!u) throw new HTTPException(400, { message: "Uživatel nenalezen" });
    }
    const [dup] = await db
      .select({ id: iamRoles.id })
      .from(iamRoles)
      .where(and(eq(iamRoles.companyId, companyId), sql`lower(${iamRoles.name}) = ${v.name.toLowerCase()}`, id ? sql`${iamRoles.id} <> ${id}` : undefined));
    if (dup) throw new HTTPException(409, { message: "Role s tímto názvem už existuje" });
    const { resourceIds, ...data } = v;
    return db.transaction(async (tx) => {
      let roleId = id;
      if (roleId) await tx.update(iamRoles).set({ ...data, updatedAt: new Date() }).where(eq(iamRoles.id, roleId));
      else roleId = (await tx.insert(iamRoles).values({ ...data, companyId }).returning({ id: iamRoles.id }))[0]!.id;
      await tx.delete(iamRoleResources).where(eq(iamRoleResources.roleId, roleId));
      const uniq = [...new Set(resourceIds)];
      if (uniq.length) await tx.insert(iamRoleResources).values(uniq.map((resourceId) => ({ roleId: roleId!, resourceId })));
      return roleId;
    });
  };

  /** Návrh JML pro osobu (sdílí náhled i provedení – provedení si návrh spočítá znovu na serveru). */
  const jmlPreview = async (p: Person, v: z.output<typeof JmlPreviewInput>): Promise<JmlPreviewDto> => {
    const today = todayIso();
    const st = await companyState(db, p.companyId);
    const after = { department: v.kind === "mover" ? (v.department ?? p.department) : p.department, jobTitle: v.kind === "mover" ? (v.jobTitle ?? p.jobTitle) : p.jobTitle };
    const rolesBefore = st.roles.filter((r) => roleMatches(r, p));
    const rolesAfter = v.kind === "leaver" ? [] : st.roles.filter((r) => roleMatches(r, after));
    const mine = (set: Set<string>) => st.resources.filter((r) => set.has(st.k(p.id, r.id))).map((r) => r.id);
    const activeRes = new Set(st.resources.filter((r) => r.active).map((r) => r.id));
    const plan = jmlPlan({
      kind: v.kind,
      rolesBefore: rolesBefore.map((r) => ({ name: r.name, resourceIds: r.resourceIds })),
      rolesAfter: rolesAfter.map((r) => ({ name: r.name, resourceIds: r.resourceIds.filter((id) => activeRes.has(id)) })),
      granted: mine(st.granted),
      openGrant: mine(st.openGrant),
      openRevoke: mine(st.openRevoke),
    });
    const res = (id: string) => st.resources.find((r) => r.id === id)!;
    const sod = await sodCheck(db, p, plan.add.map((a) => res(a.id)));
    const item = (x: { id: string; roles: string[]; suggested?: boolean; note?: string | null }): JmlItem => ({
      resourceId: x.id,
      name: res(x.id).name,
      privileged: res(x.id).privileged,
      roles: x.roles,
      suggested: x.suggested ?? false,
      note: x.note ?? null,
      sod: sod[x.id] ?? [],
    });
    const cancelRequests = v.kind === "leaver" ? st.resources.filter((r) => st.openGrant.has(st.k(p.id, r.id))).length : 0;
    return {
      person: { id: p.id, name: fullName(p), department: p.department, jobTitle: p.jobTitle, status: personStatus(p, today), endDate: p.endDate },
      kind: v.kind,
      rolesBefore: rolesBefore.map((r) => r.name),
      rolesAfter: rolesAfter.map((r) => r.name),
      add: plan.add.map(item),
      remove: plan.remove.map(item),
      keep: plan.keep.map(item),
      cancelRequests,
    };
  };

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "access"))

      /* ---- přehled IDM ---- */
      .get("/idm/overview", requirePerm("access:request", "access:manage"), async (c) => {
        const me = currentUser(c);
        const certs = await pendingCertificationsFor(db, me.id);
        const my = { toApprove: (await pendingApprovalsFor(db, me.id)).length, toCertify: certs.reduce((a, x) => a + x.n, 0) };
        let companyId: string | null = null;
        try {
          companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        } catch {
          companyId = null;
        }
        const empty: IdmOverviewDto = {
          manage: false,
          my,
          flow: { pending: 0, approved: 0, toProvision: 0, done30: 0, rejected30: 0 },
          risks: { unapproved: 0, leaversInAd: 0, unknownAccounts: 0, adMissing: 0, privilegedGrants: 0, expiring14: 0, sodOpen: 0, roleGaps: 0, certOverdue: 0 },
          people: { total: 0, joiners14: 0, leavers14: 0, withoutManager: 0, withoutAccount: 0 },
          upcoming: [],
          lastSyncAt: null,
        };
        if (!companyId) return c.json(empty);
        const today = todayIso();
        const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const [flow] = await db
          .select({
            pending: sql<number>`count(*) filter (where ${iamRequests.status} = 'pending')::int`,
            approved: sql<number>`count(*) filter (where ${iamRequests.status} = 'approved')::int`,
            toProvision: sql<number>`count(*) filter (where ${iamRequests.status} = 'approved' and exists (select 1 from iam_resources r where r.id = "iam_requests"."resource_id" and r.ad_group is not null and r.ad_group <> ''))::int`,
            done30: sql<number>`count(*) filter (where ${iamRequests.status} = 'done' and ${iamRequests.fulfilledAt} >= ${since30}::timestamptz)::int`,
            rejected30: sql<number>`count(*) filter (where ${iamRequests.status} = 'rejected' and ${iamRequests.updatedAt} >= ${since30}::timestamptz)::int`,
          })
          .from(iamRequests)
          .where(eq(iamRequests.companyId, companyId));
        const st = await companyState(db, companyId);
        const { rec } = await adMembership(db, companyId);
        const items = rec.resources.flatMap((r) => r.items);
        const distinct = (type: string) => new Set(items.filter((i) => i.type === type).map((i) => `${i.personId ?? i.accountId}`)).size;
        const [sod] = await db.select({ n: sql<number>`count(*)::int` }).from(sodViolations).where(and(eq(sodViolations.companyId, companyId), eq(sodViolations.status, "open")));
        const [overdue] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(iamCertificationItems)
          .innerJoin(iamCertifications, eq(iamCertifications.id, iamCertificationItems.certificationId))
          .where(and(eq(iamCertifications.companyId, companyId), eq(iamCertifications.status, "open"), isNull(iamCertificationItems.decision), lt(iamCertifications.dueDate, today)));
        const accounts = await db
          .select({ id: identityAccounts.id, login: identityAccounts.login, email: identityAccounts.email, enabled: identityAccounts.enabled, groups: identityAccounts.groups })
          .from(identityAccounts)
          .where(and(eq(identityAccounts.companyId, companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.kind, "user")));
        const living = st.people.filter((p) => personStatus(p, today) !== "leaver");
        const match = matchAccounts(
          living.map((p) => ({ id: p.id, name: fullName(p), login: p.login, email: p.email, status: personStatus(p, today) })),
          accounts,
        );
        const in14 = addDays(today, 14);
        const in30 = addDays(today, 30);
        const privileged = new Set(st.resources.filter((r) => r.privileged).map((r) => r.id));
        const upcoming: IdmOverviewDto["upcoming"] = [];
        for (const p of st.people) {
          if (p.startDate && p.startDate >= today && p.startDate <= in30) upcoming.push({ date: p.startDate, kind: "joiner", personId: p.id, person: fullName(p), detail: p.jobTitle });
          if (p.endDate && p.endDate >= today && p.endDate <= in30) upcoming.push({ date: p.endDate, kind: "leaver", personId: p.id, person: fullName(p), detail: p.jobTitle });
        }
        for (const g of st.grants)
          if (g.validUntil && g.validUntil >= today && g.validUntil <= in30) {
            const p = st.people.find((x) => x.id === g.personId);
            const r = st.resources.find((x) => x.id === g.resourceId);
            if (p && r) upcoming.push({ date: g.validUntil, kind: "expiry", personId: p.id, person: fullName(p), detail: r.name });
          }
        upcoming.sort((a, b) => a.date.localeCompare(b.date));
        const lastSync = rec.sources.map((s) => s.lastSyncAt).filter(Boolean).sort().pop() ?? null;
        return c.json({
          manage: true,
          my,
          flow: flow ?? empty.flow,
          risks: {
            unapproved: distinct("unapproved"),
            leaversInAd: distinct("leaver_in_ad"),
            unknownAccounts: distinct("unknown_account"),
            adMissing: items.filter((i) => i.type === "missing").length,
            privilegedGrants: st.grants.filter((g) => privileged.has(g.resourceId)).length,
            expiring14: st.grants.filter((g) => g.validUntil && g.validUntil >= today && g.validUntil <= in14).length,
            sodOpen: sod?.n ?? 0,
            roleGaps: roleGaps(st, today).length,
            certOverdue: overdue?.n ?? 0,
          },
          people: {
            total: living.length,
            joiners14: st.people.filter((p) => p.startDate && p.startDate >= today && p.startDate <= in14).length,
            leavers14: st.people.filter((p) => p.endDate && p.endDate >= today && p.endDate <= in14).length,
            withoutManager: living.filter((p) => !p.managerId).length,
            withoutAccount: accounts.length ? living.filter((p) => !match.has(p.id)).length : 0,
          },
          upcoming: upcoming.slice(0, 25),
          lastSyncAt: lastSync,
        } satisfies IdmOverviewDto);
      })

      /* ---- business role ---- */
      .get("/roles", requirePerm("access:request", "access:manage"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:request");
        const all = await roleDtos(db, companyId);
        return c.json(hasPermIn(c, "access:manage", companyId) ? all : all.filter((r) => r.active));
      })
      .post("/roles", requirePerm("access:manage"), zValidator("json", BusinessRoleInput), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        const v = c.req.valid("json");
        const id = await saveRole(c, companyId, v);
        await audit(db, { c, user: currentUser(c), action: "access.role_created", entityType: "iam_role", entityId: id, details: { name: v.name, department: v.department, jobTitle: v.jobTitle, resources: v.resourceIds.length } });
        return c.json((await roleDtos(db, companyId)).find((r) => r.id === id), 201);
      })
      .put("/roles/:id", requirePerm("access:manage"), zValidator("json", BusinessRoleInput), async (c) => {
        const r = await loadRole(c, c.req.param("id"));
        const v = c.req.valid("json");
        await saveRole(c, r.companyId, v, r.id);
        await audit(db, { c, user: currentUser(c), action: "access.role_updated", entityType: "iam_role", entityId: r.id, details: { name: v.name, department: v.department, jobTitle: v.jobTitle, resources: v.resourceIds.length } });
        return c.json((await roleDtos(db, r.companyId)).find((x) => x.id === r.id));
      })
      .delete("/roles/:id", requirePerm("access:manage"), async (c) => {
        const r = await loadRole(c, c.req.param("id"));
        await db.delete(iamRoles).where(eq(iamRoles.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "access.role_deleted", entityType: "iam_role", entityId: r.id, details: { name: r.name } });
        return c.json({ ok: true });
      })
      /** Chybějící přidělení role po osobách (náhled k doplnění). */
      .get("/roles/:id/gaps", requirePerm("access:manage"), async (c) => {
        const r = await loadRole(c, c.req.param("id"));
        const st = await companyState(db, r.companyId);
        const gaps = roleGaps(st, todayIso(), new Set([r.id]));
        return c.json(
          gaps.map((g) => ({
            personId: g.personId,
            personName: fullName(st.people.find((p) => p.id === g.personId)!),
            resourceId: g.resourceId,
            resourceName: st.resources.find((x) => x.id === g.resourceId)!.name,
          })),
        );
      })
      /** Doplnit chybějící přidělení role žádostmi (projdou běžným schválením). */
      .post(
        "/roles/:id/fill",
        requirePerm("access:manage"),
        zValidator("json", z.object({ personIds: z.array(z.string().uuid()).max(500).optional(), justification: z.string().trim().max(2000).optional() })),
        async (c) => {
          const r = await loadRole(c, c.req.param("id"));
          const v = c.req.valid("json");
          const st = await companyState(db, r.companyId);
          const only = v.personIds ? new Set(v.personIds) : null;
          const gaps = roleGaps(st, todayIso(), new Set([r.id])).filter((g) => !only || only.has(g.personId));
          const me = currentUser(c);
          let created = 0;
          for (const g of gaps) {
            const person = st.people.find((p) => p.id === g.personId)!;
            const resource = st.resources.find((x) => x.id === g.resourceId)!;
            if (resource.maxDays) continue; // časově omezené oprávnění vyžaduje datum – žádá se ručně
            await createRequest(db, { companyId: r.companyId, person, resource, action: "grant", origin: "role", justification: v.justification || `Business role ${r.name}`, validUntil: null, requestedById: me.id });
            created++;
          }
          await audit(db, { c, user: me, action: "access.role_filled", entityType: "iam_role", entityId: r.id, details: { name: r.name, requests: created } });
          return c.json({ requests: created, skipped: gaps.length - created });
        },
      )

      /* ---- matice ---- */
      .get("/matrix", requirePerm("access:manage"), async (c) => {
        const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
        const today = todayIso();
        const dept = (c.req.query("department") ?? "").trim().toLowerCase();
        const roleId = c.req.query("roleId") ?? "";
        const q = (c.req.query("q") ?? "").trim().toLowerCase();
        const st = await companyState(db, companyId);
        const role = roleId ? st.roles.find((r) => r.id === roleId) : undefined;
        if (roleId && !role) throw new HTTPException(404, { message: "Role nenalezena" });
        const expected = new Set<string>();
        for (const r of st.roles) if (r.active) for (const p of st.people) if (roleMatches(r, p)) for (const rid of r.resourceIds) expected.add(st.k(p.id, rid));
        let people = st.people.filter((p) => personStatus(p, today) !== "leaver" || st.grants.some((g) => g.personId === p.id));
        if (dept) people = people.filter((p) => (p.department ?? "").toLowerCase() === dept);
        if (role) people = people.filter((p) => roleMatches(role, p) || role.resourceIds.some((rid) => st.granted.has(st.k(p.id, rid))));
        if (q) people = people.filter((p) => `${fullName(p)} ${p.login ?? ""} ${p.email ?? ""} ${p.jobTitle ?? ""}`.toLowerCase().includes(q));
        const truncated = people.length > 300;
        people = people.slice(0, 300);
        const { inAd, withGroup, hasSource } = await adMembership(db, companyId);
        const pids = new Set(people.map((p) => p.id));
        let resources = st.resources.filter((r) => r.active || st.grants.some((g) => g.resourceId === r.id));
        if (role) resources = resources.filter((r) => role.resourceIds.includes(r.id));
        else {
          // jen sloupce, ve kterých je u zobrazených osob něco vidět
          const used = new Set<string>();
          for (const key of [...st.granted, ...st.openGrant, ...expected, ...inAd.keys()]) {
            const [p, r] = key.split(":");
            if (pids.has(p!)) used.add(r!);
          }
          resources = resources.filter((r) => used.has(r.id));
        }
        resources = resources.slice(0, 120);
        const cells: Record<string, MatrixState> = {};
        for (const p of people)
          for (const r of resources) {
            const key = st.k(p.id, r.id);
            const g = st.granted.has(key);
            const ad = withGroup.has(r.id) && hasSource ? (inAd.has(key) ? inAd.get(key)! : g) : null;
            const s = matrixState({ granted: g, inAd: ad, pendingGrant: st.openGrant.has(key), pendingRevoke: st.openRevoke.has(key), expected: expected.has(key) });
            if (s) cells[key] = s;
          }
        return c.json({
          people: people.map((p) => ({ id: p.id, name: fullName(p), department: p.department, jobTitle: p.jobTitle, status: personStatus(p, today) })),
          resources: resources.map((r) => ({ id: r.id, name: r.name, privileged: r.privileged, adGroup: r.adGroup, kind: r.kind })),
          cells,
          departments: [...new Set(st.people.map((p) => p.department).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b, "cs")),
          truncated,
        } satisfies MatrixDto);
      })

      /* ---- detail osoby 360° ---- */
      .get("/people/:id/overview", requirePerm("access:manage"), async (c) => {
        const p = await loadPerson(c, c.req.param("id"));
        const today = todayIso();
        const st = await companyState(db, p.companyId);
        const { inAd, withGroup, hasSource } = await adMembership(db, p.companyId);
        const manager = p.managerId ? st.people.find((x) => x.id === p.managerId) : undefined;
        const roles = st.roles.filter((r) => r.active && roleMatches(r, p));
        const grantRows = await db
          .select({ g: iamGrants, origin: iamRequests.origin })
          .from(iamGrants)
          .leftJoin(iamRequests, eq(iamRequests.id, iamGrants.requestId))
          .where(eq(iamGrants.personId, p.id))
          .orderBy(desc(iamGrants.createdAt));
        const res = (id: string) => st.resources.find((x) => x.id === id)!;
        const accounts = await db
          .select({ a: identityAccounts, source: identitySources.name })
          .from(identityAccounts)
          .innerJoin(identitySources, eq(identitySources.id, identityAccounts.sourceId))
          .where(and(eq(identityAccounts.companyId, p.companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.kind, "user")));
        const matched = matchAccounts([{ id: p.id, name: fullName(p), login: p.login, email: p.email, status: personStatus(p, today) }], accounts.map((x) => x.a)).get(p.id);
        const byKey = new Map(st.resources.filter((r) => r.adGroup).map((r) => [groupKey(r.adGroup!), r.id]));
        const reqs = await db
          .select({ r: iamRequests, name: iamResources.name })
          .from(iamRequests)
          .innerJoin(iamResources, eq(iamResources.id, iamRequests.resourceId))
          .where(eq(iamRequests.personId, p.id))
          .orderBy(desc(iamRequests.createdAt))
          .limit(100);
        const sod = p.email
          ? await db
              .select({ rule: sql<string>`(select name from sod_rules s where s.id = ${sodViolations.ruleId})`, severity: sql<string>`(select severity::text from sod_rules s where s.id = ${sodViolations.ruleId})`, status: sodViolations.status })
              .from(sodViolations)
              .innerJoin(users, eq(users.id, sodViolations.userId))
              .where(and(sql`lower(${users.email}) = ${p.email.toLowerCase()}`, sql`${sodViolations.status} <> 'resolved'`))
          : [];
        const history: PersonOverviewDto["history"] = [];
        for (const { g } of grantRows) {
          history.push({ at: g.since, text: `Přiděleno: ${res(g.resourceId).name}` });
          if (g.revokedAt) history.push({ at: g.revokedAt.toISOString(), text: `Odebráno: ${res(g.resourceId).name}` });
        }
        if (p.startDate) history.push({ at: p.startDate, text: "Nástup" });
        if (p.endDate) history.push({ at: p.endDate, text: "Ukončení spolupráce" });
        history.sort((a, b) => b.at.localeCompare(a.at));
        const dto: PersonOverviewDto = {
          person: {
            id: p.id,
            companyId: p.companyId,
            name: fullName(p),
            email: p.email,
            login: p.login,
            personalNumber: p.personalNumber,
            department: p.department,
            jobTitle: p.jobTitle,
            kind: p.kind,
            status: personStatus(p, today),
            startDate: p.startDate,
            endDate: p.endDate,
            managerId: p.managerId,
            managerName: manager ? fullName(manager) : null,
          },
          reports: st.people.filter((x) => x.managerId === p.id).map((x) => ({ id: x.id, name: fullName(x), status: personStatus(x, today) })),
          roles: roles.map((r) => ({
            id: r.id,
            name: r.name,
            missing: r.resourceIds.filter((rid) => res(rid)?.active && !st.granted.has(st.k(p.id, rid))).map((rid) => res(rid).name),
          })),
          grants: grantRows
            .filter(({ g }) => !g.revokedAt)
            .map(({ g, origin }) => {
              const key = st.k(p.id, g.resourceId);
              const r = res(g.resourceId);
              return {
                id: g.id,
                resourceId: r.id,
                name: r.name,
                kind: r.kind,
                privileged: r.privileged,
                since: g.since,
                validUntil: g.validUntil,
                origin,
                inAd: withGroup.has(r.id) && hasSource ? (inAd.has(key) ? inAd.get(key)! : true) : null,
                roles: roles.filter((x) => x.resourceIds.includes(r.id)).map((x) => x.name),
                revoking: st.openRevoke.has(key),
              };
            }),
          accounts: matched
            ? accounts
                .filter((x) => x.a.id === matched.id)
                .map(({ a, source }) => ({
                  id: a.id,
                  source,
                  login: a.login,
                  enabled: a.enabled,
                  lastLogonAt: a.lastLogonAt?.toISOString() ?? null,
                  groups: a.groups
                    .map((g) => {
                      const rid = byKey.get(groupKey(g)) ?? null;
                      return { name: g, resourceId: rid, approved: !!rid && st.granted.has(st.k(p.id, rid)) };
                    })
                    .sort((x, y) => x.name.localeCompare(y.name)),
                }))
            : [],
          requests: reqs.map(({ r, name }) => ({ id: r.id, resourceName: name, action: r.action, status: r.status as PersonOverviewDto["requests"][number]["status"], origin: r.origin, createdAt: r.createdAt.toISOString() })),
          sod: sod.map((s) => ({ rule: s.rule, severity: s.severity, status: s.status })),
          history: history.slice(0, 60),
        };
        return c.json(dto);
      })

      /* ---- SoD při žádosti (náhled) ---- */
      .post(
        "/sod-check",
        requirePerm("access:request", "access:manage"),
        zValidator("json", z.object({ personId: z.string().uuid(), resourceIds: z.array(z.string().uuid()).min(1).max(50) })),
        async (c) => {
          const v = c.req.valid("json");
          const [p] = await db.select().from(iamPeople).where(eq(iamPeople.id, v.personId));
          assertScope(c, p?.companyId, "Osoba nenalezena");
          const rows = await checkResources(p!.companyId, v.resourceIds);
          return c.json((await sodCheck(db, p!, rows)) as Record<string, SodConflict[]>);
        },
      )

      /* ---- JML průvodce ---- */
      .post("/jml/preview", requirePerm("access:manage"), zValidator("json", JmlPreviewInput), async (c) => {
        const v = c.req.valid("json");
        const p = await loadPerson(c, v.personId);
        return c.json(await jmlPreview(p, v));
      })
      .post("/jml/apply", requirePerm("access:manage"), zValidator("json", JmlApplyInput), async (c) => {
        const v = c.req.valid("json");
        const p = await loadPerson(c, v.personId);
        const me = currentUser(c);
        const today = todayIso();
        if (v.kind === "leaver" && !v.endDate) throw new HTTPException(400, { message: "Vyplňte datum ukončení spolupráce" });
        if (v.kind === "leaver" && p.startDate && v.endDate! < p.startDate) throw new HTTPException(400, { message: "Datum ukončení je před nástupem" });
        if (v.kind !== "leaver" && personStatus(p, today) === "leaver") throw new HTTPException(400, { message: "Osoba už ukončila spolupráci" });
        if (v.kind === "mover" && !v.department && !v.jobTitle) throw new HTTPException(400, { message: "Zadejte nový útvar nebo funkci" });
        // osobu nejdřív aktualizovat (návrh se počítá z nových údajů)
        let personUpdated = false;
        if (v.kind === "mover" && ((v.department ?? p.department) !== p.department || (v.jobTitle ?? p.jobTitle) !== p.jobTitle)) {
          await db.update(iamPeople).set({ department: v.department ?? p.department, jobTitle: v.jobTitle ?? p.jobTitle, updatedAt: new Date() }).where(eq(iamPeople.id, p.id));
          personUpdated = true;
        }
        if (v.kind === "leaver" && v.endDate !== p.endDate) {
          await db.update(iamPeople).set({ endDate: v.endDate, updatedAt: new Date() }).where(eq(iamPeople.id, p.id));
          personUpdated = true;
        }
        const plan = await jmlPreview(p, v);
        const allowedAdd = new Set(plan.add.filter((a) => a.note !== "open").map((a) => a.resourceId));
        const allowedRemove = new Set(plan.remove.filter((a) => a.note !== "open").map((a) => a.resourceId));
        const bad = [...v.add.filter((id) => !allowedAdd.has(id)), ...v.remove.filter((id) => !allowedRemove.has(id))];
        if (bad.length) throw new HTTPException(400, { message: "Výběr neodpovídá návrhu – načtěte návrh znovu" });
        const [fresh] = await db.select().from(iamPeople).where(eq(iamPeople.id, p.id));
        const resources = await checkResources(p.companyId, [...v.add, ...v.remove]);
        const label = v.kind === "joiner" ? "Nástup" : v.kind === "mover" ? "Přesun" : "Odchod";
        let requests = 0;
        // odchod v budoucnu: jen datum ukončení – oprávnění odebere denní kontrola v den odchodu
        const removeNow = v.kind !== "leaver" || v.endDate! <= today;
        for (const id of removeNow ? v.remove : []) {
          const resource = resources.find((r) => r.id === id)!;
          await createRequest(db, {
            companyId: p.companyId,
            person: fresh!,
            resource,
            action: "revoke",
            origin: v.kind === "leaver" ? "leaver" : "jml",
            justification: v.justification || (v.kind === "leaver" ? `Odchod k ${v.endDate}` : `${label} – oprávnění nepatří k nové pozici`),
            validUntil: null,
            requestedById: me.id,
          });
          requests++;
        }
        for (const id of v.add) {
          const resource = resources.find((r) => r.id === id)!;
          if (resource.maxDays) continue;
          const roles = plan.add.find((a) => a.resourceId === id)?.roles ?? [];
          await createRequest(db, {
            companyId: p.companyId,
            person: fresh!,
            resource,
            action: "grant",
            origin: "jml",
            justification: v.justification || `${label}${roles.length ? ` – role ${roles.join(", ")}` : ""}`,
            validUntil: null,
            requestedById: me.id,
          });
          requests++;
        }
        let cancelled = 0;
        if (v.kind === "leaver" && removeNow)
          cancelled = (
            await db
              .update(iamRequests)
              .set({ status: "cancelled", fulfilNote: "Zrušeno – odchod osoby", updatedAt: new Date() })
              .where(and(eq(iamRequests.personId, p.id), eq(iamRequests.action, "grant"), inArray(iamRequests.status, OPEN)))
              .returning({ id: iamRequests.id })
          ).length;
        await audit(db, { c, user: me, action: `access.jml_${v.kind}`, entityType: "iam_person", entityId: p.id, details: { name: fullName(p), add: v.add.length, remove: v.remove.length, cancelled, department: v.department, jobTitle: v.jobTitle, endDate: v.endDate } });
        return c.json({ requests, cancelled, personUpdated, scheduled: !removeNow });
      })
  );
}

