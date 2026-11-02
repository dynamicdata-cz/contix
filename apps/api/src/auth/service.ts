import {
  MODULE_UPGRADES,
  PERMISSION_UPGRADES,
  PERMISSION_KEYS,
  ROOT_COMPANY_ID,
  SettingsSchema,
  SYSTEM_ROLES,
  type Permission,
  type Settings,
  type UserDto,
} from "@contix/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Context } from "hono";
import type { Db, DbOrTx } from "../db/client";
import {
  appSettings,
  auditLog,
  companies,
  groupMembers,
  groupRoles,
  roles,
  userRoles,
  users,
  type SessionRow,
  type UserRow,
} from "../db/schema";
import { randomToken } from "./crypto";

export interface AuthState {
  user: UserRow;
  session: SessionRow;
  /** Oprávnění v rozsahu požadavku (aktivní společnost nebo souhrnný pohled). */
  permissions: Set<Permission>;
  scope: import("./scope").Scope;
}

export type AppEnv = { Variables: { auth: AuthState | null } };

/* ---------------- Nastavení ---------------- */

let settingsCache: { at: number; value: Settings } | null = null;

export async function getSettings(db: Db): Promise<Settings> {
  if (settingsCache && Date.now() - settingsCache.at < 5_000) return settingsCache.value;
  const rows = await db.select().from(appSettings);
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const value = SettingsSchema.parse(raw);
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(db: Db, patch: Partial<Settings>): Promise<Settings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // null = výchozí hodnota (např. sledované rámce „automaticky“) – záznam se odstraní
    if (value === null) {
      await db.delete(appSettings).where(eq(appSettings.key, key));
      continue;
    }
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
  settingsCache = null;
  return getSettings(db);
}

/* ---------------- Audit ---------------- */

export function clientIp(c?: Context): string | null {
  if (!c) return null;
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null;
}

export async function audit(
  db: Db,
  e: {
    c?: Context;
    user?: Pick<UserRow, "id" | "email"> | null;
    email?: string;
    action: string;
    entityType?: string;
    entityId?: string;
    details?: Record<string, unknown>;
  },
) {
  await db.insert(auditLog).values({
    userId: e.user?.id ?? null,
    userEmail: e.user?.email ?? e.email ?? null,
    action: e.action,
    entityType: e.entityType ?? null,
    entityId: e.entityId ?? null,
    details: e.details ?? {},
    ip: clientIp(e.c),
  });
}

/* ---------------- Role a oprávnění ---------------- */

/** Efektivní oprávnění = role přímo přidělené (ručně i z IdP) ∪ role skupin, jejichž je členem. */
export async function loadPermissions(db: Db, userId: string): Promise<Set<Permission>> {
  const rows = await db.execute<{ permissions: string[] }>(sql`
    select r.permissions from ${roles} r
    where r.id in (
      select ${userRoles.roleId} from ${userRoles} where ${userRoles.userId} = ${userId}
      union
      select gr.role_id from ${groupRoles} gr join ${groupMembers} gm on gm.group_id = gr.group_id
      where gm.user_id = ${userId}
    )`);
  const set = new Set<Permission>();
  for (const r of rows) for (const p of r.permissions) if ((PERMISSION_KEYS as string[]).includes(p)) set.add(p as Permission);
  return set;
}

/** Doplní systémovým rolím oprávnění přidaná v nových verzích (jen jednou, dle jejich výchozí sady). */
async function applyPermissionUpgrades(db: Db) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "perm.upgrades"));
  const applied = new Set((row?.value as string[] | undefined) ?? []);
  let changed = false;
  for (const up of PERMISSION_UPGRADES) {
    if (applied.has(up.version)) continue;
    for (const def of SYSTEM_ROLES) {
      const add = def.permissions.filter((p) => up.permissions.includes(p));
      if (!add.length) continue;
      const [r] = await db.select().from(roles).where(eq(roles.key, def.key));
      if (!r) continue;
      await db
        .update(roles)
        .set({ permissions: [...new Set([...r.permissions, ...add])] })
        .where(eq(roles.id, r.id));
    }
    applied.add(up.version);
    changed = true;
  }
  if (changed)
    await db
      .insert(appSettings)
      .values({ key: "perm.upgrades", value: [...applied] })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: [...applied], updatedAt: new Date() } });
}

export async function ensureSystemRoles(db: Db) {
  for (const r of SYSTEM_ROLES) {
    await db
      .insert(roles)
      .values({ key: r.key, name: r.name, description: r.description, permissions: r.permissions, isSystem: true })
      .onConflictDoNothing({ target: roles.key });
  }
  // Admin má vždy všechna oprávnění (i nově přidaná v dalších verzích).
  await db.update(roles).set({ permissions: [...PERMISSION_KEYS] }).where(eq(roles.key, "admin"));
  await applyPermissionUpgrades(db);
  await applyModuleUpgrades(db);
}

/** Moduly přidané v nové verzi se u existující instalace (s uloženým výběrem modulů) jednorázově zapnou. */
async function applyModuleUpgrades(db: Db) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "modules.upgrades"));
  const applied = new Set((row?.value as string[] | undefined) ?? []);
  const pending = MODULE_UPGRADES.filter((u) => !applied.has(u.version));
  if (!pending.length) return;
  const [stored] = await db.select().from(appSettings).where(eq(appSettings.key, "enabledModules"));
  if (stored && Array.isArray(stored.value)) {
    const next = [...new Set([...(stored.value as string[]), ...pending.flatMap((u) => u.modules)])];
    await updateSettings(db, { enabledModules: next });
  }
  for (const u of pending) applied.add(u.version);
  await db
    .insert(appSettings)
    .values({ key: "modules.upgrades", value: [...applied] })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: [...applied], updatedAt: new Date() } });
}

export async function roleIdByKey(db: Db, key: string): Promise<string | null> {
  const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
  return r?.id ?? null;
}

export async function countActiveAdmins(db: DbOrTx): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select count(distinct u.id)::int as n from ${users} u
    where u.is_active and (
      exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = u.id and r.key = 'admin' and ur.company_id = ${ROOT_COMPANY_ID})
      or exists (select 1 from ${groupMembers} gm join ${groupRoles} gr on gr.group_id = gm.group_id
                 join ${roles} r on r.id = gr.role_id where gm.user_id = u.id and r.key = 'admin' and gr.company_id = ${ROOT_COMPANY_ID})
    )`);
  return row?.n ?? 0;
}

/* ---------------- Uživatelé ---------------- */

export async function toUserDtos(db: Db, rows: UserRow[]): Promise<UserDto[]> {
  if (!rows.length) return [];
  const ids = rows.map((u) => u.id);
  const [ur, gm, cos] = await Promise.all([
    db
      .select({ userId: userRoles.userId, id: roles.id, key: roles.key, name: roles.name, source: userRoles.source, companyId: userRoles.companyId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(inArray(userRoles.userId, ids)),
    db.select().from(groupMembers).where(inArray(groupMembers.userId, ids)),
    db.select({ id: companies.id, name: companies.name }).from(companies),
  ]);
  const coName = (id: string) => cos.find((x) => x.id === id)?.name ?? "";
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    jobTitle: u.jobTitle,
    authProvider: u.authProvider,
    isActive: u.isActive,
    mfaEnabled: u.mfaEnabled,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    lockedUntil: u.lockedUntil?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    locale: u.locale ?? null,
    roles: ur.filter((r) => r.userId === u.id).map(({ id, key, name, source, companyId }) => ({ id, key, name, source, companyId, companyName: coName(companyId) })),
    groupIds: gm.filter((g) => g.userId === u.id).map((g) => g.groupId),
    companyId: u.companyId,
    companyName: coName(u.companyId),
  }));
}

/** Ruční role: `roleIds` = pro celou skupinu (kořen), `assignments` = role ke konkrétní společnosti. */
export async function setManualRoles(db: DbOrTx, userId: string, roleIds: string[], assignments?: { roleId: string; companyId: string }[]) {
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.source, "manual")));
  const list = assignments ?? roleIds.map((roleId) => ({ roleId, companyId: ROOT_COMPANY_ID }));
  const uniq = [...new Map(list.map((a) => [`${a.roleId}:${a.companyId}`, a])).values()];
  if (uniq.length) await db.insert(userRoles).values(uniq.map((a) => ({ userId, roleId: a.roleId, companyId: a.companyId, source: "manual" as const })));
}

export async function setUserGroups(db: DbOrTx, userId: string, groupIds: string[]) {
  await db.delete(groupMembers).where(eq(groupMembers.userId, userId));
  if (groupIds.length) await db.insert(groupMembers).values(groupIds.map((groupId) => ({ groupId, userId })));
}

export const hashPassword = (pw: string) => Bun.password.hash(pw, { algorithm: "argon2id" });
export const generateTempPassword = () => `${randomToken(12)}Aa1!`;

/** Vytvoří lokálního administrátora (pokud e-mail ještě neexistuje). Vrací heslo, pokud bylo vygenerováno. */
export async function createAdmin(db: Db, email: string, displayName: string, password?: string) {
  await ensureSystemRoles(db);
  const pw = password ?? generateTempPassword();
  const [u] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      displayName,
      authProvider: "local",
      passwordHash: await hashPassword(pw),
      mustChangePassword: !password,
    })
    .onConflictDoNothing()
    .returning();
  if (!u) return null;
  const adminId = await roleIdByKey(db, "admin");
  await db.insert(userRoles).values({ userId: u.id, roleId: adminId!, source: "manual" });
  return { user: u, generatedPassword: password ? null : pw };
}

export async function userCount(db: Db) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return r?.n ?? 0;
}
