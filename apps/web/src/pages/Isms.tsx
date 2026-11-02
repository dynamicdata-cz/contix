import { useFormGuard } from "@/lib/unsaved";
import { askConfirm } from "@/components/ui/overlay";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useProfile } from "@/lib/regime";
import { useT } from "@/lib/i18n";
import { TasksCard } from "@/components/tasks";
import { TransferButton } from "@/components/transfer";
import { CompanyCell, useGroupView } from "@/components/company";
import { DocumentVersions } from "@/components/documents";
import { STATUS_COLORS } from "@/components/health";
import { AssetPicker, IdMultiSelect, PositionSelect, type PickedAsset } from "@/components/pickers";
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { cn, fmtDay, useDebounced } from "@/lib/utils";
import { withLegalRefs, CHANGE_DECISIONS,
  CHANGE_LABELS,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  changeGaps,
  OBJECTIVE_LABELS,
  OBJECTIVE_STATUSES,
  type ChangeDecision,
  type ChangeDetail,
  type ChangeInput,
  type ChangeStatus,
  type ObjectiveDto,
  type ObjectiveInput,
  type ObjectiveStatus,
  type RiskLevel,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";

const changeTone: Record<ChangeStatus, Tone> = {
  proposed: "slate",
  assessed: "blue",
  approved: "violet",
  implemented: "amber",
  closed: "green",
  rejected: "slate",
  rolled_back: "red",
};
const objTone: Record<ObjectiveStatus, Tone> = { not_evaluated: "slate", met: "green", partially_met: "amber", not_met: "red", cancelled: "slate" };

export function IsmsTabs({ active }: { active: "review" | "changes" }) {
  const t = useT();
  const tab = (on: boolean) => cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", on ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800");
  return (
    <div className="mb-6 flex gap-2 border-b border-slate-200">
      <Link to="/isms" className={tab(active === "review")}>
        {t("isms.cileAPrezkoumani")}
      </Link>
      <Link to="/isms/changes" className={tab(active === "changes")}>
        {t("isms.rizeniZmen")}
      </Link>
    </div>
  );
}

/* ================= Cíle a přezkoumání ================= */

export function IsmsReviewPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const ov = useQuery({ queryKey: ["isms", "overview"], queryFn: api.isms.overview });
  const objs = useQuery({ queryKey: ["isms", "objectives"], queryFn: api.isms.objectives });
  const [editing, setEditing] = useState<ObjectiveDto | "new" | null>(null);
  const o = ov.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["isms"] });
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("isms.rizeniIsms")}
        subtitle={t("isms.3VyhlC4092025")}
      />
      <IsmsTabs active="review" />
      <ErrorBox error={ov.error ?? objs.error} />
      {o && (
        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <Card className="px-5 py-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <CalendarClock size={15} /> {t("isms.prezkoumaniIsms")}
            </div>
            {o.lastReview ? (
              <div className="mt-1 text-sm">
                {t("isms.posledniSchvalene")} <b>v{o.lastReview.version}</b> ({fmtDay(o.lastReview.approvedAt)})
              </div>
            ) : (
              <div className="mt-1 text-sm text-slate-600">{t("isms.zatimZadneSchvalenePrezkoumani")}</div>
            )}
            <div className={cn("mt-1 text-sm", o.reviewOverdue ? "font-medium text-red-700" : "text-slate-600")}>
              {o.reviewOverdue ? (
                <span className="inline-flex items-center gap-1">
                  <AlertTriangle size={14} color={STATUS_COLORS.serious} /> {t("isms.prezkoumaniJePotrebaProvest")}{o.nextReviewDue ? (" " + t("isms.termin", { p: fmtDay(o.nextReviewDue) })) : ""}
                </span>
              ) : (
                t("isms.dalsiNejpozdeji", { p: fmtDay(o.nextReviewDue) })
              )}
            </div>
          </Card>
          <Card className="px-5 py-4">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Target size={15} /> {t("isms.cileIsms")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {OBJECTIVE_STATUSES.filter((s) => o.objectives[s]).map((s) => (
                <Badge key={s} tone={objTone[s]}>
                  {t.lbl(OBJECTIVE_LABELS[s])} {o.objectives[s]}
                </Badge>
              ))}
              {!Object.values(o.objectives).some(Boolean) && <span className="text-sm text-slate-500">{t("isms.cileNejsouStanoveny")}</span>}
            </div>
          </Card>
          <Card className="px-5 py-4">
            <div className="text-sm text-slate-500">{t("isms.zmeny")}</div>
            <div className="mt-1 text-sm">
              {t("isms.otevrene")} <b>{o.changes.open}</b>{t("isms.zTohoVyznamne")} <b>{o.changes.significantOpen}</b>
            </div>
            <div className={cn("mt-1 text-sm", o.changes.withGaps ? "text-amber-800" : "text-slate-600")}>
              <Link to="/isms/changes" className="hover:underline">
                {o.changes.withGaps ? t("isms.vyznamnychZmenSNesplnenymiKroky", { withGaps: o.changes.withGaps }) : t("isms.vyznamneZmenyBezMezer")}
              </Link>
            </div>
          </Card>
        </div>
      )}

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title={t("isms.cileSystemuRizeniBezpecnostiInformaci")}
          subtitle={t("isms.3PismACileStanovuje")}
          action={
            can("isms:write") && (
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setEditing("new")}>
                <Plus size={14} /> {t("isms.cil")}
              </Button>
            )
          }
        />
        {(objs.data ?? []).length === 0 ? (
          <EmptyState>{t("isms.zatimZadnyCil")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("isms.cil")}</th>
                <th className="px-3 py-2">{t("isms.ukazatel")}</th>
                <th className="px-3 py-2">{t("isms.cilDosazeno")}</th>
                <th className="px-3 py-2">{t("isms.stav")}</th>
                <th className="px-3 py-2">{t("isms.odpovednost")}</th>
                <th className="px-3 py-2">{t("isms.termin2")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {objs.data!.map((x) => (
                <tr key={x.id} className={cn("hover:bg-slate-50", x.status === "cancelled" && "text-slate-400")}>
                  <td className="px-5 py-2.5">
                    <button className="text-left font-medium hover:text-brand-700" onClick={() => setEditing(x)}>
                      {x.code && <span className="mr-1.5 text-slate-500">{x.code}</span>}
                      {x.title}
                    </button>
                    {x.evaluation && <div className="text-xs text-slate-500">{x.evaluation}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{x.metric ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {x.target ?? "—"} / <b>{x.currentValue ?? "—"}</b>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={objTone[x.status]}>{t.lbl(OBJECTIVE_LABELS[x.status])}</Badge>
                    {x.evaluatedAt && <div className="text-xs text-slate-500">{fmtDay(x.evaluatedAt)}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{x.ownerPositionName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{x.dueDate ? fmtDay(x.dueDate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <DocumentVersions kind="isms_review" writePerm="isms:write" />
      {editing && <ObjectiveModal objective={editing === "new" ? null : editing} edit={can("isms:write")} onClose={() => setEditing(null)} onDone={refresh} />}
    </>
  );
}

function ObjectiveModal({ objective, edit, onClose, onDone }: { objective: ObjectiveDto | null; edit: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState({
    code: objective?.code ?? "",
    title: objective?.title ?? "",
    description: objective?.description ?? "",
    metric: objective?.metric ?? "",
    target: objective?.target ?? "",
    currentValue: objective?.currentValue ?? "",
    status: objective?.status ?? ("not_evaluated" as ObjectiveStatus),
    evaluation: objective?.evaluation ?? "",
    evaluatedAt: objective?.evaluatedAt ?? "",
    dueDate: objective?.dueDate ?? "",
    ownerPositionId: objective?.ownerPositionId ?? null,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const nz = (v: string) => (v ? v : null);
  const body = (): ObjectiveInput => ({
    ...f,
    code: nz(f.code),
    description: nz(f.description),
    metric: nz(f.metric),
    target: nz(f.target),
    currentValue: nz(f.currentValue),
    evaluation: nz(f.evaluation),
    evaluatedAt: nz(f.evaluatedAt),
    dueDate: nz(f.dueDate),
  });
  const save = useMutation({
    mutationFn: () => (objective ? api.isms.updateObjective(objective.id, body()) : api.isms.createObjective(body())),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: () => api.isms.removeObjective(objective!.id),
    onSuccess: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={objective ? objective.title : t("isms.novyCilIsms")}
      footer={
        <>
          {objective && edit && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("isms.smazatCil"))) && del.mutate()}>
              <Trash2 size={14} />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {edit && (
            <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
              {t("isms.ulozit")}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field label={t("isms.kod")}>
          <Input value={f.code} disabled={!edit} onChange={(e) => set("code", e.target.value)} />
        </Field>
        <Field label={t("isms.cil")}>
          <Input value={f.title} disabled={!edit} onChange={(e) => set("title", e.target.value)} />
        </Field>
      </div>
      <Field label={t("isms.popis")}>
        <Textarea rows={2} value={f.description} disabled={!edit} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("isms.ukazatelMeritko")}>
          <Input value={f.metric} disabled={!edit} onChange={(e) => set("metric", e.target.value)} />
        </Field>
        <Field label={t("isms.cilovaHodnota")}>
          <Input value={f.target} disabled={!edit} onChange={(e) => set("target", e.target.value)} />
        </Field>
        <Field label={t("isms.dosazenaHodnota")}>
          <Input value={f.currentValue} disabled={!edit} onChange={(e) => set("currentValue", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("isms.stav")}>
          <Select value={f.status} disabled={!edit} onChange={(e) => set("status", e.target.value as ObjectiveStatus)}>
            {OBJECTIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(OBJECTIVE_LABELS[s])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("isms.vyhodnocenoDne")}>
          <Input type="date" value={f.evaluatedAt} disabled={!edit} onChange={(e) => set("evaluatedAt", e.target.value)} />
        </Field>
        <Field label={t("isms.termin2")}>
          <Input type="date" value={f.dueDate} disabled={!edit} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
      </div>
      <Field label={t("isms.odpovednost")}>
        <PositionSelect value={f.ownerPositionId} disabled={!edit} onChange={(v) => set("ownerPositionId", v)} />
      </Field>
      <Field label={t("isms.vyhodnoceni")}>
        <Textarea rows={2} value={f.evaluation} disabled={!edit} onChange={(e) => set("evaluation", e.target.value)} />
      </Field>
      <ErrorBox error={save.error ?? del.error} />
    </Modal>
  );
}

/* ================= Řízení změn ================= */

export function ChangesPage() {
  const t = useT();
  const group = useGroupView();
  const can = useCan();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState<"open" | "all" | "significant">("open");
  const list = useQuery({ queryKey: ["isms", "changes", dq, status], queryFn: () => api.isms.changes({ q: dq || undefined, status }) });
  const rows = list.data ?? [];
  return (
    <>
      <PageHeader
        title={t("isms.rizeniIsms")}
        subtitle={t("isms.11VyhlC4092025")}
        actions={
          can("isms:write") && (
            <Link to="/isms/changes/new">
              <Button>
                <Plus size={16} /> {t("isms.novaZmena")}
              </Button>
            </Link>
          )
        }
      />
      <IsmsTabs active="changes" />
      <ErrorBox error={list.error} />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input className="max-w-xs" placeholder={t("isms.hledatNazevNeboKod")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-56" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="open">{t("isms.otevreneZmeny")}</option>
            <option value="significant">{t("isms.jenVyznamne")}</option>
            <option value="all">{t("isms.vsechny")}</option>
          </Select>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState>{t("isms.zadneZmeny")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("isms.zmena")}</th>
                <th className="px-3 py-2">{t("isms.typ")}</th>
                <th className="px-3 py-2">{t("isms.vyznam")}</th>
                <th className="px-3 py-2">{t("isms.stav")}</th>
                <th className="px-3 py-2">{t("isms.termin2")}</th>
                <th className="px-3 py-2">{t("isms.vlastnik")}</th>
                <th className="px-3 py-2">{t("isms.mezery11")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link to="/isms/changes/$changeId" params={{ changeId: c.id }} className="font-medium hover:text-brand-700">
                      {c.code && <span className="mr-1.5 text-slate-500">{c.code}</span>}
                      {c.title}
                    </Link>
                    {group && <div><CompanyCell id={c.companyId} /></div>}
                    <div className="text-xs text-slate-500">
                      {t("isms.aktivRizik", { assetCount: c.assetCount, riskCount: c.riskCount })}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{t.lbl(CHANGE_LABELS.type[c.changeType])}</td>
                  <td className="px-3 py-2.5">
                    {c.significant ? <Badge tone="violet">{t("isms.vyznamna")}</Badge> : c.affectsSecurity ? <Badge tone="blue">{t("isms.vlivNaKb")}</Badge> : <span className="text-xs text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={changeTone[c.status]}>{t.lbl(CHANGE_LABELS.status[c.status])}</Badge>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{fmtDay(c.implementedAt ?? c.plannedAt)}</td>
                  <td className="px-3 py-2.5 text-slate-600">{c.ownerPositionName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {c.gaps.length ? (
                      <span className="inline-flex items-center gap-1 text-amber-800" title={c.gaps.join("\n")}>
                        <AlertTriangle size={13} color={STATUS_COLORS.serious} /> {c.gaps.length}
                      </span>
                    ) : c.significant ? (
                      <span className="text-emerald-700">{t("isms.vPoradku")}</span>
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
    </>
  );
}

export function ChangeDetailPage() {
  const { changeId } = useParams({ strict: false }) as { changeId: string };
  const q = useQuery({ queryKey: ["isms", "change", changeId], queryFn: () => api.isms.change(changeId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <ChangeEditor key={q.data.id} ch={q.data} />;
}

export const ChangeNewPage = () => <ChangeEditor ch={null} />;

type Form = {
  code: string;
  title: string;
  description: string;
  changeType: ChangeInput["changeType"];
  status: ChangeStatus;
  ownerPositionId: string | null;
  requestedBy: string;
  plannedAt: string;
  implementedAt: string;
  affectsSecurity: boolean;
  significant: boolean;
  criteria: string[];
  significanceReason: string;
  riskAssessment: string;
  measures: string;
  docsUpdatedAt: string;
  docsNote: string;
  testedAt: string;
  testResult: string;
  rollbackPlan: string;
  pentest: ChangeDecision;
  pentestNote: string;
  audit: ChangeDecision;
  auditNote: string;
  assets: PickedAsset[];
  processIds: string[];
  riskIds: string[];
  controlIds: string[];
  supplierIds: string[];
};

function ChangeEditor({ ch }: { ch: ChangeDetail | null }) {
  const t = useT();
  const profile = useProfile(ch?.companyId);
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = ch ? ch.canEdit : can("isms:write");
  const admin = can("isms:write");
  const [f, setF] = useState<Form>({
    code: ch?.code ?? "",
    title: ch?.title ?? "",
    description: ch?.description ?? "",
    changeType: ch?.changeType ?? "technical",
    status: ch?.status ?? "proposed",
    ownerPositionId: ch?.ownerPositionId ?? null,
    requestedBy: ch?.requestedBy ?? "",
    plannedAt: ch?.plannedAt ?? "",
    implementedAt: ch?.implementedAt ?? "",
    affectsSecurity: ch?.affectsSecurity ?? false,
    significant: ch?.significant ?? false,
    criteria: ch?.criteria ?? [],
    significanceReason: ch?.significanceReason ?? "",
    riskAssessment: ch?.riskAssessment ?? "",
    measures: ch?.measures ?? "",
    docsUpdatedAt: ch?.docsUpdatedAt ?? "",
    docsNote: ch?.docsNote ?? "",
    testedAt: ch?.testedAt ?? "",
    testResult: ch?.testResult ?? "",
    rollbackPlan: ch?.rollbackPlan ?? "",
    pentest: ch?.pentest ?? "not_assessed",
    pentestNote: ch?.pentestNote ?? "",
    audit: ch?.audit ?? "not_assessed",
    auditNote: ch?.auditNote ?? "",
    assets: ch?.assets ?? [],
    processIds: ch?.processes.map((x) => x.id) ?? [],
    riskIds: ch?.risks.map((x) => x.id) ?? [],
    controlIds: ch?.controls.map((x) => x.id) ?? [],
    supplierIds: ch?.suppliers.map((x) => x.id) ?? [],
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const criteria = useQuery({ queryKey: ["isms", "criteria"], queryFn: api.isms.criteria });
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "", false], queryFn: () => api.suppliers.list(), enabled: mod("suppliers") && can("suppliers:read") });

  const nz = (v: string) => (v ? v : null);
  const body = (): ChangeInput => {
    const { assets, ...r } = f;
    return {
      ...r,
      code: nz(r.code),
      description: nz(r.description),
      requestedBy: nz(r.requestedBy),
      plannedAt: nz(r.plannedAt),
      implementedAt: nz(r.implementedAt),
      significanceReason: nz(r.significanceReason),
      riskAssessment: nz(r.riskAssessment),
      measures: nz(r.measures),
      docsUpdatedAt: nz(r.docsUpdatedAt),
      docsNote: nz(r.docsNote),
      testedAt: nz(r.testedAt),
      testResult: nz(r.testResult),
      rollbackPlan: nz(r.rollbackPlan),
      pentestNote: nz(r.pentestNote),
      auditNote: nz(r.auditNote),
      assetIds: assets.map((a) => a.id),
    };
  };
  // živý náhled mezer podle rozpracovaného formuláře
  const gaps = withLegalRefs(changeGaps({ ...f, riskCount: f.riskIds.length, controlCount: f.controlIds.length }), profile.czLegalRefs);

  const save = useMutation({
    mutationFn: () => (ch ? api.isms.updateChange(ch.id, body()) : api.isms.createChange(body())),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["isms"] });
      qc.setQueryData(["isms", "change", d.id], d);
      if (!ch) nav({ to: "/isms/changes/$changeId", params: { changeId: d.id } });
    },
  });
  const guard = useFormGuard(save);
  const del = useMutation({
    mutationFn: () => api.isms.removeChange(ch!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["isms"] });
      nav({ to: "/isms/changes" });
    },
  });
  const label = (x: { code: string | null; name: string }) => `${x.code ? `${x.code} ` : ""}${x.name}`;
  const sec = (f.significant || f.affectsSecurity) as boolean;

  return (
    <div {...guard.bind}>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/isms/changes" className="hover:text-brand-700">
          {t("isms.rizeniZmen")}
        </Link>
      </div>
      <PageHeader
        title={ch ? `${ch.code ? `${ch.code} ` : ""}${ch.title}` : t("isms.novaZmena")}
        subtitle={
          ch
            ? `${t.lbl(CHANGE_LABELS.status[ch.status])}${ch.approvedAt ? (" " + t("isms.schvalilA", { p: ch.approvedByName ?? "—", p2: fmtDay(ch.approvedAt) })) : ""}${ch.createdByName ? (" " + t("isms.zalozilA", { createdByName: ch.createdByName })) : ""}`
            : t("isms.11Odst1Vyhl409")
        }
        actions={
          <>
            {ch && admin && <TransferButton entity="changes" id={ch.id} companyId={ch.companyId} />}
            {ch && admin && (
              <Button variant="danger" onClick={async () => (await askConfirm(t("isms.smazatZaznamOZmene"))) && del.mutate()}>
                <Trash2 size={16} />
              </Button>
            )}
            {edit && (
              <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
                {ch ? t("isms.ulozit") : t("common.create")}
              </Button>
            )}
          </>
        }
      />
      {f.significant && gaps.length > 0 && (
        <div className="mb-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {gaps.map((g) => (
            <div key={g} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" color={STATUS_COLORS.serious} /> {g}
            </div>
          ))}
        </div>
      )}
      {save.isSuccess && <SuccessBox>{t("isms.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("isms.zmena")} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("isms.kod")}>
                <Input value={f.code} disabled={!edit} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label={t("isms.nazev")}>
                <Input value={f.title} disabled={!edit} onChange={(e) => set("title", e.target.value)} />
              </Field>
            </div>
            <Field label={t("isms.popis")}>
              <Textarea rows={3} value={f.description} disabled={!edit} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("isms.typ")}>
                <Select value={f.changeType} disabled={!edit} onChange={(e) => set("changeType", e.target.value as Form["changeType"])}>
                  {CHANGE_TYPES.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(CHANGE_LABELS.type[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("isms.stav")} hint={admin ? undefined : t("isms.schvaleniAZamitnutiProvadiSpravce")}>
                <Select value={f.status} disabled={!edit} onChange={(e) => set("status", e.target.value as ChangeStatus)}>
                  {CHANGE_STATUSES.map((tx) => (
                    <option key={tx} value={tx} disabled={!admin && (tx === "approved" || tx === "rejected") && ch?.status !== tx}>
                      {t.lbl(CHANGE_LABELS.status[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("isms.vlastnikFunkcniMisto")}>
                <PositionSelect value={f.ownerPositionId} disabled={!admin} onChange={(v) => set("ownerPositionId", v)} />
              </Field>
              <Field label={t("isms.zadatel")}>
                <Input value={f.requestedBy} disabled={!edit} onChange={(e) => set("requestedBy", e.target.value)} />
              </Field>
              <Field label={t("isms.planovaneProvedeni")}>
                <Input type="date" value={f.plannedAt} disabled={!edit} onChange={(e) => set("plannedAt", e.target.value)} />
              </Field>
              <Field label={t("isms.provedeno")}>
                <Input type="date" value={f.implementedAt} disabled={!edit} onChange={(e) => set("implementedAt", e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("isms.posouzeni11Odst1")} subtitle={t("isms.kriteriaProUrceniVyznamnychZmen")} />
          <div className="space-y-4 p-5">
            <Checkbox
              checked={sec}
              disabled={!edit || f.significant}
              onChange={(v) => set("affectsSecurity", v)}
              label={t("isms.zmenaMaNeboMuzeMit")}
              hint={t("isms.11Odst1PismB")}
            />
            <Checkbox
              checked={f.significant}
              disabled={!edit}
              onChange={(v) => setF((x) => ({ ...x, significant: v, affectsSecurity: v || x.affectsSecurity }))}
              label={t("isms.vyznamnaZmena")}
              hint={t("isms.11Odst1PismC")}
            />
            {f.significant && (
              <div className="space-y-2 rounded-md border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-700">{t("isms.splnenaKriteria")}</div>
                {[...new Set([...(criteria.data ?? []), ...f.criteria])].map((c) => (
                  <Checkbox
                    key={c}
                    checked={f.criteria.includes(c)}
                    disabled={!edit}
                    onChange={(v) => set("criteria", v ? [...f.criteria, c] : f.criteria.filter((x) => x !== c))}
                    label={c}
                  />
                ))}
                <Field label={t("isms.dalsiOduvodneni")}>
                  <Textarea rows={2} value={f.significanceReason} disabled={!edit} onChange={(e) => set("significanceReason", e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        </Card>
      </div>

      {f.significant && (
        <Card className="mt-6">
          <CardHeader title={t("isms.rizeniVyznamneZmeny11Odst")} subtitle={t("isms.dokumentaceRizeniZmenyPismA")} />
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <Field label={t("isms.bRizeniRizikSpojenychSe")} hint={t("isms.vysledekHodnoceniRizikSouvisejiciRizika")}>
              <Textarea rows={3} value={f.riskAssessment} disabled={!edit} onChange={(e) => set("riskAssessment", e.target.value)} />
            </Field>
            <Field label={t("isms.cBezpecnostniOpatreniKeSnizeni")} hint={t("isms.opatreniZKataloguLzeNavazat")}>
              <Textarea rows={3} value={f.measures} disabled={!edit} onChange={(e) => set("measures", e.target.value)} />
            </Field>
            <div className="space-y-3">
              <Field label={t("isms.dAktualizaceBezpecnostniAProvozni")}>
                <Input type="date" value={f.docsUpdatedAt} disabled={!edit} onChange={(e) => set("docsUpdatedAt", e.target.value)} />
              </Field>
              <Input placeholder={t("isms.ktereDokumenty")} value={f.docsNote} disabled={!edit} onChange={(e) => set("docsNote", e.target.value)} />
            </div>
            <div className="space-y-3">
              <Field label={t("isms.eTestovaniPredUvedenimDo")}>
                <Input type="date" value={f.testedAt} disabled={!edit} onChange={(e) => set("testedAt", e.target.value)} />
              </Field>
              <Textarea rows={2} placeholder={t("isms.vysledekTestu")} value={f.testResult} disabled={!edit} onChange={(e) => set("testResult", e.target.value)} />
            </div>
            <Field label={t("isms.fMoznostNavraceniDoPuvodniho")} hint={t("isms.postupAPodminkyNavratuRollback")}>
              <Textarea rows={3} value={f.rollbackPlan} disabled={!edit} onChange={(e) => set("rollbackPlan", e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("isms.penetracniTest11Odst3")}>
                <Select value={f.pentest} disabled={!edit} onChange={(e) => set("pentest", e.target.value as ChangeDecision)}>
                  {CHANGE_DECISIONS.map((d) => (
                    <option key={d} value={d}>
                      {t.lbl(CHANGE_LABELS.decision[d])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("isms.auditVRozsahuZmeny16")}>
                <Select value={f.audit} disabled={!edit} onChange={(e) => set("audit", e.target.value as ChangeDecision)}>
                  {CHANGE_DECISIONS.map((d) => (
                    <option key={d} value={d}>
                      {t.lbl(CHANGE_LABELS.decision[d])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Input placeholder={t("isms.oduvodneniTerminPentestu")} value={f.pentestNote} disabled={!edit} onChange={(e) => set("pentestNote", e.target.value)} />
              <Input placeholder={t("isms.auditorTerminZjisteni")} value={f.auditNote} disabled={!edit} onChange={(e) => set("auditNote", e.target.value)} />
            </div>
          </div>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader title={t("isms.dotcenaAktivaAVazby")} />
        <div className="grid gap-6 p-5 lg:grid-cols-2 xl:grid-cols-3">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("isms.aktiva")}</div>
            <AssetPicker value={f.assets} onChange={(v) => set("assets", v)} disabled={!edit} />
          </div>
          {mod("processes") && can("processes:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("isms.procesy")}</div>
              <IdMultiSelect
                linkKind="process"
                value={f.processIds}
                onChange={(v) => set("processIds", v)}
                disabled={!edit}
                placeholder={t("isms.pridatProces")}
                emptyLabel={t("isms.zadneProcesy")}
                options={(processes.data ?? []).map((p) => ({ id: p.id, label: label(p) }))}
                known={(ch?.processes ?? []).map((p) => ({ id: p.id, label: label(p) }))}
              />
            </div>
          )}
          {mod("risks") && can("risks:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("isms.rizika")}</div>
              <IdMultiSelect
                linkKind="risk"
                value={f.riskIds}
                onChange={(v) => set("riskIds", v)}
                disabled={!edit}
                placeholder={t("isms.pridatRiziko")}
                emptyLabel={t("isms.zadnaRizika")}
                options={(risks.data?.items ?? []).map((r) => ({ id: r.id, label: label(r) }))}
                known={(ch?.risks ?? []).map((r) => ({ id: r.id, label: label(r) }))}
              />
              {ch && ch.risks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ch.risks.map((r) => (
                    <Link key={r.id} to="/risks/$riskId" params={{ riskId: r.id }} className="inline-flex items-center gap-1 text-xs hover:underline">
                      {r.code ?? r.name} <RiskLevelBadge level={r.level as RiskLevel | null} score={null} />
                    </Link>
                  ))}
                </div>
              )}
              {edit && can("risks:write") && (
                <Link to="/risks/new" search={{}} className="mt-2 inline-block text-xs text-brand-600 hover:underline">
                  {t("isms.zalozitNoveRiziko")}
                </Link>
              )}
            </div>
          )}
          {mod("controls") && can("controls:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("isms.bezpecnostniOpatreni")}</div>
              <IdMultiSelect
                linkKind="control"
                value={f.controlIds}
                onChange={(v) => set("controlIds", v)}
                disabled={!edit}
                placeholder={t("isms.pridatOpatreni")}
                emptyLabel={t("isms.zadnaOpatreni")}
                options={(controls.data ?? []).map((c) => ({ id: c.id, label: label(c) }))}
                known={(ch?.controls ?? []).map((c) => ({ id: c.id, label: label(c) }))}
              />
            </div>
          )}
          {mod("suppliers") && can("suppliers:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("isms.dodavatele")}</div>
              <IdMultiSelect
                linkKind="supplier"
                value={f.supplierIds}
                onChange={(v) => set("supplierIds", v)}
                disabled={!edit}
                placeholder={t("isms.pridatDodavatele")}
                emptyLabel={t("isms.zadniDodavatele")}
                options={(suppliers.data ?? []).map((s) => ({ id: s.id, label: s.name, hint: s.significant ? t("isms.vyznamny") : undefined }))}
                known={(ch?.suppliers ?? []).map((s) => ({ id: s.id, label: s.name }))}
              />
            </div>
          )}
        </div>
      </Card>
      {ch && <TasksCard kind="change" id={ch.id} className="mt-6" />}
    </div>
  );
}
