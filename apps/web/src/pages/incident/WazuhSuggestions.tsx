import { useT } from "@/lib/i18n";
import { CompanyCell, useGroupView } from "@/components/company";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDay } from "@/lib/utils";
import type { AlertSuggestionDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

const levelTone = (l: number): Tone => (l >= 12 ? "red" : l >= 10 ? "amber" : "slate");
const dt = (v: string) => new Date(v).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });

/** Návrhy bezpečnostních událostí z Wazuh alertů – přijmout (vznikne událost) nebo zamítnout. */
export function WazuhSuggestions() {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [status, setStatus] = useState<"new" | "all">("new");
  const [dismiss, setDismiss] = useState<AlertSuggestionDto | null>(null);
  const [cfg, setCfg] = useState(false);
  const list = useQuery({ queryKey: ["alerts", status], queryFn: () => api.alerts.list(status) });
  const settings = useQuery({ queryKey: ["alerts", "settings"], queryFn: api.alerts.settings });
  const sync = useMutation({ mutationFn: api.alerts.sync, onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }) });
  const accept = useMutation({
    mutationFn: (id: string) => api.alerts.accept(id, "unassessed"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["incidents"] });
      nav({ to: "/incidents/$incidentId", params: { incidentId: r.incidentId } });
    },
  });
  const s = settings.data;
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          title={t("inc.navrhyUdalostiZWazuh")}
          subtitle={
            s?.alertsEnabled
              ? t("inc.alertyUrovneZIndexuSeskupene", { alertMinLevel: s.alertMinLevel, alertsIndexPattern: s.alertsIndexPattern, p: s.lastResult ?? "" })
              : t("inc.nacitaniAlertuJeVypnuteZapnete")
          }
          action={
            <div className="flex gap-2">
              <div className="flex rounded-md border border-slate-300 p-0.5 text-xs">
                {(
                  [
                    ["new", t("inc.nove")],
                    ["all", t("common.all")],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} onClick={() => setStatus(k)} className={`rounded px-2 py-1 ${status === k ? "bg-brand-50 text-brand-700" : "text-slate-600"}`}>
                    {l}
                  </button>
                ))}
              </div>
              {can("admin:settings") && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setCfg(true)}>
                  {t("inc.nastaveni")}
                </Button>
              )}
              {can("incidents:write") && s?.alertsEnabled && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" disabled={sync.isPending} onClick={() => sync.mutate()}>
                  <RefreshCw size={13} /> {t("inc.nacist")}
                </Button>
              )}
            </div>
          }
        />
        <ErrorBox error={list.error ?? sync.error ?? accept.error} />
        {sync.data && <SuccessBox>{t("inc.noveNavrhyAktualizovane", { created: sync.data.created, updated: sync.data.updated })}</SuccessBox>}
        {(list.data ?? []).length === 0 ? (
          <EmptyState>{list.isLoading ? t("common.loading") : t("inc.zadneNavrhy")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("inc.pravidlo")}</th>
                <th className="px-3 py-2">{t("inc.agentAktivum")}</th>
                <th className="px-3 py-2 text-right">{t("inc.pocet")}</th>
                <th className="px-3 py-2">{t("inc.naposledy")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(list.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-start gap-2">
                      <Badge tone={levelTone(a.ruleLevel)}>{t("inc.ur", { ruleLevel: a.ruleLevel })}</Badge>
                      <div>
                        <div className="font-medium">{a.description}</div>
                        <div className="text-xs text-slate-500">
                          {t("inc.pravidlo2")} {a.ruleId}
                          {a.groups.length ? ` · ${a.groups.join(", ")}` : ""}
                        </div>
                        {group && <CompanyCell id={a.companyId} />}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">
                    {a.agentName ?? "—"}
                    {a.assetName ? <div className="text-slate-800">{a.assetName}</div> : <div className="text-amber-700">{t("inc.aktivumNenalezeno")}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{a.count}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-600">{dt(a.lastSeen)}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    {a.status === "new" && can("incidents:write") ? (
                      <>
                        <Button className="px-2.5 py-1 text-xs" disabled={accept.isPending} onClick={() => accept.mutate(a.id)}>
                          {t("inc.zalozitUdalost")}
                        </Button>
                        <button className="ml-2 text-xs text-slate-500 hover:text-slate-800" onClick={() => setDismiss(a)}>
                          {t("inc.zamitnout")}
                        </button>
                      </>
                    ) : a.status === "accepted" ? (
                      <button className="text-xs text-brand-700 hover:underline" onClick={() => a.incidentId && nav({ to: "/incidents/$incidentId", params: { incidentId: a.incidentId } })}>
                        {t("inc.udalostZalozena")}
                      </button>
                    ) : a.status === "dismissed" ? (
                      <span className="text-xs text-slate-500" title={a.dismissReason ?? ""}>
                        {t("inc.zamitnuto")}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {dismiss && <DismissModal a={dismiss} onClose={() => setDismiss(null)} />}
      {cfg && s && <SettingsModal s={s} onClose={() => setCfg(false)} />}
    </>
  );
}

function DismissModal({ a, onClose }: { a: AlertSuggestionDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.alerts.dismiss(a.id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("inc.zamitnoutNavrh")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={!reason.trim() || m.isPending} onClick={() => m.mutate()}>
            {t("inc.zamitnout")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        {t("inc.odStejnePravidloNaStejnem", { description: a.description, count: a.count, p: fmtDay(a.firstSeen) })}
      </p>
      <Field label={t("inc.zduvodneni")}>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("inc.naprFalesnyPoplachPlanovanaUdrzba")} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function SettingsModal({ s, onClose }: { s: { alertsEnabled: boolean; alertMinLevel: number; alertsIndexPattern: string; indexerConfigured: boolean }; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ alertsEnabled: s.alertsEnabled, alertMinLevel: s.alertMinLevel, alertsIndexPattern: s.alertsIndexPattern });
  const m = useMutation({
    mutationFn: () => api.alerts.saveSettings(f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("inc.wazuhAlertyNastaveni")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            {t("inc.ulozit")}
          </Button>
        </>
      }
    >
      {!s.indexerConfigured && <p className="text-sm text-amber-800">{t("inc.wazuhIndexerNeniNastavenAdministrace")}</p>}
      <Checkbox checked={f.alertsEnabled} onChange={(v) => setF({ ...f, alertsEnabled: v })} label={t("inc.nacitatAlertyANavrhovatBezpecnostni")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("inc.minimalniUrovenPravidla")} hint={t("inc.wazuh01510Vysoka")}>
          <Input type="number" min={1} max={15} value={f.alertMinLevel} onChange={(e) => setF({ ...f, alertMinLevel: Number(e.target.value) || 10 })} />
        </Field>
        <Field label={t("inc.indexAlertu")}>
          <Input value={f.alertsIndexPattern} onChange={(e) => setF({ ...f, alertsIndexPattern: e.target.value })} />
        </Field>
      </div>
      <ErrorBox error={m.error} />
    </Modal>
  );
}
