import {
  APPETITE_CATEGORIES,
  AppetiteInput,
  KRI_KEYS,
  KRI_META,
  KriSettingInput,
  appetiteBreach,
  kriStatus,
  riskCategories,
  riskScore,
  triggerDue,
  GROUP_RISK_METRICS,
  type GroupRiskRowDto,
  type AppetiteCategory,
  type KriDto,
  type KriKey,
  type RiskAppetiteDto,
  type RiskLevel,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { hasPermIn, scopeOf, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { companies, kriSettings, riskAppetite, riskAppetiteApprovals, riskCatalog, risks, users } from "../../db/schema";
import { capabilityDtos, measureCompany, threatCoverage } from "./scenarios";
import { riskTriggers } from "./triggers";

/* ============================================================
 * Ochota riskovat a KRI (v1.23, ADR-120). Hodnoty KRI se počítají z dat při čtení; persistuje se nastavení
 * prahů a okamžik prvního překročení (breached_since) – podklad pro podnět „kri“ k přehodnocení rizik.
 * ============================================================ */

const KRI_LINKS: Record<KriKey, string> = {
  mfa_coverage: "/identity",
  edr_coverage: "/assets",
  kev_exposed: "/vulnerabilities",
  vuln_overdue_assets: "/vulnerabilities",
  restore_untested: "/continuity",
  unassessed_threats: "/risks/scenarios?tab=coverage",
  overdue_reassessments: "/risks",
};

async function kriValues(db: Db, companyId: string, now: Date): Promise<Record<KriKey, number | null>> {
  const caps = await capabilityDtos(db, companyId, await measureCompany(db, companyId, now));
  const cap = (k: string) => caps.find((c) => c.key === k);
  const metric = (k: string, m: string) => cap(k)?.metrics.find((x) => x.key === m);
  const pct = (k: string) => (cap(k)?.confidence === "measured" && cap(k)!.coverage != null ? Math.round(cap(k)!.coverage! * 1000) / 10 : null);
  const vm = cap("vuln_mgmt");
  const br = metric("backup_recovery", "processes_restore_tested");
  const cov = await threatCoverage(db, companyId);
  const open = await db.select({ id: risks.id }).from(risks).where(and(eq(risks.companyId, companyId), ne(risks.status, "closed")));
  const trig = await riskTriggers(db, open.map((r) => r.id));
  const today = now.toISOString().slice(0, 10);
  return {
    mfa_coverage: pct("mfa"),
    edr_coverage: pct("edr"),
    kev_exposed: vm?.confidence === "measured" ? (metric("vuln_mgmt", "kev_exposed_assets")?.value ?? 0) : null,
    vuln_overdue_assets: vm?.confidence === "measured" ? (metric("vuln_mgmt", "overdue_assets")?.value ?? 0) : null,
    restore_untested: br && br.total != null ? br.total - br.value : null,
    unassessed_threats: cov.assets.length ? cov.summary.unassessed : null,
    overdue_reassessments: [...trig.values()].filter((l) => l.length && (triggerDue(l) ?? "9999") < today).length,
  };
}

/** Spočítá KRI a zapíše okamžik prvního překročení (alert); po návratu do normy ho smaže. */
export async function refreshKris(db: Db, companyId: string, now = new Date()): Promise<KriDto[]> {
  const [values, rows] = await Promise.all([kriValues(db, companyId, now), db.select().from(kriSettings).where(eq(kriSettings.companyId, companyId))]);
  const out: KriDto[] = [];
  for (const key of KRI_KEYS) {
    const meta = KRI_META[key];
    const row = rows.find((r) => r.key === key);
    const warn = row?.warn ?? meta.warn;
    const alert = row?.alert ?? meta.alert;
    const enabled = row?.enabled ?? true;
    const status = enabled ? kriStatus(values[key], meta.direction, warn, alert) : "unknown";
    let since = row?.breachedSince ?? null;
    if (status === "alert" && !since) since = now;
    if (status !== "alert") since = null;
    if ((row?.breachedSince?.getTime() ?? null) !== (since?.getTime() ?? null))
      await db
        .insert(kriSettings)
        .values({ companyId, key, enabled, warn: row?.warn ?? null, alert: row?.alert ?? null, breachedSince: since, updatedAt: now })
        .onConflictDoUpdate({ target: [kriSettings.companyId, kriSettings.key], set: { breachedSince: since } });
    out.push({ key, unit: meta.unit, direction: meta.direction, value: values[key], warn, alert, enabled, status, breachedSince: since?.toISOString() ?? null, link: KRI_LINKS[key] });
  }
  return out;
}

export async function appetiteDto(db: Db, companyId: string, now = new Date()): Promise<RiskAppetiteDto> {
  const [items, [appr], policy] = await Promise.all([
    db.select().from(riskAppetite).where(eq(riskAppetite.companyId, companyId)),
    db.select({ a: riskAppetiteApprovals, by: users.displayName }).from(riskAppetiteApprovals).leftJoin(users, eq(users.id, riskAppetiteApprovals.approvedById)).where(eq(riskAppetiteApprovals.companyId, companyId)),
    settingsFor(db, null, companyId).then((s) => s.riskPolicy),
  ]);
  const limits = Object.fromEntries(items.map((i) => [i.category, i.maxLevel as RiskLevel])) as Partial<Record<AppetiteCategory, RiskLevel>>;
  const open = await db
    .select({
      r: risks,
      c: sql<boolean>`coalesce((select bool_or(k.affects_c) from risk_catalog k where k.id = ${risks.threatId} or k.id in (select l.catalog_id from risk_catalog_links l where l.risk_id = ${risks.id})), false)`,
      i: sql<boolean>`coalesce((select bool_or(k.affects_i) from risk_catalog k where k.id = ${risks.threatId} or k.id in (select l.catalog_id from risk_catalog_links l where l.risk_id = ${risks.id})), false)`,
      a: sql<boolean>`coalesce((select bool_or(k.affects_a) from risk_catalog k where k.id = ${risks.threatId} or k.id in (select l.catalog_id from risk_catalog_links l where l.risk_id = ${risks.id})), false)`,
      supplier: sql<boolean>`(exists (select 1 from supplier_risks sr where sr.risk_id = ${risks.id}) or exists (select 1 from ${riskCatalog} k where (k.id = ${risks.threatId} or k.id in (select l.catalog_id from risk_catalog_links l where l.risk_id = ${risks.id})) and k.code in ('H11', 'H19')))`,
    })
    .from(risks)
    .where(and(eq(risks.companyId, companyId), ne(risks.status, "closed")));
  const breaches: RiskAppetiteDto["breaches"] = [];
  for (const x of open) {
    const level = riskScore(policy, x.r, x.r.scaleLevels).level;
    const b = appetiteBreach(level, riskCategories({ c: x.c, i: x.i, a: x.a, supplier: x.supplier }), limits);
    if (b.breached) breaches.push({ riskId: x.r.id, code: x.r.code, name: x.r.name, level: level!, limit: b.limit!, categories: b.categories, treatment: x.r.treatment });
  }
  const order = ["critical", "high", "medium", "low"];
  breaches.sort((p, q) => order.indexOf(p.level) - order.indexOf(q.level) || p.name.localeCompare(q.name));
  return {
    categories: APPETITE_CATEGORIES.map((k) => {
      const i = items.find((x) => x.category === k);
      return { key: k, maxLevel: (i?.maxLevel as RiskLevel) ?? null, statement: i?.statement ?? null };
    }),
    approvedByName: appr?.by ?? null,
    approvedAt: appr?.a.approvedAt.toISOString() ?? null,
    changedAfterApproval: !!appr && items.some((i) => i.updatedAt.getTime() > appr.a.approvedAt.getTime()),
    breaches,
    kris: await refreshKris(db, companyId, now),
  };
}

export function appetiteRoutes(db: Db) {
  return new Hono<AppEnv>()
    .use("*", requireModule(db, "risks"))
    .get("/", requirePerm("risks:read"), async (c) => c.json(await appetiteDto(db, targetCompany(c, c.req.query("companyId") ?? null))))
    /** Přehled skupiny z posledních měsíčních snímků trendů (v1.24, ADR-121) – jen společnosti s risks:read. */
    .get("/group", requirePerm("risks:read"), async (c) => {
      const ids = scopeOf(c).ids.filter((id) => hasPermIn(c, "risks:read", id));
      if (!ids.length) return c.json([] as GroupRiskRowDto[]);
      const cos = await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, ids)).orderBy(companies.name);
      const snaps = await db.execute<{ company_id: string; period: string; taken_at: Date; values: Record<string, number | null> }>(
        sql`select distinct on (company_id) company_id, period, taken_at, "values" from trend_snapshots where company_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) order by company_id, period desc`,
      );
      const by = new Map([...snaps].map((s) => [s.company_id, s]));
      return c.json(
        cos.map((co): GroupRiskRowDto => {
          const s = by.get(co.id);
          return { companyId: co.id, name: co.name, period: s?.period ?? null, takenAt: s ? new Date(s.taken_at).toISOString() : null, values: Object.fromEntries(GROUP_RISK_METRICS.map((k) => [k, s?.values?.[k] ?? null])) };
        }),
      );
    })
    .put("/", requirePerm("risks:write"), zValidator("json", AppetiteInput), async (c) => {
      const companyId = targetCompany(c, null, "risks:write");
      const v = c.req.valid("json");
      const now = new Date();
      for (const it of v.items) {
        const row = { maxLevel: it.maxLevel, statement: it.statement ?? null, updatedById: currentUser(c).id, updatedAt: now };
        await db.insert(riskAppetite).values({ ...row, companyId, category: it.key }).onConflictDoUpdate({ target: [riskAppetite.companyId, riskAppetite.category], set: row });
      }
      await audit(db, { c, user: currentUser(c), action: "risk.appetite_updated", entityType: "company", entityId: companyId, details: { items: v.items.map((i) => ({ key: i.key, maxLevel: i.maxLevel })) } });
      return c.json(await appetiteDto(db, companyId));
    })
    .post("/approve", requirePerm("risks:write"), async (c) => {
      const companyId = targetCompany(c, null, "risks:write");
      const [any] = await db.select({ n: sql<number>`count(*)::int` }).from(riskAppetite).where(eq(riskAppetite.companyId, companyId));
      if (!any?.n) throw new HTTPException(400, { message: "Nejdřív stanovte ochotu riskovat." });
      const row = { approvedById: currentUser(c).id, approvedAt: new Date() };
      await db.insert(riskAppetiteApprovals).values({ ...row, companyId }).onConflictDoUpdate({ target: riskAppetiteApprovals.companyId, set: row });
      await audit(db, { c, user: currentUser(c), action: "risk.appetite_approved", entityType: "company", entityId: companyId, details: {} });
      return c.json(await appetiteDto(db, companyId));
    })
    .put("/kri/:key", requirePerm("risks:write"), zValidator("json", KriSettingInput), async (c) => {
      const key = c.req.param("key") as KriKey;
      if (!KRI_KEYS.includes(key)) throw new HTTPException(404, { message: "Neznámý ukazatel" });
      const companyId = targetCompany(c, null, "risks:write");
      const v = c.req.valid("json");
      const meta = KRI_META[key];
      if (meta.direction === "min" ? v.alert > v.warn : v.alert < v.warn) throw new HTTPException(400, { message: "Práh překročení musí být přísnější než práh varování." });
      const row = { enabled: v.enabled, warn: v.warn, alert: v.alert, updatedAt: new Date() };
      await db.insert(kriSettings).values({ ...row, companyId, key }).onConflictDoUpdate({ target: [kriSettings.companyId, kriSettings.key], set: row });
      await audit(db, { c, user: currentUser(c), action: "risk.kri_updated", entityType: "company", entityId: companyId, details: { key, ...v } });
      return c.json(await appetiteDto(db, companyId));
    });
}

/** Denní přepočet KRI (okamžik překročení pro podněty) u společností, které používají scénáře, ochotu nebo KRI. */
let lastKriRun = "";
export async function processKriRefresh(db: Db, now = new Date()) {
  const dayKey = now.toISOString().slice(0, 10);
  if (lastKriRun === dayKey) return { companies: 0 };
  lastKriRun = dayKey;
  const rows = await db.execute<{ id: string }>(sql`select company_id as id from risk_scenario_proposals union select company_id from kri_settings union select company_id from risk_appetite`);
  let n = 0;
  for (const r of [...rows]) {
    await refreshKris(db, r.id, now).catch((e) => console.error("KRI:", (e as Error).message));
    n++;
  }
  return { companies: n };
}
