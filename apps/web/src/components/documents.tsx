import { askConfirm } from "@/components/ui/overlay";
import { NeedsCompany, useGroupView } from "@/components/company";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useT, lbl } from "@/lib/i18n";
import { useCan } from "@/lib/auth";
import { fmtDay } from "@/lib/utils";
import { DOC_LABELS, DOC_RETENTION_YEARS, docTitle, ISMS_REVIEW_INPUTS, RISK_REPORT_INPUTS, type DocKind, type DocStatus, type DocumentVersionDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Eye, FileDown, FileText, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

const statusTone: Record<DocStatus, Tone> = { draft: "amber", approved: "green", superseded: "slate" };

/** Ukazatele snímku, které se zobrazují u verzí (s rozdílem proti předchozí verzi). */
const METRICS: Record<DocKind, { key: string; label: string; unit?: string; betterDown?: boolean }[]> = {
  soa: [
    { key: "score", label: "Míra shody", unit: " %" },
    { key: "applicable", label: "Aplikovatelné" },
    { key: "compliant", label: "Splněno" },
    { key: "nonCompliant", label: "Nesplněno", betterDown: true },
  ],
  risk_report: [
    { key: "total", label: "Rizik" },
    { key: "critical", label: "Kritická", betterDown: true },
    { key: "high", label: "Vysoká", betterDown: true },
    { key: "unacceptable", label: "Nepřijatelná", betterDown: true },
    { key: "untreated", label: "Bez zvládání", betterDown: true },
    { key: "threatCoverage", label: "Pokrytí katalogu hrozeb", unit: " %" },
    { key: "unassessedThreats", label: "Neposouzené hrozby", betterDown: true },
  ],
  isms_review: [
    { key: "objectivesMet", label: "Splněné cíle" },
    { key: "overdueActions", label: "Akce po termínu", betterDown: true },
    { key: "unacceptable", label: "Nepřijatelná rizika", betterDown: true },
    { key: "significantChanges", label: "Významné změny" },
    { key: "changeGaps", label: "Změny s mezerami", betterDown: true },
    { key: "score", label: "Míra shody", unit: " %" },
  ],
  treatment_plan: [
    { key: "open", label: "Otevřené" },
    { key: "done", label: "Dokončené" },
    { key: "overdue", label: "Po termínu", betterDown: true },
  ],
};

function Metrics({ kind, cur, prev }: { kind: DocKind; cur: Record<string, number>; prev?: Record<string, number> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {METRICS[kind].map((m) => {
        const v = cur[m.key];
        if (v == null) return null;
        const d = prev?.[m.key] != null ? v - prev[m.key]! : 0;
        const good = m.betterDown ? d < 0 : d > 0;
        return (
          <span key={m.key}>
            {lbl(m.label)}: <b className="tabular-nums text-slate-800">{Math.round(v * 10) / 10}{m.unit ?? ""}</b>
            {d !== 0 && (
              <span className={good ? "ml-1 text-emerald-700" : "ml-1 text-red-700"}>
                ({d > 0 ? "+" : "−"}{Math.abs(Math.round(d * 10) / 10)})
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Verze dokumentu ISMS: snímek → schválení → prokazatelné seznámení.
 * Použito pro SoA / přehled opatření, zprávu o hodnocení rizik a plán zvládání rizik.
 */
export function DocumentVersions(props: { kind: DocKind; framework?: string | null; writePerm: "risks:write" | "controls:write" | "isms:write" }) {
  const group = useGroupView();
  if (group) return <NeedsCompany what={docTitle(props.kind, props.framework)}>{null}</NeedsCompany>;
  return <DocumentVersionsInner {...props} />;
}

function DocumentVersionsInner({ kind, framework = null, writePerm }: { kind: DocKind; framework?: string | null; writePerm: "risks:write" | "controls:write" | "isms:write" }) {
  const can = useCan();
  const qc = useQueryClient();
  const key = ["documents", kind, framework ?? ""];
  const list = useQuery({ queryKey: key, queryFn: () => api.documents.list(kind, framework) });
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<DocumentVersionDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const ack = useMutation({ mutationFn: api.documents.acknowledge, onSuccess: refresh });
  const del = useMutation({ mutationFn: api.documents.remove, onSuccess: refresh });
  const rows = list.data ?? [];
  const title = docTitle(kind, framework);
  // jazyk výstupu (ADR-036) – zatím jen SoA; prázdné = jazyk uživatele
  const t = useT();
  const langs = useQuery({ queryKey: ["i18n", "list"], queryFn: api.i18n.list, enabled: kind === "soa" });
  const [lang, setLang] = useState("");

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title={t("doc.verzeDokumentu", { title: title })}
        subtitle={t("doc.schvaleneVerzeSeUchovavajiAlespon", { p: t.lbl(DOC_LABELS.legal[kind]), DOC_RETENTION_YEARS: DOC_RETENTION_YEARS })}
        action={
          <div className="flex shrink-0 gap-2">
            {kind === "soa" && (langs.data?.locales.length ?? 0) > 1 && (
              <select className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("doc.outputLang")} title={t("doc.outputLang")}>
                <option value="">{t("doc.outputLangMine")}</option>
                {langs.data!.locales.map((l) => (
                  <option key={l.locale} value={l.locale}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            )}
            <a href={api.documents.previewUrl(kind, framework, lang)} target="_blank" rel="noreferrer">
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs">
                <Eye size={14} /> {t("doc.nahled")}
              </Button>
            </a>
            <a href={api.documents.previewDocxUrl(kind, framework, lang)}>
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" title={t("doc.nahledAktualnihoStavuVeWordu")}>
                <FileDown size={14} /> {t("doc.word")}
              </Button>
            </a>
            {can(writePerm) && (
              <Button className="px-2.5 py-1.5 text-xs" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t("doc.novaVerze")}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox error={list.error ?? ack.error ?? del.error} />
      {rows.length === 0 ? (
        <EmptyState>{t("doc.zatimZadnaUlozenaVerzeVytvorte")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((d, i) => (
            <li key={d.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
              <div className="w-12 shrink-0 pt-0.5 font-semibold tabular-nums text-slate-700">v{d.version}</div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone[d.status]}>{t.lbl(DOC_LABELS.status[d.status])}</Badge>
                  <span className="font-medium">{d.title}</span>
                  <span className="text-xs text-slate-500">
                    {t("doc.vytvoreno")} {fmtDay(d.createdAt)}
                    {d.createdByName && ` · ${d.createdByName}`}
                  </span>
                </div>
                <Metrics kind={kind} cur={d.metrics} prev={rows[i + 1]?.metrics} />
                {d.approvedAt && (
                  <div className="text-xs text-slate-600">
                    {t("doc.schvalilA")} {d.approvedByName ?? "—"} {t("doc.dne")} {fmtDay(d.approvedAt)}
                    {d.approvalNote && ` – ${d.approvalNote}`} {t("doc.uchovatDo")} {fmtDay(d.retainUntil)}
                  </div>
                )}
                {d.status !== "draft" && (
                  <div className="text-xs text-slate-500" title={d.acknowledgements.map((a) => `${a.userName} (${fmtDay(a.at)})`).join("\n")}>
                    {t("doc.seznameno", { p: d.acknowledgements.length ? d.acknowledgements.map((a) => a.userName).join(", ") : "nikdo" })}
                  </div>
                )}
                {d.note && <div className="text-xs text-slate-500">{d.note}</div>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <a href={api.documents.htmlUrl(d.id, lang)} target="_blank" rel="noreferrer">
                  <Button variant="secondary" className="px-2 py-1 text-xs">
                    <FileText size={13} /> {t("doc.otevrit")}
                  </Button>
                </a>
                <a href={api.documents.docxUrl(d.id, lang)}>
                  <Button variant="secondary" className="px-2 py-1 text-xs">
                    <FileDown size={13} /> {t("doc.word")}
                  </Button>
                </a>
                {d.canApprove && (
                  <Button className="px-2 py-1 text-xs" onClick={() => setApproving(d)}>
                    <ShieldCheck size={13} /> {t("doc.schvalit")}
                  </Button>
                )}
                {d.status !== "draft" && !d.acknowledgedByMe && (
                  <Button variant="secondary" className="px-2 py-1 text-xs" disabled={ack.isPending} onClick={() => ack.mutate(d.id)}>
                    <CheckCheck size={13} /> {t("doc.seznamilAJsemSe")}
                  </Button>
                )}
                {d.canDelete && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs text-red-700"
                    onClick={async () => (await askConfirm(t("doc.smazatNavrhV", { version: d.version }))) && del.mutate(d.id)}
                    aria-label={t("doc.smazatNavrh")}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateModal kind={kind} framework={framework} onClose={() => setCreating(false)} onDone={refresh} />}
      {approving && <ApproveModal doc={approving} onClose={() => setApproving(null)} onDone={refresh} />}
    </Card>
  );
}

function CreateModal({ kind, framework, onClose, onDone }: { kind: DocKind; framework: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(docTitle(kind, framework));
  const [note, setNote] = useState("");
  const [periodFrom, setFrom] = useState("");
  const [periodTo, setTo] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      api.documents.create({
        kind,
        framework: (framework ?? undefined) as never,
        title,
        note: note || null,
        periodFrom: periodFrom || null,
        periodTo: periodTo || null,
        inputs: Object.fromEntries(Object.entries(inputs).filter(([, v]) => v.trim())),
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open
      wide={kind === "risk_report" || kind === "isms_review"}
      onClose={onClose}
      title={t("doc.novaVerze2", { p: docTitle(kind, framework) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !title.trim()} onClick={() => save.mutate()}>
            {t("doc.ulozitNavrh")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {t("doc.uloziSeNemennySnimekAktualniho")} <b>{t("doc.navrh")}</b>{t("doc.poKontroleHoSchvalujeOsoba")}
      </p>
      <Field label={t("doc.nazev")}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {kind === "isms_review" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("doc.hodnoceneObdobiOd")}>
              <Input type="date" value={periodFrom} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t("doc.do")}>
              <Input type="date" value={periodTo} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <p className="text-sm text-slate-600">
            {t("doc.udajeZEvidenceCilePlan")}
          </p>
          {ISMS_REVIEW_INPUTS.map((x) => (
            <Field key={x.key} label={`${x.point ? `${x.point}. ` : ""}${x.label}`}>
              <Textarea rows={2} value={inputs[x.key] ?? ""} onChange={(e) => setInputs({ ...inputs, [x.key]: e.target.value })} />
            </Field>
          ))}
        </>
      )}
      {kind === "risk_report" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("doc.hodnoceneObdobiOd")}>
              <Input type="date" value={periodFrom} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t("doc.do")}>
              <Input type="date" value={periodTo} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <div className="text-sm font-medium text-slate-700">{t("doc.zohledneneVstupy8Odst1")}</div>
          <p className="text-xs text-slate-500">{t("doc.vyznamneZmenyZEvidenceZmen")}</p>
          {RISK_REPORT_INPUTS.map((x, i) => (
            <Field key={x.key} label={`${i + 1}. ${x.label}`}>
              <Textarea rows={2} value={inputs[x.key] ?? ""} onChange={(e) => setInputs({ ...inputs, [x.key]: e.target.value })} />
            </Field>
          ))}
        </>
      )}
      <Field label={t("doc.note")} hint={t("doc.naprDuvodAktualizaceRocniPrezkum")}>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function ApproveModal({ doc, onClose, onDone }: { doc: DocumentVersionDto; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => api.documents.approve(doc.id, note),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("doc.schvalitV", { version: doc.version, title: doc.title })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <ShieldCheck size={14} /> {t("doc.schvalit")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {t("doc.schvalenimSeTatoVerzeStane")}
      </p>
      <Field label={t("doc.poznamkaKeSchvaleni")} hint={t("doc.naprCisloUsneseniNeboJednani")}>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
