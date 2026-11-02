import {
  UAC,
  fromFileTime,
  fromGeneralizedTime,
  guidToString,
  isPrivilegedAdGroup,
  ldapEscape,
  parseLoginName,
  sidToString,
  type AdSourceConfig,
  type DirAccount,
} from "@contix/shared";
import { Client, type Entry } from "ldapts";

/* ============================================================
 * Active Directory přes LDAP(S) – jen čtení (ADR-029).
 * Uživatelé + skupiny jedním stránkovaným dotazem; vnořené členství a privilegované
 * skupiny (podle SID, nezávisle na jazyku serveru) se vyhodnotí v paměti.
 * ============================================================ */

const USER_ATTRS = [
  "objectGUID",
  "objectSid",
  "sAMAccountName",
  "userPrincipalName",
  "displayName",
  "mail",
  "userAccountControl",
  "lastLogonTimestamp",
  "pwdLastSet",
  "whenCreated",
  "servicePrincipalName",
  "memberOf",
  "primaryGroupID",
  "department",
  "title",
  "accountExpires",
];
const GROUP_ATTRS = ["distinguishedName", "cn", "objectSid", "memberOf"];

/** Účty, které se nehodnotí (vestavěné, vždy zakázané nebo spravované systémem). */
const SKIP_LOGINS = new Set(["krbtgt"]);

type Attrs = Map<string, Entry[string]>;
const lower = (e: Entry): Attrs => new Map(Object.entries(e).map(([k, v]) => [k.toLowerCase(), v]));
const str = (a: Attrs, k: string): string | null => {
  const v = a.get(k.toLowerCase());
  const x = Array.isArray(v) ? v[0] : v;
  if (x === undefined || x === null) return null;
  return Buffer.isBuffer(x) ? x.toString("utf8") : String(x);
};
const list = (a: Attrs, k: string): string[] => {
  const v = a.get(k.toLowerCase());
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => (Buffer.isBuffer(x) ? x.toString("utf8") : String(x)));
};
const buf = (a: Attrs, k: string): Uint8Array | null => {
  const v = a.get(k.toLowerCase());
  const x = Array.isArray(v) ? v[0] : v;
  return Buffer.isBuffer(x) ? new Uint8Array(x) : null;
};
const dnKey = (dn: string) => dn.toLowerCase().replace(/\s*,\s*/g, ",");
const cnOf = (dn: string) => dn.match(/^CN=((?:\\,|[^,])+)/i)?.[1]?.replace(/\\,/g, ",") ?? dn;

export interface AdConnection {
  config: AdSourceConfig;
  password: string;
}

async function connect({ config, password }: AdConnection) {
  const client = new Client({
    url: config.url.replace(/\/$/, ""),
    timeout: 60_000,
    connectTimeout: 10_000,
    // tlsOptions zapne v ldapts TLS – jen pro ldaps:// (ldap:// je nešifrované, jen pro test)
    ...(config.url.startsWith("ldaps://") ? { tlsOptions: { rejectUnauthorized: config.verifyTls, ...(config.caCert ? { ca: [config.caCert] } : {}) } } : {}),
  });
  try {
    await client.bind(config.bindDn, password);
  } catch (e) {
    await client.unbind().catch(() => {});
    throw new Error(adError(e));
  }
  return client;
}

/** Srozumitelná chyba místo kódu LDAP. */
export function adError(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  const code = (e as { code?: number })?.code;
  if (code === 49 || /52e|invalid ?credentials/i.test(m) || (e as Error)?.constructor?.name === "InvalidCredentialsError") return "Přihlášení k AD selhalo – zkontrolujte účet (DN nebo UPN) a heslo.";
  if (/data 532|data 773/.test(m)) return "Heslo účtu pro čtení vypršelo nebo se musí změnit.";
  if (/data 533|data 775/.test(m)) return "Účet pro čtení je zakázaný nebo uzamčený.";
  if (/self[- ]signed|unable to verify|certificate/i.test(m)) return `Certifikát serveru není důvěryhodný (${m}). Vložte kořenový certifikát interní CA, nebo pro test vypněte ověřování.`;
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|timeout|ETIMEDOUT/i.test(m)) return `Server AD není dostupný (${m}). Zkontrolujte adresu, port 636 a firewall.`;
  return `Chyba LDAP: ${m}`;
}

export async function testAd(conn: AdConnection): Promise<{ users: number; groups: number }> {
  const client = await connect(conn);
  try {
    const base = conn.config.baseDn;
    const [u, g] = await Promise.all([
      client.search(base, { scope: "sub", filter: "(&(objectCategory=person)(objectClass=user))", attributes: ["cn"], paged: { pageSize: 1000 } }),
      client.search(base, { scope: "sub", filter: "(objectClass=group)", attributes: ["cn"], paged: { pageSize: 1000 } }),
    ]);
    return { users: u.searchEntries.length, groups: g.searchEntries.length };
  } catch (e) {
    throw new Error(adError(e));
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function fetchAd(conn: AdConnection, now = new Date()): Promise<{ accounts: DirAccount[]; notes: string[] }> {
  const client = await connect(conn);
  const { config } = conn;
  let users: Entry[];
  let groups: Entry[];
  try {
    [users, groups] = await Promise.all([
      client
        .search(config.baseDn, {
          scope: "sub",
          filter: "(&(objectCategory=person)(objectClass=user))",
          attributes: USER_ATTRS,
          explicitBufferAttributes: ["objectGUID", "objectSid"],
          paged: { pageSize: 500 },
        })
        .then((r) => r.searchEntries),
      client
        .search(config.baseDn, { scope: "sub", filter: "(objectClass=group)", attributes: GROUP_ATTRS, explicitBufferAttributes: ["objectSid"], paged: { pageSize: 500 } })
        .then((r) => r.searchEntries),
    ]);
  } catch (e) {
    throw new Error(adError(e));
  } finally {
    await client.unbind().catch(() => {});
  }
  return { accounts: buildAccounts(users, groups, config, now), notes: users.length ? [] : ["V zadané bázi (Base DN) nebyli nalezeni žádní uživatelé."] };
}

/** Převod záznamů LDAP na účty (samostatně kvůli testům). */
export function buildAccounts(users: Entry[], groups: Entry[], config: AdSourceConfig, now = new Date()): DirAccount[] {
  // skupiny: DN → {cn, privilegovaná, nadřazené skupiny}
  const g = new Map<string, { cn: string; privileged: boolean; parents: string[]; rid: number | null }>();
  for (const e of groups) {
    const a = lower(e);
    const dn = str(a, "distinguishedName") ?? e.dn;
    const sidBytes = buf(a, "objectSid");
    const sid = sidBytes ? sidToString(sidBytes) : "";
    const cn = str(a, "cn") ?? cnOf(dn);
    g.set(dnKey(dn), {
      cn,
      privileged: isPrivilegedAdGroup(sid, cn, config.extraPrivilegedGroups),
      parents: list(a, "memberOf").map(dnKey),
      rid: /^S-1-5-21-/.test(sid) ? Number(sid.split("-").at(-1)) : null,
    });
  }
  const byRid = new Map([...g].filter(([, x]) => x.rid !== null).map(([dn, x]) => [x.rid!, dn]));
  /** Tranzitivní uzávěr členství (ochrana proti cyklům). */
  const expand = (direct: string[]) => {
    const seen = new Set<string>();
    const stack = [...direct];
    while (stack.length) {
      const d = stack.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      for (const p of g.get(d)?.parents ?? []) stack.push(p);
    }
    return [...seen];
  };

  const out: DirAccount[] = [];
  for (const e of users) {
    const a = lower(e);
    const login = str(a, "sAMAccountName") ?? str(a, "userPrincipalName") ?? e.dn;
    if (SKIP_LOGINS.has(login.toLowerCase())) continue;
    const guid = buf(a, "objectGUID");
    const uac = Number(str(a, "userAccountControl") ?? 0);
    const expires = fromFileTime(str(a, "accountExpires"));
    const direct = list(a, "memberOf").map(dnKey);
    const primary = byRid.get(Number(str(a, "primaryGroupID") ?? 513));
    if (primary) direct.push(primary);
    const all = expand(direct);
    const spns = list(a, "servicePrincipalName");
    const privilegedVia = [...new Set(all.filter((d) => g.get(d)?.privileged).map((d) => g.get(d)!.cn))].sort();
    const isService = spns.length > 0 || /^(svc|srv|sa|service)[-_.]/i.test(login) || /,OU=[^,]*servis|,OU=[^,]*service/i.test(e.dn);
    out.push({
      externalId: guid ? guidToString(guid) : e.dn,
      login,
      displayName: str(a, "displayName") ?? login,
      email: (str(a, "mail") ?? str(a, "userPrincipalName"))?.toLowerCase() ?? null,
      kind: isService ? "service" : "user",
      enabled: !(uac & UAC.ACCOUNTDISABLE) && !(expires && expires < now),
      dn: e.dn,
      createdAt: fromGeneralizedTime(str(a, "whenCreated")),
      lastLogonAt: fromFileTime(str(a, "lastLogonTimestamp")),
      pwdLastSetAt: fromFileTime(str(a, "pwdLastSet")),
      signInKnown: true,
      flags: {
        pwdNeverExpires: !!(uac & UAC.DONT_EXPIRE_PASSWORD),
        pwdNotRequired: !!(uac & UAC.PASSWD_NOTREQD),
        preauthDisabled: !!(uac & UAC.DONT_REQ_PREAUTH),
        hasSpn: spns.length > 0,
        unconstrainedDelegation: !!(uac & UAC.TRUSTED_FOR_DELEGATION),
      },
      mfa: null,
      privilegedVia,
      groups: all.map((d) => g.get(d)?.cn ?? cnOf(d)).slice(0, 500),
      department: str(a, "department"),
      title: str(a, "title"),
    });
  }
  return out;
}

/* ============================================================
 * Přihlášení účtem AD (ADR-078): účet pro čtení najde uživatele, heslo ověří bind pod jeho DN.
 * Prázdné heslo se odmítá vždy (anonymní bind by v LDAP „uspěl“). Do filtru jen escapované hodnoty.
 * ============================================================ */

export interface AdIdentity {
  guid: string;
  dn: string;
  login: string;
  upn: string | null;
  email: string | null;
  displayName: string;
  /** Skupiny včetně vnořených – CN i DN. */
  groups: string[];
}

export type AdAuthResult = { ok: true; identity: AdIdentity } | { ok: false; reason: "not_found" | "ambiguous" | "bad_password" | "disabled" | "password_expired" | "locked" | "error"; message?: string };

export type AdAuthenticator = (conn: AdConnection, login: string, password: string) => Promise<AdAuthResult>;

const bindReason = (e: unknown): "bad_password" | "password_expired" | "locked" | "disabled" | "error" => {
  const m = (e as Error)?.message ?? String(e);
  if (/data 532|data 773/.test(m)) return "password_expired";
  if (/data 775/.test(m)) return "locked";
  if (/data 533|data 701/.test(m)) return "disabled";
  const code = (e as { code?: number })?.code;
  if (code === 49 || /52e|invalid ?credentials/i.test(m) || (e as Error)?.constructor?.name === "InvalidCredentialsError") return "bad_password";
  return "error";
};

export const authenticateAd: AdAuthenticator = async (conn, loginName, password) => {
  if (!password) return { ok: false, reason: "bad_password" };
  const name = parseLoginName(loginName);
  if (!name.value) return { ok: false, reason: "not_found" };
  const v = ldapEscape(name.value);
  const filter =
    name.kind === "sam"
      ? `(&(objectCategory=person)(objectClass=user)(sAMAccountName=${v}))`
      : `(&(objectCategory=person)(objectClass=user)(|(userPrincipalName=${v})(mail=${v})))`;
  let client: Client;
  try {
    client = await connect(conn);
  } catch (e) {
    return { ok: false, reason: "error", message: (e as Error).message };
  }
  try {
    const found = (
      await client.search(conn.config.baseDn, { scope: "sub", filter, sizeLimit: 2, attributes: ["objectGUID", "sAMAccountName", "userPrincipalName", "mail", "displayName", "userAccountControl", "accountExpires"], explicitBufferAttributes: ["objectGUID"] })
    ).searchEntries;
    if (!found.length) return { ok: false, reason: "not_found" };
    if (found.length > 1) return { ok: false, reason: "ambiguous" };
    const e = found[0]!;
    const a = lower(e);
    const uac = Number(str(a, "userAccountControl") ?? 0);
    const expires = fromFileTime(str(a, "accountExpires"));
    if (uac & UAC.ACCOUNTDISABLE || (expires && expires < new Date())) return { ok: false, reason: "disabled" };

    // ověření hesla vlastním spojením pod DN uživatele
    const userClient = new Client({
      url: conn.config.url.replace(/\/$/, ""),
      timeout: 20_000,
      connectTimeout: 10_000,
      ...(conn.config.url.startsWith("ldaps://") ? { tlsOptions: { rejectUnauthorized: conn.config.verifyTls, ...(conn.config.caCert ? { ca: [conn.config.caCert] } : {}) } } : {}),
    });
    try {
      await userClient.bind(e.dn, password);
    } catch (err) {
      const reason = bindReason(err);
      return { ok: false, reason, ...(reason === "error" ? { message: adError(err) } : {}) };
    } finally {
      await userClient.unbind().catch(() => {});
    }

    // skupiny včetně vnořených (LDAP_MATCHING_RULE_IN_CHAIN)
    const groups = (
      await client.search(conn.config.baseDn, { scope: "sub", filter: `(&(objectClass=group)(member:1.2.840.113556.1.4.1941:=${ldapEscape(e.dn)}))`, attributes: ["cn"], paged: { pageSize: 500 } })
    ).searchEntries.flatMap((g) => [cnOf(g.dn), g.dn]);
    const guid = buf(a, "objectGUID");
    const login = str(a, "sAMAccountName") ?? name.value;
    const upn = str(a, "userPrincipalName")?.toLowerCase() ?? null;
    return {
      ok: true,
      identity: {
        guid: guid ? guidToString(guid) : e.dn,
        dn: e.dn,
        login,
        upn,
        email: str(a, "mail")?.toLowerCase() ?? upn,
        displayName: str(a, "displayName") ?? login,
        groups: [...new Set(groups)],
      },
    };
  } catch (e) {
    return { ok: false, reason: "error", message: adError(e) };
  } finally {
    await client.unbind().catch(() => {});
  }
};
