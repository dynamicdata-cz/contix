import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, PageHeader, Select } from "@/components/ui";
import { askConfirm } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { TAG_COLORS, TAG_ENTITY_LABELS, type TagColor, type TagDto, type TaggedObjectDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";

/** Společné štítky (v1.52, ADR-149): katalog a záznamy se štítkem napříč evidencemi. */
export function TagsPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["tags"], queryFn: api.tags.list });
  const [sel, setSel] = useState<string | null>(null);
  const objects = useQuery({ queryKey: ["tags", sel, "objects"], queryFn: () => api.tags.objects(sel!), enabled: !!sel });
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("slate");
  const set = (d: TagDto[]) => qc.setQueryData(["tags"], d);
  const create = useMutation({ mutationFn: () => api.tags.create({ name, color }), onSuccess: (d) => (set(d), setName("")) });
  const update = useMutation({ mutationFn: (x: TagDto) => api.tags.update(x.id, { name: x.name, color: x.color, description: x.description }), onSuccess: set });
  const remove = useMutation({
    mutationFn: async (x: TagDto) => ((await askConfirm(t("tag.deleteConfirm", { name: x.name }), { danger: true })) ? api.tags.remove(x.id) : (q.data ?? [])),
    onSuccess: set,
  });
  const admin = can("admin:settings");
  const current = q.data?.find((x) => x.id === sel);
  return (
    <>
      <PageHeader title={t("tag.title")} subtitle={t("tag.subtitle")} />
      <ErrorBox error={q.error ?? create.error ?? update.error ?? remove.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="tag-catalog">
          <CardHeader title={t("tag.catalog")} />
          {!(q.data ?? []).length ? (
            <EmptyState>{t("tag.empty")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(q.data ?? []).map((x) => (
                <li key={x.id} className={`flex items-center gap-3 px-5 py-2.5 ${sel === x.id ? "bg-brand-50" : ""}`}>
                  <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setSel(x.id)}>
                    <Badge tone={x.color}>{x.name}</Badge>
                    <span className="text-xs text-slate-500">{t("tag.count", { n: x.count })}</span>
                  </button>
                  {admin && (
                    <>
                      <Select className="w-28 py-1 text-xs" aria-label={t("tag.color")} value={x.color} onChange={(e) => update.mutate({ ...x, color: e.target.value as TagColor })}>
                        {TAG_COLORS.map((c) => (
                          <option key={c} value={c}>
                            {t(`tag.c.${c}`)}
                          </option>
                        ))}
                      </Select>
                      <Button variant="ghost" aria-label={t("common.delete")} onClick={() => remove.mutate(x)}>
                        <Trash2 size={14} />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {admin && (
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 p-4">
              <Field label={t("tag.new")} className="w-56">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tag.newPh")} />
              </Field>
              <Select className="w-28" aria-label={t("tag.color")} value={color} onChange={(e) => setColor(e.target.value as TagColor)}>
                {TAG_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {t(`tag.c.${c}`)}
                  </option>
                ))}
              </Select>
              <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
                {t("tag.add")}
              </Button>
            </div>
          )}
        </Card>
        <Card data-testid="tag-objects">
          <CardHeader title={current ? t("tag.objects", { name: current.name }) : t("tag.pick")} />
          {current && (objects.data ?? []).length === 0 ? (
            <EmptyState>{objects.isLoading ? t("common.loading") : t("tag.noObjects")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(objects.data ?? []).map((o) => (
                <li key={`${o.entityType}:${o.id}`} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <Badge>{t.lbl(TAG_ENTITY_LABELS[o.entityType])}</Badge>
                  <ObjectLink o={o} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ObjectLink({ o }: { o: TaggedObjectDto }) {
  const cls = "text-brand-700 hover:underline";
  switch (o.entityType) {
    case "asset":
      return <Link to="/assets/$assetId" params={{ assetId: o.id }} className={cls}>{o.name}</Link>;
    case "risk":
      return <Link to="/risks/$riskId" params={{ riskId: o.id }} className={cls}>{o.name}</Link>;
    case "supplier":
      return <Link to="/suppliers/$supplierId" params={{ supplierId: o.id }} className={cls}>{o.name}</Link>;
    case "process":
      return <Link to="/processes/$processId" params={{ processId: o.id }} className={cls}>{o.name}</Link>;
    case "control":
      return <Link to="/controls/$controlId" params={{ controlId: o.id }} className={cls}>{o.name}</Link>;
    default:
      return <Link to="/suppliers/locations" className={cls}>{o.name}</Link>;
  }
}
