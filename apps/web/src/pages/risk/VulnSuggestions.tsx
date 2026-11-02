import { useT } from "@/lib/i18n";
import { CompanyCell, useGroupView } from "@/components/company";
import { SeverityBadge } from "@/components/health";
import { Button, Card, CardHeader, ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import type { Severity } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Lightbulb } from "lucide-react";
import { useState } from "react";

/** Návrhy rizik z kritických a vysokých zranitelností, které zatím nejsou ošetřeny žádným rizikem. */
export function VulnSuggestions() {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const group = useGroupView();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["risks", "vuln-suggestions"], queryFn: api.risks.vulnSuggestions, enabled: mod("vulnerabilities") && can("assets:read") });
  const create = useMutation({
    mutationFn: (assetId: string) => api.risks.fromVulns(assetId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["risks"] });
      nav({ to: "/risks/$riskId", params: { riskId: r.id } });
    },
  });
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title={t("rsk.navrhyRizikZeZranitelnosti", { length: rows.length })}
        subtitle={t("rsk.aktivaSOtevrenymiKritickymiA")}
        action={
          <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(!open)}>
            <Lightbulb size={14} /> {open ? t("rsk.skryt") : t("rsk.vs.show")}
          </Button>
        }
      />
      <ErrorBox error={q.error ?? create.error} />
      {open && (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => (
              <tr key={s.assetId}>
                <td className="px-5 py-2.5">
                  <div className="font-medium">{s.assetName}</div>
                  {group && <CompanyCell id={s.companyId} />}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {s.cves.slice(0, 6).map((v) => (
                      <span key={v.id} className="inline-flex items-center gap-1 text-xs text-slate-600">
                        <SeverityBadge severity={v.severity as Severity} /> {v.cveId}
                      </span>
                    ))}
                    {s.cveCount > 6 && <span className="text-xs text-slate-500">{t("rsk.vs.more", { n: s.cveCount - Math.min(6, s.cves.length) })}</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  {t("rsk.navrhZranitelnost")} {s.suggestedVulnLevel}
                  {s.suggestedImpact != null ? `, ${t("rsk.vs.impact", { n: s.suggestedImpact })}` : ""}
                  <div>{t("rsk.vs.count", { n: s.cveCount, c: s.criticalCount })}</div>
                </td>
                <td className="px-5 py-2.5 text-right">
                  {can("risks:write") && (
                    <Button className="px-2.5 py-1 text-xs" disabled={create.isPending} onClick={() => create.mutate(s.assetId)}>
                      {t("rsk.zalozitRiziko")}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
