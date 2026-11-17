import { fmtDate } from "@/lib/utils";
import { NetboxJiraCards } from "@/components/integrations";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import type { CollectorConnectionDto, CompanyDto, ProbeConnectionDto, ConnectorSettingsDto, ConnectorTestResult, WazuhConnectionDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Crosshair, Plus, Radar, Server, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { askConfirm } from "@/components/ui/overlay";
import { useEffect, useState } from "react";

export function AdminConnectorsPage() {
  const q = useQuery({ queryKey: ["admin", "connectors"], queryFn: api.admin.connectors });
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <div className="space-y-6">
      <WazuhConnections />
      <Collectors />
      <ProbesAdmin />
      <NetboxJiraCards />
      <div className="grid gap-6 xl:grid-cols-2">
        <ScanCard data={q.data} />
      </div>
    </div>
  );
}

/** Sběrač ze serverů (v1.51, ADR-148): připojení s tokenem, kterým servery posílají inventář. */
function Collectors() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "connections"], queryFn: api.admin.connections });
  const companies = useQuery({ queryKey: ["companies"], queryFn: api.companies.list });
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [installer, setInstaller] = useState<string | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ["admin", "connections"] });
  const create = useMutation({
    mutationFn: () => api.admin.createCollector({ name, companyId: companyId || null }),
    onSuccess: (r) => {
      setToken(r.token);
      setName("");
      done();
    },
  });
  const rotate = useMutation({ mutationFn: (id: string) => api.admin.rotateCollector(id), onSuccess: (r) => (setToken(r.token), done()) });
  const toggle = useMutation({ mutationFn: (c: CollectorConnectionDto) => api.admin.updateCollector(c.id, { name: c.name, companyId: c.companyId, enabled: !c.enabled }), onSuccess: done });
  const remove = useMutation({
    mutationFn: async (c: CollectorConnectionDto) => {
      if (await askConfirm(t("col.deleteConfirm", { name: c.name }), { danger: true })) await api.admin.deleteCollector(c.id);
    },
    onSuccess: done,
  });
  const names = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const url = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <Card data-testid="collectors">
      <CardHeader title={t("col.title")} subtitle={t("col.subtitle")} action={<Server className="text-brand-600" size={22} />} />
      <div className="space-y-4 p-5">
        {(q.data?.collectors ?? []).map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-slate-200 px-4 py-3" data-testid={`collector-${c.name}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{c.name}</span>
                {c.enabled ? <Badge tone="green">{t("con.zapnuto")}</Badge> : <Badge>{t("con.vypnuto")}</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {c.companyId ? names.get(c.companyId) ?? c.companyId : t("cn.scope.group")} · {t("col.token")} <code>{c.tokenPrefix}…</code> · {t("col.hosts", { n: c.hosts })}
                {c.lastReportAt ? ` · ${t("col.last", { date: fmtDate(c.lastReportAt) })}` : ""}
              </div>
            </div>
            <Button variant={installer === c.id ? "primary" : "secondary"} onClick={() => setInstaller(installer === c.id ? null : c.id)} data-testid={`collector-installer-${c.name}`}>
              {t("col.installer")}
            </Button>
            <Button variant="secondary" onClick={() => toggle.mutate(c)}>
              {c.enabled ? t("col.disable") : t("col.enable")}
            </Button>
            <Button variant="secondary" onClick={() => rotate.mutate(c.id)}>
              {t("col.rotate")}
            </Button>
            <Button variant="ghost" className="text-red-700" onClick={() => remove.mutate(c)}>
              <Trash2 size={14} />
            </Button>
            {installer === c.id && <InstallerPanel c={c} onRotate={() => rotate.mutate(c.id)} />}
          </div>
        ))}
        {token && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="collector-token">
            <p className="font-semibold">{t("col.tokenOnce")}</p>
            <code className="block break-all rounded bg-white px-2 py-1 text-slate-900">{token}</code>
            <p>{t("col.install")}</p>
            <pre className="overflow-x-auto rounded bg-white p-2 text-xs text-slate-800">{`sudo install -m 0755 contix-collect.py /usr/local/sbin/contix-collect.py
sudo sh -c 'umask 077; printf "CONTIX_URL=${url}\\nCONTIX_TOKEN=${token}\\n" > /etc/contix-collect.env'
sudo /usr/local/sbin/contix-collect.py
echo '17 */6 * * * root /usr/local/sbin/contix-collect.py >/dev/null' | sudo tee /etc/cron.d/contix-collect`}</pre>
            <Button variant="ghost" onClick={() => setToken(null)}>
              {t("col.hideToken")}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <Field label={t("cn.name")} className="w-56">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("col.namePh")} />
          </Field>
          <Field label={t("cn.scope")} className="w-64">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">{t("cn.scope.group")}</option>
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            <Plus size={15} /> {t("col.create")}
          </Button>
          <a href={api.admin.collectorScriptUrl} className="text-sm text-brand-700 hover:underline">
            {t("col.script")}
          </a>
        </div>
        <ErrorBox error={q.error ?? create.error ?? rotate.error ?? toggle.error ?? remove.error} />
        <p className="text-xs text-slate-500">{t("col.what")}</p>
      </div>
    </Card>
  );
}

/** Sondy bezpečnostních testů (v1.56, ADR-153): připojení s tokenem, instalátor pro Kali Linux. */
function ProbesAdmin() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "connections"], queryFn: api.admin.connections });
  const companies = useQuery({ queryKey: ["companies"], queryFn: api.companies.list });
  const [name, setName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [caPem, setCaPem] = useState("");
  const url = typeof window === "undefined" ? "" : window.location.origin;
  useEffect(() => {
    if (!url.startsWith("https:")) return;
    void api.admin.contixCa().then((pem) => pem && setCaPem(pem));
  }, [url]);
  const done = () => qc.invalidateQueries({ queryKey: ["admin", "connections"] });
  const create = useMutation({ mutationFn: () => api.admin.createProbe({ name, companyId: companyId || null }), onSuccess: (r) => (setToken(r.token), setName(""), done()) });
  const rotate = useMutation({ mutationFn: (id: string) => api.admin.rotateProbe(id), onSuccess: (r) => (setToken(r.token), done()) });
  const toggle = useMutation({ mutationFn: (p: ProbeConnectionDto) => api.admin.updateProbe(p.id, { name: p.name, companyId: p.companyId, enabled: !p.enabled }), onSuccess: done });
  const remove = useMutation({
    mutationFn: async (p: ProbeConnectionDto) => {
      if (await askConfirm(t("pr.deleteConfirm", { name: p.name }), { danger: true })) await api.admin.deleteProbe(p.id);
    },
    onSuccess: done,
  });
  const download = useMutation({ mutationFn: (id: string) => api.admin.probeInstaller(id, { url, caPem: caPem.trim() }) });
  const names = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  return (
    <Card data-testid="probes-admin">
      <CardHeader title={t("pr.title")} subtitle={t("pr.subtitle")} action={<Crosshair className="text-brand-600" size={22} />} />
      <div className="space-y-4 p-5">
        {(q.data?.probes ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-slate-200 px-4 py-3" data-testid={`probe-${p.name}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{p.name}</span>
                {p.enabled ? <Badge tone="green">{t("con.zapnuto")}</Badge> : <Badge>{t("con.vypnuto")}</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {p.companyId ? names.get(p.companyId) ?? p.companyId : t("cn.scope.group")} · {t("col.token")} <code>{p.tokenPrefix}…</code> · {p.lastSeenAt ? t("st.probe.seen", { date: fmtDate(p.lastSeenAt) }) : t("st.probe.never")}
                {p.hostname ? ` · ${p.hostname}` : ""}
              </div>
            </div>
            <Button disabled={!p.installerReady || download.isPending} onClick={() => download.mutate(p.id)}>
              {t("pr.installer")}
            </Button>
            <Button variant="secondary" onClick={() => toggle.mutate(p)}>
              {p.enabled ? t("col.disable") : t("col.enable")}
            </Button>
            <Button variant="secondary" onClick={() => rotate.mutate(p.id)}>
              {t("col.rotate")}
            </Button>
            <Button variant="ghost" className="text-red-700" onClick={() => remove.mutate(p)}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {token && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" data-testid="probe-token">
            <p className="font-semibold">{t("pr.tokenNote")}</p>
            <Button variant="ghost" onClick={() => setToken(null)}>
              {t("col.hideToken")}
            </Button>
          </div>
        )}
        <Field label={t("col.inst.ca")} hint={t("col.inst.caHint")}>
          <Textarea rows={3} value={caPem} onChange={(e) => setCaPem(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-xs" />
        </Field>
        <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-800">{`scp install-contix-probe.sh kali:
ssh -t kali sudo sh install-contix-probe.sh`}</pre>
        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <Field label={t("cn.name")} className="w-56">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kali – pentest" />
          </Field>
          <Field label={t("cn.scope")} className="w-64">
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">{t("cn.scope.group")}</option>
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            <Plus size={15} /> {t("pr.create")}
          </Button>
        </div>
        <ErrorBox error={q.error ?? create.error ?? rotate.error ?? toggle.error ?? remove.error ?? download.error} />
        <p className="text-xs text-slate-500">{t("pr.what")}</p>
      </div>
    </Card>
  );
}

/** Instalátor sběrače (v1.54, ADR-151): jeden soubor pro server – skript, adresa, token, CA, /etc/hosts, cron. */
function InstallerPanel({ c, onRotate }: { c: CollectorConnectionDto; onRotate: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [hostsIp, setHostsIp] = useState(c.hostsIp);
  const [caPem, setCaPem] = useState(c.caPem);
  const [everyHours, setEveryHours] = useState<1 | 6 | 12 | 24>(6);
  const [caAuto, setCaAuto] = useState(false);
  const url = typeof window === "undefined" ? "" : window.location.origin;
  useEffect(() => {
    if (c.caPem || !url.startsWith("https:")) return;
    void api.admin.contixCa().then((pem) => {
      if (pem) {
        setCaPem(pem);
        setCaAuto(true);
      }
    });
  }, [c.caPem, url]);
  const download = useMutation({
    mutationFn: () => api.admin.collectorInstaller(c.id, { url, hostsIp: hostsIp.trim(), caPem: caPem.trim(), everyHours }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "connections"] }),
  });
  return (
    <div className="w-full space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm" data-testid="collector-installer">
      <p className="text-slate-700">{t("col.inst.intro")}</p>
      {!c.installerReady && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          <span className="flex-1">{t("col.inst.oldToken")}</span>
          <Button variant="secondary" onClick={onRotate}>
            {t("col.rotate")}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-start gap-3">
        <Field label={t("col.inst.url")} className="w-72">
          <Input value={url} readOnly />
        </Field>
        <Field label={t("col.inst.hostsIp")} hint={t("col.inst.hostsIpHint")} className="w-56">
          <Input value={hostsIp} onChange={(e) => setHostsIp(e.target.value)} placeholder="192.0.2.10" />
        </Field>
        <Field label={t("col.inst.every")} className="w-40">
          <Select value={String(everyHours)} onChange={(e) => setEveryHours(Number(e.target.value) as 1 | 6 | 12 | 24)}>
            {[1, 6, 12, 24].map((h) => (
              <option key={h} value={h}>
                {t("col.inst.hours", { n: h })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("col.inst.ca")} hint={caAuto ? t("col.inst.caAuto") : t("col.inst.caHint")}>
        <Textarea rows={4} value={caPem} onChange={(e) => (setCaPem(e.target.value), setCaAuto(false))} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-xs" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!c.installerReady || download.isPending} onClick={() => download.mutate()}>
          {t("col.inst.download")}
        </Button>
        {download.isSuccess && <span className="text-emerald-700">{t("col.inst.downloaded")}</span>}
      </div>
      <ErrorBox error={download.error} />
      <div className="space-y-1">
        <p className="font-medium text-slate-700">{t("col.inst.howto")}</p>
        <pre className="overflow-x-auto rounded bg-white p-2 text-xs text-slate-800">{`scp install-contix-collect.sh server:
ssh -t server sudo sh install-contix-collect.sh

for h in server1 server2 server3; do scp install-contix-collect.sh $h: && ssh -t $h sudo sh install-contix-collect.sh; done`}</pre>
        <p className="text-xs text-slate-500">{t("col.inst.note")}</p>
      </div>
    </div>
  );
}

/** Víc Wazuhů (v1.49, ADR-146): seznam připojení, každé s rozsahem a schopnostmi. */
function WazuhConnections() {
  const t = useT();
  const q = useQuery({ queryKey: ["admin", "connections"], queryFn: api.admin.connections });
  const companies = useQuery({ queryKey: ["companies"], queryFn: api.companies.list });
  const [adding, setAdding] = useState(false);
  const list = q.data?.wazuh ?? [];
  const names = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  return (
    <div className="space-y-4" data-testid="wazuh-connections">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t("cn.title")}</h2>
          <p className="text-sm text-slate-500">{t("cn.subtitle")}</p>
        </div>
        {!adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={15} /> {t("cn.add")}
          </Button>
        )}
      </div>
      <ErrorBox error={q.error} />
      {q.data && !list.length && !adding && <Card className="p-5 text-sm text-slate-600">{t("con.nenastaveno")}</Card>}
      {list.map((w) => (
        <WazuhCard key={w.id} w={w} companies={companies.data ?? []} companyName={(id) => names.get(id) ?? id} />
      ))}
      {adding && <WazuhCard w={null} companies={companies.data ?? []} companyName={(id) => names.get(id) ?? id} onClose={() => setAdding(false)} />}
    </div>
  );
}

function TestResult({ r }: { r?: ConnectorTestResult }) {
  if (!r) return null;
  return (
    <div
      className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${r.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}
    >
      {r.ok ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <XCircle size={17} className="mt-0.5 shrink-0" />}
      <span>{r.message}</span>
    </div>
  );
}

function WazuhCard({ w, companies, companyName, onClose }: { w: WazuhConnectionDto | null; companies: CompanyDto[]; companyName: (id: string) => string; onClose?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(!w);
  const init = () => ({
    name: w?.name ?? (w === null ? "" : "Wazuh"),
    companyId: w?.companyId ?? null,
    groupMap: w?.groupMap ?? [],
    enabled: w?.enabled ?? true,
    url: w?.url ?? "",
    user: w?.user ?? "",
    password: "",
    verifyTls: w?.verifyTls ?? true,
    includePackages: w?.includePackages ?? true,
    vulnEnabled: w?.vulnEnabled ?? true,
    indexerUrl: w?.indexerUrl || (w?.url ? w.url.replace(/:55000$/, ":9200") : ""),
    indexerUser: w?.indexerUser ?? "",
    indexerPassword: "",
    indexerVerifyTls: w?.indexerVerifyTls ?? true,
    indexPattern: w?.indexPattern ?? "wazuh-states-vulnerabilities-*",
    autoSyncHours: (w?.autoSyncHours ?? 24) as 0 | 6 | 12 | 24,
    alertsEnabled: w?.alertsEnabled ?? false,
    alertMinLevel: w?.alertMinLevel ?? 10,
    alertsIndexPattern: w?.alertsIndexPattern ?? "wazuh-alerts-*",
    arUser: w?.arUser ?? "",
    arPassword: "",
  });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [JSON.stringify(w)]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "connections"] });
    qc.invalidateQueries({ queryKey: ["admin", "connectors"] });
    qc.invalidateQueries({ queryKey: ["connectors"] });
  };
  const test = useMutation({ mutationFn: () => api.admin.testConnection({ ...f, id: w?.id }) });
  const testIdx = useMutation({ mutationFn: () => api.admin.testConnectionIndexer({ ...f, id: w?.id }) });
  const save = useMutation({
    mutationFn: () => (w ? api.admin.updateConnection(w.id, f) : api.admin.createConnection(f)),
    onSuccess: () => {
      refresh();
      if (!w) onClose?.();
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!w || !(await askConfirm(t("cn.deleteConfirm", { name: w.name }), { danger: true }))) return;
      await api.admin.deleteConnection(w.id);
      refresh();
    },
  });
  const scope = (x: { companyId: string | null; groupMap: { group: string; companyId: string }[] }) =>
    x.companyId ? companyName(x.companyId) : x.groupMap.length ? t("cn.scope.mapped", { n: x.groupMap.length }) : t("cn.scope.group");

  if (w && !open)
    return (
      <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4" data-testid={`wazuh-conn-${w.name}`}>
        <ShieldCheck className="text-brand-600" size={20} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{w.name}</span>
            {w.enabled ? <Badge tone="green">{t("con.zapnuto")}</Badge> : <Badge>{t("con.vypnuto")}</Badge>}
            {w.alertsEnabled && <Badge tone="blue">{t("cn.alertsOn")}</Badge>}
          </div>
          <div className="truncate text-xs text-slate-500">
            {w.url} · {scope(w)} · {t("cn.agents", { n: w.agents })}
            {w.lastSyncAt ? ` · ${t("cn.lastSync", { date: fmtDate(w.lastSyncAt) })}` : ""}
          </div>
        </div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t("cn.edit")}
        </Button>
      </Card>
    );

  return (
    <Card>
      <CardHeader
        title={w ? w.name : t("cn.new")}
        subtitle={t("con.importAgentuAJejichInventare")}
        action={<ShieldCheck className="text-brand-600" size={22} />}
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("cn.name")} hint={t("cn.nameHint")}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Wazuh – produkce" />
          </Field>
          <Field label={t("cn.scope")} hint={t("cn.scopeHint")}>
            <Select value={f.companyId ?? ""} onChange={(e) => setF({ ...f, companyId: e.target.value || null })}>
              <option value="">{t("cn.scope.group")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!f.companyId && (
          <div className="space-y-2 rounded-md border border-slate-200 p-4" data-testid="group-map">
            <p className="text-sm font-semibold text-slate-800">{t("cn.groupMap")}</p>
            <p className="text-xs text-slate-500">{t("cn.groupMapHint")}</p>
            {f.groupMap.map((m, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="w-48" aria-label={t("cn.agentGroup")} value={m.group} onChange={(e) => setF({ ...f, groupMap: f.groupMap.map((x, k) => (k === i ? { ...x, group: e.target.value } : x)) })} placeholder="zakaznik-b" />
                <span className="text-slate-400">→</span>
                <Select className="w-64" aria-label={t("cn.company")} value={m.companyId} onChange={(e) => setF({ ...f, groupMap: f.groupMap.map((x, k) => (k === i ? { ...x, companyId: e.target.value } : x)) })}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button variant="ghost" aria-label={t("cn.removeRow")} onClick={() => setF({ ...f, groupMap: f.groupMap.filter((_, k) => k !== i) })}>
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button variant="secondary" disabled={!companies.length} onClick={() => setF({ ...f, groupMap: [...f.groupMap, { group: "", companyId: companies[0]!.id }] })}>
              <Plus size={14} /> {t("cn.addRow")}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-xs">
          {w?.hasPassword && <Badge tone="blue">{t("con.hesloUlozeno")}</Badge>}
          {w && <Badge>{t("cn.agents", { n: w.agents })}</Badge>}
        </div>

        <Field label={t("con.urlWazuhServerApi")} hint={t("con.wazuhManagerVychoziPort55000")}>
          <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={t("con.httpsWazuhFirmaLocal55000")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("con.uzivatelApi")}>
            <Input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder={t("con.contixRo")} autoComplete="off" />
          </Field>
          <Field label={t("con.heslo")} hint={w?.hasPassword ? t("con.prazdnePonechatUlozene") : undefined}>
            <Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        <Checkbox
          checked={f.verifyTls}
          onChange={(v) => setF({ ...f, verifyTls: v })}
          label={t("con.overovatTlsCertifikat")}
          hint={t("con.vypneteJenProTestS")}
        />
        <Checkbox checked={f.includePackages} onChange={(v) => setF({ ...f, includePackages: v })} label={t("con.nacitatSeznamNainstalovanehoSoftwaru")} />
        <Checkbox checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t("con.konektorZapnuty")} />
        <Field label={t("con.automatickaSynchronizaceAktivAZranitelno")} hint={w?.lastSyncAt ? t("con.posledniSynchronizaceX", { date: fmtDate(w.lastSyncAt), status: w.lastSyncStatus === "succeeded" ? t("con.uspesna") : w.lastSyncStatus === "running" ? t("con.bezi") : t("con.sChybou") }) : t("con.zatimNeprobehlaSpustteJiV")}>
          <Select value={String(f.autoSyncHours)} onChange={(e) => setF({ ...f, autoSyncHours: Number(e.target.value) as 0 | 6 | 12 | 24 })}>
            <option value="24">{t("con.kazdych24HodinDoporuceno")}</option>
            <option value="12">{t("con.kazdych12Hodin")}</option>
            <option value="6">{t("con.kazdych6Hodin")}</option>
            <option value="0">{t("con.vypnutoJenRucne")}</option>
          </Select>
        </Field>
        <TestResult r={test.data} />

        <div className="space-y-4 rounded-md border border-slate-200 p-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">{t("con.zranitelnostiCveWazuhIndexer")}</p>
            <p className="text-xs text-slate-500">
              {t("con.wazuh48UkladaVysledky")} <code>{t("con.admin")}</code> {t("con.zInstalaceLepeVlastniRead")} <code>{t("con.wazuhStatesVulnerabilities")}</code>).
            </p>
          </div>
          <Checkbox checked={f.vulnEnabled} onChange={(v) => setF({ ...f, vulnEnabled: v })} label={t("con.nacitatZranitelnostiPriSynchronizaci")} />
          <Field label={t("con.urlWazuhIndexeru")}>
            <Input value={f.indexerUrl} onChange={(e) => setF({ ...f, indexerUrl: e.target.value })} placeholder={t("con.httpsWazuhFirmaLocal9200")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("con.uzivatelIndexeru")}>
              <Input value={f.indexerUser} onChange={(e) => setF({ ...f, indexerUser: e.target.value })} placeholder={t("con.admin")} autoComplete="off" />
            </Field>
            <Field label={t("con.hesloIndexeru")} hint={w?.hasIndexerPassword ? t("con.prazdnePonechatUlozene") : undefined}>
              <Input type="password" value={f.indexerPassword} onChange={(e) => setF({ ...f, indexerPassword: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <Checkbox checked={f.indexerVerifyTls} onChange={(v) => setF({ ...f, indexerVerifyTls: v })} label={t("con.overovatTlsCertifikatIndexeru")} />
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{t("con.pokrocile")}</summary>
            <Field label={t("con.indexVzor")} className="mt-2">
              <Input value={f.indexPattern} onChange={(e) => setF({ ...f, indexPattern: e.target.value })} className="font-mono" />
            </Field>
          </details>
          <TestResult r={testIdx.data} />
          <Button variant="secondary" disabled={testIdx.isPending || !f.indexerUrl || !f.indexerUser} onClick={() => testIdx.mutate()}>
            {testIdx.isPending ? "Testuji…" : t("con.otestovatIndexer")}
          </Button>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">{t("con.indexerOdmitaSpojeniConnectionrefused")}</summary>
            <div className="mt-2 space-y-2">
              <p>
                {t("con.uAllInOneInstalace")} <code>127.0.0.1:9200</code>{t("con.overiteNaServeru")}{" "}
                <code>{t("con.sudoSsTlnpGrep9200")}</code>
              </p>
              <p>
                <b>{t("con.proVyvojBezZmenNa")}</b> {t("con.sshTunelZPocitaceS")}{" "}
                <code>{t("con.sshNL9200127")}</code> {t("con.aJakoUrlZadat")} <code>{t("con.httpsLocalhost9200")}</code>.
              </p>
              <p>
                <b>{t("con.proProvoz")}</b> {t("common.in")} <code>{t("con.etcWazuhIndexerOpensearchYml")}</code> {t("con.nastavit")} <code>{t("con.networkHost")}</code> {t("con.naIpServeruNebo")} <code>0.0.0.0</code>{t("con.restartovat")} <code>{t("con.wazuhIndexer")}</code> {t("con.aVeFirewalluPovolitPort")}
              </p>
            </div>
          </details>
          <p className="text-xs text-slate-500">{t("con.bezIndexeruSeContixPokusi")}<code>{t("con.vulnerability")}</code>).</p>
        </div>

        <div className="space-y-4 rounded-md border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-800">{t("cn.alerts")}</p>
          <Checkbox checked={f.alertsEnabled} onChange={(v) => setF({ ...f, alertsEnabled: v })} label={t("cn.alertsEnabled")} hint={w?.lastAlertResult ?? undefined} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("cn.alertMinLevel")}>
              <Input type="number" min={1} max={15} value={f.alertMinLevel} onChange={(e) => setF({ ...f, alertMinLevel: Number(e.target.value) || 10 })} />
            </Field>
            <Field label={t("cn.alertsIndex")}>
              <Input value={f.alertsIndexPattern} onChange={(e) => setF({ ...f, alertsIndexPattern: e.target.value })} className="font-mono" />
            </Field>
          </div>
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{t("cn.ar")}</summary>
            <p className="mt-2">{t("cn.arHint")}</p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <Field label={t("con.uzivatelApi")}>
                <Input value={f.arUser} onChange={(e) => setF({ ...f, arUser: e.target.value })} autoComplete="off" />
              </Field>
              <Field label={t("con.heslo")} hint={w?.hasArPassword ? t("con.prazdnePonechatUlozene") : undefined}>
                <Input type="password" value={f.arPassword} onChange={(e) => setF({ ...f, arPassword: e.target.value })} autoComplete="new-password" />
              </Field>
            </div>
          </details>
        </div>

        <ErrorBox error={test.error ?? testIdx.error ?? save.error ?? remove.error} />
        {save.isSuccess && <SuccessBox>{t("con.ulozenoSynchronizaciSpustiteVDiscovery")}</SuccessBox>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={test.isPending || !f.url || !f.user} onClick={() => test.mutate()}>
            {test.isPending ? "Testuji…" : t("con.otestovatPripojeni")}
          </Button>
          <Button disabled={save.isPending || !f.url || !f.user || !f.name.trim() || f.groupMap.some((m) => !m.group.trim())} onClick={() => save.mutate()}>
            {t("con.ulozit")}
          </Button>
          {w ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("cn.collapse")}
              </Button>
              <Button variant="ghost" className="ml-auto text-red-700" disabled={remove.isPending} onClick={() => remove.mutate()}>
                <Trash2 size={14} /> {t("cn.delete")}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              {t("cn.cancel")}
            </Button>
          )}
        </div>

        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">{t("con.jakVytvoritReadOnlyUcet")}</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>{t("con.wazuhDashboardServerManagementSecurity")}</li>
            <li>{t("con.rolesMappingRolesPriradteRoli")} <code>{t("con.agentRead")}</code> {t("common.and")} <code>{t("con.syscollectorRead")}</code> {t("con.pripadneVestavenouRoli")} <code>{t("con.readonly")}</code>).</li>
            <li>{t("con.zPocitaceKdeBeziContix")}</li>
          </ol>
        </details>
      </div>
    </Card>
  );
}

function ScanCard({ data }: { data: ConnectorSettingsDto }) {
  const t = useT();
  const qc = useQueryClient();
  const s = data.networkScan;
  const [enabled, setEnabled] = useState(s.enabled);
  const [cidrs, setCidrs] = useState(s.allowedCidrs.join("\n"));
  const [nmapPath, setNmapPath] = useState(s.nmapPath);
  useEffect(() => {
    setEnabled(s.enabled);
    setCidrs(s.allowedCidrs.join("\n"));
    setNmapPath(s.nmapPath);
  }, [s.enabled, s.allowedCidrs.join(","), s.nmapPath]);
  const list = cidrs
    .split(/[\n,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const test = useMutation({ mutationFn: () => api.admin.testScan(nmapPath) });
  const save = useMutation({
    mutationFn: () => api.admin.saveScan({ enabled, allowedCidrs: list, nmapPath }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "connectors"] });
      qc.invalidateQueries({ queryKey: ["connectors"] });
    },
  });

  return (
    <Card>
      <CardHeader title={t("con.sitovySkenNmap")} subtitle={t("con.aktivniVyhledaniZarizeniBezAgenta")} action={<Radar className="text-brand-600" size={22} />} />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2 text-xs">
          {s.nmapFound ? <Badge tone="green">{t("con.nmapNalezen", { p: s.nmapVersion ?? "" })}</Badge> : <Badge tone="red">{t("con.nmapNeniNainstalovany")}</Badge>}
          {s.enabled ? <Badge tone="green">{t("con.zapnuto")}</Badge> : <Badge>{t("con.vypnuto")}</Badge>}
          {!s.privileged && <Badge tone="amber">{t("con.bezRootDetekceOsNedostupna")}</Badge>}
        </div>
        {!s.nmapFound && (
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            {t("con.nainstalujteNmapNaPocitacServer")}
            <pre className="mt-1 font-mono text-xs">{t("con.brewInstallNmapMacos")}{"\n"}{t("con.sudoAptInstallNmapUbuntu")}</pre>
            {t("con.potomKlikneteNaOveritNmap")}
          </div>
        )}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {t("con.skenujteJenSiteKeKterym")}
        </div>
        <Field label={t("con.povoleneRozsahyAllowList")} hint={t("con.jedenNaRadekIpv4Adresa")}>
          <Textarea value={cidrs} onChange={(e) => setCidrs(e.target.value)} className="font-mono text-sm" placeholder="192.0.2.0/24" />
        </Field>
        <Field label={t("con.cestaKNmap")} hint={t("con.obvykleStaciNmapNaMacu")}>
          <Input value={nmapPath} onChange={(e) => setNmapPath(e.target.value)} className="font-mono" />
        </Field>
        <Checkbox checked={enabled} onChange={setEnabled} label={t("con.sitovySkenZapnuty")} />

        <TestResult r={test.data} />
        <ErrorBox error={test.error ?? save.error} />
        {save.isSuccess && <SuccessBox>{t("con.ulozeno")}</SuccessBox>}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
            {t("con.overitNmap")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("con.ulozit")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
