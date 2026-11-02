import {
  AdLoginSourceInput,
  AdLoginTestInput,
  AdSourceConfig,
  DEFAULT_IDENTITY_POLICY,
  ROOT_COMPANY_ID,
  SsoProviderInput,
  type AdLoginSourceDto,
  type AdLoginTestResult,
  type LoginAdminDto,
  type SsoKind,
  type SsoProviderDto,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { decideAdLogin, loginOf } from "../../auth/adLogin";
import { encrypt } from "../../auth/crypto";
import { currentUser, requirePerm } from "../../auth/middleware";
import { configuredProviders, redirectUri, ssoProviderId } from "../../auth/oidc";
import { audit, type AppEnv } from "../../auth/service";
import { appSecret, type Config } from "../../config";
import type { Db } from "../../db/client";
import { identitySources, roles, ssoProviders } from "../../db/schema";
import type { AdAuthenticator } from "../identity/ad";
import { tFor } from "../i18n/service";

/* ============================================================
 * Administrace → Přihlášení (ADR-078): přihlášení účty AD a poskytovatelé SSO bez úprav server.env.
 * Tajemství jen šifrovaně (secretEnc), do odpovědí ani auditu nikdy.
 * ============================================================ */

type SourceRow = typeof identitySources.$inferSelect;
type SsoRow = typeof ssoProviders.$inferSelect;

const adDto = (r: SourceRow): AdLoginSourceDto => ({
  id: r.id,
  name: r.name,
  companyId: r.companyId,
  config: AdSourceConfig.parse(r.config),
  hasSecret: !!r.secretEnc,
  login: loginOf(r),
  syncHours: r.syncHours,
});

const publicAd = (cfg: AdSourceConfig) => ({ url: cfg.url, baseDn: cfg.baseDn, bindDn: cfg.bindDn, verifyTls: cfg.verifyTls, caCert: cfg.caCert ? "(vložen)" : "" });

export function loginAdminRoutes(deps: { db: Db; config: Config; adAuth?: AdAuthenticator }) {
  const { db, config } = deps;
  const enc = (v: string | undefined, prev: string | null) => (v ? encrypt(v, appSecret(config)) : prev);
  const ssoDto = (r: SsoRow): SsoProviderDto => ({
    id: r.id,
    providerId: ssoProviderId(r.id),
    kind: r.kind as SsoKind,
    label: r.label,
    tenantId: r.tenantId,
    issuer: r.issuer,
    clientId: r.clientId,
    hasSecret: !!r.secretEnc,
    scopes: r.scopes,
    enabled: r.enabled,
    redirectUri: redirectUri(config, ssoProviderId(r.id)),
  });
  async function adRow(id: string) {
    const [r] = await db.select().from(identitySources).where(and(eq(identitySources.id, id), eq(identitySources.kind, "ad")));
    if (!r) throw new HTTPException(404, { message: "Připojení AD nenalezeno" });
    return r;
  }
  async function ssoRow(id: string) {
    const [r] = await db.select().from(ssoProviders).where(eq(ssoProviders.id, id));
    if (!r) throw new HTTPException(404, { message: "Poskytovatel nenalezen" });
    return r;
  }
  async function checkRole(key: string) {
    if (!key) return;
    const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
    if (!r) throw new HTTPException(400, { message: "Výchozí role neexistuje" });
  }

  return new Hono<AppEnv>()
    .get("/", requirePerm("admin:settings"), async (c) => {
      const [ad, sso, rs] = await Promise.all([
        db.select().from(identitySources).where(eq(identitySources.kind, "ad")).orderBy(asc(identitySources.name)),
        db.select().from(ssoProviders).orderBy(asc(ssoProviders.label)),
        db.select({ id: roles.id, key: roles.key, name: roles.name, externalGroups: roles.externalGroups }).from(roles).orderBy(asc(roles.name)),
      ]);
      return c.json({
        ad: ad.map(adDto),
        sso: sso.map(ssoDto),
        envProviders: configuredProviders(config).map((p) => ({ id: p.id, label: p.label, issuer: p.issuer, redirectUri: redirectUri(config, p.id) })),
        roles: rs,
        appUrl: config.APP_URL,
      } satisfies LoginAdminDto);
    })

    /* ---------- přihlášení účty AD ---------- */
    .post("/ad", requirePerm("admin:settings"), zValidator("json", AdLoginSourceInput), async (c) => {
      const input = c.req.valid("json");
      if (!input.secret) throw new HTTPException(400, { message: "Zadejte heslo účtu pro čtení." });
      await checkRole(input.login.defaultRoleKey);
      const [row] = await db
        .insert(identitySources)
        // jen pro přihlášení: bez automatické synchronizace účtů (zapne se v Identitách a přístupech)
        .values({ companyId: ROOT_COMPANY_ID, kind: "ad", name: input.name, enabled: true, config: input.config, secretEnc: enc(input.secret, null), policy: DEFAULT_IDENTITY_POLICY, syncHours: 0, login: input.login })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "auth.ad_login_created", entityType: "identity_source", entityId: row!.id, details: { name: input.name, config: publicAd(input.config), login: input.login } });
      return c.json(adDto(row!), 201);
    })

    .put("/ad/:id", requirePerm("admin:settings"), zValidator("json", AdLoginSourceInput), async (c) => {
      const prev = await adRow(c.req.param("id"));
      const input = c.req.valid("json");
      await checkRole(input.login.defaultRoleKey);
      const [row] = await db
        .update(identitySources)
        .set({ name: input.name, config: input.config, secretEnc: enc(input.secret, prev.secretEnc), login: input.login, updatedAt: new Date() })
        .where(eq(identitySources.id, prev.id))
        .returning();
      await audit(db, { c, user: currentUser(c), action: "auth.ad_login_updated", entityType: "identity_source", entityId: prev.id, details: { name: input.name, config: publicAd(input.config), login: input.login, secretChanged: !!input.secret } });
      return c.json(adDto(row!));
    })

    /** Zkouška přihlášení: ověří jméno a heslo v AD a ukáže skupiny a role – nic nezakládá ani nemění. */
    .post("/ad/:id/test", requirePerm("admin:settings"), zValidator("json", AdLoginTestInput), async (c) => {
      const row = await adRow(c.req.param("id"));
      const { username, password } = c.req.valid("json");
      const t = await tFor(db, c);
      // zkouší se i u vypnutého přihlášení – správce si ho ověří před zapnutím
      const d = await decideAdLogin(db, config, username.toLowerCase(), password, { auth: deps.adAuth, sources: [{ ...row, login: { ...loginOf(row), enabled: true } }] });
      const roleNames = [...d.groupRoles.map((r) => r.name), ...(d.defaultRoleName && !d.user ? [d.defaultRoleName] : [])];
      await audit(db, { c, user: currentUser(c), action: "auth.ad_login_tested", entityType: "identity_source", entityId: row.id, details: { username, ok: d.ok, reason: d.reason } });
      return c.json({
        ok: d.ok,
        reason: d.reason,
        message: d.ok ? (d.user ? t("srv.lgn.okExisting", { user: d.user.email }) : t("srv.lgn.okNew")) : (d.message ?? t(`srv.lgn.fail.${d.reason ?? "error"}` as "srv.lgn.fail.error")),
        displayName: d.identity?.displayName ?? null,
        email: d.user?.email ?? d.identity?.email ?? null,
        login: d.identity?.login ?? null,
        groups: (d.identity?.groups ?? []).filter((g) => !g.includes("=")).sort(),
        roles: [...new Set(roleNames)],
        existingUser: !!d.user,
      } satisfies AdLoginTestResult);
    })

    /* ---------- SSO (OIDC) ---------- */
    .post("/sso", requirePerm("admin:settings"), zValidator("json", SsoProviderInput), async (c) => {
      const input = c.req.valid("json");
      if (!input.secret) throw new HTTPException(400, { message: "Zadejte tajný klíč klienta." });
      const [row] = await db
        .insert(ssoProviders)
        .values({ kind: input.kind, label: input.label, tenantId: input.tenantId, issuer: input.issuer, clientId: input.clientId, secretEnc: enc(input.secret, null), scopes: input.scopes, enabled: input.enabled })
        .returning();
      await audit(db, { c, user: currentUser(c), action: "auth.sso_provider_created", entityType: "sso_provider", entityId: row!.id, details: { kind: input.kind, label: input.label, issuer: input.issuer, tenantId: input.tenantId } });
      return c.json(ssoDto(row!), 201);
    })

    .put("/sso/:id", requirePerm("admin:settings"), zValidator("json", SsoProviderInput), async (c) => {
      const prev = await ssoRow(c.req.param("id"));
      const input = c.req.valid("json");
      const [row] = await db
        .update(ssoProviders)
        .set({ kind: input.kind, label: input.label, tenantId: input.tenantId, issuer: input.issuer, clientId: input.clientId, secretEnc: enc(input.secret, prev.secretEnc), scopes: input.scopes, enabled: input.enabled, updatedAt: new Date() })
        .where(eq(ssoProviders.id, prev.id))
        .returning();
      await audit(db, { c, user: currentUser(c), action: "auth.sso_provider_updated", entityType: "sso_provider", entityId: prev.id, details: { kind: input.kind, label: input.label, enabled: input.enabled, secretChanged: !!input.secret } });
      return c.json(ssoDto(row!));
    })

    .delete("/sso/:id", requirePerm("admin:settings"), async (c) => {
      const prev = await ssoRow(c.req.param("id"));
      await db.delete(ssoProviders).where(eq(ssoProviders.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "auth.sso_provider_deleted", entityType: "sso_provider", entityId: prev.id, details: { label: prev.label } });
      return c.body(null, 204);
    });
}
