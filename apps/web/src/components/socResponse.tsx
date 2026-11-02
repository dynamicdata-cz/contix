/** Reakce s potvrzením (ADR-055): zásahy SOC se schválením (čtyři oči), Wazuh Active Response, okamžitá upozornění. */
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { SOC_ACTION_KINDS, SOC_ACTION_LABELS, SOC_NOTIFY_LEVELS, type SocActionDto, type SocActionKind, type SocActionStatus, type SocResponseSettings } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ShieldBan, X } from "lucide-react";
import { useState } from "react";

const statusTone: Record<SocActionStatus, Tone> = { proposed: "amber", approved: "blue", done: "green", failed: "red", rejected: "slate", cancelled: "slate" };

/** Seznam zásahů s tlačítky podle oprávnění (schválit / zamítnout / označit provedení / zrušit). */
export function ActionList({ items, showAlert, onChanged }: { items: SocActionDto[]; showAlert?: boolean; onChanged: () => void }) {
  const t = useT();
  const [dialog, setDialog] = useState<{ a: SocActionDto; mode: "reject" | "complete" | "approve" } | null>(null);
  const cancel = useMutation({ mutationFn: api.soc.cancelAction, onSuccess: onChanged });
  if (!items.length) return <EmptyState>{t("soc.act.empty")}</EmptyState>;
  return (
    <>
      <ErrorBox error={cancel.error} />
      <ul className="divide-y divide-slate-100 text-sm" data-testid="soc-actions">
        {items.map((a) => (
          <li key={a.id} className="space-y-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone[a.status]}>{t.lbl(SOC_ACTION_LABELS.status[a.status])}</Badge>
              <span className="font-medium">{t.lbl(SOC_ACTION_LABELS.kind[a.kind])}</span>
              <span className="break-all font-mono text-xs">{a.target}</span>
              {a.agentIds.length > 0 && <span className="text-xs text-slate-500">{t("soc.act.agents", { list: a.agentIds.join(", ") })}</span>}
              {!a.automated && <Badge tone="slate">{t("soc.act.manual")}</Badge>}
            </div>
            <p className="text-slate-700">{a.reason}</p>
            <p className="text-xs text-slate-500">
              {t("soc.act.requested", { who: a.requestedByName ?? "—", at: fmtDate(a.createdAt) })}
              {a.decidedByName && ` · ${t("soc.act.decided", { who: a.decidedByName, at: a.decidedAt ? fmtDate(a.decidedAt) : "" })}`}
              {a.decisionNote && ` – ${a.decisionNote}`}
              {a.executedByName && ` · ${t("soc.act.executed", { who: a.executedByName, at: a.executedAt ? fmtDate(a.executedAt) : "" })}`}
              {showAlert && a.alertId && (
                <>
                  {" · "}
                  <Link to="/soc/$alertId" params={{ alertId: a.alertId }} className="text-brand-700 hover:underline">
                    {a.alertTitle}
                  </Link>
                </>
              )}
            </p>
            {a.result && <p className={a.status === "failed" ? "text-xs text-red-700" : "text-xs text-slate-600"}>{a.result}</p>}
            {(a.canDecide || a.canComplete || a.canCancel) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {a.canDecide && (
                  <>
                    <Button onClick={() => setDialog({ a, mode: "approve" })}>
                      <Check size={14} /> {a.automated ? t("soc.act.approveRun") : t("soc.act.approve")}
                    </Button>
                    <Button variant="secondary" onClick={() => setDialog({ a, mode: "reject" })}>
                      <X size={14} /> {t("soc.act.reject")}
                    </Button>
                  </>
                )}
                {a.canComplete && (
                  <Button onClick={() => setDialog({ a, mode: "complete" })}>{a.automated ? t("soc.act.retry") : t("soc.act.complete")}</Button>
                )}
                {a.canCancel && (
                  <Button variant="secondary" onClick={() => cancel.mutate(a.id)} disabled={cancel.isPending}>
                    {t("soc.act.cancel")}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {dialog && <DecisionModal a={dialog.a} mode={dialog.mode} onClose={() => setDialog(null)} onDone={() => (setDialog(null), onChanged())} />}
    </>
  );
}

function DecisionModal({ a, mode, onClose, onDone }: { a: SocActionDto; mode: "reject" | "complete" | "approve"; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [success, setSuccess] = useState(true);
  const m = useMutation({
    mutationFn: () => (mode === "complete" ? api.soc.completeAction(a.id, a.automated ? true : success, note.trim() || t("soc.act.retryNote")) : api.soc.decideAction(a.id, mode, note.trim())),
    onSuccess: onDone,
  });
  const title = mode === "approve" ? t("soc.act.approveTitle") : mode === "reject" ? t("soc.act.rejectTitle") : t("soc.act.completeTitle");
  const needNote = mode === "reject" || (mode === "complete" && !a.automated);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || (needNote && note.trim().length < 3)}>
            {title}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        <strong>{t.lbl(SOC_ACTION_LABELS.kind[a.kind])}</strong> <span className="font-mono text-xs">{a.target}</span>
      </p>
      {mode === "approve" && a.automated && <p className="text-sm text-amber-800">{t("soc.act.approveWarn", { agents: a.agentIds.join(", ") })}</p>}
      {mode === "complete" && !a.automated && <Checkbox checked={success} onChange={setSuccess} label={t("soc.act.success")} />}
      <Field label={mode === "complete" ? t("soc.act.resultNote") : t("soc.act.note")}>
        <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/** Návrh zásahu z detailu alertu (předvyplněná IP a agent Wazuh). */
export function ProposeActionModal({ alertId, ip, agentId, onClose, onDone }: { alertId: string; ip: string | null; agentId: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<SocActionKind>(ip ? "block_ip" : "disable_account");
  const [target, setTarget] = useState(ip ?? "");
  const [agents, setAgents] = useState(agentId ?? "");
  const [reason, setReason] = useState("");
  const agentIds = agents.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const m = useMutation({ mutationFn: () => api.soc.proposeAction({ kind, target: target.trim(), agentIds: kind === "block_ip" ? agentIds : [], reason: reason.trim(), alertId }), onSuccess: onDone });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc.act.propose")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending || !target.trim() || reason.trim().length < 3 || (kind === "block_ip" && !agentIds.length)}>
            {t("soc.act.send")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("soc.act.proposeHint")}</p>
      <Field label={t("soc.act.kind")}>
        <Select value={kind} onChange={(e) => setKind(e.target.value as SocActionKind)}>
          {SOC_ACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.lbl(SOC_ACTION_LABELS.kind[k])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={kind === "block_ip" ? t("soc.act.targetIp") : t("soc.act.target")} hint={kind === "block_ip" ? undefined : t("soc.act.targetHint")}>
        <Input value={target} maxLength={500} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      {kind === "block_ip" && (
        <Field label={t("soc.act.agentIds")} hint={t("soc.act.agentIdsHint")}>
          <Input value={agents} placeholder="001, 004" onChange={(e) => setAgents(e.target.value)} />
        </Field>
      )}
      <Field label={t("soc.act.reason")}>
        <Textarea rows={3} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/** Karta zásahů v detailu alertu. */
export function AlertActionsCard({ alertId, ip, agentId, canWrite }: { alertId: string; ip: string | null; agentId: string | null; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "actions", "alert", alertId], queryFn: () => api.soc.actions({ status: "all", alertId }) });
  const [proposing, setProposing] = useState(false);
  const refresh = () => (qc.invalidateQueries({ queryKey: ["soc", "actions"] }), qc.invalidateQueries({ queryKey: ["soc", "alert", alertId] }), qc.invalidateQueries({ queryKey: ["soc", "iocs"] }));
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t("soc.act.title")}
        subtitle={t("soc.act.subtitle")}
        action={
          canWrite && (
            <Button variant="secondary" onClick={() => setProposing(true)}>
              <ShieldBan size={15} /> {t("soc.act.propose")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error} />
      {q.data && <ActionList items={q.data} onChanged={refresh} />}
      {proposing && <ProposeActionModal alertId={alertId} ip={ip} agentId={agentId} onClose={() => setProposing(false)} onDone={() => (setProposing(false), refresh())} />}
    </Card>
  );
}

/** Záložka Reakce: zásahy ke schválení / provedení a nastavení. */
export function ResponseTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "all">("open");
  const q = useQuery({ queryKey: ["soc", "actions", status], queryFn: () => api.soc.actions({ status }) });
  return (
    <div className="mb-6 space-y-6">
      <Card className="overflow-hidden">
        <CardHeader
          title={t("soc.act.queue")}
          subtitle={t("soc.act.queueHint")}
          action={
            <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t("soc.act.filter")}>
              <option value="open">{t("soc.act.filterOpen")}</option>
              <option value="all">{t("soc.act.filterAll")}</option>
            </Select>
          }
        />
        <ErrorBox error={q.error} />
        {!q.data ? <EmptyState>{t("common.loading")}</EmptyState> : <ActionList items={q.data} showAlert onChanged={() => qc.invalidateQueries({ queryKey: ["soc", "actions"] })} />}
      </Card>
      {can("admin:settings") && <ResponseSettingsCard />}
    </div>
  );
}

function ResponseSettingsCard() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "response-settings"], queryFn: api.soc.responseSettings });
  const [v, setV] = useState<SocResponseSettings | null>(null);
  const [pw, setPw] = useState("");
  const cur = v ?? q.data;
  const save = useMutation({
    mutationFn: () => api.soc.saveResponseSettings({ notifyMinSeverity: cur!.notifyMinSeverity, fourEyes: cur!.fourEyes, activeResponseEnabled: cur!.activeResponseEnabled, wazuhUser: cur!.wazuhUser, blockCommand: cur!.blockCommand, ...(pw ? { wazuhPassword: pw } : {}) }),
    onSuccess: (r) => (qc.setQueryData(["soc", "response-settings"], r), setV(null), setPw("")),
  });
  if (!cur) return <ErrorBox error={q.error} />;
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t("soc.act.settings")} />
      <div className="grid gap-4 p-5 text-sm lg:grid-cols-2">
        <div className="space-y-3">
          <Field label={t("soc.act.notify")} hint={t("soc.act.notifyHint")}>
            <Select value={cur.notifyMinSeverity} onChange={(e) => setV({ ...cur, notifyMinSeverity: e.target.value as SocResponseSettings["notifyMinSeverity"] })}>
              {SOC_NOTIFY_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t.lbl(SOC_ACTION_LABELS.notify[l])}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox checked={cur.fourEyes} onChange={(x) => setV({ ...cur, fourEyes: x })} label={t("soc.act.fourEyes")} hint={t("soc.act.fourEyesHint")} />
        </div>
        <div className="space-y-3">
          <Checkbox checked={cur.activeResponseEnabled} onChange={(x) => setV({ ...cur, activeResponseEnabled: x })} label={t("soc.act.arEnabled")} hint={t("soc.act.arHint")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("soc.act.arUser")}>
              <Input value={cur.wazuhUser} autoComplete="off" onChange={(e) => setV({ ...cur, wazuhUser: e.target.value })} />
            </Field>
            <Field label={t("soc.act.arPassword")} hint={cur.hasWazuhPassword ? t("soc.act.pwSet") : undefined}>
              <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
          </div>
          <Field label={t("soc.act.arCommand")} hint={t("soc.act.arCommandHint")}>
            <Input value={cur.blockCommand} className="font-mono text-xs" onChange={(e) => setV({ ...cur, blockCommand: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-slate-100 px-5 py-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending || (!v && !pw)}>
          {t("soc.save")}
        </Button>
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}
