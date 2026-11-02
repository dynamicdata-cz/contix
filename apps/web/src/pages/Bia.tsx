import { askConfirm } from "@/components/ui/overlay";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { BiaChainCard } from "./Resilience";
import { useT, lbl } from "@/lib/i18n";
import { ContinuityTabs } from "./Plans";
import { HEALTH_COLOR, STATUS_COLORS } from "@/components/health";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, PageHeader, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import {
  BIA_AREAS,
  BIA_IMPACT_LABELS,
  BIA_TIMEPOINTS,
  DECREE_LEVEL_NAMES,
  formatHours,
  LABELS,
  requiredAvailability,
  suggestMtpd,
  type BiaDetail,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

/** Úrovně dopadu 0–4: žádný = neutrální, dále ordinálně nízký → kritický (stejná rampa jako rizika). */
const IMPACT_BG = ["#f1f5f9", "#fbe1d6", "#f5b8a6", "#d9716a", "#7a1a1c"];
const IMPACT_FG = ["#64748b", "#7c2d12", "#7c2d12", "#ffffff", "#ffffff"];

export function BiaListPage() {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["bia"], queryFn: api.bia.list });
  const create = useMutation({
    mutationFn: (processId: string) => api.bia.create({ processId }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["bia"] });
      nav({ to: "/bia/$biaId", params: { biaId: b.id } });
    },
  });
  const items = list.data?.items ?? [];
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("bia.kontinuitaAnalyzaDopaduBia")}
        subtitle={t("bia.15VyhlC4092025")}
      />
      <ContinuityTabs active="bia" />
      <ErrorBox error={list.error ?? create.error} />
      <Card className="mb-6 overflow-hidden">
        <CardHeader title={t("bia.analyzyDopadu")} />
        {items.length === 0 ? (
          <EmptyState>{t("bia.zatimZadnaAnalyzaDopaduZalozte")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("bia.proces")}</th>
                <th className="px-3 py-2">{t("bia.stav")}</th>
                <th className="px-3 py-2">{t("bia.maxDopad")}</th>
                <th className="px-3 py-2">{t("bia.mtpd")}</th>
                <th className="px-3 py-2">{t("bia.rto")}</th>
                <th className="px-3 py-2">{t("bia.rpo")}</th>
                <th className="px-3 py-2">{t("bia.upozorneni")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link to="/bia/$biaId" params={{ biaId: b.id }} className="font-medium hover:text-brand-700">
                      {b.processCode && <span className="mr-1.5 text-slate-500">{b.processCode}</span>}
                      {b.processName}
                    </Link>
                    {b.assessedAt && <div className="text-xs text-slate-500">{t("bia.hodnoceno", { p: fmtDay(b.assessedAt) })}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={b.status === "approved" ? "green" : "amber"}>{b.status === "approved" ? t("bia.schvaleno") : t("bia.navrh")}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <ImpactChip v={b.maxImpact} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{formatHours(b.mtpdHours)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{formatHours(b.rtoHours)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{formatHours(b.rpoHours)}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {b.warnings.length ? (
                      <span className="inline-flex items-center gap-1 text-amber-800" title={b.warnings.join("\n")}>
                        <AlertTriangle size={13} color={STATUS_COLORS.serious} /> {b.warnings.length}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <CardHeader title={t("bia.procesyBezAnalyzyDopadu")} subtitle={t("bia.vrcholneVedeniSeNaAnalyze")} />
        {list.data?.missing.length === 0 ? (
          <EmptyState>{t("bia.vsechnyPlatneProcesyMajiAnalyzu")}</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data?.missing.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                <span className="flex-1">
                  {p.code && <span className="mr-1.5 text-slate-500">{p.code}</span>}
                  {p.name}
                </span>
                <Badge>{t.lbl(LABELS.criticality[p.criticality as keyof typeof LABELS.criticality])}</Badge>
                {can("bia:read") && (
                  <Button variant="secondary" className="px-2.5 py-1 text-xs" disabled={create.isPending} onClick={() => create.mutate(p.id)}>
                    <Plus size={13} /> {t("bia.zalozitBia")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const ImpactChip = ({ v }: { v: number }) => (
  <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: IMPACT_BG[v], color: IMPACT_FG[v] }}>
    {v} {lbl(BIA_IMPACT_LABELS[v])}
  </span>
);

export function BiaDetailPage() {
  const { biaId } = useParams({ strict: false }) as { biaId: string };
  const q = useQuery({ queryKey: ["bia", biaId], queryFn: () => api.bia.get(biaId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <BiaEditor key={q.data.id} bia={q.data} />;
}

function BiaEditor({ bia }: { bia: BiaDetail }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = bia.canEdit;
  const [f, setF] = useState({
    impacts: bia.impacts,
    mtpdHours: bia.mtpdHours,
    rtoHours: bia.rtoHours,
    rpoHours: bia.rpoHours,
    minServiceLevel: bia.minServiceLevel ?? "",
    peakPeriods: bia.peakPeriods ?? "",
    dependencies: bia.dependencies ?? "",
    notes: bia.notes ?? "",
    assessedAt: bia.assessedAt,
    status: bia.status,
  });
  const save = useMutation({
    mutationFn: () => api.bia.update(bia.id, { ...f, minServiceLevel: f.minServiceLevel || null, peakPeriods: f.peakPeriods || null, dependencies: f.dependencies || null, notes: f.notes || null }),
    onSuccess: (d) => {
      qc.setQueryData(["bia", d.id], d);
      qc.invalidateQueries({ queryKey: ["bia"] });
    },
  });
  const del = useMutation({
    mutationFn: () => api.bia.remove(bia.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bia"] });
      nav({ to: "/bia" });
    },
  });
  const setImpact = (area: string, tp: string, v: number) => setF((x) => ({ ...x, impacts: { ...x.impacts, [area]: { ...x.impacts[area], [tp]: v } } }));
  const mtpdSuggest = suggestMtpd(f.impacts);
  const reqAvail = requiredAvailability(f.rtoHours);
  const hours = (v: number | null) => ({
    value: v ?? "",
    onChange: (e: { target: { value: string } }) => e.target.value,
  });
  const num = (k: "mtpdHours" | "rtoHours" | "rpoHours") => ({
    ...hours(f[k]),
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value === "" ? null : Number(e.target.value) }),
  });

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/bia" className="hover:text-brand-700">
          {t("bia.kontinuitaBia")}
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("bia.analyzaDopadu", { processName: bia.processName })}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge tone={bia.status === "approved" ? "green" : "amber"}>{bia.status === "approved" ? t("bia.schvaleno") : t("bia.navrh")}</Badge>
            <Link to="/processes/$processId" params={{ processId: bia.processId }} className="text-brand-600 hover:underline">
              {t("bia.proces2", { p: bia.processCode ?? "" })}
            </Link>
          </div>
        </div>
        <div className="flex gap-2">
          {can("bia:write") && (
            <Link to="/continuity/plans/new" search={{ processId: bia.processId }}>
              <Button variant="secondary">
                <Plus size={15} /> {t("bia.planKontinuity")}
              </Button>
            </Link>
          )}
          {can("bia:write") && (
            <Button variant="danger" onClick={async () => (await askConfirm(t("bia.smazatAnalyzuDopadu"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          )}
          {edit && (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("bia.ulozit")}
            </Button>
          )}
        </div>
      </div>
      {save.isSuccess && <SuccessBox>{t("bia.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error} />
      {bia.warnings.length > 0 && (
        <div className="mb-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {bia.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" color={STATUS_COLORS.serious} /> {w}
            </div>
          ))}
        </div>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title={t("bia.dopadyVypadkuVCase")}
          subtitle={t("bia.oblastiDlePrilohyC1")}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-5 py-2 text-left font-medium">{t("bia.oblastDopadu")}</th>
                {BIA_TIMEPOINTS.map((tx) => (
                  <th key={tx.key} className="w-24 px-2 py-2 text-center font-medium">
                    {tx.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {BIA_AREAS.map((a) => (
                <tr key={a.key}>
                  <td className="px-5 py-1.5">
                    <div className="font-medium text-slate-800">{a.label}</div>
                    <div className="text-xs text-slate-500">{a.description}</div>
                  </td>
                  {BIA_TIMEPOINTS.map((tx) => {
                    const v = f.impacts[a.key]?.[tx.key] ?? 0;
                    return (
                      <td key={tx.key} className="px-1.5 py-1.5">
                        <select
                          disabled={!edit}
                          aria-label={`${a.label} – ${tx.label}`}
                          value={v}
                          onChange={(e) => setImpact(a.key, tx.key, Number(e.target.value))}
                          className="w-full rounded border-0 px-1 py-1.5 text-center text-xs font-medium"
                          style={{ background: IMPACT_BG[v], color: IMPACT_FG[v] }}
                        >
                          {BIA_IMPACT_LABELS.map((l, i) => (
                            <option key={i} value={i}>
                              {i} {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("bia.cileRizeniKontinuity15Pism")} />
          <fieldset disabled={!edit} className="space-y-4 p-5">
            <Field label={t("bia.1MinimalniUrovenPoskytovanychSluzeb")}>
              <Textarea rows={2} value={f.minServiceLevel} onChange={(e) => setF({ ...f, minServiceLevel: e.target.value })} placeholder={t("bia.coMusiFungovatIV")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("bia.mtpdHod")} hint={mtpdSuggest != null ? t("bia.navrhZDopadu", { p: formatHours(mtpdSuggest) }) : t("bia.maximalniPrijatelnaDobaVypadku")}>
                <Input type="number" min={0} step="0.25" {...num("mtpdHours")} />
              </Field>
              <Field label={t("bia.2RtoHod")} hint={t("bia.dobaObnoveniChodu")}>
                <Input type="number" min={0} step="0.25" {...num("rtoHours")} />
              </Field>
              <Field label={t("bia.3RpoHod")} hint={t("bia.bodObnoveniDat")}>
                <Input type="number" min={0} step="0.25" {...num("rpoHours")} />
              </Field>
            </div>
            {mtpdSuggest != null && f.mtpdHours !== mtpdSuggest && edit && (
              <button type="button" className="-mt-2 text-xs text-brand-700 hover:underline" onClick={() => setF({ ...f, mtpdHours: mtpdSuggest })}>
                {t("bia.pouzitNavrhMtpdPrvniCas", { p: formatHours(mtpdSuggest) })}
              </button>
            )}
            {reqAvail != null && (
              <p className="text-sm text-slate-600">
                {t("bia.rto")} {formatHours(f.rtoHours)} {t("bia.odpovidaDostupnostiAktivUrovne")} <b>{t.lbl(DECREE_LEVEL_NAMES[reqAvail])}</b> {t("bia.prilC1TabC")}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("bia.datumHodnoceni")}>
                <Input type="date" value={f.assessedAt ?? ""} onChange={(e) => setF({ ...f, assessedAt: e.target.value || null })} />
              </Field>
              <Field label={t("bia.stav")}>
                <Select value={f.status} disabled={!can("bia:write")} onChange={(e) => setF({ ...f, status: e.target.value as "draft" | "approved" })}>
                  <option value="draft">{t("bia.navrh")}</option>
                  <option value="approved">{t("bia.schvaleno")}</option>
                </Select>
              </Field>
            </div>
            <Field label={t("bia.obdobiSpicky")}>
              <Input value={f.peakPeriods} onChange={(e) => setF({ ...f, peakPeriods: e.target.value })} placeholder={t("bia.naprKonecMesice15")} />
            </Field>
            <Field label={t("bia.zavislostiDodavateleJineProcesyLide")}>
              <Textarea rows={2} value={f.dependencies} onChange={(e) => setF({ ...f, dependencies: e.target.value })} />
            </Field>
            <Field label={t("bia.poznamky")}>
              <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </Field>
          </fieldset>
        </Card>

        <BiaChainCard processId={bia.processId} canApply={edit} onApply={(text) => setF({ ...f, dependencies: f.dependencies ? `${f.dependencies}\n${text}` : text })} />
        <Card>
          <CardHeader title={t("bia.aktivaProcesuAJejichDostupnost")} subtitle={t("bia.hodnoceniDostupnostiAktivByMelo")} />
          {bia.assets.length === 0 ? (
            <EmptyState>{t("bia.procesNemaNavazanaAktivaProcesy")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {bia.assets.map((a) => (
                <li key={a.id} className={cn("flex items-center gap-3 px-5 py-2 text-sm", a.gap && "bg-red-50/40")}>
                  <Link to="/assets/$assetId" params={{ assetId: a.id }} className="flex-1 hover:text-brand-700">
                    {a.name}
                  </Link>
                  <span className="text-xs text-slate-500">{t.lbl(LABELS.assetType[a.assetType as keyof typeof LABELS.assetType]) ?? a.assetType}</span>
                  <span className="w-28 text-right text-xs">
                    {t("bia.dostupnost")} <b>{a.availability ? t.lbl(DECREE_LEVEL_NAMES[a.availability]) : "—"}</b>
                  </span>
                  {a.gap && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                      <AlertTriangle size={13} color={HEALTH_COLOR.red} /> {t("bia.nizka")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
