/** Sdílené aktivum holdingu (ADR-085): vlastní společnost + další společnosti skupiny, které ho vidí a používají ve vazbách. */
import { Button, Checkbox, ErrorBox, Modal } from "@/components/ui";
import { api, type AssetDetail } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building, Share2 } from "lucide-react";
import { useState } from "react";

export function AssetSharingCard({ asset }: { asset: AssetDetail }) {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(asset.sharedWith);
  const save = useMutation({
    mutationFn: () => api.assets.share(asset.id, sel),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset", asset.id] });
      qc.invalidateQueries({ queryKey: ["assets"] });
      setOpen(false);
    },
  });
  if (me.companies.length <= 1) return null;
  const name = (id: string) => me.companies.find((c) => c.id === id)?.name ?? t("ash.otherCompany");
  const owner = name(asset.companyId);
  const others = me.companies.filter((c) => c.id !== asset.companyId);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm" data-testid="asset-sharing">
      <Building size={14} className="text-slate-400" />
      <span className="text-slate-500">{t("ash.owner")}</span>
      <span className="font-medium text-slate-800">{owner}</span>
      <span className="text-slate-300">·</span>
      <Share2 size={14} className="text-slate-400" />
      <span className="text-slate-500">{t("ash.sharedWith")}</span>
      {asset.sharedWith.length ? (
        asset.sharedWith.map((id) => (
          <span key={id} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {name(id)}
          </span>
        ))
      ) : (
        <span className="text-slate-400">{t("ash.none")}</span>
      )}
      {!asset.ownedHere && <span className="text-xs text-amber-700">{t("ash.readOnly")}</span>}
      {asset.canShare && (
        <Button
          variant="secondary"
          className="ml-auto"
          onClick={() => {
            setSel(asset.sharedWith);
            setOpen(true);
          }}
        >
          <Share2 size={14} /> {t("ash.edit")}
        </Button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("ash.title")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancelAction")}
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {t("usr.ulozit")}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-500">{t("ash.hint", { owner })}</p>
        <div className="space-y-1.5">
          {others.map((c) => (
            <div key={c.id} style={{ paddingLeft: c.depth * 16 }}>
              <Checkbox checked={sel.includes(c.id)} onChange={(v) => setSel((x) => (v ? [...x, c.id] : x.filter((y) => y !== c.id)))} label={c.name} />
            </div>
          ))}
        </div>
        <ErrorBox error={save.error} />
      </Modal>
    </div>
  );
}
