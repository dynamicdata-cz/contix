/** Pohled na hostitele (ADR-061): alerty, aktivita v čase, ATT&CK, zranitelnosti, IOC, incidenty, rizika, úkoly a zásahy jednoho stroje. */
import { SEVERITY_COLOR } from "@/components/health";
import { RiskLevelBadge } from "@/components/risk";
import { ExposureBadge, IntelBadge, SeverityBadge, SocStatusBadge, TacticStrip } from "@/components/soc";
import { Badge, Card, CardHeader, EmptyState, ErrorBox, Input, PageHeader, Select, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn, fmtDate, fmtDay, useDebounced } from "@/lib/utils";
import { SOC_LABELS, TASK_LABELS, defang, type SocHostDay, type SocSeverity, type TaskStatus } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Monitor, Server } from "lucide-react";
import { useState } from "react";

const SEVS: SocSeverity[] = ["low", "medium", "high", "critical"];
const prioTone: Record<number, Tone> = { 1: "red", 2: "amber", 3: "blue", 4: "slate" };

export function HostsTab() {
  const t = useT();
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ["soc", "hosts", days, dq], queryFn: () => api.soc.hosts(days, dq.trim() || undefined) });
  return (
    <Card className="mb-6 overflow-hidden" data-testid="soc-hosts">
      <CardHeader title={t("soc.host.listTitle")} subtitle={t("soc.host.listSub")} />
      <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
        <Input className="max-w-xs" placeholder={t("soc.host.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("soc.host.search")} />
        <Select className="w-40" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("soc.host.period")}>
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              {t("soc.host.days", { n: d })}
            </option>
          ))}
        </Select>
      </div>
      <ErrorBox error={list.error} />
      {list.data?.length === 0 ? (
        <EmptyState>{t("soc.host.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("soc.host.col.host")}</th>
                <th className="px-3 py-2">{t("soc.host.col.severity")}</th>
                <th className="px-3 py-2 text-right">{t("soc.host.col.open")}</th>
                <th className="px-3 py-2 text-right">{t("soc.host.col.total")}</th>
                <th className="px-3 py-2 text-right">{t("soc.host.col.tactics")}</th>
                <th className="px-3 py-2">{t("soc.host.col.last")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data?.map((h) => (
                <tr key={h.key} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link to="/soc/hosts/$hostKey" params={{ hostKey: h.key }} className="inline-flex items-center gap-1.5 font-medium text-slate-900 hover:text-brand-700">
                      {h.assetId ? <Server size={14} className="text-slate-400" /> : <Monitor size={14} className="text-slate-400" />}
                      {h.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-slate-500">
                      {!h.assetId && <span>{t("soc.host.noAsset")}</span>}
                      {h.criticality && <span>{t("soc.host.criticality", { c: h.criticality })}</span>}
                      {h.exploit && <Badge tone="red">{t("soc.host.exploit")}</Badge>}
                      {h.intel && <Badge tone="red">{t("soc.host.intel")}</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <SeverityBadge s={h.severity} />
                  </td>
                  <td className={cn("px-3 py-2.5 text-right tabular-nums", h.open > 0 && "font-semibold text-red-700")}>{h.open}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{h.total}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{h.tactics}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{fmtDate(h.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ActivityChart({ daily }: { daily: SocHostDay[] }) {
  const t = useT();
  const max = Math.max(1, ...daily.map((d) => d.low + d.medium + d.high + d.critical));
  return (
    <div>
      <div className="flex h-32 items-end gap-px" role="img" aria-label={t("soc.host.activity")}>
        {daily.map((d) => {
          const total = d.low + d.medium + d.high + d.critical;
          return (
            <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${fmtDay(d.day)}: ${total}${total ? ` (${SEVS.filter((s) => d[s]).map((s) => `${t.lbl(SOC_LABELS.severity[s])} ${d[s]}`).join(", ")})` : ""}`}>
              {[...SEVS].reverse().map((s) => (d[s] ? <div key={s} style={{ height: `${(d[s] / max) * 100}%`, background: SEVERITY_COLOR[s] }} /> : null))}
              {!total && <div className="h-px bg-slate-200" />}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{fmtDay(daily[0]?.day ?? "")}</span>
        <span>{fmtDay(daily.at(-1)?.day ?? "")}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
        {SEVS.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SEVERITY_COLOR[s] }} /> {t.lbl(SOC_LABELS.severity[s])}
          </span>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "red" }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "red" && value > 0 && "text-red-700")}>{value}</div>
    </Card>
  );
}

export function SocHostPage() {
  const t = useT();
  const { hostKey } = useParams({ strict: false }) as { hostKey: string };
  const [days, setDays] = useState(30);
  const [tactic, setTactic] = useState<string | undefined>();
  const q = useQuery({ queryKey: ["soc", "host", hostKey, days], queryFn: () => api.soc.host(hostKey, days) });
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  const alerts = tactic ? d.alerts.filter((a) => a.mitreTactics.includes(tactic)) : d.alerts;
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/soc" search={{ tab: "hosts" } as never} className="hover:text-brand-700">
          {t("soc.host.back")}
        </Link>
      </div>
      <PageHeader
        title={d.name}
        subtitle={d.asset ? [d.asset.os, d.asset.ipAddresses.join(", ")].filter(Boolean).join(" · ") || t("soc.host.assetLinked") : t("soc.host.agentOnly", { names: d.agentNames.join(", ") })}
        actions={
          <Select className="w-40" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("soc.host.period")}>
            {[7, 30, 90].map((x) => (
              <option key={x} value={x}>
                {t("soc.host.days", { n: x })}
              </option>
            ))}
          </Select>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label={t("soc.host.kpi.open")} value={d.counts.open} tone="red" />
        <Kpi label={t("soc.host.kpi.total")} value={d.counts.total} />
        <Kpi label={t("soc.host.kpi.escalated")} value={d.counts.escalated} tone="red" />
        <Kpi label={t("soc.host.kpi.exploit")} value={d.counts.exploit} tone="red" />
        <Kpi label={t("soc.host.kpi.p1")} value={d.vulns?.p1 ?? 0} tone="red" />
      </div>
      <Card className="mb-6 p-5" data-testid="soc-host-activity">
        <div className="mb-3 text-sm font-semibold text-slate-900">{t("soc.host.activity")}</div>
        <ActivityChart daily={d.daily} />
      </Card>
      {Object.keys(d.tactics).length > 0 && <TacticStrip counts={d.tactics} active={tactic} onPick={setTactic} />}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="overflow-hidden" data-testid="soc-host-alerts">
            <CardHeader title={t("soc.host.alerts", { n: alerts.length })} />
            {alerts.length === 0 ? (
              <EmptyState>{t("soc.host.noAlerts")}</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {alerts.map((a) => (
                      <tr key={a.id} className="align-top hover:bg-slate-50">
                        <td className="w-24 px-4 py-2.5">
                          <SeverityBadge s={a.severity} />
                        </td>
                        <td className="px-3 py-2.5">
                          <Link to="/soc/$alertId" params={{ alertId: a.id }} className="font-medium text-slate-900 hover:text-brand-700">
                            {a.title}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                            {t.lbl(SOC_LABELS.source[a.source] ?? a.source)} · {a.count}× <ExposureBadge e={a.exposure} /> <IntelBadge m={a.intel} />
                          </div>
                        </td>
                        <td className="w-32 px-3 py-2.5">
                          <SocStatusBadge s={a.status} />
                        </td>
                        <td className="w-36 px-3 py-2.5 text-xs text-slate-600">{fmtDate(a.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {d.vulns && (
            <Card className="overflow-hidden">
              <CardHeader title={t("soc.host.vulns", { n: d.vulns.total, p1: d.vulns.p1, p2: d.vulns.p2 })} />
              {d.vulns.top.length === 0 ? (
                <EmptyState>{t("soc.host.noVulns")}</EmptyState>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {d.vulns.top.map((v) => (
                    <li key={v.cveId} className="flex flex-wrap items-center gap-2 px-4 py-2">
                      <Badge tone={prioTone[v.priority] ?? "slate"}>P{v.priority}</Badge>
                      <span className="font-mono text-xs">{v.cveId}</span>
                      <span className="text-xs text-slate-500">
                        {v.severity}
                        {v.cvss != null ? ` · CVSS ${v.cvss}` : ""}
                        {v.epss != null ? ` · EPSS ${Math.round(v.epss * 100)} %` : ""}
                      </span>
                      {v.kev && <Badge tone="red">KEV</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {d.asset && (
            <Card className="p-5 text-sm">
              <div className="mb-2 font-semibold text-slate-900">{t("soc.host.asset")}</div>
              <Link to="/assets/$assetId" params={{ assetId: d.asset.id }} className="font-medium text-brand-700 hover:underline">
                {d.asset.name}
              </Link>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-slate-500">{t("soc.host.criticalityLabel")}</dt>
                <dd>{d.asset.criticality ?? "—"}</dd>
                <dt className="text-slate-500">CIA</dt>
                <dd>{[d.asset.confidentiality, d.asset.integrity, d.asset.availability].map((x) => x ?? "–").join(" / ")}</dd>
                <dt className="text-slate-500">{t("soc.host.agents")}</dt>
                <dd>{d.agentNames.join(", ") || "—"}</dd>
              </dl>
            </Card>
          )}
          <SideList
            title={t("soc.host.incidents")}
            empty={t("soc.host.none")}
            items={[
              ...d.incidents.map((i) => ({ key: i.id, to: `/incidents/${i.id}`, label: `${i.code ? `${i.code} ` : ""}${i.title}`, meta: fmtDay(i.detectedAt) })),
              ...d.cases.map((x) => ({ key: x.id, to: `/soc/cases/${x.id}`, label: `${x.code} ${x.title}`, meta: t.lbl(SOC_LABELS.caseStatus[x.status as keyof typeof SOC_LABELS.caseStatus] ?? x.status) })),
            ]}
          />
          {d.risks.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title={t("soc.host.risks")} />
              <ul className="divide-y divide-slate-100 text-sm">
                {d.risks.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <Link to="/risks/$riskId" params={{ riskId: r.id }} className="text-brand-700 hover:underline">
                      {r.name}
                    </Link>
                    <RiskLevelBadge level={r.level} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <SideList
            title={t("soc.host.tasks")}
            empty={t("soc.host.none")}
            items={[
              ...d.tasks.map((x) => ({ key: x.id, to: `/actions?task=${x.id}`, label: `Ú-${x.seq} ${x.title}`, meta: `${t.lbl(TASK_LABELS.status[x.status as TaskStatus] ?? x.status)}${x.ownerPositionName ? ` · ${x.ownerPositionName}` : ""}${x.dueDate ? ` · ${fmtDay(x.dueDate)}` : ""}` })),
              ...d.actions.map((x) => ({ key: x.id, to: null, label: `${x.kind}: ${x.target}`, meta: `${x.status} · ${fmtDay(x.createdAt)}` })),
            ]}
          />
          <SideList
            title={t("soc.host.iocs")}
            empty={t("soc.host.none")}
            items={[
              ...d.intel.map((m) => ({ key: `ti:${m.source}:${m.value}`, to: null, label: defang(m.type, m.value), meta: `${m.source}${m.threat ? ` · ${m.threat}` : ""}` })),
              ...d.iocs.map((x) => ({ key: x.id, to: null, label: defang(x.type as never, x.value), meta: x.action })),
            ]}
          />
        </div>
      </div>
    </>
  );
}

function SideList({ title, items, empty }: { title: string; empty: string; items: { key: string; to: string | null; label: string; meta: string }[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((x) => (
            <li key={x.key} className="px-4 py-2">
              {x.to && !x.to.includes("?") ? (
                <Link to={x.to as never} className="text-brand-700 hover:underline">
                  {x.label}
                </Link>
              ) : x.to ? (
                <a href={x.to} className="text-brand-700 hover:underline">
                  {x.label}
                </a>
              ) : (
                <span className="break-all">{x.label}</span>
              )}
              <div className="text-xs text-slate-500">{x.meta}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
