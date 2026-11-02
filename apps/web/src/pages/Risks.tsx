import { SavedViews, SortTh } from "@/components/listTools";
import { useUrlBatch, useUrlSort } from "@/lib/urlState";
type RiskSortKey = "name" | "level" | "residual" | "status" | "owner" | "due";
import { useDebounced } from "@/lib/utils";
import { useUrlFlag, useUrlParam } from "@/lib/urlState";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import { CompanyCell, useGroupView } from "@/components/company";
import { DocumentVersions } from "@/components/documents";
import { useMethodologies } from "@/components/methodology";
import { VulnSuggestions } from "./risk/VulnSuggestions";
import { MethodologyHeatmap, LevelBars, RiskHeatmap, RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, fmtDay, plural } from "@/lib/utils";
import { BUILTIN_RISK_METHODOLOGY, getRiskMethodology, RISK_LABELS, RISK_LEVELS, RISK_STATUSES, type RiskListItem, sortRows } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, Coins, BookOpen, ListChecks, Plus, Radar, Gauge } from "lucide-react";
import { useState, useMemo } from "react";

export const riskStatusTone = { identified: "slate", assessed: "blue", treatment: "amber", accepted: "violet", closed: "green" } as const;

export function RisksPage() {
  const t = useT();
  const group = useGroupView();
  const can = useCan();
  // filtry v adrese (v1.06) – návrat z detailu je zachová
  const [q, setQ] = useUrlParam("q");
  const [level, setLevel] = useUrlParam("level");
  const [status, setStatus] = useUrlParam("status");
  const [residual, setResidual] = useUrlFlag("residual");
  const [trig, setTrig] = useUrlFlag("triggers");
  const dq = useDebounced(q);
  const [sort, setSort] = useUrlSort<RiskSortKey>();
  const batch = useUrlBatch();
  const summary = useQuery({ queryKey: ["risks", "summary"], queryFn: api.risks.summary });
  const list = useQuery({ queryKey: ["risks", "list", dq, level, status, trig], queryFn: () => api.risks.list({ q: dq, level, status, ...(trig && { triggers: "1" as const }), limit: 500 }) });
  const s = summary.data;
  useMethodologies();
  const mk = s?.policy.methodology || BUILTIN_RISK_METHODOLOGY;
  const mdef = mk !== BUILTIN_RISK_METHODOLOGY ? getRiskMethodology(mk) : null;
  const today = new Date().toISOString().slice(0, 10);
  const LV = { low: 1, medium: 2, high: 3, critical: 4 } as Record<string, number>;
  const sorted = useMemo(() => {
    const rows = list.data?.items ?? [];
    if (!sort) return rows;
    const val = (r: RiskListItem): string | number | null =>
      sort.key === "name" ? `${r.code ?? ""} ${r.name}` : sort.key === "level" ? (r.score ?? (r.level ? LV[r.level]! : null)) : sort.key === "residual" ? (r.residualScore ?? null) : sort.key === "status" ? RISK_STATUSES.indexOf(r.status) : sort.key === "owner" ? r.ownerPositionName : r.treatmentDue;
    return sortRows(rows, val, sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, sort?.key, sort?.dir]);
  const overdue = (r: RiskListItem) => !!r.treatmentDue && r.treatmentDue < today && ["identified", "assessed", "treatment"].includes(r.status);

  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("rsk.rizika")}
        subtitle={
          s && mk !== BUILTIN_RISK_METHODOLOGY
            ? t("rsk.metodikaSkoreAkceptovatelne", { p: mdef?.name ?? mk, p2: mdef?.formula ?? "…", p3: mdef?.levels.filter((l) => l.acceptable).map((l) => l.label).join(", ") || "—" })
            : s
            ? t("rsk.metodikaPriloha4", { formula: s.method === "three_factor" ? t("rsk.vzorecTriFaktory") : t("rsk.dopadPravdepodobnostScenare"), levels: s.levels, accept: s.policy.acceptLevel === "low" ? t("rsk.nizke") : t("rsk.nizkeAStredni") })
            : t("rsk.registrAHodnoceniRizik")
        }
        actions={
          <>
            <Link to="/risks/cycles">
              <Button variant="secondary">
                <CalendarCheck size={16} /> {t("rsk.rocniHodnoceni")}
              </Button>
            </Link>
            <Link to="/risks/scenarios">
              <Button variant="secondary">
                <Radar size={16} /> {t("rsc.button")}
              </Button>
            </Link>
            <Link to="/risks/appetite">
              <Button variant="secondary">
                <Gauge size={16} /> {t("rap.button")}
              </Button>
            </Link>
            <Link to="/risks/quant">
              <Button variant="secondary">
                <Coins size={16} /> {t("rsk.kvantitativne")}
              </Button>
            </Link>
            <Link to="/risks/plan">
              <Button variant="secondary">
                <ListChecks size={16} /> {t("rsk.planZvladani")}
              </Button>
            </Link>
            <Link to="/risks/catalog">
              <Button variant="secondary">
                <BookOpen size={16} /> {t("rsk.katalogHrozebAZranitelnosti")}
              </Button>
            </Link>
            {can("risks:write") && (
              <Link to="/risks/new" search={{}}>
                <Button>
                  <Plus size={16} /> {t("rsk.noveRiziko")}
                </Button>
              </Link>
            )}
          </>
        }
      />
      <ErrorBox error={summary.error ?? list.error} />

      {s && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {mk === BUILTIN_RISK_METHODOLOGY ? (
            <Card>
              <CardHeader title={t("rsk.teplotniMapa")} subtitle={t("rsk.otevrenaRizikaPodleDopaduA")} />
              <div className="p-5">
                <RiskHeatmap matrix={s.matrix} levels={s.levels} />
              </div>
            </Card>
          ) : mdef && s.customMatrix ? (
            <Card>
              <CardHeader title={t("rsk.teplotniMapa")} subtitle={t("rsk.matrixSubtitle", { p: mdef.name })} />
              <div className="p-5">
                <MethodologyHeatmap def={mdef} counts={s.customMatrix.counts} />
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title={t("rsk.urovneMetodiky", { p: mdef?.name ?? mk })} subtitle={t("rsk.zarazeniRizikaDoUrovneMetodiky")} />
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {(mdef?.levels ?? []).map((l) => (
                    <tr key={l.key}>
                      <td className="px-5 py-2 font-medium">{l.label}</td>
                      <td className="px-3 py-2">
                        <RiskLevelBadge level={l.mapsTo} />
                      </td>
                      <td className="px-3 py-2 text-slate-600">{l.treatment}</td>
                      <td className="px-3 py-2">{l.acceptable ? <Badge tone="green">{t("rsk.akceptovatelne")}</Badge> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <Card>
            <CardHeader
              title={residual ? t("rsk.zbytkovaRizikaPodleUrovne") : t("rsk.rizikaPodleUrovne")}
              action={
                <div className="flex rounded-md border border-slate-300 p-0.5 text-xs">
                  {[false, true].map((v) => (
                    <button key={String(v)} onClick={() => setResidual(v)} className={cn("rounded px-2 py-1", residual === v ? "bg-brand-50 text-brand-700" : "text-slate-600")}>
                      {v ? t("rsk.zbytkova") : t("rsk.aktualni")}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="space-y-5 p-5">
              <LevelBars counts={residual ? s.residualByLevel : s.byLevel} />
              <div className="flex flex-wrap gap-4 border-t border-slate-100 pt-4 text-sm">
                {RISK_STATUSES.map((st) => (
                  <div key={st} className="flex items-center gap-1.5">
                    <Badge tone={riskStatusTone[st]}>{t.lbl(RISK_LABELS.status[st])}</Badge>
                    <span className="font-semibold tabular-nums">{s.byStatus[st]}</span>
                  </div>
                ))}
                {s.overdue > 0 && (
                  <div className="flex items-center gap-1.5 font-medium text-red-700">
                    {t("rsk.poTerminuOsetreni", { overdue: s.overdue })}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-4 text-sm">
                <span className={s.untreated ? "font-medium text-red-700" : "text-slate-600"}>{t("rsk.nadHraniciAkceptovatelnostiBezOsetreni", { untreated: s.untreated })}</span>
                <span className={s.reviewDue ? "font-medium text-amber-700" : "text-slate-600"}>{t("rsk.kPravidelnemuPrehodnoceni", { reviewDue: s.reviewDue })}</span>
                {s.outdatedScale > 0 && <span className="font-medium text-amber-700">{t("rsk.hodnocenoVJineStupniciMetodice", { outdatedScale: s.outdatedScale })}</span>}
              </div>
            </div>
          </Card>
        </div>
      )}

      <VulnSuggestions />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <Input className="max-w-xs" placeholder={t("rsk.hledatNazevNeboKod")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-40" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">{t("rsk.vsechnyUrovne")}</option>
            {RISK_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t.lbl(RISK_LABELS.level[l])}
              </option>
            ))}
          </Select>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("rsk.vsechnyStavy")}</option>
            {RISK_STATUSES.map((st) => (
              <option key={st} value={st}>
                {t.lbl(RISK_LABELS.status[st])}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 self-center text-sm text-slate-700">
            <input type="checkbox" checked={trig} onChange={(e) => setTrig(e.target.checked)} /> {t("risk.trg.filter")}
          </label>
          <SavedViews
            page="risks"
            state={{ q, level, status, triggers: trig ? "1" : "", sort: sort ? `${sort.key}:${sort.dir}` : "" }}
            onApply={(v) => batch({ q: String(v.q ?? ""), level: String(v.level ?? ""), status: String(v.status ?? ""), triggers: String(v.triggers ?? ""), sort: String(v.sort ?? "") })}
            onReset={() => batch({ q: "", level: "", status: "", triggers: "", sort: "" })}
          />
          <span className="ml-auto self-center text-sm text-slate-500">
            {list.data && list.data.total > list.data.items.length ? t("rsk.shownOf", { shown: list.data.items.length, n: list.data.total }) : t("rsk.rizikN", { n: list.data?.total ?? 0 })}
          </span>
        </div>
        {list.data?.items.length === 0 ? (
          <EmptyState>{t("rsk.zadnaRizikaZalozteRizikoVyberte")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <SortTh k="name" label={t("rsk.riziko")} sort={sort} onSort={setSort} className="pl-5" />
                  <th className="px-3 py-2">{t("rsk.hrozbaZranitelnost")}</th>
                  <SortTh k="level" label={t("rsk.uroven")} sort={sort} onSort={setSort} firstDir="desc" />
                  <SortTh k="residual" label={t("rsk.zbytkove")} sort={sort} onSort={setSort} firstDir="desc" />
                  <SortTh k="status" label={t("rsk.stav")} sort={sort} onSort={setSort} />
                  <SortTh k="owner" label={t("rsk.vlastnik")} sort={sort} onSort={setSort} />
                  <SortTh k="due" label={t("rsk.termin")} sort={sort} onSort={setSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link to="/risks/$riskId" params={{ riskId: r.id }} className="font-medium text-slate-900 hover:text-brand-700">
                        {r.code && <span className="mr-1.5 text-slate-500">{r.code}</span>}
                        {r.name}
                      </Link>
                      {group && <div><CompanyCell id={r.companyId} /></div>}
                      <div className="text-xs text-slate-500">
                        {r.triggers > 0 && (
                          <span className="mr-1 font-medium text-red-700" title={t("risk.trg.title")}>
                            {t("risk.trg.badge", { n: r.triggers })}
                          </span>
                        )}
                        {r.reviewDue && <span className="mr-1 text-amber-700">{t("rsk.prehodnotit")}</span>}
                        {r.outdatedScale && <span className="mr-1 text-amber-700">{t("rsk.prehodnotitVMetodice")}</span>}
                        {t("rsk.aktivN", { n: r.assetCount })} · {t("rsk.procesuN", { n: r.processCount })}
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2.5 text-xs text-slate-600">
                      <div className="truncate" title={[r.threatName, ...r.moreThreatNames].filter(Boolean).join("\n")}>
                        {r.threatName ?? "—"}
                        {r.moreThreatNames.length > 0 && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px] text-slate-600">+{r.moreThreatNames.length}</span>}
                      </div>
                      <div className="truncate text-slate-400" title={[r.weaknessName, ...r.moreWeaknessNames].filter(Boolean).join("\n")}>
                        {r.weaknessName}
                        {r.moreWeaknessNames.length > 0 && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px] text-slate-600">+{r.moreWeaknessNames.length}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <RiskLevelBadge level={r.level} score={r.score} />
                    </td>
                    <td className="px-3 py-2.5">{r.residualLevel ? <RiskLevelBadge level={r.residualLevel} score={r.residualScore} /> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={riskStatusTone[r.status]}>{t.lbl(RISK_LABELS.status[r.status])}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.ownerPositionName ?? <span className="text-amber-700">{t("rsk.bezVlastnika")}</span>}</td>
                    <td className={cn("px-3 py-2.5 whitespace-nowrap", overdue(r) ? "font-medium text-red-700" : "text-slate-600")}>
                      {r.treatmentDue ? fmtDay(r.treatmentDue) : "—"}
                      {overdue(r) && " ⚠"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="mt-6">
        <DocumentVersions kind="risk_report" writePerm="risks:write" />
      </div>
    </>
  );
}
