/** Inventář certifikátů a TLS (ADR-070): čtecí kontrola koncových bodů, nálezy při čtení, plánovaná kontrola jednou denně. */
import { certFindings, daysLeft, signatureAlgorithmOf, TlsEndpointInput, worstSeverity, type TlsEndpointDto, type TlsOverview, type TlsPolicy, type TlsScanResult } from "@contix/shared";
import { patchOf } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import tls from "node:tls";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, inScope, targetCompany } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, tlsEndpoints } from "../../db/schema";
import { acquireLease } from "../ops/lease";

type Ctx = Context<AppEnv>;
type Row = typeof tlsEndpoints.$inferSelect;

const CURVE_BITS: Record<string, number> = { prime256v1: 256, "P-256": 256, secp384r1: 384, "P-384": 384, secp521r1: 521, "P-521": 521, secp256k1: 256 };

/** Spojení TLS a rozbor certifikátu – nic se neodesílá kromě běžného handshake. */
export function probeTls(host: string, port: number, serverName: string, timeoutMs = 10_000): Promise<TlsScanResult> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: TlsScanResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(r);
    };
    const sock = tls.connect({ host, port, servername: isIP(serverName) ? undefined : serverName, rejectUnauthorized: false }, () => {
      try {
        const peer = sock.getPeerCertificate(true);
        if (!peer?.raw) return finish({ ok: false, error: "Server neposlal certifikát" });
        const x = new X509Certificate(peer.raw);
        const d = x.publicKey.asymmetricKeyDetails ?? {};
        const keyType = x.publicKey.asymmetricKeyType ?? null;
        const keyBits = d.modulusLength ?? (d.namedCurve ? (CURVE_BITS[d.namedCurve] ?? null) : keyType === "ed25519" ? 256 : keyType === "ed448" ? 456 : null);
        let selfSigned = false;
        try {
          selfSigned = x.subject === x.issuer && x.verify(x.publicKey);
        } catch {
          selfSigned = false;
        }
        const nameMatch = isIP(serverName) ? !!x.checkIP(serverName) : !!x.checkHost(serverName);
        finish({
          ok: true,
          protocol: sock.getProtocol() ?? null,
          cipher: sock.getCipher()?.name ?? null,
          subject: x.subject.replace(/\n/g, ", "),
          issuer: x.issuer.replace(/\n/g, ", "),
          sans: (x.subjectAltName ?? "")
            .split(/,\s*/)
            .map((s) => s.replace(/^(DNS|IP Address):/, ""))
            .filter(Boolean)
            .slice(0, 50),
          serial: x.serialNumber,
          fingerprint256: x.fingerprint256,
          notBefore: new Date(x.validFrom).toISOString(),
          notAfter: new Date(x.validTo).toISOString(),
          keyType: keyType === "ec" ? "EC" : keyType ? keyType.toUpperCase() : null,
          keyBits,
          sigAlg: signatureAlgorithmOf(new Uint8Array(peer.raw)),
          selfSigned,
          trusted: sock.authorized,
          trustError: sock.authorized ? null : String(sock.authorizationError ?? ""),
          nameMatch,
        });
      } catch (e) {
        finish({ ok: false, error: (e as Error).message.slice(0, 300) });
      }
    });
    sock.on("error", (e) => finish({ ok: false, error: e.message.slice(0, 300) }));
    const timer = setTimeout(() => finish({ ok: false, error: `Vypršel časový limit (${timeoutMs / 1000} s)` }), timeoutMs);
  });
}

let opensslPath: string | null | undefined;
/** Zda server přijme TLS 1.0 / 1.1 – jen přes openssl (je-li nainstalován); argumenty bez shellu, host ověřen HOST_RE. */
export async function legacyProbe(host: string, port: number, serverName: string): Promise<string[] | null> {
  if (opensslPath === undefined) opensslPath = Bun.which("openssl");
  if (!opensslPath) return null;
  const target = isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
  const out: string[] = [];
  for (const [flag, name] of [
    ["-tls1", "TLSv1.0"],
    ["-tls1_1", "TLSv1.1"],
  ] as const) {
    const args = [opensslPath, "s_client", "-connect", target, flag, "-cipher", "DEFAULT@SECLEVEL=0"];
    if (!isIP(serverName)) args.push("-servername", serverName);
    try {
      const p = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
      const kill = setTimeout(() => p.kill(), 8_000);
      const text = await new Response(p.stdout).text();
      clearTimeout(kill);
      await p.exited;
      if (/Cipher is (?!\(NONE\))[A-Z0-9-]+/.test(text) && /Protocol\s*:\s*TLSv1(\.1)?\b/.test(text)) out.push(name);
    } catch {
      return null;
    }
  }
  return out;
}

export interface TlsDeps {
  probe?: typeof probeTls;
  legacy?: typeof legacyProbe;
}

export async function scanEndpoint(db: Db, row: Row, deps: TlsDeps = {}): Promise<Row> {
  const name = row.serverName || row.host;
  const r = await (deps.probe ?? probeTls)(row.host, row.port, name);
  if (r.ok) r.legacyProtocols = await (deps.legacy ?? legacyProbe)(row.host, row.port, name).catch(() => null);
  const [u] = await db
    .update(tlsEndpoints)
    .set({ result: r, lastScanAt: new Date(), notAfter: r.ok && r.notAfter ? new Date(r.notAfter) : null, updatedAt: new Date() })
    .where(eq(tlsEndpoints.id, row.id))
    .returning();
  return u!;
}

/** Plánovaná kontrola: koncové body neskenované 24 h (dávka). */
export async function processTlsScans(db: Db, deps: TlsDeps = {}, batch = 50): Promise<number> {
  if (!(await acquireLease(db, "tls-scans", 30 * 60_000))) return 0;
  const due = await db
    .select()
    .from(tlsEndpoints)
    .where(and(eq(tlsEndpoints.enabled, true), or(isNull(tlsEndpoints.lastScanAt), lt(tlsEndpoints.lastScanAt, new Date(Date.now() - 24 * 3600_000)))))
    .orderBy(asc(tlsEndpoints.lastScanAt))
    .limit(batch);
  for (const row of due) await scanEndpoint(db, row, deps).catch((e) => console.error("Kontrola TLS:", row.host, (e as Error).message));
  return due.length;
}

/** Certifikáty před vypršením pro povinnosti (`cert_expiry`). */
export async function certExpiryItems(db: Db, companyIds: string[], horizonDays: number) {
  return db
    .select({ id: tlsEndpoints.id, companyId: tlsEndpoints.companyId, host: tlsEndpoints.host, port: tlsEndpoints.port, notAfter: tlsEndpoints.notAfter })
    .from(tlsEndpoints)
    .where(and(inArray(tlsEndpoints.companyId, companyIds), eq(tlsEndpoints.enabled, true), isNotNull(tlsEndpoints.notAfter), lt(tlsEndpoints.notAfter, new Date(Date.now() + horizonDays * 86_400_000))));
}

function dto(r: Row, assetName: string | null, policy: TlsPolicy, now = new Date()): TlsEndpointDto {
  const findings = r.enabled ? certFindings(r.result, policy, now) : [];
  return {
    id: r.id,
    companyId: r.companyId,
    host: r.host,
    port: r.port,
    serverName: r.serverName,
    assetId: r.assetId,
    assetName,
    note: r.note,
    enabled: r.enabled,
    lastScanAt: r.lastScanAt?.toISOString() ?? null,
    result: r.result ?? null,
    daysLeft: r.result ? daysLeft(r.result, now) : null,
    findings,
    severity: worstSeverity(findings),
  };
}

const CANDIDATE_TYPES = ["server", "virtual_machine", "network_device", "security_device", "application", "database", "saas_service", "cloud_resource", "storage", "business_service"];

export function certificateRoutes(db: Db, deps: TlsDeps = {}) {
  const Patch = patchOf(TlsEndpointInput.omit({ companyId: true }));
  const load = async (c: Ctx, id: string) => {
    const [r] = await db.select().from(tlsEndpoints).where(eq(tlsEndpoints.id, id));
    assertScope(c, r?.companyId, "Koncový bod nenalezen");
    return r!;
  };
  const one = async (r: Row) => {
    const policy = (await getSettings(db)).tlsPolicy;
    const name = r.assetId ? ((await db.select({ name: assets.name }).from(assets).where(eq(assets.id, r.assetId)))[0]?.name ?? null) : null;
    return dto(r, name, policy);
  };
  const assetOk = async (c: Ctx, assetId: string | null | undefined) => {
    if (!assetId) return;
    const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, assetId));
    assertScope(c, a?.companyId, "Aktivum nenalezeno");
  };
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "assets"))
    .get("/", requirePerm("assets:read"), async (c) => {
      const policy = (await getSettings(db)).tlsPolicy;
      const rows = await db.select({ e: tlsEndpoints, assetName: assets.name }).from(tlsEndpoints).leftJoin(assets, eq(assets.id, tlsEndpoints.assetId)).where(inScope(c, tlsEndpoints.companyId)).orderBy(asc(tlsEndpoints.notAfter), asc(tlsEndpoints.host));
      const endpoints = rows.map((x) => dto(x.e, x.assetName, policy));
      if (opensslPath === undefined) opensslPath = Bun.which("openssl");
      const out: TlsOverview = {
        endpoints,
        policy,
        summary: {
          total: endpoints.length,
          expired: endpoints.filter((e) => e.findings.some((f) => f.kind === "expired")).length,
          expiring: endpoints.filter((e) => e.findings.some((f) => f.kind === "expiring")).length,
          withFindings: endpoints.filter((e) => e.findings.length).length,
          unscanned: endpoints.filter((e) => !e.lastScanAt).length,
          legacyCheck: !!(deps.legacy ?? opensslPath),
        },
      };
      return c.json(out);
    })
    .get("/candidates", requirePerm("assets:write"), async (c) => {
      const existing = new Set((await db.select({ host: tlsEndpoints.host }).from(tlsEndpoints).where(inScope(c, tlsEndpoints.companyId))).map((x) => x.host));
      const rows = await db
        .select({ id: assets.id, name: assets.name, hostname: assets.hostname, fqdn: sql<string | null>`${assets.hostname}`, assetType: assets.assetType, companyId: assets.companyId })
        .from(assets)
        .where(and(inScope(c, assets.companyId), isNotNull(assets.hostname), inArray(sql`${assets.assetType}::text`, CANDIDATE_TYPES)))
        .orderBy(asc(assets.name))
        .limit(500);
      return c.json(rows.filter((a) => a.hostname && /^[a-z0-9.-]+$/i.test(a.hostname) && !existing.has(a.hostname.toLowerCase())).map(({ fqdn: _f, ...a }) => a));
    })
    .post("/", requirePerm("assets:write"), zValidator("json", TlsEndpointInput), async (c) => {
      const { companyId: requested, ...input } = c.req.valid("json");
      await assetOk(c, input.assetId);
      const companyId = targetCompany(c, requested, "assets:write");
      const [dup] = await db.select({ id: tlsEndpoints.id }).from(tlsEndpoints).where(and(eq(tlsEndpoints.companyId, companyId), eq(tlsEndpoints.host, input.host), eq(tlsEndpoints.port, input.port)));
      if (dup) throw new HTTPException(409, { message: "Koncový bod už v evidenci je" });
      const [r] = await db.insert(tlsEndpoints).values({ ...input, serverName: input.serverName || null, companyId }).returning();
      await audit(db, { c, user: currentUser(c), action: "tls.endpoint_created", entityType: "tls_endpoint", entityId: r!.id, details: { host: r!.host, port: r!.port } });
      return c.json(await one(r!), 201);
    })
    .patch("/:id", requirePerm("assets:write"), zValidator("json", Patch), async (c) => {
      const cur = await load(c, c.req.param("id"));
      const input = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined));
      await assetOk(c, input.assetId as string | null | undefined);
      const [r] = await db
        .update(tlsEndpoints)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(tlsEndpoints.id, cur.id))
        .returning();
      await audit(db, { c, user: currentUser(c), action: "tls.endpoint_updated", entityType: "tls_endpoint", entityId: cur.id, details: input });
      return c.json(await one(r!));
    })
    .delete("/:id", requirePerm("assets:write"), async (c) => {
      const cur = await load(c, c.req.param("id"));
      await db.delete(tlsEndpoints).where(eq(tlsEndpoints.id, cur.id));
      await audit(db, { c, user: currentUser(c), action: "tls.endpoint_deleted", entityType: "tls_endpoint", entityId: cur.id, details: { host: cur.host, port: cur.port } });
      return c.body(null, 204);
    })
    .post("/:id/scan", requirePerm("assets:write"), async (c) => {
      const cur = await load(c, c.req.param("id"));
      return c.json(await one(await scanEndpoint(db, cur, deps)));
    })
    .post("/scan-all", requirePerm("assets:write"), async (c) => {
      const rows = await db.select().from(tlsEndpoints).where(and(inScope(c, tlsEndpoints.companyId), eq(tlsEndpoints.enabled, true))).limit(200);
      for (const r of rows) await scanEndpoint(db, r, deps);
      await audit(db, { c, user: currentUser(c), action: "tls.scanned", entityType: "tls_endpoint", details: { count: rows.length } });
      return c.json({ scanned: rows.length });
    });
}
