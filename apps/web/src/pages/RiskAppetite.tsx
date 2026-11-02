import { RiskLevelBadge } from "@/components/risk";
import { TrendsCard } from "@/components/trends";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Input, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDay } from "@/lib/utils";
import { GROUP_RISK_METRICS, RISK_APPETITE_LABELS, RISK_LABELS, RISK_LEVELS, TREND_LABELS, type AppetiteCategory, type KriDto, type RiskAppetiteDto, type RiskLevel } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

/* Ochota riskovat a klíčové ukazatele rizik (v1.23, ADR-120). */

const kriTone: Record<KriDto["status"], Tone> = { ok: "green", warn: "amber", alert: "red", unknown: "slate" };

export function RiskAppetitePage() {
  const t = useT();
  const q = useQuery({ queryKey: ["risk-appetite"], queryFn: api.risks.appetite });
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/risks" className="hover:text-brand-700">
          {t("rsk.rizika")}
        </Link>
      </div>
      <PageHeader title={t("rap.title")} subtitle={t("rap.subtitle")} />
      <ErrorBox error={q.error} />
      {q.data && (
        <div className="space-y-6">
          <AppetiteCard d={q.data} />
          <BreachesCard d={q.data} />
          <KriCard d={q.data} />
          <TrendsCard metrics={["risks_critical_high", "risks_medium", "risks_low", "risks_over_appetite", "threat_coverage_pct", "unassessed_threats", "weak_capabilities", "kri_alerts", "detection_blind"]} title={t("rap.trendTitle")} />
          <GroupCard />
        </div>
      )}
    </>
  );
}

function AppetiteCard({ d }: { d: RiskAppetiteDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(() => Object.fromEntries(d.categories.map((c) => [c.key, { maxLevel: c.maxLevel ?? "", statement: c.statement ?? "" }])) as Record<AppetiteCategory, { maxLevel: RiskLevel | ""; statement: string }>);
  const set = (r: RiskAppetiteDto) => qc.setQueryData(["risk-appetite"], r);
  const save = useMutation({
    mutationFn: () => api.risks.saveAppetite({ items: (Object.entries(f) as [AppetiteCategory, { maxLevel: RiskLevel | ""; statement: string }][]).filter(([, v]) => v.maxLevel).map(([key, v]) => ({ key, maxLevel: v.maxLevel as RiskLevel, statement: v.statement || null })) }),
    onSuccess: (r) => (set(r), setEdit(false)),
  });
  const approve = useMutation({ mutationFn: api.risks.approveAppetite, onSuccess: (r) => (set(r), toast(t("rap.approved"))) });
  const any = d.categories.some((c) => c.maxLevel);
  return (
    <Card data-testid="rap-appetite">
      <CardHeader
        title={t("rap.appetite")}
        subtitle={d.approvedAt ? t("rap.approvedBy", { name: d.approvedByName ?? "", date: fmtDay(d.approvedAt.slice(0, 10)) }) : t("rap.notApproved")}
        action={
          can("risks:write") &&
          !edit && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEdit(true)}>
                {t("rap.edit")}
              </Button>
              {any && (!d.approvedAt || d.changedAfterApproval) && (
                <Button disabled={approve.isPending} onClick={() => approve.mutate()}>
                  <CheckCircle2 size={15} /> {t("rap.approve")}
                </Button>
              )}
            </div>
          )
        }
      />
      <div className="px-5 py-3">
        {d.changedAfterApproval && <p className="mb-2 text-sm text-amber-800">{t("rap.changedAfter")}</p>}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-1.5 pr-2">{t("rap.category")}</th>
              <th className="py-1.5 pr-2">{t("rap.maxLevel")}</th>
              <th className="py-1.5">{t("rap.statement")}</th>
            </tr>
          </thead>
          <tbody>
            {d.categories.map((c) => (
              <tr key={c.key} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-2">{t.lbl(RISK_APPETITE_LABELS.category[c.key])}</td>
                <td className="py-2 pr-2">
                  {edit ? (
                    <Select aria-label={t("rap.maxLevel")} value={f[c.key].maxLevel} onChange={(e) => setF({ ...f, [c.key]: { ...f[c.key], maxLevel: e.target.value as RiskLevel | "" } })}>
                      <option value="">{t("rap.notSet")}</option>
                      {RISK_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {t.lbl(RISK_LABELS.level[l])}
                        </option>
                      ))}
                    </Select>
                  ) : c.maxLevel ? (
                    <RiskLevelBadge level={c.maxLevel} />
                  ) : (
                    <span className="text-slate-400">{t("rap.notSet")}</span>
                  )}
                </td>
                <td className="py-2">{edit ? <Textarea rows={2} aria-label={t("rap.statement")} value={f[c.key].statement} onChange={(e) => setF({ ...f, [c.key]: { ...f[c.key], statement: e.target.value } })} /> : <span className="text-slate-600">{c.statement}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {edit && (
          <div className="mt-3 flex gap-2">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("rsc.save")}
            </Button>
            <Button variant="secondary" onClick={() => setEdit(false)}>
              {t("rsc.cancel")}
            </Button>
          </div>
        )}
        <ErrorBox error={save.error ?? approve.error} />
      </div>
    </Card>
  );
}

function BreachesCard({ d }: { d: RiskAppetiteDto }) {
  const t = useT();
  return (
    <Card data-testid="rap-breaches">
      <CardHeader title={t("rap.breaches")} subtitle={t("rap.breachesHint")} />
      {!d.breaches.length ? (
        <EmptyState>{d.categories.some((c) => c.maxLevel) ? t("rap.noBreaches") : t("rap.setFirst")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 px-5 text-sm">
          {d.breaches.map((b) => (
            <li key={b.riskId} className="flex flex-wrap items-center gap-2 py-2">
              <Link to="/risks/$riskId" params={{ riskId: b.riskId }} className="font-medium text-brand-700 hover:underline">
                {b.code ? `${b.code} ` : ""}
                {b.name}
              </Link>
              <RiskLevelBadge level={b.level} />
              <span className="text-xs text-slate-500">
                {t("rap.over", { limit: t.lbl(RISK_LABELS.level[b.limit]), cats: b.categories.map((c) => t.lbl(RISK_APPETITE_LABELS.category[c])).join(", ") })}
              </span>
              {!b.treatment && <Badge tone="red">{t("rap.noTreatment")}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function KriCard({ d }: { d: RiskAppetiteDto }) {
  const t = useT();
  return (
    <Card data-testid="rap-kri">
      <CardHeader title={t("rap.kri")} subtitle={t("rap.kriHint")} />
      <div className="px-5 py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-1.5 pr-2">{t("rap.indicator")}</th>
              <th className="py-1.5 pr-2 text-right">{t("rap.value")}</th>
              <th className="py-1.5 pr-2">{t("rap.thresholds")}</th>
              <th className="py-1.5 pr-2">{t("rsc.cov.state")}</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {d.kris.map((k) => (
              <KriRow key={k.key + k.warn + k.alert + k.enabled} k={k} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function KriRow({ k }: { k: KriDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ enabled: k.enabled, warn: String(k.warn), alert: String(k.alert) });
  const save = useMutation({
    mutationFn: () => api.risks.saveKri(k.key, { enabled: f.enabled, warn: Number(f.warn), alert: Number(f.alert) }),
    onSuccess: (r) => (qc.setQueryData(["risk-appetite"], r), setEdit(false)),
  });
  const fmt = (v: number | null) => (v == null ? "–" : k.unit === "pct" ? `${v} %` : String(v));
  const op = k.direction === "min" ? "<" : "≥";
  return (
    <tr className="border-b border-slate-100 align-top" data-testid="rap-kri-row">
      <td className="py-2 pr-2">
        <a href={k.link} className="hover:text-brand-700">
          {t.lbl(RISK_APPETITE_LABELS.kri[k.key])}
        </a>
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{fmt(k.value)}</td>
      <td className="py-2 pr-2 text-xs text-slate-600">
        {edit ? (
          <div className="flex flex-wrap items-center gap-1">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> {t("rap.enabled")}
            </label>
            <Input className="w-20" aria-label={t("rap.warn")} type="number" value={f.warn} onChange={(e) => setF({ ...f, warn: e.target.value })} />
            <Input className="w-20" aria-label={t("rap.alert")} type="number" value={f.alert} onChange={(e) => setF({ ...f, alert: e.target.value })} />
          </div>
        ) : (
          t("rap.thr", { op, warn: fmt(k.warn), alert: fmt(k.alert) })
        )}
        <ErrorBox error={save.error} />
      </td>
      <td className="py-2 pr-2">
        <Badge tone={kriTone[k.status]}>{t.lbl(RISK_APPETITE_LABELS.status[k.status])}</Badge>
        {k.breachedSince && <div className="text-xs text-slate-500">{t("rap.since", { date: fmtDay(k.breachedSince.slice(0, 10)) })}</div>}
      </td>
      <td className="py-2 text-right">
        {can("risks:write") &&
          (edit ? (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("rsc.save")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setEdit(true)}>
              {t("rap.edit")}
            </Button>
          ))}
      </td>
    </tr>
  );
}

/** Přehled skupiny společností z posledních měsíčních snímků (v1.24, ADR-121). */
function GroupCard() {
  const t = useT();
  const q = useQuery({ queryKey: ["risk-group"], queryFn: api.risks.groupOverview });
  const rows = q.data ?? [];
  if (rows.length < 2) return null;
  const fmt = (k: string, v: number | null | undefined) => (v == null ? "–" : k.endsWith("_pct") ? `${v} %` : String(v));
  return (
    <Card data-testid="rap-group">
      <CardHeader title={t("rap.groupTitle")} subtitle={t("rap.groupHint")} />
      <div className="overflow-x-auto px-5 py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="py-1.5 pr-2">{t("rap.company")}</th>
              {GROUP_RISK_METRICS.map((k) => (
                <th key={k} className="py-1.5 pr-2 text-right">
                  {t.lbl(TREND_LABELS[k])}
                </th>
              ))}
              <th className="py-1.5 text-right">{t("rap.asOf")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.companyId} className="border-b border-slate-100">
                <td className="py-2 pr-2 font-medium">{r.name}</td>
                {GROUP_RISK_METRICS.map((k) => (
                  <td key={k} className="py-2 pr-2 text-right tabular-nums">
                    {fmt(k, r.values[k])}
                  </td>
                ))}
                <td className="py-2 text-right text-xs text-slate-500">{r.takenAt ? fmtDay(r.takenAt.slice(0, 10)) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorBox error={q.error} />
    </Card>
  );
}
