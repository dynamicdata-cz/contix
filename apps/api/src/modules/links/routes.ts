import { BACKLINKS_FOR, EXCEPTION_LABELS, LINK_TARGETS, recordPath, type BacklinkGroup, type BacklinkItem, type BacklinkKind, type BacklinksDto, type LinkTarget, type Permission, RISK_SCENARIO_LABELS, AUTOMATION_LABELS } from "@contix/shared";
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
  project: { perm: "projects:read", module: "projects" },
  tls_endpoint: { perm: "assets:read", module: "assets" },
  access_resource: { perm: "access:manage", module: "access" },
  scenario_proposal: { perm: "risks:read", module: "risks" },
  subprocess: { perm: "processes:read", module: "processes" },
  supplier_contract: { perm: "suppliers:read", module: "suppliers" },
  cra_finding: { perm: "cra:read", module: "cra" },
  attack_path: { perm: "risks:read", module: "risks" },
  legal_task: { perm: "legislation:read", module: "legislation" },
  control_automation: { perm: "controls:read", module: "controls" },
  data_location: { perm: "suppliers:read", module: "suppliers" },
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
      if (T === "supplier") return sql`select a.id, a.company_id, a.code, a.title as name, null as sub, '' as link from audits a where a.supplier_id = ${id}::uuid`;
      // rozsah auditu (v1.88, ADR-183)
      if (T === "asset" || T === "process" || T === "control")
        return sql`select a.id, a.company_id, a.code, a.title as name, a.performed_end::text as sub, '' as link from audits a where a.id in (${via(`audit_${T === "process" ? "processes" : `${T}s`}`, "audit_id", T, id)})`;
      return null;
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
    case "tls_endpoint":
      if (T !== "asset") return null;
      return sql`select x.id, x.company_id, null as code, x.host || ':' || x.port as name, to_char(x.not_after, 'YYYY-MM-DD') as sub, '/assets/certificates' as link from tls_endpoints x where x.asset_id = ${id}::uuid`;
    case "access_resource":
      if (T !== "asset") return null;
      return sql`select x.id, x.company_id, null as code, x.name, x.ad_group as sub, '/access?tab=resources' as link from iam_resources x where x.asset_id = ${id}::uuid and x.active`;
    case "subprocess":
      if (T !== "process") return null;
      return sql`select x.id, x.company_id, x.code, x.name, null as sub, '/processes/' || x.id as link from processes x where x.parent_id = ${id}::uuid`;
    case "supplier_contract":
      if (T !== "process") return null;
      return sql`select k.id, s.company_id, k.number as code, k.title as name, s.name as sub, '/suppliers/' || s.id as link
        from supplier_contract_processes cp join supplier_contracts k on k.id = cp.contract_id join suppliers s on s.id = k.supplier_id where cp.process_id = ${id}::uuid`;
    case "cra_finding":
      if (T !== "risk") return null;
      return sql`select f.id, f.company_id, null as code, f.vuln_id || ' – ' || f.component_ref as name, p.name as sub, '/cra/' || p.id as link
        from cra_findings f join cra_products p on p.id = f.product_id where f.risk_id = ${id}::uuid`;
    case "attack_path":
      if (T !== "risk") return null;
      return sql`select d.path_key as id, d.company_id, null as code, d.path_key as name, d.status as sub, '/risks/modeling' as link from attack_path_decisions d where d.risk_id = ${id}::uuid`;
    case "legal_task":
      if (T !== "control") return null;
      return sql`select x.id, x.company_id, null as code, x.title as name, x.status::text as sub, '/legislation' as link from legal_tasks x where x.control_id = ${id}::uuid`;
    case "control_automation":
      if (T !== "control") return null;
      {
        const lab = sql.raw(`case x.kind::text ${Object.entries(AUTOMATION_LABELS.kind).map(([k, l]) => `when '${k}' then '${l}'`).join(" ")} else x.kind::text end`);
        return sql`select x.id, x.company_id, null as code, ${lab} as name, x.frequency as sub, case x.kind::text when 'sca' then '/controls/sca' else '/identity?tab=automations' end as link from control_automations x where x.control_id = ${id}::uuid`;
      }
    case "data_location":
      if (T !== "supplier") return null;
      return sql`select x.id, x.company_id, null as code, x.name, x.country as sub, '/suppliers/locations' as link from data_locations x where x.supplier_id = ${id}::uuid`;
    case "scenario_proposal":
      if (T !== "asset" && T !== "risk") return null;
      {
        const name = sql.raw(`case x.template_key ${Object.entries(RISK_SCENARIO_LABELS.template).map(([k, l]) => `when '${k}' then '${String(l).replace(/'/g, "''")}'`).join(" ")} else x.template_key end`);
        return sql`select x.id, x.company_id, null as code, ${name} as name, null as sub, '/risks/scenarios' as link from risk_scenario_proposals x where ${T === "asset" ? sql`x.primary_asset_id = ${id}::uuid and x.status = 'proposed'` : sql`x.risk_id = ${id}::uuid`}`;
      }
    case "project":
      if (T === "control") return null;
      return sql`select x.id, x.company_id, x.code, x.name, null as sub, '' as link from projects x where x.id in (${via(`project_${T === "process" ? "processes" : `${T}s`}`, "project_id", T, id)})${
        T === "supplier" ? sql` or x.id in (select project_id from project_costs where supplier_id = ${id}::uuid)` : sql``
      }`;
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
  project: "project",
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
