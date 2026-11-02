import { askConfirm } from "@/components/ui/overlay";
import { TasksCard } from "@/components/tasks";
import { CompanyCell, TargetCompanyField, useGroupView, useTargetCompany } from "@/components/company";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, toggle, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import {
  AUDIT_LABELS,
  SOC2_CONCLUSIONS,
  SOC2_DESCRIPTION_SECTIONS,
  SOC2_LABELS,
  SOC2_OPINIONS,
  SOC2_REPORT_TYPES,
  SOC2_REQUIRED_SECTIONS,
  SOC2_SCOPE_CATEGORIES,
  SOC2_SECTIONS,
  SOC2_SUBSERVICE_METHODS,
  soc2CriteriaFor,
  tscCrosswalk,
  type AuditStatus,
  type ControlTestResult,
  type TestStatus,
  type Soc2Category,
  type Soc2Conclusion,
  type Soc2CriterionRow,
  type Soc2Cuec,
  type Soc2DescriptionSection,
  type Soc2DetailDto,
  type Soc2Opinion,
  type Soc2ReportType,
  type Soc2Subservice,
  type Soc2SubserviceMethod,
  SUPPLIER_REPORT_LABELS,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileDown, ListPlus, Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";

const conclTone: Record<Soc2Conclusion, Tone> = { pending: "slate", no_exceptions: "green", exceptions: "amber", na: "slate" };
const testTone = (r: string | null): Tone => (r === "effective" ? "green" : r === "effective_with_exceptions" ? "amber" : r === "ineffective" ? "red" : "slate");

/** Řádky „text [CC6.1, A1.2]“ ↔ položky s kritérii. */
export function parseCriteriaLines(v: string): { text: string; criteria: string[] }[] {
  return v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
      return m ? { text: m[1]!.trim(), criteria: m[2]!.split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean) } : { text: l, criteria: [] };
    })
    .filter((x) => x.text);
}
const toLines = (v: { text: string; criteria: string[] }[]) => v.map((x) => `${x.text}${x.criteria.length ? ` [${x.criteria.join(", ")}]` : ""}`).join("\n");

/* ============================ přehled ============================ */

export function Soc2Page() {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const [tab, setTab] = useState<"engagements" | "mapping">("engagements");
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["soc2"], queryFn: () => api.soc2.list() });
  return (
    <>
      <PageHeader
        title={t("soc2.title")}
        subtitle={t("soc2.subtitle")}
        actions={
          can("audits:write") && (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> {t("soc2.new")}
            </Button>
          )
        }
      />
      <div role="tablist" aria-label={t("soc2.title")} className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {(["engagements", "mapping"] as const).map((x) => (
          <button key={x} role="tab" type="button" aria-selected={tab === x} onClick={() => setTab(x)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === x ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t(`soc2.tab.${x}`)}
          </button>
        ))}
      </div>
      <ErrorBox error={q.error} />
      {tab === "engagements" ? (
        <Card className="overflow-hidden">
          {!q.data?.length ? (
            <EmptyState>{q.isLoading ? t("common.loading") : t("soc2.empty")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("soc2.engagement")}</th>
                  <th className="px-3 py-2">{t("soc2.period")}</th>
                  <th className="px-3 py-2">{t("soc2.progress")}</th>
                  <th className="px-3 py-2">{t("soc2.exceptions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link to="/soc2/$engagementId" params={{ engagementId: e.id }} className="font-medium hover:text-brand-700">
                        {e.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <Badge tone="blue">{e.reportType === "type1" ? "Type I" : "Type II"}</Badge>
                        <Badge tone="slate">{t.lbl(AUDIT_LABELS.status[e.auditStatus as AuditStatus])}</Badge>
                        {e.systemName && <span>{e.systemName}</span>}
                        <span>· {e.categories.join(", ")}</span>
                      </div>
                      {group && <CompanyCell id={e.companyId} />}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{e.reportType === "type1" ? fmtDay(e.asOf ?? "") || "—" : `${e.periodFrom ? fmtDay(e.periodFrom) : "—"} – ${e.periodTo ? fmtDay(e.periodTo) : "—"}`}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{t("soc2.progressValue", { concluded: e.progress.concluded, criteria: e.progress.criteria, tested: e.progress.tested })}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{e.progress.exceptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <MappingTable />
      )}
      {open && <NewEngagementModal onClose={() => setOpen(false)} />}
    </>
  );
}

function NewEngagementModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const qc = useQueryClient();
  const target = useTargetCompany();
  const [f, setF] = useState({ title: "", reportType: "type2" as Soc2ReportType, categories: ["CC"] as Soc2Category[], asOf: "", periodFrom: "", periodTo: "", systemName: "", serviceAuditor: "" });
  const create = useMutation({
    mutationFn: () =>
      api.soc2.create({
        companyId: target.companyId,
        title: f.title,
        reportType: f.reportType,
        categories: f.categories,
        asOf: f.asOf || null,
        periodFrom: f.periodFrom || null,
        periodTo: f.periodTo || null,
        systemName: f.systemName,
        serviceAuditor: f.serviceAuditor || null,
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["soc2"] });
      nav({ to: "/soc2/$engagementId", params: { engagementId: d.id } });
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("soc2.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!f.title.trim() || create.isPending} onClick={() => create.mutate()}>
            {t("common.create")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TargetCompanyField value={target.companyId} onChange={target.setCompanyId} />
        <Field label={t("soc2.f.title")}>
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t("soc2.f.titlePh")} />
        </Field>
        <Field label={t("soc2.f.system")}>
          <Input value={f.systemName} onChange={(e) => setF({ ...f, systemName: e.target.value })} />
        </Field>
        <ScopeFields f={f} set={(k, v) => setF((x) => ({ ...x, [k]: v }))} />
        <Field label={t("soc2.f.auditor")}>
          <Input value={f.serviceAuditor} onChange={(e) => setF({ ...f, serviceAuditor: e.target.value })} />
        </Field>
        <ErrorBox error={create.error} />
      </div>
    </Modal>
  );
}

type ScopeState = { reportType: Soc2ReportType; categories: Soc2Category[]; asOf: string; periodFrom: string; periodTo: string };
function ScopeFields<S extends ScopeState>({ f, set }: { f: S; set: <K extends keyof ScopeState>(k: K, v: ScopeState[K]) => void }) {
  const t = useT();
  return (
    <>
      <Field label={t("soc2.f.type")}>
        <Select value={f.reportType} onChange={(e) => set("reportType", e.target.value as Soc2ReportType)}>
          {SOC2_REPORT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t.lbl(SOC2_LABELS.reportType[x])}
            </option>
          ))}
        </Select>
      </Field>
      {f.reportType === "type1" ? (
        <Field label={t("soc2.f.asOf")}>
          <Input type="date" value={f.asOf} onChange={(e) => set("asOf", e.target.value)} />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("soc2.f.from")}>
            <Input type="date" value={f.periodFrom} onChange={(e) => set("periodFrom", e.target.value)} />
          </Field>
          <Field label={t("soc2.f.to")}>
            <Input type="date" value={f.periodTo} onChange={(e) => set("periodTo", e.target.value)} />
          </Field>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700">{t("soc2.f.categories")}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {SOC2_SCOPE_CATEGORIES.map((c) => (
            <Checkbox key={c} checked={c === "CC" || f.categories.includes(c)} disabled={c === "CC"} onChange={(v) => set("categories", toggle(f.categories, c, v))} label={`${c} – ${t.lbl(SOC2_LABELS.category[c])}`} />
          ))}
        </div>
      </div>
    </>
  );
}

function MappingTable() {
  const t = useT();
  const [cats, setCats] = useState<Soc2Category[]>(["CC", "A1", "C1", "PI1", "P"]);
  const rows = soc2CriteriaFor(cats).filter((c) => cats.includes(c.category));
  return (
    <Card className="overflow-hidden" data-testid="soc2-mapping">
      <CardHeader title={t("soc2.mapping")} subtitle={t("soc2.mappingSub")} />
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-5 pb-3">
        {SOC2_SCOPE_CATEGORIES.map((c) => (
          <Checkbox key={c} checked={cats.includes(c)} onChange={(v) => setCats(toggle(cats, c, v))} label={`${c} – ${t.lbl(SOC2_LABELS.category[c])}`} />
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-2">{t("soc2.criterion")}</th>
            <th className="px-3 py-2">{t("soc2.cz409")}</th>
            <th className="px-3 py-2">ISO/IEC 27001:2022</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const m = tscCrosswalk(r.id);
            return (
              <tr key={r.id}>
                <td className="px-5 py-2">
                  <span className="mr-2 font-mono text-xs font-semibold">{r.id}</span>
                  {t.lbl(r.label)}
                  <div className="text-xs text-slate-500">{t.lbl(SOC2_SECTIONS[r.section] ?? r.section)}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{m.cz409.join(", ") || "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{m.iso.join(", ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/* ============================ zakázka ============================ */

export function Soc2DetailPage() {
  const { engagementId } = useParams({ strict: false }) as { engagementId: string };
  const q = useQuery({ queryKey: ["soc2", "detail", engagementId], queryFn: () => api.soc2.get(engagementId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <Engagement d={q.data} />;
}

type Tab = "scope" | "description" | "criteria" | "report";

function Engagement({ d }: { d: Soc2DetailDto }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("criteria");
  const edit = can("audits:write");
  const done = (x: Soc2DetailDto) => {
    qc.setQueryData(["soc2", "detail", x.id], x);
    qc.invalidateQueries({ queryKey: ["soc2"], exact: true });
  };
  const del = useMutation({
    mutationFn: () => api.soc2.remove(d.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["soc2"] });
      nav({ to: "/soc2" });
    },
  });
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/soc2" className="hover:text-brand-700">
          {t("soc2.title")}
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge tone="blue">{t.lbl(SOC2_LABELS.reportType[d.reportType])}</Badge>
            <Badge tone="slate">{t.lbl(AUDIT_LABELS.status[d.auditStatus as AuditStatus])}</Badge>
            <span>{d.systemName || "—"}</span>
            <span>· {t("soc2.progressValue", { concluded: d.progress.concluded, criteria: d.progress.criteria, tested: d.progress.tested })}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/audits/$auditId" params={{ auditId: d.auditId }}>
            <Button variant="secondary">{t("soc2.auditPbc")}</Button>
          </Link>
          {edit && d.auditStatus !== "completed" && (
            <Button variant="danger" aria-label={t("soc2.delete")} onClick={async () => (await askConfirm(t("soc2.deleteConfirm"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      </div>
      <ErrorBox error={del.error} />
      <div role="tablist" aria-label={d.title} className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {(["criteria", "scope", "description", "report"] as const).map((x) => (
          <button key={x} role="tab" type="button" aria-selected={tab === x} onClick={() => setTab(x)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === x ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {t(`soc2.tab.${x}`)}
            {x === "report" && d.readiness.length > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{d.readiness.length}</span>}
          </button>
        ))}
      </div>
      {tab === "scope" && <ScopeTab d={d} edit={edit} onSaved={done} />}
      {tab === "description" && <DescriptionTab d={d} edit={edit} onSaved={done} />}
      {tab === "criteria" && <CriteriaTab d={d} edit={edit} onSaved={done} />}
      {tab === "report" && <ReportTab d={d} />}
      <TasksCard kind="soc2" id={d.id} className="mt-6" />
    </>
  );
}

function ScopeTab({ d, edit, onSaved }: { d: Soc2DetailDto; edit: boolean; onSaved: (x: Soc2DetailDto) => void }) {
  const t = useT();
  const [f, setF] = useState({
    title: d.title,
    reportType: d.reportType,
    categories: d.categories,
    asOf: d.asOf ?? "",
    periodFrom: d.periodFrom ?? "",
    periodTo: d.periodTo ?? "",
    systemName: d.systemName,
    serviceOrg: d.serviceOrg ?? "",
    serviceAuditor: d.serviceAuditor ?? "",
    signatory: d.signatory ?? "",
    reportDate: d.reportDate ?? "",
    reportPlace: d.reportPlace ?? "",
    opinion: d.opinion,
    opinionBasis: d.opinionBasis ?? "",
    assertion: d.assertion ?? "",
    otherInfo: d.otherInfo ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => v.trim() || null;
  const save = useMutation({
    mutationFn: () =>
      api.soc2.update(d.id, {
        title: f.title,
        reportType: f.reportType,
        categories: f.categories,
        asOf: f.asOf || null,
        periodFrom: f.periodFrom || null,
        periodTo: f.periodTo || null,
        systemName: f.systemName,
        serviceOrg: n(f.serviceOrg),
        serviceAuditor: n(f.serviceAuditor),
        signatory: n(f.signatory),
        reportDate: f.reportDate || null,
        reportPlace: n(f.reportPlace),
        opinion: f.opinion,
        opinionBasis: n(f.opinionBasis),
        assertion: n(f.assertion),
        otherInfo: n(f.otherInfo),
      }),
    onSuccess: onSaved,
  });
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("soc2.scope")} subtitle={t("soc2.scopeSub")} />
        <fieldset disabled={!edit} className="space-y-4 p-5 pt-0">
          <Field label={t("soc2.f.title")}>
            <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label={t("soc2.f.system")}>
            <Input value={f.systemName} onChange={(e) => set("systemName", e.target.value)} />
          </Field>
          <Field label={t("soc2.f.serviceOrg")} hint={t("soc2.f.serviceOrgHint")}>
            <Input value={f.serviceOrg} onChange={(e) => set("serviceOrg", e.target.value)} />
          </Field>
          <ScopeFields f={f} set={(k, v) => set(k, v as never)} />
        </fieldset>
      </Card>
      <Card>
        <CardHeader title={t("soc2.opinionCard")} subtitle={t("soc2.opinionSub")} />
        <fieldset disabled={!edit} className="space-y-4 p-5 pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("soc2.f.auditor")}>
              <Input value={f.serviceAuditor} onChange={(e) => set("serviceAuditor", e.target.value)} />
            </Field>
            <Field label={t("soc2.f.signatory")}>
              <Input value={f.signatory} onChange={(e) => set("signatory", e.target.value)} />
            </Field>
            <Field label={t("soc2.f.reportDate")}>
              <Input type="date" value={f.reportDate} onChange={(e) => set("reportDate", e.target.value)} />
            </Field>
            <Field label={t("soc2.f.reportPlace")}>
              <Input value={f.reportPlace} onChange={(e) => set("reportPlace", e.target.value)} />
            </Field>
          </div>
          <Field label={t("soc2.f.opinion")}>
            <Select value={f.opinion} onChange={(e) => set("opinion", e.target.value as Soc2Opinion)}>
              {SOC2_OPINIONS.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(SOC2_LABELS.opinion[x])}
                </option>
              ))}
            </Select>
          </Field>
          {f.opinion !== "unmodified" && (
            <Field label={t("soc2.f.opinionBasis")}>
              <Textarea rows={3} value={f.opinionBasis} onChange={(e) => set("opinionBasis", e.target.value)} />
            </Field>
          )}
          <Field label={t("soc2.f.assertion")} hint={t("soc2.f.assertionHint")}>
            <Textarea rows={4} value={f.assertion} onChange={(e) => set("assertion", e.target.value)} />
          </Field>
          <Field label={t("soc2.f.otherInfo")} hint={t("soc2.f.otherInfoHint")}>
            <Textarea rows={3} value={f.otherInfo} onChange={(e) => set("otherInfo", e.target.value)} />
          </Field>
        </fieldset>
      </Card>
      {edit && (
        <div className="flex items-center gap-3 lg:col-span-2">
          <Button disabled={!f.title.trim() || save.isPending} onClick={() => save.mutate()}>
            {t("soc2.save")}
          </Button>
          {save.isSuccess && <SuccessBox>{t("soc2.saved")}</SuccessBox>}
          <ErrorBox error={save.error} />
        </div>
      )}
    </div>
  );
}

function DescriptionTab({ d, edit, onSaved }: { d: Soc2DetailDto; edit: boolean; onSaved: (x: Soc2DetailDto) => void }) {
  const t = useT();
  const mod = useModule();
  const can = useCan();
  const [desc, setDesc] = useState<Partial<Record<Soc2DescriptionSection, string>>>(d.description);
  const [cuecs, setCuecs] = useState(toLines(d.cuecs));
  const [subs, setSubs] = useState<(Omit<Soc2Subservice, "csocs"> & { csocs: string })[]>(d.subservice.map((s) => ({ ...s, csocs: toLines(s.csocs) })));
  const suppliers = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.suppliers.list({ withGroup: "1" }), enabled: mod("suppliers") && can("suppliers:read") });
  const save = useMutation({
    mutationFn: () =>
      api.soc2.update(d.id, {
        description: Object.fromEntries(Object.entries(desc).filter(([, v]) => v?.trim())),
        cuecs: parseCriteriaLines(cuecs) as Soc2Cuec[],
        subservice: subs.filter((s) => s.name.trim()).map((s) => ({ ...s, csocs: parseCriteriaLines(s.csocs) })),
      }),
    onSuccess: onSaved,
  });
  const setSub = (i: number, v: Partial<(typeof subs)[number]>) => setSubs((x) => x.map((s, j) => (j === i ? { ...s, ...v } : s)));
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("soc2.description")} subtitle={t("soc2.descriptionSub")} />
        <fieldset disabled={!edit} className="grid gap-4 p-5 pt-0 lg:grid-cols-2">
          {SOC2_DESCRIPTION_SECTIONS.map((k) => (
            <Field key={k} label={`${t.lbl(SOC2_LABELS.section[k])}${SOC2_REQUIRED_SECTIONS.includes(k) ? " *" : ""}`}>
              <Textarea rows={4} value={desc[k] ?? ""} onChange={(e) => setDesc((x) => ({ ...x, [k]: e.target.value }))} />
            </Field>
          ))}
        </fieldset>
      </Card>
      <Card>
        <CardHeader title={t("soc2.cuecs")} subtitle={t("soc2.cuecsSub")} />
        <fieldset disabled={!edit} className="p-5 pt-0">
          <Textarea rows={5} value={cuecs} onChange={(e) => setCuecs(e.target.value)} aria-label={t("soc2.cuecs")} placeholder={t("soc2.cuecsPh")} />
        </fieldset>
      </Card>
      <Card>
        <CardHeader
          title={t("soc2.subservice")}
          subtitle={t("soc2.subserviceSub")}
          action={
            edit && (
              <Button variant="secondary" onClick={() => setSubs((x) => [...x, { name: "", services: "", method: "carve_out", supplierId: null, csocs: "" }])}>
                <Plus size={14} /> {t("soc2.addSubservice")}
              </Button>
            )
          }
        />
        <fieldset disabled={!edit} className="space-y-4 p-5 pt-0">
          {!subs.length && <p className="text-sm text-slate-500">{t("soc2.noSubservice")}</p>}
          {subs.map((s, i) => (
            <div key={i} className="grid gap-3 rounded-md border border-slate-200 p-3 lg:grid-cols-2">
              <Field label={t("soc2.subName")}>
                <Input value={s.name} onChange={(e) => setSub(i, { name: e.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("soc2.subMethod")}>
                  <Select value={s.method} onChange={(e) => setSub(i, { method: e.target.value as Soc2SubserviceMethod })}>
                    {SOC2_SUBSERVICE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t.lbl(SOC2_LABELS.method[m])}
                      </option>
                    ))}
                  </Select>
                </Field>
                {mod("suppliers") && (
                  <Field label={t("soc2.subSupplier")}>
                    <Select
                      value={s.supplierId ?? ""}
                      onChange={(e) => {
                        const sup = suppliers.data?.find((x) => x.id === e.target.value);
                        setSub(i, { supplierId: e.target.value || null, ...(sup && !s.name ? { name: sup.name } : {}) });
                      }}
                    >
                      <option value="">—</option>
                      {(suppliers.data ?? []).map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              <Field label={t("soc2.subServices")}>
                <Textarea rows={2} value={s.services} onChange={(e) => setSub(i, { services: e.target.value })} />
              </Field>
              <Field label={t("soc2.subCsoc")} hint={t("soc2.criteriaLineHint")}>
                <Textarea rows={3} value={s.csocs} onChange={(e) => setSub(i, { csocs: e.target.value })} />
              </Field>
              {mod("suppliers") && can("suppliers:read") && s.supplierId && (
                <SubserviceReport
                  supplierId={s.supplierId}
                  edit={edit}
                  onPrefill={(lines) => {
                    const have = new Set(s.csocs.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
                    const add = lines.filter((l) => !have.has(l));
                    setSub(i, { csocs: [...have, ...add].join("\n") });
                    return add.length;
                  }}
                />
              )}
              {edit && (
                <div className="lg:col-span-2">
                  <Button variant="secondary" onClick={() => setSubs((x) => x.filter((_, j) => j !== i))}>
                    <Trash2 size={14} /> {t("soc2.removeSubservice")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </fieldset>
      </Card>
      {edit && (
        <div className="flex items-center gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("soc2.save")}
          </Button>
          {save.isSuccess && <SuccessBox>{t("soc2.saved")}</SuccessBox>}
          <ErrorBox error={save.error} />
        </div>
      )}
    </div>
  );
}

function CriteriaTab({ d, edit, onSaved }: { d: Soc2DetailDto; edit: boolean; onSaved: (x: Soc2DetailDto) => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "exceptions" | "nocontrols">("all");
  const pbc = useMutation({ mutationFn: () => api.soc2.pbcTemplate(d.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["soc2", "detail", d.id] }) });
  const mon = useMutation({ mutationFn: () => api.soc2.monitorTests(d.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["soc2", "detail", d.id] }) });
  const cross = useMutation({
    mutationFn: () => api.controls.crosswalk({ frameworks: ["soc2"], apply: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["soc2", "detail", d.id] }),
  });
  const rows = d.criteria.filter((r) =>
    filter === "open" ? r.workpaper.conclusion === "pending" : filter === "exceptions" ? r.exceptions.length > 0 || r.tests.some((x) => x.failed > 0) : filter === "nocontrols" ? !r.controls.length : true,
  );
  let lastSection = "";
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="w-56" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t("soc2.filter")}>
          {(["all", "open", "exceptions", "nocontrols"] as const).map((x) => (
            <option key={x} value={x}>
              {t(`soc2.filter.${x}`)}
            </option>
          ))}
        </Select>
        {edit && (
          <Button variant="secondary" disabled={pbc.isPending} onClick={() => pbc.mutate()}>
            <ListPlus size={15} /> {t("soc2.pbcTemplate")}
          </Button>
        )}
        {can("controls:write") && (
          <Button variant="secondary" disabled={cross.isPending} onClick={async () => (await askConfirm(t("soc2.crosswalkConfirm"))) && cross.mutate()}>
            {t("soc2.crosswalk")}
          </Button>
        )}
        {edit && can("controls:test") && d.reportType === "type2" && d.periodFrom && d.periodTo && (
          <Button variant="secondary" disabled={mon.isPending} onClick={() => mon.mutate()} title={t("mon.soc2Hint")}>
            {t("mon.soc2Btn")}
          </Button>
        )}
        {pbc.data && <span className="text-sm text-slate-600">{t("soc2.pbcCreated", { n: pbc.data.created })}</span>}
        {mon.data && (
          <span className="text-sm text-slate-600" title={mon.data.failed.join("\n") || undefined}>
            {t("mon.soc2Done", { n: mon.data.created, skipped: mon.data.skipped, failed: mon.data.failed.length })}
          </span>
        )}
        {cross.data && <span className="text-sm text-slate-600">{t("soc2.crosswalkDone", { n: cross.data.total })}</span>}
      </div>
      <ErrorBox error={pbc.error ?? cross.error ?? mon.error} />
      <Card className="overflow-hidden" data-testid="soc2-criteria">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("soc2.criterion")}</th>
              <th className="px-3 py-2">{t("soc2.controls")}</th>
              <th className="px-3 py-2">{t("soc2.tests")}</th>
              <th className="px-3 py-2">PBC</th>
              <th className="px-3 py-2">{t("soc2.conclusion")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const head = r.section !== lastSection;
              lastSection = r.section;
              const failed = r.tests.reduce((n, x) => n + x.failed, 0);
              const open = openId === r.id;
              return [
                head && (
                  <tr key={`h-${r.section}`} className="bg-slate-50/60">
                    <td colSpan={5} className="px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {r.section} – {t.lbl(r.sectionTitle)}
                    </td>
                  </tr>
                ),
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(open ? null : r.id)}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-start gap-1.5">
                      {open ? <ChevronDown size={14} className="mt-0.5 text-slate-400" /> : <ChevronRight size={14} className="mt-0.5 text-slate-400" />}
                      <div>
                        <span className="mr-2 font-mono text-xs font-semibold">{r.id}</span>
                        {t.lbl(r.label)}
                        <div className="text-xs text-slate-500">
                          {r.cz409.join(", ") || "—"} · ISO {r.iso.join(", ") || "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">{r.controls.length ? r.controls.length : <span className="text-amber-800">{t("soc2.none")}</span>}</td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.tests.length ? `${r.tests.filter((x) => x.status === "completed").length}/${r.tests.length}` : <span className="text-amber-800">{t("soc2.none")}</span>}
                    {failed > 0 && <span className="ml-1 text-red-700">· {t("soc2.failedN", { n: failed })}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{r.pbc.total ? `${r.pbc.accepted}/${r.pbc.total}` : "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={conclTone[r.workpaper.conclusion]}>{t.lbl(SOC2_LABELS.conclusion[r.workpaper.conclusion])}</Badge>
                    {r.exceptions.length > 0 && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-xs text-amber-800">
                        <AlertTriangle size={12} />
                        {r.exceptions.length}
                      </span>
                    )}
                  </td>
                </tr>,
                open && (
                  <tr key={`d-${r.id}`}>
                    <td colSpan={5} className="bg-slate-50/40 px-5 py-4">
                      <CriterionDetail d={d} r={r} edit={edit} onSaved={onSaved} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function CriterionDetail({ d, r, edit, onSaved }: { d: Soc2DetailDto; r: Soc2CriterionRow; edit: boolean; onSaved: (x: Soc2DetailDto) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [concl, setConcl] = useState<Soc2Conclusion>(r.workpaper.conclusion);
  const [note, setNote] = useState(r.workpaper.note ?? "");
  const [ex, setEx] = useState<{ title: string; description: string; testId: string } | null>(null);
  const [resp, setResp] = useState<Record<string, string>>(Object.fromEntries(r.exceptions.map((e) => [e.id, e.managementResponse ?? ""])));
  const wp = useMutation({ mutationFn: () => api.soc2.workpaper(d.id, r.id, concl, note || null), onSuccess: onSaved });
  const addEx = useMutation({
    mutationFn: () => api.soc2.exception(d.id, { criterion: r.id, testId: ex!.testId || null, title: ex!.title, description: ex!.description || null }),
    onSuccess: (x) => {
      setEx(null);
      onSaved(x);
    },
  });
  const saveResp = useMutation({
    mutationFn: (id: string) => api.audits.updateFinding(d.auditId, id, { correctiveAction: resp[id] || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["soc2", "detail", d.id] }),
  });
  const ctlName = (id: string) => r.controls.find((c) => c.id === id);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{t("soc2.controls")}</div>
          {r.controls.length ? (
            <ul className="space-y-1 text-sm">
              {r.controls.map((c) => (
                <li key={c.id}>
                  <Link to="/controls/$controlId" params={{ controlId: c.id }} className="hover:text-brand-700">
                    <b>{c.code}</b> {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-800">{t("soc2.noControlsHint")}</p>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{d.reportType === "type2" ? t("soc2.testsOperating") : t("soc2.testsDesign")}</div>
          {r.tests.length ? (
            <ul className="space-y-1.5 text-sm">
              {r.tests.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2">
                  <Link to="/controls/tests/$testId" params={{ testId: x.id }} className="hover:text-brand-700">
                    {x.title || ctlName(x.controlId)?.name}
                  </Link>
                  <Badge tone={testTone(x.result)}>{x.result ? t(`soc2.result.${x.result as ControlTestResult}`) : t(`soc2.status.${x.status as TestStatus}`)}</Badge>
                  <span className="text-xs text-slate-500">
                    {t("soc2.samples", { n: x.samples, failed: x.failed })}
                    {x.periodFrom && ` · ${fmtDay(x.periodFrom)} – ${x.periodTo ? fmtDay(x.periodTo) : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-800">{t("soc2.noTestsHint")}</p>
          )}
        </div>
        <div className="text-xs text-slate-600">{t("soc2.pbcState", { total: r.pbc.total, open: r.pbc.open, submitted: r.pbc.submitted, accepted: r.pbc.accepted })}</div>
      </div>
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-slate-500">{t("soc2.exceptions")}</span>
            {edit && !ex && (
              <Button variant="secondary" onClick={() => setEx({ title: "", description: "", testId: r.tests.find((x) => x.failed > 0)?.id ?? "" })}>
                <Plus size={14} /> {t("soc2.addException")}
              </Button>
            )}
          </div>
          {ex && (
            <div className="mb-3 space-y-2 rounded-md border border-amber-200 bg-white p-3">
              <Input value={ex.title} onChange={(e) => setEx({ ...ex, title: e.target.value })} placeholder={t("soc2.exTitlePh")} aria-label={t("soc2.exTitle")} />
              <Textarea rows={2} value={ex.description} onChange={(e) => setEx({ ...ex, description: e.target.value })} placeholder={t("soc2.exDescPh")} aria-label={t("soc2.exDesc")} />
              <Select value={ex.testId} onChange={(e) => setEx({ ...ex, testId: e.target.value })} aria-label={t("soc2.exTest")}>
                <option value="">{t("soc2.exNoTest")}</option>
                {r.tests.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title || ctlName(x.controlId)?.name}
                  </option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Button disabled={!ex.title.trim() || addEx.isPending} onClick={() => addEx.mutate()}>
                  {t("soc2.save")}
                </Button>
                <Button variant="secondary" onClick={() => setEx(null)}>
                  {t("common.cancelAction")}
                </Button>
              </div>
              <ErrorBox error={addEx.error} />
            </div>
          )}
          {r.exceptions.length ? (
            <ul className="space-y-3 text-sm">
              {r.exceptions.map((e) => (
                <li key={e.id} className="rounded-md border border-slate-200 bg-white p-3">
                  <div className="font-medium">
                    {e.code && <span className="mr-1.5 text-slate-500">{e.code}</span>}
                    {e.title}
                  </div>
                  {e.description && <div className="mt-0.5 whitespace-pre-line text-xs text-slate-600">{e.description}</div>}
                  <Field label={t("soc2.mgmtResponse")}>
                    <Textarea rows={2} value={resp[e.id] ?? ""} disabled={!edit} onChange={(v) => setResp((x) => ({ ...x, [e.id]: v.target.value }))} />
                  </Field>
                  {edit && (resp[e.id] ?? "") !== (e.managementResponse ?? "") && (
                    <Button variant="secondary" className="mt-1" disabled={saveResp.isPending} onClick={() => saveResp.mutate(e.id)}>
                      {t("soc2.save")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !ex && <p className="text-sm text-slate-500">{t("soc2.noExceptions")}</p>
          )}
          <ErrorBox error={saveResp.error} />
        </div>
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase text-slate-500">{t("soc2.workpaper")}</div>
          <fieldset disabled={!edit} className="space-y-2">
            <Select value={concl} onChange={(e) => setConcl(e.target.value as Soc2Conclusion)} aria-label={t("soc2.conclusion")}>
              {SOC2_CONCLUSIONS.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(SOC2_LABELS.conclusion[x])}
                </option>
              ))}
            </Select>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("soc2.wpNotePh")} aria-label={t("soc2.wpNote")} />
            {edit && (
              <Button disabled={wp.isPending} onClick={() => wp.mutate()}>
                <CheckCircle2 size={15} /> {t("soc2.saveWorkpaper")}
              </Button>
            )}
          </fieldset>
          {r.workpaper.at && <div className="text-xs text-slate-500">{t("soc2.wpBy", { who: r.workpaper.byName ?? "—", date: fmtDay(r.workpaper.at.slice(0, 10)) })}</div>}
          <ErrorBox error={wp.error} />
        </div>
      </div>
    </div>
  );
}

function ReportTab({ d }: { d: Soc2DetailDto }) {
  const t = useT();
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title={t("soc2.readiness")} subtitle={t("soc2.readinessSub")} />
        <div className="p-5 pt-0" data-testid="soc2-readiness">
          {d.readiness.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
              {d.readiness.map((g) => (
                <li key={g}>{t.lbl(SOC2_LABELS.gap[g])}</li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2 size={15} /> {t("soc2.ready")}
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">{t("soc2.p.criteria")}</dt>
            <dd>{d.progress.criteria}</dd>
            <dt className="text-slate-500">{t("soc2.p.withControls")}</dt>
            <dd>{d.progress.withControls}</dd>
            <dt className="text-slate-500">{t("soc2.p.tested")}</dt>
            <dd>{d.progress.tested}</dd>
            <dt className="text-slate-500">{t("soc2.p.concluded")}</dt>
            <dd>{d.progress.concluded}</dd>
            <dt className="text-slate-500">{t("soc2.exceptions")}</dt>
            <dd>{d.progress.exceptions}</dd>
          </dl>
        </div>
      </Card>
      <Card>
        <CardHeader title={t("soc2.report")} subtitle={t("soc2.reportSub")} />
        <div className="flex flex-wrap gap-2 p-5 pt-0">
          <a href={api.soc2.reportHtmlUrl(d.id)} target="_blank" rel="noreferrer">
            <Button variant="secondary">
              <Printer size={16} /> {t("soc2.print")}
            </Button>
          </a>
          <a href={api.soc2.reportDocxUrl(d.id)}>
            <Button>
              <FileDown size={16} /> {t("soc2.word")}
            </Button>
          </a>
        </div>
        <p className="px-5 pb-5 text-xs text-slate-500">{t("soc2.reportNote")}</p>
      </Card>
    </div>
  );
}

/** Stav zprávy SOC 2 dodavatele u subdodavatelské organizace a převzetí CSOC ze zprávy (v1.11, ADR-107). */
function SubserviceReport({ supplierId, edit, onPrefill }: { supplierId: string; edit: boolean; onPrefill: (lines: string[]) => number }) {
  const t = useT();
  const [msg, setMsg] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["supplier-reports", supplierId], queryFn: () => api.supplierReports.list(supplierId) });
  const rep = (list.data ?? []).filter((r) => r.kind === "soc2_type2" || r.kind === "soc2_type1").sort((a, b) => (b.periodTo ?? b.asOf ?? "").localeCompare(a.periodTo ?? a.asOf ?? ""))[0];
  const det = useQuery({ queryKey: ["supplier-reports", "detail", rep?.id], queryFn: () => api.supplierReports.get(rep!.id), enabled: !!rep && edit });
  if (!list.data) return null;
  if (!rep) return <p className="text-xs text-amber-700 lg:col-span-2" data-testid="sub-report">{t("soc2.subNoReport")}</p>;
  const csoc = (det.data?.items ?? []).filter((x) => x.kind === "csoc");
  const high = rep.gaps.filter((g) => g.level === "high").length;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs lg:col-span-2" data-testid="sub-report">
      <span className="font-medium text-slate-700">{t("soc2.subReport")}:</span>
      <span>{rep.title}</span>
      <Badge tone="slate">{t.lbl(SUPPLIER_REPORT_LABELS.kind[rep.kind])}</Badge>
      {rep.opinion && <Badge tone={rep.opinion === "unmodified" ? "green" : "red"}>{t.lbl(SUPPLIER_REPORT_LABELS.opinion[rep.opinion])}</Badge>}
      {rep.validUntil && <Badge tone={rep.gaps.some((g) => g.code === "expired") ? "red" : "slate"}>{t("soc2.subReportValid", { date: fmtDay(rep.validUntil) })}</Badge>}
      {rep.gaps.length > 0 && <Badge tone={high ? "red" : "amber"}>{t("soc2.subReportGaps", { n: rep.gaps.length })}</Badge>}
      <Link to="/suppliers/$supplierId" params={{ supplierId }} className="text-brand-700 hover:underline">
        ›
      </Link>
      {edit && det.data && (
        <Button
          variant="secondary"
          className="ml-auto px-2 py-1 text-xs"
          type="button"
          onClick={() => {
            if (!csoc.length) return setMsg(t("soc2.subPrefillNone"));
            const n = onPrefill(csoc.map((x) => `${x.ref ? `${x.ref} ` : ""}${x.text}${x.criterion ? ` [${x.criterion}]` : ""}`));
            setMsg(t("soc2.subPrefillDone", { n }));
          }}
        >
          {t("soc2.subPrefill", { n: csoc.length })}
        </Button>
      )}
      {msg && <span className="w-full text-slate-600">{msg}</span>}
    </div>
  );
}
