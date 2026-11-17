import { useDebounced } from "@/lib/utils";
/**
 * Výběrové prvky sdílené moduly Procesy / Rizika / Organizace:
 * - AssetPicker: vyhledávání aktiv (rozbalení bez psaní, skupiny podle typu) + vybrané jako „čipy“
 * Všechny výběry jsou od v1.74 s vyhledáváním (`components/combobox.tsx`, ADR-167).
 * - PositionSelect: funkční místa seskupená podle útvarů
 * - PartyPicker: RACI přiřazení (funkční místo nebo celý útvar + role R/A/C/I)
 */
import { useT } from "@/lib/i18n";
import { HealthIndicator } from "@/components/health";
import { Badge, Select } from "@/components/ui";
import { Combobox, ComboMulti, fold, type ComboOption } from "@/components/combobox";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/overlay";
import { LABELS, PROCESS_LABELS, RACI, recordPath, type HealthStatus, type OrgUnitDto, type Raci, type RecordPathKind } from "@contix/shared";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

export type PickedAsset = { id: string; name: string; assetType?: string; healthStatus?: string };

export function AssetPicker({ value, onChange, disabled }: { value: PickedAsset[]; onChange: (v: PickedAsset[]) => void; disabled?: boolean }) {
  const t = useT();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const mod = useModule();
  const can = useCan();
  const qc = useQueryClient();
  // rozbalení bez psaní ukáže prvních 30 aktiv (v1.74), psaní hledá v názvu, hostname, IP a sériovém čísle
  const found = useQuery({
    queryKey: ["assets", "picker", dq],
    queryFn: () => api.assets.list({ q: dq.trim() || undefined, limit: 30, offset: 0, withGroup: "1" }),
    enabled: mod("assets") && !disabled,
    staleTime: 30_000,
  });
  const items = (found.data?.items ?? []).filter((a) => !value.some((v) => v.id === a.id));
  const options: ComboOption[] = [...items]
    .sort((a, b) => fold(t.lbl(LABELS.assetType[a.assetType])).localeCompare(fold(t.lbl(LABELS.assetType[b.assetType]))) || a.name.localeCompare(b.name))
    .map((a) => ({
      id: a.id,
      label: a.name,
      group: t.lbl(LABELS.assetType[a.assetType]),
      hint: [a.hostname, a.ipAddresses?.[0]].filter(Boolean).join(" · ") || undefined,
      icon: <HealthIndicator status={a.healthStatus} size={13} />,
    }));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-sm text-slate-400">{t("my.zadnaAktiva")}</span>}
        {value.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-xs">
            {a.healthStatus && <HealthIndicator status={a.healthStatus as HealthStatus} size={13} />}
            <Link to={recordPath("asset", a.id)} className="hover:text-brand-700 hover:underline">
              {a.name}
            </Link>
            {!disabled && (
              <button type="button" className="rounded-full p-0.5 hover:bg-slate-200" onClick={() => onChange(value.filter((x) => x.id !== a.id))} aria-label={`Odebrat ${a.name}`}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <Combobox
          value={null}
          options={options}
          onQuery={setQ}
          loading={found.isLoading}
          placeholder={t("my.hledatAktivumNazevHostnameIp")}
          ariaLabel={t("my.hledatAktivumNazevHostnameIp")}
          noneText={t("my.nicNenalezeno")}
          onCreate={
            can("assets:write")
              ? async (name) => {
                  // rychlé založení aktiva (v1.76): typ „ostatní“, podrobnosti se doplní v detailu
                  const a = (await api.assets.create({ name, assetType: "other" } as never)) as { id: string; name: string; assetType: string; healthStatus: string };
                  onChange([...value, { id: a.id, name: a.name, assetType: a.assetType, healthStatus: a.healthStatus }]);
                  await qc.invalidateQueries({ queryKey: ["assets"] });
                  toast(t("combo.createdAsset", { name: a.name }), "success");
                  return null;
                }
              : undefined
          }
          onChange={(id) => {
            const a = items.find((x) => x.id === id);
            if (a) onChange([...value, { id: a.id, name: a.name, assetType: a.assetType, healthStatus: a.healthStatus }]);
            setQ("");
          }}
        />
      )}
    </div>
  );
}

export function useOrg() {
  const mod = useModule();
  return useQuery({ queryKey: ["org"], queryFn: api.org.tree, enabled: mod("organization") });
}

/** Útvary ve stromovém pořadí s hloubkou (pro odsazení v selectech). */
export function flattenUnits(units: OrgUnitDto[]) {
  const byParent = new Map<string | null, OrgUnitDto[]>();
  for (const u of units) byParent.set(u.parentId, [...(byParent.get(u.parentId) ?? []), u]);
  const ids = new Set(units.map((u) => u.id));
  const out: { unit: OrgUnitDto; depth: number }[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const u of byParent.get(pid) ?? []) {
      out.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  // osiřelé (rodič neexistuje) – pro jistotu
  for (const u of units) if (u.parentId && !ids.has(u.parentId) && !out.some((o) => o.unit.id === u.id)) out.push({ unit: u, depth: 0 });
  return out;
}


/** Více společností v datech organizace → popisky s názvem společnosti. */
const multiCompany = (units: OrgUnitDto[]) => new Set(units.map((u) => u.companyId)).size > 1;

export function PositionSelect({ value, onChange, disabled, emptyLabel, ariaLabel, className }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; emptyLabel?: string; ariaLabel?: string; className?: string }) {
  const t = useT();
  const org = useOrg();
  const options = usePositionOptions();
  return (
    <Combobox
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      ariaLabel={ariaLabel}
      className={className}
      emptyLabel={emptyLabel ?? t("common.unassignedOption")}
      loading={org.isLoading}
      placeholder={t("combo.searchPosition")}
    />
  );
}

/** Funkční místa jako položky výběru: skupina = útvar (u více společností s názvem společnosti), doplněk = držitelé. */
export function usePositionOptions(): ComboOption[] {
  const t = useT();
  const org = useOrg();
  return useMemo(() => {
    const units = org.data ?? [];
    const multi = multiCompany(units);
    return flattenUnits(units).flatMap(({ unit }) =>
      unit.positions.map((p) => ({
        id: p.id,
        label: p.name,
        group: multi ? `${unit.companyName} › ${unit.name}` : unit.name,
        hint: p.holders.length ? p.holders.map((h) => h.displayName).join(", ") : t("common.vacant"),
      })),
    );
  }, [org.data, t]);
}

export function UnitSelect({
  value,
  onChange,
  disabled,
  exclude,
  companyId,
  emptyLabel: emptyLabelIn,
  ariaLabel,
  className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  exclude?: string;
  /** Jen útvary této společnosti. */
  companyId?: string;
  emptyLabel?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const t = useT();
  const emptyLabel = emptyLabelIn ?? t("common.noneOption");
  const org = useOrg();
  const options = useMemo<ComboOption[]>(() => {
    const units = org.data ?? [];
    const multi = !companyId && multiCompany(units);
    const byId = new Map(units.map((u) => [u.id, u]));
    // cesta útvaru jako doplněk – při hledání je vidět, kam útvar patří
    const path = (u: OrgUnitDto) => {
      const out: string[] = [];
      for (let p = u.parentId ? byId.get(u.parentId) : undefined, i = 0; p && i < 10; p = p.parentId ? byId.get(p.parentId) : undefined, i++) out.unshift(p.name);
      return out.join(" › ");
    };
    return flattenUnits(units)
      .filter(({ unit }) => unit.id !== exclude && (!companyId || unit.companyId === companyId))
      .map(({ unit, depth }) => ({ id: unit.id, label: unit.name, depth, hint: path(unit) || undefined, group: multi ? unit.companyName : undefined }));
  }, [org.data, exclude, companyId]);
  // rychlé založení útvaru (v1.76) – nový útvar na nejvyšší úrovni společnosti, zařadit lze v Organizaci
  const can = useCan();
  const qc = useQueryClient();
  const onCreate = can("org:write")
    ? async (name: string) => {
        const u = (await api.org.createUnit({ name, ...(companyId ? { companyId } : {}) })) as { id: string; name: string };
        await qc.invalidateQueries({ queryKey: ["org"] });
        toast(t("combo.createdUnit", { name: u.name }), "success");
        return { id: u.id, label: u.name };
      }
    : undefined;
  return <Combobox value={value} onChange={onChange} options={options} disabled={disabled} emptyLabel={emptyLabel} ariaLabel={ariaLabel} className={className} loading={org.isLoading} placeholder={t("combo.searchUnit")} onCreate={onCreate} />;
}

export type RaciEntry = { kind: "position" | "org_unit"; id: string; role: Raci; name?: string };

export const raciTone: Record<Raci, "blue" | "violet" | "amber" | "slate"> = { R: "blue", A: "violet", C: "amber", I: "slate" };

export function PartyPicker({ value, onChange }: { value: RaciEntry[]; onChange: (v: RaciEntry[]) => void }) {
  const t = useT();
  const org = useOrg();
  const flat = useMemo(() => flattenUnits(org.data ?? []), [org.data]);
  const [party, setParty] = useState("");
  const [role, setRole] = useState<Raci>("R");
  const nameOf = (e: RaciEntry) => {
    if (e.name) return e.name;
    for (const { unit } of flat) {
      if (e.kind === "org_unit" && unit.id === e.id) return unit.name;
      const p = unit.positions.find((x) => x.id === e.id);
      if (p) return `${p.name} (${unit.name})`;
    }
    return "?";
  };
  const add = () => {
    if (!party) return;
    const [kind, id] = party.split(":") as ["position" | "org_unit", string];
    if (!value.some((v) => v.kind === kind && v.id === id && v.role === role)) onChange([...value, { kind, id, role }]);
    setParty("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-sm text-slate-400">{t("my.nikdoNeprirazen")}</span>}
        {value.map((e, i) => (
          <span key={`${e.kind}${e.id}${e.role}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-0.5 pl-1 pr-1 text-xs">
            <Badge tone={raciTone[e.role]}>{e.role}</Badge>
            {nameOf(e)}
            <button type="button" className="rounded-full p-0.5 hover:bg-slate-100" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t("my.odebrat")}>
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Combobox
          className="flex-1"
          value={party || null}
          onChange={(v) => setParty(v ?? "")}
          ariaLabel={t("my.vyberteFunkcniMistoNeboUtvar")}
          placeholder={t("my.vyberteFunkcniMistoNeboUtvar")}
          options={flat.flatMap(({ unit }) => {
            const group = multiCompany(org.data ?? []) ? `${unit.companyName} › ${unit.name}` : unit.name;
            return [
              { id: `org_unit:${unit.id}`, label: t("my.celyUtvar", { name: unit.name }), group },
              ...unit.positions.map((p) => ({ id: `position:${p.id}`, label: p.name, group, hint: p.holders.map((h) => h.displayName).join(", ") || undefined })),
            ];
          })}
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as Raci)} className="w-28" title={t.lbl(PROCESS_LABELS.raci[role])}>
          {RACI.map((r) => (
            <option key={r} value={r} title={t.lbl(PROCESS_LABELS.raci[r])}>
              {r}
            </option>
          ))}
        </Select>
        <button type="button" onClick={add} disabled={!party} className="rounded-md border border-slate-300 px-3 text-sm hover:bg-slate-50 disabled:opacity-50">
          {t("my.pridat")}
        </button>
      </div>
      <p className="text-xs text-slate-500">{t("my.rProvadiASchvalujeOdpovida")}</p>
    </div>
  );
}

export type IdOption = { id: string; label: string; hint?: string };

/** Výběr více položek podle ID (procesy, rizika…) – vybrané jako čipy, přidání z rozbalovacího seznamu. */
export function IdMultiSelect({
  value,
  onChange,
  options,
  known = [],
  disabled,
  placeholder: placeholderIn,
  emptyLabel: emptyLabelIn,
  linkKind,
  ariaLabel,
}: {
  /** Druh záznamu – vybrané položky jsou odkazy na jeho detail (v1.05). */
  linkKind?: RecordPathKind;
  value: string[];
  onChange: (v: string[]) => void;
  options: IdOption[];
  /** Popisky již vybraných položek, které nemusí být v `options` (např. z detailu). */
  known?: IdOption[];
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  const t = useT();
  const placeholder = placeholderIn ?? t("my.pridat2");
  const emptyLabel = emptyLabelIn ?? t("my.nicNevybrano");
  const all = useMemo<ComboOption[]>(() => {
    const seen = new Set(options.map((o) => o.id));
    return [...options, ...known.filter((k) => !seen.has(k.id))].map((o) => ({ id: o.id, label: o.label, hint: o.hint }));
  }, [options, known]);
  const labelOf = (id: string) => all.find((o) => o.id === id)?.label ?? created.find((o) => o.id === id)?.label ?? "…";
  // rychlé založení dodavatele přímo z výběru (v1.76)
  const can = useCan();
  const qc = useQueryClient();
  const [created, setCreated] = useState<IdOption[]>([]);
  const onCreate =
    linkKind === "supplier" && can("suppliers:write")
      ? async (name: string) => {
          const x = (await api.suppliers.create({ name } as never)) as { id: string; name: string };
          setCreated((c) => [...c, { id: x.id, label: x.name }]);
          await qc.invalidateQueries({ queryKey: ["suppliers"] });
          toast(t("combo.createdSupplier", { name: x.name }), "success");
          return { id: x.id, label: x.name };
        }
      : undefined;
  return (
    <ComboMulti
      onCreate={onCreate}
      value={value}
      onChange={onChange}
      options={all}
      disabled={disabled}
      placeholder={placeholder}
      ariaLabel={ariaLabel ?? placeholder}
      emptyText={emptyLabel}
      renderChip={(id) =>
        linkKind ? (
          <Link to={recordPath(linkKind, id)} className="hover:text-brand-700 hover:underline">
            {labelOf(id)}
          </Link>
        ) : (
          labelOf(id)
        )
      }
    />
  );
}

/** Uživatelé jako položky výběru (jméno, doplněk = funkce nebo e-mail). */
export function useUserOptions(enabled = true): { options: ComboOption[]; loading: boolean } {
  const q = useQuery({ queryKey: ["directory-users"], queryFn: api.directory.users, enabled, staleTime: 60_000 });
  const options = useMemo(() => (q.data ?? []).map((u) => ({ id: u.id, label: u.displayName, hint: u.jobTitle ?? u.email })), [q.data]);
  return { options, loading: q.isLoading };
}

/** Výběr osoby s vyhledáváním (v1.74). */
export function UserSelect({ value, onChange, disabled, emptyLabel, ariaLabel, className }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; emptyLabel?: string; ariaLabel?: string; className?: string }) {
  const t = useT();
  const u = useUserOptions();
  return <Combobox value={value} onChange={onChange} options={u.options} loading={u.loading} disabled={disabled} emptyLabel={emptyLabel ?? t("common.unassignedOption")} ariaLabel={ariaLabel} className={className} placeholder={t("combo.searchUser")} />;
}

/** Více osob – vybrané jako čipy (v1.74). */
export function UserMultiSelect({ value, onChange, disabled, ariaLabel, emptyText }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; ariaLabel?: string; emptyText?: string }) {
  const t = useT();
  const u = useUserOptions();
  return <ComboMulti value={value} onChange={onChange} options={u.options} loading={u.loading} disabled={disabled} ariaLabel={ariaLabel ?? t("combo.searchUser")} placeholder={t("combo.searchUser")} emptyText={emptyText ?? t("my.nikdoNeprirazen")} />;
}

/** Více funkčních míst – vybraná jako čipy (v1.76). */
export function PositionMultiSelect({ value, onChange, disabled, ariaLabel, emptyText }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; ariaLabel?: string; emptyText?: string }) {
  const t = useT();
  const options = usePositionOptions();
  return <ComboMulti value={value} onChange={onChange} options={options} disabled={disabled} ariaLabel={ariaLabel ?? t("combo.searchPosition")} placeholder={t("combo.searchPosition")} emptyText={emptyText ?? t("my.nikdoNeprirazen")} />;
}
