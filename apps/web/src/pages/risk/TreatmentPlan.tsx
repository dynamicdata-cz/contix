import { askConfirm } from "@/components/ui/overlay";
/**
 * Plán zvládání rizik – § 8 odst. 1 písm. g) vyhl. č. 409/2025 Sb.:
 * 1. popis opatření, 2. cíle a přínosy, 3. odpovědná osoba, 4. lidské/finanční/technické zdroje,
 * 5. termín, 6. vazba riziko ↔ opatření, 7. konkrétní způsob realizace.
 */
import { useT } from "@/lib/i18n";
import { PositionSelect } from "@/components/pickers";
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import { ACTION_LABELS, ACTION_STATUSES, type ActionStatus, type PlanSuggestionDto, type RiskDetail, type TreatmentActionDto, type TreatmentActionInput } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

export const actionTone: Record<ActionStatus, "slate" | "blue" | "green" | "amber"> = { planned: "slate", in_progress: "blue", done: "green", cancelled: "amber" };

type Form = TreatmentActionInput & { id?: string; riskId: string };

const toForm = (a: TreatmentActionDto): Form => ({
  id: a.id,
  riskId: a.riskId,
  controlId: a.controlId,
  title: a.title,
  description: a.description,
  objective: a.objective,
  ownerPositionId: a.ownerPositionId,
  resourcesHuman: a.resourcesHuman,
  resourcesFinancial: a.resourcesFinancial,
  resourcesTechnical: a.resourcesTechnical,
  costEstimate: a.costEstimate,
  dueDate: a.dueDate,
  realization: a.realization,
  status: a.status,
});

export const fmtCzk = (n: number | null | undefined) => (n == null ? "—" : `${n.toLocaleString("cs-CZ")} Kč`);

export function ActionModal({ form, setForm, onSaved }: { form: Form; setForm: (f: Form | null) => void; onSaved?: () => void }) {
  const t = useT();
  const mod = useModule();
  const can = useCan();
  const qc = useQueryClient();
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });
  const save = useMutation({
    mutationFn: () => {
      const { id, riskId, ...body } = form;
      return id ? api.risks.updateAction(id, body) : api.risks.addAction(riskId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["risk", form.riskId] });
      qc.invalidateQueries({ queryKey: ["risks"] });
      setForm(null);
      onSaved?.();
    },
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const str = (k: keyof Form) => ({ value: (form[k] as string) ?? "", onChange: (e: { target: { value: string } }) => set(k, (e.target.value || null) as never) });
  return (
    <Modal
      open
      wide
      onClose={() => setForm(null)}
      title={form.id ? t("rsk.upravitAkciPlanuZvladani") : t("rsk.novaAkcePlanuZvladaniRizika")}
      footer={
        <>
          <Button variant="secondary" onClick={() => setForm(null)}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!form.title?.trim() || save.isPending} onClick={() => save.mutate()}>
            {t("rsk.ulozit")}
          </Button>
        </>
      }
    >
      <ErrorBox error={save.error} />
      <Field label={t("rsk.1BezpecnostniOpatreniNazevAkce")}>
        <Input autoFocus value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("rsk.naprZavedeniMfaProVzdaleny")} />
      </Field>
      <Field label={t("rsk.popis")}>
        <Textarea rows={2} {...str("description")} />
      </Field>
      <Field label={t("rsk.2CileAPrinosy")}>
        <Textarea rows={2} {...str("objective")} placeholder={t("rsk.jakAkceSniziRizikoHrozbu")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("rsk.3OdpovednaOsobaFunkcniMisto")}>
          <PositionSelect value={form.ownerPositionId ?? null} onChange={(v) => set("ownerPositionId", v)} />
        </Field>
        <Field label={t("rsk.5PozadovanyTermin")}>
          <Input type="date" value={form.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("rsk.4LidskeZdroje")}>
          <Input {...str("resourcesHuman")} placeholder={t("rsk.napr10Md")} />
        </Field>
        <Field label={t("rsk.financniZdroje")}>
          <Input {...str("resourcesFinancial")} placeholder={t("rsk.naprRozpocetIt2027")} />
        </Field>
        <Field label={t("rsk.technickeZdroje")}>
          <Input {...str("resourcesTechnical")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("rsk.odhadNakladuKc")}>
          <Input type="number" min={0} value={form.costEstimate ?? ""} onChange={(e) => set("costEstimate", e.target.value ? Number(e.target.value) : null)} />
        </Field>
        <Field label={t("rsk.stav")}>
          <Select value={form.status} onChange={(e) => set("status", e.target.value as ActionStatus)}>
            {ACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(ACTION_LABELS[s])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {mod("controls") && (
        <Field label={t("rsk.6VazbaNaOpatreniZ")} hint={t("rsk.poDokonceniAkceAktualizujteStav")}>
          <Select value={form.controlId ?? ""} onChange={(e) => set("controlId", e.target.value || null)}>
            <option value="">{t("rsk.bezVazby")}</option>
            {(controls.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} ` : ""}
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={t("rsk.7KonkretniZpusobRealizace")}>
        <Textarea rows={3} {...str("realization")} />
      </Field>
    </Modal>
  );
}

export function TreatmentPlanCard({ risk }: { risk: RiskDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const del = useMutation({ mutationFn: api.risks.deleteAction, onSuccess: () => qc.invalidateQueries({ queryKey: ["risk", risk.id] }) });
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={t("rsk.5PlanZvladaniRizika")}
        subtitle={t("rsk.8Odst1PismG")}
        action={
          risk.canEdit && (
            <Button variant="secondary" onClick={() => setForm({ riskId: risk.id, title: "", status: "planned" })}>
              <Plus size={15} /> {t("rsk.akce")}
            </Button>
          )
        }
      />
      <ErrorBox error={del.error} />
      {risk.actions.length === 0 ? (
        <EmptyState>{t("rsk.zatimBezAkciRizikoNad")}</EmptyState>
      ) : (
        <ActionTable actions={risk.actions} onEdit={risk.canEdit ? (a) => setForm(toForm(a)) : undefined} onDelete={risk.canEdit ? async (a) => (await askConfirm(t("rsk.smazatAkci", { title: a.title }))) && del.mutate(a.id) : undefined} />
      )}
      {form && <ActionModal form={form} setForm={setForm} />}
    </Card>
  );
}

/** Návrhy akcí plánu z dat (v1.20, ADR-117): nezavedená / neúčinná opatření a slabé schopnosti ze scénářů. */
export function PlanSuggestionsCard({ risk }: { risk: RiskDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["plan-suggestions", risk.id, risk.actions.length], queryFn: () => api.risks.planSuggestions(risk.id) });
  const [picked, setPicked] = useState<string[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [due, setDue] = useState("");
  const apply = useMutation({
    mutationFn: () => api.risks.applyPlanSuggestions(risk.id, { keys: picked, ownerPositionId: owner, dueDate: due || null }),
    onSuccess: () => {
      setPicked([]);
      qc.invalidateQueries({ queryKey: ["risk", risk.id] });
      qc.invalidateQueries({ queryKey: ["plan-suggestions", risk.id] });
    },
  });
  const list = (q.data ?? []) as PlanSuggestionDto[];
  if (!list.length) return null;
  const open = list.filter((x) => !x.existing);
  return (
    <Card className="lg:col-span-2" data-testid="plan-suggestions">
      <CardHeader title={t("rsk.plan.sugTitle")} subtitle={t("rsk.plan.sugHint")} />
      <div className="space-y-2 px-5 py-3">
        {list.map((x) => (
          <label key={x.key} className={cn("flex items-start gap-2 text-sm", x.existing && "text-slate-400")}>
            <input type="checkbox" className="mt-1" disabled={!risk.canEdit || x.existing} checked={picked.includes(x.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.key] : picked.filter((k) => k !== x.key))} />
            <span>
              <span className="font-medium">{x.title}</span> <Badge tone={x.kind === "capability" ? "violet" : x.kind === "fix_control" ? "red" : "amber"}>{t(`rsk.plan.kind.${x.kind}`)}</Badge>
              {x.existing && <span className="ml-1 text-xs">{t("rsk.plan.inPlan")}</span>}
              <span className="block text-xs text-slate-500">{x.objective}</span>
            </span>
          </label>
        ))}
        {risk.canEdit && open.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <Field label={t("rsk.plan.owner")}>
              <PositionSelect value={owner} onChange={setOwner} emptyLabel={t("rsk.plan.ownerDefault")} />
            </Field>
            <Field label={t("rsk.plan.due")}>
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Button disabled={!picked.length || apply.isPending} onClick={() => apply.mutate()}>
              <Sparkles size={15} /> {t("rsk.plan.apply", { n: picked.length })}
            </Button>
          </div>
        )}
        <ErrorBox error={apply.error ?? q.error} />
      </div>
    </Card>
  );
}

export function ActionTable({
  actions,
  showRisk,
  onEdit,
  onDelete,
}: {
  actions: TreatmentActionDto[];
  showRisk?: boolean;
  onEdit?: (a: TreatmentActionDto) => void;
  onDelete?: (a: TreatmentActionDto) => void;
}) {
  const t = useT();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showRisk && <th className="px-5 py-2">{t("rsk.riziko")}</th>}
            <th className={cn("py-2", showRisk ? "px-3" : "px-5")}>{t("rsk.opatreniAkce")}</th>
            <th className="px-3 py-2">{t("rsk.odpovednost")}</th>
            <th className="px-3 py-2">{t("rsk.zdroje")}</th>
            <th className="px-3 py-2">{t("rsk.termin")}</th>
            <th className="px-3 py-2">{t("rsk.stav")}</th>
            {(onEdit || onDelete) && <th className="w-20" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {actions.map((a) => (
            <tr key={a.id} className="align-top">
              {showRisk && (
                <td className="px-5 py-2.5">
                  <Link to="/risks/$riskId" params={{ riskId: a.riskId }} className="font-medium hover:text-brand-700">
                    {a.riskCode && <span className="mr-1 text-slate-500">{a.riskCode}</span>}
                    {a.riskName}
                  </Link>
                  <div className="mt-0.5">
                    <RiskLevelBadge level={a.riskLevel} />
                  </div>
                </td>
              )}
              <td className={cn("py-2.5", showRisk ? "px-3" : "px-5")}>
                <div className="font-medium text-slate-900">{a.title}</div>
                {a.objective && <div className="text-xs text-slate-500">{t("rsk.cil", { objective: a.objective })}</div>}
                {a.controlId && (
                  <Link to="/controls/$controlId" params={{ controlId: a.controlId }} className="text-xs text-brand-700 hover:underline">
                    ↳ {a.controlCode} {a.controlName}
                  </Link>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-600">{a.ownerPositionName ?? <span className="text-amber-700">{t("rsk.neurceno")}</span>}</td>
              <td className="px-3 py-2.5 text-xs text-slate-600">
                {[a.resourcesHuman, a.resourcesTechnical, a.resourcesFinancial].filter(Boolean).join(" · ") || "—"}
                {a.costEstimate != null && <div className="font-medium text-slate-700">{fmtCzk(a.costEstimate)}</div>}
              </td>
              <td className={cn("whitespace-nowrap px-3 py-2.5", a.overdue ? "font-medium text-red-700" : "text-slate-600")}>
                {fmtDay(a.dueDate)}
                {a.overdue && " ⚠"}
              </td>
              <td className="px-3 py-2.5">
                <Badge tone={actionTone[a.status]}>{t.lbl(ACTION_LABELS[a.status])}</Badge>
              </td>
              {(onEdit || onDelete) && (
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-0.5">
                    {onEdit && (
                      <Button variant="ghost" className="px-1.5" onClick={() => onEdit(a)} aria-label={t("rsk.upravit")}>
                        <Pencil size={14} />
                      </Button>
                    )}
                    {onDelete && (
                      <Button variant="ghost" className="px-1.5 text-red-600" onClick={() => onDelete(a)} aria-label={t("rsk.smazat")}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { toForm as actionToForm };
