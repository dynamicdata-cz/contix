/** Analýza odolnosti (ADR-065): RTO / RPO z BIA přenesené po grafu závislostí, jediné body selhání a mezery v kontinuitě. */
import { FrameworkBadge } from "@/components/frameworkBadge";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, PageHeader, Select, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatHours as formatHoursLabel, LABELS, RESILIENCE_KINDS, RESILIENCE_LABELS, type ResilienceFinding, type ResilienceKind, type ResilienceSeverity } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Network } from "lucide-react";
import { useState } from "react";

export const sevTone: Record<ResilienceSeverity, Tone> = { critical: "red", high: "amber", medium: "blue" };

export function FindingText({ f }: { f: ResilienceFinding }) {
  const t = useT();
  const d = f.detail;
  const rto = f.rtoHours != null ? formatHoursLabel(f.rtoHours) : "—";
  switch (f.kind) {
    case "spof":
      return <>{t("res.f.spof", { rto, n: Number(d.dependents ?? 0), p: Number(d.processes ?? 0) })}</>;
    case "criticality_gap":
      return <>{t("res.f.critGap", { own: t.lbl(LABELS.criticality[d.own as "low"] ?? String(d.own)), req: t.lbl(LABELS.criticality[d.required as "low"] ?? String(d.required)) })}</>;
    case "no_plan":
      return <>{t("res.f.noPlan", { rto })}</>;
    case "plan_rto":
      return <>{t("res.f.planRto", { plan: formatHoursLabel(Number(d.planRto)), rto })}</>;
    case "unhealthy":
      return <>{t("res.f.unhealthy", { rto, p1: Number(d.p1 ?? 0) })}</>;
    case "bia_no_assets":
      return <>{t("res.f.biaNoAssets", { rto })}</>;
  }
}

export function ResiliencePage() {
  const t = useT();
  const q = useQuery({ queryKey: ["assets", "resilience"], queryFn: api.assets.resilience });
  const [kind, setKind] = useState<"" | ResilienceKind>("");
  const d = q.data;
  const findings = d?.findings.filter((f) => !kind || f.kind === kind) ?? [];
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/assets" className="hover:text-brand-700">
          {t("ag.back")}
        </Link>
      </div>
      <PageHeader badge={<FrameworkBadge />}
        title={t("res.title")}
        subtitle={t("res.subtitle")}
        actions={
          <Link to="/assets/graph">
            <Button variant="secondary">
              <Network size={15} /> {t("ag.title")}
            </Button>
          </Link>
        }
      />
      <ErrorBox error={q.error} />
      {d && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("res.kpi.spof")}</div>
              <div className={cn("mt-1 text-2xl font-semibold tabular-nums", d.summary.spof > 0 && "text-red-700")}>{d.summary.spof}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("res.kpi.findings")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{d.findings.length}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("res.kpi.withReq")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{d.summary.withRequirement}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("res.kpi.assets")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{d.summary.assets}</div>
            </Card>
          </div>
          <Card className="mb-6 overflow-hidden" data-testid="resilience-findings">
            <CardHeader
              title={t("res.findings")}
              subtitle={t("res.findingsSub")}
              action={
                <Select className="w-64" value={kind} onChange={(e) => setKind(e.target.value as "" | ResilienceKind)} aria-label={t("res.filter")}>
                  <option value="">{t("res.allKinds")}</option>
                  {RESILIENCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(RESILIENCE_LABELS.kind[k])} ({d.summary.byKind[k]})
                    </option>
                  ))}
                </Select>
              }
            />
            {findings.length === 0 ? (
              <EmptyState>{t("res.noFindings")}</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {findings.map((f, i) => (
                  <li key={`${f.kind}-${f.nodeId}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                    <Badge tone={sevTone[f.severity]}>{t.lbl(RESILIENCE_LABELS.severity[f.severity])}</Badge>
                    <span className="w-56 shrink-0 text-xs font-medium text-slate-600">{t.lbl(RESILIENCE_LABELS.kind[f.kind])}</span>
                    {f.kind === "bia_no_assets" ? (
                      <Link to="/processes/$processId" params={{ processId: f.nodeId }} className="font-medium text-brand-700 hover:underline">
                        {f.name}
                      </Link>
                    ) : (
                      <Link to="/assets/graph" search={{ focus: f.nodeId } as never} className="font-medium text-brand-700 hover:underline">
                        {f.name}
                      </Link>
                    )}
                    <span className="text-xs text-slate-600">
                      <FindingText f={f} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="mb-6 overflow-hidden" data-testid="resilience-requirements">
            <CardHeader title={t("res.reqs")} subtitle={t("res.reqsSub")} />
            {d.requirements.length === 0 ? (
              <EmptyState>{t("res.noReqs")}</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2">{t("res.col.asset")}</th>
                      <th className="px-3 py-2">RTO</th>
                      <th className="px-3 py-2">RPO</th>
                      <th className="px-3 py-2">{t("res.col.reqCrit")}</th>
                      <th className="px-3 py-2">{t("res.col.processes")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.requirements.map((r) => (
                      <tr key={r.assetId}>
                        <td className="px-4 py-2">
                          <Link to="/assets/$assetId" params={{ assetId: r.assetId }} className="font-medium text-brand-700 hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{r.rtoHours != null ? formatHoursLabel(r.rtoHours) : "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{r.rpoHours != null ? formatHoursLabel(r.rpoHours) : "—"}</td>
                        <td className="px-3 py-2">{r.requiredCriticality ? t.lbl(LABELS.criticality[r.requiredCriticality]) : "—"}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">{r.processes.map((p) => p.name).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/** Karta na detailu BIA: aktiva, na kterých proces závisí, s nálezy; převzetí do pole Závislosti. */
export function BiaChainCard({ processId, onApply, canApply }: { processId: string; onApply: (text: string) => void; canApply: boolean }) {
  const t = useT();
  const q = useQuery({ queryKey: ["assets", "resilience", "process", processId], queryFn: () => api.assets.resilienceProcess(processId) });
  const d = q.data;
  if (!d || !d.requirements.length) return null;
  const byAsset = new Map<string, ResilienceFinding[]>();
  for (const f of d.findings) byAsset.set(f.nodeId, [...(byAsset.get(f.nodeId) ?? []), f]);
  const text = d.requirements.map((r) => `${r.name}${byAsset.get(r.assetId)?.some((f) => f.kind === "spof") ? ` (${t("res.spofShort")})` : ""}`).join("; ");
  return (
    <Card className="overflow-hidden" data-testid="bia-chain">
      <CardHeader
        title={t("res.bia.title", { n: d.requirements.length })}
        subtitle={t("res.bia.sub")}
        action={
          canApply && (
            <Button variant="secondary" onClick={() => onApply(text)}>
              {t("res.bia.apply")}
            </Button>
          )
        }
      />
      <ul className="divide-y divide-slate-100 text-sm">
        {d.requirements.map((r) => (
          <li key={r.assetId} className="flex flex-wrap items-center gap-2 px-5 py-2">
            <Link to="/assets/$assetId" params={{ assetId: r.assetId }} className="flex-1 hover:text-brand-700">
              {r.name}
            </Link>
            {(byAsset.get(r.assetId) ?? []).map((f, i) => (
              <Badge key={i} tone={sevTone[f.severity]}>
                {t.lbl(RESILIENCE_LABELS.kind[f.kind])}
              </Badge>
            ))}
          </li>
        ))}
      </ul>
    </Card>
  );
}
