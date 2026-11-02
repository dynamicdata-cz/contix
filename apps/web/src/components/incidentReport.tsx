/** Hlášení incidentu NÚKIB / ÚOOÚ (ADR-067): předvyplněné hlášení, kontrola úplnosti, text k vložení do Portálu Úřadu. */
import { Badge, Button, ErrorBox, Field, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { INCIDENT_LABELS, REPORT_TYPES, type ReportType } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Download, FileText, Send } from "lucide-react";
import { useState } from "react";

export function IncidentReportWizard({ incidentId, initialType, canRecord, onClose, onRecord }: { incidentId: string; initialType: ReportType; canRecord: boolean; onClose: () => void; onRecord: (type: ReportType, text: string) => void }) {
  const t = useT();
  const [type, setType] = useState<ReportType>(initialType);
  const [copied, setCopied] = useState(false);
  const q = useQuery({ queryKey: ["incidents", incidentId, "report", type], queryFn: () => api.incidents.report(incidentId, type) });
  const r = q.data;
  const srcLabel = { organization: t("rep.src.organization"), incident: t("rep.src.incident"), soc: t("rep.src.soc") };
  const copy = async () => {
    if (!r) return;
    await navigator.clipboard?.writeText(r.text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("rep.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {r && canRecord && (
            <Button onClick={() => onRecord(type, r.text)}>
              <Send size={14} /> {t("rep.record")}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("rep.intro")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("rep.type")} className="w-72">
          <Select value={type} onChange={(e) => setType(e.target.value as ReportType)} aria-label={t("rep.type")}>
            {REPORT_TYPES.map((x) => (
              <option key={x} value={x}>
                {t.lbl(INCIDENT_LABELS.reportType[x])}
              </option>
            ))}
          </Select>
        </Field>
        {r && (
          <div className="flex flex-wrap gap-2 pb-0.5">
            <Button variant="secondary" onClick={copy}>
              <Copy size={14} /> {copied ? t("rep.copied") : t("rep.copy")}
            </Button>
            <a href={api.incidents.reportTxtUrl(incidentId, type)}>
              <Button variant="secondary">
                <Download size={14} /> {t("rep.txt")}
              </Button>
            </a>
            <a href={api.incidents.reportUrl(incidentId, type)} target="_blank" rel="noreferrer">
              <Button variant="secondary">
                <FileText size={14} /> {t("rep.print")}
              </Button>
            </a>
          </div>
        )}
      </div>
      <ErrorBox error={q.error} />
      {r && (
        <>
          <div className="text-sm text-slate-600">
            {t("rep.recipient")}: <span className="font-medium text-slate-800" data-testid="report-recipient">{r.recipientName || t.lbl(INCIDENT_LABELS.recipient[r.recipient])}</span>
            {r.due && (
              <>
                {" · "}
                {t("rep.due")}: <span className="font-medium text-slate-800">{fmtDate(r.due)}</span>
              </>
            )}
          </div>
          {r.missing.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="report-missing">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-amber-800">
                <AlertTriangle size={14} /> {t("rep.missing", { n: r.missing.length })}
              </div>
              <ul className="ml-5 list-disc text-amber-900">
                {r.missing.map((m) => (
                  <li key={m.key}>
                    {m.label} <span className="text-xs text-amber-700">({srcLabel[m.source]})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="report-complete">
              <CheckCircle2 size={14} /> {t("rep.complete")}
            </div>
          )}
          <div className="max-h-[50vh] space-y-4 overflow-y-auto">
            {r.sections.map((s) => (
              <section key={s.key}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</h3>
                <dl className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
                  {s.fields.map((f) => (
                    <div key={f.key} className="grid gap-1 px-3 py-1.5 sm:grid-cols-[14rem_1fr]">
                      <dt className="text-slate-500">
                        {f.label}
                        {f.required && <span className="text-red-600"> *</span>}
                      </dt>
                      <dd className="whitespace-pre-wrap">{f.value || (f.required ? <Badge tone="amber">{t("rep.empty")}</Badge> : <span className="text-slate-400">—</span>)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
