import { DEFAULT_PROVISIONING, ProvisioningConfig, planProvisioning, type ProvisioningPlan, type ProvisioningResultDto } from "@contix/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../../auth/service";
import type { Db } from "../../db/client";
import { identityAccounts, identitySources, orgUnits, positionHolders, positions, roles, sessions, userRoles, users } from "../../db/schema";

/* ============================================================
 * Synchronizace uživatelů a organizační struktury z adresáře (ADR-031).
 * Jen členové zvolené skupiny; spravuje jen uživatele / funkční místa, která sama založila (directory_source_id).
 * Ručně založené uživatele nikdy nedeaktivuje ani nepřejmenuje; útvary jen zakládá (nemaže).
 * ============================================================ */

type SourceRow = typeof identitySources.$inferSelect;

export const provisioningOf = (row: Pick<SourceRow, "provisioning">) => ProvisioningConfig.parse(row.provisioning ?? DEFAULT_PROVISIONING);

export async function planFor(db: Db, row: SourceRow): Promise<ProvisioningPlan> {
  const cfg = provisioningOf(row);
  const [accounts, people] = await Promise.all([
    db
      .select({ email: identityAccounts.email, displayName: identityAccounts.displayName, title: identityAccounts.title, department: identityAccounts.department, enabled: identityAccounts.enabled, removedAt: identityAccounts.removedAt, kind: identityAccounts.kind, groups: identityAccounts.groups })
      .from(identityAccounts)
      .where(eq(identityAccounts.sourceId, row.id)),
    db.select({ id: users.id, email: users.email, displayName: users.displayName, jobTitle: users.jobTitle, isActive: users.isActive, src: users.directorySourceId }).from(users),
  ]);
  return planProvisioning(
    accounts.map((a) => ({ ...a, removed: !!a.removedAt })),
    people.map((u) => ({ id: u.id, email: u.email, displayName: u.displayName, jobTitle: u.jobTitle, isActive: u.isActive, managed: u.src === row.id })),
    cfg,
  );
}

export async function applyProvisioning(db: Db, row: SourceRow, opts: { actor?: { id: string; email: string } } = {}): Promise<ProvisioningResultDto> {
  const cfg = provisioningOf(row);
  const plan = await planFor(db, row);
  const res: ProvisioningResultDto = { created: 0, updated: 0, reactivated: 0, deactivated: 0, unitsCreated: 0, positionsCreated: 0, holdersAdded: 0, holdersRemoved: 0 };
  if (!cfg.enabled || !cfg.group) return res;

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, cfg.defaultRoleKey));
  await db.transaction(async (tx) => {
    // uživatelé
    for (const u of plan.create) {
      const [created] = await tx
        .insert(users)
        .values({ email: u.email, displayName: u.displayName, jobTitle: u.jobTitle, authProvider: "oidc", companyId: row.companyId, directorySourceId: row.id })
        .onConflictDoNothing()
        .returning({ id: users.id });
      if (!created) continue;
      if (role) await tx.insert(userRoles).values({ userId: created.id, roleId: role.id, source: "manual", companyId: row.companyId }).onConflictDoNothing();
      res.created++;
    }
    for (const u of plan.update) {
      await tx.update(users).set({ displayName: u.displayName, jobTitle: u.jobTitle, updatedAt: new Date() }).where(and(eq(users.id, u.id), eq(users.directorySourceId, row.id)));
      res.updated++;
    }
    if (plan.reactivate.length) {
      await tx.update(users).set({ isActive: true, updatedAt: new Date() }).where(and(inArray(users.id, plan.reactivate.map((x) => x.id)), eq(users.directorySourceId, row.id)));
      res.reactivated = plan.reactivate.length;
    }
    if (plan.deactivate.length) {
      const ids = plan.deactivate.map((x) => x.id);
      await tx.update(users).set({ isActive: false, updatedAt: new Date() }).where(and(inArray(users.id, ids), eq(users.directorySourceId, row.id)));
      await tx.delete(sessions).where(inArray(sessions.userId, ids));
      res.deactivated = ids.length;
    }

    // útvary (existující se stejným názvem se použijí) a spravovaná funkční místa
    if (cfg.units && plan.units.length) {
      const existing = await tx.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.companyId, row.companyId));
      const unitId = new Map(existing.map((u) => [u.name.toLowerCase(), u.id]));
      for (const name of plan.units) {
        if (unitId.has(name.toLowerCase())) continue;
        const [u] = await tx.insert(orgUnits).values({ companyId: row.companyId, name, directorySourceId: row.id }).returning({ id: orgUnits.id });
        unitId.set(name.toLowerCase(), u!.id);
        res.unitsCreated++;
      }
      if (cfg.positions) {
        const managed = await tx.select({ id: positions.id, orgUnitId: positions.orgUnitId, name: positions.name }).from(positions).where(eq(positions.directorySourceId, row.id));
        const posKey = (unit: string, name: string) => `${unit}\u0000${name.toLowerCase()}`;
        const posId = new Map(managed.map((p) => [posKey(p.orgUnitId, p.name), p.id]));
        for (const p of plan.positions) {
          const uid = unitId.get(p.unit.toLowerCase())!;
          if (posId.has(posKey(uid, p.name))) continue;
          const [created] = await tx.insert(positions).values({ orgUnitId: uid, name: p.name, directorySourceId: row.id }).returning({ id: positions.id });
          posId.set(posKey(uid, p.name), created!.id);
          res.positionsCreated++;
        }
        // obsazení spravovaných míst podle plánu
        const people = await tx.select({ id: users.id, email: users.email }).from(users).where(inArray(sql`lower(${users.email})`, plan.placements.length ? plan.placements.map((x) => x.email) : [""]));
        const userId = new Map(people.map((u) => [u.email.toLowerCase(), u.id]));
        const desired = new Set(plan.placements.map((x) => `${posId.get(posKey(unitId.get(x.unit.toLowerCase())!, x.position))}|${userId.get(x.email)}`).filter((k) => !k.includes("undefined")));
        const allManaged = [...posId.values()];
        const current = allManaged.length ? await tx.select({ p: positionHolders.positionId, u: positionHolders.userId }).from(positionHolders).where(inArray(positionHolders.positionId, allManaged)) : [];
        const have = new Set(current.map((h) => `${h.p}|${h.u}`));
        for (const h of current)
          if (!desired.has(`${h.p}|${h.u}`)) {
            await tx.delete(positionHolders).where(and(eq(positionHolders.positionId, h.p), eq(positionHolders.userId, h.u)));
            res.holdersRemoved++;
          }
        for (const k of desired)
          if (!have.has(k)) {
            const [p, u] = k.split("|") as [string, string];
            await tx.insert(positionHolders).values({ positionId: p, userId: u }).onConflictDoNothing();
            res.holdersAdded++;
          }
      }
    }
  });

  if (Object.values(res).some((n) => n > 0))
    await audit(db, {
      user: opts.actor ?? null,
      email: opts.actor ? undefined : "system@contix",
      action: "identity.provisioned",
      entityType: "identity_source",
      entityId: row.id,
      details: { ...res, createdEmails: plan.create.map((x) => x.email).slice(0, 200), deactivated: plan.deactivate.slice(0, 200) },
    });
  return res;
}

/** Uživatelé spravovaní zdrojem (pro náhled). */
export async function managedUsers(db: Db, sourceId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.directorySourceId, sourceId), eq(users.isActive, true)));
  return r?.n ?? 0;
}
