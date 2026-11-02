/** Výběr sledovaných rámců společnosti (ADR-074): zákon a vyhláška podle režimu vždy, další rámce volitelně. */
import { Checkbox, Select } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { FRAMEWORKS, OPTIONAL_FRAMEWORKS, frameworksInScope, type FrameworkId, type OptionalFramework } from "@contix/shared";

const nameOf = (id: string) => FRAMEWORKS.find((f) => f.id === id)?.shortName ?? id;

export function FrameworkPicker({ value, onChange }: { value: OptionalFramework[]; onChange: (v: OptionalFramework[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {[...OPTIONAL_FRAMEWORKS, ...FRAMEWORKS.filter((x) => x.custom).map((x) => x.id as OptionalFramework)].map((f) => (
        <Checkbox key={f} checked={value.includes(f)} onChange={(on) => onChange(on ? [...value, f] : value.filter((x) => x !== f))} label={nameOf(f)} />
      ))}
    </div>
  );
}

/** Implementační skupina CIS Controls v8.1 – dílčí opatření vyšších skupin jsou neaplikovatelná. */
export function CisIgSelect({ value, onChange }: { value: number; onChange: (v: 1 | 2 | 3) => void }) {
  const t = useT();
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700" data-testid="cis-ig">
      <span>{t("fw.cisIg")}</span>
      <Select className="w-auto" value={String(value)} onChange={(e) => onChange(Number(e.target.value) as 1 | 2 | 3)}>
        {[1, 2, 3].map((n) => (
          <option key={n} value={n}>
            {t(`fw.cisIg${n}` as "fw.cisIg1")}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function FrameworkScope({
  profile,
  value,
  onChange,
  cisIg,
  onCisIg,
}: {
  /** Regulatorní profil (zákon + hlavní rámec se sledují vždy). */
  profile: { law: FrameworkId | null; primary: FrameworkId | null };
  value: OptionalFramework[] | null;
  onChange: (v: OptionalFramework[] | null) => void;
  cisIg?: number;
  onCisIg?: (v: 1 | 2 | 3) => void;
}) {
  const t = useT();
  const fixed = frameworksInScope(profile, []).map(nameOf);
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3" data-testid="framework-scope">
      <p className="text-xs text-slate-500">{fixed.length ? t("fw.always", { list: fixed.join(", ") }) : t("fw.alwaysNone")}</p>
      <Checkbox checked={value !== null} onChange={(on) => onChange(on ? (value ?? []) : null)} label={t("fw.manual")} hint={t("fw.manualHint")} />
      {value !== null && <FrameworkPicker value={value} onChange={onChange} />}
      {value?.includes("cis8") && onCisIg && <CisIgSelect value={cisIg ?? 1} onChange={onCisIg} />}
    </div>
  );
}
