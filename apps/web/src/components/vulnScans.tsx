import { useT } from "@/lib/i18n";
import { AiSuggestPanel } from "@/components/ai";
import { SeverityBadge } from "@/components/health";
import { AssetPicker, type PickedAsset } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select } from "@/components/ui";
import { VulnTable } from "@/components/VulnTable";
import { CiImportHint } from "@/components/vulnMetrics";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { fmtDate } from "@/lib/utils";
import { SEVERITIES, VULN_LABELS, VULN_SCAN_LABELS, VULN_SCANNERS, type VulnScanDto, type VulnScanner, type VulnScanPreviewDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Upload, X } from "lucide-react";
import { useState } from "react";

/** Importy výstupů skenerů (ADR-095): seznam, nový import s náhledem, detail importu s triáží. */
export function ScansCard() {
  const t = useT();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const scans = useQuery({ queryKey: ["vuln-scans"], queryFn: api.vulns.scans });
  const current = scans.data?.find((s) => s.id === selected) ?? null;
  return (
    <>
      <Card className="mb-6">
        <CardHeader
          title={t("vs.title")}
          subtitle={t("vs.subtitle")}
          action={
            can("assets:write") && (
              <Button onClick={() => setOpen(true)}>
                <Upload size={15} /> {t("vs.import")}
              </Button>
            )
          }
        />
        <ErrorBox error={scans.error} />
        {scans.data && scans.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">{t("vs.colImported")}</th>
                  <th className="px-4 py-2">{t("vs.colName")}</th>
                  <th className="px-4 py-2">{t("vs.colScanner")}</th>
                  <th className="px-4 py-2 text-right">{t("vs.colNew")}</th>
                  <th className="px-4 py-2 text-right">{t("vs.colReopened")}</th>
                  <th className="px-4 py-2 text-right">{t("vs.colClosed")}</th>
                  <th className="px-4 py-2 text-right">{t("vs.colDuplicates")}</th>
                  <th className="px-4 py-2 text-right">{t("vs.colOpen")}</th>
                  <th className="px-4 py-2">{t("vs.colUnmatched")}</th>
                </tr>
              </thead>
              <tbody>
                {scans.data.slice(0, 15).map((s) => (
                  <tr key={s.id} className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selected === s.id ? "bg-brand-50/50" : ""}`} onClick={() => setSelected(selected === s.id ? null : s.id)}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtDate(s.importedAt)}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium text-brand-700">{s.name || s.fileName}</div>
                      <div className="text-xs text-slate-500">
                        {[s.assetName, s.external ? t("vs.externalShort") : null, s.importedByName].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{t.lbl(VULN_SCAN_LABELS.scanner[s.scanner])}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.stats.created ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.stats.reopened ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{s.stats.closed ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{s.stats.duplicates ?? 0}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{s.open}</td>
                    <td className="px-4 py-2 text-xs text-amber-700">{s.unmatchedHosts.length ? t("vs.unmatchedN", { n: s.unmatchedHosts.length }) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          scans.data && <EmptyState>{t("vs.empty")}</EmptyState>
        )}
        {can("assets:write") && <CiImportHint />}
      </Card>
      {current && <ScanDetail scan={current} onClose={() => setSelected(null)} />}
      {open && (
        <ScanImportModal
          onClose={(id) => {
            setOpen(false);
            if (id) setSelected(id);
          }}
        />
      )}
    </>
  );
}

function ScanDetail({ scan, onClose }: { scan: VulnScanDto; onClose: () => void }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  return (
    <Card className="mb-6" id="vuln-scan-detail">
      <CardHeader
        title={t("vs.detailTitle", { name: scan.name || scan.fileName })}
        subtitle={t("vs.detailSubtitle", { scanner: t.lbl(VULN_SCAN_LABELS.scanner[scan.scanner]), date: fmtDate(scan.importedAt), n: scan.stats.findings ?? 0 })}
        action={
          <Button variant="ghost" onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </Button>
        }
      />
      {scan.unmatchedHosts.length > 0 && (
        <div className="border-b border-slate-100 px-5 py-3 text-sm text-amber-800">
          {t("vs.unmatchedHint")} <span className="font-mono text-xs">{scan.unmatchedHosts.slice(0, 15).join(", ")}</span>
          {scan.unmatchedHosts.length > 15 && " …"}{" "}
          <Link to="/discovery" className="text-brand-700 hover:underline">
            {t("vs.toDiscovery")}
          </Link>
        </div>
      )}
      <div className="border-b border-slate-100 p-4">
        <AiSuggestPanel
          useCase="vuln_scan_triage"
          entityId={scan.id}
          canApply={can("assets:write")}
          onApplied={() => {
            for (const k of ["vulns", "vuln-scans", "vuln-summary", "assets"]) qc.invalidateQueries({ queryKey: [k] });
          }}
        />
      </div>
      <VulnTable key={scan.id} scanId={scan.id} />
    </Card>
  );
}

function ScanImportModal({ onClose }: { onClose: (createdId?: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [scanner, setScanner] = useState<VulnScanner | "">("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState<PickedAsset[]>([]);
  const [closeMissing, setCloseMissing] = useState(true);
  const [external, setExternal] = useState(false);
  const [includeInfo, setIncludeInfo] = useState(false);
  const [preview, setPreview] = useState<VulnScanPreviewDto | null>(null);
  const opts = (mode: "preview" | "commit") => ({ mode, scanner: scanner || undefined, name: name.trim() || undefined, assetId: target[0]?.id, closeMissing, external, includeInfo });
  const run = useMutation({
    mutationFn: (mode: "preview" | "commit") => api.vulns.importScan(file!, opts(mode)),
    onSuccess: (r, mode) => {
      if (mode === "preview") {
        setPreview(r as VulnScanPreviewDto);
        if (!scanner) setScanner((r as VulnScanPreviewDto).scanner);
        return;
      }
      for (const k of ["vulns", "vuln-scans", "vuln-summary", "assets", "asset"]) qc.invalidateQueries({ queryKey: [k] });
      onClose((r as VulnScanDto).id);
    },
  });
  const changed = () => setPreview(null);
  const matched = preview ? preview.hosts.filter((h) => h.assetId).reduce((a, h) => a + h.findings, 0) : 0;
  return (
    <Modal
      open
      wide
      onClose={() => onClose()}
      title={t("vs.importTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()}>
            {t("common.cancelAction")}
          </Button>
          {!preview ? (
            <Button disabled={!file || run.isPending} onClick={() => run.mutate("preview")}>
              {t("vs.previewBtn")}
            </Button>
          ) : (
            <Button disabled={run.isPending || matched === 0} onClick={() => run.mutate("commit")}>
              {t("vs.commitBtn", { n: matched })}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("vs.importHint")}</p>
      <Field label={t("vs.file")} hint={t("vs.fileHint")}>
        <Input
          type="file"
          accept=".nessus,.xml,.json,.jsonl,.sarif,.csv,.gz"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            changed();
          }}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("vs.colScanner")}>
          <Select
            value={scanner}
            onChange={(e) => {
              setScanner(e.target.value as VulnScanner | "");
              changed();
            }}
          >
            <option value="">{t("vs.autodetect")}</option>
            {VULN_SCANNERS.filter((x) => x !== "defectdojo").map((x) => (
              <option key={x} value={x}>
                {t.lbl(VULN_SCAN_LABELS.scanner[x])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("vs.colName")} hint={t("vs.nameHint")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label={t("vs.target")} hint={t("vs.targetHint")}>
        <AssetPicker
          value={target}
          onChange={(v) => {
            setTarget(v.slice(-1));
            changed();
          }}
        />
      </Field>
      <div className="space-y-2">
        <Checkbox checked={closeMissing} onChange={setCloseMissing} label={t("vs.closeMissing")} hint={t("vs.closeMissingHint")} />
        <Checkbox checked={external} onChange={setExternal} label={t("vs.external")} hint={t("vs.externalHint")} />
        <Checkbox
          checked={includeInfo}
          onChange={(v) => {
            setIncludeInfo(v);
            changed();
          }}
          label={t("vs.includeInfo")}
        />
      </div>
      {preview && (
        <div className="mt-4 space-y-3 rounded-md border border-slate-200 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="violet">{t.lbl(VULN_SCAN_LABELS.scanner[preview.scanner])}</Badge>
            <span>{t("vs.previewCounts", { n: preview.findings, info: preview.skippedInfo, matched })}</span>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {SEVERITIES.filter((s) => preview.bySeverity[s]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <SeverityBadge severity={s} /> {preview.bySeverity[s]}
              </span>
            ))}
          </div>
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">{t("vs.host")}</th>
                <th className="py-1 text-right">{t("vs.findings")}</th>
                <th className="py-1">{t("ast.aktivum")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.hosts.slice(0, 30).map((h) => (
                <tr key={`${h.host}|${h.ip}`} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{[h.host, h.ip && h.ip !== h.host ? h.ip : null].filter(Boolean).join(" / ") || "—"}</td>
                  <td className="py-1 text-right tabular-nums">{h.findings}</td>
                  <td className="py-1">{h.assetName ?? <span className="text-amber-700">{t("vs.noAsset")}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.sample.length > 0 && (
            <ul className="space-y-0.5 text-xs text-slate-600">
              {preview.sample.slice(0, 8).map((f, i) => (
                <li key={i}>
                  <span className="font-medium">{t.lbl(VULN_LABELS.severity[f.severity])}</span> · {f.title}
                  {f.cves.length > 0 && <span className="font-mono text-slate-400"> {f.cves.slice(0, 2).join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ErrorBox error={run.error} />
    </Modal>
  );
}
