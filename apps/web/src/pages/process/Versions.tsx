import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Modal, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import {
  PROCESS_LABELS,
  PROCESS_VERSION_LABELS,
  diffProcess,
  processSnapshotOf,
  type ProcessDetail,
  type ProcessDiffItem,
  type ProcessSnapshot,
  type ProcessVersionDto,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitCompare, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

const tone: Record<ProcessVersionDto["status"], Tone> = { draft: "amber", approved: "green", superseded: "slate" };

/** Verze procesu: uložit snímek, schválit, porovnat s předchozí verzí nebo s aktuálním stavem. */
export function VersionsTab({ p, canEdit }: { p: ProcessDetail; canEdit: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["process", p.id, "versions"], queryFn: () => api.processes.versions(p.id) });
  const [creating, setCreating] = useState(false);
  const [compare, setCompare] = useState<{ a: ProcessVersionDto; b: ProcessVersionDto | "current" } | null>(null);
  const set = (d: ProcessVersionDto[]) => {
    qc.setQueryData(["process", p.id, "versions"], d);
    qc.invalidateQueries({ queryKey: ["process", p.id] });
  };
  const approve = useMutation({ mutationFn: (id: string) => api.processes.approveVersion(p.id, id), onSuccess: set });
  const del = useMutation({ mutationFn: (id: string) => api.processes.deleteVersion(p.id, id), onSuccess: set });
  const versions = list.data ?? [];
  const approved = versions.find((v) => v.status === "approved");
  const hasDraft = versions.some((v) => v.status === "draft");
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={t("prc.verzeProcesu")}
        subtitle={t("prc.ulozenaVerzeJeNemennySnimek")}
        action={
          canEdit &&
          !hasDraft && (
            <Button className="whitespace-nowrap px-2.5 py-1.5 text-xs" onClick={() => setCreating(true)}>
              <Plus size={13} /> {t("prc.ulozitVerzi")}
            </Button>
          )
        }
      />
      <ErrorBox error={list.error ?? approve.error ?? del.error} />
      {approved && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-sm">
          <span>
            {t("prc.platnaVerze")} <b>{approved.number}</b> {t("prc.schvalena")} {approved.approvedAt ? fmtDate(approved.approvedAt) : ""} ({approved.approvedByName ?? "?"})
          </span>
          <button className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={() => setCompare({ a: approved, b: "current" })}>
            <GitCompare size={13} /> {t("prc.zmenyOdSchvaleneVerze")}
          </button>
        </div>
      )}
      {versions.length === 0 ? (
        <EmptyState>{list.isLoading ? t("common.loading") : t("prc.zatimZadnaUlozenaVerzeUlozte")}</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("prc.verze")}</th>
              <th className="px-3 py-2">{t("prc.popisZmeny")}</th>
              <th className="px-3 py-2">{t("prc.vytvoreno")}</th>
              <th className="px-3 py-2">{t("prc.schvaleno")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {versions.map((v, i) => {
              const prev = versions[i + 1];
              return (
                <tr key={v.id}>
                  <td className="px-5 py-2.5 whitespace-nowrap">
                    <b className="mr-2">{v.number}</b>
                    <Badge tone={tone[v.status]}>{t.lbl(PROCESS_VERSION_LABELS[v.status])}</Badge>
                  </td>
                  <td className="px-3 py-2.5">{v.changeSummary}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {fmtDate(v.createdAt)}
                    <div>{v.createdByName}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {v.approvedAt ? fmtDate(v.approvedAt) : "—"}
                    {v.approvedByName && <div>{v.approvedByName}</div>}
                    {v.approvalNote && <div className="italic">{v.approvalNote}</div>}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    {prev && (
                      <button className="mr-3 text-xs text-brand-700 hover:underline" onClick={() => setCompare({ a: prev, b: v })}>
                        {t("prc.porovnatSV", { number: prev.number })}
                      </button>
                    )}
                    {!prev && (
                      <button className="mr-3 text-xs text-brand-700 hover:underline" onClick={() => setCompare({ a: v, b: "current" })}>
                        {t("prc.porovnatSAktualnimStavem")}
                      </button>
                    )}
                    {v.canApprove && (
                      <Button className="px-2 py-1 text-xs" disabled={approve.isPending} onClick={async () => (await askConfirm(t("prc.schvalitVerziPredchoziSchvalenaVerze", { number: v.number }))) && approve.mutate(v.id)}>
                        <CheckCircle2 size={13} /> {t("prc.schvalit")}
                      </Button>
                    )}
                    {v.status === "draft" && canEdit && (
                      <button className="ml-2 text-slate-400 hover:text-red-700" title={t("prc.smazatNavrh")} onClick={async () => (await askConfirm(t("prc.smazatNavrhVerze"))) && del.mutate(v.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {creating && <CreateModal p={p} onClose={() => setCreating(false)} onDone={set} />}
      {compare && <CompareModal p={p} a={compare.a} b={compare.b} onClose={() => setCompare(null)} />}
    </Card>
  );
}

function CreateModal({ p, onClose, onDone }: { p: ProcessDetail; onClose: () => void; onDone: (d: ProcessVersionDto[]) => void }) {
  const t = useT();
  const [summary, setSummary] = useState("");
  const m = useMutation({
    mutationFn: () => api.processes.createVersion(p.id, { changeSummary: summary }),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("prc.ulozitVerziProcesu")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!summary.trim() || m.isPending} onClick={() => m.mutate()}>
            {t("prc.ulozitVerzi")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("prc.uloziSeAktualniPodobaProcesu", { length: p.steps.length })}</p>
      <Field label={t("prc.popisZmeny")}>
        <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t("prc.naprDoplnenKrokKontrolyVystupu")} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

const changeTone: Record<ProcessDiffItem["change"], Tone> = { added: "green", removed: "red", changed: "amber" };
const changeLabel: Record<ProcessDiffItem["change"], string> = { added: "přidáno", removed: "odebráno", changed: "změněno" };

function CompareModal({ p, a, b, onClose }: { p: ProcessDetail; a: ProcessVersionDto; b: ProcessVersionDto | "current"; onClose: () => void }) {
  const t = useT();
  const sa = useQuery({ queryKey: ["process", p.id, "version", a.id], queryFn: () => api.processes.version(p.id, a.id) });
  const sb = useQuery({ queryKey: ["process", p.id, "version", b === "current" ? "current" : b.id], queryFn: () => api.processes.version(p.id, (b as ProcessVersionDto).id), enabled: b !== "current" });
  const snapB: ProcessSnapshot | undefined = b === "current" ? processSnapshotOf(p) : sb.data?.snapshot;
  const diff = sa.data && snapB ? diffProcess(sa.data.snapshot, snapB) : null;
  return (
    <Modal open onClose={onClose} title={t("prc.porovnaniVerzi", { a: a.number, b: b === "current" ? t("prc.aktualniStav") : t("my.verzeN", { v: b.number }) })} footer={<Button onClick={onClose}>{t("common.close")}</Button>}>
      <ErrorBox error={sa.error ?? sb.error} />
      {!diff ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : diff.length === 0 ? (
        <p className="text-sm text-slate-600">{t("prc.bezeZmen")}</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto text-sm">
          {diff.map((d, i) => (
            <li key={i} className="py-2">
              <div className="flex items-center gap-2">
                <Badge tone={changeTone[d.change]}>{t.lbl(changeLabel[d.change])}</Badge>
                <span className="font-medium">{d.label}</span>
              </div>
              {(d.from || d.to) && (
                <div className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
                  {d.from != null && <div className="whitespace-pre-wrap rounded bg-red-50 px-2 py-1 text-red-900 line-through decoration-red-300">{d.from.slice(0, 600)}</div>}
                  {d.to != null && <div className="whitespace-pre-wrap rounded bg-green-50 px-2 py-1 text-green-900">{d.to.slice(0, 600)}</div>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">{t("prc.krokySeParujiPodleNazvu", { p: t.lbl(PROCESS_LABELS.type[p.processType]) })}</p>
    </Modal>
  );
}
