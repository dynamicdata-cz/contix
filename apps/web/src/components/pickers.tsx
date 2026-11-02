import { useDebounced } from "@/lib/utils";
/**
 * Výběrové prvky sdílené moduly Procesy / Rizika / Organizace:
 * - AssetPicker: vyhledávání aktiv + vybrané jako „čipy“
 * - PositionSelect: funkční místa seskupená podle útvarů
 * - PartyPicker: RACI přiřazení (funkční místo nebo celý útvar + role R/A/C/I)
 */
import { useT } from "@/lib/i18n";
import { HealthIndicator } from "@/components/health";
import { Badge, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useModule } from "@/lib/auth";
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
  const found = useQuery({
    queryKey: ["assets", "picker", dq],
    queryFn: () => api.assets.list({ q: dq, limit: 12, offset: 0, withGroup: "1" }),
    enabled: dq.trim().length >= 2 && mod("assets"),
  });
  const selected = new Set(value.map((v) => v.id));
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
        <div className="relative">
          <Input placeholder={t("my.hledatAktivumNazevHostnameIp")} value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {found.isLoading && <div className="px-3 py-2 text-sm text-slate-500">{t("my.hledam")}</div>}
              {found.data?.items.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">{t("my.nicNenalezeno")}</div>}
              {found.data?.items
                .filter((a) => !selected.has(a.id))
                .map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={(e) => {
                      // v <label> (Field) by aktivace popisku po překreslení „klikla“ na první tlačítko – odebrání čipu (v1.05)
                      e.preventDefault();
                      onChange([...value, { id: a.id, name: a.name, assetType: a.assetType, healthStatus: a.healthStatus }]);
                      setQ("");
                    }}
                  >
                    <HealthIndicator status={a.healthStatus} size={14} />
                    <span className="flex-1">{a.name}</span>
                    <span className="text-xs text-slate-500">{t.lbl(LABELS.assetType[a.assetType])}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
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

const indent = (d: number) => "  ".repeat(d * 2);

/** Více společností v datech organizace → popisky s názvem společnosti. */
const multiCompany = (units: OrgUnitDto[]) => new Set(units.map((u) => u.companyId)).size > 1;

export function PositionSelect({ value, onChange, disabled, emptyLabel, ariaLabel, className }: { value: string | null; onChange: (v: string | null) => void; disabled?: boolean; emptyLabel?: string; ariaLabel?: string; className?: string }) {
  const t = useT();
  const org = useOrg();
  const flat = useMemo(() => flattenUnits(org.data ?? []), [org.data]);
  const multi = multiCompany(org.data ?? []);
  return (
    <Select value={value ?? ""} disabled={disabled} className={className} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel ?? t("common.unassignedOption")}</option>
      {flat
        .filter(({ unit }) => unit.positions.length)
        .map(({ unit }) => (
          <optgroup key={unit.id} label={multi ? `${unit.companyName} › ${unit.name}` : unit.name}>
            {unit.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.holders.length ? ` (${p.holders.map((h) => h.displayName).join(", ")})` : ` (${t("common.vacant")})`}
              </option>
            ))}
          </optgroup>
        ))}
    </Select>
  );
}

export function UnitSelect({
  value,
  onChange,
  disabled,
  exclude,
  companyId,
  emptyLabel: emptyLabelIn,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  exclude?: string;
  /** Jen útvary této společnosti. */
  companyId?: string;
  emptyLabel?: string;
}) {
  const t = useT();
  const emptyLabel = emptyLabelIn ?? t("common.noneOption");
  const org = useOrg();
  const flat = useMemo(() => flattenUnits(org.data ?? []), [org.data]);
  const multi = !companyId && multiCompany(org.data ?? []);
  return (
    <Select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {flat
        .filter(({ unit }) => unit.id !== exclude && (!companyId || unit.companyId === companyId))
        .map(({ unit, depth }) => (
          <option key={unit.id} value={unit.id}>
            {indent(depth)}
            {multi && depth === 0 ? `${unit.companyName} › ` : ""}
            {unit.name}
          </option>
        ))}
    </Select>
  );
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
        <Select value={party} onChange={(e) => setParty(e.target.value)} className="flex-1">
          <option value="">{t("my.vyberteFunkcniMistoNeboUtvar")}</option>
          {flat.map(({ unit, depth }) => (
            <optgroup key={unit.id} label={`${indent(depth)}${multiCompany(org.data ?? []) && depth === 0 ? `${unit.companyName} › ` : ""}${unit.name}`}>
              <option value={`org_unit:${unit.id}`}>{t("my.celyUtvar", { name: unit.name })}</option>
              {unit.positions.map((p) => (
                <option key={p.id} value={`position:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
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
}) {
  const t = useT();
  const placeholder = placeholderIn ?? t("my.pridat2");
  const emptyLabel = emptyLabelIn ?? t("my.nicNevybrano");
  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? known.find((o) => o.id === id)?.label ?? "…";
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-sm text-slate-400">{emptyLabel}</span>}
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-xs">
            {linkKind ? (
              <Link to={recordPath(linkKind, id)} className="hover:text-brand-700 hover:underline">
                {labelOf(id)}
              </Link>
            ) : (
              labelOf(id)
            )}
            {!disabled && (
              <button type="button" className="rounded-full p-0.5 hover:bg-slate-200" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={t("my.odebrat")}>
                <X size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <Select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">{placeholder}</option>
          {options
            .filter((o) => !value.includes(o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.hint ? ` – ${o.hint}` : ""}
              </option>
            ))}
        </Select>
      )}
    </div>
  );
}
