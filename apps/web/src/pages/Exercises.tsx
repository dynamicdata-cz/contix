import { askConfirm } from "@/components/ui/overlay";
/** Cvičení a tabletop scénáře (ADR-066): seznam, nové ze šablony, příprava, průběh se vstupy scénáře, vyhodnocení, záznam pro audit. */
import { FrameworkBadge } from "@/components/frameworkBadge";
import { PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate, fmtDay } from "@/lib/utils";
import { BCM_LABELS, EXERCISE_LABELS, TASK_LABELS, TEST_TYPES, deliveredInjects, type ExerciseDto, type ExerciseLogKind, type ExerciseStatus, type TaskStatus, type TestResult, type TestType } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { FileDown, Play, Plus, Printer, Send, Square, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const statusTone: Record<ExerciseStatus, Tone> = { planned: "blue", running: "amber", completed: "green", cancelled: "slate" };
const resultTone: Record<TestResult, Tone> = { passed: "green", partial: "amber", failed: "red" };
const logTone: Record<ExerciseLogKind, Tone> = { inject: "violet", decision: "blue", note: "slate", issue: "red" };

export function ExercisesPage() {
  const t = useT();
  const can = useCan();
  const q = useQuery({ queryKey: ["exercises"], queryFn: api.exercises.list });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("ex.title")}
        subtitle={t("ex.subtitle")}
        actions={
          can("bia:write") && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> {t("ex.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error} />
      <Card className="overflow-hidden" data-testid="exercises">
        {q.data?.length === 0 ? (
          <EmptyState>{t("ex.empty")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("ex.col.title")}</th>
                <th className="px-3 py-2">{t("ex.col.type")}</th>
                <th className="px-3 py-2">{t("ex.col.date")}</th>
                <th className="px-3 py-2">{t("ex.col.status")}</th>
                <th className="px-3 py-2">{t("ex.col.result")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data?.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link to="/continuity/exercises/$exerciseId" params={{ exerciseId: e.id }} className="font-medium text-slate-900 hover:text-brand-700">
                      <span className="mr-1.5 text-slate-500">{e.code}</span>
                      {e.title}
                    </Link>
                    {e.plans.length > 0 && <div className="text-xs text-slate-500">{e.plans.map((p) => p.name).join(", ")}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{t.lbl(BCM_LABELS.testType[e.exerciseType])}</td>
                  <td className="px-3 py-2.5 text-xs">{e.plannedAt ? fmtDay(e.plannedAt) : "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={statusTone[e.status]}>{t.lbl(EXERCISE_LABELS.status[e.status])}</Badge>
                  </td>
                  <td className="px-3 py-2.5">{e.result ? <Badge tone={resultTone[e.result]}>{t.lbl(BCM_LABELS.result[e.result])}</Badge> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating && <NewModal onClose={() => setCreating(false)} />}
    </>
  );
}

function NewModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const en = t.locale !== "cs";
  const tpl = useQuery({ queryKey: ["exercises", "templates"], queryFn: api.exercises.templates });
  const plans = useQuery({ queryKey: ["continuity-plans"], queryFn: () => api.plans.list() });
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TestType>("tabletop");
  const [date, setDate] = useState("");
  const [planIds, setPlanIds] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () => {
      const x = tpl.data?.find((y) => y.key === key);
      return api.exercises.create({
        title: title.trim() || (x ? (en ? x.name.en : x.name.cs) : ""),
        exerciseType: type,
        scenarioKey: x?.key ?? null,
        scenario: x ? (en ? x.scenario.en : x.scenario.cs) : "",
        objectives: x ? x.objectives.map((o) => ({ text: en ? o.en : o.cs })) : [],
        injects: x ? x.injects.map((i) => ({ offsetMin: i.offsetMin, text: en ? i.en : i.cs, expected: en ? i.expectedEn : i.expectedCs })) : [],
        plannedAt: date || null,
        planIds,
      });
    },
    onSuccess: (e) => nav({ to: "/continuity/exercises/$exerciseId", params: { exerciseId: e.id } }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("ex.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || (!key && title.trim().length < 3)}>
            {t("ex.create")}
          </Button>
        </>
      }
    >
      <Field label={t("ex.f.template")}>
        <Select value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">{t("ex.f.noTemplate")}</option>
          {tpl.data?.map((x) => (
            <option key={x.key} value={x.key}>
              {en ? x.name.en : x.name.cs}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("ex.f.title")} hint={key ? t("ex.f.titleHint") : undefined}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("ex.col.type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as TestType)}>
            {TEST_TYPES.map((x) => (
              <option key={x} value={x}>
                {t.lbl(BCM_LABELS.testType[x])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("ex.col.date")}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("ex.f.plans")}</div>
        {plans.data?.map((p) => (
          <Checkbox key={p.id} checked={planIds.includes(p.id)} onChange={(v) => setPlanIds(v ? [...planIds, p.id] : planIds.filter((x) => x !== p.id))} label={`${p.code ? `${p.code} ` : ""}${p.name}`} />
        ))}
      </div>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

export function ExerciseDetailPage() {
  const t = useT();
  const { exerciseId } = useParams({ strict: false }) as { exerciseId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["exercise", exerciseId], queryFn: () => api.exercises.get(exerciseId) });
  const set = (r: ExerciseDto) => (qc.setQueryData(["exercise", exerciseId], r), qc.invalidateQueries({ queryKey: ["exercises"] }));
  const start = useMutation({ mutationFn: () => api.exercises.start(exerciseId), onSuccess: set });
  const cancel = useMutation({ mutationFn: () => api.exercises.cancel(exerciseId), onSuccess: set });
  const [completing, setCompleting] = useState(false);
  const e = q.data;
  if (!e) return <ErrorBox error={q.error} />;
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/continuity/exercises" className="hover:text-brand-700">
          {t("ex.back")}
        </Link>
      </div>
      <PageHeader
        title={`${e.code} ${e.title}`}
        subtitle={`${t.lbl(BCM_LABELS.testType[e.exerciseType])} · ${t.lbl(EXERCISE_LABELS.status[e.status])}${e.plannedAt ? ` · ${fmtDay(e.plannedAt)}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {e.canEdit && e.status === "planned" && (
              <Button onClick={() => start.mutate()} disabled={start.isPending}>
                <Play size={15} /> {t("ex.start")}
              </Button>
            )}
            {e.canEdit && e.status === "running" && (
              <Button onClick={() => setCompleting(true)}>
                <Square size={15} /> {t("ex.complete")}
              </Button>
            )}
            {e.canEdit && (e.status === "planned" || e.status === "running") && (
              <Button variant="secondary" onClick={async () => (await askConfirm(t("ex.confirmCancel"))) && cancel.mutate()}>
                {t("ex.cancel")}
              </Button>
            )}
            <a href={`/api/exercises/${e.id}/record.html`} target="_blank" rel="noreferrer">
              <Button variant="secondary">
                <Printer size={15} /> {t("ex.record")}
              </Button>
            </a>
            <a href={`/api/exercises/${e.id}/record.docx`}>
              <Button variant="secondary">
                <FileDown size={15} /> Word
              </Button>
            </a>
          </div>
        }
      />
      <ErrorBox error={start.error ?? cancel.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        {e.status === "planned" ? <PrepCard e={e} onSaved={set} /> : <InfoCard e={e} />}
        {e.status === "running" ? <RunCard e={e} onSaved={set} /> : <LogCard e={e} />}
        {e.status === "completed" && <ResultCard e={e} />}
      </div>
      {completing && <CompleteModal e={e} onClose={() => setCompleting(false)} onDone={(r) => (set(r), setCompleting(false))} />}
    </>
  );
}

function InfoCard({ e }: { e: ExerciseDto }) {
  const t = useT();
  return (
    <Card className="p-5 text-sm" data-testid="exercise-info">
      <div className="mb-2 font-semibold text-slate-900">{t("ex.scenario")}</div>
      <p className="whitespace-pre-wrap text-slate-700">{e.scenario || "—"}</p>
      <div className="mb-1 mt-4 font-semibold text-slate-900">{t("ex.objectives")}</div>
      <ul className="list-disc space-y-1 pl-5">
        {e.objectives.map((o, i) => (
          <li key={i}>
            {o.text}
            {o.met != null && <Badge tone={o.met ? "green" : "red"}>{o.met ? t("ex.met") : t("ex.notMet")}</Badge>}
            {o.note && <span className="text-xs text-slate-500"> – {o.note}</span>}
          </li>
        ))}
      </ul>
      <div className="mb-1 mt-4 font-semibold text-slate-900">{t("ex.participants")}</div>
      <p className="text-slate-700">{e.participants.map((p) => [p.name || p.positionName, p.role].filter(Boolean).join(" – ")).join(", ") || "—"}</p>
      <div className="mb-1 mt-4 font-semibold text-slate-900">{t("ex.f.plans")}</div>
      <p>
        {e.plans.map((p) => (
          <Link key={p.id} to="/continuity/plans/$planId" params={{ planId: p.id }} className="mr-2 text-brand-700 hover:underline">
            {p.name}
          </Link>
        ))}
        {!e.plans.length && "—"}
      </p>
    </Card>
  );
}

function PrepCard({ e, onSaved }: { e: ExerciseDto; onSaved: (r: ExerciseDto) => void }) {
  const t = useT();
  const [d, setD] = useState({ scenario: e.scenario, objectives: e.objectives.map((o) => o.text), injects: e.injects, participants: e.participants, plannedAt: e.plannedAt ?? "", facilitatorPositionId: e.facilitatorPositionId });
  const m = useMutation({
    mutationFn: () =>
      api.exercises.update(e.id, {
        scenario: d.scenario,
        objectives: d.objectives.filter((x) => x.trim().length >= 3).map((x) => ({ text: x })),
        injects: d.injects.filter((x) => x.text.trim().length >= 3),
        participants: d.participants.map(({ positionId, name, role }) => ({ positionId, name, role })),
        plannedAt: d.plannedAt || null,
        facilitatorPositionId: d.facilitatorPositionId,
      }),
    onSuccess: onSaved,
  });
  const dis = !e.canEdit;
  return (
    <Card className="lg:col-span-2" data-testid="exercise-prep">
      <CardHeader
        title={t("ex.prep")}
        subtitle={t("ex.prepSub")}
        action={
          e.canEdit && (
            <Button onClick={() => m.mutate()} disabled={m.isPending}>
              {t("soc.save")}
            </Button>
          )
        }
      />
      <fieldset disabled={dis} className="grid gap-4 p-5 lg:grid-cols-2">
        <div className="space-y-3">
          <Field label={t("ex.scenario")}>
            <Textarea rows={4} value={d.scenario} onChange={(x) => setD({ ...d, scenario: x.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("ex.col.date")}>
              <Input type="date" value={d.plannedAt} onChange={(x) => setD({ ...d, plannedAt: x.target.value })} />
            </Field>
            <Field label={t("ex.facilitator")}>
              <PositionSelect value={d.facilitatorPositionId} onChange={(v) => setD({ ...d, facilitatorPositionId: v })} />
            </Field>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t("ex.objectives")}</div>
            {d.objectives.map((o, i) => (
              <div key={i} className="mb-1 flex gap-2">
                <Input value={o} aria-label={t("ex.objectiveN", { n: i + 1 })} onChange={(x) => setD({ ...d, objectives: d.objectives.map((y, j) => (j === i ? x.target.value : y)) })} />
                <Button variant="secondary" className="px-2" onClick={() => setD({ ...d, objectives: d.objectives.filter((_, j) => j !== i) })} aria-label={t("ex.remove")}>
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
            <Button variant="secondary" className="mt-1 px-2 py-1 text-xs" onClick={() => setD({ ...d, objectives: [...d.objectives, ""] })}>
              <Plus size={13} /> {t("ex.addObjective")}
            </Button>
          </div>
          <div>
            <div className="mb-1 text-sm font-medium text-slate-700">{t("ex.participants")}</div>
            {d.participants.map((p, i) => (
              <div key={i} className="mb-1 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={p.name} placeholder={t("ex.pName")} aria-label={t("ex.pName")} onChange={(x) => setD({ ...d, participants: d.participants.map((y, j) => (j === i ? { ...y, name: x.target.value } : y)) })} />
                <Input value={p.role} placeholder={t("ex.pRole")} aria-label={t("ex.pRole")} onChange={(x) => setD({ ...d, participants: d.participants.map((y, j) => (j === i ? { ...y, role: x.target.value } : y)) })} />
                <Button variant="secondary" className="px-2" onClick={() => setD({ ...d, participants: d.participants.filter((_, j) => j !== i) })} aria-label={t("ex.remove")}>
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
            <Button variant="secondary" className="mt-1 px-2 py-1 text-xs" onClick={() => setD({ ...d, participants: [...d.participants, { positionId: null, name: "", role: "" }] })}>
              <Plus size={13} /> {t("ex.addParticipant")}
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">{t("ex.injects")}</div>
          {d.injects.map((x, i) => (
            <div key={i} className="mb-2 rounded-md border border-slate-200 p-2">
              <div className="flex gap-2">
                <Input type="number" min={0} className="w-24" value={x.offsetMin} aria-label={t("ex.offset")} onChange={(v) => setD({ ...d, injects: d.injects.map((y, j) => (j === i ? { ...y, offsetMin: Number(v.target.value) } : y)) })} />
                <Textarea rows={2} value={x.text} aria-label={t("ex.injectN", { n: i + 1 })} onChange={(v) => setD({ ...d, injects: d.injects.map((y, j) => (j === i ? { ...y, text: v.target.value } : y)) })} />
                <Button variant="secondary" className="px-2" onClick={() => setD({ ...d, injects: d.injects.filter((_, j) => j !== i) })} aria-label={t("ex.remove")}>
                  <Trash2 size={13} />
                </Button>
              </div>
              <Input className="mt-1 text-xs" value={x.expected} placeholder={t("ex.expected")} aria-label={t("ex.expected")} onChange={(v) => setD({ ...d, injects: d.injects.map((y, j) => (j === i ? { ...y, expected: v.target.value } : y)) })} />
            </div>
          ))}
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setD({ ...d, injects: [...d.injects, { offsetMin: (d.injects.at(-1)?.offsetMin ?? 0) + 30, text: "", expected: "" }] })}>
            <Plus size={13} /> {t("ex.addInject")}
          </Button>
        </div>
      </fieldset>
      <ErrorBox error={m.error} />
    </Card>
  );
}

function useElapsed(since: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(i);
  }, []);
  return since ? Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000)) : 0;
}

function RunCard({ e, onSaved }: { e: ExerciseDto; onSaved: (r: ExerciseDto) => void }) {
  const t = useT();
  const elapsed = useElapsed(e.startedAt);
  const done = deliveredInjects(e.log);
  const [kind, setKind] = useState<ExerciseLogKind>("decision");
  const [text, setText] = useState("");
  const log = useMutation({ mutationFn: (d: { kind: ExerciseLogKind; text: string; injectIndex?: number }) => api.exercises.log(e.id, d), onSuccess: (r) => (onSaved(r), setText("")) });
  return (
    <>
      <Card className="overflow-hidden" data-testid="exercise-injects">
        <CardHeader title={t("ex.injects")} subtitle={t("ex.elapsed", { n: elapsed })} />
        <ul className="divide-y divide-slate-100 text-sm">
          {e.injects.map((x, i) => (
            <li key={i} className={cn("px-4 py-2.5", done.has(i) && "bg-slate-50 text-slate-500")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={cn("mr-2 text-xs font-semibold", x.offsetMin <= elapsed && !done.has(i) ? "text-red-700" : "text-slate-500")}>T+{x.offsetMin} min</span>
                  {x.text}
                  {x.expected && <div className="text-xs text-slate-500">{t("ex.expected")}: {x.expected}</div>}
                </div>
                {e.canEdit && !done.has(i) && (
                  <Button variant="secondary" className="shrink-0 px-2 py-1 text-xs" disabled={log.isPending} onClick={() => log.mutate({ kind: "inject", text: x.text, injectIndex: i })}>
                    <Send size={13} /> {t("ex.deliver")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="overflow-hidden" data-testid="exercise-log">
        <CardHeader title={t("ex.log")} />
        {e.canEdit && (
          <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
            <Select className="w-40" value={kind} onChange={(x) => setKind(x.target.value as ExerciseLogKind)} aria-label={t("ex.logKind")}>
              {(["decision", "note", "issue"] as ExerciseLogKind[]).map((k) => (
                <option key={k} value={k}>
                  {t.lbl(EXERCISE_LABELS.logKind[k])}
                </option>
              ))}
            </Select>
            <Input className="flex-1" value={text} placeholder={t("ex.logPh")} aria-label={t("ex.logText")} onChange={(x) => setText(x.target.value)} onKeyDown={(x) => x.key === "Enter" && text.trim() && log.mutate({ kind, text: text.trim() })} />
            <Button disabled={!text.trim() || log.isPending} onClick={() => log.mutate({ kind, text: text.trim() })}>
              {t("ex.add")}
            </Button>
          </div>
        )}
        <LogList e={e} />
        <ErrorBox error={log.error} />
      </Card>
    </>
  );
}

function LogList({ e }: { e: ExerciseDto }) {
  const t = useT();
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {[...e.log].reverse().map((l, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-2 px-4 py-2">
          <span className="w-32 shrink-0 text-xs text-slate-500">{fmtDate(l.at)}</span>
          <Badge tone={logTone[l.kind]}>{t.lbl(EXERCISE_LABELS.logKind[l.kind])}</Badge>
          <span className="flex-1 whitespace-pre-wrap">{l.text}</span>
          {l.userName && <span className="text-xs text-slate-400">{l.userName}</span>}
        </li>
      ))}
    </ul>
  );
}

function LogCard({ e }: { e: ExerciseDto }) {
  const t = useT();
  if (!e.log.length) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("ex.log")} />
      <LogList e={e} />
    </Card>
  );
}

function ResultCard({ e }: { e: ExerciseDto }) {
  const t = useT();
  return (
    <Card className="p-5 text-sm lg:col-span-2" data-testid="exercise-result">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="font-semibold text-slate-900">{t("ex.evaluation")}</span>
        {e.result && <Badge tone={resultTone[e.result]}>{t.lbl(BCM_LABELS.result[e.result])}</Badge>}
        {e.achievedRtoHours != null && <span className="text-slate-600">{t("ex.achievedRto", { h: e.achievedRtoHours })}</span>}
      </div>
      {e.findings && <p className="whitespace-pre-wrap">{e.findings}</p>}
      {e.lessons && <p className="mt-2 whitespace-pre-wrap text-slate-700">{e.lessons}</p>}
      {e.tasks.length > 0 && (
        <ul className="mt-3 space-y-1">
          {e.tasks.map((x) => (
            <li key={x.id}>
              <a href={`/actions?task=${x.id}`} className="text-brand-700 hover:underline">
                Ú-{x.seq} {x.title}
              </a>{" "}
              <Badge tone="slate">{t.lbl(TASK_LABELS.status[x.status as TaskStatus] ?? x.status)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CompleteModal({ e, onClose, onDone }: { e: ExerciseDto; onClose: () => void; onDone: (r: ExerciseDto) => void }) {
  const t = useT();
  const [result, setResult] = useState<TestResult>("passed");
  const [rto, setRto] = useState("");
  const [findings, setFindings] = useState("");
  const [lessons, setLessons] = useState("");
  const [obj, setObj] = useState(e.objectives.map((o) => ({ met: o.met, note: o.note })));
  const [actions, setActions] = useState<{ title: string; ownerPositionId: string | null; dueDate: string | null }[]>([]);
  const m = useMutation({
    mutationFn: () => api.exercises.complete(e.id, { result, achievedRtoHours: rto ? Number(rto) : null, findings, lessons, objectives: obj, actions: actions.filter((a) => a.title.trim().length >= 3) }),
    onSuccess: onDone,
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("ex.completeTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {t("ex.complete")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("ex.col.result")}>
          <Select value={result} onChange={(x) => setResult(x.target.value as TestResult)}>
            {(["passed", "partial", "failed"] as TestResult[]).map((r) => (
              <option key={r} value={r}>
                {t.lbl(BCM_LABELS.result[r])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("ex.rtoField")}>
          <Input type="number" min={0} step="0.25" value={rto} onChange={(x) => setRto(x.target.value)} />
        </Field>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("ex.objectives")}</div>
        {e.objectives.map((o, i) => (
          <div key={i} className="mb-1 grid items-center gap-2 sm:grid-cols-[1fr_140px_1fr]">
            <span className="text-sm">{o.text}</span>
            <Select value={obj[i]!.met == null ? "" : obj[i]!.met ? "1" : "0"} aria-label={t("ex.objectiveN", { n: i + 1 })} onChange={(x) => setObj(obj.map((y, j) => (j === i ? { ...y, met: x.target.value === "" ? null : x.target.value === "1" } : y)))}>
              <option value="">—</option>
              <option value="1">{t("ex.met")}</option>
              <option value="0">{t("ex.notMet")}</option>
            </Select>
            <Input value={obj[i]!.note} placeholder={t("ex.note")} aria-label={t("ex.note")} onChange={(x) => setObj(obj.map((y, j) => (j === i ? { ...y, note: x.target.value } : y)))} />
          </div>
        ))}
      </div>
      <Field label={t("ex.findings")}>
        <Textarea rows={3} value={findings} onChange={(x) => setFindings(x.target.value)} />
      </Field>
      <Field label={t("ex.lessons")}>
        <Textarea rows={3} value={lessons} onChange={(x) => setLessons(x.target.value)} />
      </Field>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("ex.actions")}</div>
        {actions.map((a, i) => (
          <div key={i} className="mb-1 grid gap-2 sm:grid-cols-[1fr_220px_150px_auto]">
            <Input value={a.title} placeholder={t("ex.actionTitle")} aria-label={t("ex.actionTitle")} onChange={(x) => setActions(actions.map((y, j) => (j === i ? { ...y, title: x.target.value } : y)))} />
            <PositionSelect value={a.ownerPositionId} onChange={(v) => setActions(actions.map((y, j) => (j === i ? { ...y, ownerPositionId: v } : y)))} ariaLabel={t("ex.actionOwner")} />
            <Input type="date" value={a.dueDate ?? ""} aria-label={t("ex.actionDue")} onChange={(x) => setActions(actions.map((y, j) => (j === i ? { ...y, dueDate: x.target.value || null } : y)))} />
            <Button variant="secondary" className="px-2" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label={t("ex.remove")}>
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setActions([...actions, { title: "", ownerPositionId: null, dueDate: null }])}>
          <Plus size={13} /> {t("ex.addAction")}
        </Button>
      </div>
      <p className="text-xs text-slate-500">{t("ex.completeHint")}</p>
      <ErrorBox error={m.error} />
    </Modal>
  );
}
