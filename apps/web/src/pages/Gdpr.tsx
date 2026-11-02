import { useFormGuard } from "@/lib/unsaved";
import { askConfirm } from "@/components/ui/overlay";
import { TasksCard } from "@/components/tasks";
import { useT } from "@/lib/i18n";
import { CompanyCell, TargetCompanyField, useGroupView, useTargetCompany } from "@/components/company";
import { AssetPicker, IdMultiSelect, PositionSelect, type PickedAsset } from "@/components/pickers";
import { TransferButton } from "@/components/transfer";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { fmtDay } from "@/lib/utils";
import {
  ACTIVITY_STATUSES,
  DPIA_CRITERIA,
  GDPR_LABELS,
  LEGAL_BASES,
  PROCESSING_ROLES,
  dpiaLevel,
  dpiaRequired,
  type ActivityStatus,
  type DpiaCriterion,
  type DpiaDto,
  type DpiaRisk,
  type LegalBasis,
  type ProcessingActivityDto,
  type ProcessingActivityInput,
  type ProcessingRole,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, FileDown, Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";

const statusTone: Record<ActivityStatus, Tone> = { draft: "amber", active: "green", retired: "slate" };
const levelTone = { low: "green", medium: "amber", high: "red" } as const;
const LEVEL_TEXT = { low: "nízké", medium: "střední", high: "vysoké" } as const;

/* ============================ seznam ============================ */

export function GdprPage() {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const nav = useNavigate();
  const [status, setStatus] = useState<"all" | ActivityStatus>("all");
  const q = useQuery({ queryKey: ["gdpr", status], queryFn: () => api.gdpr.list(status) });
  const rows = q.data ?? [];
  const missingDpia = rows.filter((a) => a.dpiaRequired && a.dpia?.status !== "completed").length;
  const withGaps = rows.filter((a) => a.gaps.length).length;
  return (
    <>
      <PageHeader
        title={t("gdpr.ochranaOsobnichUdaju")}
        subtitle={t("gdpr.zaznamyOCinnostechZpracovaniCl")}
        actions={
          <>
            {!group && (
              <>
                <a href={api.gdpr.ropaHtmlUrl()} target="_blank" rel="noreferrer">
                  <Button variant="secondary">
                    <Printer size={16} /> {t("gdpr.zaznamyCl30")}
                  </Button>
                </a>
                <a href={api.gdpr.ropaDocxUrl()}>
                  <Button variant="secondary">
                    <FileDown size={16} /> {t("gdpr.word")}
                  </Button>
                </a>
              </>
            )}
            {can("gdpr:write") && (
              <Button onClick={() => nav({ to: "/gdpr/new" })}>
                <Plus size={16} /> {t("gdpr.novaCinnost")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={q.error} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">{t("gdpr.vsechnyStavy")}</option>
          {ACTIVITY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(GDPR_LABELS.status[s])}
            </option>
          ))}
        </Select>
        {missingDpia > 0 && (
          <span className="inline-flex items-center gap-1 text-sm text-red-700">
            <AlertTriangle size={14} /> {t("gdpr.dpiaChybiU")} {missingDpia} {t("gdpr.cinnosti")}
          </span>
        )}
        {withGaps > 0 && <span className="text-sm text-amber-800">{t("gdpr.neuplneZaznamy", { withGaps: withGaps })}</span>}
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState>{q.isLoading ? t("common.loading") : t("gdpr.zatimZadnaCinnostZpracovani")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("gdpr.cinnostZpracovani")}</th>
                <th className="px-3 py-2">{t("gdpr.pravniZaklad")}</th>
                <th className="px-3 py-2">{t("gdpr.subjektyUdaje")}</th>
                <th className="px-3 py-2">{t("gdpr.dpia")}</th>
                <th className="px-3 py-2">{t("gdpr.prezkum")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link to="/gdpr/$activityId" params={{ activityId: a.id }} className="font-medium hover:text-brand-700">
                      {a.code && <span className="mr-1.5 text-slate-500">{a.code}</span>}
                      {a.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <Badge tone={statusTone[a.status]}>{t.lbl(GDPR_LABELS.status[a.status])}</Badge>
                      {t.lbl(GDPR_LABELS.role[a.role])}
                      {a.gaps.length > 0 && <span className="text-amber-800">{t("gdpr.mezery", { length: a.gaps.length })}</span>}
                    </div>
                    {group && <CompanyCell id={a.companyId} />}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{a.legalBasis ? t.lbl(GDPR_LABELS.legalBasis[a.legalBasis]).split(" – ")[0] : "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {a.dataSubjects.join(", ") || "—"}
                    {a.specialCategories.length > 0 && <div className="text-red-700">{t("gdpr.zvlastniKategorie")}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    {a.dpia?.status === "completed" ? (
                      <Badge tone="green">{t("gdpr.dokonceno")}</Badge>
                    ) : a.dpiaRequired ? (
                      <Badge tone="red">{a.dpia ? t.lbl(GDPR_LABELS.dpiaStatus[a.dpia.status]) : t("gdpr.chybi")}</Badge>
                    ) : (
                      <span className="text-xs text-slate-500">{t("gdpr.nevyzadovano")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{a.nextReview ? fmtDay(a.nextReview) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

/* ============================ detail ============================ */

export function GdprNewPage() {
  return <ActivityEditor a={null} />;
}

export function GdprDetailPage() {
  const { activityId } = useParams({ strict: false }) as { activityId: string };
  const q = useQuery({ queryKey: ["gdpr", "detail", activityId], queryFn: () => api.gdpr.get(activityId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <ActivityEditor key={q.data.id + q.data.updatedAt} a={q.data} />;
}

const splitList = (v: string) =>
  v
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

function ActivityEditor({ a }: { a: ProcessingActivityDto | null }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const target = useTargetCompany();
  const edit = a ? a.canEdit : can("gdpr:write");
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.suppliers.list({ withGroup: "1" }), enabled: mod("suppliers") && can("suppliers:read") });
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });
  const [f, setF] = useState({
    code: a?.code ?? "",
    name: a?.name ?? "",
    status: (a?.status ?? "draft") as ActivityStatus,
    role: (a?.role ?? "controller") as ProcessingRole,
    purpose: a?.purpose ?? "",
    legalBasis: (a?.legalBasis ?? "") as LegalBasis | "",
    legalBasisNote: a?.legalBasisNote ?? "",
    dataSubjects: (a?.dataSubjects ?? []).join(", "),
    dataCategories: (a?.dataCategories ?? []).join(", "),
    specialCategories: (a?.specialCategories ?? []).join(", "),
    recipients: a?.recipients ?? "",
    thirdCountryTransfers: a?.thirdCountryTransfers ?? "",
    retention: a?.retention ?? "",
    securityMeasures: a?.securityMeasures ?? "",
    ownerPositionId: a?.ownerPositionId ?? null,
    processIds: a?.processes.map((x) => x.id) ?? [],
    assets: (a?.assets ?? []) as PickedAsset[],
    supplierIds: a?.suppliers.map((x) => x.id) ?? [],
    controlIds: a?.controls.map((x) => x.id) ?? [],
    dpiaCriteria: (a?.dpiaCriteria ?? []) as DpiaCriterion[],
    reviewMonths: a?.reviewMonths ?? 12,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = (): ProcessingActivityInput => ({
    ...(a ? {} : { companyId: target.companyId }),
    code: f.code || null,
    name: f.name,
    status: f.status,
    role: f.role,
    purpose: f.purpose,
    legalBasis: f.legalBasis || null,
    legalBasisNote: f.legalBasisNote || null,
    dataSubjects: splitList(f.dataSubjects),
    dataCategories: splitList(f.dataCategories),
    specialCategories: splitList(f.specialCategories),
    recipients: f.recipients || null,
    thirdCountryTransfers: f.thirdCountryTransfers || null,
    retention: f.retention || null,
    securityMeasures: f.securityMeasures || null,
    ownerPositionId: f.ownerPositionId,
    processIds: f.processIds,
    assetIds: f.assets.map((x) => x.id),
    supplierIds: f.supplierIds,
    controlIds: f.controlIds,
    dpiaCriteria: f.dpiaCriteria,
    reviewMonths: f.reviewMonths,
  });
  const save = useMutation({
    mutationFn: () => (a ? api.gdpr.update(a.id, body()) : api.gdpr.create(body())),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["gdpr"] });
      qc.setQueryData(["gdpr", "detail", d.id], d);
      if (!a) nav({ to: "/gdpr/$activityId", params: { activityId: d.id } });
    },
  });
  const guard = useFormGuard(save);
  const review = useMutation({ mutationFn: () => api.gdpr.review(a!.id), onSuccess: (d) => qc.setQueryData(["gdpr", "detail", d.id], d) });
  const del = useMutation({
    mutationFn: () => api.gdpr.remove(a!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gdpr"] });
      nav({ to: "/gdpr" });
    },
  });
  const dr = dpiaRequired(f.dpiaCriteria);
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/gdpr" className="hover:text-brand-700">
          {t("gdpr.ochranaOsobnichUdaju")}
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a ? `${a.code ? `${a.code} ` : ""}${a.name}` : t("gdpr.novaCinnostZpracovani")}</h1>
          {a && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Badge tone={statusTone[a.status]}>{t.lbl(GDPR_LABELS.status[a.status])}</Badge>
              <span>{t.lbl(GDPR_LABELS.role[a.role])}</span>
              <span>{t("gdpr.odpovida", { p: a.ownerPositionName ?? "—" })}</span>
              <span>
                {t("gdpr.prezkumDalsi", { p: a.lastReviewedAt ? fmtDay(a.lastReviewedAt) : "dosud ne", p2: a.nextReview ? fmtDay(a.nextReview) : "—" })}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {a && can("gdpr:write") && <TransferButton entity="processing" id={a.id} companyId={a.companyId} />}
          {a && edit && (
            <Button variant="secondary" disabled={review.isPending} onClick={() => review.mutate()}>
              <CheckCircle2 size={15} /> {t("gdpr.potvrditPrezkum")}
            </Button>
          )}
          {a && can("gdpr:write") && (
            <Button variant="danger" onClick={async () => (await askConfirm(t("gdpr.smazatZaznamOCinnostiZpracovani"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          )}
          {edit && (
            <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {a ? t("gdpr.ulozit") : t("common.create")}
            </Button>
          )}
        </div>
      </div>
      {save.isSuccess && a && <SuccessBox>{t("gdpr.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? review.error ?? del.error} />
      {a && a.gaps.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/50 p-4">
          <div className="mb-1 text-sm font-medium text-amber-900">{t("gdpr.chybiNalezitostiZaznamu")}</div>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {a.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("gdpr.zaznamOCinnostiZpracovani")} subtitle={t("gdpr.nalezitostiDleCl30Odst")} />
          <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
            {!a && <TargetCompanyField value={target.companyId} onChange={target.setCompanyId} />}
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("gdpr.kod")}>
                <Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder={t("gdpr.zp01")} />
              </Field>
              <Field label={t("gdpr.nazevCinnosti")}>
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("gdpr.naprPersonalniAMzdovaAgenda")} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("gdpr.stav")}>
                <Select value={f.status} onChange={(e) => set("status", e.target.value as ActivityStatus)}>
                  {ACTIVITY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t.lbl(GDPR_LABELS.status[s])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("gdpr.roleOrganizace")}>
                <Select value={f.role} onChange={(e) => set("role", e.target.value as ProcessingRole)}>
                  {PROCESSING_ROLES.map((s) => (
                    <option key={s} value={s}>
                      {t.lbl(GDPR_LABELS.role[s])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("gdpr.bUcelZpracovani")}>
              <Textarea rows={2} value={f.purpose} onChange={(e) => set("purpose", e.target.value)} />
            </Field>
            <Field label={t("gdpr.pravniZakladCl6")}>
              <Select value={f.legalBasis} onChange={(e) => set("legalBasis", e.target.value as LegalBasis | "")}>
                <option value="">{t("gdpr.vyberte")}</option>
                {LEGAL_BASES.map((s) => (
                  <option key={s} value={s}>
                    {t.lbl(GDPR_LABELS.legalBasis[s])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("gdpr.upresneniPravnihoZakladu")} hint={t("gdpr.konkretniZakonSmlouvaTestProporcionality")}>
              <Input value={f.legalBasisNote} onChange={(e) => set("legalBasisNote", e.target.value)} />
            </Field>
            <Field label={t("gdpr.cKategorieSubjektuUdaju")} hint={t("gdpr.oddelteCarkouNaprZamestnanciUchazeci")}>
              <Input value={f.dataSubjects} onChange={(e) => set("dataSubjects", e.target.value)} />
            </Field>
            <Field label={t("gdpr.cKategorieOsobnichUdaju")} hint={t("gdpr.naprIdentifikacniKontaktniMzdoveUdaje")}>
              <Input value={f.dataCategories} onChange={(e) => set("dataCategories", e.target.value)} />
            </Field>
            <Field label={t("gdpr.zvlastniKategorieCl9A")} hint={t("gdpr.naprUdajeOZdraviPrazdne")}>
              <Input value={f.specialCategories} onChange={(e) => set("specialCategories", e.target.value)} />
            </Field>
            <Field label={t("gdpr.dKategoriePrijemcu")}>
              <Textarea rows={2} value={f.recipients} onChange={(e) => set("recipients", e.target.value)} />
            </Field>
            <Field label={t("gdpr.ePredaniDoTretichZemi")}>
              <Textarea rows={2} value={f.thirdCountryTransfers} onChange={(e) => set("thirdCountryTransfers", e.target.value)} placeholder={t("gdpr.nedochaziZemeMechanismusRozhodnutiO")} />
            </Field>
            <Field label={t("gdpr.fLhutyProVymaz")}>
              <Input value={f.retention} onChange={(e) => set("retention", e.target.value)} />
            </Field>
            <Field label={t("gdpr.gTechnickaAOrganizacniOpatreni")} hint={t("gdpr.popisKonkretniOpatreniZKatalogu")}>
              <Textarea rows={3} value={f.securityMeasures} onChange={(e) => set("securityMeasures", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("gdpr.odpovednostFunkcniMisto")}>
                <PositionSelect value={f.ownerPositionId} onChange={(v) => set("ownerPositionId", v)} disabled={!can("gdpr:write")} />
              </Field>
              <Field label={t("gdpr.prezkumKazdychMesicu")}>
                <Input type="number" min={1} max={60} value={f.reviewMonths} onChange={(e) => set("reviewMonths", Number(e.target.value) || 12)} />
              </Field>
            </div>
          </fieldset>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("gdpr.vazby")} subtitle={t("gdpr.kdeZpracovaniProbihaAKdo")} />
            <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5">
              {mod("processes") && (
                <Field label={t("gdpr.procesy")}>
                  <IdMultiSelect
                    linkKind="process"
                    value={f.processIds}
                    onChange={(v) => set("processIds", v)}
                    options={(processes.data ?? []).map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
                    known={a?.processes.map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
                  />
                </Field>
              )}
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("gdpr.aktivaInformacniSystemyUlozisteEvidence")}</div>
                <AssetPicker value={f.assets} onChange={(v) => set("assets", v)} disabled={!edit} />
              </div>
              {mod("suppliers") && (
                <Field label={t("gdpr.zpracovateleDodavateleCl28")}>
                  <IdMultiSelect
                    linkKind="supplier"
                    value={f.supplierIds}
                    onChange={(v) => set("supplierIds", v)}
                    options={(suppliers.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
                    known={a?.suppliers.map((s) => ({ id: s.id, label: s.name }))}
                  />
                </Field>
              )}
              {mod("controls") && (
                <Field label={t("gdpr.bezpecnostniOpatreniZKataloguCl")}>
                  <IdMultiSelect
                    linkKind="control"
                    value={f.controlIds}
                    onChange={(v) => set("controlIds", v)}
                    options={(controls.data ?? []).map((c) => ({ id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.name}` }))}
                    known={a?.controls.map((c) => ({ id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.name}` }))}
                  />
                </Field>
              )}
            </fieldset>
          </Card>

          <Card>
            <CardHeader title={t("gdpr.potrebaPosouzeniVlivuDpia")} subtitle={t("gdpr.kriteriaDlePokynuEdpbWp248")} />
            <fieldset disabled={!edit} {...guard.bind} className="space-y-1.5 p-5">
              {DPIA_CRITERIA.map((k) => (
                <Checkbox key={k} checked={f.dpiaCriteria.includes(k)} onChange={(v) => set("dpiaCriteria", v ? [...f.dpiaCriteria, k] : f.dpiaCriteria.filter((x) => x !== k))} label={t.lbl(GDPR_LABELS.criteria[k])} />
              ))}
              <p className={`pt-2 text-sm font-medium ${dr.required ? "text-red-700" : "text-slate-600"}`}>
                {t("gdpr.splnenoKriterii")} {dr.count} – {dr.required ? t("gdpr.dpiaJeZpravidlaNutne") : t("gdpr.dpiaZpravidlaNeniNutneZduvodnete")}
              </p>
            </fieldset>
          </Card>
        </div>
      </div>

      {a && (a.dpiaRequired || a.dpia) && <DpiaCard a={a} />}
      {a && <TasksCard kind="processing" id={a.id} className="mt-6" />}
    </>
  );
}

/* ============================ DPIA ============================ */

function DpiaCard({ a }: { a: ProcessingActivityDto }) {
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["gdpr", "dpia", a.id], queryFn: () => api.gdpr.dpia(a.id) });
  if (q.isLoading) return null;
  return <DpiaForm key={q.data?.updatedAt ?? "new"} a={a} d={q.data ?? null} canApprove={can("gdpr:write")} onSaved={(d) => {
    qc.setQueryData(["gdpr", "dpia", a.id], d);
    qc.invalidateQueries({ queryKey: ["gdpr", "detail", a.id] });
    qc.invalidateQueries({ queryKey: ["gdpr", "all"], exact: true });
  }} />;
}

const emptyRisk = (): DpiaRisk => ({ description: "", likelihood: 2, severity: 2, measures: "", residualLikelihood: null, residualSeverity: null });

function DpiaForm({ a, d, canApprove, onSaved }: { a: ProcessingActivityDto; d: DpiaDto | null; canApprove: boolean; onSaved: (d: DpiaDto) => void }) {
  const t = useT();
  const locked = !!d?.approvedAt;
  const edit = a.canEdit && !locked;
  const [f, setF] = useState({
    description: d?.description ?? "",
    necessity: d?.necessity ?? "",
    risks: d?.risks ?? [],
    dpoOpinion: d?.dpoOpinion ?? "",
    conclusion: d?.conclusion ?? "",
    priorConsultation: d?.priorConsultation ?? false,
    nextReview: d?.nextReview ?? "",
  });
  const setRisk = (i: number, r: Partial<DpiaRisk>) => setF((x) => ({ ...x, risks: x.risks.map((y, j) => (j === i ? { ...y, ...r } : y)) }));
  const save = useMutation({
    mutationFn: (status?: "in_progress") =>
      api.gdpr.saveDpia(a.id, {
        ...(status ? { status } : d ? {} : { status: "draft" }),
        ...(locked ? {} : { description: f.description || null, necessity: f.necessity || null, risks: f.risks.filter((r) => r.description.trim()), dpoOpinion: f.dpoOpinion || null, conclusion: f.conclusion || null, priorConsultation: f.priorConsultation, nextReview: f.nextReview || null }),
      }),
    onSuccess: onSaved,
  });
  const guard = useFormGuard(save);
  const approve = useMutation({ mutationFn: () => api.gdpr.approveDpia(a.id), onSuccess: onSaved });
  const score = (l: number, s: number) => {
    const lv = dpiaLevel(l, s);
    return <Badge tone={levelTone[lv]}>{l * s} – {t.lbl(LEVEL_TEXT[lv])}</Badge>;
  };
  const sel = (v: number, on: (n: number) => void) => (
    <Select className="w-16 py-1 text-xs" value={v} onChange={(e) => on(Number(e.target.value))}>
      {[1, 2, 3, 4].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </Select>
  );
  return (
    <Card className="mt-6">
      <CardHeader
        title={t("gdpr.posouzeniVlivuNaOchranuOsobnich")}
        subtitle={
          d
            ? `${t.lbl(GDPR_LABELS.dpiaStatus[d.status])}${d.approvedAt ? (" " + t("gdpr.schvalilADalsiPrezkum", { p: d.approvedByName ?? "?", p2: fmtDay(d.approvedAt), p3: d.nextReview ? fmtDay(d.nextReview) : "—" })) : ""}`
            : t("gdpr.cl35Odst7Popis")
        }
        action={
          <div className="flex gap-2">
            {locked && a.canEdit && (
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={async () => (await askConfirm(t("gdpr.vratitDpiaDoZpracovaniSchvaleni"))) && save.mutate("in_progress")}>
                {t("gdpr.upravitZrusitSchvaleni")}
              </Button>
            )}
            {edit && (
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
                {t("gdpr.ulozitDpia")}
              </Button>
            )}
            {d && !locked && canApprove && (
              <Button className="px-2.5 py-1.5 text-xs" disabled={approve.isPending} onClick={() => approve.mutate()}>
                <CheckCircle2 size={13} /> {t("gdpr.schvalit")}
              </Button>
            )}
          </div>
        }
      />
      <ErrorBox error={save.error ?? approve.error} />
      <fieldset disabled={!edit} {...guard.bind} className="grid gap-4 p-5 lg:grid-cols-2">
        <Field label={t("gdpr.aSystematickyPopisZpracovaniA")}>
          <Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label={t("gdpr.bNezbytnostAPrimerenost")}>
          <Textarea rows={4} value={f.necessity} onChange={(e) => setF({ ...f, necessity: e.target.value })} />
        </Field>
        <div className="lg:col-span-2">
          <div className="mb-2 text-sm font-medium text-slate-700">{t("gdpr.cDRizikaProPrava")}</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">{t("gdpr.riziko")}</th>
                <th className="py-1">P</th>
                <th className="py-1">Z</th>
                <th className="py-1">{t("gdpr.uroven")}</th>
                <th className="py-1">{t("gdpr.opatreni")}</th>
                <th className="py-1">{t("gdpr.pPo")}</th>
                <th className="py-1">{t("gdpr.zPo")}</th>
                <th className="py-1">{t("gdpr.zbytkove")}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {f.risks.map((r, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-2">
                    <Textarea rows={2} className="text-xs" value={r.description} onChange={(e) => setRisk(i, { description: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-1">{sel(r.likelihood, (n) => setRisk(i, { likelihood: n }))}</td>
                  <td className="py-1.5 pr-1">{sel(r.severity, (n) => setRisk(i, { severity: n }))}</td>
                  <td className="py-1.5 pr-2">{score(r.likelihood, r.severity)}</td>
                  <td className="py-1.5 pr-2">
                    <Textarea rows={2} className="text-xs" value={r.measures} onChange={(e) => setRisk(i, { measures: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-1">{sel(r.residualLikelihood ?? r.likelihood, (n) => setRisk(i, { residualLikelihood: n }))}</td>
                  <td className="py-1.5 pr-1">{sel(r.residualSeverity ?? r.severity, (n) => setRisk(i, { residualSeverity: n }))}</td>
                  <td className="py-1.5 pr-2">{score(r.residualLikelihood ?? r.likelihood, r.residualSeverity ?? r.severity)}</td>
                  <td className="py-1.5">
                    {edit && (
                      <button className="text-slate-400 hover:text-red-700" onClick={() => setF({ ...f, risks: f.risks.filter((_, j) => j !== i) })} title={t("gdpr.odebrat")}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {edit && (
            <Button variant="secondary" className="mt-2 px-2.5 py-1.5 text-xs" onClick={() => setF({ ...f, risks: [...f.risks, emptyRisk()] })}>
              <Plus size={13} /> {t("gdpr.riziko")}
            </Button>
          )}
        </div>
        <Field label={t("gdpr.stanoviskoPoverenceCl35Odst")}>
          <Textarea rows={3} value={f.dpoOpinion} onChange={(e) => setF({ ...f, dpoOpinion: e.target.value })} />
        </Field>
        <Field label={t("gdpr.zaverARozhodnutiSpravce")}>
          <Textarea rows={3} value={f.conclusion} onChange={(e) => setF({ ...f, conclusion: e.target.value })} />
        </Field>
        <Checkbox
          checked={f.priorConsultation}
          onChange={(v) => setF({ ...f, priorConsultation: v })}
          label={t("gdpr.vyzadujePredchoziKonzultaciSUoou")}
          hint={t("gdpr.pokudIPoOpatrenichZustava")}
        />
        <Field label={t("gdpr.dalsiPrezkumDpia")}>
          <Input type="date" value={f.nextReview} onChange={(e) => setF({ ...f, nextReview: e.target.value })} />
        </Field>
      </fieldset>
      {d?.maxResidual != null && d.maxResidual >= 12 && !d.priorConsultation && (
        <p className="border-t border-slate-100 px-5 py-3 text-sm text-red-700">
          <AlertTriangle size={14} className="mr-1 inline" /> {t("gdpr.zbytkoveRizikoZustavaVysokeZvazte")}
        </p>
      )}
    </Card>
  );
}
