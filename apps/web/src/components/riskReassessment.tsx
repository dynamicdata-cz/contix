/** Podněty k přehodnocení rizika (ADR-058): incidenty, zjištění, změny, SOC, zranitelnosti… → návrh, rozhodnutí vlastníka, historie. */
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, ErrorBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { ASSURANCE_LABELS, AUDIT_LABELS, INCIDENT_LABELS, RISK_TRIGGER_LABELS, type RiskSuggestionChange, type RiskTrigger } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, History, Lightbulb, RefreshCcw } from "lucide-react";
import { useState } from "react";

function TriggerDetail({ x }: { x: RiskTrigger }) {
  const t = useT();
  if (x.kind === "incident") return <>{t.lbl(INCIDENT_LABELS.kind[x.detail as keyof typeof INCIDENT_LABELS.kind] ?? "")}</>;
  if (x.kind === "audit_finding") return <>{t.lbl(AUDIT_LABELS.severity[x.detail as keyof typeof AUDIT_LABELS.severity] ?? "")}</>;
  if (x.kind === "control_test") return <>{t.lbl(ASSURANCE_LABELS.result[x.detail as keyof typeof ASSURANCE_LABELS.result] ?? "")}</>;
  if (x.kind === "soc") return <>{t("risk.trg.soc", { n: x.count, what: x.detail === "exploit" ? t("risk.trg.soc.exploit") : x.detail === "escalated" ? t("risk.trg.soc.escalated") : t("risk.trg.soc.tp") })}</>;
  if (x.kind === "vuln") return <>{t("risk.trg.vuln", { n: x.count, cves: x.detail ?? "" })}</>;
  if (x.kind === "exception") return <>{t("risk.trg.exception", { date: x.detail ?? "" })}</>;
  if (x.kind === "supplier") return <>{t("risk.trg.supplier", { n: x.count })}</>;
  if (x.kind === "control_monitor") return <>{x.detail ?? ""}</>;
  if (x.kind === "scenario") return <>{t("risk.trg.scenario", { score: x.detail ?? "" })}</>;
  return null;
}

export function TriggerList({ items }: { items: RiskTrigger[] }) {
  const t = useT();
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((x, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-5 py-2 text-sm">
          <span className="w-24 shrink-0 text-xs text-slate-500">{fmtDate(x.at)}</span>
          <Badge tone={x.strong ? "red" : "amber"}>{t.lbl(RISK_TRIGGER_LABELS.kind[x.kind])}</Badge>
          {x.title && (x.link ? <Link to={x.link as never} className="font-medium text-brand-700 hover:underline">{x.title}</Link> : <span className="font-medium">{x.title}</span>)}
          <span className="text-xs text-slate-600">
            <TriggerDetail x={x} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Karta na detailu rizika. `onApply` vloží navržené hodnoty do formuláře (neukládá); `note` je zdůvodnění,
 * které se při uložení změny hodnocení zapíše do historie, nebo se použije pro potvrzení beze změny.
 */
export function RiskReassessmentCard({ riskId, canEdit, note, onNote, onApply }: { riskId: string; canEdit: boolean; note: string; onNote: (v: string) => void; onApply: (c: RiskSuggestionChange[]) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["risk", riskId, "reassessment"], queryFn: () => api.risks.reassessment(riskId) });
  const [history, setHistory] = useState(false);
  const confirm = useMutation({
    mutationFn: () => api.risks.review(riskId, note.trim()),
    onSuccess: (r) => {
      qc.setQueryData(["risk", riskId], r);
      qc.invalidateQueries({ queryKey: ["risk", riskId, "reassessment"] });
      qc.invalidateQueries({ queryKey: ["risks"] });
      onNote("");
    },
  });
  const d = q.data;
  if (!d || (!d.triggers.length && !d.reviews.length)) return q.error ? <ErrorBox error={q.error} /> : null;
  const overdue = d.due && d.due < new Date().toISOString().slice(0, 10);
  return (
    <Card className="overflow-hidden lg:col-span-2" data-testid="risk-reassessment">
      <CardHeader
        title={t("risk.trg.title")}
        subtitle={d.triggers.length ? t("risk.trg.subtitle", { since: d.baseline ? fmtDate(d.baseline) : "—", due: d.due ? fmtDate(d.due) : "—" }) : t("risk.trg.none", { since: d.baseline ? fmtDate(d.baseline) : "—" })}
        action={
          <div className="flex items-center gap-2">
            {d.triggers.length > 0 && (
              <Badge tone={overdue ? "red" : "amber"}>
                <RefreshCcw size={12} className="mr-1 inline" />
                {d.triggers.length}
              </Badge>
            )}
            {d.reviews.length > 0 && (
              <Button variant="secondary" onClick={() => setHistory(!history)}>
                <History size={15} /> {t("risk.trg.history", { n: d.reviews.length })}
              </Button>
            )}
          </div>
        }
      />
      {d.triggers.length > 0 && (
        <>
          <TriggerList items={d.triggers} />
          {d.suggestion.length > 0 && (
            <div className="mx-5 my-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <Lightbulb size={14} /> {t("risk.trg.suggest")}{" "}
                  {d.suggestion.map((s) => `${t.lbl(RISK_TRIGGER_LABELS.field[s.field])} ${s.from} → ${s.to}`).join(", ")}
                </span>
                {canEdit && (
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onApply(d.suggestion)}>
                    {t("rsk.pouzitNavrh")}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-blue-800">{t("risk.trg.suggestHint")}</p>
            </div>
          )}
          {canEdit && (
            <div className="space-y-2 border-t border-slate-100 px-5 py-3">
              <Textarea rows={2} value={note} onChange={(e) => onNote(e.target.value)} placeholder={t("risk.trg.notePh")} aria-label={t("risk.trg.note")} />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" disabled={note.trim().length < 5 || confirm.isPending} onClick={() => confirm.mutate()}>
                  <CheckCircle2 size={15} /> {t("risk.trg.confirm")}
                </Button>
                <span className="text-xs text-slate-500">{t("risk.trg.changeHint")}</span>
              </div>
              <ErrorBox error={confirm.error} />
            </div>
          )}
        </>
      )}
      {history && (
        <div className="border-t border-slate-100">
          {d.reviews.map((r) => (
            <div key={r.id} className="border-b border-slate-100 px-5 py-2.5 text-sm last:border-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-slate-500">{fmtDate(r.createdAt)}</span>
                <Badge tone={r.decision === "changed" ? "blue" : "green"}>{t.lbl(RISK_TRIGGER_LABELS.decision[r.decision])}</Badge>
                {r.decision === "changed" && (
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <RiskLevelBadge level={r.levelBefore} score={r.scoreBefore} /> → <RiskLevelBadge level={r.levelAfter} score={r.scoreAfter} />
                  </span>
                )}
                <span className="text-xs text-slate-600">{r.userName ?? "—"}</span>
                {r.triggers.length > 0 && <span className="text-xs text-slate-500">{t("risk.trg.basedOn", { kinds: [...new Set(r.triggers.map((x) => t.lbl(RISK_TRIGGER_LABELS.kind[x.kind])))].join(", ") })}</span>}
              </div>
              {r.note && <div className="mt-1 whitespace-pre-wrap text-slate-700">{r.note}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
