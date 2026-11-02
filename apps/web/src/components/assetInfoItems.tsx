/** Varování a upozornění informačního servisu, ve kterých je aktivum označené jako dotčené (ADR-088). */
import { Badge, Card, CardHeader, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDay } from "@/lib/utils";
import { FEED_ITEM_LABELS, INFO_ASSESSMENT_LABELS, type InfoAssessmentStatus } from "@contix/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

const TONE: Record<InfoAssessmentStatus, Tone> = { assessing: "amber", affected: "red", not_applicable: "slate", resolved: "green" };

export function AssetInfoItemsCard({ assetId }: { assetId: string }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const q = useQuery({ queryKey: ["infoservice", "by-asset", assetId], queryFn: () => api.infoService.byAsset(assetId), enabled: mod("legislation") && can("legislation:read") });
  if (!q.data?.length) return null;
  return (
    <Card className="lg:col-span-3" data-testid="asset-info-items">
      <CardHeader title={t("ifs.assetCard")} subtitle={t("ifs.assetCardSubtitle")} />
      <ul className="divide-y divide-slate-100">
        {q.data.map((i) => (
          <li key={i.id + i.companyId} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
            <Badge tone={i.kind === "warning" ? "red" : "amber"}>{t.lbl(FEED_ITEM_LABELS[i.kind])}</Badge>
            <span className="text-xs text-slate-500">{i.publishedAt ? fmtDay(i.publishedAt) : "—"}</span>
            <Link to="/infoservice" className="flex-1 text-brand-700 hover:underline">
              {i.title}
            </Link>
            <Badge tone={TONE[i.status]}>{t.lbl(INFO_ASSESSMENT_LABELS[i.status])}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
