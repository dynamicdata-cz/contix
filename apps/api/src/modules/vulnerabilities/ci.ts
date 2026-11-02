import { API_TOKEN_PREFIX, SEVERITIES, type Severity } from "@contix/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { sha256 } from "../../auth/crypto";
import { resolveScope } from "../../auth/scope";
import { audit, clientIp, getSettings } from "../../auth/service";
import type { Db } from "../../db/client";
import { apiTokens, assetVulnerabilities, users, vulnScans } from "../../db/schema";
import { recomputeHealth } from "./service";
import { uploadScan } from "./scans";

/* ============================================================
 * Import skenů z CI/CD (ADR-097): `POST /api/public/vulnerabilities/scans` s osobním API tokenem (Bearer ctx_…).
 * Stejné zpracování jako nahrání v UI (`uploadScan`), oprávnění uživatele tokenu (assets:write ve společnosti),
 * token omezený na společnost platí jen pro ni. Odpověď nese „bránu“ pro pipeline: nové otevřené nálezy podle závažnosti
 * a `failed` podle `failOn` (critical / high / medium / none) – rozhodnutí o zastavení buildu je na pipeline.
 * ============================================================ */

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

async function tokenUser(db: Db, c: Context) {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  const unauthorized = (msg: string) => {
    c.header("www-authenticate", 'Bearer realm="contix"');
    return new HTTPException(401, { message: msg });
  };
  if (!m || !m[1]!.startsWith(API_TOKEN_PREFIX)) throw unauthorized("Chybí API token (Authorization: Bearer ctx_…)");
  const [row] = await db.select().from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId)).where(eq(apiTokens.tokenHash, sha256(m[1]!)));
  if (!row || row.api_tokens.revokedAt || (row.api_tokens.expiresAt && row.api_tokens.expiresAt < new Date()) || !row.users.isActive) throw unauthorized("Neplatný, zneplatněný nebo prošlý API token");
  const { scope } = await resolveScope(db, row.users.id, row.users.companyId, row.api_tokens.companyId);
  if (![...scope.byCompany.values()].some((p) => p.has("api:tokens"))) throw new HTTPException(403, { message: "Uživatel už nemá oprávnění používat API tokeny." });
  const ip = clientIp(c);
  await db.update(apiTokens).set({ lastUsedAt: new Date(), lastUsedIp: ip }).where(eq(apiTokens.id, row.api_tokens.id));
  const ids = row.api_tokens.companyId ? scope.ids.filter((id) => id === row.api_tokens.companyId) : scope.ids;
  return { token: row.api_tokens, user: row.users, scope, ids };
}

export function publicVulnScanRoutes(db: Db) {
  return new Hono().post("/scans", async (c) => {
    if (!((await getSettings(db)).enabledModules as string[]).includes("vulnerabilities")) throw new HTTPException(404, { message: "Modul není zapnutý" });
    const a = await tokenUser(db, c);
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const failOn = String(body.failOn ?? "none");
    if (!["critical", "high", "medium", "none"].includes(failOn)) throw new HTTPException(400, { message: "failOn: critical, high, medium nebo none" });
    // výchozí režim z CI je zápis (náhled jen výslovně)
    if (body.mode === undefined) body.mode = "commit";
    const companyOf = (requested?: string) => {
      const pick = requested ?? (a.ids.includes(a.user.companyId) ? a.user.companyId : a.ids[0]);
      if (!pick || !a.ids.includes(pick)) throw new HTTPException(400, { message: "Zvolte společnost, do které záznam patří." });
      if (!a.scope.byCompany.get(pick)?.has("assets:write")) throw new HTTPException(403, { message: "Nemáte oprávnění v této společnosti" });
      return pick;
    };
    const up = await uploadScan(db, body, companyOf, a.user.id);
    if (up.kind === "preview") return c.json(up.preview);
    const { r, scanner, file } = up;
    await recomputeHealth(db);
    const [scan] = await db.select({ importedAt: vulnScans.importedAt }).from(vulnScans).where(eq(vulnScans.id, r.scanId));
    const rows = await db
      .select({ severity: assetVulnerabilities.severity, n: sql<number>`count(*)::int` })
      .from(assetVulnerabilities)
      .where(and(eq(assetVulnerabilities.scanId, r.scanId), eq(assetVulnerabilities.status, "open"), eq(assetVulnerabilities.firstSeenAt, scan!.importedAt)))
      .groupBy(assetVulnerabilities.severity);
    const newOpen = Object.fromEntries(SEVERITIES.map((s) => [s, rows.find((x) => x.severity === s)?.n ?? 0])) as Record<Severity, number>;
    const failed = failOn !== "none" && SEVERITIES.some((s) => newOpen[s] > 0 && RANK[s] >= RANK[failOn as Severity]);
    await audit(db, { c: c as never, user: a.user, action: "vuln_scan.imported", entityType: "vuln_scan", entityId: r.scanId, details: { scanner, file: file.name, via: "api_token", tokenId: a.token.id, ...r.stats } });
    return c.json({ scanId: r.scanId, scanner, stats: r.stats, newOpen, failOn, failed }, 201);
  });
}
