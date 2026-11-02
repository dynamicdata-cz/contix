import { askConfirm } from "@/components/ui/overlay";
/** Playbooky s úkoly pro tým (ADR-060): karta playbooku alertu se zadáním úkolů a správa vlastních playbooků. */
import { PositionSelect } from "@/components/pickers";
import { MitreBadges } from "@/components/soc";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import { stepDueDate, TASK_LABELS, type SocAlertDetailDto, type SocPlaybookDto, type SocPlaybookStep, type SocPlaybookView, type TaskStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckSquare, Copy, ListPlus, Pencil, Plus, Square, Trash2, Users } from "lucide-react";
import { useState } from "react";

const taskTone: Record<string, Tone> = { open: "amber", in_progress: "blue", done: "green", cancelled: "slate" };

/** Texty playbooku podle jazyka (vestavěné mají i angličtinu). */
export function usePbText() {
  const t = useT();
  const en = t.locale !== "cs";
  return { name: (p: SocPlaybookView) => (en && p.nameEn) || p.name, step: (s: SocPlaybookStep) => (en && s.textEn) || s.text };
}

export function AlertPlaybookCard({ a, onChange, onUpdated }: { a: SocAlertDetailDto; onChange: (d: { playbookKey?: string; playbookDone?: number[] }) => void; onUpdated: (r: SocAlertDetailDto) => void }) {
  const t = useT();
  const pt = usePbText();
  const list = useQuery({ queryKey: ["soc", "playbooks"], queryFn: api.soc.playbooks });
  const [assign, setAssign] = useState(false);
  const pb = a.playbook;
  const editable = a.canWrite && (a.status === "new" || a.status === "in_progress");
  const doneSet = new Set(a.playbookDone);
  const taskOf = (i: number) => a.playbookTasks.filter((x) => x.step === i).at(-1);
  const options = [...(list.data?.custom.filter((p) => p.enabled && p.companyId === a.companyId) ?? []), ...(list.data?.builtin ?? [])];
  if (!options.some((o) => o.key === pb.key)) options.unshift(pb as SocPlaybookDto);
  return (
    <Card className="overflow-hidden" data-testid="soc-playbook">
      <CardHeader
        title={t("soc.playbook.title")}
        subtitle={t("soc.playbook.progress", { done: doneSet.size, total: pb.steps.length })}
        action={
          <div className="flex flex-wrap gap-2">
            <Select className="w-56" value={pb.key} disabled={!editable} onChange={(e) => onChange({ playbookKey: e.target.value })} aria-label={t("soc.playbook.title")}>
              {options.map((p) => (
                <option key={p.key} value={p.key}>
                  {pt.name(p)}
                  {p.custom ? ` ★` : ""}
                </option>
              ))}
            </Select>
            {editable && (
              <Button variant="secondary" onClick={() => setAssign(true)}>
                <Users size={15} /> {t("soc.pb.assign")}
              </Button>
            )}
          </div>
        }
      />
      <ol className="divide-y divide-slate-100 text-sm">
        {pb.steps.map((s, i) => {
          const on = doneSet.has(i);
          const task = taskOf(i);
          return (
            <li key={i} className="flex items-start gap-2 pr-4">
              <button
                type="button"
                disabled={!editable}
                onClick={() => onChange({ playbookDone: on ? a.playbookDone.filter((x) => x !== i) : [...a.playbookDone, i] })}
                className={cn("flex flex-1 items-start gap-2 px-4 py-2.5 text-left", editable && "hover:bg-slate-50", on && "text-slate-500 line-through")}
                aria-pressed={on}
              >
                {on ? <CheckSquare size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <Square size={16} className="mt-0.5 shrink-0 text-slate-400" />}
                <span>
                  {i + 1}. {pt.step(s)}
                </span>
              </button>
              {task && (
                <Link to="/actions" search={{ task: task.taskId } as never} className="mt-2 shrink-0 text-xs" title={t("soc.pb.taskTitle")}>
                  <Badge tone={taskTone[task.status] ?? "slate"}>
                    Ú-{task.seq} · {task.ownerPositionName ?? t("soc.pb.noOwner")}
                    {task.dueDate ? ` · ${fmtDay(task.dueDate)}` : ""} · {t.lbl(TASK_LABELS.status[task.status as TaskStatus] ?? task.status)}
                  </Badge>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {assign && <AssignModal a={a} onClose={() => setAssign(false)} onDone={(r) => (onUpdated(r), setAssign(false))} />}
    </Card>
  );
}

function AssignModal({ a, onClose, onDone }: { a: SocAlertDetailDto; onClose: () => void; onDone: (r: SocAlertDetailDto) => void }) {
  const t = useT();
  const pt = usePbText();
  const busy = new Set(a.playbookTasks.filter((x) => x.status === "open" || x.status === "in_progress").map((x) => x.step));
  const free = a.playbook.steps.map((s, i) => ({ s, i })).filter(({ i }) => !busy.has(i) && !a.playbookDone.includes(i));
  const [rows, setRows] = useState(free.map(({ s, i }) => ({ index: i, on: true, ownerPositionId: s.ownerPositionId, dueDate: stepDueDate(s.dueHours) })));
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r) => (r.index === i ? { ...r, ...patch } : r)));
  const m = useMutation({
    mutationFn: () => api.soc.playbookTasks(a.id, rows.filter((r) => r.on).map(({ index, ownerPositionId, dueDate }) => ({ index, ownerPositionId, dueDate }))),
    onSuccess: (r) => onDone(r.alert),
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.pb.assignTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !rows.some((r) => r.on)}>
            <ListPlus size={15} /> {t("soc.pb.create", { n: rows.filter((r) => r.on).length })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("soc.pb.assignHint")}</p>
      {free.length === 0 ? (
        <EmptyState>{t("soc.pb.nothingFree")}</EmptyState>
      ) : (
        <div className="space-y-2">
          {free.map(({ s, i }) => {
            const r = rows.find((x) => x.index === i)!;
            return (
              <div key={i} className="rounded-md border border-slate-200 p-3">
                <Checkbox checked={r.on} onChange={(v) => set(i, { on: v })} label={`${i + 1}. ${pt.step(s)}`} />
                {r.on && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_180px]">
                    <PositionSelect value={r.ownerPositionId} onChange={(v) => set(i, { ownerPositionId: v })} ariaLabel={t("soc.pb.ownerOf", { n: i + 1 })} />
                    <Input type="date" value={r.dueDate ?? ""} aria-label={t("soc.pb.dueOf", { n: i + 1 })} onChange={(e) => set(i, { dueDate: e.target.value || null })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ErrorBox error={m.error} />
    </Modal>
  );
}

type Draft = { name: string; description: string; techniques: string; tactics: string; steps: { text: string; ownerPositionId: string | null; dueHours: number | null }[]; enabled: boolean; basedOn: string | null };
const toDraft = (p: SocPlaybookView & { description?: string; enabled?: boolean; basedOn?: string | null }, en: boolean): Draft => ({
  name: (en && p.nameEn) || p.name,
  description: p.description ?? "",
  techniques: p.techniques.join(", "),
  tactics: p.tactics.join(", "),
  steps: p.steps.map((s) => ({ text: (en && s.textEn) || s.text, ownerPositionId: s.ownerPositionId, dueHours: s.dueHours })),
  enabled: p.enabled ?? true,
  basedOn: p.custom ? (p.basedOn ?? null) : p.key,
});
const ids = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

export function PlaybooksTab() {
  const t = useT();
  const can = useCan();
  const pt = usePbText();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "playbooks"], queryFn: api.soc.playbooks });
  const [edit, setEdit] = useState<{ id: string | null; draft: Draft } | null>(null);
  const remove = useMutation({ mutationFn: api.soc.deletePlaybook, onSuccess: () => qc.invalidateQueries({ queryKey: ["soc", "playbooks"] }) });
  const w = can("soc:write");
  const en = t.locale !== "cs";
  const custom = q.data?.custom ?? [];
  return (
    <>
      <Card className="mb-6 overflow-hidden" data-testid="soc-playbooks">
        <CardHeader
          title={t("soc.pb.customTitle")}
          subtitle={t("soc.pb.customSub")}
          action={
            w && (
              <Button onClick={() => setEdit({ id: null, draft: { name: "", description: "", techniques: "", tactics: "", steps: [{ text: "", ownerPositionId: null, dueHours: 24 }], enabled: true, basedOn: null } })}>
                <Plus size={15} /> {t("soc.pb.new")}
              </Button>
            )
          }
        />
        <ErrorBox error={q.error ?? remove.error} />
        {custom.length === 0 ? (
          <EmptyState>{t("soc.pb.empty")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {custom.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    {!p.enabled && <Badge tone="slate">{t("soc.src.disabled")}</Badge>}
                    <MitreBadges ids={p.techniques} />
                  </div>
                  <div className="text-xs text-slate-500">{t("soc.pb.stepsInfo", { n: p.steps.length, owners: p.steps.filter((s) => s.ownerPositionId).length })}</div>
                </div>
                {w && (
                  <div className="flex gap-1">
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEdit({ id: p.id, draft: toDraft(p, false) })} aria-label={t("soc.pb.edit", { name: p.name })}>
                      <Pencil size={13} />
                    </Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={async () => (await askConfirm(t("soc.pb.confirmDelete"))) && remove.mutate(p.id)} aria-label={t("soc.pb.delete", { name: p.name })}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="mb-6 overflow-hidden">
        <CardHeader title={t("soc.pb.builtinTitle")} subtitle={t("soc.pb.builtinSub")} />
        <ul className="divide-y divide-slate-100">
          {q.data?.builtin.map((p) => (
            <li key={p.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{pt.name(p)}</span>
                  <MitreBadges ids={p.techniques} />
                </div>
                <div className="text-xs text-slate-500">{t("soc.pb.stepsInfo", { n: p.steps.length, owners: 0 })}</div>
              </div>
              {w && (
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEdit({ id: null, draft: { ...toDraft(p, en), steps: p.steps.map((s) => ({ text: (en && s.textEn) || s.text, ownerPositionId: null, dueHours: 24 })) } })}>
                  <Copy size={13} /> {t("soc.pb.customize")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {edit && <PlaybookModal id={edit.id} initial={edit.draft} onClose={() => setEdit(null)} onSaved={() => (qc.invalidateQueries({ queryKey: ["soc", "playbooks"] }), setEdit(null))} />}
    </>
  );
}

function PlaybookModal({ id, initial, onClose, onSaved }: { id: string | null; initial: Draft; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(initial);
  const setStep = (i: number, patch: Partial<Draft["steps"][number]>) => setD({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const m = useMutation({
    mutationFn: () => {
      const body = { name: d.name, description: d.description, techniques: ids(d.techniques), tactics: ids(d.tactics), steps: d.steps.filter((s) => s.text.trim()), enabled: d.enabled };
      return id ? api.soc.updatePlaybook(id, body) : api.soc.createPlaybook({ ...body, basedOn: d.basedOn });
    },
    onSuccess: onSaved,
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={id ? t("soc.pb.editTitle") : t("soc.pb.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || d.name.trim().length < 3 || !d.steps.some((s) => s.text.trim().length >= 3)}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <Field label={t("soc.pb.f.name")}>
        <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </Field>
      <Field label={t("soc.pb.f.description")}>
        <Textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("soc.pb.f.techniques")} hint={t("soc.pb.f.matchHint")}>
          <Input value={d.techniques} placeholder="T1110, T1078" onChange={(e) => setD({ ...d, techniques: e.target.value })} />
        </Field>
        <Field label={t("soc.pb.f.tactics")}>
          <Input value={d.tactics} placeholder="TA0006" onChange={(e) => setD({ ...d, tactics: e.target.value })} />
        </Field>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("soc.pb.f.steps")}</div>
        <div className="space-y-2">
          {d.steps.map((s, i) => (
            <div key={i} className="rounded-md border border-slate-200 p-2">
              <div className="flex items-start gap-2">
                <span className="mt-2 w-6 text-right text-xs text-slate-500">{i + 1}.</span>
                <Textarea rows={2} value={s.text} aria-label={t("soc.pb.f.stepText", { n: i + 1 })} onChange={(e) => setStep(i, { text: e.target.value })} />
                <Button variant="secondary" className="px-2 py-1" onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })} disabled={d.steps.length < 2} aria-label={t("soc.pb.f.removeStep", { n: i + 1 })}>
                  <Trash2 size={13} />
                </Button>
              </div>
              <div className="mt-2 grid gap-2 pl-8 sm:grid-cols-[1fr_140px]">
                <PositionSelect value={s.ownerPositionId} onChange={(v) => setStep(i, { ownerPositionId: v })} ariaLabel={t("soc.pb.ownerOf", { n: i + 1 })} />
                <Input type="number" min={1} value={s.dueHours ?? ""} placeholder={t("soc.pb.f.hours")} aria-label={t("soc.pb.f.dueHoursOf", { n: i + 1 })} onChange={(e) => setStep(i, { dueHours: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>
          ))}
        </div>
        {d.steps.length < 30 && (
          <Button variant="secondary" className="mt-2" onClick={() => setD({ ...d, steps: [...d.steps, { text: "", ownerPositionId: null, dueHours: 24 }] })}>
            <Plus size={14} /> {t("soc.pb.f.addStep")}
          </Button>
        )}
      </div>
      <Checkbox checked={d.enabled} onChange={(v) => setD({ ...d, enabled: v })} label={t("soc.pb.f.enabled")} />
      <ErrorBox error={m.error} />
    </Modal>
  );
}
