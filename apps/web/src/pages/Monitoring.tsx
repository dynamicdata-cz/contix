import { askConfirm } from "@/components/ui/overlay";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import {
  CONTROL_MONITOR_KINDS,
  MONITOR_FREQUENCIES,
  MONITOR_LABELS,
  MONITOR_SPEC,
  OBLIGATION_KINDS,
  OBLIGATION_LABELS,
  monitorParamsOf,
  type ControlMonitorDto,
  type ControlMonitorKind,
  type MonitorFrequency,
  type MonitorParams,
  type MonitorResult,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, History, Pencil, Play, Plus } from "lucide-react";
import { useState } from "react";

export const RESULT_TONE: Record<MonitorResult, Tone> = { pass: "green", fail: "red", error: "amber" };
const DOT: Record<MonitorResult, string> = { pass: "bg-emerald-500", fail: "bg-red-500", error: "bg-amber-400" };

/** Proužek posledních běhů – barva doplněná textem v title (přístupnost). */
export function RunStrip({ runs }: { runs: { runAt: string; result: MonitorResult }[] }) {
  const t = useT();
  if (!runs.length) return <span className="text-xs text-slate-400">{t("mon.noRuns")}</span>;
  return (
    <span className="inline-flex items-end gap-0.5" aria-label={t("mon.historyAria", { n: runs.length, ok: runs.filter((r) => r.result === "pass").length })}>
      {runs.map((r, i) => (
        <span key={i} className={cn("h-3.5 w-1.5 rounded-sm", DOT[r.result])} title={`${fmtDate(r.runAt)} – ${t.lbl(MONITOR_LABELS.result[r.result])}`} />
      ))}
    </span>
  );
}

export function MonitoringPage() {
  const t = useT();
  const can = useCan();
  const list = useQuery({ queryKey: ["monitors"], queryFn: () => api.monitors.list() });
  const [edit, setEdit] = useState<ControlMonitorDto | "new" | null>(null);
  const [runsOf, setRunsOf] = useState<ControlMonitorDto | null>(null);
  const [periodOf, setPeriodOf] = useState<ControlMonitorDto | null>(null);
  const qc = useQueryClient();
  const run = useMutation({ mutationFn: (id: string) => api.monitors.run(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["monitors"] }) });
  const rows = list.data ?? [];
  const count = (r: MonitorResult) => rows.filter((m) => m.enabled && m.lastResult === r).length;
  return (
    <>
      <PageHeader
        title={t("mon.title")}
        subtitle={t("mon.subtitle")}
        actions={
          can("controls:test") && (
            <Button onClick={() => setEdit("new")}>
              <Plus size={16} /> {t("mon.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={list.error ?? run.error} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[
          { k: "all", n: rows.filter((m) => m.enabled).length, label: t("mon.tileActive"), tone: "text-slate-900" },
          { k: "pass", n: count("pass"), label: t.lbl(MONITOR_LABELS.result.pass), tone: "text-emerald-700" },
          { k: "fail", n: count("fail"), label: t.lbl(MONITOR_LABELS.result.fail), tone: "text-red-700" },
          { k: "error", n: count("error"), label: t.lbl(MONITOR_LABELS.result.error), tone: "text-amber-700" },
        ].map((x) => (
          <Card key={x.k} className="px-5 py-4">
            <div className={cn("text-3xl font-semibold tabular-nums", x.tone)}>{list.data ? x.n : "…"}</div>
            <div className="text-xs text-slate-500">{x.label}</div>
          </Card>
        ))}
      </div>
      <Card data-testid="monitors">
        <CardHeader title={t("mon.listTitle")} subtitle={t("mon.listSubtitle")} />
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("mon.colControl")}</th>
                  <th className="px-4 py-2">{t("mon.colMonitor")}</th>
                  <th className="px-4 py-2">{t("mon.colLast")}</th>
                  <th className="px-4 py-2">{t("mon.colHistory")}</th>
                  <th className="px-4 py-2 text-right">{t("mon.colRate")}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={cn("border-b border-slate-100 align-top", !m.enabled && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <Link to="/controls/$controlId" params={{ controlId: m.controlId }} className="font-medium text-brand-700 hover:underline">
                        {m.controlName}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-slate-800">{m.name || t.lbl(MONITOR_LABELS.kind[m.kind])}</div>
                      <div className="text-xs text-slate-500">
                        {t.lbl(MONITOR_LABELS.frequency[m.frequency])}
                        {!m.enabled && ` · ${t("mon.disabled")}`}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {m.lastResult ? <Badge tone={RESULT_TONE[m.lastResult]}>{t.lbl(MONITOR_LABELS.result[m.lastResult])}</Badge> : <span className="text-slate-400">—</span>}
                      {m.lastSummary && <div className="mt-1 max-w-80 text-xs text-slate-600">{m.lastSummary}</div>}
                      {m.lastRunAt && <div className="text-[11px] text-slate-400">{fmtDate(m.lastRunAt)}</div>}
                      {m.openTaskId && (
                        <Link to="/actions" search={{ task: m.openTaskId } as never} className="mt-1 inline-block text-xs text-brand-700 hover:underline">
                          {t("mon.openTask")}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <RunStrip runs={m.recent} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{m.passRate90 == null ? "—" : `${m.passRate90} %`}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <Button variant="ghost" className="px-2 py-1" title={t("mon.runs")} aria-label={t("mon.runs")} onClick={() => setRunsOf(m)}>
                        <History size={15} />
                      </Button>
                      {can("controls:test") && (
                        <>
                          {m.kind !== "external_check" && (
                            <Button variant="ghost" className="px-2 py-1" disabled={run.isPending} title={t("mon.runNow")} aria-label={t("mon.runNow")} onClick={() => run.mutate(m.id)}>
                              <Play size={15} />
                            </Button>
                          )}
                          <Button variant="ghost" className="px-2 py-1" title={t("mon.periodTest")} aria-label={t("mon.periodTest")} onClick={() => setPeriodOf(m)}>
                            <ClipboardCheck size={15} />
                          </Button>
                          <Button variant="ghost" className="px-2 py-1" title={t("mon.edit")} aria-label={t("mon.edit")} onClick={() => setEdit(m)}>
                            <Pencil size={15} />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          list.data && <EmptyState>{t("mon.empty")}</EmptyState>
        )}
      </Card>
      {edit && <MonitorModal monitor={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {runsOf && <RunsModal monitor={runsOf} onClose={() => setRunsOf(null)} />}
      {periodOf && <PeriodTestModal monitor={periodOf} onClose={() => setPeriodOf(null)} />}
    </>
  );
}

function MonitorModal({ monitor, onClose }: { monitor: ControlMonitorDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const controls = useQuery({ queryKey: ["controls", "monitor-picker"], queryFn: () => api.controls.list() });
  const sources = useQuery({ queryKey: ["identity", "sources"], queryFn: api.identity.sources, retry: false });
  const [controlId, setControlId] = useState(monitor?.controlId ?? "");
  const [kind, setKind] = useState<ControlMonitorKind>(monitor?.kind ?? "identity_mfa");
  const [name, setName] = useState(monitor?.name ?? "");
  const [frequency, setFrequency] = useState<MonitorFrequency>(monitor?.frequency ?? "daily");
  const [enabled, setEnabled] = useState(monitor?.enabled ?? true);
  const [autoTask, setAutoTask] = useState(monitor?.autoTask ?? false);
  const [token, setToken] = useState<string | null>(null);
  const issue = useMutation({ mutationFn: () => api.monitors.token(monitor!.id), onSuccess: (r) => (setToken(r.token), qc.invalidateQueries({ queryKey: ["monitors"] })) });
  const [params, setParams] = useState<MonitorParams>(monitor?.params ?? monitorParamsOf("identity_mfa", {}));
  const spec = MONITOR_SPEC[kind];
  const save = useMutation({
    mutationFn: () => {
      const data = { controlId, kind, name: name.trim() || undefined, frequency, enabled, autoTask, params: monitorParamsOf(kind, params) };
      return monitor ? api.monitors.update(monitor.id, data) : api.monitors.create(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.monitors.remove(monitor!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["monitors"] });
      onClose();
    },
  });
  const num = (k: "minPct" | "maxCount" | "minScore" | "graceDays" | "staleDays" | "warnDays") => (
    <Field key={k} label={t.lbl(MONITOR_LABELS.param[k])}>
      <Input type="number" min={0} value={params[k] ?? ""} onChange={(e) => setParams({ ...params, [k]: e.target.value === "" ? undefined : Number(e.target.value) })} />
    </Field>
  );
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={monitor ? t("mon.editTitle") : t("mon.newTitle")}
      footer={
        <>
          {monitor && (
            <Button variant="ghost" className="mr-auto text-red-700" disabled={remove.isPending} onClick={async () => (await askConfirm(t("mon.removeConfirm"))) && remove.mutate()}>
              {t("mon.delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!controlId || save.isPending} onClick={() => save.mutate()}>
            {t("mon.save")}
          </Button>
        </>
      }
    >
      <Field label={t("mon.colControl")}>
        <Select value={controlId} onChange={(e) => setControlId(e.target.value)}>
          <option value="">—</option>
          {controls.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} ` : ""}
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("mon.kind")}>
          <Select
            value={kind}
            disabled={!!monitor}
            onChange={(e) => {
              const k = e.target.value as ControlMonitorKind;
              setKind(k);
              setParams(monitorParamsOf(k, {}));
            }}
          >
            {CONTROL_MONITOR_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(MONITOR_LABELS.kind[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("mon.frequency")}>
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as MonitorFrequency)}>
            {MONITOR_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t.lbl(MONITOR_LABELS.frequency[f])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-sm text-slate-600">{t(`mon.kindHint.${kind}` as "mon.kindHint.identity_mfa")}</p>
      <Field label={t("mon.name")} hint={t("mon.nameHint")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">{spec.params.filter((k) => ["minPct", "maxCount", "minScore", "graceDays", "staleDays", "warnDays"].includes(k)).map((k) => num(k as "minPct"))}</div>
      {spec.params.includes("priorities") && (
        <Field label={t.lbl(MONITOR_LABELS.param.priorities)}>
          <div className="flex gap-4">
            {(["p1", "p2", "p3", "p4"] as const).map((p) => (
              <Checkbox
                key={p}
                label={p.toUpperCase()}
                checked={(params.priorities ?? []).includes(p)}
                onChange={(v) => setParams({ ...params, priorities: v ? [...(params.priorities ?? []), p] : (params.priorities ?? []).filter((x) => x !== p) })}
              />
            ))}
          </div>
        </Field>
      )}
      {spec.params.includes("productionOnly") && <Checkbox checked={!!params.productionOnly} onChange={(v) => setParams({ ...params, productionOnly: v })} label={t.lbl(MONITOR_LABELS.param.productionOnly)} />}
      {spec.params.includes("sourceId") && (
        <Field label={t.lbl(MONITOR_LABELS.param.sourceId)}>
          <Select value={params.sourceId ?? ""} onChange={(e) => setParams({ ...params, sourceId: e.target.value || undefined })}>
            <option value="">{t("mon.allSources")}</option>
            {sources.data
              ?.filter((s) => kind !== "m365_secure_score" || s.kind === "entra")
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
      )}
      {spec.params.includes("obligationKinds") && (
        <Field label={t.lbl(MONITOR_LABELS.param.obligationKinds)} hint={t("mon.obligationKindsHint")}>
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
            {OBLIGATION_KINDS.map((k) => (
              <Checkbox
                key={k}
                checked={(params.obligationKinds ?? []).includes(k)}
                onChange={(v) => setParams({ ...params, obligationKinds: v ? [...(params.obligationKinds ?? []), k] : (params.obligationKinds ?? []).filter((x) => x !== k) })}
                label={t.lbl(OBLIGATION_LABELS[k])}
              />
            ))}
          </div>
        </Field>
      )}
      {kind === "external_check" && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="mon-token">
          <p className="text-slate-700">{t("mon.externalHint")}</p>
          {!monitor ? (
            <p className="text-xs text-slate-500">{t("mon.tokenAfterSave")}</p>
          ) : token ? (
            <>
              <p className="text-xs font-medium text-amber-800">{t("mon.tokenOnce")}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs">{`curl -X POST ${location.origin}/api/public/monitors/result \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"result":"pass","summary":"Záloha OK"}'`}</pre>
            </>
          ) : (
            <Button variant="secondary" type="button" disabled={issue.isPending} onClick={async () => (!monitor.hasToken || (await askConfirm(t("mon.tokenReplace")))) && issue.mutate()}>
              {monitor.hasToken ? t("mon.tokenNew") : t("mon.tokenIssue")}
            </Button>
          )}
          <ErrorBox error={issue.error} />
        </div>
      )}
      <Checkbox checked={autoTask} onChange={setAutoTask} label={t("mon.autoTask")} />
      <Checkbox checked={enabled} onChange={setEnabled} label={t("mon.enabled")} />
      <ErrorBox error={save.error ?? remove.error} />
    </Modal>
  );
}

function RunsModal({ monitor, onClose }: { monitor: ControlMonitorDto; onClose: () => void }) {
  const t = useT();
  const runs = useQuery({ queryKey: ["monitors", "runs", monitor.id], queryFn: () => api.monitors.runs(monitor.id) });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Modal open wide onClose={onClose} title={t("mon.runsTitle", { name: monitor.name || t.lbl(MONITOR_LABELS.kind[monitor.kind]) })}>
      <ErrorBox error={runs.error} />
      {runs.data && !runs.data.length && <EmptyState>{t("mon.noRuns")}</EmptyState>}
      <ul className="divide-y divide-slate-100 text-sm">
        {runs.data?.map((r) => (
          <li key={r.id} className="py-2">
            <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} disabled={!r.details.length}>
              <span className="w-36 shrink-0 text-slate-500">{fmtDate(r.runAt)}</span>
              <Badge tone={RESULT_TONE[r.result]}>{t.lbl(MONITOR_LABELS.result[r.result])}</Badge>
              <span className="text-slate-700">{r.summary}</span>
            </button>
            {open === r.id && (
              <ul className="ml-40 mt-1 space-y-0.5 text-xs text-slate-600">
                {r.details.map((d, i) => (
                  <li key={i}>
                    <span className="font-medium">{d.ref}</span> – {d.detail}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function PeriodTestModal({ monitor, onClose }: { monitor: ControlMonitorDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [tolerable, setTolerable] = useState(0);
  const make = useMutation({
    mutationFn: () => api.monitors.periodTest(monitor.id, { from, to, tolerable }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assurance"] }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("mon.periodTest")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {!make.data && (
            <Button disabled={make.isPending || !from || !to} onClick={() => make.mutate()}>
              {t("mon.periodCreate")}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("mon.periodHint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("mon.from")}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("mon.to")}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t("mon.tolerable")}>
          <Input type="number" min={0} value={tolerable} onChange={(e) => setTolerable(Number(e.target.value) || 0)} />
        </Field>
      </div>
      {make.data && (
        <div className="rounded-md border border-slate-200 p-3 text-sm">
          {t("mon.periodDone", { runs: make.data.runs, expected: make.data.expected, passed: make.data.passed, failed: make.data.failed + make.data.errors, coverage: make.data.coverage })}{" "}
          <Link to="/controls/tests/$testId" params={{ testId: make.data.testId }} className="font-medium text-brand-700 hover:underline">
            {t("mon.openTest")}
          </Link>
        </div>
      )}
      <ErrorBox error={make.error} />
    </Modal>
  );
}

/** Monitory jednoho opatření (detail opatření). */
export function ControlMonitorsCard({ controlId }: { controlId: string }) {
  const t = useT();
  const list = useQuery({ queryKey: ["monitors", "control", controlId], queryFn: () => api.monitors.list(controlId) });
  if (!list.data?.length) return null;
  return (
    <Card className="mb-6" data-testid="control-monitors">
      <CardHeader
        title={t("mon.title")}
        action={
          <Link to="/controls/monitoring" className="text-sm text-brand-700 hover:underline">
            {t("mon.manage")}
          </Link>
        }
      />
      <ul className="divide-y divide-slate-100 text-sm">
        {list.data.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
            <span className="min-w-56 text-slate-800">{m.name || t.lbl(MONITOR_LABELS.kind[m.kind])}</span>
            {m.lastResult && <Badge tone={RESULT_TONE[m.lastResult]}>{t.lbl(MONITOR_LABELS.result[m.lastResult])}</Badge>}
            <RunStrip runs={m.recent} />
            <span className="text-xs text-slate-500">{m.lastSummary}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
