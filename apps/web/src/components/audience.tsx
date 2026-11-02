import { useT, tt, lbl } from "@/lib/i18n";
import { flattenUnits, IdMultiSelect, useOrg } from "@/components/pickers";
import { Checkbox } from "@/components/ui";
import { SECURITY_ROLES, type Audience } from "@contix/shared";
import { useMemo } from "react";

/** Okruh dotčených osob – útvary (včetně podřízených), funkční místa, bezpečnostní role, vedení, všichni. */
export function AudienceEditor({ value, onChange, disabled }: { value: Audience; onChange: (v: Audience) => void; disabled?: boolean }) {
  const t = useT();
  const org = useOrg();
  const flat = useMemo(() => flattenUnits(org.data ?? []), [org.data]);
  const units = flat.map(({ unit, depth }) => ({ id: unit.id, label: `${"  ".repeat(depth * 2)}${unit.name}` }));
  const positions = flat.flatMap(({ unit }) => unit.positions.map((p) => ({ id: p.id, label: `${p.name} (${unit.name})` })));
  const set = <K extends keyof Audience>(k: K, v: Audience[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Checkbox checked={value.all} disabled={disabled} onChange={(v) => set("all", v)} label={t("doc.vsichniUzivateleSpolecnosti")} />
        <Checkbox checked={value.management} disabled={disabled} onChange={(v) => set("management", v)} label={t("doc.vrcholneVedeniVedouciNejvyssichUtvaru")} />
      </div>
      {!value.all && (
        <>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">{t("doc.utvaryVcetnePodrizenych")}</div>
            <IdMultiSelect value={value.unitIds} onChange={(v) => set("unitIds", v)} options={units} disabled={disabled} placeholder={t("doc.pridatUtvar")} emptyLabel={t("doc.zadne")} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">{t("doc.funkcniMista")}</div>
            <IdMultiSelect value={value.positionIds} onChange={(v) => set("positionIds", v)} options={positions} disabled={disabled} placeholder={t("doc.pridatFunkcniMisto")} emptyLabel={t("doc.zadna")} />
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">{t("doc.bezpecnostniRole")}</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {SECURITY_ROLES.map((r) => (
                <Checkbox
                  key={r}
                  checked={value.securityRoles.includes(r)}
                  disabled={disabled}
                  onChange={(v) => set("securityRoles", v ? [...value.securityRoles, r] : value.securityRoles.filter((x) => x !== r))}
                  label={t.lbl(r)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const audienceSummary = (a: Audience) =>
  a.all
    ? tt("doc.vsichniUzivatele")
    : [
        a.management && tt("doc.vedeni"),
        a.unitIds.length && tt("doc.utvaruN", { n: a.unitIds.length }),
        a.positionIds.length && tt("doc.funkcnichMistN", { n: a.positionIds.length }),
        a.securityRoles.length && a.securityRoles.map((r) => lbl(r)).join(", "),
      ]
        .filter(Boolean)
        .join(", ") || tt("doc.neurceno");
