/**
 * Hromadné úpravy v seznamech (v1.75, ADR-168): lišta nad vybranými záznamy – co změnit, hodnota, použít.
 * Server ověří každý záznam zvlášť (oprávnění, útvar / funkce ze společnosti záznamu); přeskočené ukáže s důvodem.
 * Od v1.79 i procesy a dodavatelé (ADR-172).
 */
import { PositionSelect, UnitSelect, UserSelect } from "@/components/pickers";
import { TagInput } from "@/components/tags";
import { Button, Input, Select } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { CONTROL_LABELS, CONTROL_STATUSES, CRITICALITIES, ENVIRONMENTS, LABELS, LIFECYCLE_STATUSES, PROCESS_LABELS, PROCESS_TYPES, type BulkResultDto } from "@contix/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, X } from "lucide-react";
import { useState } from "react";

export type BulkEntity = "assets" | "risks" | "controls" | "processes" | "suppliers";
type Field =
  | "orgUnitId"
  | "processType"
  | "significant"
  | "dataOutsideCz"
  | "supplierStatus"
  | "reviewIntervalMonths"
  | "lastReviewAt"
  | "ownerUnitId"
  | "ownerUserId"
  | "technicalOwnerUserId"
  | "technicalDeputyUserId"
  | "criticality"
  | "lifecycleStatus"
  | "environment"
  | "ownerPositionId"
  | "status"
  | "addTags"
  | "removeTags";

const FIELDS: Record<BulkEntity, Field[]> = {
  assets: ["ownerUnitId", "ownerUserId", "technicalOwnerUserId", "technicalDeputyUserId", "criticality", "lifecycleStatus", "environment", "addTags", "removeTags"],
  risks: ["ownerPositionId", "addTags", "removeTags"],
  controls: ["ownerPositionId", "status", "addTags", "removeTags"],
  processes: ["ownerPositionId", "orgUnitId", "criticality", "processType", "addTags", "removeTags"],
  suppliers: ["ownerUnitId", "significant", "dataOutsideCz", "supplierStatus", "reviewIntervalMonths", "lastReviewAt", "addTags", "removeTags"],
};
/** Pole formuláře → klíč v `set` (stav dodavatele se jmenuje jako stav opatření). */
const SET_KEY: Partial<Record<Field, string>> = { supplierStatus: "status" };
const BOOL_FIELDS: Field[] = ["significant", "dataOutsideCz"];
const FIELD_KEY = {
  orgUnitId: "bulk.f.orgUnitId",
  processType: "bulk.f.processType",
  significant: "bulk.f.significant",
  dataOutsideCz: "bulk.f.dataOutsideCz",
  supplierStatus: "bulk.f.supplierStatus",
  reviewIntervalMonths: "bulk.f.reviewIntervalMonths",
  lastReviewAt: "bulk.f.lastReviewAt",
  ownerUnitId: "bulk.f.ownerUnitId",
  ownerUserId: "bulk.f.ownerUserId",
  technicalOwnerUserId: "bulk.f.technicalOwnerUserId",
  technicalDeputyUserId: "bulk.f.technicalDeputyUserId",
  criticality: "bulk.f.criticality",
  lifecycleStatus: "bulk.f.lifecycleStatus",
  environment: "bulk.f.environment",
  ownerPositionId: "bulk.f.ownerPositionId",
  status: "bulk.f.status",
  addTags: "bulk.f.addTags",
  removeTags: "bulk.f.removeTags",
} as const;

/** Výběr řádků seznamu: stav + přepínače. */
export function useSelection() {
  const [sel, setSel] = useState<string[]>([]);
  return {
    sel,
    has: (id: string) => sel.includes(id),
    toggle: (id: string, on?: boolean) => setSel((s) => ((on ?? !s.includes(id)) ? [...new Set([...s, id])] : s.filter((x) => x !== id))),
    setAll: (ids: string[], on: boolean) => setSel((s) => (on ? [...new Set([...s, ...ids])] : s.filter((x) => !ids.includes(x)))),
    clear: () => setSel([]),
  };
}

/** Zaškrtávátko v řádku – klik neotevře detail. */
export function RowCheck({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-slate-300"
      checked={checked}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
      data-testid="bulk-row"
    />
  );
}

export function BulkBar({ entity, ids, onClear }: { entity: BulkEntity; ids: string[]; onClear: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [field, setField] = useState<Field>(FIELDS[entity][0]!);
  const [value, setValue] = useState<string | null>(null);
  const [tagVals, setTagVals] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<BulkResultDto["skipped"]>([]);
  const run = useMutation({
    mutationFn: () => {
      const conv = (): unknown => {
        if (BOOL_FIELDS.includes(field)) return value === "1";
        if (field === "reviewIntervalMonths") return Number(value);
        if (field === "environment" || field === "lastReviewAt" || field.endsWith("Id")) return value;
        return value ?? undefined;
      };
      const body = field === "addTags" || field === "removeTags" ? { ids, set: {}, [field]: tagVals } : { ids, set: { [SET_KEY[field] ?? field]: conv() } };
      return api.bulk[entity](body as never);
    },
    onSuccess: (r) => {
      setSkipped(r.skipped);
      toast(t("bulk.done", { n: r.updated, skipped: r.skipped.length }), r.skipped.length ? "info" : "success");
      void qc.invalidateQueries({ queryKey: [entity] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
      if (!r.skipped.length) onClear();
    },
  });
  if (!ids.length) return null;
  const enumSel = (opts: readonly string[], label: (v: string) => string, allowNull = false) => (
    <Select className="w-56" value={value ?? ""} onChange={(e) => setValue(e.target.value || null)} aria-label={t("bulk.value")}>
      <option value="">{allowNull ? t("bulk.clear") : t("bulk.pick")}</option>
      {opts.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </Select>
  );
  const picker = () => {
    switch (field) {
      case "ownerUnitId":
      case "orgUnitId":
        return <UnitSelect className="w-64" value={value} onChange={setValue} emptyLabel={t("bulk.clear")} ariaLabel={t("bulk.value")} />;
      case "ownerUserId":
      case "technicalOwnerUserId":
      case "technicalDeputyUserId":
        return <UserSelect className="w-64" value={value} onChange={setValue} emptyLabel={t("bulk.clear")} ariaLabel={t("bulk.value")} />;
      case "ownerPositionId":
        return <PositionSelect className="w-72" value={value} onChange={setValue} emptyLabel={t("bulk.clear")} ariaLabel={t("bulk.value")} />;
      case "criticality":
        return enumSel(CRITICALITIES, (v) => t.lbl(LABELS.criticality[v as keyof typeof LABELS.criticality]));
      case "lifecycleStatus":
        return enumSel(LIFECYCLE_STATUSES, (v) => t.lbl(LABELS.lifecycleStatus[v as keyof typeof LABELS.lifecycleStatus]));
      case "environment":
        return enumSel(ENVIRONMENTS, (v) => t.lbl(LABELS.environment[v as keyof typeof LABELS.environment]), true);
      case "status":
        return enumSel(
          CONTROL_STATUSES.filter((s) => s !== "not_applicable"),
          (v) => t.lbl(CONTROL_LABELS.status[v as keyof typeof CONTROL_LABELS.status]),
        );
      case "processType":
        return enumSel(PROCESS_TYPES, (v) => t.lbl(PROCESS_LABELS.type[v as keyof typeof PROCESS_LABELS.type]));
      case "significant":
      case "dataOutsideCz":
        return (
          <Select className="w-40" value={value ?? ""} onChange={(e) => setValue(e.target.value || null)} aria-label={t("bulk.value")}>
            <option value="">{t("bulk.pick")}</option>
            <option value="1">{t("bulk.yes")}</option>
            <option value="0">{t("bulk.no")}</option>
          </Select>
        );
      case "supplierStatus":
        return enumSel(["active", "ended"], (v) => t(v === "active" ? "bulk.supplier.active" : "bulk.supplier.ended"));
      case "reviewIntervalMonths":
        return <Input type="number" min={1} max={36} className="w-32" value={value ?? ""} onChange={(e) => setValue(e.target.value || null)} aria-label={t("bulk.value")} placeholder={t("bulk.months")} />;
      case "lastReviewAt":
        return <Input type="date" className="w-44" value={value ?? ""} onChange={(e) => setValue(e.target.value || null)} aria-label={t("bulk.value")} />;
      case "addTags":
      case "removeTags":
        return (
          <div className="w-72">
            <TagInput value={tagVals} onChange={setTagVals} ariaLabel={t("bulk.value")} />
          </div>
        );
    }
  };
  // výčty (kritičnost, stav…) musí mít vybranou hodnotu, vazby lze i zrušit (prázdné)
  const needsValue = ["criticality", "lifecycleStatus", "status", "processType", "significant", "dataOutsideCz", "supplierStatus", "reviewIntervalMonths"].includes(field);
  const ready = field === "addTags" || field === "removeTags" ? tagVals.length > 0 : !needsValue || !!value;
  return (
    <div className="sticky bottom-3 z-30 mt-3 rounded-xl border border-brand-200 bg-white p-3 shadow-lg" data-testid="bulk-bar">
      <div className="flex flex-wrap items-start gap-3">
        <span className="inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-brand-900">
          <CheckSquare size={16} /> {t("bulk.selected", { n: ids.length })}
        </span>
        <Select
          className="w-56"
          value={field}
          onChange={(e) => {
            setField(e.target.value as Field);
            setValue(null);
            setTagVals([]);
          }}
          aria-label={t("bulk.field")}
        >
          {FIELDS[entity].map((f) => (
            <option key={f} value={f}>
              {t(FIELD_KEY[f])}
            </option>
          ))}
        </Select>
        {picker()}
        <Button disabled={!ready || run.isPending} onClick={() => run.mutate()} data-testid="bulk-apply">
          {t("bulk.apply", { n: ids.length })}
        </Button>
        <Button variant="secondary" onClick={onClear}>
          <X size={14} /> {t("bulk.cancel")}
        </Button>
      </div>
      {run.error && <p className="mt-2 text-sm text-red-700">{(run.error as Error).message}</p>}
      {skipped.length > 0 && (
        <p className="mt-2 text-xs text-amber-800" data-testid="bulk-skipped">
          {t("bulk.skipped", { n: skipped.length })}: {[...new Set(skipped.map((s) => t.lbl(s.reason)))].join("; ")}
        </p>
      )}
    </div>
  );
}
