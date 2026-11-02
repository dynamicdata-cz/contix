import { AcceptVulnInput, VULN_PRIORITIES, VULN_SCANNERS, VulnScanImportOptions, VulnTriageInput, VulnMetricsQuery, type VulnScanDto, type VulnScanStats, type VulnScanner, VulnIntelSettingsInput, VulnListQuery, vulnPriority, type VulnFixPlanItem, type VulnPriority, type VulnSummaryDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { audit, type AppEnv } from "../../auth/service";
import { assertScope, hasPermIn, inScope, targetCompany } from "../../auth/scope";
import type { Db } from "../../db/client";
import { assets, assetVulnerabilities, users, vulnIntel, vulnScans } from "../../db/schema";
import { createHash } from "node:crypto";
import { detectScanner, parseScan } from "./parsers";
import { uploadScan } from "./scans";
import { vulnMetrics } from "./metrics";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { decodeFile, getVulnSla, intelStatus, refreshVulnIntel, saveIntelSettings, storeEpss, storeKev, vulnDueSql, vulnOverdueSql, vulnPrioritySql } from "./intel";
import { lastVulnSync, recomputeHealth } from "./service";

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const PRIO_NUM: Record<VulnPriority, number> = { p1: 1, p2: 2, p3: 3, p4: 4 };

export function vulnerabilityRoutes(db: Db, intelFetch?: FetchLike) {
  async function assertCanEdit(c: Context<AppEnv>, vulnId: string) {
    const [row] = await db
      .select({ id: assetVulnerabilities.id, assetId: assets.id, ownerUserId: assets.ownerUserId, cveId: assetVulnerabilities.cveId, companyId: assets.companyId })
      .from(assetVulnerabilities)
      .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
      .where(eq(assetVulnerabilities.id, vulnId));
    if (!row) throw new HTTPException(404, { message: "Zranitelnost nenalezena" });
    assertScope(c, row.companyId, "Zranitelnost nenalezena");
    if (hasPerm(c, "assets:write")) return row;
    if (hasPerm(c, "assets:write_own") && row.ownerUserId === currentUser(c).id) return row;
    throw new HTTPException(403, { message: "Výjimku může udělit správce aktiv nebo garant aktiva" });
  }

  async function scanList(c: Context<AppEnv>, id?: string): Promise<VulnScanDto[]> {
    const rows = await db
      .select({
        s: vulnScans,
        assetName: assets.name,
        importedByName: users.displayName,
        open: sql<number>`(select count(*)::int from asset_vulnerabilities v where v.scan_id = ${vulnScans.id} and v.status = 'open')`,
      })
      .from(vulnScans)
      .leftJoin(assets, eq(assets.id, vulnScans.assetId))
      .leftJoin(users, eq(users.id, vulnScans.importedById))
      .where(and(inScope(c, vulnScans.companyId), id ? eq(vulnScans.id, id) : undefined))
      .orderBy(desc(vulnScans.importedAt))
      .limit(200);
    return rows.map(({ s, assetName, importedByName, open }) => ({
      id: s.id,
      companyId: s.companyId,
      scanner: (VULN_SCANNERS as readonly string[]).includes(s.scanner) ? (s.scanner as VulnScanner) : "csv",
      name: s.name,
      fileName: s.fileName,
      external: s.external,
      closeMissing: s.closeMissing,
      assetId: s.assetId,
      assetName,
      stats: s.stats as unknown as VulnScanStats,
      unmatchedHosts: s.unmatchedHosts,
      importedAt: s.importedAt.toISOString(),
      importedByName,
      open,
    }));
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "vulnerabilities"))
      .get("/summary", requirePerm("assets:read"), async (c) => {
        const sevRank = sql`case ${assetVulnerabilities.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
        const sc = inScope(c, assets.companyId);
        const inAssets = sql`${assetVulnerabilities.assetId} in (select ${assets.id} from ${assets} where ${sc})`;
        const open = and(eq(assetVulnerabilities.status, "open"), inAssets)!;
        const [health, support, bySev, [accepted], topAssets, topPackages, topCves, eolAssets, lastSync] = await Promise.all([
          db.select({ k: assets.healthStatus, n: count() }).from(assets).where(sc).groupBy(assets.healthStatus),
          db.select({ k: assets.supportStatus, n: count() }).from(assets).where(sc).groupBy(assets.supportStatus),
          db
            .select({ k: assetVulnerabilities.severity, n: count() })
            .from(assetVulnerabilities)
            .where(open)
            .groupBy(assetVulnerabilities.severity),
          db.select({ n: count() }).from(assetVulnerabilities).where(and(eq(assetVulnerabilities.status, "accepted"), inAssets)),
          db
            .select({
              id: assets.id,
              name: assets.name,
              healthStatus: assets.healthStatus,
              critical: assets.vulnCritical,
              high: assets.vulnHigh,
              medium: assets.vulnMedium,
              low: assets.vulnLow,
            })
            .from(assets)
            .where(and(sc, sql`${assets.vulnCritical} + ${assets.vulnHigh} + ${assets.vulnMedium} + ${assets.vulnLow} > 0`))
            .orderBy(desc(assets.vulnCritical), desc(assets.vulnHigh), desc(assets.vulnMedium), desc(assets.vulnLow))
            .limit(15),
          db
            .select({
              name: assetVulnerabilities.packageName,
              assets: sql<number>`count(distinct ${assetVulnerabilities.assetId})::int`,
              critical: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'critical')::int`,
              high: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'high')::int`,
              medium: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'medium')::int`,
              low: sql<number>`count(*) filter (where ${assetVulnerabilities.severity} = 'low')::int`,
            })
            .from(assetVulnerabilities)
            .where(and(open, sql`${assetVulnerabilities.packageName} <> ''`))
            .groupBy(assetVulnerabilities.packageName)
            .orderBy(sql`3 desc, 4 desc, 2 desc`)
            .limit(10),
          db
            .select({
              cveId: assetVulnerabilities.cveId,
              severity: sql<string>`(array_agg(${assetVulnerabilities.severity} order by ${sevRank} desc))[1]`,
              cvssScore: sql<number | null>`max(${assetVulnerabilities.cvssScore})`,
              assets: sql<number>`count(distinct ${assetVulnerabilities.assetId})::int`,
              packageName: sql<string | null>`min(nullif(${assetVulnerabilities.packageName}, ''))`,
            })
            .from(assetVulnerabilities)
            .where(open)
            .groupBy(assetVulnerabilities.cveId)
            .orderBy(sql`max(${sevRank}) desc, 4 desc, 3 desc nulls last`)
            .limit(10),
          db
            .select({
              id: assets.id,
              name: assets.name,
              osName: assets.osName,
              osVersion: assets.osVersion,
              eolDate: assets.osEolDate,
              supportStatus: assets.supportStatus,
            })
            .from(assets)
            .where(and(sc, inArray(assets.supportStatus, ["eol", "ending"])))
            .orderBy(asc(assets.osEolDate))
            .limit(25),
          lastVulnSync(db),
        ]);
        const sla = await getVulnSla(db);
        const [prio, [kevOpen], intel, [overdue]] = await Promise.all([
          db
            .select({ p: vulnPrioritySql, n: count() })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
            .where(and(eq(assetVulnerabilities.status, "open"), sc))
            // seskupit podle 1. sloupce – výraz s parametry by Postgres v GROUP BY nepoznal jako stejný
            .groupBy(sql`1`),
          db
            .select({ n: count() })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .innerJoin(vulnIntel, and(eq(vulnIntel.cveId, assetVulnerabilities.cveId), eq(vulnIntel.kev, true)))
            .where(and(eq(assetVulnerabilities.status, "open"), sc)),
          intelStatus(db),
          db
            .select({ n: count() })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
            .where(and(sc, vulnOverdueSql(sla))),
        ]);
        const toRec = <K extends string>(rows: { k: K; n: number }[], keys: readonly K[]) =>
          Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.k === k)?.n ?? 0])) as Record<K, number>;
        const body: VulnSummaryDto = {
          health: toRec(health, ["green", "orange", "red", "unknown"] as const),
          support: toRec(support, ["supported", "ending", "eol", "unknown"] as const),
          openBySeverity: toRec(bySev, ["critical", "high", "medium", "low", "unknown"] as const),
          accepted: accepted?.n ?? 0,
          topAssets,
          topPackages,
          topCves: topCves as VulnSummaryDto["topCves"],
          eolAssets,
          lastSync,
          openByPriority: Object.fromEntries(VULN_PRIORITIES.map((k) => [k, prio.find((r) => Number(r.p) === PRIO_NUM[k])?.n ?? 0])) as VulnSummaryDto["openByPriority"],
          kevOpen: kevOpen?.n ?? 0,
          overdue: overdue?.n ?? 0,
          intel,
        };
        return c.json(body);
      })

      .get("/", requirePerm("assets:read"), zValidator("query", VulnListQuery), async (c) => {
        const q = c.req.valid("query");
        const where: SQL[] = [inScope(c, assets.companyId)];
        if (q.assetId) where.push(eq(assetVulnerabilities.assetId, q.assetId));
        if (q.severity) where.push(eq(assetVulnerabilities.severity, q.severity));
        if (q.status) where.push(eq(assetVulnerabilities.status, q.status));
        if (q.q)
          where.push(
            or(
              ilike(assetVulnerabilities.cveId, likeOf(q.q)),
              ilike(assetVulnerabilities.packageName, likeOf(q.q)),
              ilike(assetVulnerabilities.title, likeOf(q.q)),
              ilike(assetVulnerabilities.endpoint, likeOf(q.q)),
              ilike(assets.name, likeOf(q.q)),
            )!,
          );
        if (q.priority) where.push(sql`${vulnPrioritySql} = ${PRIO_NUM[q.priority]}`);
        if (q.kev) where.push(eq(vulnIntel.kev, true));
        if (q.packageName) where.push(eq(assetVulnerabilities.packageName, q.packageName));
        if (q.scanId) where.push(eq(assetVulnerabilities.scanId, q.scanId));
        if (q.scanner) where.push(q.scanner === "wazuh" ? eq(assetVulnerabilities.sourceType, "wazuh") : eq(assetVulnerabilities.scanner, q.scanner));
        if (q.verified) where.push(eq(assetVulnerabilities.verified, true));
        const sla = await getVulnSla(db);
        if (q.overdue) where.push(vulnOverdueSql(sla));
        const cond = where.length ? and(...where) : undefined;
        const sevRank = sql`case ${assetVulnerabilities.severity} when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end`;
        const [items, [total]] = await Promise.all([
          db
            .select({
              id: assetVulnerabilities.id,
              assetId: assetVulnerabilities.assetId,
              assetName: assets.name,
              cveId: assetVulnerabilities.cveId,
              severity: assetVulnerabilities.severity,
              cvssScore: assetVulnerabilities.cvssScore,
              packageName: assetVulnerabilities.packageName,
              packageVersion: assetVulnerabilities.packageVersion,
              description: assetVulnerabilities.description,
              reference: assetVulnerabilities.reference,
              publishedAt: assetVulnerabilities.publishedAt,
              detectedAt: assetVulnerabilities.detectedAt,
              status: assetVulnerabilities.status,
              acceptedReason: assetVulnerabilities.acceptedReason,
              acceptedUntil: assetVulnerabilities.acceptedUntil,
              acceptedByName: users.displayName,
              firstSeenAt: assetVulnerabilities.firstSeenAt,
              lastSeenAt: assetVulnerabilities.lastSeenAt,
              resolvedAt: assetVulnerabilities.resolvedAt,
              kev: vulnIntel.kev,
              kevRansomware: vulnIntel.kevRansomware,
              kevDateAdded: vulnIntel.kevDateAdded,
              epss: vulnIntel.epss,
              epssPercentile: vulnIntel.epssPercentile,
              criticality: assets.criticality,
              internetFacing: assets.internetFacing,
              due: vulnDueSql(sla),
              title: assetVulnerabilities.title,
              cwe: assetVulnerabilities.cwe,
              endpoint: assetVulnerabilities.endpoint,
              scanner: assetVulnerabilities.scanner,
              sourceType: assetVulnerabilities.sourceType,
              scanId: assetVulnerabilities.scanId,
              relatedCves: assetVulnerabilities.relatedCves,
              fixedVersion: assetVulnerabilities.fixedVersion,
              remediation: assetVulnerabilities.remediation,
              verified: assetVulnerabilities.verified,
              exposed: assetVulnerabilities.exposed,
              duplicateOfId: assetVulnerabilities.duplicateOfId,
              triageReason: assetVulnerabilities.triageReason,
            })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .leftJoin(users, eq(users.id, assetVulnerabilities.acceptedBy))
            .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
            .where(cond)
            .orderBy(asc(vulnPrioritySql), sql`${vulnIntel.epss} desc nulls last`, desc(sevRank), sql`${assetVulnerabilities.cvssScore} desc nulls last`, asc(assetVulnerabilities.cveId))
            .limit(q.limit)
            .offset(q.offset),
          db
            .select({ n: count() })
            .from(assetVulnerabilities)
            .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
            .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
            .where(cond),
        ]);
        const out = items.map(({ criticality, internetFacing, sourceType, ...v }) => {
          const p = vulnPriority({ severity: v.severity, kev: !!v.kev, kevRansomware: !!v.kevRansomware, epss: v.epss, assetCriticality: criticality, exposed: internetFacing || v.exposed });
          v.scanner = v.scanner || sourceType;
          const due = v.status === "open" ? v.due : null;
          return { ...v, due, overdue: !!due && due < new Date().toISOString().slice(0, 10), kev: !!v.kev, kevRansomware: !!v.kevRansomware, priority: p.priority, priorityReasons: p.reasons };
        });
        return c.json({ items: out, total: total?.n ?? 0, limit: q.limit, offset: q.offset });
      })

      /** Plán oprav: otevřené zranitelnosti podle balíčku – co zmizí opravou (aktualizací) jednoho balíčku. */
      .get("/fix-plan", requirePerm("assets:read"), async (c) => {
        const rows = await db
          .select({
            pkg: assetVulnerabilities.packageName,
            version: assetVulnerabilities.packageVersion,
            assetId: assets.id,
            assetName: assets.name,
            cveId: assetVulnerabilities.cveId,
            severity: assetVulnerabilities.severity,
            criticality: assets.criticality,
            exposed: sql<boolean>`(${assets.internetFacing} or ${assetVulnerabilities.exposed})`,
            kev: vulnIntel.kev,
            kevRansomware: vulnIntel.kevRansomware,
            epss: vulnIntel.epss,
            linked: sql<boolean>`exists (select 1 from risk_cves rc where rc.vulnerability_id = ${assetVulnerabilities.id})`,
          })
          .from(assetVulnerabilities)
          .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
          .leftJoin(vulnIntel, eq(vulnIntel.cveId, assetVulnerabilities.cveId))
          .where(and(inScope(c, assets.companyId), eq(assetVulnerabilities.status, "open"), sql`${assetVulnerabilities.packageName} <> ''`));
        const by = new Map<string, VulnFixPlanItem & { _assets: Map<string, string>; _versions: Set<string>; _cves: Map<string, { cveId: string; priority: VulnPriority; kev: boolean; epss: number | null }> }>();
        for (const r of rows) {
          let g = by.get(r.pkg);
          if (!g) {
            g = { packageName: r.pkg, assets: 0, assetNames: [], versions: [], cves: 0, byPriority: { p1: 0, p2: 0, p3: 0, p4: 0 }, kev: 0, maxEpss: null, critical: 0, sample: [], unlinked: 0, _assets: new Map(), _versions: new Set(), _cves: new Map() };
            by.set(r.pkg, g);
          }
          const p = vulnPriority({ severity: r.severity, kev: !!r.kev, kevRansomware: !!r.kevRansomware, epss: r.epss, assetCriticality: r.criticality, exposed: r.exposed }).priority;
          g.cves++;
          g.byPriority[p]++;
          if (r.kev) g.kev++;
          if (r.severity === "critical") g.critical++;
          if (r.epss != null) g.maxEpss = Math.max(g.maxEpss ?? 0, r.epss);
          if (!r.linked && (r.severity === "critical" || r.severity === "high")) g.unlinked++;
          g._assets.set(r.assetId, r.assetName);
          if (r.version) g._versions.add(r.version);
          const prev = g._cves.get(r.cveId);
          if (!prev || PRIO_NUM[p] < PRIO_NUM[prev.priority]) g._cves.set(r.cveId, { cveId: r.cveId, priority: p, kev: !!r.kev, epss: r.epss });
        }
        const score = (g: VulnFixPlanItem) => g.byPriority.p1 * 1_000_000 + g.byPriority.p2 * 1_000 + g.byPriority.p3;
        const items: VulnFixPlanItem[] = [...by.values()]
          .map(({ _assets, _versions, _cves, ...g }) => ({
            ...g,
            assets: _assets.size,
            assetNames: [..._assets.values()].sort().slice(0, 8),
            versions: [..._versions].sort().slice(0, 5),
            sample: [..._cves.values()].sort((a, b) => PRIO_NUM[a.priority] - PRIO_NUM[b.priority] || (b.epss ?? 0) - (a.epss ?? 0)).slice(0, 5),
          }))
          .sort((a, b) => score(b) - score(a) || b.cves - a.cves)
          .slice(0, 100);
        return c.json(items);
      })

      /* ---------- zdroje hrozeb (CISA KEV, EPSS) ---------- */
      .get("/intel", requirePerm("assets:read"), async (c) => c.json(await intelStatus(db)))
      .put("/intel/settings", requirePerm("admin:settings"), zValidator("json", VulnIntelSettingsInput), async (c) => {
        const input = c.req.valid("json");
        await saveIntelSettings(db, input);
        await audit(db, { c, user: currentUser(c), action: "vuln_intel.settings_updated", details: input });
        return c.json(await intelStatus(db));
      })
      .post("/intel/refresh", requirePerm("admin:settings"), async (c) => {
        const r = await refreshVulnIntel(db, intelFetch);
        await audit(db, { c, user: currentUser(c), action: "vuln_intel.refreshed", details: r });
        return c.json({ ...r, status: await intelStatus(db) });
      })
      /** Ruční nahrání (server bez internetu): JSON katalogu KEV, nebo CSV / CSV.GZ EPSS. */
      .post("/intel/upload", requirePerm("admin:settings"), async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        let text: string;
        try {
          text = decodeFile(new Uint8Array(await file.arrayBuffer()));
        } catch (e) {
          throw new HTTPException(400, { message: (e as Error).message });
        }
        const isKev = text.trimStart().startsWith("{");
        try {
          const n = isKev ? await storeKev(db, text) : await storeEpss(db, text);
          await audit(db, { c, user: currentUser(c), action: "vuln_intel.uploaded", details: { kind: isKev ? "kev" : "epss", entries: n, file: file.name } });
          return c.json({ kind: isKev ? "kev" : "epss", entries: n, status: await intelStatus(db) });
        } catch (e) {
          throw new HTTPException(400, { message: (e as Error).message });
        }
      })

      /** Metriky správy zranitelností (ADR-097). */
      .get("/metrics", requirePerm("assets:read"), zValidator("query", VulnMetricsQuery), async (c) => c.json(await vulnMetrics(db, inScope(c, assets.companyId), c.req.valid("query").months)))

      /* ---------- import výstupů skenerů (ADR-095) ---------- */
      .get("/scans", requirePerm("assets:read"), async (c) => c.json(await scanList(c)))
      .get("/scans/:id", requirePerm("assets:read"), async (c) => {
        const [s] = await scanList(c, c.req.param("id"));
        if (!s) throw new HTTPException(404, { message: "Import nenalezen" });
        return c.json(s);
      })
      /** Náhled (mode=preview) nebo zápis (mode=commit) výstupu skeneru – multipart: file + volby. */
      .post("/scans", requirePerm("assets:write"), async (c) => {
        const body = await c.req.parseBody();
        const me = currentUser(c);
        const up = await uploadScan(db, body, (requested) => targetCompany(c, requested, "assets:write"), me.id);
        if (up.kind === "preview") return c.json(up.preview);
        const { r, scanner, file } = up;
        await recomputeHealth(db);
        await audit(db, { c, user: me, action: "vuln_scan.imported", entityType: "vuln_scan", entityId: r.scanId, details: { scanner, file: file.name, ...r.stats } });
        const [dto] = await scanList(c, r.scanId);
        return c.json(dto, 201);
      })

      /** Triáž nálezů (ověřit, falešně pozitivní, mimo rozsah, duplicita, znovu otevřít) – hromadně. */
      .post("/triage", requirePerm("assets:write", "assets:write_own"), zValidator("json", VulnTriageInput), async (c) => {
        const input = c.req.valid("json");
        const me = currentUser(c);
        const ids = [...new Set(input.ids)];
        const rows = await db
          .select({ id: assetVulnerabilities.id, status: assetVulnerabilities.status, assetId: assets.id, ownerUserId: assets.ownerUserId, companyId: assets.companyId, cveId: assetVulnerabilities.cveId })
          .from(assetVulnerabilities)
          .innerJoin(assets, eq(assets.id, assetVulnerabilities.assetId))
          .where(inArray(assetVulnerabilities.id, ids));
        if (rows.length !== ids.length) throw new HTTPException(404, { message: "Zranitelnost nenalezena" });
        for (const r of rows) {
          assertScope(c, r.companyId, "Zranitelnost nenalezena");
          if (!hasPermIn(c, "assets:write", r.companyId) && !(hasPermIn(c, "assets:write_own", r.companyId) && r.ownerUserId === me.id))
            throw new HTTPException(403, { message: "Výjimku může udělit správce aktiv nebo garant aktiva" });
        }
        if (input.action === "duplicate") {
          const [orig] = await db.select({ id: assetVulnerabilities.id, assetId: assetVulnerabilities.assetId, status: assetVulnerabilities.status }).from(assetVulnerabilities).where(eq(assetVulnerabilities.id, input.duplicateOfId!));
          if (!orig || ids.includes(orig.id) || orig.status === "duplicate" || rows.some((r) => r.assetId !== orig.assetId))
            throw new HTTPException(400, { message: "Původní nález musí být jiný nález na stejném aktivu (ne duplicita)." });
        }
        const now = new Date();
        const by = { triagedBy: me.id, triagedAt: now };
        const active = ["open", "accepted"] as const;
        const [set, from] =
          input.action === "verify"
            ? [{ verified: true, ...by }, active]
            : input.action === "unverify"
              ? [{ verified: false, ...by }, active]
              : input.action === "reopen"
                ? [{ status: "open" as const, duplicateOfId: null, triageReason: null, ...by }, ["false_positive", "out_of_scope", "duplicate"] as const]
                : input.action === "duplicate"
                  ? [{ status: "duplicate" as const, duplicateOfId: input.duplicateOfId!, triageReason: input.reason || null, ...by }, active]
                  : [{ status: input.action, triageReason: input.reason!, ...by }, active];
        const changed = await db
          .update(assetVulnerabilities)
          .set(set)
          .where(and(inArray(assetVulnerabilities.id, ids), inArray(assetVulnerabilities.status, [...from])))
          .returning({ id: assetVulnerabilities.id });
        await recomputeHealth(db);
        await audit(db, {
          c,
          user: me,
          action: "vulnerability.triaged",
          entityType: rows.length === 1 ? "asset" : undefined,
          entityId: rows.length === 1 ? rows[0]!.assetId : undefined,
          details: { action: input.action, reason: input.reason, changed: changed.length, cves: [...new Set(rows.map((r) => r.cveId))].slice(0, 20) },
        });
        return c.json({ changed: changed.length });
      })

      /** Výjimka – akceptace rizika (např. kompenzační opatření, nelze aktualizovat). */
      .post("/:id/accept", zValidator("json", AcceptVulnInput), async (c) => {
        const row = await assertCanEdit(c, c.req.param("id"));
        const input = c.req.valid("json");
        const me = currentUser(c);
        await db
          .update(assetVulnerabilities)
          .set({ status: "accepted", acceptedBy: me.id, acceptedReason: input.reason, acceptedUntil: input.until ?? null })
          .where(eq(assetVulnerabilities.id, row.id));
        await recomputeHealth(db);
        await audit(db, {
          c,
          user: me,
          action: "vulnerability.accepted",
          entityType: "asset",
          entityId: row.assetId,
          details: { cve: row.cveId, reason: input.reason, until: input.until },
        });
        return c.json({ ok: true });
      })

      .post("/:id/reopen", async (c) => {
        const row = await assertCanEdit(c, c.req.param("id"));
        await db
          .update(assetVulnerabilities)
          .set({ status: "open", acceptedBy: null, acceptedReason: null, acceptedUntil: null })
          .where(and(eq(assetVulnerabilities.id, row.id), eq(assetVulnerabilities.status, "accepted")));
        await recomputeHealth(db);
        await audit(db, { c, user: currentUser(c), action: "vulnerability.reopened", entityType: "asset", entityId: row.assetId, details: { cve: row.cveId } });
        return c.json({ ok: true });
      })

      .post("/recompute", requirePerm("admin:settings", "discovery:run"), async (c) => {
        return c.json(await recomputeHealth(db));
      })
  );
}
