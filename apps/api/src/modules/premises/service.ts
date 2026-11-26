import {
  CONTAINER_TYPES,
  FacilityPhysical,
  PLACEABLE_TYPES,
  canNest,
  physicalGaps,
  physicalRevisions,
  type FacilityKind,
  type LocationDetailDto,
  type LocationIssueDto,
  type LocationNodeDto,
  type LocationsDto,
  type TextLocationDto,
  splitLocationText,
  PHYSICAL_CONTROL_LABELS,
} from "@contix/shared";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { assetDependencies, assetSources, assets, monitoringFindings, securityZones, siteMaps } from "../../db/schema";
import { applyMonitoringFindings, type MonitoringDesired } from "../integrations/monitoringFindings";

/* Lokality (v1.104, ADR-198): strom budov, pater a místností z aktiv typu facility a vazeb „umístěno v“. */

const ACTIVE = ["planned", "active", "maintenance"] as const;
const CONTAINERS = new Set<string>(CONTAINER_TYPES);
const PLACEABLE = new Set<string>(PLACEABLE_TYPES);

type Row = { id: string; companyId: string; name: string; assetType: string; criticality: string; healthStatus: string; facilityKind: string | null; physical: FacilityPhysical | null };

/** Načte aktiva společnosti a vazby „umístěno v“; spočítá rodiče lokalit a umístění techniky. */
export async function loadPlacement(db: Db, companyId: string) {
  const rows: Row[] = await db
    .select({ id: assets.id, companyId: assets.companyId, name: assets.name, assetType: assets.assetType, criticality: assets.criticality, healthStatus: assets.healthStatus, facilityKind: assets.facilityKind, physical: assets.physical })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), inArray(assets.lifecycleStatus, [...ACTIVE])));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = rows.map((r) => r.id);
  const edges = ids.length
    ? (await db.select({ fromId: assetDependencies.fromId, toId: assetDependencies.toId }).from(assetDependencies).where(and(inArray(assetDependencies.fromId, ids), eq(assetDependencies.kind, "located_in")))).filter((e) => byId.has(e.toId))
    : [];
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.fromId, [...(out.get(e.fromId) ?? []), e.toId]);
  /** Bezprostřední kontejner (lokalita nebo rack) – první platný cíl vazby. */
  const container = (id: string) => (out.get(id) ?? []).find((t) => CONTAINERS.has(byId.get(t)!.assetType)) ?? null;
  /** Lokalita (facility), ve které aktivum leží – přes rack, se zarážkou proti cyklu. */
  const facilityOf = (id: string): string | null => {
    let cur = container(id);
    const seen = new Set([id]);
    while (cur && byId.get(cur)!.assetType !== "facility" && !seen.has(cur)) {
      seen.add(cur);
      cur = container(cur);
    }
    return cur && byId.get(cur)!.assetType === "facility" ? cur : null;
  };
  const facilities = rows.filter((r) => r.assetType === "facility");
  const parentOf = new Map(facilities.map((f) => [f.id, facilityOf(f.id)]));
  return { rows, byId, out, container, facilityOf, facilities, parentOf };
}

/** Předci lokality od kořene; `null` při cyklu. */
function ancestry(id: string, parentOf: Map<string, string | null>): string[] | null {
  const chain: string[] = [];
  const seen = new Set([id]);
  let p = parentOf.get(id) ?? null;
  while (p) {
    if (seen.has(p)) return null;
    seen.add(p);
    chain.unshift(p);
    p = parentOf.get(p) ?? null;
  }
  return chain;
}

export async function locationsOf(db: Db, companyId: string, now = new Date()): Promise<LocationsDto> {
  const today = now.toISOString().slice(0, 10);
  const pl = await loadPlacement(db, companyId);
  const { rows, byId, out, facilityOf, facilities, parentOf } = pl;
  const fids = facilities.map((f) => f.id);
  const [zones, maps] = fids.length
    ? await Promise.all([
        db.select({ id: securityZones.id, name: securityZones.name, color: securityZones.color, locationId: securityZones.locationId }).from(securityZones).where(and(eq(securityZones.companyId, companyId), inArray(securityZones.locationId, fids))),
        db.select({ id: siteMaps.id, name: siteMaps.name, locationId: siteMaps.locationId }).from(siteMaps).where(and(eq(siteMaps.companyId, companyId), inArray(siteMaps.locationId, fids))),
      ])
    : [[], []];

  // technika v lokalitách
  const direct = new Map<string, Row[]>();
  let unplaced = 0;
  const issues: LocationIssueDto[] = [];
  for (const r of rows) {
    if (r.assetType === "facility") continue;
    const f = facilityOf(r.id);
    if (f) direct.set(f, [...(direct.get(f) ?? []), r]);
    else if (PLACEABLE.has(r.assetType)) {
      unplaced++;
      if ((r.criticality === "critical" || r.criticality === "high") && issues.filter((i) => i.code === "critical_unplaced").length < 50) issues.push({ code: "critical_unplaced", assetId: r.id, assetName: r.name, related: [] });
    }
  }
  // kontrola vazeb „umístěno v“
  for (const [from, targets] of out) {
    const a = byId.get(from)!;
    const bad = targets.filter((t) => !CONTAINERS.has(byId.get(t)!.assetType));
    if (bad.length) issues.push({ code: "located_in_non_container", assetId: a.id, assetName: a.name, related: bad.map((t) => ({ id: t, name: byId.get(t)!.name })) });
    const good = targets.filter((t) => CONTAINERS.has(byId.get(t)!.assetType));
    if (good.length > 1) issues.push({ code: "multiple_locations", assetId: a.id, assetName: a.name, related: good.map((t) => ({ id: t, name: byId.get(t)!.name })) });
  }

  const children = new Map<string, string[]>();
  for (const f of facilities) {
    const p = parentOf.get(f.id) ?? null;
    if (p) children.set(p, [...(children.get(p) ?? []), f.id]);
  }
  const totals = new Map<string, { all: number; crit: number }>();
  const total = (id: string, seen = new Set<string>()): { all: number; crit: number } => {
    if (totals.has(id)) return totals.get(id)!;
    if (seen.has(id)) return { all: 0, crit: 0 };
    seen.add(id);
    const mine = direct.get(id) ?? [];
    const acc = { all: mine.length, crit: mine.filter((r) => r.criticality === "critical" || r.criticality === "high").length };
    for (const ch of children.get(id) ?? []) {
      const t = total(ch, seen);
      acc.all += t.all;
      acc.crit += t.crit;
    }
    totals.set(id, acc);
    return acc;
  };

  const nodes: LocationNodeDto[] = [];
  for (const f of facilities) {
    const anc = ancestry(f.id, parentOf);
    if (!anc) issues.push({ code: "cycle", assetId: f.id, assetName: f.name, related: [] });
    const p = parentOf.get(f.id) ?? null;
    if (p && !canNest(byId.get(p)!.facilityKind as FacilityKind | null, f.facilityKind as FacilityKind | null))
      issues.push({ code: "bad_nesting", assetId: f.id, assetName: f.name, related: [{ id: p, name: byId.get(p)!.name }] });
    const physical = FacilityPhysical.parse(f.physical ?? {});
    const t = total(f.id);
    nodes.push({
      id: f.id,
      companyId: f.companyId,
      name: f.name,
      kind: (f.facilityKind as FacilityKind | null) ?? null,
      parentId: anc ? p : null,
      path: (anc ?? []).map((x) => ({ id: x, name: byId.get(x)!.name })),
      depth: anc?.length ?? 0,
      criticality: f.criticality,
      physical,
      gaps: physicalGaps(f.facilityKind as FacilityKind | null, physical),
      revisions: physicalRevisions(physical, today),
      zones: zones.filter((z) => z.locationId === f.id).map((z) => ({ id: z.id, name: z.name, color: z.color })),
      assetsDirect: (direct.get(f.id) ?? []).length,
      assetsTotal: t.all,
      assetsCritical: t.crit,
      maps: maps.filter((m) => m.locationId === f.id).map((m) => ({ id: m.id, name: m.name })),
    });
  }
  // pořadí stromu: rodič před dětmi, sourozenci podle názvu
  const order: LocationNodeDto[] = [];
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const kids = (pid: string | null) => nodes.filter((n) => n.parentId === pid).sort((a, b) => a.name.localeCompare(b.name, "cs"));
  const walk = (n: LocationNodeDto, seen: Set<string>) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    order.push(n);
    for (const k of kids(n.id)) walk(k, seen);
  };
  const seen = new Set<string>();
  for (const r of kids(null)) walk(r, seen);
  for (const n of nodes) if (!seen.has(n.id)) order.push(byNode.get(n.id)!);
  return { nodes: order, issues, unplaced };
}

export async function locationDetail(db: Db, companyId: string, id: string): Promise<LocationDetailDto | null> {
  const dto = await locationsOf(db, companyId);
  const node = dto.nodes.find((n) => n.id === id);
  if (!node) return null;
  const pl = await loadPlacement(db, companyId);
  const list = pl.rows
    .filter((r) => r.id !== id && (r.assetType === "facility" ? pl.parentOf.get(r.id) === id : pl.facilityOf(r.id) === id))
    .map((r) => {
      const c = pl.container(r.id);
      return { id: r.id, name: r.name, assetType: r.assetType, criticality: r.criticality, healthStatus: r.healthStatus, facilityKind: (r.facilityKind as FacilityKind | null) ?? null, viaRack: c && c !== id ? pl.byId.get(c)!.name : null };
    })
    .sort((a, b) => Number(b.assetType === "facility") - Number(a.assetType === "facility") || a.name.localeCompare(b.name, "cs"));
  return { ...node, assets: list };
}

/** Podstrom lokality (včetně ní). */
export async function subtreeOf(db: Db, companyId: string, id: string): Promise<Set<string>> {
  const { facilities, parentOf } = await loadPlacement(db, companyId);
  const res = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of facilities) {
      const p = parentOf.get(f.id);
      if (p && res.has(p) && !res.has(f.id)) {
        res.add(f.id);
        grew = true;
      }
    }
  }
  return res;
}

/**
 * Umístí aktivum do kontejneru (lokalita nebo rack): odebere jeho dosavadní vazby „umístěno v“ na kontejnery
 * a opačnou vazbu, pak přidá novou. `targetId: null` = jen odebrat umístění.
 */
export async function placeAsset(db: Db, assetId: string, targetId: string | null) {
  await db.transaction(async (tx) => {
    const old = await tx
      .select({ toId: assetDependencies.toId, type: assets.assetType })
      .from(assetDependencies)
      .innerJoin(assets, eq(assets.id, assetDependencies.toId))
      .where(and(eq(assetDependencies.fromId, assetId), eq(assetDependencies.kind, "located_in")));
    const drop = old.filter((o) => CONTAINERS.has(o.type)).map((o) => o.toId);
    if (drop.length) await tx.delete(assetDependencies).where(and(eq(assetDependencies.fromId, assetId), inArray(assetDependencies.toId, drop), eq(assetDependencies.kind, "located_in")));
    if (!targetId) return;
    await tx.delete(assetDependencies).where(and(eq(assetDependencies.fromId, targetId), eq(assetDependencies.toId, assetId)));
    await tx
      .insert(assetDependencies)
      .values({ fromId: assetId, toId: targetId, kind: "located_in", note: null })
      .onConflictDoUpdate({ target: [assetDependencies.fromId, assetDependencies.toId], set: { kind: "located_in" } });
  });
}

/** Je `ancestorId` předkem (nebo totožný) s `id` ve stromu lokalit? (proti cyklu při přesunu) */
export async function isWithin(db: Db, companyId: string, id: string, ancestorId: string) {
  return (await subtreeOf(db, companyId, ancestorId)).has(id);
}

/** Cesta lokality aktiva (pro detail aktiva): od kořene po bezprostřední kontejner. */
export async function locationPathOf(db: Db, companyId: string, assetId: string): Promise<{ id: string; name: string; assetType: string }[]> {
  const pl = await loadPlacement(db, companyId);
  const path: { id: string; name: string; assetType: string }[] = [];
  const seen = new Set([assetId]);
  let cur = pl.container(assetId);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const r = pl.byId.get(cur)!;
    path.unshift({ id: r.id, name: r.name, assetType: r.assetType });
    cur = pl.container(cur);
  }
  return path;
}


/* ---------- převod textového umístění na lokality (v1.108) ---------- */

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/** Texty z pole „Umístění“ u aktiv bez vlastní lokality, s návrhem cesty a shodou s existující lokalitou. */
export async function textLocations(db: Db, companyId: string): Promise<TextLocationDto[]> {
  const pl = await loadPlacement(db, companyId);
  const rows = await db
    .select({ id: assets.id, location: assets.location, type: assets.assetType })
    .from(assets)
    .where(and(eq(assets.companyId, companyId), isNotNull(assets.location), inArray(assets.lifecycleStatus, [...ACTIVE])))
    // stabilní pořadí – zápis místa se přebírá od nejstaršího aktiva
    .orderBy(asc(assets.createdAt), asc(assets.name));
  const counts = new Map<string, { text: string; n: number }>();
  for (const r of rows) {
    if (r.type === "facility" || !r.location?.trim() || pl.facilityOf(r.id)) continue;
    const k = norm(r.location);
    const c = counts.get(k) ?? { text: r.location.trim(), n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const fullPath = new Map(pl.facilities.map((f) => [f.id, norm([...(ancestry(f.id, pl.parentOf) ?? []).map((x) => pl.byId.get(x)!.name), f.name].join(" / "))]));
  const byName = new Map(pl.facilities.map((f) => [norm(f.name), f.id]));
  return [...counts.values()]
    .map(({ text, n }) => {
      const path = splitLocationText(text);
      const p = norm(path.join(" / "));
      const matchId = [...fullPath].find(([, v]) => v === p)?.[0] ?? (path.length === 1 ? (byName.get(norm(path[0]!)) ?? null) : null);
      return { text, assets: n, path, matchId };
    })
    .sort((a, b) => b.assets - a.assets || a.text.localeCompare(b.text, "cs"));
}

/** Založí chybějící lokality podle cesty (znovu použije existující se stejným názvem pod stejným rodičem) a umístí do nich aktiva s daným textem. */
export async function importTextLocations(db: Db, companyId: string, items: { text: string; locationId: string | null; kind: FacilityKind }[]) {
  let created = 0;
  let placed = 0;
  for (const it of items) {
    let target = it.locationId;
    if (!target) {
      const path = splitLocationText(it.text);
      let parent: string | null = null;
      for (let i = 0; i < path.length; i++) {
        const pl = await loadPlacement(db, companyId);
        const existing = pl.facilities.find((f) => norm(f.name) === norm(path[i]!) && (pl.parentOf.get(f.id) ?? null) === parent);
        if (existing) {
          parent = existing.id;
          continue;
        }
        const kind: FacilityKind = i === path.length - 1 ? it.kind : i === 0 ? "building" : "floor";
        const [r] = await db.insert(assets).values({ companyId, name: path[i]!.slice(0, 255), assetType: "facility", assetClass: "supporting", facilityKind: kind }).returning({ id: assets.id });
        await db.insert(assetSources).values({ assetId: r!.id, sourceType: "manual", sourceRef: r!.id });
        if (parent) await placeAsset(db, r!.id, parent);
        created++;
        parent = r!.id;
      }
      target = parent;
    }
    if (!target) continue;
    const pl = await loadPlacement(db, companyId);
    const ids = (
      await db
        .select({ id: assets.id, location: assets.location, type: assets.assetType })
        .from(assets)
        .where(and(eq(assets.companyId, companyId), isNotNull(assets.location)))
    ).filter((r) => r.type !== "facility" && norm(r.location ?? "") === norm(it.text) && !pl.facilityOf(r.id));
    for (const r of ids) await placeAsset(db, r.id, target);
    placed += ids.length;
  }
  return { created, placed };
}

/* ---------- nálezy fyzické bezpečnosti (v1.109) ---------- */

/** Lokality s mezerami doporučené fyzické bezpečnosti → nálezy monitoringu (kód premise_physical_gap). */
const czDay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
};

export async function syncPremiseFindings(db: Db, companyIds?: string[], now = new Date()) {
  const cos =
    companyIds ??
    [
      ...new Set([
        ...(await db.selectDistinct({ c: assets.companyId }).from(assets).where(eq(assets.assetType, "facility"))).map((x) => x.c),
        // společnosti s otevřenými nálezy, které už lokality nemají (smazané) – nálezy se uzavřou
        ...(await db.selectDistinct({ c: monitoringFindings.companyId }).from(monitoringFindings).where(inArray(monitoringFindings.code, ["premise_physical_gap", "premise_revision_overdue"]))).map((x) => x.c),
      ]),
    ];
  const res = { opened: 0, fixed: 0, reopened: 0 };
  for (const companyId of cos) {
    const { nodes } = await locationsOf(db, companyId, now);
    const desired: MonitoringDesired[] = [];
    const revs: MonitoringDesired[] = [];
    for (const n of nodes) {
      // revize po termínu (v1.111) – EPS / hašení / UPS v serverovně nebo datovém centru = vysoká
      const late = n.revisions.filter((r) => r.status === "overdue");
      if (late.length) {
        const tech = n.kind === "datacenter" || n.kind === "server_room";
        const path = [...n.path.map((x) => x.name), n.name].join(" › ");
        revs.push({
          companyId,
          connectionId: null,
          assetId: n.id,
          key: `prem-rev:${n.id}`,
          code: "premise_revision_overdue",
          severity: tech && late.some((r) => r.control === "fire_detection" || r.control === "fire_suppression" || r.control === "ups") ? "high" : "medium",
          subject: path.slice(0, 500),
          detail: `${path}: revize po termínu – ${late.map((r) => `${PHYSICAL_CONTROL_LABELS[r.control]} (do ${czDay(r.due)})`).join(", ")}.`.slice(0, 2000),
        });
      }
      if (!n.gaps.length) continue;
      const core = n.gaps.some((g) => g.control === "access_control" || g.control === "fire_detection");
      const tech = n.kind === "datacenter" || n.kind === "server_room";
      const path = [...n.path.map((x) => x.name), n.name].join(" › ");
      desired.push({
        companyId,
        connectionId: null,
        assetId: n.id,
        key: `prem:${n.id}`,
        code: "premise_physical_gap",
        severity: tech && core ? "high" : tech ? "medium" : "low",
        subject: path.slice(0, 500),
        detail: `${path}: chybí ${n.gaps.map((g) => `${PHYSICAL_CONTROL_LABELS[g.control]}${g.level === "partial" ? " (částečně)" : ""}`).join(", ")}.`,
      });
    }
    for (const [list, code] of [
      [desired, "premise_physical_gap"],
      [revs, "premise_revision_overdue"],
    ] as const) {
      const r = await applyMonitoringFindings(db, list, and(eq(monitoringFindings.companyId, companyId), eq(monitoringFindings.code, code))!, now);
      res.opened += r.opened;
      res.fixed += r.fixed;
      res.reopened += r.reopened;
    }
  }
  return res;
}
