import { recordPath, type Permission, type QuickHit, type QuickKind } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requirePerm } from "../../auth/middleware";
import { getSettings, type AppEnv } from "../../auth/service";
import { hasPermIn, scopeOf } from "../../auth/scope";
import type { Db } from "../../db/client";

/* ============================================================
 * Rychlé hledání záznamů podle názvu / kódu (v1.06, ADR-102) – paleta Ctrl+K.
 * Jen evidence, které uživatel smí číst (oprávnění ve společnosti, zapnutý modul); LIKE vždy escapovaný.
 * ============================================================ */

type Def = { kind: Exclude<QuickKind, "cve">; table: string; label: string; match: string[]; sub?: string; perm: Permission; module: string };
const DEFS: Def[] = [
  { kind: "asset", table: "assets", label: "name", match: ["name", "hostname", "fqdn", "array_to_string(ip_addresses, ' ')"], sub: "coalesce(hostname, fqdn)", perm: "assets:read", module: "assets" },
  { kind: "process", table: "processes", label: "coalesce(code || ' ', '') || name", match: ["name", "code"], perm: "processes:read", module: "processes" },
  { kind: "risk", table: "risks", label: "coalesce(code || ' ', '') || name", match: ["name", "code"], perm: "risks:read", module: "risks" },
  { kind: "control", table: "controls", label: "coalesce(code || ' ', '') || name", match: ["name", "code"], perm: "controls:read", module: "controls" },
  { kind: "supplier", table: "suppliers", label: "name", match: ["name", "ico"], sub: "ico", perm: "suppliers:read", module: "suppliers" },
  { kind: "incident", table: "incidents", label: "coalesce(code || ' ', '') || title", match: ["title", "code"], perm: "incidents:read", module: "incidents" },
  { kind: "change", table: "changes", label: "coalesce(code || ' ', '') || title", match: ["title", "code"], perm: "isms:read", module: "isms" },
  { kind: "policy", table: "policies", label: "coalesce(code || ' ', '') || title", match: ["title", "code"], perm: "policies:read", module: "policies" },
  { kind: "audit", table: "audits", label: "coalesce(code || ' ', '') || title", match: ["title", "code"], perm: "audits:read", module: "audits" },
  { kind: "cra_product", table: "cra_products", label: "name || coalesce(' ' || version, '')", match: ["name", "code"], perm: "cra:read", module: "cra" },
  { kind: "ai_system", table: "ai_systems", label: "coalesce(code || ' ', '') || name", match: ["name", "code"], perm: "aiact:read", module: "aiact" },
  { kind: "activity", table: "processing_activities", label: "coalesce(code || ' ', '') || name", match: ["name", "code"], perm: "gdpr:read", module: "gdpr" },
  { kind: "plan", table: "continuity_plans", label: "coalesce(code || ' ', '') || name", match: ["name", "code"], perm: "bia:read", module: "continuity" },
];
const PERMS = [...new Set(DEFS.map((d) => d.perm))];
const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;

export async function quickSearch(db: Db, c: Parameters<typeof scopeOf>[0], q: string, limit = 5): Promise<QuickHit[]> {
  const mods = new Set((await getSettings(db)).enabledModules as string[]);
  const ids = scopeOf(c).ids;
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const out: QuickHit[] = [];
  const term = q.trim();
  if (CVE_RE.test(term) && mods.has("vulnerabilities") && ids.some((id) => hasPermIn(c, "assets:read", id))) out.push({ kind: "cve", id: term.toUpperCase(), label: term.toUpperCase(), sub: null, link: `/vulnerabilities/cve/${term.toUpperCase()}` });
  const parts: SQL[] = [];
  for (const d of DEFS) {
    if (!mods.has(d.module)) continue;
    const allowed = ids.filter((id) => hasPermIn(c, d.perm, id));
    if (!allowed.length) continue;
    const where = sql.join(d.match.map((m) => sql`${sql.raw(m)} ilike ${like}`), sql` or `);
    // přesná shoda kódu / začátek názvu dřív
    parts.push(sql`(select ${d.kind}::text as kind, id::text, (${sql.raw(d.label)})::text as label, ${sql.raw(d.sub ?? "null")}::text as sub,
      (case when lower(${sql.raw(d.match[1] ?? d.match[0]!)}) = lower(${term}) then 0 when ${sql.raw(d.match[0]!)} ilike ${`${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`} then 1 else 2 end) as rank
      from ${sql.raw(d.table)} where company_id in (${sql.join(allowed.map((x) => sql`${x}::uuid`), sql`, `)}) and (${where})
      order by rank, label limit ${limit})`);
  }
  if (!parts.length) return out;
  const rows = (await db.execute<{ kind: Exclude<QuickKind, "cve">; id: string; label: string; sub: string | null; rank: number }>(sql.join(parts, sql` union all `))) as unknown as { kind: Exclude<QuickKind, "cve">; id: string; label: string; sub: string | null; rank: number }[];
  rows.sort((a, b) => a.rank - b.rank || DEFS.findIndex((d) => d.kind === a.kind) - DEFS.findIndex((d) => d.kind === b.kind));
  for (const r of rows) out.push({ kind: r.kind, id: r.id, label: r.label, sub: r.sub, link: recordPath(r.kind, r.id) });
  return out;
}

export function quickSearchRoutes(db: Db) {
  return new Hono<AppEnv>().get("/quick", requirePerm(...PERMS), zValidator("query", z.object({ q: z.string().trim().min(2).max(100) })), async (c) => c.json(await quickSearch(db, c, c.req.valid("query").q)));
}
