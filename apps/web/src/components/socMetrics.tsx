/** Úspěšnost SOC a AI (ADR-053): doby převzetí a rozhodnutí, plnění lhůt, falešné poplachy podle zdroje, shoda AI triáže. */
import { StackedBars, Legend, type Segment } from "@/components/charts";
import { STATUS_COLORS } from "@/components/health";
import { SeverityBadge } from "@/components/soc";
import { Badge, Card, CardHeader, EmptyState, ErrorBox, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import { SOC_LABELS, SOC_OUTCOME_LABELS, type SocMetricGroup, type SocOutcome, type SocSeverity } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");
const OUTCOMES: SocOutcome[] = ["attack", "noise", "unknown"];

function Tile({ label, value, hint, tone = "slate" }: { label: string; value: string; hint?: string; tone?: "slate" | "amber" | "red" | "green" }) {
  const c = { slate: "text-slate-900", amber: "text-amber-700", red: "text-red-700", green: "text-green-700" }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums tracking-tight", c)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function PerformanceTab() {
  const t = useT();
  const [days, setDays] = useState(90);
  const q = useQuery({ queryKey: ["soc", "metrics", days], queryFn: () => api.soc.metrics(days) });
  const m = q.data;
  const mins = (x: number | null) => (x == null ? "—" : x < 120 ? `${Math.round(x)} min` : `${Math.round((x / 60) * 10) / 10} h`);
  const hrs = (x: number | null) => (x == null ? "—" : `${x} h`);
  const segments: Segment[] = [
    { key: "escalated", label: t("soc.perf.escalated"), color: STATUS_COLORS.critical },
    { key: "other", label: t("soc.perf.otherDecided"), color: "#3b82f6" },
    { key: "noise", label: t("soc.perf.noise"), color: STATUS_COLORS.neutral },
  ];
  return (
    <div className="mb-6 space-y-6">
      <div className="flex items-center gap-3">
        <Select className="w-48" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("soc.perf.period")}>
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {t("soc.perf.days", { n: d })}
            </option>
          ))}
        </Select>
        <span className="text-xs text-slate-500">{t("soc.perf.hint")}</span>
      </div>
      <ErrorBox error={q.error} />
      {!m ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label={t("soc.perf.alerts")} value={String(m.total.alerts)} hint={t("soc.perf.decidedN", { n: m.total.decided })} />
            <Tile label={t("soc.perf.escalated")} value={String(m.total.escalated)} />
            <Tile label={t("soc.perf.fpRate")} value={m.total.fpRate == null ? "—" : `${Math.round(m.total.fpRate * 100)} %`} tone={m.total.fpRate != null && m.total.fpRate > 0.7 ? "amber" : "slate"} hint={t("soc.perf.fpHint")} />
            <Tile label={t("soc.perf.mtta")} value={mins(m.total.mttaMinutes)} hint={t("soc.perf.median")} />
            <Tile label={t("soc.perf.mttr")} value={hrs(m.total.mttrHours)} hint={t("soc.perf.median")} />
            <Tile label={t("soc.perf.slaAck")} value={pct(m.total.ackMet, m.total.ackTotal)} tone={m.total.ackTotal && m.total.ackMet / m.total.ackTotal < 0.8 ? "amber" : "slate"} hint={t("soc.perf.slaResolve", { p: pct(m.total.resolveMet, m.total.resolveTotal) })} />
          </div>

          <Card className="overflow-hidden" data-testid="soc-ai-metrics">
            <CardHeader title={t("soc.perf.aiTitle")} subtitle={t("soc.perf.aiSubtitle")} />
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <Tile label={t("soc.perf.agreement")} value={m.ai.agreement == null ? "—" : `${Math.round(m.ai.agreement * 100)} %`} hint={t("soc.perf.comparedN", { n: m.ai.compared })} tone={m.ai.agreement == null ? "slate" : m.ai.agreement >= 0.8 ? "green" : m.ai.agreement < 0.6 ? "amber" : "slate"} />
                  <Tile label={t("soc.perf.missed")} value={String(m.ai.missed.length)} tone={m.ai.missed.length ? "red" : "slate"} hint={t("soc.perf.missedHint")} />
                  <Tile label={t("soc.perf.overcalled")} value={String(m.ai.overcalled)} hint={t("soc.perf.overcalledHint")} />
                </div>
                <p className="text-xs text-slate-500">
                  {t("soc.perf.aiCoverage", { triaged: m.ai.triaged, errors: m.ai.errors, abstained: m.ai.abstained, ms: m.ai.avgDurationMs == null ? "—" : `${Math.round(m.ai.avgDurationMs / 100) / 10} s` })}
                </p>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1">{t("soc.perf.confidence")}</th>
                      <th className="py-1 text-right">{t("soc.perf.compared")}</th>
                      <th className="py-1 text-right">{t("soc.perf.agreement")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.ai.byConfidence.map((c) => (
                      <tr key={c.confidence} className="border-t border-slate-100">
                        <td className="py-1.5">{t.lbl(SOC_LABELS.confidence[c.confidence])}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.compared}</td>
                        <td className="py-1.5 text-right tabular-nums">{pct(c.agree, c.compared)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-500">{t("soc.perf.matrix")}</div>
                <table className="w-full text-sm" aria-label={t("soc.perf.matrix")}>
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-1">{t("soc.perf.aiSaid")} ↓ / {t("soc.perf.analystSaid")} →</th>
                      {OUTCOMES.map((o) => (
                        <th key={o} className="py-1 text-right">
                          {t.lbl(SOC_OUTCOME_LABELS[o])}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {OUTCOMES.map((s) => (
                      <tr key={s} className="border-t border-slate-100">
                        <td className="py-1.5">{t.lbl(SOC_OUTCOME_LABELS[s])}</td>
                        {OUTCOMES.map((a) => {
                          const n = m.ai.matrix.find((x) => x.suggested === s && x.actual === a)?.n ?? 0;
                          return (
                            <td key={a} className={cn("py-1.5 text-right tabular-nums", n && s === a && s !== "unknown" && "font-semibold text-green-700", n && s === "noise" && a === "attack" && "font-semibold text-red-700")}>
                              {n || "·"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {m.ai.missed.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-red-700">{t("soc.perf.missedList")}</div>
                    <ul className="space-y-0.5 text-sm">
                      {m.ai.missed.map((x) => (
                        <li key={x.id}>
                          <Link to="/soc/$alertId" params={{ alertId: x.id }} className="text-brand-700 hover:underline">
                            {x.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title={t("soc.perf.weekly")} />
            <div className="space-y-3 p-5">
              <Legend segments={segments} />
              <StackedBars
                rows={m.weekly.map((w) => ({ week: w.week, escalated: w.escalated, noise: w.noise, other: Math.max(0, w.alerts - w.escalated - w.noise) }))}
                label={(r) => t("soc.perf.weekOf", { d: fmtDay(r.week) })}
                segments={segments}
                labelWidth="9rem"
              />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <GroupTable title={t("soc.perf.bySource")} rows={m.bySource} label={(k) => t.lbl(SOC_LABELS.source[k] ?? k)} mins={mins} hrs={hrs} />
            <GroupTable title={t("soc.perf.bySeverity")} rows={m.bySeverity} label={(k) => <SeverityBadge s={k as SocSeverity} />} mins={mins} hrs={hrs} sla />
          </div>
        </>
      )}
    </div>
  );
}

function GroupTable({ title, rows, label, mins, hrs, sla }: { title: string; rows: SocMetricGroup[]; label: (k: string) => React.ReactNode; mins: (x: number | null) => string; hrs: (x: number | null) => string; sla?: boolean }) {
  const t = useT();
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2" />
              <th className="px-3 py-2 text-right">{t("soc.perf.alerts")}</th>
              <th className="px-3 py-2 text-right">{t("soc.perf.escalated")}</th>
              <th className="px-3 py-2 text-right">{t("soc.perf.fpRate")}</th>
              <th className="px-3 py-2 text-right">{sla ? t("soc.perf.slaAck") : t("soc.perf.mtta")}</th>
              <th className="px-3 py-2 text-right">{sla ? t("soc.perf.slaResolveCol") : t("soc.perf.mttr")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((g) => (
              <tr key={g.key}>
                <td className="px-4 py-2">{label(g.key)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.alerts}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.escalated}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.fpRate == null ? "—" : <Badge tone={g.fpRate > 0.7 ? "amber" : "slate"}>{Math.round(g.fpRate * 100)} %</Badge>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{sla ? pct(g.ackMet, g.ackTotal) : mins(g.mttaMinutes)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{sla ? pct(g.resolveMet, g.resolveTotal) : hrs(g.mttrHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
