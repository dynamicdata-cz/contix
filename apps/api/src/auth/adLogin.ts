import { AdLoginConfig, AdSourceConfig, DEFAULT_AD_LOGIN, groupsMatch, type AdLoginFailure } from "@contix/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { identitySources, roles, userRoles, users, type UserRow } from "../db/schema";
import { authenticateAd, type AdAuthenticator, type AdIdentity } from "../modules/identity/ad";
import { sourceSecret } from "../modules/identity/service";

/* ============================================================
 * Přihlášení účty AD (ADR-078).
 *  - zdroj = připojení AD z Identit s `login.enabled`
 *  - lokální účet s heslem se nikdy nepropojuje (přihlašuje se dál heslem CONTIXu)
 *  - role ze skupin AD (roles.external_groups) se synchronizují při každém přihlášení (source = idp)
 * ============================================================ */

type SourceRow = typeof identitySources.$inferSelect;

export const loginOf = (row: Pick<SourceRow, "login">): AdLoginConfig => AdLoginConfig.parse(row.login ?? DEFAULT_AD_LOGIN);

export async function adLoginSources(db: Db): Promise<SourceRow[]> {
  const rows = await db.select().from(identitySources).where(and(eq(identitySources.kind, "ad"), eq(identitySources.enabled, true)));
  return rows.filter((r) => loginOf(r).enabled && r.secretEnc);
}

/** Role CONTIXu podle skupin (CN nebo DN). */
export async function rolesForGroups(db: Db, groups: string[]): Promise<{ id: string; key: string; name: string }[]> {
  const all = await db.select({ id: roles.id, key: roles.key, name: roles.name, ext: roles.externalGroups }).from(roles);
  return all.filter((r) => groupsMatch(groups, r.ext)).map(({ id, key, name }) => ({ id, key, name }));
}

/** Role ze skupin IdP / AD – nahradí předchozí (source = idp). */
export async function syncIdpRoles(db: Db, userId: string, roleIds: string[]) {
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.source, "idp")));
  if (roleIds.length) await db.insert(userRoles).values(roleIds.map((roleId) => ({ userId, roleId, source: "idp" as const }))).onConflictDoNothing();
}

export interface AdLoginDecision {
  ok: boolean;
  reason: AdLoginFailure | null;
  message?: string;
  identity: AdIdentity | null;
  source: SourceRow | null;
  user: UserRow | null;
  /** Role ze skupin. */
  groupRoles: { id: string; key: string; name: string }[];
  defaultRoleId: string | null;
  defaultRoleName: string | null;
}

const emailOf = (id: AdIdentity, cfg: AdLoginConfig) => id.email ?? id.upn ?? (cfg.upnSuffix ? `${id.login.toLowerCase()}@${cfg.upnSuffix}` : null);

/** Ověří účet v AD a rozhodne, zda a jako kdo se může přihlásit (nic nezapisuje). */
export async function decideAdLogin(
  db: Db,
  config: Config,
  login: string,
  password: string,
  opts: { auth?: AdAuthenticator; sources?: SourceRow[] } = {},
): Promise<AdLoginDecision> {
  const auth = opts.auth ?? authenticateAd;
  const sources = opts.sources ?? (await adLoginSources(db));
  const empty: AdLoginDecision = { ok: false, reason: "not_found", identity: null, source: null, user: null, groupRoles: [], defaultRoleId: null, defaultRoleName: null };
  if (!password) return { ...empty, reason: "bad_password" };
  let last: AdLoginDecision = empty;
  for (const source of sources) {
    const secret = sourceSecret(source, config);
    if (!secret) continue;
    const r = await auth({ config: AdSourceConfig.parse(source.config), password: secret }, login, password);
    if (!r.ok) {
      last = { ...empty, reason: r.reason, message: r.message, source };
      if (r.reason === "not_found") continue; // zkusit další doménu
      return last;
    }
    const id = r.identity;
    const cfg = loginOf(source);
    const base = { ...empty, identity: id, source };
    if (cfg.allowedGroups.length && !groupsMatch(id.groups, cfg.allowedGroups)) return { ...base, reason: "not_allowed" };
    const groupRoles = await rolesForGroups(db, id.groups);
    const [def] = cfg.defaultRoleKey ? await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.key, cfg.defaultRoleKey)) : [];
    const decision = { ...base, groupRoles, defaultRoleId: def?.id ?? null, defaultRoleName: def?.name ?? null };

    const externalId = `ad:${id.guid}`;
    let [user] = await db.select().from(users).where(eq(users.externalId, externalId));
    const email = emailOf(id, cfg);
    if (!user && email) {
      const [byEmail] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
      // lokální účet s heslem CONTIXu se nepropojuje (převzetí účtu změnou atributu mail v AD)
      if (byEmail?.passwordHash) return { ...decision, reason: "local_account" };
      user = byEmail;
    }
    if (user) {
      if (!user.isActive) return { ...decision, user, reason: "inactive" };
      return { ...decision, ok: true, reason: null, user };
    }
    if (!cfg.autoProvision) return { ...decision, reason: "not_provisioned" };
    if (!email) return { ...decision, reason: "no_email" };
    if (!groupRoles.length && !def) return { ...decision, reason: "no_role" };
    return { ...decision, ok: true, reason: null };
  }
  return last;
}

/** Provede rozhodnutí: založí / propojí uživatele a nastaví role ze skupin. */
export async function applyAdLogin(db: Db, d: AdLoginDecision): Promise<{ user: UserRow; created: boolean; linked: boolean }> {
  const id = d.identity!;
  const source = d.source!;
  const cfg = loginOf(source);
  const externalId = `ad:${id.guid}`;
  let created = false;
  let linked = false;
  let user: UserRow | null | undefined = d.user;
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: emailOf(id, cfg)!, displayName: id.displayName, authProvider: "ad", externalId, companyId: source.companyId })
      .returning();
    if (d.defaultRoleId) await db.insert(userRoles).values({ userId: user!.id, roleId: d.defaultRoleId, source: "manual", companyId: source.companyId }).onConflictDoNothing();
    created = true;
  } else if (user.externalId !== externalId) {
    [user] = await db.update(users).set({ externalId, authProvider: "ad" }).where(eq(users.id, user.id)).returning();
    linked = true;
  }
  await syncIdpRoles(db, user!.id, d.groupRoles.map((r) => r.id));
  [user] = await db.update(users).set({ lastLoginAt: new Date(), displayName: id.displayName || user!.displayName, failedLogins: 0 }).where(eq(users.id, user!.id)).returning();
  return { user: user!, created, linked };
}
