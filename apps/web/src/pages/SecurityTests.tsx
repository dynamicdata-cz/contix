import { TransferButton } from "@/components/transfer";
import { ProcessGuide } from "@/components/processGuide";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, Kpi } from "@/components/ui";
import { askConfirm } from "@/components/ui/overlay";
import { Tabs, useTab } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { SEVERITY_COLOR, STATUS_COLORS } from "@/components/health";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate, fmtDay } from "@/lib/utils";
import { useUrlParam } from "@/lib/urlState";
import {
  SECTEST_AREA_LABELS,
  SECTEST_CATEGORIES,
  SECTEST_CATEGORY_LABELS,
  SECURITY_TESTS,
  SECTEST_PRESETS,
  secTestDef,
  type SecTestCategory,
  type SecTestFindingDto,
  type SecTestScheduleDto,
  SECTEST_SCHEDULE_INTERVALS,
  type SecTestFindingStatus,
  type SecTestId,
  type SecTestRunDto,
  type SecTestScopeDto,
  type SecTestSeverity,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronRight, FileText, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

/* ============================================================
 * Bezpečnostní testy (v1.56, ADR-153): nálezy, běhy, rozsahy, katalog, sondy.
 * ============================================================ */

const TABS = ["findings", "runs", "schedules", "scopes", "catalog", "probes"] as const;
const SEV_TONE: Record<SecTestSeverity, "red" | "amber" | "slate" | "blue"> = { critical: "red", high: "red", medium: "amber", low: "slate", info: "slate" };
const RUN_TONE = { queued: "slate", running: "blue", done: "green", failed: "red", cancelled: "slate" } as const;

export function SecurityTestsPage() {
  const t = useT();
  const [tab, setTab] = useTab(TABS, "findings");
  const findings = useQuery({ queryKey: ["sectests", "findings"], queryFn: api.secTests.findings });
  const runs = useQuery({ queryKey: ["sectests", "runs"], queryFn: api.secTests.runs, refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === "queued" || r.status === "running") ? 10_000 : false) });
  const open = (findings.data ?? []).filter((f) => f.status === "open");
  return (
    <div data-testid="sectests">
      <PageHeader title={t("st.title")} subtitle={t("st.subtitle")} />
      <ProcessGuide id="sectests" />
      <SummaryTiles onFindings={() => setTab("findings")} onRuns={() => setTab("runs")} onProbes={() => setTab("probes")} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "findings", label: t("st.tab.findings"), badge: open.length ? <Badge tone={open.some((f) => f.severity === "critical" || f.severity === "high") ? "red" : "amber"}>{open.length}</Badge> : undefined },
          { key: "runs", label: t("st.tab.runs") },
          { key: "schedules", label: t("st.tab.schedules") },
          { key: "scopes", label: t("st.tab.scopes") },
          { key: "catalog", label: t("st.tab.catalog") },
          { key: "probes", label: t("st.tab.probes") },
        ]}
      />
      {tab === "findings" && <Findings list={findings.data ?? []} error={findings.error} />}
      {tab === "runs" && <Runs list={runs.data ?? []} error={runs.error} />}
      {tab === "schedules" && <Schedules />}
      {tab === "scopes" && <Scopes />}
      {tab === "catalog" && <Catalog />}
      {tab === "probes" && <Probes />}
    </div>
  );
}

/** Dlaždice nahoře (v1.57): otevřené nálezy podle závažnosti, testy za 30 dní, sondy. */
function SummaryTiles({ onFindings, onRuns, onProbes }: { onFindings: () => void; onRuns: () => void; onProbes: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["sectests", "overview"], queryFn: api.secTests.overview, staleTime: 30_000 });
  const s = q.data;
  if (!s) return null;
  const tile = (label: string, value: ReactNode, color: string | null, onClick: () => void, sub?: string) => <Kpi label={label} value={value} accent={color} onClick={onClick} note={sub} />;
  const online = s.probes.online;
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="st-tiles">
      {tile(t("st.sev.critical"), s.open.critical, SEVERITY_COLOR.critical, onFindings)}
      {tile(t("st.sev.high"), s.open.high, SEVERITY_COLOR.high, onFindings)}
      {tile(t("st.sev.medium"), s.open.medium, SEVERITY_COLOR.medium, onFindings)}
      {tile(t("st.sev.low"), s.open.low, SEVERITY_COLOR.low, onFindings)}
      {tile(t("dash.st.runs30"), s.runs30d, null, onRuns, s.active ? t("st.tiles.active", { n: s.active }) : s.lastRunAt ? t("dash.st.last", { date: fmtDate(s.lastRunAt) }) : undefined)}
      {tile(t("dash.st.probes"), `${online} / ${s.probes.total}`, s.probes.total ? (online ? STATUS_COLORS.good : STATUS_COLORS.serious) : null, onProbes, t("dash.st.fixed30") + `: ${s.fixed30d}`)}
    </div>
  );
}

function SevBadge({ s }: { s: SecTestSeverity }) {
  const t = useT();
  return <Badge tone={SEV_TONE[s]}>{t(`st.sev.${s}`)}</Badge>;
}

function Row({ summary, children, testId, open }: { summary: ReactNode; children: ReactNode; testId?: string; open?: boolean }) {
  return (
    <details className="group border-b border-slate-100 last:border-0" data-testid={testId} open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
        {summary}
      </summary>
      <div className="space-y-2 bg-slate-50 px-11 py-3 text-sm text-slate-700">{children}</div>
    </details>
  );
}

/* ---------- nálezy ---------- */

function Findings({ list, error }: { list: SecTestFindingDto[]; error: unknown }) {
  const t = useT();
  const [status, setStatus] = useState<SecTestFindingStatus | "all">("open");
  const [cat, setCat] = useState<SecTestCategory | "">("");
  const [q, setQ] = useState("");
  // odkaz z úkolu: ?finding=<id> – jen ten nález, rozbalený
  const [only, setOnly] = useUrlParam("finding", "");
  const rows = only
    ? list.filter((f) => f.id === only)
    : list.filter((f) => (status === "all" || f.status === status) && (!cat || secTestDef(f.testId)?.category === cat) && (!q || `${f.title} ${f.host} ${f.assetName ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Card>
      <CardHeader
        title={t("st.findings.title")}
        subtitle={t("st.findings.sub")}
        action={
          only ? (
            <Button variant="secondary" onClick={() => setOnly("")}>
              {t("st.task.showAll")}
            </Button>
          ) : (
          <div className="flex flex-wrap gap-2">
            <TasksForFindings list={rows} />
            <ReportLinks q={status === "open" ? {} : { all: "1" }} testId="st-findings-report" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("hd.search")} className="w-44" />
            <Select value={cat} onChange={(e) => setCat(e.target.value as SecTestCategory | "")} className="w-40">
              <option value="">{t("st.allCategories")}</option>
              {SECTEST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t.lbl(SECTEST_CATEGORY_LABELS[c])}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value as SecTestFindingStatus | "all")} className="w-40" aria-label={t("st.status")}>
              {(["open", "accepted", "false_positive", "fixed", "all"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`st.fstatus.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          )
        }
      />
      <ErrorBox error={error} />
      {!rows.length ? <EmptyState>{t("st.findings.empty")}</EmptyState> : rows.map((f) => <FindingRow key={f.id} f={f} open={!!only} />)}
    </Card>
  );
}

/** Hromadné založení úkolů pro zobrazené otevřené nálezy bez otevřeného úkolu (v1.60). */
export function TasksForFindings({ list }: { list: SecTestFindingDto[] }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const ids = list.filter((f) => f.status === "open" && f.severity !== "info" && !(f.task && (f.task.status === "open" || f.task.status === "in_progress"))).map((f) => f.id);
  const m = useMutation({
    mutationFn: () => api.secTests.createTasks(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }),
  });
  if (!can("sectests:run") || !can("actions:write")) return null;
  if (m.data)
    return (
      <span className="self-center text-xs text-slate-600" data-testid="st-tasks-result">
        {t("st.task.result", { created: m.data.created, existing: m.data.existing })}
        {m.data.unassigned > 0 && <span className="ml-1 text-amber-700">{t("st.task.unassigned", { n: m.data.unassigned })}</span>}
      </span>
    );
  if (!ids.length) return null;
  return (
    <Button
      variant="secondary"
      disabled={m.isPending}
      title={t("st.task.bulkHint")}
      onClick={async () => {
        if (await askConfirm(t("st.task.bulkConfirm"), { title: t("st.task.bulk", { n: ids.length }), confirmLabel: t("st.task.create"), danger: false })) m.mutate();
      }}
    >
      {t("st.task.bulk", { n: ids.length })}
    </Button>
  );
}

function FindingTask({ f }: { f: SecTestFindingDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api.secTests.createTasks([f.id]), onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }) });
  const tk = f.task;
  const live = tk && (tk.status === "open" || tk.status === "in_progress");
  if (tk && (live || f.status !== "open"))
    return (
      <p className="text-xs text-slate-600" data-testid="st-finding-task">
        {t("st.task.label")}{" "}
        <Link to="/actions" search={{ task: tk.id } as never} className="font-medium text-brand-700 hover:underline">
          {tk.code}
        </Link>{" "}
        · {t(`st.task.status.${tk.status}`)}
        {tk.dueDate && ` · ${t("st.task.due")} ${fmtDay(tk.dueDate)}`} · {tk.assigneeName ?? tk.ownerName ?? <span className="text-amber-700">{t("st.task.noOwner")}</span>}
        {tk.assigneeName && tk.ownerName && <span className="text-slate-400"> ({tk.ownerName})</span>}
      </p>
    );
  if (f.status !== "open" || !can("sectests:run") || !can("actions:write")) return null;
  return (
    <p className="text-xs">
      <button type="button" className="text-brand-700 hover:underline disabled:opacity-50" disabled={m.isPending} onClick={() => m.mutate()} data-testid="st-create-task">
        {t("st.task.create")}
      </button>
      <span className="ml-2 text-slate-500">{t("st.task.createHint")}</span>
      {m.error && <span className="ml-2 text-red-600">{(m.error as Error).message}</span>}
    </p>
  );
}

export function FindingRow({ f, open }: { f: SecTestFindingDto; open?: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const done = () => qc.invalidateQueries({ queryKey: ["sectests"] });
  const setStatus = useMutation({ mutationFn: (s: SecTestFindingStatus) => api.secTests.setFinding(f.id, s), onSuccess: done });
  const advice = useMutation({ mutationFn: () => api.secTests.advice(f.id), onSuccess: done });
  const follow = useMutation({ mutationFn: (ids: SecTestId[]) => api.secTests.followFinding(f.id, ids), onSuccess: done });
  const [assigning, setAssigning] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const a = f.advice;
  return (
    <Row
      testId={`st-finding-${f.code}`}
      open={open}
      summary={
        <>
          <SevBadge s={f.severity} />
          <span className="min-w-0 flex-1 truncate">{f.title}</span>
          <code className="text-xs text-slate-500">
            {f.host}
            {f.port ? `:${f.port}` : ""}
          </code>
          {f.task && (f.task.status === "open" || f.task.status === "in_progress") && <Badge tone="blue">{f.task.code}</Badge>}
          {f.status !== "open" && <Badge>{t(`st.fstatus.${f.status}`)}</Badge>}
        </>
      }
    >
      <p>{f.detail}</p>
      {f.evidence && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-600">{f.evidence}</pre>}
      <p className="text-xs text-slate-500">
        {t.lbl(secTestDef(f.testId)?.name ?? f.testId)} · {t("st.firstSeen")} {fmtDate(f.firstSeenAt)} · {t("st.lastSeen")} {fmtDate(f.lastSeenAt)}
        {" · "}
        {f.assetId ? (
          <Link to="/assets/$assetId" params={{ assetId: f.assetId }} className="text-brand-700 hover:underline">
            {f.assetName}
          </Link>
        ) : (
          <span className="text-amber-700">{t("st.asset.none")}</span>
        )}
        {can("sectests:run") && (
          <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setAssigning(!assigning)} data-testid="st-assign">
            {f.assetId ? t("st.asset.change") : t("st.asset.assign")}
          </button>
        )}
      </p>
      {f.owners && (
        <p className="text-xs text-slate-600" data-testid="st-finding-owners">
          {t("st.owners.technical")}: <b>{f.owners.technical ?? "—"}</b>
          {f.owners.deputy && (
            <>
              {" · "}
              {t("st.owners.deputy")}: <b>{f.owners.deputy}</b>
            </>
          )}
          {" · "}
          {t("st.owners.business")}: <b>{f.owners.business ?? "—"}</b>
          {!f.owners.technical && !f.owners.business && <span className="ml-1 text-amber-700">{t("st.owners.missing")}</span>}
        </p>
      )}
      {assigning && <AssignAsset f={f} onDone={() => setAssigning(false)} />}
      <FindingTask f={f} />
      <FindingControl f={f} />
      {f.status === "accepted" && (
        <p className="text-xs text-slate-600" data-testid="st-accepted">
          {t("st.acc.info", { name: f.acceptedByName ?? "—", date: f.acceptedAt ? fmtDay(f.acceptedAt) : "—" })}
          {" · "}
          {f.acceptedUntil ? t("st.acc.until", { date: fmtDay(f.acceptedUntil) }) : t("st.acc.noUntil")}
          {f.note && <span className="text-slate-500"> · {f.note}</span>}{" "}
          <Link to="/exceptions" className="text-brand-700 hover:underline">
            {t("st.acc.link")}
          </Link>
        </p>
      )}
      {accepting && <AcceptFinding f={f} onDone={() => setAccepting(false)} />}
      {a && (
        <div className="space-y-1 rounded-md border border-brand-100 bg-white p-3" data-testid="st-advice">
          <p className="text-xs font-semibold text-brand-700">
            <Sparkles size={12} className="mr-1 inline" />
            {t("st.ai.title", { model: a.model })}
          </p>
          <p>{a.summary}</p>
          {a.impact && (
            <p>
              <span className="font-medium">{t("st.ai.impact")}</span> {a.impact}
            </p>
          )}
          {a.remediation.length > 0 && (
            <ol className="list-decimal space-y-0.5 pl-5">
              {a.remediation.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          )}
          {a.verify && (
            <p>
              <span className="font-medium">{t("st.ai.verify")}</span> {a.verify}
            </p>
          )}
          {a.nextTests.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {t("st.ai.next")} {a.nextTests.map((x) => t.lbl(secTestDef(x)?.name ?? x)).join(", ")}
              {can("sectests:run") && (
                <Button variant="secondary" disabled={follow.isPending || follow.isSuccess} onClick={() => follow.mutate(a.nextTests)}>
                  {follow.isSuccess ? t("st.ai.nextQueued") : t("st.ai.runNext")}
                </Button>
              )}
            </div>
          )}
          {a.controlIds.length > 0 && (
            <p className="text-xs">
              {t("st.ai.controls")}{" "}
              {a.controlIds.map((id) => (
                <Link key={id} to="/controls/$controlId" params={{ controlId: id }} className="mr-2 text-brand-700 hover:underline">
                  {t("st.ai.control")}
                </Link>
              ))}
            </p>
          )}
          <p className="text-xs text-slate-400">{t("st.ai.disclaimer")}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {can("ai:use") && (
          <Button variant="secondary" disabled={advice.isPending} onClick={() => advice.mutate()}>
            <Sparkles size={14} /> {advice.isPending ? t("st.ai.working") : a ? t("st.ai.again") : t("st.ai.explain")}
          </Button>
        )}
        {can("sectests:run") &&
          (f.status === "open" ? (
            <>
              <Button variant="ghost" onClick={() => setAccepting(true)} data-testid="st-accept">
                {t("st.accept")}
              </Button>
              <Button variant="ghost" onClick={() => setStatus.mutate("false_positive")}>
                {t("st.falsePositive")}
              </Button>
              <Button variant="ghost" onClick={() => setStatus.mutate("fixed")}>
                {t("st.markFixed")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setStatus.mutate("open")}>
              {t("st.reopen")}
            </Button>
          ))}
      </div>
      <ErrorBox error={advice.error ?? setStatus.error ?? follow.error} />
    </Row>
  );
}

function AssignAsset({ f, onDone }: { f: SecTestFindingDto; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [sameHost, setSameHost] = useState(true);
  const found = useQuery({ queryKey: ["assets", "sectest-assign", q], queryFn: () => api.assets.list({ q, limit: 10, offset: 0 }), enabled: q.trim().length >= 2 });
  const save = useMutation({
    mutationFn: (assetId: string | null) => api.secTests.assignFinding(f.id, assetId, sameHost, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sectests"] });
      onDone();
    },
  });
  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3" data-testid="st-assign-form">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("st.assets.searchOne")} aria-label={t("st.assets.searchOne")} />
      {(found.data?.items ?? []).map((a) => (
        <button key={a.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-slate-50" onClick={() => save.mutate(a.id)}>
          <span className="flex-1">{a.name}</span>
          <code className="text-xs text-slate-500">{a.ipAddresses.join(", ")}</code>
        </button>
      ))}
      <Checkbox checked={sameHost} onChange={setSameHost} label={t("st.asset.sameHost", { host: f.host })} hint={t("st.asset.remember")} />
      <div className="flex gap-2">
        {f.assetId && (
          <Button variant="ghost" onClick={() => save.mutate(null)}>
            {t("st.asset.unassign")}
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>
          {t("st.cancel")}
        </Button>
      </div>
      <ErrorBox error={save.error} />
    </div>
  );
}

/* ---------- běhy ---------- */

function Runs({ list, error }: { list: SecTestRunDto[]; error: unknown }) {
  const t = useT();
  const can = useCan();
  const [mode, setMode] = useState<"run" | "import" | null>(null);
  return (
    <div className="space-y-4">
      {can("sectests:run") && (
        <div className="flex gap-2">
          <Button onClick={() => setMode("run")}>{t("st.run.new")}</Button>
          <Button variant="secondary" onClick={() => setMode("import")}>
            {t("st.import.new")}
          </Button>
        </div>
      )}
      {mode === "run" && <BatchForm onClose={() => setMode(null)} />}
      {mode === "import" && <RunForm mode="import" onClose={() => setMode(null)} />}
      <Batches />
      <Card>
        <CardHeader title={t("st.runs.title")} />
        <ErrorBox error={error} />
        {!list.length ? (
          <EmptyState>{t("st.runs.empty")}</EmptyState>
        ) : (
          <table className="w-full text-sm" data-testid="st-runs">
            <tbody className="divide-y divide-slate-100">
              {list.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2">
                    <Link to="/security-tests/runs/$runId" params={{ runId: r.id }} className="font-medium text-brand-700 hover:underline">
                      {t.lbl(secTestDef(r.testId)?.name ?? r.testId)}
                    </Link>
                    <div className="truncate text-xs text-slate-500">
                      {r.parentRunId && <Badge tone="violet">{t("st.followUp")}</Badge>} {r.targets.join(", ") || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {r.source === "import" ? t("st.src.import") : r.probeName ?? t("st.src.anyProbe")} · {r.scopeName}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={RUN_TONE[r.status]}>{t(`st.rstatus.${r.status}`)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.stats.critical + r.stats.high > 0 && <Badge tone="red">{r.stats.critical + r.stats.high}</Badge>} {r.stats.medium > 0 && <Badge tone="amber">{r.stats.medium}</Badge>} {r.stats.low > 0 && <Badge>{r.stats.low}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function RunForm({ mode, onClose }: { mode: "run" | "import"; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const scopes = useQuery({ queryKey: ["sectests", "scopes"], queryFn: api.secTests.scopes });
  const probes = useQuery({ queryKey: ["sectests", "probes"], queryFn: api.secTests.probes });
  const usable = (scopes.data ?? []).filter((s) => s.status === "approved");
  const [scopeId, setScopeId] = useState("");
  const [testId, setTestId] = useState<SecTestId>("net.ports");
  const [targets, setTargets] = useState("");
  const [ports, setPorts] = useState("");
  const [probeId, setProbeId] = useState("");
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const scope = usable.find((s) => s.id === (scopeId || usable[0]?.id));
  const def = secTestDef(testId)!;
  const tests = SECURITY_TESTS.filter((x) => !scope || scope.categories.includes(x.category));
  const portList = ports
    .split(/[\s,;]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isInteger(x) && x > 0 && x < 65536);
  const submit = useMutation({
    mutationFn: async () => {
      if (!scope) throw new Error(t("st.noScope"));
      if (mode === "run") return api.secTests.createRun({ scopeId: scope.id, testId, targets: targets.split(/[\s,;]+/).filter(Boolean), ports: portList, probeId: probeId || null });
      if (!file) throw new Error(t("st.import.noFile"));
      return api.secTests.importOutput({ scopeId: scope.id, testId, target: targets.trim(), fileName: file.name, content: file.content });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sectests"] });
      onClose();
    },
  });
  return (
    <Card className="space-y-3 p-5" data-testid="st-run-form">
      <h3 className="font-semibold text-slate-900">{mode === "run" ? t("st.run.new") : t("st.import.new")}</h3>
      {!usable.length && <p className="text-sm text-amber-700">{t("st.noScope")}</p>}
      <div className="flex flex-wrap gap-3">
        <Field label={t("st.scope")} className="w-64">
          <Select value={scope?.id ?? ""} onChange={(e) => setScopeId(e.target.value)}>
            {usable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("st.test")} className="w-72">
          <Select value={testId} onChange={(e) => setTestId(e.target.value as SecTestId)}>
            {tests.map((x) => (
              <option key={x.id} value={x.id}>
                {t.lbl(SECTEST_CATEGORY_LABELS[x.category])}: {t.lbl(x.name)}
              </option>
            ))}
          </Select>
        </Field>
        {mode === "run" && (
          <Field label={t("st.probe")} className="w-56">
            <Select value={probeId} onChange={(e) => setProbeId(e.target.value)}>
              <option value="">{t("st.src.anyProbe")}</option>
              {(probes.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <p className="text-xs text-slate-500">{t.lbl(def.description)}</p>
      <Field label={mode === "run" ? t("st.targets") : t("st.import.target")} hint={def.target === "url" ? t("st.targetsUrl") : t("st.targetsHost")}>
        <Textarea rows={mode === "run" ? 3 : 1} value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={def.target === "url" ? "https://web.firma.cz" : "192.0.2.242"} />
      </Field>
      {mode === "run" && def.target === "host" && (
        <Field label={t("st.ports")} hint={def.ports.length ? t("st.portsDefault", { ports: def.ports.join(", ") }) : t("st.portsTool")} className="w-96">
          <Input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder={def.ports.join(",")} />
        </Field>
      )}
      {mode === "import" && (
        <>
          <p className="text-xs text-slate-500">
            {t("st.import.how")} <code className="break-all">{def.command}</code>
          </p>
          <input
            type="file"
            aria-label={t("st.import.file")}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setFile(f ? { name: f.name, content: await f.text() } : null);
            }}
          />
        </>
      )}
      {mode === "run" && <p className="text-xs text-slate-500">{t("st.run.note")}</p>}
      <div className="flex gap-2">
        <Button disabled={submit.isPending || !scope} onClick={() => submit.mutate()}>
          {mode === "run" ? t("st.run.queue") : t("st.import.do")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("st.cancel")}
        </Button>
      </div>
      <ErrorBox error={submit.error} />
    </Card>
  );
}

/* ---------- sady: víc testů najednou (v1.56.1) ---------- */

function Batches() {
  const t = useT();
  const q = useQuery({ queryKey: ["sectests", "batches"], queryFn: api.secTests.batches, refetchInterval: (x) => ((x.state.data ?? []).some((b) => b.status === "running") ? 10_000 : false) });
  if (!q.data?.length) return null;
  return (
    <Card>
      <CardHeader title={t("st.batches.title")} subtitle={t("st.batches.sub")} />
      <table className="w-full text-sm" data-testid="st-batches">
        <tbody className="divide-y divide-slate-100">
          {q.data.slice(0, 30).map((b) => (
            <tr key={b.id}>
              <td className="px-5 py-2">
                <Link to="/security-tests/batches/$batchId" params={{ batchId: b.id }} className="font-medium text-brand-700 hover:underline">
                  {b.name}
                </Link>
                <div className="text-xs text-slate-500">
                  {t("st.batch.runs", { n: b.runs.length, done: b.runs.filter((r) => ["done", "failed", "cancelled"].includes(r.status)).length })}
                  {b.autoFollow && ` · ${t("st.batch.autoFollow")}`}
                  {b.autoAi && ` · ${t("st.batch.autoAi")}`}
                  {b.autoTasks && ` · ${t("st.batch.autoTasks")}`}
                  {b.diff && <DiffBadges diff={b.diff} />}
                </div>
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">{fmtDate(b.createdAt)}</td>
              <td className="px-3 py-2">
                <Badge tone={b.status === "done" ? "green" : "blue"}>{t(`st.batch.status.${b.status}`)}</Badge>
              </td>
              <td className="px-3 py-2 text-right">
                {b.stats.critical + b.stats.high > 0 && <Badge tone="red">{b.stats.critical + b.stats.high}</Badge>} {b.stats.medium > 0 && <Badge tone="amber">{b.stats.medium}</Badge>} {b.stats.low > 0 && <Badge>{b.stats.low}</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** Vyhledání aktiva → jeho IP adresy (nebo FQDN / hostname) jako cíle. */
function AssetTargets({ onAdd }: { onAdd: (targets: string[]) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const found = useQuery({ queryKey: ["assets", "sectest-targets", q], queryFn: () => api.assets.list({ q, limit: 10, offset: 0 }), enabled: q.trim().length >= 2 });
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("st.assets.search")} aria-label={t("st.assets.search")} />
      {q.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {found.data?.items.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">{t("my.nicNenalezeno")}</div>}
          {found.data?.items.map((a) => {
            const addr = a.ipAddresses.length ? a.ipAddresses : [a.fqdn ?? a.hostname].filter((x): x is string => !!x);
            return (
              <button
                type="button"
                key={a.id}
                disabled={!addr.length}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
                onClick={(e) => {
                  e.preventDefault();
                  onAdd(addr);
                  setQ("");
                }}
              >
                <span className="flex-1">{a.name}</span>
                <code className="text-xs text-slate-500">{addr.join(", ") || t("st.assets.noAddress")}</code>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BatchForm({ onClose, schedule }: { onClose: () => void; schedule?: SecTestScheduleDto | "new" }) {
  const sched = schedule === "new" ? null : (schedule ?? null);
  const isSchedule = !!schedule;
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const scopes = useQuery({ queryKey: ["sectests", "scopes"], queryFn: api.secTests.scopes });
  const probes = useQuery({ queryKey: ["sectests", "probes"], queryFn: api.secTests.probes });
  const usable = (scopes.data ?? []).filter((s) => s.status === "approved");
  const [scopeId, setScopeId] = useState(sched?.scopeId ?? "");
  const [tests, setTests] = useState<SecTestId[]>(sched?.testIds ?? ["net.ports"]);
  const [targets, setTargets] = useState(sched?.targets.join("\n") ?? "");
  const [ports, setPorts] = useState(sched?.ports.join(",") ?? "");
  const [probeId, setProbeId] = useState(sched?.probeId ?? "");
  const [name, setName] = useState(sched?.name ?? "");
  const [autoFollow, setAutoFollow] = useState(sched?.autoFollow ?? true);
  const [autoAi, setAutoAi] = useState(sched?.autoAi ?? false);
  const [autoTasks, setAutoTasks] = useState(sched?.autoTasks ?? can("actions:write"));
  const [intervalDays, setIntervalDays] = useState(sched?.intervalDays ?? 7);
  const [enabled, setEnabled] = useState(sched?.enabled ?? true);
  const scope = usable.find((s) => s.id === (scopeId || usable[0]?.id));
  const allowed = SECURITY_TESTS.filter((x) => !scope || scope.categories.includes(x.category));
  const toggle = (id: SecTestId, v: boolean) => setTests(v ? [...new Set([...tests, id])] : tests.filter((x) => x !== id));
  const submit = useMutation({
    mutationFn: () => {
      if (!scope) throw new Error(t("st.noScope"));
      const portList = ports
        .split(/[\s,;]+/)
        .map(Number)
        .filter((x) => Number.isInteger(x) && x > 0 && x < 65536);
      const body = { scopeId: scope.id, name, testIds: tests, targets: targets.split(/[\s,;]+/).filter(Boolean), ports: portList, probeId: probeId || null, autoFollow, autoAi, autoTasks };
      if (isSchedule) {
        const s = { ...body, name: name || t("st.sch.defaultName"), intervalDays, enabled };
        return (sched ? api.secTests.updateSchedule(sched.id, s) : api.secTests.createSchedule(s)) as Promise<unknown>;
      }
      return api.secTests.createBatch(body) as Promise<unknown>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sectests"] });
      onClose();
    },
  });
  return (
    <Card className="space-y-4 p-5" data-testid="st-batch-form">
      <h3 className="font-semibold text-slate-900">{isSchedule ? (sched ? t("st.sch.edit") : t("st.sch.new")) : t("st.run.new")}</h3>
      {!usable.length && <p className="text-sm text-amber-700">{t("st.noScope")}</p>}
      <div className="flex flex-wrap gap-3">
        <Field label={t("st.scope")} className="w-64">
          <Select value={scope?.id ?? ""} onChange={(e) => setScopeId(e.target.value)}>
            {usable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("st.probe")} className="w-56">
          <Select value={probeId} onChange={(e) => setProbeId(e.target.value)}>
            <option value="">{t("st.src.anyProbe")}</option>
            {(probes.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("st.batch.name")} className="w-64">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("st.batch.namePh")} />
        </Field>
        {isSchedule && (
          <Field label={t("st.sch.interval")} className="w-44">
            <Select value={intervalDays} onChange={(e) => setIntervalDays(Number(e.target.value))}>
              {SECTEST_SCHEDULE_INTERVALS.map((d) => (
                <option key={d} value={d}>
                  {t(`st.sch.every.${d}` as "st.sch.every.7")}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-slate-700">{t("st.batch.tests")}</p>
        <div className="mb-2 flex flex-wrap gap-2">
          {SECTEST_PRESETS.map((p) => (
            <Button key={p.id} variant="secondary" onClick={() => setTests(p.tests.filter((x) => allowed.some((a) => a.id === x)))}>
              {t.lbl(p.name)}
            </Button>
          ))}
        </div>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {allowed.map((x) => (
            <Checkbox key={x.id} checked={tests.includes(x.id)} onChange={(v) => toggle(x.id, v)} label={`${t.lbl(SECTEST_CATEGORY_LABELS[x.category])}: ${t.lbl(x.name)}`} />
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={t("st.targets")} hint={t("st.batch.targetsHint")}>
          <Textarea rows={4} value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={"192.0.2.242\nweb.firma.cz\nhttps://web.firma.cz"} />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">{t("st.assets.add")}</p>
          <AssetTargets onAdd={(a) => setTargets([...new Set([...targets.split(/[\s,;]+/).filter(Boolean), ...a])].join("\n"))} />
          {tests.includes("net.services") && (
            <Field label={t("st.ports")} hint={t("st.batch.portsHint")}>
              <Input value={ports} onChange={(e) => setPorts(e.target.value)} placeholder={secTestDef("net.services")!.ports.join(",")} />
            </Field>
          )}
        </div>
      </div>
      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
        <Checkbox checked={autoFollow} onChange={setAutoFollow} label={t("st.batch.autoFollowLabel")} hint={t("st.batch.autoFollowHint")} />
        <Checkbox checked={autoAi} onChange={setAutoAi} disabled={!can("ai:use")} label={t("st.batch.autoAiLabel")} hint={t("st.batch.autoAiHint")} />
        <Checkbox checked={autoTasks} onChange={setAutoTasks} disabled={!can("actions:write")} label={t("st.batch.autoTasksLabel")} hint={t("st.batch.autoTasksHint")} />
        {isSchedule && <Checkbox checked={enabled} onChange={setEnabled} label={t("st.sch.enabled")} hint={t("st.sch.enabledHint")} />}
      </div>
      <p className="text-xs text-slate-500">{t("st.run.note")}</p>
      <div className="flex gap-2">
        <Button disabled={submit.isPending || !scope || !tests.length || !targets.trim()} onClick={() => submit.mutate()} data-testid="st-batch-submit">
          {isSchedule ? t("st.sch.save") : t("st.batch.queue", { n: tests.length })}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("st.cancel")}
        </Button>
      </div>
      <ErrorBox error={submit.error} />
    </Card>
  );
}

export function SecurityTestBatchPage() {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const { batchId } = useParams({ strict: false }) as { batchId: string };
  const q = useQuery({ queryKey: ["sectests", "batch", batchId], queryFn: () => api.secTests.batch(batchId), refetchInterval: (x) => (x.state.data?.status === "running" ? 5000 : false) });
  const summary = useMutation({ mutationFn: () => api.secTests.batchSummary(batchId), onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }) });
  const next = useMutation({ mutationFn: (ids: SecTestId[]) => api.secTests.batchNext(batchId, ids), onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }) });
  if (q.error) return <ErrorBox error={q.error} />;
  const b = q.data;
  if (!b) return null;
  const sm = b.summary;
  return (
    <div className="space-y-4" data-testid="st-batch">
      <PageHeader
        title={b.name}
        subtitle={`${b.scopeName} · ${fmtDate(b.createdAt)}${b.requestedByName ? ` · ${b.requestedByName}` : ""}`}
        badge={<Badge tone={b.status === "done" ? "green" : "blue"}>{t(`st.batch.status.${b.status}`)}</Badge>}
        actions={
          b.status === "done" && can("ai:use") ? (
            <Button variant="secondary" disabled={summary.isPending} onClick={() => summary.mutate()}>
              <Sparkles size={14} /> {summary.isPending ? t("st.ai.working") : t("st.ai.summary")}
            </Button>
          ) : undefined
        }
      />
      <ErrorBox error={summary.error ?? next.error} />
      {b.autoAi && b.status === "running" && <Card className="p-4 text-sm text-slate-600">{t("st.batch.aiPending")}</Card>}
      {sm && <SummaryCard sm={sm} onRun={can("sectests:run") ? (ids) => next.mutate(ids) : undefined} running={next.isPending} done={next.isSuccess} />}
      <Card>
        <CardHeader title={t("st.runs.title")} />
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {b.runs.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2">
                  <Link to="/security-tests/runs/$runId" params={{ runId: r.id }} className="font-medium text-brand-700 hover:underline">
                    {t.lbl(secTestDef(r.testId)?.name ?? r.testId)}
                  </Link>
                  <div className="truncate text-xs text-slate-500">
                    {r.parentRunId && <Badge tone="violet">{t("st.followUp")}</Badge>} {r.targets.join(", ")}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={RUN_TONE[r.status]}>{t(`st.rstatus.${r.status}`)}</Badge>
                  {r.error && <div className="text-xs text-red-700">{r.error}</div>}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.stats.critical + r.stats.high > 0 && <Badge tone="red">{r.stats.critical + r.stats.high}</Badge>} {r.stats.medium > 0 && <Badge tone="amber">{r.stats.medium}</Badge>} {r.stats.low > 0 && <Badge>{r.stats.low}</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardHeader
          title={t("st.findings.title")}
          action={
            <div className="flex flex-wrap gap-2">
              {b.status === "done" && <TasksForFindings list={b.findings} />}
              <ReportLinks q={{ batchIds: b.id, all: "1" }} testId="st-batch-report" />
            </div>
          }
        />
        {!b.findings.length ? <EmptyState>{b.status === "done" ? t("st.run.clean") : t("st.run.waiting")}</EmptyState> : b.findings.map((f) => <FindingRow key={f.id} f={f} />)}
      </Card>
    </div>
  );
}

function SummaryCard({ sm, onRun, running, done }: { sm: NonNullable<SecTestRunDto["summary"]>; onRun?: (ids: SecTestId[]) => void; running?: boolean; done?: boolean }) {
  const t = useT();
  return (
    <Card className="space-y-2 p-5 text-sm" data-testid="st-summary">
      <p className="text-xs font-semibold text-brand-700">
        <Sparkles size={12} className="mr-1 inline" />
        {t("st.ai.title", { model: sm.model })}
      </p>
      <h3 className="font-semibold">{t("st.sum.management")}</h3>
      <p className="whitespace-pre-line">{sm.management}</p>
      {sm.technical && (
        <>
          <h3 className="font-semibold">{t("st.sum.technical")}</h3>
          <p className="whitespace-pre-line">{sm.technical}</p>
        </>
      )}
      {sm.priorities.length > 0 && (
        <ul className="list-disc pl-5">
          {sm.priorities.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      {sm.nextTests.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {t("st.ai.next")} {sm.nextTests.map((x) => t.lbl(secTestDef(x)?.name ?? x)).join(", ")}
          {onRun && (
            <Button variant="secondary" disabled={running || done} onClick={() => onRun(sm.nextTests)} data-testid="st-run-next">
              {done ? t("st.ai.nextQueued") : t("st.ai.runNext")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/* ---------- rozsahy ---------- */

function Scopes() {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const q = useQuery({ queryKey: ["sectests", "scopes"], queryFn: api.secTests.scopes });
  const [edit, setEdit] = useState<SecTestScopeDto | "new" | null>(null);
  const approve = useMutation({ mutationFn: api.secTests.approveScope, onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }) });
  const remove = useMutation({
    mutationFn: async (s: SecTestScopeDto) => {
      if (await askConfirm(t("st.scope.deleteConfirm", { name: s.name }), { danger: true })) await api.secTests.deleteScope(s.id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }),
  });
  const tone = { draft: "amber", approved: "green", expired: "slate" } as const;
  return (
    <div className="space-y-4">
      <Card className="p-5 text-sm text-slate-600">{t("st.scopes.intro")}</Card>
      {can("sectests:run") && <Button onClick={() => setEdit("new")}>{t("st.scope.new")}</Button>}
      {edit && <ScopeForm s={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      <ErrorBox error={q.error ?? approve.error ?? remove.error} />
      {(q.data ?? []).map((s) => (
        <Card key={s.id} className="space-y-2 p-5 text-sm" data-testid={`st-scope-${s.name}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{s.name}</span>
            <Badge tone={tone[s.status]}>{t(`st.scope.status.${s.status}`)}</Badge>
            <span className="text-xs text-slate-500">
              {s.validFrom} – {s.validTo}
            </span>
            <span className="flex-1" />
            {s.status === "draft" && can("sectests:approve") && (
              <Button onClick={() => approve.mutate(s.id)} data-testid="st-scope-approve">
                {t("st.scope.approve")}
              </Button>
            )}
            {can("sectests:run") && (
              <Button variant="secondary" onClick={() => setEdit(s)}>
                {t("st.edit")}
              </Button>
            )}
            {can("sectests:approve") && <TransferButton entity="sectest_scopes" id={s.id} companyId={s.companyId} />}
            {can("sectests:approve") && (
              <Button variant="ghost" className="text-red-700" onClick={() => remove.mutate(s)}>
                {t("st.delete")}
              </Button>
            )}
          </div>
          <p>
            <span className="text-slate-500">{t("st.scope.targets")}</span> <code className="text-xs">{s.targets.join(", ")}</code>
            {s.exclusions.length > 0 && (
              <>
                {" · "}
                <span className="text-slate-500">{t("st.scope.exclusions")}</span> <code className="text-xs">{s.exclusions.join(", ")}</code>
              </>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {s.categories.map((c) => t.lbl(SECTEST_CATEGORY_LABELS[c])).join(", ")} · {t("st.scope.auth")} {s.authorization}
          </p>
          <p className="text-xs text-slate-500">
            {t("st.scope.createdBy", { name: s.createdByName ?? "—" })}
            {s.approvedByName && ` · ${t("st.scope.approvedBy", { name: s.approvedByName, date: fmtDate(s.approvedAt) })}`} · {t("st.scope.runs", { n: s.runs })}
          </p>
        </Card>
      ))}
    </div>
  );
}

function ScopeForm({ s, onClose }: { s: SecTestScopeDto | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const d = new Date();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const [name, setName] = useState(s?.name ?? "");
  const [targets, setTargets] = useState(s?.targets.join("\n") ?? "");
  const [exclusions, setExclusions] = useState(s?.exclusions.join("\n") ?? "");
  const [validFrom, setFrom] = useState(s?.validFrom ?? iso(d));
  const [validTo, setTo] = useState(s?.validTo ?? iso(new Date(d.getTime() + 30 * 86400_000)));
  const [authorization, setAuth] = useState(s?.authorization ?? "");
  const [cats, setCats] = useState<SecTestCategory[]>(s?.categories ?? [...SECTEST_CATEGORIES]);
  const lines = (v: string) => v.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, targets: lines(targets), exclusions: lines(exclusions), validFrom, validTo, authorization, categories: cats };
      return s ? api.secTests.updateScope(s.id, body) : api.secTests.createScope(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sectests"] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={s ? t("st.scope.edit") : t("st.scope.new")} wide footer={
      <>
        <Button variant="ghost" onClick={onClose}>
          {t("st.cancel")}
        </Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {t("st.save")}
        </Button>
      </>
    }>
      <div className="space-y-3">
        <Field label={t("st.scope.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("st.scope.namePh")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("st.scope.targets")} hint={t("st.scope.targetsHint")}>
            <Textarea rows={5} value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={"192.0.2.0/24\n*.firma.cz\nhttps://web.firma.cz"} />
          </Field>
          <Field label={t("st.scope.exclusions")} hint={t("st.scope.exclusionsHint")}>
            <Textarea rows={5} value={exclusions} onChange={(e) => setExclusions(e.target.value)} placeholder="192.0.2.1" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label={t("st.scope.from")} className="w-44">
            <Input type="date" value={validFrom} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t("st.scope.to")} className="w-44">
            <Input type="date" value={validTo} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label={t("st.scope.auth")} hint={t("st.scope.authHint")}>
          <Textarea rows={2} value={authorization} onChange={(e) => setAuth(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-4">
          {SECTEST_CATEGORIES.map((c) => (
            <Checkbox key={c} checked={cats.includes(c)} onChange={(v) => setCats(v ? [...cats, c] : cats.filter((x) => x !== c))} label={t.lbl(SECTEST_CATEGORY_LABELS[c])} />
          ))}
        </div>
        {s?.status === "approved" && <p className="text-xs text-amber-700">{t("st.scope.reapprove")}</p>}
        <ErrorBox error={save.error} />
      </div>
    </Modal>
  );
}

/* ---------- katalog ---------- */

function Catalog() {
  const t = useT();
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="st-catalog">
      {SECURITY_TESTS.map((x) => (
        <Card key={x.id} className="space-y-2 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t.lbl(SECTEST_CATEGORY_LABELS[x.category])}</Badge>
            <span className="font-semibold text-slate-900">{t.lbl(x.name)}</span>
            <code className="text-xs text-slate-400">{x.id}</code>
          </div>
          <p className="text-slate-600">{t.lbl(x.description)}</p>
          <p className="text-xs text-slate-500">
            {t("st.cat.tool")} <code>{x.tool}</code> · {x.areas.map((a) => t.lbl(SECTEST_AREA_LABELS[a])).join(", ")}
          </p>
          <code className="block break-all rounded bg-slate-50 p-2 text-xs text-slate-700">{x.command}</code>
          {x.next.length > 0 && <p className="text-xs text-slate-500">{t("st.ai.next")} {x.next.map((n) => t.lbl(secTestDef(n)?.name ?? n)).join(", ")}</p>}
        </Card>
      ))}
    </div>
  );
}

/* ---------- sondy ---------- */

function Probes() {
  const t = useT();
  const q = useQuery({ queryKey: ["sectests", "probes"], queryFn: api.secTests.probes, refetchInterval: 30_000 });
  const online = (at: string | null) => !!at && Date.now() - new Date(at).getTime() < 3 * 60_000;
  return (
    <div className="space-y-4">
      <Card className="p-5 text-sm text-slate-600">{t("st.probes.intro")}</Card>
      <ErrorBox error={q.error} />
      {!(q.data ?? []).length && <EmptyState>{t("st.probes.empty")}</EmptyState>}
      {(q.data ?? []).map((p) => (
        <Card key={p.id} className="space-y-2 p-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{p.name}</span>
            {online(p.lastSeenAt) ? <Badge tone="green">{t("st.probe.online")}</Badge> : <Badge tone="slate">{t("st.probe.offline")}</Badge>}
            <span className="text-xs text-slate-500">
              {p.hostname ?? "—"} · {t("st.probe.version", { v: p.version ?? "?" })} · {p.lastSeenAt ? t("st.probe.seen", { date: fmtDate(p.lastSeenAt) }) : t("st.probe.never")} · {t("st.probe.queued", { n: p.queued })}
            </span>
          </div>
          <p className="flex flex-wrap gap-1.5 text-xs">
            {Object.entries(p.tools).map(([k, v]) => (
              <Badge key={k} tone={v ? "green" : "amber"}>
                {k}
                {v ? "" : ` – ${t("st.probe.missing")}`}
              </Badge>
            ))}
          </p>
        </Card>
      ))}
    </div>
  );
}

/* ---------- detail běhu ---------- */

export function SecurityTestRunPage() {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const { runId } = useParams({ strict: false }) as { runId: string };
  const q = useQuery({ queryKey: ["sectests", "run", runId], queryFn: () => api.secTests.run(runId), refetchInterval: (x) => (x.state.data && ["queued", "running"].includes(x.state.data.status) ? 5000 : false) });
  const summary = useMutation({ mutationFn: () => api.secTests.summary(runId), onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }) });
  const cancel = useMutation({ mutationFn: () => api.secTests.cancelRun(runId), onSuccess: () => qc.invalidateQueries({ queryKey: ["sectests"] }) });
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data;
  if (!r) return null;
  const def = secTestDef(r.testId);
  const sm = r.summary;
  return (
    <div className="space-y-4" data-testid="st-run">
      <PageHeader
        title={t.lbl(def?.name ?? r.testId)}
        subtitle={`${r.scopeName} · ${r.source === "import" ? t("st.src.import") : r.probeName ?? t("st.src.anyProbe")}`}
        badge={<Badge tone={RUN_TONE[r.status]}>{t(`st.rstatus.${r.status}`)}</Badge>}
        actions={
          <div className="flex gap-2">
            {r.status === "queued" && can("sectests:run") && (
              <Button variant="secondary" onClick={() => cancel.mutate()}>
                {t("st.run.cancel")}
              </Button>
            )}
            {r.status === "done" && can("ai:use") && (
              <Button variant="secondary" disabled={summary.isPending} onClick={() => summary.mutate()}>
                <Sparkles size={14} /> {summary.isPending ? t("st.ai.working") : t("st.ai.summary")}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox error={r.error ? new Error(r.error) : (summary.error ?? cancel.error)} />
      <Card className="p-5 text-sm">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">{t("st.targets")}</dt>
            <dd className="break-all">{r.targets.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t("st.ports")}</dt>
            <dd>{r.ports.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t("st.run.time")}</dt>
            <dd>
              {fmtDate(r.createdAt)}
              {r.finishedAt ? ` → ${fmtDate(r.finishedAt)}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">{t("st.run.requested")}</dt>
            <dd>{r.requestedByName ?? "—"}</dd>
          </div>
        </dl>
        {r.warnings.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">
            {r.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </Card>
      {sm && <SummaryCard sm={sm} />}
      {r.facts.length > 0 && (
        <Card>
          <CardHeader title={t("st.facts")} />
          <table className="w-full text-sm" data-testid="st-facts">
            <tbody className="divide-y divide-slate-100">
              {r.facts.map((h) => (
                <tr key={h.host} className="align-top">
                  <td className="px-5 py-2 font-mono text-xs">
                    {h.host}
                    {h.hostname && <div className="text-slate-500">{h.hostname}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {h.ports.length
                      ? h.ports.map((p) => (
                          <div key={`${p.proto}${p.port}`}>
                            <code>
                              {p.proto}/{p.port}
                            </code>{" "}
                            {p.service} <span className="text-slate-500">{[p.product, p.version].filter(Boolean).join(" ")}</span>
                          </div>
                        ))
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card>
        <CardHeader title={t("st.findings.title")} />
        {!r.findings.length ? <EmptyState>{r.status === "done" ? t("st.run.clean") : t("st.run.waiting")}</EmptyState> : r.findings.map((f) => <FindingRow key={f.id} f={f} />)}
      </Card>
      {r.outputs.length > 0 && (
        <Card>
          <CardHeader title={t("st.outputs")} subtitle={t("st.outputsSub")} />
          {r.outputs.map((o, i) => (
            <Row key={i} summary={<span className="font-mono text-xs">{o.target}{o.port ? `:${o.port}` : ""} · exit {o.exitCode ?? "?"} · {Math.round(o.durationMs / 1000)} s{o.truncated ? ` · ${t("st.truncated")}` : ""}</span>}>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{o.stdout || o.stderr || "—"}</pre>
            </Row>
          ))}
        </Card>
      )}
    </div>
  );
}

/** Nálezy testů u aktiva (detail aktiva). */
export function AssetSecTestsCard({ assetId }: { assetId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["sectests", "asset", assetId], queryFn: () => api.secTests.byAsset(assetId) });
  if (!q.data?.length) return null;
  return (
    <Card className="lg:col-span-3" data-testid="asset-sectests">
      <CardHeader title={t("st.asset.title")} action={<Link to="/security-tests" className="text-sm text-brand-700 hover:underline">{t("st.title")}</Link>} />
      {q.data.map((f) => (
        <FindingRow key={f.id} f={f} />
      ))}
    </Card>
  );
}

/* ---------- pravidelné testy (v1.63) ---------- */

function Schedules() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["sectests", "schedules"], queryFn: api.secTests.schedules });
  const [edit, setEdit] = useState<SecTestScheduleDto | "new" | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ["sectests"] });
  const run = useMutation({ mutationFn: (id: string) => api.secTests.runSchedule(id), onSuccess: done });
  const remove = useMutation({ mutationFn: (id: string) => api.secTests.deleteSchedule(id), onSuccess: done });
  if (edit) return <BatchForm schedule={edit} onClose={() => setEdit(null)} />;
  return (
    <Card data-testid="st-schedules">
      <CardHeader
        title={t("st.sch.title")}
        subtitle={t("st.sch.sub")}
        action={
          can("sectests:run") ? (
            <Button onClick={() => setEdit("new")} data-testid="st-sch-new">
              {t("st.sch.new")}
            </Button>
          ) : undefined
        }
      />
      <ErrorBox error={list.error ?? run.error ?? remove.error} />
      {!list.data?.length ? (
        <EmptyState>{t("st.sch.empty")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">{t("st.sch.name")}</th>
              <th className="px-3 py-2">{t("st.sch.interval")}</th>
              <th className="px-3 py-2">{t("st.sch.next")}</th>
              <th className="px-3 py-2">{t("st.sch.last")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data.map((s) => (
              <tr key={s.id} data-testid={`st-sch-${s.name}`} className={s.enabled ? "" : "text-slate-400"}>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {s.scopeName} · {s.testIds.length} {t("st.sch.tests")} · {s.targets.slice(0, 3).join(", ")}
                    {s.targets.length > 3 ? "…" : ""}
                  </div>
                  {s.lastError && <div className="text-xs text-red-700">{s.lastError}</div>}
                </td>
                <td className="px-3 py-2.5">{t(`st.sch.every.${s.intervalDays}` as "st.sch.every.7")}</td>
                <td className="px-3 py-2.5">{s.enabled ? fmtDate(s.nextRunAt) : t("st.sch.off")}</td>
                <td className="px-3 py-2.5">
                  {s.lastBatch ? (
                    <Link to="/security-tests/batches/$batchId" params={{ batchId: s.lastBatch.id }} className="text-brand-700 hover:underline">
                      {fmtDate(s.lastBatch.createdAt)}
                    </Link>
                  ) : (
                    "—"
                  )}
                  {s.lastBatch?.diff && <DiffBadges diff={s.lastBatch.diff} />}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  {can("sectests:run") && (
                    <>
                      <Button variant="ghost" disabled={run.isPending} onClick={() => run.mutate(s.id)}>
                        {t("st.sch.runNow")}
                      </Button>
                      <Button variant="ghost" onClick={() => setEdit(s)}>
                        {t("st.sch.editBtn")}
                      </Button>
                      <Button variant="ghost" onClick={async () => (await askConfirm(t("st.sch.deleteConfirm", { name: s.name }))) && remove.mutate(s.id)}>
                        {t("st.sch.delete")}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Rozdíl sady z plánu proti předchozímu stavu: nové / opravené nálezy. */
export function DiffBadges({ diff }: { diff: NonNullable<SecTestScheduleDto["lastBatch"]>["diff"] }) {
  const t = useT();
  if (!diff) return null;
  return (
    <span className="ml-2 inline-flex gap-1 text-xs" data-testid="st-diff">
      <Badge tone={diff.newHigh ? "red" : diff.new ? "amber" : "slate"}>{t("st.sch.new_n", { n: diff.new })}</Badge>
      <Badge tone={diff.fixed ? "green" : "slate"}>{t("st.sch.fixed_n", { n: diff.fixed })}</Badge>
    </span>
  );
}

/** Odkazy na zprávu z testů (tisk / PDF a Word). */
export function ReportLinks({ q, testId }: { q: { batchIds?: string; from?: string; to?: string; all?: "1" }; testId?: string }) {
  const t = useT();
  return (
    <span className="inline-flex gap-2" data-testid={testId}>
      <a href={api.secTests.reportUrl(q, "html")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
        <FileText size={14} /> {t("st.rep.pdf")}
      </a>
      <a href={api.secTests.reportUrl(q, "docx")} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50">
        {t("st.rep.word")}
      </a>
    </span>
  );
}

/** Vazba nálezu na opatření – doklad účinnosti (v1.63). */
function FindingControl({ f }: { f: SecTestFindingDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const controls = useQuery({ queryKey: ["controls", "list"], queryFn: () => api.controls.list({}), enabled: open });
  const set = useMutation({ mutationFn: (id: string | null) => api.secTests.setControl(f.id, id), onSuccess: () => { qc.invalidateQueries({ queryKey: ["sectests"] }); setOpen(false); } });
  return (
    <p className="text-xs text-slate-600" data-testid="st-finding-control">
      {t("st.ctl.label")}{" "}
      {f.controlId ? (
        <Link to="/controls/$controlId" params={{ controlId: f.controlId }} className="text-brand-700 hover:underline">
          {f.controlLabel}
        </Link>
      ) : (
        <span className="text-slate-400">{t("st.ctl.none")}</span>
      )}
      {can("sectests:run") && !open && (
        <button type="button" className="ml-2 text-brand-700 hover:underline" onClick={() => setOpen(true)}>
          {f.controlId ? t("st.ctl.change") : t("st.ctl.assign")}
        </button>
      )}
      {open && (
        <Select className="ml-2 inline-block w-72 py-1 text-xs" value={f.controlId ?? ""} aria-label={t("st.ctl.label")} onChange={(e) => set.mutate(e.target.value || null)}>
          <option value="">{t("st.ctl.none")}</option>
          {(controls.data ?? [])
            .filter((c) => c.companyId === f.companyId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} ` : ""}
                {c.name}
              </option>
            ))}
        </Select>
      )}
    </p>
  );
}

/** Karta na detailu opatření: nálezy bezpečnostních testů navázané na opatření (doklad účinnosti). */
export function ControlSecTestsCard({ controlId }: { controlId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["sectests", "by-control", controlId], queryFn: () => api.secTests.byControl(controlId) });
  if (!q.data?.length) return null;
  const open = q.data.filter((f) => f.status === "open");
  return (
    <Card className="mt-6" data-testid="control-sectests">
      <CardHeader title={t("st.ctl.cardTitle")} subtitle={open.length ? t("st.ctl.cardOpen", { n: open.length }) : t("st.ctl.cardOk")} />
      {q.data.map((f) => (
        <FindingRow key={f.id} f={f} />
      ))}
    </Card>
  );
}

/** Přijetí rizika nálezu (v1.64): zdůvodnění a platnost – nález se objeví ve Výjimkách a přijatých rizicích. */
function AcceptFinding({ f, onDone }: { f: SecTestFindingDto; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const year = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const [note, setNote] = useState(f.note ?? "");
  const [until, setUntil] = useState(year);
  const m = useMutation({
    mutationFn: () => api.secTests.setFinding(f.id, "accepted", note.trim(), until || null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sectests"] });
      qc.invalidateQueries({ queryKey: ["exceptions"] });
      onDone();
    },
  });
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3" data-testid="st-accept-form">
      <p className="text-xs text-amber-900">{t("st.acc.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("st.acc.reason")} className="sm:col-span-3">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("st.acc.reasonPh")} />
        </Field>
        <Field label={t("st.acc.validTo")} hint={t("st.acc.validHint")}>
          <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={m.error} />
      <div className="flex gap-2">
        <Button disabled={m.isPending || note.trim().length < 5} onClick={() => m.mutate()} data-testid="st-accept-confirm">
          {t("st.acc.confirm")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("st.cancel")}
        </Button>
      </div>
    </div>
  );
}
