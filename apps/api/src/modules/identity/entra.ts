import { ENTRA_PRIVILEGED_ROLES, type DirAccount, type EntraSourceConfig } from "@contix/shared";
import type { Config } from "../../config";

/* ============================================================
 * Microsoft Entra ID přes Microsoft Graph – jen čtení (ADR-029).
 * Aplikace s oprávněními typu Application: User.Read.All, RoleManagement.Read.Directory,
 * volitelně AuditLog.Read.All (poslední přihlášení a registrace MFA – vyžaduje Entra ID P1).
 * Chybějící volitelné oprávnění nevadí: údaj zůstane neznámý a zdroj dostane poznámku.
 * ============================================================ */

export interface EntraConnection {
  config: EntraSourceConfig;
  secret: string;
  env: Pick<Config, "ENTRA_LOGIN_URL" | "GRAPH_URL">;
}

class GraphError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const endpoints = (env: EntraConnection["env"]) => ({
  login: (env.ENTRA_LOGIN_URL ?? "https://login.microsoftonline.com").replace(/\/+$/, ""),
  graph: (env.GRAPH_URL ?? "https://graph.microsoft.com").replace(/\/+$/, ""),
});

async function token(conn: EntraConnection): Promise<string> {
  const { login, graph } = endpoints(conn.env);
  const res = await fetch(`${login}/${encodeURIComponent(conn.config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: conn.config.clientId, client_secret: conn.secret, scope: `${graph}/.default` }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => {
    throw new Error(`Přihlašovací služba Microsoftu není dostupná (${(e as Error).message}). Server CONTIXu musí mít přístup na ${login}.`);
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    const d = body.error_description?.split("\r\n")[0] ?? body.error ?? `HTTP ${res.status}`;
    if (/AADSTS7000215|invalid_client/.test(d)) throw new Error("Neplatný tajný klíč aplikace (client secret) – zkontrolujte ho nebo vytvořte nový.");
    if (/AADSTS700016/.test(d)) throw new Error("Aplikace (client ID) v tenantu neexistuje – zkontrolujte ID aplikace a tenantu.");
    if (/AADSTS90002/.test(d)) throw new Error("Tenant nebyl nalezen – zkontrolujte ID tenantu.");
    throw new Error(`Přihlášení aplikace k Entra ID selhalo: ${d}`);
  }
  return body.access_token;
}

/** GET se stránkováním (@odata.nextLink); maxPages chrání před nekonečnou smyčkou. */
async function getAll<T>(conn: EntraConnection, tok: string, path: string, maxPages = 200): Promise<T[]> {
  const { graph } = endpoints(conn.env);
  let url: string | null = `${graph}${path}`;
  const out: T[] = [];
  for (let i = 0; url && i < maxPages; i++) {
    const res: Response = await fetch(url, { headers: { authorization: `Bearer ${tok}`, ConsistencyLevel: "eventual" }, signal: AbortSignal.timeout(60_000) });
    const body = (await res.json().catch(() => ({}))) as { value?: T[]; "@odata.nextLink"?: string; error?: { code?: string; message?: string } };
    if (!res.ok) throw new GraphError(res.status, body.error?.message ?? `HTTP ${res.status}`);
    out.push(...(body.value ?? []));
    url = body["@odata.nextLink"] ?? null;
  }
  return out;
}

interface GraphUser {
  id: string;
  displayName?: string | null;
  userPrincipalName?: string | null;
  mail?: string | null;
  accountEnabled?: boolean | null;
  userType?: string | null;
  createdDateTime?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  passwordPolicies?: string | null;
  lastPasswordChangeDateTime?: string | null;
  onPremisesSyncEnabled?: boolean | null;
  signInActivity?: { lastSignInDateTime?: string | null; lastNonInteractiveSignInDateTime?: string | null; lastSuccessfulSignInDateTime?: string | null } | null;
}

const USER_SELECT = "id,displayName,userPrincipalName,mail,accountEnabled,userType,createdDateTime,department,jobTitle,passwordPolicies,lastPasswordChangeDateTime,onPremisesSyncEnabled";

export async function testEntra(conn: EntraConnection): Promise<{ users: number; notes: string[] }> {
  const tok = await token(conn);
  const notes: string[] = [];
  let users: unknown[];
  try {
    users = await getAll(conn, tok, `/v1.0/users?$select=id&$top=999`, 50);
  } catch (e) {
    throw new Error(graphMessage(e, "User.Read.All"));
  }
  await getAll(conn, tok, `/v1.0/directoryRoles?$select=id`, 1).catch((e) => notes.push(graphMessage(e, "RoleManagement.Read.Directory")));
  await getAll(conn, tok, `/v1.0/users?$select=id,signInActivity&$top=1`, 1).catch(() => notes.push(SIGNIN_NOTE));
  await getAll(conn, tok, `/v1.0/reports/authenticationMethods/userRegistrationDetails?$top=1`, 1).catch(() => notes.push(MFA_NOTE));
  return { users: users.length, notes };
}

const SIGNIN_NOTE = "Poslední přihlášení není k dispozici – vyžaduje oprávnění AuditLog.Read.All a licenci Entra ID P1. Neaktivní účty se nevyhodnotí.";
const MFA_NOTE = "Registrace MFA není k dispozici – vyžaduje oprávnění AuditLog.Read.All a licenci Entra ID P1. Účty bez MFA se nevyhodnotí.";

function graphMessage(e: unknown, perm: string): string {
  if (e instanceof GraphError && (e.status === 403 || e.status === 401)) return `Aplikace nemá oprávnění ${perm} (typ Application, s udělením souhlasu správce).`;
  return `Chyba Microsoft Graph: ${(e as Error).message}`;
}

export async function fetchEntra(conn: EntraConnection, trackedGroups: string[] = []): Promise<{ accounts: DirAccount[]; notes: string[] }> {
  const tok = await token(conn);
  const notes: string[] = [];

  // uživatelé – s posledním přihlášením, pokud to licence / oprávnění dovolí
  let users: GraphUser[];
  let signInKnown = true;
  try {
    users = await getAll<GraphUser>(conn, tok, `/v1.0/users?$select=${USER_SELECT},signInActivity&$top=999`);
  } catch (e) {
    if (!(e instanceof GraphError) || (e.status !== 403 && e.status !== 400)) throw new Error(graphMessage(e, "User.Read.All"));
    signInKnown = false;
    notes.push(SIGNIN_NOTE);
    try {
      users = await getAll<GraphUser>(conn, tok, `/v1.0/users?$select=${USER_SELECT}&$top=999`);
    } catch (e2) {
      throw new Error(graphMessage(e2, "User.Read.All"));
    }
  }

  // registrace MFA
  const mfa = new Map<string, boolean>();
  try {
    const reg = await getAll<{ id: string; isMfaRegistered?: boolean }>(conn, tok, `/v1.0/reports/authenticationMethods/userRegistrationDetails?$select=id,isMfaRegistered`);
    for (const r of reg) mfa.set(r.id, !!r.isMfaRegistered);
  } catch {
    notes.push(MFA_NOTE);
  }

  // privilegované role (aktivní přiřazení; oprávněná přiřazení PIM se nezapočítávají)
  const priv = new Map<string, string[]>();
  try {
    const roles = await getAll<{ id: string; displayName?: string; roleTemplateId?: string; members?: { id: string }[] }>(
      conn,
      tok,
      `/v1.0/directoryRoles?$select=id,displayName,roleTemplateId&$expand=members($select=id)`,
    );
    const extra = conn.config.extraPrivilegedRoles.map((x) => x.toLowerCase());
    const names = new Set(Object.values(ENTRA_PRIVILEGED_ROLES).map((x) => x.toLowerCase()));
    for (const r of roles) {
      const name = r.displayName ?? ENTRA_PRIVILEGED_ROLES[r.roleTemplateId ?? ""] ?? r.id;
      const isPriv = (r.roleTemplateId && ENTRA_PRIVILEGED_ROLES[r.roleTemplateId]) || names.has(name.toLowerCase()) || extra.includes(name.toLowerCase());
      if (!isPriv) continue;
      for (const m of r.members ?? []) priv.set(m.id, [...(priv.get(m.id) ?? []), name]);
    }
  } catch (e) {
    notes.push(`${graphMessage(e, "RoleManagement.Read.Directory")} Privilegované účty se nevyhodnotí.`);
  }

  // členství ve sledovaných skupinách (tranzitivně) – pro toxické kombinace, přezkumy a synchronizaci uživatelů
  const memberOf = new Map<string, string[]>();
  for (const name of trackedGroups) {
    try {
      const found = await getAll<{ id: string; displayName: string }>(conn, tok, `/v1.0/groups?$filter=${encodeURIComponent(`displayName eq '${name.replace(/'/g, "''")}'`)}&$select=id,displayName`, 2);
      if (!found.length) {
        notes.push(`Skupina „${name}“ v Entra ID neexistuje.`);
        continue;
      }
      for (const g of found) {
        const members = await getAll<{ id: string }>(conn, tok, `/v1.0/groups/${g.id}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`);
        for (const m of members) memberOf.set(m.id, [...(memberOf.get(m.id) ?? []), g.displayName]);
      }
    } catch (e) {
      notes.push(`Členství ve skupině „${name}“: ${graphMessage(e, "GroupMember.Read.All")}`);
    }
  }

  const maxDate = (...v: (string | null | undefined)[]) => {
    const t = v.filter(Boolean).map((x) => new Date(x!).getTime()).filter((x) => Number.isFinite(x) && x > 0);
    return t.length ? new Date(Math.max(...t)) : null;
  };
  const accounts: DirAccount[] = users.map((u) => {
    const login = u.userPrincipalName ?? u.id;
    const guest = (u.userType ?? "").toLowerCase() === "guest" || login.includes("#EXT#");
    const s = u.signInActivity;
    return {
      externalId: u.id,
      login,
      displayName: u.displayName ?? login,
      email: (u.mail ?? (guest ? null : u.userPrincipalName))?.toLowerCase() ?? null,
      kind: guest ? "guest" : "user",
      enabled: u.accountEnabled !== false,
      dn: null,
      createdAt: u.createdDateTime ? new Date(u.createdDateTime) : null,
      lastLogonAt: signInKnown ? maxDate(s?.lastSignInDateTime, s?.lastNonInteractiveSignInDateTime, s?.lastSuccessfulSignInDateTime) : null,
      pwdLastSetAt: u.lastPasswordChangeDateTime ? new Date(u.lastPasswordChangeDateTime) : null,
      signInKnown,
      flags: {
        // u účtů synchronizovaných z AD platí zásady hesel AD – vyhodnotí je zdroj AD
        pwdNeverExpires: !u.onPremisesSyncEnabled && (u.passwordPolicies ?? "").includes("DisablePasswordExpiration"),
        pwdNotRequired: false,
        preauthDisabled: false,
        hasSpn: false,
        unconstrainedDelegation: false,
      },
      mfa: mfa.size ? (mfa.get(u.id) ?? null) : null,
      privilegedVia: (priv.get(u.id) ?? []).sort(),
      groups: [...new Set([...(priv.get(u.id) ?? []), ...(memberOf.get(u.id) ?? [])])],
      department: u.department ?? null,
      title: u.jobTitle ?? null,
    };
  });
  return { accounts, notes };
}

/**
 * Microsoft Secure Score (ADR-096) – poslední denní skóre tenantu, jen čtení.
 * Vyžaduje oprávnění aplikace SecurityEvents.Read.All; bez něj srozumitelná chyba (běh monitoru = chyba, ne nesplněno).
 */
export async function fetchSecureScore(conn: EntraConnection): Promise<{ current: number; max: number; pct: number; date: string | null; controls: { name: string; score: number }[] }> {
  const tok = await token(conn);
  const { graph } = endpoints(conn.env);
  const res = await fetch(`${graph}/v1.0/security/secureScores?$top=1`, { headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(60_000) }).catch((e) => {
    throw new Error(`Microsoft Graph není dostupný (${(e as Error).message}).`);
  });
  const body = (await res.json().catch(() => ({}))) as { value?: { currentScore?: number; maxScore?: number; createdDateTime?: string; controlScores?: { controlName?: string; score?: number }[] }[]; error?: { message?: string } };
  if (res.status === 401 || res.status === 403) throw new Error("Aplikaci chybí oprávnění SecurityEvents.Read.All pro čtení Secure Score.");
  if (!res.ok) throw new Error(`Secure Score: ${body.error?.message ?? `HTTP ${res.status}`}`);
  const s = body.value?.[0];
  if (!s || !s.maxScore) throw new Error("Tenant zatím nemá vypočtené Secure Score.");
  const current = Number(s.currentScore ?? 0);
  const max = Number(s.maxScore);
  return {
    current,
    max,
    pct: Math.round((current / max) * 1000) / 10,
    date: s.createdDateTime?.slice(0, 10) ?? null,
    controls: (s.controlScores ?? []).map((c) => ({ name: String(c.controlName ?? ""), score: Number(c.score ?? 0) })).filter((c) => c.name),
  };
}
