import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { LossExceedanceChart } from "@/components/lec";
import { RiskLevelBadge } from "@/components/risk";
import { Button, Card, CardHeader, Checkbox, Input } from "@/components/ui";
import { analyzeQuant, fmtCzk, type QuantInput, type QuantPolicy, type Range3 } from "@contix/shared";
import { useMemo, useState } from "react";

const empty: QuantInput = { lef: { min: 0.1, mode: 0.5, max: 2 }, lm: { min: 100_000, mode: 500_000, max: 3_000_000 } };

function RangeRow({ label, hint, value, onChange, disabled, money }: { label: string; hint: string; value: Range3; onChange: (v: Range3) => void; disabled?: boolean; money?: boolean }) {
  const t = useT();
  const bad = !(value.min <= value.mode && value.mode <= value.max);
  const f = (k: keyof Range3) => (
    <Input
      type="number"
      min={0}
      step={money ? 10000 : 0.05}
      disabled={disabled}
      value={value[k]}
      onChange={(e) => onChange({ ...value, [k]: Math.max(0, Number(e.target.value) || 0) })}
      className={bad ? "border-red-400" : undefined}
      aria-label={`${label} – ${k}`}
    />
  );
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-700">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {f("min")}
        {f("mode")}
        {f("max")}
      </div>
      <div className="mt-0.5 grid grid-cols-3 gap-2 text-[11px] text-slate-500">
        <span>{t("rsk.minimum")}</span>
        <span>{t("rsk.nejpravdepodobnejsi")}</span>
        <span>{t("rsk.maximum")}</span>
      </div>
      <p className={bad ? "text-xs text-red-700" : "text-xs text-slate-500"}>{bad ? t("rsk.musiPlatitMinimumNejpravdepodobnejsiMaxi") : hint}</p>
    </div>
  );
}

/** Kvantitativní analýza rizika (FAIR) – rozpětí četnosti a ztráty, simulace, křivka překročení, ROSI. */
export function QuantCard({
  riskId,
  value,
  onChange,
  policy,
  actionsCost,
  edit,
}: {
  riskId: string;
  value: QuantInput | null | undefined;
  onChange: (v: QuantInput | null) => void;
  policy: QuantPolicy;
  actionsCost: number;
  edit: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(!!value);
  const q = value ?? null;
  const valid = (r?: Range3 | null) => !r || (r.min <= r.mode && r.mode <= r.max);
  const ok = !!q && valid(q.lef) && valid(q.lm) && valid(q.residualLef) && valid(q.residualLm);
  const res = useMemo(() => (q && ok ? analyzeQuant(q, policy, riskId || "new", actionsCost) : null), [q, ok, policy, riskId, actionsCost]);
  const hasRes = !!(q?.residualLef || q?.residualLm);
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={t("rsk.kvantitativniAnalyzaFair")}
        subtitle={t("rsk.volitelneDoplneniKvalitativnihoHodnoceni")}
        action={
          edit &&
          (q ? (
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={async () => (await askConfirm(t("rsk.odebratKvantitativniAnalyzu"))) && onChange(null)}>
              {t("rsk.odebrat")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="px-2.5 py-1.5 text-xs"
              onClick={() => {
                onChange(empty);
                setOpen(true);
              }}
            >
              {t("rsk.kvantifikovat")}
            </Button>
          ))
        }
      />
      {q && open && (
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1.3fr]">
          <fieldset disabled={!edit} className="space-y-4">
            <RangeRow label={t("rsk.cetnostIncidentuZaRok")} hint={t("rsk.napr02JednouZa")} value={q.lef} onChange={(v) => onChange({ ...q, lef: v })} />
            <RangeRow label={t("rsk.ztrataZJednohoIncidentuKc")} hint={t("rsk.obnovaVypadekSankceNahradyReputace")} value={q.lm} onChange={(v) => onChange({ ...q, lm: v })} money />
            <Checkbox
              checked={hasRes}
              onChange={(v) => onChange(v ? { ...q, residualLef: { ...q.lef }, residualLm: { ...q.lm } } : { ...q, residualLef: null, residualLm: null })}
              label={t("rsk.odhadPoZavedeniOpatreniZbytkove")}
            />
            {hasRes && (
              <>
                <RangeRow label={t("rsk.cetnostPoOpatrenich")} hint="" value={q.residualLef ?? q.lef} onChange={(v) => onChange({ ...q, residualLef: v })} />
                <RangeRow label={t("rsk.ztrataPoOpatrenichKc")} hint="" value={q.residualLm ?? q.lm} onChange={(v) => onChange({ ...q, residualLm: v })} money />
                <div>
                  <div className="mb-1 text-sm font-medium text-slate-700">{t("rsk.rocniNakladyOpatreniKc")}</div>
                  <Input
                    type="number"
                    min={0}
                    step={10000}
                    value={q.controlCostYear ?? ""}
                    placeholder={actionsCost ? t("rsk.zPlanuZvladani", { p: actionsCost.toLocaleString("cs-CZ") }) : ""}
                    onChange={(e) => onChange({ ...q, controlCostYear: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
              </>
            )}
          </fieldset>
          <div className="space-y-4">
            {res ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label={t("rsk.ocekavanaRocniZtrata")} value={fmtCzk(res.inherent.mean)} extra={<RiskLevelBadge level={res.level} />} />
                  <Stat label={t("rsk.s95Neprekroci")} value={fmtCzk(res.inherent.p95)} />
                  <Stat label={t("rsk.alespon1IncidentZaRok")} value={`${Math.round(res.inherent.probAny * 100)} %`} />
                  {res.residual && <Stat label={t("rsk.poOpatrenich")} value={fmtCzk(res.residual.mean)} extra={res.residualLevel && <RiskLevelBadge level={res.residualLevel} />} />}
                  {res.reduction != null && <Stat label={t("rsk.snizeniZtratyRok")} value={fmtCzk(res.reduction)} />}
                  {res.rosi != null && <Stat label={t("rsk.navratnostRosi")} value={`${Math.round(res.rosi * 100)} %`} hint={t("rsk.nakladyRok", { p: fmtCzk(res.controlCostYear ?? 0) })} />}
                </div>
                <LossExceedanceChart inherent={res.inherent} residual={res.residual} />
                {policy.appetiteYear != null && (
                  <p className="text-xs text-slate-500">{t("rsk.ochotaNestRizikoZaSpolecnost", { p: fmtCzk(policy.appetiteYear) })}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">{t("rsk.opravteRozpetiVysledekSeSpocita")}</p>
            )}
          </div>
        </div>
      )}
      {q && !open && (
        <button className="px-5 pb-4 text-sm text-brand-700 hover:underline" onClick={() => setOpen(true)}>
          {t("rsk.zobrazit")}
        </button>
      )}
    </Card>
  );
}

function Stat({ label, value, extra, hint }: { label: string; value: string; extra?: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-semibold tabular-nums text-slate-900">{value}</div>
      {extra}
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}
