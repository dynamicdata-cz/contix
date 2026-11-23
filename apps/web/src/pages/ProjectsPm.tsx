import { UserSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import {
  ISSUE_KINDS,
  ISSUE_STATUSES,
  LESSON_KINDS,
  PROJECT_LABELS,
  PROJECT_LABELS2,
  PROJECT_PRIORITIES,
  PROJECT_RACI,
  PROJECT_TASK_STATUSES,
  RAG,
  type ChangeRequestInput,
  type MilestoneDto,
  type MilestoneInput,
  type ProjectDetailDto,
  type ProjectDto,
  type ProjectIssueDto,
  type ProjectIssueInput,
  type ProjectTaskDto,
  type ProjectTaskInput,
  type ProjectTaskStatus,
  type Rag,
  type StatusReportInput,
} from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, Check, Diamond, FileDown, GitPullRequestArrow, Lightbulb, ListTodo, Pencil, Plus, Printer, ThumbsUp, Trash2, UserPlus, Users, X } from "lucide-react";
import { useState, type DragEvent } from "react";

/* Projekty III (v1.35, ADR-132): přehled se semaforem, tým, Kanban úkolů, milníky, rizika a problémy, změny, hlášení stavu a poučení, portfolio. */

type OnChange = (d: ProjectDetailDto) => void;
const ragColor: Record<Rag, string> = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-red-500" };
const ragTone: Record<Rag, Tone> = { green: "green", amber: "amber", red: "red" };
const levelTone: Record<string, Tone> = { low: "slate", medium: "amber", high: "red" };
const czk = (n: number) => `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč`;

export function RagDot({ rag, size = 10, title }: { rag: Rag | null; size?: number; title?: string }) {
  return <span title={title} className={cn("inline-block shrink-0 rounded-full", rag ? ragColor[rag] : "border border-dashed border-slate-400")} style={{ width: size, height: size }} />;
}

function useUsers() {
  return useQuery({ queryKey: ["directory-users"], queryFn: api.directory.users });
}

/* ---------------- přehled projektu ---------------- */

export function ProjectOverview({ p, onTab, onChange }: { p: ProjectDetailDto; onTab: (tab: string) => void; onChange: OnChange }) {
  const t = useT();
  const rep = p.reports[0];
  const rag = rep ?? p.suggested;
  const open = p.tasks.filter((x) => x.status !== "done");
  const openIssues = p.issues.filter((x) => x.status !== "closed");
  const nextMs = p.milestones.find((m) => !m.doneAt);
  const cur = p.phases.find((x) => x.status === "active");
  const tile = (label: string, value: string | number, sub: string | null, tab: string, tone?: Tone) => (
    <button type="button" onClick={() => onTab(tab)} className="rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:ring-1 hover:ring-brand-300">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "red" && "text-red-700", tone === "amber" && "text-amber-700")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-slate-500">{sub}</div>}
    </button>
  );
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start gap-6 p-5">
          <div className="min-w-56">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("pm.health")}</div>
            <div className="mt-2 flex items-center gap-3">
              <RagDot rag={rag.overall} size={28} />
              <div>
                <div className="text-lg font-semibold">{t.lbl(PROJECT_LABELS2.rag[rag.overall])}</div>
                <div className="text-xs text-slate-500">{rep ? t("pm.reportedOn", { d: fmtDay(rep.date), who: rep.createdByName ?? "—" }) : t("pm.suggestedOnly")}</div>
              </div>
            </div>
          </div>
          <div className="grid flex-1 grid-cols-3 gap-3">
            {(["schedule", "budget", "scope"] as const).map((k) => (
              <div key={k} className="rounded-md bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <RagDot rag={rag[k]} /> {t(`pm.rag.${k}`)}
                </div>
                {rep && rep[k] !== p.suggested[k] && <div className="mt-1 text-xs text-slate-500">{t("pm.dataSays", { v: t.lbl(PROJECT_LABELS2.rag[p.suggested[k]]) })}</div>}
              </div>
            ))}
          </div>
          {p.canReport && (
            <Button variant="secondary" onClick={() => onTab("status")}>
              <CalendarClock size={16} /> {t("pm.report.new")}
            </Button>
          )}
        </div>
        {rep && <p className="border-t border-slate-100 px-5 py-3 text-sm whitespace-pre-wrap text-slate-700">{rep.summary}</p>}
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tile(t("pm.k.phase"), `${p.progress.approved}/${p.progress.phases}`, cur ? t.lbl(cur.name) : null, "phases", cur?.overdue ? "red" : undefined)}
        {tile(t("pm.k.tasks"), open.length, t("pm.k.tasksSub", { o: open.filter((x) => x.overdue).length, b: open.filter((x) => x.status === "blocked").length }), "tasks", open.some((x) => x.overdue) ? "amber" : undefined)}
        {tile(t("pm.k.milestone"), nextMs ? fmtDay(nextMs.dueDate) : "—", nextMs?.name ?? null, "schedule", nextMs?.overdue ? "red" : undefined)}
        {tile(t("pm.k.issues"), openIssues.length, t("pm.k.issuesSub", { n: openIssues.filter((x) => x.level === "high").length }), "raid", openIssues.some((x) => x.level === "high") ? "red" : undefined)}
        {tile(t("pm.k.budget"), p.budget ? `${Math.round((p.spent / p.budget) * 100)} %` : p.spent ? czk(p.spent) : "—", p.budget ? `${czk(p.spent)} / ${czk(p.budget)}` : null, "budget", p.budgetState === "over" ? "red" : p.budgetState === "warn" ? "amber" : undefined)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <TeamCard p={p} onChange={onChange} />
        <Card>
          <CardHeader title={t("pm.attention")} />
          <ul className="space-y-1.5 px-5 pb-5 text-sm">
            {cur && cur.blockers.length > 0 && <Attn tone="amber" text={t("pm.a.blockers", { phase: t.lbl(cur.name), n: cur.blockers.length })} onClick={() => onTab("phases")} />}
            {cur && !cur.blockers.length && p.status === "active" && <Attn tone="green" text={t("pm.a.gateReady", { phase: t.lbl(cur.name) })} onClick={() => onTab("phases")} />}
            {p.changes.filter((x) => x.status === "submitted").map((x) => (
              <Attn key={x.id} tone="blue" text={t("pm.a.change", { n: x.number, title: x.title })} onClick={() => onTab("changes")} />
            ))}
            {open.filter((x) => x.status === "blocked").map((x) => (
              <Attn key={x.id} tone="red" text={t("pm.a.blocked", { title: x.title })} onClick={() => onTab("tasks")} />
            ))}
            {p.milestones.filter((m) => m.overdue).map((m) => (
              <Attn key={m.id} tone="red" text={t("pm.a.milestone", { name: m.name, d: fmtDay(m.dueDate) })} onClick={() => onTab("schedule")} />
            ))}
            {openIssues.filter((x) => x.level === "high").map((x) => (
              <Attn key={x.id} tone="red" text={`${t.lbl(PROJECT_LABELS2.issueKind[x.kind])}: ${x.title}`} onClick={() => onTab("raid")} />
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Attn({ tone, text, onClick }: { tone: "red" | "amber" | "green" | "blue"; text: string; onClick: () => void }) {
  const c = { red: "bg-red-500", amber: "bg-amber-400", green: "bg-emerald-500", blue: "bg-blue-500" }[tone];
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-50">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", c)} /> {text}
      </button>
    </li>
  );
}

/* ---------------- tým ---------------- */

function TeamCard({ p, onChange }: { p: ProjectDetailDto; onChange: OnChange }) {
  const t = useT();
  const users = useUsers();
  const [f, setF] = useState<{ userId: string; role: string; raci: "R" | "A" | "C" | "I" } | null>(null);
  const cur = p;
  const add = useMutation({ mutationFn: () => api.projects.addMember(p.id, f!), onSuccess: (d) => (onChange(d), setF(null)) });
  const remove = useMutation({ mutationFn: (mid: string) => api.projects.removeMember(p.id, mid), onSuccess: onChange });
  return (
    <Card>
      <CardHeader
        title={t("pm.team")}
        action={
          p.canEdit && (
            <Button variant="secondary" onClick={() => setF({ userId: "", role: "", raci: "R" })}>
              <UserPlus size={16} /> {t("pm.addMember")}
            </Button>
          )
        }
      />
      <ErrorBox error={add.error ?? remove.error} />
      <ul className="divide-y divide-slate-100 px-5 pb-4 text-sm">
        <li className="flex items-center gap-2 py-1.5">
          <Badge tone="blue">A</Badge> <span className="font-medium">{p.sponsorName ?? "—"}</span> <span className="text-slate-500">{t("prj.sponsor")}</span>
        </li>
        <li className="flex items-center gap-2 py-1.5">
          <Badge tone="blue">R</Badge> <span className="font-medium">{p.managerName ?? "—"}</span> <span className="text-slate-500">{t("prj.manager")}</span>
        </li>
        {cur.members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 py-1.5">
            <Badge tone={m.raci === "R" || m.raci === "A" ? "blue" : "slate"}>{m.raci}</Badge>
            <span className="font-medium">{m.name}</span>
            <span className="text-slate-500">{m.role}</span>
            {p.canEdit && (
              <Button variant="ghost" className="ml-auto px-2 text-red-600" title={t("prj.remove")} onClick={() => remove.mutate(m.id)}>
                <X size={14} />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {f && (
        <Modal
          open
          onClose={() => setF(null)}
          title={t("pm.addMember")}
          footer={
            <Button disabled={!f.userId || !f.role.trim() || add.isPending} onClick={() => add.mutate()}>
              {t("prj.add")}
            </Button>
          }
        >
          <div className="space-y-3">
            <Field label={t("pm.member")}>
              <UserSelect value={(f.userId) || null} onChange={(v) => setF({ ...f, userId: (v ?? "") })} emptyLabel="—" />
            </Field>
            <Field label={t("pm.role")}>
              <Input value={f.role} placeholder={t("pm.rolePh")} onChange={(e) => setF({ ...f, role: e.target.value })} />
            </Field>
            <Field label="RACI" hint={t("pm.raciHint")}>
              <Select value={f.raci} onChange={(e) => setF({ ...f, raci: e.target.value as typeof f.raci })}>
                {PROJECT_RACI.map((r) => (
                  <option key={r} value={r}>
                    {t.lbl(PROJECT_LABELS2.raci[r])}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ---------------- úkoly (Kanban) ---------------- */

const colTone: Record<ProjectTaskStatus, string> = { todo: "border-t-slate-400", doing: "border-t-blue-500", blocked: "border-t-red-500", done: "border-t-emerald-500" };
const emptyTask = (): ProjectTaskInput => ({ title: "", description: "", phaseId: null, assigneeId: null, dueDate: null, priority: "medium", status: "todo" });

export function TasksBoard({ p, onChange }: { p: ProjectDetailDto; onChange: OnChange }) {
  const t = useT();
  const users = useUsers();
  const [edit, setEdit] = useState<{ id: string | null; f: ProjectTaskInput } | null>(null);
  const [mine, setMine] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<ProjectTaskStatus | null>(null);
  const move = useMutation({ mutationFn: (x: { id: string; status: ProjectTaskStatus; order?: number }) => api.projects.updateTask(p.id, x.id, { status: x.status, order: x.order }), onSuccess: onChange });
  const save = useMutation({
    mutationFn: () => (edit!.id ? api.projects.updateTask(p.id, edit!.id, edit!.f) : api.projects.addTask(p.id, edit!.f)),
    onSuccess: (d) => (onChange(d), setEdit(null)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.projects.removeTask(p.id, id), onSuccess: (d) => (onChange(d), setEdit(null)) });
  const me = useMe().user.id;
  const tasks = p.tasks.filter((x) => !mine || x.assigneeId === me);
  const drop = (status: ProjectTaskStatus) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const task = p.tasks.find((x) => x.id === drag);
    setDrag(null);
    if (!task || task.status === status || !task.canMove) return;
    const max = Math.max(0, ...p.tasks.filter((x) => x.status === status).map((x) => x.order));
    move.mutate({ id: task.id, status, order: max + 1 });
  };
  const open = (x: ProjectTaskDto) => setEdit({ id: x.id, f: { title: x.title, description: x.description ?? "", phaseId: x.phaseId, assigneeId: x.assigneeId, dueDate: x.dueDate, priority: x.priority, status: x.status } });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant={mine ? "primary" : "secondary"} onClick={() => setMine(!mine)}>
          <ListTodo size={16} /> {t("pm.myTasks")}
        </Button>
        <span className="text-sm text-slate-500">{t("pm.dragHint")}</span>
        {p.canEdit && (
          <Button className="ml-auto" onClick={() => setEdit({ id: null, f: emptyTask() })}>
            <Plus size={16} /> {t("pm.task.new")}
          </Button>
        )}
      </div>
      <ErrorBox error={move.error} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PROJECT_TASK_STATUSES.map((s) => {
          const col = tasks.filter((x) => x.status === s).sort((a, b) => a.order - b.order);
          return (
            <div
              key={s}
              data-testid={`col-${s}`}
              onDragOver={(e) => (e.preventDefault(), setOver(s))}
              onDragLeave={() => setOver(null)}
              onDrop={drop(s)}
              className={cn("min-h-40 rounded-lg border-t-4 bg-slate-50 p-2", colTone[s], over === s && "ring-2 ring-brand-400")}
            >
              <div className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {t.lbl(PROJECT_LABELS2.task[s])} <span className="rounded bg-white px-1.5 text-xs text-slate-500">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((x) => (
                  <div
                    key={x.id}
                    draggable={x.canMove}
                    onDragStart={() => setDrag(x.id)}
                    className={cn("group rounded-md border border-slate-200 bg-white p-2.5 text-sm shadow-sm", x.canMove && "cursor-grab", x.overdue && "border-l-4 border-l-red-500")}
                  >
                    <button type="button" className="w-full text-left font-medium hover:underline" onClick={() => open(x)}>
                      {x.title}
                    </button>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {x.priority !== "medium" && <Badge tone={x.priority === "high" ? "red" : "slate"}>{t.lbl(PROJECT_LABELS2.priority[x.priority])}</Badge>}
                      {x.phaseName && <span className="rounded bg-slate-100 px-1.5">{t.lbl(x.phaseName)}</span>}
                      {x.dueDate && <span className={cn(x.overdue && "font-medium text-red-600")}>{fmtDay(x.dueDate)}</span>}
                      {x.assigneeName && (
                        <span className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-800" title={x.assigneeName}>
                          {x.assigneeName
                            .split(" ")
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                      )}
                    </div>
                    {x.canMove && (
                      <div className="mt-1.5 hidden gap-1 group-hover:flex">
                        {PROJECT_TASK_STATUSES.filter((st) => st !== s).map((st) => (
                          <button key={st} type="button" className="rounded border border-slate-200 px-1.5 text-[11px] text-slate-600 hover:bg-slate-100" onClick={() => move.mutate({ id: x.id, status: st })}>
                            → {t.lbl(PROJECT_LABELS2.task[st])}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? edit.f.title : t("pm.task.new")}
          footer={
            <div className="flex w-full justify-between gap-2">
              {edit.id && p.canEdit ? (
                <Button variant="ghost" className="text-red-600" onClick={async () => (await askConfirm(t("pm.task.deleteConfirm"), { danger: true })) && remove.mutate(edit.id!)}>
                  <Trash2 size={16} /> {t("prj.remove")}
                </Button>
              ) : (
                <span />
              )}
              {p.canEdit && (
                <Button disabled={!edit.f.title.trim() || save.isPending} onClick={() => save.mutate()}>
                  {t("prj.save")}
                </Button>
              )}
            </div>
          }
        >
          <ErrorBox error={save.error ?? remove.error} />
          <fieldset disabled={!p.canEdit} className="space-y-3">
            <Field label={t("pm.task.title")}>
              <Input value={edit.f.title} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, title: e.target.value } })} />
            </Field>
            <Field label={t("prj.description")}>
              <Textarea rows={3} value={edit.f.description ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, description: e.target.value } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("pm.task.assignee")}>
                <UserSelect value={(edit.f.assigneeId ?? "") || null} onChange={(v) => setEdit({ ...edit, f: { ...edit.f, assigneeId: v } })} emptyLabel="—" />
              </Field>
              <Field label={t("pm.task.due")}>
                <Input type="date" value={edit.f.dueDate ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, dueDate: e.target.value || null } })} />
              </Field>
              <Field label={t("prj.phase")}>
                <Select value={edit.f.phaseId ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, phaseId: e.target.value || null } })}>
                  <option value="">—</option>
                  {p.phases.map((ph) => (
                    <option key={ph.id} value={ph.id}>
                      {t.lbl(ph.name)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pm.task.priority")}>
                <Select value={edit.f.priority} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, priority: e.target.value as ProjectTaskInput["priority"] & string } })}>
                  {PROJECT_PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(PROJECT_LABELS2.priority[x])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("prj.status")}>
                <Select value={edit.f.status} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, status: e.target.value as ProjectTaskStatus } })}>
                  {PROJECT_TASK_STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(PROJECT_LABELS2.task[x])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </fieldset>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- milníky ---------------- */

export function MilestonesCard({ p, onChange }: { p: ProjectDetailDto; onChange: OnChange }) {
  const t = useT();
  const [edit, setEdit] = useState<{ id: string | null; f: MilestoneInput } | null>(null);
  const save = useMutation({ mutationFn: () => (edit!.id ? api.projects.updateMilestone(p.id, edit!.id, edit!.f) : api.projects.addMilestone(p.id, edit!.f)), onSuccess: (d) => (onChange(d), setEdit(null)) });
  const toggle = useMutation({ mutationFn: (m: MilestoneDto) => api.projects.updateMilestone(p.id, m.id, { name: m.name, dueDate: m.dueDate, phaseId: m.phaseId, done: !m.doneAt }), onSuccess: onChange });
  const remove = useMutation({ mutationFn: (id: string) => api.projects.removeMilestone(p.id, id), onSuccess: onChange });
  return (
    <Card className="mt-5">
      <CardHeader
        title={t("pm.milestones")}
        subtitle={t("pm.milestonesHint")}
        action={
          p.canEdit && (
            <Button variant="secondary" onClick={() => setEdit({ id: null, f: { name: "", dueDate: "", phaseId: null, done: false } })}>
              <Diamond size={16} /> {t("pm.milestone.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={toggle.error ?? remove.error} />
      {!p.milestones.length ? (
        <EmptyState>{t("pm.milestone.none")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 px-5 pb-4 text-sm">
          {p.milestones.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
              <button type="button" disabled={!p.canEdit} onClick={() => toggle.mutate(m)} title={m.doneAt ? t("pm.milestone.undo") : t("pm.milestone.done")} className={cn("flex h-5 w-5 rotate-45 items-center justify-center border-2", m.doneAt ? "border-emerald-600 bg-emerald-500" : m.overdue ? "border-red-500" : "border-slate-400")}>
                {m.doneAt && <Check size={11} className="-rotate-45 text-white" />}
              </button>
              <span className={cn("font-medium", m.doneAt && "text-slate-500 line-through")}>{m.name}</span>
              <span className={cn("tabular-nums", m.overdue ? "font-medium text-red-600" : "text-slate-500")}>{fmtDay(m.dueDate)}</span>
              {m.phaseId && <span className="text-xs text-slate-500">{t.lbl(p.phases.find((x) => x.id === m.phaseId)?.name ?? "")}</span>}
              {p.canEdit && (
                <span className="ml-auto flex gap-1">
                  <Button variant="ghost" className="px-2" onClick={() => setEdit({ id: m.id, f: { name: m.name, dueDate: m.dueDate, phaseId: m.phaseId, done: !!m.doneAt } })}>
                    <Pencil size={14} />
                  </Button>
                  <Button variant="ghost" className="px-2 text-red-600" onClick={() => remove.mutate(m.id)}>
                    <Trash2 size={14} />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={edit.id ? t("pm.milestone.edit") : t("pm.milestone.new")}
          footer={
            <Button disabled={!edit.f.name.trim() || !edit.f.dueDate || save.isPending} onClick={() => save.mutate()}>
              {t("prj.save")}
            </Button>
          }
        >
          <ErrorBox error={save.error} />
          <div className="space-y-3">
            <Field label={t("prj.name")}>
              <Input value={edit.f.name} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, name: e.target.value } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("pm.task.due")}>
                <Input type="date" value={edit.f.dueDate} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, dueDate: e.target.value } })} />
              </Field>
              <Field label={t("prj.phase")}>
                <Select value={edit.f.phaseId ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, phaseId: e.target.value || null } })}>
                  <option value="">—</option>
                  {p.phases.map((ph) => (
                    <option key={ph.id} value={ph.id}>
                      {t.lbl(ph.name)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ---------------- rizika a problémy ---------------- */

const emptyIssue = (): ProjectIssueInput => ({ kind: "risk", title: "", description: "", probability: "medium", impact: "medium", ownerId: null, status: "open", response: "", dueDate: null });

export function RaidTab({ p, onChange }: { p: ProjectDetailDto; onChange: OnChange }) {
  const t = useT();
  const users = useUsers();
  const [edit, setEdit] = useState<{ id: string | null; f: ProjectIssueInput } | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const save = useMutation({ mutationFn: () => (edit!.id ? api.projects.updateIssue(p.id, edit!.id, edit!.f) : api.projects.addIssue(p.id, edit!.f)), onSuccess: (d) => (onChange(d), setEdit(null)) });
  const remove = useMutation({ mutationFn: (id: string) => api.projects.removeIssue(p.id, id), onSuccess: (d) => (onChange(d), setEdit(null)) });
  const list = p.issues.filter((x) => showClosed || x.status !== "closed");
  const grid = (["high", "medium", "low"] as const).map((imp) => (["low", "medium", "high"] as const).map((prob) => p.issues.filter((x) => x.kind === "risk" && x.status !== "closed" && x.impact === imp && x.probability === prob)));
  const open = (x: ProjectIssueDto) => setEdit({ id: x.id, f: { kind: x.kind, title: x.title, description: x.description ?? "", probability: x.probability, impact: x.impact, ownerId: x.ownerId, status: x.status, response: x.response ?? "", dueDate: x.dueDate } });
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
      <Card>
        <CardHeader
          title={t("pm.raid")}
          subtitle={t("pm.raidHint")}
          action={
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowClosed(!showClosed)}>
                {showClosed ? t("pm.hideClosed") : t("pm.showClosed")}
              </Button>
              {p.canEdit && (
                <Button onClick={() => setEdit({ id: null, f: emptyIssue() })}>
                  <Plus size={16} /> {t("pm.issue.new")}
                </Button>
              )}
            </div>
          }
        />
        {!list.length ? (
          <EmptyState>{t("pm.issue.none")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="px-5 py-2">{t("pm.issue.title")}</th>
                  <th className="py-2 pr-3">{t("pm.issue.level")}</th>
                  <th className="py-2 pr-3">{t("pm.issue.owner")}</th>
                  <th className="py-2 pr-3">{t("pm.task.due")}</th>
                  <th className="py-2 pr-5">{t("prj.status")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id} className={cn("cursor-pointer border-b border-slate-100 hover:bg-slate-50", x.status === "closed" && "opacity-60")} onClick={() => open(x)}>
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={x.kind === "issue" ? "red" : "slate"}>{t.lbl(PROJECT_LABELS2.issueKind[x.kind])}</Badge>
                        <span className="font-medium">{x.title}</span>
                      </div>
                      {x.response && <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{x.response}</div>}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={levelTone[x.level]}>
                        {t.lbl(PROJECT_LABELS2.priority[x.level])} · {x.score}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{x.ownerName ?? "—"}</td>
                    <td className={cn("py-2 pr-3 tabular-nums", x.overdue && "font-medium text-red-600")}>{x.dueDate ? fmtDay(x.dueDate) : "—"}</td>
                    <td className="py-2 pr-5">{t.lbl(PROJECT_LABELS2.issueStatus[x.status])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title={t("pm.heatmap")} />
        <div className="px-5 pb-5">
          <div className="grid grid-cols-[1.5rem_repeat(3,1fr)] gap-1 text-center text-xs">
            {grid.map((row, i) => (
              <div key={i} className="contents">
                <div className="flex items-center justify-center text-[10px] text-slate-500 [writing-mode:vertical-rl] rotate-180">{t.lbl(PROJECT_LABELS2.priority[(["high", "medium", "low"] as const)[i]!])}</div>
                {row.map((cell, j) => {
                  const score = (3 - i) * (j + 1);
                  return (
                    <div key={j} className={cn("flex h-14 items-center justify-center rounded text-base font-semibold", score >= 6 ? "bg-red-100 text-red-800" : score >= 3 ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-800")} title={cell.map((x) => x.title).join(", ")}>
                      {cell.length || ""}
                    </div>
                  );
                })}
              </div>
            ))}
            <div />
            {(["low", "medium", "high"] as const).map((x) => (
              <div key={x} className="text-[10px] text-slate-500">
                {t.lbl(PROJECT_LABELS2.priority[x])}
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>↑ {t("pm.impact")}</span>
            <span>{t("pm.probability")} →</span>
          </div>
        </div>
      </Card>
      {edit && (
        <Modal
          open
          wide
          onClose={() => setEdit(null)}
          title={edit.id ? edit.f.title : t("pm.issue.new")}
          footer={
            <div className="flex w-full justify-between gap-2">
              {edit.id && p.canEdit ? (
                <Button variant="ghost" className="text-red-600" onClick={async () => (await askConfirm(t("pm.issue.deleteConfirm"), { danger: true })) && remove.mutate(edit.id!)}>
                  <Trash2 size={16} /> {t("prj.remove")}
                </Button>
              ) : (
                <span />
              )}
              {p.canEdit && (
                <Button disabled={!edit.f.title.trim() || save.isPending} onClick={() => save.mutate()}>
                  {t("prj.save")}
                </Button>
              )}
            </div>
          }
        >
          <ErrorBox error={save.error ?? remove.error} />
          <fieldset disabled={!p.canEdit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
              <Field label={t("pm.issue.kind")}>
                <Select value={edit.f.kind} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, kind: e.target.value as "risk" | "issue" } })}>
                  {ISSUE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(PROJECT_LABELS2.issueKind[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pm.issue.title")}>
                <Input value={edit.f.title} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, title: e.target.value } })} />
              </Field>
            </div>
            <Field label={t("prj.description")}>
              <Textarea rows={2} value={edit.f.description ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, description: e.target.value } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-4">
              {edit.f.kind === "risk" && (
                <Field label={t("pm.probability")}>
                  <Select value={edit.f.probability ?? "medium"} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, probability: e.target.value as "low" } })}>
                    {PROJECT_PRIORITIES.map((x) => (
                      <option key={x} value={x}>
                        {t.lbl(PROJECT_LABELS2.priority[x])}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t("pm.impact")}>
                <Select value={edit.f.impact} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, impact: e.target.value as "low" } })}>
                  {PROJECT_PRIORITIES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(PROJECT_LABELS2.priority[x])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pm.issue.owner")}>
                <UserSelect value={(edit.f.ownerId ?? "") || null} onChange={(v) => setEdit({ ...edit, f: { ...edit.f, ownerId: v } })} emptyLabel="—" />
              </Field>
              <Field label={t("prj.status")}>
                <Select value={edit.f.status} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, status: e.target.value as "open" } })}>
                  {ISSUE_STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(PROJECT_LABELS2.issueStatus[x])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("pm.issue.response")}>
              <Textarea rows={2} value={edit.f.response ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, response: e.target.value } })} />
            </Field>
            <Field label={t("pm.task.due")}>
              <Input type="date" className="w-48" value={edit.f.dueDate ?? ""} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, dueDate: e.target.value || null } })} />
            </Field>
          </fieldset>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- žádosti o změnu ---------------- */

export function ChangesTab({ p, onChange }: { p: ProjectDetailDto; onChange: OnChange }) {
  const t = useT();
  const [f, setF] = useState<(ChangeRequestInput & { budgetText: string }) | null>(null);
  const [comment, setComment] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: () => api.projects.addChange(p.id, { title: f!.title, description: f!.description, newEndDate: f!.newEndDate || null, budgetDelta: f!.budgetText ? Number(f!.budgetText) : null, scope: f!.scope || null }),
    onSuccess: (d) => (onChange(d), setF(null), toast(t("pm.change.submitted"))),
  });
  const decide = useMutation({ mutationFn: (x: { id: string; d: "approved" | "rejected" }) => api.projects.decideChange(p.id, x.id, x.d, comment[x.id] || undefined), onSuccess: onChange });
  const tone = { submitted: "amber", approved: "green", rejected: "red" } as const;
  return (
    <Card>
      <CardHeader
        title={t("pm.changes")}
        subtitle={t("pm.changesHint")}
        action={
          p.canEdit &&
          p.status === "active" && (
            <Button onClick={() => setF({ title: "", description: "", newEndDate: null, budgetDelta: null, scope: "", budgetText: "" })}>
              <GitPullRequestArrow size={16} /> {t("pm.change.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={decide.error} />
      {!p.changes.length ? (
        <EmptyState>{t("pm.change.none")}</EmptyState>
      ) : (
        <ul className="space-y-3 px-5 pb-5">
          {p.changes.map((x) => (
            <li key={x.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {x.number}. {x.title}
                </span>
                <Badge tone={tone[x.status]}>{t.lbl(PROJECT_LABELS2.change[x.status])}</Badge>
                <span className="ml-auto text-xs text-slate-500">
                  {x.requestedByName} · {fmtDay(x.createdAt)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{x.description}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {x.newEndDate && (
                  <span className="rounded bg-slate-100 px-2 py-0.5">
                    {t("pm.change.date")}: {x.oldEndDate ? fmtDay(x.oldEndDate) : "—"} → <b>{fmtDay(x.newEndDate)}</b>
                  </span>
                )}
                {x.budgetDelta !== null && (
                  <span className="rounded bg-slate-100 px-2 py-0.5">
                    {t("pm.change.budget")}: <b>{x.budgetDelta > 0 ? "+" : ""}{czk(x.budgetDelta)}</b>
                  </span>
                )}
                {x.scope && (
                  <span className="rounded bg-slate-100 px-2 py-0.5">
                    {t("pm.change.scope")}: {x.scope}
                  </span>
                )}
              </div>
              {x.decidedAt && (
                <div className="mt-2 text-xs text-slate-500">
                  {x.decidedByName} · {fmtDay(x.decidedAt)}
                  {x.comment && ` – „${x.comment}“`}
                </div>
              )}
              {x.canDecide && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label={t("pm.change.comment")} className="min-w-64 flex-1">
                    <Input value={comment[x.id] ?? ""} onChange={(e) => setComment({ ...comment, [x.id]: e.target.value })} />
                  </Field>
                  <Button variant="secondary" className="text-red-700" disabled={decide.isPending} onClick={() => decide.mutate({ id: x.id, d: "rejected" })}>
                    <X size={16} /> {t("pm.change.reject")}
                  </Button>
                  <Button disabled={decide.isPending} onClick={() => decide.mutate({ id: x.id, d: "approved" })}>
                    <Check size={16} /> {t("pm.change.approve")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {f && (
        <Modal
          open
          onClose={() => setF(null)}
          title={t("pm.change.new")}
          footer={
            <Button disabled={f.title.trim().length < 3 || f.description.trim().length < 3 || (!f.newEndDate && !f.budgetText && !f.scope) || add.isPending} onClick={() => add.mutate()}>
              {t("pm.change.submit")}
            </Button>
          }
        >
          <ErrorBox error={add.error} />
          <div className="space-y-3">
            <Field label={t("pm.task.title")}>
              <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label={t("pm.change.why")}>
              <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("pm.change.newEnd")} hint={p.endDate ? t("pm.change.now", { d: fmtDay(p.endDate) }) : undefined}>
                <Input type="date" value={f.newEndDate ?? ""} onChange={(e) => setF({ ...f, newEndDate: e.target.value || null })} />
              </Field>
              <Field label={t("pm.change.budgetDelta")} hint={p.budget !== null ? t("pm.change.now", { d: czk(p.budget) }) : undefined}>
                <Input type="number" value={f.budgetText} onChange={(e) => setF({ ...f, budgetText: e.target.value })} />
              </Field>
            </div>
            <Field label={t("pm.change.scope")}>
              <Textarea rows={2} value={f.scope ?? ""} onChange={(e) => setF({ ...f, scope: e.target.value })} />
            </Field>
            <p className="text-xs text-slate-500">{t("pm.change.flow")}</p>
          </div>
        </Modal>
      )}
    </Card>
  );
}

/* ---------------- hlášení stavu, výstupy, poučení ---------------- */

export function StatusTab({ p, onChange }: { p: ProjectDetailDto; onChange: OnChange }) {
  const t = useT();
  const [f, setF] = useState<StatusReportInput | null>(null);
  const [lesson, setLesson] = useState<{ kind: "went_well" | "improve"; text: string }>({ kind: "went_well", text: "" });
  const add = useMutation({ mutationFn: () => api.projects.addReport(p.id, f!), onSuccess: (d) => (onChange(d), setF(null), toast(t("pm.report.saved"))) });
  const addLesson = useMutation({ mutationFn: () => api.projects.addLesson(p.id, lesson.kind, lesson.text), onSuccess: (d) => (onChange(d), setLesson({ ...lesson, text: "" })) });
  const removeLesson = useMutation({ mutationFn: (id: string) => api.projects.removeLesson(p.id, id), onSuccess: onChange });
  const startReport = () =>
    setF({
      ...p.suggested,
      summary: "",
      achievements: p.tasks
        .filter((x) => x.status === "done" && x.doneAt && Date.now() - Date.parse(x.doneAt) < 31 * 86_400_000)
        .map((x) => `• ${x.title}`)
        .join("\n"),
      nextSteps: p.tasks
        .filter((x) => x.status !== "done")
        .sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"))
        .slice(0, 5)
        .map((x) => `• ${x.title}${x.dueDate ? ` (${fmtDay(x.dueDate)})` : ""}`)
        .join("\n"),
    });
  const ragSel = (k: "overall" | "schedule" | "budget" | "scope") => (
    <Field label={t(k === "overall" ? "pm.rag.overall" : `pm.rag.${k}`)}>
      <div className="flex gap-1">
        {RAG.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setF({ ...f!, [k]: r })}
            className={cn("flex flex-1 items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-xs", f![k] === r ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200")}
          >
            <RagDot rag={r} /> {t.lbl(PROJECT_LABELS2.rag[r])}
          </button>
        ))}
      </div>
      {p.suggested[k] !== f![k] && <div className="mt-0.5 text-[11px] text-slate-500">{t("pm.dataSays", { v: t.lbl(PROJECT_LABELS2.rag[p.suggested[k]]) })}</div>}
    </Field>
  );
  const closed = p.status === "closed" || p.status === "cancelled";
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={t("pm.reports")}
          subtitle={t("pm.reportsHint")}
          action={
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" href={api.projects.reportUrl(p.id, closed ? "closure" : "status", "html")} target="_blank" rel="noreferrer">
                <Printer size={16} /> {closed ? t("pm.out.closure") : t("pm.out.status")}
              </a>
              <a className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50" href={api.projects.reportUrl(p.id, closed ? "closure" : "status", "docx")}>
                <FileDown size={16} /> Word
              </a>
              {!closed && (
                <a className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50" href={api.projects.reportUrl(p.id, "closure", "docx")}>
                  <FileDown size={16} /> {t("pm.out.closureDraft")}
                </a>
              )}
              {p.canReport && (
                <Button onClick={startReport}>
                  <CalendarClock size={16} /> {t("pm.report.new")}
                </Button>
              )}
            </div>
          }
        />
        {!p.reports.length ? (
          <EmptyState>{t("pm.report.none")}</EmptyState>
        ) : (
          <ol className="space-y-3 px-5 pb-5">
            {p.reports.map((r) => (
              <li key={r.id} className="rounded-md border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <RagDot rag={r.overall} size={14} />
                  <span className="font-semibold tabular-nums">{fmtDay(r.date)}</span>
                  {(["schedule", "budget", "scope"] as const).map((k) => (
                    <span key={k} className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <RagDot rag={r[k]} size={8} /> {t(`pm.rag.${k}`)}
                    </span>
                  ))}
                  <span className="ml-auto text-xs text-slate-500">{r.createdByName}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{r.summary}</p>
                {(r.achievements || r.nextSteps) && (
                  <div className="mt-2 grid gap-3 text-xs text-slate-600 sm:grid-cols-2">
                    {r.achievements && (
                      <div>
                        <div className="font-semibold text-slate-500">{t("pm.report.achievements")}</div>
                        <div className="whitespace-pre-wrap">{r.achievements}</div>
                      </div>
                    )}
                    {r.nextSteps && (
                      <div>
                        <div className="font-semibold text-slate-500">{t("pm.report.next")}</div>
                        <div className="whitespace-pre-wrap">{r.nextSteps}</div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card>
        <CardHeader title={t("pm.lessons")} subtitle={t("pm.lessonsHint")} />
        <ErrorBox error={addLesson.error ?? removeLesson.error} />
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          {LESSON_KINDS.map((k) => (
            <div key={k}>
              <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                {k === "went_well" ? <ThumbsUp size={15} className="text-emerald-600" /> : <Lightbulb size={15} className="text-amber-600" />} {t.lbl(PROJECT_LABELS2.lesson[k])}
              </div>
              <ul className="space-y-1 text-sm">
                {p.lessons.filter((x) => x.kind === k).map((x) => (
                  <li key={x.id} className="group flex items-start gap-2 rounded bg-slate-50 px-2 py-1">
                    <span className="flex-1">{x.text}</span>
                    <span className="text-xs text-slate-400">{x.createdByName}</span>
                    {(p.canEdit || closed) && (
                      <button type="button" className="hidden text-red-600 group-hover:inline" onClick={() => removeLesson.mutate(x.id)}>
                        <X size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {(p.canEdit || closed) && (
        <form
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (lesson.text.trim().length >= 3) addLesson.mutate();
          }}
        >
          <Select className="w-48" value={lesson.kind} onChange={(e) => setLesson({ ...lesson, kind: e.target.value as "improve" })} aria-label={t("pm.lessonKind")}>
            {LESSON_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(PROJECT_LABELS2.lesson[k])}
              </option>
            ))}
          </Select>
          <Input className="min-w-64 flex-1" placeholder={t("pm.lessonPh")} value={lesson.text} onChange={(e) => setLesson({ ...lesson, text: e.target.value })} />
          <Button type="submit" variant="secondary" disabled={lesson.text.trim().length < 3 || addLesson.isPending}>
            <Plus size={16} /> {t("prj.add")}
          </Button>
        </form>
        )}
      </Card>
      {f && (
        <Modal
          open
          wide
          onClose={() => setF(null)}
          title={t("pm.report.new")}
          footer={
            <Button disabled={f.summary.trim().length < 3 || add.isPending} onClick={() => add.mutate()}>
              {t("prj.save")}
            </Button>
          }
        >
          <ErrorBox error={add.error} />
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{t("pm.report.hint")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ragSel("overall")}
              {ragSel("schedule")}
              {ragSel("budget")}
              {ragSel("scope")}
            </div>
            <Field label={t("pm.report.summary")}>
              <Textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("pm.report.achievements")}>
                <Textarea rows={4} value={f.achievements ?? ""} onChange={(e) => setF({ ...f, achievements: e.target.value })} />
              </Field>
              <Field label={t("pm.report.next")}>
                <Textarea rows={4} value={f.nextSteps ?? ""} onChange={(e) => setF({ ...f, nextSteps: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- portfolio ---------------- */

export function PortfolioView({ rows }: { rows: ProjectDto[] }) {
  const t = useT();
  const [status, setStatus] = useState<"open" | "all">("open");
  const [ragF, setRagF] = useState<"" | Rag>("");
  const [mgr, setMgr] = useState("");
  const list = rows
    .filter((p) => status === "all" || p.status === "active" || p.status === "on_hold")
    .filter((p) => !ragF || (p.info.rag ?? p.info.suggestedRag) === ragF)
    .filter((p) => !mgr || p.managerName === mgr);
  const active = rows.filter((p) => p.status === "active");
  const managers = [...new Set(rows.map((p) => p.managerName).filter(Boolean))] as string[];
  const kpi = (label: string, n: number, tone?: "red" | "amber") => (
    <Card className="px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", n > 0 && tone === "red" && "text-red-700", n > 0 && tone === "amber" && "text-amber-700")}>{n}</div>
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpi(t("pm.pf.active"), active.length)}
        {kpi(t("pm.pf.red"), active.filter((p) => (p.info.rag ?? p.info.suggestedRag) === "red").length, "red")}
        {kpi(t("pm.pf.overdue"), active.filter((p) => p.overdue).length, "red")}
        {kpi(t("pm.pf.overBudget"), active.filter((p) => p.budgetState === "over").length, "red")}
        {kpi(t("pm.pf.gates"), active.filter((p) => p.info.gateReady).length, "amber")}
        {kpi(t("pm.pf.changes"), active.reduce((a, p) => a + p.info.pendingChanges, 0), "amber")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as "open")} aria-label={t("prj.status")}>
          <option value="open">{t("pm.pf.open")}</option>
          <option value="all">{t("pm.pf.all")}</option>
        </Select>
        <Select className="w-44" value={ragF} onChange={(e) => setRagF(e.target.value as Rag)} aria-label={t("pm.health")}>
          <option value="">{t("pm.pf.anyRag")}</option>
          {RAG.map((r) => (
            <option key={r} value={r}>
              {t.lbl(PROJECT_LABELS2.rag[r])}
            </option>
          ))}
        </Select>
        <Select className="w-52" value={mgr} onChange={(e) => setMgr(e.target.value)} aria-label={t("prj.manager")}>
          <option value="">{t("pm.pf.anyManager")}</option>
          {managers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      </div>
      {!list.length ? (
        <EmptyState>{t("pm.pf.none")}</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const rag = p.info.rag ?? p.info.suggestedRag;
            const pct = p.progress.phases ? (p.progress.approved / p.progress.phases) * 100 : 0;
            return (
              <Link
                key={p.id}
                to="/projects/$projectId"
                params={{ projectId: p.id }}
                className={cn("block rounded-lg border border-l-4 border-slate-200 bg-white p-4 transition hover:shadow-md", rag === "red" ? "border-l-red-500" : rag === "amber" ? "border-l-amber-400" : "border-l-emerald-500")}
              >
                <div className="flex items-start gap-2">
                  <RagDot rag={p.info.rag} size={12} title={p.info.rag ? t("pm.reportedOn", { d: fmtDay(p.info.ragDate!), who: "" }) : t("pm.suggestedOnly")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {p.code ? `${p.code} ` : ""}
                      {p.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {p.managerName ?? "—"} · {p.currentPhase ? t.lbl(p.currentPhase) : t.lbl(PROJECT_LABELS.status[p.status])}
                    </div>
                  </div>
                  {!p.info.rag && <span className="text-[10px] text-slate-400">{t("pm.pf.suggested")}</span>}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-100">
                  <div className="h-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>
                    {t("pm.pf.gatesDone", { a: p.progress.approved, n: p.progress.phases })}
                  </span>
                  {p.endDate && <span className={cn(p.overdue && "font-medium text-red-600")}>{fmtDay(p.endDate)}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  {p.info.tasks.open > 0 && (
                    <span className={cn("rounded px-1.5 py-0.5", p.info.tasks.overdue ? "bg-red-50 text-red-700" : "bg-slate-100")}>
                      <ListTodo size={11} className="mr-0.5 inline" /> {p.info.tasks.open}
                      {p.info.tasks.overdue > 0 && ` (${p.info.tasks.overdue} ${t("pm.pf.late")})`}
                    </span>
                  )}
                  {p.info.issues.high > 0 && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                      <AlertTriangle size={11} className="mr-0.5 inline" /> {p.info.issues.high}
                    </span>
                  )}
                  {p.info.nextMilestone && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">
                      <Diamond size={11} className="mr-0.5 inline" /> {p.info.nextMilestone.name} · {fmtDay(p.info.nextMilestone.dueDate)}
                    </span>
                  )}
                  {p.info.gateReady && p.status === "active" && <Badge tone="green">{t("pm.pf.gateReady")}</Badge>}
                  {p.info.pendingChanges > 0 && <Badge tone="amber">{t("pm.pf.changePending", { n: p.info.pendingChanges })}</Badge>}
                  {p.budget !== null && <Badge tone={p.budgetState === "over" ? "red" : p.budgetState === "warn" ? "amber" : "slate"}>{p.budget ? `${Math.round((p.spent / p.budget) * 100)} %` : "—"}</Badge>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Users size={13} /> {t("pm.pf.legend")}
      </p>
    </div>
  );
}
