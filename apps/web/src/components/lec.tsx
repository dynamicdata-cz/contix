import { useT } from "@/lib/i18n";
import { Legend } from "@/components/charts";
import { fmtCzk, type QuantStats } from "@contix/shared";
import { useMemo, useState } from "react";

/** Kategorické sloty 1 a 2 ověřené palety (modrá = bez opatření, oranžová = po opatřeních). */
export const LEC_COLORS = { inherent: "#2a78d6", residual: "#eb6834" };

/**
 * Křivka překročení ztrát (loss exceedance curve): pravděpodobnost, že roční ztráta překročí částku.
 * Logaritmická osa X (Kč), osa Y 0–100 %. Volitelná svislá čára ochoty nést riziko.
 */
export function LossExceedanceChart({ inherent, residual, appetite, height = 220 }: { inherent: QuantStats; residual?: QuantStats | null; appetite?: number | null; height?: number }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const H = height;
  const m = { l: 44, r: 12, t: 10, b: 30 };
  const pts = [...inherent.lec, ...(residual?.lec ?? [])].filter((p) => p.x > 0);
  const xMin = Math.max(1, Math.min(...pts.map((p) => p.x)));
  const xMax = Math.max(xMin * 10, ...pts.map((p) => p.x), appetite ?? 0);
  const lx = (x: number) => m.l + ((Math.log10(Math.max(x, xMin)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * (W - m.l - m.r);
  const ly = (p: number) => m.t + (1 - p) * (H - m.t - m.b);
  const path = (s: QuantStats) =>
    s.lec
      .filter((p) => p.x > 0)
      .map((p, i) => `${i ? "L" : "M"}${lx(p.x).toFixed(1)},${ly(p.p).toFixed(1)}`)
      .join("");
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let e = Math.ceil(Math.log10(xMin)); e <= Math.floor(Math.log10(xMax)); e++) out.push(10 ** e);
    return out;
  }, [xMin, xMax]);
  const at = (s: QuantStats | null | undefined, x: number) => {
    if (!s?.lec.length) return null;
    const q = s.lec.find((p) => p.x >= x) ?? s.lec.at(-1)!;
    return q.p;
  };
  const series = [
    { key: "inherent", label: t("rsk.bezOpatreni"), color: LEC_COLORS.inherent },
    ...(residual ? [{ key: "residual", label: t("rsk.poOpatrenich"), color: LEC_COLORS.residual }] : []),
  ];
  const hx = hover != null ? xMin * Math.pow(xMax / xMin, (hover - m.l) / (W - m.l - m.r)) : null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        {series.length > 1 ? <Legend segments={series} /> : <span className="text-xs text-slate-500">{t("rsk.pravdepodobnostZeRocniZtrataPrekroci")}</span>}
        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setTable(!table)}>
          {table ? "Graf" : "Tabulka"}
        </button>
      </div>
      {table ? (
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">{t("rsk.rocniZtrataVyssiNez")}</th>
              <th className="py-1 text-right">{t("rsk.bezOpatreni")}</th>
              {residual && <th className="py-1 text-right">{t("rsk.poOpatrenich")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[0.5, 0.2, 0.1, 0.05, 0.01].map((p) => {
              const x = inherent.lec.find((q) => q.p <= p)?.x ?? null;
              return (
                <tr key={p}>
                  <td className="py-1 tabular-nums">{x ? fmtCzk(x) : "—"}</td>
                  <td className="py-1 text-right tabular-nums">{x ? `${Math.round((at(inherent, x) ?? 0) * 100)} %` : "—"}</td>
                  {residual && <td className="py-1 text-right tabular-nums">{x ? `${Math.round((at(residual, x) ?? 0) * 100)} %` : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={t("rsk.krivkaPrekroceniZtrat")}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width) * W;
              setHover(x >= m.l && x <= W - m.r ? x : null);
            }}
            onMouseLeave={() => setHover(null)}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <g key={p}>
                <line x1={m.l} x2={W - m.r} y1={ly(p)} y2={ly(p)} stroke="#e2e8f0" strokeWidth={1} />
                <text x={m.l - 6} y={ly(p) + 3} textAnchor="end" fontSize={10} fill="#64748b">
                  {Math.round(p * 100)} %
                </text>
              </g>
            ))}
            {ticks.map((tx) => (
              <text key={tx} x={lx(tx)} y={H - 10} textAnchor="middle" fontSize={10} fill="#64748b">
                {fmtCzk(tx)}
              </text>
            ))}
            {appetite != null && appetite > 0 && (
              <g>
                <line x1={lx(appetite)} x2={lx(appetite)} y1={m.t} y2={H - m.b} stroke="#475569" strokeWidth={1.5} strokeDasharray="4 3" />
                <text x={lx(appetite) + 4} y={m.t + 10} fontSize={10} fill="#334155">
                  {t("rsk.ochotaNestRiziko")}
                </text>
              </g>
            )}
            {residual && <path d={path(residual)} fill="none" stroke={LEC_COLORS.residual} strokeWidth={2} strokeLinejoin="round" />}
            <path d={path(inherent)} fill="none" stroke={LEC_COLORS.inherent} strokeWidth={2} strokeLinejoin="round" />
            {hover != null && <line x1={hover} x2={hover} y1={m.t} y2={H - m.b} stroke="#94a3b8" strokeWidth={1} />}
          </svg>
          {hover != null && hx != null && (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `${Math.min(70, (hover / W) * 100)}%` }}
            >
              <div className="mb-1 font-semibold text-slate-900">{t("rsk.ztrataVyssiNez", { p: fmtCzk(hx) })}</div>
              <div className="text-slate-700">{t("rsk.bezOpatreni2", { p: Math.round((at(inherent, hx) ?? 0) * 100) })}</div>
              {residual && <div className="text-slate-700">{t("rsk.poOpatrenich2", { p: Math.round((at(residual, hx) ?? 0) * 100) })}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
