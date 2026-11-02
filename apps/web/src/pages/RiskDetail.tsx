import { Tabs, useTab } from "@/components/ui/tabs";
import { useFormGuard } from "@/lib/unsaved";
import { askConfirm } from "@/components/ui/overlay";
import { TasksCard } from "@/components/tasks";
import { LinkedRecordsCard } from "@/components/linkedRecords";
import { useT } from "@/lib/i18n";
import { SimilarRecordsCard } from "@/components/records";
import { RiskSocSignalsCard } from "@/components/soc";
import { RiskReassessmentCard } from "@/components/riskReassessment";
import { LinkedDocsCard } from "@/components/linkedDocs";
import { TransferButton } from "@/components/transfer";
import { SeverityBadge } from "@/components/health";
import { AssetPicker, PositionSelect, type PickedAsset } from "@/components/pickers";
import { FactorEditor, useMethodologies } from "@/components/methodology";
import { RiskLevelBadge, ScaleSelect, locScale } from "@/components/risk";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select, SuccessBox, Textarea, toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import {
  CONTROL_LABELS,
  isAcceptable,
  RISK_LABELS,
  RISK_STATUSES,
  riskScore,
  residualValues,
  scaleFor,
  scoreMethodology,
  getRiskMethodology,
  BUILTIN_RISK_METHODOLOGY,
  type FactorValues,
  type ControlStatus,
  type ScaleLevels,
  TREATMENTS,
  type CatalogItemDto,
  type RiskDetail,
  type RiskInput,
  type RiskPolicy,
  type Severity,
} from "@contix/shared";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Lightbulb, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PlanSuggestionsCard, TreatmentPlanCard } from "./risk/TreatmentPlan";
import { QuantCard } from "./risk/QuantCard";
import { AiSuggestPanel } from "@/components/ai";

type Form = Omit<RiskInput, "assetIds" | "processIds" | "cveIds" | "controlIds"> & {
  assets: PickedAsset[];
  processIds: string[];
  cveIds: string[];
  controlIds: string[];
};

const blank = (): Form => ({
  code: "",
  name: "",
  description: "",
  threatId: null,
  weaknessId: null,
  moreThreatIds: [],
  moreWeaknessIds: [],
  ownerPositionId: null,
  status: "identified",
  impact: null,
  threatLevel: null,
  vulnLevel: null,
  likelihood: null,
  treatment: null,
  treatmentPlan: "",
  treatmentDue: null,
  residualImpact: null,
  residualThreatLevel: null,
  residualVulnLevel: null,
  residualLikelihood: null,
  factorValues: null,
  residualFactorValues: null,
  quant: null,
  assets: [],
  processIds: [],
  cveIds: [],
  controlIds: [],
});

const fromDetail = (d: RiskDetail): Form => ({
  code: d.code ?? "",
  name: d.name,
  description: d.description ?? "",
  threatId: d.threatId,
  weaknessId: d.weaknessId,
  moreThreatIds: d.moreThreatIds,
  moreWeaknessIds: d.moreWeaknessIds,
  ownerPositionId: d.ownerPositionId,
  status: d.status,
  impact: d.impact,
  threatLevel: d.threatLevel,
  vulnLevel: d.vulnLevel,
  likelihood: d.likelihood,
  treatment: d.treatment,
  treatmentPlan: d.treatmentPlan ?? "",
  treatmentDue: d.treatmentDue,
  residualImpact: d.residualImpact,
  residualThreatLevel: d.residualThreatLevel,
  residualVulnLevel: d.residualVulnLevel,
  residualLikelihood: d.residualLikelihood,
  factorValues: d.factorValues,
  residualFactorValues: d.residualFactorValues,
  quant: d.quant,
  assets: d.assets,
  processIds: d.processes.map((p) => p.id),
  cveIds: d.cves.map((c) => c.id),
  controlIds: d.controls.map((c) => c.id),
});

export function RiskNewPage() {
  const t = useT();
  const search = useSearch({ strict: false }) as { processId?: string; assetId?: string; infoItem?: string };
  const asset = useQuery({ queryKey: ["asset", search.assetId], queryFn: () => api.assets.get(search.assetId!), enabled: !!search.assetId });
  // riziko z varování / upozornění informačního servisu (ADR-088)
  const info = useQuery({ queryKey: ["infoservice", "item", search.infoItem], queryFn: () => api.infoService.item(search.infoItem!), enabled: !!search.infoItem });
  const initial = useMemo(() => {
    const f = blank();
    if (search.processId) f.processIds = [search.processId];
    if (info.data) {
      f.name = info.data.title.slice(0, 500);
      f.description = t("rsk.fromInfoItem", { publisher: info.data.publisher || info.data.feedName, title: info.data.title, link: info.data.link, summary: info.data.summary }).slice(0, 10000);
      f.assets = info.data.assessment?.assets ?? [];
    }
    return f;
  }, [search.processId, info.data, t]);
  if (search.assetId && !asset.data) return <ErrorBox error={asset.error} />;
  if (search.infoItem && !info.data) return <ErrorBox error={info.error} />;
  const f = asset.data ? { ...initial, assets: [{ id: asset.data.id, name: asset.data.name, healthStatus: asset.data.healthStatus }] } : initial;
  return <RiskEditor initial={f} onCreated={search.infoItem ? (id) => api.infoService.link(search.infoItem!, "risk", id).then(() => undefined) : undefined} />;
}

export function RiskDetailPage() {
  const { riskId } = useParams({ strict: false }) as { riskId: string };
  const q = useQuery({ queryKey: ["risk", riskId], queryFn: () => api.risks.get(riskId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <RiskEditor key={q.data.id} detail={q.data} initial={fromDetail(q.data)} />;
}

function RiskEditor({ detail, initial, onCreated }: { detail?: RiskDetail; initial: Form; onCreated?: (id: string) => Promise<void> }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(initial);
  /** Zdůvodnění přehodnocení (ADR-058) – uloží se s novým hodnocením nebo při potvrzení beze změny. */
  const [reviewNote, setReviewNote] = useState("");
  const edit = detail ? detail.canEdit : can("risks:write");
  const summary = useQuery({ queryKey: ["risks", "summary"], queryFn: api.risks.summary });
  const catalog = useQuery({ queryKey: ["risk-catalog"], queryFn: () => api.risks.catalog() });
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  useMethodologies();
  // politika společnosti rizika (u nového rizika aktivní společnosti)
  const policy: RiskPolicy | undefined = detail?.policy ?? summary.data?.policy;
  const mk = policy?.methodology || BUILTIN_RISK_METHODOLOGY;
  const mdef = mk !== BUILTIN_RISK_METHODOLOGY ? getRiskMethodology(mk) : null;
  const custom = mk !== BUILTIN_RISK_METHODOLOGY;
  const levelLabel = (vals: FactorValues | null | undefined) => {
    if (!mdef) return null;
    const k = scoreMethodology(mdef, vals).levelKey;
    return mdef.levels.find((l) => l.key === k) ?? null;
  };
  const three = (policy?.method ?? "three_factor") === "three_factor";
  const levels = (policy?.levels ?? 4) as ScaleLevels;
  const sImpact = locScale(scaleFor("impact", levels));
  const sThreat = locScale(scaleFor("threat", levels));
  const sVuln = locScale(scaleFor("vulnerability", levels));
  const sLike = locScale(scaleFor("likelihood", levels));
  const controlsList = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });

  const cur = policy ? riskScore(policy, f) : null;
  const res = policy ? riskScore(policy, residualValues({ ...f, methodologyKey: null })) : null;

  const assetIds = f.assets.map((a) => a.id);
  const suggestion = useQuery({
    queryKey: ["risk-suggest", assetIds.join(), f.threatId],
    queryFn: () => api.risks.suggestImpact(assetIds, f.threatId),
    enabled: assetIds.length > 0,
  });

  const save = useMutation({
    mutationFn: () => {
      const { assets, ...rest } = f;
      const body: RiskInput = { ...rest, code: rest.code || null, description: rest.description || null, treatmentPlan: rest.treatmentPlan || null, assetIds: assets.map((a) => a.id) };
      if (detail && !can("risks:write")) delete body.ownerPositionId;
      return detail ? api.risks.update(detail.id, { ...body, ...(reviewNote.trim() && { reviewNote: reviewNote.trim() }) }) : api.risks.create(body);
    },
    onSuccess: async (r) => {
      // vazba na zdroj (varování informačního servisu) – chyba vazby nebrání uložení rizika
      if (!detail && onCreated) await onCreated(r.id).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["risks"] });
      qc.invalidateQueries({ queryKey: ["risk", r.id, "reassessment"] });
      if (detail) setReviewNote("");
      qc.invalidateQueries({ queryKey: ["process"] });
      qc.setQueryData(["risk", r.id], r);
      if (!detail) nav({ to: "/risks/$riskId", params: { riskId: r.id } });
    },
  });
  const guard = useFormGuard(save);
  const del = useMutation({
    mutationFn: () => api.risks.remove(detail!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["risks"] });
      nav({ to: "/risks" });
    },
  });

  const threats = (catalog.data ?? []).filter((c) => c.kind === "threat" && (c.isActive || c.id === f.threatId));
  const weaknesses = (catalog.data ?? []).filter((c) => c.kind === "weakness" && (c.isActive || c.id === f.weaknessId));
  const threat = threats.find((tx) => tx.id === f.threatId);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  // záložky detailu (v1.08) – formulář hodnocení zůstává v „Přehledu“
  const [tab, setTab] = useTab(["overview", "treatment", "links", "tasks"] as const, "overview");
  const show = (k: typeof tab) => !detail || tab === k;

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/risks" className="hover:text-brand-700">
          {t("rsk.rizika")}
        </Link>
      </div>
      <div className="sticky top-12 z-20 -mx-4 mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/70 bg-slate-50/85 px-4 py-3 backdrop-blur-md md:top-0 md:-mx-8 md:px-8">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">{detail ? (detail.code ? `${detail.code} ${detail.name}` : detail.name) : t("rsk.noveRiziko")}</h1>
          {cur && (
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <span className="flex items-center gap-2">
                {t("rsk.aktualni2")} <RiskLevelBadge level={cur.level} score={cur.score} />
              </span>
              <span className="flex items-center gap-2">
                {t("rsk.zbytkove2")} <RiskLevelBadge level={res?.level ?? null} score={res?.score} />
              </span>
              <span className="text-slate-400">{t("rsk.max", { max: cur.max })}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {detail && can("risks:write") && <TransferButton entity="risks" id={detail.id} companyId={detail.companyId} />}
          {detail && can("risks:write") && (
            <Button variant="danger" onClick={async () => (await askConfirm(t("rsk.smazatRiziko"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          )}
          {edit && (
            <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {detail ? t("rsk.ulozit") : t("rsk.zalozitRiziko")}
            </Button>
          )}
        </div>
      </div>
      {save.isSuccess && detail && <SuccessBox>{t("rsk.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error ?? summary.error} />

      {detail && (
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: "overview" as const, label: t("detail.tab.overview") },
            { key: "treatment" as const, label: t("detail.tab.treatment"), badge: detail.actions.length ? <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{detail.actions.length}</span> : null },
            { key: "links" as const, label: t("detail.tab.links") },
            { key: "tasks" as const, label: t("detail.tab.tasks") },
          ]}
        />
      )}
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {show("overview") && (
        <>
        {detail && (
          <RiskReassessmentCard
            riskId={detail.id}
            canEdit={edit}
            note={reviewNote}
            onNote={setReviewNote}
            onApply={(changes) => setF((x) => ({ ...x, ...Object.fromEntries(changes.map((c) => [c.field, c.to])) }))}
          />
        )}
        <Card>
          <CardHeader title={t("rsk.1Identifikace")} />
          <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
              <Field label={t("rsk.kod")}>
                <Input value={f.code ?? ""} onChange={(e) => set("code", e.target.value)} placeholder="R-01" />
              </Field>
              <Field label={t("rsk.nazevRizika")}>
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("rsk.naprRansomwareNaMzdovemServeru")} />
              </Field>
            </div>
            <CatalogSelect label={t("rsk.hrozba")} items={threats} value={f.threatId ?? null} onChange={(v) => set("threatId", v)} />
            <CatalogMulti label={t("rsk.moreThreats")} items={threats} primary={f.threatId ?? null} value={f.moreThreatIds ?? []} onChange={(v) => set("moreThreatIds", v)} testId="more-threats" />
            {threat && (
              <div className="-mt-2 flex gap-1.5 text-xs text-slate-500">
                {t("rsk.ohrozuje2")}
                {threat.affectsC && <Badge tone="blue">{t("rsk.duvernost")}</Badge>}
                {threat.affectsI && <Badge tone="blue">{t("rsk.integritu")}</Badge>}
                {threat.affectsA && <Badge tone="blue">{t("rsk.dostupnost")}</Badge>}
              </div>
            )}
            {[threat, weaknesses.find((w) => w.id === f.weaknessId)].some((x) => x?.source?.includes("82/2018")) && (
              <p className="-mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t("rsk.rizikoPouzivaHistorickouPolozkuKatalogu")}
              </p>
            )}
            <CatalogSelect label={t("rsk.zranitelnostSlabeMisto")} items={weaknesses} value={f.weaknessId ?? null} onChange={(v) => set("weaknessId", v)} />
            <CatalogMulti label={t("rsk.moreWeaknesses")} items={weaknesses} primary={f.weaknessId ?? null} value={f.moreWeaknessIds ?? []} onChange={(v) => set("moreWeaknessIds", v)} testId="more-weaknesses" />
            <Field label={t("rsk.popisScenare")}>
              <Textarea rows={3} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder={t("rsk.jakByKNaplneniRizika")} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("rsk.vlastnikRizikaFunkcniMisto")}>
                <PositionSelect disabled={!can("risks:write")} value={f.ownerPositionId ?? null} onChange={(v) => set("ownerPositionId", v)} />
              </Field>
              <Field label={t("rsk.stav")}>
                <Select value={f.status} onChange={(e) => set("status", e.target.value as Form["status"])}>
                  {RISK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t.lbl(RISK_LABELS.status[s])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </fieldset>
        </Card>

        <Card>
          <CardHeader title={t("rsk.2DotcenaAktivaAProcesy")} />
          <div className="space-y-5 p-5">
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("rsk.aktiva")}</div>
              <AssetPicker value={f.assets} onChange={(v) => set("assets", v)} disabled={!edit} />
            </div>
            {mod("processes") && can("processes:read") && (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("rsk.procesy")}</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {f.processIds.length === 0 && <span className="text-sm text-slate-400">{t("rsk.zadneProcesy")}</span>}
                  {f.processIds.map((id) => {
                    const p = processes.data?.find((x) => x.id === id) ?? detail?.processes.find((x) => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-xs">
                        {p ? `${p.code ? `${p.code} ` : ""}${p.name}` : "…"}
                        {edit && (
                          <button className="rounded-full p-0.5 hover:bg-slate-200" onClick={() => set("processIds", f.processIds.filter((x) => x !== id))} aria-label={t("rsk.odebrat")}>
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                {edit && (
                  <Select value="" onChange={(e) => e.target.value && set("processIds", [...f.processIds, e.target.value])}>
                    <option value="">{t("rsk.pridatProces")}</option>
                    {(processes.data ?? [])
                      .filter((p) => !f.processIds.includes(p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code ? `${p.code} ` : ""}
                          {p.name}
                        </option>
                      ))}
                  </Select>
                )}
              </div>
            )}
            {mod("vulnerabilities") && <CvePicker assets={f.assets} value={f.cveIds} onChange={(v) => set("cveIds", v)} disabled={!edit} existing={detail?.cves ?? []} />}
            {mod("controls") && can("controls:read") && (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("rsk.opatreniSnizujiciRiziko")}</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {f.controlIds.length === 0 && <span className="text-sm text-slate-400">{t("rsk.zadnaOpatreni")}</span>}
                  {f.controlIds.map((id) => {
                    const ctl = controlsList.data?.find((x) => x.id === id) ?? detail?.controls.find((x) => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-2 pr-1 text-xs">
                        <Link to="/controls/$controlId" params={{ controlId: id }} className="hover:text-brand-700">
                          {ctl ? `${ctl.code ? `${ctl.code} ` : ""}${ctl.name}` : "…"}
                        </Link>
                        {ctl && <Badge tone={ctl.status === "implemented" ? "green" : "amber"}>{t.lbl(CONTROL_LABELS.status[ctl.status as ControlStatus])}</Badge>}
                        {edit && (
                          <button className="rounded-full p-0.5 hover:bg-slate-200" onClick={() => set("controlIds", f.controlIds.filter((x) => x !== id))} aria-label={t("rsk.odebrat")}>
                            <X size={12} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                {edit && (
                  <Select value="" onChange={(e) => e.target.value && set("controlIds", [...f.controlIds, e.target.value])}>
                    <option value="">{t("rsk.pridatOpatreni")}</option>
                    {(controlsList.data ?? [])
                      .filter((x) => !f.controlIds.includes(x.id))
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code ? `${x.code} ` : ""}
                          {x.name}
                        </option>
                      ))}
                  </Select>
                )}
              </div>
            )}
          </div>
        </Card>

        {custom ? (
          <Card>
            <CardHeader title={t("rsk.3Hodnoceni")} subtitle={
                mdef
                  ? t("rsk.metodikaSkoreMax", { name: mdef.name, formula: mdef.formula, agg: mdef.areas?.length ? (mdef.areaAggregate === "weighted_sum" ? t("rsk.vazenySoucetDopaduVOblastech") : ` (${mdef.areaAggregate})`) : "", max: cur?.max ?? "" })
                  : t("rsk.metodikaSeNacita", { mk: mk })
              } />
            <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
              {detail?.outdatedScale && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {t("rsk.rizikoByloHodnocenoJinouMetodikou")}{detail.methodologyKey === BUILTIN_RISK_METHODOLOGY ? t("rsk.dleVyhlasky") : detail.methodologyKey}{t("rsk.ohodnotteHoMetodikouSpolecnostiPo")}
                </div>
              )}
              {detail?.reviewDue && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {t("rsk.posledniHodnoceniJeStarsiNez", { p: policy?.reviewMonths ?? 12 })}
                </div>
              )}
              {mdef && <FactorEditor def={mdef} value={f.factorValues} onChange={(v) => set("factorValues", v)} disabled={!edit} />}
              {cur?.level && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <RiskLevelBadge level={cur.level} score={cur.score} />
                    {levelLabel(f.factorValues) && <span className="font-medium">{levelLabel(f.factorValues)!.label}</span>}
                    {policy && (
                      <Badge tone={isAcceptable(policy, cur.level) ? "green" : "red"}>{isAcceptable(policy, cur.level) ? t("rsk.akceptovatelne2") : t("rsk.nadHraniciAkceptovatelnosti")}</Badge>
                    )}
                  </div>
                  {levelLabel(f.factorValues)?.treatment && <p className="mt-1 text-slate-600">{t("rsk.doporuceneZvladani", { treatment: levelLabel(f.factorValues)!.treatment })}</p>}
                </div>
              )}
            </fieldset>
          </Card>
        ) : (
        <Card>
          <CardHeader
            title={t("rsk.3Hodnoceni")}
            subtitle={
              three
                ? t("rsk.rizikoHodnotaAktivaHrozbaZranitelnost", { levels: levels, p: levels ** 3 })
                : t("rsk.rizikoDopadPravdepodobnostScenarePril", { levels: levels, p: levels ** 2 })
            }
          />
          <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
            {detail?.outdatedScale && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t("rsk.rizikoByloHodnocenoVeStupnici", { scaleLevels: detail.scaleLevels, levels: levels })}
              </div>
            )}
            {detail?.reviewDue && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t("rsk.posledniHodnoceniJeStarsiNez", { p: policy?.reviewMonths ?? 12 })}
              </div>
            )}
            <Field label={t("rsk.dopadHodnotaAktiva")}>
              <ScaleSelect value={f.impact} onChange={(v) => set("impact", v)} steps={sImpact} />
            </Field>
            {suggestion.data?.suggestedImpact != null && suggestion.data.suggestedImpact !== f.impact && (
              <button
                type="button"
                className="-mt-2 inline-flex items-center gap-1.5 text-xs text-brand-700 hover:underline"
                onClick={() => set("impact", suggestion.data!.suggestedImpact)}
              >
                <Lightbulb size={13} /> {t("rsk.navrhPodleHodnoceniAktivPril")}{threat ? t("rsk.slozkyOhrozeneHrozbou") : ""}: {suggestion.data.suggestedImpact} {t("rsk.pouzit")}
              </button>
            )}
            {three ? (
              <>
                <Field label={t("rsk.urovenHrozbyTabC1")}>
                  <ScaleSelect value={f.threatLevel} onChange={(v) => set("threatLevel", v)} steps={sThreat} />
                </Field>
                <Field label={t("rsk.urovenZranitelnostiTabC2")}>
                  <ScaleSelect value={f.vulnLevel} onChange={(v) => set("vulnLevel", v)} steps={sVuln} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t("rsk.pravdepodobnostScenare")}>
                  <ScaleSelect value={f.likelihood} onChange={(v) => set("likelihood", v)} steps={sLike} />
                </Field>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 text-xs text-slate-600">
                    {t("rsk.prilohaC4Odst5")}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("rsk.urovenHrozby")}>
                      <ScaleSelect value={f.threatLevel} onChange={(v) => set("threatLevel", v)} steps={sThreat} />
                    </Field>
                    <Field label={t("rsk.urovenZranitelnosti")}>
                      <ScaleSelect value={f.vulnLevel} onChange={(v) => set("vulnLevel", v)} steps={sVuln} />
                    </Field>
                  </div>
                  {f.likelihood && (!f.threatLevel || !f.vulnLevel) && <p className="mt-2 text-xs text-amber-700">{t("rsk.doplnteUrovenHrozbyIZranitelnosti")}</p>}
                </div>
              </>
            )}
            {cur?.level && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <RiskLevelBadge level={cur.level} score={cur.score} />
                  {policy && (
                    <Badge tone={isAcceptable(policy, cur.level) ? "green" : "red"}>{isAcceptable(policy, cur.level) ? t("rsk.akceptovatelne2") : t("rsk.nadHraniciAkceptovatelnosti")}</Badge>
                  )}
                </div>
                <p className="mt-1 text-slate-600">{t.lbl(RISK_LABELS.levelDesc[cur.level])}</p>
              </div>
            )}
          </fieldset>
        </Card>
        )}

        <Card>
          <CardHeader title={t("rsk.4OsetreniAZbytkoveRiziko")} subtitle={t("rsk.metodyZvladaniRizikDlePrilohy")} />
          <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("rsk.zpusobZvladani")}>
                <Select value={f.treatment ?? ""} onChange={(e) => set("treatment", (e.target.value || null) as Form["treatment"])}>
                  <option value="">—</option>
                  {TREATMENTS.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(RISK_LABELS.treatment[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("rsk.termin")}>
                <Input type="date" value={f.treatmentDue ?? ""} onChange={(e) => set("treatmentDue", e.target.value || null)} />
              </Field>
            </div>
            <Field label={t("rsk.zduvodneniPoznamkaKOsetreni")} hint={t("rsk.konkretniOpatreniPlanujteVPlanu")}>
              <Textarea rows={2} value={f.treatmentPlan ?? ""} onChange={(e) => set("treatmentPlan", e.target.value)} placeholder={t("rsk.naprDuvodAkceptaceRozhodnutiVyboru")} />
            </Field>
            <div className="text-sm font-medium text-slate-700">{t("rsk.zbytkoveRizikoPoZavedeniOpatreni")}</div>
            {!custom && detail?.residualSuggestion && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Lightbulb size={14} /> {t("rsk.navrhPodleUcinnostiNavazanychOpatreni")}{" "}
                    {detail.residualSuggestion.reduction
                      ? t(three ? "rsk.snizitZranitelnost" : "rsk.snizitZranitelnostAPravdepodobnost", { n: detail.residualSuggestion.reduction })
                      : t("rsk.zadneOpatreniNeniZavedeneA")}
                  </span>
                  {edit && detail.residualSuggestion.reduction > 0 && (
                    <Button
                      variant="secondary"
                      className="px-2 py-1 text-xs"
                      onClick={() =>
                        setF((x) => ({
                          ...x,
                          residualImpact: detail.residualSuggestion!.impact,
                          residualThreatLevel: detail.residualSuggestion!.threatLevel,
                          residualVulnLevel: detail.residualSuggestion!.vulnLevel,
                          residualLikelihood: detail.residualSuggestion!.likelihood,
                        }))
                      }
                    >
                      {t("rsk.pouzitNavrh")}
                    </Button>
                  )}
                </div>
                <ul className="mt-1 list-disc pl-5 text-xs text-blue-800">
                  {detail.residualSuggestion.basis.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
            {custom ? (
              mdef && <FactorEditor def={mdef} value={f.residualFactorValues} onChange={(v) => set("residualFactorValues", v)} disabled={!edit} compact />
            ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("rsk.dopad2")}>
                <ScaleSelect value={f.residualImpact} onChange={(v) => set("residualImpact", v)} steps={sImpact} />
              </Field>
              {three ? (
                <>
                  <Field label={t("rsk.hrozba")}>
                    <ScaleSelect value={f.residualThreatLevel} onChange={(v) => set("residualThreatLevel", v)} steps={sThreat} />
                  </Field>
                  <Field label={t("rsk.zranitelnost")}>
                    <ScaleSelect value={f.residualVulnLevel} onChange={(v) => set("residualVulnLevel", v)} steps={sVuln} />
                  </Field>
                </>
              ) : (
                <Field label={t("rsk.pravdepodobnost2")}>
                  <ScaleSelect value={f.residualLikelihood} onChange={(v) => set("residualLikelihood", v)} steps={sLike} />
                </Field>
              )}
            </div>
            )}
            {res?.level && (
              <div className="flex items-center gap-3 text-sm">
                {t("rsk.zbytkoveRiziko")} <RiskLevelBadge level={res.level} score={res.score} />
                {levelLabel(f.residualFactorValues) && <span className="font-medium">{levelLabel(f.residualFactorValues)!.label}</span>}
                {policy && !isAcceptable(policy, res.level) && <Badge tone="amber">{t("rsk.staleNadHraniciAkceptovatelnosti")}</Badge>}
              </div>
            )}
          </fieldset>
        </Card>

        {policy && (
          <QuantCard
            riskId={detail?.id ?? ""}
            value={f.quant}
            onChange={(v) => set("quant", v)}
            policy={policy.quant}
            actionsCost={(detail?.actions ?? []).filter((a) => a.status !== "cancelled").reduce((n, a) => n + (a.costEstimate ?? 0), 0)}
            edit={edit}
          />
        )}

        </>
        )}
        {detail && tab === "treatment" && <TreatmentPlanCard risk={detail} />}
        {detail && tab === "treatment" && <PlanSuggestionsCard risk={detail} />}
        {detail && tab === "links" && <LinkedRecordsCard target="risk" id={detail.id} />}
        {detail && tab === "links" && <LinkedDocsCard kind="risk" id={detail.id} />}
        {detail && tab === "tasks" && <TasksCard kind="risk" id={detail.id} />}
        {detail && tab === "links" && <SimilarRecordsCard kind="risk" id={detail.id} />}
        {detail && tab === "links" && mod("soc") && can("soc:read") && <RiskSocSignalsCard riskId={detail.id} />}
        {detail && tab === "treatment" && (
          <AiSuggestPanel
            useCase="risk_treatment"
            entityId={detail.id}
            canApply={detail.canEdit}
            onApplied={() => {
              qc.invalidateQueries({ queryKey: ["risk", detail.id] });
              qc.invalidateQueries({ queryKey: ["risks"] });
            }}
          />
        )}
      </div>
    </>
  );
}

function CatalogSelect({ label, items, value, onChange }: { label: string; items: CatalogItemDto[]; value: string | null; onChange: (v: string | null) => void }) {
  const t = useT();
  const groups = [...new Set(items.map((i) => i.category ?? t("rsk.ostatni")))];
  return (
    <Field label={label}>
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t("rsk.nevybrano")}</option>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {items
              .filter((i) => (i.category ?? t("rsk.ostatni")) === g)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code ? `${i.code} – ` : ""}
                  {i.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    </Field>
  );
}

/** Další hrozby / zranitelnosti scénáře (ADR-085): štítky + výběr pro přidání. */
function CatalogMulti({ label, items, primary, value, onChange, testId }: { label: string; items: CatalogItemDto[]; primary: string | null; value: string[]; onChange: (v: string[]) => void; testId: string }) {
  const t = useT();
  const name = (i: CatalogItemDto) => `${i.code ? `${i.code} – ` : ""}${i.name}`;
  const free = items.filter((i) => i.id !== primary && !value.includes(i.id));
  const groups = [...new Set(free.map((i) => i.category ?? t("rsk.ostatni")))];
  return (
    <div className="-mt-2" data-testid={testId}>
      <div className="mb-1 text-xs font-medium text-slate-600">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => {
          const i = items.find((x) => x.id === id);
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {i ? name(i) : id}
              <button type="button" aria-label={t("rsk.removeScenarioItem")} className="text-slate-400 hover:text-red-600" onClick={() => onChange(value.filter((x) => x !== id))}>
                <X size={12} />
              </button>
            </span>
          );
        })}
        <Select className="w-auto py-1 text-xs" value="" aria-label={label} disabled={!primary && !value.length && !items.length} onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">{t("rsk.addScenarioItem")}</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {free
                .filter((i) => (i.category ?? t("rsk.ostatni")) === g)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {name(i)}
                  </option>
                ))}
            </optgroup>
          ))}
        </Select>
      </div>
    </div>
  );
}

/** Výběr konkrétních CVE (otevřené zranitelnosti vybraných aktiv), které riziko podkládají. */
function CvePicker({
  assets,
  value,
  onChange,
  disabled,
  existing,
}: {
  assets: PickedAsset[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  existing: RiskDetail["cves"];
}) {
  const t = useT();
  const results = useQueries({
    queries: assets.slice(0, 10).map((a) => ({
      queryKey: ["vulns", "risk-picker", a.id],
      queryFn: () => api.vulns.list({ assetId: a.id, status: "open", limit: 50 }),
    })),
  });
  const options = results.flatMap((r) => r.data?.items ?? []);
  const known = new Map(existing.map((c) => [c.id, c]));
  const [showAll, setShowAll] = useState(false);
  const [showLinked, setShowLinked] = useState(false);
  useEffect(() => setShowAll(false), [assets.length]);
  if (!assets.length && !existing.length) return null;
  const sorted = [...options].sort((a, b) => (b.cvssScore ?? 0) - (a.cvssScore ?? 0));
  const visible = showAll ? sorted : sorted.slice(0, 8);
  const outsideAll = value.filter((id) => !options.some((o) => o.id === id));
  // riziko může mít navázané tisíce CVE (riziko ze zranitelností aktiva) – zobrazit jen prvních 10
  const selectedOutside = showLinked ? outsideAll : outsideAll.slice(0, 10);
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-slate-700">{t("rsk.zranitelnostiCvePodkladajiciRiziko")}</div>
      {selectedOutside.map((id) => {
        const c = known.get(id);
        return (
          <Checkbox
            key={id}
            checked
            disabled={disabled}
            onChange={() => onChange(value.filter((x) => x !== id))}
            label={
              <span className="inline-flex items-center gap-2">
                <span className="font-mono text-xs">{c?.cveId ?? id}</span> {c && <SeverityBadge severity={c.severity as Severity} />}
                <span className="text-xs text-slate-500">{c?.assetName}</span>
              </span>
            }
          />
        );
      })}
      {outsideAll.length > 10 && (
        <button type="button" className="mb-2 text-xs text-brand-700 hover:underline" onClick={() => setShowLinked(!showLinked)}>
          {showLinked ? t("rsk.zobrazitMene") : t("rsk.vs.linkedMore", { n: outsideAll.length - 10 })}
        </button>
      )}
      {options.length === 0 ? (
        <p className="text-sm text-slate-400">{t("rsk.vybranaAktivaNemajiOtevreneZranitelnosti")}</p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((v) => (
            <Checkbox
              key={v.id}
              disabled={disabled}
              checked={value.includes(v.id)}
              onChange={(on) => onChange(toggle(value, v.id, on))}
              label={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{v.cveId}</span>
                  <SeverityBadge severity={v.severity} />
                  <span className="text-xs text-slate-500">
                    {v.packageName} {v.packageVersion} · {assets.find((a) => a.id === v.assetId)?.name}
                  </span>
                </span>
              }
            />
          ))}
          {sorted.length > 8 && (
            <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setShowAll(!showAll)}>
              {showAll ? t("rsk.zobrazitMene") : t("rsk.zobrazitVsech", { length: sorted.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
