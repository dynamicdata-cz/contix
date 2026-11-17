import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { askConfirm } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { DATA_CATEGORIES, DATA_CATEGORY_LABELS, DATA_TRANSFER_LABELS, LOCATION_RULE_LABELS, TRANSFER_MECHANISMS, type DataCategory, type DataLocationDto, type TransferMechanism } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

const TONE = { ok: "green", info: "blue", warning: "amber", error: "red" } as const;

/** Umístění dat (v1.52, ADR-149): hostingy, cloud a SaaS – země a pravidla, která se na ni vztahují. */
export function DataLocationsPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["data-locations"], queryFn: api.dataLocations.list });
  const [edit, setEdit] = useState<DataLocationDto | "new" | null>(null);
  const remove = useMutation({
    mutationFn: async (l: DataLocationDto) => (await askConfirm(t("loc.deleteConfirm", { name: l.name }), { danger: true })) && api.dataLocations.remove(l.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["data-locations"] }),
  });
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader
        title={t("loc.title")}
        subtitle={t("loc.subtitle")}
        actions={
          can("suppliers:write") && (
            <Button onClick={() => setEdit("new")}>
              <Plus size={16} /> {t("loc.add")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error ?? remove.error} />
      <Card className="overflow-x-auto" data-testid="locations">
        {!rows.length ? (
          <EmptyState>{q.isLoading ? t("common.loading") : t("loc.empty")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("loc.name")}</th>
                <th className="px-3 py-2">{t("loc.country")}</th>
                <th className="px-3 py-2">{t("loc.data")}</th>
                <th className="px-3 py-2">{t("loc.rules")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((l) => (
                <tr key={l.id} data-testid={`loc-${l.name}`}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-slate-900">{l.name}</div>
                    <div className="text-xs text-slate-500">{[l.supplierName ?? l.provider, ...l.tags.map((x) => `#${x}`)].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {l.country}
                    {l.region ? ` · ${l.region}` : ""}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{l.dataCategories.map((c) => t.lbl(DATA_CATEGORY_LABELS[c])).join(", ") || "—"}</td>
                  <td className="space-y-1 px-3 py-2.5">
                    {l.rules.map((r) => (
                      <div key={r.code}>
                        <Badge tone={TONE[r.level]}>{t.lbl(LOCATION_RULE_LABELS[r.code])}</Badge>
                      </div>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {can("suppliers:write") && (
                      <>
                        <Button variant="ghost" aria-label={t("cn.edit")} onClick={() => setEdit(l)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" aria-label={t("common.delete")} onClick={() => remove.mutate(l)}>
                          <Trash2 size={14} />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">{t("loc.note")}</p>
      {edit && <LocationForm l={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function LocationForm({ l, onClose }: { l: DataLocationDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const sups = useQuery({ queryKey: ["suppliers"], queryFn: () => api.suppliers.list() });
  const [f, setF] = useState({
    name: l?.name ?? "",
    supplierId: l?.supplierId ?? "",
    provider: l?.provider ?? "",
    country: l?.country ?? "",
    region: l?.region ?? "",
    dataCategories: l?.dataCategories ?? ([] as DataCategory[]),
    transferMechanism: (l?.transferMechanism ?? "") as TransferMechanism | "",
    dpaSigned: l?.dpaSigned ?? false,
    note: l?.note ?? "",
  });
  const save = useMutation({
    mutationFn: () => {
      const data = { ...f, supplierId: f.supplierId || null, transferMechanism: f.transferMechanism || null, provider: f.provider || null, region: f.region || null, note: f.note || null };
      return l ? api.dataLocations.update(l.id, data) : api.dataLocations.create(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["data-locations"] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={l ? l.name : t("loc.add")}>
      <div className="space-y-3">
        <Field label={t("loc.name")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("loc.namePh")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("loc.supplier")}>
            <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">—</option>
              {((sups.data as { id: string; name: string }[] | undefined) ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("loc.provider")}>
            <Input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="Microsoft Azure" />
          </Field>
          <Field label={t("loc.country")} hint={t("loc.countryHint")}>
            <Input value={f.country} maxLength={2} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} placeholder="DE" />
          </Field>
          <Field label={t("loc.region")}>
            <Input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} placeholder="westeurope" />
          </Field>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-medium text-slate-700">{t("loc.data")}</span>
          <div className="grid gap-1 sm:grid-cols-2">
            {DATA_CATEGORIES.map((c) => (
              <Checkbox key={c} checked={f.dataCategories.includes(c)} onChange={(v) => setF({ ...f, dataCategories: v ? [...f.dataCategories, c] : f.dataCategories.filter((x) => x !== c) })} label={t.lbl(DATA_CATEGORY_LABELS[c])} />
            ))}
          </div>
        </div>
        <Field label={t("loc.transfer")}>
          <Select value={f.transferMechanism} onChange={(e) => setF({ ...f, transferMechanism: e.target.value as TransferMechanism | "" })}>
            <option value="">—</option>
            {TRANSFER_MECHANISMS.map((m) => (
              <option key={m} value={m}>
                {t.lbl(DATA_TRANSFER_LABELS[m])}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox checked={f.dpaSigned} onChange={(v) => setF({ ...f, dpaSigned: v })} label={t("loc.dpa")} />
        <Field label={t("loc.noteField")}>
          <Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
        <ErrorBox error={save.error} />
        <div className="flex gap-2">
          <Button disabled={!f.name.trim() || f.country.length !== 2 || save.isPending} onClick={() => save.mutate()}>
            {t("con.ulozit")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("cn.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
