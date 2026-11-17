/**
 * Výkonnostní test s realistickým objemem dat (před předáním zákazníkovi).
 *   LOAD_DATABASE_URL=postgres://contix:contix@localhost:5432/contix_load bun src/scripts/load-test.ts
 * Databáze (název musí končit na _load) se vytvoří znovu, naplní a změří se odezva hlavních přehledů API.
 * Volitelně LOAD_SCALE=2 (násobek objemu). Spojení jako v provozu (JIT vypnutý, `db/client.ts`).
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createApp } from "../app";
import { createAdmin, ensureSystemRoles } from "../auth/service";
import type { Config } from "../config";
import * as schema from "../db/schema";

const url = process.env.LOAD_DATABASE_URL ?? "";
const name = url ? new URL(url).pathname.slice(1) : "";
if (!name.endsWith("_load")) {
  console.error("Nastavte LOAD_DATABASE_URL s databází končící na _load.");
  process.exit(1);
}
const K = Number(process.env.LOAD_SCALE ?? 1);
const N = { users: 300 * K, units: 30, assets: 5000 * K, vulnsPerAsset: 8, risks: 800 * K, policies: 300 * K };

const root = postgres(url.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
await root.unsafe(`drop database if exists "${name}" with (force)`);
await root.unsafe(`create database "${name}"`);
await root.end();

const client = postgres(url, { max: 10, onnotice: () => {}, connection: { jit: "off" } });
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
await ensureSystemRoles(db);
const PASSWORD = "Load-Test-Heslo-2026!";
await createAdmin(db, "admin@load.test", "Admin", PASSWORD);

const t0 = Date.now();
const chunk = async <T>(rows: T[], f: (part: T[]) => Promise<unknown>, size = 1000) => {
  for (let i = 0; i < rows.length; i += size) await f(rows.slice(i, i + size));
};
const pick = <T>(a: readonly T[], i: number) => a[i % a.length]!;

// organizace a uživatelé
const [employee] = await db.select().from(schema.roles).where(eq(schema.roles.key, "employee"));
const units = await db
  .insert(schema.orgUnits)
  .values(Array.from({ length: N.units }, (_, i) => ({ name: `Útvar ${i + 1}` })))
  .returning({ id: schema.orgUnits.id });
const users = await db
  .insert(schema.users)
  .values(Array.from({ length: N.users }, (_, i) => ({ email: `user${i}@load.test`, displayName: `Uživatel ${i}` })))
  .returning({ id: schema.users.id });
await db.insert(schema.userRoles).values(users.map((u) => ({ userId: u.id, roleId: employee!.id, source: "manual" as const })));
const positions = await db
  .insert(schema.positions)
  .values(users.map((_, i) => ({ orgUnitId: pick(units, i).id, name: `Místo ${i}`, isManager: i < N.units })))
  .returning({ id: schema.positions.id });
await db.insert(schema.positionHolders).values(users.map((u, i) => ({ positionId: positions[i]!.id, userId: u.id })));

// aktiva a zranitelnosti
const types = ["server", "workstation", "laptop", "network_device", "application", "database"] as const;
const assetIds: string[] = [];
await chunk(
  Array.from({ length: N.assets }, (_, i) => ({ name: `AST-${i}`, assetType: pick(types, i), hostname: `host-${i}`, ipAddresses: [`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`], osName: i % 3 ? "Windows Server 2019" : "Ubuntu 22.04" })),
  async (part) => assetIds.push(...(await db.insert(schema.assets).values(part).returning({ id: schema.assets.id })).map((x) => x.id)),
);
const sev = ["critical", "high", "medium", "low"] as const;
await chunk(
  assetIds.flatMap((a, i) => Array.from({ length: N.vulnsPerAsset }, (_, k) => ({ assetId: a, cveId: `CVE-2025-${(i * 7 + k) % 9000}`, severity: pick(sev, i + k), cvssScore: 5 + ((i + k) % 5), packageName: `pkg${k}` }))),
  (part) => db.insert(schema.assetVulnerabilities).values(part),
  2000,
);

// technické závislosti aktiv (graf, analýza odolnosti): každé aktivum závisí na dvou „nižších“
await chunk(
  assetIds.flatMap((a, i) => (i < 10 ? [] : [{ fromId: a, toId: assetIds[Math.floor(i / 2)]! }, { fromId: a, toId: assetIds[i % 10]! }]).filter((d) => d.fromId !== d.toId)),
  (part) => db.insert(schema.assetDependencies).values(part).onConflictDoNothing(),
  2000,
);

// rizika
await chunk(
  Array.from({ length: N.risks }, (_, i) => ({ code: `R-${i}`, name: `Riziko ${i}`, ownerPositionId: pick(positions, i).id, impact: 1 + (i % 4), threatLevel: 1 + (i % 4), vulnLevel: 1 + ((i + 1) % 4) })),
  (part) => db.insert(schema.risks).values(part),
);

// dokumentace: platné verze, okruh = všichni / útvar, polovina seznámena
const pols = await db
  .insert(schema.policies)
  .values(Array.from({ length: N.policies }, (_, i) => ({ code: `SM-${i}`, title: `Směrnice ${i}`, status: "active" as const, audience: i % 3 ? { all: false, unitIds: [pick(units, i).id], positionIds: [], securityRoles: [], management: false } : { all: true, unitIds: [], positionIds: [], securityRoles: [], management: false }, ownerPositionId: pick(positions, i).id })))
  .returning({ id: schema.policies.id });
const versions = await db
  .insert(schema.policyVersions)
  .values(pols.map((p) => ({ policyId: p.id, version: "1.0", status: "approved" as const, approvedAt: new Date(), content: "# Text\n\nObsah směrnice." })))
  .returning({ id: schema.policyVersions.id });
await chunk(
  versions.flatMap((v, i) => (i % 2 ? [] : users.filter((_, k) => k % 2 === 0).map((u) => ({ versionId: v.id, userId: u.id })))),
  (part) => db.insert(schema.policyAcknowledgements).values(part),
  5000,
);
// nálezy testů a sběrače (v1.70): třetina serverů s nálezy testů, pětina s inventářem a nálezy konfigurace, úkoly k vysokým
const [scope] = await db.insert(schema.secTestScopes).values({ name: "Load", targets: ["10.0.0.0/8"], validFrom: "2026-01-01", validTo: "2099-12-31", authorization: "Load test", approvedAt: new Date() }).returning();
const [run] = await db.insert(schema.secTestRuns).values({ scopeId: scope!.id, testId: "net.ports", status: "done", source: "import", targets: [] }).returning();
const fsev = ["critical", "high", "medium", "low"] as const;
const stRows = assetIds.flatMap((a, i) => (i % 3 ? [] : Array.from({ length: 3 }, (_, k) => ({ key: `ld-${i}-${k}`, runId: run!.id, testId: "net.ports", code: `port.${k}`, severity: pick(fsev, i + k), title: `Otevřený port ${k}`, host: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, port: 20 + k, assetId: a, status: k === 2 ? "fixed" : "open", fixedAt: k === 2 ? new Date() : null }))));
await chunk(stRows, (part) => db.insert(schema.secTestFindings).values(part), 2000);
const [conn] = await db.insert(schema.connections).values({ kind: "collector", name: "Load" }).returning();
const invIds: { id: string; assetId: string }[] = [];
await chunk(
  assetIds.filter((_, i) => i % 5 === 0).map((a, i) => ({ connectionId: conn!.id, assetId: a, hostKey: `ld-${i}`, hostname: `host-ld-${i}`, collectedAt: new Date(), data: {}, findings: [] })),
  async (part) => invIds.push(...(await db.insert(schema.hostInventories).values(part).returning({ id: schema.hostInventories.id, assetId: schema.hostInventories.assetId })).map((x) => ({ id: x.id, assetId: x.assetId! }))),
);
await chunk(
  invIds.flatMap((v, i) => [{ inventoryId: v.id, assetId: v.assetId, key: `k1-${i}`, code: "uid0_user", severity: "high", subject: "svc" }, { inventoryId: v.id, assetId: v.assetId, key: `k2-${i}`, code: "fw_not_persistent", severity: "medium", subject: null }]),
  (part) => db.insert(schema.hostFindings).values(part),
  2000,
);
console.log(`Data: ${N.users} uživatelů, ${N.assets} aktiv, ${N.assets * N.vulnsPerAsset} zranitelností, ${N.risks} rizik, ${N.policies} dokumentů – ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// měření
const config: Config = {
  NODE_ENV: "test",
  PORT: 0,
  DATABASE_URL: url,
  CORS_ORIGINS: ["http://load.test"],
  APP_URL: "http://load.test",
  APP_SECRET: "load-secret-load-secret-load-secret-42",
  WAZUH_VERIFY_TLS: true,
  SCAN_ENABLED: false,
  SCAN_ALLOWED_CIDRS: [],
  NMAP_PATH: "nmap",
  OIDC_LABEL: "SSO",
  OIDC_SCOPES: "openid",
};
const app = createApp({ db, config });
let cookie = "";
const req = async (path: string, init: RequestInit = {}) => {
  const res = await app.request(path, { ...init, headers: { origin: "http://load.test", "content-type": "application/json", ...(cookie ? { cookie } : {}) } });
  const sc = res.headers.get("set-cookie")?.match(/contix_session=([^;]*)/);
  if (sc) cookie = `contix_session=${sc[1]}`;
  return res;
};
await req("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "admin@load.test", password: PASSWORD }) });

const endpoints = [
  "/api/dashboard",
  "/api/assets",
  "/api/vulnerabilities",
  "/api/risks",
  "/api/policies",
  "/api/policies/portal",
  "/api/notifications/mine",
  "/api/notifications/team",
  "/api/org",
  "/api/admin/users",
  "/api/vulnerabilities/fix-plan",
  "/api/assets/graph",
  "/api/assets/resilience",
  "/api/exceptions",
  "/api/actions",
  "/api/soc/hosts",
  "/api/guides",
  "/api/guides/risks",
  "/api/guides/policies",
  "/api/guides/audit",
  "/api/findings",
  "/api/findings?who=mine",
  "/api/findings/remediation",
  "/api/reports/management",
  "/api/quality",
  "/api/findings?limit=300",
  "/api/findings?status=all",
  "/api/findings?source=vulnerability",
  "/api/findings/escalations",
  "/api/findings/plan",
  "/api/trends",
];
console.log("\nEndpoint                          stav   1. dotaz   2. dotaz   velikost");
for (const e of endpoints) {
  const a = performance.now();
  const r1 = await req(e);
  const body = await r1.arrayBuffer();
  const b = performance.now();
  await (await req(e)).arrayBuffer();
  const c = performance.now();
  console.log(`${e.padEnd(34)}${String(r1.status).padEnd(7)}${`${(b - a).toFixed(0)} ms`.padStart(8)}${`${(c - b).toFixed(0)} ms`.padStart(11)}${`${(body.byteLength / 1024).toFixed(0)} kB`.padStart(11)}`);
}
await client.end();
