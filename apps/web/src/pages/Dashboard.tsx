import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import type { MsgKey } from "@contix/shared";
import { useDecree } from "@/lib/regime";
import { useGroupView } from "@/components/company";
import { KpiStrip, TrendsCard } from "@/components/trends";
import { AiEntryCard } from "@/components/aiAnswer";
import {
  HEALTH_COLOR,
  SEVERITY_COLOR,
  STATUS_COLORS,
} from "@/components/health";
import { RISK_COLOR } from "@/components/risk";
import {
  Card,
  CardHeader,
  ErrorBox,
  PageHeader,
  connectorLabel,
  statusLabel,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe, useModule } from "@/lib/auth";
import { cn, fmtDate } from "@/lib/utils";
import { formatLocale } from "@/lib/utils";
import {
  RISK_LABELS,
  VULN_LABELS,
  type DashboardDto,
  type ObligationKind,
  type OpsLevel,
} from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { WorkQueue } from "@/components/workQueue";
import { StatusPill } from "@/components/status";
import { Link, Navigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  FileText,
  GitBranch,
  GraduationCap,
  LifeBuoy,
  OctagonX,
  Presentation,
  Radar,
  Server,
  ShieldAlert,
  Siren,
  Sparkles,
  Target,
  Truck,
  UserLock,
  type LucideIcon,
  KeyRound,
  Crosshair,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { ObligationList } from "./My";

/* ============================================================
 * Úvodní přehled: co hoří (povinnosti po termínu), stav shody a souhrn každé oblasti.
 * Karta oblasti: hlavní číslo, 2–3 doplňkové údaje, stav (ikona + text) podle údajů „po termínu“ / „bez řešení“.
 * ============================================================ */

type Tone = "bad" | "warn" | undefined;
interface Metric {
  label: string;
  value: number | string;
  tone?: Tone;
}
interface Segment {
  key: string;
  label: string;
  n: number;
  color: string;
}

const LEVEL: Record<
  Exclude<OpsLevel, "off">,
  { color: string; Icon: LucideIcon; label: MsgKey }
> = {
  ok: { color: STATUS_COLORS.good, Icon: CheckCircle2, label: "dash.level.ok" as MsgKey },
  warning: {
    color: STATUS_COLORS.serious,
    Icon: AlertTriangle,
    label: "dash.level.warning" as MsgKey,
  },
  error: { color: STATUS_COLORS.critical, Icon: OctagonX, label: "dash.level.error" as MsgKey },
};

const levelOf = (metrics: Metric[]): Exclude<OpsLevel, "off"> =>
  metrics.some((m) => m.tone === "bad" && Number(m.value) > 0)
    ? "error"
    : metrics.some((m) => m.tone === "warn" && Number(m.value) > 0)
      ? "warning"
      : "ok";

export function Dashboard() {
  const t = useT();
  const mod = useModule();
  const can = useCan();
  const me = useMe();
  const group = useGroupView();
  const company = me.companies.find((c) => c.id === me.activeCompanyId);

  const externalOnly = can("audits:external") && !can("audits:read") && !can("obligations:self");
  const showAssets = mod("assets") && can("assets:read");
  const showVulns = showAssets && mod("vulnerabilities");
  const showRisks = mod("risks") && can("risks:read");
  const showControls = mod("controls") && can("controls:read");

  // osobní fronta „Dnes pro vás“ (v1.37) – stejná data jako Moje práce
  const mine = useQuery({ queryKey: ["obligations", "mine"], queryFn: api.notifications.mine, enabled: can("obligations:self"), staleTime: 60_000 });
  const mineNow = (mine.data ?? []).filter((i) => i.urgency !== "later");
  const dash = useQuery({
    enabled: !externalOnly,
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    staleTime: 30_000,
  });
  const stats = useQuery({
    queryKey: ["assets", "stats"],
    queryFn: api.assets.stats,
    enabled: showAssets,
  });
  const vulns = useQuery({
    queryKey: ["vuln-summary"],
    queryFn: api.vulns.summary,
    enabled: showVulns,
  });
  const risks = useQuery({
    queryKey: ["risks", "summary"],
    queryFn: api.risks.summary,
    enabled: showRisks,
  });
  const fws = useQuery({
    queryKey: ["controls", "frameworks"],
    queryFn: api.controls.frameworks,
    enabled: showControls && !group,
  });
  const assurance = useQuery({
    queryKey: ["assurance", "overview"],
    queryFn: api.assurance.overview,
    enabled: showControls,
  });
  const overview = useQuery({
    queryKey: ["companies", "overview"],
    queryFn: api.companies.overview,
    enabled: group,
  });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: api.discovery.runs,
    enabled: mod("discovery") && can("assets:read"),
  });

  // bezpečnostní testy a servery ze sběrače (v1.57)
  const showSecTests = mod("sectests") && can("sectests:read") && !group;
  const secTests = useQuery({ queryKey: ["sectests", "overview"], queryFn: api.secTests.overview, enabled: showSecTests, staleTime: 60_000 });
  const hosts = useQuery({ queryKey: ["hosts"], queryFn: api.hosts.list, enabled: showAssets, staleTime: 60_000 });

  const d = dash.data;
  const ob = (k: ObligationKind) =>
    d?.obligations?.byKind[k] ?? { overdue: 0, soon: 0 };
  const regimeFw = useDecree();

  const areas: ReactNode[] = [];

  if (showRisks && risks.data) {
    const r = risks.data;
    areas.push(
      <AreaCard
        key="risks"
        empty={r.byLevel.critical + r.byLevel.high + r.byLevel.medium + r.byLevel.low + r.byLevel.unassessed === 0}
        to="/risks"
        icon={ShieldAlert}
        title={t("dash.area.risks")}
        main={
          (["critical", "high", "medium", "low"] as const).reduce(
            (n, l) => n + r.byLevel[l],
            0,
          ) + r.byLevel.unassessed
        }
        mainLabel={t("dash.main.risks")}
        segments={(
          ["critical", "high", "medium", "low", "unassessed"] as const
        ).map((l) => ({
          key: l,
          label: l === "unassessed" ? t("dash.risk.unassessed") : t.dyn(`enum.risk.level.${l}`, RISK_LABELS.level[l]),
          n: r.byLevel[l],
          color: RISK_COLOR[l],
        }))}
        metrics={[
          {
            label: t("dash.m.risk.untreated"),
            value: r.untreated,
            tone: "bad",
          },
          { label: t("dash.m.risk.overdue"), value: r.overdue, tone: "bad" },
          { label: t("dash.m.risk.review"), value: r.reviewDue, tone: "warn" },
        ]}
      />,
    );
  }

  if (showAssets && stats.data) {
    const total = stats.data.byType.reduce((s, x) => s + x.n, 0);
    const h = vulns.data?.health;
    areas.push(
      <AreaCard
        key="assets"
        empty={total === 0}
        to="/assets"
        icon={Server}
        title={t("dash.area.assets")}
        main={total}
        mainLabel={t("dash.main.assets")}
        segments={
          h
            ? (["red", "orange", "green", "unknown"] as const).map((k) => ({
                key: k,
                label: t.dyn(`enum.vuln.health.${k}`, VULN_LABELS.health[k]),
                n: h[k],
                color: HEALTH_COLOR[k],
              }))
            : undefined
        }
        metrics={[
          {
            label: t("dash.m.critical"),
            value:
              stats.data.byCriticality.find((x) => x.key === "critical")?.n ??
              0,
          },
          {
            label: t("dash.m.noOwner"),
            value: stats.data.withoutOwner,
            tone: "warn",
          },
          ...(h
            ? [{ label: t("dash.m.asset.red"), value: h.red, tone: "bad" as Tone }]
            : []),
        ]}
      />,
    );
  }

  if (showVulns && vulns.data) {
    const v = vulns.data;
    areas.push(
      <AreaCard
        key="vulns"
        empty={!v.lastSync}
        emptyHint={t("dash.vulnHint")}
        to="/vulnerabilities"
        icon={Bug}
        title={t("dash.area.vulns")}
        main={
          v.openBySeverity.critical +
          v.openBySeverity.high +
          v.openBySeverity.medium +
          v.openBySeverity.low
        }
        mainLabel={t("dash.main.vulns")}
        segments={(["critical", "high", "medium", "low"] as const).map((k) => ({
          key: k,
          label: t.lbl(VULN_LABELS.severity[k]),
          n: v.openBySeverity[k],
          color: SEVERITY_COLOR[k],
        }))}
        metrics={[
          {
            label: t("dash.m.critical"),
            value: v.openBySeverity.critical,
            tone: "bad",
          },
          { label: t("dash.m.high"), value: v.openBySeverity.high, tone: "warn" },
          { label: t("dash.m.vuln.eol"), value: v.support.eol, tone: "warn" },
        ]}
        foot={
          v.lastSync
            ? t("dash.synced", { time: fmtDate(v.lastSync) })
            : t("dash.notSynced")
        }
      />,
    );
  }

  if (showControls && assurance.data) {
    const a = assurance.data;
    const tested = a.implementedControls
      ? Math.round(
          ((a.implementedControls - a.implementedNotTested) /
            a.implementedControls) *
            100,
        )
      : 0;
    areas.push(
      <AreaCard
        key="assurance"
        empty={a.implementedControls === 0}
        to="/controls/assurance"
        icon={ClipboardCheck}
        title={t("dash.area.assurance")}
        main={`${tested} %`}
        mainLabel={t("dash.main.assurance", { n: a.implementedControls })}
        metrics={[
          { label: t("dash.m.assurance.overdue"), value: a.testsOverdue, tone: "bad" },
          {
            label: t("dash.m.assurance.ineffective"),
            value: a.testsLastYear.ineffective ?? 0,
            tone: "bad",
          },
          {
            label: t("dash.m.assurance.noEvidence"),
            value: a.implementedWithoutEvidence,
            tone: "warn",
          },
          { label: t("dash.m.assurance.expired"), value: a.evidenceExpired, tone: "warn" },
        ]}
      />,
    );
  }

  if (d?.incidents)
    areas.push(
      <AreaCard
        key="incidents"
        to="/incidents"
        icon={Siren}
        title={t("dash.area.incidents")}
        main={d.incidents.open}
        mainLabel={t("dash.main.incidents")}
        metrics={[
          {
            label: t("dash.m.inc.reportOverdue"),
            value: ob("incident_report").overdue,
            tone: "bad",
          },
          {
            label: t("dash.m.inc.untriaged"),
            value: d.incidents.unassessed,
            tone: "warn",
          },
          { label: t("dash.m.inc.events"), value: d.incidents.openEvents },
        ]}
      />,
    );

  if (d?.audits)
    areas.push(
      <AreaCard
        key="audits"
        to="/audits"
        icon={Target}
        title={t("dash.area.audits")}
        main={d.audits.openFindings}
        mainLabel={t("dash.main.audits")}
        metrics={[
          {
            label: t("dash.m.audit.overdue"),
            value: d.audits.overdueFindings,
            tone: "bad",
          },
          { label: t("dash.m.audit.major"), value: d.audits.major, tone: "warn" },
          { label: t("dash.m.audit.planned"), value: d.audits.planned },
        ]}
      />,
    );

  if (d?.continuity)
    areas.push(
      <AreaCard
        key="continuity"
        empty={d.continuity.plans === 0}
        to="/bia"
        icon={LifeBuoy}
        title={t("dash.area.continuity")}
        main={`${d.continuity.approvedPlans} / ${d.continuity.plans}`}
        mainLabel={t("dash.main.continuity")}
        metrics={[
          {
            label: t("dash.m.cont.overdue"),
            value: ob("plan_test").overdue,
            tone: "bad",
          },
          { label: t("dash.m.cont.bia"), value: d.continuity.bia },
        ]}
      />,
    );

  if (d?.isms)
    areas.push(
      <AreaCard
        key="isms"
        to="/isms"
        icon={Radar}
        title={t("dash.area.isms")}
        main={d.isms.openChanges}
        mainLabel={t("dash.main.isms")}
        metrics={[
          {
            label: t("dash.m.isms.significant"),
            value: d.isms.significantOpen,
            tone: "warn",
          },
          {
            label: t("dash.m.isms.overdue"),
            value: ob("change").overdue,
            tone: "bad",
          },
          {
            label: t("dash.m.isms.reviewOverdue"),
            value: ob("isms_review").overdue,
            tone: "bad",
          },
        ]}
      />,
    );

  if (d?.policies)
    areas.push(
      <AreaCard
        key="policies"
        empty={d.policies.active === 0}
        to="/policies"
        icon={FileText}
        title={t("dash.area.policies")}
        main={d.policies.active}
        mainLabel={t("dash.main.policies")}
        metrics={[
          {
            label: t("dash.m.reviewOverdue"),
            value: ob("policy_review").overdue,
            tone: "bad",
          },
          { label: t("dash.m.drafts"), value: d.policies.draft },
        ]}
      />,
    );

  if (d?.gdpr)
    areas.push(
      <AreaCard
        key="gdpr"
        empty={d.gdpr.activities === 0}
        to="/gdpr"
        icon={UserLock}
        title={t("dash.area.gdpr")}
        main={d.gdpr.activities}
        mainLabel={t("dash.main.gdpr")}
        metrics={[
          { label: t("dash.m.gdpr.dpia"), value: d.gdpr.dpiaMissing, tone: "bad" },
          { label: t("dash.m.reviewOverdue"), value: ob("processing_review").overdue, tone: "warn" },
          { label: t("dash.m.gdpr.drafts"), value: d.gdpr.drafts },
        ]}
      />,
    );

  if (d?.identity)
    areas.push(
      <AreaCard
        key="identity"
        to="/identity"
        icon={KeyRound}
        title={t("dash.area.identity")}
        main={d.identity.open}
        mainLabel={d.identity.sources ? t("dash.main.identity") : t("dash.main.noDirectory")}
        metrics={[
          { label: t("dash.m.id.critical"), value: d.identity.critical, tone: "bad" },
          { label: t("dash.m.id.high"), value: d.identity.high, tone: "warn" },
          { label: t("dash.m.id.privileged"), value: d.identity.privileged },
          ...(d.identity.sourceErrors ? [{ label: t("dash.m.id.syncError"), value: d.identity.sourceErrors, tone: "bad" as const }] : []),
        ]}
      />,
    );

  if (d?.awareness)
    areas.push(
      <AreaCard
        key="awareness"
        empty={d.awareness.courses === 0}
        to="/awareness"
        icon={GraduationCap}
        title={t("dash.area.awareness")}
        main={d.awareness.courses}
        mainLabel={t("dash.main.awareness")}
        metrics={[
          {
            label: t("dash.m.aw.overdue"),
            value: ob("training").overdue,
            tone: "bad",
          },
        ]}
      />,
    );

  if (d?.suppliers)
    areas.push(
      <AreaCard
        key="suppliers"
        empty={d.suppliers.total === 0}
        to="/suppliers"
        icon={Truck}
        title={t("dash.area.suppliers")}
        main={d.suppliers.total}
        mainLabel={t("dash.main.suppliers")}
        metrics={[
          { label: t("dash.m.sup.significant"), value: d.suppliers.significant },
          {
            label: t("dash.m.sup.contracts"),
            value: ob("contract").overdue + ob("contract").soon,
            tone: "warn",
          },
        ]}
      />,
    );

  if (d?.processes)
    areas.push(
      <AreaCard
        key="processes"
        empty={d.processes.total === 0}
        to="/processes"
        icon={GitBranch}
        title={t("dash.area.processes")}
        main={d.processes.total}
        mainLabel={t("dash.main.processes")}
        metrics={[
          {
            label: t("dash.m.noOwner"),
            value: d.processes.withoutOwner,
            tone: "warn",
          },
        ]}
      />,
    );

  if (showSecTests && secTests.data) {
    const st = secTests.data;
    const open = st.open.critical + st.open.high + st.open.medium + st.open.low;
    areas.push(
      <AreaCard
        key="sectests"
        empty={!st.runs30d && !open && !st.lastRunAt}
        emptyHint={t("dash.st.empty")}
        to="/security-tests"
        icon={Crosshair}
        title={t("st.title")}
        main={open}
        mainLabel={t("dash.st.main")}
        segments={(["critical", "high", "medium", "low"] as const).map((k) => ({ key: k, label: t(`st.sev.${k}`), n: st.open[k], color: SEVERITY_COLOR[k] }))}
        metrics={[
          { label: t("dash.st.critHigh"), value: st.open.critical + st.open.high, tone: "bad" },
          { label: t("dash.st.runs30"), value: st.active ? t("dash.st.runsActive", { n: st.runs30d, a: st.active }) : st.runs30d },
          { label: t("dash.st.fixed30"), value: st.fixed30d },
          { label: t("dash.st.probes"), value: `${st.probes.online} / ${st.probes.total}`, tone: st.probes.total && !st.probes.online ? "warn" : undefined },
        ]}
        foot={st.lastRunAt ? t("dash.st.last", { date: fmtDate(st.lastRunAt) }) : undefined}
      />,
    );
  }
  if (showAssets && hosts.data && hosts.data.length > 0) {
    const hs = hosts.data;
    const stale = hs.filter((h) => Date.now() - new Date(h.collectedAt).getTime() > 2 * 86400_000).length;
    areas.push(
      <AreaCard
        key="hosts"
        to="/discovery"
        icon={Server}
        title={t("dash.hosts.title")}
        main={hs.length}
        mainLabel={t("dash.hosts.main")}
        segments={[
          { key: "high", label: t("dash.hosts.withHigh"), n: hs.filter((h) => h.high > 0).length, color: STATUS_COLORS.critical },
          { key: "medium", label: t("dash.hosts.withMedium"), n: hs.filter((h) => !h.high && h.medium > 0).length, color: STATUS_COLORS.serious },
          { key: "ok", label: t("dash.hosts.clean"), n: hs.filter((h) => !h.high && !h.medium).length, color: STATUS_COLORS.good },
        ]}
        metrics={[
          { label: t("dash.hosts.highFindings"), value: hs.reduce((a, h) => a + h.high, 0), tone: "bad" },
          { label: t("dash.hosts.secUpdates"), value: hs.filter((h) => (h.securityUpdates ?? 0) > 0).length, tone: "warn" },
          { label: t("dash.hosts.stale"), value: stale, tone: "warn" },
        ]}
      />,
    );
  }

  if (d?.ai && d.ai.proposed > 0)
    areas.push(
      <AreaCard
        key="ai"
        icon={Sparkles}
        title={t("dash.area.ai")}
        main={d.ai.proposed}
        mainLabel={t("dash.main.ai")}
        metrics={[]}
        foot={t("dash.aiFoot")}
      />,
    );

  // jen rámce v rozsahu společnosti (zákon, vyhláška podle režimu, zvolené další rámce – ADR-074)
  const comp = (fws.data ?? []).filter((f) => f.inScope && f.summary.applicable > 0);
  const mainFw = comp.find((f) => f.id === regimeFw) ?? comp[0];

  if (externalOnly) return <Navigate to="/audit-portal" />;
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("nav.overview")}
        subtitle={
          group
            ? t("dash.subtitleGroup")
            : t("dash.subtitle", { company: company ? ` – ${company.name}` : "" })
        }
        actions={
          can("isms:read", "risks:read", "controls:read") && (
            <Link
              to="/management"
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <Presentation size={16} /> {t("nav.managementReport")}
            </Link>
          )
        }
      />
      <ErrorBox error={dash.error} />
      <SetupBanner />
      {can("obligations:self") && mine.data && (
        <Card className="mb-6 overflow-hidden" data-testid="today-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">{t("wq.todayTitle")}</h2>
            <span className="text-sm text-slate-500">{mineNow.length ? t("wq.todaySub", { n: mineNow.length, o: mineNow.filter((i) => i.urgency === "overdue").length }) : t("wq.todayNone")}</span>
            <Link to="/my" className="ml-auto text-sm text-brand-600 hover:underline">
              {t("wq.toMyWork")}
            </Link>
          </div>
          {mineNow.length > 0 && <WorkQueue items={mineNow} showCompany={group} limit={5} compact />}
        </Card>
      )}
      {!group && (showRisks || showControls) && <KpiStrip className="mb-6" />}
      <AiEntryCard className="mb-6" overdue={d?.obligations?.overdue ?? 0} />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader
            title={t("dash.obligations")}
            subtitle={
              d?.obligations
                ? t("dash.obligationsSub", { overdue: d.obligations.overdue, soon: d.obligations.soon, scope: group ? t("dash.scope.group") : t("dash.scope.company") })
                : t("dash.obligationsEmpty")
            }
            action={
              <Link to="/my" className="text-sm text-brand-600 hover:underline">
                {t("dash.all")}
              </Link>
            }
          />
          <ObligationList
            items={(d?.obligations?.top ?? []).slice(0, 7)}
            showCompany={group}
          />
          {d?.obligations && d.obligations.overdue + d.obligations.soon > 7 && (
            <Link
              to="/my"
              className="block border-t border-slate-100 px-5 py-2.5 text-sm text-brand-700 hover:bg-slate-50"
            >
              {t("dash.more", { n: d.obligations.overdue + d.obligations.soon - 7 })}
            </Link>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title={t("dash.compliance")}
            subtitle={
              group
                ? t("dash.complianceGroup")
                : mainFw
                  ? t("dash.complianceSub")
                  : t("dash.notAssessed")
            }
          />
          {group ? (
            <div className="space-y-3 p-5">
              {(overview.data ?? []).map((co) => (
                <div
                  key={co.id}
                  className="text-sm"
                  style={{ paddingLeft: co.depth * 12 }}
                >
                  <div className="flex justify-between gap-3">
                    <span className="truncate">{co.name}</span>
                    <span className="shrink-0 tabular-nums">
                      {co.compliance == null
                        ? "—"
                        : `${co.compliance.toLocaleString(formatLocale())} %`}{" "}
                      <span className="text-xs text-slate-500">
                        {co.framework === "cz410" ? "410" : "409"}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    {co.compliance != null && (
                      <div
                        className="h-full"
                        style={{
                          width: `${co.compliance}%`,
                          background:
                            co.compliance >= 80
                              ? STATUS_COLORS.good
                              : co.compliance >= 50
                                ? STATUS_COLORS.serious
                                : STATUS_COLORS.critical,
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
              <Link
                to="/group"
                className="block pt-1 text-sm text-brand-700 hover:underline"
              >
                {t("dash.groupLink")}
              </Link>
            </div>
          ) : (
            <div className="space-y-4 p-5">
              {mainFw && (
                <Link
                  to="/controls/soa"
                  search={{ framework: mainFw.id }}
                  className="block"
                >
                  <div className="text-xs text-slate-500">
                    {t("dash.regimeFw", { fw: mainFw.shortName })}
                  </div>
                  <ComplianceRing s={mainFw.summary} />
                </Link>
              )}
              <ul className="space-y-2">
                {comp
                  .filter((f) => f !== mainFw)
                  .map((f) => (
                    <li key={f.id}>
                      <Link
                        to="/controls/soa"
                        search={{ framework: f.id }}
                        className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-3 text-sm hover:text-brand-700"
                      >
                        <span className="truncate text-slate-600">
                          {f.shortName}
                        </span>
                        <ComplianceBar s={f.summary} thin />
                        <span className="text-right tabular-nums">
                          {f.summary.score.toLocaleString(formatLocale())} %
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
              {!comp.length && (
                <p className="text-sm text-slate-500">
                  {t("dash.noAssessed")}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      <AreaSections areas={areas} />
      {!group && (showRisks || showControls) && (
        <TrendsCard id="dashboard" className="mb-6" months={12} metrics={["compliance", "risks_unacceptable", "vulns_p1", "vulns_sla_overdue", "obligations_overdue", "findings_overdue"]} />
      )}

      {runs.data && runs.data.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={t("dash.discovery")}
            action={
              <Link
                to="/discovery"
                className="text-sm text-brand-600 hover:underline"
              >
                {t("dash.all")}
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100">
            {runs.data.slice(0, 4).map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[10rem_1fr_8rem_6rem] items-center gap-3 px-5 py-2.5 text-sm"
              >
                <span className="font-medium">
                  {t.lbl(connectorLabel[r.connector]) ?? r.connector}
                </span>
                <span className="text-slate-500">{fmtDate(r.createdAt)}</span>
                <span className="text-slate-500 tabular-nums">
                  {t("dash.runStats", { created: r.stats.created ?? 0, updated: r.stats.updated ?? 0 })}
                </span>
                <span
                  className={cn(
                    "text-right text-xs",
                    r.status === "failed" ? "text-red-700" : "text-slate-600",
                  )}
                >
                  {t.dyn(`enum.run.${r.status}`, statusLabel[r.status] ?? r.status)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function AreaCard({
  to,
  icon: Icon,
  title,
  main,
  mainLabel,
  metrics,
  segments,
  foot,
  empty,
  emptyHint,
}: {
  empty?: boolean;
  emptyHint?: string;
  to?: string;
  icon: LucideIcon;
  title: string;
  main: number | string;
  mainLabel: string;
  metrics: Metric[];
  segments?: Segment[];
  foot?: string;
}) {
  const t = useT();
  // prázdná evidence není „v pořádku“ – jen ještě nevyplněná
  const lvl = empty ? { color: STATUS_COLORS.neutral, Icon: CircleDashed, label: "dash.level.empty" as MsgKey } : LEVEL[levelOf(metrics)];
  const tint = (pct: number) => `color-mix(in srgb, ${lvl.color} ${pct}%, transparent)`;
  const body = (
    <Card className={cn("relative flex h-full flex-col overflow-hidden p-4 transition duration-150 hover:-translate-y-0.5 hover:shadow-md", empty && "opacity-90")}>
      {/* barevný proužek nahoře = stav oblasti (text stavu je vpravo – barva není jediný nosič) */}
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: tint(empty ? 30 : 70) }} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-800">
          <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: tint(14), color: empty ? undefined : lvl.color }}>
            <Icon size={17} aria-hidden className={empty ? "text-slate-500" : undefined} />
          </span>
          {title}
        </div>
        <StatusPill level={empty ? "empty" : levelOf(metrics)} />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="whitespace-nowrap text-[32px] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
          {main}
        </span>
        <span className="text-sm text-slate-500">{mainLabel}</span>
      </div>
      {segments && !empty && <StackBar segments={segments} />}
      {empty && <p className="mt-3 text-sm text-slate-500">{emptyHint ?? t("dash.emptyHint")}</p>}
      {metrics.length > 0 && !empty && (
        <dl className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          {metrics.map((m) => (
            <div key={m.label} className="flex justify-between gap-3 py-1.5">
              <dt className="text-slate-600">{m.label}</dt>
              <dd
                className={cn(
                  "tabular-nums font-medium text-slate-800",
                  // nuly ztlumeně – stejně jako ve Zprávě pro vedení (v1.58.1)
                  (m.value === 0 || m.value === "0") && "font-normal text-slate-400",
                  Number(m.value) > 0 && m.tone === "bad" && "rounded bg-red-50 px-1.5 font-semibold text-red-700",
                  Number(m.value) > 0 && m.tone === "warn" && "rounded bg-amber-50 px-1.5 font-semibold text-amber-800",
                )}
              >
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {foot && <div className="mt-auto pt-3 text-xs text-slate-400">{foot}</div>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Oblasti rozdělené do sekcí; nevyplněné oblasti v jedné kompaktní kartě (v1.57). */
const TECH_AREAS = new Set(["assets", "vulns", "incidents", "identity", "sectests", "hosts"]);
function AreaSections({ areas }: { areas: ReactNode[] }) {
  const t = useT();
  type P = Parameters<typeof AreaCard>[0];
  const els = areas.filter((a): a is ReactElement<P> => !!a && typeof a === "object" && "props" in (a as object));
  const filled = els.filter((e) => !e.props.empty);
  const empty = els.filter((e) => e.props.empty);
  const attention = (list: ReactElement<P>[]) => list.filter((e) => levelOf(e.props.metrics) !== "ok").length;
  const section = (title: string, list: ReactElement<P>[], testId: string) =>
    list.length > 0 && (
      <section className="mb-6" data-testid={testId}>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
          {attention(list) > 0 && <span className="text-xs font-medium text-amber-800">{t("dash.sec.attention", { n: attention(list) })}</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{list}</div>
      </section>
    );
  return (
    <>
      {section(t("dash.sec.tech"), filled.filter((e) => TECH_AREAS.has(String(e.key))), "dash-tech")}
      {section(t("dash.sec.gov"), filled.filter((e) => !TECH_AREAS.has(String(e.key))), "dash-gov")}
      {empty.length > 0 && (
        <Card className="mb-6 p-4" data-testid="dash-empty">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <CircleDashed size={16} className="text-slate-400" aria-hidden /> {t("dash.sec.empty")}
            <span className="font-normal text-slate-500">{t("dash.sec.emptyHint")}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {empty.map((e) => {
              const I = e.props.icon;
              const chip = (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50">
                  <I size={14} aria-hidden className="text-slate-500" /> {e.props.title}
                </span>
              );
              return e.props.to ? (
                <Link key={String(e.key)} to={e.props.to}>
                  {chip}
                </Link>
              ) : (
                <span key={String(e.key)}>{chip}</span>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

/** Prstenec míry shody: splněno / částečně / nesplněno / neposouzeno + legenda s počty. */
function ComplianceRing({ s }: { s: { score: number; applicable: number; byCompliance: Record<string, number> } }) {
  const t = useT();
  const parts = [
    { k: "compliant", c: STATUS_COLORS.good, l: t("dash.ring.compliant") },
    { k: "partial", c: STATUS_COLORS.serious, l: t("dash.ring.partial") },
    { k: "non_compliant", c: STATUS_COLORS.critical, l: t("dash.ring.non") },
    { k: "not_assessed", c: STATUS_COLORS.neutral, l: t("dash.ring.na") },
  ];
  const total = Math.max(1, s.applicable);
  const R = 52;
  const C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="mt-2 flex items-center gap-5">
      <svg viewBox="0 0 128 128" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label={`${s.score} %`}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--color-slate-100)" strokeWidth="14" />
        {parts.map((p) => {
          const n = s.byCompliance[p.k] ?? 0;
          if (!n) return null;
          const len = (n / total) * C;
          const el = <circle key={p.k} cx="64" cy="64" r={R} fill="none" stroke={p.c} strokeWidth="14" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-off} />;
          off += len;
          return el;
        })}
        <text x="64" y="64" transform="rotate(90 64 64)" textAnchor="middle" dominantBaseline="central" className="fill-slate-900 text-[26px] font-semibold tabular-nums">
          {s.score.toLocaleString(formatLocale())} %
        </text>
      </svg>
      <ul className="min-w-0 space-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.k} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.c }} aria-hidden />
            <span className="flex-1 truncate text-slate-600">{p.l}</span>
            <span className="tabular-nums font-medium text-slate-800">{s.byCompliance[p.k] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Skládaný pruh s legendou (hodnoty jsou i v textu – barva není jediný nosič informace). */
function StackBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.n, 0);
  if (!total) return null;
  return (
    <div className="mt-3">
      <div
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={segments.map((s) => `${s.label} ${s.n}`).join(", ")}
      >
        {segments
          .filter((s) => s.n > 0)
          .map((s) => (
            <span
              key={s.key}
              style={{ width: `${(s.n / total) * 100}%`, background: s.color }}
              title={`${s.label}: ${s.n}`}
            />
          ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
        {segments
          .filter((s) => s.n > 0)
          .map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: s.color }}
                aria-hidden
              />
              {s.label} <span className="tabular-nums">{s.n}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

function ComplianceBar({
  s,
  thin,
}: {
  s: { applicable: number; byCompliance: Record<string, number> };
  thin?: boolean;
}) {
  const parts = [
    { k: "compliant", c: STATUS_COLORS.good },
    { k: "partial", c: STATUS_COLORS.serious },
    { k: "non_compliant", c: STATUS_COLORS.critical },
    { k: "not_assessed", c: STATUS_COLORS.neutral },
  ];
  const total = Math.max(1, s.applicable);
  return (
    <div
      className={cn(
        "flex gap-0.5 overflow-hidden rounded-full bg-slate-100",
        thin ? "h-1.5" : "mt-2 h-2.5",
      )}
    >
      {parts.map((p) =>
        s.byCompliance[p.k] ? (
          <span
            key={p.k}
            style={{
              width: `${(s.byCompliance[p.k]! / total) * 100}%`,
              background: p.c,
            }}
          />
        ) : null,
      )}
    </div>
  );
}

/** Správci: dokud není nastavení dokončené, upozorní na průvodce. */
function SetupBanner() {
  const t = useT();
  const can = useCan();
  const q = useQuery({ queryKey: ["setup"], queryFn: api.setup.get, enabled: can("admin:settings"), staleTime: 5 * 60_000 });
  // nová instalace (v1.73): dokud správce průvodce nedokončí, nabízí se průvodce prvním nastavením
  const w = useQuery({ queryKey: ["setup", "wizard"], queryFn: api.setup.wizard, enabled: can("admin:settings"), staleTime: 5 * 60_000 });
  if (w.data && !w.data.finishedAt && w.data.done < w.data.total)
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-5 py-3 text-sm" data-testid="dash-wizard">
        <span className="font-medium text-brand-900">{t("wiz.banner", { done: w.data.done, total: w.data.total })}</span>
        <span className="text-brand-800">{t("wiz.bannerHint")}</span>
        <Link to="/setup-wizard" className="ml-auto font-medium text-brand-700 hover:underline">
          {t("wiz.bannerOpen")}
        </Link>
      </div>
    );
  if (!q.data || q.data.ready) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-5 py-3 text-sm">
      <span className="font-medium text-brand-900">{t("dash.setup", { done: q.data.done, total: q.data.total })}</span>
      <span className="text-brand-800">{t("dash.setupHint")}</span>
      <Link to="/admin/setup" className="ml-auto font-medium text-brand-700 hover:underline">
        {t("dash.setupContinue")}
      </Link>
    </div>
  );
}
