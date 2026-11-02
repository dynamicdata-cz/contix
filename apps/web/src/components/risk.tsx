import { useT, lbl } from "@/lib/i18n";
import { SEVERITY_COLOR } from "@/components/health";
import { Select } from "@/components/ui";
import { cn } from "@/lib/utils";
import { matrixCellLevel, methodologyMatrix, RISK_LABELS, RISK_LEVELS, scaleFor, type RiskLevel, type RiskMethodologyDef, type ScaleLevels, type ScaleStep } from "@contix/shared";
import { Fragment } from "react";

/** Úroveň rizika používá stejnou ověřenou ordinální rampu jako závažnost CVE (nízké → kritické). */
export const RISK_COLOR: Record<RiskLevel | "unassessed", string> = {
  low: SEVERITY_COLOR.low,
  medium: SEVERITY_COLOR.medium,
  high: SEVERITY_COLOR.high,
  critical: SEVERITY_COLOR.critical,
  unassessed: SEVERITY_COLOR.unknown,
};

export function RiskLevelBadge({ level, score }: { level: RiskLevel | "unassessed" | null | string; score?: number | null }) {
  const l = (level ?? "unassessed") as RiskLevel | "unassessed";
  const label = l === "unassessed" ? "Nehodnoceno" : lbl(RISK_LABELS.level[l]);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-700" title={l !== "unassessed" ? lbl(RISK_LABELS.levelDesc[l]) : undefined}>
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: RISK_COLOR[l] }} aria-hidden />
      {label}
      {score != null && <span className="tabular-nums text-slate-500">({score})</span>}
    </span>
  );
}

/** Výběr stupně stupnice (3/4/5 úrovní) s popisem a vazbou na úrovně vyhlášky. */
export function ScaleSelect({
  value,
  onChange,
  steps,
  disabled,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  steps: ScaleStep[];
  disabled?: boolean;
}) {
  const t = useT();
  const cur = steps.find((s) => s.value === value);
  return (
    <div className="space-y-1">
      <Select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">—</option>
        {steps.map((s) => (
          <option key={s.value} value={s.value}>
            {s.value} – {t.lbl(s.name)}
          </option>
        ))}
        {value != null && !cur && <option value={value}>{t("rsk.mimoStupnici", { value: value })}</option>}
      </Select>
      {cur && <p className="text-xs leading-snug text-slate-500">{locScale([cur])[0]!.description}</p>}
    </div>
  );
}

/** Teplotní mapa N×N: řádky = dopad (nejvyšší nahoře), sloupce = pravděpodobnost. Počet je vždy vypsaný číslem. */
export function RiskHeatmap({ matrix, levels, onCell }: { matrix: number[][]; levels: number; onCell?: (impact: number, likelihood: number) => void }) {
  const t = useT();
  const lv = levels as ScaleLevels;
  const impact = locScale(scaleFor("impact", lv));
  const like = locScale(scaleFor("likelihood", lv));
  const idx = Array.from({ length: levels }, (_, i) => i + 1);
  return (
    <div className="flex gap-3">
      <div className="flex w-5 items-center justify-center">
        <span className="-rotate-90 whitespace-nowrap text-xs font-medium text-slate-500">{t("rsk.dopad")}</span>
      </div>
      <div className="flex-1">
        <div className="grid gap-1" style={{ gridTemplateColumns: `auto repeat(${levels}, minmax(0, 1fr))` }}>
          {[...idx].reverse().map((imp) => (
            <Fragment key={imp}>
              <div className="flex items-center pr-1 text-[11px] text-slate-500">
                {imp} {impact[imp - 1]?.name}
              </div>
              {idx.map((l) => {
                const n = matrix[imp - 1]?.[l - 1] ?? 0;
                const lvl = matrixCellLevel(levels, imp, l);
                return (
                  <button
                    type="button"
                    key={l}
                    disabled={!onCell || !n}
                    onClick={() => onCell?.(imp, l)}
                    className={cn("relative h-12 rounded-md border text-lg font-semibold tabular-nums", n ? "text-slate-900" : "text-slate-300")}
                    style={{ background: `${RISK_COLOR[lvl]}${n ? "40" : "14"}`, borderColor: `${RISK_COLOR[lvl]}66` }}
                    title={t("rsk.dopadPravdepodobnostRizik", { imp: imp, l: l, n: n, p: t.lbl(RISK_LABELS.level[lvl]) })}
                  >
                    {n || "·"}
                  </button>
                );
              })}
            </Fragment>
          ))}
          <div />
          {idx.map((l) => (
            <div key={l} className="pt-1 text-center text-[11px] text-slate-500">
              {l} {like[l - 1]?.name}
            </div>
          ))}
        </div>
        <div className="mt-1 text-center text-xs font-medium text-slate-500">{t("rsk.pravdepodobnost")}</div>
      </div>
    </div>
  );
}

/** Teplotní mapa maticové metodiky (5 × 5, importovaná s osami) – osy a barvy buněk z definice metodiky (ADR-083). */
export function MethodologyHeatmap({ def, counts }: { def: RiskMethodologyDef; counts: number[][] }) {
  const t = useT();
  const mm = methodologyMatrix(def);
  if (!mm) return null;
  const xs = mm.x.scale.map((s, i) => ({ ...s, i }));
  const ys = mm.y.scale.map((s, i) => ({ ...s, i })).reverse();
  return (
    <div className="flex gap-3" data-testid="methodology-heatmap">
      <div className="flex w-5 items-center justify-center">
        <span className="-rotate-90 whitespace-nowrap text-xs font-medium text-slate-500">{mm.y.label}</span>
      </div>
      <div className="flex-1">
        <div className="grid gap-1" style={{ gridTemplateColumns: `auto repeat(${xs.length}, minmax(0, 1fr))` }}>
          {ys.map((y) => (
            <Fragment key={y.value}>
              <div className="flex items-center pr-1 text-[11px] text-slate-500">
                {y.value} {y.label}
              </div>
              {xs.map((x) => {
                const n = counts[y.i]?.[x.i] ?? 0;
                const lvl = mm.levelAt(x.value, y.value);
                const color = lvl ? RISK_COLOR[lvl] : "#94a3b8";
                return (
                  <div
                    key={x.value}
                    className={cn("grid h-11 place-items-center rounded-md border text-base font-semibold tabular-nums", n ? "text-slate-900" : "text-slate-300")}
                    style={{ background: `${color}${n ? "40" : "14"}`, borderColor: `${color}66` }}
                    title={t("rsk.matrixCell", { y: `${y.value} ${y.label}`, x: `${x.value} ${x.label}`, n, p: lvl ? t.lbl(RISK_LABELS.level[lvl]) : "—" })}
                  >
                    {n || "·"}
                  </div>
                );
              })}
            </Fragment>
          ))}
          <div />
          {xs.map((x) => (
            <div key={x.value} className="pt-1 text-center text-[11px] text-slate-500">
              {x.value} {x.label}
            </div>
          ))}
        </div>
        <div className="mt-1 text-center text-xs font-medium text-slate-500">{mm.x.label} →</div>
      </div>
    </div>
  );
}

/** Vodorovný pruh rozložení podle úrovní (se štítky a počty). */
export function LevelBars({ counts }: { counts: Record<RiskLevel | "unassessed", number> }) {
  const order: (RiskLevel | "unassessed")[] = [...[...RISK_LEVELS].reverse(), "unassessed"];
  const max = Math.max(1, ...order.map((k) => counts[k] ?? 0));
  return (
    <div className="space-y-2">
      {order.map((k) => (
        <div key={k} className="flex items-center gap-3 text-sm">
          <div className="w-28 shrink-0">
            <RiskLevelBadge level={k} />
          </div>
          <div className="h-3 flex-1 rounded-sm bg-slate-100">
            <div className="h-3 rounded-sm" style={{ width: `${((counts[k] ?? 0) / max) * 100}%`, background: RISK_COLOR[k] }} />
          </div>
          <div className="w-8 text-right font-semibold tabular-nums">{counts[k] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

/** Názvy a popisy stupnic (sdílené, česky) v jazyce uživatele; popis 5stupňové škály má předponu „… polovina úrovně …“. */
export const locScale = (steps: ScaleStep[]): ScaleStep[] =>
  steps.map((s) => {
    const m = /^(.*? vyhlášky\.) (.*)$/.exec(s.description);
    return { ...s, name: lbl(s.name), description: m ? `${lbl(m[1]!)} ${lbl(m[2]!)}` : lbl(s.description) };
  });
