import { useT } from "@/lib/i18n";
import { Button, ErrorBox, Field, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { TRANSFER_LABELS, type TransferEntity, type TransferResult } from "@contix/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft } from "lucide-react";
import { useState } from "react";

/** Přesun záznamu do jiné společnosti skupiny (zobrazí se jen ve skupině s více společnostmi). */
export function TransferButton({ entity, id, companyId, onDone }: { entity: TransferEntity; id: string; companyId: string; onDone?: () => void }) {
  const t = useT();
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (me.companies.length < 2) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} title={t("doc.presunoutDoJineSpolecnostiSkupiny")}>
        <ArrowRightLeft size={15} />
      </Button>
      {open && <TransferModal entity={entity} id={id} companyId={companyId} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function TransferModal({ entity, id, companyId, onClose, onDone }: { entity: TransferEntity; id: string; companyId: string; onClose: () => void; onDone?: () => void }) {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const [target, setTarget] = useState(me.companies.find((c) => c.id !== companyId)?.id ?? "");
  const [res, setRes] = useState<TransferResult | null>(null);
  const m = useMutation({
    mutationFn: (force: boolean) => api.companies.transfer({ entity, ids: [id], targetCompanyId: target, force }),
    onSuccess: (r) => {
      setRes(r);
      if (!r.needsConfirmation) {
        qc.invalidateQueries();
        onDone?.();
        onClose();
      }
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("doc.presunoutDoJineSpolecnosti", { p: t.lbl(TRANSFER_LABELS[entity]) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          {res?.needsConfirmation ? (
            <Button variant="danger" disabled={m.isPending} onClick={() => m.mutate(true)}>
              {t("doc.prestoPresunout")}
            </Button>
          ) : (
            <Button disabled={!target || m.isPending} onClick={() => m.mutate(false)}>
              {t("doc.presunout")}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("doc.zaznamSePresuneISe")}</p>
      <Field label={t("doc.cilovaSpolecnost")}>
        <Select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setRes(null);
          }}
        >
          {me.companies
            .filter((c) => c.id !== companyId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {"  ".repeat(c.depth)}
                {c.name}
              </option>
            ))}
        </Select>
      </Field>
      {res?.needsConfirmation && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-medium">{t("doc.zCiloveSpolecnostiNebudouVidet")}</div>
          <ul className="mt-1 list-disc pl-5">
            {res.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="mt-1">{t("doc.vazbyZustanouZachovanyAleUzivatele")}</div>
        </div>
      )}
      <ErrorBox error={m.error} />
    </Modal>
  );
}
