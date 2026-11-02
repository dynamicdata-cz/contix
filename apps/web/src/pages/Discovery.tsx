import { useT, tt } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, Select, statusLabel, connectorLabel, statusTone } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import type { DiscoveryRunDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Radar, RefreshCw, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useCan } from "@/lib/auth";
import { NetSegmentsSection } from "@/components/netSegments";

export function DiscoveryPage() {
  const t = useT();
  const qc = useQueryClient();
  const connectors = useQuery({ queryKey: ["connectors"], queryFn: api.discovery.connectors });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: api.discovery.runs,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running" || r.status === "queued") ? 2000 : false),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["runs"] });
    qc.invalidateQueries({ queryKey: ["assets"] });
  };
  const can = useCan();
  const enabled = (id: string) => can("discovery:run") && (connectors.data?.find((c) => c.id === id)?.enabled ?? false);
  const detail = (id: string) => connectors.data?.find((c) => c.id === id)?.detail;
  const allowed = connectors.data?.find((c) => c.id === "network_scan")?.allowedCidrs ?? [];

  const wazuh = useMutation({ mutationFn: api.discovery.wazuh, onSuccess: refresh });
  const [targets, setTargets] = useState("");
  const [profile, setProfile] = useState<"ping" | "standard" | "os_detect">("standard");
  const scan = useMutation({
    mutationFn: () => api.discovery.scan({ targets: (targets || allowed[0] || "").split(/[\s,]+/).filter(Boolean), profile }),
    onSuccess: refresh,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const importCsv = useMutation({ mutationFn: api.discovery.importCsv, onSuccess: refresh });

  return (
    <>
      <PageHeader title={t("ast.discoveryImport")} subtitle={t("ast.automatickeZjistovaniAktivAHromadne")} />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("ast.wazuh")} subtitle={t("ast.agentiSyscollectorOsHwSit")} action={<ShieldCheck className="text-brand-600" size={20} />} />
          <div className="space-y-3 p-5">
            <ConnectorStatus text={detail("wazuh")} ok={enabled("wazuh")} canSetup={can("admin:settings")} />
            <ErrorBox error={wazuh.error} />
            <Button disabled={!enabled("wazuh") || wazuh.isPending} onClick={() => wazuh.mutate()}>
              <RefreshCw size={15} /> {t("ast.synchronizovat")}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("ast.sitovySken")} subtitle={t("ast.nmapJenVPovolenychRozsazich")} action={<Radar className="text-brand-600" size={20} />} />
          <div className="space-y-3 p-5">
            <ConnectorStatus text={detail("network_scan")} ok={enabled("network_scan")} canSetup={can("admin:settings")} />
            <Field label={t("ast.cileIpCidr")}>
              <Input value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={allowed[0] ?? "192.168.1.0/24"} disabled={!enabled("network_scan")} />
            </Field>
            <Field label={t("ast.profil")}>
              <Select value={profile} onChange={(e) => setProfile(e.target.value as typeof profile)} disabled={!enabled("network_scan")}>
                <option value="ping">{t("ast.pingSweepRychly")}</option>
                <option value="standard">{t("ast.standardniPortySluzby")}</option>
                <option value="os_detect">{t("ast.detekceOsVyzadujeRoot")}</option>
              </Select>
            </Field>
            <ErrorBox error={scan.error} />
            <Button disabled={!enabled("network_scan") || (!targets && !allowed[0]) || scan.isPending} onClick={() => scan.mutate()}>
              <Radar size={15} /> {t("ast.spustitSken")}
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("ast.importCsv")} subtitle={t("ast.hromadneNahraniZExceluJineho")} action={<FileUp className="text-brand-600" size={20} />} />
          <div className="space-y-3 p-5 text-sm">
            <p className="text-xs text-slate-500">
              {t("ast.sloupce")} <code>{t("ast.name")}</code> {t("ast.povinny")} <code>{t("ast.type")}</code>, <code>{t("ast.hostname2")}</code>, <code>{t("ast.ip")}</code>, <code>{t("ast.mac")}</code>, <code>{t("ast.os")}</code>,{" "}
              <code>{t("ast.serial")}</code>, <code>{t("ast.owner")}</code>, <code>{t("ast.criticality")}</code>, <code>{t("ast.location")}</code>, <code>{t("ast.tags")}</code>{t("ast.viceHodnotOddelte")}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importCsv.mutate(file);
                e.target.value = "";
              }}
            />
            <ErrorBox error={importCsv.error} />
            {importCsv.data && <RunSummary run={importCsv.data} />}
            <Button variant="secondary" disabled={importCsv.isPending || !can("discovery:run")} onClick={() => fileRef.current?.click()}>
              <FileUp size={15} /> {t("ast.vybratSoubor")}
            </Button>
          </div>
        </Card>
      </div>

      <NetSegmentsSection />

      <Card>
        <CardHeader title={t("ast.historieBehu")} />
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("ast.konektor")}</th>
              <th className="px-4 py-3">{t("ast.stav")}</th>
              <th className="px-4 py-3">{t("ast.spusteno")}</th>
              <th className="px-4 py-3">{t("ast.vysledek")}</th>
              <th className="px-4 py-3">{t("ast.chybaLog")}</th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top">
                <td className="px-4 py-3 font-medium">{t.lbl(connectorLabel[r.connector]) ?? r.connector}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone[r.status]}>{t.lbl(statusLabel[r.status]) ?? r.status}</Badge>
                </td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(r.startedAt)}</td>
                <td className="px-4 py-3">
                  <RunSummary run={r} />
                </td>
                <td className="max-w-md px-4 py-3 text-xs text-slate-500">
                  {r.error && <div className="text-red-600">{r.error}</div>}
                  {r.log?.length > 0 && (
                    <details>
                      <summary className="cursor-pointer">{t("ast.log", { length: r.log.length })}</summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{r.log.join("\n")}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
            {!runs.data?.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {t("ast.zatimZadneBehy")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function ConnectorStatus({ text, ok, canSetup }: { text?: string; ok: boolean; canSetup: boolean }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className={ok ? "text-emerald-700" : "text-slate-500"}>{text}</span>
      {canSetup && (
        <Link to="/admin/connectors" className="shrink-0 font-medium text-brand-600 hover:underline">
          {ok ? t("ast.nastaveni") : t("ast.nastavit")}
        </Link>
      )}
    </div>
  );
}

const RunSummary = ({ run }: { run: DiscoveryRunDto }) => (
  <span className="text-xs text-slate-600">
    {tt("ast.nalezenoNovychAktualizovano", { d: run.stats.discovered ?? 0, c: run.stats.created ?? 0, u: run.stats.updated ?? 0 })}
    {!!run.stats.conflicts && <span className="text-amber-700"> · {tt("ast.konfliktu", { n: run.stats.conflicts })}</span>}
  </span>
);
