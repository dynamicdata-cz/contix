import { Tabs } from "@/components/ui/tabs";
/**
 * SOC (v0.51–0.52, ADR-046/047): fronta bezpečnostních alertů z Wazuhu a ručních záznamů – triáž analytikem,
 * případy (korelace), lhůty převzetí a vyřešení, potlačení falešných poplachů, ladění pravidel,
 * taktiky MITRE ATT&CK, eskalace na incident a poradce SOC na lokálním modelu.
 */
import { AiTriageBadge, ExposureBadge, IntelBadge, MitreBadges, SeverityBadge, SlaBadge, SocAdvisorCard, SocStatusBadge, TacticStrip } from "@/components/soc";
import { SourcesTab } from "@/components/socSources";
import { ThreatIntelCard } from "@/components/socThreatIntel";
import { IntegrationsCard } from "@/components/socEnrich";
import { PerformanceTab } from "@/components/socMetrics";
import { IocTab } from "@/components/socIoc";
import { HuntsTab } from "@/components/socHunts";
import { PlaybooksTab } from "@/components/socPlaybooks";
import { HostsTab } from "./SocHost";
import { ResponseTab } from "@/components/socResponse";
import { SuggestTuningButton, TuningCard } from "@/components/socTuning";
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDate, fmtDay } from "@/lib/utils";
import {
  ATTACK_ID_RE,
  ATTACK_TACTICS,
  groupRows,
  sortRows,
  type SortState,
  ATTACK_TECHNIQUES,
  SOC_LABELS,
  SOC_SETTINGS_DEFAULTS,
  SOC_SEVERITIES,
  SOC_SUPPRESSION_MAX_DAYS,
  type SocCaseStatus,
  type SocRuleAdvice,
  type SocSettings,
  type SocSeverity,
  type SocSuppressionState,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BellOff, FolderPlus, Plus, RefreshCw, Settings2, TrendingUp, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { GroupRow, GroupSelect, SavedViews, SortTh } from "@/components/listTools";

type Status = "open" | "new" | "in_progress" | "accepted" | "dismissed" | "all";
const TABS = ["queue", "cases", "hosts", "response", "playbooks", "hunts", "iocs", "performance", "suppressions", "rules", "sources"] as const;
type Tab = (typeof TABS)[number];
const caseTone: Record<SocCaseStatus, Tone> = { open: "violet", in_progress: "blue", escalated: "red", closed: "slate" };
const supTone: Record<SocSuppressionState, Tone> = { active: "green", expired: "slate", revoked: "slate" };
const adviceTone: Record<SocRuleAdvice, Tone> = { tune: "red", review: "amber", keep: "green" };
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => isoDay(new Date(Date.now() + n * 864e5));

export function SocPage() {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { tab?: string };
  const tab: Tab = (TABS as readonly string[]).includes(search.tab ?? "") ? (search.tab as Tab) : "queue";
  const setTab = (x: Tab) => nav({ to: "/soc", search: (x === "queue" ? {} : { tab: x }) as never, replace: true });
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [suppressing, setSuppressing] = useState<{ ruleId: string; description?: string } | null>(null);
  const summary = useQuery({ queryKey: ["soc", "summary"], queryFn: api.soc.summary, refetchInterval: 60_000 });
  const sync = useMutation({
    mutationFn: api.soc.sync,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["soc"] }),
  });
  const sm = summary.data;
  const [tactic, setTactic] = useState<string | undefined>();
  const [preset, setPreset] = useState<{ status?: Status; unassigned?: boolean; severity?: SocSeverity; key: number }>({ key: 0 });
  const pick = (p: Omit<typeof preset, "key">) => {
    setTab("queue");
    setPreset({ ...p, key: preset.key + 1 });
  };
  const tabLabel: Record<Tab, string> = { queue: t("soc.tab.queue"), cases: t("soc.tab.cases"), suppressions: t("soc.tab.suppressions"), rules: t("soc.tab.rules"), sources: t("soc.tab.sources"), performance: t("soc.tab.performance"), iocs: t("soc.tab.iocs"), response: t("soc.tab.response"), hunts: t("soc.tab.hunts"), playbooks: t("soc.tab.playbooks"), hosts: t("soc.tab.hosts") };

  return (
    <>
      <PageHeader
        title={t("soc.title")}
        subtitle={t("soc.subtitle")}
        actions={
          <>
            {can("admin:settings") && (
              <Button variant="secondary" onClick={() => setSettings(true)}>
                <Settings2 size={15} /> {t("soc.settings.title")}
              </Button>
            )}
            {can("soc:write") && sm?.syncEnabled && (
              <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw size={15} className={cn(sync.isPending && "animate-spin")} /> {t("soc.sync")}
              </Button>
            )}
            {can("soc:write") && (
              <Button onClick={() => setCreating(true)}>
                <Plus size={16} /> {t("soc.new")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={summary.error ?? sync.error} />
      {sync.data && <p className="mb-3 text-sm text-slate-600">{t("soc.synced2", { created: sync.data.created, updated: sync.data.updated, suppressed: sync.data.suppressed ?? 0 })}</p>}
      {sm && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label={t("soc.kpi.open")} value={sm.open} hint={t("soc.kpi.openHint", { n: sm.new })} onClick={() => pick({ status: "open" })} />
          <Kpi label={t("soc.kpi.unassigned")} value={sm.unassigned} tone={sm.unassigned ? "amber" : "slate"} onClick={() => pick({ status: "open", unassigned: true })} />
          <Kpi label={t("soc.kpi.critical")} value={sm.bySeverity.critical + sm.bySeverity.high} tone={sm.bySeverity.critical ? "red" : "slate"} hint={t("soc.kpi.criticalHint", { c: sm.bySeverity.critical, h: sm.bySeverity.high })} onClick={() => pick({ status: "open", severity: "high" })} />
          <Kpi label={t("soc.kpi.slaBreached")} value={sm.slaBreached} tone={sm.slaBreached ? "red" : "slate"} hint={t("soc.kpi.slaHint")} />
          <Kpi label={t("soc.kpi.cases")} value={sm.openCases} hint={t("soc.kpi.casesHint")} onClick={() => setTab("cases")} />
          <Kpi label={t("soc.kpi.mtta")} value={sm.mttaHours == null ? "—" : `${sm.mttaHours} h`} hint={t("soc.kpi.mttaHint")} />
        </div>
      )}
      <Tabs label={t("soc.title")} value={tab} onChange={setTab} items={TABS.map((x) => ({ key: x, label: tabLabel[x] }))} />
      {tab === "queue" && (
        <>
          {sm && <TacticStrip counts={sm.tactics30} active={tactic} onPick={setTactic} />}
          <QueueTab key={preset.key} preset={preset} tactic={tactic} />
          {can("ai:use") && <SocAdvisorCard />}
          <p className="mt-3 text-xs text-slate-400">{t("soc.attackNote")}</p>
        </>
      )}
      {tab === "cases" && <CasesTab />}
      {tab === "suppressions" && <SuppressionsTab onNew={() => setSuppressing({ ruleId: "" })} />}
      {tab === "rules" && (
        <>
          <RulesTab onSuppress={(ruleId, description) => setSuppressing({ ruleId, description })} />
          <TuningCard />
        </>
      )}
      {tab === "sources" && (
        <>
          <ThreatIntelCard />
          <IntegrationsCard />
          <SourcesTab />
        </>
      )}
      {tab === "performance" && <PerformanceTab />}
      {tab === "iocs" && <IocTab />}
      {tab === "hunts" && <HuntsTab />}
      {tab === "playbooks" && <PlaybooksTab />}
      {tab === "hosts" && <HostsTab />}
      {tab === "response" && <ResponseTab />}
      {creating && <CreateAlertModal onClose={() => setCreating(false)} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {suppressing && <SuppressionModal init={suppressing} onClose={() => setSuppressing(null)} onDone={() => (setSuppressing(null), setTab("suppressions"))} />}
    </>
  );
}

/* ---------- fronta alertů ---------- */

type QSortKey = "severity" | "title" | "lastSeen" | "status" | "analyst" | "sla";
type QGroupKey = "source" | "severity" | "host" | "rule" | "tactic" | "analyst" | "status" | "day";
interface QState extends Record<string, unknown> {
  status: Status;
  severity: "" | SocSeverity;
  ai: "" | "tp" | "fp" | "none";
  intel: boolean;
  mine: boolean;
  unassigned: boolean;
  q: string;
  source: string;
  from: string;
  to: string;
  sort: SortState<QSortKey> | null;
  group: QGroupKey | "";
}
const Q_DEFAULT: QState = { status: "open", severity: "", ai: "", intel: false, mine: false, unassigned: false, q: "", source: "", from: "", to: "", sort: null, group: "" };
const STATUS_ORDER = ["new", "in_progress", "accepted", "dismissed"];

function QueueTab({ preset, tactic }: { preset: { status?: Status; unassigned?: boolean; severity?: SocSeverity }; tactic?: string }) {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { q?: string; intel?: string };
  const [s, setS] = useState<QState>({ ...Q_DEFAULT, status: preset.status ?? "open", severity: preset.severity ?? "", unassigned: !!preset.unassigned, q: search.q ?? "", intel: !!search.intel });
  const set = (p: Partial<QState>) => setS((x) => ({ ...x, ...p }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [caseTitle, setCaseTitle] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["soc", "alerts", s.status, s.severity, s.mine, s.unassigned, tactic, s.q, s.ai, s.intel, s.source, s.from, s.to],
    queryFn: () =>
      api.soc.alerts({
        status: s.status,
        severity: s.severity || undefined,
        mine: s.mine ? "1" : undefined,
        unassigned: s.unassigned ? "1" : undefined,
        tactic,
        q: s.q.trim() || undefined,
        ai: s.ai || undefined,
        intel: s.intel ? "1" : undefined,
        source: s.source || undefined,
        from: s.from || undefined,
        to: s.to || undefined,
      }),
    refetchInterval: 60_000,
  });
  const raw = list.data ?? [];
  const items = useMemo(() => {
    if (!s.sort) return raw;
    const val: Record<QSortKey, (a: (typeof raw)[number]) => string | number | null> = {
      severity: (a) => SOC_SEVERITIES.indexOf(a.severity),
      title: (a) => a.title,
      lastSeen: (a) => a.lastSeen,
      status: (a) => STATUS_ORDER.indexOf(a.status),
      analyst: (a) => a.assigneeName,
      sla: (a) => (a.caseId ? null : (a.acknowledgedAt ? a.sla?.resolveDue : a.sla?.ackDue) ?? null),
    };
    return sortRows(raw, val[s.sort.key], s.sort.dir);
  }, [raw, s.sort]);
  const groupLabel = (a: (typeof raw)[number]): string => {
    switch (s.group) {
      case "source":
        return t.lbl(SOC_LABELS.source[a.source] ?? a.source);
      case "severity":
        return t.lbl(SOC_LABELS.severity[a.severity]);
      case "host":
        return a.assetName ?? a.agentName ?? t("list.none");
      case "rule":
        return a.source === "manual" ? t.lbl(SOC_LABELS.source.manual!) : `${a.ruleId} · ${a.title}`.slice(0, 120);
      case "tactic":
        return a.mitreTactics[0] ? (ATTACK_TACTICS.find((x) => x.id === a.mitreTactics[0])?.name ?? a.mitreTactics[0]) : t("list.none");
      case "analyst":
        return a.assigneeName ?? t("soc.unassigned");
      case "status":
        return t.lbl(SOC_LABELS.status[a.status as keyof typeof SOC_LABELS.status] ?? a.status);
      case "day":
        return a.lastSeen.slice(0, 10);
      default:
        return "";
    }
  };
  const groups = s.group ? groupRows(items, groupLabel, s.group === "day" ? "first" : "count") : [{ key: "", rows: items }];
  const sources = useMemo(() => [...new Set([...Object.keys(SOC_LABELS.source), ...raw.map((a) => a.source)])], [raw]);
  const filtered = s.severity || s.ai || s.intel || s.mine || s.unassigned || s.q || s.source || s.from || s.to || s.status !== "open";
  const selectable = (a: (typeof items)[number]) => (a.status === "new" || a.status === "in_progress") && !a.caseId;
  const toggle = (id: string, on: boolean) =>
    setSelected((x) => {
      const n = new Set(x);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const mkCase = useMutation({
    mutationFn: () => api.soc.createCase({ title: (caseTitle ?? "").trim(), alertIds: [...selected] }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["soc"] });
      nav({ to: "/soc/cases/$caseId", params: { caseId: r.id } });
    },
  });
  const w = can("soc:write");
  const cols = w ? 8 : 7;
  const sortTh = (k: QSortKey, label: string, cls: string, firstDir: "asc" | "desc" = "asc") => <SortTh k={k} label={label} sort={s.sort} onSort={(sort) => set({ sort })} className={cls} firstDir={firstDir} />;
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="space-y-3 border-b border-slate-100 p-4" data-testid="soc-filters">
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-48" value={s.status} onChange={(e) => set({ status: e.target.value as Status })} aria-label={t("soc.filter.status")}>
            <option value="open">{t("soc.filter.open")}</option>
            {(["new", "in_progress", "accepted", "dismissed"] as const).map((x) => (
              <option key={x} value={x}>
                {t.lbl(SOC_LABELS.status[x])}
              </option>
            ))}
            <option value="all">{t("soc.filter.all")}</option>
          </Select>
          <Select className="w-44" value={s.severity} onChange={(e) => set({ severity: e.target.value as QState["severity"] })} aria-label={t("soc.filter.severity")}>
            <option value="">{t("soc.filter.anySeverity")}</option>
            {SOC_SEVERITIES.map((x) => (
              <option key={x} value={x}>
                {t("soc.filter.atLeast", { s: t.lbl(SOC_LABELS.severity[x]) })}
              </option>
            ))}
          </Select>
          <Select className="w-44" value={s.source} onChange={(e) => set({ source: e.target.value })} aria-label={t("soc.filter.source")}>
            <option value="">{t("soc.filter.anySource")}</option>
            {sources.map((x) => (
              <option key={x} value={x}>
                {t.lbl(SOC_LABELS.source[x] ?? x)}
              </option>
            ))}
          </Select>
          <Input className="max-w-xs" placeholder={t("soc.filter.search")} value={s.q} onChange={(e) => set({ q: e.target.value })} aria-label={t("soc.filter.search")} />
          <GroupSelect
            value={s.group}
            onChange={(group) => set({ group })}
            options={[
              { key: "source", label: t("soc.g.source") },
              { key: "severity", label: t("soc.col.severity") },
              { key: "host", label: t("soc.g.host") },
              { key: "rule", label: t("soc.g.rule") },
              { key: "tactic", label: t("soc.g.tactic") },
              { key: "analyst", label: t("soc.col.analyst") },
              { key: "status", label: t("soc.col.status") },
              { key: "day", label: t("soc.g.day") },
            ]}
          />
          <div className="ml-auto">
            <SavedViews page="soc_alerts" state={s} onApply={(v) => setS({ ...Q_DEFAULT, ...v })} onReset={() => setS(Q_DEFAULT)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select className="w-48" value={s.ai} onChange={(e) => set({ ai: e.target.value as QState["ai"] })} aria-label={t("soc.aiTriage.filter")}>
            <option value="">{t("soc.aiTriage.filterAny")}</option>
            <option value="tp">{t("soc.aiTriage.filterTp")}</option>
            <option value="fp">{t("soc.aiTriage.filterFp")}</option>
            <option value="none">{t("soc.aiTriage.filterNone")}</option>
          </Select>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            {t("list.from")} <Input type="date" className="w-40" value={s.from} onChange={(e) => set({ from: e.target.value })} aria-label={t("list.from")} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            {t("list.to")} <Input type="date" className="w-40" value={s.to} onChange={(e) => set({ to: e.target.value })} aria-label={t("list.to")} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={s.intel} onChange={(e) => set({ intel: e.target.checked })} /> {t("soc.ti.filter")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={s.mine} onChange={(e) => set({ mine: e.target.checked })} /> {t("soc.filter.mine")}
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={s.unassigned} onChange={(e) => set({ unassigned: e.target.checked })} /> {t("soc.filter.unassigned")}
          </label>
          {filtered && (
            <Button variant="ghost" onClick={() => setS({ ...Q_DEFAULT, sort: s.sort, group: s.group })}>
              <X size={14} /> {t("list.reset")}
            </Button>
          )}
          {w && selected.size > 0 && (
            <Button variant="secondary" onClick={() => setCaseTitle("")}>
              <FolderPlus size={15} /> {t("soc.toCase", { n: selected.size })}
            </Button>
          )}
          <span className="ml-auto text-xs text-slate-500">{t("soc.count", { n: items.length })}</span>
        </div>
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("soc.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="soc-queue">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {w && <th className="w-8 px-3 py-2" />}
                {sortTh("severity", t("soc.col.severity"), "w-28", "desc")}
                {sortTh("title", t("soc.col.alert"), "")}
                <th className="w-36 px-3 py-2 uppercase tracking-wide">{t("soc.col.mitre")}</th>
                <th className="w-36 px-3 py-2 uppercase tracking-wide">{t("soc.col.ai")}</th>
                {sortTh("status", t("soc.col.status"), "w-32")}
                {sortTh("analyst", t("soc.col.analyst"), "w-36")}
                {sortTh("sla", t("soc.col.sla"), "w-40")}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {s.group && <GroupRow label={g.key} count={g.rows.length} colSpan={cols} />}
                  {g.rows.map((a) => (
                    <tr key={a.id} className={cn("align-top", a.status === "new" && "bg-violet-50/30")}>
                      {w && (
                        <td className="px-3 py-2.5">
                          {selectable(a) && <input type="checkbox" checked={selected.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} aria-label={t("soc.select", { title: a.title })} />}
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <SeverityBadge s={a.severity} />
                        {a.exposure && (
                          <div className="mt-1">
                            <ExposureBadge e={a.exposure} />
                          </div>
                        )}
                        {a.intel && (
                          <div className="mt-1">
                            <IntelBadge m={a.intel} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link to="/soc/$alertId" params={{ alertId: a.id }} className="font-medium hover:text-brand-700">
                          {a.title}
                        </Link>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {t.lbl(SOC_LABELS.source[a.source] ?? a.source)}
                          {a.source !== "manual" && ` · ${t("soc.rule", { id: a.ruleId, level: a.ruleLevel })}`}
                          {a.agentName && ` · ${a.agentName}`}
                          {a.assetName && ` · ${a.assetName}`}
                          {a.count > 1 && ` · ${a.count}×`}
                          {" · "}
                          {fmtDate(a.lastSeen)}
                        </div>
                        {a.caseId && (
                          <Link to="/soc/cases/$caseId" params={{ caseId: a.caseId }} className="mt-0.5 inline-block text-xs font-medium text-brand-700 hover:underline">
                            {t("soc.inCase", { code: a.caseCode ?? "" })}
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <MitreBadges ids={a.mitreIds} />
                      </td>
                      <td className="px-3 py-2.5">
                        <AiTriageBadge tr={a.aiTriage} />
                      </td>
                      <td className="px-3 py-2.5">
                        <SocStatusBadge s={a.status} />
                        {a.verdict && <div className="mt-0.5 text-xs text-slate-500">{t.lbl(SOC_LABELS.verdict[a.verdict])}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{a.assigneeName ?? <span className="text-amber-700">{t("soc.unassigned")}</span>}</td>
                      <td className="px-3 py-2.5">{a.caseId ? <span className="text-xs text-slate-500">{t("soc.sla.byCase")}</span> : <SlaBadge sla={a.sla} acknowledged={!!a.acknowledgedAt} />}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {caseTitle !== null && (
        <Modal
          open
          onClose={() => setCaseTitle(null)}
          title={t("soc.newCase")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCaseTitle(null)}>
                {t("common.cancelAction")}
              </Button>
              <Button onClick={() => mkCase.mutate()} disabled={caseTitle.trim().length < 3 || mkCase.isPending}>
                {t("soc.createCase")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">{t("soc.newCaseHint", { n: selected.size })}</p>
          <Field label={t("soc.f.title")}>
            <Input value={caseTitle} maxLength={300} onChange={(e) => setCaseTitle(e.target.value)} />
          </Field>
          <ErrorBox error={mkCase.error} />
        </Modal>
      )}
    </Card>
  );
}

/* ---------- případy ---------- */

function CasesTab() {
  const t = useT();
  const [status, setStatus] = useState<"open" | "escalated" | "closed" | "all">("open");
  const [mine, setMine] = useState(false);
  const q = useQuery({ queryKey: ["soc", "cases", status, mine], queryFn: () => api.soc.cases({ status, mine: mine ? "1" : undefined }), refetchInterval: 60_000 });
  const items = q.data ?? [];
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t("soc.filter.status")}>
          <option value="open">{t("soc.filter.open")}</option>
          <option value="escalated">{t.lbl(SOC_LABELS.caseStatus.escalated)}</option>
          <option value="closed">{t.lbl(SOC_LABELS.caseStatus.closed)}</option>
          <option value="all">{t("soc.filter.all")}</option>
        </Select>
        <label className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> {t("soc.filter.mine")}
        </label>
        <span className="ml-auto text-xs text-slate-500">{t("soc.casesHint")}</span>
      </div>
      <ErrorBox error={q.error} />
      {!q.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("soc.casesEmpty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-28 px-4 py-2">{t("soc.col.severity")}</th>
                <th className="px-3 py-2">{t("soc.col.case")}</th>
                <th className="w-36 px-3 py-2">{t("soc.col.mitre")}</th>
                <th className="w-28 px-3 py-2">{t("soc.col.alerts")}</th>
                <th className="w-32 px-3 py-2">{t("soc.col.status")}</th>
                <th className="w-36 px-3 py-2">{t("soc.col.analyst")}</th>
                <th className="w-40 px-3 py-2">{t("soc.col.sla")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <SeverityBadge s={c.severity} />
                    {c.chain && <div className="mt-0.5 text-[11px] text-red-700" title={t.lbl(SOC_LABELS.chain[c.chain])}>{t("soc.chainShort")}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Link to="/soc/cases/$caseId" params={{ caseId: c.id }} className="font-medium hover:text-brand-700">
                      {c.code} {c.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {c.auto ? t("soc.caseAuto") : t("soc.caseManual")}
                      {c.hosts.length > 0 && ` · ${c.hosts.slice(0, 3).join(", ")}`}
                      {c.srcips.length > 0 && ` · ${c.srcips.slice(0, 3).join(", ")}`}
                      {c.lastSeen && ` · ${fmtDate(c.lastSeen)}`}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <MitreBadges ids={c.mitreIds} />
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{t("soc.caseAlerts", { open: c.openAlerts, total: c.alertCount })}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={caseTone[c.status]}>{t.lbl(SOC_LABELS.caseStatus[c.status])}</Badge>
                    {c.verdict && <div className="mt-0.5 text-xs text-slate-500">{t.lbl(SOC_LABELS.verdict[c.verdict])}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{c.assigneeName ?? <span className="text-amber-700">{t("soc.unassigned")}</span>}</td>
                  <td className="px-3 py-2.5">
                    <SlaBadge sla={c.sla} acknowledged={!!c.acknowledgedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------- potlačení ---------- */

function SuppressionsTab({ onNew }: { onNew: () => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [state, setState] = useState<"active" | "all">("active");
  const q = useQuery({ queryKey: ["soc", "suppressions", state], queryFn: () => api.soc.suppressions(state) });
  const revoke = useMutation({ mutationFn: api.soc.revokeSuppression, onSuccess: () => qc.invalidateQueries({ queryKey: ["soc", "suppressions"] }) });
  const items = q.data ?? [];
  const w = can("soc:write");
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <Select className="w-44" value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={t("soc.filter.status")}>
          <option value="active">{t.lbl(SOC_LABELS.suppression.active)}</option>
          <option value="all">{t("soc.filter.all")}</option>
        </Select>
        <span className="text-xs text-slate-500">{t("soc.sup.hint")}</span>
        {w && (
          <Button className="ml-auto" variant="secondary" onClick={onNew}>
            <BellOff size={15} /> {t("soc.sup.new")}
          </Button>
        )}
      </div>
      <ErrorBox error={q.error ?? revoke.error} />
      {!q.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("soc.sup.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("soc.sup.col.rule")}</th>
                <th className="w-44 px-3 py-2">{t("soc.sup.col.scope")}</th>
                <th className="px-3 py-2">{t("soc.detail.reason")}</th>
                <th className="w-32 px-3 py-2">{t("soc.sup.col.until")}</th>
                <th className="w-28 px-3 py-2">{t("soc.sup.col.hits")}</th>
                <th className="w-32 px-3 py-2">{t("soc.col.status")}</th>
                {w && <th className="w-24 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs">{s.ruleId}</span>
                    {s.ruleDescription && <div className="text-xs text-slate-500">{s.ruleDescription}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {s.agentName ?? s.agentId ?? t("soc.sup.anyHost")}
                    <div>{s.srcip ?? t("soc.sup.anyIp")}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {s.reason}
                    {s.createdByName && <div className="text-slate-400">{s.createdByName} · {fmtDay(s.createdAt)}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs tabular-nums">{fmtDay(s.until)}</td>
                  <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">
                    {s.hits}
                    {s.lastHitAt && <div className="text-slate-400">{fmtDate(s.lastHitAt)}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={supTone[s.state]}>{t.lbl(SOC_LABELS.suppression[s.state])}</Badge>
                  </td>
                  {w && (
                    <td className="px-3 py-2.5 text-right">
                      {s.state === "active" && (
                        <Button variant="ghost" onClick={() => revoke.mutate(s.id)} disabled={revoke.isPending}>
                          {t("soc.sup.revoke")}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SuppressionModal({ init, onClose, onDone }: { init: { ruleId: string; description?: string }; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [ruleId, setRuleId] = useState(init.ruleId);
  const [agentId, setAgentId] = useState("");
  const [srcip, setSrcip] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(inDays(30));
  const m = useMutation({
    mutationFn: () => api.soc.createSuppression({ ruleId: ruleId.trim(), agentId: agentId.trim() || null, srcip: srcip.trim() || null, reason: reason.trim(), until }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["soc"] });
      onDone();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc.sup.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={!ruleId.trim() || reason.trim().length < 3 || !until || m.isPending}>
            {t("soc.sup.create")}
          </Button>
        </>
      }
    >
      {init.description && <p className="text-sm text-slate-600">{init.description}</p>}
      <Field label={t("soc.sup.f.rule")}>
        <Input value={ruleId} maxLength={50} onChange={(e) => setRuleId(e.target.value)} placeholder="5712" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("soc.sup.f.agent")} hint={t("soc.sup.f.optional")}>
          <Input value={agentId} maxLength={50} onChange={(e) => setAgentId(e.target.value)} placeholder="001" />
        </Field>
        <Field label={t("soc.sup.f.ip")} hint={t("soc.sup.f.optional")}>
          <Input value={srcip} maxLength={45} onChange={(e) => setSrcip(e.target.value)} placeholder="10.0.0.5" />
        </Field>
      </div>
      <Field label={t("soc.detail.reason")}>
        <Textarea rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t("soc.sup.until")} hint={t("soc.sup.untilHint", { n: SOC_SUPPRESSION_MAX_DAYS })}>
        <Input type="date" value={until} min={inDays(0)} max={inDays(SOC_SUPPRESSION_MAX_DAYS)} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/* ---------- ladění pravidel ---------- */

function RulesTab({ onSuppress }: { onSuppress: (ruleId: string, description: string) => void }) {
  const t = useT();
  const can = useCan();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: ["soc", "rule-stats", days], queryFn: () => api.soc.ruleStats(days) });
  const items = q.data ?? [];
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <Select className="w-44" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("soc.rules.period")}>
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {t("soc.rules.days", { n: d })}
            </option>
          ))}
        </Select>
        <span className="text-xs text-slate-500">{t("soc.rules.hint")}</span>
      </div>
      <ErrorBox error={q.error} />
      {!q.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("soc.rules.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("soc.sup.col.rule")}</th>
                <th className="w-24 px-3 py-2 text-right">{t("soc.rules.col.alerts")}</th>
                <th className="w-24 px-3 py-2 text-right">{t("soc.rules.col.escalated")}</th>
                <th className="w-44 px-3 py-2">{t("soc.rules.col.verdicts")}</th>
                <th className="w-40 px-3 py-2">{t("soc.rules.col.fp")}</th>
                <th className="w-28 px-3 py-2 text-right">{t("soc.rules.col.suppressed")}</th>
                <th className="w-36 px-3 py-2">{t("soc.rules.col.advice")}</th>
                {can("soc:write") && <th className="w-24 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => (
                <tr key={r.ruleId} className="align-top">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs">{r.ruleId}</span> <span className="text-xs text-slate-400">· {t("soc.rules.level", { n: r.level })}</span>
                    <div className="text-xs text-slate-600">{r.description}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    {r.alerts}
                    <div className="text-slate-400">{t("soc.rules.events", { n: r.events })}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{r.escalated}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{t("soc.rules.verdicts", { tp: r.truePositive, fp: r.falsePositive, b: r.benign })}</td>
                  <td className="px-3 py-2.5">
                    {r.fpRate == null ? (
                      <span className="text-xs text-slate-400">{t("soc.rules.fewData")}</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                          <div className={cn("h-full", r.fpRate >= 0.8 ? "bg-red-500" : r.fpRate >= 0.5 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.round(r.fpRate * 100)}%` }} />
                        </div>
                        <span className="text-xs tabular-nums">{Math.round(r.fpRate * 100)} %</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    {r.suppressedHits}
                    {r.activeSuppressions > 0 && <div className="text-slate-400">{t("soc.rules.activeSup", { n: r.activeSuppressions })}</div>}
                  </td>
                  <td className="px-3 py-2.5">{r.advice ? <Badge tone={adviceTone[r.advice]}>{t.lbl(SOC_LABELS.advice[r.advice])}</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                  {can("soc:write") && (
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {/^\d+$/.test(r.ruleId) && <SuggestTuningButton ruleId={r.ruleId} />}
                      <Button variant="ghost" onClick={() => onSuppress(r.ruleId, r.description)} aria-label={t("soc.rules.suppressRule", { id: r.ruleId })}>
                        <BellOff size={14} />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        <TrendingUp size={13} /> {t("soc.rules.footnote")}
      </p>
    </Card>
  );
}

/* ---------- nastavení lhůt a korelace ---------- */

function SettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "settings"], queryFn: api.soc.settings });
  const [v, setV] = useState<SocSettings | null>(null);
  const cur = v ?? q.data ?? SOC_SETTINGS_DEFAULTS;
  const save = useMutation({
    mutationFn: () => api.soc.saveSettings(cur),
    onSuccess: (r) => {
      qc.setQueryData(["soc", "settings"], r);
      qc.invalidateQueries({ queryKey: ["soc"] });
      onClose();
    },
  });
  const set = (field: "ackMinutes" | "resolveHours", s: SocSeverity, n: number) => setV({ ...cur, [field]: { ...cur[field], [s]: n } });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.settings.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !q.data}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("soc.settings.hint")}</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1">{t("soc.col.severity")}</th>
            <th className="py-1">{t("soc.settings.ack")}</th>
            <th className="py-1">{t("soc.settings.resolve")}</th>
          </tr>
        </thead>
        <tbody>
          {[...SOC_SEVERITIES].reverse().map((s) => (
            <tr key={s}>
              <td className="py-1.5 pr-3">
                <SeverityBadge s={s} />
              </td>
              <td className="py-1.5 pr-3">
                <Input type="number" min={1} max={10080} value={cur.ackMinutes[s]} onChange={(e) => set("ackMinutes", s, Number(e.target.value))} aria-label={`${t("soc.settings.ack")} – ${t.lbl(SOC_LABELS.severity[s])}`} />
              </td>
              <td className="py-1.5">
                <Input type="number" min={1} max={2160} value={cur.resolveHours[s]} onChange={(e) => set("resolveHours", s, Number(e.target.value))} aria-label={`${t("soc.settings.resolve")} – ${t.lbl(SOC_LABELS.severity[s])}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cur.autoCases} onChange={(e) => setV({ ...cur, autoCases: e.target.checked })} /> {t("soc.settings.autoCases")}
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={cur.aiTriage} onChange={(e) => setV({ ...cur, aiTriage: e.target.checked })} />
        <span>
          {t("soc.settings.aiTriage")}
          <span className="block text-xs text-slate-500">{t("soc.settings.aiTriageHint")}</span>
        </span>
      </label>
      <Field label={t("soc.settings.window")} hint={t("soc.settings.windowHint")}>
        <Input type="number" min={1} max={168} value={cur.correlationHours} onChange={(e) => setV({ ...cur, correlationHours: Number(e.target.value) })} />
      </Field>
      <ErrorBox error={q.error ?? save.error} />
    </Modal>
  );
}

const kpiTone = { slate: "text-slate-900", amber: "text-amber-700", red: "text-red-700" } as const;
function Kpi({ label, value, hint, tone = "slate", onClick }: { label: string; value: number | string; hint?: string; tone?: keyof typeof kpiTone; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-300">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", kpiTone[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Tag>
  );
}

/** Ruční alert (hlášení z jiného nástroje, telefonu, e-mailu). */
function CreateAlertModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<SocSeverity>("medium");
  const [mitre, setMitre] = useState("");
  const ids = mitre
    .split(/[\s,;]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
  const bad = ids.filter((x) => !ATTACK_ID_RE.test(x));
  const create = useMutation({
    mutationFn: () => api.soc.create({ title: title.trim(), description: description.trim(), severity, mitreIds: ids }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["soc"] });
      nav({ to: "/soc/$alertId", params: { alertId: r.id } });
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => create.mutate()} disabled={title.trim().length < 3 || bad.length > 0 || create.isPending}>
            {t("soc.create")}
          </Button>
        </>
      }
    >
      <Field label={t("soc.f.title")}>
        <Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t("soc.f.description")}>
        <Textarea rows={3} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={t("soc.f.severity")}>
        <Select value={severity} onChange={(e) => setSeverity(e.target.value as SocSeverity)}>
          {SOC_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(SOC_LABELS.severity[s])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("soc.f.mitre")} hint={t("soc.f.mitreHint")}>
        <Input value={mitre} list="attack-techniques" placeholder="T1110, T1078" onChange={(e) => setMitre(e.target.value)} />
        <datalist id="attack-techniques">
          {ATTACK_TECHNIQUES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </datalist>
      </Field>
      {bad.length > 0 && <p className="text-sm text-red-700">{t("soc.f.mitreBad", { ids: bad.join(", ") })}</p>}
      <ErrorBox error={create.error} />
    </Modal>
  );
}
