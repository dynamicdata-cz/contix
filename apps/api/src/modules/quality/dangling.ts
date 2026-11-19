import { sql } from "drizzle-orm";
import type { Db } from "../../db/client";

/* ============================================================
 * Odkazy na smazané záznamy (v1.88, ADR-183, L1): obecné vazby bez cizího klíče (štítky, zdroj úkolu, výjimky
 * kompenzované opatřením, vazby posouzení infoservisu, tikety v externích systémech). Úklid běží v plánovači.
 * ============================================================ */

/** Druh záznamu → tabulka (uuid id). */
export const ENTITY_TABLES: Record<string, string> = {
  incident: "incidents",
  supplier: "suppliers",
  change: "changes",
  control: "controls",
  asset: "assets",
  process: "processes",
  risk: "risks",
  policy: "policies",
  audit: "audits",
  processing: "processing_activities",
  soc_alert: "alert_suggestions",
  exercise: "exercises",
  info_item: "info_item_reviews",
  ai_system: "ai_systems",
  cra_product: "cra_products",
  soc2: "soc2_engagements",
  project: "projects",
  sectest_finding: "sec_test_findings",
  host_finding: "host_findings",
  vulnerability: "asset_vulnerabilities",
  identity_finding: "identity_findings",
  sod_violation: "sod_violations",
  location: "data_locations",
  task: "tasks",
};
/** Výjimky kompenzované opatřením: druh výjimky → tabulka záznamu (`requirement_na` je ID požadavku, ne tabulka). */
const EXCEPTION_TABLES: Record<string, string> = {
  identity_finding: "identity_findings",
  sod_violation: "sod_violations",
  vulnerability: "asset_vulnerabilities",
  risk_accepted: "risks",
  soc_suppression: "soc_suppressions",
  sectest_finding: "sec_test_findings",
  host_finding: "host_findings",
};

const missing = (table: string, col: string) => sql.raw(`not exists (select 1 from ${table} z where z.id::text = ${col}::text)`);

/** Počet odkazů na smazané záznamy podle druhu vazby (pro kontrolu a test). */
export async function countDangling(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const q = async (key: string, s: ReturnType<typeof sql>) => {
    const [r] = (await db.execute<{ n: number }>(s)) as unknown as { n: number }[];
    if (Number(r?.n)) out[key] = Number(r!.n);
  };
  for (const [kind, table] of Object.entries(ENTITY_TABLES)) {
    await q(`tag:${kind}`, sql`select count(*)::int as n from object_tags x where x.entity_type = ${kind} and ${missing(table, "x.entity_id")}`);
    await q(`task:${kind}`, sql`select count(*)::int as n from tasks x where x.source_kind = ${kind} and x.source_id is not null and ${missing(table, "x.source_id")}`);
  }
  for (const [kind, table] of Object.entries(EXCEPTION_TABLES)) await q(`exception:${kind}`, sql`select count(*)::int as n from exception_controls x where x.kind = ${kind} and ${missing(table, "x.record_id")}`);
  for (const kind of ["risk", "task", "incident"]) await q(`info:${kind}`, sql`select count(*)::int as n from info_assessment_links x where x.kind = ${kind} and ${missing(ENTITY_TABLES[kind]!, "x.target_id")}`);
  await q("external:task", sql`select count(*)::int as n from external_issues x where x.entity_type = 'task' and ${missing("tasks", "x.entity_id")}`);
  return out;
}

/** Úklid: štítky, výjimky, vazby infoservisu a externí tikety smazaných záznamů se odstraní; úkol zůstává, jen ztratí zdroj. */
export async function sweepDangling(db: Db): Promise<number> {
  let n = 0;
  const run = async (s: ReturnType<typeof sql>) => {
    const r = (await db.execute(s)) as unknown as { count?: number; length?: number };
    n += Number(r.count ?? r.length ?? 0);
  };
  for (const [kind, table] of Object.entries(ENTITY_TABLES)) {
    await run(sql`delete from object_tags x where x.entity_type = ${kind} and ${missing(table, "x.entity_id")}`);
    await run(sql`update tasks x set source_kind = null, source_id = null, updated_at = now() where x.source_kind = ${kind} and x.source_id is not null and ${missing(table, "x.source_id")}`);
  }
  for (const [kind, table] of Object.entries(EXCEPTION_TABLES)) await run(sql`delete from exception_controls x where x.kind = ${kind} and ${missing(table, "x.record_id")}`);
  for (const kind of ["risk", "task", "incident"]) await run(sql`delete from info_assessment_links x where x.kind = ${kind} and ${missing(ENTITY_TABLES[kind]!, "x.target_id")}`);
  await run(sql`delete from external_issues x where x.entity_type = 'task' and ${missing("tasks", "x.entity_id")}`);
  return n;
}
