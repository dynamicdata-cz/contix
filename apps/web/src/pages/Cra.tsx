import { useFormGuard } from "@/lib/unsaved";
import { Tabs, useTab } from "@/components/ui/tabs";
import { askConfirm } from "@/components/ui/overlay";
import { AiSuggestPanel } from "@/components/ai";
import { TasksCard } from "@/components/tasks";
import { CompanyCell, TargetCompanyField, useGroupView, useTargetCompany } from "@/components/company";
import { AssetPicker, IdMultiSelect, PositionSelect, type PickedAsset } from "@/components/pickers";
import { TransferButton } from "@/components/transfer";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn, fmtDay } from "@/lib/utils";
import {
  CRA_CATEGORIES,
  CRA_CATEGORY_ITEMS,
  CRA_LABELS,
  CRA_MODULES,
  CRA_PRODUCT_TYPES,
  CRA_REPORT_KINDS,
  CRA_REPORT_STAGES,
  CRA_REQ_STATUSES,
  CRA_ROLES,
  CRA_STATUSES,
  OSV_ECOSYSTEMS,
  CRA_SUPPLY_CHECK_STATUSES,
  CRA_SUPPLY_LABELS,
  type CraSupplyCheckItem,
  type CraSupplyCheckStatus,
  VEX_JUSTIFICATIONS,
  VEX_LABELS,
  VEX_STATUSES,
  type CraFindingDto,
  type VexJustification,
  type VexStatus,
  type CraCategory,
  type CraDeadline,
  type CraModule,
  type CraProductDto,
  type CraProductInput,
  type CraProductType,
  type CraReportDto,
  type CraReportKind,
  type CraReportStage,
  type CraReqStatus,
  type CraRole,
  type CraStatus,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, Copy, Download, FileUp, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const catTone: Record<CraCategory, Tone> = { default: "slate", important_1: "blue", important_2: "violet", critical: "red" };
const statusTone: Record<CraStatus, Tone> = { development: "slate", on_market: "green", withdrawn: "amber" };
const reqTone: Record<CraReqStatus, Tone> = { open: "red", in_progress: "amber", done: "green", na: "slate" };
const dlTone: Record<CraDeadline["state"], Tone> = { done: "green", late_done: "amber", open: "blue", overdue: "red", waiting: "slate" };

const toLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const fmtTs = (iso: string | null) => (iso ? `${fmtDay(iso.slice(0, 10))} ${toLocal(iso).slice(11)}` : "—");
const splitList = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/* ============================ přehled ============================ */

export function CraPage() {
  const t = useT();
  const can = useCan();
  const nav = useNavigate();
  const group = useGroupView();
  const [tab, setTab] = useTab(["products", "reports", "advisories", "osv"] as const, "products");
  const q = useQuery({ queryKey: ["cra"], queryFn: () => api.cra.list() });
  const reps = useQuery({ queryKey: ["cra", "reports"], queryFn: () => api.cra.reports(true) });
  const overdue = (reps.data ?? []).filter((r) => r.deadlines.some((d) => d.state === "overdue")).length;
  return (
    <>
      <PageHeader
        title={t("cra.title")}
        subtitle={t("cra.subtitle")}
        actions={
          can("cra:write") && (
            <Button onClick={() => nav({ to: "/cra/new" })}>
              <Plus size={16} /> {t("cra.newProduct")}
            </Button>
          )
        }
      />
      <Card className="mb-4 p-4 text-sm text-slate-700">
        <b>{t("cra.datesTitle")}</b> {t("cra.dates")}
      </Card>
      <Tabs
        label={t("cra.title")}
        value={tab}
        onChange={setTab}
        items={(["products", "reports", "advisories", "osv"] as const).map((x) => ({
          key: x,
          label: t(`cra.tab.${x}`),
          badge: x === "reports" && overdue > 0 ? <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-xs text-red-800">{overdue}</span> : null,
        }))}
      />
      <ErrorBox error={q.error ?? reps.error} />
      {tab === "products" ? (
        <Card className="overflow-hidden">
          {!q.data?.length ? (
            <EmptyState>{q.isLoading ? t("common.loading") : t("cra.empty")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("cra.product")}</th>
                  <th className="px-3 py-2">{t("cra.category")}</th>
                  <th className="px-3 py-2">{t("cra.supportUntil")}</th>
                  <th className="px-3 py-2">{t("cra.requirements")}</th>
                  <th className="px-3 py-2">{t("cra.reports")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.map((p) => {
                  const done = p.requirements.filter((r) => r.status === "done" || r.status === "na").length;
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-2.5">
                        <Link to="/cra/$productId" params={{ productId: p.id }} className="font-medium hover:text-brand-700">
                          {p.code && <span className="mr-1.5 text-slate-500">{p.code}</span>}
                          {p.name} {p.version}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <Badge tone={statusTone[p.status]}>{t.lbl(CRA_LABELS.status[p.status])}</Badge>
                          {t.lbl(CRA_LABELS.role[p.role])}
                          {p.gaps.length > 0 && <span className="text-amber-800">{t("cra.gapsN", { n: p.gaps.length })}</span>}
                        </div>
                        {group && <CompanyCell id={p.companyId} />}
                      </td>
                      <td className="px-3 py-2.5">{p.category ? <Badge tone={catTone[p.category]}>{t.lbl(CRA_LABELS.category[p.category])}</Badge> : <span className="text-xs text-amber-800">{t("cra.notSet")}</span>}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{p.supportUntil ? fmtDay(p.supportUntil) : "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">
                        {done} / {p.requirements.length}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {p.openReports > 0 ? <span className={p.overdueReports ? "font-medium text-red-700" : "text-slate-700"}>{p.overdueReports ? t("cra.reportsOverdue", { n: p.openReports, o: p.overdueReports }) : p.openReports}</span> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      ) : tab === "reports" ? (
        <ReportList reports={reps.data ?? []} showProduct />
      ) : tab === "advisories" ? (
        <AdvisoriesTab />
      ) : (
        <OsvCard />
      )}
    </>
  );
}

function OsvCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  // stahování běží na pozadí (ADR-100) – během běhu se stav obnovuje
  const q = useQuery({ queryKey: ["cra", "osv"], queryFn: () => api.cra.osv(), refetchInterval: (x) => (x.state.data?.runningSince ? 3000 : false) });
  const running = !!q.data?.runningSince;
  const wasRunning = useRef(running);
  useEffect(() => {
    // po dokončení obnovit nálezy produktů
    if (wasRunning.current && !running) qc.invalidateQueries({ queryKey: ["cra"] });
    wasRunning.current = running;
  }, [running, qc]);
  const [f, setF] = useState<{ ecosystems: string[]; autoRefresh: boolean; baseUrl: string } | null>(null);
  const cur = f ?? (q.data ? { ecosystems: q.data.ecosystems, autoRefresh: q.data.autoRefresh, baseUrl: q.data.baseUrl } : null);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["cra"] });
  };
  const save = useMutation({ mutationFn: () => api.cra.saveOsv(cur!), onSuccess: () => (setF(null), done()) });
  const guard = useFormGuard(save);
  const refresh = useMutation({ mutationFn: () => api.cra.refreshOsv(), onSuccess: done });
  const upload = useMutation({ mutationFn: (file: File) => api.cra.uploadOsv(file), onSuccess: done });
  const edit = can("cra:write");
  if (!cur) return <ErrorBox error={q.error} />;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2" data-testid="cra-osv">
      <Card>
        <CardHeader title={t("cra.osv.title")} subtitle={t("cra.osv.sub")} />
        <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5 pt-0">
          <div>
            <div className="mb-1.5 text-sm font-medium text-slate-700">{t("cra.osv.ecosystems")}</div>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {OSV_ECOSYSTEMS.map((e) => (
                <Checkbox key={e} checked={cur.ecosystems.includes(e)} onChange={(v) => setF({ ...cur, ecosystems: v ? [...cur.ecosystems, e] : cur.ecosystems.filter((x) => x !== e) })} label={e} />
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">{t("cra.osv.sizeHint")}</p>
          </div>
          <Checkbox checked={cur.autoRefresh} onChange={(v) => setF({ ...cur, autoRefresh: v })} label={t("cra.osv.auto")} />
          <Field label={t("cra.osv.baseUrl")}>
            <Input value={cur.baseUrl} onChange={(e) => setF({ ...cur, baseUrl: e.target.value })} />
          </Field>
          {edit && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={!f || save.isPending} onClick={() => save.mutate()}>
                {t("cra.save")}
              </Button>
              <Button variant="secondary" disabled={!!f || refresh.isPending || running || !cur.ecosystems.length} onClick={() => refresh.mutate()}>
                {refresh.isPending || running ? t("cra.osv.downloading") : t("cra.osv.refresh")}
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
                <FileUp size={15} /> {t("cra.osv.upload")}
                <input type="file" accept=".zip,.json" className="hidden" aria-label={t("cra.osv.upload")} onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
              </label>
            </div>
          )}
          {running && q.data?.runningSince && <p className="text-sm text-slate-600">{t("cra.osv.running", { since: fmtTs(q.data.runningSince) })}</p>}
          {!running && refresh.isSuccess && q.data?.lastResult && <SuccessBox>{t("cra.osv.done", { records: q.data.lastResult.records, matches: q.data.lastResult.matches })}</SuccessBox>}
          {upload.data && <SuccessBox>{t("cra.osv.done", { records: upload.data.records, matches: upload.data.matches })}</SuccessBox>}
          {!running && refresh.isSuccess && q.data?.lastResult?.errors.map((e) => (
            <p key={e} className="text-sm text-red-700">
              {e}
            </p>
          ))}
          <ErrorBox error={save.error ?? refresh.error ?? upload.error} />
        </fieldset>
      </Card>
      <Card>
        <CardHeader title={t("cra.osv.state")} />
        <div className="space-y-2 p-5 pt-0 text-sm">
          <div>
            {t("cra.osv.lastRun")}: {q.data?.lastRunAt ? fmtTs(q.data.lastRunAt) : "—"}
          </div>
          {running && <div className="text-brand-700">{t("cra.osv.downloading")}</div>}
          {!running && q.data?.lastResult && <div>{t("cra.osv.done", { records: q.data.lastResult.records, matches: q.data.lastResult.matches })}</div>}
          {q.data?.lastError && <div className="text-red-700">{q.data.lastError}</div>}
          {q.data?.counts.length ? (
            <ul className="space-y-0.5">
              {q.data.counts.map((x) => (
                <li key={x.ecosystem}>
                  {x.ecosystem}: {x.records.toLocaleString()}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">{t("cra.osv.empty")}</p>
          )}
          <p className="text-xs text-slate-500">{t("cra.osv.note")}</p>
        </div>
      </Card>
    </div>
  );
}

function Deadlines({ r }: { r: CraReportDto }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {r.deadlines.map((d) => (
        <Badge key={d.stage} tone={dlTone[d.state]}>
          {t(`cra.stageShort.${d.stage}`)}: {d.doneAt ? fmtTs(d.doneAt) : d.due ? fmtTs(d.due) : t("cra.afterFix")}
        </Badge>
      ))}
    </div>
  );
}

function ReportList({ reports, showProduct, onOpen }: { reports: CraReportDto[]; showProduct?: boolean; onOpen?: (r: CraReportDto) => void }) {
  const t = useT();
  return (
    <Card className="overflow-hidden" data-testid="cra-reports">
      {!reports.length ? (
        <EmptyState>{t("cra.noReports")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("cra.report")}</th>
              <th className="px-3 py-2">{t("cra.aware")}</th>
              <th className="px-3 py-2">{t("cra.deadlines")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {reports.map((r) => (
              <tr key={r.id} className={cn(onOpen && "cursor-pointer hover:bg-slate-50")} onClick={() => onOpen?.(r)}>
                <td className="px-5 py-2.5">
                  {showProduct ? (
                    <Link to="/cra/$productId" params={{ productId: r.productId }} className="font-medium hover:text-brand-700">
                      {r.productName} – {r.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.title}</span>
                  )}
                  <div className="mt-0.5 text-xs text-slate-500">
                    {t.lbl(CRA_LABELS.reportKind[r.kind])}
                    {r.cveIds.length > 0 && ` · ${r.cveIds.join(", ")}`}
                    {r.closed && ` · ${t("cra.closed")}`}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-600">{fmtTs(r.awareAt)}</td>
                <td className="px-3 py-2.5">
                  <Deadlines r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ============================ produkt ============================ */

export function CraNewPage() {
  return <ProductEditor p={null} />;
}

export function CraProductPage() {
  const { productId } = useParams({ strict: false }) as { productId: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cra", "detail", productId], queryFn: () => api.cra.get(productId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <>
      <ProductEditor key={q.data.id + q.data.updatedAt} p={q.data} />
      {q.data.supplyChecks.length > 0 && <SupplyChecksCard p={q.data} />}
      <RequirementsCard p={q.data} />
      <CraLinksCard p={q.data} />
      <SbomCard p={q.data} />
      {q.data.openVulns > 0 && (
        <div className="mt-6 empty:hidden">
          <AiSuggestPanel useCase="vex_triage" entityId={q.data.id} canApply={q.data.canEdit} onApplied={() => qc.invalidateQueries({ queryKey: ["cra"] })} />
        </div>
      )}
      <ReportsCard p={q.data} />
      <TasksCard kind="cra_product" id={q.data.id} className="mt-6" />
    </>
  );
}

/** Vazby produktu na aktiva, dodavatele, procesy a rizika (v1.05, ADR-101). */
function CraLinksCard({ p }: { p: CraProductDto }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cra", "links", p.id], queryFn: () => api.cra.links(p.id) });
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const suppliers = useQuery({ queryKey: ["suppliers", "", false], queryFn: () => api.suppliers.list(), enabled: mod("suppliers") && can("suppliers:read") });
  const [f, setF] = useState<{ assets: PickedAsset[]; supplierIds: string[]; processIds: string[]; riskIds: string[] } | null>(null);
  const d = q.data;
  const cur = f ?? (d ? { assets: d.assets, supplierIds: d.suppliers.map((x) => x.id), processIds: d.processes.map((x) => x.id), riskIds: d.risks.map((x) => x.id) } : null);
  const save = useMutation({
    mutationFn: () => api.cra.saveLinks(p.id, { assetIds: cur!.assets.map((a) => a.id), supplierIds: cur!.supplierIds, processIds: cur!.processIds, riskIds: cur!.riskIds }),
    onSuccess: (r) => {
      qc.setQueryData(["cra", "links", p.id], r);
      qc.invalidateQueries({ queryKey: ["links"] });
      setF(null);
    },
  });
  if (!cur || !d) return <ErrorBox error={q.error} />;
  const edit = p.canEdit;
  const label = (x: { code?: string | null; name: string }) => (x.code ? `${x.code} ${x.name}` : x.name);
  return (
    <Card className="mt-6" data-testid="cra-links">
      <CardHeader
        title={t("cra.links.title")}
        subtitle={t("cra.links.sub")}
        action={
          edit && f ? (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("cra.save")}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-4 p-5 md:grid-cols-2">
        {mod("assets") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("cra.links.assets")}</div>
            <AssetPicker value={cur.assets} onChange={(v) => setF({ ...cur, assets: v })} disabled={!edit} />
          </div>
        )}
        {mod("suppliers") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("cra.links.suppliers")}</div>
            <IdMultiSelect linkKind="supplier" value={cur.supplierIds} onChange={(v) => setF({ ...cur, supplierIds: v })} disabled={!edit} options={(suppliers.data ?? []).map((x) => ({ id: x.id, label: x.name }))} known={d.suppliers.map((x) => ({ id: x.id, label: x.name }))} />
          </div>
        )}
        {mod("processes") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("cra.links.processes")}</div>
            <IdMultiSelect linkKind="process" value={cur.processIds} onChange={(v) => setF({ ...cur, processIds: v })} disabled={!edit} options={(processes.data ?? []).map((x) => ({ id: x.id, label: label(x) }))} known={d.processes} />
          </div>
        )}
        {mod("risks") && (
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("cra.links.risks")}</div>
            <IdMultiSelect linkKind="risk" value={cur.riskIds} onChange={(v) => setF({ ...cur, riskIds: v })} disabled={!edit} options={(risks.data?.items ?? []).map((x) => ({ id: x.id, label: label(x) }))} known={d.risks} />
          </div>
        )}
      </div>
      <ErrorBox error={save.error} />
    </Card>
  );
}

function ProductEditor({ p }: { p: CraProductDto | null }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const target = useTargetCompany();
  const edit = p ? p.canEdit : can("cra:write");
  const [f, setF] = useState({
    code: p?.code ?? "",
    name: p?.name ?? "",
    version: p?.version ?? "",
    productType: (p?.productType ?? "software") as CraProductType,
    role: (p?.role ?? "manufacturer") as CraRole,
    status: (p?.status ?? "development") as CraStatus,
    oss: p?.oss ?? false,
    description: p?.description ?? "",
    intendedPurpose: p?.intendedPurpose ?? "",
    category: (p?.category ?? "") as CraCategory | "",
    categoryItem: p?.categoryItem ?? "",
    onMarketSince: p?.onMarketSince ?? "",
    supportUntil: p?.supportUntil ?? "",
    supportJustification: p?.supportJustification ?? "",
    conformityModule: (p?.conformityModule ?? "") as CraModule | "",
    harmonisedStandards: p?.harmonisedStandards ?? "",
    notifiedBody: p?.notifiedBody ?? "",
    ceMarkedAt: p?.ceMarkedAt ?? "",
    docIssuedAt: p?.docIssuedAt ?? "",
    securityContact: p?.securityContact ?? "",
    cvdPolicyUrl: p?.cvdPolicyUrl ?? "",
    manufacturerName: p?.manufacturerName ?? "",
    cpe: p?.cpe ?? "",
    memberStates: (p?.memberStates ?? []).join(", "),
    ownerPositionId: p?.ownerPositionId ?? null,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => v.trim() || null;
  const body = (): CraProductInput => ({
    ...(p ? {} : { companyId: target.companyId }),
    code: n(f.code),
    name: f.name,
    version: n(f.version),
    productType: f.productType,
    role: f.role,
    status: f.status,
    oss: f.oss,
    description: n(f.description),
    intendedPurpose: n(f.intendedPurpose),
    category: f.category || null,
    categoryItem: f.categoryItem || null,
    onMarketSince: f.onMarketSince || null,
    supportUntil: f.supportUntil || null,
    supportJustification: n(f.supportJustification),
    conformityModule: f.conformityModule || null,
    harmonisedStandards: n(f.harmonisedStandards),
    notifiedBody: n(f.notifiedBody),
    ceMarkedAt: f.ceMarkedAt || null,
    docIssuedAt: f.docIssuedAt || null,
    securityContact: n(f.securityContact),
    cvdPolicyUrl: n(f.cvdPolicyUrl),
    manufacturerName: n(f.manufacturerName),
    cpe: n(f.cpe),
    memberStates: splitList(f.memberStates).map((x) => x.toUpperCase()).filter((x) => x.length === 2),
    ownerPositionId: f.ownerPositionId,
  });
  const save = useMutation({
    mutationFn: () => (p ? api.cra.update(p.id, body()) : api.cra.create(body())),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["cra"] });
      qc.setQueryData(["cra", "detail", d.id], d);
      if (!p) nav({ to: "/cra/$productId", params: { productId: d.id } });
    },
  });
  const guard = useFormGuard(save);
  const del = useMutation({
    mutationFn: () => api.cra.remove(p!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cra"] });
      nav({ to: "/cra" });
    },
  });
  const items = CRA_CATEGORY_ITEMS.filter((i) => i.category === f.category);
  const allowed = p?.conformityOptions ?? [];
  const mf = f.role === "manufacturer";
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/cra" className="hover:text-brand-700">
          {t("cra.title")}
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{p ? `${p.code ? `${p.code} ` : ""}${p.name}${p.version ? ` ${p.version}` : ""}` : t("cra.newProduct")}</h1>
          {p && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Badge tone={statusTone[p.status]}>{t.lbl(CRA_LABELS.status[p.status])}</Badge>
              {p.category && <Badge tone={catTone[p.category]}>{t.lbl(CRA_LABELS.category[p.category])}</Badge>}
              <span>{t.lbl(CRA_LABELS.role[p.role])}</span>
              <span>{t("cra.ownerIs", { p: p.ownerPositionName ?? "—" })}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {p && can("cra:write") && <TransferButton entity="cra_products" id={p.id} companyId={p.companyId} />}
          {p && can("cra:write") && (
            <Button variant="danger" aria-label={t("cra.delete")} onClick={async () => (await askConfirm(t("cra.deleteConfirm"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          )}
          {edit && (
            <Button disabled={!f.name.trim() || save.isPending} onClick={() => save.mutate()}>
              {p ? t("cra.save") : t("common.create")}
            </Button>
          )}
        </div>
      </div>
      {save.isSuccess && p && <SuccessBox>{t("cra.saved")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error} />
      {p && p.gaps.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/50 p-4" data-testid="cra-gaps">
          <div className="mb-1 text-sm font-medium text-amber-900">{t("cra.gapsTitle")}</div>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
            {p.gaps.map((g) => (
              <li key={g}>{t.lbl(CRA_LABELS.gap[g])}</li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("cra.basics")} />
          <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5 pt-0">
            {!p && <TargetCompanyField value={target.companyId} onChange={target.setCompanyId} />}
            <div className="grid gap-4 sm:grid-cols-[7rem_1fr_8rem]">
              <Field label={t("cra.code")}>
                <Input value={f.code} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label={t("cra.name")}>
                <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label={t("cra.version")}>
                <Input value={f.version} onChange={(e) => set("version", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("cra.role")}>
                <Select value={f.role} onChange={(e) => set("role", e.target.value as CraRole)}>
                  {CRA_ROLES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(CRA_LABELS.role[x])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("cra.productType")}>
                <Select value={f.productType} onChange={(e) => set("productType", e.target.value as CraProductType)}>
                  {CRA_PRODUCT_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(CRA_LABELS.productType[x])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("cra.status")}>
                <Select value={f.status} onChange={(e) => set("status", e.target.value as CraStatus)}>
                  {CRA_STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(CRA_LABELS.status[x])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {!mf && (
              <Field label={t("cra.manufacturerName")}>
                <Input value={f.manufacturerName} onChange={(e) => set("manufacturerName", e.target.value)} />
              </Field>
            )}
            <Field label={t("cra.cpe")} hint={t("cra.cpeHint")}>
              <Input value={f.cpe} onChange={(e) => set("cpe", e.target.value)} placeholder="cpe:2.3:h:vyrobce:produkt:1.0" className="font-mono" />
            </Field>
            <Field label={t("cra.intendedPurpose")}>
              <Textarea rows={2} value={f.intendedPurpose} onChange={(e) => set("intendedPurpose", e.target.value)} />
            </Field>
            <Field label={t("cra.description")}>
              <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Checkbox checked={f.oss} onChange={(v) => set("oss", v)} label={t("cra.oss")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("cra.memberStates")} hint={t("cra.memberStatesHint")}>
                <Input value={f.memberStates} onChange={(e) => set("memberStates", e.target.value)} placeholder="CZ, SK, DE" />
              </Field>
              <Field label={t("cra.owner")}>
                <PositionSelect value={f.ownerPositionId} onChange={(v) => set("ownerPositionId", v)} disabled={!can("cra:write")} />
              </Field>
            </div>
          </fieldset>
        </Card>
        <Card>
          <CardHeader title={t("cra.classification")} subtitle={t("cra.classificationSub")} />
          <fieldset disabled={!edit} {...guard.bind} className="space-y-4 p-5 pt-0">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("cra.category")}>
                <Select
                  value={f.category}
                  onChange={(e) => {
                    set("category", e.target.value as CraCategory | "");
                    set("categoryItem", "");
                  }}
                >
                  <option value="">{t("cra.notSet")}</option>
                  {CRA_CATEGORIES.map((x) => (
                    <option key={x} value={x}>
                      {t.lbl(CRA_LABELS.category[x])}
                    </option>
                  ))}
                </Select>
              </Field>
              {items.length > 0 && (
                <Field label={t("cra.categoryItem")}>
                  <Select value={f.categoryItem} onChange={(e) => set("categoryItem", e.target.value)}>
                    <option value="">—</option>
                    {items.map((i) => (
                      <option key={i.key} value={i.key}>
                        {t.lbl(CRA_LABELS.item[i.key]!)} ({i.ref})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            {mf && (
              <>
                <Field label={t("cra.conformity")} hint={allowed.length ? t("cra.conformityAllowed", { list: allowed.join(", ").replace("B_C", "B+C") }) : undefined}>
                  <Select value={f.conformityModule} onChange={(e) => set("conformityModule", e.target.value as CraModule | "")}>
                    <option value="">—</option>
                    {CRA_MODULES.map((x) => (
                      <option key={x} value={x}>
                        {t.lbl(CRA_LABELS.module[x])}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("cra.standards")}>
                  <Textarea rows={2} value={f.harmonisedStandards} onChange={(e) => set("harmonisedStandards", e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label={t("cra.notifiedBody")}>
                    <Input value={f.notifiedBody} onChange={(e) => set("notifiedBody", e.target.value)} />
                  </Field>
                  <Field label={t("cra.docIssuedAt")}>
                    <Input type="date" value={f.docIssuedAt} onChange={(e) => set("docIssuedAt", e.target.value)} />
                  </Field>
                  <Field label={t("cra.ceMarkedAt")}>
                    <Input type="date" value={f.ceMarkedAt} onChange={(e) => set("ceMarkedAt", e.target.value)} />
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("cra.onMarketSince")}>
                    <Input type="date" value={f.onMarketSince} onChange={(e) => set("onMarketSince", e.target.value)} />
                  </Field>
                  <Field label={t("cra.supportUntil")} hint={t("cra.supportHint")}>
                    <Input type="date" value={f.supportUntil} onChange={(e) => set("supportUntil", e.target.value)} />
                  </Field>
                </div>
                <Field label={t("cra.supportJustification")}>
                  <Textarea rows={2} value={f.supportJustification} onChange={(e) => set("supportJustification", e.target.value)} />
                </Field>
              </>
            )}
            {(mf || f.role === "oss_steward") && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("cra.securityContact")} hint={t("cra.securityContactHint")}>
                  <Input value={f.securityContact} onChange={(e) => set("securityContact", e.target.value)} placeholder="security@…" />
                </Field>
                <Field label={t("cra.cvdPolicy")}>
                  <Input value={f.cvdPolicyUrl} onChange={(e) => set("cvdPolicyUrl", e.target.value)} placeholder="https://…/security" />
                </Field>
              </div>
            )}
          </fieldset>
        </Card>
      </div>
    </>
  );
}

function RequirementsCard({ p }: { p: CraProductDto }) {
  const t = useT();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(p.requirements.map((r) => [r.key, r.note ?? ""])));
  const upd = useMutation({
    mutationFn: (v: { key: string; status: CraReqStatus }) => api.cra.requirement(p.id, v.key, v.status, notes[v.key] || null),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["cra"], exact: true });
      qc.setQueryData(["cra", "detail", d.id], d);
    },
  });
  const groups = (["part1", "part2", "obligation"] as const).filter((g) => p.requirements.some((r) => r.group === g));
  return (
    <Card className="mt-6 overflow-hidden" data-testid="cra-requirements">
      <CardHeader title={t("cra.requirementsTitle")} subtitle={t("cra.requirementsSub")} />
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {groups.map((g) => [
            <tr key={g} className="bg-slate-50">
              <td colSpan={3} className="px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t.lbl(CRA_LABELS.group[g])}
              </td>
            </tr>,
            ...p.requirements
              .filter((r) => r.group === g)
              .map((r) => (
                <tr key={r.key}>
                  <td className="px-5 py-2">
                    <div>{t.lbl((CRA_LABELS.req as Record<string, string>)[r.key] ?? r.key)}</div>
                    <div className="text-xs text-slate-500">{r.ref}</div>
                  </td>
                  <td className="w-40 px-3 py-2">
                    {p.canEdit ? (
                      <Select value={r.status} aria-label={t("cra.status")} onChange={(e) => upd.mutate({ key: r.key, status: e.target.value as CraReqStatus })}>
                        {CRA_REQ_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t.lbl(CRA_LABELS.reqStatus[s])}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={reqTone[r.status]}>{t.lbl(CRA_LABELS.reqStatus[r.status])}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.canEdit ? (
                      <Input
                        value={notes[r.key] ?? ""}
                        aria-label={t("cra.note")}
                        placeholder={t("cra.notePh")}
                        onChange={(e) => setNotes((x) => ({ ...x, [r.key]: e.target.value }))}
                        onBlur={() => (notes[r.key] ?? "") !== (r.note ?? "") && upd.mutate({ key: r.key, status: r.status })}
                      />
                    ) : (
                      <span className="text-xs text-slate-600">{r.note}</span>
                    )}
                  </td>
                </tr>
              )),
          ])}
        </tbody>
      </table>
      <div className="px-5 py-2">
        <ErrorBox error={upd.error} />
      </div>
    </Card>
  );
}

function SbomCard({ p }: { p: CraProductDto }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cra", "components", p.id], queryFn: () => api.cra.components(p.id) });
  const [filter, setFilter] = useState("");
  const [nc, setNc] = useState({ name: "", version: "", purl: "" });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["cra", "components", p.id] });
    qc.invalidateQueries({ queryKey: ["cra", "detail", p.id] });
  };
  const imp = useMutation({ mutationFn: async (f: File) => api.cra.sbom(p.id, await f.text(), true), onSuccess: refresh });
  const add = useMutation({ mutationFn: () => api.cra.addComponent(p.id, { name: nc.name, version: nc.version || null, purl: nc.purl || null }), onSuccess: () => (setNc({ name: "", version: "", purl: "" }), refresh()) });
  const rm = useMutation({ mutationFn: (cid: string) => api.cra.removeComponent(p.id, cid), onSuccess: refresh });
  const rows = (q.data ?? []).filter((c) => !filter || `${c.name} ${c.purl ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Card className="mt-6" data-testid="cra-sbom">
      <CardHeader
        title={t("cra.sbom", { n: p.componentCount })}
        subtitle={t("cra.sbomSub")}
        action={
          p.canEdit && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
              <FileUp size={15} /> {t("cra.importSbom")}
              <input type="file" accept=".json,.lock,.txt,application/json,text/plain" className="hidden" aria-label={t("cra.importSbom")} onChange={(e) => e.target.files?.[0] && imp.mutate(e.target.files[0])} />
            </label>
          )
        }
      />
      <div className="space-y-3 p-5 pt-0">
        {imp.data && <SuccessBox>{t("cra.sbomImported", { n: imp.data.imported, format: imp.data.format })}</SuccessBox>}
        <ErrorBox error={imp.error ?? add.error ?? rm.error} />
        {p.componentCount > 10 && <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("cra.filterPh")} aria-label={t("cra.filterPh")} className="max-w-xs" />}
        {rows.length > 0 && (
          <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-1.5">{t("cra.component")}</th>
                  <th className="px-3 py-1.5">{t("cra.version")}</th>
                  <th className="px-3 py-1.5">purl</th>
                  <th className="px-3 py-1.5">{t("cra.license")}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.slice(0, 500).map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-1">{c.name}</td>
                    <td className="px-3 py-1">{c.version}</td>
                    <td className="max-w-xs truncate px-3 py-1 font-mono text-slate-500">{c.purl}</td>
                    <td className="px-3 py-1">{c.license}</td>
                    <td className="px-2 py-1 text-right">
                      {p.canEdit && (
                        <button type="button" aria-label={t("cra.delete")} onClick={() => rm.mutate(c.id)} className="text-slate-400 hover:text-red-600">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {p.canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <Input className="w-48" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder={t("cra.component")} aria-label={t("cra.component")} />
            <Input className="w-28" value={nc.version} onChange={(e) => setNc({ ...nc, version: e.target.value })} placeholder={t("cra.version")} aria-label={t("cra.version")} />
            <Input className="w-72" value={nc.purl} onChange={(e) => setNc({ ...nc, purl: e.target.value })} placeholder="pkg:npm/lodash@4.17.21" aria-label="purl" />
            <Button variant="secondary" disabled={!nc.name.trim() || add.isPending} onClick={() => add.mutate()}>
              <Plus size={14} /> {t("cra.addComponent")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function FindingsCard({ p, onReport }: { p: CraProductDto; onReport: (x: { title: string; cveIds: string[] }) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cra", "findings", p.id], queryFn: () => api.cra.findings(p.id) });
  const comps = useQuery({ queryKey: ["cra", "components", p.id], queryFn: () => api.cra.components(p.id) });
  const [showGone, setShowGone] = useState(false);
  const [nf, setNf] = useState({ vulnId: "", componentRef: "" });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["cra", "findings", p.id] });
    qc.invalidateQueries({ queryKey: ["cra", "detail", p.id] });
  };
  const match = useMutation({ mutationFn: () => api.cra.match(p.id), onSuccess: refresh });
  const nvdCfg = useQuery({ queryKey: ["cra", "nvd"], queryFn: () => api.cra.nvd() });
  const nvd = useMutation({ mutationFn: () => api.cra.nvdLookup(p.id), onSuccess: refresh });
  const add = useMutation({ mutationFn: () => api.cra.addFinding(p.id, nf), onSuccess: () => (setNf({ vulnId: "", componentRef: "" }), refresh()) });
  const rows = (q.data ?? []).filter((f) => showGone || !f.gone);
  const refs = (comps.data ?? []).map((c) => c.purl || `${c.name}@${c.version ?? ""}`);
  return (
    <Card className="mb-6" data-testid="cra-findings">
      <CardHeader
        title={t("cra.vex.title", { n: p.openVulns })}
        subtitle={t("cra.vex.sub")}
        action={
          <div className="flex flex-wrap gap-2">
            {p.canEdit && p.componentCount > 0 && (
              <Button variant="secondary" disabled={match.isPending} onClick={() => match.mutate()}>
                {t("cra.vex.match")}
              </Button>
            )}
            {p.canEdit && p.cpe && nvdCfg.data?.enabled && (
              <Button variant="secondary" disabled={nvd.isPending} onClick={() => nvd.mutate()}>
                <Search size={14} /> {nvd.isPending ? t("cra.nvd.running") : t("cra.nvd.lookup")}
              </Button>
            )}
            <a href={api.cra.vexUrl(p.id, "openvex")}>
              <Button variant="secondary">OpenVEX</Button>
            </a>
            <a href={api.cra.vexUrl(p.id, "cyclonedx")}>
              <Button variant="secondary">CycloneDX VEX</Button>
            </a>
          </div>
        }
      />
      <div className="space-y-3 p-5 pt-0">
        {match.data && <SuccessBox>{t("cra.vex.matched", { n: match.data.matches })}</SuccessBox>}
        {nvd.data && <SuccessBox>{t(nvd.data.truncated ? "cra.nvd.doneTruncated" : "cra.nvd.done", { n: nvd.data.found, total: nvd.data.total })}</SuccessBox>}
        {p.advisoryCount > 0 && <p className="text-xs text-slate-500">{t("cra.adv.usedBy", { n: p.advisoryCount })}</p>}
        {p.componentCount === 0 && !p.cpe && p.advisoryCount === 0 && <p className="text-sm text-amber-800">{t("cra.vex.noSource")}</p>}
        <ErrorBox error={match.error ?? add.error ?? nvd.error} />
        {!rows.length ? (
          <p className="text-sm text-slate-500">{t("cra.vex.none")}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((f) => (
              <FindingRow key={f.id + f.updatedAt} f={f} edit={p.canEdit} onReport={onReport} />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox checked={showGone} onChange={setShowGone} label={t("cra.vex.showGone")} />
        </div>
        {p.canEdit && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <Input className="w-44" value={nf.vulnId} onChange={(e) => setNf({ ...nf, vulnId: e.target.value })} placeholder="CVE-2026-12345" aria-label={t("cra.vex.vulnId")} />
            <Select className="w-72" value={nf.componentRef} onChange={(e) => setNf({ ...nf, componentRef: e.target.value })} aria-label={t("cra.component")}>
              <option value="">{t("cra.vex.pickComponent")}</option>
              {refs.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!nf.vulnId.trim() || !nf.componentRef || add.isPending} onClick={() => add.mutate()}>
              <Plus size={14} /> {t("cra.vex.addManual")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function FindingRow({ f, edit, onReport }: { f: CraFindingDto; edit: boolean; onReport: (x: { title: string; cveIds: string[] }) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const mod = useModule();
  const nav = useNavigate();
  const toRisk = useMutation({
    mutationFn: () => api.cra.riskFromFinding(f.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["cra"] });
      nav({ to: "/risks/$riskId", params: { riskId: r.riskId } });
    },
  });
  const [v, setV] = useState({ status: f.status, justification: f.justification ?? "", impactStatement: f.impactStatement ?? "", actionStatement: f.actionStatement ?? "" });
  const dirty = v.status !== f.status || (v.justification || null) !== f.justification || (v.impactStatement || null) !== f.impactStatement || (v.actionStatement || null) !== f.actionStatement;
  const save = useMutation({
    mutationFn: () => api.cra.updateFinding(f.id, { status: v.status, justification: (v.justification || null) as VexJustification | null, impactStatement: v.impactStatement || null, actionStatement: v.actionStatement || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cra", "findings", f.productId] });
      qc.invalidateQueries({ queryKey: ["cra", "detail", f.productId] });
    },
  });
  return (
    <div className={cn("rounded-md border p-3", f.kev ? "border-red-200 bg-red-50/40" : "border-slate-200", f.gone && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {/^CVE-/i.test(f.vulnId) ? (
          <Link to="/vulnerabilities/cve/$cveId" params={{ cveId: f.vulnId }} className="font-mono font-semibold hover:text-brand-700 hover:underline">
            {f.vulnId}
          </Link>
        ) : (
          <span className="font-mono font-semibold">{f.vulnId}</span>
        )}
        {f.cves
          .filter((c) => c !== f.vulnId)
          .map((c) => (
            <Link key={c} to="/vulnerabilities/cve/$cveId" params={{ cveId: c }} className="font-mono text-xs text-slate-500 hover:text-brand-700 hover:underline">
              {c}
            </Link>
          ))}
        {f.kev && <Badge tone="red">KEV</Badge>}
        {f.epss != null && <span className="text-xs text-slate-500">EPSS {(f.epss * 100).toFixed(1)} %</span>}
        <span className="text-xs text-slate-500">· {f.componentName ? `${f.componentName} ${f.componentVersion ?? ""}` : f.componentRef}</span>
        {f.source === "manual" && <Badge tone="slate">{t("cra.vex.manual")}</Badge>}
        {f.source === "csaf" && <Badge tone="blue">{t("cra.vex.fromVendor")}</Badge>}
        {f.source === "nvd" && <Badge tone="slate">NVD</Badge>}
        {f.vendorStatus && f.vendorStatus !== f.status && <span className="text-xs text-amber-800">{t("cra.vex.vendorSays", { status: t.lbl(VEX_LABELS.status[f.vendorStatus]) })}</span>}
        {f.gone && <Badge tone="slate">{t("cra.vex.gone")}</Badge>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {f.riskId && mod("risks") ? (
            <Link to="/risks/$riskId" params={{ riskId: f.riskId }} className="text-xs text-brand-700 hover:underline">
              {t("cra.vex.riskOpen")}
            </Link>
          ) : (
            !f.gone &&
            mod("risks") &&
            can("risks:write") && (
              <Button variant="secondary" disabled={toRisk.isPending} onClick={async () => (await askConfirm(t("cra.vex.riskConfirm"))) && toRisk.mutate()}>
                {t("cra.vex.riskCreate")}
              </Button>
            )
          )}
          {f.kev && edit && !f.gone && (
            <Button variant="secondary" onClick={() => onReport({ title: `${f.vulnId} – ${f.componentName ?? f.componentRef}`, cveIds: f.cves })}>
              <AlertTriangle size={14} /> {t("cra.vex.report")}
            </Button>
          )}
        </span>
      </div>
      {f.summary && <div className="mt-0.5 text-xs text-slate-600">{f.summary}</div>}
      <fieldset disabled={!edit} className="mt-2 grid gap-2 sm:grid-cols-[11rem_1fr]">
        <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as VexStatus })} aria-label={t("cra.vex.status")}>
          {VEX_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(VEX_LABELS.status[s])}
            </option>
          ))}
        </Select>
        {v.status === "not_affected" ? (
          <Select value={v.justification} onChange={(e) => setV({ ...v, justification: e.target.value })} aria-label={t("cra.vex.justification")}>
            <option value="">{t("cra.vex.pickJustification")}</option>
            {VEX_JUSTIFICATIONS.map((s) => (
              <option key={s} value={s}>
                {t.lbl(VEX_LABELS.justification[s])}
              </option>
            ))}
          </Select>
        ) : (
          <Input value={v.actionStatement} onChange={(e) => setV({ ...v, actionStatement: e.target.value })} placeholder={t("cra.vex.actionPh")} aria-label={t("cra.vex.action")} />
        )}
        <Input className="sm:col-span-2" value={v.impactStatement} onChange={(e) => setV({ ...v, impactStatement: e.target.value })} placeholder={t("cra.vex.impactPh")} aria-label={t("cra.vex.impact")} />
      </fieldset>
      {edit && dirty && (
        <Button className="mt-2" disabled={save.isPending || (v.status === "not_affected" && !v.justification)} onClick={() => save.mutate()}>
          {t("cra.save")}
        </Button>
      )}
      <ErrorBox error={save.error} />
    </div>
  );
}

function ReportsCard({ p }: { p: CraProductDto }) {
  const t = useT();
  const q = useQuery({ queryKey: ["cra", "productReports", p.id], queryFn: () => api.cra.productReports(p.id) });
  const [open, setOpen] = useState<CraReportDto | "new" | null>(null);
  const [prefill, setPrefill] = useState<{ title: string; cveIds: string[] } | null>(null);
  return (
    <div className="mt-6">
      <FindingsCard
        p={p}
        onReport={(x) => {
          setPrefill(x);
          setOpen("new");
        }}
      />
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("cra.reportsTitle")}</h2>
        {p.canEdit && (
          <Button
            onClick={() => {
              setPrefill(null);
              setOpen("new");
            }}
          >
            <AlertTriangle size={15} /> {t("cra.newReport")}
          </Button>
        )}
      </div>
      <p className="mb-3 text-sm text-slate-600">{t("cra.reportsHint")}</p>
      <ReportList reports={q.data ?? []} onOpen={(r) => setOpen(r)} />
      {open && (
        <ReportModal
          p={p}
          r={open === "new" ? null : open}
          prefill={open === "new" ? prefill : null}
          onClose={() => {
            setOpen(null);
            setPrefill(null);
          }}
        />
      )}
    </div>
  );
}

function ReportModal({ p, r, prefill, onClose }: { p: CraProductDto; r: CraReportDto | null; prefill?: { title: string; cveIds: string[] } | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({
    kind: (r?.kind ?? "vulnerability") as CraReportKind,
    title: r?.title ?? prefill?.title ?? "",
    awareAt: toLocal(r?.awareAt ?? new Date().toISOString()),
    cveIds: (r?.cveIds ?? prefill?.cveIds ?? []).join(", "),
    malicious: r?.malicious == null ? "" : r.malicious ? "yes" : "no",
    memberStates: (r?.memberStates ?? p.memberStates).join(", "),
    description: r?.description ?? "",
    severity: r?.severity ?? "",
    mitigation: r?.mitigation ?? "",
    userMeasures: r?.userMeasures ?? "",
    sensitivity: r?.sensitivity ?? "",
    rootCause: r?.rootCause ?? "",
    actorInfo: r?.actorInfo ?? "",
    srpRef: r?.srpRef ?? "",
    earlyWarningAt: toLocal(r?.earlyWarningAt ?? null),
    notificationAt: toLocal(r?.notificationAt ?? null),
    correctiveAvailableAt: toLocal(r?.correctiveAvailableAt ?? null),
    finalReportAt: toLocal(r?.finalReportAt ?? null),
    usersInformedAt: toLocal(r?.usersInformedAt ?? null),
    closed: r?.closed ?? false,
  });
  const [stage, setStage] = useState<CraReportStage>("early");
  const [lang, setLang] = useState<"cs" | "en">("en");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const n = (v: string) => v.trim() || null;
  const body = () => ({
    kind: f.kind,
    title: f.title,
    awareAt: fromLocal(f.awareAt)!,
    cveIds: splitList(f.cveIds).map((x) => x.toUpperCase()),
    malicious: f.malicious === "" ? null : f.malicious === "yes",
    memberStates: splitList(f.memberStates).map((x) => x.toUpperCase()).filter((x) => x.length === 2),
    description: n(f.description),
    severity: n(f.severity),
    mitigation: n(f.mitigation),
    userMeasures: n(f.userMeasures),
    sensitivity: n(f.sensitivity),
    rootCause: n(f.rootCause),
    actorInfo: n(f.actorInfo),
    srpRef: n(f.srpRef),
    earlyWarningAt: fromLocal(f.earlyWarningAt),
    notificationAt: fromLocal(f.notificationAt),
    correctiveAvailableAt: fromLocal(f.correctiveAvailableAt),
    finalReportAt: fromLocal(f.finalReportAt),
    usersInformedAt: fromLocal(f.usersInformedAt),
    closed: f.closed,
  });
  const save = useMutation({
    mutationFn: () => (r ? api.cra.updateReport(r.id, body()) : api.cra.createReport(p.id, body())),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cra"] });
      onClose();
    },
  });
  const guard = useFormGuard(save);
  const text = useQuery({ queryKey: ["cra", "text", r?.id, stage, lang, r?.updatedAt], queryFn: () => api.cra.reportText(r!.id, stage, lang), enabled: !!r });
  const plain = (text.data?.sections ?? []).map((s) => `${s.label}: ${s.value}`).join("\n");
  const ts = (k: "earlyWarningAt" | "notificationAt" | "correctiveAvailableAt" | "finalReportAt" | "usersInformedAt") => (
    <Field label={t(`cra.ts.${k}`)}>
      <Input type="datetime-local" value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={r ? r.title : t("cra.newReport")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          {p.canEdit && (
            <Button disabled={!f.title.trim() || !f.awareAt || save.isPending} onClick={() => save.mutate()}>
              {t("cra.save")}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={!p.canEdit} {...guard.bind} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("cra.reportKind")}>
            <Select value={f.kind} onChange={(e) => set("kind", e.target.value as CraReportKind)}>
              {CRA_REPORT_KINDS.map((x) => (
                <option key={x} value={x}>
                  {t.lbl(CRA_LABELS.reportKind[x])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cra.awareAt")} hint={t("cra.awareHint")}>
            <Input type="datetime-local" value={f.awareAt} onChange={(e) => set("awareAt", e.target.value)} />
          </Field>
        </div>
        <Field label={t("cra.reportTitle")}>
          <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("cra.cveIds")}>
            <Input value={f.cveIds} onChange={(e) => set("cveIds", e.target.value)} placeholder="CVE-2026-12345" />
          </Field>
          <Field label={t("cra.malicious")}>
            <Select value={f.malicious} onChange={(e) => set("malicious", e.target.value)}>
              <option value="">{t("cra.unknown")}</option>
              <option value="yes">{t("cra.yes")}</option>
              <option value="no">{t("cra.no")}</option>
            </Select>
          </Field>
          <Field label={t("cra.memberStates")}>
            <Input value={f.memberStates} onChange={(e) => set("memberStates", e.target.value)} />
          </Field>
        </div>
        <Field label={t("cra.nature")}>
          <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("cra.mitigation")}>
            <Textarea rows={2} value={f.mitigation} onChange={(e) => set("mitigation", e.target.value)} />
          </Field>
          <Field label={t("cra.userMeasures")}>
            <Textarea rows={2} value={f.userMeasures} onChange={(e) => set("userMeasures", e.target.value)} />
          </Field>
          <Field label={t("cra.severity")}>
            <Textarea rows={2} value={f.severity} onChange={(e) => set("severity", e.target.value)} />
          </Field>
          {f.kind === "vulnerability" ? (
            <Field label={t("cra.actorInfo")}>
              <Textarea rows={2} value={f.actorInfo} onChange={(e) => set("actorInfo", e.target.value)} />
            </Field>
          ) : (
            <Field label={t("cra.rootCause")}>
              <Textarea rows={2} value={f.rootCause} onChange={(e) => set("rootCause", e.target.value)} />
            </Field>
          )}
          <Field label={t("cra.sensitivity")}>
            <Input value={f.sensitivity} onChange={(e) => set("sensitivity", e.target.value)} placeholder="TLP:AMBER" />
          </Field>
          <Field label={t("cra.srpRef")}>
            <Input value={f.srpRef} onChange={(e) => set("srpRef", e.target.value)} />
          </Field>
        </div>
        <div className="rounded-md border border-slate-200 p-3">
          <div className="mb-2 text-sm font-medium">{t("cra.submitted")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {ts("earlyWarningAt")}
            {ts("notificationAt")}
            {f.kind === "vulnerability" && ts("correctiveAvailableAt")}
            {ts("finalReportAt")}
            {ts("usersInformedAt")}
          </div>
          <div className="mt-2">
            <Checkbox checked={f.closed} onChange={(v) => set("closed", v)} label={t("cra.closeReport")} />
          </div>
        </div>
      </fieldset>
      <ErrorBox error={save.error} />
      {r && (
        <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid="cra-report-text">
          <Deadlines r={r} />
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-56" value={stage} onChange={(e) => setStage(e.target.value as CraReportStage)} aria-label={t("cra.stage")}>
              {CRA_REPORT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {t.lbl(CRA_LABELS.stage[s])}
                </option>
              ))}
            </Select>
            <Select className="w-28" value={lang} onChange={(e) => setLang(e.target.value as "cs" | "en")} aria-label={t("cra.lang")}>
              <option value="en">English</option>
              <option value="cs">Čeština</option>
            </Select>
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(plain)}>
              <Copy size={14} /> {t("cra.copy")}
            </Button>
          </div>
          <dl className="space-y-1 text-sm">
            {(text.data?.sections ?? []).map((s) => (
              <div key={s.label} className="grid grid-cols-[14rem_1fr] gap-2">
                <dt className="text-slate-500">{s.label}</dt>
                <dd className="whitespace-pre-line">{s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-500">{t("cra.srpNote")}</p>
        </div>
      )}
    </Modal>
  );
}

/* ============ dovozce / distributor: doklady výrobce (v1.16, ADR-113) ============ */

const supplyTone: Record<CraSupplyCheckStatus, Tone> = { missing: "red", ok: "green", na: "slate" };

function SupplyChecksCard({ p }: { p: CraProductDto }) {
  const t = useT();
  const open = p.supplyChecks.filter((c) => !c.optional && c.status === "missing").length;
  return (
    <Card className="mt-6" data-testid="cra-supply">
      <CardHeader title={t("cra.supply.title", { open })} subtitle={t(p.role === "importer" ? "cra.supply.subImporter" : "cra.supply.subDistributor")} />
      <div className="divide-y divide-slate-100 border-t border-slate-100">
        {p.supplyChecks.map((c) => (
          <SupplyCheckRow key={c.key + (c.at ?? "") + c.status + c.files.length} p={p} c={c} />
        ))}
      </div>
      <ProductFiles p={p} />
    </Card>
  );
}

function SupplyCheckRow({ p, c }: { p: CraProductDto; c: CraSupplyCheckItem }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = useState({ status: c.status, note: c.note ?? "", url: c.url ?? "" });
  const done = (d: CraProductDto) => {
    qc.setQueryData(["cra", "detail", d.id], d);
    qc.invalidateQueries({ queryKey: ["cra"] });
  };
  const save = useMutation({ mutationFn: () => api.cra.supplyCheck(p.id, c.key, { status: v.status, note: v.note || null, url: v.url || null }), onSuccess: done });
  const up = useMutation({ mutationFn: (f: File) => api.cra.uploadFile(p.id, f, c.key), onSuccess: done });
  const rm = useMutation({ mutationFn: (fid: string) => api.cra.removeFile(p.id, fid), onSuccess: done });
  const dirty = v.status !== c.status || (v.note || null) !== c.note || (v.url || null) !== c.url;
  const label = t.lbl(CRA_SUPPLY_LABELS.check[c.key as keyof typeof CRA_SUPPLY_LABELS.check] ?? c.key);
  return (
    <div className="space-y-2 px-5 py-3" data-testid={`supply-${c.key}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={supplyTone[c.status]}>{t.lbl(CRA_SUPPLY_LABELS.status[c.status])}</Badge>
        <span className="font-medium">{label}</span>
        {c.optional && <span className="text-xs text-slate-500">({t("cra.supply.optional")})</span>}
        <span className="text-xs text-slate-500">{c.ref}</span>
        {c.at && <span className="ml-auto text-xs text-slate-500">{t("cra.supply.verified", { date: fmtDay(c.at), by: c.byName ?? "—" })}</span>}
      </div>
      <fieldset disabled={!p.canEdit} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr]">
        <Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as CraSupplyCheckStatus })} aria-label={`${label} – ${t("cra.supply.status")}`}>
          {CRA_SUPPLY_CHECK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(CRA_SUPPLY_LABELS.status[s])}
            </option>
          ))}
        </Select>
        <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder={t("cra.supply.notePh")} aria-label={`${label} – ${t("cra.supply.note")}`} />
        <Input value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://…" aria-label={`${label} – ${t("cra.supply.url")}`} />
      </fieldset>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {c.url && (
          <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
            {t("cra.supply.openLink")}
          </a>
        )}
        {c.files.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5">
            <a href={api.cra.fileUrl(p.id, f.id)} className="hover:text-brand-700">
              <Download size={12} className="mr-0.5 inline" />
              {f.fileName}
            </a>
            {p.canEdit && (
              <button type="button" aria-label={`${t("cra.delete")} ${f.fileName}`} className="text-slate-400 hover:text-red-600" onClick={async () => (await askConfirm(t("cra.supply.removeFile", { name: f.fileName }))) && rm.mutate(f.id)}>
                <Trash2 size={12} />
              </button>
            )}
          </span>
        ))}
        {p.canEdit && (
          <label className="inline-flex cursor-pointer items-center gap-1 text-brand-700 hover:underline">
            <FileUp size={12} /> {t("cra.supply.attach")}
            <input type="file" className="hidden" aria-label={`${label} – ${t("cra.supply.attach")}`} onChange={(e) => e.target.files?.[0] && up.mutate(e.target.files[0])} />
          </label>
        )}
        {p.canEdit && dirty && (
          <Button className="ml-auto" disabled={save.isPending} onClick={() => save.mutate()}>
            {t("cra.save")}
          </Button>
        )}
      </div>
      <ErrorBox error={save.error ?? up.error ?? rm.error} />
    </div>
  );
}

function ProductFiles({ p }: { p: CraProductDto }) {
  const t = useT();
  const qc = useQueryClient();
  const done = (d: CraProductDto) => {
    qc.setQueryData(["cra", "detail", d.id], d);
    qc.invalidateQueries({ queryKey: ["cra"] });
  };
  const up = useMutation({ mutationFn: (f: File) => api.cra.uploadFile(p.id, f), onSuccess: done });
  const rm = useMutation({ mutationFn: (fid: string) => api.cra.removeFile(p.id, fid), onSuccess: done });
  return (
    <div className="space-y-2 border-t border-slate-100 px-5 py-3 text-sm">
      <div className="font-medium">{t("cra.supply.otherFiles")}</div>
      {!p.files.length && <p className="text-xs text-slate-500">{t("cra.supply.noFiles")}</p>}
      <ul className="space-y-1 text-xs">
        {p.files.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <a href={api.cra.fileUrl(p.id, f.id)} className="hover:text-brand-700">
              <Download size={12} className="mr-1 inline" />
              {f.fileName}
            </a>
            <span className="text-slate-500">
              {fmtDay(f.createdAt.slice(0, 10))} · {f.uploadedByName ?? "—"}
            </span>
            {p.canEdit && (
              <button type="button" aria-label={`${t("cra.delete")} ${f.fileName}`} className="text-slate-400 hover:text-red-600" onClick={async () => (await askConfirm(t("cra.supply.removeFile", { name: f.fileName }))) && rm.mutate(f.id)}>
                <Trash2 size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {p.canEdit && (
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
          <FileUp size={15} /> {t("cra.supply.upload")}
          <input type="file" className="hidden" aria-label={t("cra.supply.upload")} onChange={(e) => e.target.files?.[0] && up.mutate(e.target.files[0])} />
        </label>
      )}
      <ErrorBox error={up.error ?? rm.error} />
    </div>
  );
}

/* ============ oznámení výrobců CSAF a NVD (v1.16, ADR-113) ============ */

function AdvisoriesTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const group = useGroupView();
  const q = useQuery({ queryKey: ["cra", "advisories"], queryFn: () => api.cra.advisories() });
  const done = () => qc.invalidateQueries({ queryKey: ["cra"] });
  const up = useMutation({
    mutationFn: async (files: File[]) => {
      let vulns = 0;
      let matches = 0;
      for (const f of files) {
        const r = await api.cra.uploadAdvisory(f);
        vulns += r.vulnerabilities;
        matches += r.matches;
      }
      return { files: files.length, vulns, matches };
    },
    onSuccess: done,
  });
  const rm = useMutation({ mutationFn: (id: string) => api.cra.removeAdvisory(id), onSuccess: done });
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]" data-testid="cra-advisories">
      <Card>
        <CardHeader
          title={t("cra.adv.title")}
          subtitle={t("cra.adv.sub")}
          action={
            can("cra:write") && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
                <FileUp size={15} /> {t("cra.adv.upload")}
                <input type="file" multiple accept=".json,application/json" className="hidden" aria-label={t("cra.adv.upload")} onChange={(e) => e.target.files?.length && up.mutate([...e.target.files])} />
              </label>
            )
          }
        />
        <div className="space-y-3 p-5 pt-0">
          {up.data && <SuccessBox>{t("cra.adv.uploaded", { files: up.data.files, vulns: up.data.vulns, matches: up.data.matches })}</SuccessBox>}
          <ErrorBox error={q.error ?? up.error ?? rm.error} />
          {!q.data?.length ? (
            <p className="text-sm text-slate-500">{q.isLoading ? t("common.loading") : t("cra.adv.empty")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
              {q.data.map((a) => (
                <li key={a.id} className="space-y-1 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-500">{a.trackingId}</span>
                    <span className="font-medium">{a.title}</span>
                    <span className="text-xs text-slate-500">
                      {a.publisher} · {t("cra.adv.revision", { v: a.version })}
                      {a.currentRelease ? ` · ${fmtDay(a.currentRelease.slice(0, 10))}` : ""}
                    </span>
                    {can("cra:write") && (
                      <button type="button" aria-label={`${t("cra.delete")} ${a.trackingId}`} className="ml-auto text-slate-400 hover:text-red-600" onClick={async () => (await askConfirm(t("cra.adv.removeConfirm", { id: a.trackingId }))) && rm.mutate(a.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-slate-600">
                    {t("cra.adv.counts", { vulns: a.vulnerabilities, products: a.products })}
                    {" · "}
                    {a.matchedProducts.length ? (
                      <>
                        {t("cra.adv.matched")}{" "}
                        {a.matchedProducts.map((m, i) => (
                          <span key={m.id}>
                            {i > 0 && ", "}
                            <Link to="/cra/$productId" params={{ productId: m.id }} className="text-brand-700 hover:underline">
                              {m.name}
                            </Link>
                          </span>
                        ))}
                      </>
                    ) : (
                      <span className="text-amber-800">{t("cra.adv.noMatch")}</span>
                    )}
                  </div>
                  {group && <CompanyCell id={a.companyId} />}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">{t("cra.adv.hint")}</p>
        </div>
      </Card>
      <NvdCard />
    </div>
  );
}

function NvdCard() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cra", "nvd"], queryFn: () => api.cra.nvd() });
  const save = useMutation({ mutationFn: (enabled: boolean) => api.cra.saveNvd({ enabled, baseUrl: q.data!.baseUrl }), onSuccess: (d) => qc.setQueryData(["cra", "nvd"], d) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <Card data-testid="cra-nvd">
      <CardHeader title={t("cra.nvd.title")} />
      <div className="space-y-3 p-5 pt-0 text-sm">
        <p className="text-slate-700">{t("cra.nvd.sub")}</p>
        <Checkbox checked={q.data.enabled} disabled={!can("admin:settings") || save.isPending} onChange={(v) => save.mutate(v)} label={t("cra.nvd.enable")} />
        <p className="text-xs text-amber-800">{t("cra.nvd.privacy")}</p>
        <ErrorBox error={save.error} />
      </div>
    </Card>
  );
}
