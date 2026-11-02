/** Incident × SOC (ADR-056): podklady ze SOC, návrh doplnění záznamu (převezme se do formuláře, uloží člověk), záznam o zvládání. */
import { SeverityBadge } from "@/components/soc";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { SOC_ACTION_LABELS, SOC_IOC_LABELS, SOC_LABELS, type IncidentSocDraft } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileDown, FileText, Radar, Wand2 } from "lucide-react";
import { useState } from "react";

export type SocDraftPick = Partial<Pick<IncidentSocDraft, "occurredAt" | "indicators" | "evidence" | "containment" | "timeline" | "assets">>;

/** Tlačítka záznamu o zvládání incidentu (tisk / Word). */
export function IncidentRecordButtons({ incidentId }: { incidentId: string }) {
  const t = useT();
  return (
    <>
      <a href={api.incidents.recordUrl(incidentId, "html")} target="_blank" rel="noreferrer">
        <Button variant="secondary" title={t("incSoc.recordHint")}>
          <FileText size={15} /> {t("incSoc.record")}
        </Button>
      </a>
      <a href={api.incidents.recordUrl(incidentId, "docx")} download>
        <Button variant="secondary" aria-label={t("incSoc.recordWord")} title={t("incSoc.recordWord")}>
          <FileDown size={15} /> Word
        </Button>
      </a>
    </>
  );
}

export function IncidentSocCard({ incidentId, edit, onApply }: { incidentId: string; edit: boolean; onApply: (p: SocDraftPick) => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["incidents", "soc", incidentId], queryFn: () => api.incidents.soc(incidentId) });
  const [draft, setDraft] = useState<IncidentSocDraft | null>(null);
  const load = useMutation({ mutationFn: () => api.incidents.socDraft(incidentId), onSuccess: setDraft });
  const ev = q.data;
  if (!ev || (!ev.alerts.length && !ev.actions.length && !ev.cases.length)) return null;
  return (
    <Card className="mt-6 overflow-hidden" data-testid="incident-soc">
      <CardHeader
        title={t("incSoc.title")}
        subtitle={t("incSoc.subtitle", { a: ev.alerts.length, i: ev.iocs.length, x: ev.actions.length })}
        action={
          edit && (
            <Button variant="secondary" onClick={() => load.mutate()} disabled={load.isPending}>
              <Wand2 size={15} /> {t("incSoc.fill")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error ?? load.error} />
      <div className="grid gap-6 p-5 text-sm lg:grid-cols-3">
        <div>
          {ev.cases.length > 0 && (
            <>
              <div className="mb-1 text-xs font-medium text-slate-500">{t("incSoc.cases")}</div>
              <ul className="mb-3 space-y-1">
                {ev.cases.map((x) => (
                  <li key={x.id}>
                    <Link to="/soc/cases/$caseId" params={{ caseId: x.id }} className="font-medium text-brand-700 hover:underline">
                      {x.code} {x.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mb-1 text-xs font-medium text-slate-500">{t("incSoc.alerts")}</div>
          <ul className="space-y-1.5">
            {ev.alerts.map((a) => (
              <li key={a.id}>
                <Link to="/soc/$alertId" params={{ alertId: a.id }} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  <Radar size={13} /> {a.title}
                </Link>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <SeverityBadge s={a.severity} /> {t.lbl(SOC_LABELS.source[a.source] ?? a.source)} · {a.count}× · {fmtDate(a.firstSeen)}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">{t("incSoc.iocs")}</div>
          {ev.iocs.length ? (
            <ul className="space-y-0.5">
              {ev.iocs.map((i) => (
                <li key={i.id} className="text-xs">
                  <span className="text-slate-500">{t.lbl(SOC_IOC_LABELS.type[i.type])}:</span> <span className="break-all font-mono">{i.display}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">—</p>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">{t("incSoc.actions")}</div>
          {ev.actions.length ? (
            <ul className="space-y-1">
              {ev.actions.map((a) => (
                <li key={a.id} className="text-xs">
                  <Badge tone={a.status === "done" ? "green" : a.status === "failed" ? "red" : "slate"}>{t.lbl(SOC_ACTION_LABELS.status[a.status])}</Badge> {t.lbl(SOC_ACTION_LABELS.kind[a.kind])} <span className="font-mono">{a.target}</span>
                  {a.decidedByName && <div className="text-slate-500">{t("incSoc.approvedBy", { who: a.decidedByName })}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">—</p>
          )}
        </div>
      </div>
      {draft && <DraftModal draft={draft} onClose={() => setDraft(null)} onApply={(p) => (onApply(p), setDraft(null))} />}
    </Card>
  );
}

function DraftModal({ draft, onClose, onApply }: { draft: IncidentSocDraft; onClose: () => void; onApply: (p: SocDraftPick) => void }) {
  const t = useT();
  const parts = [
    { key: "evidence" as const, label: t("incSoc.pEvidence"), text: draft.evidence },
    { key: "indicators" as const, label: t("incSoc.pIndicators"), text: draft.indicators },
    { key: "containment" as const, label: t("incSoc.pContainment"), text: draft.containment },
  ].filter((p) => p.text);
  const [on, setOn] = useState<Record<string, boolean>>({ evidence: true, indicators: true, containment: true, timeline: true, occurredAt: true, assets: true });
  const empty = !parts.length && !draft.timeline.length && !draft.occurredAt && !draft.assets.length;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("incSoc.draftTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          {!empty && (
            <Button
              onClick={() =>
                onApply({
                  ...Object.fromEntries(parts.filter((p) => on[p.key]).map((p) => [p.key, p.text])),
                  ...(on.timeline && draft.timeline.length ? { timeline: draft.timeline } : {}),
                  ...(on.occurredAt && draft.occurredAt ? { occurredAt: draft.occurredAt } : {}),
                  ...(on.assets && draft.assets.length ? { assets: draft.assets } : {}),
                })
              }
            >
              {t("incSoc.apply")}
            </Button>
          )}
        </>
      }
    >
      {empty ? (
        <p className="text-sm text-slate-600">{t("incSoc.nothing")}</p>
      ) : (
        <div className="space-y-4" data-testid="incident-soc-draft">
          <p className="text-sm text-slate-600">{t("incSoc.draftHint")}</p>
          {parts.map((p) => (
            <div key={p.key}>
              <Checkbox checked={on[p.key]!} onChange={(x) => setOn({ ...on, [p.key]: x })} label={p.label} />
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-700">{p.text}</pre>
            </div>
          ))}
          {draft.timeline.length > 0 && (
            <div>
              <Checkbox checked={on.timeline!} onChange={(x) => setOn({ ...on, timeline: x })} label={t("incSoc.pTimeline", { n: draft.timeline.length })} />
              <ul className="mt-1 max-h-40 overflow-auto rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                {draft.timeline.map((e, i) => (
                  <li key={i}>
                    <span className="text-slate-500">{fmtDate(e.at)}</span> {e.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {draft.occurredAt && <Checkbox checked={on.occurredAt!} onChange={(x) => setOn({ ...on, occurredAt: x })} label={t("incSoc.pOccurred", { d: fmtDate(draft.occurredAt) })} />}
          {draft.assets.length > 0 && <Checkbox checked={on.assets!} onChange={(x) => setOn({ ...on, assets: x })} label={t("incSoc.pAssets", { list: draft.assets.map((a) => a.name).join(", ") })} />}
        </div>
      )}
    </Modal>
  );
}
