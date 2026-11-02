import { askConfirm } from "@/components/ui/overlay";
/**
 * Bezpečnostní dotazníky pro dodavatele (v0.46, ADR-040): odeslání odkazu, stav vyplnění, vyhodnocení,
 * založení rizika z mezer. Dodavatel vyplňuje bez přihlášení na stránce /q/<token>.
 */
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { useCzDecree } from "@/lib/regime";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate, fmtDay } from "@/lib/utils";
import {
  QUESTIONNAIRE_LABELS,
  QUESTIONNAIRE_SECTIONS,
  QUESTIONNAIRE_TEMPLATES,
  questionsFor,
  type QuestionnaireDto,
  type QuestionnaireLocale,
  type QuestionnaireTemplate,
  type SupplierDetail,
  type SupplierRiskLevel,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardList, Copy, ExternalLink, Link2, Paperclip, Printer, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";

const statusTone: Record<QuestionnaireDto["status"], Tone> = { sent: "blue", submitted: "amber", evaluated: "green", cancelled: "slate" };
const levelTone: Record<SupplierRiskLevel, Tone> = { low: "green", medium: "amber", high: "red" };

export function QuestionnairesCard({ supplier, edit }: { supplier: SupplierDetail; edit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["suppliers", "questionnaires", supplier.id], queryFn: () => api.suppliers.questionnaires(supplier.id) });
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<{ link: string; emailed?: boolean; emailError?: string | null } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["suppliers", "questionnaires", supplier.id] });
    qc.invalidateQueries({ queryKey: ["suppliers", "detail", supplier.id] });
  };
  const newLink = useMutation({
    mutationFn: (qid: string) => api.suppliers.questionnaireLink(supplier.id, qid, 30),
    onSuccess: (r) => {
      setLink({ link: r.link });
      refresh();
    },
  });
  const cancel = useMutation({ mutationFn: (qid: string) => api.suppliers.cancelQuestionnaire(supplier.id, qid), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (qid: string) => api.suppliers.deleteQuestionnaire(supplier.id, qid), onSuccess: refresh });
  const items = list.data ?? [];
  const current = items.find((q) => q.id === open);

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader
        title={t("sq.title")}
        subtitle={t("sq.subtitle")}
        action={
          edit && (
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setCreating(true)}>
              <Send size={14} /> {t("sq.send")}
            </Button>
          )
        }
      />
      <ErrorBox error={list.error ?? newLink.error ?? cancel.error ?? remove.error} />
      {!list.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("sq.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <button className="font-medium hover:text-brand-700" onClick={() => setOpen(q.id)}>
                  {q.title}
                </button>
                <div className="text-xs text-slate-500">
                  {t("sq.sentOn", { date: fmtDay(q.sentAt) })}
                  {q.sentTo && ` · ${q.sentTo}`}
                  {q.status === "sent" && ` · ${t(q.expired ? "sq.linkExpired" : "sq.validUntil", { date: fmtDay(q.expiresAt) })}`}
                  {q.submittedAt && ` · ${t("sq.submittedOn", { date: fmtDay(q.submittedAt) })}`}
                  {q.status === "sent" && q.lastSavedAt && ` · ${t("sq.inProgress")}`}
                </div>
              </div>
              {q.result.score != null && (q.status === "submitted" || q.status === "evaluated") && (
                <span className="tabular-nums text-sm font-medium text-slate-700">{q.result.score} %</span>
              )}
              {q.result.level && (q.status === "submitted" || q.status === "evaluated") && <Badge tone={levelTone[q.result.level]}>{t.lbl(QUESTIONNAIRE_LABELS.level[q.result.level])}</Badge>}
              <Badge tone={q.expired ? "red" : statusTone[q.status]}>{q.expired ? t("sq.expired") : t.lbl(QUESTIONNAIRE_LABELS.status[q.status])}</Badge>
              {edit && q.status === "sent" && (
                <>
                  <Button variant="ghost" className="px-1.5 py-1 text-xs" onClick={() => newLink.mutate(q.id)} title={t("sq.newLinkHint")}>
                    <Link2 size={13} /> {t("sq.newLink")}
                  </Button>
                  <Button variant="ghost" className="px-1.5 py-1 text-xs" onClick={async () => (await askConfirm(t("sq.cancelConfirm"))) && cancel.mutate(q.id)}>
                    {t("sq.cancel")}
                  </Button>
                </>
              )}
              {edit && q.status !== "evaluated" && (
                <Button variant="ghost" className="px-1.5 py-1 text-red-700" onClick={async () => (await askConfirm(t("sq.deleteConfirm"))) && remove.mutate(q.id)} aria-label={t("sq.delete")}>
                  <Trash2 size={13} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <NewQuestionnaireModal
          supplier={supplier}
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            setLink(r);
            refresh();
          }}
        />
      )}
      {link && <LinkModal {...link} onClose={() => setLink(null)} />}
      {current && <QuestionnaireModal supplier={supplier} q={current} edit={edit} onClose={() => setOpen(null)} onChanged={refresh} />}
    </Card>
  );
}

function NewQuestionnaireModal({ supplier, onClose, onCreated }: { supplier: SupplierDetail; onClose: () => void; onCreated: (r: { link: string; emailed: boolean; emailError: string | null }) => void }) {
  const t = useT();
  const decree = useCzDecree();
  const [template, setTemplate] = useState<QuestionnaireTemplate>(decree);
  const [locale, setLocale] = useState<QuestionnaireLocale>(t.locale === "en" ? "en" : "cs");
  const [validDays, setValidDays] = useState(30);
  const [sendEmail, setSendEmail] = useState(!!supplier.contactEmail);
  const [email, setEmail] = useState(supplier.contactEmail ?? "");
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () => api.suppliers.createQuestionnaire(supplier.id, { template, locale, validDays, sendEmail, email: sendEmail ? email || null : null, message: message || null }),
    onSuccess: (r) => onCreated({ link: r.link, emailed: r.emailed, emailError: r.emailError }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("sq.newTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || (sendEmail && !email.trim())}>
            <Send size={15} /> {sendEmail ? t("sq.createAndSend") : t("sq.createLink")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t("sq.newIntro")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("sq.template")} hint={t("sq.templateHint", { n: questionsFor(template).length })}>
            <Select value={template} onChange={(e) => setTemplate(e.target.value as QuestionnaireTemplate)}>
              {QUESTIONNAIRE_TEMPLATES.map((k) => (
                <option key={k} value={k}>
                  {t.lbl(QUESTIONNAIRE_LABELS.template[k])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("sq.language")} hint={t("sq.languageHint")}>
            <Select value={locale} onChange={(e) => setLocale(e.target.value as QuestionnaireLocale)}>
              <option value="cs">Čeština</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label={t("sq.validDays")}>
            <Input type="number" min={1} max={180} value={validDays} onChange={(e) => setValidDays(Math.max(1, Math.min(180, Number(e.target.value) || 30)))} />
          </Field>
        </div>
        <Checkbox checked={sendEmail} onChange={setSendEmail} label={t("sq.sendEmail")} hint={t("sq.sendEmailHint")} />
        {sendEmail && (
          <Field label={t("sq.recipient")}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <Field label={t("sq.message")} hint={t("sq.messageHint")}>
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <ErrorBox error={create.error} />
      </div>
    </Modal>
  );
}

function LinkModal({ link, emailed, emailError, onClose }: { link: string; emailed?: boolean; emailError?: string | null; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* schránka nedostupná – odkaz lze označit ručně */
    }
  };
  return (
    <Modal open onClose={onClose} title={t("sq.linkTitle")} footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      <div className="space-y-3">
        {emailed && <SuccessBox>{t("sq.emailed")}</SuccessBox>}
        {emailError && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{emailError}</p>}
        <p className="text-sm text-slate-600">{t("sq.linkOnce")}</p>
        <div className="flex gap-2">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t("sq.linkTitle")} />
          <Button variant="secondary" onClick={copy}>
            <Copy size={15} /> {copied ? t("sq.copied") : t("sq.copy")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function QuestionnaireModal({ supplier, q, edit, onClose, onChanged }: { supplier: SupplierDetail; q: QuestionnaireDto; edit: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const [note, setNote] = useState(q.evaluationNote ?? "");
  const [markRisk, setMarkRisk] = useState(true);
  const evaluate = useMutation({ mutationFn: () => api.suppliers.evaluateQuestionnaire(supplier.id, q.id, { note: note || null, markRiskAssessed: markRisk }), onSuccess: onChanged });
  const reopen = useMutation({ mutationFn: () => api.suppliers.reopenQuestionnaire(supplier.id, q.id), onSuccess: onChanged });
  const risk = useMutation({ mutationFn: () => api.suppliers.questionnaireRisk(supplier.id, q.id), onSuccess: onChanged });
  const text = (key: string) => {
    const x = questionsFor("cz409").find((y) => y.key === key);
    return x ? (t.locale === "en" ? x.text.en : x.text.cs) : key;
  };
  const sec = (key: string) => {
    const x = QUESTIONNAIRE_SECTIONS.find((y) => y.key === key);
    return x ? (t.locale === "en" ? x.title.en : x.title.cs) : key;
  };
  const r = q.result;
  const answered = q.status === "submitted" || q.status === "evaluated";
  const riskId = risk.data?.riskId ?? q.riskId;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={q.title}
      footer={
        <>
          {answered && (
            <a href={api.suppliers.questionnaireReportUrl(supplier.id, q.id)} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-brand-700">
              <Printer size={15} /> {t("sq.print")}
            </a>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Badge tone={q.expired ? "red" : statusTone[q.status]}>{q.expired ? t("sq.expired") : t.lbl(QUESTIONNAIRE_LABELS.status[q.status])}</Badge>
          <span>{t.lbl(QUESTIONNAIRE_LABELS.template[q.template])}</span>
          <span>· {q.locale === "en" ? "English" : "Čeština"}</span>
          {q.createdByName && <span>· {t("sq.sentBy", { name: q.createdByName, date: fmtDay(q.sentAt) })}</span>}
        </div>
        {!answered ? (
          <p className="text-sm text-slate-600">{q.status === "sent" ? t("sq.progress", { answered: r.answered, total: r.total }) : t("sq.cancelledInfo")}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label={t("sq.score")} value={r.score == null ? "–" : `${r.score} %`} />
              <Stat label={t("sq.level")} value={r.level ? <Badge tone={levelTone[r.level]}>{t.lbl(QUESTIONNAIRE_LABELS.level[r.level])}</Badge> : "–"} />
              <Stat label={t("sq.gaps")} value={r.gaps.length} />
              <Stat label={t("sq.criticalNo")} value={r.criticalNo} />
            </div>
            <p className="text-xs text-slate-500">{t("sq.scoreHint")}</p>
            <div className="text-sm text-slate-700">
              {t("sq.respondent")}: <b>{[q.respondentName, q.respondentRole].filter(Boolean).join(", ")}</b> {q.respondentEmail && <span className="text-slate-500">({q.respondentEmail})</span>} ·{" "}
              {fmtDate(q.submittedAt!)}
            </div>
            {r.gaps.length > 0 && (
              <div>
                <div className="mb-1 text-sm font-medium text-slate-700">{t("sq.gapsTitle")}</div>
                <ul className="space-y-1 text-sm">
                  {r.gaps.map((g) => (
                    <li key={g.key} className="flex gap-2">
                      <span className="shrink-0 self-start">
                        <Badge tone={g.value === "no" ? "red" : "amber"}>{t.lbl(QUESTIONNAIRE_LABELS.answer[g.value])}</Badge>
                      </span>
                      <span className="min-w-0 flex-1">
                        {text(g.key)}
                        {g.critical && <span className="ml-1 text-xs font-medium text-red-700">{t("sq.critical")}</span>}
                        {g.comment && <span className="block text-xs text-slate-500">{g.comment}</span>}
                        <FileLinks supplierId={supplier.id} q={q} questionKey={g.key} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <details className="rounded-md border border-slate-200">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">{t("sq.allAnswers", { n: r.answered })}</summary>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {questionsFor(q.template).map((x) => {
                    const a = q.answers[x.key];
                    return (
                      <tr key={x.key} className="align-top">
                        <td className="w-40 px-3 py-1.5 text-xs text-slate-500">{sec(x.section)}</td>
                        <td className="px-3 py-1.5">
                          {text(x.key)}
                          {(a?.comment || a?.evidence) && (
                            <div className="text-xs text-slate-500">
                              {a.comment}
                              {a.evidence && <span className="block">{a.evidence}</span>}
                            </div>
                          )}
                          <FileLinks supplierId={supplier.id} q={q} questionKey={x.key} />
                        </td>
                        <td className="w-28 px-3 py-1.5">{a ? t.lbl(QUESTIONNAIRE_LABELS.answer[a.value]) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
            {q.files.some((f) => !f.questionKey) && (
              <div className="text-sm">
                <div className="font-medium text-slate-700">{t("sq.files")}</div>
                <FileLinks supplierId={supplier.id} q={q} questionKey={null} />
              </div>
            )}
            {q.generalNote && (
              <div className="text-sm">
                <div className="font-medium text-slate-700">{t("sq.generalNote")}</div>
                <p className="whitespace-pre-line text-slate-600">{q.generalNote}</p>
              </div>
            )}
            {q.status === "submitted" && edit && (
              <div className="space-y-3 rounded-md bg-slate-50 p-4">
                <Field label={t("sq.evaluationNote")} hint={t("sq.evaluationNoteHint")}>
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Checkbox checked={markRisk} onChange={setMarkRisk} label={t("sq.markRiskAssessed")} hint={t("sq.markRiskAssessedHint")} />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
                    <ClipboardList size={15} /> {t("sq.evaluate")}
                  </Button>
                  <Button variant="secondary" onClick={async () => (await askConfirm(t("sq.reopenConfirm"))) && reopen.mutate()} disabled={reopen.isPending}>
                    {t("sq.reopen")}
                  </Button>
                </div>
              </div>
            )}
            {q.status === "evaluated" && (
              <p className="text-sm text-slate-600">
                {t("sq.evaluatedBy", { name: q.evaluatedByName ?? "—", date: fmtDay(q.evaluatedAt!) })}
                {q.evaluationNote && <span className="block whitespace-pre-line text-slate-500">{q.evaluationNote}</span>}
              </p>
            )}
            {mod("risks") &&
              (riskId ? (
                <Link to="/risks/$riskId" params={{ riskId }} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
                  <ExternalLink size={14} /> {t("sq.openRisk")}
                </Link>
              ) : (
                edit &&
                can("risks:write") && (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" onClick={() => risk.mutate()} disabled={risk.isPending}>
                      <ShieldAlert size={15} /> {t("sq.createRisk")}
                    </Button>
                    <span className="text-xs text-slate-500">{t("sq.createRiskHint")}</span>
                  </div>
                )
              ))}
          </>
        )}
        <ErrorBox error={evaluate.error ?? reopen.error ?? risk.error} />
      </div>
    </Modal>
  );
}

const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-md border border-slate-200 p-3">
    <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
  </div>
);

function FileLinks({ supplierId, q, questionKey }: { supplierId: string; q: QuestionnaireDto; questionKey: string | null }) {
  const list = q.files.filter((f) => f.questionKey === questionKey);
  if (!list.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {list.map((f) => (
        <a key={f.id} href={api.suppliers.questionnaireFileUrl(supplierId, q.id, f.id)} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-brand-700 hover:bg-slate-100">
          <Paperclip size={12} aria-hidden /> {f.filename}
        </a>
      ))}
    </div>
  );
}
