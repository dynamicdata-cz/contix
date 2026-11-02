import { useT } from "@/lib/i18n";
import { RiskLevelBadge } from "@/components/risk";
import { Button, Card, CardHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GitBranch, Plus, ShieldAlert } from "lucide-react";

/** Na detailu aktiva: procesy, které aktivum používají, a rizika, která se ho týkají. */
export function AssetGrcCard({ assetId }: { assetId: string }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const showProc = mod("processes") && can("processes:read");
  const showRisk = mod("risks") && can("risks:read");
  const procs = useQuery({ queryKey: ["processes", "asset", assetId], queryFn: () => api.processes.list({ assetId }), enabled: showProc });
  const risks = useQuery({ queryKey: ["risks", "asset", assetId], queryFn: () => api.risks.list({ assetId, limit: 50 }), enabled: showRisk });
  if (!showProc && !showRisk) return null;
  return (
    <Card>
      <CardHeader
        title={t("ast.procesyARizika")}
        action={
          showRisk &&
          can("risks:write") && (
            <Link to="/risks/new" search={{ assetId }}>
              <Button variant="ghost" className="px-2 text-xs">
                <Plus size={14} /> {t("ast.riziko")}
              </Button>
            </Link>
          )
        }
      />
      <div className="space-y-4 px-5 py-4 text-sm">
        {showProc && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t("ast.pouzivajiProcesy")}</div>
            {procs.data?.length ? (
              procs.data.map((p) => (
                <Link key={p.id} to="/processes/$processId" params={{ processId: p.id }} className="flex items-center gap-2 py-0.5 hover:text-brand-700">
                  <GitBranch size={13} className="text-slate-400" />
                  {p.code && <span className="text-slate-500">{p.code}</span>}
                  {p.name}
                </Link>
              ))
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </div>
        )}
        {showRisk && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t("ast.rizika")}</div>
            {risks.data?.items.length ? (
              risks.data.items.map((r) => (
                <Link key={r.id} to="/risks/$riskId" params={{ riskId: r.id }} className="flex items-center gap-2 py-0.5 hover:text-brand-700">
                  <ShieldAlert size={13} className="text-slate-400" />
                  <span className="flex-1 truncate">{r.name}</span>
                  <RiskLevelBadge level={r.level} />
                </Link>
              ))
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
