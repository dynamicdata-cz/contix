import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
// @ts-expect-error – ldapjs nemá typy; jen jako mock LDAP serveru v testech
import ldap from "ldapjs";
import postgres from "postgres";
import { createApp } from "../src/app";
import { createAdmin, ensureSystemRoles } from "../src/auth/service";
import type { Config } from "../src/config";
import * as schema from "../src/db/schema";
import { processIdentitySync } from "../src/modules/identity/service";

/**
 * Identita a přístupy (v0.28): mock Active Directory (LDAP) a mock Microsoft Graph.
 * Spuštění: TEST_DATABASE_URL=… bun test (databázi vyprázdní).
 */
const url = process.env.TEST_DATABASE_URL;
const APP = "http://localhost:5173";
const PW = "Spravne-Heslo-2026!";
const DAY = 86_400_000;
const BASE = "DC=firma,DC=local";

/* ---------- mock AD ---------- */
const domainSid = (rid: number) => {
  const b = Buffer.from([1, 5, 0, 0, 0, 0, 0, 5, 21, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0]);
  b.writeUInt32LE(rid, 24);
  return b;
};
const builtinSid = (rid: number) => {
  const b = Buffer.from([1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0, 0, 0, 0]);
  b.writeUInt32LE(rid, 12);
  return b;
};
const fileTime = (daysAgo: number) => String((BigInt(Date.now() - daysAgo * DAY) + 11_644_473_600_000n) * 10_000n);
const genTime = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().replace(/[-:T]/g, "").slice(0, 14) + ".0Z";
const guid = (n: number) => Buffer.from(Array.from({ length: 16 }, (_, i) => (i === 15 ? n : i)));

const g = (cn: string, sid: Buffer, memberOf: string[] = [], ou = "CN=Users") => ({
  dn: `CN=${cn},${ou},${BASE}`,
  attributes: { cn, distinguishedName: `CN=${cn},${ou},${BASE}`, objectSid: sid, memberOf, objectClass: ["top", "group"] },
});
const DA = `CN=Domain Admins,CN=Users,${BASE}`;
const ADMINS = `CN=Administrators,CN=Builtin,${BASE}`;
const IT = `CN=IT Admins,OU=Groups,${BASE}`;
const groups = [g("Administrators", builtinSid(544), [], "CN=Builtin"), g("Domain Admins", domainSid(512), [ADMINS]), g("Domain Users", domainSid(513)), g("IT Admins", domainSid(1105), [DA], "OU=Groups"), g("Účetní", domainSid(1200), [], "OU=Groups")];

type U = { sam: string; n: number; uac: number; logon?: number; pwd?: number; created?: number; memberOf?: string[]; spn?: string[]; mail?: string; primary?: number; ou?: string };
const u = (x: U) => ({
  dn: `CN=${x.sam},${x.ou ?? "OU=Lide"},${BASE}`,
  attributes: {
    objectClass: ["top", "person", "organizationalPerson", "user"],
    objectGUID: guid(x.n),
    objectSid: domainSid(2000 + x.n),
    sAMAccountName: x.sam,
    userPrincipalName: `${x.sam}@firma.local`,
    displayName: `Jméno ${x.sam}`,
    ...(x.mail ? { mail: x.mail } : {}),
    userAccountControl: String(x.uac),
    ...(x.logon !== undefined ? { lastLogonTimestamp: fileTime(x.logon) } : { lastLogonTimestamp: "0" }),
    pwdLastSet: fileTime(x.pwd ?? 10),
    whenCreated: genTime(x.created ?? 400),
    memberOf: x.memberOf ?? [],
    ...(x.spn ? { servicePrincipalName: x.spn } : {}),
    primaryGroupID: String(x.primary ?? 513),
    accountExpires: "9223372036854775807",
    department: "IT",
  },
});
const directory = {
  users: [
    u({ sam: "admin.novak", n: 1, uac: 512, logon: 200, pwd: 400, memberOf: [IT] }), // vnořeně Domain Admins → neaktivní privilegovaný + staré heslo
    u({ sam: "jana.svobodova", n: 2, uac: 512, logon: 5, mail: "jana@firma.cz" }), // v CONTIXu deaktivovaná
    u({ sam: "svc_sql", n: 3, uac: 512 | 0x10000, logon: 1, spn: ["MSSQLSvc/sql01.firma.local:1433"] }), // kerberoasting + heslo bez expirace
    u({ sam: "petr.odesel", n: 4, uac: 514, logon: 500 }), // zakázaný – bez nálezů
    u({ sam: "test.user", n: 5, uac: 512, created: 60 }), // nikdy se nepřihlásil
    u({ sam: "legacy", n: 6, uac: 512 | 0x20 | 0x400000, logon: 2 }), // bez hesla + bez předautentizace
    u({ sam: "admin.dvorak", n: 7, uac: 512, logon: 1, primary: 512 }), // Domain Admins jako primární skupina
    u({ sam: "krbtgt", n: 8, uac: 514 }),
  ],
};
let binds = 0;
const ldapServer = ldap.createServer();
ldapServer.bind(BASE, (req: any, res: any, next: any) => {
  binds++;
  if (req.dn.toString().toLowerCase() !== "cn=contix-read,ou=servis,dc=firma,dc=local" || req.credentials !== "ad-heslo") return next(new ldap.InvalidCredentialsError());
  res.end();
  return next();
});
ldapServer.search(BASE, (req: any, res: any, next: any) => {
  const f = req.filter.toString().toLowerCase();
  const list = f.includes("objectclass=group") ? groups : directory.users;
  // ldapjs filtruje požadované atributy porovnáním s malými písmeny – seznam proto převedeme (jako AD: atributy bez ohledu na velikost)
  res.attributes = res.attributes.map((a: string) => a.toLowerCase());
  for (const e of list) res.send({ dn: e.dn, attributes: { ...e.attributes } });
  res.end();
  return next();
});
const ldapPort = await new Promise<number>((resolve) => ldapServer.listen(0, "127.0.0.1", () => resolve(ldapServer.address().port)));

/* ---------- mock Microsoft Graph ---------- */
const graphState = { signIn: true, mfa: true, secureDenied: false };
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();
const graph = Bun.serve({
  port: 0,
  async fetch(req) {
    const p = new URL(req.url);
    if (p.pathname === "/tenant-1/oauth2/v2.0/token") {
      const f = new URLSearchParams(await req.text());
      if (f.get("client_secret") !== "entra-secret") return Response.json({ error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." }, { status: 401 });
      return Response.json({ access_token: "graph-token", token_type: "Bearer" });
    }
    if (req.headers.get("authorization") !== "Bearer graph-token") return Response.json({ error: { message: "unauthorized" } }, { status: 401 });
    if (p.pathname === "/v1.0/users") {
      const sel = p.searchParams.get("$select") ?? "";
      if (sel.includes("signInActivity") && !graphState.signIn) return Response.json({ error: { code: "Authorization_RequestDenied", message: "Neither tenant is B2C or tenant doesn't have premium license" } }, { status: 403 });
      const all = [
        { id: "e1", displayName: "Globální admin", userPrincipalName: "ga@firma.cz", mail: "ga@firma.cz", accountEnabled: true, userType: "Member", createdDateTime: iso(500), lastPasswordChangeDateTime: iso(30), signInActivity: { lastSignInDateTime: iso(2) } },
        { id: "e2", displayName: "Host", userPrincipalName: "host_ext#EXT#@firma.onmicrosoft.com", mail: "host@partner.cz", accountEnabled: true, userType: "Guest", createdDateTime: iso(300), signInActivity: { lastSignInDateTime: iso(150) } },
        { id: "e3", displayName: "Běžný", userPrincipalName: "bezny@firma.cz", accountEnabled: true, userType: "Member", createdDateTime: iso(300), signInActivity: { lastSignInDateTime: iso(1) } },
        { id: "e4", displayName: "Cloud účet", userPrincipalName: "cloud@firma.cz", accountEnabled: true, userType: "Member", createdDateTime: iso(300), passwordPolicies: "DisablePasswordExpiration", onPremisesSyncEnabled: null, signInActivity: { lastSignInDateTime: iso(3) } },
      ];
      // stránkování: první stránka 2 záznamy
      if (!p.searchParams.get("page")) return Response.json({ value: all.slice(0, 2), "@odata.nextLink": `${p.origin}/v1.0/users?page=2&$select=${encodeURIComponent(sel)}` });
      return Response.json({ value: all.slice(2) });
    }
    if (p.pathname === "/v1.0/reports/authenticationMethods/userRegistrationDetails") {
      if (!graphState.mfa) return Response.json({ error: { message: "forbidden" } }, { status: 403 });
      return Response.json({ value: [{ id: "e1", isMfaRegistered: false }, { id: "e2", isMfaRegistered: false }, { id: "e3", isMfaRegistered: true }, { id: "e4", isMfaRegistered: true }] });
    }
    if (p.pathname === "/v1.0/security/secureScores") {
      if (graphState.secureDenied) return Response.json({ error: { code: "Forbidden", message: "Insufficient privileges" } }, { status: 403 });
      return Response.json({ value: [{ currentScore: 55, maxScore: 100, createdDateTime: "2026-10-22T00:00:00Z", controlScores: [{ controlName: "MFARegistrationV2", score: 2 }, { controlName: "AdminMFAV2", score: 10 }] }] });
    }
    if (p.pathname === "/v1.0/directoryRoles")
      return Response.json({
        value: [
          { id: "r1", displayName: "Global Administrator", roleTemplateId: "62e90394-69f5-4237-9190-012177145e10", members: [{ id: "e1" }] },
          { id: "r2", displayName: "Directory Readers", roleTemplateId: "88d8e3e3-8f55-4a1e-953a-9b9898b8876b", members: [{ id: "e3" }] },
        ],
      });
    return Response.json({ error: { message: "nf" } }, { status: 404 });
  },
});

describe.skipIf(!url)("Identity a přístupy (AD / Entra ID)", () => {
  const client = postgres(url ?? "postgres://invalid", { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema });
  const config: Config = {
    NODE_ENV: "test",
    PORT: 0,
    DATABASE_URL: url ?? "",
    CORS_ORIGINS: [APP],
    APP_URL: APP,
    APP_SECRET: "test-secret-test-secret-test-secret-42",
    WAZUH_VERIFY_TLS: true,
    SCAN_ENABLED: false,
    SCAN_ALLOWED_CIDRS: [],
    NMAP_PATH: "nmap",
    OIDC_LABEL: "SSO",
    OIDC_SCOPES: "openid",
    ENTRA_LOGIN_URL: `http://127.0.0.1:${graph.port}`,
    GRAPH_URL: `http://127.0.0.1:${graph.port}`,
  };
  const app = createApp({ db, config });

  function browser() {
    let cookie = "";
    const json = async (path: string, init: RequestInit & { json?: unknown } = {}) => {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("cookie", cookie);
      headers.set("origin", APP);
      let body = init.body;
      if (init.json !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(init.json);
      }
      const res = await app.request(path, { ...init, headers, body });
      const m = res.headers.get("set-cookie")?.match(/contix_session=([^;]*)/);
      if (m) cookie = m[1] ? `contix_session=${m[1]}` : "";
      const text = await res.text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      return { status: res.status, body: parsed, headers: res.headers };
    };
    return { json, login: (email: string) => json("/api/auth/login", { method: "POST", json: { email, password: PW } }) };
  }
  const admin = browser();
  const adInput = (over: Record<string, unknown> = {}) => ({
    kind: "ad",
    name: "Doména FIRMA",
    secret: "ad-heslo",
    syncHours: 24,
    policy: { staleDays: 90, guestStaleDays: 90, neverLoggedDays: 30, privilegedPwdDays: 365, maxPrivilegedMembers: 1 },
    config: { url: `ldap://127.0.0.1:${ldapPort}`, baseDn: BASE, bindDn: "CN=contix-read,OU=Servis,DC=firma,DC=local", verifyTls: true },
    ...over,
  });
  let adId = "";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
    await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    await ensureSystemRoles(db);
    await createAdmin(db, "admin@test.cz", "Admin", PW);
    expect((await admin.login("admin@test.cz")).status).toBe(200);
    // Jana odešla – v CONTIXu deaktivovaná
    const jana = await admin.json("/api/admin/users", { method: "POST", json: { email: "jana@firma.cz", displayName: "Jana", password: PW } });
    expect((await admin.json(`/api/admin/users/${jana.body.id}`, { method: "PATCH", json: { isActive: false } })).status).toBe(200);
  }, 60_000);
  afterAll(async () => {
    ldapServer.close();
    graph.stop(true);
    await client.end();
  });

  test("test připojení k AD: správné a špatné heslo", async () => {
    const ok = await admin.json("/api/identity/sources/test", { method: "POST", json: adInput() });
    expect(ok.body).toMatchObject({ ok: true });
    expect(ok.body.message).toContain("8 uživatelských účtů");
    const bad = await admin.json("/api/identity/sources/test", { method: "POST", json: adInput({ secret: "spatne" }) });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.message).toContain("Přihlášení k AD selhalo");
    // neplatná adresa
    expect((await admin.json("/api/identity/sources/test", { method: "POST", json: adInput({ config: { ...adInput().config, url: "http://dc" } }) })).status).toBe(400);
  });

  test("založení zdroje AD – tajemství se nevrací, bez hesla nejde", async () => {
    expect((await admin.json("/api/identity/sources", { method: "POST", json: adInput({ secret: undefined }) })).status).toBe(400);
    const r = await admin.json("/api/identity/sources", { method: "POST", json: adInput() });
    expect(r.status).toBe(201);
    expect(r.body.hasSecret).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("ad-heslo");
    adId = r.body.id;
    const [row] = await db.select().from(schema.identitySources);
    expect(row!.secretEnc).not.toContain("ad-heslo");
  });

  test("synchronizace AD: účty, privilegované skupiny (vnořené, primární, podle SID) a nálezy", async () => {
    const s = await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" });
    expect(s.status).toBe(200);
    expect(s.body.accounts).toBe(7); // krbtgt vynechán
    const acc = (await admin.json("/api/identity/accounts")).body as any[];
    const by = (sam: string) => acc.find((a) => a.login === sam);
    expect(by("admin.novak").privilegedVia).toEqual(["Administrators", "Domain Admins"]);
    expect(by("admin.dvorak").privilegedVia).toEqual(["Administrators", "Domain Admins"]);
    expect(by("jana.svobodova").privileged).toBe(false);
    expect(by("svc_sql").kind).toBe("service");
    expect(by("petr.odesel").enabled).toBe(false);
    expect(by("jana.svobodova").contixUser).toMatchObject({ active: false });
    expect(by("admin.novak").id).toMatch(/^[0-9a-f-]{36}$/);

    const f = (await admin.json("/api/identity/findings")).body as any[];
    const has = (rule: string, subject: string) => f.find((x) => x.rule === rule && x.subject === subject);
    expect(has("stale", "admin.novak")?.severity).toBe("critical");
    expect(has("privileged_pwd_old", "admin.novak")?.severity).toBe("high");
    expect(has("leaver", "jana.svobodova")?.severity).toBe("high");
    expect(has("kerberoastable", "svc_sql")?.severity).toBe("medium");
    expect(has("pwd_never_expires", "svc_sql")?.severity).toBe("medium");
    expect(has("never_logged_in", "test.user")?.severity).toBe("low");
    expect(has("pwd_not_required", "legacy")?.severity).toBe("high");
    expect(has("preauth_disabled", "legacy")?.severity).toBe("high");
    expect(has("privileged_group_size", "Domain Admins")?.detail).toContain("2 povolených členů");
    expect(f.some((x) => x.subject === "petr.odesel")).toBe(false);
    expect(f[0].severity).toBe("critical"); // řazení podle závažnosti

    const ov = (await admin.json("/api/identity/overview")).body;
    expect(ov.open.critical).toBe(1);
    expect(ov.privileged).toBe(2);
    expect(ov.sources[0]).toMatchObject({ lastStatus: "ok", stats: { accounts: 7, enabled: 6, privileged: 2 } });
    expect(ov.trend.length).toBe(1);
    expect(ov.byRule[0].severity).toBe("critical");

    // filtry účtů
    expect(((await admin.json("/api/identity/accounts?privileged=1")).body as any[]).map((a) => a.login).sort()).toEqual(["admin.dvorak", "admin.novak"]);
    expect(((await admin.json("/api/identity/accounts?q=svc_")).body as any[]).length).toBe(1);
    const detail = (await admin.json(`/api/identity/accounts/${by("admin.novak").id}`)).body;
    expect(detail.groups).toContain("IT Admins");
    expect(detail.findings.length).toBe(2);
  });

  test("výjimka a znovuotevření nálezu; CSV pro auditora", async () => {
    const f = ((await admin.json("/api/identity/findings?rule=kerberoastable")).body as any[])[0];
    const past = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    expect((await admin.json(`/api/identity/findings/${f.id}/accept`, { method: "POST", json: { reason: "Servisní účet SQL, heslo 30 znaků", until: past } })).status).toBe(400);
    const until = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10);
    const a = await admin.json(`/api/identity/findings/${f.id}/accept`, { method: "POST", json: { reason: "Servisní účet SQL, heslo 30 znaků", until } });
    expect(a.body).toMatchObject({ status: "accepted", acceptedByName: "Admin", acceptedUntil: until });
    expect(((await admin.json("/api/identity/findings?status=accepted")).body as any[]).length).toBe(1);
    // přehled výjimek – druh, odůvodnění, kdo, platnost
    const exc = (await admin.json("/api/exceptions")).body;
    expect(exc.items.find((e: any) => e.kind === "identity_finding")).toMatchObject({ reason: "Servisní účet SQL, heslo 30 znaků", acceptedByName: "Admin", until, state: "valid", link: "/identity?tab=findings&status=accepted" });
    const csv = await admin.json("/api/identity/findings.csv");
    expect(csv.headers.get("content-disposition")).toContain("attachment");
    expect(String(csv.body)).toContain("Neaktivní účet");
    expect(String(csv.body)).not.toContain("Uživatelský účet se SPN"); // výjimka není mezi otevřenými
    const log = await db.select().from(schema.auditLog).where(sql`action = 'identity.finding_accepted'`);
    expect(log.length).toBe(1);
  });

  test("druhá synchronizace: opravené nálezy se vyřeší, zmizelý účet se označí, výjimka zůstane", async () => {
    const svc = directory.users.find((x) => x.attributes.sAMAccountName === "svc_sql")!;
    directory.users = directory.users.filter((x) => x.attributes.sAMAccountName !== "legacy");
    svc.attributes.userAccountControl = "512"; // heslo s expirací, SPN zůstává (výjimka)
    const s = await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" });
    expect(s.body.removed).toBe(1);
    expect(s.body.findings.resolved).toBe(3); // pwd_never_expires + 2× legacy
    const resolved = (await admin.json("/api/identity/findings?status=resolved")).body as any[];
    expect(resolved.map((x) => x.rule).sort()).toEqual(["preauth_disabled", "pwd_never_expires", "pwd_not_required"]);
    expect(((await admin.json("/api/identity/findings?status=accepted")).body as any[])[0].rule).toBe("kerberoastable");
    expect(((await admin.json("/api/identity/accounts?removed=1")).body as any[]).map((a) => a.login)).toEqual(["legacy"]);
    const ov = (await admin.json("/api/identity/overview")).body;
    expect(ov.accepted).toBe(1);

    // vypršelá výjimka se při synchronizaci znovu otevře
    await db.update(schema.identityFindings).set({ acceptedUntil: "2020-01-01" }).where(sql`status = 'accepted'`);
    await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" });
    expect(((await admin.json("/api/identity/findings?rule=kerberoastable")).body as any[])[0].status).toBe("open");
  });

  test("Entra ID: privilegované role, MFA, hosté, stránkování; chybějící licence = poznámka, ne chyba", async () => {
    const input = { kind: "entra", name: "Tenant", secret: "entra-secret", config: { tenantId: "tenant-1", clientId: "app-1" } };
    const bad = await admin.json("/api/identity/sources/test", { method: "POST", json: { ...input, secret: "x" } });
    expect(bad.body).toMatchObject({ ok: false });
    expect(bad.body.message).toContain("tajný klíč");
    const ok = await admin.json("/api/identity/sources/test", { method: "POST", json: input });
    expect(ok.body).toMatchObject({ ok: true, notes: [] });

    const src = (await admin.json("/api/identity/sources", { method: "POST", json: input })).body;
    const s = await admin.json(`/api/identity/sources/${src.id}/sync`, { method: "POST" });
    expect(s.body.accounts).toBe(4);
    const f = ((await admin.json(`/api/identity/findings?sourceId=${src.id}`)).body as any[]).map((x) => `${x.rule}:${x.subject}:${x.severity}`).sort();
    expect(f).toEqual(["no_mfa:ga@firma.cz:critical", "pwd_never_expires:cloud@firma.cz:low", "stale:host_ext#EXT#@firma.onmicrosoft.com:medium"]);
    const ga = ((await admin.json(`/api/identity/accounts?sourceId=${src.id}&privileged=1`)).body as any[])[0];
    expect(ga).toMatchObject({ login: "ga@firma.cz", privilegedVia: ["Global Administrator"], mfa: false });

    // bez licence P1: poslední přihlášení ani MFA nejsou – nálezy se nevyhodnotí, zdroj má poznámky
    graphState.signIn = false;
    graphState.mfa = false;
    const s2 = await admin.json(`/api/identity/sources/${src.id}/sync`, { method: "POST" });
    expect(s2.status).toBe(200);
    expect(s2.body.notes.length).toBe(2);
    const open = ((await admin.json(`/api/identity/findings?sourceId=${src.id}`)).body as any[]).map((x) => x.rule);
    expect(open).toEqual(["pwd_never_expires"]);
    const t = await admin.json("/api/identity/sources/test", { method: "POST", json: input });
    expect(t.body.notes.length).toBe(2);
  });

  test("toxické kombinace (SoD): skupina AD × funkční místo, výjimka, vyřešení po změně obsazení", async () => {
    const roles = (await admin.json("/api/admin/roles")).body as any[];
    const employee = roles.find((x) => x.key === "employee").id;
    const novak = (await admin.json("/api/admin/users", { method: "POST", json: { email: "admin.novak@firma.local", displayName: "Petr Novák", password: PW, roleIds: [employee] } })).body;
    const vedouci = (await admin.json("/api/admin/users", { method: "POST", json: { email: "vedouci@test.cz", displayName: "Vedoucí IT", password: PW, roleIds: [employee] } })).body;
    await db.update(schema.users).set({ mustChangePassword: false });
    const me = (await admin.json("/api/auth/me")).body.user;
    const unit = (await admin.json("/api/org/units", { method: "POST", json: { name: "IT" } })).body;
    const pos = async (name: string, holderIds: string[], isManager = false) => (await admin.json("/api/org/positions", { method: "POST", json: { orgUnitId: unit.id, name, holderIds, isManager } })).body.id as string;
    ids.mgr = await pos("Vedoucí IT", [vedouci.id], true);
    ids.admin = await pos("Správce sítě", [novak.id]);
    ids.pay = await pos("Schvalovatel plateb", [novak.id]);
    ids.owner = await pos("Vlastník AD", [me.id]);
    expect(ids.pay).toMatch(/^[0-9a-f-]{36}$/);
    await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" }); // spárování účtů s uživateli

    const groups = (await admin.json("/api/identity/groups")).body as any[];
    expect(groups.find((g) => g.name === "Domain Admins")).toMatchObject({ privileged: true, accounts: 2 });

    // neplatné pravidlo (prázdná strana)
    expect((await admin.json("/api/identity/sod/rules", { method: "POST", json: { name: "Prázdné", sideA: { groups: ["IT Admins"] }, sideB: {} } })).status).toBe(400);
    const r1 = await admin.json("/api/identity/sod/rules", { method: "POST", json: { name: "Správce domény nesmí schvalovat platby", severity: "critical", sideA: { groups: ["domain admins"] }, sideB: { positionIds: [ids.pay] } } });
    expect(r1.status).toBe(201);
    expect(r1.body.open).toBe(1);
    await admin.json("/api/identity/sod/rules", { method: "POST", json: { name: "IT × účetnictví", sideA: { groups: ["IT Admins"] }, sideB: { groups: ["Účetní"] } } });
    const v = (await admin.json("/api/identity/sod/violations")).body as any[];
    expect(v.length).toBe(1);
    expect(v[0]).toMatchObject({ person: "Jméno admin.novak", contixUserId: novak.id, severity: "critical", matchA: ["Domain Admins (Doména FIRMA)"], matchB: ["funkční místo Schvalovatel plateb"] });
    expect(v[0].accounts[0].login).toBe("admin.novak");
    const rules = (await admin.json("/api/identity/sod/rules")).body as any[];
    expect(rules.find((x) => x.id === r1.body.id)).toMatchObject({ open: 1, positionNames: { [ids.pay]: "Schvalovatel plateb" } });

    const until = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
    expect((await admin.json(`/api/identity/sod/violations/${v[0].id}/accept`, { method: "POST", json: { reason: "Přechodně do nástupu nového kolegy", until } })).body.status).toBe("accepted");
    const excSod = (await admin.json("/api/exceptions?kind=sod_violation")).body;
    expect(excSod.items).toHaveLength(1);
    expect(excSod.items[0]).toMatchObject({ kind: "sod_violation", state: "expiring", until, reason: "Přechodně do nástupu nového kolegy" });
    expect(excSod.summary.byState.expiring).toBeGreaterThanOrEqual(1);
    // blížící se konec platnosti = povinnost pro toho, kdo výjimku udělil (i v týmovém přehledu)
    const team = (await admin.json("/api/notifications/team")).body as any[];
    expect(team.some((o) => o.kind === "exception_expiry" && o.due === until)).toBe(true);

    // změna obsazení místa → po vyhodnocení vyřešeno
    expect((await admin.json(`/api/org/positions/${ids.pay}`, { method: "PATCH", json: { holderIds: [] } })).status).toBe(200);
    expect((await admin.json("/api/identity/sod/evaluate", { method: "POST" })).body.resolved).toBe(1);
    expect(((await admin.json("/api/identity/sod/violations?status=resolved")).body as any[]).length).toBe(1);
    ids.vedouci = vedouci.id;
  });

  test("přezkum přístupů: recenzent vedoucí útvaru, rozhodnutí, uzavření, protokol, povinnosti", async () => {
    const due = new Date(Date.now() + 14 * DAY).toISOString().slice(0, 10);
    const none = await admin.json("/api/identity/reviews", { method: "POST", json: { name: "Nic", groups: ["Neexistuje"], reviewerPositionId: ids.owner, dueDate: due } });
    expect(none.status).toBe(400);
    const r = await admin.json("/api/identity/reviews", { method: "POST", json: { name: "Privilegované účty Q4", sourceIds: [adId], privilegedOnly: true, reviewerMode: "manager", reviewerPositionId: ids.owner, dueDate: due } });
    expect(r.status).toBe(201);
    const rid = r.body.id;
    const items = r.body.items as any[];
    expect(items.map((i) => `${i.login}:${i.reviewerName}`).sort()).toEqual(["admin.dvorak:Vlastník AD", "admin.novak:Vedoucí IT"]);
    expect(items.find((i) => i.login === "admin.novak").access).toEqual(["Administrators", "Domain Admins"]);

    // vedoucí (bez identity:read) vidí jen své položky a má povinnost
    const ved = browser();
    await ved.login("vedouci@test.cz");
    const mine = (await ved.json("/api/notifications/mine")).body as any[];
    expect(mine.find((o) => o.kind === "access_review")).toMatchObject({ link: `/identity/reviews/${rid}`, due });
    expect(((await ved.json("/api/identity/reviews")).body as any[]).length).toBe(1);
    const d = (await ved.json(`/api/identity/reviews/${rid}`)).body;
    expect(d.items.map((i: any) => i.login)).toEqual(["admin.novak"]);
    expect(d.canDecideAll).toBe(false);
    expect((await ved.json(`/api/identity/reviews/${rid}/report.html`)).status).toBe(403);
    const dvorak = items.find((i) => i.login === "admin.dvorak");
    const novakItem = items.find((i) => i.login === "admin.novak");
    expect((await ved.json(`/api/identity/reviews/${rid}/items/${dvorak.id}/decide`, { method: "POST", json: { decision: "keep" } })).status).toBe(403);
    expect((await ved.json(`/api/identity/reviews/${rid}/items/${novakItem.id}/decide`, { method: "POST", json: { decision: "revoke" } })).status).toBe(400);
    const dec = await ved.json(`/api/identity/reviews/${rid}/items/${novakItem.id}/decide`, { method: "POST", json: { decision: "revoke", note: "Odebrat z Domain Admins, stačí IT Admins" } });
    expect(dec.body).toMatchObject({ decision: "revoke", decidedByName: "Vedoucí IT", remediated: false });

    // uzavřít lze až po rozhodnutí všech položek
    expect((await admin.json(`/api/identity/reviews/${rid}/close`, { method: "POST" })).status).toBe(409);
    await admin.json(`/api/identity/reviews/${rid}/items/${dvorak.id}/decide`, { method: "POST", json: { decision: "keep", note: "Správce domény" } });
    expect((await admin.json(`/api/identity/reviews/${rid}/items/${novakItem.id}/remediated`, { method: "POST", json: { done: true } })).body.remediated).toBe(true);
    const closed = (await admin.json(`/api/identity/reviews/${rid}/close`, { method: "POST" })).body;
    expect(closed).toMatchObject({ status: "closed", counts: { total: 2, keep: 1, revoke: 1, remediated: 1, pending: 0 } });
    expect((await ved.json(`/api/identity/reviews/${rid}/items/${novakItem.id}/decide`, { method: "POST", json: { decision: "keep" } })).status).toBe(409);
    expect(((await ved.json("/api/notifications/mine")).body as any[]).some((o) => o.kind === "access_review")).toBe(false);

    const html = await admin.json(`/api/identity/reviews/${rid}/report.html`);
    expect(String(html.body)).toContain("Protokol přezkumu přístupů");
    expect(String(html.body)).toContain("Odebrat z Domain Admins");
    const docx = await admin.json(`/api/identity/reviews/${rid}/report.docx`);
    expect(docx.status).toBe(200);
    expect(docx.headers.get("content-type")).toContain("wordprocessingml");
    const log = await db.select().from(schema.auditLog).where(sql`action like 'identity.review_%'`);
    expect(log.length).toBeGreaterThanOrEqual(5);
  });

  test("synchronizace uživatelů a struktury: náhled, založení, místa, deaktivace", async () => {
    // bez skupiny nelze zapnout
    expect((await admin.json(`/api/identity/sources/${adId}`, { method: "PUT", json: adInput({ secret: undefined, provisioning: { enabled: true, group: "" } }) })).status).toBe(400);
    expect((await admin.json(`/api/identity/sources/${adId}`, { method: "PUT", json: adInput({ secret: undefined, provisioning: { enabled: true, group: "domain users", defaultRoleKey: "neexistuje" } }) })).status).toBe(400);
    const prev = (await admin.json(`/api/identity/sources/${adId}/provisioning`)).body;
    expect(prev.create.map((x: any) => x.email).sort()).toEqual([]); // skupina zatím nezadaná → nic
    const put = await admin.json(`/api/identity/sources/${adId}`, { method: "PUT", json: adInput({ secret: undefined, provisioning: { enabled: true, group: "domain users" } }) });
    expect(put.body.provisioning).toMatchObject({ enabled: true, group: "domain users", defaultRoleKey: "employee" });
    const plan = (await admin.json(`/api/identity/sources/${adId}/provisioning`)).body;
    // admin.dvorak má jako primární skupinu Domain Admins – v Domain Users není (jako v AD)
    expect(plan.create.map((x: any) => x.email).sort()).toEqual(["test.user@firma.local"]);
    expect(plan.existing.map((x: any) => x.email)).toEqual(["admin.novak@firma.local"]); // ručně založený – nemění se; Jana (deaktivovaná) se vynechá
    expect(plan.units).toEqual(["IT"]);
    expect(plan.positions).toEqual([{ unit: "IT", name: "Pracovník" }]);

    const run = (await admin.json(`/api/identity/sources/${adId}/provisioning/run`, { method: "POST" })).body;
    expect(run).toMatchObject({ created: 1, unitsCreated: 0, positionsCreated: 1, holdersAdded: 2, deactivated: 0 });
    const [tu] = await db.select().from(schema.users).where(sql`email = 'test.user@firma.local'`);
    expect(tu).toMatchObject({ authProvider: "oidc", isActive: true, directorySourceId: adId, passwordHash: null });
    const tuRoles = await db.select().from(schema.userRoles).where(sql`user_id = ${tu!.id}`);
    expect(tuRoles.length).toBe(1);
    // opakovaně nic
    expect((await admin.json(`/api/identity/sources/${adId}/provisioning/run`, { method: "POST" })).body).toMatchObject({ created: 0, holdersAdded: 0, positionsCreated: 0 });

    // účet zakázán v AD → při synchronizaci se uživatel deaktivuje a uvolní místo; ručně založený zůstane
    const t = directory.users.find((x) => x.attributes.sAMAccountName === "test.user")!;
    t.attributes.userAccountControl = "514";
    const s1 = (await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" })).body;
    expect(s1.provisioning).toMatchObject({ deactivated: 1, holdersRemoved: 1 });
    const [tu2] = await db.select().from(schema.users).where(sql`email = 'test.user@firma.local'`);
    expect(tu2!.isActive).toBe(false);
    const [nv] = await db.select().from(schema.users).where(sql`email = 'admin.novak@firma.local'`);
    expect(nv!.isActive).toBe(true);
    t.attributes.userAccountControl = "512";
    const s2 = (await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" })).body;
    expect(s2.provisioning).toMatchObject({ reactivated: 1, holdersAdded: 1 });
    const log = await db.select().from(schema.auditLog).where(sql`action = 'identity.provisioned'`);
    expect(log.length).toBeGreaterThanOrEqual(3);
  });

  test("automatické testy opatření: kontrola účtů (CSV důkaz, účinnost) a uzavřený přezkum (protokol)", async () => {
    const ctl = (await admin.json("/api/controls", { method: "POST", json: { name: "Řízení přístupových oprávnění", status: "implemented", effectiveness: "effective" } })).body;
    const a = await admin.json("/api/identity/automations", { method: "POST", json: { controlId: ctl.id, kind: "identity_checks", sourceIds: [adId], maxCritical: 0, maxHigh: 5, applyEffectiveness: true } });
    expect(a.status).toBe(201);
    const run = await admin.json(`/api/identity/automations/${a.body.id}/run`, { method: "POST" });
    expect(run.body).toMatchObject({ lastResult: "ineffective", lastError: null });
    const [test] = await db.select().from(schema.controlTests).where(sql`id = ${run.body.lastTestId}`);
    expect(test).toMatchObject({ status: "completed", result: "ineffective", tester: "CONTIX – automatický test", methods: ["reperformance"] });
    expect(test!.conclusion).toContain("Překročena tolerance");
    const samples = await db.select().from(schema.controlTestSamples).where(sql`test_id = ${test!.id}`);
    expect(samples.length).toBe(11);
    expect(samples.find((x) => x.ref === "Neaktivní účet")?.result).toBe("fail");
    const [ev] = await db.select().from(schema.evidenceControls).where(sql`control_id = ${ctl.id}`);
    const [file] = await db.select().from(schema.evidenceFiles).where(sql`evidence_id = ${ev!.evidenceId}`);
    expect(Buffer.from(file!.content).toString()).toContain("Neaktivní účet");
    const [c1] = await db.select().from(schema.controls).where(sql`id = ${ctl.id}`);
    expect(c1!.effectiveness).toBe("ineffective");
    // test je vidět i v detailu opatření (modul ověřování)
    const tests = (await admin.json(`/api/assurance/tests?controlId=${ctl.id}`)).body;
    expect(JSON.stringify(tests)).toContain("Automatická kontrola účtů");

    // plánovač: v intervalu nic, po intervalu nový test
    const { processAutomations } = await import("../src/modules/identity/automations");
    expect(await processAutomations(db)).toEqual([]);
    expect((await db.select().from(schema.controlTests).where(sql`control_id = ${ctl.id}`)).length).toBe(1);
    await db.update(schema.controlAutomations).set({ lastRunAt: new Date(Date.now() - 40 * DAY) });
    await processAutomations(db);
    expect((await db.select().from(schema.controlTests).where(sql`control_id = ${ctl.id}`)).length).toBe(2);

    // přezkum přístupů → test s protokolem
    await admin.json("/api/identity/automations", { method: "POST", json: { controlId: ctl.id, kind: "access_review" } });
    const due = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
    const r = (await admin.json("/api/identity/reviews", { method: "POST", json: { name: "Rychlý přezkum", sourceIds: [adId], privilegedOnly: true, reviewerPositionId: ids.owner, dueDate: due } })).body;
    for (const i of r.items) await admin.json(`/api/identity/reviews/${r.id}/items/${i.id}/decide`, { method: "POST", json: { decision: "keep" } });
    await admin.json(`/api/identity/reviews/${r.id}/close`, { method: "POST" });
    const all = await db.select().from(schema.controlTests).where(sql`control_id = ${ctl.id}`);
    const rt = all.find((x) => x.title === "Přezkum přístupů: Rychlý přezkum");
    expect(rt).toMatchObject({ result: "effective", populationSize: 2 });
    const files = await db.select({ f: schema.evidenceFiles.filename, mime: schema.evidenceFiles.mime }).from(schema.evidenceFiles);
    expect(files.some((x) => x.mime === "text/html" && x.f.startsWith("prezkum-pristupu-"))).toBe(true);
    const list = (await admin.json("/api/identity/automations")).body as any[];
    expect(list.length).toBe(2);
    expect(list[0].controlName).toBe("Řízení přístupových oprávnění");
  });

  test("průběžné monitorování opatření: MFA, výjimka, Secure Score, privilegované účty, TLS, test za období, plánovač, oprávnění (ADR-096)", async () => {
    graphState.signIn = true;
    graphState.mfa = true;
    const entra = ((await admin.json("/api/identity/sources")).body as any[]).find((x) => x.kind === "entra");
    expect((await admin.json(`/api/identity/sources/${entra.id}/sync`, { method: "POST" })).status).toBe(200);
    const ctl = (await admin.json("/api/controls", { method: "POST", json: { name: "Vícefaktorové ověření", status: "implemented" } })).body;
    const mk = async (kind: string, params: Record<string, unknown> = {}, frequency = "daily") => {
      const r = await admin.json("/api/monitors", { method: "POST", json: { controlId: ctl.id, kind, frequency, params } });
      expect(r.status).toBe(201);
      return r.body;
    };
    // MFA: 2 ze 4 účtů bez MFA → 50 % → nesplněno
    const mfa = await mk("identity_mfa", { sourceId: entra.id, minPct: 100, maxCount: 999 });
    expect(mfa.params).toEqual({ minPct: 100, sourceId: entra.id }); // neznámé parametry se zahodí
    const r1 = (await admin.json(`/api/monitors/${mfa.id}/run`, { method: "POST" })).body;
    expect(r1).toMatchObject({ result: "fail", value: 50, threshold: 100, population: 4, exceptions: 2 });
    expect(r1.details.map((d: any) => d.ref).sort()).toEqual(["ga@firma.cz", "host_ext#EXT#@firma.onmicrosoft.com"]);
    // schválená výjimka nálezu „bez MFA“ se počítá jako vyhovující; práh 75 % → splněno
    const f = ((await admin.json(`/api/identity/findings?sourceId=${entra.id}`)).body as any[]).find((x) => x.rule === "no_mfa");
    await admin.json(`/api/identity/findings/${f.id}/accept`, { method: "POST", json: { reason: "Break-glass účet v trezoru", until: new Date(Date.now() + 300 * DAY).toISOString().slice(0, 10) } });
    await admin.json(`/api/monitors/${mfa.id}`, { method: "PUT", json: { controlId: ctl.id, kind: "identity_mfa", frequency: "daily", params: { sourceId: entra.id, minPct: 75 } } });
    expect((await admin.json(`/api/monitors/${mfa.id}/run`, { method: "POST" })).body).toMatchObject({ result: "pass", value: 75 });
    expect((await admin.json(`/api/monitors/${mfa.id}`, { method: "PUT", json: { controlId: ctl.id, kind: "eol_assets", params: {} } })).status).toBe(400);
    // Secure Score z Microsoft Graph; chybějící oprávnění = chyba, ne nesplněno
    const ss = await mk("m365_secure_score", { minPct: 50 });
    expect((await admin.json(`/api/monitors/${ss.id}/run`, { method: "POST" })).body).toMatchObject({ result: "pass", value: 55 });
    graphState.secureDenied = true;
    const ssErr = (await admin.json(`/api/monitors/${ss.id}/run`, { method: "POST" })).body;
    expect(ssErr.result).toBe("error");
    expect(ssErr.summary).toContain("SecurityEvents.Read.All");
    graphState.secureDenied = false;
    // privilegované účty nad tolerancí, TLS bez koncových bodů = chyba, s končícím certifikátem = nesplněno
    const pr = await mk("privileged_accounts", { maxCount: 0, sourceId: entra.id });
    expect((await admin.json(`/api/monitors/${pr.id}/run`, { method: "POST" })).body).toMatchObject({ result: "fail", value: 1 });
    const tls = await mk("tls_expiry", { warnDays: 30 });
    expect((await admin.json(`/api/monitors/${tls.id}/run`, { method: "POST" })).body.result).toBe("error");
    await db.insert(schema.tlsEndpoints).values({ host: "portal.firma.cz", port: 443, notAfter: new Date(Date.now() + 5 * DAY) });
    const tr = (await admin.json(`/api/monitors/${tls.id}/run`, { method: "POST" })).body;
    expect(tr).toMatchObject({ result: "fail", value: 1, population: 1 });
    expect(tr.details[0].ref).toBe("portal.firma.cz:443");
    // seznam: poslední výsledek, proužek, úspěšnost
    const list = (await admin.json(`/api/monitors?controlId=${ctl.id}`)).body as any[];
    expect(list.find((m) => m.id === mfa.id)).toMatchObject({ lastResult: "pass", passRate90: 50, controlName: "Vícefaktorové ověření" });
    expect(list.find((m) => m.id === mfa.id).recent.map((r: any) => r.result)).toEqual(["fail", "pass"]);
    // test za období: 9 z 10 denních běhů (pokrytí 90 %) bez výjimek = účinné; vzorky + CSV důkaz
    const runsIn = (from: string, results: string[]) => results.map((r, i) => ({ monitorId: mfa.id, runAt: new Date(new Date(`${from}T06:00:00Z`).getTime() + i * DAY), result: r as "pass", summary: `běh ${i}` }));
    await db.insert(schema.controlMonitorRuns).values(runsIn("2026-01-01", Array(9).fill("pass")));
    const pt = await admin.json(`/api/monitors/${mfa.id}/period-test`, { method: "POST", json: { from: "2026-01-01", to: "2026-01-10" } });
    expect(pt.status).toBe(201);
    expect(pt.body).toMatchObject({ runs: 9, expected: 10, passed: 9, gap: false, result: "effective" });
    const [t1] = await db.select().from(schema.controlTests).where(sql`id = ${pt.body.testId}`);
    expect(t1).toMatchObject({ status: "completed", kind: "operating", periodFrom: "2026-01-01", periodTo: "2026-01-10", monitorId: mfa.id, populationSize: 9 });
    expect((await db.select().from(schema.controlTestSamples).where(sql`test_id = ${t1!.id}`)).length).toBe(9);
    const [file] = await db.select().from(schema.evidenceFiles).where(sql`evidence_id = ${pt.body.evidenceId}`);
    expect(Buffer.from(file!.content).toString()).toContain("běh 8");
    // výpadek monitorování a chyba zdroje = výjimky
    await db.insert(schema.controlMonitorRuns).values(runsIn("2026-02-01", ["pass", "pass", "error", "pass", "pass"]));
    const pt2 = (await admin.json(`/api/monitors/${mfa.id}/period-test`, { method: "POST", json: { from: "2026-02-01", to: "2026-02-10", tolerable: 1 } })).body;
    expect(pt2).toMatchObject({ runs: 5, errors: 1, gap: true, exceptions: 2, result: "ineffective" });
    const s2 = await db.select().from(schema.controlTestSamples).where(sql`test_id = ${pt2.testId}`);
    expect(s2.filter((x) => x.result === "fail").map((x) => x.ref)).toContain("Výpadek monitorování");
    expect((await admin.json(`/api/monitors/${mfa.id}/period-test`, { method: "POST", json: { from: "2025-01-01", to: "2025-01-31" } })).status).toBe(409);
    // SOC 2: testy za období zprávy bez duplicit
    const { soc2MonitorTests, processMonitors } = await import("../src/modules/controls/monitors");
    const sm = await soc2MonitorTests(db, ctl.companyId, [ctl.id], "2026-01-01", "2026-01-10", null);
    expect(sm.skipped).toBe(1); // MFA už test za období má
    expect(sm.failed.length).toBe(3); // ostatní monitory v období neběžely
    // plánovač: v intervalu nic, po intervalu nový běh
    expect(await processMonitors(db, config)).toBe(0);
    await db.update(schema.controlMonitors).set({ lastRunAt: new Date(Date.now() - 2 * DAY) }).where(sql`id = ${pr.id}`);
    expect(await processMonitors(db, config)).toBe(1);
    // smazání jen bez historie
    expect((await admin.json(`/api/monitors/${mfa.id}`, { method: "DELETE" })).status).toBe(409);
    const fresh = await mk("eol_assets");
    expect((await admin.json(`/api/monitors/${fresh.id}`, { method: "DELETE" })).status).toBe(200);
    // čtenář bez oprávnění k identitám vidí výsledky, ale ne jména účtů
    const roles = (await admin.json("/api/admin/roles")).body as any[];
    await admin.json("/api/admin/users", { method: "POST", json: { email: "mon-emp@test.cz", displayName: "Mon", password: PW, roleIds: [roles.find((x) => x.key === "asset_owner").id] } });
    await db.update(schema.users).set({ mustChangePassword: false });
    const emp = browser();
    await emp.login("mon-emp@test.cz");
    const er = (await emp.json(`/api/monitors/${mfa.id}/runs`)).body as any[];
    expect(er.length).toBeGreaterThan(2);
    expect(er.every((r) => r.details.length === 0)).toBe(true);
    expect((await emp.json(`/api/monitors/${mfa.id}/run`, { method: "POST" })).status).toBe(403);
  });

  test("chyba připojení se zapíše ke zdroji; plánovač respektuje interval; oprávnění", async () => {
    const r = await admin.json(`/api/identity/sources/${adId}`, { method: "PUT", json: adInput({ secret: "spatne" }) });
    expect(r.status).toBe(200);
    expect((await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" })).status).toBe(502);
    const src = (await admin.json("/api/identity/sources")).body.find((x: any) => x.id === adId);
    expect(src).toMatchObject({ lastStatus: "error" });
    expect(src.lastError).toContain("Přihlášení k AD selhalo");
    const ops = (await admin.json("/api/ops/status")).body;
    expect(ops.checks.find((c: any) => c.key === "identity")).toMatchObject({ level: "error" });
    const dash = (await admin.json("/api/dashboard")).body;
    expect(dash.identity).toMatchObject({ sourceErrors: 1 });

    // plánovač: čerstvě synchronizované zdroje přeskočí, starší spustí
    await admin.json(`/api/identity/sources/${adId}`, { method: "PUT", json: adInput() });
    const before = binds;
    expect(await processIdentitySync(db, config)).toEqual([]);
    expect(binds).toBe(before);
    await db.update(schema.identitySources).set({ lastSyncAt: new Date(Date.now() - 25 * 3_600_000) });
    expect(await processIdentitySync(db, config)).toEqual([]);
    expect(binds).toBeGreaterThan(before);

    // zaměstnanec k identitám nemá přístup, auditor jen čte
    const roles = (await admin.json("/api/admin/roles")).body as any[];
    const role = (k: string) => roles.find((x) => x.key === k).id;
    await admin.json("/api/admin/users", { method: "POST", json: { email: "zam@test.cz", displayName: "Zaměstnanec", password: PW, roleIds: [role("employee")] } });
    await admin.json("/api/admin/users", { method: "POST", json: { email: "aud@test.cz", displayName: "Auditor", password: PW, roleIds: [role("auditor")] } });
    await db.update(schema.users).set({ mustChangePassword: false }); // jinak oprávnění až po změně hesla
    const zam = browser();
    await zam.login("zam@test.cz");
    expect((await zam.json("/api/identity/overview")).status).toBe(403);
    const aud = browser();
    await aud.login("aud@test.cz");
    expect((await aud.json("/api/identity/findings")).status).toBe(200);
    const fid = ((await aud.json("/api/identity/findings")).body as any[])[0].id;
    expect((await aud.json(`/api/identity/findings/${fid}/accept`, { method: "POST", json: { reason: "zkouška auditora", until: "2030-01-01" } })).status).toBe(403);
    expect((await aud.json("/api/identity/sources", { method: "POST", json: adInput() })).status).toBe(403);

    // prázdná odpověď adresáře nic nevyřeší ani neodstraní
    const saved = directory.users;
    directory.users = [];
    const empty = await admin.json(`/api/identity/sources/${adId}/sync`, { method: "POST" });
    expect(empty.status).toBe(502);
    expect(empty.body.error).toContain("nevrátil žádné účty");
    expect(((await admin.json(`/api/identity/accounts?sourceId=${adId}`)).body as any[]).length).toBe(6);
    directory.users = saved;

    // smazání zdroje smaže i účty a nálezy
    expect((await admin.json(`/api/identity/sources/${adId}`, { method: "DELETE" })).status).toBe(200);
    const left = await db.select().from(schema.identityAccounts).where(sql`source_id = ${adId}`);
    expect(left.length).toBe(0);
  });
});
