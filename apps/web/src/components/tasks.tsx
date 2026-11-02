import { askConfirm } from "@/components/ui/overlay";
/** Úkoly (v0.48, ADR-043): editor úkolu a karta úkolů navázaných na záznam (incident, dodavatel, změna, opatření…). */
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { PositionSelect } from "@/components/pickers";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import { TASK_LABELS, TASK_PRIORITIES, TASK_STATUSES, type TaskDto, type TaskPriority, type TaskSource, type TaskStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ListTodo, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export const taskStatusTone: Record<TaskStatus, Tone> = { open: "blue", in_progress: "amber", done: "green", cancelled: "slate" };
export const priorityTone: Record<TaskPriority, Tone> = { low: "slate", medium: "blue", high: "red" };
const today = () => new Date().toISOString().slice(0, 10);

/** Editor úkolu – nový (s volitelným zdrojem) nebo úprava. Vlastník bez práva správy mění jen stav a poznámku. */
export function TaskModal({ task, source, onClose, onSaved }: { task: TaskDto | null; source?: { kind: TaskSource; id: string } | null; onClose: () => void; onSaved: (t: TaskDto) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const manage = task ? task.canManage : true;
  const [f, setF] = useState({
    title: task?.title ?? "",
    description: task?.description ?? "",
    ownerPositionId: task?.ownerPositionId ?? null,
    dueDate: task?.dueDate ?? "",
    priority: (task?.priority ?? "medium") as TaskPriority,
    status: (task?.status ?? "open") as TaskStatus,
    completionNote: task?.completionNote ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      task
        ? api.actions.update(
            task.id,
            manage
              ? { title: f.title, description: f.description || null, ownerPositionId: f.ownerPositionId, dueDate: f.dueDate || null, priority: f.priority, status: f.status, completionNote: f.completionNote || null }
              : { status: f.status, completionNote: f.completionNote || null },
          )
        : api.actions.create({ title: f.title, description: f.description || null, ownerPositionId: f.ownerPositionId, dueDate: f.dueDate || null, priority: f.priority, status: f.status, completionNote: f.completionNote || null, sourceKind: source?.kind ?? null, sourceId: source?.id ?? null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onSaved(r);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.actions.remove(task!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={task ? `${task.code} ${task.title}` : t("task.newTitle")}
      footer={
        <>
          {task?.canManage && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("task.deleteConfirm"))) && remove.mutate()}>
              <Trash2 size={15} /> {t("task.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          {(!task || task.canEdit) && (
            <Button onClick={() => save.mutate()} disabled={save.isPending || !f.title.trim()}>
              {task ? t("task.save") : t("task.create")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {(task?.sourceLink || source) && (
          <p className="text-sm text-slate-600">
            {t("task.source")}:{" "}
            {task?.sourceLink ? (
              <Link to={task.sourceLink as never} className="font-medium text-brand-700 hover:underline">
                {t.lbl(TASK_LABELS.source[task.sourceKind!])}
                {task.sourceLabel && `: ${task.sourceLabel}`}
              </Link>
            ) : (
              source && t.lbl(TASK_LABELS.source[source.kind])
            )}
          </p>
        )}
        <Field label={t("task.titleLabel")}>
          <Input value={f.title} disabled={!manage} onChange={(e) => set("title", e.target.value)} maxLength={500} />
        </Field>
        <Field label={t("task.description")}>
          <Textarea rows={3} value={f.description} disabled={!manage} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("task.owner")} hint={t("task.ownerHint")}>
            <PositionSelect value={f.ownerPositionId} disabled={!manage} onChange={(v) => set("ownerPositionId", v)} />
          </Field>
          <Field label={t("task.due")}>
            <Input type="date" value={f.dueDate} disabled={!manage} onChange={(e) => set("dueDate", e.target.value)} />
          </Field>
          <Field label={t("task.priority")}>
            <Select value={f.priority} disabled={!manage} onChange={(e) => set("priority", e.target.value as TaskPriority)}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t.lbl(TASK_LABELS.priority[p])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("task.status")}>
            <Select value={f.status} disabled={!!task && !task.canEdit} onChange={(e) => set("status", e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t.lbl(TASK_LABELS.status[s])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("task.completionNote")} hint={t("task.completionNoteHint")}>
          <Textarea rows={2} value={f.completionNote} disabled={!!task && !task.canEdit} onChange={(e) => set("completionNote", e.target.value)} />
        </Field>
        {task && (
          <p className="text-xs text-slate-500">
            {t("task.createdBy", { name: task.createdByName ?? "—", date: fmtDay(task.createdAt) })}
            {task.completedAt && ` · ${t("task.completedOn", { date: fmtDay(task.completedAt) })}`}
          </p>
        )}
        <ErrorBox error={save.error ?? remove.error} />
      </div>
    </Modal>
  );
}

/** Karta „Úkoly“ na kartě záznamu. */
export function TasksCard({ kind, id, className }: { kind: TaskSource; id: string; className?: string }) {
  const t = useT();
  const can = useCan();
  const q = useQuery({ queryKey: ["tasks", kind, id], queryFn: () => api.actions.tasks(kind, id), enabled: can("actions:read") });
  const [edit, setEdit] = useState<TaskDto | "new" | null>(null);
  if (!can("actions:read")) return null;
  const list = q.data ?? [];
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader
        title={t("task.cardTitle")}
        subtitle={t("task.cardSubtitle")}
        action={
          can("actions:write") && (
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setEdit("new")}>
              <Plus size={14} /> {t("task.add")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error} />
      {list.length === 0 ? (
        <EmptyState>{q.data ? t("task.none") : t("common.loading")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((x) => {
            const overdue = (x.status === "open" || x.status === "in_progress") && !!x.dueDate && x.dueDate < today();
            return (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
                <ListTodo size={15} className="text-slate-400" aria-hidden />
                <button className="min-w-0 flex-1 text-left font-medium hover:text-brand-700" onClick={() => setEdit(x)}>
                  <span className="mr-1 text-xs font-normal text-slate-400">{x.code}</span>
                  {x.title}
                </button>
                <span className="text-xs text-slate-500">{x.ownerName ?? "—"}</span>
                {x.dueDate && <span className={cn("text-xs tabular-nums", overdue ? "font-medium text-red-700" : "text-slate-600")}>{fmtDay(x.dueDate)}</span>}
                <Badge tone={taskStatusTone[x.status]}>{t.lbl(TASK_LABELS.status[x.status])}</Badge>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <TaskModal task={edit === "new" ? null : edit} source={{ kind, id }} onClose={() => setEdit(null)} onSaved={() => setEdit(null)} />}
    </Card>
  );
}
