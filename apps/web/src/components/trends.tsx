/**
 * Trendy ukazatelů (v0.47, ADR-042): malé násobky – každý ukazatel vlastní graf (jedna série, jedna osa),
 * poslední hodnota, změna proti předchozímu měsíci se šipkou a slovem (ne jen barvou), tooltip po najetí, tabulka.
 * v1.39 (ADR-136): volba typu grafu, období, měřítka a ukazatelů (pamatuje si prohlížeč), export SVG / PNG / CSV.
 */
import { Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Modal, Select } from "@/components/ui";
import { DropdownMenu } from "@/components/ui/menu";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, formatLocale } from "@/lib/utils";
import {
  CHART_LABELS,
  CHART_MONTHS,
  CHART_SCALES,
  CHART_TYPES,
  ChartPrefs,
  TREND_LABELS,
  TREND_METRICS,
  fmtChartValue,
  isPctMetric,
  seriesOf,
  trendChange,
  trendsCsv,
  trendsSvg,
  type ChartScale,
  type ChartType,
  type TrendDto,
  type TrendMetric,
} from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, BarChart3, Download, LineChart, ListChecks, Minus, Table2 } from "lucide-react";
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

/** Nastavení grafu karty – v prohlížeči (`contix.chart.<id>`), jen pohodlí uživatele. */
export function useChartPrefs(id: string, defaults: { months?: number; metrics: string[] }) {
  const key = `contix.chart.${id}`;
  const read = (): ChartPrefs => {
    try {
      const v = ChartPrefs.safeParse(JSON.parse(localStorage.getItem(key) ?? "{}"));
      if (v.success) return { ...v.data, months: localStorage.getItem(key) ? v.data.months : ((defaults.months as 6 | 12 | 24) ?? 12) };
    } catch {
      /* úložiště nedostupné */
    }
    return { type: "line", months: (defaults.months as 6 | 12 | 24) ?? 12, scale: "value" };
  };
  const [p, setP] = useState<ChartPrefs>(read);
  const set = (patch: Partial<ChartPrefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* úložiště nedostupné */
    }
  };
  const metrics = p.metrics?.length ? p.metrics : defaults.metrics;
  return { prefs: p, metrics, set, reset: () => set({ metrics: undefined }) };
}

const typeIcon: Record<ChartType, typeof LineChart> = { line: LineChart, area: AreaChart, columns: BarChart3, table: Table2 };

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  // prvek musí být v dokumentu, jinak prohlížeč název souboru ignoruje
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function TrendsCard({ id, metrics: defaults, months = 12, title, subtitle, className, state }: { id?: string; metrics: Key[]; months?: number; title?: string; subtitle?: string; className?: string; state?: ReturnType<typeof useChartPrefs> }) {
  const t = useT();
  const cardId = id ?? defaults.join(",").slice(0, 60);
  const own = useChartPrefs(cardId, { months, metrics: defaults });
  const { prefs, metrics, set, reset } = state ?? own;
  const [picker, setPicker] = useState(false);
  const q = useTrends(prefs.months);
  const d = q.data;
  const loc = formatLocale();
  const fwName = (fw: string) => d?.frameworks.find((f) => f.id === fw)?.name ?? fw;
  const label = (k: string) => (k === "compliance" && d ? t("trend.complianceOf", { name: fwName(d.framework) }) : k.startsWith("compliance:") ? t("trend.complianceOf", { name: fwName(k.slice(11)) }) : t.lbl(TREND_LABELS[k as TrendMetric]));
  const shown = (d ? metrics.filter((k) => d.points.some((p) => typeof (p.values as Record<string, unknown>)[k] === "number")) : []) as Key[];
  const fileBase = `contix-${(title ?? t("trend.title")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${new Date().toISOString().slice(0, 10)}`;
  const svg = () => trendsSvg({ points: d!.points, keys: shown, label, type: prefs.type === "table" ? "line" : prefs.type, scale: prefs.scale, month: (p) => monthLabel(p, loc), locale: loc, title: title ?? t("trend.title") });
  const exportPng = () => {
    const s = svg();
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width * 2;
      c.height = img.height * 2;
      const ctx = c.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      c.toBlob((b) => b && download(`${fileBase}.png`, b), "image/png");
    };
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(s)))}`;
  };
  return (
    <Card className={`overflow-hidden ${className ?? ""}`} data-testid={`trends-${cardId}`}>
      <CardHeader title={title ?? t("trend.title")} subtitle={subtitle ?? t("trend.subtitle", { n: prefs.months })} />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 pb-3">
        <div className="flex rounded-md border border-slate-200 p-0.5" role="group" aria-label={t("chart.type")}>
          {CHART_TYPES.map((ty) => {
            const Icon = typeIcon[ty];
            return (
              <button key={ty} type="button" aria-pressed={prefs.type === ty} title={t.lbl(CHART_LABELS.type[ty])} onClick={() => set({ type: ty })} className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs", prefs.type === ty ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100")}>
                <Icon size={14} aria-hidden /> <span className="hidden sm:inline">{t.lbl(CHART_LABELS.type[ty])}</span>
              </button>
            );
          })}
        </div>
        <Select className="h-8 w-auto py-0 text-xs" aria-label={t("chart.periodAria")} value={prefs.months} onChange={(e) => set({ months: Number(e.target.value) as 6 | 12 | 24 })}>
          {CHART_MONTHS.map((m) => (
            <option key={m} value={m}>
              {t("chart.months", { n: m })}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-auto py-0 text-xs" aria-label={t("chart.scale")} value={prefs.scale} onChange={(e) => set({ scale: e.target.value as ChartScale })}>
          {CHART_SCALES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(CHART_LABELS.scale[s])}
            </option>
          ))}
        </Select>
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setPicker(true)}>
          <ListChecks size={14} /> {t("chart.metrics", { n: shown.length })}
        </Button>
        {d && shown.length > 0 && (
          <DropdownMenu
            label={t("chart.export")}
            className="ml-auto"
            buttonClassName="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-slate-600 hover:bg-slate-100"
            button={
              <>
                <Download size={14} /> {t("chart.export")}
              </>
            }
            items={[
              { label: t("chart.exportPng"), onClick: exportPng },
              { label: t("chart.exportSvg"), onClick: () => download(`${fileBase}.svg`, new Blob([svg()], { type: "image/svg+xml" })) },
              { label: t("chart.exportCsv"), onClick: () => download(`${fileBase}.csv`, new Blob([trendsCsv(d.points, shown, label, prefs.scale, t("srv.rep.trendIndicator"))], { type: "text/csv" })) },
            ]}
          />
        )}
      </div>
      <ErrorBox error={q.error} />
      {!d ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState>{t("trend.empty")}</EmptyState>
      ) : prefs.type === "table" ? (
        <TrendTable d={d} keys={shown} label={label} scale={prefs.scale} />
      ) : (
        <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((k) => (
            <TrendTile key={k} d={d} k={k} label={label(k)} type={prefs.type as Exclude<ChartType, "table">} scale={prefs.scale} />
          ))}
        </div>
      )}
      {d && d.points.length < 2 && shown.length > 0 && <p className="px-5 pb-3 pt-2 text-xs text-slate-500">{t("trend.firstMonth")}</p>}
      {picker && <MetricPicker available={[...(d?.frameworks.length ? ["compliance"] : []), ...TREND_METRICS.filter((m) => m !== "compliance")]} value={metrics} label={label} onClose={() => setPicker(false)} onSave={(m) => set({ metrics: m })} onReset={reset} />}
    </Card>
  );
}

function MetricPicker({ available, value, label, onClose, onSave, onReset }: { available: string[]; value: string[]; label: (k: string) => string; onClose: () => void; onSave: (m: string[]) => void; onReset: () => void }) {
  const t = useT();
  const [sel, setSel] = useState<string[]>(value);
  const move = (k: string, d: -1 | 1) => {
    const i = sel.indexOf(k);
    const j = i + d;
    if (i < 0 || j < 0 || j >= sel.length) return;
    const next = [...sel];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSel(next);
  };
  const rest = available.filter((k) => !sel.includes(k));
  return (
    <Modal
      open
      onClose={onClose}
      title={t("chart.pickTitle")}
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onReset();
              onClose();
            }}
          >
            {t("chart.reset")}
          </Button>
          <Button
            disabled={!sel.length}
            onClick={() => {
              onSave(sel);
              onClose();
            }}
          >
            {t("chart.apply")}
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-slate-500">{t("chart.pickHint")}</p>
      <ol className="mb-4 space-y-1">
        {sel.map((k, i) => (
          <li key={k} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-sm">
            <Checkbox checked onChange={() => setSel(sel.filter((x) => x !== k))} label={label(k)} />
            <span className="ml-auto flex gap-1">
              <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30" disabled={i === 0} onClick={() => move(k, -1)} aria-label={t("chart.up")}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30" disabled={i === sel.length - 1} onClick={() => move(k, 1)} aria-label={t("chart.down")}>
                <ArrowDown size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="max-h-56 space-y-0.5 overflow-y-auto border-t border-slate-100 pt-2">
        {rest.map((k) => (
          <Checkbox key={k} checked={false} onChange={() => setSel([...sel, k])} label={label(k)} />
        ))}
      </div>
    </Modal>
  );
}

function fmt(v: number | null | undefined, k: Key) {
  return fmtChartValue(v, k, "value", formatLocale());
}

function TrendTile({ d, k, label, type = "line", scale = "value" }: { d: TrendDto; k: Key; label: string; type?: Exclude<ChartType, "table">; scale?: ChartScale }) {
  const t = useT();
  const ch = trendChange(d.points, k);
  const [hover, setHover] = useState<number | null>(null);
  const pts = seriesOf(d.points, k, scale);
  const vals = pts.map((p) => p.v).filter((v): v is number => v != null);
  const lo = scale === "change" ? Math.min(0, ...vals) : 0;
  const hi = scale === "value" && isPctMetric(k) ? 100 : Math.max(lo + 1, ...vals);
  const W = 240;
  const H = 64;
  const PAD = 6;
  const x = (i: number) => (pts.length < 2 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (pts.length - 1));
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - 2 * PAD);
  const base = y(scale === "change" ? 0 : lo);
  // čára jen přes navazující měsíce s hodnotou (mezera = chybějící snímek)
  const segs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  pts.forEach((p, i) => {
    if (p.v == null) {
      if (cur.length) segs.push(cur);
      cur = [];
      return;
    }
    cur.push({ x: x(i), y: y(p.v) });
  });
  if (cur.length) segs.push(cur);
  const hv = hover != null ? pts[hover] : null;
  const Icon = ch.delta == null || ch.delta === 0 ? Minus : ch.delta > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = ch.better == null ? "text-slate-500" : ch.better ? "text-emerald-700" : "text-red-700";
  const shownVal = scale === "change" ? fmtChartValue(vals.at(-1), k, scale, formatLocale()) : fmt(ch.last, k);
  const band = (W - 2 * PAD) / Math.max(1, pts.length);
  const bw = Math.max(2, band * 0.6);
  return (
    <div className="bg-white p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">{shownVal}</span>
        {scale === "value" && ch.delta != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
            <Icon size={14} aria-hidden />
            {ch.delta > 0 ? "+" : ""}
            {fmt(ch.delta, k)} {ch.better == null ? t("trend.same") : ch.better ? t("trend.better") : t("trend.worse")}
          </span>
        )}
      </div>
      <div className="relative mt-2" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full overflow-visible" role="img" aria-label={`${label}: ${pts.map((p) => `${monthLabel(p.period, formatLocale())} ${fmtChartValue(p.v, k, scale, formatLocale())}`).join(", ")}`}>
          <line x1={PAD} x2={W - PAD} y1={base} y2={base} stroke="var(--color-slate-200)" strokeWidth={1} />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H - PAD} stroke="var(--color-slate-400)" strokeWidth={1} strokeDasharray="2 2" />}
          {type === "columns"
            ? pts.map((p, i) => (p.v == null ? null : <rect key={i} x={PAD + (i + 0.5) * band - bw / 2} y={Math.min(base, y(p.v))} width={bw} height={Math.max(1, Math.abs(base - y(p.v)))} rx={1.5} fill={LINE} opacity={hover == null || hover === i ? 1 : 0.6} />))
            : segs.map((sg, i) => (
                <g key={i}>
                  {type === "area" && sg.length > 1 && <path d={`M${sg[0]!.x},${base}L${sg.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join("L")}L${sg.at(-1)!.x},${base}Z`} fill="var(--chart-area)" />}
                  <path d={sg.map((q, j) => `${j ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join("")} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              ))}
          {type !== "columns" &&
            pts.map((p, i) =>
              p.v == null ? null : <circle key={i} cx={x(i)} cy={y(p.v)} r={i === pts.length - 1 || i === hover ? 4 : 2.5} fill={LINE} stroke="var(--color-white)" strokeWidth={2} vectorEffect="non-scaling-stroke" />,
            )}
          {/* zásahové plochy větší než značky */}
          {pts.map((_, i) => (
            <rect key={`h${i}`} x={x(i) - (W / Math.max(2, pts.length)) / 2} y={0} width={W / Math.max(2, pts.length)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hv && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow" style={{ left: `${(x(hover!) / W) * 100}%` }}>
            <span className="font-semibold text-slate-900">{monthLabel(hv.period, formatLocale(), false)}</span> <span className="tabular-nums text-slate-700">{fmtChartValue(hv.v, k, scale, formatLocale())}</span>
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

function TrendTable({ d, keys, label, scale = "value" }: { d: TrendDto; keys: Key[]; label: (k: Key) => string; scale?: ChartScale }) {
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
              {seriesOf(d.points, k, scale).map((p) => (
                <td key={p.period} className="px-2 py-1.5 text-right tabular-nums">
                  {fmtChartValue(p.v, k, scale, formatLocale())}
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
          {/* bez předchozího měsíce se trend nezobrazuje (v1.36) – žádný šum „— první měsíc“ */}
          {ch.delta != null && (
            <div className={`mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium ${tone}`}>
              <Icon size={14} aria-hidden />
              {`${ch.delta > 0 ? "+" : ""}${fmt(ch.delta, k)} ${ch.better == null ? t("trend.same") : ch.better ? t("trend.better") : t("trend.worse")}`}
            </div>
          )}
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
