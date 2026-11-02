import { ControlAutomationInput, type ControlAutomationDto, type ScaAssetDto } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requireModule, requirePerm } from "../../auth/middleware";
import { assertScope, hasPermIn, inScope, scopeOf, visibleIds } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { assets, controlAutomations, controls, scaResults } from "../../db/schema";
import type { FetchLike } from "../discovery/connectors/wazuh";
import { assetChecks, policyRows, runScaAutomation, scaOverview, syncSca } from "./service";

/* Shoda konfigurace – Wazuh SCA (ADR-064): přehled, detail aktiva, načtení, automatický test opatření. */

type Ctx = Context<AppEnv>;

export function scaRoutes(deps: { db: Db; config: Config; fetchImpl?: FetchLike }) {
  const { db } = deps;
  const readIds = (c: Ctx) => scopeOf(c).ids.filter((id) => hasPermIn(c, "assets:read", id));

  async function automation(c: Ctx, id: string) {
    const [a] = await db.select().from(controlAutomations).where(eq(controlAutomations.id, id));
    if (!a || a.kind !== "sca") throw new HTTPException(404, { message: "Automatizace nenalezena" });
    assertScope(c, a.companyId, "Automatizace nenalezena");
    if (!hasPermIn(c, "controls:test", a.companyId)) throw new HTTPException(403, { message: "Nedostatečná oprávnění" });
    return a;
  }
  async function controlFor(c: Ctx, id: string) {
    const [ctl] = await db.select({ id: controls.id, companyId: controls.companyId }).from(controls).where(eq(controls.id, id));
    if (!ctl) throw new HTTPException(400, { message: "Opatření nenalezeno" });
    assertScope(c, ctl.companyId, "Opatření nenalezeno");
    if (!hasPermIn(c, "controls:test", ctl.companyId)) throw new HTTPException(403, { message: "K automatickým testům opatření je potřeba oprávnění testovat opatření." });
    return ctl;
  }
  async function list(where: SQL | undefined): Promise<ControlAutomationDto[]> {
    const rows = await db.select({ a: controlAutomations, name: controls.name, code: controls.code }).from(controlAutomations).innerJoin(controls, eq(controls.id, controlAutomations.controlId)).where(and(eq(controlAutomations.kind, "sca"), where)).orderBy(asc(controls.code), asc(controls.name));
    return rows.map(({ a, name, code }) => ({
      id: a.id,
      companyId: a.companyId,
      controlId: a.controlId,
      controlName: `${code ? `${code} ` : ""}${name}`,
      kind: a.kind,
      frequency: a.frequency,
      sourceIds: a.sourceIds,
      rules: a.rules,
      maxCritical: a.maxCritical,
      maxHigh: a.maxHigh,
      applyEffectiveness: a.applyEffectiveness,
      enabled: a.enabled,
      scaPolicies: a.scaPolicies,
      scaMinScore: a.scaMinScore,
      scaWarnScore: a.scaWarnScore,
      lastRunAt: a.lastRunAt?.toISOString() ?? null,
      lastResult: a.lastResult,
      lastTestId: a.lastTestId,
      lastError: a.lastError,
    }));
  }
  const values = (i: ReturnType<typeof ControlAutomationInput.parse>) => {
    if (i.scaWarnScore > i.scaMinScore) throw new HTTPException(400, { message: "Práh „s výjimkami“ nesmí být vyšší než práh „účinné“." });
    return { controlId: i.controlId, kind: "sca" as const, frequency: i.frequency, applyEffectiveness: i.applyEffectiveness, enabled: i.enabled, scaPolicies: i.scaPolicies, scaMinScore: i.scaMinScore, scaWarnScore: i.scaWarnScore };
  };

  return new Hono<AppEnv>()
    .use("*", requireModule(db, "assets"))
    .get("/", requirePerm("assets:read"), async (c) => c.json(await scaOverview(db, readIds(c))))
    .get("/assets/:assetId", requirePerm("assets:read"), async (c) => {
      const id = c.req.param("assetId");
      const [a] = await db.select({ companyId: assets.companyId }).from(assets).where(eq(assets.id, id));
      if (!a || !(await visibleIds(db, c)).includes(a.companyId)) throw new HTTPException(404, { message: "Aktivum nenalezeno" });
      const [policies, checks] = await Promise.all([policyRows(db, eq(scaResults.assetId, id)), assetChecks(db, id)]);
      const out: ScaAssetDto = { assetId: id, policies: policies.map((p) => ({ ...p, checks: checks.filter((x) => x.policyId === p.policyId) })) };
      return c.json(out);
    })
    .post("/sync", requirePerm("discovery:run"), async (c) => {
      const r = await syncSca(db, deps.config, deps.fetchImpl);
      await audit(db, { c, user: currentUser(c), action: "sca.synced", details: r });
      return c.json(await scaOverview(db, readIds(c)));
    })
    .get("/automations", requirePerm("controls:read"), async (c) => c.json(await list(inScope(c, controlAutomations.companyId))))
    .post("/automations", requirePerm("controls:test"), zValidator("json", ControlAutomationInput), async (c) => {
      const input = c.req.valid("json");
      const ctl = await controlFor(c, input.controlId);
      const [a] = await db.insert(controlAutomations).values({ ...values(input), companyId: ctl.companyId, createdById: currentUser(c).id }).returning();
      await audit(db, { c, user: currentUser(c), action: "control_automation.created", entityType: "control", entityId: ctl.id, details: { automationId: a!.id, ...values(input) } });
      return c.json((await list(eq(controlAutomations.id, a!.id)))[0], 201);
    })
    .put("/automations/:id", requirePerm("controls:test"), zValidator("json", ControlAutomationInput), async (c) => {
      const prev = await automation(c, c.req.param("id"));
      const input = c.req.valid("json");
      const ctl = await controlFor(c, input.controlId);
      await db.update(controlAutomations).set({ ...values(input), companyId: ctl.companyId, updatedAt: new Date() }).where(eq(controlAutomations.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "control_automation.updated", entityType: "control", entityId: ctl.id, details: { automationId: prev.id, ...values(input) } });
      return c.json((await list(eq(controlAutomations.id, prev.id)))[0]);
    })
    .delete("/automations/:id", requirePerm("controls:test"), async (c) => {
      const prev = await automation(c, c.req.param("id"));
      await db.delete(controlAutomations).where(eq(controlAutomations.id, prev.id));
      await audit(db, { c, user: currentUser(c), action: "control_automation.deleted", entityType: "control", entityId: prev.controlId, details: { automationId: prev.id } });
      return c.json({ ok: true });
    })
    .post("/automations/:id/run", requirePerm("controls:test"), async (c) => {
      const a = await automation(c, c.req.param("id"));
      try {
        await runScaAutomation(db, a);
      } catch (e) {
        throw new HTTPException(409, { message: (e as Error).message });
      }
      return c.json((await list(eq(controlAutomations.id, a.id)))[0]);
    });
}

