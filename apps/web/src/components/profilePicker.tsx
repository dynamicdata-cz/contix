/** Regulatorní profil společnosti (ADR-080): balíček země, úroveň povinností a hlavní rámec z knihovny. */
import { Checkbox, Field, Select } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { DORA_AUTHORITY, FRAMEWORKS, getMethodology, profileOf, regulatoryPack, REGULATORY_PACKS, type PackId } from "@contix/shared";

export interface ProfileValue {
  pack: PackId;
  regime: "higher" | "lower" | "none";
  primaryFramework: string | null;
  doraEntity: boolean;
}

export function ProfilePicker({ value, onChange, disabled }: { value: ProfileValue; onChange: (v: ProfileValue) => void; disabled?: boolean }) {
  const t = useT();
  const pack = regulatoryPack(value.pack);
  const p = profileOf(value);
  const needsPrimary = !pack.levels.find((l) => l.key === value.regime)?.primary || pack.id !== "cz";
  const candidates = FRAMEWORKS.filter((f) => f.uses.includes("gap") && !["cz409", "cz410", "zkb"].includes(f.id));
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="profile-picker">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("prf.pack")}>
          <Select
            value={value.pack}
            disabled={disabled}
            onChange={(e) => {
              const next = e.target.value as PackId;
              const lv = regulatoryPack(next).levels;
              onChange({ ...value, pack: next, regime: lv.some((l) => l.key === value.regime) && !(value.regime === "none" && lv.length > 1) ? value.regime : lv[0]!.key });
            }}
          >
            {REGULATORY_PACKS.map((x) => (
              <option key={x.id} value={x.id}>
                {t.lbl(x.name)}
              </option>
            ))}
          </Select>
        </Field>
        {pack.levels.length > 1 && (
          <Field label={pack.id === "cz" ? t("usr.rezimPodleZakonaC264") : t("prf.level")}>
            <Select value={value.regime} disabled={disabled} onChange={(e) => onChange({ ...value, regime: e.target.value as ProfileValue["regime"] })}>
              {pack.levels.map((l) => (
                <option key={l.key} value={l.key}>
                  {t.lbl(l.name)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {needsPrimary && (
          <Field label={t("prf.primary")} hint={t("prf.primaryHint")}>
            <Select value={value.primaryFramework ?? ""} disabled={disabled} onChange={(e) => onChange({ ...value, primaryFramework: e.target.value || null })}>
              <option value="">{pack.id === "cz" || pack.id === "generic" ? t("prf.noPrimary") : t("prf.defaultNis2")}</option>
              {candidates.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.shortName} – {f.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Checkbox
        checked={value.doraEntity}
        disabled={disabled}
        onChange={(v) => onChange({ ...value, doraEntity: v })}
        label={t("prf.dora")}
        hint={t("prf.doraHint", { authority: DORA_AUTHORITY[pack.jurisdiction] ?? t("prf.doraAuthorityOther") })}
      />
      <p className="text-xs text-slate-500">
        {pack.id === "cz" || pack.id === "generic" ? t.lbl(pack.description) : pack.description}{" "}
        {pack.asOf && t("prf.asOf", { authority: pack.authority, asOf: pack.asOf })}{" "}
        {t("prf.summary", {
          main: p.primary ? (FRAMEWORKS.find((f) => f.id === p.primary)?.shortName ?? p.primary) : "—",
          risk: getMethodology(p.riskMethodology)?.name ?? (p.riskMethodology === "zkb409" ? t.lbl("Příloha č. 4 vyhlášky") : p.riskMethodology),
        })}
      </p>
    </div>
  );
}
