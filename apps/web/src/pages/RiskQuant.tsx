import { useT } from "@/lib/i18n";
import { CompanyCell, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { LossExceedanceChart } from "@/components/lec";
import { RiskLevelBadge } from "@/components/risk";
import { Card, CardHeader, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtCzk } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

/** Kvantitativní přehled rizik (FAIR) – portfolio, ochota nést riziko, návratnost opatření. */
export function RiskQuantPage() {
  const t = useT();
  const group = useGroupView();
  const q = useQuery({ queryKey: ["risks", "quant"], queryFn: api.risks.quant });
  const d = q.data;
  const ap = d?.policy.appetiteYear ?? null;
  const over = d?.portfolio && ap != null ? d.portfolio.p95 > ap : null;
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/risks" className="hover:text-brand-700">
          {t("rsk.rizika")}
        </Link>
      </div>
      <PageHeader
        title={t("rsk.kvantitativniAnalyzaRizik")}
        subtitle={t("rsk.fairRocniZtratyZKvantifikovanych")}
      />
      <ErrorBox error={q.error} />
      {d && !d.items.length && (
        <Card className="p-6 text-sm text-slate-600">
          {t("rsk.zatimZadneKvantifikovaneRizikoU")} <b>{t("rsk.kvantifikovat")}</b> {t("rsk.nejvicSeToVyplatiU")}
        </Card>
      )}
      {d?.portfolio && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <CardHeader title={t("rsk.portfolio")} subtitle={`${t("rsk.kvantifikovanychRizik", { n: d.items.length })}${d.unquantified ? t("rsk.dalsichJenKvalitativne", { unquantified: d.unquantified }) : ""}`} />
            <div className="grid grid-cols-2 gap-4 p-5">
              <Big label={t("rsk.ocekavanaRocniZtrata")} value={fmtCzk(d.portfolio.mean)} />
              <Big label={t("rsk.s95Neprekroci")} value={fmtCzk(d.portfolio.p95)} />
              <Big label={t("rsk.s99Neprekroci")} value={fmtCzk(d.portfolio.p99)} />
              {d.residualPortfolio && <Big label={t("rsk.poOpatrenichPrumer")} value={fmtCzk(d.residualPortfolio.mean)} />}
            </div>
            <div className="border-t border-slate-100 px-5 py-3 text-sm">
              {ap == null ? (
                <span className="text-slate-500">{t("rsk.ochotaNestRizikoNeniStanovena")}</span>
              ) : over ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
                  <AlertTriangle size={15} color={STATUS_COLORS.critical} /> {t("rsk.ztrataS95PravdepodobnostiPrevysuje")}{fmtCzk(ap)} {t("rsk.rok")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 size={15} color={STATUS_COLORS.good} /> {t("rsk.vMezichOchotyNestRiziko")}{fmtCzk(ap)} {t("rsk.rok")}
                </span>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title={t("rsk.krivkaPrekroceniZtratPortfolio")} />
            <div className="p-5">
              <LossExceedanceChart inherent={d.portfolio} residual={d.residualPortfolio} appetite={ap} height={240} />
            </div>
          </Card>
        </div>
      )}
      {d && d.items.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title={t("rsk.rizikaPodleOcekavaneZtraty")} subtitle={t("rsk.navratnostRosiSnizeniZtratyRocni")} />
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("rsk.riziko")}</th>
                <th className="px-3 py-2">{t("rsk.kvalitativne")}</th>
                <th className="px-3 py-2 text-right">{t("rsk.ocekavanaZtrata")}</th>
                <th className="px-3 py-2 text-right">95 %</th>
                <th className="px-3 py-2">{t("rsk.pasmo")}</th>
                <th className="px-3 py-2 text-right">{t("rsk.poOpatrenich")}</th>
                <th className="px-3 py-2 text-right">{t("rsk.rosi")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {d.items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link to="/risks/$riskId" params={{ riskId: r.id }} className="font-medium hover:text-brand-700">
                      {r.code && <span className="mr-1.5 text-slate-500">{r.code}</span>}
                      {r.name}
                    </Link>
                    {group && (
                      <div>
                        <CompanyCell id={r.companyId} />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <RiskLevelBadge level={r.level} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtCzk(r.ale)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtCzk(r.p95)}</td>
                  <td className="px-3 py-2.5">
                    <RiskLevelBadge level={r.quantLevel} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{r.residualAle != null ? fmtCzk(r.residualAle) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.rosi != null ? <span className={r.rosi < 0 ? "text-red-700" : ""}>{Math.round(r.rosi * 100)} %</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
