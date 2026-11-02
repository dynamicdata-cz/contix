import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { BpmnEditor, type BpmnEditorHandle } from "@/components/BpmnEditor";
import { Button, ErrorBox, SuccessBox } from "@/components/ui";
import { api } from "@/lib/api";
import type { ProcessDetail } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ListPlus, Maximize, RefreshCw, Save, Undo2 } from "lucide-react";
import { useRef, useState } from "react";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function DiagramTab({ process }: { process: ProcessDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const ed = useRef<BpmnEditorHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const bpmn = useQuery({ queryKey: ["process", process.id, "bpmn"], queryFn: () => api.processes.bpmn(process.id), staleTime: Infinity });
  const fileBase = (process.code ? `${process.code}-` : "") + process.name.replace(/[^\p{L}\p{N}]+/gu, "_");

  const save = useMutation({
    mutationFn: async () => api.processes.saveBpmn(process.id, await ed.current!.getXml()),
    onSuccess: () => {
      setDirty(false);
      setMsg(t("prc.diagramUlozen"));
      qc.invalidateQueries({ queryKey: ["process", process.id] });
    },
  });
  const regenerate = useMutation({
    mutationFn: () => api.processes.generateBpmn(process.id),
    onSuccess: async (r) => {
      await ed.current!.load(r.xml);
      setDirty(true);
      setMsg(t("prc.diagramVygenerovanZAktualnichKroku"));
    },
  });
  const clear = useMutation({
    mutationFn: () => api.processes.clearBpmn(process.id),
    onSuccess: async () => {
      const r = await api.processes.generateBpmn(process.id);
      await ed.current!.load(r.xml);
      setDirty(false);
      setMsg(t("prc.ulozenyDiagramOdstranenZobrazujeSe"));
      qc.invalidateQueries({ queryKey: ["process", process.id] });
    },
  });
  const importTasks = useMutation({
    mutationFn: () => api.processes.importSteps(process.id, ed.current!.tasks()),
    onSuccess: (r) => {
      setMsg(t("prc.doKrokuPridanoNovychUloh", { added: r.added, skipped: r.skipped }));
      qc.invalidateQueries({ queryKey: ["process", process.id] });
    },
  });

  if (bpmn.error) return <ErrorBox error={bpmn.error} />;
  if (!bpmn.data) return <div className="p-5 text-sm text-slate-500">{t("prc.nacitamDiagram")}</div>;
  const edit = process.canEdit;

  return (
    <div className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        {edit && (
          <>
            <Button disabled={save.isPending || (!dirty && !bpmn.data.generated)} onClick={() => save.mutate()}>
              <Save size={15} /> {t("prc.ulozitDiagram")}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => (!process.hasBpmn || (await askConfirm(t("prc.nahraditDiagramNovymVygenerovanymZ")))) && regenerate.mutate()}
            >
              <RefreshCw size={15} /> {t("prc.generovatZKroku")}
            </Button>
            <Button variant="secondary" title={t("prc.ulohyZDiagramuKtereV")} onClick={() => importTasks.mutate()}>
              <ListPlus size={15} /> {t("prc.prevzitUlohyDoKroku")}
            </Button>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => ed.current?.fit()} title={t("prc.prizpusobit")}>
            <Maximize size={15} />
          </Button>
          <Button variant="secondary" onClick={async () => download(`${fileBase}.bpmn`, await ed.current!.getXml(), "application/xml")}>
            <Download size={15} /> {t("prc.bpmn")}
          </Button>
          <Button variant="secondary" onClick={async () => download(`${fileBase}.svg`, await ed.current!.getSvg(), "image/svg+xml")}>
            <Download size={15} /> {t("prc.svg")}
          </Button>
          {edit && process.hasBpmn && (
            <Button variant="ghost" title={t("prc.zahoditUlozenyDiagram")} onClick={async () => (await askConfirm(t("prc.odstranitUlozenyDiagram"))) && clear.mutate()}>
              <Undo2 size={15} />
            </Button>
          )}
        </div>
      </div>
      {bpmn.data.generated && !dirty && !msg && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          {t("prc.diagramJeZatimJen")} <b>{t("prc.vygenerovanyZKroku")}</b> {t("prc.drahyPodleTohoKdoKrok")} {edit && t("prc.upravteHoAUlozteNebo")}
        </div>
      )}
      {msg && <SuccessBox>{msg}</SuccessBox>}
      <ErrorBox error={save.error ?? regenerate.error ?? importTasks.error ?? clear.error} />
      <BpmnEditor ref={ed} xml={bpmn.data.xml} readOnly={!edit} onChange={() => (setDirty(true), setMsg(null))} />
      <p className="text-xs text-slate-500">
        {t("prc.zdrojemPravdyJsou")} <b>{t("prc.kroky")}</b> {t("prc.popisRaciAktivaDiagramSlouzi")}
      </p>
    </div>
  );
}
