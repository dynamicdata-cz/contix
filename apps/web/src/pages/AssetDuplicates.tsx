import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Modal, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { LABELS, type AssetDuplicatePair, type DuplicateAsset } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, GitMerge, X } from "lucide-react";
import { useState } from "react";

/** Pravděpodobné duplicity aktiv (typicky z více zdrojů discovery) – sloučení nebo zamítnutí rozhoduje člověk. */
export function AssetDuplicatesPage() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assets", "duplicates"], queryFn: api.assets.duplicates });
  const [merge, setMerge] = useState<AssetDuplicatePair | null>(null);
  const dismiss = useMutation({
    mutationFn: (p: AssetDuplicatePair) => api.assets.dismissDuplicate(p.a.id, p.b.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assets", "duplicates"] }),
  });
  const pairs = q.data ?? [];
  return (
    <>
      <PageHeader
        title={t("ast.duplicityAktiv")}
        subtitle={t("ast.dvojiceAktivKtereJsouNejspis")}
        actions={
          <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
            <ArrowLeft size={14} /> {t("ast.aktiva")}
          </Link>
        }
      />
      <ErrorBox error={q.error ?? dismiss.error} />
      {!pairs.length ? (
        <EmptyState>{q.isLoading ? t("ast.hledam") : t("ast.zadnePravdepodobneDuplicityNenalezeny")}</EmptyState>
      ) : (
        <div className="space-y-3">
          {pairs.map((p) => (
            <Card key={`${p.a.id}-${p.b.id}`} className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge tone={p.score >= 80 ? "red" : p.score >= 50 ? "amber" : "slate"}>{t("ast.shoda", { score: p.score })}</Badge>
                {p.reasons.map((r) => (
                  <Badge key={r} tone="blue">
                    {r}
                  </Badge>
                ))}
                <div className="ml-auto flex gap-2">
                  {can("assets:delete") && (
                    <Button className="px-2.5 py-1.5 text-xs" onClick={() => setMerge(p)}>
                      <GitMerge size={13} /> {t("ast.sloucit")}
                    </Button>
                  )}
                  {can("assets:write") && (
                    <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={dismiss.isPending} onClick={() => dismiss.mutate(p)}>
                      <X size={13} /> {t("ast.nejdeODuplicitu")}
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <AssetBox a={p.a} />
                <AssetBox a={p.b} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {merge && <MergeModal pair={merge} onClose={() => setMerge(null)} />}
    </>
  );
}

function AssetBox({ a }: { a: DuplicateAsset }) {
  const t = useT();
  return (
    <div className="rounded-md border border-slate-200 p-3 text-sm">
      <Link to="/assets/$assetId" params={{ assetId: a.id }} className="font-medium text-brand-700 hover:underline">
        {a.name}
      </Link>
      <dl className="mt-1.5 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5 text-xs text-slate-600">
        <dt>{t("ast.typ")}</dt>
        <dd>{t.lbl(LABELS.assetType[a.assetType as keyof typeof LABELS.assetType]) ?? a.assetType}</dd>
        <dt>{t("ast.hostname")}</dt>
        <dd>{a.hostname ?? "—"}</dd>
        <dt>{t("ast.serioveCislo")}</dt>
        <dd>{a.serialNumber ?? "—"}</dd>
        <dt>{t("ast.ipMac")}</dt>
        <dd className="break-all">{[...a.ipAddresses, ...a.macAddresses].join(", ") || "—"}</dd>
        <dt>{t("ast.zdroj")}</dt>
        <dd>{a.source ?? t("ast.rucne")}</dd>
        <dt>{t("ast.vazby")}</dt>
        <dd>{a.links}</dd>
        <dt>{t("ast.zmeneno")}</dt>
        <dd>{new Date(a.updatedAt).toLocaleDateString("cs-CZ")}</dd>
      </dl>
    </div>
  );
}

function MergeModal({ pair, onClose }: { pair: AssetDuplicatePair; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  // výchozí: ponechat aktivum s více vazbami
  const [keep, setKeep] = useState(pair.a.links >= pair.b.links ? pair.a.id : pair.b.id);
  const [fill, setFill] = useState(true);
  const remove = keep === pair.a.id ? pair.b : pair.a;
  const m = useMutation({
    mutationFn: () => api.assets.merge({ keepId: keep, removeId: remove.id, fillEmpty: fill }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("ast.sloucitAktiva")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button variant="danger" disabled={m.isPending} onClick={() => m.mutate()}>
            <GitMerge size={14} /> {t("ast.sloucitASmazat")}{remove.name}“
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("ast.ktereAktivumPonechatDruheSe")}</p>
      <div className="space-y-2">
        {[pair.a, pair.b].map((a) => (
          <label key={a.id} className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${keep === a.id ? "border-brand-400 bg-brand-50" : "border-slate-200"}`}>
            <input type="radio" className="mt-1 accent-brand-600" checked={keep === a.id} onChange={() => setKeep(a.id)} />
            <span>
              <b>{a.name}</b>
              <span className="block text-xs text-slate-500">
                {a.source ?? t("ast.rucne")} {t("ast.vazeb")} {a.links} {t("ast.zmeneno2")} {new Date(a.updatedAt).toLocaleDateString("cs-CZ")}
              </span>
            </span>
          </label>
        ))}
      </div>
      <Checkbox checked={fill} onChange={setFill} label={t("ast.doplnitPrazdnaPolePonechanehoAktiva")} />
      <ErrorBox error={m.error} />
    </Modal>
  );
}
