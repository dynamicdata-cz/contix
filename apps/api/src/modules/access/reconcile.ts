import { ReconAdoptInput, ReconRevokeInput, groupKey, matchAccounts, personStatus, reconcileGroup, type ReconDto, type ReconPerson } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { iamGrants, iamPeople, iamRequests, iamResources, identityAccounts, identitySources } from "../../db/schema";
import { createRequest, fullName, todayIso } from "./routes";

/* ============================================================
 * Soulad s AD / Entra ID (v1.28, ADR-125): členství ve skupinách z posledního načtení zdroje identit (jen čtení)
 * proti evidovaným přidělením. Převzetí stávajícího stavu (počáteční naplnění) a žádost o odebrání neschváleného členství.
 * ============================================================ */

type Ctx = Context<AppEnv>;

export async function reconcileCompany(db: Db, companyId: string): Promise<ReconDto> {
  const today = todayIso();
  const [sources, resources, people, grants, accounts] = await Promise.all([
    db.select({ id: identitySources.id, name: identitySources.name, kind: identitySources.kind, lastSyncAt: identitySources.lastSyncAt }).from(identitySources).where(eq(identitySources.companyId, companyId)),
    db.select().from(iamResources).where(eq(iamResources.companyId, companyId)),
    db.select().from(iamPeople).where(eq(iamPeople.companyId, companyId)),
    db.select({ personId: iamGrants.personId, resourceId: iamGrants.resourceId }).from(iamGrants).where(and(eq(iamGrants.companyId, companyId), isNull(iamGrants.revokedAt))),
    db
      .select({ id: identityAccounts.id, login: identityAccounts.login, email: identityAccounts.email, enabled: identityAccounts.enabled, groups: identityAccounts.groups })
      .from(identityAccounts)
      .where(and(eq(identityAccounts.companyId, companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.kind, "user"))),
  ]);
  const rp: ReconPerson[] = people.map((p) => ({ id: p.id, name: fullName(p), login: p.login, email: p.email, status: personStatus(p, today) }));
  const match = matchAccounts(rp, accounts);
  const withGroup = resources.filter((r) => r.adGroup || r.kind === "ad_group");
  return {
    sources: sources.map((s) => ({ ...s, lastSyncAt: s.lastSyncAt?.toISOString() ?? null })),
    withoutGroup: resources.filter((r) => r.kind === "ad_group" && !r.adGroup).length,
    resources: withGroup.map((r) => {
      const group = r.adGroup || r.name;
      const granted = new Set(grants.filter((g) => g.resourceId === r.id).map((g) => g.personId));
      const items = reconcileGroup(group, rp, accounts, granted, match);
      return {
        resourceId: r.id,
        resourceName: r.name,
        group,
        privileged: r.privileged,
        members: accounts.filter((a) => a.groups.some((g) => groupKey(g) === groupKey(group))).length,
        granted: granted.size,
        items,
      };
    }),
  };
}

export function accessReconcileRoutes(db: Db) {
  const loadResource = async (c: Ctx, id: string) => {
    const [r] = await db.select().from(iamResources).where(eq(iamResources.id, id));
    assertScope(c, r?.companyId, "Oprávnění nenalezeno");
    if (!hasPermIn(c, "access:manage", r!.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return r!;
  };
  /** Osoby, u kterých soulad hlásí daný typ nesouladu (ověření na serveru, ne podle klienta). */
  const itemsOf = async (companyId: string, resourceId: string, types: string[]) => {
    const d = await reconcileCompany(db, companyId);
    return (d.resources.find((x) => x.resourceId === resourceId)?.items ?? []).filter((i) => types.includes(i.type));
  };

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "access"))
    .get("/reconcile", requirePerm("access:manage"), async (c) => c.json(await reconcileCompany(db, targetCompany(c, c.req.query("companyId") ?? null, "access:manage"))))
    /** Převzetí stávajícího členství jako evidovaného přidělení (počáteční naplnění evidence). */
    .post("/reconcile/adopt", requirePerm("access:manage"), zValidator("json", ReconAdoptInput), async (c) => {
      const v = c.req.valid("json");
      const r = await loadResource(c, v.resourceId);
      const allowed = new Set((await itemsOf(r.companyId, r.id, ["unapproved"])).map((i) => i.personId));
      const ids = v.personIds.filter((id) => allowed.has(id));
      if (!ids.length) throw new HTTPException(400, { message: "Žádná z vybraných osob není ve skupině bez schválení" });
      await db.insert(iamGrants).values(ids.map((personId) => ({ companyId: r.companyId, personId, resourceId: r.id, since: todayIso() }))).onConflictDoNothing();
      await audit(db, { c, user: currentUser(c), action: "access.adopted", entityType: "iam_resource", entityId: r.id, details: { resource: r.name, people: ids.length } });
      return c.json(await reconcileCompany(db, r.companyId));
    })
    /** Žádost o odebrání neschváleného členství (nebo členství odešlé osoby) – jde rovnou k vyřízení. */
    .post("/reconcile/revoke", requirePerm("access:manage"), zValidator("json", ReconRevokeInput), async (c) => {
      const v = c.req.valid("json");
      const r = await loadResource(c, v.resourceId);
      const it = (await itemsOf(r.companyId, r.id, ["unapproved", "leaver_in_ad"])).find((i) => i.personId === v.personId);
      if (!it) throw new HTTPException(400, { message: "Osoba není ve skupině bez schválení" });
      const [person] = await db.select().from(iamPeople).where(eq(iamPeople.id, v.personId));
      const [open] = await db
        .select({ id: iamRequests.id })
        .from(iamRequests)
        .where(and(eq(iamRequests.personId, v.personId), eq(iamRequests.resourceId, r.id), eq(iamRequests.action, "revoke"), inArray(iamRequests.status, ["pending", "approved"])));
      if (open) throw new HTTPException(409, { message: "Pro tuto osobu a oprávnění už je otevřená žádost" });
      const req = await createRequest(db, {
        companyId: r.companyId,
        person: person!,
        resource: r,
        action: "revoke",
        origin: "reconcile",
        justification: v.justification || (it.type === "leaver_in_ad" ? "Odešlá osoba je stále členem skupiny v AD" : `Členství ve skupině ${r.adGroup ?? r.name} bez schválené žádosti`),
        validUntil: null,
        requestedById: currentUser(c).id,
      });
      await audit(db, { c, user: currentUser(c), action: "access.reconcile_revoke", entityType: "access_request", entityId: req.id, details: { resource: r.name, person: fullName(person!), type: it.type } });
      return c.json({ requestId: req.id });
    });
}
