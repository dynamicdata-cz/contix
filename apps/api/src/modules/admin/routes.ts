import {
  validateModules, validateBounds,
  GroupInput,
  GroupPatch,
  PASSWORD_MIN,
  RoleInput,
  RolePatch,
  SettingsPatch,
  UserCreate,
  UserUpdate,
  type GroupDto,
  type RoleDto,
  ROOT_COMPANY_ID,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Config } from "../../config";
import type { Db, DbOrTx, Tx } from "../../db/client";
import { companySettings, getCompanies, invalidateCompanies } from "../../auth/scope";
import {
  auditLog,
  groupMembers,
  groupRoles,
  groups,
  mfaRecoveryCodes,
  roles,
  sessions,
  userRoles,
  users,
  companies,
} from "../../db/schema";
import { currentUser, requirePerm } from "../../auth/middleware";
import { configuredProviders, redirectUri } from "../../auth/oidc";
import { switchRiskMethodology } from "../companies/routes";
import { recomputeHealth } from "../vulnerabilities/service";
import {
  audit,
  countActiveAdmins,
  getSettings,
  hashPassword,
  setManualRoles,
  setUserGroups,
  toUserDtos,
  updateSettings,
  type AppEnv,
} from "../../auth/service";
import { ApiError } from "../../lib/apiError";

const pgUnique = (e: unknown) => (e as any)?.cause?.code === "23505" || (e as any)?.code === "23505";

export function adminRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;

  /** Nesmí zůstat systém bez aktivního administrátora. */
  async function guardLastAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const r = await fn(tx);
      if ((await countActiveAdmins(tx)) === 0)
        throw new HTTPException(409, { message: "Operace by odebrala posledního aktivního administrátora." });
      return r;
    });
  }

  const loadRole = async (id: string) => {
    const [r] = await db.select().from(roles).where(eq(roles.id, id));
    if (!r) throw new HTTPException(404, { message: "Role nenalezena" });
    return r;
  };

  async function assertCompanies(ids: string[], assignments?: { companyId: string }[]) {
    const all = await getCompanies(db);
    for (const id of [...ids, ...(assignments ?? []).map((a) => a.companyId)])
      if (!all.some((x) => x.id === id)) throw new HTTPException(400, { message: "Neznámá společnost" });
  }

  async function setGroupRoles(tx: DbOrTx, groupId: string, roleIds: string[], assignments?: { roleId: string; companyId: string }[]) {
    await tx.delete(groupRoles).where(eq(groupRoles.groupId, groupId));
    const list = assignments ?? roleIds.map((roleId) => ({ roleId, companyId: ROOT_COMPANY_ID }));
    const uniq = [...new Map(list.map((a) => [`${a.roleId}:${a.companyId}`, a])).values()];
    if (uniq.length) await tx.insert(groupRoles).values(uniq.map((a) => ({ groupId, ...a })));
  }

  async function groupDto(id: string): Promise<GroupDto> {
    const [g] = await db.select().from(groups).where(eq(groups.id, id));
    if (!g) throw new HTTPException(404, { message: "Skupina nenalezena" });
    const [gr, gm] = await Promise.all([
      db.select().from(groupRoles).where(eq(groupRoles.groupId, id)),
      db.select().from(groupMembers).where(eq(groupMembers.groupId, id)),
    ]);
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      roleIds: [...new Set(gr.filter((x) => x.companyId === ROOT_COMPANY_ID).map((x) => x.roleId))],
      roleAssignments: gr.map((x) => ({ roleId: x.roleId, companyId: x.companyId })),
      memberIds: gm.map((x) => x.userId),
    };
  }

  return (
    new Hono<AppEnv>()
      /* ==================== Uživatelé ==================== */
      .get("/users", requirePerm("admin:users"), async (c) => {
        const q = c.req.query("q");
        const cond = q ? or(ilike(users.email, `%${q}%`), ilike(users.displayName, `%${q}%`)) : undefined;
        const rows = await db.select().from(users).where(cond).orderBy(asc(users.displayName)).limit(500);
        return c.json(await toUserDtos(db, rows));
      })

      .post("/users", requirePerm("admin:users"), zValidator("json", UserCreate), async (c) => {
        const input = c.req.valid("json");
        if (input.authProvider === "local" && !input.password)
          throw new ApiError(400, "err.admin.tempPassword", { min: String(PASSWORD_MIN) });
        if ((input.roleIds.length || input.roleAssignments?.length) && !c.get("auth")!.permissions.has("admin:roles"))
          throw new HTTPException(403, { message: "Přidělovat role smí jen správce rolí" });
        await assertCompanies(input.companyId ? [input.companyId] : [], input.roleAssignments);
        try {
          const created = await db.transaction(async (tx) => {
            const [u] = await tx
              .insert(users)
              .values({
                email: input.email,
                displayName: input.displayName,
                jobTitle: input.jobTitle ?? null,
                authProvider: input.authProvider,
                passwordHash: input.password ? await hashPassword(input.password) : null,
                mustChangePassword: !!input.password,
                ...(input.companyId ? { companyId: input.companyId } : {}),
              })
              .returning();
            await setManualRoles(tx, u!.id, input.roleIds, input.roleAssignments);
            if (input.groupIds.length) await tx.insert(groupMembers).values(input.groupIds.map((groupId) => ({ groupId, userId: u!.id })));
            return u!;
          });
          await audit(db, { c, user: currentUser(c), action: "user.created", entityType: "user", entityId: created.id, details: { email: created.email, roleIds: input.roleIds } });
          return c.json((await toUserDtos(db, [created]))[0], 201);
        } catch (e) {
          if (pgUnique(e)) throw new HTTPException(409, { message: "Uživatel s tímto e-mailem již existuje" });
          throw e;
        }
      })

      .get("/users/:id", requirePerm("admin:users"), async (c) => {
        const [u] = await db.select().from(users).where(eq(users.id, c.req.param("id")));
        if (!u) throw new HTTPException(404, { message: "Uživatel nenalezen" });
        return c.json((await toUserDtos(db, [u]))[0]);
      })

      .patch("/users/:id", requirePerm("admin:users"), zValidator("json", UserUpdate), async (c) => {
        const id = c.req.param("id");
        const input = c.req.valid("json");
        const me = currentUser(c);
        if (id === me.id && input.isActive === false) throw new HTTPException(400, { message: "Nemůžete deaktivovat sami sebe" });
        if (id === me.id && input.authProvider && input.authProvider !== me.authProvider) throw new HTTPException(400, { message: "Způsob přihlášení vlastního účtu nelze změnit" });
        if ((input.roleIds || input.roleAssignments) && !c.get("auth")!.permissions.has("admin:roles"))
          throw new HTTPException(403, { message: "Přidělovat role smí jen správce rolí" });
        await assertCompanies(input.companyId ? [input.companyId] : [], input.roleAssignments);

        const updated = await guardLastAdmin(async (tx) => {
          const fields = Object.fromEntries(
            Object.entries({
              displayName: input.displayName,
              jobTitle: input.jobTitle,
              isActive: input.isActive,
              companyId: input.companyId,
              authProvider: input.authProvider,
              // firemní účet (AD / SSO) nemá heslo CONTIXu (ADR-078)
              ...(input.authProvider && input.authProvider !== "local" ? { passwordHash: null, mustChangePassword: false } : {}),
            }).filter(
              ([, v]) => v !== undefined,
            ),
          );
          const [u] = Object.keys(fields).length
            ? await tx.update(users).set(fields).where(eq(users.id, id)).returning()
            : await tx.select().from(users).where(eq(users.id, id));
          if (!u) throw new HTTPException(404, { message: "Uživatel nenalezen" });
          if (input.roleIds || input.roleAssignments) await setManualRoles(tx, id, input.roleIds ?? [], input.roleAssignments);
          if (input.groupIds) await setUserGroups(tx, id, input.groupIds);
          if (input.isActive === false || (input.authProvider && input.authProvider !== "local")) await tx.delete(sessions).where(eq(sessions.userId, id));
          return u;
        });
        await audit(db, { c, user: me, action: "user.updated", entityType: "user", entityId: id, details: input });
        return c.json((await toUserDtos(db, [updated]))[0]);
      })

      .post(
        "/users/:id/reset-password",
        requirePerm("admin:users"),
        zValidator("json", z.object({ password: z.string().min(PASSWORD_MIN).max(200) })),
        async (c) => {
          const id = c.req.param("id");
          const [u] = await db
            .update(users)
            .set({ passwordHash: await hashPassword(c.req.valid("json").password), mustChangePassword: true, failedLogins: 0, lockedUntil: null })
            .where(and(eq(users.id, id), eq(users.authProvider, "local")))
            .returning({ id: users.id });
          if (!u) throw new HTTPException(404, { message: "Lokální uživatel nenalezen" });
          await db.delete(sessions).where(eq(sessions.userId, id));
          await audit(db, { c, user: currentUser(c), action: "user.password_reset", entityType: "user", entityId: id });
          return c.json({ ok: true });
        },
      )

      .post("/users/:id/reset-mfa", requirePerm("admin:users"), async (c) => {
        const id = c.req.param("id");
        await db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null }).where(eq(users.id, id));
        await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, id));
        await db.delete(sessions).where(eq(sessions.userId, id));
        await audit(db, { c, user: currentUser(c), action: "user.mfa_reset", entityType: "user", entityId: id });
        return c.json({ ok: true });
      })

      .post("/users/:id/unlock", requirePerm("admin:users"), async (c) => {
        const id = c.req.param("id");
        await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, id));
        await audit(db, { c, user: currentUser(c), action: "user.unlocked", entityType: "user", entityId: id });
        return c.json({ ok: true });
      })

      /* ==================== Role ==================== */
      .get("/roles", requirePerm("admin:roles", "admin:users"), async (c) => {
        const rows = await db
          .select({
            id: roles.id,
            key: roles.key,
            name: roles.name,
            description: roles.description,
            permissions: roles.permissions,
            externalGroups: roles.externalGroups,
            isSystem: roles.isSystem,
            userCount: sql<number>`(select count(distinct ${userRoles.userId})::int from ${userRoles} where ${userRoles.roleId} = ${roles.id})`,
          })
          .from(roles)
          .orderBy(desc(roles.isSystem), asc(roles.name));
        return c.json(rows as RoleDto[]);
      })

      .post("/roles", requirePerm("admin:roles"), zValidator("json", RoleInput), async (c) => {
        const input = c.req.valid("json");
        try {
          const [r] = await db.insert(roles).values({ ...input, isSystem: false }).returning();
          await audit(db, { c, user: currentUser(c), action: "role.created", entityType: "role", entityId: r!.id, details: input });
          return c.json(r, 201);
        } catch (e) {
          if (pgUnique(e)) throw new HTTPException(409, { message: "Role s tímto klíčem již existuje" });
          throw e;
        }
      })

      .patch("/roles/:id", requirePerm("admin:roles"), zValidator("json", RolePatch), async (c) => {
        const role = await loadRole(c.req.param("id"));
        const input = c.req.valid("json");
        if (role.key === "admin" && input.permissions) throw new HTTPException(400, { message: "Role Administrátor má vždy všechna oprávnění" });
        if (!Object.keys(input).length) return c.json(role);
        const [r] = await db.update(roles).set(input).where(eq(roles.id, role.id)).returning();
        await audit(db, { c, user: currentUser(c), action: "role.updated", entityType: "role", entityId: role.id, details: input });
        return c.json(r);
      })

      .delete("/roles/:id", requirePerm("admin:roles"), async (c) => {
        const role = await loadRole(c.req.param("id"));
        if (role.isSystem) throw new HTTPException(400, { message: "Systémovou roli nelze smazat" });
        await db.delete(roles).where(eq(roles.id, role.id));
        await audit(db, { c, user: currentUser(c), action: "role.deleted", entityType: "role", entityId: role.id, details: { key: role.key } });
        return c.body(null, 204);
      })

      /* ==================== Skupiny ==================== */
      .get("/groups", requirePerm("admin:users"), async (c) => {
        const rows = await db.select({ id: groups.id }).from(groups).orderBy(asc(groups.name));
        return c.json(await Promise.all(rows.map((r) => groupDto(r.id))));
      })

      .post("/groups", requirePerm("admin:users"), zValidator("json", GroupInput), async (c) => {
        const input = c.req.valid("json");
        if ((input.roleIds.length || input.roleAssignments?.length) && !c.get("auth")!.permissions.has("admin:roles"))
          throw new HTTPException(403, { message: "Přidělovat role smí jen správce rolí" });
        await assertCompanies([], input.roleAssignments);
        try {
          const [g] = await db.insert(groups).values({ name: input.name, description: input.description ?? null }).returning();
          await setGroupRoles(db, g!.id, input.roleIds, input.roleAssignments);
          if (input.memberIds.length) await db.insert(groupMembers).values(input.memberIds.map((userId) => ({ groupId: g!.id, userId })));
          await audit(db, { c, user: currentUser(c), action: "group.created", entityType: "group", entityId: g!.id, details: input });
          return c.json(await groupDto(g!.id), 201);
        } catch (e) {
          if (pgUnique(e)) throw new HTTPException(409, { message: "Skupina s tímto názvem již existuje" });
          throw e;
        }
      })

      .patch("/groups/:id", requirePerm("admin:users"), zValidator("json", GroupPatch), async (c) => {
        const id = c.req.param("id");
        const input = c.req.valid("json");
        if ((input.roleIds || input.roleAssignments) && !c.get("auth")!.permissions.has("admin:roles"))
          throw new HTTPException(403, { message: "Přidělovat role smí jen správce rolí" });
        await assertCompanies([], input.roleAssignments);
        await groupDto(id);
        await guardLastAdmin(async (tx) => {
          const fields = Object.fromEntries(
            Object.entries({ name: input.name, description: input.description }).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(fields).length) await tx.update(groups).set(fields).where(eq(groups.id, id));
          if (input.roleIds || input.roleAssignments) await setGroupRoles(tx, id, input.roleIds ?? [], input.roleAssignments);
          if (input.memberIds) {
            await tx.delete(groupMembers).where(eq(groupMembers.groupId, id));
            if (input.memberIds.length) await tx.insert(groupMembers).values(input.memberIds.map((userId) => ({ groupId: id, userId })));
          }
        });
        await audit(db, { c, user: currentUser(c), action: "group.updated", entityType: "group", entityId: id, details: input });
        return c.json(await groupDto(id));
      })

      .delete("/groups/:id", requirePerm("admin:users"), async (c) => {
        const id = c.req.param("id");
        await guardLastAdmin((tx) => tx.delete(groups).where(eq(groups.id, id)));
        await audit(db, { c, user: currentUser(c), action: "group.deleted", entityType: "group", entityId: id });
        return c.body(null, 204);
      })

      /* ==================== Nastavení ==================== */
      .get("/settings", requirePerm("admin:settings"), async (c) => {
        return c.json({
          settings: companySettings(await getSettings(db), await getCompanies(db), ROOT_COMPANY_ID),
          identityProviders: configuredProviders(config).map((p) => ({
            id: p.id,
            label: p.label,
            issuer: p.issuer,
            redirectUri: redirectUri(config, p.id),
          })),
          appUrl: config.APP_URL,
        });
      })

      .patch("/settings", requirePerm("admin:settings"), zValidator("json", SettingsPatch), async (c) => {
        const patch = c.req.valid("json");
        const a = c.get("auth")!;
        if (patch.enabledModules) {
          const err = validateModules(patch.enabledModules);
          if (err) throw new HTTPException(400, { message: err });
        }
        if (patch.riskPolicy) {
          const err = validateBounds(patch.riskPolicy);
          if (err) throw new HTTPException(400, { message: err });
        }
        if (patch.mfaRequired && !a.user.mfaEnabled && !a.session.viaIdp)
          throw new HTTPException(400, { message: "Než MFA vynutíte pro všechny, nastavte si ho nejdřív pro svůj účet (Můj profil)." });
        const { organizationName, organizationIco, organizationAddress, regulatedServices, regime, pack, primaryFramework, doraEntity, ...rest } = patch;
        // identita, režim a regulatorní profil patří kořenové společnosti (ostatní společnosti se spravují v Administraci → Společnosti)
        const identity = Object.fromEntries(
          Object.entries({ name: organizationName, ico: organizationIco, address: organizationAddress, regulatedServices, regime, pack, primaryFramework, doraEntity, ...(pack === "generic" ? { regime: "none" } : {}) }).filter(
            ([, v]) => v !== undefined,
          ),
        );
        if (Object.keys(identity).length) {
          const prevPack = (await getCompanies(db)).find((x) => x.id === ROOT_COMPANY_ID)?.pack ?? "cz";
          await db.update(companies).set({ ...identity, updatedAt: new Date() }).where(eq(companies.id, ROOT_COMPANY_ID));
          invalidateCompanies();
          if (pack && pack !== prevPack && !rest.riskPolicy) await switchRiskMethodology(db, prevPack, pack);
        }
        await updateSettings(db, rest);
        const s = companySettings(await getSettings(db), await getCompanies(db), ROOT_COMPANY_ID);
        if (patch.healthPolicy) await recomputeHealth(db);
        await audit(db, { c, user: currentUser(c), action: "settings.updated", details: patch });
        return c.json(s);
      })

      /* ==================== Audit log ==================== */
      .get("/audit-log", requirePerm("audit_log:read"), async (c) => {
        const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
        const offset = Number(c.req.query("offset") ?? 0);
        const q = c.req.query("q");
        const conds: SQL[] = [];
        if (q) conds.push(or(ilike(auditLog.action, `%${q}%`), ilike(auditLog.userEmail, `%${q}%`))!);
        const rows = await db
          .select()
          .from(auditLog)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(auditLog.at))
          .limit(limit)
          .offset(offset);
        return c.json(rows);
      })
  );
}

/** Adresář uživatelů pro výběr vlastníka aktiva apod. (bez citlivých údajů). */
export function directoryRoutes(db: Db) {
  return new Hono<AppEnv>().get("/users", requirePerm("assets:read"), async (c) => {
    const rows = await db
      .select({ id: users.id, displayName: users.displayName, email: users.email, jobTitle: users.jobTitle })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(asc(users.displayName));
    return c.json(rows);
  });
}
