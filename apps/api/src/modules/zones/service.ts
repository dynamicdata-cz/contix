import { MONITORING_INFO, DEFAULT_ZONES, matchZone, zoneFlowLevel, type SecurityZoneDto, type ZoneKind, type ZoneMapDto } from "@contix/shared";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assetDependencies, assets, monitoringFindings, securityZones } from "../../db/schema";
import { monitoringOf } from "../identity/computers";
import { applyMonitoringFindings, type MonitoringDesired } from "../integrations/monitoringFindings";

/* ============================================================
 * Bezpečnostní zóny (v1.97, ADR-191): katalog zón společnosti, zařazení aktiv podle IP, vrstvená mapa s vazbami
 * přes hranice zón a kontroly zón jako nálezy monitoringu (zdroj „Monitoring a zóny“).
 * ============================================================ */

const ACTIVE = ["planned", "active", "maintenance"] as const;
type ZoneRow = typeof securityZones.$inferSelect;

export async function zonesOf(db: Db, companyId: string) {
  return db.select().from(securityZones).where(eq(securityZones.companyId, companyId)).orderBy(asc(securityZones.trust), asc(securityZones.sortOrder), asc(securityZones.name));
}

/** Výchozí katalog – jen zóny, jejichž druh ve společnosti ještě není. */
export async function seedDefaultZones(db: Db, companyId: string) {
  const have = new Set((await zonesOf(db, companyId)).map((z) => z.kind));
  const add = DEFAULT_ZONES.filter((z) => !have.has(z.kind)).map((z, i) => ({ ...z, companyId, sortOrder: (i + 1) * 10 }));
  if (add.length) await db.insert(securityZones).values(add);
  return add.length;
}

/** Zařazení aktiv podle IP (jen aktiva bez ručně zvolené zóny). Vrací počet změněných. */
export async function assignZones(db: Db, companyId: string) {
  const zones = await zonesOf(db, companyId);
  const rows = await db
    .select({ id: assets.id, ips: assets.ipAddresses, zoneId: assets.zoneId })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), eq(assets.zoneManual, false)));
  let changed = 0;
  for (const r of rows) {
    const z = matchZone(r.ips ?? [], zones);
    const next = z?.id ?? null;
    if (next !== r.zoneId) {
      await db.update(assets).set({ zoneId: next }).where(eq(assets.id, r.id));
      changed++;
    }
  }
  return changed;
}

async function zoneAssets(db: Db, companyId: string) {
  const rows = await db
    .select({ id: assets.id, name: assets.name, assetType: assets.assetType, zoneId: assets.zoneId, manual: assets.zoneManual, health: assets.healthStatus, internetFacing: assets.internetFacing, criticality: assets.criticality, ips: assets.ipAddresses })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), inArray(assets.lifecycleStatus, [...ACTIVE])))
    .orderBy(asc(assets.name));
  const mon = await monitoringOf(db, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, monitored: !!mon.get(r.id)?.size }));
}

export async function zoneDtos(db: Db, companyId: string): Promise<SecurityZoneDto[]> {
  const [zones, list, open] = await Promise.all([
    zonesOf(db, companyId),
    zoneAssets(db, companyId),
    db
      .select({ key: monitoringFindings.key, assetId: monitoringFindings.assetId })
      .from(monitoringFindings)
      .where(and(eq(monitoringFindings.companyId, companyId), eq(monitoringFindings.status, "open"), sql`${monitoringFindings.code} like 'zone\\_%'`)),
  ]);
  return zones.map((z) => {
    const mine = list.filter((a) => a.zoneId === z.id);
    const ids = new Set(mine.map((a) => a.id));
    return {
      id: z.id,
      companyId: z.companyId,
      name: z.name,
      kind: z.kind as ZoneKind,
      trust: z.trust,
      color: z.color,
      description: z.description,
      cidrs: z.cidrs ?? [],
      sortOrder: z.sortOrder,
      assets: mine.length,
      monitored: mine.filter((a) => a.monitored).length,
      servers: mine.filter((a) => a.assetType === "server").length,
      workstations: mine.filter((a) => a.assetType === "workstation" || a.assetType === "laptop").length,
      internetFacing: mine.filter((a) => a.internetFacing).length,
      openFindings: open.filter((f) => (f.assetId && ids.has(f.assetId)) || f.key === `zonez:${z.id}`).length,
    };
  });
}

export async function zoneMap(db: Db, companyId: string): Promise<ZoneMapDto> {
  const [zones, list] = await Promise.all([zoneDtos(db, companyId), zoneAssets(db, companyId)]);
  const zm = new Map(zones.map((z) => [z.id, z]));
  const am = new Map(list.map((a) => [a.id, a]));
  const deps = list.length
    ? await db
        .select({ fromId: assetDependencies.fromId, toId: assetDependencies.toId })
        .from(assetDependencies)
        .where(inArray(assetDependencies.fromId, list.map((a) => a.id)))
    : [];
  const flows: ZoneMapDto["flows"] = [];
  for (const d of deps) {
    const a = am.get(d.fromId);
    const b = am.get(d.toId);
    if (!a?.zoneId || !b?.zoneId || a.zoneId === b.zoneId) continue;
    const za = zm.get(a.zoneId);
    const zb = zm.get(b.zoneId);
    if (!za || !zb) continue;
    flows.push({ fromId: a.id, toId: b.id, fromZone: za.id, toZone: zb.id, level: zoneFlowLevel(za, zb) });
  }
  return {
    zones,
    assets: list.map((a) => ({ id: a.id, name: a.name, assetType: a.assetType, zoneId: a.zoneId, manual: a.manual, health: a.health, monitored: a.monitored, internetFacing: a.internetFacing, criticality: a.criticality })),
    flows,
    unassigned: list.filter((a) => !a.zoneId && (a.ips ?? []).length > 0).length,
  };
}

/** Kontroly zón → nálezy monitoringu (kódy zone_*) pro společnosti, které mají zóny. */
export async function syncZoneFindings(db: Db, companyIds?: string[], now = new Date()) {
  const cos = companyIds ?? [...new Set((await db.selectDistinct({ c: securityZones.companyId }).from(securityZones)).map((x) => x.c))];
  const res = { opened: 0, fixed: 0, reopened: 0 };
  for (const companyId of cos) {
    const m = await zoneMap(db, companyId);
    const zm = new Map(m.zones.map((z) => [z.id, z]));
    const am = new Map(m.assets.map((a) => [a.id, a]));
    const desired: MonitoringDesired[] = [];
    const base = { companyId, connectionId: null };
    for (const a of m.assets) {
      const z = a.zoneId ? zm.get(a.zoneId) : undefined;
      if ((z?.kind === "dmz" || a.internetFacing) && !a.monitored && ["server", "network_device", "application", "virtual_machine"].includes(a.assetType))
        desired.push({ ...base, assetId: a.id, key: `zone:${a.id}`, code: "zone_exposed_unmonitored", severity: a.internetFacing ? "high" : "medium", subject: a.name, detail: `${MONITORING_INFO.zone_exposed_unmonitored.title}: ${a.name}${z ? ` (zóna ${z.name})` : ""}.` });
      if (z && (z.kind === "server" || z.kind === "management") && (a.assetType === "workstation" || a.assetType === "laptop"))
        desired.push({ ...base, assetId: a.id, key: `zone:${a.id}`, code: "zone_workstation_in_server", severity: "medium", subject: a.name, detail: `${a.name} je v zóně ${z.name}.` });
    }
    for (const f of m.flows.filter((x) => x.level === "high")) {
      const a = am.get(f.fromId)!;
      const b = am.get(f.toId)!;
      desired.push({ ...base, assetId: b.id, key: `flow:${a.id}:${b.id}`, code: "zone_boundary_flow", severity: "high", subject: `${a.name} → ${b.name}`.slice(0, 500), detail: `${a.name} (${zm.get(f.fromZone)?.name}) používá ${b.name} (${zm.get(f.toZone)?.name}).` });
    }
    for (const z of m.zones)
      if (z.assets > 0 && z.monitored === 0 && z.kind !== "internet" && z.kind !== "guest")
        desired.push({ ...base, assetId: null, key: `zonez:${z.id}`, code: "zone_unmonitored", severity: "low", subject: z.name, detail: `Zóna ${z.name}: ${z.assets} aktiv, žádné se sběrem dat.` });
    const r = await applyMonitoringFindings(db, desired, and(eq(monitoringFindings.companyId, companyId), sql`${monitoringFindings.code} like 'zone\\_%'`)!, now);
    res.opened += r.opened;
    res.fixed += r.fixed;
    res.reopened += r.reopened;
  }
  // společnosti bez zón: případné staré nálezy zón uzavřít
  const stale = await db
    .update(monitoringFindings)
    .set({ status: "fixed", fixedAt: now, updatedAt: now })
    .where(and(inArray(monitoringFindings.status, ["open", "accepted"]), sql`${monitoringFindings.code} like 'zone\\_%'`, cos.length ? notInArray(monitoringFindings.companyId, cos) : undefined))
    .returning({ id: monitoringFindings.id });
  res.fixed += stale.length;
  return res;
}

export type { ZoneRow };
