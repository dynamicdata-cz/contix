import { useFormGuard } from "@/lib/unsaved";
import { Tabs, useTab } from "@/components/ui/tabs";
import { askConfirm } from "@/components/ui/overlay";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { TasksCard } from "@/components/tasks";
import { SimilarRecordsCard } from "@/components/records";
import { useT, tt } from "@/lib/i18n";
import { AiSuggestPanel } from "@/components/ai";
import { TransferButton } from "@/components/transfer";
import { WazuhSuggestions } from "./incident/WazuhSuggestions";
import { IncidentList } from "./incident/IncidentList";
import { CompanyCell, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { AssetPicker, IdMultiSelect, PositionSelect, type PickedAsset } from "@/components/pickers";
import { IncidentReportWizard } from "@/components/incidentReport";
import { IncidentRecordButtons, IncidentSocCard, type SocDraftPick } from "@/components/incidentSoc";
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { cn, fmtDate } from "@/lib/utils";
import {
  AUTHORITY_DECISIONS,
  INCIDENT_CATEGORIES,
  INCIDENT_CAUSES,
  INCIDENT_KINDS,
  INCIDENT_LABELS,
  INCIDENT_STATUSES,
  isReportable,
  isSignificant,
  REPORT_CHANNELS,
  REPORT_RECIPIENTS,
  REPORT_TYPES,
  SIGNIFICANCE_AREAS,
  type AuthorityDecision,
  type IncidentCategory,
  type IncidentCause,
  type IncidentDeadline,
  type IncidentDetail,
  type IncidentInput,
  type IncidentKind,
  type IncidentStatus,
  type ReportChannel,
  type ReportRecipient,
  type ReportType,
  type RiskLevel,
  type TimelineEntry,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock, FileText, Plus, Send, Siren, Trash2 } from "lucide-react";
import { useState } from "react";

export const kindTone: Record<IncidentKind, Tone> = { unassessed: "amber", event: "slate", incident: "red" };
export const statusTone: Record<IncidentStatus, Tone> = { new: "amber", assessing: "blue", handling: "violet", resolved: "green", closed: "slate" };

/** ISO → hodnota pro <input type="datetime-local"> v místním čase. */
const toLocal = (v?: string | null) => {
  if (!v) return "";
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function remaining(due: string) {
  const ms = new Date(due).getTime() - Date.now();
  const h = Math.round(Math.abs(ms) / 3600_000);
  const txt = h >= 48 ? tt("inc.dni", { n: Math.round(h / 24) }) : `${h} h`;
  return ms >= 0 ? tt("inc.zbyva", { p: txt }) : tt("inc.poTerminuCas", { p: txt });
}

export function DeadlineChip({ d }: { d: IncidentDeadline | null }) {
  if (!d) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", d.state === "overdue" ? "font-medium text-red-700" : "text-amber-800")} title={`${d.label} – ${d.legal}`}>
      <Clock size={12} /> {d.label}
      {d.due && ` · ${remaining(d.due)}`}
    </span>
  );
}

/* ================= Nahlášení události (§ 14 odst. 1 písm. f) ================= */

export function IncidentReportPage() {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const nav = useNavigate();
  const [f, setF] = useState({ title: "", description: "", category: "other" as IncidentCategory, detectedAt: toLocal(new Date().toISOString()), assets: [] as PickedAsset[] });
  const save = useMutation({
    mutationFn: () =>
      api.incidents.create({
        title: f.title,
        description: f.description || null,
        category: f.category,
        detectedAt: fromLocal(f.detectedAt)!,
        assetIds: f.assets.map((a) => a.id),
      }),
    onSuccess: (d) => {
      if (can("incidents:read")) nav({ to: "/incidents/$incidentId", params: { incidentId: d.id } });
    },
  });
  return (
    <>
      <PageHeader badge={<FrameworkBadge />} title={t("inc.nahlasitBezpecnostniUdalost")} subtitle={t("inc.neobvykleChovaniSystemuPodezrelyE")} />
      {mod("soc") && (
        <p className="mb-4 text-sm text-slate-600">
          {t("phish.fromIncident")}{" "}
          <Link to="/phishing" className="font-medium text-brand-700 hover:underline">
            {t("nav.reportPhishing")}
          </Link>
        </p>
      )}
      {save.isSuccess && !can("incidents:read") ? (
        <SuccessBox>{t("inc.dekujemeHlaseniByloPredanoOdpovednym")}</SuccessBox>
      ) : (
        <Card className="max-w-3xl">
          <div className="space-y-4 p-5">
            <Field label={t("inc.coSeStaloStrucne")}>
              <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            </Field>
            <Field label={t("inc.popis")} hint={t("inc.coJstePozorovaliKdyNa")}>
              <Textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("inc.kdyJsteToZjistili")}>
                <Input type="datetime-local" value={f.detectedAt} onChange={(e) => setF({ ...f, detectedAt: e.target.value })} />
              </Field>
              <Field label={t("inc.druh")}>
                <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as IncidentCategory })}>
                  {INCIDENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t.lbl(INCIDENT_LABELS.category[c])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {can("assets:read") && (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("inc.dotcenaZarizeniSystemy")}</div>
                <AssetPicker value={f.assets} onChange={(v) => setF({ ...f, assets: v })} />
              </div>
            )}
            <ErrorBox error={save.error} />
            <div className="flex justify-end">
              <Button disabled={save.isPending || !f.title.trim() || !f.detectedAt} onClick={() => save.mutate()}>
                <Send size={15} /> {t("inc.odeslatHlaseni")}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

/* ================= Seznam ================= */

export function IncidentsPage() {
  const t = useT();
  const group = useGroupView();
  const can = useCan();
  const [tab, setTab] = useTab(["list", "wazuh"] as const, "list");
  const sugg = useQuery({ queryKey: ["alerts", "new"], queryFn: () => api.alerts.list("new"), enabled: can("incidents:read") });
  return (
    <>
      <PageHeader
        title={t("inc.udalostiAIncidenty")}
        subtitle={t("inc.14VyhlC4092025")}
        actions={
          can("incidents:report") && (
            <Link to="/incidents/report">
              <Button>
                <Siren size={16} /> {t("inc.nahlasitUdalost")}
              </Button>
            </Link>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "list" as const, label: t("inc.tab.list") },
          { key: "wazuh" as const, label: `${t("inc.navrhyZWazuh")}${sugg.data?.length ? ` (${sugg.data.length})` : ""}` },
        ]}
      />
      {tab === "wazuh" ? (
        <WazuhSuggestions />
      ) : (
        <IncidentList group={group} />
      )}
    </>
  );
}

/* ================= Detail ================= */

export function IncidentDetailPage() {
  const { incidentId } = useParams({ strict: false }) as { incidentId: string };
  const q = useQuery({ queryKey: ["incidents", "detail", incidentId], queryFn: () => api.incidents.get(incidentId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <IncidentEditor key={q.data.id} inc={q.data} />;
}

type Form = {
  code: string;
  title: string;
  description: string;
  kind: IncidentKind;
  status: IncidentStatus;
  category: IncidentCategory;
  cause: IncidentCause;
  reportedBy: string;
  ownerPositionId: string | null;
  detectedAt: string;
  occurredAt: string;
  resolvedAt: string;
  inScope: boolean;
  cyberOrigin: boolean;
  intentExcluded: boolean;
  toleranceExceeded: boolean;
  significanceAreas: Record<string, boolean>;
  significanceNote: string;
  authorityDecision: AuthorityDecision;
  suspectedUnlawful: boolean;
  crossBorder: boolean;
  personalDataBreach: boolean;
  affectedUsers: string;
  downtimeHours: string;
  financialLoss: string;
  impactDescription: string;
  indicators: string;
  evidence: string;
  containment: string;
  rootCause: string;
  lessonsLearned: string;
  timeline: TimelineEntry[];
  assets: PickedAsset[];
  processIds: string[];
  riskIds: string[];
  controlIds: string[];
  supplierIds: string[];
};

const formOf = (d: IncidentDetail): Form => ({
  code: d.code ?? "",
  title: d.title,
  description: d.description ?? "",
  kind: d.kind,
  status: d.status,
  category: d.category,
  cause: d.cause,
  reportedBy: d.reportedBy ?? "",
  ownerPositionId: d.ownerPositionId,
  detectedAt: toLocal(d.detectedAt),
  occurredAt: toLocal(d.occurredAt),
  resolvedAt: toLocal(d.resolvedAt),
  inScope: d.inScope,
  cyberOrigin: d.cyberOrigin,
  intentExcluded: d.intentExcluded,
  toleranceExceeded: d.toleranceExceeded,
  significanceAreas: d.significanceAreas,
  significanceNote: d.significanceNote ?? "",
  authorityDecision: d.authorityDecision,
  suspectedUnlawful: d.suspectedUnlawful,
  crossBorder: d.crossBorder,
  personalDataBreach: d.personalDataBreach,
  affectedUsers: d.affectedUsers == null ? "" : String(d.affectedUsers),
  downtimeHours: d.downtimeHours == null ? "" : String(d.downtimeHours),
  financialLoss: d.financialLoss == null ? "" : String(d.financialLoss),
  impactDescription: d.impactDescription ?? "",
  indicators: d.indicators ?? "",
  evidence: d.evidence ?? "",
  containment: d.containment ?? "",
  rootCause: d.rootCause ?? "",
  lessonsLearned: d.lessonsLearned ?? "",
  timeline: d.timeline,
  assets: d.assets,
  processIds: d.processes.map((x) => x.id),
  riskIds: d.risks.map((x) => x.id),
  controlIds: d.controls.map((x) => x.id),
  supplierIds: d.suppliers.map((x) => x.id),
});

function IncidentEditor({ inc }: { inc: IncidentDetail }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const admin = can("incidents:write");
  const edit = inc.canEdit;
  const [f, setF] = useState<Form>(formOf(inc));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const [reporting, setReporting] = useState<ReportType | null>(null);
  const [reportText, setReportText] = useState("");
  const [wizard, setWizard] = useState<ReportType | null>(null);
  const [note, setNote] = useState("");
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "", false], queryFn: () => api.suppliers.list(), enabled: mod("suppliers") && can("suppliers:read") });

  const nz = (v: string) => (v ? v : null);
  const num = (v: string) => (v === "" ? null : Number(v));
  const body = (): Partial<IncidentInput> => {
    const { assets, detectedAt, occurredAt, resolvedAt, affectedUsers, downtimeHours, financialLoss, ...r } = f;
    return {
      ...r,
      code: nz(r.code),
      description: nz(r.description),
      reportedBy: nz(r.reportedBy),
      significanceNote: nz(r.significanceNote),
      impactDescription: nz(r.impactDescription),
      indicators: nz(r.indicators),
      evidence: nz(r.evidence),
      containment: nz(r.containment),
      rootCause: nz(r.rootCause),
      lessonsLearned: nz(r.lessonsLearned),
      detectedAt: fromLocal(detectedAt)!,
      occurredAt: fromLocal(occurredAt),
      resolvedAt: fromLocal(resolvedAt),
      affectedUsers: num(affectedUsers),
      downtimeHours: num(downtimeHours),
      financialLoss: num(financialLoss),
      assetIds: assets.map((a) => a.id),
    };
  };
  const done = (d: IncidentDetail) => {
    qc.invalidateQueries({ queryKey: ["incidents"] });
    qc.setQueryData(["incidents", "detail", d.id], d);
    setF(formOf(d));
  };
  const save = useMutation({ mutationFn: () => api.incidents.update(inc.id, body()), onSuccess: done });
  const guard = useFormGuard(save);
  const del = useMutation({
    mutationFn: () => api.incidents.remove(inc.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      nav({ to: "/incidents" });
    },
  });
  const delReport = useMutation({ mutationFn: (rid: string) => api.incidents.deleteReport(inc.id, rid), onSuccess: done });
  const label = (x: { code: string | null; name: string }) => `${x.code ? `${x.code} ` : ""}${x.name}`;

  // živý náhled povinnosti hlásit podle rozpracovaného formuláře
  const reportable = isReportable(f, inc.regime);
  const significant = isSignificant(f);
  /** Převzetí návrhu ze SOC do formuláře – uloží se až tlačítkem Uložit. */
  const applySoc = (p: SocDraftPick) =>
    setF((x) => ({
      ...x,
      ...(p.evidence ? { evidence: p.evidence } : {}),
      ...(p.indicators ? { indicators: p.indicators } : {}),
      ...(p.containment ? { containment: p.containment } : {}),
      ...(p.occurredAt ? { occurredAt: toLocal(p.occurredAt) } : {}),
      ...(p.timeline ? { timeline: [...x.timeline, ...p.timeline].sort((a, b) => a.at.localeCompare(b.at)) } : {}),
      ...(p.assets ? { assets: [...x.assets, ...p.assets.filter((a) => !x.assets.some((y) => y.id === a.id))] } : {}),
    }));
  const addTimeline = () => {
    if (!note.trim()) return;
    set("timeline", [...f.timeline, { at: new Date().toISOString(), text: note.trim() }]);
    setNote("");
  };

  return (
    <div {...guard.bind}>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/incidents" className="hover:text-brand-700">
          {t("inc.udalostiAIncidenty")}
        </Link>
      </div>
      <PageHeader
        title={`${inc.code ? `${inc.code} ` : ""}${inc.title}`}
        subtitle={`${t("inc.zjistenoDne", { date: fmtDate(inc.detectedAt) })}${inc.reportedBy ? (" " + t("inc.nahlasilA", { reportedBy: inc.reportedBy })) : ""}${inc.createdByName ? (" " + t("inc.zalozilA", { createdByName: inc.createdByName })) : ""}`}
        actions={
          <>
            <IncidentRecordButtons incidentId={inc.id} />
            {admin && <TransferButton entity="incidents" id={inc.id} companyId={inc.companyId} />}
            {admin && (
              <Button variant="danger" onClick={async () => (await askConfirm(t("inc.smazatZaznamVcetneHlaseni"))) && del.mutate()}>
                <Trash2 size={16} />
              </Button>
            )}
            {edit && (
              <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
                {t("inc.ulozit")}
              </Button>
            )}
          </>
        }
      />
      {inc.gaps.length > 0 && (
        <div className="mb-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {inc.gaps.map((g) => (
            <div key={g} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" color={STATUS_COLORS.serious} /> {g}
            </div>
          ))}
        </div>
      )}
      {save.isSuccess && <SuccessBox>{t("inc.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error ?? delReport.error} />

      {/* ---------- lhůty hlášení ---------- */}
      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title={t("inc.hlaseniALhuty")}
          subtitle={
            inc.regime === "none"
              ? t("inc.organizaceNeniRegulovanaHlaseniJe")
              : inc.regime === "dora"
                ? t("inc.regimeDora")
                : inc.regime === "nis2"
                ? t("inc.regimeNis2")
                : t("inc.rezimPodani", { regime: inc.regime === "higher" ? t("inc.vyssichPovinnostiHlasiSeUradu") : t("inc.nizsichPovinnostiHlasiSeNarodnimu") })
          }
          action={
            <div className="flex gap-2">
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setWizard(inc.deadlines.find((d) => d.state !== "done" && d.state !== "waiting")?.type ?? "initial")}>
                <FileText size={14} /> {t("rep.prepare")}
              </Button>
              {admin && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => { setReportText(""); setReporting("initial"); }}>
                  <Send size={14} /> {t("inc.zaznamenatPodani")}
                </Button>
              )}
            </div>
          }
        />
        <div className="px-5 py-3 text-sm">
          {reportable ? (
            <span className="font-medium text-red-700">{t("inc.incidentPodlehaPovinnostiHlaseni15")}</span>
          ) : f.kind === "incident" ? (
            <span className="text-slate-600">{t("inc.podleAktualnihoPosouzeniIncidentNepodleh")}</span>
          ) : (
            <span className="text-slate-600">{t("inc.povinnostHlaseniSePosuzujeU")}</span>
          )}
          {(reportable !== inc.reportable || significant !== inc.significant) && <span className="ml-2 text-xs text-amber-700">{t("inc.neulozeneZmenyPosouzeni")}</span>}
        </div>
        {inc.deadlines.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("inc.povinnost")}</th>
                <th className="px-3 py-2">{t("inc.termin")}</th>
                <th className="px-3 py-2">{t("inc.stav")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inc.deadlines.map((d) => (
                <tr key={d.type}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{d.label}</div>
                    <div className="text-xs text-slate-500">{d.legal}</div>
                    {d.note && <div className="text-xs text-slate-500">{d.note}</div>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{d.due ? fmtDate(d.due) : "—"}</td>
                  <td className="px-3 py-2.5">
                    {d.state === "done" ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 size={13} /> {t("inc.podano")} {fmtDate(d.submittedAt)}
                      </span>
                    ) : d.state === "waiting" ? (
                      <span className="text-xs text-slate-500">{t("inc.ceka")}</span>
                    ) : (
                      <DeadlineChip d={d} />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button className="mr-3 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline" onClick={() => setWizard(d.type)}>
                      <FileText size={12} /> {t("rep.prepareShort")}
                    </button>
                    {admin && d.state !== "done" && (
                      <button className="text-xs text-brand-600 hover:underline" onClick={() => { setReportText(""); setReporting(d.type); }}>
                        {t("inc.zaznamenat")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {inc.reports.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t("inc.podanaHlaseni")}</div>
            <ul className="space-y-1 text-sm">
              {inc.reports.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <span className="flex-1">
                    {t.lbl(INCIDENT_LABELS.reportType[r.reportType])} – {t.lbl(INCIDENT_LABELS.recipient[r.recipient])}, {t.lbl(INCIDENT_LABELS.channel[r.channel])}, {fmtDate(r.submittedAt)}
                    {r.reference && <span className="text-slate-500"> {t("inc.c", { reference: r.reference })}</span>}
                    {r.createdByName && <span className="text-xs text-slate-400"> {t("inc.zapsalA", { createdByName: r.createdByName })}</span>}
                  </span>
                  {admin && (
                    <button className="text-red-700" onClick={async () => (await askConfirm(t("inc.smazatZaznamOHlaseni"))) && delReport.mutate(r.id)} aria-label={t("inc.smazatHlaseni")}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("inc.zaznam")} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("inc.kod")}>
                <Input value={f.code} disabled={!edit} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label={t("inc.nazev")}>
                <Input value={f.title} disabled={!edit} onChange={(e) => set("title", e.target.value)} />
              </Field>
            </div>
            <Field label={t("inc.popis")}>
              <Textarea rows={3} value={f.description} disabled={!edit} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("inc.klasifikace14Odst1Pism")}>
                <Select value={f.kind} disabled={!admin} onChange={(e) => set("kind", e.target.value as IncidentKind)}>
                  {INCIDENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(INCIDENT_LABELS.kind[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("inc.stav")}>
                <Select value={f.status} disabled={!edit} onChange={(e) => set("status", e.target.value as IncidentStatus)}>
                  {INCIDENT_STATUSES.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(INCIDENT_LABELS.status[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("inc.kategorie")}>
                <Select value={f.category} disabled={!edit} onChange={(e) => set("category", e.target.value as IncidentCategory)}>
                  {INCIDENT_CATEGORIES.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(INCIDENT_LABELS.category[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("inc.odpovednostZaZvladani14Odst")}>
                <PositionSelect value={f.ownerPositionId} disabled={!admin} onChange={(v) => set("ownerPositionId", v)} />
              </Field>
              <Field label={t("inc.zjisteno")} hint={t("inc.odOkamzikuZjisteniBeziLhuty")}>
                <Input type="datetime-local" value={f.detectedAt} disabled={!admin} onChange={(e) => set("detectedAt", e.target.value)} />
              </Field>
              <Field label={t("inc.vznikOdhad")}>
                <Input type="datetime-local" value={f.occurredAt} disabled={!edit} onChange={(e) => set("occurredAt", e.target.value)} />
              </Field>
              <Field label={t("inc.vyreseno")}>
                <Input type="datetime-local" value={f.resolvedAt} disabled={!edit} onChange={(e) => set("resolvedAt", e.target.value)} />
              </Field>
              <Field label={t("inc.nahlasilA2")}>
                <Input value={f.reportedBy} disabled={!edit} onChange={(e) => set("reportedBy", e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("inc.posouzeniPovinnostiHlasit")} subtitle={t("inc.15ZakonaC2642025")} />
          <div className="space-y-3 p-5">
            <Checkbox checked={f.inScope} disabled={!admin} onChange={(v) => set("inScope", v)} label={t("inc.projevilSeVeStanovenemRozsahu")} />
            <Checkbox checked={f.cyberOrigin} disabled={!admin} onChange={(v) => set("cyberOrigin", v)} label={t("inc.maPuvodVKybernetickemProstoru")} />
            <Checkbox
              checked={f.intentExcluded}
              disabled={!admin}
              onChange={(v) => set("intentExcluded", v)}
              label={t("inc.umyslneZavineniLzeDo24")}
              hint={t("inc.pokudAnoHlaseniNeniPovinne")}
            />
            {inc.regime === "higher" && (
              <Field label={t("inc.sdeleniUraduOVyznamnemDopadu")}>
                <Select value={f.authorityDecision} disabled={!admin} onChange={(e) => set("authorityDecision", e.target.value as AuthorityDecision)}>
                  {AUTHORITY_DECISIONS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(INCIDENT_LABELS.authority[k])}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="rounded-md border border-slate-200 p-3">
              <div className="mb-2 text-sm font-medium text-slate-700">{t("inc.vyznamnostDopadu")} {inc.regime === "lower" ? "(§ 14 vyhl. 410/2025)" : inc.regime === "nis2" ? t("inc.nis2Significance") : inc.regime === "dora" ? t("inc.doraSignificance") : t("inc.15Odst3Zakona")}</div>
              <Checkbox
                checked={f.toleranceExceeded}
                disabled={!edit}
                onChange={(v) => set("toleranceExceeded", v)}
                label={t("inc.prekrocenaUnosnaMiraUjmyStanovena")}
                hint={inc.tolerance ? t("inc.unosnaMiraUjmy", { tolerance: inc.tolerance }) : t("inc.unosnouMiruUjmyStanovteV")}
              />
              <div className="mt-2 space-y-1.5 pl-1">
                {SIGNIFICANCE_AREAS.map((a) => (
                  <Checkbox
                    key={a.key}
                    checked={!!f.significanceAreas[a.key]}
                    disabled={!edit}
                    onChange={(v) => set("significanceAreas", { ...f.significanceAreas, [a.key]: v })}
                    label={a.label}
                  />
                ))}
              </div>
              <div className={cn("mt-2 text-sm", significant ? "font-medium text-red-700" : "text-slate-600")}>{significant ? t("inc.dopadJeVyznamny") : t("inc.dopadNeniVyhodnocenJakoVyznamny")}</div>
              <Textarea className="mt-2" rows={2} placeholder={t("inc.oduvodneni")} value={f.significanceNote} disabled={!edit} onChange={(e) => set("significanceNote", e.target.value)} />
            </div>
            <Checkbox checked={f.suspectedUnlawful} disabled={!edit} onChange={(v) => set("suspectedUnlawful", v)} label={t("inc.domnenkaNezakonnehoZasahuUdajPrvotniho")} />
            <Checkbox checked={f.crossBorder} disabled={!edit} onChange={(v) => set("crossBorder", v)} label={t("inc.moznyPreshranicniDopadUdajPrvotniho")} />
            <Checkbox
              checked={f.personalDataBreach}
              disabled={!edit}
              onChange={(v) => set("personalDataBreach", v)}
              label={t("inc.poruseniZabezpeceniOsobnichUdaju")}
              hint={t("inc.zvazteOhlaseniUoouDo72")}
            />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("inc.dopad")} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("inc.zasazeniUzivatele")}>
                <Input type="number" min={0} value={f.affectedUsers} disabled={!edit} onChange={(e) => set("affectedUsers", e.target.value)} />
              </Field>
              <Field label={t("inc.vypadekH")}>
                <Input type="number" min={0} step="0.5" value={f.downtimeHours} disabled={!edit} onChange={(e) => set("downtimeHours", e.target.value)} />
              </Field>
              <Field label={t("inc.financniZtrataKc")}>
                <Input type="number" min={0} value={f.financialLoss} disabled={!edit} onChange={(e) => set("financialLoss", e.target.value)} />
              </Field>
            </div>
            <Field label={t("inc.popisDopadu")}>
              <Textarea rows={3} value={f.impactDescription} disabled={!edit} onChange={(e) => set("impactDescription", e.target.value)} />
            </Field>
            <Field label={t("inc.indikatoryKompromitaceIoc")} hint={t("inc.ipAdresyDomenyHasheNazvy")}>
              <Textarea rows={3} value={f.indicators} disabled={!edit} onChange={(e) => set("indicators", e.target.value)} className="font-mono text-xs" />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("inc.zvladani14Odst1")} />
          <div className="space-y-4 p-5">
            <Field label={t("inc.iOpatreniKOdvraceniA")}>
              <Textarea rows={3} value={f.containment} disabled={!edit} onChange={(e) => set("containment", e.target.value)} />
            </Field>
            <Field label={t("inc.dPodkladyProAnalyzuA")} hint={t("inc.logyImageDiskuEMaily")}>
              <Textarea rows={2} value={f.evidence} disabled={!edit} onChange={(e) => set("evidence", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
              <Field label={t("inc.primaPricina")}>
                <Select value={f.cause} disabled={!edit} onChange={(e) => set("cause", e.target.value as IncidentCause)}>
                  {INCIDENT_CAUSES.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(INCIDENT_LABELS.cause[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("inc.kProsetreniAUrceniPriciny")}>
                <Textarea rows={2} value={f.rootCause} disabled={!edit} onChange={(e) => set("rootCause", e.target.value)} />
              </Field>
            </div>
            <Field label={t("inc.nVyhodnoceniUcinnostiReseniA")} hint={t("inc.novaOpatreniNavazteNizeRizika")}>
              <Textarea rows={3} value={f.lessonsLearned} disabled={!edit} onChange={(e) => set("lessonsLearned", e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="mt-6 empty:hidden">
        <AiSuggestPanel
          useCase="incident_summary"
          entityId={inc.id}
          canApply={edit}
          onApplied={async () => {
            // přijaté texty jsou uložené – převzít je do formuláře, aby je další uložení nepřepsalo
            const fresh = await api.incidents.get(inc.id);
            qc.setQueryData(["incidents", "detail", inc.id], fresh);
            setF((x) => ({ ...x, impactDescription: fresh.impactDescription ?? "", rootCause: fresh.rootCause ?? "", lessonsLearned: fresh.lessonsLearned ?? "" }));
          }}
        />
      </div>
      <div className="mt-6 empty:hidden">
        <AiSuggestPanel
          useCase="incident_triage"
          entityId={inc.id}
          canApply={edit}
          onApplied={async () => {
            const fresh = await api.incidents.get(inc.id);
            qc.setQueryData(["incidents", "detail", inc.id], fresh);
            setF((x) => ({ ...x, kind: fresh.kind, category: fresh.category, cause: fresh.cause, suspectedUnlawful: fresh.suspectedUnlawful, personalDataBreach: fresh.personalDataBreach }));
          }}
        />
      </div>

      {mod("soc") && can("soc:read") && <IncidentSocCard incidentId={inc.id} edit={edit} onApply={applySoc} />}

      <Card className="mt-6">
        <CardHeader title={t("inc.prubehLZaznamyOZvladani")} subtitle={t("inc.casovaOsaSeUloziSpolu")} />
        <div className="p-5">
          {f.timeline.length === 0 && <div className="mb-3 text-sm text-slate-400">{t("inc.bezZaznamu")}</div>}
          <ol className="mb-3 space-y-2 border-l-2 border-slate-200 pl-4">
            {f.timeline.map((tx, i) => (
              <li key={i} className="text-sm">
                <span className="mr-2 text-xs text-slate-500">{fmtDate(tx.at)}</span>
                {tx.text}
                {edit && (
                  <button className="ml-2 text-slate-400 hover:text-red-700" onClick={() => set("timeline", f.timeline.filter((_, j) => j !== i))} aria-label={t("inc.odebrat")}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ol>
          {edit && (
            <div className="flex gap-2">
              <Input placeholder={t("inc.coSeStaloCoBylo")} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTimeline()} />
              <Button variant="secondary" onClick={addTimeline}>
                <Plus size={14} /> {t("inc.pridat")}
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title={t("inc.dotcenaAktivaAVazby")} subtitle={t("inc.incidentZohledneteVHodnoceniRizik")} />
        <div className="grid gap-6 p-5 lg:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("inc.aktiva")}</div>
            <AssetPicker value={f.assets} onChange={(v) => set("assets", v)} disabled={!edit} />
          </div>
          {mod("processes") && can("processes:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("inc.procesy")}</div>
              <IdMultiSelect
                linkKind="process"
                value={f.processIds}
                onChange={(v) => set("processIds", v)}
                disabled={!edit}
                placeholder={t("inc.pridatProces")}
                emptyLabel={t("inc.zadneProcesy")}
                options={(processes.data ?? []).map((p) => ({ id: p.id, label: label(p) }))}
                known={inc.processes.map((p) => ({ id: p.id, label: label(p) }))}
              />
            </div>
          )}
          {mod("risks") && can("risks:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("inc.rizika")}</div>
              <IdMultiSelect
                linkKind="risk"
                value={f.riskIds}
                onChange={(v) => set("riskIds", v)}
                disabled={!edit}
                placeholder={t("inc.pridatRiziko")}
                emptyLabel={t("inc.zadnaRizika")}
                options={(risks.data?.items ?? []).map((r) => ({ id: r.id, label: label(r) }))}
                known={inc.risks.map((r) => ({ id: r.id, label: label(r) }))}
              />
              {inc.risks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {inc.risks.map((r) => (
                    <Link key={r.id} to="/risks/$riskId" params={{ riskId: r.id }} className="inline-flex items-center gap-1 text-xs hover:underline">
                      {r.code ?? r.name} <RiskLevelBadge level={r.level as RiskLevel | null} score={null} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
          {mod("controls") && can("controls:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("inc.bezpecnostniOpatreni")}</div>
              <IdMultiSelect
                linkKind="control"
                value={f.controlIds}
                onChange={(v) => set("controlIds", v)}
                disabled={!edit}
                placeholder={t("inc.pridatOpatreni")}
                emptyLabel={t("inc.zadnaOpatreni")}
                options={(controls.data ?? []).map((c) => ({ id: c.id, label: label(c) }))}
                known={inc.controls.map((c) => ({ id: c.id, label: label(c) }))}
              />
            </div>
          )}
          {mod("suppliers") && can("suppliers:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("inc.dodavatele")}</div>
              <IdMultiSelect
                linkKind="supplier"
                value={f.supplierIds}
                onChange={(v) => set("supplierIds", v)}
                disabled={!edit}
                placeholder={t("inc.pridatDodavatele")}
                emptyLabel={t("inc.zadniDodavatele")}
                options={(suppliers.data ?? []).map((s) => ({ id: s.id, label: s.name }))}
                known={inc.suppliers.map((s) => ({ id: s.id, label: s.name }))}
              />
            </div>
          )}
        </div>
      </Card>
      <TasksCard kind="incident" id={inc.id} className="mt-6" />
      <SimilarRecordsCard kind="incident" id={inc.id} className="mt-6" />
      {wizard && (
        <IncidentReportWizard
          incidentId={inc.id}
          initialType={wizard}
          canRecord={admin}
          onClose={() => setWizard(null)}
          onRecord={(type, text) => {
            setWizard(null);
            setReportText(text);
            setReporting(type);
          }}
        />
      )}
      {reporting && <ReportModal inc={inc} type={reporting} summary={reportText} onClose={() => setReporting(null)} onDone={done} />}
    </div>
  );
}

function ReportModal({ inc, type, summary = "", onClose, onDone }: { inc: IncidentDetail; type: ReportType; summary?: string; onClose: () => void; onDone: (d: IncidentDetail) => void }) {
  const t = useT();
  const [f, setF] = useState({
    reportType: type,
    recipient: (type === "gdpr" ? "uoou" : inc.recipient) as ReportRecipient,
    channel: "portal" as ReportChannel,
    submittedAt: toLocal(new Date().toISOString()),
    reference: "",
    summary,
  });
  const save = useMutation({
    mutationFn: () => api.incidents.addReport(inc.id, { ...f, submittedAt: fromLocal(f.submittedAt)!, reference: f.reference || null, summary: f.summary || null }),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("inc.zaznamenatPodaneHlaseni")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("inc.ulozit")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("inc.contixHlaseniNeodesilaPodejteHo")}</p>
      <Field label={t("inc.druh")}>
        <Select
          value={f.reportType}
          onChange={(e) => {
            const tx = e.target.value as ReportType;
            setF({ ...f, reportType: tx, recipient: tx === "gdpr" ? "uoou" : inc.recipient });
          }}
        >
          {REPORT_TYPES.map((tx) => (
            <option key={tx} value={tx}>
              {t.lbl(INCIDENT_LABELS.reportType[tx])}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("inc.prijemce")}>
          <Select value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value as ReportRecipient })}>
            {REPORT_RECIPIENTS.map((tx) => (
              <option key={tx} value={tx}>
                {t.lbl(INCIDENT_LABELS.recipient[tx])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("inc.zpusob")}>
          <Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as ReportChannel })}>
            {REPORT_CHANNELS.map((tx) => (
              <option key={tx} value={tx}>
                {t.lbl(INCIDENT_LABELS.channel[tx])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("inc.podano2")}>
          <Input type="datetime-local" value={f.submittedAt} onChange={(e) => setF({ ...f, submittedAt: e.target.value })} />
        </Field>
        <Field label={t("inc.cisloHlaseniCJ")}>
          <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
      </div>
      <Field label={t("inc.poznamka")}>
        <Textarea rows={summary ? 8 : 2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
