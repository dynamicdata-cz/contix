import { askConfirm } from "@/components/ui/overlay";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import { TransferButton } from "@/components/transfer";
import { CompanyCell, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { AssetPicker, IdMultiSelect, PositionSelect, type PickedAsset } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import {
  BCM_LABELS,
  formatHours,
  PLAN_TYPES,
  TEST_RESULTS,
  TEST_TYPES,
  type PlanContact,
  type PlanDetail,
  type PlanInput,
  type PlanStatus,
  type PlanStep,
  type PlanTestInput,
  type TestResult,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { AlertTriangle, ArrowDown, ArrowUp, ClipboardCheck, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

const statusTone: Record<PlanStatus, Tone> = { draft: "amber", approved: "green", retired: "slate" };
const resultTone: Record<TestResult, Tone> = { passed: "green", partial: "amber", failed: "red" };

/** Záložky sekce Kontinuita. */
export function ContinuityTabs({ active }: { active: "bia" | "plans" }) {
  const t = useT();
  const tab = (on: boolean) => cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", on ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800");
  return (
    <div className="mb-6 flex gap-2 border-b border-slate-200">
      <Link to="/bia" className={tab(active === "bia")}>
        {t("plan.analyzaDopaduBia")}
      </Link>
      <Link to="/continuity/plans" className={tab(active === "plans")}>
        {t("plan.planyKontinuityAObnovy")}
      </Link>
      <Link to="/bia/cycles" className={tab(false)}>
        {t("plan.pravidelnePrezkoumaniBia")}
      </Link>
    </div>
  );
}

export function PlansPage() {
  const t = useT();
  const group = useGroupView();
  const can = useCan();
  const list = useQuery({ queryKey: ["plans"], queryFn: api.plans.list });
  const rows = list.data ?? [];
  const overdue = rows.filter((p) => p.testOverdue).length;
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("plan.kontinuitaPlanyKontinuityAObnovy")}
        subtitle={t("plan.15PismEVyhlC")}
        actions={
          can("bia:write") && (
            <Link to="/continuity/plans/new" search={{}}>
              <Button>
                <Plus size={16} /> {t("plan.novyPlan")}
              </Button>
            </Link>
          )
        }
      />
      <ContinuityTabs active="plans" />
      <ErrorBox error={list.error} />
      {overdue > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={15} color={STATUS_COLORS.serious} /> {overdue} {overdue === 1 ? t("plan.planMa") : t("plan.planyMaji")} {t("plan.testPoTerminu")}
        </div>
      )}
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState>{t("plan.zatimZadnyPlanZaloztePlan")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("plan.plan")}</th>
                <th className="px-3 py-2">{t("plan.typ")}</th>
                <th className="px-3 py-2">{t("plan.stav")}</th>
                <th className="px-3 py-2">{t("plan.procesy")}</th>
                <th className="px-3 py-2">{t("plan.ciloveRto")}</th>
                <th className="px-3 py-2">{t("plan.posledniTest")}</th>
                <th className="px-3 py-2">{t("plan.dalsiTest")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link to="/continuity/plans/$planId" params={{ planId: p.id }} className="font-medium hover:text-brand-700">
                      {p.code && <span className="mr-1.5 text-slate-500">{p.code}</span>}
                      {p.name}
                    </Link>
                    {group && <div><CompanyCell id={p.companyId} /></div>}
                    <div className="text-xs text-slate-500">{p.ownerPositionName ?? <span className="text-amber-700">{t("plan.bezVlastnika")}</span>}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{t.lbl(BCM_LABELS.planType[p.planType])}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <Badge tone={statusTone[p.status]}>{t.lbl(BCM_LABELS.status[p.status])}</Badge> <span className="text-xs text-slate-500">v{p.version}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{p.processes.map((x) => `${x.code ? `${x.code} ` : ""}${x.name}`).join(", ") || "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {formatHours(p.rtoTargetHours)}
                    {p.rtoFromBia && <span className="ml-1 text-xs text-slate-400">{t("plan.bia")}</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {p.lastTest ? (
                      <span className="whitespace-nowrap">
                        {fmtDay(p.lastTest.testedAt)} <Badge tone={resultTone[p.lastTest.result]}>{t.lbl(BCM_LABELS.result[p.lastTest.result])}</Badge>
                      </span>
                    ) : (
                      <span className="text-slate-400">{t("plan.netestovano")}</span>
                    )}
                  </td>
                  <td className={cn("px-3 py-2.5 whitespace-nowrap", p.testOverdue ? "font-medium text-red-700" : "text-slate-600")}>
                    {p.nextTestDue ? fmtDay(p.nextTestDue) : "—"}
                    {p.testOverdue && " ⚠"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export function PlanDetailPage() {
  const { planId } = useParams({ strict: false }) as { planId: string };
  const q = useQuery({ queryKey: ["plans", planId], queryFn: () => api.plans.get(planId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <PlanEditor key={`${q.data.id}:${q.data.version}:${q.data.status}`} plan={q.data} />;
}

export function PlanNewPage() {
  const search = useSearch({ strict: false }) as { processId?: string };
  return <PlanEditor plan={null} processId={search.processId} />;
}

type Form = {
  code: string;
  name: string;
  planType: PlanInput["planType"];
  ownerPositionId: string | null;
  purpose: string;
  scope: string;
  activation: string;
  strategy: string;
  resources: string;
  steps: PlanStep[];
  contacts: PlanContact[];
  rtoTargetHours: string;
  testIntervalMonths: number;
  lastReviewAt: string;
  processIds: string[];
  assets: PickedAsset[];
};

function PlanEditor({ plan, processId }: { plan: PlanDetail | null; processId?: string }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = plan ? plan.canEdit : can("bia:write");
  const [f, setF] = useState<Form>({
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    planType: plan?.planType ?? "continuity",
    ownerPositionId: plan?.ownerPositionId ?? null,
    purpose: plan?.purpose ?? "",
    scope: plan?.scope ?? "",
    activation: plan?.activation ?? "",
    strategy: plan?.strategy ?? "",
    resources: plan?.resources ?? "",
    steps: plan?.steps.map(({ responsiblePositionName: _, ...s }) => s) ?? [],
    contacts: plan?.contacts ?? [],
    rtoTargetHours: plan?.planRtoTargetHours != null ? String(plan.planRtoTargetHours) : "",
    testIntervalMonths: plan?.testIntervalMonths ?? 12,
    lastReviewAt: plan?.lastReviewAt ?? "",
    processIds: plan?.processes.map((p) => p.id) ?? (processId ? [processId] : []),
    assets: plan?.assets ?? [],
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const [testing, setTesting] = useState(false);

  const body = (): PlanInput => ({
    code: f.code || null,
    name: f.name,
    planType: f.planType,
    ownerPositionId: f.ownerPositionId,
    purpose: f.purpose || null,
    scope: f.scope || null,
    activation: f.activation || null,
    strategy: f.strategy || null,
    resources: f.resources || null,
    steps: f.steps.filter((s) => s.title.trim()),
    contacts: f.contacts.filter((c) => c.name.trim()),
    rtoTargetHours: f.rtoTargetHours === "" ? null : Number(f.rtoTargetHours),
    testIntervalMonths: f.testIntervalMonths,
    lastReviewAt: f.lastReviewAt || null,
    processIds: f.processIds,
    assetIds: f.assets.map((a) => a.id),
  });
  const done = (d: PlanDetail) => {
    qc.invalidateQueries({ queryKey: ["plans"] });
    qc.setQueryData(["plans", d.id], d);
    if (!plan) nav({ to: "/continuity/plans/$planId", params: { planId: d.id } });
  };
  const save = useMutation({ mutationFn: () => (plan ? api.plans.update(plan.id, body()) : api.plans.create(body())), onSuccess: done });
  const setStatus = useMutation({ mutationFn: (status: PlanStatus) => api.plans.update(plan!.id, { status }), onSuccess: done });
  const del = useMutation({
    mutationFn: () => api.plans.remove(plan!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plans"] });
      nav({ to: "/continuity/plans" });
    },
  });
  const delTest = useMutation({ mutationFn: (testId: string) => api.plans.deleteTest(plan!.id, testId), onSuccess: done });

  const step = (i: number, patch: Partial<PlanStep>) => set("steps", f.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: number) => {
    const a = [...f.steps];
    const [x] = a.splice(i, 1);
    a.splice(i + d, 0, x!);
    set("steps", a);
  };
  const contact = (i: number, patch: Partial<PlanContact>) => set("contacts", f.contacts.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/continuity/plans" className="hover:text-brand-700">
          {t("plan.planyKontinuityAObnovy")}
        </Link>
      </div>
      <PageHeader
        title={plan ? `${plan.code ? `${plan.code} ` : ""}${plan.name}` : t("plan.novyPlan")}
        subtitle={
          plan
            ? `${t.lbl(BCM_LABELS.planType[plan.planType])} · verze ${plan.version} · ${t.lbl(BCM_LABELS.status[plan.status])}${plan.approvedAt ? ` (${plan.approvedByName ?? "—"}, ${fmtDay(plan.approvedAt)})` : ""}`
            : t("plan.postupyProZachovaniAObnovu")
        }
        actions={
          <>
            {plan && can("bia:write") && plan.status === "draft" && (
              <Button variant="secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate("approved")}>
                <ShieldCheck size={16} /> {t("plan.schvalit")}
              </Button>
            )}
            {plan && can("bia:write") && plan.status === "approved" && (
              <Button variant="secondary" disabled={setStatus.isPending} onClick={async () => (await askConfirm(t("plan.zrusitPlatnostPlanu"))) && setStatus.mutate("retired")}>
                {t("plan.zrusitPlatnost")}
              </Button>
            )}
            {plan && can("bia:write") && <TransferButton entity="plans" id={plan.id} companyId={plan.companyId} />}
            {plan && can("bia:write") && (
              <Button variant="danger" onClick={async () => (await askConfirm(t("plan.smazatPlanVcetneZaznamuO"))) && del.mutate()}>
                <Trash2 size={16} />
              </Button>
            )}
            {edit && (
              <Button disabled={save.isPending || !f.name.trim()} onClick={() => save.mutate()}>
                {plan ? t("plan.ulozit") : t("common.create")}
              </Button>
            )}
          </>
        }
      />
      {plan?.status === "approved" && edit && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          {t("plan.planJeSchvalenyVecnaZmena", { p: plan.version + 1 })}
        </div>
      )}
      {save.isSuccess && <SuccessBox>{t("plan.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? setStatus.error ?? del.error ?? delTest.error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("plan.zakladniUdaje")} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("plan.kod")}>
                <Input value={f.code} disabled={!edit} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label={t("plan.nazev")}>
                <Input value={f.name} disabled={!edit} onChange={(e) => set("name", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("plan.typPlanu")}>
                <Select value={f.planType} disabled={!edit} onChange={(e) => set("planType", e.target.value as Form["planType"])}>
                  {PLAN_TYPES.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(BCM_LABELS.planType[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("plan.vlastnikFunkcniMisto")}>
                <PositionSelect value={f.ownerPositionId} disabled={!can("bia:write")} onChange={(v) => set("ownerPositionId", v)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("plan.ciloveRtoH")} hint={plan?.rtoFromBia ? `Z BIA: ${formatHours(plan.rtoTargetHours)}` : t("plan.prazdneNejprisnejsiRtoZBia")}>
                <Input type="number" min={0} step="0.5" value={f.rtoTargetHours} disabled={!edit} onChange={(e) => set("rtoTargetHours", e.target.value)} />
              </Field>
              <Field label={t("plan.intervalTestuMes")}>
                <Input type="number" min={1} max={36} value={f.testIntervalMonths} disabled={!edit} onChange={(e) => set("testIntervalMonths", Number(e.target.value) || 12)} />
              </Field>
              <Field label={t("plan.posledniPrezkum")}>
                <Input type="date" value={f.lastReviewAt} disabled={!edit} onChange={(e) => set("lastReviewAt", e.target.value)} />
              </Field>
            </div>
            <Field label={t("plan.ucel")}>
              <Textarea rows={2} value={f.purpose} disabled={!edit} onChange={(e) => set("purpose", e.target.value)} />
            </Field>
            <Field label={t("plan.rozsah")}>
              <Textarea rows={2} value={f.scope} disabled={!edit} onChange={(e) => set("scope", e.target.value)} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("plan.aktivaceAStrategie")} />
          <div className="space-y-4 p-5">
            <Field label={t("plan.kriteriaAOpravneniKAktivaci")} hint={t("plan.kdoAZaJakychPodminek")}>
              <Textarea rows={3} value={f.activation} disabled={!edit} onChange={(e) => set("activation", e.target.value)} />
            </Field>
            <Field label={t("plan.strategieNahradniReseni")} hint={t("plan.nouzovyRezimZalozniLokalitaRucni")}>
              <Textarea rows={3} value={f.strategy} disabled={!edit} onChange={(e) => set("strategy", e.target.value)} />
            </Field>
            <Field label={t("plan.potrebneZdroje")} hint={t("plan.lideTechnikaDodavateleZalohy")}>
              <Textarea rows={3} value={f.resources} disabled={!edit} onChange={(e) => set("resources", e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title={t("plan.procesyAAktiva")} subtitle={t("plan.planSeVztahujeKProcesum")} />
        <div className="grid gap-6 p-5 lg:grid-cols-2">
          {mod("processes") && can("processes:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("plan.procesy")}</div>
              <IdMultiSelect
                linkKind="process"
                value={f.processIds}
                onChange={(v) => set("processIds", v)}
                disabled={!edit}
                placeholder={t("plan.pridatProces")}
                emptyLabel={t("plan.zadneProcesy")}
                options={(processes.data ?? []).map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
                known={(plan?.processes ?? []).map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
              />
            </div>
          )}
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("plan.aktiva")}</div>
            <AssetPicker value={f.assets} onChange={(v) => set("assets", v)} disabled={!edit} />
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={t("plan.postupKroky")}
          subtitle={t("plan.poradiKrokuOdAktivacePlanu")}
          action={
            edit && (
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => set("steps", [...f.steps, { title: "", responsiblePositionId: null, targetMinutes: null }])}>
                <Plus size={14} /> {t("plan.krok")}
              </Button>
            )
          }
        />
        {f.steps.length === 0 ? (
          <EmptyState>{t("plan.zatimZadneKroky")}</EmptyState>
        ) : (
          <ol className="divide-y divide-slate-100">
            {f.steps.map((s, i) => (
              <li key={i} className="grid gap-3 px-5 py-3 md:grid-cols-[2rem_1fr_16rem_7rem_auto]">
                <div className="pt-2 text-sm font-semibold text-slate-500">{i + 1}.</div>
                <div className="space-y-2">
                  <Input placeholder={t("plan.krok")} value={s.title} disabled={!edit} onChange={(e) => step(i, { title: e.target.value })} />
                  <Textarea rows={1} placeholder={t("plan.popis")} value={s.description ?? ""} disabled={!edit} onChange={(e) => step(i, { description: e.target.value || null })} />
                </div>
                <div className="space-y-2">
                  <PositionSelect value={s.responsiblePositionId ?? null} disabled={!edit} onChange={(v) => step(i, { responsiblePositionId: v })} emptyLabel={t("plan.odpovednost")} />
                  <Input placeholder={t("plan.neboTextNaprDodavatel")} value={s.responsibleText ?? ""} disabled={!edit} onChange={(e) => step(i, { responsibleText: e.target.value || null })} />
                </div>
                <Field label={t("plan.doMin")}>
                  <Input
                    type="number"
                    min={0}
                    value={s.targetMinutes ?? ""}
                    disabled={!edit}
                    onChange={(e) => step(i, { targetMinutes: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </Field>
                {edit && (
                  <div className="flex items-start gap-0.5">
                    <Button variant="ghost" className="px-1.5 py-1" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("plan.nahoru")}>
                      <ArrowUp size={14} />
                    </Button>
                    <Button variant="ghost" className="px-1.5 py-1" disabled={i === f.steps.length - 1} onClick={() => move(i, 1)} aria-label={t("plan.dolu")}>
                      <ArrowDown size={14} />
                    </Button>
                    <Button variant="ghost" className="px-1.5 py-1 text-red-700" onClick={() => set("steps", f.steps.filter((_, j) => j !== i))} aria-label={t("plan.odebratKrok")}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader
          title={t("plan.kontakty")}
          subtitle={t("plan.krizovyTymDodavateleOrganyNukib")}
          action={
            edit && (
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => set("contacts", [...f.contacts, { name: "" }])}>
                <Plus size={14} /> {t("plan.kontakt")}
              </Button>
            )
          }
        />
        {f.contacts.length === 0 ? (
          <EmptyState>{t("plan.zatimZadneKontakty")}</EmptyState>
        ) : (
          <div className="divide-y divide-slate-100">
            {f.contacts.map((c, i) => (
              <div key={i} className="grid gap-2 px-5 py-2.5 md:grid-cols-[1fr_1fr_10rem_1fr_auto]">
                <Input placeholder={t("plan.jmenoSubjekt")} value={c.name} disabled={!edit} onChange={(e) => contact(i, { name: e.target.value })} />
                <Input placeholder={t("plan.role")} value={c.role ?? ""} disabled={!edit} onChange={(e) => contact(i, { role: e.target.value || null })} />
                <Input placeholder={t("plan.telefon")} value={c.phone ?? ""} disabled={!edit} onChange={(e) => contact(i, { phone: e.target.value || null })} />
                <Input placeholder={t("plan.eMail")} value={c.email ?? ""} disabled={!edit} onChange={(e) => contact(i, { email: e.target.value || null })} />
                {edit && (
                  <Button variant="ghost" className="px-1.5 py-1 text-red-700" onClick={() => set("contacts", f.contacts.filter((_, j) => j !== i))} aria-label={t("plan.odebratKontakt")}>
                    <Trash2 size={14} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {plan && (
        <Card className="mt-6 overflow-hidden">
          <CardHeader
            title={t("plan.testyPlanu")}
            subtitle={
              plan.nextTestDue
                ? t("plan.dalsiTestDo", { date: fmtDay(plan.nextTestDue), overdue: plan.testOverdue ? t("plan.poTerminu") : "", months: plan.testIntervalMonths })
                : t("plan.terminDalsihoTestuSePocita")
            }
            action={
              plan.canEdit && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setTesting(true)}>
                  <ClipboardCheck size={14} /> {t("plan.zaznamenatTest")}
                </Button>
              )
            }
          />
          {plan.tests.length === 0 ? (
            <EmptyState>{t("plan.planZatimNebylTestovan")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("plan.datum")}</th>
                  <th className="px-3 py-2">{t("plan.typ")}</th>
                  <th className="px-3 py-2">{t("plan.vysledek")}</th>
                  <th className="px-3 py-2">{t("plan.dosazeneRto")}</th>
                  <th className="px-3 py-2">{t("plan.zjisteniAZlepseni")}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plan.tests.map((tx) => (
                  <tr key={tx.id} className="align-top">
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      {fmtDay(tx.testedAt)}
                      {tx.createdByName && <div className="text-xs text-slate-500">{tx.createdByName}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {t.lbl(BCM_LABELS.testType[tx.testType])}
                      {tx.scenario && <div className="text-xs text-slate-500">{tx.scenario}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={resultTone[tx.result]}>{t.lbl(BCM_LABELS.result[tx.result])}</Badge>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                      {formatHours(tx.achievedRtoHours ?? null)}
                      {tx.rtoMet === false && <span className="ml-1 text-xs font-medium text-red-700">{t("plan.nesplneno")}</span>}
                      {tx.rtoMet === true && <span className="ml-1 text-xs text-emerald-700">{t("plan.splneno")}</span>}
                    </td>
                    <td className="max-w-md px-3 py-2.5 text-xs text-slate-600">
                      {tx.findings && <div>{tx.findings}</div>}
                      {tx.improvements && <div className="text-slate-500">{t("plan.zlepseni", { improvements: tx.improvements })}</div>}
                    </td>
                    <td className="px-3 py-2.5">
                      {can("bia:write") && (
                        <Button variant="ghost" className="px-1.5 py-1 text-red-700" onClick={async () => (await askConfirm(t("plan.smazatZaznamOTestu"))) && delTest.mutate(tx.id)} aria-label={t("plan.smazatTest")}>
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {testing && plan && <TestModal plan={plan} onClose={() => setTesting(false)} onDone={done} />}
    </>
  );
}

function TestModal({ plan, onClose, onDone }: { plan: PlanDetail; onClose: () => void; onDone: (d: PlanDetail) => void }) {
  const t = useT();
  const [f, setF] = useState<PlanTestInput & { rto: string }>({
    testedAt: new Date().toISOString().slice(0, 10),
    testType: "tabletop",
    result: "passed",
    scenario: "",
    participants: "",
    findings: "",
    improvements: "",
    rto: "",
  });
  const save = useMutation({
    mutationFn: () => {
      const { rto, ...rest } = f;
      return api.plans.addTest(plan.id, { ...rest, achievedRtoHours: rto === "" ? null : Number(rto) });
    },
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("plan.testPlanu", { name: plan.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("plan.ulozit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t("plan.datum")}>
          <Input type="date" value={f.testedAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set("testedAt", e.target.value)} />
        </Field>
        <Field label={t("plan.typTestu")}>
          <Select value={f.testType} onChange={(e) => set("testType", e.target.value)}>
            {TEST_TYPES.map((tx) => (
              <option key={tx} value={tx}>
                {t.lbl(BCM_LABELS.testType[tx])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("plan.vysledek")}>
          <Select value={f.result} onChange={(e) => set("result", e.target.value)}>
            {TEST_RESULTS.map((tx) => (
              <option key={tx} value={tx}>
                {t.lbl(BCM_LABELS.result[tx])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("plan.dosazeneRtoH")} hint={plan.rtoTargetHours != null ? t("plan.cil", { p: formatHours(plan.rtoTargetHours) }) : undefined}>
          <Input type="number" min={0} step="0.5" value={f.rto} onChange={(e) => set("rto", e.target.value)} />
        </Field>
      </div>
      <Field label={t("plan.scenar")}>
        <Textarea rows={2} value={f.scenario ?? ""} onChange={(e) => set("scenario", e.target.value)} />
      </Field>
      <Field label={t("plan.ucastnici")}>
        <Input value={f.participants ?? ""} onChange={(e) => set("participants", e.target.value)} />
      </Field>
      <Field label={t("plan.zjisteni")}>
        <Textarea rows={2} value={f.findings ?? ""} onChange={(e) => set("findings", e.target.value)} />
      </Field>
      <Field label={t("plan.navrzenaZlepseni")} hint={t("plan.promitneteJeDoNoveVerze")}>
        <Textarea rows={2} value={f.improvements ?? ""} onChange={(e) => set("improvements", e.target.value)} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
