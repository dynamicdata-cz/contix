import { useT } from "@/lib/i18n";
import { STATUS_COLORS } from "@/components/health";
import { useSwitchCompany } from "@/components/company";
import { Card, CardHeader, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, fmtDay } from "@/lib/utils";
import { FRAMEWORKS, fmtCzk, type CycleStatusDto } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Network } from "lucide-react";

const REG = { higher: "vyšší", lower: "nižší", none: "—" } as const;
const Dash = () => <span className="text-slate-300">—</span>;
const Warn = ({ n, children }: { n: number; children?: React.ReactNode }) =>
  n ? (
    <span className="inline-flex items-center gap-1 font-medium text-red-700">
      <AlertTriangle size={12} color={STATUS_COLORS.critical} /> {n}
      {children}
    </span>
  ) : (
    <span className="text-slate-500">0</span>
  );

function CycleCell({ st }: { st: CycleStatusDto | null }) {
  const t = useT();
  if (!st) return <td className="px-3 py-2.5"><Dash /></td>;
  return (
    <td className={cn("px-3 py-2.5 text-xs whitespace-nowrap", st.overdue && !st.runningId ? "font-medium text-red-700" : "text-slate-600")}>
      {st.runningId ? t("org.probiha") : st.lastApprovedAt ? `${fmtDay(st.lastApprovedAt)} → ${fmtDay(st.nextDue!)}` : t("org.dosudNeprobehlo")}
    </td>
  );
}

/** Souhrnný přehled skupiny – klíčové ukazatele za každou společnost. */
export function GroupPage() {
  const t = useT();
  const q = useQuery({ queryKey: ["companies", "overview"], queryFn: api.companies.overview });
  const switchTo = useSwitchCompany();
  const rows = q.data ?? [];
  return (
    <>
      <PageHeader title={t("org.prehledSkupiny")} subtitle={t("org.stavKybernetickeBezpecnostiPoSpolecnoste")} />
      <ErrorBox error={q.error} />
      <Card className="overflow-x-auto">
        <CardHeader title={t("org.spolecnosti")} />
        {rows.length === 0 ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("org.spolecnost")}</th>
                <th className="px-3 py-2">{t("org.rezim")}</th>
                <th className="px-3 py-2 text-right">{t("org.miraShody")}</th>
                <th className="px-3 py-2 text-right">{t("org.rizikaKritVys")}</th>
                <th className="px-3 py-2 text-right">{t("org.neprijatelna")}</th>
                <th className="px-3 py-2 text-right">{t("org.akcePoTerminu")}</th>
                <th className="px-3 py-2 text-right">{t("org.otevreneIncidenty")}</th>
                <th className="px-3 py-2 text-right">{t("org.hlaseniPoTerminu")}</th>
                <th className="px-3 py-2 text-right">{t("org.dodavateleSMezerami")}</th>
                <th className="px-3 py-2">{t("org.hodnoceniRizik")}</th>
                <th className="px-3 py-2">{t("org.prezkoumaniBia")}</th>
                <th className="px-3 py-2 text-right">{t("org.ocekavanaZtrata")}</th>
                <th className="px-3 py-2">{t("org.prezkoumaniIsms")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <button className="flex items-center gap-2 text-left font-medium hover:text-brand-700" style={{ paddingLeft: r.depth * 18 }} onClick={() => switchTo(r.id)}>
                      {r.kind === "holding" ? <Network size={14} className="text-brand-600" /> : <Building2 size={14} className="text-slate-400" />}
                      {r.name}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {t.lbl(REG[r.regime])} · {FRAMEWORKS.find((x) => x.id === r.framework)?.shortName ?? r.framework}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.compliance == null ? <Dash /> : `${r.compliance.toLocaleString("cs-CZ")} %`}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.risks ? `${r.risks.total} (${r.risks.critical}/${r.risks.high})` : <Dash />}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.risks ? <Warn n={r.risks.unacceptable} /> : <Dash />}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.risks ? <Warn n={r.risks.overdueActions} /> : <Dash />}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.incidents ? r.incidents.open : <Dash />}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.incidents ? <Warn n={r.incidents.overdueReports} /> : <Dash />}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.suppliers ? <Warn n={r.suppliers.withGaps} /> : <Dash />}</td>
                  <CycleCell st={r.risks?.cycle ?? null} />
                  <CycleCell st={r.plans?.biaCycle ?? null} />
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.risks?.ale != null ? fmtCzk(r.risks.ale) : <Dash />}</td>
                  <td className={cn("px-3 py-2.5 text-xs whitespace-nowrap", r.review?.overdue ? "font-medium text-red-700" : "text-slate-600")}>
                    {r.review ? (r.review.lastApprovedAt ? `${fmtDay(r.review.lastApprovedAt)} → ${fmtDay(r.review.nextDue)}` : t("org.dosudNeprobehlo")) : <Dash />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
