import { z } from "zod";
import type { AssetClass, AssetType, Criticality } from "./asset";
import type { HealthStatus } from "./vuln";

/* ============================================================
 * Graf vazeb aktiv (v0.68, ADR-063): uzly = aktiva (a procesy), hrany = „závisí na“ –
 * primární aktivum na podpůrném (asset_links), technické závislosti mezi aktivy (asset_dependencies)
 * a proces na aktivu (process_assets). Vrstvy podle typu aktiva, překryvy (stav, kritičnost, zranitelnosti,
 * alerty SOC, rizika), detail uzlu a analýza dopadu výpadku. Rozložení je deterministické (`layoutGraph`).
 * ============================================================ */

export const ASSET_LAYERS = ["process", "primary", "application", "infrastructure", "network", "people"] as const;
export type AssetLayer = (typeof ASSET_LAYERS)[number];

const LAYER_OF: Partial<Record<AssetType, AssetLayer>> = {
  business_service: "primary",
  business_process: "primary",
  information_asset: "primary",
  application: "application",
  database: "application",
  saas_service: "application",
  cloud_resource: "application",
  container: "application",
  server: "infrastructure",
  virtual_machine: "infrastructure",
  storage: "infrastructure",
  workstation: "infrastructure",
  laptop: "infrastructure",
  mobile_device: "infrastructure",
  printer: "infrastructure",
  iot_ot: "infrastructure",
  network_device: "network",
  security_device: "network",
  personnel: "people",
  supplier: "people",
  facility: "people",
};
/** Vrstva aktiva: primární aktiva vždy nahoře, ostatní podle typu. */
export function assetLayer(type: AssetType, cls: AssetClass): AssetLayer {
  if (cls === "primary") return "primary";
  return LAYER_OF[type] === "primary" ? "application" : (LAYER_OF[type] ?? "people");
}

/** Druhy technické závislosti (zdroj závisí na cíli). */
export const ASSET_DEP_KINDS = ["runs_on", "uses", "network", "located_in", "backup"] as const;
export type AssetDepKind = (typeof ASSET_DEP_KINDS)[number];

export const AssetDependencyInput = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  kind: z.enum(ASSET_DEP_KINDS).default("uses"),
  note: z.string().trim().max(500).nullable().optional(),
});
export type AssetDependencyInput = z.input<typeof AssetDependencyInput>;

export interface AssetDependencyDto {
  id: string;
  name: string;
  assetType: AssetType;
  kind: AssetDepKind;
  note: string | null;
}

export type GraphEdgeKind = "supports" | "depends" | "process";

export interface AssetGraphNode {
  id: string;
  /** asset | process */
  kind: "asset" | "process";
  name: string;
  layer: AssetLayer;
  companyId: string;
  assetType: AssetType | null;
  assetClass: AssetClass | null;
  criticality: Criticality | null;
  healthStatus: HealthStatus | null;
  /** Efektivní CIA (s děděním z primárních aktiv). */
  cia: { c: number | null; i: number | null; a: number | null } | null;
  vulns: { critical: number; high: number; p1: number } | null;
  /** Otevřené alerty SOC (jen se soc:read). */
  alerts: number | null;
  /** Rizika aktiva: počet a nejvyšší úroveň (jen s risks:read). */
  risks: { count: number; level: string | null } | null;
}
export interface AssetGraphEdge {
  /** Zdroj závisí na cíli. */
  from: string;
  to: string;
  kind: GraphEdgeKind;
  depKind: AssetDepKind | null;
  note: string | null;
}
export interface AssetGraphDto {
  nodes: AssetGraphNode[];
  edges: AssetGraphEdge[];
  /** Které překryvy jsou k dispozici (podle oprávnění a modulů). */
  overlays: { vulns: boolean; alerts: boolean; risks: boolean; processes: boolean };
  truncated: boolean;
}

export const ASSET_GRAPH_MAX_NODES = 1500;

/* ---------- analýza grafu ---------- */

const adj = (edges: Pick<AssetGraphEdge, "from" | "to">[], reverse: boolean) => {
  const m = new Map<string, string[]>();
  for (const e of edges) {
    const [a, b] = reverse ? [e.to, e.from] : [e.from, e.to];
    m.set(a, [...(m.get(a) ?? []), b]);
  }
  return m;
};
const reach = (start: string, m: Map<string, string[]>, maxDepth = Infinity) => {
  const seen = new Map<string, number>([[start, 0]]);
  const q = [start];
  while (q.length) {
    const x = q.shift()!;
    const d = seen.get(x)!;
    if (d >= maxDepth) continue;
    for (const y of m.get(x) ?? []) if (!seen.has(y)) (seen.set(y, d + 1), q.push(y));
  }
  seen.delete(start);
  return seen;
};

/** Dopad výpadku uzlu: co na něm (tranzitivně) závisí – `affected`; na čem závisí on sám – `dependsOn`. */
export function impactOf(edges: Pick<AssetGraphEdge, "from" | "to">[], id: string): { affected: Set<string>; dependsOn: Set<string> } {
  return { affected: new Set(reach(id, adj(edges, true)).keys()), dependsOn: new Set(reach(id, adj(edges, false)).keys()) };
}

/** Okolí uzlu do hloubky `depth` (oběma směry). */
export function neighborhood(edges: Pick<AssetGraphEdge, "from" | "to">[], id: string, depth: number): Set<string> {
  const both = new Map<string, string[]>();
  for (const e of edges) {
    both.set(e.from, [...(both.get(e.from) ?? []), e.to]);
    both.set(e.to, [...(both.get(e.to) ?? []), e.from]);
  }
  return new Set([id, ...reach(id, both, depth).keys()]);
}

/* ---------- rozložení ---------- */

export interface GraphLayout {
  pos: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
  /** Svislá poloha a výška pásu vrstvy. */
  bands: { layer: AssetLayer; y: number; h: number }[];
}

/**
 * Vrstvené rozložení: každá vrstva = pás (dlouhé vrstvy se zalomí do více řádků po `perRow`),
 * pořadí v pásu podle barycentra sousedů (několik průchodů dolů a nahoru) – méně křížení hran.
 */
export function layoutGraph(
  nodes: Pick<AssetGraphNode, "id" | "layer" | "name">[],
  edges: Pick<AssetGraphEdge, "from" | "to">[],
  opt: { nodeW?: number; gapX?: number; rowH?: number; bandGap?: number; perRow?: number; layers?: readonly AssetLayer[] } = {},
): GraphLayout {
  const nodeW = opt.nodeW ?? 170;
  const gapX = opt.gapX ?? 24;
  const rowH = opt.rowH ?? 74;
  const bandGap = opt.bandGap ?? 46;
  const perRow = opt.perRow ?? 14;
  const layers = (opt.layers ?? ASSET_LAYERS).filter((l) => nodes.some((n) => n.layer === l));
  const byLayer = new Map(layers.map((l) => [l, nodes.filter((n) => n.layer === l).sort((a, b) => a.name.localeCompare(b.name)).map((n) => n.id)]));
  const nb = new Map<string, string[]>();
  for (const e of edges) {
    nb.set(e.from, [...(nb.get(e.from) ?? []), e.to]);
    nb.set(e.to, [...(nb.get(e.to) ?? []), e.from]);
  }
  const order = new Map<string, number>();
  const setOrder = () => byLayer.forEach((ids) => ids.forEach((id, i) => order.set(id, i / Math.max(1, ids.length - 1))));
  setOrder();
  const sweep = (seq: AssetLayer[]) => {
    for (const l of seq) {
      const ids = byLayer.get(l)!;
      const bc = new Map(
        ids.map((id) => {
          const ns = (nb.get(id) ?? []).filter((n) => order.has(n) && !ids.includes(n));
          return [id, ns.length ? ns.reduce((s, n) => s + order.get(n)!, 0) / ns.length : order.get(id)!];
        }),
      );
      ids.sort((a, b) => bc.get(a)! - bc.get(b)! || a.localeCompare(b));
      ids.forEach((id, i) => order.set(id, i / Math.max(1, ids.length - 1)));
    }
  };
  for (let i = 0; i < 4; i++) {
    sweep(layers.slice(1));
    sweep([...layers].reverse().slice(1));
  }
  const maxCols = Math.min(perRow, Math.max(1, ...[...byLayer.values()].map((x) => x.length)));
  const width = maxCols * (nodeW + gapX) + gapX;
  const pos = new Map<string, { x: number; y: number }>();
  const bands: GraphLayout["bands"] = [];
  let y = 30;
  for (const l of layers) {
    const ids = byLayer.get(l)!;
    const rows = Math.max(1, Math.ceil(ids.length / perRow));
    const h = rows * rowH;
    bands.push({ layer: l, y: y - 22, h: h + 22 });
    ids.forEach((id, i) => {
      const r = Math.floor(i / perRow);
      const inRow = Math.min(perRow, ids.length - r * perRow);
      const offset = (width - inRow * (nodeW + gapX) + gapX) / 2;
      pos.set(id, { x: offset + (i % perRow) * (nodeW + gapX), y: y + r * rowH });
    });
    y += h + bandGap;
  }
  return { pos, width, height: y, bands };
}

export const ASSET_GRAPH_LABELS = {
  layer: {
    process: "Procesy",
    primary: "Primární aktiva (služby, informace)",
    application: "Aplikace a data",
    infrastructure: "Infrastruktura a koncová zařízení",
    network: "Síť a bezpečnostní prvky",
    people: "Lidé, dodavatelé a prostory",
  } as Record<AssetLayer, string>,
  depKind: { runs_on: "běží na", uses: "využívá", network: "síťově přes", located_in: "umístěno v", backup: "zálohováno na" } as Record<AssetDepKind, string>,
  edgeKind: { supports: "Primární ← podpůrné", depends: "Technická závislost", process: "Proces využívá" } as Record<GraphEdgeKind, string>,
};
