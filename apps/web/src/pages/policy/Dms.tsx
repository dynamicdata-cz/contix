import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDay } from "@/lib/utils";
import { AWARENESS_LABELS, OFFICE_APPS, officeAppOf, POLICY_LABELS, POLICY_WORKFLOW_ACTIONS, type CourseForm, type OfficeOpenDto, type PolicyFileDto, type PolicyCommentDto, type PolicyDetail, type PolicyVersionDto, type PolicyVersionStatus, type QuizInput } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DiffView } from "@/components/diff";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, CornerUpLeft, ExternalLink, FilePlus2, FileText, GitCompare, History, PenLine, RefreshCw, Lock, LockOpen, Paperclip, Plus, Send, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";

const versionTone: Record<PolicyVersionStatus, Tone> = { draft: "amber", review: "blue", approval: "violet", approved: "green", superseded: "slate" };
const sizeOf = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

/** Verze dokumentu se soubory a schvalovacím oběhem gestor → vlastník procesu → schvalovatel. */
export function VersionsCard({ p, onDone, onOpen, onReview }: { p: PolicyDetail; onDone: (d: PolicyDetail) => void; onOpen: (v: "new" | string) => void; onReview: () => void }) {
  const t = useT();
  const open = p.versions.find((v) => ["draft", "review", "approval"].includes(v.status));
  const [history, setHistory] = useState<PolicyVersionDto | null>(null);
  const [ret, setRet] = useState<PolicyVersionDto | null>(null);
  const wf = useMutation({ mutationFn: ({ v, action, note }: { v: PolicyVersionDto; action: "submit" | "review_ok" | "approve"; note?: string }) => api.policies.workflow(p.id, v.id, { action, note }), onSuccess: onDone });
  const direct = useMutation({ mutationFn: (v: PolicyVersionDto) => api.policies.approve(p.id, v.id), onSuccess: onDone });
  const delVersion = useMutation({ mutationFn: (v: PolicyVersionDto) => api.policies.deleteVersion(p.id, v.id), onSuccess: onDone });
  const upload = useMutation({ mutationFn: ({ v, file, replaceId }: { v: PolicyVersionDto; file: File; replaceId?: string }) => api.policies.uploadFile(p.id, v.id, file, replaceId), onSuccess: onDone });
  const delFile = useMutation({ mutationFn: ({ v, fid }: { v: PolicyVersionDto; fid: string }) => api.policies.deleteFile(p.id, v.id, fid), onSuccess: onDone });
  const checkout = useMutation({ mutationFn: (v: PolicyVersionDto) => api.policies.checkout(p.id, v.id), onSuccess: onDone });
  const unlock = useMutation({ mutationFn: (v: PolicyVersionDto) => api.policies.unlock(p.id, v.id), onSuccess: onDone });
  const fromTemplate = useMutation({ mutationFn: ({ v, tid }: { v: PolicyVersionDto; tid: string }) => api.policies.fromTemplate(p.id, v.id, tid), onSuccess: onDone });
  const templates = useQuery({ queryKey: ["policies", "templates"], queryFn: api.policies.templates, enabled: p.canEdit });
  const tpl = (templates.data ?? []).filter((tx) => tx.companyId === p.companyId && (!tx.docType || tx.docType === p.docType));
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<{ v: PolicyVersionDto; replaceId?: string } | null>(null);
  const [checkin, setCheckin] = useState<PolicyVersionDto | null>(null);
  const [revisions, setRevisions] = useState<string | null>(null);
  const [compare, setCompare] = useState<PolicyVersionDto | null>(null);
  const qc = useQueryClient();
  const [officeOpen, setOfficeOpen] = useState<OfficeOpenDto | null>(null);
  const office = useMutation({
    mutationFn: ({ v, f, mode }: { v: PolicyVersionDto; f: PolicyFileDto; mode: "edit" | "view" }) => api.policies.office(p.id, v.id, f.id, mode),
    onSuccess: (o) => {
      setOfficeOpen(o);
      // otevře Word / Excel / PowerPoint (prohlížeč se zeptá na povolení odkazu ms-word:)
      window.location.href = o.uri;
      qc.invalidateQueries({ queryKey: ["policies", "detail", p.id] });
    },
  });
  const convert = useMutation({ mutationFn: ({ v, fid }: { v: PolicyVersionDto; fid: string }) => api.policies.convert(p.id, v.id, fid), onSuccess: onDone });
  const steps = [
    { role: POLICY_LABELS.role.owner, who: p.ownerPositionName },
    ...(p.reviewerPositionName ? [{ role: POLICY_LABELS.role.reviewer, who: p.reviewerPositionName }] : []),
    { role: POLICY_LABELS.role.approver, who: p.approverPositionName ?? t("dms.opravneniSchvalovatDokumentyIsms") },
  ];
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader
        title={t("dms.verzeASchvalovani")}
        subtitle={t("dms.obehX", { p: steps.map((s) => `${s.role} (${s.who ?? t("dms.neurceno")})`).join(" → ") })}
        action={
          p.canEdit && (
            <div className="flex gap-2">
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={onReview} disabled={!p.currentVersion}>
                {t("dms.prezkoumanoBezeZmeny")}
              </Button>
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => onOpen("new")} disabled={!!open}>
                <FilePlus2 size={14} /> {t("dms.novaVerze")}
              </Button>
            </div>
          )
        }
      />
      <ErrorBox error={wf.error ?? direct.error ?? delVersion.error ?? upload.error ?? delFile.error ?? checkout.error ?? unlock.error ?? fromTemplate.error ?? convert.error ?? office.error} />
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.doc,.odt,.xlsx,.pptx,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadFor) upload.mutate({ ...uploadFor, file });
          e.target.value = "";
        }}
      />
      {p.versions.length === 0 ? (
        <EmptyState>{t("dms.zatimZadnaVerzeGestorZalozi")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {p.versions.map((v) => (
            <li key={v.id} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums">{v.version}</span>
                <Badge tone={versionTone[v.status]}>{t.lbl(POLICY_LABELS.versionStatus[v.status])}</Badge>
                <span className="text-slate-600">{v.changeSummary ?? ""}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {v.approvedAt ? t("dms.schvaleno", { p: fmtDay(v.approvedAt), p2: v.approvedByName ?? "" }) : v.submittedAt ? t("dms.predlozeno", { p: fmtDay(v.submittedAt) }) : t("dms.zalozeno", { p: fmtDay(v.createdAt) })}
                  {v.status !== "draft" && v.status !== "review" && v.status !== "approval" && (" " + t("dms.seznameno", { acknowledged: v.acknowledged }))}
                </span>
              </div>
              {v.files.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {v.files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-xs">
                      <Paperclip size={12} className="text-slate-400" />
                      <a href={api.policies.fileUrl(p.id, v.id, f.id, f.mime === "application/pdf")} target={f.mime === "application/pdf" ? "_blank" : undefined} rel="noreferrer" className="text-brand-700 hover:underline">
                        {f.filename}
                      </a>
                      <span className="text-slate-400">{sizeOf(f.size)}</span>
                      <PdfLink p={p} v={v} f={f} onRetry={() => convert.mutate({ v, fid: f.id })} retrying={convert.isPending} />
                      {(() => {
                        const app = officeAppOf(f.filename);
                        if (!app) return null;
                        const label = OFFICE_APPS[app].label;
                        if (v.status === "draft" && (v.can.edit || v.can.checkout))
                          return (
                            <button
                              className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 text-[11px] font-medium text-blue-800 hover:bg-blue-100"
                              title={t("dms.otevritVDesktopoveAplikaciUlozeni", { label: label })}
                              disabled={office.isPending}
                              onClick={() => office.mutate({ v, f, mode: "edit" })}
                            >
                              <PenLine size={11} /> {label === "Word" ? t("dms.upravitVeWordu") : label === "Excel" ? t("dms.upravitVExcelu") : t("dms.upravitVPowerpointu")}
                            </button>
                          );
                        return (
                          <button className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-brand-700" title={t("dms.otevritVAplikaciJenPro", { label: label })} onClick={() => office.mutate({ v, f, mode: "view" })}>
                            <ExternalLink size={11} /> {label}
                          </button>
                        );
                      })()}
                      {f.revision > 1 && (
                        <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-600" title={f.note ?? undefined}>
                          {t("dms.rev2", { revision: f.revision })}
                        </span>
                      )}
                      {v.can.edit && (
                        <>
                          <button
                            className="text-slate-500 hover:text-brand-700"
                            title={t("dms.nahratNovouReviziTohotoSouboru")}
                            onClick={() => {
                              setUploadFor({ v, replaceId: f.id });
                              fileInput.current?.click();
                            }}
                          >
                            <Upload size={12} />
                          </button>
                          <button className="text-slate-400 hover:text-red-600" title={t("dms.odebratSouborISeStarsimi")} onClick={async () => (await askConfirm(t("dms.odebrat", { filename: f.filename }))) && delFile.mutate({ v, fid: f.id })}>
                            <X size={12} />
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {v.fileHistory.length > 0 && (
                <div className="mt-1 text-xs">
                  <button className="text-slate-500 hover:underline" onClick={() => setRevisions(revisions === v.id ? null : v.id)}>
                    {t("dms.starsiRevizeSouboru", { length: v.fileHistory.length })}
                  </button>
                  {revisions === v.id && (
                    <ul className="mt-1 space-y-0.5 border-l-2 border-slate-100 pl-3">
                      {v.fileHistory.map((f) => (
                        <li key={f.id} className="flex flex-wrap items-center gap-2 text-slate-500">
                          <a href={api.policies.fileUrl(p.id, v.id, f.id)} className="hover:text-brand-700 hover:underline">
                            {f.filename}
                          </a>
                          <span>{t("dms.rev2", { revision: f.revision })}</span>
                          <span>
                            {new Date(f.uploadedAt).toLocaleString("cs-CZ")} · {f.uploadedByName ?? "?"}
                          </span>
                          {f.note && <span className="italic">{f.note}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {v.office && (
                <p className="mt-1.5 rounded bg-blue-50 px-2 py-1 text-xs text-blue-900">
                  {v.office.open ? t("dms.upravujeteVOffice") : t("dms.upravaVOffice")}: {v.office.filename} ·{" "}
                  {v.office.saves ? t("dms.ulozenoNaposledy", { saves: v.office.saves, p: new Date(v.office.lastSavedAt!).toLocaleString("cs-CZ") }) : t("dms.zatimNeulozenoUkladejteVAplikaci")}
                  {v.can.checkin && t("dms.azSkonciteZavreteDokumentA")}
                </p>
              )}
              {v.lock && (
                <p className={`mt-1.5 inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs ${v.lock.mine ? "bg-blue-50 text-blue-900" : "bg-amber-50 text-amber-900"}`}>
                  <Lock size={12} />
                  {v.lock.mine ? t("dms.mateRezervovanoKUprave") : t("dms.upravujeX", { p: v.lock.userName ?? t("dms.jinyUzivatel") })} {t("dms.od")} {new Date(v.lock.at).toLocaleString("cs-CZ")}
                  {v.lock.mine && t("dms.poUpraveNahrajteSouborTlacitkem")}
                </p>
              )}
              {(() => {
                const last = v.events.filter((e) => (POLICY_WORKFLOW_ACTIONS as readonly string[]).includes(e.action)).at(-1);
                return last?.action === "return" && v.status === "draft" ? (
                  <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    {t("dms.vraceno", { p: last.userName ?? "?", p2: fmtDay(last.at), note: last.note })}
                  </p>
                ) : null;
              })()}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(v.hasContent || v.can.edit) && (
                  <button className="text-xs text-brand-700 hover:underline" onClick={() => onOpen(v.id)}>
                    {v.can.edit ? t("dms.upravitTextAUdaje") : "Text"}
                  </button>
                )}
                {v.can.edit && (
                  <button
                    className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                    onClick={() => {
                      setUploadFor({ v });
                      fileInput.current?.click();
                    }}
                  >
                    <Upload size={12} /> {t("dms.nahratSoubor")}
                  </button>
                )}
                {v.can.edit && tpl.length > 0 && (
                  <select
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-brand-700"
                    value=""
                    disabled={fromTemplate.isPending}
                    onChange={(e) => e.target.value && fromTemplate.mutate({ v, tid: e.target.value })}
                    aria-label={t("dms.vytvoritSouborZeSablony")}
                  >
                    <option value="">{t("dms.zeSablony")}</option>
                    {tpl.map((tx) => (
                      <option key={tx.id} value={tx.id}>
                        {tx.name}
                      </option>
                    ))}
                  </select>
                )}
                {v.can.checkout && (
                  <button className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" title={t("dms.zamkneNavrhProOstatniDokud")} onClick={() => checkout.mutate(v)}>
                    <Lock size={12} /> {t("dms.rezervovatKUprave")}
                  </button>
                )}
                {v.can.checkin && (
                  <button className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" onClick={() => setCheckin(v)}>
                    <LockOpen size={12} /> {t("dms.vratitPoUprave")}
                  </button>
                )}
                {v.can.unlock && (
                  <button
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:underline"
                    onClick={async () => (v.lock?.mine || (await askConfirm(t("dms.zrusitRezervaciUzivateleNeulozeneZmeny", { p: v.lock?.userName ?? "?" })))) && unlock.mutate(v)}
                  >
                    <LockOpen size={12} /> {t("dms.zrusitRezervaci")}
                  </button>
                )}
                {p.versions.indexOf(v) < p.versions.length - 1 && (
                  <button className="inline-flex items-center gap-1 text-xs text-slate-600 hover:underline" title={t("dms.porovnatTextSPredchoziVerzi")} onClick={() => setCompare(v)}>
                    <GitCompare size={12} /> {t("dms.porovnatS")} {p.versions[p.versions.indexOf(v) + 1]!.version}
                  </button>
                )}
                {v.events.length > 0 && (
                  <button className="inline-flex items-center gap-1 text-xs text-slate-600 hover:underline" onClick={() => setHistory(v)}>
                    <History size={12} /> {t("dms.historie")}{v.events.length})
                  </button>
                )}
                <span className="ml-auto flex flex-wrap gap-2">
                  {v.status === "draft" && p.canEdit && (
                    <Button
                      className="px-2.5 py-1 text-xs"
                      disabled={!v.can.submit || wf.isPending}
                      title={v.can.submit ? undefined : t("dms.nejdrivNahrajteSouborNeboDoplnte")}
                      onClick={() => wf.mutate({ v, action: "submit" })}
                    >
                      <Send size={13} /> {t("dms.predlozit")} {p.reviewerPositionName ? t("dms.keKontrole") : t("dms.keSchvaleni")}
                    </Button>
                  )}
                  {v.can.review && (
                    <Button className="px-2.5 py-1 text-xs" disabled={wf.isPending} onClick={() => wf.mutate({ v, action: "review_ok" })}>
                      <CheckCircle2 size={13} /> {t("dms.vecneVPoradkuKeSchvaleni")}
                    </Button>
                  )}
                  {v.can.approve && (
                    <Button className="px-2.5 py-1 text-xs" disabled={wf.isPending} onClick={async () => (await askConfirm(t("dms.schvalitVerziStaneSePlatnou", { version: v.version }))) && wf.mutate({ v, action: "approve" })}>
                      <CheckCircle2 size={13} /> {t("dms.schvalit")}
                    </Button>
                  )}
                  {(v.can.review || v.can.approve) && (
                    <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => setRet(v)}>
                      <CornerUpLeft size={13} /> {t("dms.vratit")}
                    </Button>
                  )}
                  {v.can.directApprove && !v.can.approve && (
                    <button
                      className="text-xs text-slate-500 hover:text-brand-700 hover:underline"
                      title={t("dms.schvalitMimoBeznyObehOpravneni")}
                      onClick={async () => (await askConfirm(t("dms.schvalitVerziPrimoBezObehu", { version: v.version }))) && direct.mutate(v)}
                    >
                      {t("dms.schvalitPrimo")}
                    </button>
                  )}
                  {v.can.edit && (
                    <button className="text-slate-400 hover:text-red-600" title={t("dms.smazatNavrh")} onClick={async () => (await askConfirm(t("dms.smazatNavrhVerze"))) && delVersion.mutate(v)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {history && (
        <Modal open onClose={() => setHistory(null)} title={t("dms.historieVerze", { version: history.version })} footer={<Button onClick={() => setHistory(null)}>{t("common.close")}</Button>}>
          <ol className="space-y-2 text-sm">
            {history.events.map((e, i) => (
              <li key={i} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium">{t.lbl(POLICY_LABELS.workflowAction[e.action])}</div>
                <div className="text-xs text-slate-500">
                  {new Date(e.at).toLocaleString("cs-CZ")} · {e.userName ?? "?"} · {t.lbl(POLICY_LABELS.versionStatus[e.fromStatus])} → {t.lbl(POLICY_LABELS.versionStatus[e.toStatus])}
                </div>
                {e.note && <div className="mt-0.5 text-slate-700">{e.note}</div>}
              </li>
            ))}
          </ol>
        </Modal>
      )}
      {ret && <ReturnModal p={p} v={ret} onClose={() => setRet(null)} onDone={onDone} />}
      {checkin && <CheckinModal p={p} v={checkin} onClose={() => setCheckin(null)} onDone={onDone} />}
      {compare && <CompareModal p={p} v={compare} onClose={() => setCompare(null)} />}
      {officeOpen && <OfficeHelpModal o={officeOpen} onClose={() => setOfficeOpen(null)} />}
    </Card>
  );
}

/** Nápověda po otevření v Office (a náhradní postup, když se aplikace sama nespustí). */
function OfficeHelpModal({ o, onClose }: { o: OfficeOpenDto; onClose: () => void }) {
  const t = useT();
  const label = OFFICE_APPS[o.app].label;
  const [copied, setCopied] = useState(false);
  return (
    <Modal open onClose={onClose} title={t("dms.oteviraSe", { label: label })} footer={<Button onClick={onClose}>{t("dms.rozumim")}</Button>}>
      <div className="space-y-3 text-sm text-slate-700">
        {o.mode === "edit" ? (
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("dms.verzeJeRezervovanaProVas")}</li>
            <li>
              {t("dms.upravujteVAplikaci")} {label} {t("dms.aUkladejteBezne")}<b>{t("dms.ctrlS")}</b>{t("dms.kazdeUlozeniSeZapiseDo")}
            </li>
            <li>{t("dms.azSkonciteDokumentZavreteA")}</li>
          </ul>
        ) : (
          <p>{t("dms.dokumentSeOtevreJenPro")}</p>
        )}
        <p className="text-xs text-slate-500">
          {t("dms.pokudSeNespustiProhlizecMusi", { label: label })}
        </p>
        <div className="flex gap-2">
          <Input readOnly value={o.url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(o.url).then(() => setCopied(true));
            }}
          >
            {copied ? t("dms.zkopirovano") : t("dms.kopirovat")}
          </Button>
        </div>
        <p className="text-xs text-slate-500">{t("dms.odkazJeOsobniAPlati")}</p>
      </div>
    </Modal>
  );
}

/** Odkaz na PDF s doložkou / stav převodu. */
function PdfLink({ p, v, f, onRetry, retrying }: { p: PolicyDetail; v: PolicyVersionDto; f: PolicyFileDto; onRetry: () => void; retrying: boolean }) {
  const t = useT();
  if (f.pdf === "native" || f.pdf === "ok")
    return (
      <a href={api.policies.pdfUrl(p.id, v.id, f.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 text-[11px] text-slate-700 hover:bg-brand-50 hover:text-brand-700" title={t("dms.pdfSDolozkouStavVerze")}>
        <FileText size={11} /> {t("dms.pdf")}
      </a>
    );
  if (f.pdf === "pending" && /\.(docx?|xlsx?|pptx?|od[tsp]|rtf)$/i.test(f.filename)) return <span className="text-[11px] text-slate-400" title={t("dms.prevodDoPdfCekaNa")}>{t("dms.pdfSePripravuje")}</span>;
  if (f.pdf === "failed")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-700" title={f.pdfError ?? undefined}>
        {t("dms.prevodDoPdfSelhal")}
        {p.canEdit && (
          <button className="text-slate-500 hover:text-brand-700" title={t("dms.zkusitZnovu")} disabled={retrying} onClick={onRetry}>
            <RefreshCw size={11} className={retrying ? "animate-spin" : undefined} />
          </button>
        )}
      </span>
    );
  return null;
}

function CompareModal({ p, v, onClose }: { p: PolicyDetail; v: PolicyVersionDto; onClose: () => void }) {
  const t = useT();
  const older = p.versions.slice(p.versions.indexOf(v) + 1);
  const [base, setBase] = useState(older[0]?.id ?? "");
  const d = useQuery({ queryKey: ["policies", "diff", v.id, base], queryFn: () => api.policies.diff(p.id, v.id, base), enabled: !!base });
  return (
    <Modal open onClose={onClose} title={t("dms.zmenyVeVerzi", { version: v.version })} wide footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      <div className="space-y-3">
        {older.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            {t("dms.porovnatSVerzi")}
            <select className="rounded border border-slate-300 px-2 py-1" value={base} onChange={(e) => setBase(e.target.value)}>
              {older.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.version} ({t.lbl(POLICY_LABELS.versionStatus[o.status])})
                </option>
              ))}
            </select>
          </label>
        )}
        <ErrorBox error={d.error} />
        {d.isLoading && <p className="text-sm text-slate-500">{t("dms.porovnavam")}</p>}
        {d.data && <DiffView d={d.data} />}
      </div>
    </Modal>
  );
}

const extOf = (n: string) => n.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "";

/** Check-in: nahraje upravený soubor jako novou revizi (nebo jen uvolní rezervaci). */
function CheckinModal({ p, v, onClose, onDone }: { p: PolicyDetail; v: PolicyVersionDto; onClose: () => void; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [replaceId, setReplaceId] = useState<string>(v.files[0]?.id ?? "");
  const [note, setNote] = useState("");
  const pick = (f: File | null) => {
    setFile(f);
    // nabídnout nahrazení souboru se stejnou příponou
    const same: PolicyFileDto | undefined = f ? v.files.find((x) => extOf(x.filename) === extOf(f.name)) : undefined;
    if (same) setReplaceId(same.id);
  };
  const m = useMutation({
    mutationFn: () => api.policies.checkin(p.id, v.id, file, file ? replaceId || null : null, note || null),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("dms.vratitVerziPoUprave", { version: v.version })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            {file ? t("dms.nahratAUvolnit") : v.office?.saves ? t("dms.dokoncitUpravuZmenyZOffice") : t("dms.uvolnitBezZmenySouboru")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("dms.upravenySoubor")}>
          <input type="file" className="block w-full text-sm" accept=".pdf,.docx,.doc,.odt,.xlsx,.pptx" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </Field>
        {file && v.files.length > 0 && (
          <Field label={t("dms.nahrazuje")} hint={t("dms.puvodniSouborZustaneVHistorii")}>
            <select className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" value={replaceId} onChange={(e) => setReplaceId(e.target.value)}>
              {v.files.map((f) => (
                <option key={f.id} value={f.id}>
                  {t("dms.rev", { filename: f.filename, revision: f.revision })}
                </option>
              ))}
              <option value="">{t("dms.pridatJakoNovySoubor")}</option>
            </select>
          </Field>
        )}
        <Field label={t("dms.poznamkaKRevizi")}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("dms.naprZapracovanyPripominkyZKontroly")} />
        </Field>
        <ErrorBox error={m.error} />
      </div>
    </Modal>
  );
}

function ReturnModal({ p, v, onClose, onDone }: { p: PolicyDetail; v: PolicyVersionDto; onClose: () => void; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => api.policies.workflow(p.id, v.id, { action: "return", note }),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("dms.vratitVerziGestorovi", { version: v.version })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!note.trim() || m.isPending} onClick={() => m.mutate()}>
            {t("dms.vratitKPrepracovani")}
          </Button>
        </>
      }
    >
      <Field label={t("dms.coJePotrebaUpravit")}>
        <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

const commentTone: Record<PolicyCommentDto["status"], Tone> = { open: "amber", accepted: "green", rejected: "slate" };

/** Připomínky zaměstnanců k platnému dokumentu – vyřizuje gestor. */
export function CommentsCard({ p, onDone }: { p: PolicyDetail; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const [resolve, setResolve] = useState<{ c: PolicyCommentDto; status: "accepted" | "rejected" } | null>(null);
  const [response, setResponse] = useState("");
  const m = useMutation({
    mutationFn: () => api.policies.resolveComment(p.id, resolve!.c.id, resolve!.status, response),
    onSuccess: (d) => {
      onDone(d);
      setResolve(null);
      setResponse("");
    },
  });
  if (!p.comments.length) return null;
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader title={t("dms.pripominky")} subtitle={t("dms.otevrenychPripominkyZamestnancuZPortalu", { openComments: p.openComments })} />
      <ul className="divide-y divide-slate-100 text-sm">
        {p.comments.map((c) => (
          <li key={c.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Badge tone={commentTone[c.status]}>{t.lbl(POLICY_LABELS.commentStatus[c.status])}</Badge>
              {c.authorName ?? "?"} · {fmtDay(c.createdAt)} {t("dms.verze")} {c.version ?? "—"} {c.reference && `· ${c.reference}`}
              {c.status === "open" && p.canEdit && (
                <span className="ml-auto flex gap-2">
                  <button className="text-brand-700 hover:underline" onClick={() => setResolve({ c, status: "accepted" })}>
                    {t("dms.prijmout")}
                  </button>
                  <button className="text-slate-600 hover:underline" onClick={() => setResolve({ c, status: "rejected" })}>
                    {t("dms.neprijmout")}
                  </button>
                </span>
              )}
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
      {resolve && (
        <Modal
          open
          onClose={() => setResolve(null)}
          title={resolve.status === "accepted" ? t("dms.prijmoutPripominku") : t("dms.neprijmoutPripominku")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setResolve(null)}>
                {t("common.cancelAction")}
              </Button>
              <Button disabled={!response.trim() || m.isPending} onClick={() => m.mutate()}>
                {t("dms.ulozitVyjadreni")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">{resolve.c.text}</p>
          <Field label={t("dms.vyjadreniProAutoraPripominky")}>
            <Textarea rows={3} value={response} onChange={(e) => setResponse(e.target.value)} placeholder={resolve.status === "accepted" ? t("dms.naprZapracujemeDoVerze1") : t("dms.duvodNeprijeti")} />
          </Field>
          <ErrorBox error={m.error} />
        </Modal>
      )}
    </Card>
  );
}

/** Test porozumění – otázky s jednou nebo více správnými odpověďmi. */
export function QuizCard({ p, onDone }: { p: PolicyDetail; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const [edit, setEdit] = useState(false);
  const [qs, setQs] = useState<QuizInput>(() => p.quiz.map((q) => ({ question: q.question, options: q.options, correct: q.correct ?? [] })));
  const save = useMutation({
    mutationFn: () => api.policies.saveQuiz(p.id, qs),
    onSuccess: (d) => {
      onDone(d);
      setEdit(false);
    },
  });
  const upd = (i: number, f: (q: QuizInput[number]) => QuizInput[number]) => setQs((x) => x.map((q, j) => (j === i ? f(q) : q)));
  return (
    <Card>
      <CardHeader
        title={t("dms.testPorozumeni")}
        subtitle={p.quiz.length ? t("dms.otazekUspesnostPovinnyPredPotvrzenim", { length: p.quiz.length, quizPassPct: p.quizPassPct }) : t("dms.volitelnyKratkyTestVysledekJe")}
        action={
          p.canEdit &&
          !edit && (
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setEdit(true)}>
              {p.quiz.length ? "Upravit" : t("dms.vytvoritTest")}
            </Button>
          )
        }
      />
      {!edit ? (
        p.quiz.length ? (
          <ol className="list-decimal space-y-1 px-10 py-3 text-sm">
            {p.quiz.map((q, i) => (
              <li key={i}>
                {q.question} <span className="text-xs text-slate-500">({q.options.length} {t("dms.moznosti")}{q.multiple ? t("dms.viceSpravnych") : ""})</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState>{t("dms.bezTestuStaciPotvrditSeznameni")}</EmptyState>
        )
      ) : (
        <div className="space-y-4 p-5">
          {qs.map((q, i) => (
            <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3">
              <div className="flex gap-2">
                <Input value={q.question} placeholder={t("dms.otazka", { p: i + 1 })} onChange={(e) => upd(i, (x) => ({ ...x, question: e.target.value }))} />
                <button className="text-slate-400 hover:text-red-600" title={t("dms.odebratOtazku")} onClick={() => setQs((x) => x.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </button>
              </div>
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2 pl-2">
                  <input
                    type="checkbox"
                    className="accent-brand-600"
                    title={t("dms.spravnaOdpoved")}
                    checked={q.correct.includes(oi)}
                    onChange={(e) => upd(i, (x) => ({ ...x, correct: e.target.checked ? [...x.correct, oi] : x.correct.filter((c) => c !== oi) }))}
                  />
                  <Input value={o} placeholder={t("dms.moznost", { p: oi + 1 })} onChange={(e) => upd(i, (x) => ({ ...x, options: x.options.map((y, k) => (k === oi ? e.target.value : y)) }))} />
                  {q.options.length > 2 && (
                    <button
                      className="text-slate-400 hover:text-red-600"
                      onClick={() => upd(i, (x) => ({ ...x, options: x.options.filter((_, k) => k !== oi), correct: x.correct.filter((c) => c !== oi).map((c) => (c > oi ? c - 1 : c)) }))}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {q.options.length < 8 && (
                <button className="pl-2 text-xs text-brand-700 hover:underline" onClick={() => upd(i, (x) => ({ ...x, options: [...x.options, ""] }))}>
                  {t("dms.moznost2")}
                </button>
              )}
            </div>
          ))}
          <p className="text-xs text-slate-500">{t("dms.zaskrtneteSpravneOdpovediOtazkaJe")}</p>
          <ErrorBox error={save.error} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setQs((x) => [...x, { question: "", options: ["", ""], correct: [] }])} disabled={qs.length >= 30}>
              <Plus size={14} /> {t("dms.otazka2")}
            </Button>
            <Button
              disabled={save.isPending || qs.some((q) => !q.question.trim() || q.options.some((o) => !o.trim()) || !q.correct.length)}
              onClick={() => save.mutate()}
            >
              {t("dms.ulozitTest")}
            </Button>
            <Button variant="secondary" onClick={() => setEdit(false)}>
              {t("common.cancelAction")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Školení navázaná na dokument (Povědomí a školení). */
export function CoursesCard({ p }: { p: PolicyDetail }) {
  const t = useT();
  const can = useCan();
  return (
    <Card>
      <CardHeader
        title={t("dms.navazanaSkoleni")}
        subtitle={
          p.retrainOnNewVersion
            ? t("dms.novaVerzeDokumentuVyzadujeOpakovani")
            : t("dms.kurzFormySeznameniSDokumentem")
        }
      />
      {p.courses.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {p.courses.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-5 py-2">
              {can("awareness:read") ? (
                <Link to="/awareness/$courseId" params={{ courseId: c.id }} className="text-brand-700 hover:underline">
                  {c.code ? `${c.code} ` : ""}
                  {c.title}
                </Link>
              ) : (
                <span>{c.title}</span>
              )}
              <Badge tone="slate">{t.lbl(AWARENESS_LABELS.form[c.form as CourseForm]) ?? c.form}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>
          {t("dms.zadneKurzNavazeteVPovedomi")}{" "}
          {can("awareness:write") && (
            <Link to="/awareness/new" className="text-brand-700 hover:underline">
              {t("dms.novyKurz")}
            </Link>
          )}
        </EmptyState>
      )}
    </Card>
  );
}
