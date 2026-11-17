/**
 * Nálezy (v1.65, ADR-158): jednotný přehled nálezů bezpečnostních testů, konfigurace serverů (sběrač),
 * zranitelností a zjištění auditů – stejná stupnice závažnosti a stavů, odpovědná osoba, úkol, přijaté riziko.
 * Nálezy serveru se tu i spravují (úkol, přijetí, falešný nález); ostatní se otevírají ve svém modulu.
 */
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone, Kpi } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useUrlParam } from "@/lib/urlState";
import { cn, fmtDay } from "@/lib/utils";
import { TASK_LABELS, type TaskStatus, FINDING_LABELS, FINDING_SOURCES, UNIFIED_SEVERITIES, UNIFIED_STATUSES, type FindingSource, type UnifiedFindingDto, type UnifiedFindingsDto, type UnifiedSeverity, type UnifiedStatus, type FindingsRemediationDto, type RemediationStat, type FindingPlanEffort } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ClipboardList, FlaskConical, Server, ShieldAlert, Bug } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const PAGE = 300;
const sevTone: Record<UnifiedSeverity, Tone> = { critical: "red", high: "red", medium: "amber", low: "slate", info: "slate" };
const stTone: Record<UnifiedStatus, Tone> = { open: "red", in_progress: "amber", accepted: "blue", fixed: "green", dismissed: "slate" };
const srcIcon: Record<FindingSource, React.ReactNode> = { sectest: <FlaskConical size={15} />, host: <Server size={15} />, vulnerability: <Bug size={15} />, audit: <ClipboardList size={15} /> };

function useLabels() {
  const t = useT();
  return {
    src: (s: FindingSource) => t.lbl(FINDING_LABELS.source[s]),
    sev: (s: UnifiedSeverity) => t.lbl(FINDING_LABELS.severity[s]),
    st: (s: UnifiedStatus) => t.lbl(FINDING_LABELS.status[s]),
  };
}

export function FindingsPage() {
  const t = useT();
  const L = useLabels();
  const [source, setSource] = useUrlParam<"" | FindingSource>("source", "");
  const [status, setStatus] = useUrlParam<string>("status", "active");
  const [severity, setSeverity] = useUrlParam<"" | UnifiedSeverity>("severity", "");
  const [focus] = useUrlParam<string>("focus", "");
  const [who, setWho] = useUrlParam<"" | "mine" | "team">("who", "");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);
  // stránkování (v1.72): prvních 300 podle priority, „Zobrazit další“ po 300
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [source, status, severity, q, who]);
  const query = useQuery({
    queryKey: ["findings", { source, status, severity, q, who, limit }],
    queryFn: () => api.findings.list({ source: source || undefined, status: status as "active", severity: severity || undefined, q: q || undefined, who: who || undefined, limit }),
    placeholderData: (prev) => prev,
  });
  const d = query.data;
  return (
    <>
      <PageHeader title={t("fnd.title")} subtitle={t("fnd.subtitle")} />
      <ErrorBox error={query.error} />
      {d && <SourceTiles d={d} active={source} onPick={(s) => setSource(s === source ? "" : s)} />}
      <EscalationCard />
      <PlanCard />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Select className="w-56" value={source} onChange={(e) => setSource(e.target.value as FindingSource | "")} aria-label={t("fnd.f.source")}>
            <option value="">{t("fnd.f.allSources")}</option>
            {FINDING_SOURCES.filter((s) => d?.sources.includes(s) ?? true).map((s) => (
              <option key={s} value={s}>
                {L.src(s)}
              </option>
            ))}
          </Select>
          <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("fnd.f.status")}>
            <option value="active">{t("fnd.f.active")}</option>
            {UNIFIED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {L.st(s)}
              </option>
            ))}
            <option value="all">{t("fnd.f.all")}</option>
          </Select>
          <Select className="w-40" value={severity} onChange={(e) => setSeverity(e.target.value as UnifiedSeverity | "")} aria-label={t("fnd.f.severity")}>
            <option value="">{t("fnd.f.allSeverities")}</option>
            {UNIFIED_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {L.sev(s)}
              </option>
            ))}
          </Select>
          <Select className="w-44" value={who} onChange={(e) => setWho(e.target.value as typeof who)} aria-label={t("fnd.f.who")} data-testid="fnd-who">
            <option value="">{t("fnd.f.whoAll")}</option>
            <option value="mine">{t("fnd.f.whoMine")}</option>
            <option value="team">{t("fnd.f.whoTeam")}</option>
          </Select>
          <Input className="max-w-xs" placeholder={t("fnd.f.search")} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("fnd.f.search")} />
          {d && <span className="ml-auto text-xs text-slate-500">{t("fnd.count", { n: d.total ?? d.items.length })}</span>}
        </div>
        <FindingsTable items={d?.items} loading={!d} focus={focus} />
      </Card>
      {d?.truncated && d.items.length < (d.total ?? 0) && limit < 1500 ? (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <span className="text-slate-500">{t("fnd.shown", { n: d.items.length, total: d.total ?? d.items.length })}</span>
          <Button variant="secondary" disabled={query.isFetching} onClick={() => setLimit((l) => Math.min(1500, l + PAGE))} data-testid="fnd-more">
            {t("fnd.more")}
          </Button>
        </div>
      ) : (
        d?.truncated && <p className="mt-2 text-xs text-amber-700">{t("fnd.truncated")}</p>
      )}
      <RemediationCard />
      <p className="mt-2 text-xs text-slate-500">{t("fnd.footnote")}</p>
    </>
  );
}

function SourceTiles({ d, active, onPick }: { d: UnifiedFindingsDto; active: string; onPick: (s: FindingSource) => void }) {
  const t = useT();
  const L = useLabels();
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="fnd-tiles">
      {FINDING_SOURCES.filter((s) => d.sources.includes(s)).map((s) => {
        const o = d.open[s];
        const total = UNIFIED_SEVERITIES.reduce((n, v) => n + o[v], 0);
        const hot = o.critical + o.high;
        return (
          <Kpi key={s} icon={srcIcon[s]} label={L.src(s)} value={total} note={t("fnd.tile.note", { hot, total })} noteTone={hot ? "red" : undefined} onClick={() => onPick(s)} active={active === s} />
        );
      })}
    </div>
  );
}

/** Tabulka nálezů – stránka Nálezy i karta aktiva. */
export function FindingsTable({ items, loading, focus, compact }: { items: UnifiedFindingDto[] | undefined; loading?: boolean; focus?: string; compact?: boolean }) {
  const t = useT();
  const L = useLabels();
  const router = useRouter();
  const can = useCan();
  const qc = useQueryClient();
  const [acting, setActing] = useState<UnifiedFindingDto | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const canHost = can("assets:write");
  const today = new Date().toISOString().slice(0, 10);
  const hostOpen = useMemo(() => (items ?? []).filter((f) => f.source === "host" && f.status === "open" && !f.task), [items]);
  const tasks = useMutation({
    mutationFn: (ids: string[]) => api.hosts.findingTasks(ids),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["actions"] });
      setSel([]);
      toast(t("fnd.tasksCreated", { n: r.created, u: r.unassigned }));
    },
  });
  useEffect(() => {
    if (focus) document.getElementById(`fnd-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, items]);
  if (loading) return <EmptyState>{t("common.loading")}</EmptyState>;
  if (!items?.length) return <EmptyState>{t("fnd.empty")}</EmptyState>;
  const go = (href: string) => (e: React.MouseEvent) => (e.preventDefault(), router.history.push(href));
  return (
    <>
      {canHost && can("actions:write") && hostOpen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs">
          <span className="text-slate-600">{t("fnd.bulk.hint", { n: hostOpen.length })}</span>
          <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={tasks.isPending} onClick={() => tasks.mutate(sel.length ? sel : hostOpen.map((f) => f.id))} data-testid="fnd-bulk-tasks">
            {sel.length ? t("fnd.bulk.selected", { n: sel.length }) : t("fnd.bulk.all")}
          </Button>
          <ErrorBox error={tasks.error} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">{t("fnd.col.finding")}</th>
              {!compact && <th scope="col" className="w-48 px-3 py-2">{t("fnd.col.asset")}</th>}
              <th scope="col" className="w-44 px-3 py-2">{t("fnd.col.owner")}</th>
              <th scope="col" className="w-44 px-3 py-2">{t("fnd.col.task")}</th>
              <th scope="col" className="w-40 px-3 py-2">{t("fnd.col.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((f) => {
              const pickable = canHost && f.source === "host" && f.status === "open" && !f.task;
              return (
                <tr key={f.key} id={`fnd-${f.id}`} className={cn("align-top", focus === f.id && "bg-brand-50/60")} data-testid="fnd-row">
                  <td className="px-4 py-2.5">
                    <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {pickable && (
                        <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300" checked={sel.includes(f.id)} onChange={(e) => setSel(e.target.checked ? [...sel, f.id] : sel.filter((x) => x !== f.id))} aria-label={`${t("fnd.pick")}: ${f.title}`} />
                      )}
                      <span className="inline-flex items-center gap-1">
                        {srcIcon[f.source]} {L.src(f.source)}
                      </span>
                      <Badge tone={sevTone[f.severity]}>{L.sev(f.severity)}</Badge>
                      <span className="tabular-nums text-slate-400" title={t("fnd.priorityHint")}>
                        {t("fnd.priority", { n: f.priority })}
                      </span>
                    </div>
                    <a href={f.link} onClick={go(f.link)} className="font-medium hover:text-brand-700">
                      {f.title}
                    </a>
                    {f.detail && <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{f.detail}</div>}
                  </td>
                  {!compact && (
                    <td className="px-3 py-2.5 text-xs">
                      {f.assetId && f.assetName ? (
                        <a href={`/assets/${f.assetId}`} onClick={go(`/assets/${f.assetId}`)} className="hover:text-brand-700">
                          {f.assetName}
                        </a>
                      ) : (
                        <span className="text-slate-400">{t("fnd.noAsset")}</span>
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-xs text-slate-700">{f.ownerName ?? <span className="text-amber-700">{t("fnd.noOwner")}</span>}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {f.task ? (
                      <a href={`/actions?task=${f.task.id}`} onClick={go(`/actions?task=${f.task.id}`)} className="hover:text-brand-700">
                        {f.task.code} · {t.lbl(TASK_LABELS.status[f.task.status as TaskStatus] ?? f.task.status)}
                        {f.task.dueDate && <div className="text-slate-500">{t("fnd.due", { date: fmtDay(f.task.dueDate) })}</div>}
                      </a>
                    ) : f.dueDate ? (
                      <span className={cn("text-slate-600", (f.status === "open" || f.status === "in_progress") && f.dueDate < today && "font-medium text-red-700")} title={f.dueFromSla ? t("fnd.slaHint") : undefined}>
                        {t(f.dueFromSla ? "fnd.dueSla" : "fnd.due", { date: fmtDay(f.dueDate) })}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <Badge tone={stTone[f.status]}>{L.st(f.status)}</Badge>
                    {f.acceptedUntil && f.status === "accepted" && <div className="mt-0.5 text-slate-600">{t("fnd.until", { date: fmtDay(f.acceptedUntil) })}</div>}
                    {canHost && f.source === "host" && (
                      <button type="button" className="mt-1 block text-brand-700 hover:underline" onClick={() => setActing(f)} data-testid="fnd-host-action">
                        {t("fnd.host.change")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {acting && <HostFindingModal f={acting} onClose={() => setActing(null)} />}
    </>
  );
}

function HostFindingModal({ f, onClose }: { f: UnifiedFindingDto; onClose: () => void }) {
  const t = useT();
  const L = useLabels();
  const qc = useQueryClient();
  const can = useCan();
  const year = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const [status, setStatus] = useState<"open" | "accepted" | "false_positive" | "fixed">(f.status === "open" ? "accepted" : "open");
  const [note, setNote] = useState("");
  const [until, setUntil] = useState(year);
  const needsNote = status === "accepted" || status === "false_positive";
  const done = () => {
    qc.invalidateQueries({ queryKey: ["findings"] });
    qc.invalidateQueries({ queryKey: ["exceptions"] });
    qc.invalidateQueries({ queryKey: ["actions"] });
    onClose();
  };
  const save = useMutation({ mutationFn: () => api.hosts.patchFinding(f.id, { status, note: note.trim() || null, until: status === "accepted" ? until || null : null }), onSuccess: done });
  const task = useMutation({ mutationFn: () => api.hosts.findingTasks([f.id]), onSuccess: done });
  return (
    <Modal
      open
      onClose={onClose}
      title={f.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("ui.confirm.cancel")}
          </Button>
          <Button disabled={save.isPending || (needsNote && note.trim().length < 5)} onClick={() => save.mutate()} data-testid="fnd-host-save">
            {t("fnd.host.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {f.detail} · {L.sev(f.severity)} · {L.st(f.status)}
      </p>
      {f.status === "open" && !f.task && can("actions:write") && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
          <span className="text-slate-600">{t("fnd.host.taskHint")}</span>
          <Button variant="secondary" disabled={task.isPending} onClick={() => task.mutate()} data-testid="fnd-host-task">
            {t("fnd.host.task")}
          </Button>
        </div>
      )}
      <Field label={t("fnd.host.newStatus")}>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t("fnd.host.newStatus")}>
          {(["open", "accepted", "false_positive", "fixed"] as const)
            .filter((s) => s !== (f.status === "dismissed" ? "false_positive" : f.status))
            .map((s) => (
              <option key={s} value={s}>
                {s === "false_positive" ? t("fnd.host.falsePositive") : L.st(s)}
              </option>
            ))}
        </Select>
      </Field>
      {status === "fixed" && <p className="text-xs text-slate-500">{t("fnd.host.fixedHint")}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={needsNote ? t("fnd.host.reason") : t("fnd.host.note")} className={status === "accepted" ? "sm:col-span-2" : "sm:col-span-3"}>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("fnd.host.reason")} />
        </Field>
        {status === "accepted" && (
          <Field label={t("st.acc.validTo")} hint={t("st.acc.validHint")}>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </Field>
        )}
      </div>
      <ErrorBox error={save.error ?? task.error} />
    </Modal>
  );
}

/** Karta aktiva „Nálezy“ – všechny zdroje nálezů aktiva (v1.65). */
export function AssetFindingsCard({ assetId }: { assetId: string }) {
  const t = useT();
  const L = useLabels();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ["findings", { assetId, all }], queryFn: () => api.findings.list({ assetId, status: all ? "all" : "active" }) });
  const d = q.data;
  const counts = d ? FINDING_SOURCES.filter((s) => d.sources.includes(s)).map((s) => ({ s, n: UNIFIED_SEVERITIES.reduce((a, v) => a + d.open[s][v], 0) })) : [];
  return (
    <Card className="overflow-hidden" data-testid="asset-findings">
      <CardHeader
        title={t("fnd.asset.title")}
        subtitle={counts.length ? counts.map((c) => `${L.src(c.s)}: ${c.n}`).join(" · ") : undefined}
        action={<Checkbox checked={all} onChange={setAll} label={t("fnd.asset.all")} />}
      />
      <ErrorBox error={q.error} />
      <FindingsTable items={d?.items} loading={!d} compact />
    </Card>
  );
}

export { ShieldAlert as FindingsIcon };

/** Náprava nálezů (v1.69): otevřené, po termínu, opravené za 12 měsíců, doba opravy, podíl v termínu. */
export function RemediationCard({ assetId }: { assetId?: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["findings", "remediation", assetId ?? null], queryFn: () => api.findings.remediation({ assetId }) });
  if (!q.data || (!q.data.total.open && !q.data.total.fixed)) return null;
  return (
    <Card className="mt-6 overflow-hidden" data-testid="fnd-remediation">
      <CardHeader title={t("fnd.rem.title")} subtitle={t("fnd.rem.subtitle", { from: fmtDay(q.data.from), to: fmtDay(q.data.to) })} />
      <RemediationTable d={q.data} />
    </Card>
  );
}

export function RemediationTable({ d }: { d: FindingsRemediationDto }) {
  const t = useT();
  const L = useLabels();
  const pct = (v: number | null) => (v == null ? "—" : `${v} %`);
  const row = (key: string, label: React.ReactNode, x: RemediationStat, strong = false) => (
    <tr key={key} className={cn(strong && "bg-slate-50 font-medium")}>
      <td className="px-4 py-2">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums">{x.open}</td>
      <td className={cn("px-3 py-2 text-right tabular-nums", x.overdue > 0 && "font-semibold text-red-700")}>{x.overdue}</td>
      <td className={cn("px-3 py-2 text-right tabular-nums", x.escalated > 0 && "font-semibold text-red-700")}>{x.escalated}</td>
      <td className="px-3 py-2 text-right tabular-nums">{x.fixed}</td>
      <td className="px-3 py-2 text-right tabular-nums">{x.avgDays == null ? "—" : x.avgDays.toLocaleString()}</td>
      <td className={cn("px-3 py-2 text-right tabular-nums", x.onTimePct != null && x.onTimePct < 80 && "text-amber-700")}>{pct(x.onTimePct)}</td>
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2">{t("fnd.rem.source")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("fnd.rem.open")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("fnd.rem.overdue")}</th>
            <th scope="col" className="px-3 py-2 text-right" title={t("fnd.rem.escalatedHint")}>{t("fnd.rem.escalated")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("fnd.rem.fixed")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("fnd.rem.days")}</th>
            <th scope="col" className="px-3 py-2 text-right">{t("fnd.rem.onTime")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {d.sources.map((s) => row(s, <span className="inline-flex items-center gap-1.5">{srcIcon[s]} {L.src(s)}</span>, d.bySource[s]))}
          {(["critical", "high", "medium"] as const).map((sv) => row(sv, <span className="pl-5 text-slate-600">{L.sev(sv)}</span>, d.total.bySeverity[sv]))}
          {row("total", t("fnd.rem.total"), d.total, true)}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-slate-500">{t("fnd.rem.note")}</p>
    </div>
  );
}

/** Plán oprav (v1.70): poslední plán společnosti, návrh lokálním modelem na pokyn. */
function PlanCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["findings", "plan"], queryFn: api.findings.plan, retry: false });
  const ai = useQuery({ queryKey: ["ai", "status"], queryFn: api.ai.status, enabled: can("ai:use"), staleTime: 60_000 });
  const gen = useMutation({ mutationFn: api.findings.generatePlan, onSuccess: (p) => qc.setQueryData(["findings", "plan"], p) });
  const mk = useMutation({
    mutationFn: (steps: number[]) => api.findings.planTasks(steps),
    onSuccess: (r) => {
      toast(t("fnd.plan.tasksCreated", { n: r.created }), "success");
      void qc.invalidateQueries({ queryKey: ["findings"] });
      void qc.invalidateQueries({ queryKey: ["actions"] });
    },
  });
  const p = q.data;
  const canGen = can("ai:use") && !!ai.data?.enabled;
  const canTask = can("actions:write");
  if (!p && !canGen) return null;
  const effort = (e: FindingPlanEffort | null) => (e ? t(`fnd.plan.effort.${e}` as const) : null);
  const without = p ? p.steps.map((s, i) => (!s.task && !s.done ? i : -1)).filter((i) => i >= 0) : [];
  const pct = p && p.progress.items ? Math.round((p.progress.resolved / p.progress.items) * 100) : 0;
  return (
    <Card className="mb-6 overflow-hidden" data-testid="fnd-plan">
      <CardHeader
        title={t("fnd.plan.title")}
        subtitle={p ? t("fnd.plan.subtitle", { date: fmtDay(p.generatedAt), n: p.considered, model: p.model }) : t("fnd.plan.empty")}
        action={
          <div className="flex flex-wrap gap-2">
            {canTask && without.length > 0 && (
              <Button disabled={mk.isPending} onClick={() => mk.mutate(without)} data-testid="fnd-plan-tasks">
                {t("fnd.plan.tasksAll", { n: without.length })}
              </Button>
            )}
            {canGen && (
              <Button variant="secondary" disabled={gen.isPending} onClick={() => gen.mutate()} data-testid="fnd-plan-generate">
                {gen.isPending ? t("fnd.plan.working") : p ? t("fnd.plan.again") : t("fnd.plan.generate")}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox error={gen.error ?? q.error ?? mk.error} />
      {p && (
        <div className="space-y-3 p-5 text-sm">
          {p.steps.length > 0 && (
            <div data-testid="fnd-plan-progress">
              <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
                <span>{t("fnd.plan.progress", { done: p.progress.done, steps: p.progress.steps, resolved: p.progress.resolved, items: p.progress.items })}</span>
                <span>{t("fnd.plan.withTask", { n: p.progress.withTask })}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("fnd.plan.progressLabel")}>
                <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}
          {p.summary && <p className="text-slate-700">{p.summary}</p>}
          <ol className="space-y-3">
            {p.steps.map((s, i) => (
              <li key={i} className={cn("rounded-md border p-3", s.done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200")} data-testid="fnd-plan-step">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("font-semibold", s.done ? "text-emerald-800" : "text-slate-900")}>
                    {i + 1}. {s.title}
                  </span>
                  {s.effort && <Badge tone="slate">{effort(s.effort)}</Badge>}
                  {s.done ? <Badge tone="green">{t("fnd.plan.stepDone")}</Badge> : <Badge tone="slate">{t("fnd.plan.stepResolved", { n: s.resolved, of: s.items.length })}</Badge>}
                  <span className="ml-auto text-xs">
                    {s.task ? (
                      <a href={`/actions?task=${s.task.id}`} onClick={(e) => (e.preventDefault(), router.history.push(`/actions?task=${s.task!.id}`))} className="text-slate-600 hover:text-brand-700">
                        {s.task.code} · {t.lbl(TASK_LABELS.status[s.task.status as TaskStatus] ?? s.task.status)}
                        {s.task.assigneeName ? ` · ${s.task.assigneeName}` : ""}
                        {s.task.dueDate ? ` · ${t("fnd.due", { date: fmtDay(s.task.dueDate) })}` : ""}
                      </a>
                    ) : (
                      canTask &&
                      !s.done && (
                        <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={mk.isPending} onClick={() => mk.mutate([i])}>
                          {t("fnd.plan.task")}
                        </Button>
                      )
                    )}
                  </span>
                </div>
                {s.why && <p className="mt-1 text-slate-600">{s.why}</p>}
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.items.map((it) => (
                    <li key={it.key}>
                      <a href={it.link} onClick={(e) => (e.preventDefault(), router.history.push(it.link))} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:text-brand-700">
                        <span className={cn("h-1.5 w-1.5 rounded-full", it.severity === "critical" || it.severity === "high" ? "bg-red-500" : it.severity === "medium" ? "bg-amber-500" : "bg-slate-400")} />
                        {it.title.slice(0, 80)}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">{t("fnd.plan.note")}</p>
        </div>
      )}
    </Card>
  );
}

/** Eskalace na mě (v1.71, ADR-164): aktiva podřízených garantů s nálezy po termínu déle než týden. */
function EscalationCard() {
  const t = useT();
  const router = useRouter();
  const q = useQuery({ queryKey: ["findings", "escalations"], queryFn: api.findings.escalations, retry: false });
  if (!q.data?.length) return null;
  return (
    <Card className="mb-6 overflow-hidden border-red-200" data-testid="fnd-escalations">
      <CardHeader title={t("fnd.esc.title", { n: q.data.length })} subtitle={t("fnd.esc.subtitle")} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">{t("fnd.esc.asset")}</th>
              <th scope="col" className="px-3 py-2">{t("fnd.esc.guarantor")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("fnd.esc.overdue")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("fnd.esc.days")}</th>
              <th scope="col" className="px-3 py-2 text-right">{t("fnd.esc.level")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.data.map((e) => (
              <tr key={e.assetId}>
                <td className="px-4 py-2">
                  <a href={`/assets/${e.assetId}?tab=tasks`} onClick={(ev) => (ev.preventDefault(), router.history.push(`/assets/${e.assetId}?tab=tasks`))} className="font-medium text-slate-900 hover:text-brand-700">
                    {e.assetName}
                  </a>
                </td>
                <td className="px-3 py-2 text-slate-700">{e.guarantorName ?? "—"}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-700">{e.overdue}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.daysOverdue}</td>
                <td className="px-3 py-2 text-right tabular-nums">{e.level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
