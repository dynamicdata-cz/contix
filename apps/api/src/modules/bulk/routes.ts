import { AssetBulkInput, ControlBulkInput, ProcessBulkInput, RiskBulkInput, SupplierBulkInput, bulkHasChange, type BulkResultDto, type Permission } from "@contix/shared";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { currentUser, requirePerm } from "../../auth/middleware";
import { hasPermIn } from "../../auth/scope";
import { audit, type AppEnv } from "../../auth/service";
import type { Db } from "../../db/client";
import { assets, controls, objectTags, orgUnits, positions, processes, risks, suppliers, tags, users } from "../../db/schema";
import { reassignHostFindingTasks } from "../collector/findings";
import { reassignFindingTasks } from "../sectests/tasks";
import { canonicalTags } from "../tags/routes";
import { recomputeHealth } from "../vulnerabilities/service";

/* ============================================================
 * Hromadné úpravy v seznamech (v1.75, ADR-168): aktiva, rizika, opatření; od v1.79 procesy a dodavatelé (ADR-172). Záznam po záznamu: oprávnění k zápisu
 * ve společnosti záznamu, útvar / funkce ze stejné společnosti jako záznam (jako Kvalita dat),
 * osoba aktivní. Nevyhovující se přeskočí s důvodem, změny jdou do auditu po záznamech.
 * ============================================================ */

const MSG = {
  perm: "Nemáte oprávnění k zápisu v jeho společnosti",
  unit: "Útvar nepatří do společnosti záznamu",
  position: "Funkční místo nepatří do společnosti záznamu",
  missing: "Záznam nenalezen",
} as const;

export function bulkRoutes(db: Db) {
  const unitCompany = async (id: string | null | undefined) => (id ? ((await db.select({ c: orgUnits.companyId }).from(orgUnits).where(eq(orgUnits.id, id)))[0]?.c ?? "—") : null);
  const positionCompany = async (id: string | null | undefined) =>
    id ? ((await db.select({ c: orgUnits.companyId }).from(positions).innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId)).where(eq(positions.id, id)))[0]?.c ?? "—") : null;
  const assertUsers = async (ids: (string | null | undefined)[]) => {
    const want = ids.filter((x): x is string => !!x);
    if (!want.length) return;
    const ok = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, want), eq(users.isActive, true)));
    if (ok.length !== new Set(want).size) throw new HTTPException(400, { message: "Vybraná osoba neexistuje nebo není aktivní" });
  };

  /** Štítky rizik / opatření v katalogu (object_tags). */
  async function objectTagsChange(type: "risk" | "control" | "process" | "supplier", rows: { id: string; companyId: string }[], add: string[] = [], remove: string[] = []) {
    if (add.length) {
      const names = await canonicalTags(db, add);
      const ts = await db.select({ id: tags.id }).from(tags).where(inArray(sql`lower(${tags.name})`, names.map((n) => n.toLowerCase())));
      const values = rows.flatMap((r) => ts.map((t) => ({ tagId: t.id, entityType: type, entityId: r.id, companyId: r.companyId })));
      if (values.length) await db.insert(objectTags).values(values).onConflictDoNothing();
    }
    if (remove.length) {
      const ts = await db.select({ id: tags.id }).from(tags).where(inArray(sql`lower(${tags.name})`, remove.map((n) => n.toLowerCase())));
      if (ts.length)
        await db.delete(objectTags).where(
          and(
            eq(objectTags.entityType, type),
            inArray(objectTags.entityId, rows.map((r) => r.id)),
            inArray(objectTags.tagId, ts.map((t) => t.id)),
          ),
        );
    }
  }

  /** Společné: načtení, kontrola oprávnění a společnosti útvaru / funkce. */
  async function eligible<T extends { id: string; companyId: string }>(
    c: Parameters<typeof hasPermIn>[0],
    wanted: string[],
    found: T[],
    perm: Permission,
    check?: (r: T) => string | null,
  ): Promise<{ ok: T[]; skipped: BulkResultDto["skipped"] }> {
    const byId = new Map(found.map((r) => [r.id, r]));
    const ok: T[] = [];
    const skipped: BulkResultDto["skipped"] = [];
    for (const id of [...new Set(wanted)]) {
      const r = byId.get(id);
      // záznam mimo čtecí rozsah se tváří jako neexistující
      if (!r || !hasPermIn(c, perm.replace(/:write$/, ":read") as Permission, r.companyId)) skipped.push({ id, reason: MSG.missing });
      else if (!hasPermIn(c, perm, r.companyId)) skipped.push({ id, reason: MSG.perm });
      else {
        const why = check?.(r) ?? null;
        if (why) skipped.push({ id, reason: why });
        else ok.push(r);
      }
    }
    return { ok, skipped };
  }

  return new Hono<AppEnv>()
    .post("/assets", requirePerm("assets:write"), zValidator("json", AssetBulkInput), async (c) => {
      const i = c.req.valid("json");
      if (!bulkHasChange(i)) throw new HTTPException(400, { message: "Nic ke změně" });
      const s = i.set;
      await assertUsers([s.ownerUserId, s.technicalOwnerUserId, s.technicalDeputyUserId]);
      const unitCo = await unitCompany(s.ownerUnitId);
      const found = await db.select({ id: assets.id, companyId: assets.companyId, name: assets.name, tags: assets.tags }).from(assets).where(inArray(assets.id, i.ids));
      const { ok, skipped } = await eligible(c, i.ids, found, "assets:write", (r) => (unitCo && unitCo !== r.companyId ? MSG.unit : null));
      const set = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
      const add = i.addTags?.length ? await canonicalTags(db, i.addTags) : [];
      const rem = new Set((i.removeTags ?? []).map((x) => x.toLowerCase()));
      for (const r of ok) {
        const nextTags = [...r.tags.filter((x) => !rem.has(x.toLowerCase())), ...add.filter((x) => !r.tags.some((y) => y.toLowerCase() === x.toLowerCase()))];
        const changeTags = add.length || rem.size;
        await db.update(assets).set({ ...set, ...(changeTags ? { tags: nextTags } : {}), updatedAt: new Date() }).where(eq(assets.id, r.id));
        await audit(db, { c, user: currentUser(c), action: "asset.bulk_updated", entityType: "asset", entityId: r.id, details: { name: r.name, ...set, ...(changeTags ? { tags: nextTags } : {}) } });
      }
      // úkoly z nálezů jdou za novým garantem (stejně jako při úpravě v detailu)
      if (ok.length && (s.ownerUserId !== undefined || s.technicalOwnerUserId !== undefined || s.technicalDeputyUserId !== undefined))
        for (const r of ok) {
          await reassignFindingTasks(db, { assetId: r.id });
          await reassignHostFindingTasks(db, { assetId: r.id });
        }
      if (ok.length && s.criticality) await recomputeHealth(db);
      return c.json({ updated: ok.length, skipped } satisfies BulkResultDto);
    })
    .post("/risks", requirePerm("risks:write"), zValidator("json", RiskBulkInput), async (c) => {
      const i = c.req.valid("json");
      if (!bulkHasChange(i)) throw new HTTPException(400, { message: "Nic ke změně" });
      const posCo = await positionCompany(i.set.ownerPositionId);
      const found = await db.select({ id: risks.id, companyId: risks.companyId, name: risks.name }).from(risks).where(inArray(risks.id, i.ids));
      const { ok, skipped } = await eligible(c, i.ids, found, "risks:write", (r) => (posCo && posCo !== r.companyId ? MSG.position : null));
      if (i.set.ownerPositionId !== undefined && ok.length) await db.update(risks).set({ ownerPositionId: i.set.ownerPositionId, updatedAt: new Date() }).where(inArray(risks.id, ok.map((r) => r.id)));
      await objectTagsChange("risk", ok, i.addTags, i.removeTags);
      for (const r of ok) await audit(db, { c, user: currentUser(c), action: "risk.bulk_updated", entityType: "risk", entityId: r.id, details: { name: r.name, ...i.set, addTags: i.addTags, removeTags: i.removeTags } });
      return c.json({ updated: ok.length, skipped } satisfies BulkResultDto);
    })
    .post("/controls", requirePerm("controls:write"), zValidator("json", ControlBulkInput), async (c) => {
      const i = c.req.valid("json");
      if (!bulkHasChange(i)) throw new HTTPException(400, { message: "Nic ke změně" });
      const posCo = await positionCompany(i.set.ownerPositionId);
      const found = await db.select({ id: controls.id, companyId: controls.companyId, name: controls.name }).from(controls).where(inArray(controls.id, i.ids));
      const { ok, skipped } = await eligible(c, i.ids, found, "controls:write", (r) => (posCo && posCo !== r.companyId ? MSG.position : null));
      const set = Object.fromEntries(Object.entries(i.set).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length && ok.length) await db.update(controls).set({ ...set, updatedAt: new Date() }).where(inArray(controls.id, ok.map((r) => r.id)));
      await objectTagsChange("control", ok, i.addTags, i.removeTags);
      for (const r of ok) await audit(db, { c, user: currentUser(c), action: "control.bulk_updated", entityType: "control", entityId: r.id, details: { name: r.name, ...set, addTags: i.addTags, removeTags: i.removeTags } });
      return c.json({ updated: ok.length, skipped } satisfies BulkResultDto);
    })
    .post("/processes", requirePerm("processes:write"), zValidator("json", ProcessBulkInput), async (c) => {
      const i = c.req.valid("json");
      if (!bulkHasChange(i)) throw new HTTPException(400, { message: "Nic ke změně" });
      const posCo = await positionCompany(i.set.ownerPositionId);
      const unitCo = await unitCompany(i.set.orgUnitId);
      const found = await db.select({ id: processes.id, companyId: processes.companyId, name: processes.name }).from(processes).where(inArray(processes.id, i.ids));
      const { ok, skipped } = await eligible(c, i.ids, found, "processes:write", (r) => (posCo && posCo !== r.companyId ? MSG.position : unitCo && unitCo !== r.companyId ? MSG.unit : null));
      const set = Object.fromEntries(Object.entries(i.set).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length && ok.length)
        await db.update(processes).set({ ...set, version: sql`${processes.version} + 1`, updatedAt: new Date() }).where(inArray(processes.id, ok.map((r) => r.id)));
      await objectTagsChange("process", ok, i.addTags, i.removeTags);
      for (const r of ok) await audit(db, { c, user: currentUser(c), action: "process.bulk_updated", entityType: "process", entityId: r.id, details: { name: r.name, ...set, addTags: i.addTags, removeTags: i.removeTags } });
      return c.json({ updated: ok.length, skipped } satisfies BulkResultDto);
    })
    .post("/suppliers", requirePerm("suppliers:write"), zValidator("json", SupplierBulkInput), async (c) => {
      const i = c.req.valid("json");
      if (!bulkHasChange(i)) throw new HTTPException(400, { message: "Nic ke změně" });
      const unitCo = await unitCompany(i.set.ownerUnitId);
      const found = await db.select({ id: suppliers.id, companyId: suppliers.companyId, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, i.ids));
      const { ok, skipped } = await eligible(c, i.ids, found, "suppliers:write", (r) => (unitCo && unitCo !== r.companyId ? MSG.unit : null));
      const set = Object.fromEntries(Object.entries(i.set).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length && ok.length) await db.update(suppliers).set({ ...set, updatedAt: new Date() }).where(inArray(suppliers.id, ok.map((r) => r.id)));
      await objectTagsChange("supplier", ok, i.addTags, i.removeTags);
      for (const r of ok) await audit(db, { c, user: currentUser(c), action: "supplier.bulk_updated", entityType: "supplier", entityId: r.id, details: { name: r.name, ...set, addTags: i.addTags, removeTags: i.removeTags } });
      return c.json({ updated: ok.length, skipped } satisfies BulkResultDto);
    });
}
