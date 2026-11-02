import { useT, lbl } from "@/lib/i18n";
import { ColumnChart, Legend, StackedBars } from "@/components/charts";
import { HealthIndicator, SEVERITY_COLOR, SEVERITY_ORDER, SeverityBadge, SUPPORT_COLOR, SupportBadge } from "@/components/health";
import { Button, Card, CardHeader, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { VulnTable } from "@/components/VulnTable";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";
import { SUPPORT_STATUSES, VULN_LABELS, type HealthStatus, type VulnPriority } from "@contix/shared";
import { FixPlanCard, PrioritySection } from "@/components/vulnPriority";
import { ScansCard } from "@/components/vulnScans";
import { DefectDojoCard, VulnMetricsCard } from "@/components/vulnMetrics";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

const sevSegments = () => SEVERITY_ORDER.map((s) => ({ key: s, label: lbl(VULN_LABELS.severity[s]), color: SEVERITY_COLOR[s] }));

export function VulnerabilitiesPage() {
  const t = useT();
  const navigate = useNavigate();
  const can = useCan();
  const qc = useQueryClient();
  const sum = useQuery({ queryKey: ["vuln-summary"], queryFn: api.vulns.summary });
  const recompute = useMutation({
    mutationFn: api.vulns.recompute,
    onSuccess: () => {
      for (const k of ["vuln-summary", "assets", "asset"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const s = sum.data;
  const [filter, setFilter] = useState<{ key: number; priority?: VulnPriority; kev?: boolean; packageName?: string; overdue?: boolean }>({ key: 0 });
  const focus = (f: { priority?: VulnPriority; kev?: boolean; packageName?: string; overdue?: boolean }) => {
    setFilter((x) => ({ ...f, key: x.key + 1 }));
    setTimeout(() => document.getElementById("vuln-table")?.scrollIntoView({ behavior: "smooth" }), 50);
  };
  const totalAssets = s ? Object.values(s.health).reduce((a, b) => a + b, 0) : 0;
  const openTotal = s ? SEVERITY_ORDER.reduce((a, k) => a + s.openBySeverity[k], 0) : 0;

  return (
    <>
      <PageHeader
        title={t("ast.zranitelnostiAZastaralost")}
        subtitle={
          s?.lastSync
            ? t("ast.posledniNacteniZranitelnostiZWazuhu", { p: fmtDate(s.lastSync) })
            : t("ast.zranitelnostiSeNacitajiPriSynchronizaci")
        }
        actions={
          <>
            {can("discovery:run") && (
              <Link to="/discovery">
                <Button variant="secondary">
                  <RefreshCw size={15} /> {t("ast.synchronizovatWazuh")}
                </Button>
              </Link>
            )}
            {can("admin:settings") && (
              <Button variant="secondary" disabled={recompute.isPending} onClick={() => recompute.mutate()} title={t("ast.prepocitatSemaforPodleAktualnichPravidel")}>
                {t("ast.prepocitatSemafor")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={sum.error ?? recompute.error} />
      {s && <PrioritySection s={s} onPick={(p) => focus(p === "kev" ? { kev: true } : p === "overdue" ? { overdue: true } : { priority: p })} />}
      <FixPlanCard onPackage={(pkg) => focus({ packageName: pkg })} />
      <VulnMetricsCard />
      <ScansCard />
      <DefectDojoCard />

      {/* Semafor – stat tiles s ikonou a textem */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["red", "orange", "green", "unknown"] as HealthStatus[]).map((h) => (
          <Card
            key={h}
            className="cursor-pointer px-5 py-4 transition hover:border-slate-300"
            onClick={() => navigate({ to: "/assets", search: { health: h } as never })}
          >
            <div className="flex items-center justify-between">
              <HealthIndicator status={h} withLabel />
              <span className="text-xs text-slate-400">{totalAssets ? Math.round(((s?.health[h] ?? 0) / totalAssets) * 100) : 0} %</span>
            </div>
            <div className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{s?.health[h] ?? "…"}</div>
            <div className="text-xs text-slate-500">{t("ast.aktiv")}</div>
          </Card>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("ast.otevreneZranitelnostiPodleZavaznosti")} subtitle={t("ast.otevrenychCveSVyjimkou", { openTotal: openTotal, p: s?.accepted ?? 0 })} />
          <div className="p-5">
            <ColumnChart
              data={SEVERITY_ORDER.map((k) => ({
                key: k,
                label: t.lbl(VULN_LABELS.severity[k]),
                value: s?.openBySeverity[k] ?? 0,
                color: SEVERITY_COLOR[k],
              }))}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("ast.zastaralostPodporaOperacnichSystemu")} subtitle={t("ast.konecPodporyVyrobceEolPodle")} />
          <div className="p-5">
            <ColumnChart
              data={SUPPORT_STATUSES.map((k) => ({
                key: k,
                label: t.lbl(VULN_LABELS.support[k]),
                value: s?.support[k] ?? 0,
                color: SUPPORT_COLOR[k],
              }))}
            />
          </div>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("ast.nejrizikovejsiAktiva")} subtitle={t("ast.otevreneZranitelnostiPodleZavaznosti")} action={<Legend segments={sevSegments()} />} />
          <div className="p-4">
            <StackedBars
              rows={s?.topAssets ?? []}
              segments={sevSegments()}
              label={(r) => (
                <span className="inline-flex items-center gap-2">
                  <HealthIndicator status={r.healthStatus} size={14} />
                  {r.name}
                </span>
              )}
              onClick={(r) => navigate({ to: "/assets/$assetId", params: { assetId: r.id } })}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("ast.nejzranitelnejsiKomponenty")} subtitle={t("ast.knihovnyABalickySNejvice")} action={<Legend segments={sevSegments()} />} />
          <div className="p-4">
            <StackedBars
              rows={(s?.topPackages ?? []).map((p) => ({ ...p, label: `${p.name} (${p.assets} ${p.assets === 1 ? "aktivum" : "aktiv"})` }))}
              segments={sevSegments()}
              label={(r) => r.label}
              labelWidth="14rem"
            />
          </div>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("ast.nejzavaznejsiCve")} subtitle={t("ast.podleZavaznostiAPoctuZasazenych")} />
          <table className="w-full text-sm">
            <tbody>
              {s?.topCves.map((c) => (
                <tr key={c.cveId} className="border-b border-slate-100">
                  <td className="px-5 py-2">
                    <Link to="/vulnerabilities/cve/$cveId" params={{ cveId: c.cveId }} className="font-mono text-xs text-brand-700 hover:underline">
                      {c.cveId}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <SeverityBadge severity={c.severity} />
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{c.cvssScore?.toFixed(1) ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{c.packageName}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-slate-600">{c.assets}×</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s && !s.topCves.length && <EmptyState>{t("ast.zadneOtevreneZranitelnosti")}</EmptyState>}
        </Card>
        <Card>
          <CardHeader title={t("ast.aktivaBezPodporyNeboS")} />
          <table className="w-full text-sm">
            <tbody>
              {s?.eolAssets.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="px-5 py-2">
                    <Link to="/assets/$assetId" params={{ assetId: a.id }} className="font-medium text-brand-700 hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{[a.osName, a.osVersion].filter(Boolean).join(" ")}</td>
                  <td className="px-5 py-2">
                    <SupportBadge status={a.supportStatus} eolDate={a.eolDate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s && !s.eolAssets.length && <EmptyState>{t("ast.vsechnyZnameSystemyMajiPodporu")}</EmptyState>}
        </Card>
      </div>

      <Card id="vuln-table">
        <CardHeader title={t("ast.vsechnyZranitelnosti")} subtitle={t("ast.filtrovaniVyjimkyAkceptaceRizikaA")} />
        <VulnTable key={filter.key} initialPriority={filter.priority} initialKev={filter.kev} initialPackage={filter.packageName} initialOverdue={filter.overdue} />
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        {t("ast.barvaSemaforuJeVzdyDoplnena")}
      </p>
    </>
  );
}
