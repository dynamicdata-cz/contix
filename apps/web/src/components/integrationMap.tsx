import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { mapProblems, MAP_STATUSES, type IntegrationMapDto, type MapEdgeDto, type MapGroupDto, type MapNodeDto, type MapNodeKind, type MapReason, type MapStatus } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellRing, Bot, Boxes, Crosshair, DatabaseBackup, FileType, Landmark, Maximize2, Minimize2, Network, Radar, Scale, Server, ShieldAlert, ShieldCheck, Ticket, Users, Waypoints, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/* ============================================================
 * Mapa propojení (v1.86, ADR-181): zóny sítě jako pruhy, uzly se stavem a odznakem, spojení s protokolem
 * a počtem zpráv za 24 h, panel detailu (proč tento stav, údaje, odkazy), „jen problémy“ a celá obrazovka.
 * Data i stavy počítá API (`buildIntegrationMap`) – komponenta jen kreslí.
 * ============================================================ */

export const STATUS_CLS: Record<MapStatus, { box: string; dot: string; line: string; fill: string; text: string }> = {
  ok: { box: "stroke-emerald-500", dot: "fill-emerald-500", line: "stroke-emerald-500", fill: "bg-emerald-500", text: "text-emerald-700" },
  warn: { box: "stroke-amber-500", dot: "fill-amber-500", line: "stroke-amber-500", fill: "bg-amber-500", text: "text-amber-700" },
  error: { box: "stroke-red-500", dot: "fill-red-500", line: "stroke-red-500", fill: "bg-red-500", text: "text-red-700" },
  off: { box: "stroke-slate-300", dot: "fill-slate-400", line: "stroke-slate-300", fill: "bg-slate-400", text: "text-slate-500" },
};
const TONE: Record<MapStatus, "green" | "amber" | "red" | "slate"> = { ok: "green", warn: "amber", error: "red", off: "slate" };

const SVC_ICON: Record<string, LucideIcon> = { ai: Bot, vuln_intel: ShieldAlert, legislation: Scale, notifications: BellRing, converter: FileType, backup: DatabaseBackup, alerts: ShieldAlert };
const ICON: Record<MapNodeKind, LucideIcon> = { core: ShieldCheck, concentrator: Waypoints, agent: Server, collector: Boxes, host: Server, wazuh: ShieldCheck, netbox: Network, jira: Ticket, probe: Crosshair, scan: Radar, identity: Users, service: Landmark };
const iconOf = (n: MapNodeDto) => (n.kind === "service" ? (SVC_ICON[n.id.slice(4)] ?? Landmark) : ICON[n.kind]);

/* ---------- rozložení ---------- */
const W = 1120;
const LANE_L = { x: 6, w: 452 };
const LEAF = { x: 18, w: 176, h: 34 };
const MID = { x: 262, w: 182, h: 48 };
const CORE = { x: 520, w: 150, h: 92 };
const LANE_R = { x: 728, w: 386 };
const RNODE = { x: 744, w: 354, h: 46 };
const LANE_HEAD = 30;
const GAP = 8;
const LANE_GAP = 16;
const MAX_LEAVES = 5;

interface Box {
  n: MapNodeDto;
  x: number;
  y: number;
  w: number;
  h: number;
  leaf?: boolean;
}
interface Lane {
  g: MapGroupDto;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface More {
  parent: string;
  x: number;
  y: number;
  hidden: number;
  okHidden: number;
}

const ORDER: Record<MapStatus, number> = { error: 0, warn: 1, ok: 2, off: 3 };

function layoutMap(m: IntegrationMapDto, onlyProblems: boolean, expanded: Set<string>) {
  const boxes: Box[] = [];
  const lanes: Lane[] = [];
  const more: More[] = [];
  const children = (id: string) => m.nodes.filter((n) => n.parent === id).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.title.localeCompare(b.title));
  const visible = (n: MapNodeDto) => !onlyProblems || n.status === "warn" || n.status === "error";

  // levá strana: zóny a sběrače – v každém pruhu koncentrátory / sběrače s agenty / servery
  let y = 34;
  for (const g of m.groups.filter((x) => x.side === "left")) {
    const mids = m.nodes.filter((n) => n.group === g.id && !n.parent);
    const top = y;
    y += LANE_HEAD;
    for (const mid of mids) {
      const all = children(mid.id);
      const vis = all.filter(visible);
      const shown = expanded.has(mid.id) ? vis : vis.slice(0, MAX_LEAVES);
      const extra = vis.length - shown.length;
      const okHidden = all.length - vis.length;
      const rows = shown.length + (extra > 0 || okHidden > 0 ? 1 : 0) + (expanded.has(mid.id) && vis.length > MAX_LEAVES ? 0 : 0);
      const block = Math.max(MID.h + 12, rows * (LEAF.h + GAP) - GAP);
      boxes.push({ n: mid, x: MID.x, y: y + (block - MID.h) / 2, w: MID.w, h: MID.h });
      shown.forEach((l, i) => boxes.push({ n: l, x: LEAF.x, y: y + i * (LEAF.h + GAP), w: LEAF.w, h: LEAF.h, leaf: true }));
      if (extra > 0 || okHidden > 0 || (expanded.has(mid.id) && vis.length > MAX_LEAVES)) more.push({ parent: mid.id, x: LEAF.x, y: y + shown.length * (LEAF.h + GAP), hidden: extra, okHidden });
      y += block + GAP * 2 + 6;
    }
    lanes.push({ g, x: LANE_L.x, y: top, w: LANE_L.w, h: y - top - GAP });
    y += LANE_GAP - GAP;
  }
  const leftH = y;

  // pravá strana: monitoring, evidence, služby
  y = 34;
  for (const g of m.groups.filter((x) => x.side === "right")) {
    const list = m.nodes.filter((n) => n.group === g.id && (visible(n) || !onlyProblems));
    const top = y;
    y += LANE_HEAD;
    for (const n of list) {
      boxes.push({ n, x: RNODE.x, y, w: RNODE.w, h: RNODE.h });
      y += RNODE.h + GAP;
    }
    lanes.push({ g, x: LANE_R.x, y: top, w: LANE_R.w, h: y - top + GAP / 2 });
    y += LANE_GAP;
  }
  const height = Math.max(leftH, y, 260) + 6;
  const core = m.nodes.find((n) => n.kind === "core")!;
  boxes.push({ n: core, x: CORE.x, y: height / 2 - CORE.h / 2, w: CORE.w, h: CORE.h });
  return { boxes, lanes, more, height };
}

/* ---------- komponenta ---------- */

export function IntegrationMap({ testId = "integration-map" }: { testId?: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["integrations", "map"], queryFn: api.integrations.map, refetchInterval: 60_000 });
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [full, setFull] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  const m = q.data;
  const lay = useMemo(() => (m ? layoutMap(m, onlyProblems, expanded) : null), [m, onlyProblems, expanded]);
  if (!m || !lay) return null;
  const selected = m.nodes.find((n) => n.id === sel) ?? null;
  const empty = m.nodes.length <= 1;

  const body = (
    <div className={cn("grid gap-4", full ? "xl:grid-cols-[1fr_22rem]" : "2xl:grid-cols-[1fr_20rem]")}>
      <div className="min-w-0">
        {empty && <p className="px-2 pb-2 text-sm text-slate-500">{t("imap.empty")}</p>}
        <div className="overflow-x-auto">
          <MapSvg m={m} lay={lay} sel={sel} hover={hover} setHover={setHover} onSelect={(id) => setSel(id === sel ? null : id)} onMore={(id) => setExpanded((s) => toggle(s, id))} expanded={expanded} />
        </div>
        <Legend />
        {m.coverage && m.coverage.servers > 0 && <Coverage m={m} />}
      </div>
      <Panel n={selected} m={m} onClose={() => setSel(null)} />
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="hidden items-center gap-1 sm:flex" aria-label={t("imap.title")}>
        {(["error", "warn", "ok", "off"] as const).map((s) => (m.totals[s] ? <Badge key={s} tone={TONE[s]}>{`${m.totals[s]} · ${t(`imap.st.${s}`)}`}</Badge> : null))}
      </span>
      <Button variant={onlyProblems ? "primary" : "secondary"} className="px-2.5 py-1 text-xs" aria-pressed={onlyProblems} onClick={() => setOnlyProblems((v) => !v)} data-testid="map-only-problems">
        {t("imap.onlyProblems")}
      </Button>
      <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setFull((v) => !v)} aria-label={full ? t("imap.close") : t("imap.fullscreen")} data-testid="map-fullscreen">
        {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        <span className="hidden sm:inline">{full ? t("imap.close") : t("imap.fullscreen")}</span>
      </Button>
    </div>
  );

  if (full)
    return (
      <div className="fixed inset-0 z-50 overflow-auto bg-slate-50 p-4" role="dialog" aria-modal="true" aria-label={t("imap.title")} data-testid={testId}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">{t("imap.title")}</h2>
          {toolbar}
        </div>
        {body}
      </div>
    );
  return (
    <Card data-testid={testId}>
      <CardHeader title={t("imap.title")} subtitle={t("imap.subtitle")} action={toolbar} />
      <div className="px-3 pb-4">
        {body}
        <p className="mt-2 px-2 text-xs text-slate-400">{t("imap.updated", { date: fmtDate(m.at) })}</p>
      </div>
    </Card>
  );
}

const toggle = (s: Set<string>, id: string) => {
  const n = new Set(s);
  if (n.has(id)) n.delete(id);
  else n.add(id);
  return n;
};

function MapSvg({
  m,
  lay,
  sel,
  hover,
  setHover,
  onSelect,
  onMore,
  expanded,
}: {
  m: IntegrationMapDto;
  lay: ReturnType<typeof layoutMap>;
  sel: string | null;
  hover: string | null;
  setHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  onMore: (id: string) => void;
  expanded: Set<string>;
}) {
  const t = useT();
  const byId = new Map(lay.boxes.map((b) => [b.n.id, b]));
  const focus = hover ?? sel;
  const linked = (e: MapEdgeDto) => !focus || e.from === focus || e.to === focus;
  const near = (id: string) => !focus || id === focus || m.edges.some((e) => (e.from === focus && e.to === id) || (e.to === focus && e.from === id));
  const firstLeafEdge = new Set<string>();
  const groupTitle = (g: MapGroupDto) => (g.kind === "zone" ? t("imap.g.zone", { zone: g.title }) : t(`imap.g.${g.kind}`));
  const titleOf = (n: MapNodeDto) => (n.kind === "service" ? tk(t, `imap.svc.${n.id.slice(4)}`) : n.title);

  return (
    <svg viewBox={`0 0 ${W} ${lay.height}`} className="min-w-[880px]" role="group" aria-label={t("imap.title")} style={{ width: "100%", height: "auto" }}>
      <style>{`@keyframes ctxflow { to { stroke-dashoffset: -20; } } .ctx-flow { animation: ctxflow 1.2s linear infinite; } @media (prefers-reduced-motion: reduce) { .ctx-flow { animation: none; } } .ctx-node:focus-visible rect.ctx-frame { stroke-width: 3; }`}</style>
      <text x={LANE_L.x + 4} y={20} className="fill-slate-400 text-[11px] font-semibold uppercase tracking-wide">
        {t("imap.col.sources")}
      </text>
      <text x={LANE_R.x + 4} y={20} className="fill-slate-400 text-[11px] font-semibold uppercase tracking-wide">
        {t("imap.col.integrations")}
      </text>
      {/* pruhy zón a skupin */}
      {lay.lanes.map((l) => {
        const worst = l.g.counts.error ? "error" : l.g.counts.warn ? "warn" : l.g.counts.ok ? "ok" : "off";
        return (
          <g key={l.g.id} data-testid={`map-lane-${l.g.id}`}>
            <rect x={l.x} y={l.y} width={l.w} height={l.h} rx={12} className="fill-slate-50 stroke-slate-200" strokeWidth={1} />
            <circle cx={l.x + 14} cy={l.y + 15} r={4} className={STATUS_CLS[worst].dot} />
            <text x={l.x + 24} y={l.y + 19} className="fill-slate-700 text-[12px] font-semibold">
              {clip(groupTitle(l.g), 34)}
            </text>
            <text x={l.x + l.w - 12} y={l.y + 19} textAnchor="end" className="fill-slate-400 text-[11px]">
              {(["error", "warn", "ok", "off"] as const)
                .filter((s) => l.g.counts[s])
                .map((s) => `${l.g.counts[s]} ${t(`imap.stShort.${s}`)}`)
                .join(" · ")}
            </text>
          </g>
        );
      })}
      {/* spojení */}
      {m.edges.map((e, i) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        if (!a || !b) return null;
        const rightward = a.x < b.x;
        const x1 = rightward ? a.x + a.w : a.x;
        const x2 = rightward ? b.x : b.x + b.w;
        const y1 = a.y + a.h / 2;
        const y2 = b.y + b.h / 2;
        const dx = (x2 - x1) / 2;
        const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
        const leafEdge = !!a.leaf;
        let label: string | null = null;
        if (leafEdge) {
          if (!firstLeafEdge.has(e.to)) {
            firstLeafEdge.add(e.to);
            label = e.label;
          }
        } else label = [e.label, e.msgs24h != null ? t("imap.msgs", { n: e.msgs24h }) : null].filter(Boolean).join(" · ");
        // popisek: u agenta nad začátkem, u koncentrátoru / sběrače pod uzlem, vpravo u vzdálenějšího konce od CONTIXu
        const fromCore = e.from === "contix";
        const leftMid = !leafEdge && e.to === "contix" && a.x < b.x;
        const pos = leafEdge
          ? { x: x1 + 4, y: y1 - 5, anchor: "start" as const }
          : leftMid
            ? { x: a.x + a.w, y: a.y + a.h + 11, anchor: "end" as const }
            : fromCore
              ? { x: x2 - 8, y: y2 - 5, anchor: "end" as const }
              : { x: x1 - 8, y: y1 - 5, anchor: "end" as const };
        return (
          <g key={i} opacity={linked(e) ? 1 : 0.15} data-testid={`map-edge-${e.from}-${e.to}`}>
            <path d={d} fill="none" className="stroke-slate-200" strokeWidth={3} />
            <path d={d} fill="none" className={cn(STATUS_CLS[e.status].line, e.status !== "off" && "ctx-flow")} strokeWidth={1.6} strokeDasharray="6 4" />
            {label && (!leafEdge || !focus || linked(e)) && (
              <text x={pos.x} y={pos.y} textAnchor={pos.anchor} className="fill-slate-500 text-[10.5px]" paintOrder="stroke" stroke="var(--color-slate-50)" strokeWidth={4}>
                {label}
              </text>
            )}
          </g>
        );
      })}
      {/* uzly */}
      {lay.boxes.map((b) => {
        const n = b.n;
        const core = n.kind === "core";
        const Icon = iconOf(n);
        const active = sel === n.id;
        return (
          <g
            key={n.id}
            transform={`translate(${b.x},${b.y})`}
            opacity={near(n.id) ? 1 : 0.35}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(n.id)}
            onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), onSelect(n.id))}
            tabIndex={0}
            role="button"
            aria-pressed={active}
            aria-label={`${titleOf(n)} – ${t(`imap.st.${n.status}`)}`}
            className="ctx-node cursor-pointer outline-none"
            data-testid={`map-node-${n.id}`}
          >
            <rect width={b.w} height={b.h} rx={core ? 16 : 9} className={cn("ctx-frame", core ? "fill-brand-600" : "fill-white", core ? (n.status === "ok" ? "stroke-brand-700" : STATUS_CLS[n.status].box) : STATUS_CLS[n.status].box)} strokeWidth={active ? 3 : core ? (n.status === "ok" ? 0 : 3) : 1.5} />
            {!core && <circle cx={b.w - 10} cy={10} r={4} className={STATUS_CLS[n.status].dot} />}
            <Icon x={10} y={core ? 22 : b.leaf ? 9 : 15} width={core ? 26 : 16} height={core ? 26 : 16} className={core ? "text-white" : "text-slate-500"} />
            <text x={core ? 44 : 32} y={core ? 38 : b.leaf ? 21 : 21} className={core ? "fill-white text-[17px] font-bold" : cn("fill-slate-900", b.leaf ? "text-[12px]" : "text-[13px] font-semibold")}>
              {clip(titleOf(n), core ? 12 : b.leaf ? (n.badge ? 15 : 19) : b.w > 300 ? 34 : 18)}
            </text>
            {core && (
              <text x={44} y={58} className="fill-white/80 text-[10px]">
                {t("imap.core")}
              </text>
            )}
            {!core && !b.leaf && (
              <text x={32} y={37} className="fill-slate-500 text-[11px]">
                {clip(subOf(n, t), b.w > 300 ? 46 : 22)}
              </text>
            )}
            {n.badge && !core && (
              <text x={b.w - 20} y={b.leaf ? 22 : 38} textAnchor="end" className={cn("text-[10.5px] font-semibold", scoreFill(n.badge) ?? (b.leaf ? "fill-slate-500" : "fill-slate-400"))}>
                {n.badge}
              </text>
            )}
          </g>
        );
      })}
      {/* sbalené servery */}
      {lay.more.map((x) => (
        <g key={x.parent} transform={`translate(${x.x},${x.y})`} className="cursor-pointer" role="button" tabIndex={0} onClick={() => onMore(x.parent)} onKeyDown={(ev) => ev.key === "Enter" && onMore(x.parent)} data-testid={`map-more-${x.parent}`}>
          <rect width={LEAF.w} height={LEAF.h - 6} rx={8} className="fill-transparent stroke-slate-300" strokeDasharray="3 3" />
          <text x={LEAF.w / 2} y={18} textAnchor="middle" className="fill-slate-500 text-[11px]">
            {expanded.has(x.parent) ? t("imap.showLess") : [x.hidden > 0 ? t("imap.more", { n: x.hidden }) : null, x.okHidden > 0 ? t("imap.okHidden", { n: x.okHidden }) : null].filter(Boolean).join(" · ")}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Odznak se skóre hardeningu barevně: < 65 % červeně, < 85 % oranžově, jinak zeleně. */
function scoreFill(badge: string): string | null {
  const m = /^(\d+) %$/.exec(badge);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 85 ? "fill-emerald-600" : n >= 65 ? "fill-amber-600" : "fill-red-600";
}

function subOf(n: MapNodeDto, t: ReturnType<typeof useT>) {
  const r = n.reasons.find((x) => x.level !== "info");
  if (n.status !== "ok" && r) return reasonText(r, t);
  if (n.kind === "service") return n.sub ?? "";
  if (n.kind === "concentrator") return [n.sub, n.facts.find((f) => f.key === "version")?.value].filter(Boolean).join(" · ");
  return n.sub ?? t(`imap.k.${n.kind}`);
}

const DATE_KEYS = new Set(["since", "date"]);
const DATE_FACTS = new Set(["seen", "sync", "alerts", "caExpires"]);
export function reasonText(r: MapReason, t: ReturnType<typeof useT>) {
  const params = Object.fromEntries(Object.entries(r.params ?? {}).map(([k, v]) => [k, DATE_KEYS.has(k) && typeof v === "string" ? fmtDate(v) : v]));
  return tk(t, `imap.r.${r.code}`, params).trim();
}

function Panel({ n, m, onClose }: { n: MapNodeDto | null; m: IntegrationMapDto; onClose: () => void }) {
  const t = useT();
  if (!n)
    return (
      <aside className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500" data-testid="map-panel-empty">
        {t("imap.panel.hint")}
        <ProblemList m={m} />
      </aside>
    );
  const Icon = iconOf(n);
  const conns = m.edges.filter((e) => e.from === n.id || e.to === n.id);
  const nameOf = (id: string) => {
    const x = m.nodes.find((y) => y.id === id);
    return x ? (x.kind === "service" ? tk(t, `imap.svc.${x.id.slice(4)}`) : x.title) : id;
  };
  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm" data-testid="map-panel" aria-live="polite">
      <div className="mb-3 flex items-start gap-2">
        <Icon size={18} className="mt-0.5 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{n.kind === "service" ? tk(t, `imap.svc.${n.id.slice(4)}`) : n.title}</p>
          <p className="text-xs text-slate-500">{t(`imap.k.${n.kind}`)}</p>
        </div>
        <Badge tone={TONE[n.status]}>{t(`imap.st.${n.status}`)}</Badge>
        <button type="button" onClick={onClose} className="rounded px-1 text-slate-400 hover:text-slate-700" aria-label={t("imap.close")}>
          ×
        </button>
      </div>
      <Section title={t("imap.panel.reasons")}>
        {n.reasons.length ? (
          <ul className="space-y-1" data-testid="map-panel-reasons">
            {n.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <svg width="8" height="8" className="mt-1.5 shrink-0" aria-hidden>
                  <circle cx="4" cy="4" r="4" className={r.level === "info" ? "fill-brand-400" : STATUS_CLS[r.level].dot} />
                </svg>
                <span>{reasonText(r, t)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-emerald-700">{t("imap.panel.allOk")}</p>
        )}
      </Section>
      {n.facts.length > 0 && (
        <Section title={t("imap.panel.facts")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {n.facts.map((f) => (
              <FactRow key={f.key} label={tk(t, `imap.f.${f.key}`)}>
                {DATE_FACTS.has(f.key) ? (f.value && f.value !== "—" ? fmtDate(f.value) : t("imap.never")) : f.value || "—"}
              </FactRow>
            ))}
          </dl>
        </Section>
      )}
      {conns.length > 0 && (
        <Section title={t("imap.panel.edges")}>
          <ul className="space-y-0.5 text-xs" data-testid="map-panel-edges">
            {conns.map((e, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <svg width="8" height="8" aria-hidden>
                  <circle cx="4" cy="4" r="4" className={STATUS_CLS[e.status].dot} />
                </svg>
                <span className="truncate">
                  {nameOf(e.from)} → {nameOf(e.to)}
                </span>
                <span className="ml-auto shrink-0 text-slate-500">
                  {e.label}
                  {e.msgs24h != null && ` · ${t("imap.msgs", { n: e.msgs24h })}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {n.links.length > 0 && (
        <Section title={t("imap.panel.links")}>
          <div className="flex flex-wrap gap-2">
            {n.links.map((l) => (
              <Link key={l.key} to={l.link.to as never} params={l.link.params as never} search={l.link.search as never} className="text-sm text-brand-700 hover:underline" data-testid={`map-link-${l.key}`}>
                {tk(t, `imap.l.${l.key}`)} →
              </Link>
            ))}
          </div>
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}
function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{children}</dd>
    </>
  );
}

/** Seznam problémů (bez vybraného uzlu a v Přehledu). */
export function ProblemList({ m, limit = 6 }: { m: IntegrationMapDto; limit?: number }) {
  const t = useT();
  const list = mapProblems(m);
  if (!list.length) return null;
  return (
    <ul className="mt-3 space-y-1.5" data-testid="map-problems">
      {list.slice(0, limit).map((n) => (
        <li key={n.id} className="flex items-start gap-2 text-xs">
          <svg width="8" height="8" className="mt-1 shrink-0" aria-hidden>
            <circle cx="4" cy="4" r="4" className={STATUS_CLS[n.status].dot} />
          </svg>
          <span className="min-w-0">
            <span className="font-medium text-slate-800">{n.kind === "service" ? tk(t, `imap.svc.${n.id.slice(4)}`) : n.title}</span>
            {n.reasons.find((r) => r.level !== "info") && <span className="text-slate-500"> – {reasonText(n.reasons.find((r) => r.level !== "info")!, t)}</span>}
          </span>
        </li>
      ))}
      {list.length > limit && <li className="text-xs text-slate-500">{t("imap.more", { n: list.length - limit })}</li>}
    </ul>
  );
}

function Legend() {
  const t = useT();
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-slate-500">
      {MAP_STATUSES.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <circle cx="5" cy="5" r="4" className={STATUS_CLS[s].dot} />
          </svg>
          {t(`imap.st.${s}`)}
        </span>
      ))}
      <span>{t("imap.legendFlow")}</span>
    </div>
  );
}

export function Coverage({ m, compact }: { m: IntegrationMapDto; compact?: boolean }) {
  const t = useT();
  const c = m.coverage!;
  const items: [string, number, MapStatus][] = [
    ["agent", c.agent, "ok"],
    ["collector", c.collector, "ok"],
    ["wazuh", c.wazuh, "ok"],
    ["none", c.none, c.none ? "warn" : "ok"],
    ...(c.duplicate ? ([["duplicate", c.duplicate, "warn"]] as [string, number, MapStatus][]) : []),
  ];
  return (
    <div className={cn("rounded-xl border border-slate-200 p-3", compact ? "mt-3" : "mx-2 mt-3")} data-testid="map-coverage">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {t("imap.cov.title")} · {c.servers} {t("imap.cov.servers")}
      </p>
      <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${t("imap.cov.none")}: ${c.none} / ${c.servers}`}>
        <div className="bg-emerald-500" style={{ width: `${((c.servers - c.none) / c.servers) * 100}%` }} />
        <div className="bg-amber-500" style={{ width: `${(c.none / c.servers) * 100}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {items.map(([k, v, s]) => (
          <span key={k}>
            <span className={cn("font-semibold", STATUS_CLS[s].text)}>{v}</span> <span className="text-slate-500">{tk(t, `imap.cov.${k}`)}</span>
          </span>
        ))}
      </div>
      {!!c.adServers && (
        <p className="mt-2 text-xs text-slate-600" data-testid="map-coverage-ad">
          {t("imap.cov.ad", { n: c.adServers, noAsset: c.adNoAsset ?? 0 })}{" "}
          <a href="/identity?tab=computers" className="text-brand-700 hover:underline">
            {t("imap.cov.adLink")}
          </a>
        </p>
      )}
      {!compact && c.noneSample.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          {t("imap.cov.noneList")}{" "}
          {c.noneSample.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link to="/assets/$assetId" params={{ assetId: s.id }} className="text-brand-700 hover:underline">
                {s.name}
              </Link>
            </span>
          ))}
          {c.none > c.noneSample.length && ` …`}
        </p>
      )}
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Překlad klíče složeného z dat (kód důvodu, údaje, služby). */
const tk = (t: ReturnType<typeof useT>, key: string, params?: Record<string, string | number>) => t.dyn(key, key, params);

/* ---------- dlaždice v Přehledu (v1.86) ---------- */

const laneWorst = (g: MapGroupDto): MapStatus => (g.counts.error ? "error" : g.counts.warn ? "warn" : g.counts.ok ? "ok" : "off");

/** Stav sběru dat: zmenšená mapa zón kolem CONTIXu, souhrn, problémy a pokrytí serverů. */
export function DataFlowCard({ className }: { className?: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["integrations", "map"], queryFn: api.integrations.map, refetchInterval: 60_000, retry: false });
  const m = q.data;
  if (!m || m.nodes.length <= 1) return null;
  const left = m.groups.filter((g) => g.side === "left");
  const right = m.groups.filter((g) => g.side === "right");
  const rows = Math.max(left.length, right.length, 1);
  const RH = 34;
  const H = rows * (RH + 8) + 8;
  const W2 = 640;
  const lx = (i: number, n: number) => 8 + (H - 8 - n * (RH + 8)) / 2 + i * (RH + 8);
  const name = (g: MapGroupDto) => (g.kind === "zone" ? t("imap.g.zone", { zone: g.title }) : t(`imap.g.${g.kind}`));
  const count = (g: MapGroupDto) => g.counts.ok + g.counts.warn + g.counts.error + g.counts.off;
  const core = m.nodes.find((n) => n.kind === "core")!;
  return (
    <Card className={cn("overflow-hidden", className)} data-testid="dash-dataflow">
      <CardHeader
        title={t("imap.dash.title")}
        subtitle={t("imap.dash.sub")}
        action={
          <Link to="/discovery/map" className="text-sm text-brand-600 hover:underline" data-testid="dash-dataflow-open">
            {t("imap.dash.open")}
          </Link>
        }
      />
      <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <svg viewBox={`0 0 ${W2} ${H}`} className="w-full" role="img" aria-label={t("imap.dash.title")}>
            <style>{`@keyframes ctxflow { to { stroke-dashoffset: -20; } } .ctx-flow { animation: ctxflow 1.2s linear infinite; } @media (prefers-reduced-motion: reduce) { .ctx-flow { animation: none; } }`}</style>
            {[...left.map((g, i) => ({ g, x: 4, y: lx(i, left.length), side: "l" })), ...right.map((g, i) => ({ g, x: 416, y: lx(i, right.length), side: "r" }))].map(({ g, x, y, side }) => {
              const s = laneWorst(g);
              const cy = H / 2;
              const x1 = side === "l" ? x + 220 : 330;
              const x2 = side === "l" ? 270 : x;
              const y1 = side === "l" ? y + RH / 2 : cy;
              const y2 = side === "l" ? cy : y + RH / 2;
              const dx = (x2 - x1) / 2;
              return (
                <g key={g.id}>
                  <path d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} fill="none" className={cn(STATUS_CLS[s].line, s !== "off" && "ctx-flow")} strokeWidth={1.6} strokeDasharray="6 4" />
                  <rect x={x} y={y} width={220} height={RH} rx={9} className={cn("fill-white", STATUS_CLS[s].box)} strokeWidth={1.5} />
                  <circle cx={x + 12} cy={y + RH / 2} r={4} className={STATUS_CLS[s].dot} />
                  <text x={x + 22} y={y + RH / 2 + 4} className="fill-slate-800 text-[12px] font-medium">
                    {clip(name(g), 22)}
                  </text>
                  <text x={x + 212} y={y + RH / 2 + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                    {g.counts.error + g.counts.warn ? `${g.counts.error + g.counts.warn}/${count(g)} !` : count(g)}
                  </text>
                </g>
              );
            })}
            <g transform={`translate(270,${H / 2 - 26})`}>
              <rect width={100} height={52} rx={12} className={cn("fill-brand-600", core.status !== "ok" && STATUS_CLS[core.status].box)} strokeWidth={core.status === "ok" ? 0 : 3} />
              <text x={50} y={32} textAnchor="middle" className="fill-white text-[15px] font-bold">
                CONTIX
              </text>
            </g>
          </svg>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["error", "warn", "ok", "off"] as const).map((s) => (m.totals[s] ? <Badge key={s} tone={TONE[s]}>{`${m.totals[s]} · ${t(`imap.st.${s}`)}`}</Badge> : null))}
          </div>
        </div>
        <div className="min-w-0">
          {mapProblems(m).length ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("imap.dash.problems")}</p>
              <ProblemList m={m} limit={4} />
            </>
          ) : (
            <p className="text-sm text-emerald-700">{t("imap.dash.allOk")}</p>
          )}
          {m.coverage && m.coverage.servers > 0 && <Coverage m={m} compact />}
        </div>
      </div>
    </Card>
  );
}
