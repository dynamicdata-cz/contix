import { allPacks } from "../modules/i18n/service";
import { ChangePasswordInput, companyTree, LoginInput, MfaCodeInput, ROOT_COMPANY_ID, type MeDto } from "@contix/shared";
import { getCompanies } from "./scope";
import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { appSecret, type Config } from "../config";
import type { Db } from "../db/client";
import { authFlows, mfaRecoveryCodes, roles, sessions, userRoles, users, type UserRow } from "../db/schema";
import {
  decrypt,
  encrypt,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  sha256,
  verifyTotp,
} from "./crypto";
import { authStatus, createSession, destroySession, requireAuth } from "./middleware";
import { adLoginSources, applyAdLogin, decideAdLogin, rolesForGroups, syncIdpRoles } from "./adLogin";
import type { AdAuthenticator } from "../modules/identity/ad";
import { buildAuthorizationUrl, exchangeCode, providersFor, publicProviders } from "./oidc";
import { audit, clientIp, getSettings, hashPassword, roleIdByKey, toUserDtos, type AppEnv, type AuthState } from "./service";

const GENERIC_LOGIN_ERROR = "Neplatný e-mail nebo heslo";

/** Omezení neúspěšných přihlášení z jedné IP adresy (hádání hesel, záměrné zamykání účtů). */
const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX_FAILURES = 30;
const ipFailures = new Map<string, { n: number; since: number }>();
function ipBlocked(ip: string | null) {
  if (!ip) return false;
  const r = ipFailures.get(ip);
  if (!r) return false;
  if (Date.now() - r.since > IP_WINDOW_MS) {
    ipFailures.delete(ip);
    return false;
  }
  return r.n >= IP_MAX_FAILURES;
}
function ipFailed(ip: string | null) {
  if (!ip) return;
  const r = ipFailures.get(ip);
  if (!r || Date.now() - r.since > IP_WINDOW_MS) ipFailures.set(ip, { n: 1, since: Date.now() });
  else r.n++;
  if (ipFailures.size > 10_000) ipFailures.clear(); // ochrana paměti
}
// Hash pro vyrovnání času odezvy, když uživatel neexistuje (ochrana proti zjišťování účtů).
const DUMMY_HASH = Bun.password.hash("dummy-password-for-timing", { algorithm: "argon2id" });

export function authRoutes(deps: { db: Db; config: Config; adAuth?: AdAuthenticator }) {
  const { db, config } = deps;
  const secret = () => appSecret(config);

  async function registerFailure(user: UserRow) {
    const s = await getSettings(db);
    const failed = user.failedLogins + 1;
    if (failed >= s.maxFailedLogins)
      await db
        .update(users)
        .set({ failedLogins: 0, lockedUntil: new Date(Date.now() + s.lockoutMinutes * 60_000) })
        .where(eq(users.id, user.id));
    else await db.update(users).set({ failedLogins: failed }).where(eq(users.id, user.id));
  }

  /** Jazyk uživatele, pokud balíček existuje; jinak výchozí jazyk organizace (smazaný balíček). */
  async function effectiveLocale(user: string | null, def: string) {
    const { packs } = await allPacks(db);
    return user && packs.has(user) ? user : packs.has(def) ? def : "cs";
  }

  async function me(auth: AuthState): Promise<MeDto> {
    const st = await authStatus(db, auth);
    const [dto] = await toUserDtos(db, [auth.user]);
    const settings = await getSettings(db);
    const all = await getCompanies(db);
    const tree = companyTree(all.filter((x) => x.active && auth.scope.accessible.includes(x.id)));
    const name = all.find((x) => x.id === (auth.scope.active ?? ROOT_COMPANY_ID))?.name ?? settings.organizationName;
    return {
      user: dto!,
      permissions: st.complete ? [...auth.permissions] : [],
      mfaPending: st.mfaPending,
      mfaSetupRequired: st.mfaSetupRequired,
      mustChangePassword: st.mustChangePassword,
      organizationName: name,
      enabledModules: settings.enabledModules,
      companies: tree.map((x) => ({ id: x.id, parentId: x.parentId, name: x.name, shortName: x.shortName, kind: x.kind, depth: x.depth, regime: x.regime as "higher" | "lower" | "none", pack: (x.pack ?? "cz") as "cz" | "sk" | "pl" | "de" | "at" | "generic", primaryFramework: x.primaryFramework ?? null, doraEntity: x.doraEntity ?? false })),
      activeCompanyId: auth.scope.active,
      homeCompanyId: auth.scope.home,
      canGroupView: auth.scope.canGroupView,
      locale: await effectiveLocale(auth.user.locale, settings.defaultLocale),
    };
  }

  const needSession = (c: Context<AppEnv>): AuthState => {
    const a = c.get("auth");
    if (!a) throw new HTTPException(401, { message: "Nepřihlášen" });
    return a;
  };

  return (
    new Hono<AppEnv>()
      .get("/providers", async (c) => {
        const s = await getSettings(db);
        return c.json({ organizationName: s.organizationName, local: true, ad: (await adLoginSources(db)).length > 0, oidc: await publicProviders(db, config) });
      })

      /* ---------- lokální přihlášení ---------- */
      .post("/login", zValidator("json", LoginInput), async (c) => {
        const { email, password } = c.req.valid("json");
        const ip = clientIp(c);
        if (ipBlocked(ip)) {
          await audit(db, { c, email, action: "auth.login_throttled" });
          throw new HTTPException(429, { message: "Příliš mnoho neúspěšných pokusů o přihlášení. Zkuste to znovu za 15 minut." });
        }
        const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);

        // účet AD (ADR-078): uživatel bez hesla CONTIXu nebo přihlašovací jméno, které není e-mail uživatele
        if (!user?.passwordHash) {
          const sources = await adLoginSources(db);
          if (sources.length) {
            if (user?.lockedUntil && user.lockedUntil > new Date()) {
              await audit(db, { c, user, action: "auth.login_locked" });
              throw new HTTPException(423, { message: "Účet je dočasně zablokován po opakovaných neúspěšných pokusech." });
            }
            const d = await decideAdLogin(db, config, email, password, { auth: deps.adAuth, sources });
            if (!d.ok) {
              if (["bad_password", "not_found", "ambiguous"].includes(d.reason ?? "")) ipFailed(ip);
              if (d.user && d.reason === "bad_password") await registerFailure(d.user);
              await audit(db, { c, email, action: "auth.login_failed", details: { method: "ad", reason: d.reason, source: d.source?.id ?? null, ...(d.message ? { error: d.message } : {}) } });
              throw new HTTPException(401, { message: GENERIC_LOGIN_ERROR });
            }
            if (d.user?.lockedUntil && d.user.lockedUntil > new Date()) {
              await audit(db, { c, user: d.user, action: "auth.login_locked" });
              throw new HTTPException(423, { message: "Účet je dočasně zablokován po opakovaných neúspěšných pokusech." });
            }
            const r = await applyAdLogin(db, d);
            if (r.created) await audit(db, { c, user: r.user, action: "user.provisioned", entityType: "user", entityId: r.user.id, details: { provider: "ad", source: d.source!.id } });
            if (r.linked) await audit(db, { c, user: r.user, action: "user.sso_linked", entityType: "user", entityId: r.user.id, details: { provider: "ad", source: d.source!.id } });
            await createSession(c, deps, r.user.id, { mfaVerified: !r.user.mfaEnabled });
            await audit(db, { c, user: r.user, action: "auth.login", details: { method: "ad", source: d.source!.id, mfa: r.user.mfaEnabled, idpRoles: d.groupRoles.length } });
            return c.json({ ok: true, mfaRequired: r.user.mfaEnabled });
          }
        }

        if (!user || !user.passwordHash || !user.isActive) {
          ipFailed(ip);
          await Bun.password.verify(password, await DUMMY_HASH);
          await audit(db, { c, email, action: "auth.login_failed", details: { reason: user ? "inactive_or_sso" : "unknown" } });
          throw new HTTPException(401, { message: GENERIC_LOGIN_ERROR });
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await audit(db, { c, user, action: "auth.login_locked" });
          throw new HTTPException(423, { message: "Účet je dočasně zablokován po opakovaných neúspěšných pokusech." });
        }
        if (!(await Bun.password.verify(password, user.passwordHash))) {
          ipFailed(ip);
          await registerFailure(user);
          await audit(db, { c, user, action: "auth.login_failed", details: { reason: "password" } });
          throw new HTTPException(401, { message: GENERIC_LOGIN_ERROR });
        }

        await db
          .update(users)
          .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() })
          .where(eq(users.id, user.id));
        await createSession(c, deps, user.id, { mfaVerified: !user.mfaEnabled });
        await audit(db, { c, user, action: "auth.login", details: { method: "password", mfa: user.mfaEnabled } });
        return c.json({ ok: true, mfaRequired: user.mfaEnabled });
      })

      .post("/logout", async (c) => {
        const a = c.get("auth");
        await destroySession(c, db);
        if (a) await audit(db, { c, user: a.user, action: "auth.logout" });
        return c.json({ ok: true });
      })

      .get("/me", async (c) => {
        return c.json(await me(needSession(c)));
      })

      /* ---------- MFA ---------- */
      .post("/mfa/verify", zValidator("json", MfaCodeInput), async (c) => {
        const a = needSession(c);
        const user = a.user;
        if (!user.mfaEnabled || !user.mfaSecretEnc) throw new HTTPException(400, { message: "MFA není nastaveno" });
        if (user.lockedUntil && user.lockedUntil > new Date())
          throw new HTTPException(423, { message: "Účet je dočasně zablokován." });

        const { code } = c.req.valid("json");
        const step = verifyTotp(decrypt(user.mfaSecretEnc, secret()), code, Date.now(), user.mfaLastStep);
        let method = "totp";
        if (step !== null) {
          await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
        } else {
          // záložní kód
          const hash = sha256(normalizeRecoveryCode(code));
          const [rc] = await db
            .update(mfaRecoveryCodes)
            .set({ usedAt: new Date() })
            .where(and(eq(mfaRecoveryCodes.userId, user.id), eq(mfaRecoveryCodes.codeHash, hash), isNull(mfaRecoveryCodes.usedAt)))
            .returning();
          if (!rc) {
            await registerFailure(user);
            await audit(db, { c, user, action: "auth.mfa_failed" });
            throw new HTTPException(401, { message: "Neplatný ověřovací kód" });
          }
          method = "recovery_code";
        }
        await db.update(users).set({ failedLogins: 0 }).where(eq(users.id, user.id));
        await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, a.session.id));
        await audit(db, { c, user, action: "auth.mfa_verified", details: { method } });
        return c.json({ ok: true });
      })

      /** Krok 1 nastavení MFA: vygeneruje tajemství (zatím neaktivní). */
      .post("/mfa/setup", async (c) => {
        const a = needSession(c);
        const st = await authStatus(db, a);
        if (st.mfaPending) throw new HTTPException(401, { message: "Nejdřív ověřte stávající MFA" });
        if (a.user.mfaEnabled) throw new HTTPException(409, { message: "MFA je již aktivní" });
        if (a.user.authProvider !== "local")
          throw new HTTPException(400, { message: "U účtů přes Entra ID / SSO řídí MFA poskytovatel identity" });
        const totpSecret = generateTotpSecret();
        await db.update(users).set({ mfaSecretEnc: encrypt(totpSecret, secret()) }).where(eq(users.id, a.user.id));
        return c.json({ secret: totpSecret, otpauthUrl: otpauthUrl(totpSecret, a.user.email) });
      })

      /** Krok 2: ověří první kód, aktivuje MFA a vrátí záložní kódy (zobrazí se jen jednou). */
      .post("/mfa/enable", zValidator("json", MfaCodeInput), async (c) => {
        const a = needSession(c);
        const [user] = await db.select().from(users).where(eq(users.id, a.user.id));
        if (!user?.mfaSecretEnc || user.mfaEnabled) throw new HTTPException(400, { message: "Nejdřív spusťte nastavení MFA" });
        const step = verifyTotp(decrypt(user.mfaSecretEnc, secret()), c.req.valid("json").code);
        if (step === null) throw new HTTPException(400, { message: "Kód nesouhlasí – zkontrolujte čas v telefonu a zkuste znovu" });

        const codes = generateRecoveryCodes();
        await db.transaction(async (tx) => {
          await tx.update(users).set({ mfaEnabled: true, mfaLastStep: step }).where(eq(users.id, user.id));
          await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
          await tx.insert(mfaRecoveryCodes).values(codes.map((k) => ({ userId: user.id, codeHash: sha256(normalizeRecoveryCode(k)) })));
          await tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, a.session.id));
        });
        await audit(db, { c, user, action: "auth.mfa_enabled" });
        return c.json({ recoveryCodes: codes });
      })

      .post("/mfa/disable", requireAuth(db), zValidator("json", LoginInput.pick({ password: true })), async (c) => {
        const a = needSession(c);
        const s = await getSettings(db);
        if (s.mfaRequired) throw new HTTPException(403, { message: "Organizace vyžaduje MFA – nelze vypnout" });
        if (!a.user.passwordHash || !(await Bun.password.verify(c.req.valid("json").password, a.user.passwordHash)))
          throw new HTTPException(401, { message: "Neplatné heslo" });
        await db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null }).where(eq(users.id, a.user.id));
        await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, a.user.id));
        await audit(db, { c, user: a.user, action: "auth.mfa_disabled" });
        return c.json({ ok: true });
      })

      /* ---------- změna hesla ---------- */
      .post("/password", zValidator("json", ChangePasswordInput), async (c) => {
        const a = needSession(c);
        const st = await authStatus(db, a);
        if (st.mfaPending) throw new HTTPException(401, { message: "Vyžadováno ověření druhým faktorem" });
        const { currentPassword, newPassword } = c.req.valid("json");
        const [user] = await db.select().from(users).where(eq(users.id, a.user.id));
        if (!user?.passwordHash) throw new HTTPException(400, { message: "Účet nemá lokální heslo (přihlášení přes SSO)" });
        if (!currentPassword || !(await Bun.password.verify(currentPassword, user.passwordHash)))
          throw new HTTPException(401, { message: "Současné heslo nesouhlasí" });
        if (currentPassword === newPassword) throw new HTTPException(400, { message: "Nové heslo musí být jiné než současné" });
        await db
          .update(users)
          .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false })
          .where(eq(users.id, user.id));
        // odhlásit ostatní relace
        await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, a.session.id)));
        await audit(db, { c, user, action: "auth.password_changed" });
        return c.json({ ok: true });
      })

      /* ---------- OIDC: Entra ID / Google / AD FS ---------- */
      .get("/oidc/:provider/start", async (c) => {
        const p = (await providersFor(db, config)).find((x) => x.id === c.req.param("provider"));
        if (!p) throw new HTTPException(404, { message: "Poskytovatel není nastaven" });
        await db.delete(authFlows).where(lt(authFlows.expiresAt, new Date()));
        const r = await buildAuthorizationUrl(p, config);
        await db.insert(authFlows).values({
          state: r.state,
          provider: p.id,
          nonce: r.nonce,
          codeVerifier: r.codeVerifier,
          expiresAt: new Date(Date.now() + 10 * 60_000),
        });
        return c.redirect(r.url, 302);
      })

      .get("/oidc/:provider/callback", async (c) => {
        const base = config.APP_URL.replace(/\/+$/, "");
        const fail = (code: string) => c.redirect(`${base}/login?error=${code}`, 302);
        const p = (await providersFor(db, config)).find((x) => x.id === c.req.param("provider"));
        const state = c.req.query("state");
        const code = c.req.query("code");
        if (!p || !state || !code) return fail("sso_invalid");

        const [flow] = await db.delete(authFlows).where(eq(authFlows.state, state)).returning();
        if (!flow || flow.provider !== p.id || flow.expiresAt < new Date()) return fail("sso_expired");

        let id;
        try {
          id = await exchangeCode(p, config, code, flow.codeVerifier, flow.nonce);
        } catch (e) {
          await audit(db, { c, action: "auth.sso_failed", details: { provider: p.id, error: (e as Error).message } });
          return fail("sso_failed");
        }
        if (!id.email) return fail("sso_no_email");

        const settings = await getSettings(db);
        // důvěra v e-mail od IdP: povolené domény; Google (kdokoli na světě) jen s nastavenými doménami
        const domain = id.email.split("@")[1] ?? "";
        const domains = settings.oidcAllowedDomains ?? [];
        if (domains.length && !domains.includes(domain)) {
          await audit(db, { c, email: id.email, action: "auth.sso_domain_denied", details: { provider: p.id } });
          return fail("sso_domain");
        }
        const trustEmail = domains.length > 0 || p.id !== "google";

        const externalId = `${p.id}:${id.subject}`;
        let [user] = await db.select().from(users).where(eq(users.externalId, externalId));
        if (!user && trustEmail) {
          [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${id.email}`);
          if (user) {
            // propojení existujícího účtu (založeného adminem) s identitou u IdP
            [user] = await db.update(users).set({ externalId }).where(eq(users.id, user.id)).returning();
            await audit(db, { c, user, action: "user.sso_linked", entityType: "user", entityId: user!.id, details: { provider: p.id } });
          }
        }
        if (!user) {
          if (!settings.oidcAutoProvision || !trustEmail) {
            await audit(db, { c, email: id.email, action: "auth.sso_not_provisioned", details: { provider: p.id } });
            return fail("not_provisioned");
          }
          [user] = await db
            .insert(users)
            .values({ email: id.email, displayName: id.name ?? id.email, authProvider: "oidc", externalId })
            .returning();
          const def = await roleIdByKey(db, settings.oidcDefaultRoleKey);
          if (def) await db.insert(userRoles).values({ userId: user!.id, roleId: def, source: "manual" });
          await audit(db, { c, user, action: "user.provisioned", entityType: "user", entityId: user!.id, details: { provider: p.id } });
        }
        if (!user!.isActive) return fail("inactive");

        // synchronizace rolí ze skupin IdP (role.externalGroups)
        const idpRoleIds = (await rolesForGroups(db, id.groups)).map((r) => r.id);
        await syncIdpRoles(db, user!.id, idpRoleIds);

        await db
          .update(users)
          .set({ lastLoginAt: new Date(), displayName: id.name ?? user!.displayName })
          .where(eq(users.id, user!.id));
        await createSession(c, deps, user!.id, { mfaVerified: true, viaIdp: true });
        await audit(db, {
          c,
          user,
          action: "auth.login",
          details: { method: "sso", provider: p.id, idpRoles: idpRoleIds.length, amr: id.claims.amr },
        });
        return c.redirect(`${base}/`, 302);
      })
  );
}
