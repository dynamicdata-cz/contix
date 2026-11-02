/** DORA – registr informací (ADR-069): smluvní ujednání s poskytovateli IKT, funkce, subjekty, koncentrace, export šablon. */
import { IdMultiSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  DORA_ALTERNATIVES,
  DORA_ARRANGEMENT_TYPES,
  DORA_ENTITY_TYPE_CS,
  DORA_FINDING_LABELS,
  DORA_HIERARCHY_CS,
  DORA_IMPACT,
  DORA_LABELS,
  DORA_NON_SUBST_REASON,
  DORA_REINTEGRATION,
  DORA_RELIANCE,
  DORA_SENSITIVITY,
  DORA_SERVICE_LABELS,
  DORA_SERVICE_TYPES,
  DORA_SUBSTITUTABILITY,
  DORA_TERMINATION,
  type DoraChainLink,
  type DoraContractInput,
  type DoraEntity,
  type DoraFinding,
  type DoraProvider,
  type DoraRegisterDto,
  type DoraSeverity,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

const TABS = ["overview", "contracts", "functions", "entities", "concentration"] as const;
type Tab = (typeof TABS)[number];
const sevTone: Record<DoraSeverity, Tone> = { high: "red", medium: "amber", low: "blue" };
const pct = (v: number) => `${Math.round(v * 100)} %`;

type EditTarget = { kind: "contract"; id: string; title: string } | { kind: "provider"; id: string; name: string } | { kind: "entity"; id: string; name: string } | null;

export function DoraPage() {
  const t = useT();
  const can = useCan();
  const q = useQuery({ queryKey: ["suppliers", "dora"], queryFn: api.suppliers.dora });
  const [tab, setTab] = useState<Tab>("overview");
  const [edit, setEdit] = useState<EditTarget>(null);
  const d = q.data;
  const write = can("suppliers:write");
  const tabLabel: Record<Tab, string> = { overview: t("dora.tab.overview"), contracts: t("dora.tab.contracts"), functions: t("dora.tab.functions"), entities: t("dora.tab.entities"), concentration: t("dora.tab.concentration") };
  const openFinding = (f: DoraFinding) => {
    if (!write) return;
    if (f.ref.type === "contract") setEdit({ kind: "contract", id: f.ref.id, title: f.name });
    else if (f.ref.type === "supplier") setEdit({ kind: "provider", id: f.ref.id, name: f.name });
    else if (f.ref.type === "company") setEdit({ kind: "entity", id: f.ref.id, name: f.name });
  };
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/suppliers" className="hover:text-brand-700">
          {t("dora.back")}
        </Link>
      </div>
      <PageHeader
        title={t("dora.title")}
        subtitle={t("dora.subtitle")}
        actions={
          <a href={api.suppliers.doraExportUrl()}>
            <Button variant="secondary">
              <Download size={15} /> {t("dora.export")}
            </Button>
          </a>
        }
      />
      <ErrorBox error={q.error} />
      {d && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label={t("dora.kpi.providers")} value={d.summary.providers} />
            <Kpi label={t("dora.kpi.contracts")} value={d.summary.contracts} hint={t("dora.kpi.complete", { n: d.summary.complete })} />
            <Kpi label={t("dora.kpi.functions")} value={d.summary.functions} hint={t("dora.kpi.critical", { n: d.summary.criticalFunctions })} />
            <Kpi label={t("dora.kpi.findings")} value={d.summary.findings} tone={d.findings.some((f) => f.severity === "high") ? "text-red-700" : undefined} />
            <Kpi label={t("dora.kpi.topShare")} value={d.concentration[0] ? pct(d.concentration[0].share) : "—"} hint={d.concentration[0]?.name} />
          </div>
          <div role="tablist" aria-label={t("dora.title")} className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map((x) => (
              <button key={x} role="tab" type="button" aria-selected={tab === x} onClick={() => setTab(x)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === x ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
                {tabLabel[x]}
              </button>
            ))}
          </div>
          {tab === "overview" && <Overview d={d} onOpen={openFinding} onProvider={write ? (id, name) => setEdit({ kind: "provider", id, name }) : undefined} />}
          {tab === "contracts" && <Contracts d={d} write={write} onEdit={setEdit} />}
          {tab === "functions" && <Functions d={d} canEdit={can("processes:write")} />}
          {tab === "entities" && <Entities d={d} write={write} onEdit={setEdit} />}
          {tab === "concentration" && <Concentration d={d} />}
        </>
      )}
      {edit?.kind === "contract" && <ContractModal id={edit.id} title={edit.title} d={d!} onClose={() => setEdit(null)} />}
      {edit?.kind === "provider" && <ProviderModal id={edit.id} name={edit.name} onClose={() => setEdit(null)} />}
      {edit?.kind === "entity" && <EntityModal id={edit.id} name={edit.name} current={d?.companies.find((c) => c.id === edit.id)?.dora ?? {}} onClose={() => setEdit(null)} />}
    </>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

function Overview({ d, onOpen, onProvider }: { d: DoraRegisterDto; onOpen: (f: DoraFinding) => void; onProvider?: (id: string, name: string) => void }) {
  const t = useT();
  return (
    <>
    <Card className="overflow-hidden" data-testid="dora-findings">
      <CardHeader title={t("dora.findings")} subtitle={t("dora.findingsSub")} />
      {d.summary.providers === 0 ? (
        <EmptyState>{t("dora.empty")}</EmptyState>
      ) : d.findings.length === 0 ? (
        <EmptyState>{t("dora.noFindings")}</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {d.findings.map((f, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <Badge tone={sevTone[f.severity]}>{t.lbl(DORA_LABELS.impact[f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low"])}</Badge>
              <span className="w-64 shrink-0 text-xs font-medium text-slate-600">{t.lbl(DORA_FINDING_LABELS[f.kind])}</span>
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpen(f)}>
                {f.name}
              </button>
              {f.fields.length > 0 && <span className="font-mono text-xs text-slate-500">{f.fields.join(", ")}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
    {d.others.length > 0 && (
      <Card className="mt-6 overflow-hidden" data-testid="dora-others">
        <CardHeader title={t("dora.others")} subtitle={t("dora.othersSub")} />
        <ul className="divide-y divide-slate-100 text-sm">
          {d.others.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <Link to="/suppliers/$supplierId" params={{ supplierId: o.id }} className="flex-1 hover:text-brand-700">
                {o.name}
              </Link>
              {o.significant && <Badge tone="amber">{t("dora.significant")}</Badge>}
              {onProvider && (
                <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onProvider(o.id, o.name)}>
                  {t("dora.markIct")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    )}
    </>
  );
}

function Contracts({ d, write, onEdit }: { d: DoraRegisterDto; write: boolean; onEdit: (e: EditTarget) => void }) {
  const t = useT();
  return (
    <Card className="overflow-hidden" data-testid="dora-contracts">
      <CardHeader title={t("dora.contracts")} subtitle={t("dora.contractsSub")} />
      {d.contracts.length === 0 ? (
        <EmptyState>{t("dora.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("dora.col.ref")}</th>
                <th className="px-3 py-2">{t("dora.col.provider")}</th>
                <th className="px-3 py-2">{t("dora.col.services")}</th>
                <th className="px-3 py-2">{t("dora.col.functions")}</th>
                <th className="px-3 py-2 text-right">{t("dora.col.cost")}</th>
                <th className="px-3 py-2">{t("dora.col.state")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.contracts.map((c) => (
                <tr key={c.contractId}>
                  <td className="px-4 py-2">
                    <Link to="/suppliers/$supplierId" params={{ supplierId: c.supplierId }} className="font-medium text-brand-700 hover:underline">
                      {c.reference}
                    </Link>
                    <div className="text-xs text-slate-500">{c.title}</div>
                  </td>
                  <td className="px-3 py-2">
                    {write ? (
                      <button type="button" className="hover:text-brand-700 hover:underline" onClick={() => onEdit({ kind: "provider", id: c.supplierId, name: c.providerName })}>
                        {c.providerName}
                      </button>
                    ) : (
                      c.providerName
                    )}
                    <div className="font-mono text-xs text-slate-500">{c.providerCode ? `${c.providerCodeType} ${c.providerCode}` : "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-xs" title={c.serviceTypes.map((s) => t.lbl(DORA_SERVICE_LABELS[s])).join(", ")}>
                    {c.serviceTypes.join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.functionIds.join(", ") || "—"} {c.critical && <Badge tone="red">{t("dora.critical")}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.annualCost != null ? `${c.annualCost.toLocaleString()} ${c.currency}` : "—"}</td>
                  <td className="px-3 py-2">{c.missing ? <Badge tone="amber">{t("dora.missing", { n: c.missing })}</Badge> : <Badge tone="green">{t("dora.complete")}</Badge>}</td>
                  <td className="px-3 py-2 text-right">
                    {write && (
                      <button type="button" aria-label={t("dora.editContract")} className="text-slate-500 hover:text-brand-700" onClick={() => onEdit({ kind: "contract", id: c.contractId, title: `${c.providerName} – ${c.title}` })}>
                        <Pencil size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-3 text-xs text-slate-500">{t("dora.contractsNote")}</p>
    </Card>
  );
}

function Functions({ d, canEdit }: { d: DoraRegisterDto; canEdit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [act, setAct] = useState<Record<string, string>>({});
  const save = useMutation({ mutationFn: ({ id, v }: { id: string; v: string }) => api.suppliers.saveDoraFunction(id, v), onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers", "dora"] }) });
  return (
    <Card className="overflow-hidden" data-testid="dora-functions">
      <CardHeader title={t("dora.functions")} subtitle={t("dora.functionsSub")} />
      {d.functions.length === 0 ? (
        <EmptyState>{t("dora.noFunctions")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">ID</th>
                <th className="px-3 py-2">{t("dora.col.function")}</th>
                <th className="px-3 py-2">{t("dora.col.critical")}</th>
                <th className="px-3 py-2">RTO / RPO</th>
                <th className="px-3 py-2">{t("dora.col.activity")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.functions.map((f) => (
                <tr key={f.processId}>
                  <td className="px-4 py-2 font-mono text-xs">{f.functionId}</td>
                  <td className="px-3 py-2">
                    <Link to="/processes/$processId" params={{ processId: f.processId }} className="font-medium text-brand-700 hover:underline">
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={f.critical === "yes" ? "red" : f.critical === "no" ? "slate" : "amber"}>{f.critical === "yes" ? t("dora.yes") : f.critical === "no" ? t("dora.no") : t.lbl(DORA_LABELS.impact.not_assessed)}</Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{f.rtoHours != null ? `${f.rtoHours} h / ${f.rpoHours ?? "—"} h` : "—"}</td>
                  <td className="px-3 py-2">
                    {canEdit ? (
                      <Input
                        aria-label={t("dora.col.activity")}
                        className="h-8 text-xs"
                        value={act[f.processId] ?? (f.activity === "support functions" ? "" : f.activity)}
                        placeholder="support functions"
                        onChange={(e) => setAct({ ...act, [f.processId]: e.target.value })}
                        onBlur={(e) => e.target.value !== (f.activity === "support functions" ? "" : f.activity) && save.mutate({ id: f.processId, v: e.target.value })}
                      />
                    ) : (
                      <span className="text-xs">{f.activity}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorBox error={save.error} />
    </Card>
  );
}

function Entities({ d, write, onEdit }: { d: DoraRegisterDto; write: boolean; onEdit: (e: EditTarget) => void }) {
  const t = useT();
  return (
    <Card className="overflow-hidden" data-testid="dora-entities">
      <CardHeader title={t("dora.entities")} subtitle={t("dora.entitiesSub")} />
      <ul className="divide-y divide-slate-100 text-sm">
        {d.companies.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="flex-1 font-medium">{c.name}</span>
            <span className="font-mono text-xs text-slate-600">{c.dora.lei || "—"}</span>
            <span className="text-xs text-slate-500">{c.dora.entityType ? t.lbl(DORA_ENTITY_TYPE_CS[c.dora.entityType - 1]!) : "—"}</span>
            {write && (
              <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => onEdit({ kind: "entity", id: c.id, name: c.name })}>
                <Pencil size={13} /> {t("dora.edit")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Concentration({ d }: { d: DoraRegisterDto }) {
  const t = useT();
  return (
    <Card className="overflow-hidden" data-testid="dora-concentration">
      <CardHeader title={t("dora.concentration")} subtitle={t("dora.concentrationSub")} />
      {d.concentration.length === 0 ? (
        <EmptyState>{t("dora.empty")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">{t("dora.col.group")}</th>
              <th className="px-3 py-2 text-right">{t("dora.col.contracts")}</th>
              <th className="px-3 py-2 text-right">{t("dora.col.critFns")}</th>
              <th className="px-3 py-2">{t("dora.col.share")}</th>
              <th className="px-3 py-2 text-right">{t("dora.col.cost")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.concentration.map((g) => (
              <tr key={g.key}>
                <td className="px-4 py-2">
                  <span className="font-medium">{g.name}</span> {g.notSubstitutable && <Badge tone="red">{t("dora.notSubst")}</Badge>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{g.contracts}</td>
                <td className="px-3 py-2 text-right tabular-nums">{g.criticalFunctions}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-28 overflow-hidden rounded bg-slate-100" aria-hidden>
                      <div className={cn("h-full", g.share >= 0.5 ? "bg-red-500" : "bg-brand-500")} style={{ width: pct(g.share) }} />
                    </div>
                    <span className="tabular-nums text-xs">{pct(g.share)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{g.annualCost.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/* ---------------- editace ---------------- */

function EnumSelect<T extends string>({ label, value, options, labels, onChange }: { label: string; value: T | null | undefined; options: readonly T[]; labels: Record<T, string>; onChange: (v: T | null) => void }) {
  const t = useT();
  return (
    <Field label={label}>
      <Select value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as T | null)} aria-label={label}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {t.lbl(labels[o])}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function ContractModal({ id, title, d, onClose }: { id: string; title: string; d: DoraRegisterDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const cur = useQuery({ queryKey: ["suppliers", "dora", "contract", id], queryFn: () => api.suppliers.doraContract(id) });
  const procs = useQuery({ queryKey: ["processes", "list"], queryFn: () => api.processes.list() });
  const [f, setF] = useState<DoraContractInput | null>(null);
  const v: DoraContractInput = f ?? cur.data ?? { processIds: [], serviceTypes: [], chain: [] };
  const set = (p: Partial<DoraContractInput>) => setF({ ...v, ...p });
  const save = useMutation({
    mutationFn: () => api.suppliers.saveDoraContract(id, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers", "dora"] });
      onClose();
    },
  });
  const sameSupplier = d.contracts.find((c) => c.contractId === id)?.supplierId;
  const siblings = d.contracts.filter((c) => c.supplierId === sameSupplier && c.contractId !== id);
  const chain = v.chain ?? [];
  const setChain = (i: number, p: Partial<DoraChainLink>) => set({ chain: chain.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("dora.editContract")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !cur.data} onClick={() => save.mutate()}>
            {t("dora.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm font-medium">{title}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <EnumSelect label={t("dora.f.arrangement")} value={v.arrangementType ?? "standalone"} options={DORA_ARRANGEMENT_TYPES} labels={DORA_LABELS.arrangement} onChange={(x) => set({ arrangementType: x ?? "standalone" })} />
        <Field label={t("dora.f.overarching")}>
          <Select value={v.overarchingContractId ?? ""} onChange={(e) => set({ overarchingContractId: e.target.value || null })} aria-label={t("dora.f.overarching")}>
            <option value="">—</option>
            {siblings.map((c) => (
              <option key={c.contractId} value={c.contractId}>
                {c.reference} {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <Field label={t("dora.f.annualCost")}>
            <Input type="number" min={0} value={v.annualCost ?? ""} onChange={(e) => set({ annualCost: numOrNull(e.target.value) })} />
          </Field>
          <Field label={t("dora.f.currency")}>
            <Input value={v.currency ?? "EUR"} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
          </Field>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-sm font-medium text-slate-700">{t("dora.f.services")}</div>
        <div className="grid gap-1 sm:grid-cols-3">
          {DORA_SERVICE_TYPES.map((s) => (
            <Checkbox
              key={s}
              checked={(v.serviceTypes ?? []).includes(s)}
              onChange={(on) => set({ serviceTypes: on ? [...(v.serviceTypes ?? []), s] : (v.serviceTypes ?? []).filter((x) => x !== s) })}
              label={`${s} ${t.lbl(DORA_SERVICE_LABELS[s])}`}
            />
          ))}
        </div>
      </div>
      <Field label={t("dora.f.functions")} hint={t("dora.f.functionsHint")}>
        <IdMultiSelect linkKind="process" value={v.processIds ?? []} onChange={(ids) => set({ processIds: ids })} options={(procs.data ?? []).map((p) => ({ id: p.id, label: p.name, hint: p.code ?? undefined }))} />
      </Field>
      <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dora.h.critical")}</h3>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label={t("dora.f.noticeEntity")}>
          <Input type="number" min={0} value={v.noticeEntityDays ?? ""} onChange={(e) => set({ noticeEntityDays: numOrNull(e.target.value) })} />
        </Field>
        <Field label={t("dora.f.noticeProvider")}>
          <Input type="number" min={0} value={v.noticeProviderDays ?? ""} onChange={(e) => set({ noticeProviderDays: numOrNull(e.target.value) })} />
        </Field>
        <Field label={t("dora.f.governingLaw")}>
          <Input value={v.governingLaw ?? ""} maxLength={2} placeholder="CZ" onChange={(e) => set({ governingLaw: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t("dora.f.serviceCountry")}>
          <Input value={v.serviceCountry ?? ""} maxLength={2} placeholder="CZ" onChange={(e) => set({ serviceCountry: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t("dora.f.storesData")}>
          <Select value={v.storesData == null ? "" : v.storesData ? "1" : "0"} onChange={(e) => set({ storesData: e.target.value === "" ? null : e.target.value === "1" })} aria-label={t("dora.f.storesData")}>
            <option value="">—</option>
            <option value="1">{t("dora.yes")}</option>
            <option value="0">{t("dora.no")}</option>
          </Select>
        </Field>
        <Field label={t("dora.f.dataLocation")}>
          <Input value={v.dataLocation ?? ""} maxLength={2} onChange={(e) => set({ dataLocation: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t("dora.f.processingLocation")}>
          <Input value={v.processingLocation ?? ""} maxLength={2} onChange={(e) => set({ processingLocation: e.target.value.toUpperCase() })} />
        </Field>
        <EnumSelect label={t("dora.f.sensitivity")} value={v.dataSensitivity} options={DORA_SENSITIVITY} labels={DORA_LABELS.sensitivity} onChange={(x) => set({ dataSensitivity: x })} />
        <EnumSelect label={t("dora.f.reliance")} value={v.reliance} options={DORA_RELIANCE} labels={DORA_LABELS.reliance} onChange={(x) => set({ reliance: x })} />
        <EnumSelect label={t("dora.f.termination")} value={v.terminationReason} options={DORA_TERMINATION} labels={DORA_LABELS.termination} onChange={(x) => set({ terminationReason: x })} />
      </div>
      <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dora.h.assessment")}</h3>
      <div className="grid gap-4 sm:grid-cols-4">
        <EnumSelect label={t("dora.f.substitutability")} value={v.substitutability} options={DORA_SUBSTITUTABILITY} labels={DORA_LABELS.substitutability} onChange={(x) => set({ substitutability: x })} />
        <EnumSelect label={t("dora.f.nonSubst")} value={v.nonSubstReason} options={DORA_NON_SUBST_REASON} labels={DORA_LABELS.nonSubst} onChange={(x) => set({ nonSubstReason: x })} />
        <EnumSelect label={t("dora.f.reintegration")} value={v.reintegration} options={DORA_REINTEGRATION} labels={DORA_LABELS.reintegration} onChange={(x) => set({ reintegration: x })} />
        <EnumSelect label={t("dora.f.impact")} value={v.discontinuationImpact} options={DORA_IMPACT} labels={DORA_LABELS.impact} onChange={(x) => set({ discontinuationImpact: x })} />
        <Field label={t("dora.f.lastAudit")}>
          <Input type="date" value={v.lastAuditAt ?? ""} onChange={(e) => set({ lastAuditAt: e.target.value || null })} />
        </Field>
        <Field label={t("dora.f.exitPlan")}>
          <Select value={v.exitPlan == null ? "" : v.exitPlan ? "1" : "0"} onChange={(e) => set({ exitPlan: e.target.value === "" ? null : e.target.value === "1" })} aria-label={t("dora.f.exitPlan")}>
            <option value="">{t("dora.f.exitPlanAuto")}</option>
            <option value="1">{t("dora.yes")}</option>
            <option value="0">{t("dora.no")}</option>
          </Select>
        </Field>
        <EnumSelect label={t("dora.f.alternatives")} value={v.alternatives} options={DORA_ALTERNATIVES} labels={DORA_LABELS.alternatives} onChange={(x) => set({ alternatives: x })} />
        <Field label={t("dora.f.alternativeProvider")}>
          <Input value={v.alternativeProvider ?? ""} onChange={(e) => set({ alternativeProvider: e.target.value })} />
        </Field>
      </div>
      <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("dora.h.chain")}</h3>
      {chain.map((l, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[4rem_1fr_9rem_6rem_6rem_auto]">
          <Field label={t("dora.f.rank")}>
            <Input type="number" min={2} value={l.rank} onChange={(e) => setChain(i, { rank: Number(e.target.value) || 2 })} />
          </Field>
          <Field label={t("dora.f.subName")}>
            <Input value={l.name} onChange={(e) => setChain(i, { name: e.target.value })} />
          </Field>
          <Field label={t("dora.f.subCode")}>
            <Input value={l.code} onChange={(e) => setChain(i, { code: e.target.value })} />
          </Field>
          <Field label={t("dora.f.codeType")}>
            <Input value={l.codeType} placeholder="LEI" onChange={(e) => setChain(i, { codeType: e.target.value })} />
          </Field>
          <Field label={t("dora.f.service")}>
            <Select value={l.serviceType} onChange={(e) => setChain(i, { serviceType: e.target.value as DoraChainLink["serviceType"] })}>
              {DORA_SERVICE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <button type="button" aria-label={t("dora.removeSub")} className="mb-2 text-red-700" onClick={() => set({ chain: chain.filter((_, k) => k !== i) })}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div>
        <Button variant="secondary" className="px-2.5 py-1 text-xs" onClick={() => set({ chain: [...chain, { rank: 2, name: "", code: "", codeType: "LEI", serviceType: v.serviceTypes?.[0] ?? "S07" }] })}>
          <Plus size={13} /> {t("dora.addSub")}
        </Button>
      </div>
      <ErrorBox error={cur.error ?? save.error} />
    </Modal>
  );
}

export function ProviderModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const sup = useQuery({ queryKey: ["suppliers", id], queryFn: () => api.suppliers.get(id) });
  const [f, setF] = useState<Partial<DoraProvider> | null>(null);
  const cur = (sup.data as { dora?: Partial<DoraProvider> } | undefined)?.dora ?? {};
  const v: Partial<DoraProvider> = f ?? { currency: "EUR", personType: "legal", ...cur, ict: cur.ict ?? true };
  const set = (p: Partial<DoraProvider>) => setF({ ...v, ...p });
  const save = useMutation({
    mutationFn: () => api.suppliers.saveDoraProvider(id, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("dora.editProvider")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !sup.data} onClick={() => save.mutate()}>
            {t("dora.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm font-medium">{name}</p>
      <ProviderFields v={v} set={set} ico={sup.data?.ico ?? null} />
      <ErrorBox error={sup.error ?? save.error} />
    </Modal>
  );
}

export function ProviderFields({ v, set, ico }: { v: Partial<DoraProvider>; set: (p: Partial<DoraProvider>) => void; ico: string | null }) {
  const t = useT();
  return (
    <>
      <Checkbox checked={!!v.ict} onChange={(x) => set({ ict: x })} label={t("dora.f.ict")} hint={t("dora.f.ictHint")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="LEI" hint={ico ? t("dora.f.leiHint", { ico }) : undefined}>
          <Input value={v.lei ?? ""} maxLength={20} onChange={(e) => set({ lei: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="EUID">
          <Input value={v.euid ?? ""} onChange={(e) => set({ euid: e.target.value })} />
        </Field>
        <Field label={t("dora.f.country")}>
          <Input value={v.country ?? ""} maxLength={2} placeholder="CZ" onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t("dora.f.personType")}>
          <Select value={v.personType ?? "legal"} onChange={(e) => set({ personType: e.target.value as "legal" | "individual" })}>
            <option value="legal">{t.lbl(DORA_LABELS.personType.legal)}</option>
            <option value="individual">{t.lbl(DORA_LABELS.personType.individual)}</option>
          </Select>
        </Field>
        <Field label={t("dora.f.parentCode")}>
          <Input value={v.parentCode ?? ""} onChange={(e) => set({ parentCode: e.target.value })} />
        </Field>
        <Field label={t("dora.f.codeType")}>
          <Input value={v.parentCodeType ?? ""} placeholder="LEI" onChange={(e) => set({ parentCodeType: e.target.value })} />
        </Field>
        <Field label={t("dora.f.providerCost")}>
          <Input type="number" min={0} value={v.annualCost ?? ""} onChange={(e) => set({ annualCost: numOrNull(e.target.value) })} />
        </Field>
        <Field label={t("dora.f.currency")}>
          <Input value={v.currency ?? "EUR"} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
        </Field>
      </div>
    </>
  );
}

function EntityModal({ id, name, current, onClose }: { id: string; name: string; current: Partial<DoraEntity>; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = useState<Partial<DoraEntity>>({ currency: "EUR", ...current });
  const set = (p: Partial<DoraEntity>) => setV({ ...v, ...p });
  const save = useMutation({
    mutationFn: () => api.suppliers.saveDoraEntity(id, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers", "dora"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("dora.editEntity")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("dora.save")}
          </Button>
        </>
      }
    >
      <p className="text-sm font-medium">{name}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="LEI">
          <Input value={v.lei ?? ""} maxLength={20} onChange={(e) => set({ lei: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t("dora.f.country")}>
          <Input value={v.country ?? ""} maxLength={2} placeholder="CZ" onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t("dora.f.entityType")}>
          <Select value={v.entityType ?? ""} onChange={(e) => set({ entityType: e.target.value ? Number(e.target.value) : null })} aria-label={t("dora.f.entityType")}>
            <option value="">—</option>
            {DORA_ENTITY_TYPE_CS.map((x, i) => (
              <option key={x} value={i + 1}>
                {t.lbl(x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dora.f.hierarchy")}>
          <Select value={v.hierarchy ?? ""} onChange={(e) => set({ hierarchy: e.target.value ? Number(e.target.value) : null })} aria-label={t("dora.f.hierarchy")}>
            <option value="">—</option>
            {DORA_HIERARCHY_CS.map((x, i) => (
              <option key={x} value={i + 1}>
                {t.lbl(x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("dora.f.parentLei")}>
          <Input value={v.parentLei ?? ""} maxLength={20} onChange={(e) => set({ parentLei: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t("dora.f.authority")}>
          <Input value={v.competentAuthority ?? ""} placeholder="CZ_CNB" onChange={(e) => set({ competentAuthority: e.target.value })} />
        </Field>
        <Field label={t("dora.f.totalAssets")}>
          <Input type="number" min={0} value={v.totalAssets ?? ""} onChange={(e) => set({ totalAssets: numOrNull(e.target.value) })} />
        </Field>
        <Field label={t("dora.f.currency")}>
          <Input value={v.currency ?? "EUR"} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

/** Karta na detailu dodavatele: příznak poskytovatele IKT a údaje pro registr DORA. */
export function DoraProviderCard({ supplierId, name, dora, edit }: { supplierId: string; name: string; dora: Partial<DoraProvider>; edit: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Card className="mt-6 overflow-hidden" data-testid="dora-provider-card">
      <CardHeader
        title={t("dora.cardTitle")}
        subtitle={dora.ict ? t("dora.cardIct", { lei: dora.lei || "—", country: dora.country || "—" }) : t("dora.cardNotIct")}
        action={
          <div className="flex gap-2">
            {dora.ict && (
              <Link to="/suppliers/dora">
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs">
                  {t("dora.title")}
                </Button>
              </Link>
            )}
            {edit && (
              <Button variant={dora.ict ? "secondary" : "primary"} className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
                {dora.ict ? t("dora.editProviderShort") : t("dora.markIct")}
              </Button>
            )}
          </div>
        }
      />
      {open && <ProviderModal id={supplierId} name={name} onClose={() => setOpen(false)} />}
    </Card>
  );
}
