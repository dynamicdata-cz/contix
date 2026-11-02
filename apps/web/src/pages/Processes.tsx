import { useT } from "@/lib/i18n";
import { CompanyCell, TargetCompanyField, useGroupView, useTargetCompany } from "@/components/company";
import { PositionSelect, UnitSelect } from "@/components/pickers";
import { Badge, Button, Card, criticalityTone, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn, plural, useDebounced } from "@/lib/utils";
import { LABELS, PROCESS_LABELS, PROCESS_STATUSES, PROCESS_TYPES, type ProcessListItem, type ProcessStatus, type ProcessType } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, GitBranch, LayoutGrid, List, Plus, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

const MAP_TITLE: Record<ProcessType, string> = { management: "Řídicí procesy", core: "Hlavní (klíčové) procesy", support: "Podpůrné procesy" };

export const statusTone: Record<ProcessStatus, "slate" | "green" | "amber"> = { draft: "amber", active: "green", retired: "slate" };

/** Seřadí procesy do stromu (rodič → potomci) s hloubkou. */
function treeOrder(list: ProcessListItem[]) {
  const ids = new Set(list.map((p) => p.id));
  const byParent = new Map<string | null, ProcessListItem[]>();
  for (const p of list) {
    const key = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), p]);
  }
  const out: { p: ProcessListItem; depth: number }[] = [];
  const walk = (pid: string | null, depth: number) => {
    for (const p of byParent.get(pid) ?? []) {
      out.push({ p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function ProcessesPage() {
  const t = useT();
  const group = useGroupView();
  const can = useCan();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"map" | "list">("map");
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ["processes", dq, status], queryFn: () => api.processes.list({ q: dq, status }) });
  const rows = useMemo(() => treeOrder(list.data ?? []), [list.data]);

  return (
    <>
      <PageHeader
        title={t("prc.procesy")}
        subtitle={t("prc.evidenceAModelovaniProcesuProcesni")}
        actions={
          can("processes:write") && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> {t("prc.novyProces")}
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder={t("prc.hledatNazevNeboKod")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("prc.vsechnyStavy")}</option>
          {PROCESS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(PROCESS_LABELS.status[s])}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex rounded-md border border-slate-300 bg-white p-0.5">
          {(
            [
              ["map", LayoutGrid, t("prc.procesniMapa")],
              ["list", List, "Strom"],
            ] as const
          ).map(([k, Icon, label]) => (
            <button key={k} onClick={() => setView(k)} className={cn("flex items-center gap-1.5 rounded px-2.5 py-1 text-sm", view === k ? "bg-brand-50 text-brand-700" : "text-slate-600")}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={list.error} />

      {list.data && list.data.length === 0 ? (
        <Card>
          <EmptyState>
            {t("prc.zatimZadneProcesyZalozteHlavni")}
            {can("processes:write") && (
              <div className="mt-3">
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} /> {t("prc.novyProces")}
                </Button>
              </div>
            )}
          </EmptyState>
        </Card>
      ) : view === "map" ? (
        <div className="space-y-4">
          {(["management", "core", "support"] as ProcessType[]).map((tx) => {
            const items = (list.data ?? []).filter((p) => p.processType === tx && !(p.parentId && list.data!.some((x) => x.id === p.parentId)));
            return (
              <Card key={tx} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                  <h2 className="text-sm font-semibold text-slate-700">{t.lbl(MAP_TITLE[tx])}</h2>
                  <span className="text-xs text-slate-500">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-slate-400">—</div>
                ) : (
                  <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((p) => (
                      <ProcessTile key={p.id} p={p} subCount={(list.data ?? []).filter((x) => x.parentId === p.id).length} />
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("prc.proces")}</th>
                <th className="px-3 py-2">{t("prc.typ")}</th>
                <th className="px-3 py-2">{t("prc.stav")}</th>
                <th className="px-3 py-2">{t("prc.vlastnik2")}</th>
                <th className="px-3 py-2">{t("prc.kriticnost2")}</th>
                <th className="px-3 py-2 text-right">{t("prc.kroky2")}</th>
                <th className="px-3 py-2 text-right">{t("prc.rizika")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ p, depth }) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5" style={{ paddingLeft: 20 + depth * 20 }}>
                    <Link to="/processes/$processId" params={{ processId: p.id }} className="flex items-center gap-1.5 font-medium text-slate-900 hover:text-brand-700">
                      {depth > 0 && <ChevronRight size={14} className="text-slate-300" />}
                      {p.code && <span className="text-slate-500">{p.code}</span>}
                      {p.name}
                    </Link>
                    {group && <div><CompanyCell id={p.companyId} /></div>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{t.lbl(PROCESS_LABELS.type[p.processType])}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={statusTone[p.status]}>{t.lbl(PROCESS_LABELS.status[p.status])}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{p.ownerPositionName ?? <span className="text-amber-700">{t("prc.bezVlastnika")}</span>}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={criticalityTone[p.criticality]}>{t.lbl(LABELS.criticality[p.criticality as keyof typeof LABELS.criticality])}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.stepCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.riskCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && <CreateProcessModal onClose={() => setCreating(false)} processes={list.data ?? []} />}
    </>
  );
}

function ProcessTile({ p, subCount }: { p: ProcessListItem; subCount: number }) {
  const t = useT();
  return (
    <Link
      to="/processes/$processId"
      params={{ processId: p.id }}
      className="group block rounded-md border border-slate-200 bg-white p-3 transition hover:border-brand-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {p.code && <div className="text-xs text-slate-500">{p.code}</div>}
          <div className="font-medium text-slate-900 group-hover:text-brand-700">{p.name}</div>
        </div>
        <Badge tone={statusTone[p.status]}>{t.lbl(PROCESS_LABELS.status[p.status])}</Badge>
      </div>
      <div className="mt-2 text-xs text-slate-500">{p.ownerPositionName ?? t("prc.bezVlastnika")}</div>
      <div className="mt-2 flex gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <List size={13} /> {t("prc.krokuN", { n: p.stepCount })}
        </span>
        {subCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <GitBranch size={13} /> {t("prc.podprocesuN", { n: subCount })}
          </span>
        )}
        {p.riskCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <ShieldAlert size={13} /> {t("rsk.rizikN", { n: p.riskCount })}
          </span>
        )}
      </div>
    </Link>
  );
}

function CreateProcessModal({ onClose, processes }: { onClose: () => void; processes: ProcessListItem[] }) {
  const t = useT();
  const nav = useNavigate();
  const target = useTargetCompany();
  const [f, setF] = useState({
    name: "",
    code: "",
    processType: "core" as ProcessType,
    parentId: null as string | null,
    ownerPositionId: null as string | null,
    orgUnitId: null as string | null,
  });
  const create = useMutation({
    mutationFn: () => api.processes.create({ ...f, code: f.code || null, companyId: target.companyId }),
    onSuccess: (p) => nav({ to: "/processes/$processId", params: { processId: p.id } }),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.novyProces")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!f.name.trim() || create.isPending} onClick={() => create.mutate()}>
            {t("prc.zalozitAPokracovat")}
          </Button>
        </>
      }
    >
      <ErrorBox error={create.error} />
      <TargetCompanyField value={target.companyId} onChange={target.setCompanyId} />
      <div className="grid gap-4 sm:grid-cols-[1fr_130px]">
        <Field label={t("prc.nazevProcesu")}>
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("prc.naprZpracovaniMezd")} />
        </Field>
        <Field label={t("prc.kod")}>
          <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="P-01" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("prc.typProcesu")}>
          <Select value={f.processType} onChange={(e) => setF({ ...f, processType: e.target.value as ProcessType })}>
            {PROCESS_TYPES.map((tx) => (
              <option key={tx} value={tx}>
                {t.lbl(PROCESS_LABELS.type[tx])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("prc.nadrazenyProces2")}>
          <Select value={f.parentId ?? ""} onChange={(e) => setF({ ...f, parentId: e.target.value || null })}>
            <option value="">{t("prc.zadnyProcesNejvyssiUrovne")}</option>
            {processes.filter((p) => p.companyId === target.companyId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code ? `${p.code} ` : ""}
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("prc.vlastnikProcesuFunkcniMisto")} hint={t("prc.drzitelFunkcnihoMistaMuzeSvuj")}>
        <PositionSelect value={f.ownerPositionId} onChange={(v) => setF({ ...f, ownerPositionId: v })} />
      </Field>
      <Field label={t("prc.garantujiciUtvar")}>
        <UnitSelect value={f.orgUnitId} companyId={target.companyId} onChange={(v) => setF({ ...f, orgUnitId: v })} />
      </Field>
    </Modal>
  );
}
