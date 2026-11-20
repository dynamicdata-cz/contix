import { askConfirm } from "@/components/ui/overlay";
import { ProcessGuide } from "@/components/processGuide";
import { useT, lbl, tt } from "@/lib/i18n";
import { CompanyCell, TargetCompanyField, useTargetCompany } from "@/components/company";
import { ColumnChart, Legend, StackedBars } from "@/components/charts";
import { SEVERITY_COLOR, SeverityBadge } from "@/components/health";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, Kpi } from "@/components/ui";
import { api, type IdentityFindingFilter } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, fmtDate, fmtDay, useDebounced } from "@/lib/utils";
import {
  DEFAULT_IDENTITY_POLICY,
  DEFAULT_PROVISIONING,
  type ProvisioningConfig,
  IDENTITY_LABELS,
  COMPUTER_ROLE_LABELS,
  IDENTITY_RULE_INFO,
  IDENTITY_RULES,
  IDENTITY_SEVERITIES,
  type AdSourceConfig,
  type EntraSourceConfig,
  type IdentityFindingDto,
  type IdentityOverviewDto,
  type IdentityPolicy,
  type IdentityRule,
  type IdentitySeverity,
  type IdentitySourceDto,
  type IdentitySourceKind,
  type IdentityTestResult,
  IDENTITY_REPORT_KINDS,
  IDENTITY_REPORT_LABELS,
  type IdentityReportGroup,
  type IdentityReportScheduleInput,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileText, KeyRound, Plus, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AutomationsTab, ReviewsTab, SodTab } from "./IdentityGovernance";
import { Computers } from "./IdentityComputers";

/* ============================================================
 * Identity a přístupy (v0.28) – kontroly účtů v AD a Entra ID.
 * ============================================================ */

type Tab = "overview" | "findings" | "accounts" | "computers" | "sod" | "reviews" | "automations" | "sources";
const sevSegments = () => IDENTITY_SEVERITIES.map((s) => ({ key: s, label: lbl(IDENTITY_LABELS.severity[s]), color: SEVERITY_COLOR[s] }));
const ago = (iso: string | null) => {
  if (!iso) return "nikdy";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? tt("idn.dnes") : d === 1 ? tt("idn.vcera") : tt("idn.predDny", { n: d });
};

export function IdentityPage() {
  const t = useT();
  const initialRule = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("rule") as IdentityRule | null) : null;
  const initialTab = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("tab") as Tab | null) : null;
  const [tab, setTab] = useState<Tab>(initialRule ? "findings" : (initialTab ?? "overview"));
  const [findingFilter, setFindingFilter] = useState<{ rule?: IdentityRule; severity?: IdentitySeverity; sourceId?: string; computerId?: string }>(initialRule && IDENTITY_RULES.includes(initialRule) ? { rule: initialRule } : {});
  const [accountId, setAccountId] = useState<string | null>(null);
  const ov = useQuery({ queryKey: ["identity", "overview"], queryFn: api.identity.overview });
  const tabCls = (on: boolean) => cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", on ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800");
  const openFindings = (f: typeof findingFilter) => {
    setFindingFilter(f);
    setTab("findings");
  };

  return (
    <>
      <PageHeader
        title={t("idn.identityAPristupy")}
        subtitle={t("idn.kontrolyUctuVActiveDirectory")}
      />
      <ProcessGuide id="identity" />
      <div className="mb-6 flex gap-2 border-b border-slate-200">
        {(
          [
            ["overview", t("idn.prehled")],
            ["findings", t("idn.nalezy")],
            ["accounts", t("idn.ucty")],
            ...(ov.data?.sources.some((x) => x.kind === "ad") ? ([["computers", t("idn.pc.tab")]] as [Tab, string][]) : []),
            ["sod", t("idn.toxickeKombinace")],
            ["reviews", t("idn.prezkumPristupu")],
            ["automations", t("idn.testyOpatreni")],
            ["sources", "Zdroje"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" className={tabCls(tab === k)} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      <ErrorBox error={ov.error} />
      {tab === "overview" && ov.data && <Overview data={ov.data} onFindings={openFindings} onSources={() => setTab("sources")} />}
      {tab === "findings" && <Findings filter={findingFilter} setFilter={setFindingFilter} sources={ov.data?.sources ?? []} onAccount={setAccountId} />}
      {tab === "accounts" && <Accounts sources={ov.data?.sources ?? []} onAccount={setAccountId} />}
      {tab === "computers" && <Computers sources={(ov.data?.sources ?? []).filter((x) => x.kind === "ad")} onFindings={(computerId) => openFindings({ computerId })} />}
      {tab === "sod" && <SodTab />}
      {tab === "reviews" && <ReviewsTab sources={ov.data?.sources ?? []} />}
      {tab === "automations" && <AutomationsTab sources={ov.data?.sources ?? []} />}
      {tab === "sources" && <Sources sources={ov.data?.sources ?? []} />}
      {accountId && <AccountModal id={accountId} onClose={() => setAccountId(null)} />}
    </>
  );
}

/* ---------------- přehled ---------------- */

function Overview({ data, onFindings, onSources }: { data: IdentityOverviewDto; onFindings: (f: { rule?: IdentityRule; severity?: IdentitySeverity }) => void; onSources: () => void }) {
  const t = useT();
  const can = useCan();
  if (!data.sources.length)
    return (
      <Card className="p-8 text-center">
        <KeyRound className="mx-auto mb-3 text-slate-400" size={32} />
        <h2 className="mb-2 text-lg font-semibold">{t("idn.zatimNeniPripojenZadnyAdresar2")}</h2>
        <p className="mx-auto mb-4 max-w-xl text-sm text-slate-600">
          {t("idn.pripojteActiveDirectoryLdapsUcet")}
        </p>
        {can("admin:settings") ? <Button onClick={onSources}>{t("idn.pripojitAdresar")}</Button> : <p className="text-sm text-slate-500">{t("idn.adresarPripojiSpravceSystemu")}</p>}
      </Card>
    );
  const tiles: { label: string; value: number; tone: string; onClick?: () => void; icon: React.ReactNode }[] = [
    { label: t("idn.kritickeNalezy"), value: data.open.critical, tone: "text-red-700", onClick: () => onFindings({ severity: "critical" }), icon: <ShieldAlert size={16} className="text-red-600" /> },
    { label: t("idn.vysokeNalezy"), value: data.open.high, tone: "text-orange-700", onClick: () => onFindings({ severity: "high" }), icon: <AlertTriangle size={16} className="text-orange-600" /> },
    { label: t("idn.stredniANizke"), value: data.open.medium + data.open.low, tone: "text-slate-900", onClick: () => onFindings({}), icon: <AlertTriangle size={16} className="text-slate-400" /> },
    { label: t("idn.privilegovaneUcty"), value: data.privileged, tone: "text-slate-900", icon: <KeyRound size={16} className="text-slate-500" /> },
    { label: t("idn.povoleneUcty"), value: data.accounts, tone: "text-slate-900", icon: <Users size={16} className="text-slate-500" /> },
  ];
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((tx) => (
          <Kpi key={tx.label} icon={tx.icon} label={tx.label} value={<span className={tx.value ? tx.tone : undefined}>{tx.value}</span>} onClick={tx.onClick} />
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("idn.nalezyPodlePravidla")} subtitle={t("idn.otevreneSVyjimkou", { accepted: data.accepted })} />
          <div className="divide-y divide-slate-100">
            {data.byRule.length === 0 && <p className="px-5 py-4 text-sm text-slate-500">{t("idn.zadneOtevreneNalezy")}</p>}
            {data.byRule.map((r) => (
              <button key={r.rule} type="button" className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50" onClick={() => onFindings({ rule: r.rule })}>
                <SeverityBadge severity={r.severity} />
                <span className="flex-1 text-sm">{t.lbl(IDENTITY_RULE_INFO[r.rule]?.title) ?? r.rule}</span>
                <span className="text-sm font-semibold tabular-nums">{r.open}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("idn.vyvojOtevrenychNalezu")} subtitle={t("idn.stavPoSynchronizacichPoslednich14")} action={<Legend segments={sevSegments()} />} />
          <div className="p-4">
            {data.trend.length < 2 ? (
              <ColumnChart data={IDENTITY_SEVERITIES.map((s) => ({ key: s, label: t.lbl(IDENTITY_LABELS.severity[s]), value: data.open[s], color: SEVERITY_COLOR[s] }))} height={150} />
            ) : (
              <StackedBars rows={data.trend.slice(-14)} segments={sevSegments()} label={(r) => fmtDate(r.day)} labelWidth="7rem" />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.sources.map((s) => (
          <SourceCard key={s.id} s={s} />
        ))}
      </div>
    </>
  );
}

function SourceCard({ s, onEdit }: { s: IdentitySourceDto; onEdit?: () => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const sync = useMutation({ mutationFn: () => api.identity.sync(s.id), onSettled: () => qc.invalidateQueries({ queryKey: ["identity"] }) });
  const total = s.stats ? IDENTITY_SEVERITIES.reduce((a, k) => a + s.stats!.findings[k], 0) : 0;
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{s.name}</div>
          <div className="text-xs text-slate-500">
            {t.lbl(IDENTITY_LABELS.sourceKind[s.kind])} · {"url" in s.config ? (s.config as AdSourceConfig).url : `tenant ${(s.config as EntraSourceConfig).tenantId}`} · <CompanyCell id={s.companyId} />
          </div>
        </div>
        {!s.enabled ? <Badge tone="slate">{t("idn.vypnuto")}</Badge> : s.lastStatus === "error" ? <Badge tone="red">{t("idn.chyba")}</Badge> : s.lastStatus === "running" || sync.isPending ? <Badge tone="blue">{t("idn.probiha")}</Badge> : s.lastSyncAt ? <Badge tone="green">{t("idn.vPoradku")}</Badge> : <Badge tone="amber">{t("idn.nesynchronizovano")}</Badge>}
      </div>
      <p className="text-sm text-slate-600">
        {t("idn.posledniSynchronizace")} <b>{s.lastSyncAt ? `${fmtDate(s.lastSyncAt)} (${ago(s.lastSyncAt)})` : t("idn.zatimNe")}</b>
        {s.syncHours > 0 ? (" " + t("idn.automatickyKazdychH", { syncHours: s.syncHours })) : t("idn.jenRucne")}
      </p>
      {s.stats && (
        <p className="mt-1 text-sm text-slate-600">
          {t("idn.uctuPovolenychPrivilegovanychOtevrenychN", { accounts: s.stats.accounts, enabled: s.stats.enabled, privileged: s.stats.privileged, total: total })}
        </p>
      )}
      {s.provisioning.enabled && <p className="mt-1 text-sm text-slate-600">{t("idn.synchronizaceUzivateluSkupina")} <b>{s.provisioning.group}</b></p>}
      {s.lastStatus === "error" && s.lastError && <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">{s.lastError}</p>}
      {s.notes.map((n) => (
        <p key={n} className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {n}
        </p>
      ))}
      <ErrorBox error={sync.error} />
      <div className="mt-3 flex flex-wrap gap-2">
        {can("identity:write") && (
          <Button variant="secondary" disabled={sync.isPending || !s.enabled} onClick={() => sync.mutate()}>
            <RefreshCw size={15} className={cn(sync.isPending && "animate-spin")} /> {sync.isPending ? t("common.loading") : "Synchronizovat"}
          </Button>
        )}
        {onEdit && can("admin:settings") && (
          <Button variant="secondary" onClick={onEdit}>
            {t("idn.upravit")}
          </Button>
        )}
      </div>
      {sync.data && (
        <p className="mt-2 text-xs text-slate-500">
          {t("idn.nacteno")} {sync.data.accounts} {t("idn.uctuNovychNalezu")} {sync.data.findings.opened} {t("idn.vyresenych")} {sync.data.findings.resolved}
          {sync.data.removed ? (" " + t("idn.zAdresareZmizelo", { removed: sync.data.removed })) : ""}
          {sync.data.provisioning ? (" " + t("idn.uzivateleNoveDeaktivovanoZmenObsazeni", { created: sync.data.provisioning.created, deactivated: sync.data.provisioning.deactivated, p: sync.data.provisioning.holdersAdded + sync.data.provisioning.holdersRemoved })) : ""}
        </p>
      )}
    </Card>
  );
}

/* ---------------- nálezy ---------------- */

function Findings({
  filter,
  setFilter,
  sources,
  onAccount,
}: {
  filter: { rule?: IdentityRule; severity?: IdentitySeverity; sourceId?: string; computerId?: string };
  setFilter: (f: { rule?: IdentityRule; severity?: IdentitySeverity; sourceId?: string; computerId?: string }) => void;
  sources: IdentitySourceDto[];
  onAccount: (id: string) => void;
}) {
  const t = useT();
  const can = useCan();
  const [status, setStatus] = useState<"open" | "accepted" | "resolved">(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("status") === "accepted" ? "accepted" : "open"));
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [accepting, setAccepting] = useState<IdentityFindingDto | null>(null);
  const qc = useQueryClient();
  const fq = { status, ...filter, q: dq || undefined };
  const list = useQuery({ queryKey: ["identity", "findings", status, filter, dq], queryFn: () => api.identity.findings(fq) });
  const facets = useQuery({ queryKey: ["identity", "facets", status, filter, dq], queryFn: () => api.identity.facets(fq) });
  const reopen = useMutation({ mutationFn: api.identity.reopen, onSuccess: () => qc.invalidateQueries({ queryKey: ["identity"] }) });
  // hromadné akce (v1.89): výběr otevřených nálezů → výjimka nebo úkoly
  const [sel, setSel] = useState<string[]>([]);
  const [bulkAccept, setBulkAccept] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reports, setReports] = useState(false);
  const selectable = (list.data ?? []).filter((f) => f.status === "open");
  // jiný filtr = jiný seznam → výběr se zruší
  useEffect(() => setSel([]), [status, filter, dq]);
  const canBulk = can("identity:write") && status === "open";
  const tasks = useMutation({
    mutationFn: () => api.findings.tasks(sel.map((id) => `identity:${id}`)),
    onSuccess: (r) => {
      setMsg(t("idn.bulk.tasksDone", { n: r.created, existing: r.existing }));
      setSel([]);
      qc.invalidateQueries({ queryKey: ["identity"] });
    },
  });
  const ruleTiles = IDENTITY_RULES.filter((r) => (facets.data?.rules[r] ?? 0) > 0);
  const info = filter.rule ? IDENTITY_RULE_INFO[filter.rule] : null;
  return (
    <>
      {filter.computerId && (
        <p className="mb-3 flex items-center gap-2 text-sm text-slate-600" data-testid="finding-computer-filter">
          {t("idn.pc.filtered", { name: list.data?.[0]?.computer?.name ?? "…" })}
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setFilter({ ...filter, computerId: undefined })}>
            {t("idn.pc.clearFilter")}
          </Button>
        </p>
      )}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t("idn.stav")}>
            <option value="open">{t("idn.otevrene")}</option>
            <option value="accepted">{t("idn.sVyjimkou")}</option>
            <option value="resolved">{t("idn.vyresene")}</option>
          </Select>
          <Select value={filter.severity ?? ""} onChange={(e) => setFilter({ ...filter, severity: (e.target.value || undefined) as IdentitySeverity | undefined })} aria-label={t("idn.zavaznost")}>
            <option value="">{t("idn.vsechnyZavaznosti")}</option>
            {IDENTITY_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(IDENTITY_LABELS.severity[s])}
                {facets.data ? ` (${facets.data.severities[s] ?? 0})` : ""}
              </option>
            ))}
          </Select>
          <Select value={filter.rule ?? ""} onChange={(e) => setFilter({ ...filter, rule: (e.target.value || undefined) as IdentityRule | undefined })} aria-label={t("idn.pravidlo")}>
            <option value="">{t("idn.vsechnaPravidla")}</option>
            {IDENTITY_RULES.map((r) => (
              <option key={r} value={r}>
                {t.lbl(IDENTITY_RULE_INFO[r].title)}
                {facets.data ? ` (${facets.data.rules[r] ?? 0})` : ""}
              </option>
            ))}
          </Select>
          <Select value={filter.sourceId ?? ""} onChange={(e) => setFilter({ ...filter, sourceId: e.target.value || undefined })} aria-label={t("idn.zdroj")}>
            <option value="">{t("idn.vsechnyZdroje")}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Input placeholder={t("idn.ucetJmenoDetail")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {info && (
          <div className="mt-3 rounded-md bg-slate-50 px-4 py-3 text-sm">
            <p className="font-medium">{t.lbl(info.title)}</p>
            <p className="mt-1 text-slate-600">{t.lbl(info.why)}</p>
            <p className="mt-1 text-slate-600">
              <b>{t("idn.coUdelat")}</b> {t.lbl(info.fix)}
            </p>
          </div>
        )}
      </Card>
      {ruleTiles.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="idn-rule-tiles">
          {ruleTiles.map((r) => {
            const on = filter.rule === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={on}
                title={t.lbl(IDENTITY_RULE_INFO[r].why)}
                onClick={() => setFilter({ ...filter, rule: on ? undefined : r })}
                className={cn("rounded-lg border px-3 py-2 text-left text-sm", on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 bg-white hover:border-slate-300")}
              >
                <span className="block text-lg font-semibold leading-tight">{facets.data?.rules[r] ?? 0}</span>
                <span className="text-xs text-slate-600">{t.lbl(IDENTITY_RULE_INFO[r].title)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm text-slate-500">{t("idn.count", { n: facets.data?.total ?? list.data?.length ?? 0 })}</span>
        {canBulk && sel.length > 0 && (
          <>
            <span className="text-sm text-slate-700">{t("idn.bulk.selected", { n: sel.length })}</span>
            <Button variant="secondary" onClick={() => setBulkAccept(true)}>
              {t("idn.bulk.accept")}
            </Button>
            {can("actions:write") && (
              <Button variant="secondary" disabled={tasks.isPending} onClick={() => tasks.mutate()}>
                {t("idn.bulk.tasks")}
              </Button>
            )}
          </>
        )}
        <a href={api.identity.findingsCsvUrl(fq)} download>
          <Button variant="secondary">
            <Download size={15} /> CSV
          </Button>
        </a>
        <a href={api.identity.findingsXlsxUrl(fq)} download>
          <Button variant="secondary">
            <Download size={15} /> XLSX
          </Button>
        </a>
        <Button variant="secondary" onClick={() => setReports(true)}>
          <FileText size={15} /> {t("idn.rep.button")}
        </Button>
      </div>
      {msg && <SuccessBox>{msg}</SuccessBox>}
      <ErrorBox error={list.error ?? reopen.error ?? tasks.error} />
      <Card>
        {list.data && !list.data.length ? (
          <EmptyState>{status === "open" ? t("idn.zadneOtevreneNalezyProZvoleny") : t("common.nothingToShow")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {canBulk && (
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={t("idn.bulk.all")}
                        checked={selectable.length > 0 && sel.length === selectable.length}
                        onChange={(e) => setSel(e.target.checked ? selectable.map((f) => f.id) : [])}
                      />
                    </th>
                  )}
                  <th className="px-4 py-2">{t("idn.zavaznost")}</th>
                  <th className="px-3 py-2">{t("idn.pravidlo")}</th>
                  <th className="px-3 py-2">{t("idn.ucetSkupina")}</th>
                  <th className="px-3 py-2">{t("idn.detail")}</th>
                  <th className="px-3 py-2">{t("idn.zdroj")}</th>
                  <th className="px-3 py-2">{status === "resolved" ? t("idn.vyreseno") : "Od"}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data?.map((f) => (
                  <tr key={f.id} className="align-top">
                    {canBulk && (
                      <td className="px-3 py-2">
                        {f.status === "open" && (
                          <input type="checkbox" aria-label={f.subject} checked={sel.includes(f.id)} onChange={(e) => setSel(e.target.checked ? [...sel, f.id] : sel.filter((x) => x !== f.id))} />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <SeverityBadge severity={f.severity} />
                    </td>
                    <td className="px-3 py-2" title={t.lbl(IDENTITY_RULE_INFO[f.rule]?.why)}>
                      {t.lbl(IDENTITY_RULE_INFO[f.rule]?.title) ?? f.rule}
                    </td>
                    <td className="px-3 py-2">
                      {f.account ? (
                        <button type="button" className="text-left text-brand-700 hover:underline" onClick={() => onAccount(f.account!.id)}>
                          <span className="font-medium">{f.account.login}</span>
                          <span className="block text-xs text-slate-500">{f.account.displayName}</span>
                        </button>
                      ) : f.computer ? (
                        <span>
                          <span className="font-medium">{f.computer.name}</span>
                          <span className="block text-xs text-slate-500">
                            {t.lbl(COMPUTER_ROLE_LABELS[f.computer.role])}
                            {f.computer.assetId && (
                              <>
                                {" · "}
                                <a href={`/assets/${f.computer.assetId}`} className="text-brand-700 hover:underline">
                                  {t("idn.pc.asset")}
                                </a>
                              </>
                            )}
                          </span>
                        </span>
                      ) : (
                        <span className="font-medium">{f.subject}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {f.detail}
                      {f.status === "accepted" && (
                        <span className="mt-1 block text-xs text-amber-800">
                          {t("idn.vyjimkaDo", { p: fmtDay(f.acceptedUntil), p2: f.acceptedByName ?? "?", acceptedReason: f.acceptedReason })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{f.sourceName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{fmtDate(status === "resolved" ? f.resolvedAt : f.firstSeenAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {can("identity:write") && f.status === "open" && (
                        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAccepting(f)}>
                          {t("idn.vyjimka")}
                        </Button>
                      )}
                      {can("identity:write") && f.status === "accepted" && (
                        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={reopen.isPending} onClick={() => reopen.mutate(f.id)}>
                          {t("idn.zrusitVyjimku")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data && list.data.length >= 2000 && <p className="px-4 py-2 text-xs text-slate-500">{t("idn.zobrazenoPrvnich2000NalezuZuzte")}</p>}
          </div>
        )}
      </Card>
      {accepting && <AcceptModal f={accepting} onClose={() => setAccepting(null)} />}
      {bulkAccept && (
        <BulkAcceptModal
          ids={sel}
          onClose={(n) => {
            setBulkAccept(false);
            if (n !== null) {
              setMsg(t("idn.bulk.acceptDone", { n }));
              setSel([]);
            }
          }}
        />
      )}
      {reports && <ReportsModal filter={fq} onClose={() => setReports(false)} />}
    </>
  );
}

/* ---------------- hromadná výjimka, reporty a měsíční rozesílání (v1.89) ---------------- */

function BulkAcceptModal({ ids, onClose }: { ids: string[]; onClose: (accepted: number | null) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(() => new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10));
  const m = useMutation({
    mutationFn: () => api.identity.bulkAccept({ ids, reason, until }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["identity"] });
      onClose(r.accepted);
    },
  });
  return (
    <Modal
      open
      onClose={() => onClose(null)}
      title={t("idn.bulk.acceptTitle", { n: ids.length })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose(null)}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={reason.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
            {t("idn.udelitVyjimku")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("idn.bulk.acceptHint")}</p>
      <Field label={t("idn.oduvodneniProcJeStavPrijatelny")}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t("idn.platiDo")} hint={t("idn.nejdele2Roky")}>
        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function ReportsModal({ filter, onClose }: { filter: IdentityFindingFilter; onClose: () => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [group, setGroup] = useState<IdentityReportGroup>("department");
  const sched = useQuery({ queryKey: ["identity", "report-schedule"], queryFn: api.identity.reportSchedule });
  const [plan, setPlan] = useState<IdentityReportScheduleInput | null>(null);
  const p = plan ?? (sched.data ? { enabled: sched.data.enabled, reports: sched.data.reports, format: sched.data.format, day: sched.data.day, group: sched.data.group } : null);
  const save = useMutation({
    mutationFn: (v: IdentityReportScheduleInput) => api.identity.saveReportSchedule(v),
    onSuccess: (d) => {
      qc.setQueryData(["identity", "report-schedule"], d);
      setPlan(null);
    },
  });
  const send = useMutation({ mutationFn: api.identity.sendReportNow, onSuccess: () => qc.invalidateQueries({ queryKey: ["identity", "report-schedule"] }) });
  const q = { ...filter, group };
  return (
    <Modal open onClose={onClose} title={t("idn.rep.title")} wide>
      <p className="text-sm text-slate-600">{t("idn.rep.hint")}</p>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200" data-testid="idn-reports">
        {IDENTITY_REPORT_KINDS.map((k) => (
          <li key={k} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <span className="mr-auto text-sm font-medium">{t.lbl(IDENTITY_REPORT_LABELS[k])}</span>
            {k === "inactive" && (
              <Select className="w-auto" value={group} onChange={(e) => setGroup(e.target.value as IdentityReportGroup)} aria-label={t("idn.rep.group")}>
                <option value="department">{t("idn.rep.byDepartment")}</option>
                <option value="ou">{t("idn.rep.byOu")}</option>
              </Select>
            )}
            <a href={api.identity.reportUrl(k, "docx", q)} download>
              <Button variant="secondary">Word</Button>
            </a>
            <a href={api.identity.reportUrl(k, "html", q)} target="_blank" rel="noreferrer">
              <Button variant="secondary">{t("idn.rep.pdf")}</Button>
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-5 border-t border-slate-200 pt-4" data-testid="idn-report-schedule">
        <div className="text-sm font-medium">{t("idn.rep.scheduleTitle")}</div>
        {sched.data && (
          <p className="mt-1 text-xs text-slate-500">
            {sched.data.guarantor ? t("idn.rep.guarantor", { name: sched.data.guarantor.name, n: sched.data.guarantor.recipients }) : t("idn.rep.noGuarantor")}
            {sched.data.lastSentAt ? ` · ${t("idn.rep.lastSent", { date: fmtDate(sched.data.lastSentAt) })}` : ""}
            {sched.data.lastStatus ? ` · ${sched.data.lastStatus}` : ""}
          </p>
        )}
        {p && (
          <div className="mt-3 space-y-3">
            <Checkbox checked={p.enabled} disabled={!can("identity:write")} onChange={(v) => setPlan({ ...p, enabled: v })} label={t("idn.rep.enabled")} />
            <div className="flex flex-wrap gap-4">
              {IDENTITY_REPORT_KINDS.map((k) => (
                <Checkbox
                  key={k}
                  disabled={!can("identity:write")}
                  checked={p.reports.includes(k)}
                  onChange={(v) => setPlan({ ...p, reports: v ? [...p.reports, k] : p.reports.filter((x) => x !== k) })}
                  label={t.lbl(IDENTITY_REPORT_LABELS[k])}
                />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("idn.rep.day")}>
                <Input type="number" min={1} max={28} disabled={!can("identity:write")} value={p.day ?? 1} onChange={(e) => setPlan({ ...p, day: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} />
              </Field>
              <Field label={t("idn.rep.format")} hint={sched.data && !sched.data.pdfAvailable ? t("idn.rep.pdfNoConverter") : undefined}>
                <Select value={p.format ?? "docx"} disabled={!can("identity:write")} onChange={(e) => setPlan({ ...p, format: e.target.value as "docx" | "pdf" })}>
                  <option value="docx">Word</option>
                  <option value="pdf">PDF</option>
                </Select>
              </Field>
              <Field label={t("idn.rep.group")}>
                <Select value={p.group ?? "department"} disabled={!can("identity:write")} onChange={(e) => setPlan({ ...p, group: e.target.value as IdentityReportGroup })}>
                  <option value="department">{t("idn.rep.byDepartment")}</option>
                  <option value="ou">{t("idn.rep.byOu")}</option>
                </Select>
              </Field>
            </div>
            {can("identity:write") && (
              <div className="flex flex-wrap gap-2">
                <Button disabled={!plan || !p.reports.length || save.isPending} onClick={() => save.mutate(p)}>
                  {t("idn.rep.save")}
                </Button>
                <Button variant="secondary" disabled={!sched.data?.guarantor || send.isPending} onClick={() => send.mutate()}>
                  {t("idn.rep.sendNow")}
                </Button>
              </div>
            )}
            {send.data && <SuccessBox>{send.data.status}</SuccessBox>}
          </div>
        )}
        <ErrorBox error={sched.error ?? save.error ?? send.error} />
      </div>
    </Modal>
  );
}

function AcceptModal({ f, onClose }: { f: IdentityFindingDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(() => new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10));
  const m = useMutation({
    mutationFn: () => api.identity.accept(f.id, { reason, until }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("idn.vyjimkaZNalezu")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={reason.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
            {t("idn.udelitVyjimku")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        <b>{t.lbl(IDENTITY_RULE_INFO[f.rule]?.title)}</b> – {f.subject}{t("idn.vyjimkaZnamenaVedomePrijetiRizika")}
      </p>
      <Field label={t("idn.oduvodneniProcJeStavPrijatelny")}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label={t("idn.platiDo")} hint={t("idn.nejdele2Roky")}>
        <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/* ---------------- účty ---------------- */

function Accounts({ sources, onAccount }: { sources: IdentitySourceDto[]; onAccount: (id: string) => void }) {
  const t = useT();
  const [f, setF] = useState<{ q: string; sourceId: string; privileged: boolean; withFindings: boolean; kind: string; disabled: boolean; removed: boolean }>({ q: "", sourceId: "", privileged: false, withFindings: false, kind: "", disabled: false, removed: false });
  const list = useQuery({
    queryKey: ["identity", "accounts", f],
    queryFn: () =>
      api.identity.accounts({
        q: f.q || undefined,
        sourceId: f.sourceId || undefined,
        privileged: f.privileged ? "1" : undefined,
        withFindings: f.withFindings ? "1" : undefined,
        kind: f.kind || undefined,
        enabled: f.disabled ? "0" : undefined,
        removed: f.removed ? "1" : undefined,
      }),
  });
  return (
    <>
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input placeholder={t("idn.prihlasovaciJmenoJmenoEMail")} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
          <Select value={f.sourceId} onChange={(e) => setF({ ...f, sourceId: e.target.value })} aria-label={t("idn.zdroj")}>
            <option value="">{t("idn.vsechnyZdroje")}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label={t("idn.druhUctu")}>
            <option value="">{t("idn.vsechnyDruhyUctu")}</option>
            {(["user", "service", "guest"] as const).map((k) => (
              <option key={k} value={k}>
                {t.lbl(IDENTITY_LABELS.accountKind[k])}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-5">
          <Checkbox checked={f.privileged} onChange={(v) => setF({ ...f, privileged: v })} label={t("idn.jenPrivilegovane")} />
          <Checkbox checked={f.withFindings} onChange={(v) => setF({ ...f, withFindings: v })} label={t("idn.jenSOtevrenymiNalezy")} />
          <Checkbox checked={f.disabled} onChange={(v) => setF({ ...f, disabled: v })} label={t("idn.jenZakazane")} />
          <Checkbox checked={f.removed} onChange={(v) => setF({ ...f, removed: v })} label={t("idn.odstraneneZAdresare")} />
        </div>
      </Card>
      <ErrorBox error={list.error} />
      <Card>
        {list.data && !list.data.length ? (
          <EmptyState>{t("idn.zadneUctyProZvolenyFiltr")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("idn.ucet")}</th>
                  <th className="px-3 py-2">{t("idn.druh")}</th>
                  <th className="px-3 py-2">{t("idn.privilegovany")}</th>
                  <th className="px-3 py-2">{t("idn.posledniPrihlaseni")}</th>
                  <th className="px-3 py-2">{t("idn.mfa")}</th>
                  <th className="px-3 py-2">{t("idn.uzivatelContixu")}</th>
                  <th className="px-3 py-2">{t("idn.nalezy")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data?.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onAccount(a.id)}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{a.login}</span>
                      {!a.enabled && <Badge tone="slate">{t("idn.zakazany")}</Badge>}
                      <span className="block text-xs text-slate-500">
                        {a.displayName}
                        {a.department ? ` · ${a.department}` : ""} · {a.sourceName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{t.lbl(IDENTITY_LABELS.accountKind[a.kind])}</td>
                    <td className="px-3 py-2 text-xs">{a.privileged ? a.privilegedVia.join(", ") : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{a.lastLogonAt ? `${fmtDate(a.lastLogonAt)} (${ago(a.lastLogonAt)})` : a.sourceKind === "entra" && a.lastLogonAt === null ? "—" : "nikdy"}</td>
                    <td className="px-3 py-2 text-xs">{a.mfa === null ? "—" : a.mfa ? "ano" : <span className="font-medium text-red-700">{t("common.no")}</span>}</td>
                    <td className="px-3 py-2 text-xs">{a.contixUser ? `${a.contixUser.name}${a.contixUser.active ? "" : t("idn.neaktivni")}` : "—"}</td>
                    <td className="px-3 py-2">{a.maxSeverity ? <span className="inline-flex items-center gap-1.5"><SeverityBadge severity={a.maxSeverity} /> {a.openFindings}</span> : <CheckCircle2 size={15} className="text-green-600" aria-label={t("idn.bezNalezu")} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.data && list.data.length >= 1000 && <p className="px-4 py-2 text-xs text-slate-500">{t("idn.zobrazenoPrvnich1000UctuZuzte")}</p>}
          </div>
        )}
      </Card>
    </>
  );
}

function AccountModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const q = useQuery({ queryKey: ["identity", "account", id], queryFn: () => api.identity.account(id) });
  const a = q.data;
  const flags = a
    ? ([
        [t("idn.hesloNikdyNevyprsi"), a.flags.pwdNeverExpires],
        [t("idn.nevyzadujeHeslo"), a.flags.pwdNotRequired],
        [t("idn.bezPredautentizaceKerberos"), a.flags.preauthDisabled],
        [t("idn.maServiceprincipalname"), a.flags.hasSpn],
        [t("idn.neomezenaDelegace"), a.flags.unconstrainedDelegation],
      ] as [string, boolean][]).filter(([, v]) => v)
    : [];
  return (
    <Modal open onClose={onClose} title={a ? a.login : t("idn.ucet")} wide>
      <ErrorBox error={q.error} />
      {a && (
        <>
          <dl className="grid grid-cols-[11rem_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500">{t("idn.jmeno")}</dt>
            <dd>{a.displayName}</dd>
            <dt className="text-slate-500">{t("idn.zdroj")}</dt>
            <dd>
              {a.sourceName} ({t.lbl(IDENTITY_LABELS.sourceKind[a.sourceKind])})
            </dd>
            {a.dn && (
              <>
                <dt className="text-slate-500">{t("idn.dn")}</dt>
                <dd className="break-all text-xs">{a.dn}</dd>
              </>
            )}
            <dt className="text-slate-500">{t("idn.druhStav")}</dt>
            <dd>
              {t.lbl(IDENTITY_LABELS.accountKind[a.kind])} · {a.enabled ? t("idn.povoleny") : t("idn.zakazany")}
              {a.removedAt ? (" " + t("idn.odstranenZAdresare", { p: fmtDate(a.removedAt) })) : ""}
            </dd>
            <dt className="text-slate-500">{t("idn.utvarFunkce")}</dt>
            <dd>{[a.department, a.title].filter(Boolean).join(" · ") || "—"}</dd>
            <dt className="text-slate-500">{t("idn.zalozen")}</dt>
            <dd>{fmtDate(a.createdAt) || "—"}</dd>
            <dt className="text-slate-500">{t("idn.posledniPrihlaseni")}</dt>
            <dd>{a.lastLogonAt ? `${fmtDate(a.lastLogonAt)} (${ago(a.lastLogonAt)})` : "—"}</dd>
            <dt className="text-slate-500">{t("idn.zmenaHesla")}</dt>
            <dd>{a.pwdLastSetAt ? `${fmtDate(a.pwdLastSetAt)} (${ago(a.pwdLastSetAt)})` : "—"}</dd>
            <dt className="text-slate-500">{t("idn.mfa")}</dt>
            <dd>{a.mfa === null ? t("idn.nezname") : a.mfa ? t("idn.registrovano") : t("idn.neregistrovano")}</dd>
            <dt className="text-slate-500">{t("idn.uzivatelContixu")}</dt>
            <dd>{a.contixUser ? `${a.contixUser.name}${a.contixUser.active ? "" : t("idn.deaktivovany")}` : "—"}</dd>
            <dt className="text-slate-500">{t("idn.privilegovanyPres")}</dt>
            <dd>{a.privilegedVia.length ? a.privilegedVia.join(", ") : "—"}</dd>
            {flags.length > 0 && (
              <>
                <dt className="text-slate-500">{t("idn.rizikovePriznaky")}</dt>
                <dd>{flags.map(([l]) => l).join(", ")}</dd>
              </>
            )}
          </dl>
          {a.groups.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">{t("idn.skupinyVcetneVnorenych", { length: a.groups.length })}</p>
              <div className="flex flex-wrap gap-1">
                {a.groups.map((g) => (
                  <Badge key={g} tone={a.privilegedVia.includes(g) ? "red" : "slate"}>
                    {g}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="mb-1 text-sm font-medium">{t("idn.nalezy")}</p>
            {!a.findings.length && <p className="text-sm text-slate-500">{t("idn.bezNalezu2")}</p>}
            <ul className="space-y-1.5">
              {a.findings.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-sm">
                  <SeverityBadge severity={f.severity} />
                  <span className="flex-1">
                    <b>{t.lbl(IDENTITY_RULE_INFO[f.rule]?.title)}</b> – {f.detail}
                    <span className="block text-xs text-slate-500">
                      {t.lbl(IDENTITY_LABELS.status[f.status])}
                      {f.status === "resolved" ? ` ${fmtDate(f.resolvedAt)}` : ` od ${fmtDate(f.firstSeenAt)}`}
                      {f.status === "open" ? ` · ${t.lbl(IDENTITY_RULE_INFO[f.rule]?.fix)}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------------- zdroje ---------------- */

function Sources({ sources }: { sources: IdentitySourceDto[] }) {
  const t = useT();
  const can = useCan();
  const [editing, setEditing] = useState<IdentitySourceDto | IdentitySourceKind | null>(null);
  return (
    <>
      {can("admin:settings") && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button onClick={() => setEditing("ad")}>
            <Plus size={15} /> {t("idn.activeDirectory")}
          </Button>
          <Button onClick={() => setEditing("entra")}>
            <Plus size={15} /> {t("idn.microsoftEntraId")}
          </Button>
        </div>
      )}
      {!sources.length && <EmptyState>{t("idn.zatimNeniPripojenZadnyAdresar")}{!can("admin:settings") && t("idn.pripojiHoSpravceSystemu")}</EmptyState>}
      <div className="grid gap-4 lg:grid-cols-2">
        {sources.map((s) => (
          <SourceCard key={s.id} s={s} onEdit={() => setEditing(s)} />
        ))}
      </div>
      {editing && <SourceModal initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SourceModal({ initial, onClose }: { initial: IdentitySourceDto | IdentitySourceKind; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const existing = typeof initial === "string" ? null : initial;
  const kind: IdentitySourceKind = existing?.kind ?? (initial as IdentitySourceKind);
  const target = useTargetCompany();
  const [companyId, setCompanyId] = useState(existing?.companyId ?? target.companyId);
  const [name, setName] = useState(existing?.name ?? (kind === "ad" ? t("idn.activeDirectory") : t("idn.entraId")));
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [syncHours, setSyncHours] = useState(existing?.syncHours ?? 24);
  const [policy, setPolicy] = useState<IdentityPolicy>(existing?.policy ?? DEFAULT_IDENTITY_POLICY);
  const [secret, setSecret] = useState("");
  const [ad, setAd] = useState<AdSourceConfig>(
    kind === "ad" && existing ? { ...(existing.config as AdSourceConfig), computers: (existing.config as Partial<AdSourceConfig>).computers ?? true } : { url: "ldaps://", baseDn: "", bindDn: "", verifyTls: true, caCert: "", extraPrivilegedGroups: [], computers: true },
  );
  const [entra, setEntra] = useState<EntraSourceConfig>(kind === "entra" && existing ? (existing.config as EntraSourceConfig) : { tenantId: "", clientId: "", extraPrivilegedRoles: [], trackedGroups: [] });
  const [extra, setExtra] = useState((kind === "ad" ? ad.extraPrivilegedGroups : entra.extraPrivilegedRoles).join("\n"));
  const [tracked, setTracked] = useState((kind === "entra" ? (entra.trackedGroups ?? []) : []).join("\n"));
  const [prov, setProv] = useState<ProvisioningConfig>(existing?.provisioning ?? DEFAULT_PROVISIONING);
  const [test, setTest] = useState<IdentityTestResult | null>(null);

  const payload = useMemo(() => {
    const list = extra.split("\n").map((x) => x.trim()).filter(Boolean);
    const base = { name, enabled, syncHours, policy, provisioning: prov, companyId, secret: secret || undefined };
    const trackedList = tracked.split("\n").map((x) => x.trim()).filter(Boolean);
    return kind === "ad"
      ? { kind: "ad" as const, ...base, config: { ...ad, extraPrivilegedGroups: list } }
      : { kind: "entra" as const, ...base, config: { ...entra, extraPrivilegedRoles: list, trackedGroups: trackedList } };
  }, [kind, name, enabled, syncHours, policy, prov, companyId, secret, ad, entra, extra, tracked]);

  const doTest = useMutation({ mutationFn: () => api.identity.testSource({ ...payload, id: existing?.id }), onSuccess: setTest });
  const save = useMutation({
    mutationFn: () => (existing ? api.identity.updateSource(existing.id, payload) : api.identity.createSource(payload)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity"] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.identity.removeSource(existing!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["identity"] });
      onClose();
    },
  });
  const num = (k: keyof IdentityPolicy) => (
    <Input type="number" value={policy[k]} onChange={(e) => setPolicy({ ...policy, [k]: Number(e.target.value) })} />
  );

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${existing ? "Upravit" : t("idn.pripojit")} ${t.lbl(IDENTITY_LABELS.sourceKind[kind])}`}
      footer={
        <>
          {existing && (
            <Button variant="danger" className="mr-auto" disabled={remove.isPending} onClick={async () => (await askConfirm(t("idn.odpojitSmazouSeINactene", { name: existing.name }))) && remove.mutate()}>
              {t("idn.odpojit")}
            </Button>
          )}
          <Button variant="secondary" disabled={doTest.isPending} onClick={() => doTest.mutate()}>
            {doTest.isPending ? "Testuji…" : t("idn.otestovatPripojeni")}
          </Button>
          <Button disabled={save.isPending || !name.trim()} onClick={() => save.mutate()}>
            {t("idn.ulozit")}
          </Button>
        </>
      }
    >
      {kind === "ad" ? (
        <div className="rounded-md bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {t("idn.vytvorteVAdBeznyUcet")} <b>{t("idn.jenProCteni")}</b> {t("idn.staciClenstviVDomainUsers")} <b>{t("idn.636Ldaps")}</b>{t("idn.pokudRadicPouzivaCertifikatInterni")}
        </div>
      ) : (
        <div className="rounded-md bg-slate-50 px-4 py-3 text-xs text-slate-600">
          {t("idn.vEntraIdVytvorte")} <b>{t("idn.registraciAplikace")}</b> {t("idn.sTajnymKlicemAOpravnenimi")} <b>{t("idn.application")}</b>: <code>{t("idn.userReadAll")}</code>, <code>{t("idn.rolemanagementReadDirectory")}</code> {t("idn.aSLicenciEntraId")} <code>{t("idn.auditlogReadAll")}</code> {t("idn.proPosledniPrihlaseniARegistraci")}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("idn.nazev")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <TargetCompanyField value={companyId} onChange={setCompanyId} />
      </div>
      {kind === "ad" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("idn.adresaServeru")} hint={t("idn.ldapsDc01FirmaLocal636")}>
            <Input value={ad.url} onChange={(e) => setAd({ ...ad, url: e.target.value })} />
          </Field>
          <Field label={t("idn.baseDn")} hint={t("idn.kdeHledatUctyNaprDc")}>
            <Input value={ad.baseDn} onChange={(e) => setAd({ ...ad, baseDn: e.target.value })} />
          </Field>
          <Field label={t("idn.ucetProCteni")} hint={t("idn.dnNeboUpnNaprContix")}>
            <Input value={ad.bindDn} onChange={(e) => setAd({ ...ad, bindDn: e.target.value })} />
          </Field>
          <Field label={t("idn.heslo")} hint={existing?.hasSecret ? t("idn.ulozenoVyplnteJenProZmenu") : undefined}>
            <Input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
          <Field label={t("idn.korenovyCertifikatInterniCaPem")} className="md:col-span-2">
            <Textarea rows={3} className="font-mono text-xs" value={ad.caCert} placeholder={t("idn.beginCertificate")} onChange={(e) => setAd({ ...ad, caCert: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Checkbox checked={ad.verifyTls} onChange={(v) => setAd({ ...ad, verifyTls: v })} label={t("idn.overovatCertifikatServeru")} hint={t("idn.vypinejteJenProKratkyTest")} />
          </div>
          <div className="md:col-span-2">
            <Checkbox checked={ad.computers !== false} onChange={(v) => setAd({ ...ad, computers: v })} label={t("idn.pc.load")} hint={t("idn.pc.loadHint")} />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("idn.idTenantuDirectoryId")}>
            <Input value={entra.tenantId} onChange={(e) => setEntra({ ...entra, tenantId: e.target.value })} />
          </Field>
          <Field label={t("idn.idAplikaceClientId")}>
            <Input value={entra.clientId} onChange={(e) => setEntra({ ...entra, clientId: e.target.value })} />
          </Field>
          <Field label={t("idn.tajnyKlicAplikaceClientSecret")} hint={existing?.hasSecret ? t("idn.ulozenoVyplnteJenProZmenu") : t("idn.hodnotaValueNeIdKlice")} className="md:col-span-2">
            <Input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </Field>
        </div>
      )}
      <Field label={kind === "ad" ? t("idn.dalsiPrivilegovaneSkupinyJednaNa") : t("idn.dalsiPrivilegovaneRoleJednaNa")} hint={kind === "ad" ? t("idn.vychoziDomainEnterpriseSchemaAdmins") : t("idn.vychoziGlobalAdministratorPrivilegedRole")}>
        <Textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} />
      </Field>
      <div>
        <p className="mb-2 text-sm font-medium">{t("idn.pravidlaKontroly")}</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t("idn.neaktivniPoDnech")}>{num("staleDays")}</Field>
          <Field label={t("idn.hosteNeaktivniPoDnech")}>{num("guestStaleDays")}</Field>
          <Field label={t("idn.nikdyNeprihlasenPoDnech")}>{num("neverLoggedDays")}</Field>
          <Field label={t("idn.maxStariHeslaSpravceDny")}>{num("privilegedPwdDays")}</Field>
          <Field label={t("idn.maxClenuPrivilegovaneSkupiny")}>{num("maxPrivilegedMembers")}</Field>
          {kind === "ad" && <Field label={t("idn.pc.staleDays")}>{num("computerStaleDays")}</Field>}
          <Field label={t("idn.synchronizaceHodin0Rucne")}>
            <Input type="number" value={syncHours} onChange={(e) => setSyncHours(Number(e.target.value))} />
          </Field>
        </div>
      </div>
      {kind === "entra" && (
        <Field label={t("idn.sledovaneSkupinyEntraIdJedna")} hint={t("idn.clenstviSeNacteProToxicke")}>
          <Textarea rows={2} value={tracked} onChange={(e) => setTracked(e.target.value)} />
        </Field>
      )}
      <ProvisioningFields value={prov} onChange={setProv} sourceId={existing?.id ?? null} />
      <Checkbox checked={enabled} onChange={setEnabled} label={t("idn.zdrojZapnuty")} />
      {test && (test.ok ? <SuccessBox>{test.message}</SuccessBox> : <ErrorBox error={new Error(test.message)} />)}
      {test?.notes?.map((n) => (
        <p key={n} className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {n}
        </p>
      ))}
      <ErrorBox error={doTest.error ?? save.error ?? remove.error} />
    </Modal>
  );
}

/* ---------------- synchronizace uživatelů ---------------- */

function ProvisioningFields({ value, onChange, sourceId }: { value: ProvisioningConfig; onChange: (v: ProvisioningConfig) => void; sourceId: string | null }) {
  const t = useT();
  const can = useCan();
  const rolesQ = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles, enabled: can("admin:roles") });
  const [show, setShow] = useState(false);
  const preview = useQuery({ queryKey: ["identity", "provisioning", sourceId, value.group, show], queryFn: () => api.identity.provisioningPreview(sourceId!), enabled: show && !!sourceId });
  const set = (p: Partial<ProvisioningConfig>) => onChange({ ...value, ...p });
  return (
    <Card className="space-y-3 p-4">
      <Checkbox
        checked={value.enabled}
        onChange={(v) => set({ enabled: v })}
        label={t("idn.synchronizovatUzivateleAOrganizacniStruk")}
        hint={t("idn.clenoveZvoleneSkupinySeV")}
      />
      {value.enabled && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("idn.skupinaUzivateluContixu")} hint={t("idn.naprContixUzivateleNeboDomain")}>
              <Input value={value.group} onChange={(e) => set({ group: e.target.value })} />
            </Field>
            <Field label={t("idn.roleNovychUzivatelu")}>
              {rolesQ.data ? (
                <Select value={value.defaultRoleKey} onChange={(e) => set({ defaultRoleKey: e.target.value })}>
                  {rolesQ.data.map((r) => (
                    <option key={r.id} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={value.defaultRoleKey} onChange={(e) => set({ defaultRoleKey: e.target.value })} />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <Checkbox checked={value.units} onChange={(v) => set({ units: v })} label={t("idn.utvaryPodleDepartment")} />
            <Checkbox checked={value.positions} onChange={(v) => set({ positions: v })} label={t("idn.funkcniMistaPodleTitle")} />
            <Checkbox checked={value.deactivate} onChange={(v) => set({ deactivate: v })} label={t("idn.deaktivovatOdesle")} />
          </div>
          {sourceId && (
            <Button variant="secondary" onClick={() => setShow(true)}>
              {t("idn.nahledZmenPodleUlozeneSkupiny")}
            </Button>
          )}
          <ErrorBox error={preview.error} />
          {show && preview.data && (
            <div className="rounded-md bg-slate-50 px-4 py-3 text-xs text-slate-700">
              <p>
                {t("common.create")} <b>{preview.data.create.length}</b> {t("idn.aktualizovat")} {preview.data.update.length} {t("idn.znovuAktivovat")} {preview.data.reactivate.length} {t("idn.deaktivovat")} <b>{preview.data.deactivate.length}</b> {t("idn.rucneZalozenychBezeZmeny")} {preview.data.existing.length} {t("idn.utvaru")} {preview.data.units.length} {t("idn.funkcnichMist")} {preview.data.positions.length}
              </p>
              {preview.data.create.length > 0 && <p className="mt-1">{t("idn.nove", { p: preview.data.create.slice(0, 15).map((x) => x.email).join(", "), p2: preview.data.create.length > 15 ? "…" : "" })}</p>}
              {preview.data.deactivate.length > 0 && <p className="mt-1 text-red-700">{t("idn.deaktivace")} {preview.data.deactivate.slice(0, 15).map((x) => `${x.email} (${x.reason})`).join(", ")}</p>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
