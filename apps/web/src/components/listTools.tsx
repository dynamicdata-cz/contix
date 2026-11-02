import { askConfirm } from "@/components/ui/overlay";
/** Nástroje seznamů (ADR-075): řazení kliknutím na sloupec, seskupení a uložené pohledy (vlastní i sdílené). */
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SavedViewDto, SortDir, SortState, ViewPage } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, Save, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

/** Záhlaví sloupce s řazením; první klik sestupně u dat/závažnosti, vzestupně u textu. */
export function SortTh<K extends string>({ k, label, sort, onSort, className, firstDir = "asc" }: { k: K; label: ReactNode; sort: SortState<K> | null; onSort: (s: SortState<K> | null) => void; className?: string; firstDir?: SortDir }) {
  const t = useT();
  const active = sort?.key === k;
  const next = (): SortState<K> | null => (!active ? { key: k, dir: firstDir } : sort!.dir === firstDir ? { key: k, dir: firstDir === "asc" ? "desc" : "asc" } : null);
  const Icon = !active ? ArrowUpDown : sort!.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" className={cn("px-3 py-2", className)} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(next())} className={cn("inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800", active && "text-brand-700")} title={t("list.sortBy")}>
        {label}
        <Icon size={12} className={active ? "" : "opacity-40"} />
      </button>
    </th>
  );
}

/** Výběr seskupení. */
export function GroupSelect<K extends string>({ value, options, onChange }: { value: K | ""; options: { key: K; label: string }[]; onChange: (v: K | "") => void }) {
  const t = useT();
  return (
    <Select className="w-52" value={value} onChange={(e) => onChange(e.target.value as K | "")} aria-label={t("list.groupBy")}>
      <option value="">{t("list.noGrouping")}</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {t("list.groupByX", { x: o.label })}
        </option>
      ))}
    </Select>
  );
}

/** Řádek se záhlavím skupiny v tabulce. */
export function GroupRow({ label, count, colSpan }: { label: ReactNode; count: number; colSpan: number }) {
  return (
    <tr className="bg-slate-100/70">
      <td colSpan={colSpan} className="px-4 py-1.5 text-xs font-semibold text-slate-700">
        {label} <span className="ml-1 font-normal text-slate-500">({count})</span>
      </td>
    </tr>
  );
}

/** Uložené pohledy: výběr, uložení aktuálního stavu, smazání vlastního. */
export function SavedViews<S extends Record<string, unknown>>({ page, state, onApply, onReset }: { page: ViewPage; state: S; onApply: (s: S) => void; onReset: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["views", page], queryFn: () => api.views.list(page) });
  const [cur, setCur] = useState("");
  const [saving, setSaving] = useState(false);
  const del = useMutation({ mutationFn: (id: string) => api.views.remove(page, id), onSuccess: () => (setCur(""), qc.invalidateQueries({ queryKey: ["views", page] })) });
  const views = q.data ?? [];
  const sel = views.find((v) => v.id === cur);
  return (
    <div className="flex items-center gap-1.5" data-testid="saved-views">
      <Bookmark size={15} className="text-slate-400" />
      <Select
        className="w-56"
        value={cur}
        aria-label={t("list.views")}
        onChange={(e) => {
          const v = views.find((x) => x.id === e.target.value);
          setCur(e.target.value);
          if (v) onApply(v.state as S);
          else onReset();
        }}
      >
        <option value="">{t("list.defaultView")}</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.shared ? ` · ${v.mine ? t("list.shared") : v.ownerName ?? t("list.shared")}` : ""}
          </option>
        ))}
      </Select>
      <Button variant="secondary" onClick={() => setSaving(true)} title={t("list.saveView")} aria-label={t("list.saveView")}>
        <Save size={14} />
      </Button>
      {sel?.mine && (
        <Button variant="secondary" onClick={async () => (await askConfirm(t("list.deleteViewConfirm", { name: sel.name }))) && del.mutate(sel.id)} aria-label={t("list.deleteView")} title={t("list.deleteView")}>
          <Trash2 size={14} />
        </Button>
      )}
      {saving && <SaveViewModal page={page} state={state} initial={sel?.mine ? sel : null} onClose={() => setSaving(false)} onSaved={(v) => (setCur(v.id), setSaving(false))} />}
    </div>
  );
}

function SaveViewModal({ page, state, initial, onClose, onSaved }: { page: ViewPage; state: Record<string, unknown>; initial: SavedViewDto | null; onClose: () => void; onSaved: (v: SavedViewDto) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(initial?.name ?? "");
  const [shared, setShared] = useState(initial?.shared ?? false);
  const m = useMutation({ mutationFn: () => api.views.save(page, { name, state, shared }), onSuccess: (v) => (qc.invalidateQueries({ queryKey: ["views", page] }), onSaved(v)) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("list.saveView")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={!name.trim() || m.isPending}>
            {t("list.save")}
          </Button>
        </>
      }
    >
      <Field label={t("list.viewName")} hint={t("list.viewNameHint")}>
        <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={t("list.viewNamePh")} />
      </Field>
      <Checkbox checked={shared} onChange={setShared} label={t("list.shareView")} hint={t("list.shareViewHint")} />
      {initial && <Badge tone="slate">{t("list.overwrite", { name: initial.name })}</Badge>}
      <ErrorBox error={m.error} />
    </Modal>
  );
}
