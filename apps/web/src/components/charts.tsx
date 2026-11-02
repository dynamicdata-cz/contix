import { useT } from "@/lib/i18n";
import { useState, type ReactNode } from "react";

/**
 * Jednoduché grafy v HTML/CSS (bez knihovny):
 *  - tenké značky, zaoblený konec 4 px u datového konce, 2 px mezera mezi segmenty,
 *  - popisky a hodnoty v textových barvách (ne v barvě série),
 *  - legenda pro ≥ 2 série, tooltip při najetí, tabulkové zobrazení jako alternativa.
 */

export interface Segment {
  key: string;
  label: string;
  color: string;
}

function Tooltip({ lines }: { lines: ReactNode[] }) {
  return (
    <div className="pointer-events-none absolute z-20 -translate-y-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? "mb-1 font-semibold text-slate-900" : "text-slate-700"}>
          {l}
        </div>
      ))}
    </div>
  );
}

export function Legend({ segments }: { segments: Segment[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {segments.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Horizontální skládané pruhy – jeden řádek = jedna položka (aktivum, balíček). */
export function StackedBars<T extends Record<string, unknown>>({
  rows,
  label,
  segments,
  onClick,
  labelWidth = "12rem",
}: {
  rows: T[];
  label: (r: T) => ReactNode;
  segments: Segment[];
  onClick?: (r: T) => void;
  labelWidth?: string;
}) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const total = (r: T) => segments.reduce((s, g) => s + (Number(r[g.key]) || 0), 0);
  const max = Math.max(1, ...rows.map(total));
  return (
    <div className="space-y-1.5" onMouseLeave={() => setHover(null)}>
      {rows.map((r, i) => {
        const tx = total(r);
        const parts = segments.filter((g) => Number(r[g.key]) > 0);
        return (
          <div
            key={i}
            className={`relative grid items-center gap-3 rounded px-1 py-1 text-sm ${onClick ? "cursor-pointer hover:bg-slate-50" : ""}`}
            style={{ gridTemplateColumns: `${labelWidth} 1fr 3rem` }}
            onMouseEnter={() => setHover(i)}
            onClick={() => onClick?.(r)}
          >
            <span className="truncate text-slate-700">{label(r)}</span>
            <div className="flex h-3.5 gap-[2px]" style={{ width: `${(tx / max) * 100}%`, minWidth: tx ? 6 : 0 }}>
              {parts.map((g, j) => (
                <div
                  key={g.key}
                  style={{
                    flexGrow: Number(r[g.key]),
                    background: g.color,
                    borderRadius: j === parts.length - 1 ? "0 4px 4px 0" : 0,
                    minWidth: 3,
                  }}
                />
              ))}
            </div>
            <span className="text-right tabular-nums text-slate-600">{tx}</span>
            {hover === i && (
              <div className="absolute left-1/2 top-0">
                <Tooltip
                  lines={[
                    label(r),
                    ...segments.filter((g) => Number(r[g.key]) > 0).map((g) => `${g.label}: ${r[g.key]}`),
                    `Celkem: ${tx}`,
                  ]}
                />
              </div>
            )}
          </div>
        );
      })}
      {!rows.length && <p className="py-6 text-center text-sm text-slate-500">{t("my.zadnaData")}</p>}
    </div>
  );
}

/** Sloupcový graf pro několik kategorií (jedna série – barva kategorie nese stav/závažnost + popisek). */
export function ColumnChart({
  data,
  height = 180,
  onClick,
}: {
  data: { key: string; label: string; value: number; color: string; icon?: ReactNode }[];
  height?: number;
  onClick?: (key: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="relative flex items-end gap-4 border-b border-slate-200 px-2" style={{ height }}>
        {data.map((d) => (
          <div
            key={d.key}
            className={`relative flex flex-1 flex-col items-center justify-end ${onClick ? "cursor-pointer" : ""}`}
            style={{ height: "100%" }}
            onMouseEnter={() => setHover(d.key)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onClick?.(d.key)}
          >
            <span className="mb-1 text-sm font-semibold tabular-nums text-slate-800">{d.value}</span>
            <div
              className="w-full max-w-16"
              style={{
                height: `${(d.value / max) * (height - 28)}px`,
                minHeight: d.value ? 3 : 0,
                background: d.color,
                borderRadius: "4px 4px 0 0",
                opacity: hover && hover !== d.key ? 0.55 : 1,
              }}
            />
            {hover === d.key && (
              <div className="absolute top-6">
                <Tooltip lines={[d.label, `${d.value}`]} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 px-2">
        {data.map((d) => (
          <div key={d.key} className="flex flex-1 items-start justify-center gap-1 text-center text-xs text-slate-600">
            {d.icon}
            <span>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
