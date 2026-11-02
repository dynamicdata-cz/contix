import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { TransferButton } from "@/components/transfer";
import { AudienceEditor } from "@/components/audience";
import { CompanyCell, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { IdMultiSelect, PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import {
  AWARENESS_LABELS,
  COURSE_FORMS,
  COURSE_KINDS,
  EMPTY_AUDIENCE,
  SESSION_STATUSES,
  SUGGESTED_TOPICS,
  type CourseDetail,
  type CourseForm,
  type CourseInput,
  type CourseKind,
  type SessionStatus,
  type TrainingState,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Download, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export const stateTone: Record<TrainingState, Tone> = { ok: "green", due_soon: "amber", overdue: "red", missing: "blue" };
const STATE_COLOR: Record<TrainingState, string> = { ok: STATUS_COLORS.good, due_soon: STATUS_COLORS.serious, overdue: STATUS_COLORS.critical, missing: STATUS_COLORS.neutral };

function Coverage({ stats, required }: { stats: Record<TrainingState, number>; required: number }) {
  const t = useT();
  if (!required) return <span className="text-xs text-slate-400">{t("awr.okruhNeurcen")}</span>;
  const order: TrainingState[] = ["ok", "due_soon", "missing", "overdue"];
  return (
    <div className="w-40">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={order.map((s) => `${t.lbl(AWARENESS_LABELS.state[s])} ${stats[s]}`).join(", ")}>
        {order.map((s) => stats[s] > 0 && <div key={s} style={{ width: `${(stats[s] / required) * 100}%`, background: STATE_COLOR[s] }} />)}
      </div>
      <div className="mt-1 text-xs text-slate-500">
        {stats.ok + stats.due_soon}/{required} {t("awr.platnych")}{stats.overdue ? <span className="ml-1 font-medium text-red-700">{t("awr.poTerminu", { overdue: stats.overdue })}</span> : null}
      </div>
    </div>
  );
}

export function AwarenessPage() {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const [tab, setTab] = useState<"plan" | "log">("plan");
  const list = useQuery({ queryKey: ["awareness"], queryFn: api.awareness.list });
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const log = useQuery({ queryKey: ["awareness", "log", from, to], queryFn: () => api.awareness.log(from, to), enabled: tab === "log" });
  const exportCsv = () => {
    const rows = [["Datum", t("awr.skoleni"), "Druh", "Osoba", t("awr.vysledek"), t("awr.skore")], ...(log.data ?? []).map((r) => [r.date, r.courseTitle, t.lbl(AWARENESS_LABELS.kind[r.kind]), r.userName, r.passed ? "absolvoval/a" : t("awr.neprospelA"), r.score ?? ""])];
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `prehled-skoleni-${from}-${to}.csv`;
    a.click();
  };
  return (
    <>
      <PageHeader
        title={t("awr.bezpecnostniPovedomiASkoleni")}
        subtitle={t("awr.planRozvojeBezpecnostnihoPovedomi10")}
        actions={
          can("awareness:write") && (
            <Link to="/awareness/new">
              <Button>
                <Plus size={16} /> {t("awr.skoleni")}
              </Button>
            </Link>
          )
        }
      />
      <ErrorBox error={list.error ?? log.error} />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(
          [
            ["plan", t("awr.planSkoleni")],
            ["log", t("awr.prehledAbsolvovani10Odst5")],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-slate-600")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "plan" ? (
        <Card className="overflow-hidden">
          {(list.data ?? []).length === 0 ? (
            <EmptyState>{list.isLoading ? t("common.loading") : t("awr.zatimZadnaSkoleniZalozteVstupni")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("awr.skoleni")}</th>
                  <th className="px-3 py-2">{t("awr.druhForma")}</th>
                  <th className="px-3 py-2">{t("awr.periodicita")}</th>
                  <th className="px-3 py-2">{t("awr.pokryti")}</th>
                  <th className="px-3 py-2">{t("awr.dalsiTermin")}</th>
                  <th className="px-3 py-2">{t("awr.odpovida")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(list.data ?? []).map((c) => (
                  <tr key={c.id} className={cn("hover:bg-slate-50", !c.active && "opacity-60")}>
                    <td className="px-5 py-2.5">
                      <Link to="/awareness/$courseId" params={{ courseId: c.id }} className="font-medium hover:text-brand-700">
                        {c.code && <span className="mr-1.5 text-slate-500">{c.code}</span>}
                        {c.title}
                      </Link>
                      {group && (
                        <div>
                          <CompanyCell id={c.companyId} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      {t.lbl(AWARENESS_LABELS.kind[c.kind])}
                      <br />
                      {t.lbl(AWARENESS_LABELS.form[c.form])}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{c.intervalMonths ? t("awr.mes", { intervalMonths: c.intervalMonths }) : t("awr.jednorazove")}</td>
                    <td className="px-3 py-2.5">{c.active ? <Coverage stats={c.stats} required={c.required} /> : <Badge>{t("awr.neaktivni")}</Badge>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{c.nextSession ? fmtDay(c.nextSession) : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{c.ownerPositionName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
            <Field label={t("awr.od")}>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t("awr.do")}>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button variant="secondary" onClick={exportCsv} disabled={!log.data?.length}>
              <Download size={15} /> {t("awr.csv")}
            </Button>
          </div>
          {(log.data ?? []).length === 0 ? (
            <EmptyState>{t("awr.zaObdobiNejsouZaznamy")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("awr.datum")}</th>
                  <th className="px-3 py-2">{t("awr.skoleni")}</th>
                  <th className="px-3 py-2">{t("awr.osoba")}</th>
                  <th className="px-3 py-2">{t("awr.vysledek")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(log.data ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className="px-5 py-2 whitespace-nowrap tabular-nums">{fmtDay(r.date)}</td>
                    <td className="px-3 py-2">
                      {r.courseTitle} <span className="text-xs text-slate-500">· {t.lbl(AWARENESS_LABELS.kind[r.kind])}</span>
                    </td>
                    <td className="px-3 py-2">{r.userName}</td>
                    <td className="px-3 py-2 text-xs">{r.passed ? "absolvoval/a" : <span className="text-red-700">{t("awr.neprospelA")}</span>}{r.score != null ? ` · ${r.score} %` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}

export function CourseNewPage() {
  return <CourseEditor c={null} />;
}

export function CourseDetailPage() {
  const { courseId } = useParams({ strict: false }) as { courseId: string };
  const q = useQuery({ queryKey: ["awareness", "detail", courseId], queryFn: () => api.awareness.get(courseId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <CourseEditor key={q.data.id} c={q.data} />;
}

function CourseEditor({ c }: { c: CourseDetail | null }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = c ? c.canEdit : can("awareness:write");
  const [f, setF] = useState({
    code: c?.code ?? "",
    title: c?.title ?? "",
    kind: c?.kind ?? ("periodic" as CourseKind),
    form: c?.form ?? ("elearning" as CourseForm),
    description: c?.description ?? "",
    topics: c?.topics ?? [],
    audience: c?.audience ?? EMPTY_AUDIENCE,
    intervalMonths: c?.intervalMonths ?? 12,
    dueDaysForNew: c?.dueDaysForNew ?? null,
    durationHours: c?.durationHours ?? null,
    ownerPositionId: c?.ownerPositionId ?? null,
    policyId: c?.policyId ?? null,
    active: c?.active ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [topic, setTopic] = useState("");
  const policies = useQuery({ queryKey: ["policies"], queryFn: api.policies.list, enabled: mod("policies") && can("policies:read") });
  const [session, setSession] = useState<string | "new" | null>(null);
  const [record, setRecord] = useState(false);
  const done = (d: CourseDetail) => {
    qc.invalidateQueries({ queryKey: ["awareness"] });
    qc.setQueryData(["awareness", "detail", d.id], d);
    if (!c) nav({ to: "/awareness/$courseId", params: { courseId: d.id } });
  };
  const body = (): CourseInput => ({ ...f, code: f.code || null, description: f.description || null, intervalMonths: f.intervalMonths || null });
  const save = useMutation({ mutationFn: () => (c ? api.awareness.update(c.id, body()) : api.awareness.create(body())), onSuccess: done });
  const del = useMutation({
    mutationFn: () => api.awareness.remove(c!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["awareness"] });
      nav({ to: "/awareness" });
    },
  });
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/awareness" className="hover:text-brand-700">
          {t("awr.povedomiASkoleni")}
        </Link>
      </div>
      <PageHeader
        title={c ? `${c.code ? `${c.code} ` : ""}${c.title}` : t("awr.noveSkoleni")}
        subtitle={c ? `${t.lbl(AWARENESS_LABELS.kind[c.kind])} · ${t.lbl(AWARENESS_LABELS.form[c.form])}` : t("awr.polozkaPlanuRozvojeBezpecnostnihoPovedom")}
        actions={
          <>
            {c && edit && <TransferButton entity="courses" id={c.id} companyId={c.companyId} />}
            {c && edit && (
              <Button variant="danger" onClick={async () => (await askConfirm(t("awr.smazatSkoleniJdeJenBez"))) && del.mutate()}>
                <Trash2 size={16} />
              </Button>
            )}
            {edit && (
              <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
                {c ? t("awr.ulozit") : t("common.create")}
              </Button>
            )}
          </>
        }
      />
      {save.isSuccess && <SuccessBox>{t("awr.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error} />
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("awr.skoleni")} />
          <fieldset disabled={!edit} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("awr.oznaceni")}>
                <Input value={f.code} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label={t("awr.nazev")}>
                <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("awr.druh10Odst3")}>
                <Select value={f.kind} onChange={(e) => set("kind", e.target.value as CourseKind)}>
                  {COURSE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(AWARENESS_LABELS.kind[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("awr.forma")}>
                <Select value={f.form} onChange={(e) => set("form", e.target.value as CourseForm)}>
                  {COURSE_FORMS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(AWARENESS_LABELS.form[k])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("awr.opakovatMesice")} hint={t("awr.prazdneJednorazove")}>
                <Input type="number" min={1} max={60} value={f.intervalMonths ?? ""} onChange={(e) => set("intervalMonths", e.target.value ? Number(e.target.value) : (null as never))} />
              </Field>
              <Field label={t("awr.lhutaProNoveDny")} hint={t("awr.odNastupuNaMisto")}>
                <Input type="number" min={1} max={365} value={f.dueDaysForNew ?? ""} onChange={(e) => set("dueDaysForNew", e.target.value ? Number(e.target.value) : null)} />
              </Field>
              <Field label={t("awr.rozsahHodiny")}>
                <Input type="number" min={0} step={0.5} value={f.durationHours ?? ""} onChange={(e) => set("durationHours", e.target.value ? Number(e.target.value) : null)} />
              </Field>
            </div>
            <Field label={t("awr.odpovidaZaRealizaci")} hint={t("awr.10Odst4PismA")}>
              <PositionSelect value={f.ownerPositionId} onChange={(v) => set("ownerPositionId", v)} />
            </Field>
            {mod("policies") && (
              <Field label={t("awr.navazujiciDokument")}>
                <Select value={f.policyId ?? ""} onChange={(e) => set("policyId", e.target.value || null)}>
                  <option value="">—</option>
                  {(policies.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ? `${p.code} ` : ""}
                      {p.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t("awr.obsahAForma")}>
              <Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div>
              <div className="mb-1 text-sm font-medium text-slate-700">{t("awr.temata")}</div>
              <IdMultiSelect
                value={f.topics}
                onChange={(v) => set("topics", v)}
                disabled={!edit}
                options={SUGGESTED_TOPICS.map((tx) => ({ id: tx, label: tx }))}
                known={f.topics.map((tx) => ({ id: tx, label: tx }))}
                placeholder={t("awr.pridatTemaZNavrhu")}
                emptyLabel={t("awr.zadna")}
              />
              {edit && (
                <div className="mt-2 flex gap-2">
                  <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("awr.vlastniTema")} />
                  <Button
                    variant="secondary"
                    disabled={!topic.trim()}
                    onClick={() => {
                      set("topics", [...new Set([...f.topics, topic.trim()])]);
                      setTopic("");
                    }}
                  >
                    {t("awr.pridat")}
                  </Button>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">{t("awr.navrhyTematOverteProtiPriloze")}</p>
            </div>
            <Checkbox checked={f.active} onChange={(v) => set("active", v)} label={t("awr.aktivniPocitaSeDoPlanu")} />
          </fieldset>
        </Card>
        <Card>
          <CardHeader title={t("awr.kdoMusiSkoleniAbsolvovat")} subtitle={t("awr.podleUtvaruFunkcnichMistA")} />
          <div className="p-5">
            <AudienceEditor value={f.audience} onChange={(v) => set("audience", v)} disabled={!edit} />
          </div>
          {c && (
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">{t("awr.stavOsob", { length: c.people.length })}</span>
                {edit && (
                  <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setRecord(true)}>
                    {t("awr.zapsatAbsolvovani")}
                  </Button>
                )}
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto text-sm">
                {c.people.map((p) => (
                  <div key={p.userId} className="flex items-center justify-between gap-3">
                    <span>{p.name}</span>
                    <span className="flex items-center gap-2 text-xs text-slate-500">
                      {p.lastCompleted ? fmtDay(p.lastCompleted) : ""}
                      <Badge tone={stateTone[p.state]}>{t.lbl(AWARENESS_LABELS.state[p.state])}</Badge>
                    </span>
                  </div>
                ))}
                {c.people.length === 0 && <span className="text-slate-400">{t("awr.okruhJePrazdny")}</span>}
              </div>
            </div>
          )}
        </Card>
      </div>
      {c && (
        <Card className="mt-6 overflow-hidden">
          <CardHeader
            title={t("awr.terminy")}
            subtitle={t("awr.poOznaceniProbehloSeUcastnikum")}
            action={
              edit && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setSession("new")}>
                  <Plus size={14} /> {t("awr.termin")}
                </Button>
              )
            }
          />
          {c.sessions.length === 0 ? (
            <EmptyState>{t("awr.zadneTerminy")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {c.sessions.map((s) => (
                  <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSession(s.id)}>
                    <td className="w-32 px-5 py-2.5 tabular-nums">{fmtDay(s.date)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={s.status === "held" ? "green" : s.status === "planned" ? "blue" : "slate"}>{t.lbl(AWARENESS_LABELS.session[s.status])}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{[s.trainer, s.location].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{t("awr.ucastniku", { participants: s.participants })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {c && session && <SessionModal course={c} sessionId={session === "new" ? null : session} edit={edit} onClose={() => setSession(null)} onDone={done} />}
      {c && record && <RecordModal course={c} onClose={() => setRecord(false)} onDone={done} />}
    </>
  );
}

function SessionModal({ course, sessionId, edit, onClose, onDone }: { course: CourseDetail; sessionId: string | null; edit: boolean; onClose: () => void; onDone: (d: CourseDetail) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["awareness", "session", sessionId], queryFn: () => api.awareness.session(course.id, sessionId!), enabled: !!sessionId });
  const [f, setF] = useState<{ date: string; status: SessionStatus; trainer: string; location: string; note: string; effectiveness: string; participantIds: string[] } | null>(
    sessionId ? null : { date: new Date().toISOString().slice(0, 10), status: "planned", trainer: "", location: "", note: "", effectiveness: "", participantIds: [] },
  );
  if (!f && q.data)
    setF({
      date: q.data.date,
      status: q.data.status as SessionStatus,
      trainer: q.data.trainer ?? "",
      location: q.data.location ?? "",
      note: q.data.note ?? "",
      effectiveness: q.data.effectiveness ?? "",
      participantIds: q.data.participantIds,
    });
  const save = useMutation({
    mutationFn: () => {
      const b = { ...f!, trainer: f!.trainer || null, location: f!.location || null, note: f!.note || null, effectiveness: f!.effectiveness || null };
      return sessionId ? api.awareness.updateSession(course.id, sessionId, b) : api.awareness.addSession(course.id, b);
    },
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: () => api.awareness.deleteSession(course.id, sessionId!),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const people = course.people.map((p) => ({ id: p.userId, label: p.name }));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={sessionId ? t("awr.terminSkoleni") : t("awr.novyTermin")}
      footer={
        <>
          {sessionId && edit && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("awr.smazatTerminZapsanaAbsolvovaniZustanou"))) && del.mutate()}>
              <Trash2 size={14} />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {edit && (
            <Button disabled={!f || save.isPending} onClick={() => save.mutate()}>
              {t("awr.ulozit")}
            </Button>
          )}
        </>
      }
    >
      {!f ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : (
        <fieldset disabled={!edit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("awr.datum")}>
              <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </Field>
            <Field label={t("awr.stav")}>
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as SessionStatus })}>
                {SESSION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t.lbl(AWARENESS_LABELS.session[s])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("awr.lektor")}>
              <Input value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })} />
            </Field>
          </div>
          <Field label={t("awr.mistoOdkaz")}>
            <Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
          </Field>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{t("awr.ucastnici", { length: f.participantIds.length })}</span>
              {edit && (
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setF({ ...f, participantIds: people.map((p) => p.id) })}>
                  {t("awr.pridatVsechnyDotcene")}
                </button>
              )}
            </div>
            <IdMultiSelect value={f.participantIds} onChange={(v) => setF({ ...f, participantIds: v })} options={people} disabled={!edit} placeholder={t("awr.pridatUcastnika")} emptyLabel="Nikdo" />
          </div>
          <Field label={t("awr.hodnoceniUcinnosti")} hint={t("awr.10Odst4PismC")}>
            <Textarea rows={2} value={f.effectiveness} onChange={(e) => setF({ ...f, effectiveness: e.target.value })} />
          </Field>
          <Field label={t("awr.poznamka")}>
            <Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </fieldset>
      )}
      <ErrorBox error={q.error ?? save.error ?? del.error} />
    </Modal>
  );
}

function RecordModal({ course, onClose, onDone }: { course: CourseDetail; onClose: () => void; onDone: (d: CourseDetail) => void }) {
  const t = useT();
  const [userIds, setUserIds] = useState<string[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [score, setScore] = useState("");
  const m = useMutation({
    mutationFn: () => api.awareness.addRecords(course.id, { userIds, completedAt: date, score: score ? Number(score) : null }),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const pending = course.people.filter((p) => p.state !== "ok");
  return (
    <Modal
      open
      onClose={onClose}
      title={t("awr.zapsatAbsolvovani")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!userIds.length || m.isPending} onClick={() => m.mutate()}>
            {t("awr.zapsat", { length: userIds.length })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("awr.naprDokoncenyELearningNebo")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("awr.datumAbsolvovani")}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("awr.vysledekTestu")}>
          <Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
        </Field>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">{t("awr.osoby")}</span>
          {pending.length > 0 && (
            <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setUserIds(pending.map((p) => p.userId))}>
              {t("awr.vsichniBezPlatnehoSkoleni", { length: pending.length })}
            </button>
          )}
        </div>
        <IdMultiSelect value={userIds} onChange={setUserIds} options={course.people.map((p) => ({ id: p.userId, label: p.name, hint: t.lbl(AWARENESS_LABELS.state[p.state]) }))} placeholder={t("awr.pridatOsobu")} />
      </div>
      <ErrorBox error={m.error} />
    </Modal>
  );
}
