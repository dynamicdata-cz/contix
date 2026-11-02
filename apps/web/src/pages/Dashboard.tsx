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
} from "lucide-react";
import type { ReactNode } from "react";
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
                  <div className="text-4xl font-semibold tabular-nums">
                    {mainFw.summary.score.toLocaleString(formatLocale())} %
                  </div>
                  <ComplianceBar s={mainFw.summary} />
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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {areas}
      </div>
      {!group && (showRisks || showControls) && (
        <TrendsCard className="mb-6" months={12} metrics={["compliance", "risks_unacceptable", "vulns_p1", "vulns_sla_overdue", "obligations_overdue", "findings_overdue"]} />
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
  const body = (
    <Card className="flex h-full flex-col p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-700">
            <Icon size={16} aria-hidden />
          </span>
          {title}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-slate-600">
          <lvl.Icon size={14} color={lvl.color} aria-hidden /> {t(lvl.label)}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="whitespace-nowrap text-3xl font-semibold tabular-nums">
          {main}
        </span>
        <span className="text-sm text-slate-500">{mainLabel}</span>
      </div>
      {segments && !empty && <StackBar segments={segments} />}
      {empty && <p className="mt-3 text-sm text-slate-500">{emptyHint ?? t("dash.emptyHint")}</p>}
      {metrics.length > 0 && !empty && (
        <dl className="mt-3 space-y-1 text-sm">
          {metrics.map((m) => (
            <div key={m.label} className="flex justify-between gap-3">
              <dt className="text-slate-600">{m.label}</dt>
              <dd
                className={cn(
                  "tabular-nums",
                  Number(m.value) > 0 &&
                    m.tone === "bad" &&
                    "font-semibold text-red-700",
                  Number(m.value) > 0 &&
                    m.tone === "warn" &&
                    "font-semibold text-amber-800",
                )}
              >
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {foot && (
        <div className="mt-auto pt-3 text-xs text-slate-400">{foot}</div>
      )}
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
