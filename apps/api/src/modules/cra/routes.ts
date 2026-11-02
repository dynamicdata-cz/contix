import {
  CRA_REQUIREMENTS,
  BUILTIN_RISK_METHODOLOGY,
  CraLinksInput,
  type CraLinksDto,
  CRA_REPORT_STAGES,
  CraComponentInput,
  CraProductInput,
  CraProductPatch,
  CraReportInput,
  CraReportPatch,
  CraRequirementInput,
  CraFindingInput,
  CraFindingPatch,
  OsvSettingsInput,
  buildCycloneDxVex,
  buildOpenVex,
  cvesOf,
  type CraFindingDto,
  type VexJustification,
  type VexStatus,
  buildCraReport,
  craConformityOptions,
  craDeadlines,
  craProductGaps,
  craRequirementsFor,
  parseSbom,
  type CraCategory,
  type CraModule,
  type CraProductDto,
  type CraProductType,
  type CraReportDto,
  type CraReportKind,
  type CraReqState,
  type CraRole,
  type CraStatus,
  CraSupplyCheckInput,
  CRA_SUPPLY_CHECKS,
  EVIDENCE_MAX_BYTES,
  NvdSettingsInput,
  craSupplyChecksFor,
  csafRef,
  isSupplyRole,
  parseCsaf,
  supplyChecksOpen,
  type CraAdvisoryDto,
  type CraProductFileDto,
  type CraSupplyCheckState,
  type CsafAdvisory,
} from "@contix/shared";
import { createHash } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, settingsFor, targetCompany } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { users, craAdvisories, craProductFiles, assets, craComponents, craFindings, craProductAssets, craProductProcesses, craProductRisks, craProductSuppliers, craProducts, craReports, orgUnits, positionHolders, positions, processes, riskAssets, risks, suppliers, vulnIntel } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { componentRefOf, getOsvSettings, matchProducts, osvRecordsFromUpload, osvStatus, startOsvRefresh, storeOsvRecords, storeOsvSettings } from "./osv";
import { tFor } from "../i18n/service";
import { assetVisible } from "../assets/routes";
import { safeFilename } from "../assurance/routes";
import { mimeFor } from "../policies/mime";
import { getNvdSettings, matchAdvisories, nvdLookup, retireAdvisory, storeNvdSettings } from "./supply";

/* ============================================================
 * CRA (ADR-092): produkty s digitálními prvky, požadavky přílohy I a povinnosti podle role,
 * SBOM (CycloneDX / SPDX JSON) a hlášení čl. 14. Lhůty `craDeadlines`, mezery `craProductGaps`
 * a texty hlášení `buildCraReport` se počítají při čtení – nic se neodesílá.
 * ============================================================ */

type Ctx = Context<AppEnv>;
type Row = typeof craProducts.$inferSelect;
type ReportRow = typeof craReports.$inferSelect;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const today = () => new Date().toISOString().slice(0, 10);

export function reportDto(r: ReportRow, productName: string, now = new Date()): CraReportDto {
  const base = {
    kind: r.kind as CraReportKind,
    awareAt: r.awareAt.toISOString(),
    earlyWarningAt: iso(r.earlyWarningAt),
    notificationAt: iso(r.notificationAt),
    correctiveAvailableAt: iso(r.correctiveAvailableAt),
    finalReportAt: iso(r.finalReportAt),
  };
  return {
    id: r.id,
    productId: r.productId,
    productName,
    companyId: r.companyId,
    ...base,
    title: r.title,
    cveIds: r.cveIds,
    malicious: r.malicious,
    memberStates: r.memberStates,
    description: r.description,
    severity: r.severity,
    mitigation: r.mitigation,
    userMeasures: r.userMeasures,
    sensitivity: r.sensitivity,
    rootCause: r.rootCause,
    actorInfo: r.actorInfo,
    srpRef: r.srpRef,
    usersInformedAt: iso(r.usersInformedAt),
    closed: r.closed,
    deadlines: craDeadlines(base, now).map((d) => (r.closed && !d.doneAt ? { ...d, state: "waiting" as const } : d)),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function craRoutes(db: Db, deps: { fetchImpl?: FetchLike } = {}) {
  async function canEdit(c: Ctx, p: { ownerPositionId: string | null }) {
    if (hasPerm(c, "cra:write")) return true;
    if (!p.ownerPositionId) return false;
    const [x] = await db.select({ n: sql<number>`count(*)::int` }).from(positionHolders).where(and(eq(positionHolders.positionId, p.ownerPositionId), eq(positionHolders.userId, currentUser(c).id)));
    return x!.n > 0;
  }

  /** Nálezy zranitelností komponent s KEV / EPSS (ADR-093). */
  async function findingsOf(where: SQL | undefined): Promise<CraFindingDto[]> {
    const rows = await db.select().from(craFindings).where(where).orderBy(asc(craFindings.gone), asc(craFindings.vulnId));
    const cves = [...new Set(rows.flatMap((r) => cvesOf(r.vulnId, r.aliases)))];
    const intel = cves.length ? await db.select().from(vulnIntel).where(inArray(vulnIntel.cveId, cves)) : [];
    const im = new Map(intel.map((i) => [i.cveId, i]));
    const pids = [...new Set(rows.map((r) => r.productId))];
    const comps = pids.length ? await db.select().from(craComponents).where(inArray(craComponents.productId, pids)) : [];
    const cm = new Map(comps.map((x) => [`${x.productId}|${componentRefOf(x)}`, x]));
    // oznámení výrobců (CSAF) – popisek místo komponenty (v1.16)
    const companies = [...new Set(rows.filter((r) => r.source === "csaf").map((r) => r.companyId))];
    const advs = companies.length ? await db.select({ companyId: craAdvisories.companyId, namespace: craAdvisories.namespace, trackingId: craAdvisories.trackingId, title: craAdvisories.title }).from(craAdvisories).where(inArray(craAdvisories.companyId, companies)) : [];
    const am = new Map(advs.map((a) => [`${a.companyId}|${csafRef(a)}`, `${a.trackingId} – ${a.title}`]));
    const extName = (r: (typeof rows)[number]) => (r.source === "csaf" ? (am.get(`${r.companyId}|${r.componentRef}`) ?? r.componentRef.replace(/^csaf:/, "")) : r.source === "nvd" ? `NVD · ${r.componentRef.replace(/^cpe:/, "")}` : null);
    return rows.map((r) => {
      const cv = cvesOf(r.vulnId, r.aliases);
      const comp = cm.get(`${r.productId}|${r.componentRef}`);
      return {
        id: r.id,
        productId: r.productId,
        componentRef: r.componentRef,
        componentName: comp?.name ?? extName(r),
        componentVersion: comp?.version ?? null,
        vulnId: r.vulnId,
        aliases: r.aliases,
        cves: cv,
        summary: r.summary,
        severity: r.severity,
        source: r.source as CraFindingDto["source"],
        status: r.status as VexStatus,
        vendorStatus: (r.vendorStatus as VexStatus | null) ?? null,
        justification: (r.justification as VexJustification | null) ?? null,
        impactStatement: r.impactStatement,
        actionStatement: r.actionStatement,
        gone: r.gone,
        kev: cv.some((x) => im.get(x)?.kev),
        riskId: r.riskId ?? null,
        epss: cv.reduce<number | null>((m, x) => (im.get(x)?.epss != null ? Math.max(m ?? 0, im.get(x)!.epss!) : m), null),
        firstSeen: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async function load(c: Ctx, where: SQL | undefined): Promise<CraProductDto[]> {
    const rows = await db.select({ p: craProducts, ownerName: positions.name }).from(craProducts).leftJoin(positions, eq(positions.id, craProducts.ownerPositionId)).where(where).orderBy(asc(craProducts.code), asc(craProducts.name));
    const ids = rows.map((r) => r.p.id);
    const [comp, reps, fileRows, advCounts] = await Promise.all([
      ids.length ? db.select({ id: craComponents.productId, n: sql<number>`count(*)::int` }).from(craComponents).where(inArray(craComponents.productId, ids)).groupBy(craComponents.productId) : [],
      ids.length ? db.select().from(craReports).where(and(inArray(craReports.productId, ids), eq(craReports.closed, false))) : [],
      ids.length
        ? db
            .select({ id: craProductFiles.id, productId: craProductFiles.productId, checkKey: craProductFiles.checkKey, fileName: craProductFiles.fileName, fileSize: craProductFiles.fileSize, sha256: craProductFiles.fileSha256, by: users.displayName, createdAt: craProductFiles.createdAt })
            .from(craProductFiles)
            .leftJoin(users, eq(users.id, craProductFiles.uploadedById))
            .where(inArray(craProductFiles.productId, ids))
            .orderBy(asc(craProductFiles.createdAt))
        : [],
      ids.length ? db.select({ id: craFindings.productId, n: sql<number>`count(distinct ${craFindings.componentRef})::int` }).from(craFindings).where(and(inArray(craFindings.productId, ids), eq(craFindings.source, "csaf"), eq(craFindings.gone, false))).groupBy(craFindings.productId) : [],
    ]);
    const vulns = ids.length ? (await findingsOf(and(inArray(craFindings.productId, ids), eq(craFindings.gone, false)))).filter((f) => f.status === "under_investigation" || f.status === "affected") : [];
    const now = new Date();
    const out: CraProductDto[] = [];
    for (const { p, ownerName } of rows) {
      const requirements = craRequirementsFor(p.role as CraRole, p.requirements as Record<string, CraReqState>);
      const open = reps.filter((r) => r.productId === p.id);
      const overdue = open.filter((r) => reportDto(r, p.name, now).deadlines.some((d) => d.state === "overdue")).length;
      const componentCount = comp.find((x) => x.id === p.id)?.n ?? 0;
      const category = (p.category as CraCategory | null) ?? null;
      const files: CraProductFileDto[] = fileRows.filter((f) => f.productId === p.id).map((f) => ({ id: f.id, checkKey: f.checkKey, fileName: f.fileName, fileSize: f.fileSize, sha256: f.sha256, uploadedByName: f.by, createdAt: f.createdAt.toISOString() }));
      const supplyChecks = craSupplyChecksFor(p.role, p.supplyChecks as Record<string, CraSupplyCheckState>, files);
      const advisoryCount = advCounts.find((x) => x.id === p.id)?.n ?? 0;
      out.push({
        id: p.id,
        companyId: p.companyId,
        code: p.code,
        name: p.name,
        version: p.version,
        productType: p.productType as CraProductType,
        role: p.role as CraRole,
        status: p.status as CraStatus,
        oss: p.oss,
        description: p.description,
        intendedPurpose: p.intendedPurpose,
        category,
        categoryItem: p.categoryItem,
        onMarketSince: p.onMarketSince,
        supportUntil: p.supportUntil,
        supportJustification: p.supportJustification,
        conformityModule: (p.conformityModule as CraModule | null) ?? null,
        conformityOptions: category ? craConformityOptions(category, p.oss) : [],
        harmonisedStandards: p.harmonisedStandards,
        notifiedBody: p.notifiedBody,
        ceMarkedAt: p.ceMarkedAt,
        docIssuedAt: p.docIssuedAt,
        securityContact: p.securityContact,
        cvdPolicyUrl: p.cvdPolicyUrl,
        manufacturerName: p.manufacturerName,
        cpe: p.cpe,
        memberStates: p.memberStates,
        ownerPositionId: p.ownerPositionId,
        ownerPositionName: ownerName,
        requirements,
        componentCount,
        openReports: open.length,
        overdueReports: overdue,
        openVulns: vulns.filter((f) => f.productId === p.id).length,
        kevVulns: vulns.filter((f) => f.productId === p.id && f.kev).length,
        gaps: craProductGaps({
          role: p.role as CraRole,
          status: p.status as CraStatus,
          category,
          supportUntil: p.supportUntil,
          supportJustification: p.supportJustification,
          onMarketSince: p.onMarketSince,
          securityContact: p.securityContact,
          conformityModule: (p.conformityModule as CraModule | null) ?? null,
          oss: p.oss,
          components: componentCount,
          requirements,
          overdueReports: overdue,
          today: today(),
          openVulns: vulns.filter((f) => f.productId === p.id).length,
          kevVulns: vulns.filter((f) => f.productId === p.id && f.kev).length,
          supplyOpen: supplyChecksOpen(supplyChecks),
          vulnSource: componentCount > 0 || !!p.cpe || advisoryCount > 0,
        }),
        supplyChecks,
        files: files.filter((f) => !f.checkKey),
        advisoryCount,
        canEdit: await canEdit(c, p),
        updatedAt: p.updatedAt.toISOString(),
      });
    }
    return out;
  }

  async function row(c: Ctx, id: string): Promise<Row> {
    const [p] = await db.select().from(craProducts).where(eq(craProducts.id, id));
    if (!p) throw new HTTPException(404, { message: "Produkt nenalezen" });
    assertScope(c, p.companyId, "Produkt nenalezen");
    return p;
  }
  async function editable(c: Ctx, id: string) {
    const p = await row(c, id);
    if (!(await canEdit(c, p))) throw new HTTPException(403, { message: "Produkt upravuje jeho vlastník nebo správce CRA" });
    return p;
  }
  const one = async (c: Ctx, id: string) => (await load(c, eq(craProducts.id, id)))[0]!;
  async function linksOf(productId: string): Promise<CraLinksDto> {
    const code = (c: string | null, n: string) => (c ? `${c} ${n}` : n);
    const [a, s, pr, r] = await Promise.all([
      db.select({ id: assets.id, name: assets.name, assetType: assets.assetType, healthStatus: assets.healthStatus }).from(craProductAssets).innerJoin(assets, eq(assets.id, craProductAssets.targetId)).where(eq(craProductAssets.productId, productId)).orderBy(asc(assets.name)),
      db.select({ id: suppliers.id, name: suppliers.name }).from(craProductSuppliers).innerJoin(suppliers, eq(suppliers.id, craProductSuppliers.targetId)).where(eq(craProductSuppliers.productId, productId)).orderBy(asc(suppliers.name)),
      db.select({ id: processes.id, code: processes.code, name: processes.name }).from(craProductProcesses).innerJoin(processes, eq(processes.id, craProductProcesses.targetId)).where(eq(craProductProcesses.productId, productId)).orderBy(asc(processes.name)),
      db.select({ id: risks.id, code: risks.code, name: risks.name }).from(craProductRisks).innerJoin(risks, eq(risks.id, craProductRisks.targetId)).where(eq(craProductRisks.productId, productId)).orderBy(asc(risks.name)),
    ]);
    return { assets: a, suppliers: s, processes: pr.map((x) => ({ id: x.id, label: code(x.code, x.name) })), risks: r.map((x) => ({ id: x.id, label: code(x.code, x.name) })) };
  }
  async function advisoriesOf(where: SQL | undefined): Promise<CraAdvisoryDto[]> {
    const rows = await db.select({ a: craAdvisories, by: users.displayName }).from(craAdvisories).leftJoin(users, eq(users.id, craAdvisories.uploadedById)).where(where).orderBy(desc(craAdvisories.updatedAt));
    if (!rows.length) return [];
    const refs = rows.map((r) => csafRef(r.a));
    const hits = await db
      .selectDistinct({ ref: craFindings.componentRef, companyId: craFindings.companyId, id: craProducts.id, name: craProducts.name })
      .from(craFindings)
      .innerJoin(craProducts, eq(craProducts.id, craFindings.productId))
      .where(and(inArray(craFindings.componentRef, refs), eq(craFindings.gone, false)));
    return rows.map(({ a, by }) => {
      const d = a.data as unknown as CsafAdvisory;
      const ref = csafRef(a);
      return {
        id: a.id,
        companyId: a.companyId,
        publisher: a.publisher,
        trackingId: a.trackingId,
        version: a.version,
        title: a.title,
        currentRelease: a.currentRelease,
        products: d.products?.length ?? 0,
        vulnerabilities: d.vulnerabilities?.length ?? 0,
        matchedProducts: hits.filter((h) => h.ref === ref && h.companyId === a.companyId).map((h) => ({ id: h.id, name: h.name })),
        uploadedByName: by,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      };
    });
  }
  async function reportRow(c: Ctx, id: string) {
    const [r] = await db.select({ r: craReports, p: craProducts }).from(craReports).innerJoin(craProducts, eq(craProducts.id, craReports.productId)).where(eq(craReports.id, id));
    if (!r) throw new HTTPException(404, { message: "Hlášení nenalezeno" });
    assertScope(c, r.r.companyId, "Hlášení nenalezeno");
    return r;
  }
  async function positionOk(companyId: string, id: string | null | undefined) {
    if (!id) return;
    const [p] = await db.select({ companyId: orgUnits.companyId }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(positions.id, id));
    if (!p || p.companyId !== companyId) throw new HTTPException(400, { message: "Funkční místo nepatří do společnosti" });
  }
  const tsOf = (v: string | null | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
  function reportValues(input: z.infer<typeof CraReportPatch>) {
    const { awareAt, earlyWarningAt, notificationAt, correctiveAvailableAt, finalReportAt, usersInformedAt, ...rest } = input;
    const v: Record<string, unknown> = { ...rest };
    for (const [k, x] of Object.entries({ awareAt, earlyWarningAt, notificationAt, correctiveAvailableAt, finalReportAt, usersInformedAt })) {
      const d = tsOf(x as string | null | undefined);
      if (d !== undefined) v[k] = d;
    }
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<typeof craReports.$inferInsert>;
  }

  return (
    new Hono<AppEnv>()
      .use("*", requireModule(db, "cra"))
      .get("/", requirePerm("cra:read"), async (c) => c.json(await load(c, inScope(c, craProducts.companyId))))
      .get("/reports", requirePerm("cra:read"), zValidator("query", z.object({ open: z.enum(["1", "0"]).default("1") })), async (c) => {
        const rows = await db
          .select({ r: craReports, name: craProducts.name })
          .from(craReports)
          .innerJoin(craProducts, eq(craProducts.id, craReports.productId))
          .where(and(inScope(c, craReports.companyId), c.req.valid("query").open === "1" ? eq(craReports.closed, false) : undefined))
          .orderBy(desc(craReports.awareAt));
        return c.json(rows.map((x) => reportDto(x.r, x.name)));
      })
      .post("/", requirePerm("cra:write"), zValidator("json", CraProductInput), async (c) => {
        const { companyId: requested, ...input } = c.req.valid("json");
        const companyId = targetCompany(c, requested, "cra:write");
        await positionOk(companyId, input.ownerPositionId);
        const [p] = await db.insert(craProducts).values({ ...input, companyId }).returning();
        await matchAdvisories(db, { productIds: [p!.id] });
        await audit(db, { c, user: currentUser(c), action: "cra.product_created", entityType: "cra_product", entityId: p!.id, details: { name: p!.name, category: p!.category } });
        return c.json(await one(c, p!.id), 201);
      })
      .get("/reports/:rid", requirePerm("cra:read"), async (c) => {
        const x = await reportRow(c, c.req.param("rid"));
        return c.json(reportDto(x.r, x.p.name));
      })
      .patch("/reports/:rid", requirePerm("cra:read"), zValidator("json", CraReportPatch), async (c) => {
        const x = await reportRow(c, c.req.param("rid"));
        if (!(await canEdit(c, x.p))) throw new HTTPException(403, { message: "Produkt upravuje jeho vlastník nebo správce CRA" });
        const set = reportValues(c.req.valid("json"));
        if (Object.keys(set).length) await db.update(craReports).set({ ...set, updatedAt: new Date() }).where(eq(craReports.id, x.r.id));
        await audit(db, { c, user: currentUser(c), action: "cra.report_updated", entityType: "cra_report", entityId: x.r.id, details: { fields: Object.keys(set) } });
        const [r] = await db.select().from(craReports).where(eq(craReports.id, x.r.id));
        return c.json(reportDto(r!, x.p.name));
      })
      .delete("/reports/:rid", requirePerm("cra:write"), async (c) => {
        const x = await reportRow(c, c.req.param("rid"));
        if (x.r.earlyWarningAt || x.r.notificationAt || x.r.finalReportAt) throw new HTTPException(409, { message: "Podané hlášení nelze smazat – uzavřete ho." });
        await db.delete(craReports).where(eq(craReports.id, x.r.id));
        await audit(db, { c, user: currentUser(c), action: "cra.report_deleted", entityType: "cra_report", entityId: x.r.id, details: { title: x.r.title } });
        return c.json({ ok: true });
      })
      .get("/reports/:rid/text", requirePerm("cra:read"), zValidator("query", z.object({ stage: z.enum(CRA_REPORT_STAGES), lang: z.enum(["cs", "en"]).optional() })), async (c) => {
        const x = await reportRow(c, c.req.param("rid"));
        const { stage, lang } = c.req.valid("query");
        const t = await tFor(db, c);
        const s = await settingsFor(db, null, x.p.companyId);
        const manufacturer = x.p.role === "manufacturer" || x.p.role === "oss_steward" ? s.organizationName : (x.p.manufacturerName ?? s.organizationName);
        const r = reportDto(x.r, x.p.name);
        return c.json({ stage, sections: buildCraReport({ name: x.p.name, version: x.p.version, manufacturer }, r, stage, lang ?? (t.locale === "en" ? "en" : "cs")) });
      })
      /** Riziko z nálezu zranitelnosti produktu – jen na pokyn uživatele (v1.05, ADR-101); naváže produkt a jeho aktiva. */
      .post("/findings/:fid/risk", requirePerm("risks:write"), async (c) => {
        const [f] = await db.select().from(craFindings).where(eq(craFindings.id, c.req.param("fid")));
        if (!f) throw new HTTPException(404, { message: "Nález nenalezen" });
        assertScope(c, f.companyId, "Nález nenalezen");
        if (!hasPermIn(c, "risks:write", f.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        if (f.riskId) throw new HTTPException(409, { message: "K nálezu už riziko existuje." });
        const p = await row(c, f.productId);
        const [comp] = await db.select().from(craComponents).where(eq(craComponents.productId, p.id));
        const compLabel = (await findingsOf(eq(craFindings.id, f.id)))[0];
        const policy = (await settingsFor(db, c, p.companyId)).riskPolicy;
        const [risk] = await db
          .insert(risks)
          .values({
            companyId: p.companyId,
            name: `${p.name}${p.version ? ` ${p.version}` : ""}: ${f.vulnId} v ${compLabel?.componentName ?? comp?.name ?? f.componentRef}`.slice(0, 300),
            description: [
              `Zranitelnost ${f.vulnId}${compLabel?.cves.length ? ` (${compLabel.cves.join(", ")})` : ""} v komponentě ${compLabel?.componentName ?? f.componentRef}${compLabel?.componentVersion ? ` ${compLabel.componentVersion}` : ""} produktu ${p.name}.`,
              f.summary,
              compLabel?.kev ? "Zranitelnost je v katalogu aktivně zneužívaných (KEV) – zvažte hlášení podle čl. 14 CRA." : null,
              "Návrh z nálezu SBOM – ohodnoťte dopad a pravděpodobnost a doplňte opatření (aktualizace komponenty, VEX).",
            ]
              .filter(Boolean)
              .join("\n\n"),
            scaleLevels: policy.levels,
            methodologyKey: policy.methodology || BUILTIN_RISK_METHODOLOGY,
          })
          .returning({ id: risks.id });
        const assetIds = (await db.select({ id: craProductAssets.targetId }).from(craProductAssets).innerJoin(assets, eq(assets.id, craProductAssets.targetId)).where(and(eq(craProductAssets.productId, p.id), eq(assets.companyId, p.companyId)))).map((x) => x.id);
        if (assetIds.length) await db.insert(riskAssets).values(assetIds.map((assetId) => ({ riskId: risk!.id, assetId }))).onConflictDoNothing();
        await db.insert(craProductRisks).values({ productId: p.id, targetId: risk!.id }).onConflictDoNothing();
        await db.update(craFindings).set({ riskId: risk!.id, updatedAt: new Date() }).where(eq(craFindings.id, f.id));
        await audit(db, { c, user: currentUser(c), action: "risk.created_from_cra_finding", entityType: "risk", entityId: risk!.id, details: { productId: p.id, findingId: f.id, vulnId: f.vulnId } });
        return c.json({ riskId: risk!.id }, 201);
      })
      .patch("/findings/:fid", requirePerm("cra:read"), zValidator("json", CraFindingPatch), async (c) => {
        const [f] = await db.select().from(craFindings).where(eq(craFindings.id, c.req.param("fid")));
        if (!f) throw new HTTPException(404, { message: "Nález nenalezen" });
        assertScope(c, f.companyId, "Nález nenalezen");
        await editable(c, f.productId);
        const set = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<typeof craFindings.$inferInsert>;
        if ((set.status ?? f.status) === "not_affected" && !(set.justification ?? f.justification)) throw new HTTPException(400, { message: "Stav „Nezasaženo“ vyžaduje zdůvodnění." });
        if (set.status && set.status !== "not_affected") set.justification = null;
        await db.update(craFindings).set({ ...set, updatedAt: new Date() }).where(eq(craFindings.id, f.id));
        await audit(db, { c, user: currentUser(c), action: "cra.vex_updated", entityType: "cra_product", entityId: f.productId, details: { vulnId: f.vulnId, componentRef: f.componentRef, ...set } });
        return c.json((await findingsOf(eq(craFindings.id, f.id)))[0]);
      })

      /* ---------- offline databáze OSV ---------- */
      .get("/osv", requirePerm("cra:read"), async (c) => c.json(await osvStatus(db)))
      .put("/osv", requirePerm("cra:write"), zValidator("json", OsvSettingsInput), async (c) => {
        await storeOsvSettings(db, c.req.valid("json"));
        await audit(db, { c, user: currentUser(c), action: "cra.osv_settings_updated", details: c.req.valid("json") });
        return c.json(await osvStatus(db));
      })
      .post("/osv/refresh", requirePerm("cra:write"), async (c) => {
        if (!(await getOsvSettings(db)).ecosystems.length) throw new HTTPException(400, { message: "Vyberte ekosystémy OSV ke stažení." });
        // stahování trvá minuty – běží na pozadí, UI se dotazuje na stav (ADR-100)
        const user = currentUser(c);
        const started = await startOsvRefresh(db, deps.fetchImpl, async (r) => {
          await audit(db, { user, action: "cra.osv_refreshed", details: { records: r.records, matches: r.matches, errors: r.errors.length } });
        });
        if (!started) throw new HTTPException(409, { message: "Stahování databáze OSV už probíhá." });
        return c.json({ started: true, status: await osvStatus(db) }, 202);
      })
      .post("/osv/upload", requirePerm("cra:write"), async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        let recs;
        try {
          recs = osvRecordsFromUpload(new Uint8Array(await file.arrayBuffer()));
        } catch {
          throw new HTTPException(400, { message: "Soubor není archiv ani záznam OSV." });
        }
        if (!recs.length) throw new HTTPException(400, { message: "Soubor neobsahuje žádné záznamy OSV." });
        await storeOsvRecords(db, recs);
        const m = await matchProducts(db);
        await audit(db, { c, user: currentUser(c), action: "cra.osv_uploaded", details: { file: file.name, records: recs.length, matches: m.matches } });
        return c.json({ records: recs.length, ...m, status: await osvStatus(db) });
      })
      /* ---------- oznámení výrobců CSAF a NVD (v1.16, ADR-113) ---------- */
      .get("/advisories", requirePerm("cra:read"), async (c) => c.json(await advisoriesOf(inScope(c, craAdvisories.companyId))))
      .post("/advisories", requirePerm("cra:write"), async (c) => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        if (file.size > 20 * 1024 * 1024) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 20 MB)" });
        const companyId = targetCompany(c, typeof body.companyId === "string" && body.companyId ? body.companyId : null, "cra:write");
        const buf = Buffer.from(await file.arrayBuffer());
        let adv: CsafAdvisory;
        try {
          adv = parseCsaf(buf.toString("utf8"));
        } catch {
          throw new HTTPException(400, { message: "Soubor není oznámení CSAF 2.0 (JSON)." });
        }
        const [old] = await db.select().from(craAdvisories).where(and(eq(craAdvisories.companyId, companyId), eq(craAdvisories.namespace, adv.namespace), eq(craAdvisories.trackingId, adv.trackingId)));
        // starší revize nepřepíše novější (výrobce oznámení aktualizuje se stejným ID)
        if (old?.currentRelease && adv.currentRelease && old.currentRelease > adv.currentRelease) throw new HTTPException(409, { message: "Evidována je novější revize tohoto oznámení." });
        const values = { publisher: adv.publisher.slice(0, 300), namespace: adv.namespace.slice(0, 300), trackingId: adv.trackingId.slice(0, 200), version: adv.version.slice(0, 50), title: adv.title.slice(0, 500), currentRelease: adv.currentRelease, data: adv as unknown as Record<string, unknown>, fileSha256: createHash("sha256").update(buf).digest("hex") };
        const [row] = old
          ? await db.update(craAdvisories).set({ ...values, updatedAt: new Date() }).where(eq(craAdvisories.id, old.id)).returning()
          : await db.insert(craAdvisories).values({ ...values, companyId, uploadedById: currentUser(c).id }).returning();
        const m = await matchAdvisories(db, { companyIds: [companyId] });
        await audit(db, { c, user: currentUser(c), action: "cra.advisory_uploaded", entityType: "cra_advisory", entityId: row!.id, details: { trackingId: adv.trackingId, version: adv.version, publisher: adv.publisher, vulnerabilities: adv.vulnerabilities.length, matches: m.matches, replaced: !!old } });
        return c.json({ advisory: (await advisoriesOf(eq(craAdvisories.id, row!.id)))[0], vulnerabilities: adv.vulnerabilities.length, matches: m.matches }, old ? 200 : 201);
      })
      .delete("/advisories/:aid", requirePerm("cra:write"), async (c) => {
        const [a] = await db.select().from(craAdvisories).where(eq(craAdvisories.id, c.req.param("aid")));
        if (!a) throw new HTTPException(404, { message: "Oznámení nenalezeno" });
        assertScope(c, a.companyId, "Oznámení nenalezeno");
        if (!hasPermIn(c, "cra:write", a.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
        await retireAdvisory(db, a);
        await db.delete(craAdvisories).where(eq(craAdvisories.id, a.id));
        await audit(db, { c, user: currentUser(c), action: "cra.advisory_deleted", entityType: "cra_advisory", entityId: a.id, details: { trackingId: a.trackingId } });
        return c.json({ ok: true });
      })
      .get("/nvd", requirePerm("cra:read"), async (c) => c.json(await getNvdSettings(db)))
      .put("/nvd", requirePerm("admin:settings"), zValidator("json", NvdSettingsInput), async (c) => {
        const v = await storeNvdSettings(db, c.req.valid("json"));
        await audit(db, { c, user: currentUser(c), action: "cra.nvd_settings_updated", details: v });
        return c.json(v);
      })
      .get("/:id", requirePerm("cra:read"), async (c) => {
        const p = await row(c, c.req.param("id"));
        return c.json(await one(c, p.id));
      })
      .patch("/:id", requirePerm("cra:read"), zValidator("json", CraProductPatch), async (c) => {
        const cur = await editable(c, c.req.param("id"));
        const set = Object.fromEntries(Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined)) as Partial<typeof craProducts.$inferInsert>;
        if (!hasPerm(c, "cra:write")) delete set.ownerPositionId;
        await positionOk(cur.companyId, set.ownerPositionId);
        if (Object.keys(set).length) await db.update(craProducts).set({ ...set, updatedAt: new Date() }).where(eq(craProducts.id, cur.id));
        if (["cpe", "name", "version", "manufacturerName"].some((k) => k in set)) await matchAdvisories(db, { productIds: [cur.id] });
        await audit(db, { c, user: currentUser(c), action: "cra.product_updated", entityType: "cra_product", entityId: cur.id, details: set });
        return c.json(await one(c, cur.id));
      })
      .delete("/:id", requirePerm("cra:write"), async (c) => {
        const cur = await row(c, c.req.param("id"));
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(craReports).where(eq(craReports.productId, cur.id));
        if (r!.n > 0) throw new HTTPException(409, { message: "Produkt s hlášeními nelze smazat – označte ho jako stažený z trhu." });
        await db.delete(craProducts).where(eq(craProducts.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "cra.product_deleted", entityType: "cra_product", entityId: cur.id, details: { name: cur.name } });
        return c.json({ ok: true });
      })

      /* ---------- doklady výrobce – dovozce / distributor (v1.16, ADR-113) ---------- */
      .put("/:id/checks/:key", requirePerm("cra:read"), zValidator("json", CraSupplyCheckInput), async (c) => {
        const cur = await editable(c, c.req.param("id"));
        const key = c.req.param("key");
        const def = CRA_SUPPLY_CHECKS.find((x) => x.key === key);
        if (!def) throw new HTTPException(404, { message: "Neznámý doklad" });
        if (!isSupplyRole(cur.role) || !def.roles.includes(cur.role)) throw new HTTPException(409, { message: "Doklad se na roli organizace nevztahuje." });
        const { status, note, url } = c.req.valid("json");
        const state: CraSupplyCheckState = { status, note: note ?? null, url: url ?? null, at: today(), byName: currentUser(c).displayName };
        await db.update(craProducts).set({ supplyChecks: { ...(cur.supplyChecks as Record<string, unknown>), [key]: state }, updatedAt: new Date() }).where(eq(craProducts.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "cra.supply_check_updated", entityType: "cra_product", entityId: cur.id, details: { key, status } });
        return c.json(await one(c, cur.id));
      })
      .post("/:id/files", requirePerm("cra:read"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File) || file.size === 0) throw new HTTPException(400, { message: "Chybí soubor (pole „file“)" });
        if (file.size > EVIDENCE_MAX_BYTES) throw new HTTPException(413, { message: "Soubor je příliš velký (max. 25 MB)" });
        const checkKey = typeof body.checkKey === "string" && body.checkKey ? body.checkKey : null;
        if (checkKey && !CRA_SUPPLY_CHECKS.some((x) => x.key === checkKey)) throw new HTTPException(400, { message: "Neznámý doklad" });
        const buf = Buffer.from(await file.arrayBuffer());
        const name = safeFilename(file.name);
        const [f] = await db.insert(craProductFiles).values({ productId: p.id, checkKey, fileName: name, fileMime: mimeFor(name), fileSize: buf.length, fileSha256: createHash("sha256").update(buf).digest("hex"), content: buf, uploadedById: currentUser(c).id }).returning({ id: craProductFiles.id });
        await audit(db, { c, user: currentUser(c), action: "cra.file_uploaded", entityType: "cra_product", entityId: p.id, details: { fileId: f!.id, file: name, checkKey, size: buf.length } });
        return c.json(await one(c, p.id), 201);
      })
      .get("/:id/files/:fid", requirePerm("cra:read"), async (c) => {
        const p = await row(c, c.req.param("id"));
        const [f] = await db.select().from(craProductFiles).where(and(eq(craProductFiles.id, c.req.param("fid")), eq(craProductFiles.productId, p.id)));
        if (!f) throw new HTTPException(404, { message: "Soubor nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "cra.file_downloaded", entityType: "cra_product", entityId: p.id, details: { fileId: f.id, file: f.fileName } });
        return new Response(new Uint8Array(f.content), {
          headers: {
            "content-type": f.fileMime,
            "content-disposition": `attachment; filename="${f.fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'",
            "cache-control": "private, no-store",
          },
        });
      })
      .delete("/:id/files/:fid", requirePerm("cra:read"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const [f] = await db.delete(craProductFiles).where(and(eq(craProductFiles.id, c.req.param("fid")), eq(craProductFiles.productId, p.id))).returning({ id: craProductFiles.id, fileName: craProductFiles.fileName });
        if (!f) throw new HTTPException(404, { message: "Soubor nenalezen" });
        await audit(db, { c, user: currentUser(c), action: "cra.file_deleted", entityType: "cra_product", entityId: p.id, details: { fileId: f.id, file: f.fileName } });
        return c.json(await one(c, p.id));
      })
      /** Dohledání CVE podle CPE v NVD – jen na pokyn a jen je-li v nastavení výslovně zapnuto (odchází jen CPE). */
      .post("/:id/nvd", requirePerm("cra:read"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        if (!(await getNvdSettings(db)).enabled) throw new HTTPException(409, { message: "Dohledání v NVD je vypnuté (CRA → Zdroje zranitelností)." });
        if (!p.cpe) throw new HTTPException(400, { message: "Produkt nemá vyplněné CPE." });
        let r;
        try {
          r = await nvdLookup(db, p, deps.fetchImpl);
        } catch (e) {
          throw new HTTPException(502, { message: `NVD neodpovídá: ${(e as Error).message}`.slice(0, 300) });
        }
        await audit(db, { c, user: currentUser(c), action: "cra.nvd_lookup", entityType: "cra_product", entityId: p.id, details: { cpe: r.query, found: r.found, total: r.total } });
        return c.json(r);
      })

      /* ---------- požadavky ---------- */
      .put("/:id/requirements/:key", requirePerm("cra:read"), zValidator("json", CraRequirementInput), async (c) => {
        const cur = await editable(c, c.req.param("id"));
        const key = c.req.param("key");
        const def = CRA_REQUIREMENTS.find((r) => r.key === key);
        if (!def) throw new HTTPException(404, { message: "Neznámý požadavek" });
        if (!def.roles.includes(cur.role as CraRole)) throw new HTTPException(409, { message: "Požadavek se na roli organizace nevztahuje." });
        const { status, note } = c.req.valid("json");
        const next = { ...(cur.requirements as Record<string, CraReqState>), [key]: { status, note: note ?? null, at: today() } };
        await db.update(craProducts).set({ requirements: next, updatedAt: new Date() }).where(eq(craProducts.id, cur.id));
        await audit(db, { c, user: currentUser(c), action: "cra.requirement_updated", entityType: "cra_product", entityId: cur.id, details: { key, status } });
        return c.json(await one(c, cur.id));
      })

      /* ---------- SBOM ---------- */
      .get("/:id/components", requirePerm("cra:read"), async (c) => {
        const p = await row(c, c.req.param("id"));
        const rows = await db.select().from(craComponents).where(eq(craComponents.productId, p.id)).orderBy(asc(craComponents.name), asc(craComponents.version));
        return c.json(rows.map(({ productId: _p, createdAt: _c, ...x }) => x));
      })
      .post("/:id/components", requirePerm("cra:read"), zValidator("json", CraComponentInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const input = c.req.valid("json");
        await db.insert(craComponents).values({ ...input, productId: p.id });
        await matchProducts(db, [p.id]);
        await audit(db, { c, user: currentUser(c), action: "cra.component_added", entityType: "cra_product", entityId: p.id, details: { name: input.name } });
        return c.json(await one(c, p.id), 201);
      })
      .delete("/:id/components/:cid", requirePerm("cra:read"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        await db.delete(craComponents).where(and(eq(craComponents.id, c.req.param("cid")), eq(craComponents.productId, p.id)));
        await matchProducts(db, [p.id]);
        await audit(db, { c, user: currentUser(c), action: "cra.component_removed", entityType: "cra_product", entityId: p.id });
        return c.json(await one(c, p.id));
      })
      .post("/:id/sbom", requirePerm("cra:read"), zValidator("json", z.object({ text: z.string().min(2).max(10_000_000), replace: z.boolean().default(true) })), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const { text, replace } = c.req.valid("json");
        let parsed: ReturnType<typeof parseSbom>;
        try {
          parsed = parseSbom(text);
        } catch {
          throw new HTTPException(400, { message: "Soubor není SBOM (CycloneDX / SPDX JSON) ani zámek závislostí (bun.lock, package-lock.json, requirements.txt)." });
        }
        if (!parsed.components.length) throw new HTTPException(400, { message: "SBOM neobsahuje žádné komponenty." });
        await db.transaction(async (tx) => {
          if (replace) await tx.delete(craComponents).where(eq(craComponents.productId, p.id));
          for (let i = 0; i < parsed.components.length; i += 500) await tx.insert(craComponents).values(parsed.components.slice(i, i + 500).map((x) => ({ ...x, name: x.name.slice(0, 300), productId: p.id })));
        });
        const m = await matchProducts(db, [p.id]);
        await audit(db, { c, user: currentUser(c), action: "cra.sbom_imported", entityType: "cra_product", entityId: p.id, details: { format: parsed.format, components: parsed.components.length, replace, matches: m.matches } });
        return c.json({ format: parsed.format, imported: parsed.components.length, matches: m.matches });
      })

      /* ---------- vazby na aktiva, dodavatele, procesy a rizika (v1.05, ADR-101) ---------- */
      .get("/:id/links", requirePerm("cra:read"), async (c) => {
        const p = await row(c, c.req.param("id"));
        return c.json(await linksOf(p.id));
      })
      .put("/:id/links", requirePerm("cra:read"), zValidator("json", CraLinksInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const v = c.req.valid("json");
        // cíle jen ze společností v rozsahu uživatele; aktiva i sdílená (ADR-085)
        const check = async (rows: { id: string; companyId: string }[], want: string[]) => {
          if (rows.length !== new Set(want).size) throw new HTTPException(400, { message: "Neznámý navázaný záznam" });
          for (const r of rows) assertScope(c, r.companyId, "Navázaný záznam nenalezen");
        };
        const ids = (x: string[]) => [...new Set(x)];
        const aRows = v.assetIds.length ? await db.select({ id: assets.id, companyId: assets.companyId }).from(assets).where(inArray(assets.id, ids(v.assetIds))) : [];
        if (aRows.length !== ids(v.assetIds).length) throw new HTTPException(400, { message: "Neznámý navázaný záznam" });
        for (const a of aRows) if (!(await assetVisible(db, c, a))) throw new HTTPException(400, { message: "Neznámý navázaný záznam" });
        await check(v.supplierIds.length ? await db.select({ id: suppliers.id, companyId: suppliers.companyId }).from(suppliers).where(inArray(suppliers.id, ids(v.supplierIds))) : [], v.supplierIds);
        await check(v.processIds.length ? await db.select({ id: processes.id, companyId: processes.companyId }).from(processes).where(inArray(processes.id, ids(v.processIds))) : [], v.processIds);
        await check(v.riskIds.length ? await db.select({ id: risks.id, companyId: risks.companyId }).from(risks).where(inArray(risks.id, ids(v.riskIds))) : [], v.riskIds);
        await db.transaction(async (tx) => {
          for (const [t, list] of [
            [craProductAssets, v.assetIds],
            [craProductSuppliers, v.supplierIds],
            [craProductProcesses, v.processIds],
            [craProductRisks, v.riskIds],
          ] as const) {
            await tx.delete(t).where(eq(t.productId, p.id));
            if (list.length) await tx.insert(t).values(ids(list).map((targetId) => ({ productId: p.id, targetId })));
          }
        });
        await audit(db, { c, user: currentUser(c), action: "cra.links_updated", entityType: "cra_product", entityId: p.id, details: { assets: v.assetIds.length, suppliers: v.supplierIds.length, processes: v.processIds.length, risks: v.riskIds.length } });
        return c.json(await linksOf(p.id));
      })

      /* ---------- zranitelnosti komponent a VEX (ADR-093) ---------- */
      .get("/:id/findings", requirePerm("cra:read"), async (c) => {
        const p = await row(c, c.req.param("id"));
        return c.json(await findingsOf(eq(craFindings.productId, p.id)));
      })
      .post("/:id/findings", requirePerm("cra:read"), zValidator("json", CraFindingInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const input = c.req.valid("json");
        const [dup] = await db.select({ id: craFindings.id }).from(craFindings).where(and(eq(craFindings.productId, p.id), eq(craFindings.componentRef, input.componentRef), eq(craFindings.vulnId, input.vulnId.toUpperCase())));
        if (dup) throw new HTTPException(409, { message: "Zranitelnost u komponenty už je evidována." });
        await db.insert(craFindings).values({ companyId: p.companyId, productId: p.id, componentRef: input.componentRef, vulnId: input.vulnId.toUpperCase(), summary: input.summary ?? null, source: "manual" });
        await audit(db, { c, user: currentUser(c), action: "cra.finding_added", entityType: "cra_product", entityId: p.id, details: { vulnId: input.vulnId, componentRef: input.componentRef } });
        return c.json(await findingsOf(eq(craFindings.productId, p.id)), 201);
      })
      .post("/:id/match", requirePerm("cra:read"), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const m = await matchProducts(db, [p.id]);
        return c.json(m);
      })
      .get("/:id/vex", requirePerm("cra:read"), zValidator("query", z.object({ format: z.enum(["openvex", "cyclonedx"]).default("openvex") })), async (c) => {
        const p = await row(c, c.req.param("id"));
        const s = await settingsFor(db, null, p.companyId);
        const st = (await findingsOf(and(eq(craFindings.productId, p.id), eq(craFindings.gone, false)))).map((f) => ({ vulnId: f.vulnId, aliases: f.aliases, componentRef: f.componentRef, status: f.status, justification: f.justification, impactStatement: f.impactStatement, actionStatement: f.actionStatement }));
        const fmt = c.req.valid("query").format;
        const doc = fmt === "openvex" ? buildOpenVex({ id: p.id, name: p.name, version: p.version }, s.organizationName, st) : buildCycloneDxVex({ id: p.id, name: p.name, version: p.version }, s.organizationName, st);
        await audit(db, { c, user: currentUser(c), action: "cra.vex_exported", entityType: "cra_product", entityId: p.id, details: { format: fmt, statements: st.length } });
        const file = `${p.name.replace(/[^\w.-]+/g, "_")}${p.version ? `-${p.version.replace(/[^\w.-]+/g, "_")}` : ""}.${fmt === "openvex" ? "openvex" : "cdx"}.json`;
        return c.body(JSON.stringify(doc, null, 2), 200, { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${file}"` });
      })

      /* ---------- hlášení čl. 14 ---------- */
      .get("/:id/reports", requirePerm("cra:read"), async (c) => {
        const p = await row(c, c.req.param("id"));
        const rows = await db.select().from(craReports).where(eq(craReports.productId, p.id)).orderBy(desc(craReports.awareAt));
        return c.json(rows.map((r) => reportDto(r, p.name)));
      })
      .post("/:id/reports", requirePerm("cra:read"), zValidator("json", CraReportInput), async (c) => {
        const p = await editable(c, c.req.param("id"));
        const input = c.req.valid("json");
        const vals = reportValues(input);
        const [r] = await db
          .insert(craReports)
          .values({ ...vals, kind: input.kind, title: input.title, awareAt: new Date(input.awareAt), memberStates: input.memberStates.length ? input.memberStates : p.memberStates, productId: p.id, companyId: p.companyId })
          .returning();
        await audit(db, { c, user: currentUser(c), action: "cra.report_created", entityType: "cra_report", entityId: r!.id, details: { kind: r!.kind, productId: p.id, cveIds: r!.cveIds } });
        return c.json(reportDto(r!, p.name), 201);
      })
  );
}
