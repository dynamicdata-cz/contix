import { Card, CardHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Boxes, Crosshair, Network, Radar, Server, ShieldCheck, Ticket, Waypoints, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

/* ============================================================
 * Mapa propojení (Administrace → Konektory): co komunikuje s čím – CONTIX uprostřed, vlevo zdroje dat
 * (koncentrátory s agenty, sběrače se servery), vpravo integrace (Wazuh, NetBox, JIRA, sondy, síťový sken).
 * Šipky běží ve směru toku dat, barva uzlu = stav posledního spojení. Jen čte stávající přehledy konektorů.
 * ============================================================ */

type Status = "ok" | "warn" | "error" | "off";
interface MapNode {
  id: string;
  x: number;
  y: number;
  w: number;
  title: string;
  sub?: string;
  icon: LucideIcon;
  status: Status;
  hint?: string;
  href?: { to: string; params?: Record<string, string> };
  small?: boolean;
}
interface MapEdge {
  from: string;
  to: string;
  label?: string;
  status: Status;
}

const HOUR = 3_600_000;
const age = (iso: string | null | undefined) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);
const portOf = (url: string, fallback: string) => {
  try {
    return new URL(url).port || fallback;
  } catch {
    return fallback;
  }
};

const STATUS_CLS: Record<Status, { box: string; dot: string; line: string }> = {
  ok: { box: "stroke-emerald-500", dot: "fill-emerald-500", line: "stroke-emerald-500" },
  warn: { box: "stroke-amber-500", dot: "fill-amber-500", line: "stroke-amber-500" },
  error: { box: "stroke-red-500", dot: "fill-red-500", line: "stroke-red-500" },
  off: { box: "stroke-slate-300", dot: "fill-slate-400", line: "stroke-slate-300" },
};

const W = 990;
const COL = { leaf: 4, mid: 270, core: 545, ext: 830 };
const NW = 150;
const NODE_H = 46;
const LEAF_H = 30;
const MAX_LEAVES = 6;

export function IntegrationMap() {
  const t = useT();
  const navigate = useNavigate();
  const conns = useQuery({ queryKey: ["admin", "connections"], queryFn: api.admin.connections });
  const agents = useQuery({ queryKey: ["admin", "agents"], queryFn: api.admin.agents });
  const hosts = useQuery({ queryKey: ["hosts"], queryFn: api.hosts.list });
  const settings = useQuery({ queryKey: ["admin", "connectors"], queryFn: api.admin.connectors });
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const c = conns.data;
    if (!c) return null;
    const nodes: MapNode[] = [];
    const edges: MapEdge[] = [];
    const left: { mid: MapNode; leaves: MapNode[]; more: number }[] = [];
    const right: { node: MapNode; leaves: MapNode[] }[] = [];

    // ---- zdroje dat: koncentrátory a jejich agenti ----
    for (const k of c.concentrators) {
      const seen = k.status?.receivedAt ?? k.lastSeenAt;
      const st: Status = !k.enabled ? "off" : !k.registered ? "warn" : age(seen) > HOUR ? "error" : k.status?.lastError ? "warn" : "ok";
      const mid: MapNode = {
        id: `konc-${k.id}`,
        x: COL.mid,
        y: 0,
        w: NW,
        title: k.name,
        sub: t("imap.zone", { zone: k.zone }),
        icon: Waypoints,
        status: st,
        hint: [k.hostname, k.version && `v${k.version}`, seen ? t("imap.seen", { date: fmtDate(seen) }) : t("imap.never"), k.status?.lastError].filter(Boolean).join(" · "),
      };
      const list = (agents.data?.agents ?? []).filter((a) => a.concentratorId === k.id);
      const leaves = list.slice(0, MAX_LEAVES).map<MapNode>((a) => ({
        id: `agent-${a.id}`,
        x: COL.leaf,
        y: 0,
        w: NW,
        title: a.hostname,
        sub: a.status === "approved" ? (a.assetId ? t("imap.agent.paired") : t("imap.agent.unpaired")) : t(`konc.st.${a.status}`),
        icon: Server,
        small: true,
        status: a.status === "blocked" ? "off" : a.status === "pending" ? "warn" : age(a.lastSeenAt) > HOUR ? "error" : "ok",
        hint: [a.os, a.version && `agent ${a.version}`, a.lastSeenAt ? t("imap.seen", { date: fmtDate(a.lastSeenAt) }) : t("imap.never")].filter(Boolean).join(" · "),
        href: a.inventoryId ? { to: "/discovery/hosts/$hostId", params: { hostId: a.inventoryId } } : undefined,
      }));
      left.push({ mid, leaves, more: list.length - leaves.length });
      for (const l of leaves) edges.push({ from: l.id, to: mid.id, label: l === leaves[0] ? t("imap.e.agent") : undefined, status: l.status });
      edges.push({ from: mid.id, to: "contix", label: t("imap.e.konc"), status: st });
    }

    // ---- zdroje dat: sběrače (skript na každém serveru) ----
    for (const s of c.collectors) {
      const st: Status = !s.enabled ? "off" : !s.lastReportAt ? "warn" : age(s.lastReportAt) > 13 * HOUR ? "error" : "ok";
      const mid: MapNode = {
        id: `col-${s.id}`,
        x: COL.mid,
        y: 0,
        w: NW,
        title: s.name,
        sub: t("imap.collector", { n: s.hosts }),
        icon: Boxes,
        status: st,
        hint: s.lastReportAt ? t("imap.seen", { date: fmtDate(s.lastReportAt) }) : t("imap.never"),
      };
      const list = (hosts.data ?? []).filter((h) => h.connectionName === s.name && !h.collectorVersion.startsWith("agent"));
      const leaves = list.slice(0, MAX_LEAVES).map<MapNode>((h) => ({
        id: `host-${h.id}`,
        x: COL.leaf,
        y: 0,
        w: NW,
        title: h.hostname,
        sub: h.os ?? undefined,
        icon: Server,
        small: true,
        status: age(h.collectedAt) > 13 * HOUR ? "error" : h.high ? "warn" : "ok",
        hint: t("imap.seen", { date: fmtDate(h.collectedAt) }),
        href: { to: "/discovery/hosts/$hostId", params: { hostId: h.id } },
      }));
      left.push({ mid, leaves, more: list.length - leaves.length });
      for (const l of leaves) edges.push({ from: l.id, to: mid.id, label: l === leaves[0] ? t("imap.e.script") : undefined, status: l.status });
      edges.push({ from: mid.id, to: "contix", label: t("imap.e.token"), status: st });
    }

    // ---- integrace vpravo ----
    for (const w of c.wazuh) {
      const st: Status = !w.enabled ? "off" : w.lastSyncStatus === "failed" ? "error" : !w.lastSyncAt ? "warn" : "ok";
      const node: MapNode = {
        id: `wazuh-${w.id}`,
        x: COL.ext,
        y: 0,
        w: NW,
        title: w.name,
        sub: w.agents ? `Wazuh · ${t("imap.wazuhAgents", { n: w.agents })}` : "Wazuh",
        icon: ShieldCheck,
        status: st,
        hint: [w.url, w.lastSyncAt ? t("imap.sync", { date: fmtDate(w.lastSyncAt) }) : t("imap.never")].join(" · "),
      };
      const leaves: MapNode[] = [];
      right.push({ node, leaves });
      edges.push({ from: "contix", to: node.id, label: [`API :${portOf(w.url, "55000")}`, w.indexerUrl && `indexer :${portOf(w.indexerUrl, "9200")}`].filter(Boolean).join(" · "), status: st });
    }
    for (const n of c.netbox) {
      const st: Status = !n.enabled ? "off" : n.lastSyncStatus === "failed" ? "error" : !n.lastSyncAt ? "warn" : "ok";
      right.push({ node: { id: `netbox-${n.id}`, x: COL.ext, y: 0, w: NW, title: n.name, sub: "NetBox", icon: Network, status: st, hint: n.url }, leaves: [] });
      edges.push({ from: "contix", to: `netbox-${n.id}`, label: t("imap.e.netbox"), status: st });
    }
    for (const j of c.jira) {
      const st: Status = j.enabled ? "ok" : "off";
      right.push({ node: { id: `jira-${j.id}`, x: COL.ext, y: 0, w: NW, title: j.name, sub: `JIRA · ${j.projectKey}`, icon: Ticket, status: st, hint: j.url }, leaves: [] });
      edges.push({ from: "contix", to: `jira-${j.id}`, label: t("imap.e.jira"), status: st });
    }
    for (const p of c.probes) {
      const st: Status = !p.enabled ? "off" : !p.lastSeenAt ? "warn" : age(p.lastSeenAt) > HOUR ? "error" : "ok";
      right.push({
        node: { id: `probe-${p.id}`, x: COL.ext, y: 0, w: NW, title: p.name, sub: t("imap.probe"), icon: Crosshair, status: st, hint: [p.hostname, p.lastSeenAt ? t("imap.seen", { date: fmtDate(p.lastSeenAt) }) : t("imap.never")].filter(Boolean).join(" · ") },
        leaves: [],
      });
      edges.push({ from: `probe-${p.id}`, to: "contix", label: t("imap.e.probe"), status: st });
    }
    const scan = settings.data?.networkScan;
    if (scan?.enabled) {
      const st: Status = scan.nmapFound ? "ok" : "error";
      right.push({ node: { id: "scan", x: COL.ext, y: 0, w: NW, title: t("imap.scan"), sub: scan.allowedCidrs.slice(0, 2).join(", ") || "—", icon: Radar, status: st, hint: scan.allowedCidrs.join(", ") }, leaves: [] });
      edges.push({ from: "contix", to: "scan", label: "nmap", status: st });
    }

    // ---- rozložení: skupiny pod sebou, CONTIX uprostřed výšky ----
    const GAP = 18;
    let y = 40;
    for (const g of left) {
      const leafBlock = g.leaves.length * (LEAF_H + 8) + (g.more > 0 ? 22 : 0);
      const h = Math.max(NODE_H, leafBlock);
      g.mid.y = y + (h - NODE_H) / 2;
      g.leaves.forEach((l, i) => (l.y = y + (h - leafBlock) / 2 + i * (LEAF_H + 8)));
      nodes.push(g.mid, ...g.leaves);
      if (g.more > 0) nodes.push({ id: `${g.mid.id}-more`, x: COL.leaf, y: y + (h - leafBlock) / 2 + g.leaves.length * (LEAF_H + 8), w: NW, title: t("imap.more", { n: g.more }), icon: Server, small: true, status: "off" });
      y += h + GAP;
    }
    const leftH = y;
    y = 40;
    for (const g of right) {
      g.node.y = y;
      g.leaves.forEach((l) => (l.y = y + (NODE_H - LEAF_H) / 2));
      nodes.push(g.node, ...g.leaves);
      y += NODE_H + GAP;
    }
    const height = Math.max(leftH, y, 220) + 10;
    nodes.push({ id: "contix", x: COL.core, y: height / 2 - 40, w: 140, title: "CONTIX", sub: t("imap.core"), icon: ShieldCheck, status: "ok" });
    return { nodes, edges: edges.filter((e) => e.from !== e.to), height, empty: left.length + right.length === 0 };
  }, [conns.data, agents.data, hosts.data, settings.data, t]);

  if (!layout) return null;
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const nh = (n: MapNode) => (n.id === "contix" ? 80 : n.small ? LEAF_H : NODE_H);
  const linked = (e: MapEdge) => hover && (e.from === hover || e.to === hover);

  return (
    <Card data-testid="integration-map">
      <CardHeader title={t("imap.title")} subtitle={t("imap.subtitle")} />
      <style>{`@keyframes ctxflow { to { stroke-dashoffset: -20; } } .ctx-flow { animation: ctxflow 1.2s linear infinite; } @media (prefers-reduced-motion: reduce) { .ctx-flow { animation: none; } }`}</style>
      <div className="overflow-x-auto px-3 pb-3">
        {layout.empty && <p className="px-2 pb-2 text-sm text-slate-500">{t("imap.empty")}</p>}
        <svg viewBox={`0 0 ${W} ${layout.height}`} className="min-w-[820px]" role="img" aria-label={t("imap.title")} style={{ width: "100%", height: "auto" }}>
          <text x={COL.leaf} y={22} className="fill-slate-400 text-[11px] font-semibold uppercase tracking-wide">
            {t("imap.col.sources")}
          </text>
          <text x={COL.ext} y={22} className="fill-slate-400 text-[11px] font-semibold uppercase tracking-wide">
            {t("imap.col.integrations")}
          </text>
          {layout.edges.map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const rightward = a.x < b.x;
            const x1 = rightward ? a.x + a.w : a.x;
            const x2 = rightward ? b.x : b.x + b.w;
            const y1 = a.y + nh(a) / 2;
            const y2 = b.y + nh(b) / 2;
            const dx = (x2 - x1) / 2;
            const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
            const dim = hover && !linked(e);
            return (
              <g key={i} opacity={dim ? 0.2 : 1}>
                <path d={d} fill="none" className="stroke-slate-200" strokeWidth={3} />
                <path d={d} fill="none" className={`${STATUS_CLS[e.status].line} ${e.status === "off" ? "" : "ctx-flow"}`} strokeWidth={1.6} strokeDasharray="6 4" />
                {e.label && (
                  // popisek u zdroje (od CONTIXu u cíle) – nad vodorovným začátkem křivky, popisky se nepřekrývají
                  <text
                    x={e.from === "contix" ? (rightward ? x2 - 8 : x2 + 8) : rightward ? x1 + 8 : x1 - 8}
                    y={(e.from === "contix" ? y2 : y1) - 6}
                    textAnchor={(e.from === "contix") === rightward ? "end" : "start"}
                    className="fill-slate-500 text-[11px]"
                    paintOrder="stroke"
                    stroke="var(--color-white)"
                    strokeWidth={4}
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}
          {layout.nodes.map((n) => {
            const h = nh(n);
            const core = n.id === "contix";
            const Icon = n.icon;
            const dim = hover && hover !== n.id && !layout.edges.some((e) => (e.from === hover && e.to === n.id) || (e.to === hover && e.from === n.id));
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={n.href ? () => void navigate(n.href as never) : undefined}
                className={n.href ? "cursor-pointer" : undefined}
                data-testid={`map-node-${n.id}`}
              >
                {n.hint && <title>{`${n.title} – ${n.hint}`}</title>}
                <rect width={n.w} height={h} rx={core ? 14 : 9} className={core ? "fill-brand-600 stroke-brand-700" : `fill-white ${STATUS_CLS[n.status].box}`} strokeWidth={core ? 0 : 1.5} />
                {!core && <circle cx={n.w - 10} cy={10} r={4} className={STATUS_CLS[n.status].dot} />}
                <Icon x={10} y={core ? 22 : n.small ? 7 : 13} width={core ? 26 : 16} height={core ? 26 : 16} className={core ? "text-white" : "text-slate-500"} />
                <text x={core ? 44 : 32} y={core ? 36 : n.small ? 19 : 21} className={core ? "fill-white text-[17px] font-bold" : `fill-slate-900 ${n.small ? "text-[12px]" : "text-[13px] font-semibold"}`}>
                  {clip(n.title, core ? 14 : n.small ? 15 : 16)}
                </text>
                {n.sub && !n.small && (
                  <text x={core ? 44 : 32} y={core ? 54 : 36} className={core ? "fill-white/80 text-[10px]" : "fill-slate-500 text-[11px]"}>
                    {clip(n.sub, core ? 18 : 20)}
                  </text>
                )}
                {n.sub && n.small && n.w >= NW && n.title.length <= 9 && (
                  <text x={n.w - 18} y={19} textAnchor="end" className="fill-slate-400 text-[9px]">
                    {clip(n.sub, 8)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-slate-500">
          {(["ok", "warn", "error", "off"] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden>
                <circle cx="5" cy="5" r="4" className={STATUS_CLS[s].dot} />
              </svg>
              {t(`imap.st.${s}`)}
            </span>
          ))}
          <span>{t("imap.legendFlow")}</span>
        </div>
      </div>
    </Card>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
