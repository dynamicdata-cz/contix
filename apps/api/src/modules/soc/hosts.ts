import {
  SOC_OPEN_STATUSES,
  hostDaily,
  hostKeyOf,
  parseHostKey,
  socSeverity,
  type SocHostDetail,
  type SocHostListItem,
  type TiMatch,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, scopeOf } from "../../auth/scope";
import { getSettings, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { alertSuggestions, assets, assetVulnerabilities, incidentAssets, incidents, positions, socActions, socCases, socIocs, tasks, vulnIntel } from "../../db/schema";
import { vulnPrioritySql } from "../vulnerabilities/intel";
import { effLevelSql } from "./exposure";
import { linkedRisks } from "./grc";
import { alertBase, alertDtos } from "./routes";
import { caseCode, getSocSettings } from "./service";

/* ============================================================
 * Pohled na hostitele (ADR-061) – přehled hostitelů s alerty a detail jednoho stroje.
 * Hostitel = aktivum, u alertů bez aktiva krátké jméno agenta. Jen čtení, při čtení.
 * ============================================================ */

type Ctx = Context<AppEnv>;
const DAY = 864e5;
/** Krátké jméno agenta v SQL (stejně jako `hostKeyOfAgent`). */
const shortAgentSql = sql<string>`lower(split_part(${alertSuggestions.agentName}, '.', 1))`;
const hostKeySql = sql<string>`case when ${alertSuggestions.assetId} is not null then 'a:' || ${alertSuggestions.assetId}::text else 'h:' || ${shortAgentSql} end`;

export function socHostRoutes(db: Db) {
  const socIds = (c: Ctx) => scopeOf(c).ids.filter((id) => hasPermIn(c, "soc:read", id));
  const inSoc = (c: Ctx): SQL => {
    const ids = socIds(c);
    return ids.length ? inArray(alertSuggestions.companyId, ids) : sql`false`;
  };
  const mods = async () => (await getSettings(db)).enabledModules as string[];

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "soc"))
      /** Hostitelé s alerty za období (nebo s otevřenými alerty). */
      .get("/hosts", requirePerm("soc:read"), zValidator("query", z.object({ days: z.coerce.number().int().min(1).max(365).default(30), q: z.string().trim().max(200).optional() })), async (c) => {
        const { days, q } = c.req.valid("query");
        const since = new Date(Date.now() - days * DAY);
        const rows = await db
          .select({
            key: hostKeySql,
            companyId: alertSuggestions.companyId,
            assetId: sql<string | null>`(array_agg(${alertSuggestions.assetId}))[1]`,
            assetName: sql<string | null>`max(${assets.name})`,
            criticality: sql<string | null>`max(${assets.criticality}::text)`,
            agentName: sql<string | null>`max(${alertSuggestions.agentName})`,
            total: sql<number>`count(*)::int`,
            open: sql<number>`count(*) filter (where ${alertSuggestions.status} in ('new','in_progress'))::int`,
            level: sql<number>`max(${effLevelSql})::int`,
            exploit: sql<boolean>`bool_or(coalesce((${alertSuggestions.exposure}->>'exploit')::boolean, false))`,
            intel: sql<boolean>`bool_or(${alertSuggestions.intel} is not null)`,
            tactics: sql<string[]>`array_agg(array_to_string(${alertSuggestions.mitreTactics}, ','))`,
            lastSeen: sql<Date>`max(${alertSuggestions.lastSeen})`,
          })
          .from(alertSuggestions)
          .leftJoin(assets, eq(assets.id, alertSuggestions.assetId))
          .where(
            and(
              inSoc(c),
              or(gte(alertSuggestions.lastSeen, since), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES])),
              or(sql`${alertSuggestions.assetId} is not null`, sql`coalesce(${alertSuggestions.agentName}, '') <> ''`),
              q ? or(sql`${assets.name} ilike ${`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`, sql`${alertSuggestions.agentName} ilike ${`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`}`) : undefined,
            ),
          )
          .groupBy(hostKeySql, alertSuggestions.companyId)
          .orderBy(desc(sql`count(*) filter (where ${alertSuggestions.status} in ('new','in_progress'))`), desc(sql`max(${effLevelSql})`), desc(sql`max(${alertSuggestions.lastSeen})`))
          .limit(500);
        const out: SocHostListItem[] = rows.map((r) => ({
          key: r.key,
          companyId: r.companyId,
          assetId: r.key.startsWith("a:") ? r.key.slice(2) : null,
          name: r.assetName ?? r.agentName ?? r.key.slice(2),
          agentName: r.agentName,
          criticality: r.criticality,
          total: r.total,
          open: r.open,
          severity: socSeverity(r.level),
          exploit: r.exploit,
          intel: r.intel,
          tactics: new Set((r.tactics ?? []).flatMap((x) => (x ? x.split(",") : []))).size,
          lastSeen: new Date(r.lastSeen).toISOString(),
        }));
        return c.json(out);
      })
      /** Detail hostitele. */
      .get("/hosts/:key", requirePerm("soc:read"), zValidator("query", z.object({ days: z.coerce.number().int().min(7).max(365).default(30) })), async (c) => {
        const key = parseHostKey(c.req.param("key"));
        if (!key) throw new HTTPException(404, { message: "Hostitel nenalezen" });
        const { days } = c.req.valid("query");
        let companyId: string;
        let asset: (typeof assets.$inferSelect) | null = null;
        let where: SQL;
        if (key.kind === "asset") {
          const [a] = await db.select().from(assets).where(eq(assets.id, key.id));
          assertScope(c, a?.companyId, "Hostitel nenalezen");
          if (!hasPermIn(c, "soc:read", a!.companyId)) throw new HTTPException(404, { message: "Hostitel nenalezen" });
          asset = a!;
          companyId = a!.companyId;
          where = eq(alertSuggestions.assetId, a!.id);
        } else {
          where = and(isNull(alertSuggestions.assetId), sql`${shortAgentSql} = ${key.name}`, inSoc(c))!;
          const [first] = await db.select({ companyId: alertSuggestions.companyId }).from(alertSuggestions).where(where).limit(1);
          if (!first) throw new HTTPException(404, { message: "Hostitel nenalezen" });
          companyId = first.companyId;
          where = and(where, eq(alertSuggestions.companyId, companyId))!;
        }
        const since = new Date(Date.now() - days * DAY);
        const rows = await alertBase(db)
          .where(and(where, or(gte(alertSuggestions.lastSeen, since), inArray(alertSuggestions.status, [...SOC_OPEN_STATUSES]))))
          .orderBy(desc(alertSuggestions.lastSeen))
          .limit(500);
        const alerts = alertDtos(rows, await getSocSettings(db));
        const raw = rows.map((r) => r.s);
        const ids = raw.map((a) => a.id);
        const enabled = await mods();
        const canAssets = !!asset && hasPermIn(c, "assets:read", companyId);
        const canInc = enabled.includes("incidents") && hasPermIn(c, "incidents:read", companyId);
        const agentIds = [...new Set(raw.map((a) => a.agentId).filter((x): x is string => !!x))];

        const [vulnRows, iocRows, incRows, caseRows, taskRows, actionRows] = await Promise.all([
          canAssets
            ? db
                .select({ cveId: assetVulnerabilities.cveId, severity: assetVulnerabilities.severity, cvss: assetVulnerabilities.cvssScore, kev: vulnIntel.kev, epss: vulnIntel.epss, priority: vulnPrioritySql })
                .from(assetVulnerabilities)
                .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
                .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
                .where(and(eq(assetVulnerabilities.assetId, asset!.id), eq(assetVulnerabilities.status, "open")))
                .orderBy(vulnPrioritySql, sql`${assetVulnerabilities.cvssScore} desc nulls last`)
            : Promise.resolve(null),
          ids.length ? db.select({ id: socIocs.id, type: socIocs.type, value: socIocs.value, action: socIocs.action }).from(socIocs).where(and(inArray(socIocs.sourceAlertId, ids), isNull(socIocs.revokedAt))) : Promise.resolve([]),
          canInc
            ? db
                .selectDistinct({ id: incidents.id, code: incidents.code, title: incidents.title, status: incidents.status, detectedAt: incidents.detectedAt })
                .from(incidents)
                .leftJoin(incidentAssets, eq(incidentAssets.incidentId, incidents.id))
                .where(
                  and(
                    eq(incidents.companyId, companyId),
                    or(
                      ids.length ? inArray(incidents.id, raw.map((a) => a.incidentId).filter((x): x is string => !!x).concat(["00000000-0000-0000-0000-000000000000"])) : sql`false`,
                      asset ? eq(incidentAssets.targetId, asset.id) : sql`false`,
                    ),
                  ),
                )
                .orderBy(desc(incidents.detectedAt))
                .limit(50)
            : Promise.resolve([]),
          raw.some((a) => a.caseId)
            ? db.select({ id: socCases.id, seq: socCases.seq, title: socCases.title, status: socCases.status }).from(socCases).where(inArray(socCases.id, [...new Set(raw.map((a) => a.caseId).filter((x): x is string => !!x))]))
            : Promise.resolve([]),
          ids.length
            ? db
                .select({ t: tasks, pos: positions.name })
                .from(tasks)
                .leftJoin(positions, eq(positions.id, tasks.ownerPositionId))
                .where(and(eq(tasks.sourceKind, "soc_alert"), inArray(tasks.sourceId, ids)))
                .orderBy(desc(tasks.createdAt))
                .limit(100)
            : Promise.resolve([]),
          ids.length || agentIds.length
            ? db
                .select({ id: socActions.id, kind: socActions.kind, target: socActions.target, status: socActions.status, createdAt: socActions.createdAt })
                .from(socActions)
                .where(and(eq(socActions.companyId, companyId), or(ids.length ? inArray(socActions.alertId, ids) : sql`false`, agentIds.length ? sql`${socActions.agentIds} && ${sql`array[${sql.join(agentIds.map((x) => sql`${x}`), sql`, `)}]::text[]`}` : sql`false`)))
                .orderBy(desc(socActions.createdAt))
                .limit(50)
            : Promise.resolve([]),
        ]);

        const tactics: Record<string, number> = {};
        for (const a of alerts) for (const t of a.mitreTactics) tactics[t] = (tactics[t] ?? 0) + 1;
        const intelMap = new Map<string, TiMatch>();
        for (const a of alerts) for (const m of a.intel ?? []) intelMap.set(`${m.source}|${m.type}|${m.value}`, m);
        const out: SocHostDetail = {
          key: c.req.param("key"),
          companyId,
          name: asset?.name ?? raw.find((a) => a.agentName)?.agentName ?? c.req.param("key").slice(2),
          days,
          asset: asset
            ? {
                id: asset.id,
                name: asset.name,
                assetType: asset.assetType,
                criticality: asset.criticality,
                healthStatus: asset.healthStatus,
                confidentiality: asset.confidentiality,
                integrity: asset.integrity,
                availability: asset.availability,
                ipAddresses: asset.ipAddresses,
                os: [asset.osName, asset.osVersion].filter(Boolean).join(" ") || null,
              }
            : null,
          agentNames: [...new Set(raw.map((a) => a.agentName).filter((x): x is string => !!x))],
          counts: {
            total: alerts.length,
            open: alerts.filter((a) => (SOC_OPEN_STATUSES as readonly string[]).includes(a.status)).length,
            escalated: alerts.filter((a) => a.status === "accepted").length,
            truePositive: alerts.filter((a) => a.verdict === "true_positive").length,
            falsePositive: alerts.filter((a) => a.verdict === "false_positive" || a.verdict === "benign").length,
            exploit: alerts.filter((a) => a.exposure?.exploit).length,
          },
          daily: hostDaily(alerts.filter((a) => new Date(a.firstSeen) >= since), days),
          tactics,
          alerts: alerts.slice(0, 200),
          vulns: vulnRows
            ? {
                total: vulnRows.length,
                p1: vulnRows.filter((v) => v.priority === 1).length,
                p2: vulnRows.filter((v) => v.priority === 2).length,
                top: vulnRows.slice(0, 15).map((v) => ({ cveId: v.cveId, severity: v.severity, cvss: v.cvss, kev: !!v.kev, epss: v.epss, priority: v.priority })),
              }
            : null,
          intel: [...intelMap.values()],
          iocs: iocRows,
          incidents: incRows.map((i) => ({ ...i, detectedAt: i.detectedAt.toISOString() })),
          cases: caseRows.map((x) => ({ id: x.id, code: caseCode(x.seq), title: x.title, status: x.status })),
          risks: asset ? await linkedRisks(db, c, companyId, [asset.id]) : [],
          tasks: taskRows.map(({ t, pos }) => ({ id: t.id, seq: t.seq, title: t.title, status: t.status, dueDate: t.dueDate, ownerPositionName: pos, alertId: t.sourceId })),
          actions: actionRows.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
        };
        return c.json(out);
      })
  );
}

export { hostKeyOf };
