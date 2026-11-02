/** Detail alertu SOC (ADR-046): triáž, ATT&CK, playbook, poznámky, AI rozbor, eskalace na incident. */
import { AlertPlaybookCard } from "@/components/socPlaybooks";
import { AiTriageBadge, MitreBadges, SeverityBadge, SlaBadge, SocAdvisorCard, SocStatusBadge, usePlaybookText, useTacticName, ExposureBanner, IntelBanner, LinkedRisksCard } from "@/components/soc";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { hostKeyOf, ATTACK_ID_RE, isPrivateIp, SOC_LABELS, SOC_SUPPRESSIBLE_SOURCES, type SocAiTriage, SOC_VERDICTS, type SocAlertDetailDto, type SocVerdict } from "@contix/shared";
import { AlertIocCard } from "@/components/socIoc";
import { AlertEnrichmentsCard } from "@/components/socEnrich";
import { AlertActionsCard } from "@/components/socResponse";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, CheckSquare, Link2, Loader2, Siren, Sparkles, Square, UserCheck } from "lucide-react";
import { useState } from "react";

export function SocAlertPage() {
  const t = useT();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const { alertId } = useParams({ strict: false }) as { alertId: string };
  const q = useQuery({ queryKey: ["soc", "alert", alertId], queryFn: () => api.soc.alert(alertId) });
  const analysts = useQuery({ queryKey: ["soc", "analysts"], queryFn: api.soc.analysts, enabled: !!q.data?.canWrite, staleTime: 5 * 60_000 });
  const done = (r: SocAlertDetailDto) => {
    qc.setQueryData(["soc", "alert", alertId], r);
    qc.invalidateQueries({ queryKey: ["soc", "alerts"] });
    qc.invalidateQueries({ queryKey: ["soc", "summary"] });
  };
  const update = useMutation({ mutationFn: (d: Parameters<typeof api.soc.update>[1]) => api.soc.update(alertId, d), onSuccess: done });
  const advise = useMutation({ mutationFn: () => api.soc.advise(alertId), onSuccess: done });
  const reopen = useMutation({ mutationFn: () => api.soc.reopen(alertId), onSuccess: done });
  const [closing, setClosing] = useState<false | { verdict?: SocVerdict; reason?: string }>(false);
  const [escalating, setEscalating] = useState(false);
  const a = q.data;
  if (!a) return <ErrorBox error={q.error} />;
  const open = a.status === "new" || a.status === "in_progress";
  const w = a.canWrite;

  return (
    <>
      <Link to="/soc" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700">
        <ArrowLeft size={14} /> {t("soc.back")}
      </Link>
      <PageHeader
        title={a.title}
        subtitle={`${t.lbl(SOC_LABELS.source[a.source] ?? a.source)}${a.source !== "manual" ? ` · ${t("soc.rule", { id: a.ruleId, level: a.ruleLevel })}` : ""} · ${fmtDate(a.firstSeen)}`}
        actions={
          w && (
            <>
              {open && a.assigneeId !== me.user.id && (
                <Button variant="secondary" onClick={() => update.mutate({ assigneeId: me.user.id })} disabled={update.isPending}>
                  <UserCheck size={15} /> {t("soc.takeOver")}
                </Button>
              )}
              {open && (
                <Button variant="secondary" onClick={() => setClosing({})}>
                  {t("soc.close")}
                </Button>
              )}
              {open && a.canEscalate && (
                <Button onClick={() => setEscalating(true)}>
                  <Siren size={15} /> {t("soc.escalate")}
                </Button>
              )}
              {a.status === "dismissed" && (
                <Button variant="secondary" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                  {t("soc.reopen")}
                </Button>
              )}
            </>
          )
        }
      />
      <ErrorBox error={update.error ?? reopen.error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SeverityBadge s={a.severity} />
        <SocStatusBadge s={a.status} />
        {a.verdict && <Badge tone="slate">{t.lbl(SOC_LABELS.verdict[a.verdict])}</Badge>}
        {a.incidentId && (
          <Link to="/incidents/$incidentId" params={{ incidentId: a.incidentId }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            <Siren size={14} /> {a.incidentTitle ?? t("soc.incident")}
          </Link>
        )}
        {a.caseId && (
          <Link to="/soc/cases/$caseId" params={{ caseId: a.caseId }} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            <Link2 size={14} /> {t("soc.inCase", { code: a.caseCode ?? "" })}
          </Link>
        )}
      </div>
      <ExposureBanner e={a.exposure} />
      <IntelBanner m={a.intel} />
      {can("ai:use") && (a.aiTriage || open) && (
        <AiTriageCard
          a={a}
          canApply={w && open}
          onApply={(tr) => (tr.action === "escalate" && a.canEscalate ? setEscalating(true) : tr.action === "close" ? setClosing({ verdict: tr.verdict!, reason: t("soc.aiTriage.reasonPrefill", { r: tr.reasoning }) }) : undefined)}
          onDone={done}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardHeader title={t("soc.detail.title")} />
            <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
              {a.description && a.description !== a.title && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">{t("soc.f.description")}</dt>
                  <dd className="whitespace-pre-wrap">{a.description}</dd>
                </div>
              )}
              <Item label={t("soc.detail.occurrences")} value={`${a.count}× · ${fmtDate(a.firstSeen)} – ${fmtDate(a.lastSeen)}`} />
              <div>
                <dt className="text-xs text-slate-500">{t("soc.detail.host")}</dt>
                <dd>
                  {hostKeyOf(a) ? (
                    <Link to="/soc/hosts/$hostKey" params={{ hostKey: hostKeyOf(a)! }} className="text-brand-700 hover:underline" title={t("soc.host.open")}>
                      {a.agentName ?? a.assetName ?? "—"}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">{t("soc.detail.asset")}</dt>
                <dd>{a.assetId ? <Link to="/assets/$assetId" params={{ assetId: a.assetId }} className="text-brand-700 hover:underline">{a.assetName}</Link> : "—"}</dd>
              </div>
              {a.sample?.srcip ? <Item label={t("soc.detail.srcip")} value={String(a.sample.srcip)} /> : null}
              {a.groups.length > 0 && <Item label={t("soc.detail.groups")} value={a.groups.join(", ")} />}
              <Item
                label={t("soc.detail.history")}
                value={
                  a.history.total
                    ? `${t("soc.detail.historyN", { n: a.history.total, e: a.history.escalated })}${Object.entries(a.history.byVerdict)
                        .map(([v, n]) => ` · ${t.lbl(SOC_LABELS.verdict[v as SocVerdict])}: ${n}`)
                        .join("")}`
                    : t("soc.detail.historyNone")
                }
              />
              {a.dismissReason && <Item label={t("soc.detail.reason")} value={a.dismissReason} />}
            </dl>
          </Card>
          {a.source === "phishing" && <PhishingCard a={a} />}
          <MitreCard a={a} onSave={(ids) => update.mutate({ mitreIds: ids })} saving={update.isPending} />
          <AlertPlaybookCard a={a} onChange={(d) => update.mutate(d)} onUpdated={done} />
          <NotesCard a={a} onSaved={done} />
        </div>
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader title={t("soc.triage.title")} />
            <div className="space-y-3 p-4 text-sm">
              <Field label={t("soc.col.analyst")}>
                {w && open ? (
                  <Select value={a.assigneeId ?? ""} onChange={(e) => update.mutate({ assigneeId: e.target.value || null })} aria-label={t("soc.col.analyst")}>
                    <option value="">{t("soc.unassigned")}</option>
                    {(analysts.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName}
                      </option>
                    ))}
                    {a.assigneeId && !analysts.data?.some((u) => u.id === a.assigneeId) && <option value={a.assigneeId}>{a.assigneeName}</option>}
                  </Select>
                ) : (
                  <div>{a.assigneeName ?? "—"}</div>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                <div>
                  {t("soc.triage.acknowledged")}
                  <div className="text-slate-900">{a.acknowledgedAt ? fmtDate(a.acknowledgedAt) : "—"}</div>
                </div>
                <div>
                  {t("soc.triage.decided")}
                  <div className="text-slate-900">{a.decidedAt ? fmtDate(a.decidedAt) : "—"}</div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">{t("soc.col.sla")}</div>
                {a.caseId ? <span className="text-xs text-slate-500">{t("soc.sla.byCase")}</span> : <SlaBadge sla={a.sla} acknowledged={!!a.acknowledgedAt} />}
              </div>
            </div>
          </Card>
          {can("ai:use") && (
            <Card className="overflow-hidden">
              <CardHeader
                title={t("soc.ai.title")}
                subtitle={t("soc.ai.subtitle")}
                action={
                  w && (
                    <Button variant="secondary" onClick={() => advise.mutate()} disabled={advise.isPending}>
                      {advise.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {a.aiAdvice ? t("soc.ai.again") : t("soc.ai.run")}
                    </Button>
                  )
                }
              />
              <div className="p-4">
                <ErrorBox error={advise.error} />
                {advise.isPending && <p className="text-xs text-slate-500">{t("ai.modelPripravujeOdpovedLokalniModel")}</p>}
                {a.aiAdvice ? (
                  <div className="rounded-md border border-violet-200 bg-violet-50/60 px-3 py-2.5 text-sm leading-relaxed text-slate-800" data-testid="soc-ai-advice">
                    <div className="whitespace-pre-wrap">{a.aiAdvice.text}</div>
                    <p className="mt-2 text-xs text-slate-500">
                      {a.aiAdvice.model} · {fmtDate(a.aiAdvice.at)} · {t("soc.advisor.disclaimer")}
                    </p>
                  </div>
                ) : (
                  !advise.isPending && <p className="text-sm text-slate-500">{t("soc.ai.none")}</p>
                )}
              </div>
            </Card>
          )}
          <AlertActionsCard alertId={a.id} ip={typeof a.sample?.srcip === "string" && !isPrivateIp(a.sample.srcip) ? a.sample.srcip : null} agentId={a.source === "wazuh" ? a.agentId : null} canWrite={w} />
          <AlertIocCard alertId={a.id} canWrite={w} />
          <AlertEnrichmentsCard alertId={a.id} />
          <LinkedRisksCard risks={a.risks} />
          {a.assetVulns.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title={t("soc.vulns.title")} subtitle={t("soc.vulns.subtitle")} />
              <ul className="divide-y divide-slate-100 text-sm">
                {a.assetVulns.map((v) => (
                  <li key={v.cveId} className="flex items-center justify-between px-4 py-2">
                    <span className="font-mono text-xs">{v.cveId}</span>
                    <span className="text-xs text-slate-500">
                      {v.severity}
                      {v.cvss != null && ` · CVSS ${v.cvss}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {can("ai:use") && <SocAdvisorCard alertId={a.id} />}
        </div>
      </div>
      {closing && <CloseModal a={a} init={closing} onClose={() => setClosing(false)} onDone={(r) => (done(r), setClosing(false))} />}
      {escalating && <EscalateModal a={a} onClose={() => setEscalating(false)} onDone={(r) => (done(r), setEscalating(false))} />}
    </>
  );
}

const Item = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd>{value}</dd>
  </div>
);

function MitreCard({ a, onSave, saving }: { a: SocAlertDetailDto; onSave: (ids: string[]) => void; saving: boolean }) {
  const t = useT();
  const tactic = useTacticName();
  const [edit, setEdit] = useState<string | null>(null);
  const ids = (edit ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  const bad = ids.filter((x) => !ATTACK_ID_RE.test(x));
  const open = a.status === "new" || a.status === "in_progress";
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t("soc.mitre.title")}
        subtitle={a.mitreTactics.length ? a.mitreTactics.map(tactic).join(" → ") : t("soc.mitre.none")}
        action={
          a.canWrite &&
          open &&
          edit === null && (
            <Button variant="ghost" onClick={() => setEdit(a.mitreIds.join(", "))}>
              {t("soc.edit")}
            </Button>
          )
        }
      />
      <div className="p-4">
        {edit === null ? (
          <MitreBadges ids={a.mitreIds} />
        ) : (
          <div className="space-y-2">
            <Input value={edit} onChange={(e) => setEdit(e.target.value)} aria-label={t("soc.f.mitre")} placeholder="T1110, T1078" />
            {bad.length > 0 && <p className="text-sm text-red-700">{t("soc.f.mitreBad", { ids: bad.join(", ") })}</p>}
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  onSave(ids);
                  setEdit(null);
                }}
                disabled={bad.length > 0 || saving}
              >
                {t("soc.save")}
              </Button>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t("common.cancelAction")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function NotesCard({ a, onSaved }: { a: SocAlertDetailDto; onSaved: (r: SocAlertDetailDto) => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => api.soc.note(a.id, text.trim()),
    onSuccess: (r) => {
      setText("");
      onSaved(r);
    },
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("soc.notes.title")} subtitle={t("soc.notes.subtitle")} />
      <ul className="divide-y divide-slate-100 text-sm">
        {[...a.notes].reverse().map((n, i) => (
          <li key={i} className="px-4 py-2.5">
            <div className="text-xs text-slate-500">
              {fmtDate(n.at)} · {n.userName ?? "—"}
            </div>
            <div className="whitespace-pre-wrap">{n.text}</div>
          </li>
        ))}
        {!a.notes.length && <li className="px-4 py-3 text-slate-500">{t("soc.notes.none")}</li>}
      </ul>
      {a.canWrite && (
        <form
          className="space-y-2 border-t border-slate-100 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate();
          }}
        >
          <Textarea rows={2} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} aria-label={t("soc.notes.add")} placeholder={t("soc.notes.placeholder")} />
          <ErrorBox error={add.error} />
          <Button type="submit" variant="secondary" disabled={!text.trim() || add.isPending}>
            {t("soc.notes.add")}
          </Button>
        </form>
      )}
    </Card>
  );
}

function CloseModal({ a, init, onClose, onDone }: { a: SocAlertDetailDto; init: { verdict?: SocVerdict; reason?: string }; onClose: () => void; onDone: (r: SocAlertDetailDto) => void }) {
  const t = useT();
  const [verdict, setVerdict] = useState<SocVerdict>(init.verdict ?? "false_positive");
  const [reason, setReason] = useState(init.reason ?? "");
  const plus = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const [suppress, setSuppress] = useState(false);
  const [until, setUntil] = useState(plus(30));
  const [byIp, setByIp] = useState(false);
  const canSuppress = SOC_SUPPRESSIBLE_SOURCES.includes(a.source) && (verdict === "false_positive" || verdict === "benign");
  const m = useMutation({ mutationFn: () => api.soc.close(a.id, verdict, reason.trim(), canSuppress && suppress ? { until, ip: byIp } : undefined), onSuccess: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={!reason.trim() || m.isPending}>
            {t("soc.close")}
          </Button>
        </>
      }
    >
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
      {canSuppress && (
        <div className="space-y-2 rounded-md border border-slate-200 p-3">
          <Checkbox checked={suppress} onChange={setSuppress} label={t("soc.sup.onClose")} hint={t("soc.sup.onCloseHint", { rule: a.ruleId, host: a.agentName ?? "—" })} />
          {suppress && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("soc.sup.until")}>
                <Input type="date" value={until} min={plus(0)} max={plus(366)} onChange={(e) => setUntil(e.target.value)} />
              </Field>
              {a.sample?.srcip ? (
                <div className="pt-6">
                  <Checkbox checked={byIp} onChange={setByIp} label={t("soc.sup.onlyIp", { ip: String(a.sample.srcip) })} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function EscalateModal({ a, onClose, onDone }: { a: SocAlertDetailDto; onClose: () => void; onDone: (r: SocAlertDetailDto) => void }) {
  const t = useT();
  const [title, setTitle] = useState(a.title);
  const [kind, setKind] = useState<"unassessed" | "event" | "incident">("unassessed");
  const m = useMutation({ mutationFn: () => api.soc.escalate(a.id, { title: title.trim() || undefined, kind }), onSuccess: (r) => onDone(r.alert) });
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
      <p className="text-sm text-slate-600">{t("soc.escalateHint")}</p>
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

/** Předběžná triáž AI (ADR-051): návrh verdiktu a podobné rozhodnuté alerty. Nic se neaplikuje samo. */
function AiTriageCard({ a, canApply, onApply, onDone }: { a: SocAlertDetailDto; canApply: boolean; onApply: (tr: SocAiTriage) => void; onDone: (r: SocAlertDetailDto) => void }) {
  const t = useT();
  const run = useMutation({ mutationFn: () => api.soc.triage(a.id), onSuccess: onDone });
  const tr = a.aiTriage;
  return (
    <Card className="mb-6 overflow-hidden border-violet-200" data-testid="soc-ai-triage">
      <CardHeader
        title={t("soc.aiTriage.title")}
        subtitle={t("soc.aiTriage.subtitle")}
        action={
          a.canWrite && (
            <Button variant="secondary" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {tr ? t("soc.aiTriage.again") : t("soc.aiTriage.run")}
            </Button>
          )
        }
      />
      <div className="space-y-3 p-4 text-sm">
        <ErrorBox error={run.error} />
        {!tr ? (
          <p className="text-slate-500">{run.isPending ? t("ai.modelPripravujeOdpovedLokalniModel") : t("soc.aiTriage.pending")}</p>
        ) : tr.error || !tr.verdict ? (
          <p className="text-amber-800">{t("soc.aiTriage.error", { e: tr.error ?? "" })}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <AiTriageBadge tr={tr} />
              {tr.severity && <SeverityBadge s={tr.severity} />}
              {tr.confidence && <Badge tone={tr.confidence === "high" ? "green" : tr.confidence === "medium" ? "slate" : "amber"}>{t.lbl(SOC_LABELS.confidence[tr.confidence])}</Badge>}
              {tr.action && <span className="text-xs text-slate-600">→ {t.lbl(SOC_LABELS.action[tr.action])}</span>}
              {canApply && (tr.action === "close" || (tr.action === "escalate" && a.canEscalate)) && (
                <Button className="ml-auto" onClick={() => onApply(tr)}>
                  {t("soc.aiTriage.apply")}
                </Button>
              )}
            </div>
            {tr.reasoning && <p className="whitespace-pre-wrap leading-relaxed text-slate-800">{tr.reasoning}</p>}
          </>
        )}
        {tr && (
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">{t("soc.aiTriage.similar")}</div>
            {tr.similar.length === 0 ? (
              <p className="text-xs text-slate-500">{t("soc.aiTriage.similarNone")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {tr.similar.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
                    <Link to="/soc/$alertId" params={{ alertId: x.id }} className="font-medium text-brand-700 hover:underline">
                      {x.title}
                    </Link>
                    <span className="text-slate-500">{x.status === "accepted" ? t("soc.aiTriage.escalated") : x.verdict ? t.lbl(SOC_LABELS.verdict[x.verdict]) : "—"}</span>
                    <span className="text-slate-400">{x.reasons.map((r) => t.lbl(SOC_LABELS.similarReason[r])).join(", ")}</span>
                    <span className="ml-auto text-slate-400">{fmtDate(x.lastSeen)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tr && (
          <p className="text-xs text-slate-500">
            {tr.model} · {fmtDate(tr.at)} · {t("soc.aiTriage.disclaimer")}
          </p>
        )}
      </div>
    </Card>
  );
}

/** Rozbor nahlášeného phishingu – odkazy jen jako text (neklikací), celý e-mail se neukládá. */
function PhishingCard({ a }: { a: SocAlertDetailDto }) {
  const t = useT();
  const x = (a.sample ?? {}) as { from?: string; replyTo?: string | null; returnPath?: string | null; subject?: string; date?: string | null; auth?: { spf: string | null; dkim: string | null; dmarc: string | null }; hops?: number; urls?: string[]; domains?: string[]; attachments?: string[]; reports?: number };
  const tone = (v: string | null | undefined) => (v === "pass" ? "green" : v === "fail" || v === "softfail" ? "red" : "slate");
  return (
    <Card className="overflow-hidden" data-testid="soc-phishing">
      <CardHeader title={t("phish.card.title")} subtitle={t("phish.card.reports", { n: x.reports ?? 1 })} />
      <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
        <Item label={t("phish.from")} value={x.from ?? "—"} />
        <Item label={t("phish.subject")} value={x.subject ?? "—"} />
        {x.replyTo && <Item label="Reply-To" value={x.replyTo} />}
        {x.returnPath && <Item label="Return-Path" value={x.returnPath} />}
        {x.auth && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-500">{t("phish.card.auth")}</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {(["spf", "dkim", "dmarc"] as const).map((k) => (
                <Badge key={k} tone={tone(x.auth![k])}>
                  {k.toUpperCase()}: {x.auth![k] ?? "?"}
                </Badge>
              ))}
            </dd>
          </div>
        )}
        {!!x.domains?.length && <Item label={t("phish.card.domains")} value={x.domains.join(", ")} />}
        {!!x.attachments?.length && <Item label={t("phish.card.attachments")} value={x.attachments.join(", ")} />}
        {!!x.urls?.length && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-500">{t("phish.card.urls")}</dt>
            <dd>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs text-slate-700">
                {x.urls.map((u) => (
                  <li key={u} className="break-all">
                    {u.replace(/^http/i, "hxxp")}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
