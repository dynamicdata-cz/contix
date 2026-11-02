/**
 * Skupina společností v UI: přepínač aktivní společnosti, sloupec „Společnost“ v souhrnném pohledu
 * a upozornění u stránek, které se vedou jen za jednu společnost (SoA, dokumenty ISMS).
 */
import { useT } from "@/lib/i18n";
import { Button, Card, Select } from "@/components/ui";
import { getActiveCompany, setActiveCompany } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { FRAMEWORKS, GROUP_SCOPE } from "@contix/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Building, Network } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Souhrnný pohled za více společností? */
export function useGroupView() {
  const me = useMe();
  return me.activeCompanyId === null && me.companies.length > 1;
}

export function useCompanyName() {
  const me = useMe();
  return (id: string | null | undefined) => me.companies.find((c) => c.id === id)?.shortName || me.companies.find((c) => c.id === id)?.name || "";
}

export function useSwitchCompany() {
  const qc = useQueryClient();
  return (id: string | null) => {
    setActiveCompany(id);
    qc.resetQueries();
  };
}

export function CompanySwitcher() {
  const t = useT();
  const me = useMe();
  const switchTo = useSwitchCompany();
  if (me.companies.length <= 1 && !me.canGroupView) return null;
  const value = me.activeCompanyId ?? GROUP_SCOPE;
  return (
    <div className="border-b border-slate-100 px-3 py-2">
      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <Network size={12} /> {t("company.label")}
      </label>
      <Select className="py-1.5 text-sm" value={value} onChange={(e) => switchTo(e.target.value)} aria-label={t("company.active")}>
        {me.canGroupView && me.companies.length > 1 && <option value={GROUP_SCOPE}>{t("company.wholeGroup")}</option>}
        {me.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {"  ".repeat(c.depth)}
            {c.name}
          </option>
        ))}
      </Select>
      {value === GROUP_SCOPE && getActiveCompany() !== null && (
        <p className="mt-1 text-[11px] leading-tight text-slate-500">
          {t("company.newRecordsHome", { name: me.companies.find((c) => c.id === me.homeCompanyId)?.name ?? "—" })}
        </p>
      )}
    </div>
  );
}

/** Buňka se společností – zobrazí se jen v souhrnném pohledu. */
export function CompanyCell({ id, className }: { id: string; className?: string }) {
  const name = useCompanyName();
  return (
    <span className={className ?? "inline-flex items-center gap-1 whitespace-nowrap text-xs text-slate-500"}>
      <Building size={11} /> {name(id)}
    </span>
  );
}

/** Obsah, který dává smysl jen za jednu společnost (SoA, dokumenty ISMS). */
export function NeedsCompany({ children, what }: { children: ReactNode; what: string }) {
  const t = useT();
  const me = useMe();
  const group = useGroupView();
  const switchTo = useSwitchCompany();
  if (!group) return <>{children}</>;
  return (
    <Card className="mb-6 p-5">
      <div className="mb-3 text-sm text-slate-700">
        {t("company.perCompany", { what })}
      </div>
      <div className="flex flex-wrap gap-2">
        {me.companies.map((c) => (
          <Button key={c.id} variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => switchTo(c.id)}>
            <Building size={13} /> {c.name}
          </Button>
        ))}
      </div>
    </Card>
  );
}

/** Pruh nad obsahem stránky: v jaké společnosti uživatel právě pracuje (jen ve skupině s více společnostmi). */
export function ActiveCompanyBar() {
  const t = useT();
  const me = useMe();
  const switchTo = useSwitchCompany();
  if (me.companies.length <= 1) return null;
  const active = me.companies.find((c) => c.id === me.activeCompanyId) ?? null;
  const parent = active?.parentId ? me.companies.find((c) => c.id === active.parentId) : null;
  const home = me.companies.find((c) => c.id === me.homeCompanyId);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-white px-4 py-2 text-sm md:px-8">
      {active ? (
        <>
          {active.kind === "holding" ? <Network size={15} className="text-brand-600" /> : <Building size={15} className="text-slate-500" />}
          <span className="text-slate-500">{t("company.workingIn")}</span>
          <span className="font-semibold text-slate-900">{active.name}</span>
          <span className="text-xs text-slate-500">
            {active.kind === "holding" ? t("company.kind.holding") : t("company.kind.company")}
            {" · "}
            {active.pack === "generic"
              ? (FRAMEWORKS.find((x) => x.id === active.primaryFramework)?.shortName ?? t("company.regime.none"))
              : active.regime === "higher"
                ? t("company.regime.higher")
                : active.regime === "lower"
                  ? t("company.regime.lower")
                  : t("company.regime.none")}
            {active.doraEntity ? " · DORA" : ""}
            {parent ? ` · ${t("company.inGroup", { name: parent.name })}` : ""}
          </span>
        </>
      ) : (
        <>
          <Network size={15} className="text-brand-600" />
          <span className="font-semibold text-slate-900">{t("company.wholeGroup")}</span>
          <span className="text-xs text-slate-500">{t("company.newRecordsInto", { name: home?.name ?? t("company.homeCompany") })}</span>
        </>
      )}
      {me.activeCompanyId && me.canGroupView && (
        <button className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => switchTo(GROUP_SCOPE)}>
          {t("org.zobrazitCelouSkupinu")}
        </button>
      )}
    </div>
  );
}

/** Výběr společnosti pro nový záznam – jen v souhrnném pohledu skupiny (jinak platí aktivní společnost). */
export function useTargetCompany() {
  const me = useMe();
  const group = useGroupView();
  const [id, setId] = useState<string>(me.activeCompanyId ?? me.homeCompanyId);
  return { companyId: id, setCompanyId: setId, group, name: me.companies.find((c) => c.id === id)?.name ?? "" };
}

export function TargetCompanyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const me = useMe();
  const group = useGroupView();
  if (!group) {
    const c = me.companies.find((x) => x.id === value);
    return c && me.companies.length > 1 ? <p className="text-xs text-slate-500">{t("company.recordCreatedIn")} <b>{c.name}</b>.</p> : null;
  }
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{t("company.label")}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {me.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {"  ".repeat(c.depth)}
            {c.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
