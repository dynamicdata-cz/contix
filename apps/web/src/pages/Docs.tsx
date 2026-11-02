import { useT } from "@/lib/i18n";
import { Markdown } from "@/components/markdown";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { DiffView } from "@/components/diff";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/utils";
import { POLICY_LABELS, type PolicyCommentDto, type PortalDocDetail, type PortalDocItem } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Download, ExternalLink, FileText, GitCompare, MessageSquarePlus, Search, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";

const sizeOf = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

function AckBadge({ d }: { d: PortalDocItem }) {
  const t = useT();
  if (!d.mustAcknowledge) return null;
  if (d.acknowledgedAt)
    return (
      <Badge tone="green">
        <CheckCircle2 size={12} /> {t("doc.seznamenA")} {fmtDay(d.acknowledgedAt)}
      </Badge>
    );
  const overdue = !!d.ackDue && d.ackDue < new Date().toISOString().slice(0, 10);
  return <Badge tone={overdue ? "red" : "amber"}>{t("doc.kSeznameni")}{d.ackDue ? ` do ${fmtDay(d.ackDue)}` : ""}</Badge>;
}

/** Portál dokumentů pro všechny zaměstnance – jen platné verze. */
export function DocsPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [only, setOnly] = useState<"all" | "todo">("all");
  const [folder, setFolder] = useState("");
  const list = useQuery({ queryKey: ["docs", "portal", term], queryFn: () => api.policies.portal(term || undefined) });
  const roles = useQuery({ queryKey: ["docs", "roles"], queryFn: api.policies.myRoles });
  // složky z cest dokumentů vč. nadřazených („A“, „A / B“)
  const paths = [...new Set((list.data ?? []).flatMap((d) => (d.folderPath ? d.folderPath.split(" / ").map((_, i, a) => a.slice(0, i + 1).join(" / ")) : [])))].sort((a, b) => a.localeCompare(b, "cs"));
  const docs = (list.data ?? [])
    .filter((d) => only === "all" || (d.mustAcknowledge && !d.acknowledgedAt))
    .filter((d) => !folder || d.folderPath === folder || !!d.folderPath?.startsWith(`${folder} / `));
  const todo = (list.data ?? []).filter((d) => d.mustAcknowledge && !d.acknowledgedAt).length;
  const pendingRoles = (roles.data ?? []).filter((p) => p.pendingVersion || p.openComments);
  return (
    <>
      <PageHeader title={t("doc.dokumenty")} subtitle={t("doc.platnePolitikySmerniceAPostupy")} />
      <AskDocs />
      {pendingRoles.length > 0 && (
        <Card className="mb-4">
          <CardHeader title={t("doc.mojeRoleVeSchvalovani")} subtitle={t("doc.dokumentyUKterychJsteGestor")} />
          <ul className="divide-y divide-slate-100 text-sm">
            {pendingRoles.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2">
                <Link to="/policies/$policyId" params={{ policyId: p.id }} className="font-medium text-brand-700 hover:underline">
                  {p.code ? `${p.code} ` : ""}
                  {p.title}
                </Link>
                {p.pendingVersion && <Badge tone="amber">{t("doc.verze", { version: p.pendingVersion.version, p: t.lbl(POLICY_LABELS.versionStatus[p.pendingVersion.status]) })}</Badge>}
                {p.openComments > 0 && <Badge tone="blue">{t("doc.pripominky", { openComments: p.openComments })}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <form
          className="relative min-w-64 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q.trim());
          }}
        >
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <Input className="pl-9" placeholder={t("doc.hledatVNazvuPopisuI")} value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        {paths.length > 0 && (
          <select className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label={t("doc.slozka")}>
            <option value="">{t("doc.vsechnySlozky")}</option>
            {paths.map((x) => (
              <option key={x} value={x}>
                {"\u00a0\u00a0".repeat(x.split(" / ").length - 1)}
                {x.split(" / ").at(-1)}
              </option>
            ))}
          </select>
        )}
        <div className="flex rounded-md border border-slate-200 text-sm">
          {(["all", "todo"] as const).map((k) => (
            <button key={k} className={`px-3 py-1.5 ${only === k ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600"}`} onClick={() => setOnly(k)}>
              {k === "all" ? t("doc.vsechny") : t("doc.kSeznameni2", { todo: todo })}
            </button>
          ))}
        </div>
      </Card>
      <ErrorBox error={list.error} />
      {!docs.length ? (
        <EmptyState>{list.isLoading ? t("common.loading") : term ? t("common.nothingFound") : only === "todo" ? t("doc.vseMatePotvrzene") : t("doc.zatimZadnePlatneDokumenty")}</EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id}>
                <Link to="/docs/$docId" params={{ docId: d.id }} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                  <FileText size={18} className="mt-0.5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-slate-900">
                      {d.code ? <span className="text-slate-500">{d.code} </span> : null}
                      {d.title}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {d.folderPath ? `${d.folderPath} · ` : ""}
                      {t.lbl(POLICY_LABELS.type[d.docType])} {t("doc.verze2")} {d.version}
                      {d.effectiveFrom ? (" " + t("doc.ucinnostOd", { p: fmtDay(d.effectiveFrom) })) : ""}
                      {d.ownerPositionName ? ` · gestor ${d.ownerPositionName}` : ""}
                    </div>
                    {d.snippet && <div className="mt-1 text-xs italic text-slate-600">{d.snippet}</div>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <AckBadge d={d} />
                    {d.classification !== "internal" && <Badge tone={d.classification === "public" ? "slate" : "violet"}>{t.lbl(POLICY_LABELS.classification[d.classification])}</Badge>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export function DocDetailPage() {
  const t = useT();
  const { docId } = useParams({ strict: false }) as { docId: string };
  const q = useQuery({ queryKey: ["docs", "detail", docId], queryFn: () => api.policies.portalDoc(docId) });
  if (!q.data) return q.error ? <ErrorBox error={q.error} /> : <EmptyState>{t("common.loading")}</EmptyState>;
  return <DocView d={q.data} />;
}

function DocView({ d }: { d: PortalDocDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["docs"] });
    qc.invalidateQueries({ queryKey: ["obligations"] });
    qc.invalidateQueries({ queryKey: ["policies", "mine"] });
  };
  const ack = useMutation({ mutationFn: () => api.policies.acknowledge(d.id, d.versionId), onSuccess: refresh });
  const pdf = d.files.find((f) => f.pdf === "native" || f.pdf === "ok");
  const [changes, setChanges] = useState(false);
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/docs" className="inline-flex items-center gap-1 hover:text-brand-700">
          <ArrowLeft size={14} /> {t("doc.dokumenty")}
        </Link>
      </div>
      <PageHeader
        title={`${d.code ? `${d.code} ` : ""}${d.title}`}
        subtitle={`${t.lbl(POLICY_LABELS.type[d.docType])} · ${t("doc.platnaVerzeN", { v: d.version })}${d.effectiveFrom ? (" " + t("doc.ucinnostOd", { p: fmtDay(d.effectiveFrom) })) : ""} · ${t.lbl(POLICY_LABELS.classification[d.classification])}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {d.description && <p className="text-sm text-slate-600">{d.description}</p>}
          {d.files.length > 0 && (
            <Card>
              <CardHeader title={t("doc.dokument")} />
              <ul className="divide-y divide-slate-100 text-sm">
                {d.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-5 py-2.5">
                    <FileText size={16} className="text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">{f.filename}</span>
                    <span className="text-xs text-slate-500">{sizeOf(f.size)}</span>
                    {(f.pdf === "native" || f.pdf === "ok") && (
                      <a href={api.policies.pdfUrl(d.id, d.versionId, f.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline" title={t("doc.pdfSDolozkouPlatnosti")}>
                        <ExternalLink size={14} /> {f.pdf === "ok" ? t("doc.cistPdf") : t("doc.otevrit")}
                      </a>
                    )}
                    {f.pdf !== "native" && (
                      <a href={api.policies.fileUrl(d.id, d.versionId, f.id)} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                        <Download size={14} /> {t("doc.stahnout")}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {d.content && (
            <Card className="p-6">
              <Markdown text={d.content} />
            </Card>
          )}
          {!d.content && !d.files.length && d.location && (
            <Card className="p-5 text-sm">
              {t("doc.dokumentJeDostupny")} <b>{d.location}</b>
            </Card>
          )}
          {pdf && !d.content && <p className="text-xs text-slate-500">{t("doc.pdfSeOtevreVNove")}</p>}
          <Comments d={d} />
        </div>

        <div className="space-y-6">
          {d.mustAcknowledge && (
            <Card>
              <CardHeader title={t("doc.seznameni")} subtitle={t("doc.dokumentSeTykaVasiFunkce")} />
              <div className="space-y-3 p-5">
                {d.acknowledgedAt ? (
                  <SuccessBox>{t("doc.seznameniPotvrzeno", { p: fmtDay(d.acknowledgedAt) })}</SuccessBox>
                ) : (
                  <>
                    {d.ackDue && <p className="text-sm text-slate-600">{t("doc.termin", { p: fmtDay(d.ackDue) })}</p>}
                    {d.hasQuiz && !d.quizPassed && <p className="text-sm text-amber-800">{t("doc.nejdriveUspesneAbsolvujteKratkyTest")}</p>}
                    <Button disabled={ack.isPending || (d.hasQuiz && !d.quizPassed)} onClick={() => ack.mutate()}>
                      <ShieldCheck size={15} /> {t("doc.potvrzujiSeznameniSVerzi")} {d.version}
                    </Button>
                    <ErrorBox error={ack.error} />
                  </>
                )}
              </div>
            </Card>
          )}
          {d.hasQuiz && <Quiz d={d} onDone={refresh} />}
          {d.previousVersion && (
            <Button variant="secondary" className="w-full justify-center" onClick={() => setChanges(true)}>
              <GitCompare size={15} /> {t("doc.coSeZmeniloOprotiVerzi")} {d.previousVersion}
            </Button>
          )}
          {changes && <ChangesModal d={d} onClose={() => setChanges(false)} />}
          <Card>
            <CardHeader title={t("doc.historieVerzi")} />
            <ul className="divide-y divide-slate-100 text-sm">
              {d.history.map((h) => (
                <li key={h.version} className="px-5 py-2">
                  <b className="tabular-nums">{h.version}</b> <span className="text-xs text-slate-500">{h.approvedAt ? fmtDay(h.approvedAt) : ""}</span>
                  {h.changeSummary && <div className="text-xs text-slate-600">{h.changeSummary}</div>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function ChangesModal({ d, onClose }: { d: PortalDocDetail; onClose: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["docs", "changes", d.versionId], queryFn: () => api.policies.portalChanges(d.id) });
  return (
    <Modal open onClose={onClose} title={t("doc.zmenyVeVerzi", { version: d.version })} wide footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="text-sm text-slate-500">{t("doc.porovnavam")}</p>}
      {q.data && <DiffView d={q.data} />}
    </Modal>
  );
}

function Quiz({ d, onDone }: { d: PortalDocDetail; onDone: () => void }) {
  const t = useT();
  const [answers, setAnswers] = useState<number[][]>(() => d.quiz.map(() => []));
  const submit = useMutation({ mutationFn: () => api.policies.quiz(d.id, answers), onSuccess: (r) => r.passed && onDone() });
  const toggle = (qi: number, oi: number, multiple: boolean) =>
    setAnswers((a) => a.map((x, i) => (i !== qi ? x : multiple ? (x.includes(oi) ? x.filter((y) => y !== oi) : [...x, oi]) : [oi])));
  if (d.quizPassed && !submit.data)
    return (
      <Card className="p-5">
        <SuccessBox>{t("doc.testPorozumeniMateSplneny")}</SuccessBox>
      </Card>
    );
  return (
    <Card>
      <CardHeader title={t("doc.testPorozumeni")} subtitle={t("doc.otazekUspesnostAlespon", { length: d.quiz.length, quizPassPct: d.quizPassPct })} />
      <div className="space-y-4 p-5 text-sm">
        {d.quiz.map((q, qi) => (
          <div key={qi}>
            <p className="mb-1.5 font-medium">
              {qi + 1}. {q.question} {q.multiple && <span className="text-xs font-normal text-slate-500">{t("doc.viceSpravnychOdpovedi")}</span>}
            </p>
            {q.options.map((o, oi) => (
              <label key={oi} className="flex cursor-pointer items-start gap-2 py-0.5">
                <input type={q.multiple ? "checkbox" : "radio"} name={`q${qi}`} className="mt-1 accent-brand-600" checked={answers[qi]?.includes(oi) ?? false} onChange={() => toggle(qi, oi, q.multiple)} />
                <span>{o}</span>
              </label>
            ))}
          </div>
        ))}
        {submit.data &&
          (submit.data.passed ? (
            <SuccessBox>
              {t("doc.splnenoNyniMuzetePotvrditSeznameni", { correct: submit.data.correct, total: submit.data.total, score: submit.data.score })}
            </SuccessBox>
          ) : (
            <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">
              {t("doc.spravnePotrebaProjdeteSiDokument", { correct: submit.data.correct, total: submit.data.total, score: submit.data.score, passPct: submit.data.passPct })}
            </p>
          ))}
        <ErrorBox error={submit.error} />
        {!submit.data?.passed && (
          <Button disabled={submit.isPending || answers.some((a) => !a.length)} onClick={() => submit.mutate()}>
            {t("doc.vyhodnotit")}
          </Button>
        )}
      </div>
    </Card>
  );
}

const commentTone: Record<PolicyCommentDto["status"], Tone> = { open: "amber", accepted: "green", rejected: "slate" };

function Comments({ d }: { d: PortalDocDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [reference, setReference] = useState("");
  const add = useMutation({
    mutationFn: () => api.policies.comment(d.id, { text, reference: reference || null }),
    onSuccess: () => {
      setText("");
      setReference("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["docs", "detail", d.id] });
    },
  });
  return (
    <Card>
      <CardHeader
        title={t("doc.pripominky2")}
        subtitle={t("doc.navrhNaUpravuNeboNejasnost")}
        action={
          !open && (
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
              <MessageSquarePlus size={14} /> {t("doc.pripominka")}
            </Button>
          )
        }
      />
      {open && (
        <div className="space-y-3 border-b border-slate-100 p-5">
          <Field label={t("doc.clanekOdstavecVolitelne")}>
            <Input value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} placeholder={t("doc.naprCl32")} />
          </Field>
          <Field label={t("doc.pripominka")}>
            <Textarea rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          </Field>
          <ErrorBox error={add.error} />
          <div className="flex gap-2">
            <Button disabled={text.trim().length < 3 || add.isPending} onClick={() => add.mutate()}>
              {t("doc.odeslat")}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancelAction")}
            </Button>
          </div>
        </div>
      )}
      {d.myComments.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {d.myComments.map((c) => (
            <li key={c.id} className="px-5 py-3">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Badge tone={commentTone[c.status]}>{t.lbl(POLICY_LABELS.commentStatus[c.status])}</Badge>
                {fmtDay(c.createdAt)} {t("doc.verze2")} {c.version ?? "—"} {c.reference && `· ${c.reference}`}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{c.text}</p>
              {c.response && (
                <p className="mt-1.5 rounded bg-slate-50 px-3 py-2 text-slate-700">
                  <b>{c.respondedByName ?? "Gestor"}:</b> {c.response}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !open && <p className="px-5 pb-4 text-sm text-slate-500">{t("doc.zatimJsteKDokumentuNic")}</p>
      )}
    </Card>
  );
}

/** Zeptej se dokumentace – odpověď z platných dokumentů s odkazy na zdroj (lokální AI). */
function AskDocs() {
  const t = useT();
  const st = useQuery({ queryKey: ["docs", "qa-status"], queryFn: api.policies.qaStatus, staleTime: 5 * 60_000 });
  const [q, setQ] = useState("");
  const ask = useMutation({ mutationFn: (question: string) => api.policies.qa(question) });
  if (!st.data?.enabled) return null;
  const r = ask.data;
  // [1] → odkaz na zdroj
  const parts = r ? r.answer.split(/(\[\d+\])/g) : [];
  const srcOf = (n: number) => r?.sources.find((x) => x.n === n);
  return (
    <Card className="mb-4 p-4">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) ask.mutate(q.trim());
        }}
      >
        <Sparkles size={18} className="text-brand-600" aria-hidden />
        <Input className="min-w-64 flex-1" placeholder={t("doc.zeptejteSeDokumentaceNaprJak")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("doc.otazkaNaDokumentaci")} />
        <Button type="submit" disabled={ask.isPending || q.trim().length < 3}>
          {ask.isPending ? t("doc.hledamVDokumentaci") : t("doc.zeptatSe")}
        </Button>
      </form>
      <ErrorBox error={ask.error} />
      {r && (
        <div className="mt-4 space-y-3">
          <div className="whitespace-pre-wrap rounded-md bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-800">
            {parts.map((p, i) => {
              const m = p.match(/^\[(\d+)\]$/);
              const src = m ? srcOf(Number(m[1])) : undefined;
              return src ? (
                <Link key={i} to="/docs/$docId" params={{ docId: src.policyId }} className="mx-0.5 rounded bg-brand-100 px-1 text-xs font-semibold text-brand-800 no-underline hover:bg-brand-200" title={`${src.code ? `${src.code} ` : ""}${src.title}${src.heading ? ` – ${src.heading}` : ""}`}>
                  {src.n}
                </Link>
              ) : (
                <span key={i}>{p}</span>
              );
            })}
          </div>
          {r.sources.length > 0 && (
            <ol className="space-y-2 text-sm">
              {r.sources.map((s) => (
                <li key={s.n} className="flex gap-2">
                  <span className="mt-0.5 h-5 min-w-5 rounded bg-brand-100 px-1 text-center text-xs font-semibold leading-5 text-brand-800">{s.n}</span>
                  <div className="min-w-0">
                    <Link to="/docs/$docId" params={{ docId: s.policyId }} className="font-medium text-brand-700 hover:underline">
                      {s.code ? `${s.code} ` : ""}
                      {s.title}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {" "}
                      {t("doc.verze2")} {s.version}
                      {s.heading ? ` · ${s.heading}` : ""}
                    </span>
                    <div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{s.snippet}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-slate-500">
            {t("doc.odpovedPripravilaAiNaServeru")}
            {r.mode === "keyword" && t("doc.hledanoJenPodleSlovVyhledavani")}
          </p>
        </div>
      )}
    </Card>
  );
}
