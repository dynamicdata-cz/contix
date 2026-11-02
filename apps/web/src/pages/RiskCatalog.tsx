import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Modal, PageHeader, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { CatalogItemDto, CatalogItemInput } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Kind = "threat" | "weakness";
type Form = CatalogItemInput & { id?: string; kind: Kind; isBuiltin?: boolean };

export function RiskCatalogPage() {
  const t = useT();
  const can = useCan();
  const edit = can("risks:catalog");
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("threat");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const cat = useQuery({ queryKey: ["risk-catalog"], queryFn: () => api.risks.catalog() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["risk-catalog"] });
  const save = useMutation({
    mutationFn: (f: Form) => {
      const { id, kind: k, isBuiltin, ...body } = f;
      return id ? api.risks.updateCatalog(id, body) : api.risks.createCatalog(k, body);
    },
    onSuccess: () => (refresh(), setForm(null)),
  });
  const setActive = useMutation({ mutationFn: (x: CatalogItemDto) => api.risks.updateCatalog(x.id, { isActive: !x.isActive }), onSuccess: refresh });
  const del = useMutation({ mutationFn: api.risks.deleteCatalog, onSuccess: refresh });
  const items = (cat.data ?? []).filter((c) => c.kind === kind && (showInactive || c.isActive));

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/risks" className="hover:text-brand-700">
          {t("rsk.rizika")}
        </Link>
      </div>
      <PageHeader
        title={t("rsk.katalogHrozebAZranitelnosti")}
        subtitle={t("rsk.vychoziObsahKategorieHrozebA")}
        actions={
          edit && (
            <Button onClick={() => setForm({ kind, code: "", name: "", category: "", description: "", affectsC: true, affectsI: true, affectsA: true, isActive: true })}>
              <Plus size={16} /> {kind === "threat" ? t("rsk.novaHrozba") : t("rsk.novaZranitelnost")}
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-4">
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5">
          {(
            [
              ["threat", "Hrozby"],
              ["weakness", "Zranitelnosti"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={cn("rounded px-3 py-1 text-sm", kind === k ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600")}>
              {l}
            </button>
          ))}
        </div>
        <Checkbox checked={showInactive} onChange={setShowInactive} label={t("rsk.zobrazitINeaktivni")} />
      </div>
      <ErrorBox error={cat.error ?? del.error ?? setActive.error} />
      <Card className="overflow-hidden">
        <CardHeader title={kind === "threat" ? "Hrozby" : t("rsk.zranitelnostiSlabaMista")} />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-16 px-5 py-2">{t("rsk.kod")}</th>
              <th className="px-3 py-2">{t("rsk.nazev")}</th>
              <th className="px-3 py-2">{t("rsk.kategorie")}</th>
              {kind === "threat" && <th className="px-3 py-2">{t("rsk.ohrozuje")}</th>}
              <th className="px-3 py-2 text-right">{t("rsk.rizik")}</th>
              <th className="w-36" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((x) => (
              <tr key={x.id} className={cn(!x.isActive && "opacity-50")}>
                <td className="px-5 py-2.5 font-mono text-xs">{x.code}</td>
                <td className="px-3 py-2.5">
                  {x.name}
                  {x.isBuiltin && (
                    <span className="ml-2">
                      <Badge tone={x.source?.includes("82/2018") ? "amber" : "slate"}>{x.source?.includes("82/2018") ? t("rsk.vyhl822018Historicka") : t("rsk.vyhl4092025Pril3")}</Badge>
                    </span>
                  )}
                  {x.description && <div className="text-xs text-slate-500">{x.description}</div>}
                </td>
                <td className="px-3 py-2.5 text-slate-600">{x.category}</td>
                {kind === "threat" && (
                  <td className="px-3 py-2.5 font-mono text-xs" title={t("rsk.duvernostIntegritaDostupnost")}>
                    {x.affectsC ? "C" : "·"}
                    {x.affectsI ? "I" : "·"}
                    {x.affectsA ? "A" : "·"}
                  </td>
                )}
                <td className="px-3 py-2.5 text-right tabular-nums">{x.riskCount ?? 0}</td>
                <td className="px-3 py-2.5 text-right">
                  {edit && (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" className="px-2 text-xs" onClick={() => setActive.mutate(x)}>
                        {x.isActive ? "Deaktivovat" : "Aktivovat"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-1.5"
                        onClick={() =>
                          setForm({
                            id: x.id,
                            kind: x.kind,
                            isBuiltin: x.isBuiltin,
                            code: x.code ?? "",
                            name: x.name,
                            category: x.category ?? "",
                            description: x.description ?? "",
                            affectsC: x.affectsC,
                            affectsI: x.affectsI,
                            affectsA: x.affectsA,
                            isActive: x.isActive,
                          })
                        }
                        aria-label={t("rsk.upravit")}
                      >
                        <Pencil size={14} />
                      </Button>
                      {!x.isBuiltin && (
                        <Button variant="ghost" className="px-1.5 text-red-600" onClick={async () => (await askConfirm(t("rsk.smazat2", { name: x.name }))) && del.mutate(x.id)} aria-label={t("rsk.smazat")}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {form && (
        <Modal
          open
          onClose={() => setForm(null)}
          title={form.id ? t("rsk.upravitPolozkuKatalogu") : form.kind === "threat" ? t("rsk.novaHrozba") : t("rsk.novaZranitelnost")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>
                {t("common.cancelAction")}
              </Button>
              <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate(form)}>
                {t("rsk.ulozit")}
              </Button>
            </>
          }
        >
          <ErrorBox error={save.error} />
          <div className="grid gap-4 sm:grid-cols-[110px_1fr]">
            <Field label={t("rsk.kod")}>
              <Input value={form.code ?? ""} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={form.kind === "threat" ? "H18" : "Z13"} />
            </Field>
            <Field label={t("rsk.kategorie")}>
              <Input value={form.category ?? ""} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
          </div>
          <Field label={t("rsk.nazev")}>
            <Textarea rows={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("rsk.popis")}>
            <Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          {form.kind === "threat" && (
            <div className="flex gap-6">
              <Checkbox checked={!!form.affectsC} onChange={(v) => setForm({ ...form, affectsC: v })} label={t("rsk.duvernost")} />
              <Checkbox checked={!!form.affectsI} onChange={(v) => setForm({ ...form, affectsI: v })} label={t("rsk.integrita")} />
              <Checkbox checked={!!form.affectsA} onChange={(v) => setForm({ ...form, affectsA: v })} label={t("rsk.dostupnost")} />
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
