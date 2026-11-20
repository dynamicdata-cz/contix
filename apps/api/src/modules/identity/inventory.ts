import { DEFAULT_IDENTITY_POLICY, type IdentityInventory } from "@contix/shared";
import { and, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/client";
import { identityAccounts, identityComputers, identityGroups, identitySources } from "../../db/schema";

/* ============================================================
 * Inventář adresáře (v1.91, ADR-186): kolik účtů, počítačů a skupin je aktivních.
 * Aktivní = povolený a přihlášený v limitu ze zásad zdroje (účty staleDays, hosté guestStaleDays,
 * počítače computerStaleDays). Entra ID bez údaje o přihlášení (chybí licence) = „neznámá“, ne „nikdy“.
 * ============================================================ */

const days = (key: string, def: number) => sql`make_interval(days => coalesce((${identitySources.policy}->>${key})::int, ${def}))`;
const accLimit = sql`(now() - case when ${identityAccounts.kind} = 'guest' then ${days("guestStaleDays", DEFAULT_IDENTITY_POLICY.guestStaleDays)} else ${days("staleDays", DEFAULT_IDENTITY_POLICY.staleDays)} end)`;
const pcLimit = sql`(now() - ${days("computerStaleDays", DEFAULT_IDENTITY_POLICY.computerStaleDays ?? 90)})`;

/** Podmínka aktivity účtu (dotaz musí mít připojené `identity_sources`). */
export function accountActivity(a: "active" | "inactive" | "never" | "unknown"): SQL {
  const en = sql`${identityAccounts.enabled}`;
  switch (a) {
    case "active":
      return sql`(${en} and ${identityAccounts.lastLogonAt} >= ${accLimit})`;
    case "inactive":
      return sql`(${en} and ${identityAccounts.lastLogonAt} < ${accLimit})`;
    case "never":
      return sql`(${en} and ${identityAccounts.lastLogonAt} is null and ${identitySources.kind} = 'ad')`;
    case "unknown":
      return sql`(${en} and ${identityAccounts.lastLogonAt} is null and ${identitySources.kind} <> 'ad')`;
  }
}
/** Aktivní počítač (dotaz musí mít připojené `identity_sources`). */
export const computerActive = sql`(${identityComputers.enabled} and ${identityComputers.lastLogonAt} >= ${pcLimit})`;

const n = (cond: SQL) => sql<number>`count(*) filter (where ${cond})`.mapWith(Number);

/** `accScope` / `pcScope` / `grpScope` – podmínky rozsahu společností (a zdroje) pro jednotlivé tabulky. */
export async function identityInventory(db: Db, scope: { accounts?: SQL; computers?: SQL; groups?: SQL }): Promise<IdentityInventory> {
  const [[a], [p], [g]] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        enabled: n(sql`${identityAccounts.enabled}`),
        active: n(accountActivity("active")),
        inactive: n(accountActivity("inactive")),
        never: n(accountActivity("never")),
        unknown: n(accountActivity("unknown")),
        disabled: n(sql`not ${identityAccounts.enabled}`),
        privileged: n(sql`${identityAccounts.enabled} and ${identityAccounts.privileged}`),
        privilegedActive: n(sql`${identityAccounts.privileged} and ${accountActivity("active")}`),
        user: n(sql`${identityAccounts.enabled} and ${identityAccounts.kind} = 'user'`),
        service: n(sql`${identityAccounts.enabled} and ${identityAccounts.kind} = 'service'`),
        guest: n(sql`${identityAccounts.enabled} and ${identityAccounts.kind} = 'guest'`),
      })
      .from(identityAccounts)
      .innerJoin(identitySources, sql`${identitySources.id} = ${identityAccounts.sourceId}`)
      .where(and(isNull(identityAccounts.removedAt), scope.accounts)),
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        enabled: n(sql`${identityComputers.enabled}`),
        active: n(computerActive),
        inactive: n(sql`${identityComputers.enabled} and not coalesce(${identityComputers.lastLogonAt} >= ${pcLimit}, false)`),
        disabled: n(sql`not ${identityComputers.enabled}`),
        dc: n(sql`${identityComputers.enabled} and ${identityComputers.role} = 'dc'`),
        server: n(sql`${identityComputers.enabled} and ${identityComputers.role} = 'server'`),
        workstation: n(sql`${identityComputers.enabled} and ${identityComputers.role} = 'workstation'`),
        other: n(sql`${identityComputers.enabled} and ${identityComputers.role} = 'other'`),
        serversActive: n(sql`${identityComputers.role} in ('server', 'dc') and ${computerActive}`),
        workstationsActive: n(sql`${identityComputers.role} = 'workstation' and ${computerActive}`),
      })
      .from(identityComputers)
      .innerJoin(identitySources, sql`${identitySources.id} = ${identityComputers.sourceId}`)
      .where(and(isNull(identityComputers.removedAt), scope.computers)),
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        privileged: n(sql`${identityGroups.privileged}`),
      })
      .from(identityGroups)
      .where(and(isNull(identityGroups.removedAt), scope.groups)),
  ]);
  return {
    accounts: a!,
    computers: p?.total ? p : null,
    groups: g ?? { total: 0, privileged: 0 },
  };
}
