import { ImportAdGroupsInput, parentDn, type AdGroupsDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { iamGrants, iamResources, identityGroups, identitySources, users } from "../../db/schema";
import { reconcileCompany } from "./reconcile";
import { todayIso } from "./routes";

/* ============================================================
 * Skupiny z AD do katalogu oprávnění (v1.33, ADR-130): výběr existujících skupin podle OU a hromadné založení oprávnění
 * (volitelně s převzetím stávajících členů); seznam OU pro povolenou OU a místo nových skupin.
 * ============================================================ */

export async function adGroupsOf(db: Db, companyId: string): Promise<AdGroupsDto> {
  const [sources, groups, resources] = await Promise.all([
    db.select({ id: identitySources.id, name: identitySources.name, lastSyncAt: identitySources.lastSyncAt }).from(identitySources).where(and(eq(identitySources.companyId, companyId), eq(identitySources.kind, "ad"))),
    db.select().from(identityGroups).where(and(eq(identityGroups.companyId, companyId), isNull(identityGroups.removedAt))).orderBy(asc(identityGroups.dn)),
    db.select({ id: iamResources.id, dn: iamResources.adGroup }).from(iamResources).where(eq(iamResources.companyId, companyId)),
  ]);
  const byDn = new Map(resources.filter((r) => r.dn).map((r) => [r.dn!.toLowerCase(), r.id]));
  const list = groups.map((g) => ({ dn: g.dn, cn: g.cn, ou: parentDn(g.dn), description: g.description, privileged: g.privileged, protectedGroup: g.protectedGroup, members: g.members, resourceId: byDn.get(g.dn.toLowerCase()) ?? null }));
  // OU včetně nadřazených (OU=Business,OU=Groups,… → i OU=Groups,…), bez samotné domény a vestavěných kontejnerů
  const ous = new Set<string>();
  for (const g of list) {
    let ou = g.ou;
    while (/^OU=/i.test(ou)) {
      ous.add(ou);
      ou = parentDn(ou);
    }
  }
  return {
    sources: sources.map((s) => ({ ...s, lastSyncAt: s.lastSyncAt?.toISOString() ?? null })),
    groups: list,
    ous: [...ous].sort((a, b) => a.split(",").reverse().join(",").localeCompare(b.split(",").reverse().join(","))),
  };
}

export function accessAdGroupRoutes(db: Db) {
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "access"))
    .get("/ad-groups", requirePerm("access:manage"), async (c) => c.json(await adGroupsOf(db, targetCompany(c, c.req.query("companyId") ?? null, "access:manage"))))
    .post("/resources/import-ad", requirePerm("access:manage"), zValidator("json", ImportAdGroupsInput), async (c) => {
      const companyId = targetCompany(c, c.req.query("companyId") ?? null, "access:manage");
      const v = c.req.valid("json");
      if (v.ownerId) {
        const [u] = await db.select({ a: users.isActive }).from(users).where(eq(users.id, v.ownerId));
        if (!u?.a) throw new HTTPException(400, { message: "Uživatel nenalezen" });
      }
      const all = await adGroupsOf(db, companyId);
      const want = new Set(v.dns.map((d) => d.toLowerCase()));
      const picked = all.groups.filter((g) => want.has(g.dn.toLowerCase()));
      if (picked.length !== want.size) throw new HTTPException(400, { message: "Některá skupina v načteném AD není – spusťte synchronizaci zdroje identit" });
      const existingNames = new Set((await db.select({ n: iamResources.name }).from(iamResources).where(eq(iamResources.companyId, companyId))).map((r) => r.n.toLowerCase()));
      const created: { id: string; dn: string }[] = [];
      for (const g of picked) {
        if (g.resourceId) continue;
        // název oprávnění = CN; při shodě názvu s jiným oprávněním doplnit OU
        let name = g.cn;
        if (existingNames.has(name.toLowerCase())) name = `${g.cn} (${g.ou.split(",")[0]!.replace(/^OU=/i, "")})`.slice(0, 200);
        existingNames.add(name.toLowerCase());
        const [r] = await db
          .insert(iamResources)
          .values({ companyId, name, kind: "ad_group", description: g.description, adGroup: g.dn, ownerId: v.ownerId, approvalManager: v.approvalManager, approvalOwner: v.approvalOwner, privileged: g.privileged || g.protectedGroup })
          .returning({ id: iamResources.id });
        created.push({ id: r!.id, dn: g.dn });
      }
      // převzetí stávajících členů jako přidělení (jen osoby, které soulad vyhodnotí jako „ve skupině bez schválení“)
      let adopted = 0;
      if (v.adopt && created.length) {
        const rec = await reconcileCompany(db, companyId);
        for (const cr of created) {
          const ids = (rec.resources.find((x) => x.resourceId === cr.id)?.items ?? []).filter((i) => i.type === "unapproved").map((i) => i.personId!);
          if (!ids.length) continue;
          const ins = await db.insert(iamGrants).values(ids.map((personId) => ({ companyId, personId, resourceId: cr.id, since: todayIso() }))).onConflictDoNothing().returning({ id: iamGrants.id });
          adopted += ins.length;
        }
      }
      await audit(db, { c, user: currentUser(c), action: "access.resources_imported_ad", entityType: "iam_resource", details: { created: created.length, adopted, groups: created.map((x) => x.dn) } });
      return c.json({ created: created.length, skipped: picked.length - created.length, adopted });
    });
}

