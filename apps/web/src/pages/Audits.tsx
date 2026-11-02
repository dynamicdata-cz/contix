import { askConfirm } from "@/components/ui/overlay";
import { TasksCard } from "@/components/tasks";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { AuditRequestsPanel } from "@/components/auditRequests";
import { useDecree, useProfile } from "@/lib/regime";
import { useT } from "@/lib/i18n";
import { AiSuggestPanel } from "@/components/ai";
import { TransferButton } from "@/components/transfer";
import { CompanyCell, useGroupView } from "@/components/company";
import { useMethodologies } from "@/components/methodology";
import { STATUS_COLORS } from "@/components/health";
import { IdMultiSelect, PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe, useModule } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import { type FrameworkId, AUDIT_CHECK_LABELS,
  AUDIT_CHECK_RESULTS,
  type AuditCheckResult,
  AUDIT_LABELS,
  AUDIT_STATUSES,
  AUDIT_TYPES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  requirementsOf,
  type AuditDetail,
  type AuditInput,
  type AuditStatus,
  type AuditType,
  type FindingDto,
  type FindingInput,
  type FindingSeverity,
  type FindingStatus,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

const statusTone: Record<AuditStatus, Tone> = { planned: "slate", in_progress: "blue", completed: "green", cancelled: "slate" };
const sevTone: Record<FindingSeverity, Tone> = { major: "red", minor: "amber", observation: "blue", recommendation: "slate" };
const fStatusTone: Record<FindingStatus, Tone> = { open: "amber", in_progress: "blue", closed: "green", accepted: "slate" };
const covColor = { ok: STATUS_COLORS.good, partial: STATUS_COLORS.serious, overdue: STATUS_COLORS.critical };
const covLabel = { ok: "do 2 let", partial: "2–5 let (jen po celcích)", overdue: "neauditováno / > 5 let" };

const sectionsOf = (fw: FrameworkId) => [...new Map(requirementsOf(fw).map((r) => [r.section, r.sectionTitle])).entries()];

export function AuditsPage() {
  const t = useT();
  const group = useGroupView();
  const can = useCan();
  const [tab, setTab] = useState<"audits" | "findings" | "coverage">("audits");
  const decree = useDecree();
  const list = useQuery({ queryKey: ["audits", "list"], queryFn: () => api.audits.list("all") });
  const findings = useQuery({ queryKey: ["audits", "findings"], queryFn: () => api.audits.findings("open"), enabled: tab === "findings" });
  const coverage = useQuery({ queryKey: ["audits", "coverage"], queryFn: api.audits.coverage, enabled: tab === "coverage" });
  const tx = (on: boolean) => cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", on ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800");
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("aud.audityKybernetickeBezpecnosti")}
        subtitle={t("aud.16VyhlC4092025")}
        actions={
          can("audits:write") && (
            <Link to="/audits/new">
              <Button>
                <Plus size={16} /> {t("aud.novyAudit")}
              </Button>
            </Link>
          )
        }
      />
      <div className="mb-6 flex gap-2 border-b border-slate-200">
        <button className={tx(tab === "audits")} onClick={() => setTab("audits")}>
          {t("aud.planAAudity")}
        </button>
        <button className={tx(tab === "findings")} onClick={() => setTab("findings")}>
          {t("aud.otevrenaZjisteni")}
        </button>
        <button className={tx(tab === "coverage")} onClick={() => setTab("coverage")}>
          {t("aud.pokrytiVyhlasky")}
        </button>
      </div>
      <ErrorBox error={list.error ?? findings.error ?? coverage.error} />
      {tab === "audits" && (
        <Card className="overflow-hidden">
          {(list.data ?? []).length === 0 ? (
            <EmptyState>{t("aud.zatimZadnyAuditZaloztePlan")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("aud.audit")}</th>
                  <th className="px-3 py-2">{t("aud.stav")}</th>
                  <th className="px-3 py-2">{t("aud.termin")}</th>
                  <th className="px-3 py-2">{t("aud.auditor")}</th>
                  <th className="px-3 py-2">{t("aud.zjisteni")}</th>
                  <th className="px-3 py-2">{t("aud.mezery")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.data!.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link to="/audits/$auditId" params={{ auditId: a.id }} className="font-medium hover:text-brand-700">
                        {a.code && <span className="mr-1.5 text-slate-500">{a.code}</span>}
                        {a.title}
                      </Link>
                      {group && <div><CompanyCell id={a.companyId} /></div>}
                      <div className="text-xs text-slate-500">
                        {t.lbl(AUDIT_LABELS.type[a.auditType])}
                        {a.sections.length > 0 && ` · ${a.sections.join(", ")}`}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={statusTone[a.status]}>{t.lbl(AUDIT_LABELS.status[a.status])}</Badge>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{a.performedEnd ? fmtDay(a.performedEnd) : a.plannedStart ? t("aud.plan", { p: fmtDay(a.plannedStart) }) : "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{a.auditorName ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {FINDING_SEVERITIES.filter((s) => a.findings[s]).map((s) => (
                          <Badge key={s} tone={sevTone[s]}>
                            {a.findings[s]} {AUDIT_LABELS.severity[s].toLowerCase()}
                          </Badge>
                        ))}
                      </div>
                      {a.overdueFindings > 0 && <div className="text-xs text-red-700">{t("aud.poTerminu", { overdueFindings: a.overdueFindings })}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {a.gaps.length ? (
                        <span className="inline-flex items-center gap-1 text-amber-800" title={a.gaps.join("\n")}>
                          <AlertTriangle size={13} color={STATUS_COLORS.serious} /> {a.gaps.length}
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
      )}
      {tab === "findings" && (
        <Card className="overflow-hidden">
          {(findings.data ?? []).length === 0 ? <EmptyState>{t("aud.zadnaOtevrenaZjisteni")}</EmptyState> : <FindingTable rows={findings.data!} showAudit />}
        </Card>
      )}
      {tab === "coverage" && (
        <Card className="overflow-hidden">
          <CardHeader title={t("aud.pokrytiOddiluVyhlaskyC2025", { p: decree === "cz410" ? "410" : "409" })} subtitle={t("aud.auditVPlnemRozsahuBez")} />
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("aud.oddil")}</th>
                <th className="px-3 py-2">{t("aud.posledniAudit")}</th>
                <th className="px-3 py-2">{t("aud.stav")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(coverage.data ?? []).map((c) => (
                <tr key={c.section}>
                  <td className="px-5 py-2">
                    <span className="mr-2 font-medium">{c.section}</span>
                    <span className="text-slate-600">{c.title}</span>
                  </td>
                  <td className="px-3 py-2">
                    {c.lastAuditId ? (
                      <Link to="/audits/$auditId" params={{ auditId: c.lastAuditId }} className="hover:underline">
                        {fmtDay(c.lastAudit)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: covColor[c.state] }} /> {t.lbl(covLabel[c.state])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function FindingTable({ rows, showAudit, onEdit }: { rows: FindingDto[]; showAudit?: boolean; onEdit?: (f: FindingDto) => void }) {
  const t = useT();
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-5 py-2">{t("aud.zjisteni")}</th>
          {showAudit && <th className="px-3 py-2">{t("aud.audit")}</th>}
          <th className="px-3 py-2">{t("aud.zavaznost")}</th>
          <th className="px-3 py-2">{t("aud.napravneOpatreni")}</th>
          <th className="px-3 py-2">{t("aud.odpovednost")}</th>
          <th className="px-3 py-2">{t("aud.termin")}</th>
          <th className="px-3 py-2">{t("aud.stav")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((f) => (
          <tr key={f.id} className="align-top hover:bg-slate-50">
            <td className="px-5 py-2.5">
              {onEdit ? (
                <button className="text-left font-medium hover:text-brand-700" onClick={() => onEdit(f)}>
                  {f.code && <span className="mr-1.5 text-slate-500">{f.code}</span>}
                  {f.title}
                </button>
              ) : (
                <span className="font-medium">
                  {f.code && <span className="mr-1.5 text-slate-500">{f.code}</span>}
                  {f.title}
                </span>
              )}
              {f.requirementRef && <div className="text-xs text-slate-500">{f.requirementRef}</div>}
              {f.riskName && f.riskId && (
                <div className="text-xs text-slate-500">
                  <Link to="/risks/$riskId" params={{ riskId: f.riskId }} className="hover:text-brand-700 hover:underline">
                    {t("aud.riziko", { riskName: f.riskName })}
                  </Link>
                </div>
              )}
              {f.controlLabel && f.controlId && (
                <div className="text-xs text-slate-500">
                  <Link to="/controls/$controlId" params={{ controlId: f.controlId }} className="hover:text-brand-700 hover:underline">
                    {t("aud.finding.control", { name: f.controlLabel })}
                  </Link>
                </div>
              )}
            </td>
            {showAudit && (
              <td className="px-3 py-2.5 text-xs">
                <Link to="/audits/$auditId" params={{ auditId: f.auditId }} className="hover:underline">
                  {f.auditCode ?? f.auditTitle}
                </Link>
              </td>
            )}
            <td className="px-3 py-2.5">
              <Badge tone={sevTone[f.severity]}>{t.lbl(AUDIT_LABELS.severity[f.severity])}</Badge>
            </td>
            <td className="max-w-xs px-3 py-2.5 text-xs text-slate-600">{f.correctiveAction ?? <span className="text-amber-700">{t("aud.neurceno")}</span>}</td>
            <td className="px-3 py-2.5 text-slate-600">{f.ownerPositionName ?? "—"}</td>
            <td className={cn("px-3 py-2.5 whitespace-nowrap", f.overdue ? "font-medium text-red-700" : "text-slate-600")}>
              {f.dueDate ? fmtDay(f.dueDate) : "—"}
              {f.overdue && " ⚠"}
            </td>
            <td className="px-3 py-2.5">
              <Badge tone={fStatusTone[f.status]}>{t.lbl(AUDIT_LABELS.findingStatus[f.status])}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditDetailPage() {
  const { auditId } = useParams({ strict: false }) as { auditId: string };
  const q = useQuery({ queryKey: ["audits", "detail", auditId], queryFn: () => api.audits.get(auditId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <AuditEditor key={q.data.id} a={q.data} />;
}

export const AuditNewPage = () => <AuditEditor a={null} />;

function AuditEditor({ a }: { a: AuditDetail | null }) {
  const t = useT();
  // nový audit: kontrolní seznam podle hlavního rámce regulatorního profilu (ADR-080)
  const profile = useProfile();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = a ? a.canEdit : can("audits:write");
  const [f, setF] = useState({
    code: a?.code ?? "",
    title: a?.title ?? "",
    auditType: a?.auditType ?? ("regular" as AuditType),
    status: a?.status ?? ("planned" as AuditStatus),
    sections: a?.sections ?? [],
    scope: a?.scope ?? "",
    plannedStart: a?.plannedStart ?? "",
    plannedEnd: a?.plannedEnd ?? "",
    performedStart: a?.performedStart ?? "",
    performedEnd: a?.performedEnd ?? "",
    auditorName: a?.auditorName && a.auditorName !== a.auditorPositionName ? a.auditorName : "",
    auditorPositionId: a?.auditorPositionId ?? null,
    auditorExternal: a?.auditorExternal ?? false,
    auditorQualified: a?.auditorQualified ?? false,
    auditorIndependent: a?.auditorIndependent ?? false,
    conclusion: a?.conclusion ?? "",
    reportRef: a?.reportRef ?? "",
    managementInformedAt: a?.managementInformedAt ?? "",
    supplierId: a?.supplierId ?? null,
    changeIds: a?.changes.map((c) => c.id) ?? [],
    methodologyKey: a ? a.methodologyKey : profile.auditMethodology,
  });
  const methods = useMethodologies();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [finding, setFinding] = useState<FindingDto | "new" | null>(null);
  const changes = useQuery({ queryKey: ["isms", "changes", "", "significant"], queryFn: () => api.isms.changes({ status: "significant" }), enabled: mod("isms") && can("isms:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "", false], queryFn: () => api.suppliers.list(), enabled: mod("suppliers") && can("suppliers:read") });
  const nz = (v: string) => (v ? v : null);
  const body = (): AuditInput => ({
    ...f,
    code: nz(f.code),
    scope: nz(f.scope),
    plannedStart: nz(f.plannedStart),
    plannedEnd: nz(f.plannedEnd),
    performedStart: nz(f.performedStart),
    performedEnd: nz(f.performedEnd),
    auditorName: nz(f.auditorName),
    conclusion: nz(f.conclusion),
    reportRef: nz(f.reportRef),
    managementInformedAt: nz(f.managementInformedAt),
  });
  const done = (d: AuditDetail) => {
    qc.invalidateQueries({ queryKey: ["audits"] });
    qc.setQueryData(["audits", "detail", d.id], d);
    if (!a) nav({ to: "/audits/$auditId", params: { auditId: d.id } });
  };
  const save = useMutation({ mutationFn: () => (a ? api.audits.update(a.id, body()) : api.audits.create(body())), onSuccess: done });
  const del = useMutation({
    mutationFn: () => api.audits.remove(a!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["audits"] });
      nav({ to: "/audits" });
    },
  });
  const decree = useDecree(a?.companyId);
  const SECTIONS = sectionsOf(decree);
  const allSections = f.sections.length === SECTIONS.length;

  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/audits" className="hover:text-brand-700">
          {t("aud.audity")}
        </Link>
      </div>
      <PageHeader
        title={a ? `${a.code ? `${a.code} ` : ""}${a.title}` : t("aud.novyAudit")}
        subtitle={a ? `${t.lbl(AUDIT_LABELS.type[a.auditType])} · ${t.lbl(AUDIT_LABELS.status[a.status])}` : t("aud.planAudituKybernetickeBezpecnosti16")}
        actions={
          <>
            {a && edit && <TransferButton entity="audits" id={a.id} companyId={a.companyId} />}
            {a && edit && (
              <Button variant="danger" onClick={async () => (await askConfirm(t("aud.smazatAuditVcetneZjisteni"))) && del.mutate()}>
                <Trash2 size={16} />
              </Button>
            )}
            {edit && (
              <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
                {a ? t("aud.ulozit") : t("common.create")}
              </Button>
            )}
          </>
        }
      />
      {a && a.gaps.length > 0 && (
        <div className="mb-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {a.gaps.map((g) => (
            <div key={g} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" color={STATUS_COLORS.serious} /> {g}
            </div>
          ))}
        </div>
      )}
      {save.isSuccess && <SuccessBox>{t("aud.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("aud.audit")} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("aud.kod")}>
                <Input value={f.code} disabled={!edit} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label={t("aud.nazev")}>
                <Input value={f.title} disabled={!edit} onChange={(e) => set("title", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aud.druh")}>
                <Select value={f.auditType} disabled={!edit} onChange={(e) => set("auditType", e.target.value as AuditType)}>
                  {AUDIT_TYPES.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(AUDIT_LABELS.type[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("aud.stav")}>
                <Select value={f.status} disabled={!edit} onChange={(e) => set("status", e.target.value as AuditStatus)}>
                  {AUDIT_STATUSES.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(AUDIT_LABELS.status[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("aud.planOd")}>
                <Input type="date" value={f.plannedStart} disabled={!edit} onChange={(e) => set("plannedStart", e.target.value)} />
              </Field>
              <Field label={t("aud.planDo")}>
                <Input type="date" value={f.plannedEnd} disabled={!edit} onChange={(e) => set("plannedEnd", e.target.value)} />
              </Field>
              <Field label={t("aud.provedenOd")}>
                <Input type="date" value={f.performedStart} disabled={!edit} onChange={(e) => set("performedStart", e.target.value)} />
              </Field>
              <Field label={t("aud.dokoncen")}>
                <Input type="date" value={f.performedEnd} disabled={!edit} onChange={(e) => set("performedEnd", e.target.value)} />
              </Field>
            </div>
            <Field label={t("aud.rozsahPopis")} hint={t("aud.16Odst2ZavedeniOpatreni")}>
              <Textarea rows={3} value={f.scope} disabled={!edit} onChange={(e) => set("scope", e.target.value)} />
            </Field>
            <Field label={t("aud.metodikaKontrolniSeznam")} hint={t("aud.vestavenySeznamDleVyhlaskyPolozky")}>
              <Select value={f.methodologyKey ?? ""} disabled={!edit} onChange={(e) => set("methodologyKey", e.target.value || null)}>
                <option value="">{t("aud.bezKontrolnihoSeznamu")}</option>
                {(methods.data ?? [])
                  .filter((m) => m.kind === "audit")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {f.auditType === "supplier" && mod("suppliers") && (
              <Field label={t("aud.dodavatel")}>
                <Select value={f.supplierId ?? ""} disabled={!edit} onChange={(e) => set("supplierId", e.target.value || null)}>
                  <option value="">—</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {mod("isms") && can("isms:read") && (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("aud.vyznamneZmenyVRozsahuAuditu")}</div>
                <IdMultiSelect
                  linkKind="change"
                  value={f.changeIds}
                  onChange={(v) => set("changeIds", v)}
                  disabled={!edit}
                  placeholder={t("aud.pridatZmenu")}
                  emptyLabel={t("aud.zadne")}
                  options={(changes.data ?? []).map((c) => ({ id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.title}` }))}
                  known={(a?.changes ?? []).map((c) => ({ id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.title}` }))}
                />
                <p className="mt-1 text-xs text-slate-500">{t("aud.poDokonceniAudituSeU")}</p>
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title={t("aud.auditor5Odst4")} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aud.funkcniMistoInterniAuditor")} hint={t("aud.kontrolujeSeZdaNezastavaJinou")}>
                <PositionSelect value={f.auditorPositionId} disabled={!edit} onChange={(v) => set("auditorPositionId", v)} emptyLabel={t("aud.externiJenJmeno")} />
              </Field>
              <Field label={t("aud.jmenoSpolecnost")}>
                <Input value={f.auditorName} disabled={!edit} onChange={(e) => set("auditorName", e.target.value)} />
              </Field>
            </div>
            <Checkbox checked={f.auditorExternal} disabled={!edit} onChange={(v) => set("auditorExternal", v)} label={t("aud.externiAuditor")} />
            <Checkbox
              checked={f.auditorQualified}
              disabled={!edit}
              onChange={(v) => set("auditorQualified", v)}
              label={t("aud.vyskolenADolozenaPraxeS")}
              hint={t("aud.5Odst4PismA")}
            />
            <Checkbox checked={f.auditorIndependent} disabled={!edit} onChange={(v) => set("auditorIndependent", v)} label={t("aud.nestrannostProvedeniAudituZarucena")} hint={t("aud.5Odst4PismB")} />
          </div>
          <CardHeader title={t("aud.vysledek")} />
          <div className="space-y-4 p-5">
            <Field label={t("aud.zaverAuditu")}>
              <Textarea rows={3} value={f.conclusion} disabled={!edit} onChange={(e) => set("conclusion", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aud.zpravaZAudituOdkazC")}>
                <Input value={f.reportRef} disabled={!edit} onChange={(e) => set("reportRef", e.target.value)} />
              </Field>
              <Field label={t("aud.vedeniSeznamenoSVysledky")} hint={t("aud.4Odst2PismE")}>
                <Input type="date" value={f.managementInformedAt} disabled={!edit} onChange={(e) => set("managementInformedAt", e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={t("aud.rozsahOddilyVyhlaskyC2025", { p: decree === "cz410" ? "410" : "409" })}
          subtitle={t("aud.proSledovaniPokryti16Odst")}
          action={
            edit && (
              <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => set("sections", allSections ? [] : SECTIONS.map(([s]) => s))}>
                {allSections ? t("aud.zrusitVyber") : t("aud.celyRozsah")}
              </Button>
            )
          }
        />
        <div className="grid gap-x-6 gap-y-1.5 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map(([s, title]) => (
            <Checkbox key={s} checked={f.sections.includes(s)} disabled={!edit} onChange={(v) => set("sections", v ? [...f.sections, s] : f.sections.filter((x) => x !== s))} label={`${s} ${title}`} />
          ))}
        </div>
      </Card>

      {a?.methodologyKey && <ChecklistCard audit={a} edit={edit} />}

      {a && (
        <Card className="mt-6 overflow-hidden">
          <CardHeader
            title={t("aud.zjisteniANapravnaOpatreni")}
            subtitle={t("aud.16Odst3VysledkyZahrnout")}
            action={
              edit && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setFinding("new")}>
                  <Plus size={14} /> {t("aud.zjisteni")}
                </Button>
              )
            }
          />
          {a.findingList.length === 0 ? <EmptyState>{t("aud.zadnaZjisteni")}</EmptyState> : <FindingTable rows={a.findingList} onEdit={(x) => setFinding(x)} />}
        </Card>
      )}
      {a && <AuditRequestsPanel auditId={a.id} />}
      {a && finding && <FindingModal audit={a} finding={finding === "new" ? null : finding} edit={edit} onClose={() => setFinding(null)} onDone={done} />}
      {a && <TasksCard kind="audit" id={a.id} className="mt-6" />}
    </>
  );
}

function FindingModal({ audit, finding, edit, onClose, onDone }: { audit: AuditDetail; finding: FindingDto | null; edit: boolean; onClose: () => void; onDone: (d: AuditDetail) => void }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const decree = useDecree(audit.companyId);
  const reqs = useMemo(() => requirementsOf(decree), [decree]);
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });
  const [f, setF] = useState({
    code: finding?.code ?? "",
    title: finding?.title ?? "",
    description: finding?.description ?? "",
    severity: finding?.severity ?? ("minor" as FindingSeverity),
    status: finding?.status ?? ("open" as FindingStatus),
    requirementId: finding?.requirementId ?? null,
    correctiveAction: finding?.correctiveAction ?? "",
    ownerPositionId: finding?.ownerPositionId ?? null,
    dueDate: finding?.dueDate ?? "",
    closedAt: finding?.closedAt ?? "",
    verification: finding?.verification ?? "",
    riskId: finding?.riskId ?? null,
    controlId: finding?.controlId ?? null,
    awareness: finding?.awareness ?? false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const nz = (v: string) => (v ? v : null);
  const body = (): FindingInput => ({ ...f, code: nz(f.code), description: nz(f.description), correctiveAction: nz(f.correctiveAction), dueDate: nz(f.dueDate), closedAt: nz(f.closedAt), verification: nz(f.verification) });
  const save = useMutation({
    mutationFn: () => (finding ? api.audits.updateFinding(audit.id, finding.id, body()) : api.audits.addFinding(audit.id, body())),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: () => api.audits.deleteFinding(audit.id, finding!.id),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={finding ? finding.title : t("aud.noveZjisteni")}
      footer={
        <>
          {finding && edit && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("aud.smazatZjisteni"))) && del.mutate()}>
              <Trash2 size={14} />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {edit && (
            <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
              {t("aud.ulozit")}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field label={t("aud.kod")}>
          <Input value={f.code} disabled={!edit} onChange={(e) => set("code", e.target.value)} />
        </Field>
        <Field label={t("aud.zjisteni")}>
          <Input value={f.title} disabled={!edit} onChange={(e) => set("title", e.target.value)} />
        </Field>
      </div>
      <Field label={t("aud.popisADukazy")}>
        <Textarea rows={3} value={f.description} disabled={!edit} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("aud.zavaznost")}>
          <Select value={f.severity} disabled={!edit} onChange={(e) => set("severity", e.target.value as FindingSeverity)}>
            {FINDING_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(AUDIT_LABELS.severity[s])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("aud.stav")}>
          <Select value={f.status} disabled={!edit} onChange={(e) => set("status", e.target.value as FindingStatus)}>
            {FINDING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(AUDIT_LABELS.findingStatus[s])}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("aud.pozadavekVyhlaskyC4092025")}>
        <Select value={f.requirementId ?? ""} disabled={!edit} onChange={(e) => set("requirementId", e.target.value || null)}>
          <option value="">{t("aud.bezVazby")}</option>
          {reqs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.ref} – {r.text.slice(0, 90)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("aud.napravneOpatreni16Odst3")}>
        <Textarea rows={2} value={f.correctiveAction} disabled={!edit} onChange={(e) => set("correctiveAction", e.target.value)} />
      </Field>
      {finding && (
        <AiSuggestPanel
          useCase="finding_remediation"
          entityId={finding.id}
          canApply={edit}
          onApplied={async () => {
            const d = await api.audits.get(audit.id);
            onDone(d);
            const all = await api.audits.findings("all");
            const fresh = all.find((x) => x.id === finding.id);
            if (fresh) set("correctiveAction", fresh.correctiveAction ?? "");
          }}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("aud.odpovednost")}>
          <PositionSelect value={f.ownerPositionId} disabled={!edit} onChange={(v) => set("ownerPositionId", v)} />
        </Field>
        <Field label={t("aud.termin")}>
          <Input type="date" value={f.dueDate} disabled={!edit} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        <Field label={t("aud.uzavreno")}>
          <Input type="date" value={f.closedAt} disabled={!edit} onChange={(e) => set("closedAt", e.target.value)} />
        </Field>
      </div>
      <Field label={t("aud.overeniUcinnostiNapravy")}>
        <Textarea rows={2} value={f.verification} disabled={!edit} onChange={(e) => set("verification", e.target.value)} />
      </Field>
      {mod("risks") && can("risks:read") && (
        <Field label={t("aud.zahrnutoDoRizeniRizikRiziko")}>
          <Select value={f.riskId ?? ""} disabled={!edit} onChange={(e) => set("riskId", e.target.value || null)}>
            <option value="">—</option>
            {(risks.data?.items ?? [])
              .filter((r) => r.companyId === audit.companyId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code ? `${r.code} ` : ""}
                  {r.name}
                </option>
              ))}
          </Select>
        </Field>
      )}
      {mod("controls") && can("controls:read") && (
        <Field label={t("aud.finding.controlField")}>
          <Select value={f.controlId ?? ""} disabled={!edit} onChange={(e) => set("controlId", e.target.value || null)}>
            <option value="">—</option>
            {(controls.data ?? [])
              .filter((x) => x.companyId === audit.companyId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code ? `${x.code} ` : ""}
                  {x.name}
                </option>
              ))}
          </Select>
        </Field>
      )}
      <Checkbox checked={f.awareness} disabled={!edit} onChange={(v) => set("awareness", v)} label={t("aud.zahrnutoDoPlanuRozvojeBezpecnostniho")} />
      <ErrorBox error={save.error ?? del.error} />
    </Modal>
  );
}

const CHECK_TONE: Record<AuditCheckResult, Tone> = { not_checked: "slate", conform: "green", partial: "amber", nonconform: "red", not_applicable: "slate" };

/** Kontrolní seznam auditu podle metodiky – výsledek u každé položky, z neshody se zakládá zjištění. */
function ChecklistCard({ audit, edit }: { audit: AuditDetail; edit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const key = ["audits", "checklist", audit.id];
  const q = useQuery({ queryKey: key, queryFn: () => api.audits.checklist(audit.id) });
  const [filter, setFilter] = useState<"all" | "open" | "issues">("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const check = useMutation({
    mutationFn: (v: { itemId: string; result: AuditCheckResult; note?: string | null }) => api.audits.check(audit.id, v),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  const finding = useMutation({
    mutationFn: (itemId: string) => api.audits.findingFromCheck(audit.id, itemId),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      qc.invalidateQueries({ queryKey: ["audits"] });
    },
  });
  const d = q.data;
  const items = (d?.items ?? []).filter((i) =>
    filter === "open" ? i.result === "not_checked" : filter === "issues" ? i.result === "nonconform" || i.result === "partial" : true,
  );
  const total = d?.items.length ?? 0;
  const checked = total - (d?.summary.not_checked ?? 0);
  let lastSection: string | null = null;
  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader
        title={t("aud.kontrolniSeznam", { p: d?.methodologyName ?? audit.methodologyName ?? audit.methodologyKey })}
        subtitle={
          d
            ? `${t("aud.overenoZ", { checked, total })} · ${AUDIT_CHECK_RESULTS.filter((r) => r !== "not_checked" && d.summary[r])
                .map((r) => `${t.lbl(AUDIT_CHECK_LABELS[r]).toLowerCase()} ${d.summary[r]}`)
                .join(", ") || t("aud.zatimBezVysledku")}`
            : undefined
        }
        action={
          <div className="flex rounded-md border border-slate-300 p-0.5 text-xs">
            {(
              [
                ["all", t("common.all")],
                ["open", t("aud.neoverene")],
                ["issues", "Neshody"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={cn("rounded px-2 py-1", filter === k ? "bg-brand-50 text-brand-700" : "text-slate-600")}>
                {l}
              </button>
            ))}
          </div>
        }
      />
      <ErrorBox error={q.error ?? check.error ?? finding.error} />
      {d && total === 0 && <EmptyState>{t("aud.metodikaNeniDostupnaNeboRozsah")}</EmptyState>}
      {total > 0 && (
        <div className="h-1.5 bg-slate-100">
          <div className="h-full bg-brand-500" style={{ width: `${(checked / total) * 100}%` }} />
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {items.map((i) => {
          const head = i.section && i.section !== lastSection ? i.section : null;
          lastSection = i.section;
          return (
            <div key={i.itemId}>
              {head && <div className="bg-slate-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{head}</div>}
              <div className="grid gap-3 px-5 py-3 md:grid-cols-[1fr_11rem]">
                <div className="min-w-0 text-sm">
                  {i.ref && <span className="mr-1.5 text-xs font-medium text-slate-500">{i.ref}</span>}
                  {i.question}
                  {i.guidance && <p className="mt-1 whitespace-pre-line text-xs text-slate-500">{i.guidance}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      className="max-w-md py-1 text-xs"
                      placeholder={t("aud.poznamkaDukaz")}
                      disabled={!edit}
                      value={notes[i.itemId] ?? i.note ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [i.itemId]: e.target.value }))}
                      onBlur={() => {
                        const v = notes[i.itemId];
                        if (v !== undefined && v !== (i.note ?? "")) check.mutate({ itemId: i.itemId, result: i.result, note: v || null });
                      }}
                    />
                    {i.findingId ? (
                      <Badge tone="violet">{t("aud.zjisteni2")} {i.findingCode ?? t("aud.zalozeno")}</Badge>
                    ) : (
                      edit &&
                      (i.result === "nonconform" || i.result === "partial") && (
                        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={finding.isPending} onClick={() => finding.mutate(i.itemId)}>
                          <Plus size={12} /> {t("aud.zjisteni")}
                        </Button>
                      )
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Select
                    value={i.result}
                    disabled={!edit}
                    onChange={(e) => check.mutate({ itemId: i.itemId, result: e.target.value as AuditCheckResult, note: notes[i.itemId] ?? i.note })}
                  >
                    {AUDIT_CHECK_RESULTS.map((r) => (
                      <option key={r} value={r}>
                        {t.lbl(AUDIT_CHECK_LABELS[r])}
                      </option>
                    ))}
                  </Select>
                  <Badge tone={CHECK_TONE[i.result]}>{t.lbl(AUDIT_CHECK_LABELS[i.result])}</Badge>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
