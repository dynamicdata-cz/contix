import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, ErrorBox, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { SETUP_LABELS, type SetupDto, type SetupStatus } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, CircleDashed, CircleMinus, Download, FolderTree, Printer } from "lucide-react";
import type { ReactNode } from "react";

const tone: Record<SetupStatus, Tone> = { done: "green", partial: "amber", todo: "red", skipped: "slate" };
const icon: Record<SetupStatus, ReactNode> = {
  done: <CheckCircle2 size={20} className="text-emerald-600" aria-hidden />,
  partial: <CircleDashed size={20} className="text-amber-600" aria-hidden />,
  todo: <Circle size={20} className="text-red-500" aria-hidden />,
  skipped: <CircleMinus size={20} className="text-slate-400" aria-hidden />,
};

/** Průvodce prvním nastavením organizace – stav kroků počítá API z dat. */
export function AdminSetupPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["setup"], queryFn: api.setup.get });
  const folders = useMutation({
    mutationFn: api.setup.docFolders,
    onSuccess: (d) => {
      qc.setQueryData(["setup"], d);
      qc.invalidateQueries({ queryKey: ["policies"] });
    },
  });
  const d: SetupDto | undefined = q.data;
  return (
    <>
      <ErrorBox error={q.error ?? folders.error} />
      {d && (
        <>
          <Card className="mb-6 flex flex-wrap items-center gap-6 p-5">
            <div className="min-w-56 flex-1">
              <div className="text-sm text-slate-600">{t("set.povinneKroky")}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {d.done} <span className="text-base font-normal text-slate-500">z {d.total}</span>
              </div>
              <div className="mt-2 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={d.done} aria-valuemax={d.total}>
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${d.total ? (d.done / d.total) * 100 : 0}%` }} />
              </div>
              <p className="mt-2 text-sm text-slate-600">{d.ready ? t("set.organizaceJePripravenaKPredani") : t("set.projdeteKrokyShoraDoluOdkaz")}</p>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-xs font-medium text-slate-600">{t("set.predavaciProtokol")}</div>
              <div className="flex gap-2">
                <a href={api.setup.protocolUrl("docx")}>
                  <Button variant="secondary">
                    <Download size={15} /> {t("set.word")}
                  </Button>
                </a>
                <a href={api.setup.protocolUrl("html")} target="_blank" rel="noreferrer">
                  <Button variant="secondary">
                    <Printer size={15} /> {t("set.tiskPdf")}
                  </Button>
                </a>
              </div>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title={t("set.krokyNastaveni")} subtitle={t("set.stavSeVyhodnocujeZAktualnich")} />
            <ol className="divide-y divide-slate-100">
              {d.steps.map((st, i) => (
                <li key={st.key} className={cn("flex gap-4 px-5 py-4", st.status === "skipped" && "opacity-60")}>
                  <div className="pt-0.5">{icon[st.status]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs tabular-nums text-slate-400">{i + 1}.</span>
                      <span className="font-medium">{st.title}</span>
                      <Badge tone={tone[st.status]}>{t.lbl(SETUP_LABELS.status[st.status])}</Badge>
                      {st.optional && <span className="text-xs text-slate-500">{t("set.volitelne")}</span>}
                    </div>
                    {st.why && <p className="mt-0.5 text-sm text-slate-600">{st.why}</p>}
                    {st.detail.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 text-sm text-slate-700">
                        {st.detail.map((x, k) => (
                          <li key={k}>{x}</li>
                        ))}
                      </ul>
                    )}
                    {st.key === "documentation" && d.canCreateDocFolders && can("policies:write") && (
                      <Button variant="secondary" className="mt-2 px-2.5 py-1 text-xs" disabled={folders.isPending} onClick={() => folders.mutate()}>
                        <FolderTree size={14} /> {t("set.zalozitVychoziStrukturuSlozek")}
                      </Button>
                    )}
                  </div>
                  {st.status !== "skipped" && (
                    <Link to={st.link as never} className="self-center whitespace-nowrap text-sm font-medium text-brand-700 hover:underline">
                      {st.status === "done" ? "Zobrazit" : "Nastavit"} →
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </>
  );
}
