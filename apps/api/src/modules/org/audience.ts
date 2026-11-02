import { descendantsOf, type Audience } from "@contix/shared";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getCompanies } from "../../auth/scope";
import type { Db } from "../../db/client";
import { orgUnits, positionHolders, positions, users } from "../../db/schema";

export interface AudienceMember {
  userId: string;
  name: string;
  email: string;
  /** Nejdřívější nástup do funkčního místa, které ho do okruhu zařadilo (pro lhůty vstupních školení). */
  since: string | null;
}

/**
 * Okruh dotčených osob (§ 6 odst. 5 písm. b, § 10) – aktivní uživatelé podle útvarů, funkčních míst,
 * bezpečnostních rolí a vedení. „Všichni“ = uživatelé společnosti a jejích dceřiných společností
 * (dokument holdingu platí pro celou skupinu).
 */
export async function audienceMembers(db: Db, companyId: string, a: Audience): Promise<AudienceMember[]> {
  const out = new Map<string, AudienceMember>();
  const add = (r: { userId: string; name: string; email: string; since: string | null }) => {
    const cur = out.get(r.userId);
    if (!cur) out.set(r.userId, { ...r });
    else if (r.since && (!cur.since || r.since < cur.since)) cur.since = r.since;
  };
  if (a.all) {
    const all = await getCompanies(db);
    const ids = [companyId, ...descendantsOf(all, companyId)];
    const rows = await db
      .select({ userId: users.id, name: users.displayName, email: users.email })
      .from(users)
      .where(and(eq(users.isActive, true), inArray(users.companyId, ids)));
    for (const r of rows) add({ ...r, since: null });
  }
  const conds = [];
  if (a.positionIds.length) conds.push(inArray(positions.id, a.positionIds));
  if (a.unitIds.length) {
    // útvar včetně podřízených útvarů
    const sub = await db.execute<{ id: string }>(sql`
      with recursive t as (select id from org_units where id in (${sql.join(a.unitIds.map((x) => sql`${x}::uuid`), sql`, `)})
        union select u.id from org_units u join t on u.parent_id = t.id)
      select id from t`);
    const ids = [...sub].map((r) => r.id);
    if (ids.length) conds.push(inArray(positions.orgUnitId, ids));
  }
  if (a.securityRoles.length) conds.push(sql`${positions.securityRoles} && ${sql`array[${sql.join(a.securityRoles.map((r) => sql`${r}`), sql`, `)}]::text[]`}`);
  if (a.management) conds.push(and(eq(positions.isManager, true), isNull(orgUnits.parentId)));
  if (conds.length) {
    const rows = await db
      .select({ userId: users.id, name: users.displayName, email: users.email, since: positionHolders.since })
      .from(positionHolders)
      .innerJoin(positions, eq(positions.id, positionHolders.positionId))
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .innerJoin(users, eq(users.id, positionHolders.userId))
      .where(and(eq(users.isActive, true), or(...conds)));
    for (const r of rows) add(r);
  }
  return [...out.values()].sort((x, y) => x.name.localeCompare(y.name, "cs"));
}

/** Je uživatel v okruhu? (pro „moje povinnosti“ bez načítání celého okruhu by bylo složitější – okruhy jsou malé). */
export async function isMember(db: Db, companyId: string, a: Audience, userId: string) {
  return (await audienceMembers(db, companyId, a)).some((m) => m.userId === userId);
}

/**
 * Hromadné vyhodnocení okruhů (přehledy dokumentů a školení): organizace a uživatelé se načtou jednou
 * a okruhy se počítají v paměti – místo několika dotazů na každý dokument. Výsledek je shodný s `audienceMembers`.
 */
export async function audienceResolver(db: Db) {
  const [companies, activeUsers, units, holders] = await Promise.all([
    getCompanies(db),
    db.select({ userId: users.id, name: users.displayName, email: users.email, companyId: users.companyId }).from(users).where(eq(users.isActive, true)),
    db.select({ id: orgUnits.id, parentId: orgUnits.parentId }).from(orgUnits),
    db
      .select({ userId: positionHolders.userId, positionId: positions.id, unitId: positions.orgUnitId, isManager: positions.isManager, securityRoles: positions.securityRoles, since: positionHolders.since })
      .from(positionHolders)
      .innerJoin(positions, eq(positions.id, positionHolders.positionId)),
  ]);
  const userById = new Map(activeUsers.map((u) => [u.userId, u]));
  const parentOf = new Map(units.map((u) => [u.id, u.parentId]));
  const childrenOf = new Map<string, string[]>();
  for (const u of units) if (u.parentId) childrenOf.set(u.parentId, [...(childrenOf.get(u.parentId) ?? []), u.id]);
  const subtree = (ids: string[]) => {
    const out = new Set(ids);
    const stack = [...ids];
    while (stack.length) for (const c of childrenOf.get(stack.pop()!) ?? []) if (!out.has(c)) (out.add(c), stack.push(c));
    return out;
  };
  const cache = new Map<string, AudienceMember[]>();
  return (companyId: string, a: Audience): AudienceMember[] => {
    const key = `${companyId}|${JSON.stringify(a)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const out = new Map<string, AudienceMember>();
    const add = (r: AudienceMember) => {
      const cur = out.get(r.userId);
      if (!cur) out.set(r.userId, { ...r });
      else if (r.since && (!cur.since || r.since < cur.since)) cur.since = r.since;
    };
    if (a.all) {
      const ids = new Set([companyId, ...descendantsOf(companies, companyId)]);
      for (const u of activeUsers) if (ids.has(u.companyId)) add({ userId: u.userId, name: u.name, email: u.email, since: null });
    }
    const pos = new Set(a.positionIds);
    const unitSet = a.unitIds.length ? subtree(a.unitIds) : null;
    const roles = new Set(a.securityRoles);
    for (const h of holders) {
      const u = userById.get(h.userId);
      if (!u) continue;
      const hit =
        pos.has(h.positionId) ||
        (unitSet?.has(h.unitId) ?? false) ||
        (roles.size > 0 && h.securityRoles.some((r) => roles.has(r))) ||
        (a.management && h.isManager && !parentOf.get(h.unitId));
      if (hit) add({ userId: u.userId, name: u.name, email: u.email, since: h.since });
    }
    const res = [...out.values()].sort((x, y) => x.name.localeCompare(y.name, "cs"));
    cache.set(key, res);
    return res;
  };
}
