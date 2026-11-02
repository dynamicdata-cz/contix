import { Tabs, useTab } from "@/components/ui/tabs";
import { askConfirm } from "@/components/ui/overlay";
import { LinkedRecordsCard } from "@/components/linkedRecords";
import { TasksCard } from "@/components/tasks";
import { useT } from "@/lib/i18n";
import { LinkedDocsCard } from "@/components/linkedDocs";
import { AiSuggestPanel } from "@/components/ai";
import { TransferButton } from "@/components/transfer";
import { AssetSharingCard } from "@/components/assetSharing";
import { AssetInfoItemsCard } from "@/components/assetInfoItems";
import { Badge, Button, Card, CardHeader, criticalityTone, EmptyState, ErrorBox, Field, Input, Modal, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { HealthIndicator, SupportBadge, VulnCounts } from "@/components/health";
import { VulnTable } from "@/components/VulnTable";
import { AssetGrcCard } from "@/components/AssetGrcCard";
import { useCan, useModule } from "@/lib/auth";
import { AssetScaCard } from "./Sca";
import { cn, fmtDate } from "@/lib/utils";
import { ASSET_GRAPH_LABELS, hostKeyOfAsset, LABELS, type HealthStatus, type AssetClass, type LinkedAssetDto, type SourceType } from "@contix/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, Link2, Network, Pencil, Plus, Radar, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";

const CIA_LABEL = ["", "nízká", "střední", "vysoká", "kritická"];

export function AssetDetailPage() {
  const t = useT();
  const { assetId } = useParams({ from: "/app/assets/$assetId" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mod = useModule();
  const can = useCan();
  const [linking, setLinking] = useState(false);
  const [tab, setTab] = useTab(["overview", "governance", "security", "tasks"] as const, "overview");
  const { data: a, error } = useQuery({ queryKey: ["asset", assetId], queryFn: () => api.assets.get(assetId) });
  const del = useMutation({
    mutationFn: () => api.assets.remove(assetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      navigate({ to: "/assets" });
    },
  });
  const unlink = useMutation({
    mutationFn: (other: LinkedAssetDto) =>
      a!.assetClass === "primary" ? api.assets.unlink(a!.id, other.id) : api.assets.unlink(other.id, a!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["asset"] }),
  });

  if (error) return <ErrorBox error={error} />;
  if (!a) return <p className="text-slate-500">{t("common.loading")}</p>;

  const isPrimary = a.assetClass === "primary";
  const links = isPrimary ? a.supportedBy : a.supports;
  const eff = a.effectiveCia;
  const cia = (own: number | null, e: number | null) => (
    <span>
      {e ? `${e} – ${t.lbl(CIA_LABEL[e])}` : "—"}
      {e !== own && <span className="ml-1 text-xs text-violet-700">{t("ast.zdedenoVlastni", { p: own ?? "—" })}</span>}
    </span>
  );

  return (
    <>
      <PageHeader
        sticky
        title={a.name}
        subtitle={`${t.lbl(LABELS.assetClass[a.assetClass])} aktivum · ${t.lbl(LABELS.assetType[a.assetType])} · ${t.lbl(LABELS.lifecycleStatus[a.lifecycleStatus])}`}
        actions={
          <>
            {mod("soc") && can("soc:read") && (
              <Link to="/soc/hosts/$hostKey" params={{ hostKey: hostKeyOfAsset(a.id) }}>
                <Button variant="secondary">
                  <Radar size={15} /> {t("soc.host.open")}
                </Button>
              </Link>
            )}
            {a.canEdit && (
              <Link to="/assets/$assetId/edit" params={{ assetId }}>
                <Button variant="secondary">
                  <Pencil size={15} /> {t("ast.upravit")}
                </Button>
              </Link>
            )}
            {a.ownedHere && can("assets:write") && <TransferButton entity="assets" id={a.id} companyId={a.companyId} />}
            {a.ownedHere && can("assets:delete") && (
              <Button variant="danger" disabled={del.isPending} onClick={async () => (await askConfirm(t("ast.smazatAktivum", { name: a.name }))) && del.mutate()}>
                <Trash2 size={15} /> {t("ast.smazat")}
              </Button>
            )}
          </>
        }
      />
      <ErrorBox error={del.error ?? unlink.error} />

      <HealthBanner asset={a} />
      <AssetSharingCard asset={a} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview" as const, label: t("detail.tab.overview") },
          { key: "governance" as const, label: t("detail.tab.governance") },
          { key: "security" as const, label: t("detail.tab.security") },
          { key: "tasks" as const, label: t("detail.tab.tasks") },
        ]}
      />
      {tab === "governance" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <AssetGrcCard assetId={a.id} />
          <LinkedRecordsCard target="asset" id={a.id} />
          <LinkedDocsCard kind="asset" id={a.id} />
        </div>
      )}
      {tab === "security" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <AssetScaCard assetId={a.id} />
          <AssetInfoItemsCard assetId={a.id} />
        </div>
      )}
      {tab === "tasks" && <TasksCard kind="asset" id={a.id} />}

      <div className={cn("grid gap-6 lg:grid-cols-3", tab !== "overview" && "hidden")}>
        {a.vulnCritical + a.vulnHigh + a.vulnMedium + a.vulnLow > 0 && (
        <Card className="lg:col-span-3">
          <CardHeader
            title={t("ast.zranitelnostiCve")}
            subtitle={t("ast.zWazuhVulnerabilityDetectionU")}
          />
          <VulnTable assetId={a.id} canEditAsset={a.canEdit} />
        </Card>
        )}
        <Card className="lg:col-span-2">
          <CardHeader
            title={isPrimary ? t("ast.podpurnaAktiva", { length: links.length }) : t("ast.podporujePrimarniAktiva", { length: links.length })}
            subtitle={
              isPrimary
                ? t("ast.technikaLideDodavateleAProstory")
                : t("ast.hodnoceniCiaSeDediZ")
            }
            action={
              a.canEdit && (
                <Button variant="secondary" onClick={() => setLinking(true)}>
                  <Plus size={15} /> {t("ast.pridatVazbu")}
                </Button>
              )
            }
          />
          <ul className="divide-y divide-slate-100">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                {isPrimary ? <ArrowDownRight size={16} className="text-slate-400" /> : <ArrowUpRight size={16} className="text-violet-500" />}
                <Link to="/assets/$assetId" params={{ assetId: l.id }} className="font-medium text-brand-700 hover:underline">
                  {l.name}
                </Link>
                <span className="text-slate-500">{t.lbl(LABELS.assetType[l.assetType])}</span>
                {l.note && <span className="text-xs text-slate-400">– {l.note}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">
                    C{l.confidentiality ?? "-"} I{l.integrity ?? "-"} A{l.availability ?? "-"}
                  </span>
                  <Badge tone={criticalityTone[l.criticality]}>{t.lbl(LABELS.criticality[l.criticality])}</Badge>
                  {a.canEdit && (
                    <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" title={t("ast.odebratVazbu")} onClick={() => unlink.mutate(l)}>
                      <X size={15} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!links.length && (
            <EmptyState>
              {isPrimary ? t("ast.zatimNejsouPrirazenaZadnaPodpurna") : t("ast.aktivumZatimNepodporujeZadnePrimarni")}
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title={t("ast.rizeniGrc")} subtitle={t("ast.vyplnujeVlastnikKonektoryNeprepisuji")} />
          <dl className="space-y-4 p-5">
            <Item label={t("ast.podporaOs")}>
              <SupportBadge status={a.supportStatus} eolDate={a.osEolDate} />
            </Item>
            <Item label={t("ast.kriticnost")}>
              <Badge tone={criticalityTone[a.criticality]}>{t.lbl(LABELS.criticality[a.criticality])}</Badge>
            </Item>
            <Item label={t("ast.duvernost")}>{cia(a.confidentiality, eff.confidentiality)}</Item>
            <Item label={t("ast.integrita")}>{cia(a.integrity, eff.integrity)}</Item>
            <Item label={t("ast.dostupnost")}>{cia(a.availability, eff.availability)}</Item>
            <Item label={t("ast.garantVlastnik")}>{a.owner ? `${a.owner.displayName} (${a.owner.email})` : null}</Item>
            <Item label={t("ast.odpovednyUtvar")}>{a.ownerName}</Item>
            <Item label={t("ast.umisteni")}>{a.location}</Item>
            <Item label={t("ast.prostredi")}>{a.environment ? t.lbl(LABELS.environment[a.environment]) : null}</Item>
            <Item label={t("ast.stitky")}>
              {a.tags.length ? (
                <div className="flex flex-wrap gap-1">
                  {a.tags.map((tx) => (
                    <Badge key={tx}>{tx}</Badge>
                  ))}
                </div>
              ) : null}
            </Item>
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title={t("ast.technickeUdaje")} subtitle={t("ast.doplnujiSeAutomatickyZKonektoru")} />
          <dl className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
            <Item label={t("ast.hostname")}>{a.hostname}</Item>
            <Item label={t("ast.fqdn")}>{a.fqdn}</Item>
            <Item label={t("ast.ipAdresy")}>{a.ipAddresses.join(", ")}</Item>
            <Item label={t("ast.macAdresy")}>{a.macAddresses.join(", ")}</Item>
            <Item label={t("ast.operacniSystem")}>{[a.osName, a.osVersion].filter(Boolean).join(" ")}</Item>
            <Item label={t("ast.vyrobceModel")}>{[a.manufacturer, a.model].filter(Boolean).join(" ")}</Item>
            <Item label={t("ast.serioveCislo")}>{a.serialNumber}</Item>
            <Item label={t("ast.poprveNaposledyVideno")}>
              {fmtDate(a.firstSeenAt)} / {fmtDate(a.lastSeenAt)}
            </Item>
          </dl>
          {a.description && <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-700">{a.description}</p>}
        </Card>

        <div className="lg:col-span-3 empty:hidden">
          <AiSuggestPanel useCase="asset_classification" entityId={a.id} canApply={a.canEdit} onApplied={() => qc.invalidateQueries({ queryKey: ["asset", assetId] })} />
        </div>
        <Card>
          <CardHeader title={t("ast.zdrojeZaznamu")} />
          <ul className="divide-y divide-slate-100">
            {a.sources.map((s) => (
              <li key={`${s.sourceType}:${s.sourceRef}`} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <Badge tone="violet">{t.lbl(LABELS.source[s.sourceType as SourceType])}</Badge>
                  <span className="text-xs text-slate-500">{fmtDate(s.lastSyncedAt)}</span>
                </div>
                <div className="mt-1 truncate font-mono text-xs text-slate-500">{s.sourceRef}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-3" data-testid="asset-dependencies">
          <CardHeader
            title={t("ag.depsTitle", { n: a.dependsOn.length + a.dependedBy.length })}
            subtitle={t("ag.depsSub")}
            action={
              <Link to="/assets/graph" search={{ focus: a.id } as never}>
                <Button variant="secondary">
                  <Network size={15} /> {t("ag.showInGraph")}
                </Button>
              </Link>
            }
          />
          {a.dependsOn.length + a.dependedBy.length === 0 ? (
            <EmptyState>{t("ag.depsEmpty")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {[...a.dependsOn.map((d) => ({ ...d, dir: "out" as const })), ...a.dependedBy.map((d) => ({ ...d, dir: "in" as const }))].map((d) => (
                <li key={`${d.dir}-${d.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  {d.dir === "out" ? <ArrowDownRight size={16} className="text-blue-500" /> : <ArrowUpRight size={16} className="text-slate-400" />}
                  <span className="text-xs text-slate-500">{d.dir === "out" ? t.lbl(ASSET_GRAPH_LABELS.depKind[d.kind]) : t("ag.dependedByKind", { kind: t.lbl(ASSET_GRAPH_LABELS.depKind[d.kind]) })}</span>
                  <Link to="/assets/$assetId" params={{ assetId: d.id }} className="font-medium text-brand-700 hover:underline">
                    {d.name}
                  </Link>
                  <span className="text-slate-500">{t.lbl(LABELS.assetType[d.assetType])}</span>
                  {d.note && <span className="text-xs text-slate-400">– {d.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>


        {a.vulnCritical + a.vulnHigh + a.vulnMedium + a.vulnLow === 0 && (
          <Card className="lg:col-span-3">
            <CardHeader title={t("ast.zranitelnostiCve")} subtitle={t("ast.historieAVyjimky")} />
            <VulnTable assetId={a.id} canEditAsset={a.canEdit} />
          </Card>
        )}

        {a.software.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader title={t("ast.software", { length: a.software.length })} subtitle={t("ast.zWazuhSyscollectoru")} />
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {a.software.map((s, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="px-5 py-2">{s.name}</td>
                      <td className="px-5 py-2 text-slate-500">{s.version}</td>
                      <td className="px-5 py-2 text-slate-500">{s.vendor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {linking && (
        <LinkModal
          assetId={a.id}
          assetClass={a.assetClass}
          existing={links.map((l) => l.id)}
          onClose={() => setLinking(false)}
        />
      )}
    </>
  );
}

function HealthBanner({ asset }: { asset: { healthStatus: HealthStatus; healthReasons: { level: string; text: string }[]; vulnCritical: number; vulnHigh: number; vulnMedium: number; vulnLow: number } }) {
  const t = useT();
  const tone = {
    red: "border-red-200 bg-red-50",
    orange: "border-orange-200 bg-orange-50",
    green: "border-emerald-200 bg-emerald-50",
    unknown: "border-slate-200 bg-slate-50",
  }[asset.healthStatus];
  return (
    <div className={`mb-6 flex flex-wrap items-start justify-between gap-4 rounded-lg border px-5 py-4 ${tone}`}>
      <div>
        <HealthIndicator status={asset.healthStatus} withLabel size={22} />
        {asset.healthReasons.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
            {asset.healthReasons.map((r, i) => (
              <li key={i}>
                {r.level === "red" ? "●" : "○"} {r.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            {asset.healthStatus === "green"
              ? t("ast.zadneOtevreneVysokeAniKriticke")
              : t("ast.proTotoAktivumZatimNejsou")}
          </p>
        )}
      </div>
      <VulnCounts
        className="text-sm"
        c={{ critical: asset.vulnCritical, high: asset.vulnHigh, medium: asset.vulnMedium, low: asset.vulnLow }}
      />
    </div>
  );
}

function LinkModal({ assetId, assetClass, existing, onClose }: { assetId: string; assetClass: AssetClass; existing: string[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const target: AssetClass = assetClass === "primary" ? "supporting" : "primary";
  const candidates = useQuery({
    queryKey: ["assets", "link-candidates", target, q],
    queryFn: () => api.assets.list({ assetClass: target, q, limit: 20 }),
    placeholderData: keepPreviousData,
  });
  const link = useMutation({
    mutationFn: (otherId: string) =>
      api.assets.link(
        assetClass === "primary"
          ? { primaryId: assetId, supportingId: otherId, note: note || null }
          : { primaryId: otherId, supportingId: assetId, note: note || null },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset"] });
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title={target === "supporting" ? t("ast.pridatPodpurneAktivum") : t("ast.priraditKPrimarnimuAktivu")}>
      <Input autoFocus placeholder={t("ast.hledatPodleNazvuHostnameIp")} value={q} onChange={(e) => setQ(e.target.value)} />
      <Field label={t("ast.poznamkaKVazbeVolitelne")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ast.naprHostujeDatabazi")} />
      </Field>
      <ErrorBox error={link.error} />
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {candidates.data?.items
          .filter((c) => !existing.includes(c.id) && c.id !== assetId)
          .map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-slate-500">{t.lbl(LABELS.assetType[c.assetType])}</div>
              </div>
              <Button variant="secondary" disabled={link.isPending} onClick={() => link.mutate(c.id)}>
                <Link2 size={14} /> {t("ast.propojit")}
              </Button>
            </li>
          ))}
        {candidates.data && !candidates.data.items.length && <EmptyState>{t("common.nothingFound")}</EmptyState>}
      </ul>
    </Modal>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{empty ? "—" : children}</dd>
    </div>
  );
}
