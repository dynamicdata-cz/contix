/**
 * Akce a úkoly (v0.48, ADR-043): jednotný přehled nápravných akcí – úkoly, akce plánu zvládání rizik,
 * nápravná opatření z auditů a úkoly ze změn předpisů; po termínu nahoře, filtry, export CSV.
 */
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Select } from "@/components/ui";
import { priorityTone, TaskModal, taskStatusTone } from "@/components/tasks";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay, useDebounced } from "@/lib/utils";
import { toast } from "@/components/ui/overlay";
import { PositionSelect } from "@/components/pickers";
import { TASK_LABELS, type ActionItem, type ActionKind, type TaskDto, type TaskStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AlarmClock, CalendarClock, CheckCircle2, Download, ListTodo, Plus } from "lucide-react";
import { useState } from "react";

type Status = "active" | "done" | "all";

export function ActionsPage() {
  const t = useT();
  const can = useCan();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title={t("act.title")}
        subtitle={t("act.subtitle")}
        actions={
          <>
            <a href={api.actions.exportUrl()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
              <Download size={15} /> CSV
            </a>
            {can("actions:write") && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} /> {t("act.newTask")}
              </Button>
            )}
          </>
        }
      />
      <ActionsBoard />
      {creating && <TaskModal task={null} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} />}
    </>
  );
}

/** Seznam akcí a úkolů s filtry a hromadnými změnami (v1.10) – stránka Akce a úkoly i záložka v Moje práce. */
export function ActionsBoard({ mineDefault = false }: { mineDefault?: boolean }) {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { task?: string };
  const [kind, setKind] = useState<"" | ActionKind>("");
  const [status, setStatus] = useState<Status>("active");
  const [mine, setMine] = useState(mineDefault);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const bulk = useMutation({
    mutationFn: (v: { status?: TaskStatus; dueDate?: string | null; ownerPositionId?: string | null }) => api.actions.bulkTasks({ ids: [...sel], ...v }),
    onSuccess: (r) => {
      toast(r.skipped.length ? t("act.bulk.doneSkipped", { n: r.updated, s: r.skipped.length }) : t("act.bulk.done", { n: r.updated }), r.skipped.length ? "info" : "success");
      setSel(new Set());
      qc.invalidateQueries({ queryKey: ["actions"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["obligations"] });
    },
  });
  const [bulkDue, setBulkDue] = useState("");
  const [bulkOwner, setBulkOwner] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [text, setText] = useState("");
  const dtext = useDebounced(text);
  const q = useQuery({
    queryKey: ["actions", kind, status, mine, overdue, dtext],
    queryFn: () => api.actions.list({ kind: kind || undefined, status, mine: mine ? "1" : undefined, overdue: overdue ? "1" : undefined, q: dtext.trim() || undefined }),
  });
  // úkol otevřený odkazem (?task=…) – z povinností, e-mailu
  const open = useQuery({ queryKey: ["tasks", "one", search.task], queryFn: () => api.actions.task(search.task!), enabled: !!search.task });
  const closeTask = () => nav({ to: "/actions", search: {} as never, replace: true });
  const sm = q.data?.summary;
  const items = q.data?.items ?? [];

  const taskIds = items.filter((a) => a.kind === "task").map((a) => a.id);
  const toggle = (id: string, on: boolean) => setSel((x) => {
    const n = new Set(x);
    if (on) n.add(id);
    else n.delete(id);
    return n;
  });
  return (
    <>
      <ErrorBox error={q.error ?? open.error} />
      {sm && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi icon={<ListTodo size={16} />} label={t("act.kpi.open")} value={sm.open} onClick={() => (setStatus("active"), setOverdue(false))} />
          <Kpi icon={<AlarmClock size={16} />} label={t("act.kpi.overdue")} value={sm.overdue} tone={sm.overdue ? "red" : "slate"} onClick={() => (setStatus("active"), setOverdue(true))} />
          <Kpi icon={<CalendarClock size={16} />} label={t("act.kpi.soon")} value={sm.dueSoon} tone={sm.dueSoon ? "amber" : "slate"} />
          <Kpi icon={<CheckCircle2 size={16} />} label={t("act.kpi.done30")} value={sm.doneLast30} tone="green" onClick={() => (setStatus("done"), setOverdue(false))} />
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Select className="w-64" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label={t("act.filter.kind")}>
            <option value="">{t("act.filter.allKinds")}</option>
            {(q.data?.kinds ?? []).map((k) => (
              <option key={k} value={k}>
                {t.lbl(TASK_LABELS.kind[k])} ({sm?.byKind[k] ?? 0})
              </option>
            ))}
          </Select>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label={t("act.filter.status")}>
            <option value="active">{t("act.filter.active")}</option>
            <option value="done">{t("act.filter.done")}</option>
            <option value="all">{t("act.filter.all")}</option>
          </Select>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t("act.filter.mine")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> {t("act.filter.overdue")}
          </label>
          <Input className="max-w-xs" placeholder={t("act.filter.search")} value={text} onChange={(e) => setText(e.target.value)} />
          <span className="ml-auto text-xs text-slate-500">{t("act.count", { n: items.length })}</span>
        </div>
        {sel.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-4 py-2.5 text-sm" data-testid="bulk-bar">
            <span className="font-medium text-brand-800">{t("act.bulk.selected", { n: sel.size })}</span>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={bulk.isPending} onClick={() => bulk.mutate({ status: "done" })}>
              {t("act.bulk.markDone")}
            </Button>
            <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={bulk.isPending} onClick={() => bulk.mutate({ status: "in_progress" })}>
              {t("act.bulk.markInProgress")}
            </Button>
            {can("actions:write") && (
              <>
                <Input type="date" className="w-40 py-1 text-xs" value={bulkDue} onChange={(e) => setBulkDue(e.target.value)} aria-label={t("act.bulk.due")} />
                <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!bulkDue || bulk.isPending} onClick={() => bulk.mutate({ dueDate: bulkDue })}>
                  {t("act.bulk.setDue")}
                </Button>
                <div className="w-56">
                  <PositionSelect value={bulkOwner} onChange={setBulkOwner} ariaLabel={t("act.bulk.owner")} className="py-1 text-xs" />
                </div>
                <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={!bulkOwner || bulk.isPending} onClick={() => bulk.mutate({ ownerPositionId: bulkOwner })}>
                  {t("act.bulk.setOwner")}
                </Button>
              </>
            )}
            <button type="button" className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => setSel(new Set())}>
              {t("act.bulk.clear")}
            </button>
            <ErrorBox error={bulk.error} />
          </div>
        )}
        {!q.data ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : items.length === 0 ? (
          <EmptyState>{t("act.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="w-8 pl-4">
                    {taskIds.length > 0 && <input type="checkbox" aria-label={t("act.bulk.all")} checked={taskIds.every((id) => sel.has(id))} onChange={(e) => setSel(e.target.checked ? new Set(taskIds) : new Set())} />}
                  </th>
                  <th className="px-3 py-2">{t("act.col.action")}</th>
                  <th className="w-56 px-3 py-2">{t("act.col.owner")}</th>
                  <th className="w-32 px-3 py-2">{t("act.col.due")}</th>
                  <th className="w-36 px-3 py-2">{t("act.col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((a) => (
                  <Row key={a.key} a={a} selected={sel.has(a.id)} onSelect={a.kind === "task" ? (on) => toggle(a.id, on) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-slate-500">{t("act.footnote")}</p>
      {search.task && open.data && <TaskModal key={open.data.id} task={open.data as TaskDto} onClose={closeTask} onSaved={closeTask} />}
    </>
  );
}

function Row({ a, selected, onSelect }: { a: ActionItem; selected: boolean; onSelect?: (on: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const active = a.status === "open" || a.status === "in_progress";
  return (
    <tr className={cn("align-top", a.overdue && "bg-red-50/40", selected && "bg-brand-50")}>
      <td className="w-8 pl-4 pt-3">{onSelect && <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t("act.bulk.select", { title: a.title })} />}</td>
      <td className="px-3 py-2.5">
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <span>{t.lbl(TASK_LABELS.kind[a.kind])}</span>
          {a.priority && a.priority !== "medium" && <Badge tone={priorityTone[a.priority]}>{t.lbl(TASK_LABELS.priority[a.priority])}</Badge>}
        </div>
        {a.kind === "task" ? (
          <button type="button" className="text-left font-medium hover:text-brand-700" onClick={() => nav({ to: "/actions", search: { task: a.id } as never })}>
            {a.title}
          </button>
        ) : (
          <Link to={a.link as never} className="font-medium hover:text-brand-700">
            {a.title}
          </Link>
        )}
        {a.source && <div className="mt-0.5 text-xs text-slate-500">{a.source}</div>}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-600">{a.ownerName ?? <span className="text-amber-700">{t("act.noOwner")}</span>}</td>
      <td className={cn("px-3 py-2.5 text-xs tabular-nums", a.overdue ? "font-medium text-red-700" : "text-slate-600")}>
        {a.dueDate ? fmtDay(a.dueDate) : active ? <span className="text-slate-400">{t("act.noDue")}</span> : "—"}
        {a.overdue && <div className="font-normal">{t("act.overdue")}</div>}
      </td>
      <td className="px-3 py-2.5">
        <Badge tone={taskStatusTone[a.status]}>{t.lbl(TASK_LABELS.status[a.status])}</Badge>
        {a.completedAt && !active && <div className="mt-0.5 text-xs text-slate-500">{fmtDay(a.completedAt)}</div>}
      </td>
    </tr>
  );
}

const kpiTone = { slate: "text-slate-900", amber: "text-amber-700", red: "text-red-700", green: "text-emerald-700" } as const;
function Kpi({ icon, label, value, tone = "slate", onClick }: { icon: React.ReactNode; label: string; value: number; tone?: keyof typeof kpiTone; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon} {label}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", kpiTone[tone])}>{value}</div>
    </Tag>
  );
}
