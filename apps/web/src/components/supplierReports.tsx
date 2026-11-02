import { askConfirm } from "@/components/ui/overlay";
import { AiSuggestPanel } from "@/components/ai";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate, fmtDay } from "@/lib/utils";
import {
  REPORT_ITEM_KINDS,
  REPORT_ITEM_SEVERITIES,
  REPORT_ITEM_STATUSES,
  REPORT_OPINIONS,
  SUPPLIER_REPORT_KINDS,
  SUPPLIER_REPORT_LABELS,
  type ReportItemKind,
  type ReportItemStatus,
  type SupplierReportDetailDto,
  type SupplierReportDto,
  type SupplierReportGap,
  type SupplierReportInput,
  type SupplierReportItemDto,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { BadgeCheck, Download, FileUp, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";

const GAP_TONE: Record<SupplierReportGap["level"], Tone> = { high: "red", medium: "amber", low: "slate" };
const STATUS_TONE: Record<ReportItemStatus, Tone> = { open: "amber", addressed: "green", not_applicable: "slate", accepted: "violet" };

export function GapList({ gaps }: { gaps: SupplierReportGap[] }) {
  const t = useT();
  if (!gaps.length) return <Badge tone="green">{t("srp.noGaps")}</Badge>;
  return (
    <ul className="space-y-1 text-sm">
      {gaps.map((g) => (
        <li key={g.code} className="flex items-center gap-2">
          <Badge tone={GAP_TONE[g.level]}>{g.n ?? "!"}</Badge>
          <span className="text-slate-700">{t.lbl(SUPPLIER_REPORT_LABELS.gap[g.code])}</span>
        </li>
      ))}
    </ul>
  );
}

/** Zprávy o ujištění na detailu dodavatele. */
export function SupplierReportsCard({ supplierId, edit }: { supplierId: string; edit: boolean }) {
  const t = useT();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["supplier-reports", supplierId], queryFn: () => api.supplierReports.list(supplierId) });
  const [creating, setCreating] = useState(false);
  return (
    <Card className="mt-6" data-testid="supplier-reports">
      <CardHeader
        title={t("srp.title")}
        subtitle={t("srp.subtitle")}
        action={
          edit && (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus size={15} /> {t("srp.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={list.error} />
      {list.data?.length ? (
        <ul className="divide-y divide-slate-100">
          {list.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link to="/suppliers/reports/$reportId" params={{ reportId: r.id }} className="font-medium text-brand-700 hover:underline">
                  {r.title}
                </Link>
                <div className="text-xs text-slate-500">
                  {t.lbl(SUPPLIER_REPORT_LABELS.kind[r.kind])}
                  {r.periodTo && ` · ${r.periodFrom ? `${fmtDay(r.periodFrom)} – ` : ""}${fmtDay(r.periodTo)}`}
                  {r.validUntil && ` · ${t("srp.validUntil", { d: fmtDay(r.validUntil) })}`}
                </div>
              </div>
              <span className="text-xs text-slate-500">{t("srp.counts", { cuec: r.counts.cuec, exc: r.counts.exception })}</span>
              {r.gaps.filter((g) => g.level !== "low").length ? <Badge tone="amber">{t("srp.gapsN", { n: r.gaps.filter((g) => g.level !== "low").length })}</Badge> : <Badge tone="green">{t("srp.noGaps")}</Badge>}
            </li>
          ))}
        </ul>
      ) : (
        list.data && <EmptyState>{t("srp.empty")}</EmptyState>
      )}
      {creating && <NewReportModal supplierId={supplierId} onClose={() => setCreating(false)} onCreated={(id) => nav({ to: "/suppliers/reports/$reportId", params: { reportId: id } })} />}
    </Card>
  );
}

function NewReportModal({ supplierId, onClose, onCreated }: { supplierId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT();
  const [f, setF] = useState<SupplierReportInput>({ supplierId, kind: "soc2_type2", title: "", subserviceOrgs: [] });
  const create = useMutation({ mutationFn: () => api.supplierReports.create(f), onSuccess: (r) => onCreated(r.id) });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("srp.new")}
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
      <ReportFields f={f} set={(p) => setF({ ...f, ...p })} />
      <ErrorBox error={create.error} />
    </Modal>
  );
}

function ReportFields({ f, set }: { f: Partial<SupplierReportInput>; set: (p: Partial<SupplierReportInput>) => void }) {
  const t = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("srp.fTitle")} className="sm:col-span-2">
        <Input value={f.title ?? ""} placeholder={t("srp.fTitlePh")} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label={t("srp.fKind")}>
        <Select value={f.kind ?? "soc2_type2"} onChange={(e) => set({ kind: e.target.value as SupplierReportInput["kind"] })}>
          {SUPPLIER_REPORT_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.lbl(SUPPLIER_REPORT_LABELS.kind[k])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("srp.fAuditor")}>
        <Input value={f.serviceAuditor ?? ""} onChange={(e) => set({ serviceAuditor: e.target.value || null })} />
      </Field>
      <Field label={t("srp.fFrom")}>
        <Input type="date" value={f.periodFrom ?? ""} onChange={(e) => set({ periodFrom: e.target.value || null })} />
      </Field>
      <Field label={t("srp.fTo")}>
        <Input type="date" value={f.periodTo ?? ""} onChange={(e) => set({ periodTo: e.target.value || null })} />
      </Field>
      <Field label={t("srp.fOpinion")}>
        <Select value={f.opinion ?? ""} onChange={(e) => set({ opinion: (e.target.value || null) as SupplierReportInput["opinion"] })}>
          <option value="">—</option>
          {REPORT_OPINIONS.map((o) => (
            <option key={o} value={o}>
              {t.lbl(SUPPLIER_REPORT_LABELS.opinion[o])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("srp.fValid")} hint={t("srp.fValidHint")}>
        <Input type="date" value={f.validUntil ?? ""} onChange={(e) => set({ validUntil: e.target.value || null })} />
      </Field>
      <Field label={t("srp.fBridge")} hint={t("srp.fBridgeHint")}>
        <Input type="date" value={f.bridgeUntil ?? ""} onChange={(e) => set({ bridgeUntil: e.target.value || null })} />
      </Field>
      <Field label={t("srp.fSubservice")} hint={t("srp.fSubserviceHint")}>
        <Input value={(f.subserviceOrgs ?? []).join(", ")} onChange={(e) => set({ subserviceOrgs: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      </Field>
    </div>
  );
}

/** Detail zprávy dodavatele: metadata, soubor / text, mezery, AI vytěžení, položky (CUEC, výjimky, CSOC). */
export function SupplierReportPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { reportId } = useParams({ strict: false }) as { reportId: string };
  const q = useQuery({ queryKey: ["supplier-report", reportId], queryFn: () => api.supplierReports.get(reportId) });
  const set = (d: SupplierReportDetailDto) => {
    qc.setQueryData(["supplier-report", reportId], d);
    qc.invalidateQueries({ queryKey: ["supplier-reports"] });
  };
  const [edit, setEdit] = useState<Partial<SupplierReportInput> | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => api.supplierReports.update(reportId, edit!), onSuccess: (d) => (set(d), setEdit(null)) });
  const upload = useMutation({ mutationFn: (f: File) => api.supplierReports.upload(reportId, f), onSuccess: (d) => (set(d), setNote(d.note)) });
  const saveText = useMutation({ mutationFn: () => api.supplierReports.setText(reportId, text!), onSuccess: (d) => (set(d), setText(null)) });
  const review = useMutation({ mutationFn: () => api.supplierReports.review(reportId), onSuccess: set });
  const remove = useMutation({ mutationFn: () => api.supplierReports.remove(reportId), onSuccess: () => q.data && nav({ to: "/suppliers/$supplierId", params: { supplierId: q.data.supplierId } }) });
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  const w = can("suppliers:write");
  return (
    <>
      <PageHeader
        title={d.title}
        subtitle={`${d.supplierName} · ${t.lbl(SUPPLIER_REPORT_LABELS.kind[d.kind])}${d.reviewedAt ? ` · ${t("srp.reviewedBy", { d: fmtDate(d.reviewedAt), who: d.reviewedByName ?? "" })}` : ""}`}
        actions={
          <>
            <Link to="/suppliers/$supplierId" params={{ supplierId: d.supplierId }}>
              <Button variant="secondary">{t("srp.toSupplier")}</Button>
            </Link>
            {w && (
            <>
              <Button variant="secondary" onClick={() => setEdit({ ...d, notes: d.notes })}>
                {t("mon.edit")}
              </Button>
              <Button variant="secondary" disabled={review.isPending} onClick={() => review.mutate()}>
                <BadgeCheck size={15} /> {t("srp.markReviewed")}
              </Button>
              <Button variant="ghost" className="text-red-700" onClick={async () => (await askConfirm(t("srp.removeConfirm"))) && remove.mutate()} aria-label={t("mon.delete")}>
                <Trash2 size={15} />
              </Button>
            </>
            )}
          </>
        }
      />
      <ErrorBox error={q.error ?? review.error ?? remove.error} />
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5 text-sm lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">{t("srp.fAuditor")}</dt>
              <dd>{d.serviceAuditor ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("srp.period")}</dt>
              <dd>{d.periodTo ? `${d.periodFrom ? `${fmtDay(d.periodFrom)} – ` : ""}${fmtDay(d.periodTo)}` : d.asOf ? fmtDay(d.asOf) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("srp.fOpinion")}</dt>
              <dd>{d.opinion ? t.lbl(SUPPLIER_REPORT_LABELS.opinion[d.opinion]) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("srp.fValid")}</dt>
              <dd>{d.validUntil ? fmtDay(d.validUntil) : "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">{t("srp.fSubservice")}</dt>
              <dd>{d.subserviceOrgs.join(", ") || "—"}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            {d.fileName ? (
              <a href={api.supplierReports.fileUrl(d.id)} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                <Download size={14} /> {d.fileName}
              </a>
            ) : (
              <span className="text-slate-500">{t("srp.noFile")}</span>
            )}
            {w && (
              <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-brand-700 hover:underline">
                <FileUp size={14} /> {t("srp.upload")}
                <input type="file" className="sr-only" accept=".pdf,.txt,.html,.htm,.md" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
              </label>
            )}
            <span className="text-xs text-slate-500">{d.hasText ? t("srp.hasText") : t("srp.noText")}</span>
            {w && (
              <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setText(text == null ? "" : null)}>
                {t("srp.pasteText")}
              </button>
            )}
          </div>
          {note && <p className="mt-2 text-xs text-amber-700">{note}</p>}
          {text != null && (
            <div className="mt-3">
              <Textarea rows={8} value={text} placeholder={t("srp.pasteHint")} onChange={(e) => setText(e.target.value)} />
              <Button className="mt-2" disabled={text.length < 20 || saveText.isPending} onClick={() => saveText.mutate()}>
                {t("mon.save")}
              </Button>
            </div>
          )}
          <ErrorBox error={upload.error ?? saveText.error} />
        </Card>
        <Card className="p-5" data-testid="report-gaps">
          <h3 className="mb-2 text-sm font-medium text-slate-800">{t("srp.gapsTitle")}</h3>
          <GapList gaps={d.gaps} />
        </Card>
      </div>
      {d.hasText && (
        <Card className="mb-6 p-4">
          <AiSuggestPanel useCase="supplier_report_extract" entityId={d.id} canApply={w} onApplied={() => qc.invalidateQueries({ queryKey: ["supplier-report", reportId] })} />
        </Card>
      )}
      {REPORT_ITEM_KINDS.map((k) => (
        <ItemsCard key={k} kind={k} d={d} edit={w} onSaved={set} />
      ))}
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={t("mon.edit")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEdit(null)}>
                {t("common.cancelAction")}
              </Button>
              <Button disabled={save.isPending} onClick={() => save.mutate()}>
                {t("mon.save")}
              </Button>
            </>
          }
        >
          <ReportFields f={edit} set={(p) => setEdit({ ...edit, ...p })} />
          <ErrorBox error={save.error} />
        </Modal>
      )}
    </>
  );
}

function ItemsCard({ kind, d, edit, onSaved }: { kind: ReportItemKind; d: SupplierReportDetailDto; edit: boolean; onSaved: (d: SupplierReportDetailDto) => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const items = d.items.filter((i) => i.kind === kind);
  const ctl = useQuery({ queryKey: ["controls", "report-picker"], queryFn: () => api.controls.list(), enabled: kind === "cuec" && edit });
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const upd = useMutation({ mutationFn: (x: { id: string; patch: Parameters<typeof api.supplierReports.updateItem>[2] }) => api.supplierReports.updateItem(d.id, x.id, x.patch), onSuccess: onSaved });
  const add = useMutation({
    mutationFn: () => api.supplierReports.addItem(d.id, { kind, text }),
    onSuccess: (r) => {
      onSaved(r);
      setText("");
      setAdding(false);
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api.supplierReports.removeItem(d.id, id), onSuccess: onSaved });
  const risk = useMutation({
    mutationFn: (id: string) => api.supplierReports.createRisk(d.id, id),
    onSuccess: (r) => {
      onSaved(r.report);
      qc.invalidateQueries({ queryKey: ["risks"] });
    },
  });
  return (
    <Card className="mb-6" data-testid={`report-items-${kind}`}>
      <CardHeader
        title={`${t.lbl(SUPPLIER_REPORT_LABELS.itemKind[kind])} (${items.length})`}
        subtitle={t(`srp.kindHint.${kind}` as "srp.kindHint.cuec")}
        action={
          edit && (
            <Button variant="ghost" onClick={() => setAdding(!adding)}>
              <Plus size={15} /> {t("srp.addItem")}
            </Button>
          )
        }
      />
      <ErrorBox error={upd.error ?? add.error ?? del.error ?? risk.error} />
      {adding && (
        <div className="flex gap-2 border-b border-slate-100 px-5 py-3">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("srp.itemTextPh")} />
          <Button disabled={text.trim().length < 3 || add.isPending} onClick={() => add.mutate()}>
            {t("common.create")}
          </Button>
        </div>
      )}
      {items.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((i) => (
            <ItemRow key={i.id} i={i} edit={edit} controls={ctl.data ?? []} canRisk={can("risks:write")} onPatch={(patch) => upd.mutate({ id: i.id, patch })} onDelete={() => del.mutate(i.id)} onRisk={() => risk.mutate(i.id)} />
          ))}
        </ul>
      ) : (
        <EmptyState>{t("srp.noItems")}</EmptyState>
      )}
    </Card>
  );
}

function ItemRow({
  i,
  edit,
  controls,
  canRisk,
  onPatch,
  onDelete,
  onRisk,
}: {
  i: SupplierReportItemDto;
  edit: boolean;
  controls: { id: string; code: string | null; name: string }[];
  canRisk: boolean;
  onPatch: (p: Parameters<typeof api.supplierReports.updateItem>[2]) => void;
  onDelete: () => void;
  onRisk: () => void;
}) {
  const t = useT();
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-start gap-2">
        {i.ref && <span className="font-mono text-xs text-slate-500">{i.ref}</span>}
        {i.criterion && <Badge tone="violet">{i.criterion}</Badge>}
        {i.source === "ai" && <Badge tone="slate">AI</Badge>}
        <span className="min-w-0 flex-1 text-slate-800">{i.text}</span>
        <Badge tone={STATUS_TONE[i.status]}>{t.lbl(SUPPLIER_REPORT_LABELS.itemStatus[i.status])}</Badge>
      </div>
      {i.managementResponse && <div className="mt-1 text-xs text-slate-600">{t("srp.mgmt", { text: i.managementResponse })}</div>}
      {i.note && <div className="mt-1 text-xs text-slate-500">{i.note}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {i.kind === "cuec" &&
          (edit ? (
            <Select className="w-72" value={i.controlId ?? ""} aria-label={t("srp.control")} onChange={(e) => onPatch({ controlId: e.target.value || null })}>
              <option value="">{t("srp.noControl")}</option>
              {controls.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} ` : ""}
                  {c.name}
                </option>
              ))}
            </Select>
          ) : (
            <span>{i.controlName ?? t("srp.noControl")}</span>
          ))}
        {i.kind === "cuec" && i.controlId && (
          <Link to="/controls/$controlId" params={{ controlId: i.controlId }} className="text-brand-700 hover:underline">
            {i.controlName}
          </Link>
        )}
        {i.kind === "exception" && (
          <>
            {edit ? (
              <Select className="w-32" value={i.severity ?? ""} aria-label={t("srp.severity")} onChange={(e) => onPatch({ severity: (e.target.value || null) as "low" })}>
                <option value="">—</option>
                {REPORT_ITEM_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t.lbl(SUPPLIER_REPORT_LABELS.severity[s])}
                  </option>
                ))}
              </Select>
            ) : (
              i.severity && <span>{t.lbl(SUPPLIER_REPORT_LABELS.severity[i.severity])}</span>
            )}
            {i.riskId ? (
              <Link to="/risks/$riskId" params={{ riskId: i.riskId }} className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                <ShieldAlert size={13} /> {i.riskName}
              </Link>
            ) : (
              canRisk && (
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={onRisk}>
                  <ShieldAlert size={13} /> {t("srp.createRisk")}
                </Button>
              )
            )}
          </>
        )}
        {edit && (
          <Select className="w-44" value={i.status} aria-label={t("srp.status")} onChange={(e) => onPatch({ status: e.target.value as ReportItemStatus })}>
            {REPORT_ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.lbl(SUPPLIER_REPORT_LABELS.itemStatus[s])}
              </option>
            ))}
          </Select>
        )}
        {i.kind === "cuec" && i.controlId && (i.controlStatus === "planned" || i.controlStatus === "not_implemented" || i.controlEffectiveness === "ineffective") && <Badge tone="red">{t("srp.weakControl")}</Badge>}
        {edit && (
          <Button variant="ghost" className="ml-auto px-1.5 py-1 text-red-700" onClick={async () => (await askConfirm(t("srp.removeItem"))) && onDelete()} aria-label={t("mon.delete")}>
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </li>
  );
}

export type { SupplierReportDto };
