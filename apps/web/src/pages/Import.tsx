import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, PageHeader, Select, SuccessBox, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { IMPORT_ENTITY_LABELS, IMPORT_FIELDS, type ImportEntity, type ImportMode, type ImportPreviewDto, type ImportPreviewRow, type ImportResultDto } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useState } from "react";

const ACTION: Record<ImportPreviewRow["action"], { label: string; tone: Tone }> = {
  create: { label: "nový", tone: "green" },
  update: { label: "aktualizace", tone: "blue" },
  skip: { label: "přeskočen", tone: "slate" },
};

/** Import reálných dat z Excelu / CSV: soubor → mapování sloupců → náhled s kontrolou → zápis. */
export function ImportPage() {
  const t = useT();
  const entities = useQuery({ queryKey: ["import", "entities"], queryFn: api.import.entities });
  const [entity, setEntity] = useState<ImportEntity | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [sheet, setSheet] = useState<string>("");
  const [mapping, setMapping] = useState<(string | null)[] | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const ent = (entity || entities.data?.[0]) as ImportEntity | undefined;

  const form = (withMapping: boolean) => {
    const fd = new FormData();
    fd.set("entity", ent!);
    fd.set("file", file!);
    fd.set("mode", mode);
    if (sheet) fd.set("sheet", sheet);
    if (withMapping && mapping) fd.set("mapping", JSON.stringify(mapping));
    return fd;
  };
  const preview = useMutation({
    mutationFn: (withMapping: boolean) => api.import.preview(form(withMapping)),
    onSuccess: (d) => {
      setMapping(d.mapping);
      setSheet(d.sheet ?? "");
      setResult(null);
    },
  });
  const commit = useMutation({ mutationFn: () => api.import.commit(form(true)), onSuccess: setResult });
  const p: ImportPreviewDto | undefined = preview.data;
  const reset = () => {
    preview.reset();
    setMapping(null);
    setSheet("");
    setResult(null);
  };
  const fields = ent ? IMPORT_FIELDS[ent] : [];
  const dirty = !!p && JSON.stringify(mapping) !== JSON.stringify(p.mapping);
  const missingRequired = fields.filter((f) => f.required && !(mapping ?? []).includes(f.key));
  const rows = (p?.rows ?? []).filter((r) => !onlyIssues || r.errors.length || r.warnings.length);
  const writable = p ? p.counts.create + p.counts.update : 0;

  if (entities.data && !entities.data.length) return <EmptyState>{t("imp.nemateOpravneniZapisovatDoZadne")}</EmptyState>;

  return (
    <>
      <PageHeader title={t("imp.importDat")} subtitle={t("imp.hromadneZalozeniNeboAktualizaceZaznamu")} />
      <Card className="mb-6">
        <CardHeader title={t("imp.1Soubor")} />
        <div className="grid gap-4 p-5 md:grid-cols-[14rem_1fr_14rem]">
          <Field label={t("imp.evidence")}>
            <Select
              value={ent ?? ""}
              onChange={(e) => {
                setEntity(e.target.value as ImportEntity);
                reset();
              }}
            >
              {(entities.data ?? []).map((e) => (
                <option key={e} value={e}>
                  {t.lbl(IMPORT_ENTITY_LABELS[e])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("imp.souborXlsxCsv")}>
            <input
              type="file"
              accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                reset();
              }}
            />
          </Field>
          <Field label={t("imp.existujiciZaznamy")}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as ImportMode)}>
              <option value="upsert">{t("imp.aktualizovatVyplnenymiSloupci")}</option>
              <option value="create_only">{t("imp.ponechatBezeZmeny")}</option>
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-3 md:col-span-3">
            <Button disabled={!file || !ent || preview.isPending} onClick={() => preview.mutate(false)}>
              <Upload size={15} /> {t("imp.nacistNahled")}
            </Button>
            {ent && (
              <a href={api.import.templateUrl(ent)} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
                <Download size={14} /> {t("imp.sablonaX", { p: t.lbl(IMPORT_ENTITY_LABELS[ent]).toLowerCase() })}
              </a>
            )}
            <span className="text-xs text-slate-500">
              {t("imp.parovaniNaExistujiciZaznamy")} {ent === "assets" ? t("imp.serioveCisloHostnameNazev") : ent === "suppliers" ? t("imp.icoNazev") : t("imp.kodNazev")}{t("imp.vlastnikaZadejteNazvemFunkcnihoMista")}
            </span>
          </div>
          <div className="md:col-span-3">
            <ErrorBox error={preview.error} />
          </div>
        </div>
      </Card>

      {p && (
        <>
          <Card className="mb-6 overflow-hidden">
            <CardHeader
              title={t("imp.2MapovaniSloupcu")}
              subtitle={t("imp.radkuZListu", { n: p.total, sheet: p.sheet ? t("imp.zListu", { p: p.sheet }) : "" })}
              action={
                p.sheets.length > 1 && (
                  <Select
                    className="w-56"
                    value={sheet}
                    onChange={(e) => {
                      setSheet(e.target.value);
                      setMapping(null);
                    }}
                  >
                    {p.sheets.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                )
              }
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2">{t("imp.sloupecVSouboru")}</th>
                    <th className="px-3 py-2">{t("imp.ukazka")}</th>
                    <th className="px-3 py-2">{t("imp.poleVContixu")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {p.headers.map((h, i) => (
                    <tr key={i}>
                      <td className="px-5 py-2 font-medium">{h || <span className="text-slate-400">{t("imp.bezNazvu")}</span>}</td>
                      <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500">{p.samples.map((r) => r[i]).filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-2">
                        <Select className="w-72" value={mapping?.[i] ?? ""} onChange={(e) => setMapping((m) => (m ?? p.mapping).map((x, j) => (j === i ? e.target.value || null : x === e.target.value ? null : x)))}>
                          <option value="">{t("imp.nepouzit")}</option>
                          {fields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                              {f.required ? " *" : ""}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
              {missingRequired.length > 0 && <span className="text-sm text-red-700">{t("imp.chybiPovinne", { p: missingRequired.map((f) => f.label).join(", ") })}</span>}
              {(dirty || sheet !== (p.sheet ?? "")) && (
                <Button variant="secondary" disabled={preview.isPending} onClick={() => preview.mutate(sheet === (p.sheet ?? ""))}>
                  {t("imp.prepocitatNahled")}
                </Button>
              )}
            </div>
          </Card>

          <Card className="mb-6 overflow-hidden">
            <CardHeader
              title={t("imp.3NahledAKontrola")}
              subtitle={t("imp.radkySChybouSeNeimportuji")}
              action={
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> {t("imp.jenRadkySProblemem")}
                </label>
              }
            />
            <div className="flex flex-wrap gap-2 px-5 pb-3">
              <Badge tone="green">{t("imp.nove", { create: p.counts.create })}</Badge>
              <Badge tone="blue">{t("imp.aktualizace", { update: p.counts.update })}</Badge>
              <Badge tone="slate">{t("imp.preskoceno", { skip: p.counts.skip })}</Badge>
              <Badge tone={p.counts.errors ? "red" : "slate"}>{t("imp.sChybou", { errors: p.counts.errors })}</Badge>
            </div>
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-2">{t("imp.radek")}</th>
                    <th className="px-3 py-2">{t("imp.zaznam")}</th>
                    <th className="px-3 py-2">{t("imp.akce")}</th>
                    <th className="px-3 py-2">{t("imp.kontrola")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.row} className={r.errors.length ? "bg-red-50/50" : undefined}>
                      <td className="px-5 py-2 text-xs text-slate-500">{r.row}</td>
                      <td className="px-3 py-2">
                        {[r.data.code, r.data.name].filter(Boolean).join(" ") || <span className="text-slate-400">—</span>}
                        {r.matchLabel && r.action !== "create" && <div className="text-xs text-slate-500">↔ {r.matchLabel}</div>}
                      </td>
                      <td className="px-3 py-2">{r.errors.length ? <Badge tone="red">{t("imp.chyba")}</Badge> : <Badge tone={ACTION[r.action].tone}>{t.lbl(ACTION[r.action].label)}</Badge>}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.errors.map((e, i) => (
                          <div key={i} className="text-red-700">
                            {e}
                          </div>
                        ))}
                        {r.warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-1 text-amber-800">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                          </div>
                        ))}
                        {!r.errors.length && !r.warnings.length && <CheckCircle2 size={14} className="text-green-600" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {p.total > p.rows.length && <p className="px-5 py-2 text-xs text-slate-500">{t("imp.nahledZobrazujePrvnichRadkuImportuje", { length: p.rows.length, total: p.total })}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
              <Button disabled={!writable || dirty || missingRequired.length > 0 || commit.isPending} onClick={async () => (await askConfirm(t("imp.importovatZaznamuDoEvidence", { writable: writable, p: IMPORT_ENTITY_LABELS[p.entity].toLowerCase() }))) && commit.mutate()}>
                <FileSpreadsheet size={15} /> {commit.isPending ? "Importuji…" : t("imp.importovatZaznamu", { writable: writable })}
              </Button>
              {dirty && <span className="text-xs text-amber-800">{t("imp.mapovaniSeZmeniloNejdrivPrepocitejte")}</span>}
              <ErrorBox error={commit.error} />
            </div>
          </Card>
        </>
      )}

      {result && (
        <Card className="p-5">
          <SuccessBox>
            {t("imp.importDokoncenNove")} {result.created}{t("imp.aktualizovane")} {result.updated}{t("imp.preskocene")} {result.skipped}
            {result.failed.length ? t("imp.neuspesne", { length: result.failed.length }) : ""}.
          </SuccessBox>
          {result.failed.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-red-700">
              {result.failed.map((f) => (
                <li key={f.row}>
                  {t("imp.radek2", { row: f.row, error: f.error })}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">{t("imp.importJeZapsanVAuditnim")}</p>
        </Card>
      )}
    </>
  );
}
