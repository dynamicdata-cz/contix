import { QUALITY_CHECKS, QUALITY_META, QualityFixInput, qualityScore, type QualityCheck, type QualityCheckDto, type QualityDto, type QualityGap, type QualityItem } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { hasPermIn, scopeOf } from "../../auth/scope";
import { audit, getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, controls, orgUnits, positions, processes, risks, tasks, trendSnapshots, users } from "../../db/schema";
import { reassignHostFindingTasks } from "../collector/findings";
import { canonicalTags } from "../tags/routes";
import { reassignFindingTasks } from "../sectests/tasks";

/* ============================================================
 * Kvalita dat (v1.70, ADR-163): kontroly slabin v evidenci (při čtení, SQL, nic se nepersistuje) a hromadné
 * nastavení odpovědnosti. Jen společnosti, kde má uživatel čtecí oprávnění dané evidence (a zapnutý modul);
 * oprava jen se zápisem ve společnosti záznamu, funkce ze stejné společnosti, každá oprava do auditu.
 * ============================================================ */

const LIMIT = 200;
const ACTIVE = sql`lifecycle_status in ('active', 'maintenance')`;
/** SQL kontroly: sloupce id, company_id, label, link nad tabulkou s aliasem x. */
const CHECK_SQL: Record<QualityCheck, (ids: SQL) => SQL> = {
  assets_no_owner: (ids) => sql`select x.id, x.company_id, x.name as label, '/assets/' || x.id as link from assets x where x.company_id in (${ids}) and x.${ACTIVE} and x.owner_user_id is null and coalesce(x.owner_name, '') = '' order by x.name`,
  assets_findings_no_tech: (ids) => sql`select x.id, x.company_id, x.name as label, '/assets/' || x.id || '?tab=tasks' as link from assets x where x.company_id in (${ids}) and x.${ACTIVE}
    and x.technical_owner_user_id is null and x.technical_deputy_user_id is null
    and (exists (select 1 from sec_test_findings f where f.asset_id = x.id and f.status = 'open') or exists (select 1 from host_findings h where h.asset_id = x.id and h.status = 'open')
      or exists (select 1 from asset_vulnerabilities v where v.asset_id = x.id and v.status = 'open' and v.severity in ('critical', 'high')))
    order by x.name`,
  primary_unrated: (ids) => sql`select x.id, x.company_id, x.name as label, '/assets/' || x.id as link from assets x where x.company_id in (${ids}) and x.${ACTIVE} and x.asset_class = 'primary'
    and (x.confidentiality is null or x.integrity is null or x.availability is null) order by x.name`,
  risks_no_owner: (ids) => sql`select x.id, x.company_id, coalesce(x.code || ' ', '') || x.name as label, '/risks/' || x.id as link from risks x where x.company_id in (${ids}) and x.status <> 'closed' and x.owner_position_id is null order by x.code nulls last, x.name`,
  risks_unrated: (ids) => sql`select x.id, x.company_id, coalesce(x.code || ' ', '') || x.name as label, '/risks/' || x.id as link from risks x where x.company_id in (${ids}) and x.status <> 'closed' and x.impact is null and x.factor_values is null order by x.code nulls last, x.name`,
  controls_no_owner: (ids) => sql`select x.id, x.company_id, coalesce(x.code || ' ', '') || x.name as label, '/controls/' || x.id as link from controls x where x.company_id in (${ids}) and x.status <> 'not_applicable' and x.owner_position_id is null order by x.code nulls last, x.name`,
  controls_untested: (ids) => sql`select x.id, x.company_id, coalesce(x.code || ' ', '') || x.name as label, '/controls/' || x.id || '?tab=assurance' as link from controls x where x.company_id in (${ids}) and x.status = 'implemented'
    and not exists (select 1 from control_tests t where t.control_id = x.id and t.status = 'completed' and t.performed_at >= (now() - interval '12 months')::date)
    and not exists (select 1 from control_monitors m where m.control_id = x.id and m.enabled) order by x.code nulls last, x.name`,
  processes_no_owner: (ids) => sql`select x.id, x.company_id, coalesce(x.code || ' ', '') || x.name as label, '/processes/' || x.id as link from processes x where x.company_id in (${ids}) and x.status = 'active' and x.owner_position_id is null order by x.code nulls last, x.name`,
  findings_no_asset: (ids) => sql`select x.id, x.company_id, x.title || ' (' || x.host || coalesce(':' || x.port, '') || ')' as label, '/security-tests?finding=' || x.id as link from sec_test_findings x where x.company_id in (${ids}) and x.status = 'open' and x.asset_id is null order by x.severity, x.host`,
  hosts_no_asset: (ids) => sql`select x.id, x.company_id, x.hostname as label, '/discovery/hosts/' || x.id as link from host_inventories x where x.company_id in (${ids}) and x.asset_id is null order by x.hostname`,
  tasks_unassigned: (ids) => sql`select x.id, x.company_id, '#' || x.seq || ' ' || x.title as label, '/actions?task=' || x.id as link from tasks x where x.company_id in (${ids}) and x.status in ('open', 'in_progress') and x.assignee_user_id is null and x.owner_position_id is null order by x.due_date nulls last`,
  assets_unit_text: (ids) => sql`select x.id, x.company_id, x.name || ' – „' || x.owner_name || '“' as label, '/assets/' || x.id as link from assets x where x.company_id in (${ids}) and x.${ACTIVE}
    and x.owner_unit_id is null and coalesce(trim(x.owner_name), '') <> '' order by x.owner_name, x.name`,
  assets_tags_uncatalogued: (ids) => sql`select x.id, x.company_id, x.name || ' (' || array_to_string(x.tags, ', ') || ')' as label, '/assets/' || x.id as link from assets x where x.company_id in (${ids})
    and exists (select 1 from unnest(x.tags) t where not exists (select 1 from tags g where g.name = t)) order by x.name`,
  // aktivum procesu (přímo nebo podpůrné aktivum aktiva procesu) s nižší kritičností než proces (v1.88)
  assets_crit_below_process: (ids) => sql`with pa as (
      select pa.asset_id, p.criticality, p.name from process_assets pa join processes p on p.id = pa.process_id
      union all
      select l.supporting_id, p.criticality, p.name from process_assets pa join processes p on p.id = pa.process_id join asset_links l on l.primary_id = pa.asset_id
    ), worst as (
      select asset_id, max(array_position(array['low','medium','high','critical']::text[], criticality::text)) as rank,
        (array_agg(name order by array_position(array['low','medium','high','critical']::text[], criticality::text) desc))[1] as process
      from pa group by asset_id
    )
    select x.id, x.company_id, x.name || ' – ' || x.criticality::text || ' < ' || (array['low','medium','high','critical'])[w.rank] || ' (' || w.process || ')' as label, '/assets/' || x.id as link
    from assets x join worst w on w.asset_id = x.id
    where x.company_id in (${ids}) and x.${ACTIVE} and array_position(array['low','medium','high','critical']::text[], x.criticality::text) < w.rank
    order by w.rank desc, x.name`,
  suppliers_no_contract: (ids) => sql`select x.id, x.company_id, x.name as label, '/suppliers/' || x.id as link from suppliers x where x.company_id in (${ids}) and x.significant
    and not exists (select 1 from supplier_contracts k where k.supplier_id = x.id and (k.valid_to is null or k.valid_to >= current_date)) order by x.name`,
};

const availableChecks = (mods: Set<string>) => QUALITY_CHECKS.filter((k) => !QUALITY_META[k].module || mods.has(QUALITY_META[k].module!));

async function runCheck(db: Db, key: QualityCheck, ids: string[], limit: number): Promise<{ count: number; items: QualityItem[] }> {
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = (await db.execute<{ id: string; company_id: string; label: string; link: string; n: number }>(
    sql`select q.*, count(*) over ()::int as n from (${CHECK_SQL[key](list)}) q limit ${limit}`,
  )) as unknown as { id: string; company_id: string; label: string; link: string; n: number }[];
  return { count: rows[0]?.n ?? 0, items: rows.map((r) => ({ id: r.id, companyId: r.company_id, label: r.label, link: r.link })) };
}

/** Skóre a počet slabin za společnost (trendy, v1.71) – všechny kontroly zapnutých modulů, bez ohledu na oprávnění. */
export async function qualityOfCompany(db: Db, companyId: string, enabledModules: string[]): Promise<{ score: number | null; issues: number }> {
  const counts: number[] = [];
  for (const key of availableChecks(new Set(enabledModules))) counts.push((await runCheck(db, key, [companyId], 1)).count);
  return { score: qualityScore(counts), issues: counts.reduce((a, b) => a + b, 0) };
}

/**
 * Chybějící údaje podle osob (týdenní souhrn, v1.71, ADR-164): primární aktiva bez hodnocení CIA a aktiva s nálezy bez
 * technického garanta → business vlastník aktiva; otevřené úkoly bez řešitele → kdo úkol založil. Jen aktivní uživatelé.
 */
export async function qualityGapsByUser(db: Db, enabledModules: string[], perUser = 20): Promise<Map<string, QualityGap[]>> {
  const mods = new Set(enabledModules);
  const out = new Map<string, QualityGap[]>();
  const add = (uid: string, g: QualityGap) => {
    const l = out.get(uid) ?? [];
    if (l.length < perUser) l.push(g);
    out.set(uid, l);
  };
  if (mods.has("assets")) {
    const rows = (await db.execute(sql`
      select x.owner_user_id::text as uid, x.id::text as id, x.name,
        (x.asset_class = 'primary' and (x.confidentiality is null or x.integrity is null or x.availability is null)) as unrated,
        (x.technical_owner_user_id is null and x.technical_deputy_user_id is null
          and (exists (select 1 from sec_test_findings f where f.asset_id = x.id and f.status = 'open') or exists (select 1 from host_findings h where h.asset_id = x.id and h.status = 'open')
            or exists (select 1 from asset_vulnerabilities v where v.asset_id = x.id and v.status = 'open' and v.severity in ('critical', 'high')))) as no_tech
      from assets x join users u on u.id = x.owner_user_id and u.is_active
      where x.${ACTIVE} order by x.name`)) as unknown as { uid: string; id: string; name: string; unrated: boolean; no_tech: boolean }[];
    for (const r of rows) {
      if (r.unrated) add(r.uid, { kind: "asset_unrated", label: r.name, link: `/assets/${r.id}` });
      if (r.no_tech) add(r.uid, { kind: "asset_no_tech", label: r.name, link: `/assets/${r.id}` });
    }
  }
  {
    // úkoly (akce) jsou vždy zapnuté
    const rows = (await db.execute(sql`
      select x.created_by_id::text as uid, x.id::text as id, '#' || x.seq || ' ' || x.title as label from tasks x join users u on u.id = x.created_by_id and u.is_active
      where x.status in ('open', 'in_progress') and x.assignee_user_id is null and x.owner_position_id is null order by x.due_date nulls last`)) as unknown as { uid: string; id: string; label: string }[];
    for (const r of rows) add(r.uid, { kind: "task_unassigned", label: r.label, link: `/actions?task=${r.id}` });
  }
  return out;
}

export function qualityRoutes(db: Db) {
  return new Hono<AppEnv>()
    .get("/", requirePerm("assets:read", "risks:read", "controls:read", "processes:read", "suppliers:read", "actions:read", "sectests:read"), async (c) => {
      const mods = new Set((await getSettings(db)).enabledModules as string[]);
      const sc = scopeOf(c);
      const base = sc.active ? [sc.active] : sc.ids;
      const checks: QualityCheckDto[] = [];
      for (const key of availableChecks(mods)) {
        const m = QUALITY_META[key];
        const ids = base.filter((id) => hasPermIn(c, m.perm, id));
        if (!ids.length) continue;
        const { count, items } = await runCheck(db, key, ids, LIMIT);
        checks.push({ key, count, items, canFix: !!m.fix && ids.some((id) => hasPermIn(c, m.write, id)) });
      }
      const dto: QualityDto = { checks, score: qualityScore(checks.map((x) => x.count)) };
      // vývoj z měsíčních snímků trendů (aktivní společnost)
      if (sc.active) {
        const snaps = await db.select({ period: trendSnapshots.period, values: trendSnapshots.values }).from(trendSnapshots).where(eq(trendSnapshots.companyId, sc.active)).orderBy(desc(trendSnapshots.period)).limit(12);
        dto.history = snaps
          .filter((x) => x.values.quality_score != null)
          .map((x) => ({ period: x.period, score: x.values.quality_score ?? null, issues: x.values.quality_issues ?? null }))
          .reverse();
      }
      return c.json(dto);
    })
    .post("/fix", requirePerm("assets:write", "risks:write", "controls:write", "processes:write", "actions:write"), zValidator("json", QualityFixInput), async (c) => {
      const i = c.req.valid("json");
      const m = QUALITY_META[i.check];
      if (!m.fix) throw new HTTPException(400, { message: "Tuto kontrolu nelze opravit hromadně" });
      if (m.fix === "position" ? !i.positionId : m.fix === "unit" ? !i.unitId : m.fix === "normalize" ? !!(i.userId || i.positionId || i.unitId) : !i.userId)
        throw new HTTPException(400, { message: "Vyberte osobu, nebo funkční místo" });
      const ids = [...new Set(i.ids)];
      const T = { assets_no_owner: assets, assets_findings_no_tech: assets, assets_unit_text: assets, assets_tags_uncatalogued: assets, risks_no_owner: risks, controls_no_owner: controls, processes_no_owner: processes, tasks_unassigned: tasks } as const;
      const tbl = T[i.check as keyof typeof T];
      if (!tbl) throw new HTTPException(400, { message: "Tuto kontrolu nelze opravit hromadně" });
      const rows = (await db.select({ id: tbl.id, companyId: tbl.companyId }).from(tbl).where(inArray(tbl.id, ids))) as { id: string; companyId: string }[];
      if (rows.length !== ids.length || rows.some((r) => !hasPermIn(c, m.write, r.companyId))) throw new HTTPException(404, { message: "Záznam nenalezen" });
      let target = "";
      if (i.positionId) {
        const [p] = await db.select({ companyId: orgUnits.companyId, name: positions.name }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(positions.id, i.positionId));
        if (!p || rows.some((r) => r.companyId !== p.companyId)) throw new HTTPException(400, { message: "Funkční místo musí patřit do společnosti záznamu" });
        target = p.name;
      } else if (i.unitId) {
        const [u] = await db.select({ companyId: orgUnits.companyId, name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.id, i.unitId));
        if (!u || rows.some((r) => r.companyId !== u.companyId)) throw new HTTPException(400, { message: "Útvar nepatří do společnosti záznamu" });
        target = u.name;
      } else if (m.fix === "normalize") {
        target = "katalog štítků";
      } else {
        const [u] = await db.select({ id: users.id, name: users.displayName, active: users.isActive }).from(users).where(eq(users.id, i.userId!));
        if (!u?.active) throw new HTTPException(400, { message: "Cílový uživatel neexistuje nebo není aktivní" });
        target = u.name;
      }
      const now = new Date();
      if (i.check === "assets_no_owner") await db.update(assets).set({ ownerUserId: i.userId!, updatedAt: now }).where(and(inArray(assets.id, ids), sql`${assets.ownerUserId} is null`));
      if (i.check === "assets_findings_no_tech") {
        await db.update(assets).set({ technicalOwnerUserId: i.userId!, updatedAt: now }).where(and(inArray(assets.id, ids), sql`${assets.technicalOwnerUserId} is null`));
        for (const id of ids) {
          await reassignFindingTasks(db, { assetId: id });
          await reassignHostFindingTasks(db, { assetId: id });
        }
      }
      if (i.check === "assets_unit_text") await db.update(assets).set({ ownerUnitId: i.unitId!, updatedAt: now }).where(and(inArray(assets.id, ids), sql`${assets.ownerUnitId} is null`));
      // sjednocení štítků s katalogem: chybějící se založí, ostatní v pravopisu katalogu
      if (i.check === "assets_tags_uncatalogued")
        for (const a of await db.select({ id: assets.id, tags: assets.tags }).from(assets).where(inArray(assets.id, ids)))
          await db.update(assets).set({ tags: await canonicalTags(db, a.tags), updatedAt: now }).where(eq(assets.id, a.id));
      if (i.check === "risks_no_owner") await db.update(risks).set({ ownerPositionId: i.positionId!, updatedAt: now }).where(and(inArray(risks.id, ids), sql`${risks.ownerPositionId} is null`));
      if (i.check === "controls_no_owner") await db.update(controls).set({ ownerPositionId: i.positionId!, updatedAt: now }).where(and(inArray(controls.id, ids), sql`${controls.ownerPositionId} is null`));
      if (i.check === "processes_no_owner") await db.update(processes).set({ ownerPositionId: i.positionId!, updatedAt: now }).where(and(inArray(processes.id, ids), sql`${processes.ownerPositionId} is null`));
      if (i.check === "tasks_unassigned") await db.update(tasks).set({ ownerPositionId: i.positionId!, updatedAt: now }).where(and(inArray(tasks.id, ids), sql`${tasks.ownerPositionId} is null`));
      await audit(db, { c, user: currentUser(c), action: "quality.bulk_fix", entityType: i.check, details: { check: i.check, ids: ids.slice(0, 100), count: ids.length, to: target } });
      return c.json({ updated: ids.length });
    });
}
