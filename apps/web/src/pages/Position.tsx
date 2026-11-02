import { PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { POSITION_USAGE_LABELS, type PositionUsageKind } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowRightLeft, UserRound } from "lucide-react";
import { useState } from "react";

/** Funkční místo: držitelé, vše, co místo vlastní, a předání při odchodu (v1.10, ADR-106). */
export function PositionPage() {
  const t = useT();
  const can = useCan();
  const { positionId } = useParams({ strict: false }) as { positionId: string };
  const q = useQuery({ queryKey: ["org", "position", positionId], queryFn: () => api.org.positionDetail(positionId) });
  const [handover, setHandover] = useState(false);
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  const total = d.groups.reduce((n, g) => n + g.total, 0);
  return (
    <>
      <PageHeader
        title={d.position.name}
        subtitle={`${d.position.unitName} · ${t("pos.itemsN", { n: total })}`}
        meta={
          <>
            <UserRound size={15} className="text-slate-400" />
            {d.position.holders.length ? d.position.holders.map((h) => <Badge key={h.id}>{h.name}</Badge>) : <span className="text-amber-700">{t("pos.vacant")}</span>}
          </>
        }
        actions={
          can("org:write") &&
          d.groups.some((g) => g.canHandover) && (
            <Button onClick={() => setHandover(true)}>
              <ArrowRightLeft size={15} /> {t("pos.handover")}
            </Button>
          )
        }
      />
      {!d.groups.length && !d.raci.length ? (
        <Card>
          <EmptyState>{t("pos.empty")}</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="position-usage">
          {d.groups.map((g) => (
            <Card key={g.kind} className="overflow-hidden">
              <CardHeader title={`${t.lbl(POSITION_USAGE_LABELS[g.kind])} (${g.total})`} />
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {g.items.map((x) => (
                  <li key={x.id} className="px-5 py-2 text-sm">
                    <Link to={x.link as never} className="text-slate-800 hover:text-brand-700 hover:underline">
                      {x.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {d.raci.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title={`${t("pos.raci")} (${d.raci.length})`} />
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {d.raci.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 px-5 py-2 text-sm">
                    <Badge tone="blue">{r.role}</Badge>
                    <Link to="/processes/$processId" params={{ processId: r.processId }} className="hover:text-brand-700 hover:underline">
                      {r.processName}
                    </Link>
                    <span className="text-slate-500">› {r.stepName}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
      {handover && <HandoverModal positionId={d.position.id} groups={d.groups.filter((g) => g.canHandover)} onClose={() => setHandover(false)} />}
    </>
  );
}

function HandoverModal({ positionId, groups, onClose }: { positionId: string; groups: { kind: PositionUsageKind; total: number }[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [kinds, setKinds] = useState<PositionUsageKind[]>(groups.map((g) => g.kind));
  const [note, setNote] = useState("");
  const go = useMutation({
    mutationFn: () => api.org.handover(positionId, { targetPositionId: target!, kinds, note: note || undefined }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast(t("pos.handoverDone", { n: Object.values(r.moved).reduce((a, b) => a + b, 0) }));
      onClose();
    },
  });
  const n = groups.filter((g) => kinds.includes(g.kind)).reduce((a, g) => a + g.total, 0);
  return (
    <Modal
      open
      onClose={onClose}
      title={t("pos.handover")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("ui.confirm.cancel")}
          </Button>
          <Button disabled={!target || target === positionId || !kinds.length || go.isPending} onClick={async () => (await askConfirm(t("pos.handoverConfirm", { n }))) && go.mutate()}>
            {t("pos.handoverGo", { n })}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("pos.handoverHint")}</p>
      <Field label={t("pos.target")}>
        <PositionSelect value={target} onChange={setTarget} ariaLabel={t("pos.target")} />
      </Field>
      <div className="space-y-1.5">
        {groups.map((g) => (
          <Checkbox key={g.kind} checked={kinds.includes(g.kind)} onChange={(v) => setKinds(v ? [...kinds, g.kind] : kinds.filter((k) => k !== g.kind))} label={`${t.lbl(POSITION_USAGE_LABELS[g.kind])} (${g.total})`} />
        ))}
      </div>
      <Field label={t("pos.note")}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pos.notePh")} />
      </Field>
      <ErrorBox error={go.error} />
    </Modal>
  );
}
