import { askConfirm } from "@/components/ui/overlay";
import { LinkedRecordsCard } from "@/components/linkedRecords";
import { TasksCard } from "@/components/tasks";
import { useT } from "@/lib/i18n";
import { LinkedDocsCard } from "@/components/linkedDocs";
import { VersionsTab } from "./process/Versions";
import { TransferButton } from "@/components/transfer";
import { HealthIndicator } from "@/components/health";
import { AssetPicker, PartyPicker, PositionSelect, raciTone, UnitSelect, type PickedAsset, type RaciEntry } from "@/components/pickers";
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, criticalityTone, EmptyState, ErrorBox, Field, Input, Modal, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe, useModule } from "@/lib/auth";
import { cn, fmtDate } from "@/lib/utils";
import {
  CRITICALITIES,
  LABELS,
  PROCESS_LABELS,
  PROCESS_STATUSES,
  PROCESS_TYPES,
  RISK_LABELS,
  STEP_TYPES,
  type HealthStatus,
  type ProcessDetail,
  type ProcessInput,
  type StepDto,
  type StepType,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Building, ArrowDown, ArrowUp, CircleDot, Diamond, FileText, GitBranch, Layers, Pencil, Plus, Square, Trash2, Workflow } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { statusTone } from "./Processes";

const DiagramTab = lazy(() => import("./process/DiagramTab"));

const STEP_ICON: Record<StepType, typeof Square> = { task: Square, decision: Diamond, subprocess: Layers, event: CircleDot };

type Tab = "card" | "steps" | "diagram" | "assets" | "risks" | "versions";

export function ProcessDetailPage() {
  const t = useT();
  const me = useMe();
  const { processId } = useParams({ strict: false }) as { processId: string };
  const can = useCan();
  const mod = useModule();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["process", processId], queryFn: () => api.processes.get(processId) });
  const [tab, setTab] = useState<Tab>("steps");
  const del = useMutation({
    mutationFn: () => api.processes.remove(processId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["processes"] });
      nav({ to: "/processes" });
    },
  });
  const p = q.data;
  if (!p) return <ErrorBox error={q.error} />;

  const tabs: [Tab, string, number?][] = [
    ["steps", "Kroky", p.steps.length],
    ["diagram", t("prc.diagramBpmn")],
    ["card", t("prc.procesniKarta")],
    ["assets", t("prc.aktivaADokumenty"), p.assets.length + p.documents.length],
    ...(mod("risks") && can("risks:read") ? ([["risks", "Rizika", p.risks.length]] as [Tab, string, number][]) : []),
    ["versions", "Verze"],
  ];

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/processes" className="hover:text-brand-700">
          {t("prc.procesy")}
        </Link>
        {p.parentId && (
          <>
            {" › "}
            <Link to="/processes/$processId" params={{ processId: p.parentId }} className="hover:text-brand-700">
              {t("prc.nadrazenyProces")}
            </Link>
          </>
        )}
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {p.code && <span className="mr-2 text-slate-400">{p.code}</span>}
            {p.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {me.companies.length > 1 && (
              <Badge tone="blue">
                <Building size={11} className="mr-1" />
                {me.companies.find((c) => c.id === p.companyId)?.name ?? t("prc.spolecnostSkupiny")}
              </Badge>
            )}
            <Badge tone={statusTone[p.status]}>{t.lbl(PROCESS_LABELS.status[p.status])}</Badge>
            <Badge tone="violet">{t.lbl(PROCESS_LABELS.type[p.processType])}</Badge>
            <Badge tone={criticalityTone[p.criticality]}>{t("prc.kriticnost", { p: t.lbl(LABELS.criticality[p.criticality as keyof typeof LABELS.criticality]) })}</Badge>
            <span>
              {t("prc.vlastnik")} <b>{p.ownerPositionName ?? "—"}</b>
              {p.ownerHolders.length > 0 && ` (${p.ownerHolders.map((h) => h.displayName).join(", ")})`}
            </span>
            {p.orgUnitName && <span>· {p.orgUnitName}</span>}
            <span className="text-slate-400">
              {t("prc.verzeZmeneno", { version: p.version, p: fmtDate(p.updatedAt) })}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
        {can("processes:write") && <TransferButton entity="processes" id={p.id} companyId={p.companyId} />}
          {can("processes:write") && (
            <Button variant="danger" onClick={async () => (await askConfirm(t("prc.smazatProcesVcetneKrokuA", { name: p.name }))) && del.mutate()}>
              <Trash2 size={15} /> {t("prc.smazat")}
            </Button>
          )}
        </div>
      </div>
      <ErrorBox error={del.error} />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm",
              tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
            )}
          >
            {label}
            {n != null && n > 0 && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "steps" && <StepsTab p={p} />}
      {tab === "diagram" && (
        <Card>
          <Suspense fallback={<div className="p-5 text-sm text-slate-500">{t("prc.nacitamEditor")}</div>}>
            <DiagramTab process={p} />
          </Suspense>
        </Card>
      )}
      {tab === "card" && <CardTab p={p} />}
      {tab === "card" && <LinkedRecordsCard target="process" id={p.id} className="mt-6" />}
      {tab === "card" && <LinkedDocsCard kind="process" id={p.id} className="mt-6" />}
      {tab === "card" && <TasksCard kind="process" id={p.id} className="mt-6" />}
      {tab === "assets" && <AssetsTab p={p} />}
      {tab === "risks" && <RisksTab p={p} />}
      {tab === "versions" && <VersionsTab p={p} canEdit={p.canEdit} />}
    </>
  );
}

/* ============================ Kroky ============================ */

type StepForm = {
  id?: string;
  name: string;
  stepType: StepType;
  description: string;
  inputs: string;
  outputs: string;
  duration: string;
  systems: string;
  raci: RaciEntry[];
  assets: PickedAsset[];
};

const emptyStep = (): StepForm => ({ name: "", stepType: "task", description: "", inputs: "", outputs: "", duration: "", systems: "", raci: [], assets: [] });

function StepsTab({ p }: { p: ProcessDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<StepForm | null>(null);
  const [view, setView] = useState<"steps" | "raci">("steps");
  const refresh = () => qc.invalidateQueries({ queryKey: ["process", p.id] });
  const move = useMutation({
    mutationFn: (ids: string[]) => api.processes.reorder(p.id, ids),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (stepId: string) => api.processes.deleteStep(p.id, stepId), onSuccess: refresh });
  const swap = (i: number, j: number) => {
    const ids = p.steps.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    move.mutate(ids);
  };
  const toForm = (s: StepDto): StepForm => ({
    id: s.id,
    name: s.name,
    stepType: s.stepType,
    description: s.description ?? "",
    inputs: s.inputs ?? "",
    outputs: s.outputs ?? "",
    duration: s.duration ?? "",
    systems: s.systems ?? "",
    raci: s.raci.map((r) => ({ kind: r.kind, id: r.id, role: r.role, name: r.orgUnitName ? `${r.name} (${r.orgUnitName})` : r.name })),
    assets: s.assets,
  });

  return (
    <Card>
      <CardHeader
        title={t("prc.krokyProcesu")}
        subtitle={t("prc.popisJednotlivychCinnostiVPoradi")}
        action={
          <div className="flex gap-2">
            <div className="flex rounded-md border border-slate-300 p-0.5">
              {(
                [
                  ["steps", "Kroky"],
                  ["raci", t("prc.maticeRaci")],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setView(k)} className={cn("rounded px-2.5 py-1 text-sm", view === k ? "bg-brand-50 text-brand-700" : "text-slate-600")}>
                  {l}
                </button>
              ))}
            </div>
            {p.canEdit && (
              <Button onClick={() => setForm(emptyStep())}>
                <Plus size={15} /> {t("prc.krok")}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox error={move.error ?? del.error} />
      {p.steps.length === 0 ? (
        <EmptyState>{t("prc.procesZatimNemaPopsaneKroky")}</EmptyState>
      ) : view === "raci" ? (
        <RaciMatrix steps={p.steps} />
      ) : (
        <ol className="divide-y divide-slate-100">
          {p.steps.map((s, i) => {
            const Icon = STEP_ICON[s.stepType];
            return (
              <li key={s.id} className="flex gap-4 px-5 py-4">
                <div className="flex w-10 shrink-0 flex-col items-center gap-1">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{i + 1}</span>
                  <Icon size={14} className="text-slate-400" aria-label={t.lbl(PROCESS_LABELS.stepType[s.stepType])} />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{s.name}</span>
                    {s.stepType !== "task" && <Badge>{t.lbl(PROCESS_LABELS.stepType[s.stepType])}</Badge>}
                    {s.duration && <span className="text-xs text-slate-500">⏱ {s.duration}</span>}
                  </div>
                  {s.description && <p className="whitespace-pre-line text-sm text-slate-600">{s.description}</p>}
                  {(s.inputs || s.outputs || s.systems) && (
                    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                      {s.inputs && <Dt k="Vstupy" v={s.inputs} />}
                      {s.outputs && <Dt k={t("prc.vystupy")} v={s.outputs} />}
                      {s.systems && <Dt k={t("prc.systemyNastroje")} v={s.systems} />}
                    </dl>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {s.raci.map((r) => (
                      <span key={`${r.kind}${r.id}${r.role}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 py-0.5 pl-1 pr-2 text-xs" title={t.lbl(PROCESS_LABELS.raci[r.role])}>
                        <Badge tone={raciTone[r.role]}>{r.role}</Badge>
                        {r.name}
                      </span>
                    ))}
                    {s.assets.map((a) => (
                      <Link
                        key={a.id}
                        to="/assets/$assetId"
                        params={{ assetId: a.id }}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs hover:border-brand-300"
                      >
                        <HealthIndicator status={a.healthStatus as HealthStatus} size={12} />
                        {a.name}
                      </Link>
                    ))}
                  </div>
                </div>
                {p.canEdit && (
                  <div className="flex shrink-0 items-start gap-0.5">
                    <Button variant="ghost" className="px-1.5" disabled={i === 0 || move.isPending} onClick={() => swap(i, i - 1)} aria-label={t("prc.posunoutNahoru")}>
                      <ArrowUp size={15} />
                    </Button>
                    <Button variant="ghost" className="px-1.5" disabled={i === p.steps.length - 1 || move.isPending} onClick={() => swap(i, i + 1)} aria-label={t("prc.posunoutDolu")}>
                      <ArrowDown size={15} />
                    </Button>
                    <Button variant="ghost" className="px-1.5" onClick={() => setForm(toForm(s))} aria-label={t("prc.upravit")}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" className="px-1.5 text-red-600" onClick={async () => (await askConfirm(t("prc.smazatKrok", { name: s.name }))) && del.mutate(s.id)} aria-label={t("prc.smazat")}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {form && <StepModal p={p} form={form} setForm={setForm} />}
    </Card>
  );
}

const Dt = ({ k, v }: { k: string; v: string }) => (
  <div>
    <dt className="font-medium text-slate-500">{k}</dt>
    <dd className="whitespace-pre-line text-slate-700">{v}</dd>
  </div>
);

function RaciMatrix({ steps }: { steps: StepDto[] }) {
  const t = useT();
  const parties = useMemo(() => {
    const m = new Map<string, { key: string; name: string; sub?: string | null }>();
    for (const s of steps) for (const r of s.raci) m.set(`${r.kind}:${r.id}`, { key: `${r.kind}:${r.id}`, name: r.name, sub: r.orgUnitName });
    return [...m.values()];
  }, [steps]);
  if (!parties.length) return <EmptyState>{t("prc.krokyZatimNemajiPrirazeneOdpovednosti")}</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-5 py-2 text-left font-medium">{t("prc.krok")}</th>
            {parties.map((pt) => (
              <th key={pt.key} className="px-3 py-2 text-center font-medium">
                {pt.name}
                {pt.sub && <div className="font-normal text-slate-400">{pt.sub}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {steps.map((s, i) => (
            <tr key={s.id}>
              <td className="px-5 py-2">
                <span className="mr-2 text-slate-400">{i + 1}.</span>
                {s.name}
              </td>
              {parties.map((pt) => {
                const roles = s.raci.filter((r) => `${r.kind}:${r.id}` === pt.key).map((r) => r.role);
                return (
                  <td key={pt.key} className="px-3 py-2 text-center">
                    <span className="inline-flex gap-0.5">
                      {roles.map((r) => (
                        <Badge key={r} tone={raciTone[r]}>
                          {r}
                        </Badge>
                      ))}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-3 text-xs text-slate-500">
        {Object.entries(PROCESS_LABELS.raci)
          .map(([k, v]) => `${k} = ${t.lbl(v)}`)
          .join(" · ")}
        {t("prc.kazdyKrokByMelMit")}
      </p>
    </div>
  );
}

function StepModal({ p, form, setForm }: { p: ProcessDetail; form: StepForm; setForm: (f: StepForm | null) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name,
        stepType: form.stepType,
        description: form.description || null,
        inputs: form.inputs || null,
        outputs: form.outputs || null,
        duration: form.duration || null,
        systems: form.systems || null,
        raci: form.raci.map(({ kind, id, role }) => ({ kind, id, role })),
        assetIds: form.assets.map((a) => a.id),
      };
      return form.id ? api.processes.updateStep(p.id, form.id, body) : api.processes.createStep(p.id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["process", p.id] });
      setForm(null);
    },
  });
  const set = (k: keyof StepForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const accountable = form.raci.filter((r) => r.role === "A").length;
  return (
    <Modal
      open
      wide
      onClose={() => setForm(null)}
      title={form.id ? t("prc.upravitKrok") : t("prc.novyKrok")}
      footer={
        <>
          <Button variant="secondary" onClick={() => setForm(null)}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
            {t("prc.ulozit")}
          </Button>
        </>
      }
    >
      <ErrorBox error={save.error} />
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <Field label={t("prc.nazevKroku")}>
          <Input autoFocus value={form.name} onChange={set("name")} placeholder={t("prc.naprKontrolaPodkladuProVyplatu")} />
        </Field>
        <Field label={t("prc.typ")}>
          <Select value={form.stepType} onChange={set("stepType")}>
            {STEP_TYPES.map((tx) => (
              <option key={tx} value={tx}>
                {t.lbl(PROCESS_LABELS.stepType[tx])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("prc.popisCinnosti")}>
        <Textarea rows={4} value={form.description} onChange={set("description")} placeholder={t("prc.coPresneSeVKroku")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("prc.vstupy")}>
          <Textarea rows={2} value={form.inputs} onChange={set("inputs")} />
        </Field>
        <Field label={t("prc.vystupy")}>
          <Textarea rows={2} value={form.outputs} onChange={set("outputs")} />
        </Field>
        <Field label={t("prc.dobaTrvaniLhuta")}>
          <Input value={form.duration} onChange={set("duration")} placeholder={t("prc.naprDo5DneV")} />
        </Field>
        <Field label={t("prc.systemyNastrojeVolnyText")}>
          <Input value={form.systems} onChange={set("systems")} />
        </Field>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">{t("prc.odpovednostiRaci")}</div>
        <PartyPicker value={form.raci} onChange={(raci) => setForm({ ...form, raci })} />
        {form.raci.length > 0 && accountable !== 1 && (
          <p className="mt-1 text-xs text-amber-700">{t("prc.doporuceniKrokByMelMit", { accountable: accountable })}</p>
        )}
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-slate-700">{t("prc.aktivaPouzitaVKroku")}</div>
        <AssetPicker value={form.assets} onChange={(assets) => setForm({ ...form, assets })} />
      </div>
    </Modal>
  );
}

/* ============================ Procesní karta ============================ */

function CardTab({ p }: { p: ProcessDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const admin = can("processes:write");
  const init = (): ProcessInput => ({
    name: p.name,
    code: p.code,
    processType: p.processType,
    status: p.status,
    purpose: p.purpose,
    description: p.description,
    trigger: p.trigger,
    inputs: p.inputs,
    outputs: p.outputs,
    kpis: p.kpis,
    frequency: p.frequency,
    legislation: p.legislation,
    ownerPositionId: p.ownerPositionId,
    orgUnitId: p.orgUnitId,
    parentId: p.parentId,
    criticality: p.criticality as ProcessInput["criticality"],
  });
  const [f, setF] = useState<ProcessInput>(init);
  useEffect(() => setF(init()), [p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: admin });
  const save = useMutation({
    mutationFn: () => {
      const { ownerPositionId, parentId, ...rest } = f;
      return api.processes.update(p.id, admin ? f : rest);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["process", p.id] });
      qc.invalidateQueries({ queryKey: ["processes"] });
    },
  });
  const ro = !p.canEdit;
  const tx = (k: keyof ProcessInput, label: string, rows = 3, hint?: string) => (
    <Field label={label} hint={hint}>
      <Textarea rows={rows} disabled={ro} value={(f[k] as string) ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value || null })} />
    </Field>
  );

  return (
    <Card>
      <CardHeader title={t("prc.procesniKarta")} subtitle={t("prc.zakladniUdajeProcesuUcelHranice")} />
      <div className="space-y-5 p-5">
        {save.isSuccess && <SuccessBox>{t("prc.ulozeno")}</SuccessBox>}
        <ErrorBox error={save.error} />
        <div className="grid gap-4 md:grid-cols-[1fr_140px]">
          <Field label={t("prc.nazev")}>
            <Input disabled={ro} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t("prc.kod")}>
            <Input disabled={ro} value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value || null })} />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t("prc.typ")}>
            <Select disabled={ro} value={f.processType} onChange={(e) => setF({ ...f, processType: e.target.value as ProcessInput["processType"] })}>
              {PROCESS_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(PROCESS_LABELS.type[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.stav")}>
            <Select disabled={ro} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProcessInput["status"] })}>
              {PROCESS_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(PROCESS_LABELS.status[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.kriticnost2")}>
            <Select disabled={ro} value={f.criticality} onChange={(e) => setF({ ...f, criticality: e.target.value as ProcessInput["criticality"] })}>
              {CRITICALITIES.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(LABELS.criticality[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prc.vlastnikFunkcniMisto")} hint={!admin ? t("prc.meniSpravceProcesu") : undefined}>
            <PositionSelect disabled={!admin} value={f.ownerPositionId ?? null} onChange={(v) => setF({ ...f, ownerPositionId: v })} />
          </Field>
          <Field label={t("prc.garantujiciUtvar")}>
            <UnitSelect disabled={ro} companyId={p.companyId} value={f.orgUnitId ?? null} onChange={(v) => setF({ ...f, orgUnitId: v })} />
          </Field>
          <Field label={t("prc.nadrazenyProces2")}>
            <Select disabled={!admin} value={f.parentId ?? ""} onChange={(e) => setF({ ...f, parentId: e.target.value || null })}>
              <option value="">{t("common.noneOption")}</option>
              {(others.data ?? [])
                .filter((x) => x.id !== p.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code ? `${x.code} ` : ""}
                    {x.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        {tx("purpose", t("prc.ucelACilProcesu"), 2)}
        {tx("description", "Popis / rozsah (hranice procesu)", 4)}
        <div className="grid gap-4 md:grid-cols-2">
          {tx("trigger", t("prc.spoustecCoProcesZahajuje"), 2)}
          <Field label={t("prc.frekvence")}>
            <Input disabled={ro} value={f.frequency ?? ""} onChange={(e) => setF({ ...f, frequency: e.target.value || null })} placeholder={t("prc.mesicneNaVyzadani")} />
          </Field>
          {tx("inputs", "Vstupy", 3)}
          {tx("outputs", t("prc.vystupy"), 3)}
          {tx("kpis", t("prc.meritkaVykonnostiKpi"), 3)}
          {tx("legislation", t("prc.legislativaAInterniPredpisy"), 3, t("prc.naprZakonOKybernetickeBezpecnosti"))}
        </div>
        {p.children.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t("prc.podprocesy")}</div>
            <div className="flex flex-wrap gap-2 text-sm">
              {p.children.map((c) => (
                <Link key={c.id} to="/processes/$processId" params={{ processId: c.id }} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                  <GitBranch size={13} /> {c.code && `${c.code} `}
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        )}
        {!ro && (
          <div className="flex justify-end">
            <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {t("prc.ulozitKartu")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ============================ Aktiva a dokumenty ============================ */

function AssetsTab({ p }: { p: ProcessDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const direct = p.assets.filter((a) => !a.viaSteps);
  const [picked, setPicked] = useState<PickedAsset[]>(direct);
  useEffect(() => setPicked(p.assets.filter((a) => !a.viaSteps)), [p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [doc, setDoc] = useState({ title: "", url: "", docType: "" });
  const [docOpen, setDocOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["process", p.id] });
  const saveAssets = useMutation({ mutationFn: () => api.processes.setAssets(p.id, picked.map((a) => a.id)), onSuccess: refresh });
  const addDoc = useMutation({
    mutationFn: () => api.processes.addDocument(p.id, { title: doc.title, url: doc.url || null, docType: doc.docType || null }),
    onSuccess: () => {
      refresh();
      setDocOpen(false);
      setDoc({ title: "", url: "", docType: "" });
    },
  });
  const delDoc = useMutation({ mutationFn: (id: string) => api.processes.removeDocument(p.id, id), onSuccess: refresh });
  const changed = picked.map((a) => a.id).sort().join() !== direct.map((a) => a.id).sort().join();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("prc.aktivaProcesu")} subtitle={t("prc.primarniAktivaInformaceSluzbySe")} />
        <div className="space-y-4 p-5">
          <ErrorBox error={saveAssets.error} />
          {p.canEdit && (
            <>
              <AssetPicker value={picked} onChange={setPicked} />
              {changed && (
                <div className="flex justify-end">
                  <Button onClick={() => saveAssets.mutate()} disabled={saveAssets.isPending}>
                    {t("prc.ulozitAktiva")}
                  </Button>
                </div>
              )}
            </>
          )}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {p.assets.map((a) => (
                <tr key={a.id}>
                  <td className="py-2">
                    <Link to="/assets/$assetId" params={{ assetId: a.id }} className="inline-flex items-center gap-2 hover:text-brand-700">
                      <HealthIndicator status={a.healthStatus as HealthStatus} size={15} />
                      {a.name}
                    </Link>
                  </td>
                  <td className="py-2 text-slate-500">{t.lbl(LABELS.assetType[a.assetType as keyof typeof LABELS.assetType]) ?? a.assetType}</td>
                  <td className="py-2 text-right">{a.viaSteps ? <Badge>{t("prc.zKroku")}</Badge> : <Badge tone="blue">{t("prc.primo")}</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.assets.length === 0 && <p className="text-sm text-slate-400">{t("prc.zadnaAktiva")}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t("prc.dokumenty")}
          subtitle={t("prc.smerniceFormularePracovniPostupyOdkazy")}
          action={
            p.canEdit && (
              <Button variant="secondary" onClick={() => setDocOpen(true)}>
                <Plus size={15} /> {t("prc.dokument")}
              </Button>
            )
          }
        />
        <ErrorBox error={delDoc.error} />
        {p.documents.length === 0 ? (
          <EmptyState>{t("prc.zadneDokumenty")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {p.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <FileText size={16} className="text-slate-400" />
                <div className="min-w-0 flex-1">
                  {d.url && /^https?:/i.test(d.url) ? (
                    <a href={d.url} target="_blank" rel="noreferrer noopener" className="text-brand-600 hover:underline">
                      {d.title}
                    </a>
                  ) : (
                    <span>{d.title}</span>
                  )}
                  {d.url && !/^https?:/i.test(d.url) && <div className="truncate text-xs text-slate-500">{d.url}</div>}
                </div>
                {d.docType && <Badge>{d.docType}</Badge>}
                {p.canEdit && (
                  <Button variant="ghost" className="px-1.5 text-red-600" onClick={() => delDoc.mutate(d.id)} aria-label={t("prc.odebrat")}>
                    <Trash2 size={14} />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={docOpen}
        onClose={() => setDocOpen(false)}
        title={t("prc.pridatDokument")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDocOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button disabled={!doc.title.trim() || addDoc.isPending} onClick={() => addDoc.mutate()}>
              {t("prc.pridat")}
            </Button>
          </>
        }
      >
        <ErrorBox error={addDoc.error} />
        <Field label={t("prc.nazev")}>
          <Input autoFocus value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
        </Field>
        <Field label={t("prc.odkaz")} hint={t("prc.httpsFileNeboServerSdilena")}>
          <Input value={doc.url} onChange={(e) => setDoc({ ...doc, url: e.target.value })} />
        </Field>
        <Field label={t("prc.druh")}>
          <Input value={doc.docType} onChange={(e) => setDoc({ ...doc, docType: e.target.value })} placeholder={t("prc.smerniceFormularPostup")} />
        </Field>
      </Modal>
    </div>
  );
}

/* ============================ Rizika ============================ */

function RisksTab({ p }: { p: ProcessDetail }) {
  const t = useT();
  const can = useCan();
  return (
    <Card>
      <CardHeader
        title={t("prc.rizikaProcesu")}
        subtitle={t("prc.rizikaNavazanaNaTentoProces")}
        action={
          can("risks:write") && (
            <Link to="/risks/new" search={{ processId: p.id }}>
              <Button variant="secondary">
                <Plus size={15} /> {t("prc.noveRiziko")}
              </Button>
            </Link>
          )
        }
      />
      {p.risks.length === 0 ? (
        <EmptyState>{t("prc.kProcesuNejsouEvidovanaZadna")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {p.risks.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <Workflow size={15} className="text-slate-300" />
              <Link to="/risks/$riskId" params={{ riskId: r.id }} className="flex-1 hover:text-brand-700">
                {r.code && <span className="mr-2 text-slate-500">{r.code}</span>}
                {r.name}
              </Link>
              <RiskLevelBadge level={r.level} />
              <Badge>{t.lbl(RISK_LABELS.status[r.status as keyof typeof RISK_LABELS.status]) ?? r.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
