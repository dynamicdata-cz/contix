import { groupKey, matchAccounts, personStatus, sodConflictsFor, type SodConflict } from "@contix/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { iamGrants, iamPeople, iamRequests, iamResources, identityAccounts, positionHolders, positions, sodRules, users } from "../../db/schema";

/* ============================================================
 * Kontrola toxických kombinací (SoD) při žádosti (v1.34, ADR-131): současný stav osoby = skupiny jejího účtu v AD
 * + evidovaná přidělení + otevřené žádosti o přidělení + funkční místa jejího uživatele CONTIXu; pravidla jsou
 * stejná jako v Identitách (Toxické kombinace). Oprávnění bez skupiny AD se porovnává podle názvu.
 * ============================================================ */

export const resourceKey = (r: { adGroup: string | null; name: string }) => groupKey(r.adGroup || r.name);

export async function personState(db: Db, person: typeof iamPeople.$inferSelect) {
  const [grants, open, accounts] = await Promise.all([
    db
      .select({ adGroup: iamResources.adGroup, name: iamResources.name, id: iamResources.id })
      .from(iamGrants)
      .innerJoin(iamResources, eq(iamResources.id, iamGrants.resourceId))
      .where(and(eq(iamGrants.personId, person.id), isNull(iamGrants.revokedAt))),
    db
      .select({ adGroup: iamResources.adGroup, name: iamResources.name, id: iamResources.id })
      .from(iamRequests)
      .innerJoin(iamResources, eq(iamResources.id, iamRequests.resourceId))
      .where(and(eq(iamRequests.personId, person.id), eq(iamRequests.action, "grant"), inArray(iamRequests.status, ["pending", "approved"]))),
    db
      .select({ id: identityAccounts.id, login: identityAccounts.login, email: identityAccounts.email, enabled: identityAccounts.enabled, groups: identityAccounts.groups })
      .from(identityAccounts)
      .where(and(eq(identityAccounts.companyId, person.companyId), isNull(identityAccounts.removedAt), eq(identityAccounts.kind, "user"))),
  ]);
  const acc = matchAccounts([{ id: person.id, name: "", login: person.login, email: person.email, status: personStatus(person, new Date().toISOString().slice(0, 10)) }], accounts).get(person.id);
  let positionIds: string[] = [];
  const positionNames: Record<string, string> = {};
  if (person.email) {
    const rows = await db
      .select({ id: positions.id, name: positions.name })
      .from(positionHolders)
      .innerJoin(users, eq(users.id, positionHolders.userId))
      .innerJoin(positions, eq(positions.id, positionHolders.positionId))
      .where(and(sql`lower(${users.email}) = ${person.email.trim().toLowerCase()}`, eq(users.isActive, true)));
    positionIds = rows.map((r) => r.id);
    for (const r of rows) positionNames[r.id] = r.name;
  }
  return { groups: [...(acc?.groups ?? []), ...grants.map(resourceKey), ...open.map(resourceKey)], positionIds, positionNames };
}

export async function sodRulesOf(db: Db, companyId: string) {
  return db
    .select({ id: sodRules.id, name: sodRules.name, severity: sodRules.severity, sideA: sodRules.sideA, sideB: sodRules.sideB })
    .from(sodRules)
    .where(and(eq(sodRules.companyId, companyId), eq(sodRules.enabled, true)));
}

/** Konflikty pro každé z oprávnění (každé posouzené samostatně vůči současnému stavu). */
export async function sodCheck(db: Db, person: typeof iamPeople.$inferSelect, resources: { id: string; adGroup: string | null; name: string }[]): Promise<Record<string, SodConflict[]>> {
  const out: Record<string, SodConflict[]> = {};
  if (!resources.length) return out;
  const rules = await sodRulesOf(db, person.companyId);
  if (!rules.length) return out;
  const state = await personState(db, person);
  for (const r of resources) {
    const c = sodConflictsFor(rules, state, [resourceKey(r)]);
    if (c.length) out[r.id] = c;
  }
  return out;
}

/** Konflikty celé sady najednou (JML: přidávané položky dohromady). */
export async function sodCheckSet(db: Db, person: typeof iamPeople.$inferSelect, resources: { id: string; adGroup: string | null; name: string }[], withoutResourceIds: string[] = []) {
  const rules = await sodRulesOf(db, person.companyId);
  if (!rules.length || !resources.length) return [] as SodConflict[];
  const state = await personState(db, person);
  if (withoutResourceIds.length) {
    const drop = new Set(
      (await db.select({ adGroup: iamResources.adGroup, name: iamResources.name }).from(iamResources).where(inArray(iamResources.id, withoutResourceIds))).map(resourceKey),
    );
    state.groups = state.groups.filter((g) => !drop.has(groupKey(g)));
  }
  return sodConflictsFor(rules, state, resources.map(resourceKey));
}
