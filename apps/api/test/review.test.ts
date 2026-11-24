import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { HELP_TOPICS } from "@contix/shared";
import { EN_LABELS } from "../../../packages/shared/src/i18n/en.labels";
import { HELP_EN } from "../../../packages/shared/src/i18n/help.en";

/* Revize v0.73: každá routa musí mít requirePerm(...) (nebo jinou guard funkci v řetězci před handlerem).
 * Výjimky níže kontrolují oprávnění uvnitř handleru (podle druhu záznamu / společnosti / vlastníka) nebo jde o veřejné
 * rozhraní s tokenem (dotazníky dodavatelů, ingest SOC, feed IOC, WebDAV, MCP). Novou výjimku přidávej jen s kontrolou v handleru. */
const INLINE_GUARDED = new Set([
  "modules/assets/routes.ts DELETE /links",
  "modules/assets/routes.ts PATCH /:id",
  "modules/assets/routes.ts POST /links",
  "modules/companies/routes.ts GET /overview",
  "modules/companies/routes.ts POST /transfer",
  "modules/connectors/routes.ts GET /",
  "modules/connectors/routes.ts POST /network-scan/test",
  "modules/connectors/routes.ts POST /wazuh/indexer-test",
  "modules/connectors/routes.ts POST /wazuh/test",
  "modules/connectors/routes.ts PUT /network-scan",
  "modules/connectors/routes.ts PUT /wazuh",
  "modules/cycles/routes.ts GET /",
  "modules/frameworks/routes.ts GET /catalog",
  "modules/cycles/routes.ts GET /:id",
  "modules/cycles/routes.ts GET /:id/compare",
  "modules/cycles/routes.ts GET /status",
  "modules/cycles/routes.ts PATCH /:id",
  "modules/cycles/routes.ts POST /",
  "modules/cycles/routes.ts POST /:id/cancel",
  "modules/cycles/routes.ts POST /:id/reopen",
  "modules/cycles/routes.ts POST /:id/submit",
  "modules/cycles/routes.ts PUT /:id/items/:entityId",
  "modules/discovery/routes.ts GET /connectors",
  "modules/discovery/routes.ts GET /runs",
  "modules/discovery/routes.ts GET /runs/:id",
  "modules/documents/routes.ts DELETE /:id",
  "modules/documents/routes.ts GET /",
  "modules/documents/routes.ts GET /:id",
  "modules/documents/routes.ts GET /:id/docx",
  "modules/documents/routes.ts GET /:id/html",
  "modules/documents/routes.ts GET /preview.docx",
  "modules/documents/routes.ts GET /preview.html",
  "modules/documents/routes.ts POST /",
  "modules/documents/routes.ts POST /:id/acknowledge",
  "modules/documents/routes.ts POST /:id/approve",
  "modules/i18n/routes.ts GET /",
  "modules/i18n/routes.ts GET /packs/:locale",
  "modules/i18n/routes.ts PATCH /i18n/me",
  "modules/incidents/routes.ts POST /",
  "modules/mcp/routes.ts DELETE /",
  "modules/mcp/routes.ts GET /",
  "modules/mcp/routes.ts POST /",
  "modules/policies/webdav.ts ALL /:token",
  "modules/policies/webdav.ts ALL /:token/",
  "modules/policies/webdav.ts ALL /:token/:name",
  "modules/reports/routes.ts GET /management",
  "modules/reports/routes.ts GET /management.docx",
  "modules/reports/routes.ts GET /management.html",
  "modules/soc/iocs.ts GET /feed/:token/:file",
  // odběr kalendáře lhůt: token odběru v cestě, oprávnění uživatele při stažení (v1.101, ADR-195)
  "modules/calendar/routes.ts GET /:file",
  "modules/soc/sources.ts POST /ingest",
  "modules/suppliers/questionnaires.ts DELETE /:token/files/:fileId",
  "modules/suppliers/questionnaires.ts GET /:token",
  "modules/suppliers/questionnaires.ts POST /:token/files",
  "modules/suppliers/questionnaires.ts POST /:token/submit",
  "modules/suppliers/questionnaires.ts PUT /:token",
  "modules/trust/center.ts GET /:slug",
  "modules/trust/center.ts GET /:slug/docs/:policyId",
  "modules/trust/center.ts POST /:slug/requests",
  "modules/vulnerabilities/ci.ts POST /scans",
  // sběrač ze serverů: token připojení v hlavičce (v1.51, ADR-148)
  "modules/collector/routes.ts POST /inventory",
  // koncentrátory agentů: registrační kód v těle, jinak podpis koncentrátoru v hlavičkách (ADR-177)
  "modules/agents/routes.ts POST /register",
  "modules/agents/routes.ts POST /agents",
  "modules/agents/routes.ts POST /batches",
  "modules/agents/routes.ts POST /hello",
  // sonda bezpečnostních testů: token sondy v hlavičce (v1.56, ADR-153)
  "modules/sectests/routes.ts POST /poll",
  "modules/sectests/routes.ts POST /result",
  "modules/controls/monitors.ts POST /result",
  "modules/vulnerabilities/routes.ts POST /:id/accept",
  "modules/vulnerabilities/routes.ts POST /:id/reopen"
]);

const ROOT = join(import.meta.dir, "../src");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });

export function unguardedRoutes(): string[] {
  const out: string[] = [];
  for (const f of files(join(ROOT, "modules"))) {
    const s = readFileSync(f, "utf8");
    for (const m of s.matchAll(/(?<![\w$])\s*\.(get|post|put|patch|delete|all)\(\s*"(\/[^"]*)"/g)) {
      const seg = s.slice(m.index! + m[0].length, m.index! + m[0].length + 600);
      const h = seg.search(/async\s*\(c|\(c\)\s*=>|async\s*c\s*=>/);
      const head = h >= 0 ? seg.slice(0, h) : seg.slice(0, 200);
      if (/require\w*\(|perm\w*\(|guard|Perm/.test(head)) continue;
      out.push(`${relative(ROOT, f).replaceAll("\\", "/")} ${m[1]!.toUpperCase()} ${m[2]}`);
    }
  }
  return [...new Set(out)];
}

describe("oprávnění rout", () => {
  test("každá routa má requirePerm nebo je na seznamu výjimek s kontrolou v handleru", () => {
    const found = unguardedRoutes();
    expect(found.filter((r) => !INLINE_GUARDED.has(r))).toEqual([]);
    // seznam výjimek neobsahuje zastaralé položky
    expect([...INLINE_GUARDED].filter((r) => !found.includes(r))).toEqual([]);
  });
});

describe("anglická verze", () => {
  test("každé téma nápovědy má anglický překlad se stejnými oddíly", () => {
    const heads = (b: string) => (b.match(/^## /gm) ?? []).length;
    const bad = HELP_TOPICS.filter((t) => !HELP_EN[t.id] || heads(HELP_EN[t.id]!.body) !== heads(t.body)).map((t) => t.id);
    expect(bad).toEqual([]);
  });
  test("statické hlášky HTTPException mají anglický popisek", () => {
    const miss = new Set<string>();
    for (const f of files(ROOT))
      for (const m of readFileSync(f, "utf8").matchAll(/new HTTPException\(\d+,\s*\{\s*message:\s*"((?:[^"\\]|\\.)+)"/g)) {
        const msg = JSON.parse(`"${m[1]}"`) as string;
        if (!EN_LABELS[`lbl:${msg}`]) miss.add(msg);
      }
    expect([...miss]).toEqual([]);
  });
});

/* v0.84 (ADR-080): moduly se řídí regulatorním profilem (`profileOf`), ne natvrdo vyhláškou 409/410.
 * Literál "cz409" / "cz410" smí být jen v souborech níže – funkce vázané na strukturu české vyhlášky
 * (výchozí katalog V-xx/N-xx, oddíly ISMS, šablony dotazníků a smluvních doložek, tiskové názvy SoA).
 * Seznam se má jen zmenšovat (balíčky zemí ve verzi 0.85+). */
const CZ_LITERAL_ALLOWED = new Set([
  "api/src/db/schema.ts",
  "api/src/modules/ai/service.ts",
  "api/src/modules/ai/usecases.ts",
  "api/src/modules/controls/routes.ts",
  "api/src/modules/documents/render.ts",
  "api/src/modules/documents/routes.ts",
  "api/src/modules/policies/bulkImport.ts",
  "api/src/modules/policies/routes.ts",
  "api/src/modules/suppliers/questionnaires.ts",
  "api/src/modules/suppliers/routes.ts",
  "web/src/components/profilePicker.tsx",
  "web/src/components/supplierQuestionnaires.tsx",
  "web/src/lib/api.ts",
  "web/src/lib/regime.ts",
  "web/src/pages/Audits.tsx",
  "web/src/pages/Controls.tsx",
  "web/src/pages/Dashboard.tsx",
  "web/src/pages/Policies.tsx",
  "web/src/pages/Soa.tsx",
  "web/src/pages/Suppliers.tsx",
]);

describe("regulatorní profil", () => {
  test("vyhláška 409/410 natvrdo jen v povolených souborech", () => {
    const APPS = join(import.meta.dir, "../..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
      });
    const hits = [...walk(join(APPS, "api/src")), ...walk(join(APPS, "web/src"))]
      .filter((f) => /"cz4(09|10)"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(APPS, f).replaceAll("\\", "/"));
    expect(hits.filter((f) => !CZ_LITERAL_ALLOWED.has(f))).toEqual([]);
    expect([...CZ_LITERAL_ALLOWED].filter((f) => !hits.includes(f))).toEqual([]);
  });
});

/* ---------- pokrytí vazeb (v1.75, ADR-168) ---------- */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema172 from "../src/db/schema";
import { BACKLINKS_FOR, RELATION_COVERAGE, type LinkTarget } from "@contix/shared";
describe("vazby mezi evidencemi", () => {
  const TARGET: Record<keyof typeof RELATION_COVERAGE, LinkTarget> = { assets: "asset", processes: "process", risks: "risk", controls: "control", suppliers: "supplier" };
  const fks = new Map<string, Set<string>>(Object.keys(RELATION_COVERAGE).map((k) => [k, new Set<string>()]));
  for (const v of Object.values(schema172)) {
    if (!is(v, PgTable)) continue;
    const cfg = getTableConfig(v);
    for (const fk of cfg.foreignKeys) fks.get(getTableConfig(fk.reference().foreignTable).name)?.add(cfg.name);
  }
  test("každá tabulka s cizím klíčem na aktivum / proces / riziko / opatření / dodavatele je v RELATION_COVERAGE", () => {
    const missing: string[] = [];
    for (const [core, tables] of fks) for (const t of tables) if (!(t in RELATION_COVERAGE[core as keyof typeof RELATION_COVERAGE])) missing.push(`${core} ← ${t}`);
    expect(missing).toEqual([]);
  });
  test("mapa neobsahuje zastaralé tabulky a zpětné vazby jsou u cíle zapnuté", () => {
    const stale: string[] = [];
    const off: string[] = [];
    for (const [core, map] of Object.entries(RELATION_COVERAGE)) {
      for (const [t, place] of Object.entries(map)) {
        if (!fks.get(core)!.has(t)) stale.push(`${core} ← ${t}`);
        if (place.startsWith("backlink:") && !(BACKLINKS_FOR[TARGET[core as keyof typeof TARGET]] as readonly string[]).includes(place.slice(9))) off.push(`${core}: ${place}`);
      }
    }
    expect(stale).toEqual([]);
    expect(off).toEqual([]);
  });
});
