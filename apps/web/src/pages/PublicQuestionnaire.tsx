import { askConfirm } from "@/components/ui/overlay";
/**
 * Veřejná stránka bezpečnostního dotazníku pro dodavatele (ADR-040) – bez přihlášení, jazyk podle dotazníku.
 * Texty jsou z `QUESTIONNAIRE_PUBLIC_TEXT` (sdílené), ne z jazykového balíčku uživatele.
 */
import { Button, ErrorBox, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { QUESTIONNAIRE_ANSWER_TEXT, QUESTIONNAIRE_FILE_EXTENSIONS, QUESTIONNAIRE_PUBLIC_TEXT, type PublicQuestionnaireDto, type QuestionnaireAnswers, type QuestionnaireAnswerValue } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { CheckCircle2, Paperclip, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const fill = (s: string, p: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? ""));
const date = (iso: string, locale: string) => new Date(iso).toLocaleDateString(locale === "cs" ? "cs-CZ" : "en-GB", { dateStyle: "long" });

export function PublicQuestionnairePage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const q = useQuery({ queryKey: ["public-questionnaire", token], queryFn: () => api.publicQuestionnaire.get(token), retry: false, refetchOnWindowFocus: false });
  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">C</span> CONTIX
        </div>
        {q.data ? <Questionnaire token={token} data={q.data} /> : q.error ? <ErrorBox error={q.error} /> : <p className="text-sm text-slate-500">…</p>}
      </div>
    </div>
  );
}

function Questionnaire({ token, data: initial }: { token: string; data: PublicQuestionnaireDto }) {
  const [data, setData] = useState(initial);
  const L = QUESTIONNAIRE_PUBLIC_TEXT[data.locale];
  const A = QUESTIONNAIRE_ANSWER_TEXT[data.locale];
  const [answers, setAnswers] = useState<QuestionnaireAnswers>(initial.answers);
  const [who, setWho] = useState({ respondentName: initial.respondentName ?? "", respondentEmail: initial.respondentEmail ?? "", respondentRole: initial.respondentRole ?? "", generalNote: initial.generalNote ?? "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    document.documentElement.lang = data.locale;
    document.title = `${L.heading} – ${data.organization}`;
  }, [data.locale, data.organization, L.heading]);
  const payload = () => ({ answers, respondentName: who.respondentName || null, respondentEmail: who.respondentEmail || null, respondentRole: who.respondentRole || null, generalNote: who.generalNote || null });
  const save = useMutation({
    mutationFn: () => api.publicQuestionnaire.save(token, payload()),
    onSuccess: (d) => {
      setData(d);
      setSaved(true);
    },
  });
  const submit = useMutation({
    mutationFn: () => api.publicQuestionnaire.submit(token, { ...payload(), respondentName: who.respondentName, respondentEmail: who.respondentEmail }),
    onSuccess: (d) => {
      setData(d);
      window.scrollTo({ top: 0 });
    },
  });
  const upload = useMutation({
    mutationFn: (x: { file: File; questionKey: string | null }) => api.publicQuestionnaire.upload(token, x.file, x.questionKey),
    onSuccess: (d) => setData((cur) => ({ ...cur, files: d.files })),
  });
  const removeFile = useMutation({
    mutationFn: (fileId: string) => api.publicQuestionnaire.removeFile(token, fileId),
    onSuccess: (d) => setData((cur) => ({ ...cur, files: d.files })),
  });
  const files = (questionKey: string | null) => (
    <Attachments
      list={data.files.filter((f) => f.questionKey === questionKey)}
      L={L}
      busy={upload.isPending && upload.variables?.questionKey === questionKey}
      onAdd={(file) => upload.mutate({ file, questionKey })}
      onRemove={(id) => removeFile.mutate(id)}
    />
  );
  const missing = useMemo(() => data.questions.filter((x) => !answers[x.key]).length, [answers, data.questions]);
  const set = (key: string, patch: Partial<{ value: QuestionnaireAnswerValue; comment: string; evidence: string }>) => {
    setSaved(false);
    setAnswers((a) => ({ ...a, [key]: { value: a[key]?.value ?? "yes", comment: a[key]?.comment ?? null, evidence: a[key]?.evidence ?? null, ...patch } }));
  };

  const header = (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{L.heading}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {data.organization} · {L.supplier}: <b>{data.supplierName}</b> · {data.title}
      </p>
    </div>
  );
  if (data.status === "submitted")
    return (
      <>
        {header}
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <CheckCircle2 size={22} /> {fill(L.submitted!, { date: date(data.submittedAt!, data.locale) })}
        </div>
      </>
    );
  if (data.status === "closed")
    return (
      <>
        {header}
        <div className="rounded-lg border border-slate-200 bg-white p-5 text-slate-700">{L.closed}</div>
      </>
    );

  return (
    <>
      {header}
      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-700">
        <p className="flex gap-2">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand-600" /> {fill(L.intro!, { organization: data.organization, date: date(data.expiresAt, data.locale) })}
        </p>
        {data.message && <p className="mt-3 whitespace-pre-line border-l-2 border-slate-200 pl-3 text-slate-600">{data.message}</p>}
      </div>
      {data.sections.map((sec) => (
        <section key={sec.key} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">{sec.title}</h2>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {data.questions
              .filter((x) => x.section === sec.key)
              .map((x) => {
                const a = answers[x.key];
                const opts: QuestionnaireAnswerValue[] = x.allowNa ? ["yes", "partial", "no", "na"] : ["yes", "partial", "no"];
                return (
                  <div key={x.key} role="group" aria-labelledby={`q-${x.key}`} className="p-4">
                    <p id={`q-${x.key}`} className="mb-2 text-sm text-slate-900">
                      {x.text}
                      {x.critical && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{L.critical}</span>}
                    </p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`q-${x.key}`}>
                      {opts.map((v) => (
                        <label
                          key={v}
                          className={cn(
                            "cursor-pointer rounded-md border px-3 py-1.5 text-sm",
                            a?.value === v ? (v === "yes" ? "border-emerald-500 bg-emerald-50 text-emerald-900" : v === "na" ? "border-slate-400 bg-slate-100" : v === "partial" ? "border-amber-500 bg-amber-50 text-amber-900" : "border-red-500 bg-red-50 text-red-900") : "border-slate-300 hover:bg-slate-50",
                          )}
                        >
                          <input type="radio" name={x.key} value={v} checked={a?.value === v} onChange={() => set(x.key, { value: v })} className="sr-only" />
                          {A[v]}
                        </label>
                      ))}
                    </div>
                    {a && (
                      <div className="mt-3 grid gap-2">
                        <Textarea rows={2} placeholder={L.comment} aria-label={L.comment} value={a.comment ?? ""} onChange={(e) => set(x.key, { comment: e.target.value })} maxLength={2000} />
                        <Input placeholder={L.evidence} aria-label={L.evidence} value={a.evidence ?? ""} onChange={(e) => set(x.key, { evidence: e.target.value })} maxLength={500} />
                        {files(x.key)}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      ))}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{L.respondent}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input placeholder={L.name} aria-label={L.name} value={who.respondentName} onChange={(e) => setWho({ ...who, respondentName: e.target.value })} />
          <Input type="email" placeholder={L.email} aria-label={L.email} value={who.respondentEmail} onChange={(e) => setWho({ ...who, respondentEmail: e.target.value })} />
          <Input placeholder={L.role} aria-label={L.role} value={who.respondentRole} onChange={(e) => setWho({ ...who, respondentRole: e.target.value })} />
        </div>
        <div className="mt-3">
          <div className="mb-1 text-sm text-slate-700">{L.attachGeneral}</div>
          {files(null)}
          <p className="mt-1 text-xs text-slate-500">{L.attachHint}</p>
        </div>
        <Textarea className="mt-3" rows={3} placeholder={L.generalNote} aria-label={L.generalNote} value={who.generalNote} onChange={(e) => setWho({ ...who, generalNote: e.target.value })} maxLength={4000} />
      </section>
      <ErrorBox error={save.error ?? submit.error ?? upload.error ?? removeFile.error} />
      {saved && <p className="mb-3 text-sm text-emerald-700">{L.saved}</p>}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
        <span className="text-sm text-slate-600">
          {fill(L.progress!, { answered: data.questions.length - missing, total: data.questions.length })}
          {missing > 0 && <span className="ml-2 text-amber-700">{fill(L.missing!, { n: missing })}</span>}
        </span>
        <Button variant="secondary" className="ml-auto" onClick={() => save.mutate()} disabled={save.isPending}>
          {L.save}
        </Button>
        <Button onClick={async () => (await askConfirm(L.confirmSubmit!)) && submit.mutate()} disabled={submit.isPending || missing > 0 || !who.respondentName.trim() || !who.respondentEmail.trim()}>
          {L.submit}
        </Button>
      </div>
    </>
  );
}

const ACCEPT = QUESTIONNAIRE_FILE_EXTENSIONS.map((e) => `.${e}`).join(",");
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

function Attachments({ list, L, busy, onAdd, onRemove }: { list: PublicQuestionnaireDto["files"]; L: Record<string, string>; busy: boolean; onAdd: (f: File) => void; onRemove: (id: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.map((f) => (
        <span key={f.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
          <Paperclip size={12} aria-hidden /> {f.filename} <span className="text-slate-400">({size(f.size)})</span>
          <button type="button" onClick={() => onRemove(f.id)} className="ml-0.5 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`${L.removeFile} ${f.filename}`}>
            <X size={12} />
          </button>
        </span>
      ))}
      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-brand-400 hover:text-brand-700">
        <Paperclip size={12} aria-hidden /> {busy ? L.uploading : L.attach}
        <input
          type="file"
          className="sr-only"
          accept={ACCEPT}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAdd(f);
            e.target.value = "";
          }}
        />
      </label>
    </div>
  );
}
