import { useT } from "@/lib/i18n";
import { CompanyCell } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Modal, PageHeader, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe, useModule } from "@/lib/auth";
import { cn, fmtDate, fmtDay } from "@/lib/utils";
import { AWARENESS_LABELS, OBLIGATION_LABELS, POLICY_LABELS, URGENCY_LABELS, type MyPolicyItem, type ObligationItem, type ObligationUrgency } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
import { stateTone } from "./Awareness";
import { ActionsBoard } from "./Actions";
import { Tabs, useTab } from "@/components/ui/tabs";

const urgencyTone: Record<ObligationUrgency, Tone> = { overdue: "red", today: "amber", soon: "blue", later: "slate" };

export function ObligationList({ items, showCompany }: { items: ObligationItem[]; showCompany: boolean }) {
  const t = useT();
  if (!items.length)
    return (
      <EmptyState>
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 size={16} color={STATUS_COLORS.good} /> {t("obl.none")}
        </span>
      </EmptyState>
    );
  return (
    <div className="divide-y divide-slate-100">
      {items.map((i) => (
        <Link key={i.key} to={i.link as never} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
          <div className="w-24 shrink-0 pt-0.5">
            <Badge tone={urgencyTone[i.urgency]}>
              {i.urgency === "overdue" && <AlertTriangle size={11} className="mr-1" />}
              {t.dyn(`enum.urgency.${i.urgency}`, URGENCY_LABELS[i.urgency])}
            </Badge>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-800">{i.title}</div>
            <div className="text-xs text-slate-500">
              {t.dyn(`enum.obligation.${i.kind}`, OBLIGATION_LABELS[i.kind])}
              {i.detail ? ` · ${i.detail}` : ""}
              {i.ownerName ? ` · ${i.ownerName}` : ""}
            </div>
            {showCompany && <CompanyCell id={i.companyId} />}
          </div>
          <div className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-500">
            <Clock size={11} className="mr-1 inline" />
            {i.due ? (i.due.length > 10 ? fmtDate(i.due) : fmtDay(i.due)) : "—"}
          </div>
        </Link>
      ))}
    </div>
  );
}

/** Moje práce (v1.10): záložky Moje povinnosti | Úkoly a akce (hromadné změny) | Tým. Moje povinnosti: seznámení s dokumenty, školení, úkoly mých funkčních míst; povinnosti týmu. */
export function MyPage() {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const me = useMe();
  const team = can("isms:read", "risks:read", "audits:read", "incidents:read", "policies:read");
  const actions = can("actions:read");
  const [tab, setTab] = useTab(["mine", "actions", "team"] as const, "mine");
  const mine = useQuery({ queryKey: ["obligations", "mine"], queryFn: api.notifications.mine, enabled: can("obligations:self") });
  const teamQ = useQuery({ queryKey: ["obligations", "team"], queryFn: api.notifications.team, enabled: team && tab === "team" });
  const pols = useQuery({ queryKey: ["policies", "mine"], queryFn: api.policies.mine, enabled: mod("policies") && can("obligations:self") });
  const trainings = useQuery({ queryKey: ["awareness", "mine"], queryFn: api.awareness.mine, enabled: mod("awareness") && can("obligations:self") });
  const [reading, setReading] = useState<MyPolicyItem | null>(null);
  const tasks = (mine.data ?? []).filter((i) => i.kind !== "policy_ack" && i.kind !== "training");
  const multi = me.companies.length > 1;
  return (
    <>
      <PageHeader title={t("my.mojePovinnosti")} subtitle={t("my.dokumentyKSeznameniSkoleniA")} />
      <ErrorBox error={mine.error ?? teamQ.error ?? pols.error ?? trainings.error} />
      <Tabs
        label={t("my.mojePovinnosti")}
        value={tab}
        onChange={setTab}
        items={[
          { key: "mine", label: t("my.tab.mine") },
          ...(actions ? [{ key: "actions" as const, label: t("my.tab.actions") }] : []),
          ...(team ? [{ key: "team" as const, label: t("my.tab.team") }] : []),
        ]}
      />
      {tab === "actions" && actions ? (
        <ActionsBoard mineDefault />
      ) : tab === "team" && team ? (
        <Card className="overflow-hidden">
          <CardHeader title={t("my.lhutyVAktualnimRozsahu")} subtitle={t("my.poTerminuDnesAS")} />
          {teamQ.isLoading ? <EmptyState>{t("common.loading")}</EmptyState> : <ObligationList items={teamQ.data ?? []} showCompany={multi} />}
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {mod("policies") && (
            <Card className="overflow-hidden">
              <CardHeader title={t("my.dokumentyKSeznameni")} subtitle={t("my.6Odst5PismB")} />
              {(pols.data ?? []).length === 0 ? (
                <EmptyState>{t("my.zadneDokumenty")}</EmptyState>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(pols.data ?? []).map((p) => (
                    <div key={p.versionId} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">
                          {p.code ? `${p.code} ` : ""}
                          {p.title} <span className="font-normal text-slate-500">v{p.version}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {t.lbl(POLICY_LABELS.type[p.docType])}
                          {p.approvedAt ? (" " + t("my.platnaOd", { p: fmtDay(p.approvedAt) })) : ""}
                        </div>
                      </div>
                      {p.acknowledgedAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 size={13} color={STATUS_COLORS.good} /> {fmtDay(p.acknowledgedAt)}
                        </span>
                      ) : (
                        <Button className="px-2.5 py-1 text-xs" onClick={() => setReading(p)}>
                          {t("my.precistAPotvrdit")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          {mod("awareness") && (
            <Card className="overflow-hidden">
              <CardHeader title={t("my.mojeSkoleni")} subtitle={t("my.10Odst3VstupniA")} />
              {(trainings.data ?? []).length === 0 ? (
                <EmptyState>{t("my.zadnaPovinnaSkoleni")}</EmptyState>
              ) : (
                <div className="divide-y divide-slate-100">
                  {(trainings.data ?? []).map((tx) => (
                    <div key={tx.courseId} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <div className="text-sm font-medium">{tx.title}</div>
                        <div className="text-xs text-slate-500">
                          {t.lbl(AWARENESS_LABELS.kind[tx.kind])} · {t.lbl(AWARENESS_LABELS.form[tx.form])}
                          {tx.lastCompleted ? ` · naposledy ${fmtDay(tx.lastCompleted)}` : ""}
                          {tx.validUntil ? (" " + t("my.platiDo", { p: fmtDay(tx.validUntil) })) : ""}
                          {tx.nextSession ? (" " + t("my.termin", { p: fmtDay(tx.nextSession) })) : ""}
                        </div>
                      </div>
                      <Badge tone={stateTone[tx.state]}>{t.lbl(AWARENESS_LABELS.state[tx.state])}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader title={t("my.ukolyMychFunkcnichMist")} subtitle={t("my.akcePlanuZvladaniRizikNapravna")} />
            {mine.isLoading ? <EmptyState>{t("common.loading")}</EmptyState> : <ObligationList items={tasks} showCompany={multi} />}
          </Card>
        </div>
      )}
      {reading && <ReadModal item={reading} onClose={() => setReading(null)} />}
    </>
  );
}

function ReadModal({ item, onClose }: { item: MyPolicyItem; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ["policies", "content", item.versionId], queryFn: () => api.policies.content(item.policyId, item.versionId), enabled: item.hasContent });
  const ack = useMutation({
    mutationFn: () => api.policies.acknowledge(item.policyId, item.versionId),
    onSuccess: (d) => {
      qc.setQueryData(["policies", "mine"], d);
      qc.invalidateQueries({ queryKey: ["obligations"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${item.code ? `${item.code} ` : ""}${item.title} – ${t("my.verzeN", { v: item.version })}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={ack.isPending} onClick={() => ack.mutate()}>
            {t("my.potvrzujiZeJsemSeSeznamil")}
          </Button>
        </>
      }
    >
      {item.location && (
        <p className="text-sm text-slate-600">
          {t("my.dokumentJeDostupny")} <span className="font-medium">{item.location}</span>
        </p>
      )}
      {item.hasContent && <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-4 font-sans text-sm text-slate-800">{c.data?.content ?? t("common.loading")}</pre>}
      <ErrorBox error={c.error ?? ack.error} />
    </Modal>
  );
}
