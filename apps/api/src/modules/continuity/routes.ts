import {
  BIA_AREAS,
  BIA_TIMEPOINTS,
  BiaInput,
  BiaPatch,
  biaWarnings,
  maxImpact,
  requiredAvailability,
  suggestMtpd,
  type BiaDetail,
  type BiaListItem,
} from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { asc, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { markReassessed } from "../cycles/routes";
import { HTTPException } from "hono/http-exception";
import { currentUser, hasPerm, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, inScope } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, biaAssessments, positionHolders, processAssets, processes } from "../../db/schema";

type Ctx = Context<AppEnv>;
type BiaRow = typeof biaAssessments.$inferSelect;

/** Analýza dopadů (BIA) dle § 15 vyhl. č. 409/2025 Sb. – jedna aktuální BIA na proces. */
export function continuityRoutes(db: Db) {
  async function processAssetsOf(processIds: string[]) {
    if (!processIds.length) return [];
    return db
      .selectDistinct({
        processId: processAssets.processId,
        id: assets.id,
        name: assets.name,
        assetType: assets.assetType,
        assetClass: assets.assetClass,
        availability: assets.availability,
      })
      .from(processAssets)
      .innerJoin(assets, eq(assets.id, processAssets.assetId))
      .where(inArray(processAssets.processId, processIds));
  }

  function toItem(b: BiaRow, p: typeof processes.$inferSelect, procAssets: Awaited<ReturnType<typeof processAssetsOf>>): BiaListItem {
    const req = requiredAvailability(b.rtoHours);
    const gaps = req == null ? 0 : procAssets.filter((a) => a.processId === p.id && (a.availability ?? 0) < req).length;
    const warnings = biaWarnings(b);
    if (gaps) warnings.push(`${gaps} aktiv procesu má nižší hodnocení dostupnosti, než odpovídá RTO (příl. č. 1 tab. č. 3).`);
    return {
      id: b.id,
      companyId: b.companyId,
      processId: p.id,
      processCode: p.code,
      processName: p.name,
      processCriticality: p.criticality,
      status: b.status,
      assessedAt: b.assessedAt,
      maxImpact: maxImpact(b.impacts),
      mtpdHours: b.mtpdHours,
      rtoHours: b.rtoHours,
      rpoHours: b.rpoHours,
      requiredAvailability: req,
      availabilityGaps: gaps,
      warnings,
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  async function canEdit(c: Ctx, p: { ownerPositionId: string | null }) {
    if (hasPerm(c, "bia:write")) return true;
    if (!p.ownerPositionId) return false;
    const rows = await db.select().from(positionHolders).where(eq(positionHolders.positionId, p.ownerPositionId));
    return rows.some((r) => r.userId === currentUser(c).id);
  }

  async function detail(c: Ctx, id: string): Promise<BiaDetail> {
    const [row] = await db.select({ b: biaAssessments, p: processes }).from(biaAssessments).innerJoin(processes, eq(processes.id, biaAssessments.processId)).where(eq(biaAssessments.id, id));
    assertScope(c, row?.b.companyId, "Analýza dopadů nenalezena");
    if (!row) throw new HTTPException(404, { message: "Analýza dopadů nenalezena" });
    const pa = await processAssetsOf([row.p.id]);
    const item = toItem(row.b, row.p, pa);
    return {
      ...item,
      impacts: row.b.impacts,
      minServiceLevel: row.b.minServiceLevel,
      peakPeriods: row.b.peakPeriods,
      dependencies: row.b.dependencies,
      notes: row.b.notes,
      suggestedMtpdHours: suggestMtpd(row.b.impacts),
      assets: pa
        .map((a) => ({ id: a.id, name: a.name, assetType: a.assetType, assetClass: a.assetClass, availability: a.availability, gap: item.requiredAvailability != null && (a.availability ?? 0) < item.requiredAvailability }))
        .sort((a, b) => a.name.localeCompare(b.name, "cs")),
      canEdit: await canEdit(c, row.p),
    };
  }

  /** Hodnoty dopadů jen 0–4 a jen známé oblasti/časové body (zbytek zahodit). */
  function cleanImpacts(impacts: Record<string, Record<string, number>> | undefined) {
    if (!impacts) return undefined;
    const areas = new Set<string>(BIA_AREAS.map((a) => a.key));
    const tps = new Set<string>(BIA_TIMEPOINTS.map((t) => t.key));
    return Object.fromEntries(
      Object.entries(impacts)
        .filter(([area]) => areas.has(area))
        .map(([area, vals]) => [area, Object.fromEntries(Object.entries(vals).filter(([tp, v]) => tps.has(tp) && Number.isInteger(v) && v >= 0 && v <= 4))]),
    );
  }

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "continuity"))
    .get("/", requirePerm("bia:read"), async (c) => {
      const [rows, procs] = await Promise.all([
        db
          .select({ b: biaAssessments, p: processes })
          .from(biaAssessments)
          .innerJoin(processes, eq(processes.id, biaAssessments.processId))
          .where(inScope(c, biaAssessments.companyId))
          .orderBy(asc(processes.code), asc(processes.name)),
        db
          .select({ id: processes.id, code: processes.code, name: processes.name, status: processes.status, criticality: processes.criticality })
          .from(processes)
          .where(inScope(c, processes.companyId))
          .orderBy(asc(processes.code), asc(processes.name)),
      ]);
      const pa = await processAssetsOf(rows.map((r) => r.p.id));
      const have = new Set(rows.map((r) => r.p.id));
      return c.json({
        items: rows.map((r) => toItem(r.b, r.p, pa)),
        /** Procesy bez analýzy dopadů (kromě zrušených). */
        missing: procs.filter((p) => !have.has(p.id) && p.status !== "retired"),
      });
    })
    .post("/", requirePerm("bia:read"), zValidator("json", BiaInput), async (c) => {
      const input = c.req.valid("json");
      const [p] = await db.select().from(processes).where(eq(processes.id, input.processId));
      if (!p) throw new HTTPException(404, { message: "Proces nenalezen" });
      assertScope(c, p.companyId, "Proces nenalezen");
      if (!(await canEdit(c, p))) throw new HTTPException(403, { message: "Analýzu dopadů zpracovává vlastník procesu nebo správce BIA" });
      // BIA patří společnosti procesu
      const [b] = await db
        .insert(biaAssessments)
        .values({ ...input, companyId: p.companyId, impacts: cleanImpacts(input.impacts) ?? {} })
        .onConflictDoNothing()
        .returning();
      if (!b) throw new HTTPException(409, { message: "Proces už analýzu dopadů má – upravte ji." });
      await audit(db, { c, user: currentUser(c), action: "bia.created", entityType: "bia", entityId: b.id, details: { processId: p.id } });
      return c.json(await detail(c, b.id), 201);
    })
    .get("/:id", requirePerm("bia:read"), async (c) => c.json(await detail(c, c.req.param("id"))))
    .patch("/:id", requirePerm("bia:read"), zValidator("json", BiaPatch), async (c) => {
      const id = c.req.param("id");
      const [row] = await db.select({ b: biaAssessments, p: processes }).from(biaAssessments).innerJoin(processes, eq(processes.id, biaAssessments.processId)).where(eq(biaAssessments.id, id));
      if (!row) throw new HTTPException(404, { message: "Analýza dopadů nenalezena" });
      assertScope(c, row.b.companyId, "Analýza dopadů nenalezena");
      if (!(await canEdit(c, row.p))) throw new HTTPException(403, { message: "Analýzu dopadů zpracovává vlastník procesu nebo správce BIA" });
      const raw = c.req.valid("json");
      const input = Object.fromEntries(Object.entries({ ...raw, impacts: cleanImpacts(raw.impacts) }).filter(([, v]) => v !== undefined));
      if (input.status === "approved" && !hasPerm(c, "bia:write")) throw new HTTPException(403, { message: "Schválit analýzu dopadů může správce BIA" });
      const reassessed = ["impacts", "mtpdHours", "rtoHours", "rpoHours"].some((k) => k in input && JSON.stringify(input[k]) !== JSON.stringify(row.b[k as keyof typeof row.b]));
      if (reassessed && !("assessedAt" in input)) input.assessedAt = new Date().toISOString().slice(0, 10);
      if (Object.keys(input).length) await db.update(biaAssessments).set({ ...input, updatedAt: new Date() }).where(eq(biaAssessments.id, id));
      if (reassessed) await markReassessed(db, "bia", id, currentUser(c).id);
      await audit(db, { c, user: currentUser(c), action: "bia.updated", entityType: "bia", entityId: id, details: input });
      return c.json(await detail(c, id));
    })
    .delete("/:id", requirePerm("bia:write"), async (c) => {
      const id = c.req.param("id");
      const [cur] = await db.select({ companyId: biaAssessments.companyId }).from(biaAssessments).where(eq(biaAssessments.id, id));
      assertScope(c, cur?.companyId, "Analýza dopadů nenalezena");
      const [b] = await db.delete(biaAssessments).where(eq(biaAssessments.id, id)).returning({ processId: biaAssessments.processId });
      if (!b) throw new HTTPException(404, { message: "Analýza dopadů nenalezena" });
      await audit(db, { c, user: currentUser(c), action: "bia.deleted", entityType: "bia", entityId: id, details: b });
      return c.body(null, 204);
    });
}
