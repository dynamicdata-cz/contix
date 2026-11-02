/**
 * Graf vazeb aktiv (ADR-063): vrstvy (procesy → primární aktiva → aplikace → infrastruktura → síť → lidé a prostory),
 * hrany „závisí na“, překryvy (stav, kritičnost, zranitelnosti, alerty SOC, rizika), detail uzlu, okolí a analýza dopadu.
 */
import { HEALTH_COLOR, SEVERITY_COLOR, STATUS_COLORS } from "@/components/health";
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  ASSET_DEP_KINDS,
  ASSET_GRAPH_LABELS,
  ASSET_LAYERS,
  LABELS,
  hostKeyOfAsset,
  impactOf,
  layoutGraph,
  neighborhood,
  type AssetDepKind,
  type AssetGraphEdge,
  type AssetGraphNode,
  type AssetLayer,
  type GraphEdgeKind,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Maximize2, Minus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";

type Overlay = "none" | "health" | "criticality" | "vulns" | "alerts" | "risks" | "resilience";
const RES_COLOR: Record<string, string> = { critical: SEVERITY_COLOR.critical, high: SEVERITY_COLOR.high, medium: SEVERITY_COLOR.medium };
const NODE_W = 170;
const NODE_H = 46;
const LAYER_TINT: Record<AssetLayer, string> = { process: "#ede9fe", primary: "#dbeafe", application: "#e0f2fe", infrastructure: "#f1f5f9", network: "#fef3c7", people: "#ecfccb" };
const EDGE_STYLE: Record<GraphEdgeKind, { color: string; dash?: string }> = { supports: { color: "#64748b" }, depends: { color: "#2563eb", dash: "6 4" }, process: { color: "#7c3aed", dash: "2 4" } };
const SEV = (l: string | null | undefined) => (l === "critical" || l === "high" || l === "medium" || l === "low" ? SEVERITY_COLOR[l] : STATUS_COLORS.neutral);

function overlayColor(o: Overlay, n: AssetGraphNode, res?: Map<string, { sev: string; spof: boolean }>): string {
  if (n.kind === "process") return "#7c3aed";
  if (o === "resilience") return res?.get(n.id) ? RES_COLOR[res.get(n.id)!.sev]! : STATUS_COLORS.good;
  switch (o) {
    case "health":
      return HEALTH_COLOR[n.healthStatus ?? "unknown"];
    case "criticality":
      return SEV(n.criticality);
    case "vulns":
      return !n.vulns ? STATUS_COLORS.neutral : n.vulns.p1 ? SEVERITY_COLOR.critical : n.vulns.critical ? SEVERITY_COLOR.high : n.vulns.high ? SEVERITY_COLOR.medium : STATUS_COLORS.good;
    case "alerts":
      return n.alerts ? SEVERITY_COLOR.high : STATUS_COLORS.good;
    case "risks":
      return n.risks?.count ? SEV(n.risks.level) : STATUS_COLORS.neutral;
    default:
      return "#94a3b8";
  }
}
function badgeOf(o: Overlay, n: AssetGraphNode, res?: Map<string, { sev: string; spof: boolean }>): string | null {
  if (o === "resilience") return res?.get(n.id)?.spof ? "!" : null;
  if (o === "vulns" && n.vulns && (n.vulns.p1 || n.vulns.critical || n.vulns.high)) return String(n.vulns.p1 || n.vulns.critical + n.vulns.high);
  if (o === "alerts" && n.alerts) return String(n.alerts);
  if (o === "risks" && n.risks?.count) return String(n.risks.count);
  return null;
}
const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function AssetGraphPage() {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { focus?: string };
  const [retired, setRetired] = useState(false);
  const q = useQuery({ queryKey: ["assets", "graph", retired], queryFn: () => api.assets.graph(retired) });
  const [layers, setLayers] = useState<Set<AssetLayer>>(new Set(ASSET_LAYERS));
  const [edgeKinds, setEdgeKinds] = useState<Set<GraphEdgeKind>>(new Set(["supports", "depends", "process"]));
  const [overlay, setOverlay] = useState<Overlay>("health");
  const [text, setText] = useState("");
  const [isolated, setIsolated] = useState(false);
  const [selected, setSelected] = useState<string | null>(search.focus ?? null);
  const [depth, setDepth] = useState<number>(search.focus ? 2 : 0);
  const [impact, setImpact] = useState(false);
  const data = q.data;
  const resQ = useQuery({ queryKey: ["assets", "resilience"], queryFn: api.assets.resilience, enabled: overlay === "resilience" });
  const res = useMemo(() => {
    const m = new Map<string, { sev: string; spof: boolean }>();
    const rank: Record<string, number> = { critical: 3, high: 2, medium: 1 };
    for (const f of resQ.data?.findings ?? []) {
      const cur = m.get(f.nodeId);
      m.set(f.nodeId, { sev: !cur || rank[f.severity]! > rank[cur.sev]! ? f.severity : cur.sev, spof: (cur?.spof ?? false) || f.kind === "spof" });
    }
    return m;
  }, [resQ.data]);

  // viditelné uzly a hrany podle vrstev, typů hran, hledání a okolí
  const view = useMemo(() => {
    if (!data) return null;
    let edges = data.edges.filter((e) => edgeKinds.has(e.kind));
    let nodes = data.nodes.filter((n) => layers.has(n.layer));
    let ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    if (selected && ids.has(selected) && depth > 0) {
      const nb = impact ? (() => {
        const im = impactOf(edges, selected);
        return new Set([selected, ...im.affected, ...im.dependsOn]);
      })() : neighborhood(edges, selected, depth);
      nodes = nodes.filter((n) => nb.has(n.id));
      ids = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    }
    if (!isolated) {
      const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
      nodes = nodes.filter((n) => linked.has(n.id) || n.id === selected);
    }
    return { nodes, edges, layout: layoutGraph(nodes, edges) };
  }, [data, layers, edgeKinds, selected, depth, impact, isolated]);

  const im = useMemo(() => (selected && view && impact ? impactOf(view.edges, selected) : null), [selected, view, impact]);
  const match = (n: AssetGraphNode) => !text.trim() || n.name.toLowerCase().includes(text.trim().toLowerCase());
  const sel = data?.nodes.find((n) => n.id === selected) ?? null;

  // posun a přiblížení
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const fit = () => {
    if (!view) return;
    // malý graf nezvětšovat přes míru – minimální šířka výřezu, graf na střed
    const w = Math.max(view.layout.width, 760);
    const h = view.layout.height;
    setVb({ x: -(w - view.layout.width) / 2, y: 0, w, h });
  };
  useEffect(fit, [view?.layout.width, view?.layout.height]); // eslint-disable-line react-hooks/exhaustive-deps
  const drag = useRef<{ x: number; y: number; vb: NonNullable<typeof vb> } | null>(null);
  const zoom = (f: number, cx = 0.5, cy = 0.5) =>
    setVb((v) => (v ? { w: v.w * f, h: v.h * f, x: v.x + v.w * cx * (1 - f), y: v.y + v.h * cy * (1 - f) } : v));
  const onWheel = (e: RWheelEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };
  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-node]")) return;
    if (vb) drag.current = { x: e.clientX, y: e.clientY, vb };
  };
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = svgRef.current!.getBoundingClientRect();
    setVb({ ...d.vb, x: d.vb.x - ((e.clientX - d.x) * d.vb.w) / r.width, y: d.vb.y - ((e.clientY - d.y) * d.vb.h) / r.height });
  };

  const toggle = <T,>(s: Set<T>, v: T) => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const pick = (id: string) => {
    setSelected(id === selected ? null : id);
  };

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/assets" className="hover:text-brand-700">
          {t("ag.back")}
        </Link>
      </div>
      <PageHeader title={t("ag.title")} subtitle={t("ag.subtitle")} />
      <ErrorBox error={q.error} />
      {data?.truncated && <p className="mb-3 text-sm text-amber-800">{t("ag.truncated", { n: data.nodes.filter((n) => n.kind === "asset").length })}</p>}
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t("ag.search")}>
            <Input className="w-56" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("ag.searchPh")} />
          </Field>
          <Field label={t("ag.overlay")}>
            <Select className="w-52" value={overlay} onChange={(e) => setOverlay(e.target.value as Overlay)}>
              <option value="none">{t("ag.ov.none")}</option>
              <option value="health">{t("ag.ov.health")}</option>
              <option value="criticality">{t("ag.ov.criticality")}</option>
              <option value="vulns">{t("ag.ov.vulns")}</option>
              {data?.overlays.alerts && <option value="alerts">{t("ag.ov.alerts")}</option>}
              {data?.overlays.risks && <option value="risks">{t("ag.ov.risks")}</option>}
              <option value="resilience">{t("ag.ov.resilience")}</option>
            </Select>
          </Field>
          <Field label={t("ag.depth")}>
            <Select className="w-44" value={String(depth)} disabled={!selected} onChange={(e) => setDepth(Number(e.target.value))}>
              <option value="0">{t("ag.depthAll")}</option>
              {[1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  {t("ag.depthN", { n: d })}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox checked={impact} disabled={!selected} onChange={(v) => (setImpact(v), v && depth === 0 && setDepth(1))} label={t("ag.impact")} />
          <Checkbox checked={isolated} onChange={setIsolated} label={t("ag.isolated")} />
          <Checkbox checked={retired} onChange={setRetired} label={t("ag.retired")} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm" role="group" aria-label={t("ag.layers")}>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("ag.layers")}</span>
          {ASSET_LAYERS.filter((l) => l !== "process" || data?.overlays.processes).map((l) => (
            <label key={l} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={layers.has(l)} onChange={() => setLayers(toggle(layers, l))} />
              <span className="inline-block h-3 w-3 rounded-sm border border-slate-300" style={{ background: LAYER_TINT[l] }} />
              {t.lbl(ASSET_GRAPH_LABELS.layer[l])}
            </label>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm" role="group" aria-label={t("ag.edges")}>
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("ag.edges")}</span>
          {(["supports", "depends", "process"] as GraphEdgeKind[]).filter((k) => k !== "process" || data?.overlays.processes).map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={edgeKinds.has(k)} onChange={() => setEdgeKinds(toggle(edgeKinds, k))} />
              <svg width="26" height="8" aria-hidden>
                <line x1="0" y1="4" x2="26" y2="4" stroke={EDGE_STYLE[k].color} strokeWidth="2" strokeDasharray={EDGE_STYLE[k].dash} />
              </svg>
              {t.lbl(ASSET_GRAPH_LABELS.edgeKind[k])}
            </label>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card className="relative overflow-hidden" data-testid="asset-graph">
          <div className="absolute right-2 top-2 z-10 flex gap-1">
            <Button variant="secondary" className="px-2 py-1" onClick={() => zoom(1 / 1.25)} aria-label={t("ag.zoomIn")}>
              <Plus size={14} />
            </Button>
            <Button variant="secondary" className="px-2 py-1" onClick={() => zoom(1.25)} aria-label={t("ag.zoomOut")}>
              <Minus size={14} />
            </Button>
            <Button variant="secondary" className="px-2 py-1" onClick={fit} aria-label={t("ag.fit")}>
              <Maximize2 size={14} />
            </Button>
          </div>
          {view && view.nodes.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">{t("ag.empty")}</p>
          ) : (
            view &&
            vb && (
              <svg
                ref={svgRef}
                className="w-full cursor-grab touch-none select-none bg-white active:cursor-grabbing"
                style={{ height: Math.min(680, Math.max(320, view.layout.height + 10)) }}
                viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
                onWheel={onWheel}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={() => (drag.current = null)}
                onPointerLeave={() => (drag.current = null)}
                role="img"
                aria-label={t("ag.title")}
              >
                <defs>
                  {(Object.keys(EDGE_STYLE) as GraphEdgeKind[]).map((k) => (
                    <marker key={k} id={`arr-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill={EDGE_STYLE[k].color} />
                    </marker>
                  ))}
                </defs>
                {view.layout.bands.map((b) => (
                  <g key={b.layer}>
                    <rect x={vb.x - 2000} y={b.y} width={view.layout.width + 4000 + vb.w} height={b.h} fill={LAYER_TINT[b.layer]} opacity={0.5} />
                    <text x={vb.x + 8} y={b.y + 15} className="fill-slate-500" fontSize="12" fontWeight="600" stroke="var(--color-white)" strokeWidth="4" paintOrder="stroke">
                      {t.lbl(ASSET_GRAPH_LABELS.layer[b.layer])}
                    </text>
                  </g>
                ))}
                {view.edges.map((e: AssetGraphEdge) => {
                  const a = view.layout.pos.get(e.from)!;
                  const b = view.layout.pos.get(e.to)!;
                  const down = b.y >= a.y;
                  const x1 = a.x + NODE_W / 2;
                  const y1 = a.y + (down ? NODE_H : 0);
                  const x2 = b.x + NODE_W / 2;
                  const y2 = b.y + (down ? 0 : NODE_H);
                  const my = (y1 + y2) / 2;
                  const hot = !!selected && (e.from === selected || e.to === selected || (!!im && (im.affected.has(e.from) || im.dependsOn.has(e.to))));
                  const dim = !!selected && !hot;
                  return (
                    <path
                      key={`${e.from}-${e.to}-${e.kind}`}
                      d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
                      fill="none"
                      stroke={EDGE_STYLE[e.kind].color}
                      strokeWidth={hot ? 2.4 : 1.3}
                      strokeDasharray={EDGE_STYLE[e.kind].dash}
                      opacity={dim ? 0.15 : 0.85}
                      markerEnd={`url(#arr-${e.kind})`}
                    >
                      <title>{e.depKind ? t.lbl(ASSET_GRAPH_LABELS.depKind[e.depKind]) : t.lbl(ASSET_GRAPH_LABELS.edgeKind[e.kind])}</title>
                    </path>
                  );
                })}
                {view.nodes.map((n) => {
                  const p = view.layout.pos.get(n.id)!;
                  const col = overlayColor(overlay, n, res);
                  const isSel = n.id === selected;
                  const inImpact = im ? im.affected.has(n.id) : false;
                  const inDeps = im ? im.dependsOn.has(n.id) : false;
                  const dim = (!!text.trim() && !match(n)) || (!!im && !isSel && !inImpact && !inDeps);
                  const badge = badgeOf(overlay, n, res);
                  return (
                    <g
                      key={n.id}
                      data-node={n.id}
                      transform={`translate(${p.x},${p.y})`}
                      opacity={dim ? 0.25 : 1}
                      role="button"
                      tabIndex={0}
                      aria-label={n.name}
                      aria-pressed={isSel}
                      className="cursor-pointer outline-none"
                      onClick={() => pick(n.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(n.id))}
                    >
                      <title>{n.name}</title>
                      <rect width={NODE_W} height={NODE_H} rx={n.kind === "process" ? 22 : 8} fill={inImpact ? "#fee2e2" : inDeps ? "#e0f2fe" : "#fff"} stroke={isSel ? "#0f172a" : col} strokeWidth={isSel ? 3 : 2.2} />
                      <rect width="6" height={NODE_H} rx="3" fill={col} />
                      <text x="14" y="19" fontSize="12.5" fontWeight="600" className="fill-slate-900">
                        {short(n.name)}
                      </text>
                      <text x="14" y="35" fontSize="10.5" className="fill-slate-500">
                        {short(n.kind === "process" ? t("ag.process") : t.lbl(LABELS.assetType[n.assetType!]), 26)}
                      </text>
                      {badge && (
                        <g transform={`translate(${NODE_W - 4},4)`}>
                          <circle r="10" fill={col} />
                          <text textAnchor="middle" y="4" fontSize="10" fontWeight="700" fill="#fff">
                            {badge}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
            )
          )}
          <Legend overlay={overlay} impact={impact && !!selected} />
        </Card>
        <div>
          {sel ? (
            <NodePanel
              n={sel}
              edges={data!.edges}
              nodes={data!.nodes}
              canEdit={can("assets:write") || can("assets:write_own")}
              soc={mod("soc") && can("soc:read")}
              onClose={() => (setSelected(null), setImpact(false), setDepth(0))}
              onPick={pick}
              onChanged={() => qc.invalidateQueries({ queryKey: ["assets", "graph"] })}
            />
          ) : (
            <Card className="p-4 text-sm text-slate-600">{t("ag.hint")}</Card>
          )}
        </div>
      </div>
    </>
  );
}

function Legend({ overlay, impact }: { overlay: Overlay; impact: boolean }) {
  const t = useT();
  const items: [string, string][] =
    overlay === "health"
      ? [[HEALTH_COLOR.green, t("ag.lg.green")], [HEALTH_COLOR.orange, t("ag.lg.orange")], [HEALTH_COLOR.red, t("ag.lg.red")], [HEALTH_COLOR.unknown, t("ag.lg.unknown")]]
      : overlay === "criticality" || overlay === "risks"
        ? [[SEVERITY_COLOR.low, t("ag.lg.low")], [SEVERITY_COLOR.medium, t("ag.lg.medium")], [SEVERITY_COLOR.high, t("ag.lg.high")], [SEVERITY_COLOR.critical, t("ag.lg.critical")]]
        : overlay === "vulns"
          ? [[STATUS_COLORS.good, t("ag.lg.noVulns")], [SEVERITY_COLOR.medium, t("ag.lg.highVulns")], [SEVERITY_COLOR.high, t("ag.lg.critVulns")], [SEVERITY_COLOR.critical, t("ag.lg.p1")]]
          : overlay === "resilience"
            ? [[STATUS_COLORS.good, t("ag.lg.noFinding")], [SEVERITY_COLOR.medium, t("ag.lg.medium")], [SEVERITY_COLOR.high, t("ag.lg.high")], [SEVERITY_COLOR.critical, t("ag.lg.critical")]]
            : overlay === "alerts"
            ? [[STATUS_COLORS.good, t("ag.lg.noAlerts")], [SEVERITY_COLOR.high, t("ag.lg.alerts")]]
            : [];
  return (
    <div className="flex flex-wrap gap-3 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {l}
        </span>
      ))}
      {impact && (
        <>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-red-300 bg-red-100" /> {t("ag.lg.affected")}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm border border-sky-300 bg-sky-100" /> {t("ag.lg.dependsOn")}
          </span>
        </>
      )}
      <span className="ml-auto text-slate-400">{t("ag.lg.nav")}</span>
    </div>
  );
}

function NodePanel({
  n,
  edges,
  nodes,
  canEdit,
  soc,
  onClose,
  onPick,
  onChanged,
}: {
  n: AssetGraphNode;
  edges: AssetGraphEdge[];
  nodes: AssetGraphNode[];
  canEdit: boolean;
  soc: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const name = new Map(nodes.map((x) => [x.id, x.name]));
  const out = edges.filter((e) => e.from === n.id);
  const inc = edges.filter((e) => e.to === n.id);
  const im = impactOf(edges, n.id);
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<AssetDepKind>("runs_on");
  const add = useMutation({ mutationFn: () => api.assets.addDependency({ fromId: n.id, toId: target, kind }), onSuccess: () => (setTarget(""), onChanged()) });
  const remove = useMutation({ mutationFn: (to: string) => api.assets.removeDependency(n.id, to), onSuccess: onChanged });
  const label = (e: AssetGraphEdge) => (e.depKind ? t.lbl(ASSET_GRAPH_LABELS.depKind[e.depKind]) : t.lbl(ASSET_GRAPH_LABELS.edgeKind[e.kind]));
  return (
    <Card className="p-4 text-sm" data-testid="asset-graph-node">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-slate-900">{n.name}</div>
          <div className="text-xs text-slate-500">
            {n.kind === "process" ? t("ag.process") : `${t.lbl(LABELS.assetType[n.assetType!])} · ${t.lbl(LABELS.assetClass[n.assetClass!])}`}
          </div>
        </div>
        <button type="button" className="rounded p-1 hover:bg-slate-100" onClick={onClose} aria-label={t("ag.close")}>
          <X size={16} />
        </button>
      </div>
      {n.kind === "asset" && (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-slate-500">{t("ag.d.criticality")}</dt>
            <dd>{n.criticality ? t.lbl(LABELS.criticality[n.criticality]) : "—"}</dd>
            <dt className="text-slate-500">{t("ag.d.cia")}</dt>
            <dd>{n.cia ? [n.cia.c, n.cia.i, n.cia.a].map((x) => x ?? "–").join(" / ") : "—"}</dd>
            <dt className="text-slate-500">{t("ag.d.vulns")}</dt>
            <dd>{n.vulns ? t("ag.d.vulnsV", { p1: n.vulns.p1, c: n.vulns.critical, h: n.vulns.high }) : "—"}</dd>
            {n.alerts != null && (
              <>
                <dt className="text-slate-500">{t("ag.d.alerts")}</dt>
                <dd className={cn(n.alerts > 0 && "font-semibold text-red-700")}>{n.alerts}</dd>
              </>
            )}
            {n.risks && (
              <>
                <dt className="text-slate-500">{t("ag.d.risks")}</dt>
                <dd className="flex items-center gap-1">
                  {n.risks.count} {n.risks.level && <RiskLevelBadge level={n.risks.level} />}
                </dd>
              </>
            )}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/assets/$assetId" params={{ assetId: n.id }}>
              <Button variant="secondary" className="px-2 py-1 text-xs">
                {t("ag.openAsset")}
              </Button>
            </Link>
            {soc && (
              <Link to="/soc/hosts/$hostKey" params={{ hostKey: hostKeyOfAsset(n.id) }}>
                <Button variant="secondary" className="px-2 py-1 text-xs">
                  {t("soc.host.open")}
                </Button>
              </Link>
            )}
          </div>
        </>
      )}
      <div className="mt-4 rounded-md bg-slate-50 p-2 text-xs text-slate-700" data-testid="asset-graph-impact">
        {t("ag.impactSummary", { a: im.affected.size, d: im.dependsOn.size })}
      </div>
      <EdgeList title={t("ag.dependsOn")} items={out.map((e) => ({ id: e.to, label: label(e), removable: e.kind === "depends" }))} name={name} onPick={onPick} onRemove={canEdit ? (id) => remove.mutate(id) : undefined} />
      <EdgeList title={t("ag.dependedBy")} items={inc.map((e) => ({ id: e.from, label: label(e), removable: false }))} name={name} onPick={onPick} />
      {canEdit && n.kind === "asset" && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("ag.addDep")}</div>
          <Select value={kind} onChange={(e) => setKind(e.target.value as AssetDepKind)} aria-label={t("ag.depKind")}>
            {ASSET_DEP_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(ASSET_GRAPH_LABELS.depKind[k])}
              </option>
            ))}
          </Select>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t("ag.depTarget")}>
            <option value="">{t("ag.depTargetPh")}</option>
            {nodes
              .filter((x) => x.kind === "asset" && x.id !== n.id)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
          <Button className="w-full" disabled={!target || add.isPending} onClick={() => add.mutate()}>
            <Plus size={14} /> {t("ag.addDepBtn")}
          </Button>
          <ErrorBox error={add.error ?? remove.error} />
        </div>
      )}
    </Card>
  );
}

function EdgeList({ title, items, name, onPick, onRemove }: { title: string; items: { id: string; label: string; removable: boolean }[]; name: Map<string, string>; onPick: (id: string) => void; onRemove?: (id: string) => void }) {
  const t = useT();
  return (
    <div className="mt-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((x) => (
            <li key={`${x.id}-${x.label}`} className="flex items-center justify-between gap-2">
              <button type="button" className="truncate text-left text-brand-700 hover:underline" onClick={() => onPick(x.id)}>
                {name.get(x.id) ?? x.id}
              </button>
              <span className="flex shrink-0 items-center gap-1">
                <Badge tone="slate">{x.label}</Badge>
                {x.removable && onRemove && (
                  <button type="button" className="rounded p-0.5 text-slate-400 hover:text-red-700" onClick={() => onRemove(x.id)} aria-label={t("ag.removeDep", { name: name.get(x.id) ?? "" })}>
                    <Trash2 size={13} />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
