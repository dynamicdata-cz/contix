import type { ModuleKey, Permission } from "@contix/shared";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { cookieSecure, type Config } from "../config";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { randomToken, sha256 } from "./crypto";
import { requestedCompany, resolveScope } from "./scope";
import { getSettings, type AppEnv, type AuthState } from "./service";

export const SESSION_COOKIE = "contix_session";

export async function createSession(
  c: Context,
  deps: { db: Db; config: Config },
  userId: string,
  opts: { mfaVerified: boolean; viaIdp?: boolean },
) {
  const settings = await getSettings(deps.db);
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + settings.sessionMaxHours * 3600_000);
  await deps.db.insert(sessions).values({
    id: sha256(token),
    userId,
    mfaVerified: opts.mfaVerified,
    viaIdp: opts.viaIdp ?? false,
    ip: c.req.header("x-forwarded-for")?.split(",")[0] ?? null,
    userAgent: c.req.header("user-agent")?.slice(0, 500) ?? null,
    expiresAt,
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(deps.config),
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(c: Context, db: Db) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Načte session z cookie (pokud existuje a je platná) do c.var.auth. Nic nevynucuje. */
export function sessionMiddleware(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("auth", null);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const id = sha256(token);
      const [row] = await db.select().from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(eq(sessions.id, id));
      if (row) {
        const settings = await getSettings(db);
        const now = Date.now();
        const idleLimit = row.sessions.lastSeenAt.getTime() + settings.sessionTimeoutMinutes * 60_000;
        if (row.sessions.expiresAt.getTime() < now || idleLimit < now || !row.users.isActive) {
          await db.delete(sessions).where(eq(sessions.id, id));
          deleteCookie(c, SESSION_COOKIE, { path: "/" });
        } else {
          if (now - row.sessions.lastSeenAt.getTime() > 30_000)
            await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
          const { scope, permissions } = await resolveScope(db, row.users.id, row.users.companyId, requestedCompany(c));
          const auth: AuthState = { user: row.users, session: row.sessions, permissions, scope };
          c.set("auth", auth);
        }
      }
    }
    await next();
  };
}

/** Stav přihlášení: plně přihlášen / čeká na MFA / musí nastavit MFA / musí změnit heslo. */
export async function authStatus(db: Db, auth: AuthState) {
  const settings = await getSettings(db);
  const { user, session } = auth;
  const mfaPending = user.mfaEnabled && !session.mfaVerified && !session.viaIdp;
  const mfaSetupRequired = settings.mfaRequired && !user.mfaEnabled && !session.viaIdp;
  const mustChangePassword = user.authProvider === "local" && user.mustChangePassword;
  return { mfaPending, mfaSetupRequired, mustChangePassword, complete: !mfaPending && !mfaSetupRequired && !mustChangePassword };
}

/** Vyžaduje plně dokončené přihlášení. */
export function requireAuth(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = c.get("auth");
    if (!auth) throw new HTTPException(401, { message: "Nepřihlášen" });
    const st = await authStatus(db, auth);
    if (st.mfaPending) throw new HTTPException(401, { message: "Vyžadováno ověření druhým faktorem" });
    if (st.mfaSetupRequired) throw new HTTPException(403, { message: "Organizace vyžaduje nastavení MFA" });
    if (st.mustChangePassword) throw new HTTPException(403, { message: "Je nutné změnit heslo" });
    await next();
  };
}

export function hasPerm(c: Context<AppEnv>, ...perms: Permission[]) {
  const p = c.get("auth")?.permissions;
  return !!p && perms.some((x) => p.has(x));
}

/** Vyžaduje alespoň jedno z uvedených oprávnění. */
export function requirePerm(...perms: Permission[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!hasPerm(c, ...perms)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    await next();
  };
}

export const currentUser = (c: Context<AppEnv>) => {
  const a = c.get("auth");
  if (!a) throw new HTTPException(401, { message: "Nepřihlášen" });
  return a.user;
};

/** Modul musí být zapnutý (Administrace → Moduly), jinak 404. */
export function requireModule(db: Db, key: ModuleKey): MiddlewareHandler<AppEnv> {
  return async (_c, next) => {
    const s = await getSettings(db);
    if (!s.enabledModules.includes(key)) throw new HTTPException(404, { message: "Modul je vypnutý" });
    await next();
  };
}
