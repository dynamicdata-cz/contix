import { API_TOKEN_PREFIX, ApiTokenInput, ipAllowed, CONTIX_VERSION, type ApiTokenDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomToken, sha256 } from "../../auth/crypto";
import { currentUser, requirePerm } from "../../auth/middleware";
import { getCompanies, resolveScope, scopeOf } from "../../auth/scope";
import { audit, clientIp, getSettings, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { apiTokens, users } from "../../db/schema";
import { getAiSettings } from "../ai/service";
import { runTool, toolSchema, toolsFor, type ToolCtx, type ToolResult } from "../ai/tools";
import { ApiError } from "../../lib/apiError";

/* ============================================================
 * MCP server (Model Context Protocol, transport Streamable HTTP – jen JSON odpovědi, bez SSE).
 * Externí AI klient (Claude Code, Claude Desktop, Open WebUI…) se přihlásí osobním API tokenem
 * a smí volat jen čtecí nástroje z katalogu (modules/ai/tools.ts) s oprávněními svého uživatele. ADR-021.
 * ============================================================ */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type RpcId = string | number | null;
interface RpcRequest {
  jsonrpc: "2.0";
  id?: RpcId;
  method: string;
  params?: Record<string, unknown>;
}

const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

/** Výsledek nástroje jako Markdown tabulka (pro modely, které nečtou structuredContent). */
export function toolResultText(title: string, r: ToolResult, appUrl: string): string {
  const base = appUrl.replace(/\/+$/, "");
  const cell = (v: string | number | null) => String(v ?? "—").replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const lines = [`${title}: ${r.total} záznamů${r.total > r.rows.length ? ` (zobrazeno ${r.rows.length})` : ""}`];
  if (r.note) lines.push(r.note);
  if (r.rows.length) {
    lines.push("", `| ${r.columns.join(" | ")} | Odkaz |`, `|${r.columns.map(() => "---").join("|")}|---|`);
    for (const row of r.rows) lines.push(`| ${row.cells.map(cell).join(" | ")} | ${row.link ? `${base}${row.link}` : ""} |`);
  }
  return lines.join("\n");
}

interface TokenAuth {
  token: typeof apiTokens.$inferSelect;
  user: typeof users.$inferSelect;
  ctx: ToolCtx;
}

export function mcpRoutes(deps: { db: Db; config: Config }) {
  const { db, config } = deps;

  async function authenticate(c: Context): Promise<TokenAuth> {
    const h = c.req.header("authorization") ?? "";
    const m = h.match(/^Bearer\s+(\S+)$/i);
    const unauthorized = (msg: string) => {
      c.header("www-authenticate", 'Bearer realm="contix"');
      return new HTTPException(401, { message: msg });
    };
    if (!m || !m[1]!.startsWith(API_TOKEN_PREFIX)) throw unauthorized("Chybí API token (Authorization: Bearer ctx_…)");
    const [row] = await db.select().from(apiTokens).innerJoin(users, eq(users.id, apiTokens.userId)).where(eq(apiTokens.tokenHash, sha256(m[1]!)));
    if (!row || row.api_tokens.revokedAt || (row.api_tokens.expiresAt && row.api_tokens.expiresAt < new Date()) || !row.users.isActive) throw unauthorized("Neplatný, zneplatněný nebo prošlý API token");
    const ai = await getAiSettings(db);
    if (!ai.mcpEnabled) throw new HTTPException(403, { message: "MCP server je vypnutý (Administrace → AI asistent)." });
    const ip = clientIp(c);
    if (!ipAllowed(ip, ai.mcpAllowedIps)) {
      await audit(db, { c, user: row.users, action: "mcp.denied_ip", entityType: "api_token", entityId: row.api_tokens.id, details: { ip } });
      throw new ApiError(403, "err.mcp.ipNotAllowed", { ip: String(ip ?? "?") });
    }
    const { scope } = await resolveScope(db, row.users.id, row.users.companyId, row.api_tokens.companyId);
    // token omezený na společnost, ke které uživatel už nemá přístup → nic neuvidí
    const ids = row.api_tokens.companyId ? scope.ids.filter((id) => id === row.api_tokens.companyId) : scope.ids;
    if (![...scope.byCompany.values()].some((p) => p.has("api:tokens"))) throw new HTTPException(403, { message: "Uživatel už nemá oprávnění používat API tokeny." });
    if (!row.api_tokens.lastUsedAt || row.api_tokens.lastUsedIp !== ip || Date.now() - row.api_tokens.lastUsedAt.getTime() > 60_000) await db.update(apiTokens).set({ lastUsedAt: new Date(), lastUsedIp: ip }).where(eq(apiTokens.id, row.api_tokens.id));
    return { token: row.api_tokens, user: row.users, ctx: { db, companyIds: ids, byCompany: scope.byCompany, enabledModules: (await getSettings(db)).enabledModules } };
  }

  async function handle(c: Context, a: TokenAuth, msg: RpcRequest) {
    const id = msg.id ?? null;
    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "contix", title: "CONTIX GRC", version: CONTIX_VERSION },
          instructions:
            "CONTIX je GRC aplikace (kybernetická bezpečnost dle NIS2/ZKB, ISO 27001, GDPR). Nástroje jsou jen pro čtení a vrací data, ke kterým má uživatel tokenu oprávnění. Odkazy vedou do webového rozhraní CONTIX.",
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, {
          tools: toolsFor(a.ctx).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: toolSchema(t), annotations: { readOnlyHint: true, openWorldHint: false } })),
        });
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};
        const tool = toolsFor(a.ctx).find((t) => t.name === name);
        if (!tool) return rpcError(id, -32602, `Neznámý nástroj: ${name}`);
        try {
          const r = await runTool(a.ctx, name, args);
          await audit(db, { c, user: a.user, action: "mcp.tool_call", entityType: "api_token", entityId: a.token.id, details: { tool: name, args, total: r.total } });
          return rpcResult(id, { content: [{ type: "text", text: toolResultText(tool.title, r, config.APP_URL) }], structuredContent: r, isError: false });
        } catch (e) {
          return rpcResult(id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
        }
      }
      default:
        return rpcError(id, -32601, `Metoda není podporována: ${msg.method}`);
    }
  }

  return new Hono<AppEnv>()
    .post("/", async (c) => {
      const a = await authenticate(c);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(rpcError(null, -32700, "Neplatný JSON"), 400);
      }
      const batch = Array.isArray(body);
      const msgs = (batch ? body : [body]) as RpcRequest[];
      const out = [];
      for (const m of msgs.slice(0, 20)) {
        if (!m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
          out.push(rpcError((m as RpcRequest)?.id ?? null, -32600, "Neplatný požadavek JSON-RPC"));
          continue;
        }
        if (m.id === undefined) continue; // notifikace (např. notifications/initialized) – bez odpovědi
        out.push(await handle(c, a, m));
      }
      if (!out.length) return c.body(null, 202);
      return c.json(batch ? out : out[0]);
    })
    .get("/", (c) => c.json({ error: "Server nepodporuje SSE stream – použijte POST." }, 405, { allow: "POST" }))
    .delete("/", (c) => c.body(null, 405));
}

/* ---------- správa osobních API tokenů (v profilu) ---------- */

export function tokenRoutes(db: Db) {
  const dto = async (rows: (typeof apiTokens.$inferSelect)[]): Promise<ApiTokenDto[]> => {
    const names = new Map((await getCompanies(db)).map((x) => [x.id, x.name]));
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      companyId: t.companyId,
      companyName: t.companyId ? (names.get(t.companyId) ?? null) : null,
      expiresAt: t.expiresAt?.toISOString() ?? null,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: t.lastUsedIp,
      revokedAt: t.revokedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  };
  const mine = async (userId: string) => dto(await db.select().from(apiTokens).where(eq(apiTokens.userId, userId)).orderBy(desc(apiTokens.createdAt)));

  return new Hono<AppEnv>()
    .get("/", requirePerm("api:tokens"), async (c) => c.json(await mine(currentUser(c).id)))
    .post("/", requirePerm("api:tokens"), zValidator("json", ApiTokenInput), async (c) => {
      const input = c.req.valid("json");
      const user = currentUser(c);
      if (input.companyId && !scopeOf(c).accessible.includes(input.companyId)) throw new HTTPException(400, { message: "K této společnosti nemáte přístup" });
      const active = await db.select({ id: apiTokens.id }).from(apiTokens).where(and(eq(apiTokens.userId, user.id)));
      if (active.length >= 20) throw new HTTPException(409, { message: "Dosažen limit 20 tokenů – nepoužívané smažte." });
      const token = `${API_TOKEN_PREFIX}${randomToken(32)}`;
      const days = input.expiresInDays === undefined ? 90 : input.expiresInDays;
      const [row] = await db
        .insert(apiTokens)
        .values({ userId: user.id, name: input.name, tokenHash: sha256(token), prefix: token.slice(0, 12), companyId: input.companyId ?? null, expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null })
        .returning();
      await audit(db, { c, user, action: "api_token.created", entityType: "api_token", entityId: row!.id, details: { name: input.name, expiresInDays: days, companyId: input.companyId ?? null } });
      // samotný token se vrací jen teď – v DB je pouze jeho hash
      return c.json({ token, item: (await dto([row!]))[0] }, 201);
    })
    .post("/:id/revoke", requirePerm("api:tokens"), async (c) => {
      const user = currentUser(c);
      const [row] = await db
        .update(apiTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(apiTokens.id, c.req.param("id")), eq(apiTokens.userId, user.id)))
        .returning();
      if (!row) throw new HTTPException(404, { message: "Token nenalezen" });
      await audit(db, { c, user, action: "api_token.revoked", entityType: "api_token", entityId: row.id, details: { name: row.name } });
      return c.json(await mine(user.id));
    })
    .delete("/:id", requirePerm("api:tokens"), async (c) => {
      const user = currentUser(c);
      const [row] = await db.delete(apiTokens).where(and(eq(apiTokens.id, c.req.param("id")), eq(apiTokens.userId, user.id))).returning({ id: apiTokens.id, name: apiTokens.name });
      if (!row) throw new HTTPException(404, { message: "Token nenalezen" });
      await audit(db, { c, user, action: "api_token.deleted", entityType: "api_token", entityId: row.id, details: { name: row.name } });
      return c.json(await mine(user.id));
    });
}
