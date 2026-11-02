import { askConfirm } from "@/components/ui/overlay";
/** Shoda konfigurace – Wazuh SCA (ADR-064): skóre podle politik, nejčastěji selhávající kontroly, automatický test opatření, karta aktiva. */
import { STATUS_COLORS } from "@/components/health";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate } from "@/lib/utils";
import { AUTOMATION_FREQUENCIES, AUTOMATION_LABELS, SCA_COMPLIANCE_LABELS, SCA_LABELS, type AutomationFrequency, type ControlAutomationDto, type ScaCheckDto, type ScaResult } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Play, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

const resultTone: Record<ScaResult, Tone> = { passed: "green", failed: "red", not_applicable: "slate" };
const testTone: Record<string, Tone> = { effective: "green", effective_with_exceptions: "amber", ineffective: "red" };
const scoreColor = (s: number | null) => (s == null ? STATUS_COLORS.neutral : s >= 80 ? STATUS_COLORS.good : s >= 60 ? STATUS_COLORS.serious : STATUS_COLORS.critical);

export function ScoreBar({ score }: { score: number | null }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
        <span className="block h-full" style={{ width: `${score ?? 0}%`, background: scoreColor(score) }} />
      </span>
      <span className="w-10 text-right text-xs font-semibold tabular-nums">{score == null ? "—" : `${score} %`}</span>
    </span>
  );
}

function Compliance({ c }: { c: Record<string, string[]> }) {
  const t = useT();
  const keys = Object.keys(c).filter((k) => !k.startsWith("mitre"));
  if (!keys.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {keys.slice(0, 6).map((k) => (
        <span key={k} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600" title={c[k]!.join(", ")}>
          {t.lbl(SCA_COMPLIANCE_LABELS[k] ?? k)}: {c[k]!.slice(0, 3).join(", ")}
          {c[k]!.length > 3 ? "…" : ""}
        </span>
      ))}
    </span>
  );
}

export function ScaPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sca"], queryFn: api.sca.overview });
  const sync = useMutation({ mutationFn: api.sca.sync, onSuccess: (r) => qc.setQueryData(["sca"], r) });
  const d = q.data;
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/controls" className="hover:text-brand-700">
          {t("sca.back")}
        </Link>
      </div>
      <PageHeader
        title={t("sca.title")}
        subtitle={t("sca.subtitle")}
        actions={
          can("discovery:run") && (
            <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw size={15} className={sync.isPending ? "animate-spin" : ""} /> {t("sca.sync")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error ?? sync.error} />
      {d && (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {d.lastSync ? t("sca.lastSync", { at: fmtDate(d.lastSync.at), a: d.lastSync.agents, p: d.lastSync.policies, c: d.lastSync.checks }) : t("sca.never")}
            {d.lastSync?.error && <span className="ml-2 text-amber-800">{d.lastSync.error}</span>}
          </p>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("sca.kpi.score")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: scoreColor(d.totals.score) }}>
                {d.totals.score == null ? "—" : `${d.totals.score} %`}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("sca.kpi.assets")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{d.totals.assets}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("sca.kpi.pass")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{d.totals.pass}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("sca.kpi.fail")}</div>
              <div className={cn("mt-1 text-2xl font-semibold tabular-nums", d.totals.fail > 0 && "text-red-700")}>{d.totals.fail}</div>
            </Card>
          </div>
          <Card className="mb-6 overflow-hidden" data-testid="sca-policies">
            <CardHeader title={t("sca.policies")} subtitle={t("sca.policiesSub")} />
            {d.policies.length === 0 ? (
              <EmptyState>{t("sca.empty")}</EmptyState>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">{t("sca.col.policy")}</th>
                    <th className="px-3 py-2 text-right">{t("sca.col.assets")}</th>
                    <th className="px-3 py-2">{t("sca.col.score")}</th>
                    <th className="px-3 py-2">{t("sca.col.worst")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.policies.map((p) => (
                    <tr key={p.policyId} className="align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{p.policyName}</div>
                        <div className="text-xs text-slate-500">{t("sca.passFail", { p: p.pass, f: p.fail })}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.assets}</td>
                      <td className="px-3 py-2.5">
                        <ScoreBar score={p.score} />
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {p.worst.map((w) => (
                          <Link key={w.assetId} to="/assets/$assetId" params={{ assetId: w.assetId }} className="mr-2 text-brand-700 hover:underline">
                            {w.assetName} ({w.score ?? "—"} %)
                          </Link>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {d.topFailed.length > 0 && (
            <Card className="mb-6 overflow-hidden" data-testid="sca-failed">
              <CardHeader title={t("sca.topFailed")} subtitle={t("sca.topFailedSub")} />
              <ul className="divide-y divide-slate-100 text-sm">
                {d.topFailed.map((f) => (
                  <li key={`${f.policyId}-${f.checkId}`} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{f.title}</span>
                      <Badge tone="red">{t("sca.failedOn", { n: f.failedOn })}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">
                        {f.policyId} #{f.checkId}
                      </span>
                      <Compliance c={f.compliance} />
                    </div>
                    <div className="mt-1 text-xs">
                      {f.assets.map((a) => (
                        <Link key={a.id} to="/assets/$assetId" params={{ assetId: a.id }} className="mr-2 text-brand-700 hover:underline">
                          {a.name}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <ScaAutomations policies={d.policies.map((p) => ({ id: p.policyId, name: p.policyName }))} />
        </>
      )}
    </>
  );
}

function ScaAutomations({ policies }: { policies: { id: string; name: string }[] }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sca", "automations"], queryFn: api.sca.automations });
  const [edit, setEdit] = useState<ControlAutomationDto | "new" | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["sca", "automations"] });
  const run = useMutation({ mutationFn: api.sca.runAutomation, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.sca.removeAutomation, onSuccess: refresh });
  const w = can("controls:test");
  return (
    <Card className="mb-6 overflow-hidden" data-testid="sca-automations">
      <CardHeader
        title={t("sca.auto.title")}
        subtitle={t("sca.auto.sub")}
        action={
          w && (
            <Button variant="secondary" onClick={() => setEdit("new")}>
              <Plus size={15} /> {t("sca.auto.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error ?? run.error ?? remove.error} />
      {q.data?.length === 0 ? (
        <EmptyState>{t("sca.auto.empty")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data?.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div>
                <Link to="/controls/$controlId" params={{ controlId: a.controlId }} className="font-medium text-brand-700 hover:underline">
                  {a.controlName}
                </Link>
                <div className="text-xs text-slate-500">
                  {t.lbl(AUTOMATION_LABELS.frequency[a.frequency])} · {t("sca.auto.thresholds", { min: a.scaMinScore, warn: a.scaWarnScore })} · {a.scaPolicies.length ? a.scaPolicies.join(", ") : t("sca.auto.allPolicies")}
                </div>
                {a.lastError && <div className="text-xs text-amber-800">{a.lastError}</div>}
              </div>
              <div className="flex items-center gap-2">
                {a.lastResult && <Badge tone={testTone[a.lastResult] ?? "slate"}>{t.lbl(SCA_TEST_LABEL[a.lastResult] ?? a.lastResult)}</Badge>}
                {w && (
                  <>
                    <Button variant="secondary" className="px-2 py-1 text-xs" disabled={run.isPending} onClick={() => run.mutate(a.id)}>
                      <Play size={13} /> {t("sca.auto.run")}
                    </Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setEdit(a)}>
                      {t("sca.auto.edit")}
                    </Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={async () => (await askConfirm(t("sca.auto.confirmDelete"))) && remove.mutate(a.id)} aria-label={t("sca.auto.delete")}>
                      <Trash2 size={13} />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && <AutomationModal a={edit === "new" ? null : edit} policies={policies} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), refresh())} />}
    </Card>
  );
}

const SCA_TEST_LABEL: Record<string, string> = { effective: "Účinné", effective_with_exceptions: "Účinné s výjimkami", ineffective: "Neúčinné" };

function AutomationModal({ a, policies, onClose, onSaved }: { a: ControlAutomationDto | null; policies: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({}) });
  const [controlId, setControlId] = useState(a?.controlId ?? "");
  const [frequency, setFrequency] = useState<AutomationFrequency>(a?.frequency ?? "monthly");
  const [sel, setSel] = useState<string[]>(a?.scaPolicies ?? []);
  const [min, setMin] = useState(a?.scaMinScore ?? 80);
  const [warn, setWarn] = useState(a?.scaWarnScore ?? 60);
  const [apply, setApply] = useState(a?.applyEffectiveness ?? false);
  const m = useMutation({
    mutationFn: () => {
      const body = { controlId, kind: "sca" as const, frequency, scaPolicies: sel, scaMinScore: min, scaWarnScore: warn, applyEffectiveness: apply, enabled: true };
      return a ? api.sca.updateAutomation(a.id, body) : api.sca.createAutomation(body);
    },
    onSuccess: onSaved,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={a ? t("sca.auto.edit") : t("sca.auto.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={!controlId || m.isPending}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <Field label={t("sca.auto.control")}>
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
      <Field label={t("sca.auto.frequency")}>
        <Select value={frequency} onChange={(e) => setFrequency(e.target.value as AutomationFrequency)}>
          {AUTOMATION_FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {t.lbl(AUTOMATION_LABELS.frequency[f])}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("sca.auto.policies")}</div>
        <div className="space-y-1">
          {policies.map((p) => (
            <Checkbox key={p.id} checked={sel.includes(p.id)} onChange={(v) => setSel(v ? [...sel, p.id] : sel.filter((x) => x !== p.id))} label={p.name} />
          ))}
          <p className="text-xs text-slate-500">{t("sca.auto.policiesHint")}</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("sca.auto.min")}>
          <Input type="number" min={0} max={100} value={min} onChange={(e) => setMin(Number(e.target.value))} />
        </Field>
        <Field label={t("sca.auto.warn")}>
          <Input type="number" min={0} max={100} value={warn} onChange={(e) => setWarn(Number(e.target.value))} />
        </Field>
      </div>
      <Checkbox checked={apply} onChange={setApply} label={t("sca.auto.apply")} />
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/** Karta na detailu aktiva. */
export function AssetScaCard({ assetId }: { assetId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["sca", "asset", assetId], queryFn: () => api.sca.asset(assetId) });
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (!q.data || !q.data.policies.length) return null;
  return (
    <Card className="lg:col-span-3" data-testid="asset-sca">
      <CardHeader title={t("sca.assetTitle")} subtitle={t("sca.assetSub")} />
      <ul className="divide-y divide-slate-100 text-sm">
        {q.data.policies.map((p) => {
          const checks = p.checks.filter((c: ScaCheckDto) => all || c.result === "failed");
          return (
            <li key={p.policyId}>
              <button type="button" className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen(open === p.policyId ? null : p.policyId)} aria-expanded={open === p.policyId}>
                {open === p.policyId ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className="flex-1 font-medium">{p.policyName}</span>
                <span className="text-xs text-slate-500">{t("sca.passFail", { p: p.pass, f: p.fail })}</span>
                <ScoreBar score={p.score} />
              </button>
              {open === p.policyId && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3">
                  <Checkbox checked={all} onChange={setAll} label={t("sca.showAll")} />
                  <ul className="mt-2 space-y-2">
                    {checks.map((c: ScaCheckDto) => (
                      <li key={c.checkId} className="rounded-md border border-slate-200 bg-white p-2.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium">{c.title}</span>
                          <Badge tone={resultTone[c.result]}>{t.lbl(SCA_LABELS.result[c.result])}</Badge>
                        </div>
                        {c.result === "failed" && c.remediation && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{c.remediation}</p>}
                        <div className="mt-1">
                          <Compliance c={c.compliance} />
                        </div>
                      </li>
                    ))}
                    {checks.length === 0 && <li className="text-xs text-slate-500">{t("sca.noFailed")}</li>}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

