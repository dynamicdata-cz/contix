import { TasksCard } from "@/components/tasks";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import { PROJECT_LABELS, PROJECT_LABELS2, PROJECT_STATUSES, timelinePct, timelineRange, type BudgetState, type ProjectCostInput, type ProjectTemplateInput, type TimelineBar, type DocReqDto, type PhaseDto, type ProjectDetailDto, type ProjectInput, type ProjectStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { CalendarRange, Check, CheckCircle2, Circle, Download, FileUp, LayoutTemplate, Link2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AssetPicker, IdMultiSelect, type PickedAsset, UserSelect } from "@/components/pickers";
import { useModule } from "@/lib/auth";
import { useUrlParam } from "@/lib/urlState";
import { Tabs, useTab } from "@/components/ui/tabs";
import { ChangesTab, MilestonesCard, PortfolioView, ProjectOverview, RagDot, RaidTab, StatusTab, TasksBoard } from "./ProjectsPm";
import { LayoutGrid, List } from "lucide-react";

/* Projekty s fázemi a branami (v1.31, ADR-128). */

const statusTone: Record<ProjectStatus, Tone> = { active: "blue", on_hold: "amber", closed: "green", cancelled: "slate" };
const docTone: Record<DocReqDto["status"], Tone> = { missing: "slate", submitted: "amber", approved: "green", rejected: "red", na: "slate" };

export function ProjectsPage() {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["projects"], queryFn: api.projects.list });
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [view, setView] = useUrlParam<"cards" | "list" | "timeline">("view", "cards");
  return (
    <>
      <PageHeader
        title={t("prj.title")}
        subtitle={t("prj.subtitle")}
        actions={
          <div className="flex gap-2">
            <div className="flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label={t("pm.view")}>
              {(
                [
                  ["cards", LayoutGrid, t("pm.view.cards")],
                  ["list", List, t("prj.listView")],
                  ["timeline", CalendarRange, t("prj.timeline")],
                ] as const
              ).map(([k, Icon, label]) => (
                <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm", view === k ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
            {can("projects:write") && (
              <>
                <Button variant="secondary" onClick={() => setTemplates(true)}>
                  <LayoutTemplate size={16} /> {t("prj.templates")}
                </Button>
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} /> {t("prj.new")}
                </Button>
              </>
            )}
          </div>
        }
      />
      <ErrorBox error={q.error} />
      {templates && <TemplatesModal onClose={() => setTemplates(false)} />}
      {view === "timeline" && q.data && q.data.length > 0 ? (
        <Card>
          <CardHeader title={t("prj.timeline")} />
          <Timeline
            bars={q.data.filter((p) => p.status !== "cancelled").map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}`, start: p.startDate, end: p.endDate, actualEnd: null, status: p.overdue ? "overdue" : p.status }))}
            link={(id) => `/projects/${id}`}
          />
        </Card>
      ) : q.data && !q.data.length ? (
        <EmptyState>{t("prj.empty")}</EmptyState>
      ) : view === "cards" && q.data ? (
        <PortfolioView rows={q.data} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="px-5 py-2">{t("prj.name")}</th>
                  <th className="py-2 pr-3">{t("prj.phase")}</th>
                  <th className="py-2 pr-3">{t("prj.progress")}</th>
                  <th className="py-2 pr-3">{t("prj.budget")}</th>
                  <th className="py-2 pr-3">{t("prj.manager")}</th>
                  <th className="py-2 pr-5">{t("prj.status")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="px-5 py-2">
                      <RagDot rag={p.info.rag ?? p.info.suggestedRag} size={9} />{" "}
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-medium text-brand-700 hover:underline">
                        {p.code ? `${p.code} ` : ""}
                        {p.name}
                      </Link>
                      <div className="text-xs text-slate-500">{t.lbl(p.templateName)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {p.currentPhase ? t.lbl(p.currentPhase) : "—"} {p.overdue && <Badge tone="red">{t("prj.overdue")}</Badge>}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                          <div className="h-full bg-brand-600" style={{ width: `${p.progress.phases ? (p.progress.approved / p.progress.phases) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-slate-500">
                          {p.progress.approved}/{p.progress.phases}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{p.budget !== null ? <BudgetBadge budget={p.budget} spent={p.spent} state={p.budgetState} /> : p.spent ? czk(p.spent) : "—"}</td>
                    <td className="py-2 pr-3">{p.managerName ?? "—"}</td>
                    <td className="py-2 pr-5">
                      <Badge tone={statusTone[p.status]}>{t.lbl(PROJECT_LABELS.status[p.status])}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <NewProjectModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => nav({ to: "/projects/$projectId", params: { projectId: id } })} />
    </>
  );
}

function NewProjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const tpl = useQuery({ queryKey: ["projects", "templates"], queryFn: api.projects.templates, enabled: open });
  const users = useQuery({ queryKey: ["directory-users"], queryFn: api.directory.users, enabled: open });
  const [f, setF] = useState<ProjectInput>({ name: "", templateKey: "it" });
  useEffect(() => {
    if (open) setF({ name: "", templateKey: "it", code: "", description: "", managerId: null, sponsorId: null, startDate: null, endDate: null });
  }, [open]);
  const m = useMutation({
    mutationFn: () => api.projects.create(f),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
      onCreated(p.id);
    },
  });
  const sel = tpl.data?.find((x) => x.key === f.templateKey);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t("prj.new")}
      footer={
        <Button disabled={!f.name.trim() || m.isPending} onClick={() => m.mutate()}>
          {t("prj.create")}
        </Button>
      }
    >
      <div className="space-y-3">
        <ErrorBox error={m.error} />
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label={t("prj.code")}>
            <Input value={f.code ?? ""} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label={t("prj.name")}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
        </div>
        <Field label={t("prj.template")}>
          <Select value={f.templateKey} onChange={(e) => setF({ ...f, templateKey: e.target.value })}>
            {tpl.data?.filter((x) => x.active).map((x) => (
              <option key={x.key} value={x.key}>
                {t.lbl(x.name)}
              </option>
            ))}
          </Select>
        </Field>
        {sel && <p className="text-xs text-slate-500">{sel.phases.map((p) => t.lbl(p.name)).join(" → ")}</p>}
        <Field label={t("prj.description")}>
          <Textarea rows={2} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("prj.manager")}>
            <UserSelect value={(f.managerId ?? "") || null} onChange={(v) => setF({ ...f, managerId: v })} emptyLabel="—" />
          </Field>
          <Field label={t("prj.sponsor")} hint={t("prj.sponsorHint")}>
            <UserSelect value={(f.sponsorId ?? "") || null} onChange={(v) => setF({ ...f, sponsorId: v })} emptyLabel="—" />
          </Field>
          <Field label={t("prj.start")}>
            <Input type="date" value={f.startDate ?? ""} onChange={(e) => setF({ ...f, startDate: e.target.value || null })} />
          </Field>
          <Field label={t("prj.end")}>
            <Input type="date" value={f.endDate ?? ""} onChange={(e) => setF({ ...f, endDate: e.target.value || null })} />
          </Field>
          <Field label={t("prj.budgetCzk")} hint={t("prj.budgetHint")}>
            <Input type="number" min={0} value={f.budget ?? ""} onChange={(e) => setF({ ...f, budget: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function ProjectDetailPage() {
  const t = useT();
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["projects", projectId], queryFn: () => api.projects.get(projectId) });
  const set = (d: ProjectDetailDto) => {
    qc.setQueryData(["projects", projectId], d);
    qc.invalidateQueries({ queryKey: ["projects"], exact: true });
    qc.invalidateQueries({ queryKey: ["obligations"] });
  };
  const status = useMutation({ mutationFn: (s: ProjectStatus) => api.projects.update(projectId, { status: s }), onSuccess: set });
  const [tab, setTab] = useTab(["overview", "phases", "tasks", "schedule", "raid", "budget", "changes", "status", "links"] as const, "overview");
  if (!q.data) return <ErrorBox error={q.error} />;
  const p = q.data;
  const openTasks = p.tasks.filter((x) => x.status !== "done").length;
  const openIssues = p.issues.filter((x) => x.status !== "closed").length;
  const pendingCh = p.changes.filter((x) => x.status === "submitted").length;
  const n = (k: number) => (k ? ` (${k})` : "");
  return (
    <>
      <PageHeader
        sticky
        title={`${p.code ? `${p.code} ` : ""}${p.name}`}
        subtitle={t.lbl(p.templateName)}
        facts={[
          { label: t("fx.rag"), value: <span className="inline-flex items-center gap-1.5"><RagDot rag={p.reports[0]?.overall ?? p.suggested.overall} /> {t.lbl(PROJECT_LABELS2.rag[p.reports[0]?.overall ?? p.suggested.overall])}</span> },
          { label: t("prj.manager"), value: p.managerName ?? "—" },
          { label: t("prj.sponsor"), value: p.sponsorName ?? "—" },
          (p.startDate || p.endDate) && { label: t("fx.term"), value: `${fmtDay(p.startDate) || "…"} – ${fmtDay(p.endDate) || "…"}`, tone: p.overdue ? "red" : undefined },
          p.budget !== null && { label: t("prj.budget"), value: `${czk(p.spent)} / ${czk(p.budget)}`, tone: p.budgetState === "over" ? "red" : p.budgetState === "warn" ? "amber" : undefined },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone[p.status]}>{t.lbl(PROJECT_LABELS.status[p.status])}</Badge>
            {p.canEdit && (
              <Select
                className="h-9 w-40"
                aria-label={t("prj.status")}
                value={p.status}
                onChange={async (e) => {
                  const s = e.target.value as ProjectStatus;
                  if (s === "cancelled" && !(await askConfirm(t("prj.cancelConfirm"), { danger: true }))) return;
                  status.mutate(s);
                }}
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.lbl(PROJECT_LABELS.status[s])}
                  </option>
                ))}
              </Select>
            )}
          </div>
        }
      />
      <ErrorBox error={status.error} />
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview" as const, label: t("pm.tab.overview") },
          { key: "phases" as const, label: t("pm.tab.phases") },
          { key: "tasks" as const, label: `${t("pm.tab.tasks")}${n(openTasks)}` },
          { key: "schedule" as const, label: t("prj.schedule") },
          { key: "raid" as const, label: `${t("pm.tab.raid")}${n(openIssues)}` },
          { key: "budget" as const, label: t("prj.budget") },
          { key: "changes" as const, label: `${t("pm.tab.changes")}${n(pendingCh)}` },
          { key: "status" as const, label: t("pm.tab.status") },
          { key: "links" as const, label: t("pm.tab.links") },
        ]}
      />
      {tab === "overview" && (
        <>
          {p.description && <p className="mb-4 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{p.description}</p>}
          <ProjectOverview p={p} onTab={(k) => setTab(k as typeof tab)} onChange={set} />
        </>
      )}
      {tab === "tasks" && <TasksBoard p={p} onChange={set} />}
      {tab === "raid" && <RaidTab p={p} onChange={set} />}
      {tab === "changes" && <ChangesTab p={p} onChange={set} />}
      {tab === "status" && <StatusTab p={p} onChange={set} />}
      {tab === "phases" && (
      <>
      <ol className="mb-6 flex flex-wrap items-center gap-2 text-sm" aria-label={t("prj.phases")}>
        {p.phases.map((ph, i) => (
          <li key={ph.id} className="flex items-center gap-2">
            <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1", ph.status === "approved" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : ph.status === "active" ? "bg-brand-50 font-medium text-brand-800 ring-1 ring-brand-300 dark:bg-slate-800 dark:text-brand-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}>
              {ph.status === "approved" ? <CheckCircle2 size={14} /> : <Circle size={14} />} {t.lbl(ph.name)}
            </span>
            {i < p.phases.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        ))}
      </ol>
      <div className="space-y-4">
        {p.phases.map((ph) => (
          <PhaseCard key={ph.id} p={p} ph={ph} onChange={set} />
        ))}
      </div>
      </>
      )}
      {tab === "schedule" && (
        <>
          <Card>
            <CardHeader title={t("prj.schedule")} subtitle={t("prj.scheduleHint")} />
            <Timeline
              bars={p.phases.map((ph) => ({ id: ph.id, label: t.lbl(ph.name), start: ph.plannedStart, end: ph.plannedEnd, actualEnd: ph.approvedAt?.slice(0, 10) ?? null, status: ph.overdue ? "overdue" : ph.status }))}
              marks={p.milestones.map((m) => ({ id: m.id, date: m.dueDate, label: m.name, done: !!m.doneAt, overdue: m.overdue }))}
            />
          </Card>
          <MilestonesCard p={p} onChange={set} />
        </>
      )}
      {tab === "budget" && <BudgetCard p={p} onChange={set} />}
      {tab === "links" && (
        <>
          <ProjectLinksCard p={p} />
          <TasksCard kind="project" id={p.id} className="mt-6" />
        </>
      )}
    </>
  );
}

function PhaseCard({ p, ph, onChange }: { p: ProjectDetailDto; ph: PhaseDto; onChange: (d: ProjectDetailDto) => void }) {
  const t = useT();
  const [open, setOpen] = useState(ph.status === "active");
  const [comment, setComment] = useState("");
  const [adding, setAdding] = useState<{ name: string; required: boolean } | null>(null);
  const gate = useMutation({ mutationFn: () => api.projects.approveGate(p.id, ph.id, comment || undefined), onSuccess: (d) => (onChange(d), toast(t("prj.gateApproved"))) });
  const due = useMutation({ mutationFn: (v: { plannedStart?: string | null; plannedEnd?: string | null }) => api.projects.phase(p.id, ph.id, v), onSuccess: onChange });
  const add = useMutation({ mutationFn: () => api.projects.addDoc(p.id, ph.id, adding!.name, adding!.required), onSuccess: (d) => (onChange(d), setAdding(null)) });
  const editable = p.canEdit && ph.status !== "approved";
  return (
    <Card>
      <CardHeader
        title={t.lbl(ph.name)}
        subtitle={
          ph.status === "approved"
            ? t("prj.approvedBy", { name: ph.approvedByName ?? "—", date: fmtDay(ph.approvedAt) })
            : ph.status === "active"
              ? ph.blockers.length
                ? t("prj.blockers", { n: ph.blockers.length })
                : t("prj.readyForGate")
              : t.lbl(PROJECT_LABELS.phase.planned)
        }
        action={
          <div className="flex items-center gap-2">
            {ph.overdue && <Badge tone="red">{t("prj.overdue")}</Badge>}
            {editable ? (
              <>
                <Input type="date" className="h-8 w-36 text-xs" aria-label={t("prj.plannedStart")} title={t("prj.plannedStart")} value={ph.plannedStart ?? ""} onChange={(e) => due.mutate({ plannedStart: e.target.value || null })} />
                <span className="text-slate-400">–</span>
                <Input type="date" className="h-8 w-36 text-xs" aria-label={t("prj.plannedEnd")} title={t("prj.plannedEnd")} value={ph.plannedEnd ?? ""} onChange={(e) => due.mutate({ plannedEnd: e.target.value || null })} />
              </>
            ) : (
              (ph.plannedStart || ph.plannedEnd) && <span className="text-xs text-slate-500">{[fmtDay(ph.plannedStart), fmtDay(ph.plannedEnd)].filter(Boolean).join(" – ")}</span>
            )}
            <Button variant="ghost" className="px-2 text-xs" onClick={() => setOpen(!open)}>
              {open ? t("prj.collapse") : t("prj.expand", { n: ph.docs.length })}
            </Button>
          </div>
        }
      />
      {open && (
        <>
          <ErrorBox error={gate.error ?? due.error ?? add.error} />
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {ph.docs.map((d) => (
              <DocRow key={d.id} p={p} d={d} editable={editable} onChange={onChange} />
            ))}
          </ul>
          {editable && (
            <div className="px-5 py-2">
              {adding ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input className="h-8 min-w-64 flex-1 text-sm" placeholder={t("prj.docName")} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
                  <Checkbox checked={adding.required} onChange={(v) => setAdding({ ...adding, required: v })} label={t("prj.required")} />
                  <Button className="text-xs" disabled={!adding.name.trim() || add.isPending} onClick={() => add.mutate()}>
                    {t("prj.add")}
                  </Button>
                  <Button variant="ghost" className="text-xs" onClick={() => setAdding(null)}>
                    <X size={14} />
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" className="text-xs" onClick={() => setAdding({ name: "", required: false })}>
                  <Plus size={14} /> {t("prj.addDoc")}
                </Button>
              )}
            </div>
          )}
          {ph.status === "active" && (p.canApproveGate || ph.blockers.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
              {ph.blockers.length > 0 ? (
                <span className="text-xs text-slate-500">{t("prj.gateWaits", { list: ph.blockers.map((b) => t.lbl(b)).join(", ") })}</span>
              ) : (
                <>
                  <Input className="h-8 min-w-64 flex-1 text-sm" placeholder={t("prj.gateComment")} value={comment} onChange={(e) => setComment(e.target.value)} />
                  <Button disabled={gate.isPending} onClick={() => gate.mutate()}>
                    <ShieldCheck size={16} /> {t("prj.approveGate")}
                  </Button>
                </>
              )}
            </div>
          )}
          {ph.gateComment && <div className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500 dark:border-slate-800">„{ph.gateComment}“</div>}
        </>
      )}
    </Card>
  );
}

function DocRow({ p, d, editable, onChange }: { p: ProjectDetailDto; d: DocReqDto; editable: boolean; onChange: (d: ProjectDetailDto) => void }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mode, setMode] = useState<"na" | "rejected">("na");
  const [url, setUrl] = useState<string | null>(null);
  const upd = useMutation({ mutationFn: (x: { status?: string; note?: string | null; url?: string | null }) => api.projects.updateDoc(p.id, d.id, x), onSuccess: (r) => (onChange(r), setNote(null), setUrl(null)) });
  const upload = useMutation({ mutationFn: (f: File) => api.projects.uploadDoc(p.id, d.id, f), onSuccess: onChange });
  const remove = useMutation({ mutationFn: () => api.projects.removeDoc(p.id, d.id), onSuccess: onChange });
  return (
    <li className="px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-56 flex-1">
          <span className="font-medium">{t.lbl(d.name)}</span>
          {d.required ? <span className="ml-1 text-red-600">*</span> : <span className="ml-1 text-xs text-slate-400">({t("prj.optional")})</span>}
          {d.security && <ShieldCheck size={13} className="ml-1 inline text-brand-600" aria-label={t("prj.security")} />}
        </span>
        <Badge tone={docTone[d.status]}>{t.lbl(PROJECT_LABELS.doc[d.status])}</Badge>
        {d.fileName && (
          <a href={api.projects.docFileUrl(p.id, d.id)} className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
            <Download size={12} /> {d.fileName}
          </a>
        )}
        {d.url && (
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
            <Link2 size={12} /> {t("prj.link")}
          </a>
        )}
        {editable && (
          <span className="flex gap-1">
            <input ref={fileRef} type="file" className="hidden" aria-label={`${t("prj.upload")} ${d.name}`} onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
            <Button variant="ghost" className="px-2 text-xs" title={t("prj.upload")} onClick={() => fileRef.current?.click()}>
              <FileUp size={14} />
            </Button>
            <Button variant="ghost" className="px-2 text-xs" title={t("prj.linkAdd")} onClick={() => setUrl(d.url ?? "")}>
              <Link2 size={14} />
            </Button>
            {d.canReview && (
              <>
                <Button variant="ghost" className="px-2 text-xs text-emerald-700" onClick={() => upd.mutate({ status: "approved" })}>
                  <Check size={14} /> {t("prj.approve")}
                </Button>
                <Button variant="ghost" className="px-2 text-xs text-red-700" onClick={() => (setMode("rejected"), setNote(""))}>
                  <X size={14} /> {t("prj.reject")}
                </Button>
              </>
            )}
            {d.status !== "na" && d.status !== "approved" && (
              <Button variant="ghost" className="px-2 text-xs" onClick={() => (setMode("na"), setNote(d.note ?? ""))}>
                {t("prj.na")}
              </Button>
            )}
            {!d.required && (
              <Button variant="ghost" className="px-2 text-xs text-red-600" title={t("prj.remove")} onClick={async () => (await askConfirm(t("prj.removeConfirm", { name: d.name }))) && remove.mutate()}>
                <Trash2 size={14} />
              </Button>
            )}
          </span>
        )}
      </div>
      {d.note && note === null && <div className="mt-1 text-xs text-slate-500">{d.note}</div>}
      {d.updatedByName && <div className="text-xs text-slate-400">{t("prj.updated", { name: d.updatedByName, date: fmtDay(d.updatedAt) })}</div>}
      {url !== null && (
        <div className="mt-2 flex gap-2">
          <Input className="h-8 flex-1 text-sm" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button className="text-xs" disabled={!url.trim() || upd.isPending} onClick={() => upd.mutate({ url, status: "submitted" })}>
            {t("prj.submit")}
          </Button>
          <Button variant="ghost" className="text-xs" onClick={() => setUrl(null)}>
            <X size={14} />
          </Button>
        </div>
      )}
      {note !== null && (
        <div className="mt-2 flex gap-2">
          <Input className="h-8 flex-1 text-sm" placeholder={mode === "rejected" ? t("prj.rejectReason") : t("prj.naReason")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button className="text-xs" disabled={!note.trim() || upd.isPending} onClick={() => upd.mutate({ status: mode, note })}>
            {t("prj.confirm")}
          </Button>
          <Button variant="ghost" className="text-xs" onClick={() => setNote(null)}>
            <X size={14} />
          </Button>
        </div>
      )}
      <ErrorBox error={upd.error ?? upload.error ?? remove.error} />
    </li>
  );
}

/* ---------------- harmonogram, rozpočet, vazby, šablony (v1.32, ADR-129) ---------------- */

const czk = (n: number) => `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč`;
const barColor: Record<string, string> = { approved: "bg-emerald-500", closed: "bg-emerald-500", active: "bg-brand-600", planned: "bg-slate-300 dark:bg-slate-600", on_hold: "bg-amber-400", overdue: "bg-red-500" };

/** Jednoduchý Gantt: pruh plán (začátek–konec), tečka skutečného konce (schválení brány), svislá čára dnes. */
function Timeline({ bars, link, marks = [] }: { bars: TimelineBar[]; link?: (id: string) => string; marks?: { id: string; date: string; label: string; done: boolean; overdue: boolean }[] }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const r = timelineRange([...bars, ...marks.map((m) => ({ id: m.id, label: m.label, start: m.date, end: m.date, actualEnd: null, status: "" }))], today);
  if (!r) return <div className="px-5 py-4 text-sm text-slate-500">{t("prj.noDates")}</div>;
  const months: string[] = [];
  for (let d = new Date(`${r.from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= r.to; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 10));
  return (
    <div className="overflow-x-auto px-5 py-4" data-testid="timeline">
      <div className="relative min-w-[36rem]">
        <div className="relative ml-48 h-5 border-b border-slate-200 text-[10px] text-slate-500 dark:border-slate-700">
          {months.map((m) => (
            <span key={m} className="absolute -translate-x-1/2" style={{ left: `${timelinePct(m < r.from ? r.from : m, r)}%` }}>
              {new Date(`${m}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" })}
            </span>
          ))}
        </div>
        {bars.map((b) => {
          const start = b.start ?? b.end;
          const end = b.end ?? b.start;
          return (
            <div key={b.id} className="flex items-center gap-0 py-1 text-sm">
              <div className="w-48 shrink-0 truncate pr-2" title={b.label}>
                {link ? (
                  <Link to={link(b.id) as never} className="text-brand-700 hover:underline">
                    {b.label}
                  </Link>
                ) : (
                  b.label
                )}
              </div>
              <div className="relative h-5 flex-1 rounded bg-slate-50 dark:bg-slate-800/50">
                {start && end && (
                  <div className={cn("absolute top-1 h-3 rounded", barColor[b.status] ?? "bg-slate-400")} style={{ left: `${timelinePct(start, r)}%`, width: `${Math.max(0.8, timelinePct(end, r) - timelinePct(start, r))}%` }} title={`${fmtDay(b.start)} – ${fmtDay(b.end)}`} />
                )}
                {b.actualEnd && <div className="absolute top-0.5 h-4 w-1 rounded bg-emerald-700" style={{ left: `${timelinePct(b.actualEnd, r)}%` }} title={`${t("prj.actualEnd")}: ${fmtDay(b.actualEnd)}`} />}
                <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: `${timelinePct(today, r)}%` }} title={t("prj.today")} />
              </div>
            </div>
          );
        })}
        {marks.length > 0 && (
          <div className="flex items-center py-1 text-sm">
            <div className="w-48 shrink-0 pr-2 text-slate-500">{t("pm.milestones")}</div>
            <div className="relative h-6 flex-1 rounded bg-slate-50 dark:bg-slate-800/50">
              {marks.map((m) => (
                <div
                  key={m.id}
                  className={cn("absolute top-1.5 h-3 w-3 -translate-x-1/2 rotate-45", m.done ? "bg-emerald-500" : m.overdue ? "bg-red-500" : "bg-brand-600")}
                  style={{ left: `${timelinePct(m.date, r)}%` }}
                  title={`${m.label} · ${fmtDay(m.date)}`}
                />
              ))}
              <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: `${timelinePct(today, r)}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const budgetTone: Record<BudgetState, Tone> = { none: "slate", ok: "green", warn: "amber", over: "red" };
function BudgetBadge({ budget, spent, state }: { budget: number; spent: number; state: BudgetState }) {
  return (
    <span className="flex items-center gap-1.5">
      <Badge tone={budgetTone[state]}>{budget > 0 ? `${Math.round((spent / budget) * 100)} %` : "—"}</Badge>
      <span className="text-xs text-slate-500">
        {czk(spent)} / {czk(budget)}
      </span>
    </span>
  );
}

function BudgetCard({ p, onChange }: { p: ProjectDetailDto; onChange: (d: ProjectDetailDto) => void }) {
  const t = useT();
  const suppliers = useQuery({ queryKey: ["suppliers", "", false], queryFn: () => api.suppliers.list(), enabled: p.canEdit });
  const [f, setF] = useState<ProjectCostInput | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const add = useMutation({ mutationFn: () => api.projects.addCost(p.id, f!), onSuccess: (d) => (onChange(d), setF(null)) });
  const remove = useMutation({ mutationFn: (cid: string) => api.projects.removeCost(p.id, cid), onSuccess: onChange });
  const saveBudget = useMutation({ mutationFn: () => api.projects.update(p.id, { budget: budget === "" ? null : Number(budget) }), onSuccess: (d) => (onChange(d), setBudget(null)) });
  const pct = p.budget ? Math.min(100, (p.spent / p.budget) * 100) : 0;
  return (
    <Card>
      <CardHeader
        title={t("prj.budget")}
        subtitle={p.budget !== null ? t("prj.budgetSummary", { spent: czk(p.spent), budget: czk(p.budget), rest: czk(p.budget - p.spent) }) : t("prj.spentOnly", { spent: czk(p.spent) })}
        action={
          p.canEdit && (
            <div className="flex gap-2">
              <Button variant="ghost" className="text-xs" onClick={() => setBudget(p.budget === null ? "" : String(p.budget))}>
                {t("prj.setBudget")}
              </Button>
              <Button variant="secondary" className="text-xs" onClick={() => setF({ date: new Date().toISOString().slice(0, 10), description: "", amount: 0, phaseId: null, supplierId: null })}>
                <Plus size={14} /> {t("prj.addCost")}
              </Button>
            </div>
          )
        }
      />
      <ErrorBox error={add.error ?? remove.error ?? saveBudget.error} />
      {p.budget !== null && (
        <div className="px-5 pt-3">
          <div className="h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
            <div className={cn("h-full", p.budgetState === "over" ? "bg-red-500" : p.budgetState === "warn" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
          </div>
          {p.budgetState === "over" && <div className="mt-1 text-xs font-medium text-red-600">{t("prj.overBudget")}</div>}
        </div>
      )}
      {budget !== null && (
        <div className="flex gap-2 px-5 py-3">
          <Input type="number" min={0} className="h-8 w-48" aria-label={t("prj.budgetCzk")} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t("prj.budgetCzk")} />
          <Button className="text-xs" disabled={saveBudget.isPending} onClick={() => saveBudget.mutate()}>
            {t("prj.save")}
          </Button>
          <Button variant="ghost" className="text-xs" onClick={() => setBudget(null)}>
            <X size={14} />
          </Button>
        </div>
      )}
      {f && (
        <div className="grid gap-2 px-5 py-3 sm:grid-cols-[9rem_1fr_9rem_10rem_10rem_auto] sm:items-end">
          <Field label={t("prj.costDate")}>
            <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </Field>
          <Field label={t("prj.costDesc")}>
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <Field label={t("prj.costAmount")}>
            <Input type="number" value={f.amount || ""} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} />
          </Field>
          <Field label={t("prj.phase")}>
            <Select value={f.phaseId ?? ""} onChange={(e) => setF({ ...f, phaseId: e.target.value || null })}>
              <option value="">—</option>
              {p.phases.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {t.lbl(ph.name)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("prj.costSupplier")}>
            <Select value={f.supplierId ?? ""} onChange={(e) => setF({ ...f, supplierId: e.target.value || null })}>
              <option value="">—</option>
              {suppliers.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-1">
            <Button disabled={!f.description.trim() || !f.amount || add.isPending} onClick={() => add.mutate()}>
              {t("prj.add")}
            </Button>
            <Button variant="ghost" onClick={() => setF(null)}>
              <X size={14} />
            </Button>
          </div>
        </div>
      )}
      {p.costs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {p.costs.map((x) => (
                <tr key={x.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-5 py-2 text-slate-500">{fmtDay(x.date)}</td>
                  <td className="py-2 pr-3">
                    {x.description}
                    <div className="text-xs text-slate-500">{[x.phaseName && t.lbl(x.phaseName), x.supplierName, x.createdByName].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className={cn("py-2 pr-3 text-right tabular-nums", x.amount < 0 && "text-emerald-700")}>{czk(x.amount)}</td>
                  <td className="py-2 pr-5 text-right">
                    {p.canEdit && (
                      <Button variant="ghost" className="px-2 text-red-600" title={t("prj.remove")} onClick={async () => (await askConfirm(t("prj.removeCostConfirm", { name: x.description }))) && remove.mutate(x.id)}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ProjectLinksCard({ p }: { p: ProjectDetailDto }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["projects", "links", p.id], queryFn: () => api.projects.links(p.id) });
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "", false], queryFn: () => api.suppliers.list(), enabled: mod("suppliers") && can("suppliers:read") });
  const [f, setF] = useState<{ assets: PickedAsset[]; supplierIds: string[]; processIds: string[]; riskIds: string[] } | null>(null);
  const d = q.data;
  const cur = f ?? (d ? { assets: d.assets, supplierIds: d.suppliers.map((x) => x.id), processIds: d.processes.map((x) => x.id), riskIds: d.risks.map((x) => x.id) } : null);
  const save = useMutation({
    mutationFn: () => api.projects.saveLinks(p.id, { assetIds: cur!.assets.map((a) => a.id), supplierIds: cur!.supplierIds, processIds: cur!.processIds, riskIds: cur!.riskIds }),
    onSuccess: (r) => {
      qc.setQueryData(["projects", "links", p.id], r);
      qc.invalidateQueries({ queryKey: ["links"] });
      setF(null);
    },
  });
  if (!cur || !d) return <ErrorBox error={q.error} />;
  const edit = p.canEdit;
  const label = (x: { code?: string | null; name: string }) => (x.code ? `${x.code} ${x.name}` : x.name);
  return (
    <Card data-testid="project-links">
      <CardHeader
        title={t("prj.links")}
        subtitle={t("prj.linksHint")}
        action={
          edit && f ? (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("prj.save")}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 p-5 md:grid-cols-2">
        {mod("assets") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t("prj.linkAssets")}</div>
            <AssetPicker value={cur.assets} onChange={(v) => setF({ ...cur, assets: v })} disabled={!edit} />
          </div>
        )}
        {mod("risks") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t("prj.linkRisks")}</div>
            <IdMultiSelect linkKind="risk" value={cur.riskIds} onChange={(v) => setF({ ...cur, riskIds: v })} disabled={!edit} options={(risks.data?.items ?? []).map((x) => ({ id: x.id, label: label(x) }))} known={d.risks} />
          </div>
        )}
        {mod("suppliers") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t("prj.linkSuppliers")}</div>
            <IdMultiSelect linkKind="supplier" value={cur.supplierIds} onChange={(v) => setF({ ...cur, supplierIds: v })} disabled={!edit} options={(suppliers.data ?? []).map((x) => ({ id: x.id, label: x.name }))} known={d.suppliers.map((x) => ({ id: x.id, label: x.name }))} />
          </div>
        )}
        {mod("processes") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t("prj.linkProcesses")}</div>
            <IdMultiSelect linkKind="process" value={cur.processIds} onChange={(v) => setF({ ...cur, processIds: v })} disabled={!edit} options={(processes.data ?? []).map((x) => ({ id: x.id, label: label(x) }))} known={d.processes} />
          </div>
        )}
      </div>
      <ErrorBox error={save.error} />
    </Card>
  );
}

function TemplatesModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["projects", "templates"], queryFn: api.projects.templates });
  const [edit, setEdit] = useState<{ id: string | null; f: ProjectTemplateInput } | null>(null);
  const save = useMutation({
    mutationFn: async () => void (edit!.id ? await api.projects.updateTemplate(edit!.id, edit!.f) : await api.projects.createTemplate(edit!.f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", "templates"] });
      setEdit(null);
      toast(t("prj.saved"));
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.projects.removeTemplate(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", "templates"] }) });
  const copy = (tpl: { name: string; phases: { name: string; docs: { name: string; required: boolean; security?: boolean }[] }[] }, id: string | null, active = true, rename = true) =>
    setEdit({ id, f: { name: rename ? `${t.lbl(tpl.name)} (${t("prj.copy")})` : tpl.name, active, phases: tpl.phases.map((ph) => ({ name: t.lbl(ph.name), docs: ph.docs.map((d) => ({ name: t.lbl(d.name), required: d.required, security: !!d.security })) })) } });
  const setPh = (i: number, ph: ProjectTemplateInput["phases"][number] | null) =>
    setEdit((e) => e && { ...e, f: { ...e.f, phases: ph ? e.f.phases.map((x, j) => (j === i ? ph : x)) : e.f.phases.filter((_, j) => j !== i) } });
  return (
    <Modal open onClose={onClose} wide title={edit ? (edit.id ? t("prj.editTemplate") : t("prj.newTemplate")) : t("prj.templates")} footer={edit ? <Button disabled={!edit.f.name.trim() || !edit.f.phases.length || save.isPending} onClick={() => save.mutate()}>{t("prj.save")}</Button> : undefined}>
      <ErrorBox error={q.error ?? save.error ?? remove.error} />
      {!edit && (
        <div className="space-y-2 text-sm">
          <p className="text-slate-500">{t("prj.templatesHint")}</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {q.data?.map((x) => (
              <li key={x.key} className={cn("flex flex-wrap items-center gap-2 py-2", !x.active && "opacity-50")}>
                <span className="min-w-56 flex-1">
                  <span className="font-medium">{t.lbl(x.name)}</span>
                  <span className="ml-2 text-xs text-slate-500">{x.phases.map((ph) => t.lbl(ph.name)).join(" → ")}</span>
                </span>
                {x.custom ? <Badge tone="blue">{t("prj.custom")}</Badge> : <Badge tone="slate">{t("prj.builtin")}</Badge>}
                {x.custom ? (
                  <>
                    <Button variant="ghost" className="px-2 text-xs" onClick={() => copy(x, x.id, x.active, false)}>
                      {t("prj.edit")}
                    </Button>
                    <Button variant="ghost" className="px-2 text-xs text-red-600" onClick={async () => (await askConfirm(t("prj.removeTemplateConfirm", { name: x.name }), { danger: true })) && remove.mutate(x.id!)}>
                      <Trash2 size={14} />
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" className="px-2 text-xs" onClick={() => copy(x, null)}>
                    {t("prj.copyTemplate")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => setEdit({ id: null, f: { name: "", active: true, phases: [{ name: "", docs: [] }] } })}>
            <Plus size={16} /> {t("prj.newTemplate")}
          </Button>
        </div>
      )}
      {edit && (
        <div className="space-y-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label={t("prj.name")}>
              <Input value={edit.f.name} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, name: e.target.value } })} />
            </Field>
            <Checkbox checked={edit.f.active !== false} onChange={(v) => setEdit({ ...edit, f: { ...edit.f, active: v } })} label={t("prj.templateActive")} />
          </div>
          {edit.f.phases.map((ph, i) => (
            <div key={i} className="rounded border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{i + 1}.</span>
                <Input className="h-8 flex-1" placeholder={t("prj.phaseName")} value={ph.name} onChange={(e) => setPh(i, { ...ph, name: e.target.value })} />
                <Button variant="ghost" className="px-2 text-red-600" title={t("prj.remove")} onClick={() => setPh(i, null)}>
                  <Trash2 size={14} />
                </Button>
              </div>
              <ul className="mt-2 space-y-1 pl-5">
                {(ph.docs ?? []).map((d, k) => (
                  <li key={k} className="flex flex-wrap items-center gap-2">
                    <Input className="h-8 min-w-48 flex-1" placeholder={t("prj.docName")} value={d.name} onChange={(e) => setPh(i, { ...ph, docs: ph.docs!.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} />
                    <Checkbox checked={d.required !== false} onChange={(v) => setPh(i, { ...ph, docs: ph.docs!.map((x, j) => (j === k ? { ...x, required: v } : x)) })} label={t("prj.required")} />
                    <Checkbox checked={!!d.security} onChange={(v) => setPh(i, { ...ph, docs: ph.docs!.map((x, j) => (j === k ? { ...x, security: v } : x)) })} label={t("prj.security")} />
                    <Button variant="ghost" className="px-2 text-red-600" title={t("prj.remove")} onClick={() => setPh(i, { ...ph, docs: ph.docs!.filter((_, j) => j !== k) })}>
                      <X size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="ghost" className="mt-1 text-xs" onClick={() => setPh(i, { ...ph, docs: [...(ph.docs ?? []), { name: "", required: true, security: false }] })}>
                <Plus size={14} /> {t("prj.addDoc")}
              </Button>
            </div>
          ))}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setEdit({ ...edit, f: { ...edit.f, phases: [...edit.f.phases, { name: "", docs: [] }] } })}>
              <Plus size={16} /> {t("prj.addPhase")}
            </Button>
            <Button variant="ghost" onClick={() => setEdit(null)}>
              {t("prj.back")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
