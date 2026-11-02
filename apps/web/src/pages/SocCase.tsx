/** Případ SOC (v0.52, ADR-047): související alerty, řetězec útoku, lhůty, triáž, poznámky, uzavření a eskalace. */
import { ExposureBadge, LinkedRisksCard, MitreBadges, SeverityBadge, SlaBadge, SocStatusBadge, useTacticName } from "@/components/soc";
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { SOC_LABELS, SOC_VERDICTS, type SocCaseDetailDto, type SocVerdict } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Siren, TriangleAlert, UserCheck, X } from "lucide-react";
import { useState } from "react";

export function SocCasePage() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const tactic = useTacticName();
  const { caseId } = useParams({ strict: false }) as { caseId: string };
  const q = useQuery({ queryKey: ["soc", "case", caseId], queryFn: () => api.soc.case(caseId) });
  const analysts = useQuery({ queryKey: ["soc", "analysts"], queryFn: api.soc.analysts, enabled: !!q.data?.canWrite, staleTime: 5 * 60_000 });
  const done = (r: SocCaseDetailDto) => {
    qc.setQueryData(["soc", "case", caseId], r);
    qc.invalidateQueries({ queryKey: ["soc", "cases"] });
    qc.invalidateQueries({ queryKey: ["soc", "alerts"] });
    qc.invalidateQueries({ queryKey: ["soc", "summary"] });
  };
  const update = useMutation({ mutationFn: (d: Parameters<typeof api.soc.updateCase>[1]) => api.soc.updateCase(caseId, d), onSuccess: done });
  const remove = useMutation({ mutationFn: (alertId: string) => api.soc.caseAlerts(caseId, { remove: [alertId] }), onSuccess: done });
  const reopen = useMutation({ mutationFn: () => api.soc.reopenCase(caseId), onSuccess: done });
  const [note, setNote] = useState("");
  const addNote = useMutation({ mutationFn: () => api.soc.caseNote(caseId, note.trim()), onSuccess: (r) => (setNote(""), done(r)) });
  const [closing, setClosing] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const c = q.data;
  if (!c) return <ErrorBox error={q.error} />;
  const open = c.status === "open" || c.status === "in_progress";
  const w = c.canWrite;

  return (
    <>
      <Link to="/soc" search={{ tab: "cases" } as never} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft size={14} /> {t("soc.backCases")}
      </Link>
      <PageHeader
        title={`${c.code} ${c.title}`}
        subtitle={`${c.auto ? t("soc.caseAuto") : t("soc.caseManual")} · ${fmtDate(c.createdAt)}`}
        actions={
          w && (
            <>
              {open && c.assigneeId !== me.user.id && (
                <Button variant="secondary" onClick={() => update.mutate({ assigneeId: me.user.id })} disabled={update.isPending}>
                  <UserCheck size={15} /> {t("soc.takeOver")}
                </Button>
              )}
              {open && (
                <Button variant="secondary" onClick={() => setClosing(true)}>
                  {t("soc.caseClose")}
                </Button>
              )}
              {open && c.canEscalate && c.openAlerts > 0 && (
                <Button onClick={() => setEscalating(true)}>
                  <Siren size={15} /> {t("soc.escalate")}
                </Button>
              )}
              {c.status === "closed" && (
                <Button variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                  {t("soc.reopen")}
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorBox error={update.error ?? reopen.error ?? remove.error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SeverityBadge s={c.severity} />
        <Badge tone={c.status === "escalated" ? "red" : c.status === "closed" ? "slate" : c.status === "in_progress" ? "blue" : "violet"}>{t.lbl(SOC_LABELS.caseStatus[c.status])}</Badge>
        {c.verdict && <Badge tone="slate">{t.lbl(SOC_LABELS.verdict[c.verdict])}</Badge>}
        {c.incidentId && (
          <Link to="/incidents/$incidentId" params={{ incidentId: c.incidentId }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            <Siren size={14} /> {c.incidentTitle ?? t("soc.incident")}
          </Link>
        )}
      </div>
      {c.chain && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="note">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">{t.lbl(SOC_LABELS.chain[c.chain])}</div>
            <div className="text-xs">{t("soc.chainBump", { base: t.lbl(SOC_LABELS.severity[c.baseSeverity]), now: t.lbl(SOC_LABELS.severity[c.severity]) })}</div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader title={t("soc.case.alertsTitle", { n: c.alertCount })} subtitle={c.mitreTactics.length ? c.mitreTactics.map(tactic).join(" → ") : t("soc.mitre.none")} />
            <ul className="divide-y divide-slate-100 text-sm">
              {c.alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="w-24 shrink-0 space-y-1">
                    <SeverityBadge s={a.severity} />
                    <ExposureBadge e={a.exposure} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link to="/soc/$alertId" params={{ alertId: a.id }} className="font-medium hover:text-brand-700">
                      {a.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {fmtDate(a.firstSeen)}
                      {a.agentName && ` · ${a.agentName}`}
                      {a.sample?.srcip ? ` · IP ${String(a.sample.srcip)}` : ""}
                      {a.count > 1 && ` · ${a.count}×`}
                    </div>
                    <MitreBadges ids={a.mitreIds} className="mt-1" />
                  </div>
                  <div className="shrink-0 text-right">
                    <SocStatusBadge s={a.status} />
                    {w && open && (
                      <button type="button" className="mt-1 flex items-center gap-0.5 text-xs text-slate-500 hover:text-red-700" onClick={() => remove.mutate(a.id)} aria-label={t("soc.case.remove", { title: a.title })}>
                        <X size={12} /> {t("soc.case.removeShort")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          {c.description && (
            <Card className="p-4 text-sm">
              <div className="mb-1 text-xs text-slate-500">{t("soc.f.description")}</div>
              <div className="whitespace-pre-wrap">{c.description}</div>
            </Card>
          )}
          <Card className="overflow-hidden">
            <CardHeader title={t("soc.notes.title")} subtitle={t("soc.notes.subtitle")} />
            <ul className="divide-y divide-slate-100 text-sm">
              {[...c.notes].reverse().map((n, i) => (
                <li key={i} className="px-4 py-2.5">
                  <div className="text-xs text-slate-500">
                    {fmtDate(n.at)} · {n.userName ?? "—"}
                  </div>
                  <div className="whitespace-pre-wrap">{n.text}</div>
                </li>
              ))}
              {!c.notes.length && <li className="px-4 py-3 text-slate-500">{t("soc.notes.none")}</li>}
            </ul>
            {w && (
              <form
                className="space-y-2 border-t border-slate-100 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (note.trim()) addNote.mutate();
                }}
              >
                <Textarea rows={2} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} aria-label={t("soc.notes.add")} placeholder={t("soc.notes.placeholder")} />
                <ErrorBox error={addNote.error} />
                <Button type="submit" variant="secondary" disabled={!note.trim() || addNote.isPending}>
                  {t("soc.notes.add")}
                </Button>
              </form>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title={t("soc.triage.title")} />
            <div className="space-y-3 p-4 text-sm">
              <Field label={t("soc.col.analyst")}>
                {w && open ? (
                  <Select value={c.assigneeId ?? ""} onChange={(e) => update.mutate({ assigneeId: e.target.value || null })} aria-label={t("soc.col.analyst")}>
                    <option value="">{t("soc.unassigned")}</option>
                    {(analysts.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                    {c.assigneeId && !analysts.data?.some((u) => u.id === c.assigneeId) && <option value={c.assigneeId}>{c.assigneeName}</option>}
                  </Select>
                ) : (
                  <div>{c.assigneeName ?? "—"}</div>
                )}
              </Field>
              <div>
                <div className="mb-1 text-xs text-slate-500">{t("soc.col.sla")}</div>
                <SlaBadge sla={c.sla} acknowledged={!!c.acknowledgedAt} />
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    {t("soc.sla.ackDue")}
                    <div className="text-slate-900">{fmtDate(c.sla.ackDue)}</div>
                  </div>
                  <div>
                    {t("soc.sla.resolveDue")}
                    <div className="text-slate-900">{fmtDate(c.sla.resolveDue)}</div>
                  </div>
                </div>
              </div>
              {(c.hosts.length > 0 || c.srcips.length > 0) && (
                <div className="text-xs text-slate-600">
                  {c.hosts.length > 0 && (
                    <div>
                      {t("soc.detail.host")}: <span className="text-slate-900">{c.hosts.join(", ")}</span>
                    </div>
                  )}
                  {c.srcips.length > 0 && (
                    <div>
                      {t("soc.detail.srcip")}: <span className="text-slate-900">{c.srcips.join(", ")}</span>
                    </div>
                  )}
                </div>
              )}
              {c.closeReason && (
                <div className="text-xs text-slate-600">
                  {t("soc.detail.reason")}: <span className="text-slate-900">{c.closeReason}</span>
                </div>
              )}
            </div>
          </Card>
          <LinkedRisksCard risks={c.risks} />
          <Card className="overflow-hidden">
            <CardHeader title={t("soc.mitre.title")} />
            <div className="p-4">
              <MitreBadges ids={c.mitreIds} />
            </div>
          </Card>
        </div>
      </div>
      {closing && <CloseCaseModal c={c} onClose={() => setClosing(false)} onDone={(r) => (done(r), setClosing(false))} />}
      {escalating && <EscalateCaseModal c={c} onClose={() => setEscalating(false)} onDone={(r) => (done(r), setEscalating(false))} />}
    </>
  );
}

function CloseCaseModal({ c, onClose, onDone }: { c: SocCaseDetailDto; onClose: () => void; onDone: (r: SocCaseDetailDto) => void }) {
  const t = useT();
  const [verdict, setVerdict] = useState<SocVerdict>("false_positive");
  const [reason, setReason] = useState("");
  const m = useMutation({ mutationFn: () => api.soc.closeCase(c.id, verdict, reason.trim()), onSuccess: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc.caseClose")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={!reason.trim() || m.isPending}>
            {t("soc.caseClose")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("soc.caseCloseHint", { n: c.openAlerts })}</p>
      <Field label={t("soc.verdict")}>
        <Select value={verdict} onChange={(e) => setVerdict(e.target.value as SocVerdict)}>
          {SOC_VERDICTS.map((v) => (
            <option key={v} value={v}>
              {t.lbl(SOC_LABELS.verdict[v])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("soc.detail.reason")}>
        <Textarea rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {verdict === "true_positive" && <p className="text-sm text-amber-800">{t("soc.closeTpHint")}</p>}
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function EscalateCaseModal({ c, onClose, onDone }: { c: SocCaseDetailDto; onClose: () => void; onDone: (r: SocCaseDetailDto) => void }) {
  const t = useT();
  const [title, setTitle] = useState(`${c.code} ${c.title}`);
  const [kind, setKind] = useState<"unassessed" | "event" | "incident">("unassessed");
  const m = useMutation({ mutationFn: () => api.soc.escalateCase(c.id, { title: title.trim() || undefined, kind }), onSuccess: (r) => onDone(r.case) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc.escalate")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            <Siren size={15} /> {t("soc.escalateConfirm")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("soc.caseEscalateHint", { n: c.openAlerts })}</p>
      <Field label={t("soc.f.title")}>
        <Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("soc.escalateKind")}>
        <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="unassessed">{t("soc.kind.unassessed")}</option>
          <option value="event">{t("soc.kind.event")}</option>
          <option value="incident">{t("soc.kind.incident")}</option>
        </Select>
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}
