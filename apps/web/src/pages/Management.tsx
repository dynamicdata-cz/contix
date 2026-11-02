import { FrameworkBadge } from "@/components/frameworkBadge";
import { TrendsCard } from "@/components/trends";
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
import type { OpsLevel } from "@contix/shared";
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
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("isms.zpravaProVedeni")}
        subtitle={t("isms.stavKybernetickeBezpecnostiNaJedne")}
        actions={
          !group && (
            <>
              <a
                href={api.reports.managementHtmlUrl(period)}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="secondary">
                  <Printer size={16} /> {t("isms.tiskPdf")}
                </Button>
              </a>
              <a href={api.reports.managementDocxUrl(period)}>
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
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {r.kpis.map((k) => {
                const l = LEVEL[k.level];
                const inner = (
                  <Card className="h-full p-4 transition hover:border-slate-300">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm text-slate-600">{k.label}</div>
                      <span
                        className="inline-flex shrink-0 items-center gap-1 text-xs"
                        style={{ color: l.color }}
                      >
                        <l.Icon size={15} aria-hidden />{" "}
                        <span className="text-slate-600">{t.lbl(l.label)}</span>
                      </span>
                    </div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums">
                      {k.value}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {k.detail}
                    </div>
                  </Card>
                );
                return k.link ? (
                  <Link key={k.key} to={k.link} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div key={k.key}>{inner}</div>
                );
              })}
            </div>

            <TrendsCard
              className="mb-6"
              months={12}
              title={t("trend.mgmtTitle")}
              metrics={["compliance", "controls_tested_pct", "risks_unacceptable", "risks_untreated", "plan_overdue", "findings_overdue", "vulns_critical", "vulns_high", "vulns_p1", "vulns_sla_overdue", "assets_red", "obligations_overdue", "exceptions_expired", "incidents_significant"]}
            />

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
                        <td className="px-5 py-2">{c.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
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
            </div>
          </>
        )}
      </NeedsCompany>
    </>
  );
}
