import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { EvidenceFiles, EvidenceModal, UploadButton, ValidityBadge, useCanTest } from "@/components/assurance";
import { Badge, Button, Card, CardHeader, ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/utils";
import { ASSURANCE_LABELS, FRAMEWORKS } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

export function EvidenceDetailPage() {
  const t = useT();
  const { evidenceId } = useParams({ strict: false }) as { evidenceId: string };
  const canTest = useCanTest();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["evidence", evidenceId], queryFn: () => api.assurance.getEvidence(evidenceId) });
  const [edit, setEdit] = useState(false);
  const del = useMutation({ mutationFn: () => api.assurance.deleteEvidence(evidenceId), onSuccess: () => nav({ to: "/controls/assurance" }) });
  const e = q.data;
  if (!e) return <ErrorBox error={q.error} />;
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/controls/assurance" className="hover:text-brand-700">
          {t("asr.testyADukazy")}
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{e.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Badge>{t.lbl(ASSURANCE_LABELS.evidenceKind[e.kind])}</Badge>
            <ValidityBadge e={e} />
            {e.collectedAt && <span>{t("asr.porizeno2", { p: fmtDay(e.collectedAt) })}</span>}
            {e.periodFrom && e.periodTo && (
              <span>
                {t("asr.obdobi", { p: fmtDay(e.periodFrom), p2: fmtDay(e.periodTo) })}
              </span>
            )}
            <span>{t("asr.zalozilA", { p: e.createdByName ?? "?" })}</span>
          </div>
        </div>
        {canTest && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEdit(true)}>
              <Pencil size={15} /> {t("asr.upravit")}
            </Button>
            <Button variant="danger" onClick={async () => (await askConfirm(t("asr.smazatDukazVcetneSouboru"))) && del.mutate()}>
              <Trash2 size={15} />
            </Button>
          </div>
        )}
      </div>
      <ErrorBox error={del.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("asr.souboryAOdkazy")} subtitle={t("asr.souborySeUkladajiNemenneS")} action={canTest && <UploadButton evidenceId={e.id} small />} />
          <EvidenceFiles e={e} canEdit={canTest} />
        </Card>
        <div className="space-y-6">
          {e.description && (
            <Card>
              <CardHeader title={t("asr.popis")} />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-slate-700">{e.description}</p>
            </Card>
          )}
          {e.requirements.length > 0 && (
            <Card>
              <CardHeader title={t("asr.dokladaPozadavky", { length: e.requirements.length })} />
              <div className="flex flex-wrap gap-1.5 px-5 py-3">
                {e.requirements.map((r) => (
                  <Link key={r.id} to="/controls/soa" search={{ framework: r.framework as never }} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:border-brand-300">
                    {FRAMEWORKS.find((f) => f.id === r.framework)?.shortName} {r.ref}
                  </Link>
                ))}
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title={t("asr.dokladaOpatreni", { length: e.controls.length })} />
            <ul className="divide-y divide-slate-100">
              {e.controls.map((c) => (
                <li key={c.id} className="px-5 py-2 text-sm">
                  <Link to="/controls/$controlId" params={{ controlId: c.id }} className="hover:text-brand-700">
                    {c.code && <span className="mr-1.5 text-slate-500">{c.code}</span>}
                    {c.name}
                  </Link>
                </li>
              ))}
              {e.controls.length === 0 && <li className="px-5 py-3 text-sm text-slate-500">{t("asr.zatimNeprirazenoKOpatreni")}</li>}
            </ul>
          </Card>
        </div>
      </div>
      {edit && <EvidenceModal initial={e} onClose={() => setEdit(false)} />}
    </>
  );
}
