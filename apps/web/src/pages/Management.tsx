import { RemediationTable } from "@/pages/Findings";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { TrendsCard, useChartPrefs } from "@/components/trends";

const MGMT_METRICS = ["compliance", "compliance_path", "controls_tested_pct", "risks_unacceptable", "risks_untreated", "plan_overdue", "findings_overdue", "vulns_critical", "vulns_high", "vulns_p1", "vulns_sla_overdue", "assets_red", "obligations_overdue", "exceptions_expired", "incidents_significant"] satisfies TrendMetric[];
import { SocReportCard } from "@/components/soc";
import { useT } from "@/lib/i18n";
import { NeedsCompany, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import {
  Button,
  Card,
  CardHeader,
  ErrorBox,
  Field,
  Input,
  PageHeader,
} from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/utils";
import { managementHealthScore, type OpsLevel, type TrendMetric } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  OctagonX,
  Printer,
} from "lucide-react";
import { useState } from "react";
import { filterQueue, WorkQueue } from "@/components/workQueue";
import { useCan } from "@/lib/auth";
import { LEVEL_STYLE, StatusDot, StatusPill, tint } from "@/components/status";

const LEVEL: Record<
  OpsLevel,
  { color: string; Icon: typeof CheckCircle2; label: string }
> = {
  ok: { color: STATUS_COLORS.good, Icon: CheckCircle2, label: "V pořádku" },
  warning: {
    color: STATUS_COLORS.serious,
    Icon: AlertTriangle,
    label: "Pozor",
  },
  error: {
    color: STATUS_COLORS.critical,
    Icon: OctagonX,
    label: "Vyžaduje rozhodnutí",
  },
  off: { color: STATUS_COLORS.neutral, Icon: CheckCircle2, label: "—" },
};

/** Zpráva o stavu kybernetické bezpečnosti pro vedení – semafor klíčových ukazatelů, tisk a Word. */
export function ManagementPage() {
  const t = useT();
  const group = useGroupView();
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [period, setPeriod] = useState({
    periodFrom: yearAgo,
    periodTo: today,
  });
  const q = useQuery({
    queryKey: ["reports", "management", period],
    queryFn: () => api.reports.management(period),
    enabled: !group,
  });
  const r = q.data;
  // grafy ve zprávě = nastavení karty Vývoj ukazatelů (v1.39, ADR-136)
  const chart = useChartPrefs("management", { months: 12, metrics: MGMT_METRICS });
  const exportQ = { ...period, charts: chart.metrics.filter((k) => !k.startsWith("compliance:")).join(","), chart: chart.prefs.type, months: String(chart.prefs.months) };
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("isms.zpravaProVedeni")}
        subtitle={t("isms.stavKybernetickeBezpecnostiNaJedne")}
        actions={
          !group && (
            <>
              <a
                href={api.reports.managementHtmlUrl(exportQ)}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="secondary">
                  <Printer size={16} /> {t("isms.tiskPdf")}
                </Button>
              </a>
              <a href={api.reports.managementDocxUrl(exportQ)}>
                <Button>
                  <FileDown size={16} /> {t("isms.word")}
                </Button>
              </a>
            </>
          )
        }
      />
      <NeedsCompany what={t("isms.zpravaProVedeni")}>
        <div className="mb-6 flex flex-wrap items-end gap-4">
          <Field label={t("isms.obdobiOd")}>
            <Input
              type="date"
              value={period.periodFrom}
              onChange={(e) =>
                e.target.value &&
                setPeriod({ ...period, periodFrom: e.target.value })
              }
            />
          </Field>
          <Field label={t("isms.do")}>
            <Input
              type="date"
              value={period.periodTo}
              onChange={(e) =>
                e.target.value &&
                setPeriod({ ...period, periodTo: e.target.value })
              }
            />
          </Field>
          {r && (
            <p className="pb-2 text-sm text-slate-500">
              {t("isms.stavK", { p: new Date(r.generatedAt).toLocaleString("cs-CZ") })}
            </p>
          )}
        </div>
        <ErrorBox error={q.error} />
        {r && (
          <>
            <ExecutivePanel kpis={r.kpis} />
            <Scorecard kpis={r.kpis} />

            <TrendsCard id="management" className="mb-6" months={12} title={t("trend.mgmtTitle")} subtitle={t("chart.mgmtHint")} metrics={MGMT_METRICS} state={chart} />

            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="overflow-hidden">
                <CardHeader title={t("isms.shodaSPozadavky")} />
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-2">{t("isms.ramec")}</th>
                      <th className="px-3 py-2 text-right">{t("isms.shoda")}</th>
                      <th className="px-3 py-2 text-right">{t("isms.splneno")}</th>
                      <th className="px-3 py-2 text-right">{t("isms.castecne")}</th>
                      <th className="px-3 py-2 text-right">{t("isms.nesplneno")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.compliance.map((c) => (
                      <tr key={c.framework}>
                        <td className="px-5 py-2.5">
                          <div className="font-medium text-slate-800">{c.name}</div>
                          <ComplianceStack c={c} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums" style={{ color: scoreColor(c.score) }}>
                          {c.score.toLocaleString("cs-CZ")} %
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.compliant}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.partial}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {c.nonCompliant}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Card className="overflow-hidden">
                <CardHeader
                  title={t("isms.incidentyVObdobi")}
                  subtitle={
                    r.incidents
                      ? t("isms.incidentuVyznamnychUdalosti", { incidents: r.incidents.incidents, significant: r.incidents.significant, events: r.incidents.events })
                      : t("isms.modulJeVypnuty")
                  }
                />
                {r.incidents && (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {r.incidents.list.map((x, i) => (
                      <li
                        key={i}
                        className="flex justify-between gap-3 px-5 py-2"
                      >
                        <span>
                          {x.code && (
                            <span className="mr-1.5 text-slate-500">
                              {x.code}
                            </span>
                          )}
                          {x.title}
                          {x.significant && (
                            <span className="ml-2 text-xs text-red-700">
                              {t("isms.vyznamny")}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {fmtDay(x.detectedAt)}
                        </span>
                      </li>
                    ))}
                    {r.incidents.list.length === 0 && (
                      <li className="px-5 py-3 text-slate-500">
                        {t("isms.zadneIncidenty")}
                      </li>
                    )}
                  </ul>
                )}
              </Card>
              {r.soc && <SocReportCard s={r.soc} />}
              {r.findings && (r.findings.total.open > 0 || r.findings.total.fixed > 0) && (
                <Card className="overflow-hidden lg:col-span-2" data-testid="mgmt-findings">
                  <CardHeader title={t("fnd.rem.mgmtTitle")} subtitle={t("fnd.rem.subtitle", { from: fmtDay(r.findings.from), to: fmtDay(r.findings.to) })} />
                  <RemediationTable d={r.findings} />
                </Card>
              )}
            </div>
          </>
        )}
      </NeedsCompany>
    </>
  );
}

/* ---------------- řídicí panel pro vedení (v1.38, ADR-135) ---------------- */

type Kpi = { key: string; label: string; value: string | number; detail: string | null; level: OpsLevel; link: string | null };

const scoreColor = (n: number) => (n >= 80 ? STATUS_COLORS.good : n >= 50 ? STATUS_COLORS.serious : STATUS_COLORS.critical);
const ORDER: Record<OpsLevel, number> = { error: 0, warning: 1, ok: 2, off: 3 };

/** Všechny ukazatele (v1.58.1): co vyžaduje pozornost v plné šíři, co je v pořádku kompaktně a ztlumeně. */
function Scorecard({ kpis }: { kpis: Kpi[] }) {
  const t = useT();
  const bad = [...kpis].filter((k) => k.level === "error" || k.level === "warning").sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const ok = kpis.filter((k) => k.level !== "error" && k.level !== "warning");
  const wrap = (k: Kpi, body: React.ReactNode) =>
    k.link ? (
      <Link to={k.link as never} className="block">
        {body}
      </Link>
    ) : (
      body
    );
  return (
    <Card className="mb-6 overflow-hidden" data-testid="mgmt-scorecard">
      <CardHeader title={t("exe.allKpis")} subtitle={t("exe.scorecardSub")} />
      {bad.length > 0 && (
        <>
          <div className="bg-slate-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("exe.attentionGroup", { n: bad.length })}</div>
          <ul className="divide-y divide-slate-100">
            {bad.map((k) => (
              <li key={k.key} data-testid={`kpi-${k.key}`}>
                {wrap(
                  k,
                  <div className="flex items-center gap-4 px-5 py-3 transition hover:bg-slate-50">
                    <StatusDot level={k.level} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900">{k.label}</div>
                      {k.detail && <div className="mt-0.5 text-xs text-slate-500">{k.detail}</div>}
                    </div>
                    <div className={`w-20 shrink-0 text-right text-xl font-semibold tabular-nums ${LEVEL_STYLE[k.level].text}`}>{k.value}</div>
                    <StatusPill level={k.level} label={t.lbl(LEVEL[k.level].label)} className="hidden w-40 justify-center sm:inline-flex" />
                  </div>,
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {ok.length > 0 && (
        <>
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("exe.okGroup", { n: ok.length })}</div>
          <ul className="grid sm:grid-cols-2">
            {ok.map((k) => (
              <li key={k.key} data-testid={`kpi-${k.key}`} className="border-b border-slate-100 sm:odd:border-r">
                {wrap(
                  k,
                  <div className="flex items-center gap-3 px-5 py-2.5 transition hover:bg-slate-50" title={k.detail ?? undefined}>
                    <StatusDot level={k.level} />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{k.label}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-400">{k.value}</span>
                  </div>,
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ComplianceStack({ c }: { c: { applicable: number; compliant: number; partial: number; nonCompliant: number; notAssessed: number } }) {
  const total = Math.max(1, c.applicable);
  const parts = [
    { n: c.compliant, col: STATUS_COLORS.good },
    { n: c.partial, col: STATUS_COLORS.serious },
    { n: c.nonCompliant, col: STATUS_COLORS.critical },
    { n: c.notAssessed, col: STATUS_COLORS.neutral },
  ];
  return (
    <div className="mt-1.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
      {parts.map((p, i) => (p.n ? <span key={i} style={{ width: `${(p.n / total) * 100}%`, background: p.col }} /> : null))}
    </div>
  );
}

function ExecutivePanel({ kpis }: { kpis: Kpi[] }) {
  const t = useT();
  const can = useCan();
  const score = managementHealthScore(kpis);
  const errors = kpis.filter((k) => k.level === "error");
  const warns = kpis.filter((k) => k.level === "warning");
  const oks = kpis.filter((k) => k.level === "ok");
  const decide = [...errors, ...warns].slice(0, 6);
  const mine = useQuery({ queryKey: ["obligations", "mine"], queryFn: api.notifications.mine, enabled: can("obligations:self"), staleTime: 60_000 });
  const approvals = filterQueue(mine.data ?? [], "approve");
  const color = score === null ? STATUS_COLORS.neutral : score >= 75 ? STATUS_COLORS.good : score >= 50 ? STATUS_COLORS.serious : STATUS_COLORS.critical;
  const overall: OpsLevel = errors.length ? "error" : warns.length ? "warning" : "ok";
  const R = 15.9;
  const lamp = (n: number, c: string, label: string, testId: string) => (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: n ? tint(c, 9) : "var(--color-slate-50)" }} data-testid={testId}>
      <span className="text-2xl font-semibold tabular-nums" style={{ color: n ? c : "var(--color-slate-400)" }}>
        {n}
      </span>
      <span className="text-sm leading-tight text-slate-600">{label}</span>
    </div>
  );
  return (
    <div className="mb-8 space-y-6" data-testid="executive-panel">
      <Card className="relative overflow-hidden p-6">
        <span className="absolute inset-x-0 top-0 h-1" style={{ background: tint(LEVEL[overall].color, 70) }} aria-hidden />
        <div className="flex flex-wrap items-center gap-8">
          <div className="flex items-center gap-5">
            <svg width="132" height="132" viewBox="0 0 36 36" role="img" aria-label={t("exe.scoreAria", { n: score ?? 0 })}>
              <circle cx="18" cy="18" r={R} fill="none" stroke="var(--color-slate-100)" strokeWidth="3.2" />
              {score !== null && <circle cx="18" cy="18" r={R} fill="none" stroke={color} strokeWidth="3.2" strokeDasharray={`${score} ${100 - score}`} strokeDashoffset="25" strokeLinecap="round" />}
              <text x="18" y="19.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--color-slate-900)">
                {score ?? "—"}
              </text>
              <text x="18" y="25" textAnchor="middle" fontSize="2.6" fill="var(--color-slate-500)">
                {t("exe.of100")}
              </text>
            </svg>
          </div>
          <div className="min-w-64 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("exe.health")}</div>
            <div className="mt-1 text-2xl font-semibold leading-tight text-slate-900">
              {errors.length ? t("exe.headlineError", { n: errors.length }) : warns.length ? t("exe.headlineWarn", { n: warns.length }) : t("exe.headlineOk")}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {lamp(errors.length, STATUS_COLORS.critical, t("exe.lampError"), "lamp-error")}
              {lamp(warns.length, STATUS_COLORS.serious, t("exe.lampWarn"), "lamp-warn")}
              {lamp(oks.length, STATUS_COLORS.good, t("exe.lampOk"), "lamp-ok")}
            </div>
          </div>
        </div>
      </Card>
      {decide.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">{t("exe.decide")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {decide.map((k) => {
              const l = LEVEL[k.level];
              return (
                <Card key={k.key} className="relative flex flex-col gap-2 overflow-hidden p-5 pl-6">
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: tint(l.color, 70) }} aria-hidden />
                  <div className="flex items-center gap-2">
                    <StatusPill level={k.level} label={t.lbl(l.label)} />
                  </div>
                  <div className="font-semibold leading-snug text-slate-900">{k.label}</div>
                  <div className={`text-3xl font-semibold tabular-nums ${LEVEL_STYLE[k.level].text}`}>
                    {k.value}
                  </div>
                  {k.detail && <div className="text-sm text-slate-600">{k.detail}</div>}
                  {k.link && (
                    <Link to={k.link as never} className="mt-auto pt-2 text-sm font-medium text-brand-700 hover:underline">
                      {t("exe.open")} →
                    </Link>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
      {approvals.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">{t("exe.myApprovals")}</h2>
            <span className="text-sm text-slate-500">{approvals.length}</span>
          </div>
          <WorkQueue items={approvals} showCompany={false} compact />
        </Card>
      )}
    </div>
  );
}
