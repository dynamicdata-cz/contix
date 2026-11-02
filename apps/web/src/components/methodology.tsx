import { useT } from "@/lib/i18n";
import { Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { registerMethodologies, type FactorValues, type RiskMethodologyDef } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";

/**
 * Načte metodiky (vestavěné + importované) a zaregistruje importované definice do sdíleného registru,
 * aby výpočet skóre v UI (riskScore) odpovídal API.
 */
export function useMethodologies() {
  const can = useCan();
  const q = useQuery({
    queryKey: ["methodologies"],
    queryFn: api.methodologies.list,
    staleTime: 60_000,
    enabled: can("risks:read", "audits:read", "admin:settings"),
  });
  if (q.data) registerMethodologies(q.data.filter((m) => !m.builtin && m.definition).map((m) => m.definition!));
  return q;
}

function StepSelect({ steps, value, onChange, disabled }: { steps: RiskMethodologyDef["factors"][number]["scale"]; value: number | undefined; onChange: (v: number | undefined) => void; disabled?: boolean }) {
  const cur = steps.find((s) => s.value === value);
  return (
    <div className="space-y-1">
      <Select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}>
        <option value="">—</option>
        {steps.map((s) => (
          <option key={s.value} value={s.value}>
            {s.value} – {s.label}
          </option>
        ))}
      </Select>
      {cur?.description && <p className="text-xs leading-snug text-slate-500">{cur.description}</p>}
    </div>
  );
}

/** Formulář hodnot faktorů libovolné metodiky (faktor po oblastech = tabulka oblastí s vahami). */
export function FactorEditor({
  def,
  value,
  onChange,
  disabled,
  compact,
}: {
  def: RiskMethodologyDef;
  value: FactorValues | null | undefined;
  onChange: (v: FactorValues) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const v = value ?? {};
  const setFactor = (k: string, x: number | Record<string, number> | undefined) => {
    const next = { ...v };
    if (x === undefined) delete next[k];
    else next[k] = x;
    onChange(next);
  };
  return (
    <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-4"}>
      {def.factors.map((f) =>
        f.perArea ? (
          <div key={f.key} className="sm:col-span-2">
            <div className="mb-1.5 text-sm font-medium text-slate-700">{f.label}</div>
            {f.description && !compact && <p className="mb-2 text-xs text-slate-500">{f.description}</p>}
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">{t("meth.oblastDopadu")}</th>
                  <th className="py-1 pr-3 text-right">{t("meth.vaha")}</th>
                  <th className="py-1">{t("meth.hodnota")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(def.areas ?? []).map((a) => {
                  const cur = (typeof v[f.key] === "object" ? v[f.key] : {}) as Record<string, number>;
                  return (
                    <tr key={a.key}>
                      <td className="py-1.5 pr-3">{a.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">{a.weight}</td>
                      <td className="w-56 py-1.5">
                        <StepSelect
                          steps={f.scale}
                          disabled={disabled}
                          value={cur[a.key]}
                          onChange={(x) => {
                            const n = { ...cur };
                            if (x === undefined) delete n[a.key];
                            else n[a.key] = x;
                            setFactor(f.key, Object.keys(n).length ? n : undefined);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <label key={f.key} className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{f.label}</span>
            <StepSelect steps={f.scale} disabled={disabled} value={typeof v[f.key] === "number" ? (v[f.key] as number) : undefined} onChange={(x) => setFactor(f.key, x)} />
          </label>
        ),
      )}
    </div>
  );
}

/** Výběr metodiky hodnocení rizik (vyhláška + vestavěné + importované). */
export function RiskMethodologySelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const t = useT();
  const q = useMethodologies();
  const opts = (q.data ?? []).filter((m) => m.kind === "risk");
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {opts.length === 0 && <option value={value}>{value}</option>}
      {opts.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
          {m.builtin ? "" : t("meth.importovana2")}
        </option>
      ))}
    </Select>
  );
}
