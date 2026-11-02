import { useFormGuard } from "@/lib/unsaved";
import { askConfirm } from "@/components/ui/overlay";
import { AiSuggestPanel } from "@/components/ai";
import { SimilarRecordsCard } from "@/components/records";
import { TasksCard } from "@/components/tasks";
import { CompanyCell, TargetCompanyField, useGroupView, useTargetCompany } from "@/components/company";
import { AssetPicker, IdMultiSelect, PositionSelect, type PickedAsset } from "@/components/pickers";
import { TransferButton } from "@/components/transfer";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, PageHeader, Select, SuccessBox, Textarea, toggle, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDay } from "@/lib/utils";
import {
  AIACT_LABELS,
  AI_ANNEX_III,
  AI_CLASS_ORDER,
  AI_EXCEPTIONS,
  AI_OBLIGATION_STATUSES,
  AI_PROHIBITED,
  AI_ROLES,
  AI_SOURCES,
  AI_SYSTEM_STATUSES,
  AI_TRANSPARENCY,
  EMPTY_SCREENING,
  FRIA_FIELDS,
  classifyAiSystem,
  friaMissing,
  type AiException,
  type AiObligationStatus,
  type AiRiskClass,
  type AiRole,
  type AiScreening,
  type AiSource,
  type AiSystemDto,
  type AiSystemInput,
  type AiSystemStatus,
  type FriaField,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, BookOpen, CheckCircle2, FileDown, Plus, Printer, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useState } from "react";

export const clsTone: Record<AiRiskClass, Tone> = { prohibited: "red", high: "amber", limited: "blue", minimal: "green", unassessed: "slate" };
const statusTone: Record<AiSystemStatus, Tone> = { proposed: "amber", approved: "blue", in_use: "green", rejected: "red", retired: "slate" };
const oblTone: Record<AiObligationStatus, Tone> = { open: "red", in_progress: "amber", done: "green", na: "slate" };

/* ============================ přehled a registr ============================ */

export function AiActPage() {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const nav = useNavigate();
  const [status, setStatus] = useState<"all" | AiSystemStatus>("all");
  const q = useQuery({ queryKey: ["aiact", status], queryFn: () => api.aiact.list(status) });
  const sum = useQuery({ queryKey: ["aiact", "summary"], queryFn: () => api.aiact.summary() });
  const rows = [...(q.data ?? [])].sort((a, b) => AI_CLASS_ORDER.indexOf(a.classification.cls) - AI_CLASS_ORDER.indexOf(b.classification.cls) || a.name.localeCompare(b.name));
  const s = sum.data;
  return (
    <>
      <PageHeader
        title={t("aia.title")}
        subtitle={t("aia.subtitle")}
        actions={
          <>
            {!group && (
              <>
                <a href={api.aiact.registerHtmlUrl()} target="_blank" rel="noreferrer">
                  <Button variant="secondary">
                    <Printer size={16} /> {t("aia.register")}
                  </Button>
                </a>
                <a href={api.aiact.registerDocxUrl()}>
                  <Button variant="secondary">
                    <FileDown size={16} /> {t("aia.word")}
                  </Button>
                </a>
              </>
            )}
            {can("aiact:write") && (
              <Button onClick={() => nav({ to: "/aiact/new" })}>
                <Plus size={16} /> {t("aia.newSystem")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={q.error ?? sum.error} />
      {s && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="aiact-summary">
          {AI_CLASS_ORDER.map((k) => (
            <Card key={k} className="p-4">
              <div className="text-2xl font-semibold">{s.byClass[k]}</div>
              <div className="mt-1">
                <Badge tone={clsTone[k]}>{t.lbl(AIACT_LABELS.cls[k])}</Badge>
              </div>
            </Card>
          ))}
          <Card className="p-4">
            <div className="text-2xl font-semibold">{s.withGaps}</div>
            <div className="mt-1 text-xs text-slate-500">{t("aia.withGaps")}</div>
            {s.friaOpen > 0 && <div className="mt-1 text-xs text-red-700">{t("aia.friaOpen", { n: s.friaOpen })}</div>}
          </Card>
        </div>
      )}

      <div className="mb-6 grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Select className="w-52" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t("aia.status")}>
              <option value="all">{t("aia.allStatuses")}</option>
              {AI_SYSTEM_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(AIACT_LABELS.status[x])}
                </option>
              ))}
            </Select>
          </div>
          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState>{q.isLoading ? t("common.loading") : t("aia.empty")}</EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2">{t("aia.system")}</th>
                    <th className="px-3 py-2">{t("aia.class")}</th>
                    <th className="px-3 py-2">{t("aia.obligations")}</th>
                    <th className="px-3 py-2">{t("aia.review")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((a) => {
                    const done = a.obligations.filter((o) => o.status === "done" || o.status === "na").length;
                    return (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-5 py-2.5">
                          <Link to="/aiact/$systemId" params={{ systemId: a.id }} className="font-medium hover:text-brand-700">
                            {a.code && <span className="mr-1.5 text-slate-500">{a.code}</span>}
                            {a.name}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                            <Badge tone={statusTone[a.status]}>{t.lbl(AIACT_LABELS.status[a.status])}</Badge>
                            {t.lbl(AIACT_LABELS.role[a.role])}
                            {a.vendor && <span>· {a.vendor}</span>}
                            {a.gaps.length > 0 && <span className="text-amber-800">{t("aia.gapsN", { n: a.gaps.length })}</span>}
                          </div>
                          {group && <CompanyCell id={a.companyId} />}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={clsTone[a.classification.cls]}>{t.lbl(AIACT_LABELS.cls[a.classification.cls])}</Badge>
                          {a.friaRequired && <div className="mt-0.5 text-xs text-slate-500">FRIA: {a.fria?.status === "completed" ? t("aia.done") : t("aia.missing")}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{a.obligations.length ? `${done} / ${a.obligations.length}` : "—"}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{a.nextReview ? fmtDay(a.nextReview) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <LiteracyCard />
          <Card>
            <CardHeader title={t("aia.timeline")} />
            <ul className="space-y-1.5 p-5 pt-0 text-sm text-slate-700">
              <li>
                <b>2. 2. 2025</b> – {t("aia.tl.1")}
              </li>
              <li>
                <b>2. 8. 2026</b> – {t("aia.tl.2")}
              </li>
              <li>
                <b>2. 12. 2026</b> – {t("aia.tl.3")}
              </li>
              <li>
                <b>2. 12. 2027</b> – {t("aia.tl.4")}
              </li>
              <li>
                <b>2. 8. 2028</b> – {t("aia.tl.5")}
              </li>
            </ul>
            <p className="px-5 pb-4 text-xs text-slate-500">{t("aia.tl.note")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function LiteracyCard() {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const group = useGroupView();
  const target = useTargetCompany();
  const nav = useNavigate();
  const [course, setCourse] = useState(can("awareness:write") && mod("awareness"));
  const sum = useQuery({ queryKey: ["aiact", "summary"], queryFn: () => api.aiact.summary() });
  const create = useMutation({
    mutationFn: () => api.aiact.directive({ companyId: target.companyId, course }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["aiact"] });
      qc.invalidateQueries({ queryKey: ["policies"] });
      nav({ to: "/policies/$policyId", params: { policyId: r.directiveId } });
    },
  });
  const s = sum.data;
  const canCreate = can("aiact:write") && can("policies:write") && mod("policies");
  return (
    <Card data-testid="aiact-literacy">
      <CardHeader title={t("aia.literacy")} subtitle={t("aia.literacySub")} />
      <div className="space-y-3 p-5 pt-0 text-sm">
        {s?.directive ? (
          <div className="flex items-center gap-2">
            <BookOpen size={15} className="text-slate-400" />
            <Link to="/policies/$policyId" params={{ policyId: s.directive.id }} className="font-medium hover:text-brand-700">
              {s.directive.title}
            </Link>
          </div>
        ) : (
          <p className="text-slate-600">{t("aia.noDirective")}</p>
        )}
        {s?.literacy.map((c) => (
          <div key={c.id}>
            <Link to="/awareness/$courseId" params={{ courseId: c.id }} className="hover:text-brand-700">
              {c.title}
            </Link>
            <div className="text-xs text-slate-500">{t("aia.literacyStats", { ok: c.ok, required: c.required, overdue: c.overdue, missing: c.missing })}</div>
          </div>
        ))}
        {s && !s.literacy.length && <p className="text-xs text-amber-800">{t("aia.noLiteracyCourse")}</p>}
        {!s?.directive && canCreate && !group && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            {can("awareness:write") && mod("awareness") && <Checkbox checked={course} onChange={setCourse} label={t("aia.withCourse")} />}
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              <Plus size={15} /> {t("aia.createDirective")}
            </Button>
            <p className="text-xs text-slate-500">{t("aia.createDirectiveHint")}</p>
          </div>
        )}
        <ErrorBox error={create.error} />
      </div>
    </Card>
  );
}

/* ============================ detail ============================ */

export function AiActNewPage() {
  return <AiSystemEditor a={null} />;
}

export function AiActDetailPage() {
  const { systemId } = useParams({ strict: false }) as { systemId: string };
  const q = useQuery({ queryKey: ["aiact", "detail", systemId], queryFn: () => api.aiact.get(systemId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <AiSystemEditor key={q.data.id + q.data.updatedAt} a={q.data} />;
}

function AiSystemEditor({ a }: { a: AiSystemDto | null }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const target = useTargetCompany();
  const edit = a ? a.canEdit : can("aiact:write");
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.suppliers.list({ withGroup: "1" }), enabled: mod("suppliers") && can("suppliers:read") });
  const activities = useQuery({ queryKey: ["gdpr", "all"], queryFn: () => api.gdpr.list("all"), enabled: mod("gdpr") && can("gdpr:read") });
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });
  const codeName = (x: { code?: string | null; name: string }) => (x.code ? `${x.code} ${x.name}` : x.name);
  const [f, setF] = useState({
    code: a?.code ?? "",
    name: a?.name ?? "",
    vendor: a?.vendor ?? "",
    model: a?.model ?? "",
    role: (a?.role ?? "deployer") as AiRole,
    source: (a?.source ?? "saas") as AiSource,
    status: (a?.status ?? "proposed") as AiSystemStatus,
    purpose: a?.purpose ?? "",
    description: a?.description ?? "",
    users: a?.users ?? "",
    inputData: a?.inputData ?? "",
    outputs: a?.outputs ?? "",
    humanOversight: a?.humanOversight ?? "",
    dataLocation: a?.dataLocation ?? "",
    instructionsUrl: a?.instructionsUrl ?? "",
    logRetentionMonths: a?.logRetentionMonths ?? null,
    ownerPositionId: a?.ownerPositionId ?? null,
    oversightPositionId: a?.oversightPositionId ?? null,
    reviewMonths: a?.reviewMonths ?? 12,
    processIds: a?.processes.map((x) => x.id) ?? [],
    assets: (a?.assets ?? []) as PickedAsset[],
    supplierIds: a?.suppliers.map((x) => x.id) ?? [],
    activityIds: a?.activities.map((x) => x.id) ?? [],
    riskIds: a?.risks.map((x) => x.id) ?? [],
    controlIds: a?.controls.map((x) => x.id) ?? [],
  });
  const [sc, setSc] = useState<AiScreening>(a?.screening ?? EMPTY_SCREENING);
  const [scTouched, setScTouched] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setS = <K extends keyof AiScreening>(k: K, v: AiScreening[K]) => {
    setScTouched(true);
    setSc((x) => ({ ...x, [k]: v }));
  };
  const nul = (v: string) => v.trim() || null;
  const body = (): AiSystemInput => ({
    ...(a ? {} : { companyId: target.companyId }),
    code: nul(f.code),
    name: f.name,
    vendor: nul(f.vendor),
    model: nul(f.model),
    role: f.role,
    source: f.source,
    status: f.status,
    purpose: f.purpose,
    description: nul(f.description),
    users: nul(f.users),
    inputData: nul(f.inputData),
    outputs: nul(f.outputs),
    humanOversight: nul(f.humanOversight),
    dataLocation: nul(f.dataLocation),
    instructionsUrl: nul(f.instructionsUrl),
    logRetentionMonths: f.logRetentionMonths,
    ownerPositionId: f.ownerPositionId,
    oversightPositionId: f.oversightPositionId,
    reviewMonths: f.reviewMonths,
    processIds: f.processIds,
    assetIds: f.assets.map((x) => x.id),
    supplierIds: f.supplierIds,
    activityIds: f.activityIds,
    riskIds: f.riskIds,
    controlIds: f.controlIds,
    ...(scTouched ? { screening: sc } : {}),
  });
  const onSaved = (d: AiSystemDto) => {
    qc.invalidateQueries({ queryKey: ["aiact"] });
    qc.setQueryData(["aiact", "detail", d.id], d);
  };
  const save = useMutation({
    mutationFn: () => (a ? api.aiact.update(a.id, body()) : api.aiact.create(body())),
    onSuccess: (d) => {
      onSaved(d);
      if (!a) nav({ to: "/aiact/$systemId", params: { systemId: d.id } });
    },
  });
  const guard = useFormGuard(save);
  const review = useMutation({ mutationFn: () => api.aiact.review(a!.id), onSuccess: onSaved });
  const del = useMutation({
    mutationFn: () => api.aiact.remove(a!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["aiact"] });
      nav({ to: "/aiact" });
    },
  });
  const preview = classifyAiSystem(scTouched || a?.screening ? sc : null);
  const statuses = AI_SYSTEM_STATUSES.filter((s) => s === f.status || (s !== "approved" && s !== "rejected"));
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/aiact" className="hover:text-brand-700">
          {t("aia.title")}
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a ? `${a.code ? `${a.code} ` : ""}${a.name}` : t("aia.newSystemTitle")}</h1>
          {a && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Badge tone={statusTone[a.status]}>{t.lbl(AIACT_LABELS.status[a.status])}</Badge>
              <Badge tone={clsTone[a.classification.cls]}>{t.lbl(AIACT_LABELS.cls[a.classification.cls])}</Badge>
              <span>{t.lbl(AIACT_LABELS.role[a.role])}</span>
              <span>{t("aia.ownerIs", { p: a.ownerPositionName ?? "—" })}</span>
              <span>{t("aia.reviewIs", { last: a.lastReviewedAt ? fmtDay(a.lastReviewedAt) : "—", next: a.nextReview ? fmtDay(a.nextReview) : "—" })}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {a && can("aiact:write") && <TransferButton entity="ai_systems" id={a.id} companyId={a.companyId} />}
          {a && edit && a.decision && (
            <Button variant="secondary" disabled={review.isPending} onClick={() => review.mutate()}>
              <CheckCircle2 size={15} /> {t("aia.confirmReview")}
            </Button>
          )}
          {a && can("aiact:write") && (
            <Button variant="danger" aria-label={t("aia.delete")} onClick={async () => (await askConfirm(t("aia.deleteConfirm"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          )}
          {edit && (
            <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {a ? t("aia.save") : t("common.create")}
            </Button>
          )}
        </div>
      </div>
      {save.isSuccess && a && <SuccessBox>{t("aia.saved")}</SuccessBox>}
      <ErrorBox error={save.error ?? review.error ?? del.error} />
      {a && a.gaps.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/50 p-4" data-testid="aiact-gaps">
          <div className="mb-1 text-sm font-medium text-amber-900">{t("aia.gapsTitle")}</div>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {a.gaps.map((g) => (
              <li key={g}>{t.lbl(AIACT_LABELS.gap[g])}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("aia.basics")} subtitle={t("aia.basicsSub")} />
          <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
            {!a && <TargetCompanyField value={target.companyId} onChange={target.setCompanyId} />}
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("aia.code")}>
                <Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="AI-01" />
              </Field>
              <Field label={t("aia.name")}>
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("aia.namePh")} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aia.vendor")}>
                <Input value={f.vendor} onChange={(e) => set("vendor", e.target.value)} />
              </Field>
              <Field label={t("aia.model")}>
                <Input value={f.model} onChange={(e) => set("model", e.target.value)} placeholder={t("aia.modelPh")} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("aia.role")}>
                <Select value={f.role} onChange={(e) => set("role", e.target.value as AiRole)}>
                  {AI_ROLES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(AIACT_LABELS.role[x])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("aia.source")}>
                <Select value={f.source} onChange={(e) => set("source", e.target.value as AiSource)}>
                  {AI_SOURCES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(AIACT_LABELS.source[x])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("aia.status")}>
                <Select value={f.status} onChange={(e) => set("status", e.target.value as AiSystemStatus)}>
                  {statuses.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(AIACT_LABELS.status[x])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("aia.purpose")} hint={t("aia.purposeHint")}>
              <Textarea rows={3} value={f.purpose} onChange={(e) => set("purpose", e.target.value)} />
            </Field>
            <Field label={t("aia.users")} hint={t("aia.usersHint")}>
              <Input value={f.users} onChange={(e) => set("users", e.target.value)} />
            </Field>
            <Field label={t("aia.inputData")} hint={t("aia.inputDataHint")}>
              <Textarea rows={2} value={f.inputData} onChange={(e) => set("inputData", e.target.value)} />
            </Field>
            <Field label={t("aia.outputs")} hint={t("aia.outputsHint")}>
              <Textarea rows={2} value={f.outputs} onChange={(e) => set("outputs", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aia.dataLocation")}>
                <Input value={f.dataLocation} onChange={(e) => set("dataLocation", e.target.value)} placeholder={t("aia.dataLocationPh")} />
              </Field>
              <Field label={t("aia.logRetention")} hint={t("aia.logRetentionHint")}>
                <Input type="number" min={0} max={240} value={f.logRetentionMonths ?? ""} onChange={(e) => set("logRetentionMonths", e.target.value === "" ? null : Number(e.target.value))} />
              </Field>
            </div>
            <Field label={t("aia.instructionsUrl")}>
              <Input value={f.instructionsUrl} onChange={(e) => set("instructionsUrl", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aia.owner")}>
                <PositionSelect value={f.ownerPositionId} onChange={(v) => set("ownerPositionId", v)} disabled={!can("aiact:write")} />
              </Field>
              <Field label={t("aia.oversight")}>
                <PositionSelect value={f.oversightPositionId} onChange={(v) => set("oversightPositionId", v)} />
              </Field>
            </div>
            <Field label={t("aia.humanOversight")} hint={t("aia.humanOversightHint")}>
              <Textarea rows={2} value={f.humanOversight} onChange={(e) => set("humanOversight", e.target.value)} />
            </Field>
            <Field label={t("aia.description")}>
              <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label={t("aia.reviewMonths")}>
              <Input type="number" min={1} max={60} value={f.reviewMonths} onChange={(e) => set("reviewMonths", Number(e.target.value) || 12)} />
            </Field>
          </fieldset>
        </Card>

        <div className="space-y-6">
          <Card data-testid="aiact-screening">
            <CardHeader title={t("aia.screening")} subtitle={t("aia.screeningSub")} />
            <fieldset disabled={!edit} {...guard.bind} className="space-y-5 p-5">
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-500">{t("aia.resultClass")}</span>
                <Badge tone={clsTone[preview.cls]}>{t.lbl(AIACT_LABELS.cls[preview.cls])}</Badge>
                {preview.reasons.length > 0 && <span className="text-xs text-slate-500">{preview.reasons.join("; ")}</span>}
                {preview.annexIIIExempt && <span className="text-xs text-slate-500">{t("aia.exemptNote")}</span>}
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium text-red-800">{t("aia.q.prohibited")}</div>
                <div className="space-y-1">
                  {AI_PROHIBITED.map((p) => (
                    <Checkbox key={p.key} checked={sc.prohibited.includes(p.key)} onChange={(v) => setS("prohibited", toggle(sc.prohibited, p.key, v))} label={t.lbl(AIACT_LABELS.prohibited[p.key])} hint={p.ref} />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium">{t("aia.q.annexIII")}</div>
                <div className="space-y-1">
                  {AI_ANNEX_III.map((p) => (
                    <Checkbox key={p.key} checked={sc.annexIII.includes(p.key)} onChange={(v) => setS("annexIII", toggle(sc.annexIII, p.key, v))} label={t.lbl(AIACT_LABELS.annexIII[p.key])} hint={p.ref} />
                  ))}
                </div>
                {sc.annexIII.length > 0 && (
                  <div className="mt-3 space-y-2 rounded-md border border-slate-200 p-3">
                    <Field label={t("aia.q.exception")} hint={t("aia.q.exceptionHint")}>
                      <Select value={sc.exception ?? ""} onChange={(e) => setS("exception", (e.target.value || null) as AiException | null)}>
                        <option value="">{t("aia.q.noException")}</option>
                        {AI_EXCEPTIONS.map((x) => (
                          <option key={x} value={x}>
                            {t.lbl(AIACT_LABELS.exception[x])}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Checkbox checked={sc.profiling} onChange={(v) => setS("profiling", v)} label={t("aia.q.profiling")} />
                  </div>
                )}
              </div>
              <Checkbox checked={sc.annexI} onChange={(v) => setS("annexI", v)} label={t("aia.q.annexI")} hint={t("aia.q.annexIHint")} />
              <div>
                <div className="mb-1.5 text-sm font-medium">{t("aia.q.transparency")}</div>
                <div className="space-y-1">
                  {AI_TRANSPARENCY.map((p) => (
                    <Checkbox key={p.key} checked={sc.transparency.includes(p.key)} onChange={(v) => setS("transparency", toggle(sc.transparency, p.key, v))} label={t.lbl(AIACT_LABELS.transparency[p.key])} hint={p.ref} />
                  ))}
                </div>
              </div>
              <div className="space-y-1 border-t border-slate-100 pt-4">
                <Checkbox checked={sc.publicService} onChange={(v) => setS("publicService", v)} label={t("aia.q.publicService")} hint={t("aia.q.publicServiceHint")} />
                <Checkbox checked={sc.personalData} onChange={(v) => setS("personalData", v)} label={t("aia.q.personalData")} />
                <Checkbox checked={sc.gpai} onChange={(v) => setS("gpai", v)} label={t("aia.q.gpai")} />
              </div>
              {scTouched && <p className="text-xs text-amber-800">{t("aia.screeningUnsaved")}</p>}
            </fieldset>
          </Card>

          <Card>
            <CardHeader title={t("aia.links")} subtitle={t("aia.linksSub")} />
            <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
              {mod("processes") && (
                <Field label={t("aia.processes")}>
                  <IdMultiSelect
                    linkKind="process"
                    value={f.processIds}
                    onChange={(v) => set("processIds", v)}
                    options={(processes.data ?? []).map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
                    known={a?.processes.map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
                  />
                </Field>
              )}
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("aia.assets")}</div>
                <AssetPicker value={f.assets} onChange={(v) => set("assets", v)} disabled={!edit} />
              </div>
              {mod("suppliers") && (
                <Field label={t("aia.suppliers")}>
                  <IdMultiSelect
                    linkKind="supplier"
                    value={f.supplierIds}
                    onChange={(v) => set("supplierIds", v)}
                    options={(suppliers.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
                    known={a?.suppliers.map((s) => ({ id: s.id, label: s.name }))}
                  />
                </Field>
              )}
              {mod("risks") && can("risks:read") && (
                <Field label={t("aia.risks")} hint={t("aia.risksHint")}>
                  <IdMultiSelect linkKind="risk" value={f.riskIds} onChange={(v) => set("riskIds", v)} options={(risks.data?.items ?? []).map((x) => ({ id: x.id, label: codeName(x) }))} known={a?.risks.map((x) => ({ id: x.id, label: codeName(x) }))} />
                </Field>
              )}
              {mod("controls") && can("controls:read") && (
                <Field label={t("aia.controls")} hint={t("aia.controlsHint")}>
                  <IdMultiSelect linkKind="control" value={f.controlIds} onChange={(v) => set("controlIds", v)} options={(controls.data ?? []).map((x) => ({ id: x.id, label: codeName(x) }))} known={a?.controls.map((x) => ({ id: x.id, label: codeName(x) }))} />
                </Field>
              )}
              {mod("gdpr") && (
                <Field label={t("aia.activities")} hint={t("aia.activitiesHint")}>
                  <IdMultiSelect
                    linkKind="activity"
                    value={f.activityIds}
                    onChange={(v) => set("activityIds", v)}
                    options={(activities.data ?? []).map((s) => ({ id: s.id, label: `${s.code ? `${s.code} ` : ""}${s.name}` }))}
                    known={a?.activities.map((s) => ({ id: s.id, label: `${s.code ? `${s.code} ` : ""}${s.name}` }))}
                  />
                </Field>
              )}
              {a?.activities.map((x) => (
                <div key={x.id} className="text-xs text-slate-600">
                  <Link to="/gdpr/$activityId" params={{ activityId: x.id }} className="hover:text-brand-700">
                    {x.name}
                  </Link>{" "}
                  · DPIA: {x.dpiaStatus === "completed" ? t("aia.done") : x.dpiaStatus ? t("aia.inProgress") : "—"}
                </div>
              ))}
            </fieldset>
          </Card>

          {a && <DecisionCard a={a} />}
        </div>
      </div>

      {a && (
        <div className="mt-6 empty:hidden">
          <AiSuggestPanel useCase="ai_act_screening" entityId={a.id} canApply={a.canEdit} onApplied={() => qc.invalidateQueries({ queryKey: ["aiact"] })} />
        </div>
      )}
      {a && a.obligations.length > 0 && <ObligationsCard a={a} />}
      {a && (a.friaRequired || a.fria) && <FriaCard a={a} />}
      {a && <TasksCard kind="ai_system" id={a.id} className="mt-6" />}
      {a && <SimilarRecordsCard kind="ai_system" id={a.id} className="mt-6" />}
    </>
  );
}

function DecisionCard({ a }: { a: AiSystemDto }) {
  const t = useT();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject") => api.aiact.decide(a.id, d, note || null),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["aiact"] });
      qc.setQueryData(["aiact", "detail", d.id], d);
    },
  });
  return (
    <Card data-testid="aiact-decision">
      <CardHeader title={t("aia.decision")} subtitle={t("aia.decisionSub")} />
      <div className="space-y-3 p-5 pt-0 text-sm">
        {a.decision ? (
          <div className="flex flex-wrap items-center gap-2">
            {a.status === "rejected" ? <XCircle size={16} className="text-red-600" /> : <ShieldCheck size={16} className="text-emerald-600" />}
            <span>{t(a.status === "rejected" ? "aia.rejectedBy" : "aia.approvedBy", { who: a.decision.byName ?? "—", date: fmtDay(a.decision.at.slice(0, 10)) })}</span>
            {a.decision.note && <span className="text-slate-500">– {a.decision.note}</span>}
          </div>
        ) : (
          <p className="text-slate-600">{t("aia.notDecided")}</p>
        )}
        {a.classification.cls === "prohibited" && (
          <p className="flex items-center gap-1.5 text-red-700">
            <AlertTriangle size={14} /> {t("aia.prohibitedWarn")}
          </p>
        )}
        {a.canEdit && (!a.decision || a.status === "rejected") && (
          <>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("aia.decisionNotePh")} aria-label={t("aia.decisionNote")} />
            <div className="flex gap-2">
              <Button disabled={decide.isPending || a.classification.cls === "prohibited" || !a.screening} onClick={() => decide.mutate("approve")}>
                <ShieldCheck size={15} /> {t("aia.approve")}
              </Button>
              {a.status !== "rejected" && (
                <Button variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate("reject")}>
                  <XCircle size={15} /> {t("aia.reject")}
                </Button>
              )}
            </div>
          </>
        )}
        <ErrorBox error={decide.error} />
      </div>
    </Card>
  );
}

function ObligationsCard({ a }: { a: AiSystemDto }) {
  const t = useT();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(a.obligations.map((o) => [o.key, o.note ?? ""])));
  const upd = useMutation({
    mutationFn: (v: { key: string; status: AiObligationStatus }) => api.aiact.obligation(a.id, v.key, v.status, notes[v.key] || null),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["aiact"] });
      qc.setQueryData(["aiact", "detail", d.id], d);
    },
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card className="mt-6 overflow-hidden" data-testid="aiact-obligations">
      <CardHeader title={t("aia.obligationsTitle")} subtitle={t("aia.obligationsSub")} />
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-2">{t("aia.obligation")}</th>
            <th className="px-3 py-2">{t("aia.from")}</th>
            <th className="px-3 py-2">{t("aia.status")}</th>
            <th className="px-3 py-2">{t("aia.note")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {a.obligations.map((o) => (
            <tr key={o.key}>
              <td className="px-5 py-2.5">
                <div>{t.lbl(AIACT_LABELS.obligation[o.key as keyof typeof AIACT_LABELS.obligation])}</div>
                <div className="text-xs text-slate-500">
                  {o.ref} · {t.lbl(o.role === "provider" ? AIACT_LABELS.role.provider : o.role === "deployer" ? AIACT_LABELS.role.deployer : AIACT_LABELS.role.provider_deployer)}
                </div>
              </td>
              <td className={`px-3 py-2.5 text-xs ${o.from <= today ? "text-slate-700" : "text-slate-400"}`}>{fmtDay(o.from)}</td>
              <td className="px-3 py-2.5">
                {a.canEdit && o.key !== "fria" ? (
                  <Select className="w-36" value={o.status} aria-label={t("aia.status")} onChange={(e) => upd.mutate({ key: o.key, status: e.target.value as AiObligationStatus })}>
                    {AI_OBLIGATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t.lbl(AIACT_LABELS.obligationStatus[s])}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Badge tone={oblTone[o.status]}>{t.lbl(AIACT_LABELS.obligationStatus[o.status])}</Badge>
                )}
              </td>
              <td className="px-3 py-2.5">
                {a.canEdit ? (
                  <Input
                    value={notes[o.key] ?? ""}
                    aria-label={t("aia.note")}
                    onChange={(e) => setNotes((x) => ({ ...x, [o.key]: e.target.value }))}
                    onBlur={() => (notes[o.key] ?? "") !== (o.note ?? "") && upd.mutate({ key: o.key, status: o.status })}
                  />
                ) : (
                  <span className="text-xs text-slate-600">{o.note ?? ""}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-5 py-2">
        <ErrorBox error={upd.error} />
      </div>
    </Card>
  );
}

function FriaCard({ a }: { a: AiSystemDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const fr = a.fria;
  const locked = fr?.status === "completed";
  const [f, setF] = useState<Record<FriaField, string> & { authorityNotifiedAt: string; nextReview: string }>({
    ...(Object.fromEntries(FRIA_FIELDS.map((k) => [k, fr?.[k] ?? ""])) as Record<FriaField, string>),
    authorityNotifiedAt: fr?.authorityNotifiedAt ?? "",
    nextReview: fr?.nextReview ?? "",
  });
  const done = (d: AiSystemDto) => {
    qc.invalidateQueries({ queryKey: ["aiact"] });
    qc.setQueryData(["aiact", "detail", d.id], d);
  };
  const save = useMutation({
    mutationFn: () =>
      api.aiact.saveFria(a.id, { ...Object.fromEntries(FRIA_FIELDS.map((k) => [k, f[k] || null])), authorityNotifiedAt: f.authorityNotifiedAt || null, nextReview: f.nextReview || null }),
    onSuccess: done,
  });
  const guard = useFormGuard(save);
  const approve = useMutation({ mutationFn: () => api.aiact.approveFria(a.id), onSuccess: done });
  const reopen = useMutation({ mutationFn: () => api.aiact.reopenFria(a.id), onSuccess: done });
  const missing = friaMissing(fr);
  return (
    <Card className="mt-6" data-testid="aiact-fria">
      <CardHeader
        title={t("aia.fria")}
        subtitle={t("aia.friaSub")}
        action={fr ? <Badge tone={locked ? "green" : "amber"}>{t.lbl(AIACT_LABELS.friaStatus[fr.status])}</Badge> : undefined}
      />
      <fieldset disabled={!a.canEdit || locked} {...guard.bind} className="grid gap-4 p-5 pt-0 lg:grid-cols-2">
        {FRIA_FIELDS.map((k) => (
          <Field key={k} label={t.lbl(AIACT_LABELS.fria[k])}>
            <Textarea rows={3} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} />
          </Field>
        ))}
        <Field label={t("aia.friaNotified")} hint={t("aia.friaNotifiedHint")}>
          <Input type="date" value={f.authorityNotifiedAt} onChange={(e) => setF((x) => ({ ...x, authorityNotifiedAt: e.target.value }))} />
        </Field>
        <Field label={t("aia.friaNextReview")}>
          <Input type="date" value={f.nextReview} onChange={(e) => setF((x) => ({ ...x, nextReview: e.target.value }))} />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 px-5 pb-5">
        {a.canEdit && !locked && (
          <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
            {t("aia.friaSave")}
          </Button>
        )}
        {can("aiact:write") && !locked && fr && (
          <Button disabled={approve.isPending || missing.length > 0} onClick={() => approve.mutate()}>
            <CheckCircle2 size={15} /> {t("aia.friaApprove")}
          </Button>
        )}
        {can("aiact:write") && locked && (
          <Button variant="secondary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
            {t("aia.friaReopen")}
          </Button>
        )}
        {locked && fr?.approvedAt && <span className="text-xs text-slate-500">{t("aia.friaApprovedBy", { who: fr.approvedByName ?? "—", date: fmtDay(fr.approvedAt.slice(0, 10)) })}</span>}
        {!locked && fr && missing.length > 0 && <span className="text-xs text-amber-800">{t("aia.friaMissingN", { n: missing.length })}</span>}
        <ErrorBox error={save.error ?? approve.error ?? reopen.error} />
      </div>
    </Card>
  );
}
