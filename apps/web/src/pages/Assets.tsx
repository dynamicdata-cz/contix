import { useDebounced } from "@/lib/utils";
import { useUrlParam } from "@/lib/urlState";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, criticalityTone, ErrorBox, Input, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import {
  ASSET_CLASSES,
  ASSET_TYPES,
  CRITICALITIES,
  LABELS,
  SOURCE_TYPES,
  type AssetClass,
  type AssetType,
  type Criticality,
  type SourceType,
} from "@contix/shared";
import { useCan, useMe } from "@/lib/auth";
import { useCompanyName } from "@/components/company";
import { HealthIndicator, VulnCounts } from "@/components/health";
import { HEALTH_STATUSES, VULN_LABELS, type HealthStatus } from "@contix/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Copy, Network, Plus, Search, Share2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";

const PAGE = 50;

export function AssetsPage() {
  const t = useT();
  const me = useMe();
  const coName = useCompanyName();
  const navigate = useNavigate();
  // filtry v adrese (v1.06); stránkování jen v paměti
  const [q, setQ] = useUrlParam("q");
  const [assetType, setType] = useUrlParam<AssetType | "">("type");
  const [assetClass, setClass] = useUrlParam<AssetClass | "">("class");
  const [health, setHealth] = useUrlParam<HealthStatus | "">("health");
  const [sort, setSort] = useUrlParam<"name" | "risk">("sort", new URLSearchParams(location.search).get("health") ? "risk" : "name");
  const can = useCan();
  const [criticality, setCrit] = useUrlParam<Criticality | "">("criticality");
  const [source, setSource] = useUrlParam<SourceType | "">("source");
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);

  const query = { q: dq, sort, health: health || undefined, assetClass: assetClass || undefined, assetType: assetType || undefined, criticality: criticality || undefined, source: source || undefined, limit: PAGE, offset };
  const { data, error, isFetching } = useQuery({
    queryKey: ["assets", query],
    queryFn: () => api.assets.list(query),
    placeholderData: keepPreviousData,
  });

  const reset = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setOffset(0);
  };

  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("ast.aktiva")}
        subtitle={t("ast.jednotnyInventarRucniZaznamyWazuh")}
        actions={
          <div className="flex gap-2">
            <Link to="/assets/resilience">
              <Button variant="secondary">
                <ShieldAlert size={16} /> {t("res.title")}
              </Button>
            </Link>
            <Link to="/assets/certificates">
              <Button variant="secondary">
                <ShieldCheck size={16} /> {t("tls.title")}
              </Button>
            </Link>
            <Link to="/assets/graph">
              <Button variant="secondary">
                <Network size={16} /> {t("ag.title")}
              </Button>
            </Link>
            <Link to="/assets/duplicates">
              <Button variant="secondary">
                <Copy size={16} /> {t("ast.duplicity")}
              </Button>
            </Link>
            {can("assets:write", "assets:write_own") && (
              <Link to="/assets/new">
                <Button>
                  <Plus size={16} /> {t("ast.noveAktivum")}
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="relative sm:col-span-3 lg:col-span-6">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <Input className="pl-9" placeholder={t("ast.hledatNazevHostnameIpSeriove")} value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        </div>
        <Select value={health} onChange={(e) => reset(setHealth)(e.target.value as HealthStatus | "")}>
          <option value="">{t("ast.semaforVse")}</option>
          {HEALTH_STATUSES.map((h) => (
            <option key={h} value={h}>
              {t.lbl(VULN_LABELS.health[h])}
            </option>
          ))}
        </Select>
        <Select value={assetClass} onChange={(e) => reset(setClass)(e.target.value as AssetClass | "")}>
          <option value="">{t("ast.vsechnyTridy")}</option>
          {ASSET_CLASSES.map((c) => (
            <option key={c} value={c}>
              {t.lbl(LABELS.assetClass[c])}
            </option>
          ))}
        </Select>
        <Select value={assetType} onChange={(e) => reset(setType)(e.target.value as AssetType | "")}>
          <option value="">{t("ast.vsechnyTypy")}</option>
          {ASSET_TYPES.map((tx) => (
            <option key={tx} value={tx}>
              {t.lbl(LABELS.assetType[tx])}
            </option>
          ))}
        </Select>
        <Select value={criticality} onChange={(e) => reset(setCrit)(e.target.value as Criticality | "")}>
          <option value="">{t("ast.kriticnost")}</option>
          {CRITICALITIES.map((c) => (
            <option key={c} value={c}>
              {t.lbl(LABELS.criticality[c])}
            </option>
          ))}
        </Select>
        <Select value={source} onChange={(e) => reset(setSource)(e.target.value as SourceType | "")}>
          <option value="">{t("ast.vsechnyZdroje")}</option>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(LABELS.source[s])}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => reset(setSort)(e.target.value as "name" | "risk")}>
          <option value="name">{t("ast.raditNazev")}</option>
          <option value="risk">{t("ast.raditRiziko")}</option>
        </Select>
      </Card>

      <ErrorBox error={error} />

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-4 py-3" aria-label={t("ast.stav")} />
              <th className="px-4 py-3">{t("ast.nazev2")}</th>
              <th className="px-4 py-3">{t("ast.typTrida")}</th>
              <th className="px-4 py-3">{t("ast.ipHostname")}</th>
              <th className="px-4 py-3">{t("ast.os2")}</th>
              <th className="px-4 py-3">{t("ast.vlastnik")}</th>
              <th className="px-4 py-3">{t("ast.kriticnost")}</th>
              <th className="px-4 py-3">{t("ast.naposledyVideno")}</th>
            </tr>
          </thead>
          <tbody className={isFetching ? "opacity-60" : ""}>
            {data?.items.map((a) => (
              <tr
                key={a.id}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                onClick={() => navigate({ to: "/assets/$assetId", params: { assetId: a.id } })}
              >
                <td className="px-4 py-3">
                  <HealthIndicator status={a.healthStatus} reasons={a.healthReasons} />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">
                    {a.name}
                    {!!a.sharedWith?.length && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 align-middle text-[11px] font-medium text-brand-700" title={t("ash.listTitle")}>
                        <Share2 size={10} />
                        {me.activeCompanyId && a.companyId !== me.activeCompanyId && a.sharedWith.includes(me.activeCompanyId) ? t("ash.sharedFrom", { name: coName(a.companyId) }) : t("ash.sharedCount", { n: a.sharedWith.length })}
                      </span>
                    )}
                  </div>
                  <VulnCounts c={{ critical: a.vulnCritical, high: a.vulnHigh, medium: a.vulnMedium, low: a.vulnLow }} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{t.lbl(LABELS.assetType[a.assetType])}</div>
                  <div className={a.assetClass === "primary" ? "text-xs font-medium text-violet-700" : "text-xs text-slate-400"}>
                    {t.lbl(LABELS.assetClass[a.assetClass])}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div>{a.ipAddresses.slice(0, 2).join(", ") || "—"}</div>
                  {a.hostname && <div className="text-xs text-slate-400">{a.hostname}</div>}
                </td>
                <td className="px-4 py-3 text-slate-600">{[a.osName, a.osVersion].filter(Boolean).join(" ") || "—"}</td>
                <td className="px-4 py-3 text-slate-600">{a.ownerDisplayName ?? a.ownerName ?? <span className="text-amber-600">{t("ast.neprirazen2")}</span>}</td>
                <td className="px-4 py-3">
                  <Badge tone={criticalityTone[a.criticality]}>{t.lbl(LABELS.criticality[a.criticality])}</Badge>
                </td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(a.lastSeenAt)}</td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  {t("common.nothingFound")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
            <span>
              {offset + 1}–{Math.min(offset + PAGE, data.total)} {t("common.of")} {data.total}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(offset - PAGE)}>
                {t("ast.predchozi")}
              </Button>
              <Button variant="secondary" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                {t("ast.dalsi")}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
