import { Tabs, useTab } from "@/components/ui/tabs";
import { askConfirm } from "@/components/ui/overlay";
import { AiSuggestPanel } from "@/components/ai";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate, fmtDay } from "@/lib/utils";
import {
  QA_ANSWERS,
  TRUST_LABELS,
  type CustomerQDetailDto,
  type CustomerQPreviewDto,
  type QaItemDto,
  type QaItemStatus,
  type TrustCertification,
  type TrustSettingsDto,
  type TrustSettingsInput,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { CheckCircle2, Download, ExternalLink, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";

const ITEM_TONE: Record<QaItemStatus, Tone> = { empty: "slate", draft: "amber", approved: "green" };
type Tab = "questionnaires" | "library" | "center";

export function TrustPage() {
  const t = useT();
  const [tab, setTab] = useTab(["questionnaires", "library", "center"] as const, "questionnaires");
  return (
    <>
      <PageHeader title={t("tr.title")} subtitle={t("tr.subtitle")} />
      <Tabs label={t("tr.title")} value={tab} onChange={setTab} items={(["questionnaires", "library", "center"] as const).map((x) => ({ key: x, label: t(`tr.tab.${x}`) }))} />
      {tab === "questionnaires" && <QuestionnairesTab />}
      {tab === "library" && <LibraryTab />}
      {tab === "center" && <CenterTab />}
    </>
  );
}

function QuestionnairesTab() {
  const t = useT();
  const can = useCan();
  const list = useQuery({ queryKey: ["trust", "questionnaires"], queryFn: api.trust.questionnaires });
  const [open, setOpen] = useState(false);
  return (
    <Card data-testid="customer-questionnaires">
      <CardHeader
        title={t("tr.qTitle")}
        subtitle={t("tr.qSubtitle")}
        action={
          can("trust:write") && (
            <Button onClick={() => setOpen(true)}>
              <Upload size={15} /> {t("tr.import")}
            </Button>
          )
        }
      />
      <ErrorBox error={list.error} />
      {list.data?.length ? (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">{t("tr.customer")}</th>
              <th className="px-4 py-2">{t("tr.due")}</th>
              <th className="px-4 py-2">{t("tr.progress")}</th>
              <th className="px-4 py-2">{t("tr.status")}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.map((q) => {
              const total = q.counts.empty + q.counts.draft + q.counts.approved;
              return (
                <tr key={q.id} className="border-b border-slate-100">
                  <td className="px-4 py-2">
                    <Link to="/trust/questionnaires/$qid" params={{ qid: q.id }} className="font-medium text-brand-700 hover:underline">
                      {q.customer}
                    </Link>
                    <div className="text-xs text-slate-500">{q.title}</div>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{q.dueDate ? fmtDay(q.dueDate) : "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex h-2 w-40 overflow-hidden rounded bg-slate-100" title={t("tr.progressTip", { a: q.counts.approved, d: q.counts.draft, e: q.counts.empty })}>
                      <div className="bg-emerald-600" style={{ width: `${(q.counts.approved / Math.max(1, total)) * 100}%` }} />
                      <div className="bg-amber-400" style={{ width: `${(q.counts.draft / Math.max(1, total)) * 100}%` }} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{t("tr.progressTip", { a: q.counts.approved, d: q.counts.draft, e: q.counts.empty })}</div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={q.status === "in_progress" ? "amber" : "green"}>{t.lbl(TRUST_LABELS.qStatus[q.status])}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        list.data && <EmptyState>{t("tr.qEmpty")}</EmptyState>
      )}
      {open && <ImportModal onClose={() => setOpen(false)} />}
    </Card>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [customer, setCustomer] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [sheet, setSheet] = useState("");
  const [qc, setQc] = useState<number | undefined>();
  const [idc, setIdc] = useState<number | undefined>();
  const [pv, setPv] = useState<CustomerQPreviewDto | null>(null);
  const run = useMutation({
    mutationFn: (mode: "preview" | "commit") => api.trust.importQuestionnaire(file!, { mode, customer, title, dueDate, sheet, questionColumn: qc, idColumn: idc }),
    onSuccess: (r, mode) => {
      if (mode === "preview") {
        const p = r as CustomerQPreviewDto;
        setPv(p);
        if (qc === undefined && p.questionColumn != null) setQc(p.questionColumn);
        if (idc === undefined && p.idColumn != null) setIdc(p.idColumn);
        return;
      }
      nav({ to: "/trust/questionnaires/$qid", params: { qid: (r as CustomerQDetailDto).id } });
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("tr.import")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button variant="secondary" disabled={!file || run.isPending} onClick={() => run.mutate("preview")}>
            {t("vs.previewBtn")}
          </Button>
          <Button disabled={!file || !customer.trim() || !pv?.questions || run.isPending} onClick={() => run.mutate("commit")}>
            {t("tr.importN", { n: pv?.questions ?? 0 })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("tr.importHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("tr.customer")}>
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </Field>
        <Field label={t("tr.due")}>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label={t("tr.qName")} className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("vs.file")} className="sm:col-span-2">
          <Input type="file" accept=".xlsx,.csv" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setPv(null))} />
        </Field>
      </div>
      {pv && (
        <div className="mt-3 space-y-3 rounded-md border border-slate-200 p-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            {pv.sheets.length > 1 && (
              <Field label={t("tr.sheet")}>
                <Select value={sheet || pv.sheet || ""} onChange={(e) => (setSheet(e.target.value), setPv(null))}>
                  {pv.sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t("tr.qColumn")}>
              <Select value={qc ?? ""} onChange={(e) => (setQc(e.target.value === "" ? undefined : Number(e.target.value)), setPv(null))}>
                <option value="">—</option>
                {pv.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `#${i + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("tr.idColumn")}>
              <Select value={idc ?? ""} onChange={(e) => (setIdc(e.target.value === "" ? undefined : Number(e.target.value)), setPv(null))}>
                <option value="">—</option>
                {pv.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `#${i + 1}`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div>{t("tr.previewN", { n: pv.questions })}</div>
          <ol className="list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
            {pv.sample.map((s, i) => (
              <li key={i}>
                {s.section && <span className="text-slate-400">{s.section} · </span>}
                {s.ref && <span className="font-mono">{s.ref} </span>}
                {s.question}
              </li>
            ))}
          </ol>
        </div>
      )}
      <ErrorBox error={run.error} />
    </Modal>
  );
}

/** Detail dotazníku: odpovědi, převzetí z knihovny, AI návrh, schválení, export. */
export function CustomerQuestionnairePage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { qid } = useParams({ strict: false }) as { qid: string };
  const q = useQuery({ queryKey: ["trust", "questionnaire", qid], queryFn: () => api.trust.questionnaire(qid) });
  const set = (d: CustomerQDetailDto) => {
    qc.setQueryData(["trust", "questionnaire", qid], d);
    qc.invalidateQueries({ queryKey: ["trust", "questionnaires"] });
  };
  const [filter, setFilter] = useState<QaItemStatus | "">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const approveSel = useMutation({ mutationFn: () => api.trust.approveItems(qid, [...selected]), onSuccess: (d) => (set(d), setSelected(new Set())) });
  const approve = useMutation({ mutationFn: () => api.trust.approve(qid), onSuccess: set });
  const reopen = useMutation({ mutationFn: () => api.trust.reopen(qid), onSuccess: set });
  const sent = useMutation({ mutationFn: () => api.trust.sent(qid), onSuccess: set });
  const remove = useMutation({ mutationFn: () => api.trust.removeQuestionnaire(qid), onSuccess: () => nav({ to: "/trust" }) });
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  const w = can("trust:write") && d.status === "in_progress";
  const items = d.items.filter((i) => !filter || i.status === filter);
  const drafts = d.items.filter((i) => i.status === "draft");
  let lastSection: string | null = null;
  return (
    <>
      <PageHeader
        title={d.customer}
        subtitle={`${d.title}${d.dueDate ? ` · ${t("tr.dueOn", { d: fmtDay(d.dueDate) })}` : ""} · ${t.lbl(TRUST_LABELS.qStatus[d.status])}`}
        actions={
          <>
            <a href={api.trust.exportUrl(d.id)}>
              <Button variant="secondary">
                <Download size={15} /> {t("tr.export")}
              </Button>
            </a>
            {w && (
              <Button disabled={approve.isPending || d.counts.approved !== d.items.length} onClick={() => approve.mutate()} title={t("tr.approveHint")}>
                <CheckCircle2 size={15} /> {t("tr.approveAll")}
              </Button>
            )}
            {can("trust:write") && d.status === "approved" && (
              <>
                <Button variant="secondary" onClick={() => sent.mutate()}>
                  {t("tr.markSent")}
                </Button>
                <Button variant="secondary" onClick={() => reopen.mutate()}>
                  {t("tr.reopen")}
                </Button>
              </>
            )}
            {can("trust:write") && (
              <Button variant="ghost" className="text-red-700" onClick={async () => (await askConfirm(t("tr.removeConfirm"))) && remove.mutate()} aria-label={t("mon.delete")}>
                <Trash2 size={15} />
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={approve.error ?? approveSel.error ?? reopen.error ?? sent.error ?? remove.error} />
      {w && d.counts.empty > 0 && (
        <Card className="mb-4 p-4">
          <AiSuggestPanel useCase="questionnaire_answer" entityId={d.id} canApply={w} onApplied={() => qc.invalidateQueries({ queryKey: ["trust", "questionnaire", qid] })} />
          <p className="mt-2 text-xs text-slate-500">{t("tr.aiHint", { n: Math.min(20, d.counts.empty) })}</p>
        </Card>
      )}
      <Card data-testid="qa-items">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2 text-sm">
          <Select className="w-48" value={filter} onChange={(e) => setFilter(e.target.value as QaItemStatus | "")} aria-label={t("tr.status")}>
            <option value="">{t("tr.allItems", { n: d.items.length })}</option>
            {(["empty", "draft", "approved"] as const).map((s) => (
              <option key={s} value={s}>
                {t.lbl(TRUST_LABELS.itemStatus[s])} ({d.counts[s]})
              </option>
            ))}
          </Select>
          {w && drafts.length > 0 && (
            <>
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setSelected(new Set(drafts.map((i) => i.id)))}>
                {t("tr.selectDrafts", { n: drafts.length })}
              </Button>
              <Button className="px-2 py-1 text-xs" disabled={!selected.size || approveSel.isPending} onClick={() => approveSel.mutate()}>
                {t("tr.approveSelected", { n: selected.size })}
              </Button>
            </>
          )}
        </div>
        <ul className="divide-y divide-slate-100">
          {items.map((i) => {
            const head = i.section && i.section !== lastSection ? i.section : null;
            lastSection = i.section;
            return (
              <li key={i.id}>
                {head && <div className="bg-slate-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{head}</div>}
                <QaRow i={i} qid={d.id} edit={w} selected={selected.has(i.id)} onSelect={(v) => setSelected((s0) => { const n = new Set(s0); if (v) n.add(i.id); else n.delete(i.id); return n; })} onSaved={set} />
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

function QaRow({ i, qid, edit, selected, onSelect, onSaved }: { i: QaItemDto; qid: string; edit: boolean; selected: boolean; onSelect: (v: boolean) => void; onSaved: (d: CustomerQDetailDto) => void }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const patch = useMutation({ mutationFn: (p: Parameters<typeof api.trust.patchItem>[2]) => api.trust.patchItem(qid, i.id, p), onSuccess: (d) => (onSaved(d), setText(null)) });
  const lib = useMutation({ mutationFn: (libId: string) => api.trust.fromLibrary(qid, i.id, libId), onSuccess: onSaved });
  return (
    <div className="flex gap-3 px-4 py-3 text-sm">
      {edit && i.status === "draft" ? <input type="checkbox" className="mt-1" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t("vs.selectRow", { id: i.ref ?? String(i.seq) })} /> : <span className="w-[13px]" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-2">
          <span className="font-mono text-xs text-slate-400">{i.ref ?? i.seq}</span>
          <span className="min-w-0 flex-1 font-medium text-slate-800">{i.question}</span>
          <Badge tone={ITEM_TONE[i.status]}>{t.lbl(TRUST_LABELS.itemStatus[i.status])}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          {edit ? (
            <Select className="w-36" value={i.answer ?? ""} aria-label={t("tr.answer")} onChange={(e) => patch.mutate({ answer: (e.target.value || null) as QaItemDto["answer"] })}>
              <option value="">—</option>
              {QA_ANSWERS.map((a) => (
                <option key={a} value={a}>
                  {t.lbl(TRUST_LABELS.answer[a])}
                </option>
              ))}
            </Select>
          ) : (
            i.answer && <Badge tone="violet">{t.lbl(TRUST_LABELS.answer[i.answer])}</Badge>
          )}
          {text != null ? (
            <div className="flex min-w-72 flex-1 gap-2">
              <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
              <Button className="self-start" disabled={patch.isPending} onClick={() => patch.mutate({ answerText: text || null })}>
                {t("mon.save")}
              </Button>
            </div>
          ) : (
            <button type="button" disabled={!edit} className={cn("min-w-0 flex-1 text-left text-slate-700", edit && "hover:text-brand-700")} onClick={() => setText(i.answerText ?? "")}>
              {i.answerText || (edit ? <span className="text-slate-400">{t("tr.addText")}</span> : "—")}
            </button>
          )}
          {edit && i.status === "draft" && (
            <Button variant="secondary" className="px-2 py-1 text-xs" disabled={patch.isPending} onClick={() => patch.mutate({ status: "approved" })}>
              {t("tr.approve")}
            </Button>
          )}
          {edit && i.status === "approved" && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => patch.mutate({ status: "draft" })}>
              {t("tr.unapprove")}
            </Button>
          )}
        </div>
        {(i.sources.length > 0 || i.answeredBy) && (
          <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
            {i.answeredBy && <span>{t(`tr.by.${i.answeredBy}` as "tr.by.ai")}{i.confidence && ` · ${t(`tr.conf.${i.confidence}` as "tr.conf.low")}`}</span>}
            {i.sources.map((s) => (
              <Badge key={`${s.kind}:${s.id}`} tone="slate">
                {t.lbl(TRUST_LABELS.source[s.kind])}: {s.label}
              </Badge>
            ))}
            {i.approvedByName && <span>· {t("tr.approvedBy", { who: i.approvedByName })}</span>}
          </div>
        )}
        {edit && i.libraryMatch && i.status !== "approved" && !i.sources.some((s) => s.kind === "library" && s.id === i.libraryMatch!.id) && (
          <div className="mt-1 text-xs text-slate-600">
            {t("tr.libMatch", { score: Math.round(i.libraryMatch.score * 100) })} <span className="italic">„{i.libraryMatch.question.slice(0, 120)}“</span>{" "}
            <button type="button" className="text-brand-700 hover:underline" onClick={() => lib.mutate(i.libraryMatch!.id)}>
              {t("tr.useLib")}
            </button>
          </div>
        )}
        <ErrorBox error={patch.error ?? lib.error} />
      </div>
    </div>
  );
}

function LibraryTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const list = useQuery({ queryKey: ["trust", "library", q], queryFn: () => api.trust.library(q || undefined) });
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ question: "", answer: "" as string, answerText: "" });
  const add = useMutation({
    mutationFn: () => api.trust.saveLibrary({ question: f.question, answer: (f.answer || null) as "yes", answerText: f.answerText || null }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["trust", "library"] }), setAdding(false), setF({ question: "", answer: "", answerText: "" })),
  });
  const del = useMutation({ mutationFn: (id: string) => api.trust.removeLibrary(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["trust", "library"] }) });
  return (
    <Card data-testid="answer-library">
      <CardHeader
        title={t("tr.libTitle")}
        subtitle={t("tr.libSubtitle")}
        action={
          can("trust:write") && (
            <Button variant="secondary" onClick={() => setAdding(!adding)}>
              <Plus size={15} /> {t("tr.libAdd")}
            </Button>
          )
        }
      />
      <div className="border-b border-slate-100 p-4">
        <Input placeholder={t("tr.libSearch")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {adding && (
        <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-[1fr_9rem]">
          <Input placeholder={t("tr.question")} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />
          <Select value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} aria-label={t("tr.answer")}>
            <option value="">—</option>
            {QA_ANSWERS.map((a) => (
              <option key={a} value={a}>
                {t.lbl(TRUST_LABELS.answer[a])}
              </option>
            ))}
          </Select>
          <Textarea className="sm:col-span-2" rows={2} placeholder={t("tr.addText")} value={f.answerText} onChange={(e) => setF({ ...f, answerText: e.target.value })} />
          <Button className="w-fit" disabled={f.question.trim().length < 5 || add.isPending} onClick={() => add.mutate()}>
            {t("mon.save")}
          </Button>
        </div>
      )}
      <ErrorBox error={list.error ?? add.error ?? del.error} />
      <ul className="divide-y divide-slate-100 text-sm">
        {list.data?.map((l) => (
          <li key={l.id} className="flex gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-800">{l.question}</div>
              <div className="mt-0.5 text-slate-600">
                {l.answer && <Badge tone="violet">{t.lbl(TRUST_LABELS.answer[l.answer])}</Badge>} {l.answerText}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">{t("tr.libUsage", { n: l.usage, d: fmtDate(l.updatedAt) })}</div>
            </div>
            {can("trust:write") && (
              <Button variant="ghost" className="px-1.5 py-1 text-red-700" onClick={async () => (await askConfirm(t("tr.libRemove"))) && del.mutate(l.id)} aria-label={t("mon.delete")}>
                <Trash2 size={13} />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {list.data && !list.data.length && <EmptyState>{t("tr.libEmpty")}</EmptyState>}
    </Card>
  );
}

function CenterTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ["trust", "center"], queryFn: api.trust.center });
  const pols = useQuery({ queryKey: ["policies", "trust-picker"], queryFn: () => api.policies.list() });
  const sups = useQuery({ queryKey: ["suppliers", "trust-picker"], queryFn: () => api.suppliers.list({}) });
  const reqs = useQuery({ queryKey: ["trust", "requests"], queryFn: api.trust.requests });
  const [f, setF] = useState<TrustSettingsInput | null>(null);
  const cur: TrustSettingsInput = f ?? (st.data ? strip(st.data) : { enabled: false, slug: "", title: "", certifications: [], documents: [], subprocessorIds: [], showControls: true, showMonitoring: true, accessDays: 30 });
  const set = (p: Partial<TrustSettingsInput>) => setF({ ...cur, ...p });
  const save = useMutation({ mutationFn: () => api.trust.saveCenter(cur), onSuccess: () => (setF(null), qc.invalidateQueries({ queryKey: ["trust", "center"] })) });
  const [approved, setApproved] = useState<{ link: string; mailed: boolean } | null>(null);
  const appr = useMutation({ mutationFn: (id: string) => api.trust.approveRequest(id), onSuccess: (r) => (setApproved(r), qc.invalidateQueries({ queryKey: ["trust", "requests"] })) });
  const rej = useMutation({ mutationFn: (id: string) => api.trust.rejectRequest(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["trust", "requests"] }) });
  const rev = useMutation({ mutationFn: (id: string) => api.trust.revokeRequest(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["trust", "requests"] }) });
  const w = can("trust:write");
  const docs = cur.documents ?? [];
  const certs = cur.certifications ?? [];
  const setCert = (i: number, p: Partial<TrustCertification>) => set({ certifications: certs.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  return (
    <>
      <Card className="mb-6" data-testid="trust-center">
        <CardHeader
          title={t("tr.tcTitle")}
          subtitle={t("tr.tcSubtitle")}
          action={
            st.data?.url && (
              <a href={st.data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                <ExternalLink size={14} /> {st.data.url}
              </a>
            )
          }
        />
        <div className="grid gap-3 p-5 md:grid-cols-2">
          <Field label={t("tr.tcPageTitle")}>
            <Input disabled={!w} value={cur.title} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <Field label={t("tr.tcSlug")} hint={t("tr.tcSlugHint")}>
            <Input disabled={!w} value={cur.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />
          </Field>
          <Field label={t("tr.tcIntro")} className="md:col-span-2">
            <Textarea disabled={!w} rows={3} value={cur.intro ?? ""} onChange={(e) => set({ intro: e.target.value || null })} />
          </Field>
          <Field label={t("tr.tcContact")}>
            <Input disabled={!w} type="email" value={cur.contactEmail ?? ""} onChange={(e) => set({ contactEmail: e.target.value || null })} />
          </Field>
          <Field label={t("tr.tcDays")}>
            <Input disabled={!w} type="number" min={1} max={365} value={cur.accessDays ?? 30} onChange={(e) => set({ accessDays: Number(e.target.value) || 30 })} />
          </Field>
          <div className="space-y-2 md:col-span-2">
            <Checkbox disabled={!w} checked={!!cur.enabled} onChange={(v) => set({ enabled: v })} label={t("tr.tcEnabled")} />
            <Checkbox disabled={!w} checked={cur.showControls ?? true} onChange={(v) => set({ showControls: v })} label={t("tr.tcShowControls")} />
            <Checkbox disabled={!w} checked={cur.showMonitoring ?? true} onChange={(v) => set({ showMonitoring: v })} label={t("tr.tcShowMonitoring")} />
          </div>
        </div>
        <div className="border-t border-slate-100 p-5">
          <h3 className="mb-2 text-sm font-medium text-slate-800">{t("tr.tcCerts")}</h3>
          {certs.map((c, i) => (
            <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto]">
              <Input disabled={!w} placeholder={t("tr.certName")} value={c.name} onChange={(e) => setCert(i, { name: e.target.value })} />
              <Input disabled={!w} placeholder={t("tr.certIssuer")} value={c.issuer ?? ""} onChange={(e) => setCert(i, { issuer: e.target.value || null })} />
              <Input disabled={!w} type="date" aria-label={t("srp.fValid")} value={c.validUntil ?? ""} onChange={(e) => setCert(i, { validUntil: e.target.value || null })} />
              {w && (
                <Button variant="ghost" className="px-1.5 text-red-700" onClick={() => set({ certifications: certs.filter((_, j) => j !== i) })} aria-label={t("mon.delete")}>
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          ))}
          {w && (
            <Button variant="ghost" onClick={() => set({ certifications: [...certs, { name: "" }] })}>
              <Plus size={14} /> {t("tr.certAdd")}
            </Button>
          )}
        </div>
        <div className="grid gap-6 border-t border-slate-100 p-5 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-800">{t("tr.tcDocs")}</h3>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {pols.data
                ?.filter((p) => p.status === "active")
                .map((p) => {
                  const d = docs.find((x) => x.policyId === p.id);
                  return (
                    <li key={p.id} className="flex items-center gap-2">
                      <Select disabled={!w} className="w-44" value={d?.access ?? ""} aria-label={p.title} onChange={(e) => set({ documents: [...docs.filter((x) => x.policyId !== p.id), ...(e.target.value ? [{ policyId: p.id, access: e.target.value as "public" }] : [])] })}>
                        <option value="">{t("tr.notShown")}</option>
                        <option value="public">{t.lbl(TRUST_LABELS.access.public)}</option>
                        <option value="nda">{t.lbl(TRUST_LABELS.access.nda)}</option>
                      </Select>
                      <span className="truncate">
                        {p.code ? `${p.code} ` : ""}
                        {p.title}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-800">{t("tr.tcSubs")}</h3>
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
              {sups.data?.map((s) => (
                <li key={s.id}>
                  <Checkbox disabled={!w} checked={(cur.subprocessorIds ?? []).includes(s.id)} onChange={(v) => set({ subprocessorIds: v ? [...(cur.subprocessorIds ?? []), s.id] : (cur.subprocessorIds ?? []).filter((x) => x !== s.id) })} label={s.name} />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-100 p-5">
          <Field label={t("tr.tcNda")} hint={t("tr.tcNdaHint")}>
            <Textarea disabled={!w} rows={4} value={cur.ndaText ?? ""} onChange={(e) => set({ ndaText: e.target.value || null })} />
          </Field>
          {w && (
            <Button className="mt-3" disabled={!f || save.isPending || !cur.slug || !cur.title} onClick={() => save.mutate()}>
              {t("mon.save")}
            </Button>
          )}
          <ErrorBox error={st.error ?? save.error} />
        </div>
      </Card>
      <Card data-testid="trust-requests">
        <CardHeader title={t("tr.reqTitle")} subtitle={t("tr.reqSubtitle")} />
        {approved && (
          <div className="border-b border-slate-100 px-5 py-3 text-sm">
            {approved.mailed ? t("tr.reqMailed") : t("tr.reqCopy")}
            <Input className="mt-1 font-mono text-xs" readOnly value={approved.link} onFocus={(e) => e.target.select()} />
          </div>
        )}
        <ErrorBox error={reqs.error ?? appr.error ?? rej.error ?? rev.error} />
        {reqs.data?.length ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {reqs.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {r.name} · {r.organization}
                  </div>
                  <div className="text-xs text-slate-500">
                    {r.email} · {fmtDate(r.createdAt)}
                    {r.reason && ` · ${r.reason}`}
                    {r.expiresAt && r.status === "approved" && ` · ${t("srp.validUntil", { d: fmtDay(r.expiresAt) })}`}
                    {r.downloads > 0 && ` · ${t("tr.downloads", { n: r.downloads })}`}
                  </div>
                </div>
                <Badge tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "slate"}>{t.lbl(TRUST_LABELS.requestStatus[r.status])}</Badge>
                {w && r.status === "pending" && (
                  <>
                    <Button className="px-2 py-1 text-xs" onClick={() => appr.mutate(r.id)}>
                      {t("tr.reqApprove")}
                    </Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => rej.mutate(r.id)}>
                      {t("tr.reqReject")}
                    </Button>
                  </>
                )}
                {w && r.status === "approved" && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => rev.mutate(r.id)}>
                    {t("tr.reqRevoke")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          reqs.data && <EmptyState>{t("tr.reqEmpty")}</EmptyState>
        )}
      </Card>
    </>
  );
}

const strip = ({ companyId: _c, url: _u, pendingRequests: _p, ...s }: TrustSettingsDto): TrustSettingsInput => s;
