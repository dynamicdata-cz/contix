import { z } from "zod";
import type { TrendPoint } from "./trends";

/* ============================================================
 * Volitelný formát grafů (v1.39, ADR-136): typ (čára / plocha / sloupce / tabulka), období, měřítko (hodnoty / změna
 * proti prvnímu měsíci), výběr a pořadí ukazatelů; export SVG / PNG / CSV; grafy ve zprávě pro vedení (tisk i Word).
 * Geometrie je společná pro web (export) i server (tisk) – `trendsSvg`.
 * ============================================================ */

export const CHART_TYPES = ["line", "area", "columns", "table"] as const;
export type ChartType = (typeof CHART_TYPES)[number];
export const CHART_MONTHS = [6, 12, 24] as const;
export type ChartMonths = (typeof CHART_MONTHS)[number];
export const CHART_SCALES = ["value", "change"] as const;
export type ChartScale = (typeof CHART_SCALES)[number];

export const CHART_LABELS = {
  type: { line: "Čára", area: "Plocha", columns: "Sloupce", table: "Tabulka" } satisfies Record<ChartType, string>,
  scale: { value: "Hodnoty", change: "Změna od začátku (%)" } satisfies Record<ChartScale, string>,
};

/** Nastavení grafu (uložené u uživatele v prohlížeči, nebo předané do zprávy). */
export const ChartPrefs = z.object({
  type: z.enum(CHART_TYPES).default("line"),
  months: z.union([z.literal(6), z.literal(12), z.literal(24)]).default(12),
  scale: z.enum(CHART_SCALES).default("value"),
  /** Vybrané ukazatele v pořadí; prázdné / chybí = výchozí sada karty. */
  metrics: z.array(z.string().max(80)).max(30).optional(),
});
export type ChartPrefs = z.output<typeof ChartPrefs>;

/** Parametry grafů ve zprávě pro vedení (query `charts`, `chart`, `months`). */
export const ReportChartsQuery = z.object({
  charts: z
    .string()
    .max(1000)
    .optional()
    .transform((v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12) : null)),
  chart: z.enum(CHART_TYPES).default("line"),
  months: z.coerce.number().int().refine((n) => n === 6 || n === 12 || n === 24, "Období 6, 12 nebo 24 měsíců").default(6),
});

export const isPctMetric = (k: string) => k.startsWith("compliance") || k === "controls_tested_pct" || k === "threat_coverage_pct" || k === "findings_ontime_pct";

/**
 * Řada hodnot ukazatele. Měřítko „change“ = změna v % proti prvnímu měsíci s hodnotou (u procentních ukazatelů
 * rozdíl v procentních bodech); u nulového začátku nelze spočítat → null.
 */
export function seriesOf(points: TrendPoint[], key: string, scale: ChartScale = "value"): { period: string; v: number | null }[] {
  const val = (p: TrendPoint) => (p.values as Record<string, number | null | undefined>)[key];
  const raw = points.map((p) => ({ period: p.period, v: typeof val(p) === "number" ? (val(p) as number) : null }));
  if (scale === "value") return raw;
  const base = raw.find((x) => x.v != null)?.v ?? null;
  return raw.map((x) => {
    if (x.v == null || base == null) return { ...x, v: null };
    if (isPctMetric(key)) return { ...x, v: Math.round((x.v - base) * 10) / 10 };
    if (base === 0) return { ...x, v: null };
    return { ...x, v: Math.round(((x.v - base) / Math.abs(base)) * 1000) / 10 };
  });
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Jednotka hodnoty: v měřítku změny procentní body u procentních ukazatelů, jinak %. */
export function chartUnit(key: string, scale: ChartScale): string {
  if (scale === "change") return isPctMetric(key) ? " p. b." : " %";
  return isPctMetric(key) ? " %" : "";
}
export function fmtChartValue(v: number | null | undefined, key: string, scale: ChartScale, locale = "cs-CZ"): string {
  if (v == null) return "–";
  return `${scale === "change" && v > 0 ? "+" : ""}${v.toLocaleString(locale, { maximumFractionDigits: 1 })}${chartUnit(key, scale)}`;
}

export interface TrendsSvgInput {
  points: TrendPoint[];
  keys: string[];
  label: (k: string) => string;
  type: Exclude<ChartType, "table">;
  scale?: ChartScale;
  /** Popisek měsíce (YYYY-MM → text). */
  month: (period: string) => string;
  locale?: string;
  title?: string;
  /** Barva série (výchozí modrá řada palety). */
  color?: string;
  columns?: number;
}

/** Malé násobky jako samostatné SVG (export i tisk): název, poslední hodnota, osa, první a poslední měsíc. */
export function trendsSvg(o: TrendsSvgInput): string {
  const cols = Math.max(1, Math.min(o.columns ?? 3, o.keys.length));
  const W = 300;
  const H = 150;
  const GAP = 16;
  const top = o.title ? 36 : 0;
  const rows = Math.ceil(o.keys.length / cols);
  const totalW = cols * W + (cols - 1) * GAP;
  const totalH = top + rows * H + (rows - 1) * GAP;
  const color = o.color ?? "#2a78d6";
  const locale = o.locale ?? "cs-CZ";
  const scale = o.scale ?? "value";
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" font-family="Inter, Arial, sans-serif">`;
  out += `<rect width="${totalW}" height="${totalH}" fill="#ffffff"/>`;
  if (o.title) out += `<text x="0" y="22" font-size="16" font-weight="600" fill="#151a24">${esc(o.title)}</text>`;
  o.keys.forEach((k, i) => {
    const ox = (i % cols) * (W + GAP);
    const oy = top + Math.floor(i / cols) * (H + GAP);
    const s = seriesOf(o.points, k, scale);
    const vals = s.map((x) => x.v).filter((v): v is number => v != null);
    const last = vals.at(-1);
    const lo = scale === "change" ? Math.min(0, ...vals) : 0;
    const hi = scale === "value" && isPctMetric(k) ? 100 : Math.max(lo + 1, ...vals);
    const px = 12;
    const cx0 = ox + px;
    const cx1 = ox + W - px;
    const cy0 = oy + 58;
    const cy1 = oy + H - 26;
    const x = (j: number) => (s.length < 2 ? (cx0 + cx1) / 2 : cx0 + (j * (cx1 - cx0)) / (s.length - 1));
    const y = (v: number) => cy1 - ((v - lo) / (hi - lo || 1)) * (cy1 - cy0);
    out += `<rect x="${ox}" y="${oy}" width="${W}" height="${H}" rx="8" fill="#ffffff" stroke="#e1e6ee"/>`;
    out += `<text x="${ox + px}" y="${oy + 22}" font-size="12" fill="#4d5669">${esc(o.label(k))}</text>`;
    out += `<text x="${ox + px}" y="${oy + 46}" font-size="20" font-weight="600" fill="#151a24">${esc(fmtChartValue(last, k, scale, locale))}</text>`;
    out += `<line x1="${cx0}" x2="${cx1}" y1="${y(scale === "change" ? 0 : lo)}" y2="${y(scale === "change" ? 0 : lo)}" stroke="#cbd2de" stroke-width="1"/>`;
    if (o.type === "columns") {
      const band = (cx1 - cx0) / Math.max(1, s.length);
      const bw = Math.max(2, band * 0.6);
      s.forEach((p, j) => {
        if (p.v == null) return;
        const base = y(scale === "change" ? 0 : lo);
        const yy = y(p.v);
        out += `<rect x="${(cx0 + (j + 0.5) * band - bw / 2).toFixed(1)}" y="${Math.min(base, yy).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(base - yy)).toFixed(1)}" rx="1.5" fill="${color}"/>`;
      });
    } else {
      const segs: string[][] = [];
      let cur: string[] = [];
      s.forEach((p, j) => {
        if (p.v == null) {
          if (cur.length) segs.push(cur);
          cur = [];
          return;
        }
        cur.push(`${x(j).toFixed(1)},${y(p.v).toFixed(1)}`);
      });
      if (cur.length) segs.push(cur);
      for (const seg of segs) {
        if (o.type === "area" && seg.length > 1) {
          const base = y(scale === "change" ? 0 : lo).toFixed(1);
          const first = seg[0]!.split(",")[0];
          const lastX = seg.at(-1)!.split(",")[0];
          out += `<path d="M${first},${base}L${seg.join("L")}L${lastX},${base}Z" fill="${color}" fill-opacity="0.15"/>`;
        }
        out += `<polyline points="${seg.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
        const lp = seg.at(-1)!.split(",");
        out += `<circle cx="${lp[0]}" cy="${lp[1]}" r="3.5" fill="${color}"/>`;
      }
    }
    if (s.length) {
      out += `<text x="${cx0}" y="${oy + H - 8}" font-size="10" fill="#677186">${esc(o.month(s[0]!.period))}</text>`;
      out += `<text x="${cx1}" y="${oy + H - 8}" font-size="10" fill="#677186" text-anchor="end">${esc(o.month(s.at(-1)!.period))}</text>`;
    }
  });
  return `${out}</svg>`;
}

/** CSV (středník, UTF-8 s BOM – Excel v češtině): ukazatel × měsíce. */
export function trendsCsv(points: TrendPoint[], keys: string[], label: (k: string) => string, scale: ChartScale = "value", headLabel = "Ukazatel"): string {
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = [q(headLabel), ...points.map((p) => p.period)].join(";");
  const rows = keys.map((k) => [q(label(k)), ...seriesOf(points, k, scale).map((x) => (x.v == null ? "" : String(x.v).replace(".", ",")))].join(";"));
  return `﻿${[head, ...rows].join("\r\n")}\r\n`;
}
