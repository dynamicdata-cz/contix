/**
 * Trendy ukazatelů (v0.47, ADR-042): malé násobky – každý ukazatel vlastní čárový graf (jedna série, jedna osa),
 * poslední hodnota, změna proti předchozímu měsíci se šipkou a slovem (ne jen barvou), tooltip po najetí, tabulka.
 */
import { Card, CardHeader, EmptyState, ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatLocale } from "@/lib/utils";
import { TREND_LABELS, trendChange, type TrendDto, type TrendMetric } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Minus, Table2, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

/** Barva čáry (jedna série = jedna barva značky); text je vždy v textových barvách. */
const LINE = "var(--chart-line)";

type Key = TrendMetric | `compliance:${string}`;

const monthLabel = (period: string, locale: string, short = true) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: short ? "short" : "long", year: short ? "2-digit" : "numeric", timeZone: "UTC" });
};

export function useTrends(months = 12, enabled = true) {
  return useQuery({ queryKey: ["trends", months], queryFn: () => api.trends.get(months), enabled, staleTime: 5 * 60_000 });
}

export function TrendsCard({ metrics, months = 12, title, subtitle, className }: { metrics: Key[]; months?: number; title?: string; subtitle?: string; className?: string }) {
  const t = useT();
  const q = useTrends(months);
  const [table, setTable] = useState(false);
  const d = q.data;
  const fwName = (id: string) => d?.frameworks.find((f) => f.id === id)?.name ?? id;
  const label = (k: Key) => (k === "compliance" && d ? t("trend.complianceOf", { name: fwName(d.framework) }) : k.startsWith("compliance:") ? t("trend.complianceOf", { name: fwName(k.slice(11)) }) : t.lbl(TREND_LABELS[k as TrendMetric]));
  const shown = d ? metrics.filter((k) => d.points.some((p) => typeof p.values[k] === "number")) : [];
  return (
    <Card className={`overflow-hidden ${className ?? ""}`}>
      <CardHeader
        title={title ?? t("trend.title")}
        subtitle={subtitle ?? t("trend.subtitle", { n: months })}
        action={
          d &&
          shown.length > 0 && (
            <button type="button" onClick={() => setTable(!table)} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-brand-700" aria-pressed={table}>
              {table ? <TrendingUp size={14} /> : <Table2 size={14} />} {table ? t("trend.charts") : t("trend.table")}
            </button>
          )
        }
      />
      <ErrorBox error={q.error} />
      {!d ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState>{t("trend.empty")}</EmptyState>
      ) : table ? (
        <TrendTable d={d} keys={shown} label={label} />
      ) : (
        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((k) => (
            <TrendTile key={k} d={d} k={k} label={label(k)} />
          ))}
        </div>
      )}
      {d && d.points.length < 2 && shown.length > 0 && <p className="px-5 pb-3 pt-2 text-xs text-slate-500">{t("trend.firstMonth")}</p>}
    </Card>
  );
}

function fmt(v: number | null | undefined, k: Key) {
  if (v == null) return "–";
  const pct = k.startsWith("compliance") || k === "controls_tested_pct";
  return `${v.toLocaleString(formatLocale(), { maximumFractionDigits: 1 })}${pct ? " %" : ""}`;
}

function TrendTile({ d, k, label }: { d: TrendDto; k: Key; label: string }) {
  const t = useT();
  const ch = trendChange(d.points, k);
  const [hover, setHover] = useState<number | null>(null);
  const pts = d.points.map((p) => ({ period: p.period, v: typeof p.values[k] === "number" ? (p.values[k] as number) : null }));
  const vals = pts.map((p) => p.v).filter((v): v is number => v != null);
  const pct = k.startsWith("compliance") || k === "controls_tested_pct";
  const max = pct ? 100 : Math.max(1, ...vals);
  const W = 240;
  const H = 64;
  const PAD = 6;
  const x = (i: number) => (pts.length < 2 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (pts.length - 1));
  const y = (v: number) => H - PAD - (v / max) * (H - 2 * PAD);
  // čára jen přes navazující měsíce s hodnotou (mezera = chybějící snímek)
  const segs: string[] = [];
  let cur = "";
  pts.forEach((p, i) => {
    if (p.v == null) {
      if (cur) segs.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const hv = hover != null ? pts[hover] : null;
  const Icon = ch.delta == null || ch.delta === 0 ? Minus : ch.delta > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = ch.better == null ? "text-slate-500" : ch.better ? "text-emerald-700" : "text-red-700";
  return (
    <div className="bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">{fmt(ch.last, k)}</span>
        {ch.delta != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
            <Icon size={14} aria-hidden />
            {ch.delta > 0 ? "+" : ""}
            {fmt(ch.delta, k)} {ch.better == null ? t("trend.same") : ch.better ? t("trend.better") : t("trend.worse")}
          </span>
        )}
      </div>
      <div className="relative mt-2" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full overflow-visible" role="img" aria-label={`${label}: ${pts.map((p) => `${monthLabel(p.period, formatLocale())} ${fmt(p.v, k)}`).join(", ")}`}>
          <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--color-slate-200)" strokeWidth={1} />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H - PAD} stroke="var(--color-slate-400)" strokeWidth={1} strokeDasharray="2 2" />}
          {segs.map((s, i) => (
            <path key={i} d={s} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
          {pts.map((p, i) =>
            p.v == null ? null : (
              <circle key={i} cx={x(i)} cy={y(p.v)} r={i === pts.length - 1 || i === hover ? 4 : 2.5} fill={LINE} stroke="var(--color-white)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ),
          )}
          {/* zásahové plochy větší než značky */}
          {pts.map((_, i) => (
            <rect key={i} x={x(i) - (W / Math.max(2, pts.length)) / 2} y={0} width={W / Math.max(2, pts.length)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hv && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow" style={{ left: `${(x(hover!) / W) * 100}%` }}>
            <span className="font-semibold text-slate-900">{monthLabel(hv.period, formatLocale(), false)}</span> <span className="tabular-nums text-slate-700">{fmt(hv.v, k)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>{pts[0] && monthLabel(pts[0].period, formatLocale())}</span>
          <span>{pts.at(-1) && monthLabel(pts.at(-1)!.period, formatLocale())}</span>
        </div>
      </div>
    </div>
  );
}

function TrendTable({ d, keys, label }: { d: TrendDto; keys: Key[]; label: (k: Key) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-4 py-2" />
            {d.points.map((p) => (
              <th key={p.period} className="px-2 py-2 text-right font-medium">
                {monthLabel(p.period, formatLocale())}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {keys.map((k) => (
            <tr key={k}>
              <td className="px-4 py-1.5 text-slate-700">{label(k)}</td>
              {d.points.map((p) => (
                <td key={p.period} className="px-2 py-1.5 text-right tabular-nums">
                  {fmt(p.values[k] as number | null | undefined, k)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Ukazatele na přehledu (v1.08, ADR-104): číslo, změna proti minulému měsíci (šipka + slovo), drobný průběh ---------- */
const KPI: { k: Key; to: string }[] = [
  { k: "compliance", to: "/controls/soa" },
  { k: "risks_unacceptable", to: "/risks" },
  { k: "vulns_p1", to: "/vulnerabilities" },
  { k: "obligations_overdue", to: "/my" },
];

export function KpiStrip({ className }: { className?: string }) {
  const t = useT();
  const q = useTrends(12);
  const d = q.data;
  if (!d) return null;
  const shown = KPI.filter(({ k }) => d.points.some((p) => typeof p.values[k] === "number"));
  if (!shown.length) return null;
  const fwName = d.frameworks.find((f) => f.id === d.framework)?.name ?? d.framework;
  return (
    <div className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${className ?? ""}`} data-testid="kpi-strip">
      {shown.map(({ k, to }) => (
        <KpiTile key={k} d={d} k={k} to={to} label={k === "compliance" ? t("trend.complianceOf", { name: fwName }) : t.lbl(TREND_LABELS[k as TrendMetric])} />
      ))}
    </div>
  );
}

function KpiTile({ d, k, label, to }: { d: TrendDto; k: Key; label: string; to: string }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const ch = trendChange(d.points, k);
  const pts = d.points.map((p) => ({ period: p.period, v: typeof p.values[k] === "number" ? (p.values[k] as number) : null }));
  const vals = pts.map((p) => p.v).filter((v): v is number => v != null);
  const pct = k.startsWith("compliance");
  const lo = pct ? 0 : 0;
  const hi = pct ? 100 : Math.max(1, ...vals);
  const W = 160;
  const H = 40;
  const x = (i: number) => (pts.length < 2 ? W : (i * W) / (pts.length - 1));
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const idx = pts.map((p, i) => (p.v == null ? -1 : i)).filter((i) => i >= 0);
  const line = idx.map((i, n) => `${n ? "L" : "M"}${x(i).toFixed(1)},${y(pts[i]!.v!).toFixed(1)}`).join("");
  const area = idx.length > 1 ? `${line}L${x(idx.at(-1)!).toFixed(1)},${H}L${x(idx[0]!).toFixed(1)},${H}Z` : "";
  const Icon = ch.delta == null || ch.delta === 0 ? Minus : ch.delta > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = ch.better == null ? "text-slate-500" : ch.better ? "text-emerald-700" : "text-red-700";
  const hv = hover != null ? pts[hover] : null;
  return (
    <Link to={to as never} className="group block rounded-xl border border-slate-200/80 bg-white p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
      <div className="text-[13px] font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div>
          <div className="text-[28px] font-semibold leading-none tabular-nums text-slate-900">{fmt(ch.last, k)}</div>
          <div className={`mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
            <Icon size={14} aria-hidden />
            {ch.delta == null ? t("kpi.noPrev") : `${ch.delta > 0 ? "+" : ""}${fmt(ch.delta, k)} ${ch.better == null ? t("trend.same") : ch.better ? t("trend.better") : t("trend.worse")}`}
          </div>
        </div>
        {idx.length > 1 && (
          <div className="relative w-28 shrink-0" onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-10 w-full overflow-visible" role="img" aria-label={`${label}: ${pts.map((p) => `${monthLabel(p.period, formatLocale())} ${fmt(p.v, k)}`).join(", ")}`}>
              <path d={area} fill="var(--chart-area)" />
              <path d={line} fill="none" stroke="var(--chart-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              {hover != null && pts[hover]?.v != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--color-slate-400)" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
              {(() => {
                const i = hover ?? idx.at(-1)!;
                const v = pts[i]?.v;
                return v == null ? null : <circle cx={x(i)} cy={y(v)} r={4} fill="var(--chart-line)" stroke="var(--color-white)" strokeWidth={2} vectorEffect="non-scaling-stroke" />;
              })()}
              {pts.map((_, i) => (
                <rect key={i} x={x(i) - W / Math.max(2, pts.length) / 2} y={0} width={W / Math.max(2, pts.length)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
              ))}
            </svg>
            {hv && (
              <div className="pointer-events-none absolute -top-1 right-0 z-10 -translate-y-full whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow">
                <span className="font-semibold text-slate-900">{monthLabel(hv.period, formatLocale(), false)}</span> <span className="tabular-nums text-slate-700">{fmt(hv.v, k)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
