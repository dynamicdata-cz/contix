import { BACKLINKS_FOR, EXCEPTION_LABELS, LINK_TARGETS, recordPath, type BacklinkGroup, type BacklinkItem, type BacklinkKind, type BacklinksDto, type LinkTarget, type Permission } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { requirePerm } from "../../auth/middleware";
import { getSettings, type AppEnv } from "../../auth/service";
import { hasPermIn, scopeOf } from "../../auth/scope";
import type { Db } from "../../db/client";
import { assetVisible } from "../assets/routes";
import { EXCEPTION_ACCESS } from "../exceptions/routes";

/* ============================================================
 * Zpětné vazby mezi záznamy (v1.05, ADR-101).
 * GET /api/links/:target/:id → skupiny záznamů jiných evidencí, které na cíl odkazují (tabulky vazeb a cizí klíče).
 * Cíl musí uživatel smět číst; každý navázaný záznam jen s čtecím oprávněním jeho evidence ve společnosti záznamu
 * a se zapnutým modulem. Nic se nepersistuje.
 * ============================================================ */

const TARGET: Record<LinkTarget, { table: string; perm: Permission; module: string }> = {
  asset: { table: "assets", perm: "assets:read", module: "assets" },
  process: { table: "processes", perm: "processes:read", module: "processes" },
  risk: { table: "risks", perm: "risks:read", module: "risks" },
  control: { table: "controls", perm: "controls:read", module: "controls" },
  supplier: { table: "suppliers", perm: "suppliers:read", module: "suppliers" },
};

export const BACKLINK_ACCESS: Record<BacklinkKind, { perm: Permission; module: string }> = {
  incident: { perm: "incidents:read", module: "incidents" },
  change: { perm: "isms:read", module: "isms" },
  activity: { perm: "gdpr:read", module: "gdpr" },
  ai_system: { perm: "aiact:read", module: "aiact" },
  plan: { perm: "bia:read", module: "continuity" },
  bia: { perm: "bia:read", module: "continuity" },
  control: { perm: "controls:read", module: "controls" },
  supplier: { perm: "suppliers:read", module: "suppliers" },
  audit: { perm: "audits:read", module: "audits" },
  audit_finding: { perm: "audits:read", module: "audits" },
  supplier_report: { perm: "suppliers:read", module: "suppliers" },
  supplier_questionnaire: { perm: "suppliers:read", module: "suppliers" },
  treatment_action: { perm: "risks:read", module: "risks" },
  cra_product: { perm: "cra:read", module: "cra" },
  /** Řádky nesou vlastní oprávnění podle druhu výjimky (sloupec perm). */
  exception: { perm: "controls:read", module: "controls" },
};

type Row = { id: string; company_id: string; code: string | null; name: string; sub: string | null; link: string; perm?: Permission | null };
const lbl = (r: Row) => (r.code ? `${r.code} ${r.name}` : r.name);

/** Tabulka vazeb ve tvaru (zdroj_id, cíl_id) – název sloupce cíle podle druhu cíle. */
const COL: Record<LinkTarget, string> = { asset: "asset_id", process: "process_id", risk: "risk_id", control: "control_id", supplier: "supplier_id" };
const via = (linkTable: string, srcCol: string, target: LinkTarget, id: string) =>
  sql`select ${sql.raw(srcCol)} from ${sql.raw(linkTable)} where ${sql.raw(COL[target])} = ${id}::uuid`;

/** Dotaz pro (druh zpětné vazby, cíl) – vrací řádky Row; null = kombinace neexistuje. */
function query(kind: BacklinkKind, target: LinkTarget, id: string): SQL | null {
  const T = target;
  switch (kind) {
    case "incident":
      return T === "asset" || T === "process" || T === "risk" || T === "control" || T === "supplier"
        ? sql`select i.id, i.company_id, i.code, i.title as name, null as sub, '' as link from incidents i where i.id in (${via(`incident_${T === "process" ? "processes" : `${T}s`}`, "incident_id", T, id)})`
        : null;
    case "change":
      return sql`select x.id, x.company_id, x.code, x.title as name, null as sub, '' as link from changes x where x.id in (${via(`change_${T === "process" ? "processes" : `${T}s`}`, "change_id", T, id)})`;
    case "activity":
      if (T === "risk") return null;
      return sql`select x.id, x.company_id, x.code, x.name, null as sub, '' as link from processing_activities x where x.id in (${via(`activity_${T === "process" ? "processes" : `${T}s`}`, "activity_id", T, id)})`;
    case "ai_system":
      return sql`select x.id, x.company_id, x.code, x.name, null as sub, '' as link from ai_systems x where x.id in (${via(`ai_system_${T === "process" ? "processes" : `${T}s`}`, "system_id", T, id)})`;
    case "plan":
      if (T !== "asset" && T !== "process") return null;
      return sql`select x.id, x.company_id, x.code, x.name, null as sub, '' as link from continuity_plans x where x.id in (${via(`plan_${T === "process" ? "processes" : "assets"}`, "plan_id", T, id)})`;
    case "bia":
      if (T !== "process") return null;
      return sql`select b.id, b.company_id, p.code, p.name, null as sub, '' as link from bia_assessments b join processes p on p.id = b.process_id where b.process_id = ${id}::uuid`;
    case "control":
      if (T !== "asset") return null;
      return sql`select x.id, x.company_id, x.code, x.name, null as sub, '' as link from controls x where x.id in (${via("control_assets", "control_id", T, id)})`;
    case "supplier":
      if (T === "asset") return sql`select x.id, x.company_id, null as code, x.name, null as sub, '' as link from suppliers x where x.id in (${via("supplier_assets", "supplier_id", T, id)})`;
      if (T === "process") return sql`select x.id, x.company_id, null as code, x.name, null as sub, '' as link from suppliers x where x.id in (${via("supplier_processes", "supplier_id", T, id)})`;
      if (T === "risk") return sql`select x.id, x.company_id, null as code, x.name, null as sub, '' as link from suppliers x where x.id in (${via("supplier_risks", "supplier_id", T, id)})`;
      return null;
    case "audit":
      if (T !== "supplier") return null;
      return sql`select a.id, a.company_id, a.code, a.title as name, null as sub, '' as link from audits a where a.supplier_id = ${id}::uuid`;
    case "audit_finding":
      if (T !== "risk" && T !== "control") return null;
      return sql`select f.id, a.company_id, f.code, f.title as name, coalesce(a.code || ' ', '') || a.title as sub, '/audits/' || a.id as link
        from audit_findings f join audits a on a.id = f.audit_id where f.${sql.raw(COL[T])} = ${id}::uuid`;
    case "supplier_report":
      if (T !== "risk" && T !== "control") return null;
      return sql`select distinct r.id, r.company_id, null as code, r.title as name, s.name as sub, '' as link
        from supplier_report_items it join supplier_reports r on r.id = it.report_id join suppliers s on s.id = r.supplier_id where it.${sql.raw(COL[T])} = ${id}::uuid`;
    case "supplier_questionnaire":
      if (T !== "risk") return null;
      return sql`select q.id, q.company_id, null as code, q.title as name, s.name as sub, '/suppliers/' || s.id as link
        from supplier_questionnaires q join suppliers s on s.id = q.supplier_id where q.risk_id = ${id}::uuid`;
    case "treatment_action":
      if (T !== "control") return null;
      return sql`select t.id, r.company_id, null as code, t.title as name, coalesce(r.code || ' ', '') || r.name as sub, '/risks/' || r.id as link
        from risk_treatment_actions t join risks r on r.id = t.risk_id where t.control_id = ${id}::uuid`;
    case "exception": {
      if (T !== "control") return null;
      const perm = sql.raw(`case e.kind ${Object.entries(EXCEPTION_ACCESS).map(([k, a]) => `when '${k}' then '${a.perm}'`).join(" ")} end`);
      const lab = sql.raw(`case e.kind ${Object.entries(EXCEPTION_LABELS.kind).map(([k, l]) => `when '${k}' then '${l}'`).join(" ")} end`);
      return sql`select e.id, e.company_id, null as code, e.title as name, ${lab} as sub, '/exceptions' as link, ${perm} as perm from exception_controls e where e.control_id = ${id}::uuid`;
    }
    case "cra_product":
      if (T === "control") return null;
      return sql`select x.id, x.company_id, x.code, x.name || coalesce(' ' || x.version, '') as name, null as sub, '' as link from cra_products x where x.id in (${via(`cra_product_${T === "process" ? "processes" : `${T}s`}`, "product_id", T, id)})`;
  }
}

const PATH: Partial<Record<BacklinkKind, Parameters<typeof recordPath>[0]>> = {
  incident: "incident",
  change: "change",
  activity: "activity",
  ai_system: "ai_system",
  plan: "plan",
  bia: "bia",
  control: "control",
  supplier: "supplier",
  audit: "audit",
  supplier_report: "supplier_report",
  cra_product: "cra_product",
};

/** Zpětné vazby cíle – jen skupiny a záznamy, které uživatel smí číst. */
export async function backlinksFor(db: Db, c: Context<AppEnv>, target: LinkTarget, id: string): Promise<BacklinksDto> {
  const mods = new Set((await getSettings(db)).enabledModules as string[]);
  const groups: BacklinkGroup[] = [];
  for (const kind of BACKLINKS_FOR[target]) {
    const acc = BACKLINK_ACCESS[kind];
    if (!mods.has(acc.module)) continue;
    const q = query(kind, target, id);
    if (!q) continue;
    const rows = (await db.execute<Row>(q)) as unknown as Row[];
    const items: BacklinkItem[] = rows
      .filter((r) => hasPermIn(c, r.perm ?? acc.perm, r.company_id))
      .map((r) => ({ id: r.id, label: lbl(r), sub: r.sub, link: r.link || (PATH[kind] ? recordPath(PATH[kind]!, r.id) : "/") }))
      .sort((a, b) => a.label.localeCompare(b.label, "cs"));
    if (items.length) groups.push({ kind, items: items.slice(0, 100) });
  }
  return { target, id, groups };
}

export function linkRoutes(db: Db) {
  return new Hono<AppEnv>().get(
    "/:target/:id",
    requirePerm(...[...new Set(Object.values(TARGET).map((t) => t.perm))]),
    zValidator("param", z.object({ target: z.enum(LINK_TARGETS), id: z.string().uuid() })),
    async (c) => {
      const { target, id } = c.req.valid("param");
      const tg = TARGET[target];
      if (!((await getSettings(db)).enabledModules as string[]).includes(tg.module)) throw new HTTPException(404, { message: "Záznam nenalezen" });
      const [row] = (await db.execute<{ id: string; company_id: string }>(sql`select id, company_id from ${sql.raw(tg.table)} where id = ${id}::uuid`)) as unknown as { id: string; company_id: string }[];
      if (!row) throw new HTTPException(404, { message: "Záznam nenalezen" });
      // cíl musí uživatel smět číst (aktivum i jako sdílené do jeho společnosti – ADR-085)
      const ok = target === "asset" ? hasPermIn(c, tg.perm, row.company_id) || (scopeOf(c).ids.some((x) => hasPermIn(c, tg.perm, x)) && (await assetVisible(db, c, { id: row.id, companyId: row.company_id }))) : hasPermIn(c, tg.perm, row.company_id);
      if (!ok) throw new HTTPException(404, { message: "Záznam nenalezen" });
      return c.json(await backlinksFor(db, c, target, id));
    },
  );
}
