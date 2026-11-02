import { askConfirm } from "@/components/ui/overlay";
/** Zdroje alertů SOC (ADR-052): webhooky s tokenem pro další nástroje – správa, jednorázové zobrazení tokenu, příklad volání. */
import { SeverityBadge } from "@/components/soc";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import { SOC_LABELS, SOC_PULL_PRESETS, SOC_SEVERITIES, SOC_SOURCE_LABELS, SOC_SOURCE_PRESETS, type SocPullDto, type SocSeverity, type SocSourceDto, type SocSourcePreset, type SocSourceSecret } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, KeyRound, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

const ingestUrl = () => `${window.location.origin}/api/public/soc/ingest`;

const EXAMPLE: Record<SocSourcePreset, string> = {
  generic: '{"title":"Podezřelé přihlášení","severity":"high","host":"srv-01","srcip":"203.0.113.7","mitre":["T1078"]}',
  suricata: '{"event_type":"alert","src_ip":"198.51.100.7","dest_ip":"10.0.0.5","alert":{"signature_id":2024217,"signature":"ET EXPLOIT …","severity":1}}',
  defender: '{"value":[{"title":"Suspicious credential dump","severity":"high","detectorId":"…","mitreTechniques":["T1003"],"evidence":[{"@odata.type":"#microsoft.graph.security.deviceEvidence","deviceDnsName":"pc-01"}]}]}',
  sentinel: '{"object":{"properties":{"title":"Suspicious sign-in","severity":"High","status":"New","incidentNumber":42,"additionalData":{"techniques":["T1078"]}}}}',
  elastic: '{"_source":{"@timestamp":"2026-10-17T08:00:00Z","kibana.alert.rule.name":"Encoded PowerShell","kibana.alert.severity":"high","host":{"name":"srv-01"}}}',
};

type PullDraft = { on: boolean; intervalMinutes: number; secret: string; sentinel: { tenantId: string; clientId: string; subscriptionId: string; resourceGroup: string; workspace: string }; elastic: { url: string; index: string; authType: "apikey" | "basic"; username: string; verifyTls: boolean; openOnly: boolean } };
const emptyPull = (p?: SocPullDto | null): PullDraft => ({
  on: p ? p.config.enabled : true,
  intervalMinutes: p?.config.intervalMinutes ?? 15,
  secret: "",
  sentinel: {
    tenantId: p?.config.sentinel?.tenantId ?? "",
    clientId: p?.config.sentinel?.clientId ?? "",
    subscriptionId: p?.config.sentinel?.subscriptionId ?? "",
    resourceGroup: p?.config.sentinel?.resourceGroup ?? "",
    workspace: p?.config.sentinel?.workspace ?? "",
  },
  elastic: {
    url: p?.config.elastic?.url ?? "",
    index: p?.config.elastic?.index ?? ".alerts-security.alerts-default",
    authType: p?.config.elastic?.authType ?? "apikey",
    username: p?.config.elastic?.username ?? "",
    verifyTls: p?.config.elastic?.verifyTls ?? true,
    openOnly: p?.config.elastic?.openOnly ?? true,
  },
});
const pullBody = (preset: SocSourcePreset, d: PullDraft) => ({
  enabled: d.on,
  intervalMinutes: d.intervalMinutes,
  ...(preset === "sentinel" ? { sentinel: d.sentinel } : { elastic: d.elastic }),
});
const isPull = (p: SocSourcePreset) => (SOC_PULL_PRESETS as readonly string[]).includes(p);

function PullFields({ preset, d, set, hasSecret }: { preset: SocSourcePreset; d: PullDraft; set: (d: PullDraft) => void; hasSecret: boolean }) {
  const t = useT();
  const s = d.sentinel;
  const e = d.elastic;
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-3" data-testid="soc-pull-fields">
      <Checkbox checked={d.on} onChange={(v) => set({ ...d, on: v })} label={t("soc.pull.on")} hint={t(`soc.pull.hint.${preset === "sentinel" ? "sentinel" : "elastic"}`)} />
      <div className="grid gap-3 sm:grid-cols-2">
        {preset === "sentinel" ? (
          <>
            <Field label={t("soc.pull.tenantId")}>
              <Input value={s.tenantId} onChange={(x) => set({ ...d, sentinel: { ...s, tenantId: x.target.value } })} />
            </Field>
            <Field label={t("soc.pull.clientId")}>
              <Input value={s.clientId} onChange={(x) => set({ ...d, sentinel: { ...s, clientId: x.target.value } })} />
            </Field>
            <Field label={t("soc.pull.subscriptionId")}>
              <Input value={s.subscriptionId} onChange={(x) => set({ ...d, sentinel: { ...s, subscriptionId: x.target.value } })} />
            </Field>
            <Field label={t("soc.pull.resourceGroup")}>
              <Input value={s.resourceGroup} onChange={(x) => set({ ...d, sentinel: { ...s, resourceGroup: x.target.value } })} />
            </Field>
            <Field label={t("soc.pull.workspace")}>
              <Input value={s.workspace} onChange={(x) => set({ ...d, sentinel: { ...s, workspace: x.target.value } })} />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("soc.pull.url")}>
              <Input value={e.url} placeholder="https://elastic.firma.local:9200" onChange={(x) => set({ ...d, elastic: { ...e, url: x.target.value } })} />
            </Field>
            <Field label={t("soc.pull.index")}>
              <Input value={e.index} className="font-mono text-xs" onChange={(x) => set({ ...d, elastic: { ...e, index: x.target.value } })} />
            </Field>
            <Field label={t("soc.pull.authType")}>
              <Select value={e.authType} onChange={(x) => set({ ...d, elastic: { ...e, authType: x.target.value as "apikey" | "basic" } })}>
                <option value="apikey">{t("soc.pull.auth.apikey")}</option>
                <option value="basic">{t("soc.pull.auth.basic")}</option>
              </Select>
            </Field>
            {e.authType === "basic" && (
              <Field label={t("soc.pull.username")}>
                <Input value={e.username} onChange={(x) => set({ ...d, elastic: { ...e, username: x.target.value } })} />
              </Field>
            )}
            <Checkbox checked={e.verifyTls} onChange={(v) => set({ ...d, elastic: { ...e, verifyTls: v } })} label={t("soc.pull.verifyTls")} />
            <Checkbox checked={e.openOnly} onChange={(v) => set({ ...d, elastic: { ...e, openOnly: v } })} label={t("soc.pull.openOnly")} />
          </>
        )}
        <Field label={preset === "sentinel" ? t("soc.pull.clientSecret") : e.authType === "apikey" ? t("soc.pull.apiKey") : t("soc.pull.password")} hint={hasSecret ? t("soc.act.pwSet") : undefined}>
          <Input type="password" autoComplete="new-password" value={d.secret} onChange={(x) => set({ ...d, secret: x.target.value })} />
        </Field>
        <Field label={t("soc.pull.interval")}>
          <Input type="number" min={5} max={1440} value={d.intervalMinutes} onChange={(x) => set({ ...d, intervalMinutes: Number(x.target.value) })} />
        </Field>
      </div>
      <p className="text-xs text-slate-500">{t("soc.pull.privacy")}</p>
    </div>
  );
}

function PullModal({ s, onClose, onSaved }: { s: SocSourceDto; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [d, setD] = useState<PullDraft>(emptyPull(s.pull));
  const m = useMutation({ mutationFn: () => api.soc.updateSource(s.id, { pull: pullBody(s.preset, d), ...(d.secret ? { secret: d.secret } : {}) }), onSuccess: onSaved });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.pull.title", { name: s.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            {t("soc.save")}
          </Button>
        </>
      }
    >
      <PullFields preset={s.preset} d={d} set={setD} hasSecret={!!s.pull?.hasSecret} />
      <ErrorBox error={m.error} />
    </Modal>
  );
}

export function SourcesTab() {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["soc", "sources"], queryFn: api.soc.sources });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<SocSourceSecret | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["soc", "sources"] });
  const update = useMutation({ mutationFn: (d: { id: string; enabled: boolean }) => api.soc.updateSource(d.id, { enabled: d.enabled }), onSuccess: refresh });
  const rotate = useMutation({ mutationFn: api.soc.rotateSource, onSuccess: (r) => (refresh(), setSecret(r)) });
  const remove = useMutation({ mutationFn: api.soc.deleteSource, onSuccess: refresh });
  const [pulling, setPulling] = useState<SocSourceDto | null>(null);
  const pullNow = useMutation({ mutationFn: api.soc.pullSource, onSuccess: () => (refresh(), qc.invalidateQueries({ queryKey: ["soc", "alerts"] })) });
  const admin = can("admin:settings");
  const items = q.data ?? [];
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title={t("soc.src.title")}
        subtitle={t("soc.src.subtitle")}
        action={
          admin && (
            <Button onClick={() => setCreating(true)}>
              <Plus size={15} /> {t("soc.src.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error ?? update.error ?? rotate.error ?? remove.error ?? pullNow.error} />
      {!q.data ? (
        <EmptyState>{t("common.loading")}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>{t("soc.src.empty")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">{t("soc.src.col.name")}</th>
                <th className="w-44 px-3 py-2">{t("soc.src.col.preset")}</th>
                <th className="w-32 px-3 py-2">{t("soc.src.col.severity")}</th>
                <th className="w-40 px-3 py-2">{t("soc.src.col.traffic")}</th>
                <th className="w-40 px-3 py-2">{t("soc.src.col.last")}</th>
                {admin && <th className="w-56 px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{s.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-slate-500">{s.tokenPrefix}…</div>
                    {!s.enabled && <Badge tone="slate">{t("soc.src.disabled")}</Badge>}
                    {s.pull && (
                      <div className="mt-1 text-xs text-slate-600">
                        {s.pull.config.enabled ? t("soc.pull.status", { n: s.pull.config.intervalMinutes }) : t("soc.pull.off")}
                        {s.pull.lastResult && ` · ${t("soc.pull.last", { at: fmtDate(s.pull.lastResult.at), n: s.pull.lastResult.fetched, c: s.pull.lastResult.created })}`}
                      </div>
                    )}
                    {s.lastError && <div className="mt-1 text-xs text-amber-800">{s.lastError}</div>}
                  </td>
                  <td className="px-3 py-2.5">{t.lbl(SOC_SOURCE_LABELS.preset[s.preset])}</td>
                  <td className="px-3 py-2.5">
                    <SeverityBadge s={s.defaultSeverity} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{t("soc.src.traffic", { e: s.eventsTotal, a: s.alertsCreated })}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-600">{s.lastEventAt ? fmtDate(s.lastEventAt) : "—"}</td>
                  {admin && (
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {isPull(s.preset) && (
                          <Button variant="secondary" onClick={() => setPulling(s)} aria-label={t("soc.pull.settings")} title={t("soc.pull.settings")}>
                            <Settings2 size={14} />
                          </Button>
                        )}
                        {s.pull && (
                          <Button variant="secondary" disabled={pullNow.isPending} onClick={() => pullNow.mutate(s.id)}>
                            <Download size={14} /> {t("soc.pull.now")}
                          </Button>
                        )}
                        <Button variant="secondary" onClick={() => update.mutate({ id: s.id, enabled: !s.enabled })}>
                          {s.enabled ? t("soc.src.disable") : t("soc.src.enable")}
                        </Button>
                        <Button variant="secondary" onClick={async () => (await askConfirm(t("soc.src.rotateConfirm"))) && rotate.mutate(s.id)} aria-label={t("soc.src.rotate")} title={t("soc.src.rotate")}>
                          <KeyRound size={14} />
                        </Button>
                        <Button variant="danger" onClick={async () => (await askConfirm(t("soc.src.deleteConfirm", { name: s.name }))) && remove.mutate(s.id)} aria-label={t("soc.src.delete")} title={t("soc.src.delete")}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{t("soc.src.hint")}</p>
      {creating && <SourceModal onClose={() => setCreating(false)} onDone={(r) => (setCreating(false), refresh(), setSecret(r))} />}
      {secret && <TokenModal s={secret} onClose={() => setSecret(null)} />}
      {pulling && <PullModal s={pulling} onClose={() => setPulling(null)} onSaved={() => (setPulling(null), refresh())} />}
    </Card>
  );
}

function SourceModal({ onClose, onDone }: { onClose: () => void; onDone: (r: SocSourceSecret) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<SocSourcePreset>("generic");
  const [sev, setSev] = useState<SocSeverity>("medium");
  const [enabled, setEnabled] = useState(true);
  const [pull, setPull] = useState<PullDraft>(emptyPull());
  const m = useMutation({
    mutationFn: () => api.soc.createSource({ name: name.trim(), preset, defaultSeverity: sev, enabled, ...(isPull(preset) && pull.on ? { pull: pullBody(preset, pull), secret: pull.secret || undefined } : {}) }),
    onSuccess: onDone,
  });
  return (
    <Modal
      open
      wide={isPull(preset)}
      onClose={onClose}
      title={t("soc.src.new")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button onClick={() => m.mutate()} disabled={name.trim().length < 2 || m.isPending}>
            {t("soc.src.create")}
          </Button>
        </>
      }
    >
      <Field label={t("soc.src.col.name")}>
        <Input value={name} maxLength={120} placeholder="Suricata DMZ" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("soc.src.col.preset")} hint={t(`soc.src.presetHint.${preset}`)}>
        <Select value={preset} onChange={(e) => setPreset(e.target.value as SocSourcePreset)}>
          {SOC_SOURCE_PRESETS.map((p) => (
            <option key={p} value={p}>
              {t.lbl(SOC_SOURCE_LABELS.preset[p])}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("soc.src.col.severity")} hint={t("soc.src.severityHint")}>
        <Select value={sev} onChange={(e) => setSev(e.target.value as SocSeverity)}>
          {SOC_SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {t.lbl(SOC_LABELS.severity[s])}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox checked={enabled} onChange={setEnabled} label={t("soc.src.enabled")} />
      {isPull(preset) && <PullFields preset={preset} d={pull} set={setPull} hasSecret={false} />}
      <ErrorBox error={m.error} />
    </Modal>
  );
}

/** Token se zobrazí jen jednou – s adresou příjmu a příkladem volání. */
function TokenModal({ s, onClose }: { s: SocSourceSecret; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const curl = `curl -sS -X POST '${ingestUrl()}' \\\n  -H 'Authorization: Bearer ${s.token}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${EXAMPLE[s.source.preset]}'`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* schránka nedostupná – text lze označit ručně */
    }
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("soc.src.tokenTitle", { name: s.source.name })}
      footer={
        <Button onClick={onClose}>{t("soc.src.tokenDone")}</Button>
      }
    >
      <p className="text-sm text-amber-800">{t("soc.src.tokenOnce")}</p>
      <Field label={t("soc.src.token")}>
        <div className="flex gap-2">
          <Input readOnly value={s.token} className="font-mono text-xs" data-testid="soc-source-token" onFocus={(e) => e.target.select()} />
          <Button variant="secondary" onClick={() => copy(s.token)} aria-label={t("soc.src.copy")}>
            <Copy size={14} /> {copied ? t("soc.src.copied") : t("soc.src.copy")}
          </Button>
        </div>
      </Field>
      <Field label={t("soc.src.url")}>
        <Input readOnly value={ingestUrl()} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
      </Field>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">{t("soc.src.example")}</div>
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{curl}</pre>
        <p className="mt-1 text-xs text-slate-500">{t(`soc.src.presetHint.${s.source.preset}`)}</p>
      </div>
    </Modal>
  );
}

