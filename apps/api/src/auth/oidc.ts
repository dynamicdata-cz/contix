import type { AuthProviderInfo } from "@contix/shared";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "node:crypto";
import { appSecret, type Config } from "../config";
import type { Db } from "../db/client";
import { ssoProviders } from "../db/schema";
import { decrypt, randomToken } from "./crypto";

/**
 * OIDC přihlášení (Authorization Code + PKCE).
 *  - Microsoft Entra ID (cloud / hybridní AD synchronizované přes Entra Connect)
 *  - Google Workspace
 *  - obecný OIDC poskytovatel – např. AD FS pro čistě on-prem Active Directory, Keycloak, Authentik
 */

export interface OidcProvider {
  id: string;
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  extraAuthParams?: Record<string, string>;
  /** Google: e-mail přijmout jen ověřený. */
  requireEmailVerified?: boolean;
}

export function configuredProviders(c: Config): OidcProvider[] {
  const out: OidcProvider[] = [];
  if (c.ENTRA_TENANT_ID && c.ENTRA_CLIENT_ID && c.ENTRA_CLIENT_SECRET)
    out.push({
      id: "entra",
      label: "Microsoft Entra ID",
      issuer: `https://login.microsoftonline.com/${c.ENTRA_TENANT_ID}/v2.0`,
      clientId: c.ENTRA_CLIENT_ID,
      clientSecret: c.ENTRA_CLIENT_SECRET,
      scopes: "openid profile email",
      extraAuthParams: { prompt: "select_account" },
    });
  if (c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET)
    out.push({
      id: "google",
      label: "Google",
      issuer: "https://accounts.google.com",
      clientId: c.GOOGLE_CLIENT_ID,
      clientSecret: c.GOOGLE_CLIENT_SECRET,
      scopes: "openid profile email",
      extraAuthParams: { prompt: "select_account" },
      requireEmailVerified: true,
    });
  if (c.OIDC_ISSUER && c.OIDC_CLIENT_ID && c.OIDC_CLIENT_SECRET)
    out.push({
      id: "oidc",
      label: c.OIDC_LABEL,
      issuer: c.OIDC_ISSUER.replace(/\/+$/, ""),
      clientId: c.OIDC_CLIENT_ID,
      clientSecret: c.OIDC_CLIENT_SECRET,
      scopes: c.OIDC_SCOPES,
    });
  return out;
}

type SsoRow = typeof ssoProviders.$inferSelect;
export const ssoProviderId = (id: string) => `sso-${id}`;
export const entraIssuer = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/v2.0`;

/** Poskytovatel z administrace (ADR-078) – null, když chybí / nelze dešifrovat tajemství. */
export function providerFromRow(r: SsoRow, c: Config): OidcProvider | null {
  if (!r.enabled || !r.secretEnc) return null;
  let clientSecret: string;
  try {
    clientSecret = decrypt(r.secretEnc, appSecret(c));
  } catch {
    return null;
  }
  const base = { id: ssoProviderId(r.id), label: r.label, clientId: r.clientId, clientSecret, scopes: r.scopes || "openid profile email" };
  if (r.kind === "entra") return { ...base, issuer: entraIssuer(r.tenantId), extraAuthParams: { prompt: "select_account" } };
  if (r.kind === "google") return { ...base, issuer: "https://accounts.google.com", extraAuthParams: { prompt: "select_account" }, requireEmailVerified: true };
  return { ...base, issuer: r.issuer.replace(/\/+$/, "") };
}

/** Všichni poskytovatelé: z konfigurace serveru (server.env) + z administrace. */
export async function providersFor(db: Db, c: Config): Promise<OidcProvider[]> {
  const rows = await db.select().from(ssoProviders);
  return [...configuredProviders(c), ...rows.map((r) => providerFromRow(r, c)).filter((p): p is OidcProvider => !!p)];
}

export const publicProviders = async (db: Db, c: Config): Promise<AuthProviderInfo[]> => (await providersFor(db, c)).map(({ id, label }) => ({ id, label }));

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveryCache = new Map<string, { at: number; doc: Discovery; jwks: ReturnType<typeof createRemoteJWKSet> }>();

export async function discover(issuer: string, fetchImpl: typeof fetch = fetch) {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 3600_000) return hit;
  const res = await fetchImpl(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery selhalo (${res.status})`);
  const doc = (await res.json()) as Discovery;
  const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)) };
  discoveryCache.set(issuer, entry);
  return entry;
}

export const redirectUri = (c: Config, providerId: string) =>
  `${c.APP_URL.replace(/\/+$/, "")}/api/auth/oidc/${providerId}/callback`;

export async function buildAuthorizationUrl(p: OidcProvider, c: Config) {
  const { doc } = await discover(p.issuer);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const codeVerifier = randomToken(48);
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const url = new URL(doc.authorization_endpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: redirectUri(c, p.id),
    scope: p.scopes,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...p.extraAuthParams,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), state, nonce, codeVerifier };
}

export interface OidcIdentity {
  subject: string;
  email: string | null;
  name: string | null;
  /** Skupiny (Entra: object ID skupin, AD FS: názvy skupin) + app role. */
  groups: string[];
  claims: JWTPayload;
}

export async function exchangeCode(p: OidcProvider, c: Config, code: string, codeVerifier: string, nonce: string): Promise<OidcIdentity> {
  const { doc, jwks } = await discover(p.issuer);
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(c, p.id),
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`Výměna kódu u IdP selhala (${res.status})`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("IdP nevrátil id_token");

  const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: doc.issuer, audience: p.clientId });
  if (payload.nonce !== nonce) throw new Error("Neplatný nonce");

  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  let email = str(payload.email) ?? str(payload.preferred_username) ?? str(payload.upn) ?? str(payload.unique_name);
  if (p.requireEmailVerified && payload.email_verified !== true) email = null;
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);
  return {
    subject: String(payload.sub),
    email: email?.toLowerCase() ?? null,
    name: str(payload.name),
    groups: [...arr(payload.groups), ...arr(payload.roles), ...arr(payload.group)],
    claims: payload,
  };
}
