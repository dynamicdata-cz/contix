/**
 * Hromadný import dokumentace (v0.32): ZIP s tabulkou metadat (CSV / XLSX) a soubory dokumentů →
 * náhled (role → funkční místa, chyby, soubory) → založení dokumentů s návrhem verze a souborem.
 */
import { useT } from "@/lib/i18n";
import { PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, SuccessBox } from "@/components/ui";
import { api } from "@/lib/api";
import { POLICY_LABELS, type DocImportPreviewDto, type DocImportResultDto } from "@contix/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileCheck2, FileX2, Upload } from "lucide-react";
import { useState } from "react";
import { FolderSelect } from "./Library";

export function ImportTab() {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DocImportPreviewDto | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [folderId, setFolderId] = useState<string | null>(null);
  const [foldersByType, setFoldersByType] = useState(true);
  const [ack, setAck] = useState(true);
  const [result, setResult] = useState<DocImportResultDto | null>(null);
  const options = () => ({ mapping, folderId, foldersByType, requireAcknowledgement: ack });

  const load = useMutation({
    mutationFn: () => api.policies.importDocs(file!, "preview"),
    onSuccess: (p) => {
      setPreview(p);
      setResult(null);
      setMapping(Object.fromEntries(p.roles.map((r) => [r.name, r.positionId])));
    },
  });
  const run = useMutation({
    mutationFn: () => api.policies.importDocs(file!, "commit", options()),
    onSuccess: (r) => {
      setResult(r);
      setPreview(null);
      qc.invalidateQueries({ queryKey: ["policies"] });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t("dms.hromadnyImportDokumentace")}
          subtitle={t("dms.zipArchivSTabulkouMetadat")}
        />
        <div className="flex flex-wrap items-end gap-3 p-5">
          <Field label={t("dms.zipArchiv")}>
            <Input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setResult(null);
              }}
            />
          </Field>
          <Button disabled={!file || load.isPending} onClick={() => load.mutate()}>
            <Upload size={16} /> {load.isPending ? t("common.loading") : t("dms.nacistNahled")}
          </Button>
        </div>
        <div className="px-5 pb-5 text-xs text-slate-500">
          {t("dms.souborDokumentuSeParujePodle")} <code>{t("dms.pol07PolitikaDocx")}</code>{t("dms.dokumentSeStejnymOznacenimKtery")}
        </div>
        <ErrorBox error={load.error ?? run.error} />
      </Card>

      {result && (
        <Card>
          <CardHeader title={t("dms.importDokoncen")} />
          <div className="space-y-3 p-5 text-sm">
            <SuccessBox>
              {t("dms.zalozenoDokumentuNahranoSouboruPropojeno", { length: result.created.length, files: result.files, linkedParents: result.linkedParents })}
            </SuccessBox>
            {result.skipped.length > 0 && (
              <div>
                <div className="mb-1 font-medium text-slate-700">{t("dms.preskocenoUpozorneni", { length: result.skipped.length })}</div>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      {t("dms.r", { line: s.line, p: s.code ?? "", reason: s.reason })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {result.created.slice(0, 200).map((d) => (
                <Link key={d.id} to="/policies/$policyId" params={{ policyId: d.id }} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:text-brand-700">
                  {d.code}
                </Link>
              ))}
            </div>
          </div>
        </Card>
      )}

      {preview && (
        <>
          <Card>
            <CardHeader title={t("dms.nahled")} subtitle={t("dms.tabulkaMetadat", { metadataFile: preview.metadataFile })} />
            <div className="flex flex-wrap gap-2 px-5 pt-4 text-sm">
              <Badge tone="slate">{t("dms.radku", { total: preview.summary.total })}</Badge>
              <Badge tone="green">{t("dms.zaloziSe", { create: preview.summary.create })}</Badge>
              {preview.summary.skip > 0 && <Badge tone="blue">{t("dms.existuje", { skip: preview.summary.skip })}</Badge>}
              {preview.summary.errors > 0 && <Badge tone="red">{t("dms.chyby", { errors: preview.summary.errors })}</Badge>}
              {preview.summary.withoutFile > 0 && <Badge tone="amber">{t("dms.bezSouboru", { withoutFile: preview.summary.withoutFile })}</Badge>}
            </div>
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">{t("dms.roleFunkcniMista")}</div>
                <p className="mb-2 text-xs text-slate-500">{t("dms.navrzenoPodleShodyNazvuNeurcene")}</p>
                <div className="space-y-2">
                  {preview.roles.map((r) => (
                    <div key={r.name} className="grid grid-cols-[1fr_16rem] items-center gap-2 text-sm">
                      <span>
                        {r.name} <span className="text-xs text-slate-400">({r.count}×)</span>
                      </span>
                      <PositionSelect value={mapping[r.name] ?? null} onChange={(v) => setMapping((m) => ({ ...m, [r.name]: v }))} emptyLabel={t("dms.neprirazovat")} />
                    </div>
                  ))}
                  {preview.roles.length === 0 && <span className="text-sm text-slate-400">{t("dms.tabulkaNeobsahujeRole")}</span>}
                </div>
              </div>
              <div className="space-y-3">
                <Field label={t("dms.cilovaSlozka")}>
                  <FolderSelect value={folderId} onChange={setFolderId} />
                </Field>
                <Checkbox checked={foldersByType} onChange={setFoldersByType} label={t("dms.zalozitPodslozkyPodleDruhuDokumentu")} />
                <Checkbox checked={ack} onChange={setAck} label={t("dms.vyzadovatProkazatelneSeznameniKromeZazna")} />
                <Button disabled={!preview.summary.create || run.isPending} onClick={() => run.mutate()}>
                  {run.isPending ? "Importuji…" : t("dms.importovatDokumentu", { create: preview.summary.create })}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">{t("dms.radekZkr")}</th>
                    <th className="px-3 py-2">{t("dms.oznaceniNazev")}</th>
                    <th className="px-3 py-2">{t("dms.druh")}</th>
                    <th className="px-3 py-2">{t("dms.oddilyPozadavky")}</th>
                    <th className="px-3 py-2">{t("dms.soubor")}</th>
                    <th className="px-3 py-2">{t("dms.stav")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-1.5 text-xs text-slate-400">{r.line}</td>
                      <td className="px-3 py-1.5">
                        <span className="mr-1.5 text-slate-500">{r.code}</span>
                        {r.title}
                        {r.parentCode && <div className="text-xs text-slate-400">{t("dms.pod", { parentCode: r.parentCode })}</div>}
                        {[...r.errors, ...r.warnings].map((m) => (
                          <div key={m} className={r.errors.includes(m) ? "text-xs text-red-700" : "text-xs text-amber-700"}>
                            {m}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {r.docType ? t.lbl(POLICY_LABELS.type[r.docType]) : "—"}
                        {r.system !== "isms" && <div className="text-slate-400">{t.lbl(POLICY_LABELS.system[r.system])}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {r.sections.join(", ")}
                        {r.requirementIds.length > 0 && <div className="text-slate-400">{t("dms.pozadavku", { length: r.requirementIds.length })}</div>}
                      </td>
                      <td className="px-3 py-1.5" title={r.file ?? ""}>
                        {r.file ? <FileCheck2 size={16} className="text-emerald-600" aria-label={t("dms.souborNalezen")} /> : <FileX2 size={16} className="text-amber-600" aria-label={t("dms.bezSouboru2")} />}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.errors.length ? <Badge tone="red">{t("dms.chyba")}</Badge> : r.exists ? <Badge tone="blue">{t("dms.existuje2")}</Badge> : <Badge tone="green">{t("dms.novy")}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.unusedFiles.length > 0 && (
              <details className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
                <summary>{t("dms.souboryVArchivuBezRadku", { length: preview.unusedFiles.length })}</summary>
                <ul className="mt-1 max-h-40 overflow-y-auto">
                  {preview.unusedFiles.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
