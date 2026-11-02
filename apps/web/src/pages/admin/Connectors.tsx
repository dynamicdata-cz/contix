import { fmtDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import type { ConnectorSettingsDto, ConnectorTestResult } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Radar, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

export function AdminConnectorsPage() {
  const q = useQuery({ queryKey: ["admin", "connectors"], queryFn: api.admin.connectors });
  if (!q.data) return <ErrorBox error={q.error} />;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <WazuhCard data={q.data} />
      <ScanCard data={q.data} />
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

function WazuhCard({ data }: { data: ConnectorSettingsDto }) {
  const t = useT();
  const qc = useQueryClient();
  const w = data.wazuh;
  const init = () => ({
    enabled: w.source === "none" ? true : w.enabled,
    url: w.url,
    user: w.user,
    password: "",
    verifyTls: w.verifyTls,
    includePackages: w.includePackages,
    vulnEnabled: w.vulnEnabled,
    indexerUrl: w.indexerUrl || (w.url ? w.url.replace(/:55000$/, ":9200") : ""),
    indexerUser: w.indexerUser,
    indexerPassword: "",
    indexerVerifyTls: w.indexerVerifyTls,
    indexPattern: w.indexPattern,
    autoSyncHours: w.autoSyncHours as 0 | 6 | 12 | 24,
  });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [JSON.stringify(w)]);

  const test = useMutation({ mutationFn: () => api.admin.testWazuh(f) });
  const testIdx = useMutation({ mutationFn: () => api.admin.testIndexer(f) });
  const save = useMutation({
    mutationFn: () => api.admin.saveWazuh(f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "connectors"] });
      qc.invalidateQueries({ queryKey: ["connectors"] });
    },
  });

  return (
    <Card>
      <CardHeader
        title={t("con.wazuh")}
        subtitle={t("con.importAgentuAJejichInventare")}
        action={<ShieldCheck className="text-brand-600" size={22} />}
      />
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap gap-2 text-xs">
          {w.source === "none" && <Badge tone="amber">{t("con.nenastaveno")}</Badge>}
          {w.source === "env" && <Badge>{t("con.zEnvUlozenimSePrevezme")}</Badge>}
          {w.source === "db" && (w.enabled ? <Badge tone="green">{t("con.zapnuto")}</Badge> : <Badge>{t("con.vypnuto")}</Badge>)}
          {w.hasPassword && <Badge tone="blue">{t("con.hesloUlozeno")}</Badge>}
        </div>

        <Field label={t("con.urlWazuhServerApi")} hint={t("con.wazuhManagerVychoziPort55000")}>
          <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={t("con.httpsWazuhFirmaLocal55000")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("con.uzivatelApi")}>
            <Input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder={t("con.contixRo")} autoComplete="off" />
          </Field>
          <Field label={t("con.heslo")} hint={w.hasPassword ? t("con.prazdnePonechatUlozene") : undefined}>
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
        <Field label={t("con.automatickaSynchronizaceAktivAZranitelno")} hint={w.lastSyncAt ? t("con.posledniSynchronizaceX", { date: fmtDate(w.lastSyncAt), status: w.lastSyncStatus === "succeeded" ? t("con.uspesna") : w.lastSyncStatus === "running" ? t("con.bezi") : t("con.sChybou") }) : t("con.zatimNeprobehlaSpustteJiV")}>
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
            <Field label={t("con.hesloIndexeru")} hint={w.hasIndexerPassword ? t("con.prazdnePonechatUlozene") : undefined}>
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

        <ErrorBox error={test.error ?? testIdx.error ?? save.error} />
        {save.isSuccess && <SuccessBox>{t("con.ulozenoSynchronizaciSpustiteVDiscovery")}</SuccessBox>}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={test.isPending || !f.url || !f.user} onClick={() => test.mutate()}>
            {test.isPending ? "Testuji…" : t("con.otestovatPripojeni")}
          </Button>
          <Button disabled={save.isPending || !f.url || !f.user} onClick={() => save.mutate()}>
            {t("con.ulozit")}
          </Button>
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
          <Textarea value={cidrs} onChange={(e) => setCidrs(e.target.value)} className="font-mono text-sm" placeholder="192.168.1.0/24" />
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
