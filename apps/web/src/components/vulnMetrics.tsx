import { Legend, StackedBars } from "@/components/charts";
import { SeverityBadge } from "@/components/health";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate, formatLocale } from "@/lib/utils";
import { VULN_LABELS, type DefectDojoSettingsInput, type Severity } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const SEVS: Severity[] = ["critical", "high", "medium", "low"];
/** Stáří = sekvenční (ordinální) šedomodrá rampa, nejtmavší = nejstarší. */
const AGE = [
  { key: "d30", color: "#cbd5e1" },
  { key: "d90", color: "#94a3b8" },
  { key: "d180", color: "#64748b" },
  { key: "older", color: "#1e293b" },
] as const;

/** Metriky správy zranitelností (ADR-097): MTTR, dodržení lhůt, stárnutí, měsíční vývoj, zdroje. */
export function VulnMetricsCard() {
  const t = useT();
  const q = useQuery({ queryKey: ["vuln-metrics"], queryFn: () => api.vulns.metrics() });
  const [table, setTable] = useState(false);
  const d = q.data;
  const num = (v: number | null) => (v == null ? "–" : v.toLocaleString(formatLocale(), { maximumFractionDigits: 1 }));
  const maxM = Math.max(1, ...(d?.months ?? []).flatMap((m) => [m.opened, m.closed]));
  const segs = AGE.map((a) => ({ key: a.key, label: t(`vm.age.${a.key}`), color: a.color }));
  return (
    <Card className="mb-6" data-testid="vuln-metrics">
      <CardHeader
        title={t("vm.title")}
        subtitle={t("vm.subtitle")}
        action={
          <button type="button" className="text-xs text-slate-600 hover:text-brand-700" onClick={() => setTable(!table)} aria-pressed={table}>
            {table ? t("vm.charts") : t("vm.table")}
          </button>
        }
      />
      <ErrorBox error={q.error} />
      {d && (
        <>
          <div className="grid gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
            {SEVS.map((s) => (
              <div key={s} className="bg-white px-5 py-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  {t("vm.mttr")} <SeverityBadge severity={s} />
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                  {num(d.mttr[s].days)}
                  {d.mttr[s].days != null && <span className="ml-1 text-sm font-normal text-slate-500">{t("vm.days")}</span>}
                </div>
                <div className="text-[11px] text-slate-400">{t("vm.resolvedN", { n: d.mttr[s].n })}</div>
              </div>
            ))}
            <div className="bg-white px-5 py-3">
              <div className="text-xs text-slate-500">{t("vm.sla")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{d.sla.pct == null ? "–" : `${d.sla.pct} %`}</div>
              <div className="text-[11px] text-slate-400">{t("vm.slaOf", { inTime: d.sla.inTime, n: d.sla.resolved })}</div>
            </div>
            <div className="bg-white px-5 py-3">
              <div className="text-xs text-slate-500">{t("vm.overdue")}</div>
              <div className={`mt-1 text-2xl font-semibold tabular-nums ${d.sla.openOverdue ? "text-red-700" : "text-slate-900"}`}>{d.sla.openOverdue}</div>
              <div className="text-[11px] text-slate-400">{t("vm.triage", { fp: d.triage.falsePositive, dup: d.triage.duplicate, oos: d.triage.outOfScope })}</div>
            </div>
          </div>
          <div className="grid gap-6 p-5 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-800">{t("vm.agingTitle")}</h3>
                <Legend segments={segs} />
              </div>
              {table ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1">{t("ast.zavaznost")}</th>
                      {segs.map((s) => (
                        <th key={s.key} className="py-1 text-right">
                          {s.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SEVS.map((s) => (
                      <tr key={s} className="border-t border-slate-100">
                        <td className="py-1">{t.lbl(VULN_LABELS.severity[s])}</td>
                        {AGE.map((a) => (
                          <td key={a.key} className="py-1 text-right tabular-nums">
                            {d.aging[s][a.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <StackedBars rows={SEVS.map((s) => ({ sev: s, ...d.aging[s] }))} segments={segs} label={(r) => t.lbl(VULN_LABELS.severity[r.sev as Severity])} labelWidth="6rem" />
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-800">{t("vm.monthsTitle")}</h3>
                <Legend
                  segments={[
                    { key: "o", label: t("vm.opened"), color: "#94a3b8" },
                    { key: "c", label: t("vm.closed"), color: "#047857" },
                  ]}
                />
              </div>
              {table ? (
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1">{t("vm.month")}</th>
                      <th className="py-1 text-right">{t("vm.opened")}</th>
                      <th className="py-1 text-right">{t("vm.closed")}</th>
                      <th className="py-1 text-right">{t("vm.openEnd")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.months.map((m) => (
                      <tr key={m.month} className="border-t border-slate-100">
                        <td className="py-1">{m.month}</td>
                        <td className="py-1 text-right tabular-nums">{m.opened}</td>
                        <td className="py-1 text-right tabular-nums">{m.closed}</td>
                        <td className="py-1 text-right tabular-nums">{m.open}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div>
                  <div className="flex h-36 items-end gap-1 border-b border-slate-200">
                    {d.months.map((m) => (
                      <div key={m.month} className="flex flex-1 items-end justify-center gap-0.5" title={t("vm.monthTip", { m: m.month, o: m.opened, c: m.closed, open: m.open })}>
                        <div className="w-2 rounded-t-sm bg-slate-400" style={{ height: `${(m.opened / maxM) * 128}px`, minHeight: m.opened ? 2 : 0 }} />
                        <div className="w-2 rounded-t-sm bg-emerald-700" style={{ height: `${(m.closed / maxM) * 128}px`, minHeight: m.closed ? 2 : 0 }} />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex gap-1 text-[10px] text-slate-500">
                    {d.months.map((m) => (
                      <div key={m.month} className="flex-1 text-center">
                        {m.month.slice(5)}
                        <div className="tabular-nums text-slate-700">{m.open}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">{t("vm.openEndHint")}</p>
                </div>
              )}
            </div>
          </div>
          {d.bySource.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3 text-xs">
              <span className="text-slate-500">{t("vm.sources")}</span>
              {d.bySource.map((s) => (
                <Badge key={s.source} tone="slate">
                  {s.source}: {s.open} / {t("vm.fixed90", { n: s.resolved90 })}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Import z CI/CD – návod s osobním API tokenem (bez zobrazení tokenu). */
export function CiImportHint() {
  const t = useT();
  const url = `${window.location.origin}/api/public/vulnerabilities/scans`;
  const cmd = `curl -sf -H "Authorization: Bearer $CONTIX_TOKEN" \\\n  -F file=@trivy.json -F assetId=<ID aktiva> -F failOn=high \\\n  ${url}`;
  return (
    <details className="border-t border-slate-100 px-5 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-slate-700">{t("vm.ciTitle")}</summary>
      <p className="mt-2 text-slate-600">{t("vm.ciHint")}</p>
      <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{cmd}</pre>
      <p className="mt-2 text-xs text-slate-500">{t("vm.ciResponse")}</p>
    </details>
  );
}

/** Konektor DefectDojo (správce) – jen čtení aktivních nálezů. */
export function DefectDojoCard() {
  const t = useT();
  const can = useCan();
  const me = useMe();
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ["defectdojo"], queryFn: api.vulns.defectDojo, enabled: can("admin:settings") });
  const [form, setForm] = useState<DefectDojoSettingsInput | null>(null);
  const f = form ?? (st.data ? { enabled: st.data.enabled, url: st.data.url, companyId: st.data.companyId ?? undefined, intervalHours: st.data.intervalHours, verifiedOnly: st.data.verifiedOnly, productAsAsset: st.data.productAsAsset } : null);
  const save = useMutation({
    mutationFn: () => api.vulns.saveDefectDojo(f!),
    onSuccess: () => {
      setForm(null);
      qc.invalidateQueries({ queryKey: ["defectdojo"] });
    },
  });
  const test = useMutation({ mutationFn: api.vulns.testDefectDojo });
  const sync = useMutation({
    mutationFn: api.vulns.syncDefectDojo,
    onSuccess: () => {
      for (const k of ["defectdojo", "vuln-scans", "vulns", "vuln-summary", "vuln-metrics"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  if (!can("admin:settings") || !f || !st.data) return null;
  const set = (p: Partial<DefectDojoSettingsInput>) => setForm({ ...f, ...p });
  return (
    <Card className="mb-6" data-testid="defectdojo">
      <CardHeader title={t("vm.ddTitle")} subtitle={t("vm.ddSubtitle")} action={st.data.enabled ? <Badge tone="green">{t("vm.ddOn")}</Badge> : <Badge tone="slate">{t("vm.ddOff")}</Badge>} />
      <div className="grid gap-3 p-5 md:grid-cols-2">
        <Field label={t("vm.ddUrl")}>
          <Input value={f.url ?? ""} placeholder="https://defectdojo.firma.cz" onChange={(e) => set({ url: e.target.value })} />
        </Field>
        <Field label={t("vm.ddKey")} hint={st.data.hasKey ? t("vm.ddKeySet") : t("vm.ddKeyHint")}>
          <Input type="password" autoComplete="off" value={f.apiKey ?? ""} onChange={(e) => set({ apiKey: e.target.value || undefined })} />
        </Field>
        <Field label={t("vm.ddCompany")}>
          <Select value={f.companyId ?? ""} onChange={(e) => set({ companyId: e.target.value || undefined })}>
            <option value="">—</option>
            {me.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("vm.ddInterval")}>
          <Input type="number" min={1} max={168} value={f.intervalHours ?? 24} onChange={(e) => set({ intervalHours: Number(e.target.value) || 24 })} />
        </Field>
        <div className="space-y-2 md:col-span-2">
          <Checkbox checked={!!f.enabled} onChange={(v) => set({ enabled: v })} label={t("vm.ddEnabled")} />
          <Checkbox checked={!!f.verifiedOnly} onChange={(v) => set({ verifiedOnly: v })} label={t("vm.ddVerified")} />
          <Checkbox checked={f.productAsAsset ?? true} onChange={(v) => set({ productAsAsset: v })} label={t("vm.ddProduct")} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3 text-sm">
        <Button disabled={save.isPending || !form} onClick={() => save.mutate()}>
          {t("mon.save")}
        </Button>
        <Button variant="secondary" disabled={test.isPending || !st.data.hasKey} onClick={() => test.mutate()}>
          {t("vm.ddTest")}
        </Button>
        <Button variant="secondary" disabled={sync.isPending || !st.data.hasKey || !st.data.companyId} onClick={() => sync.mutate()}>
          {t("vm.ddSync")}
        </Button>
        {test.data && <span className={test.data.ok ? "text-emerald-700" : "text-red-700"}>{test.data.ok ? t("vm.ddTestOk", { n: test.data.activeFindings ?? 0 }) : test.data.message}</span>}
        {st.data.lastSyncAt && (
          <span className="text-xs text-slate-500">
            {t("vm.ddLast", { d: fmtDate(st.data.lastSyncAt) })}
            {st.data.lastStats && ` · ${t("vm.ddStats", { c: st.data.lastStats.created, u: st.data.lastStats.updated, x: st.data.lastStats.closed })}`}
          </span>
        )}
        {st.data.lastError && <span className="text-xs text-red-700">{st.data.lastError}</span>}
      </div>
      <ErrorBox error={save.error ?? sync.error} />
    </Card>
  );
}
