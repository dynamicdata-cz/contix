/** Knihovna rámců (ADR-079): vestavěné a vlastní rámce podle země, import (CSV / XLSX / YAML / JSON / XML / OSCAL) a export. */
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { fmtDate } from "@/lib/utils";
import {
  FRAMEWORK_CSV_HEADERS,
  FRAMEWORK_EXPORT_FORMATS,
  FRAMEWORK_FILE_EXTENSIONS,
  FRAMEWORK_KIND_LABELS,
  FRAMEWORK_KINDS,
  FRAMEWORK_USE_LABELS,
  FRAMEWORK_USES,
  JURISDICTION_LABELS,
  type FrameworkImportPreview,
  type FrameworkKind,
  type FrameworkLibraryItem,
  type FrameworkUse,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, FileCheck2, FileUp, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

const JUR_ORDER = ["CZ", "EU", "INT"];

export function FrameworkLibraryPage() {
  const t = useT();
  const can = useCan();
  const lib = useQuery({ queryKey: ["frameworks", "library"], queryFn: api.frameworks.list });
  const scope = useQuery({ queryKey: ["controls", "frameworks"], queryFn: api.controls.frameworks, enabled: can("controls:read") });
  const [q, setQ] = useState("");
  const [jur, setJur] = useState("");
  const [kind, setKind] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<FrameworkLibraryItem | null>(null);
  const inScope = new Set((scope.data ?? []).filter((f) => f.inScope).map((f) => f.id));
  const items = (lib.data ?? []).filter(
    (f) => (!jur || f.jurisdiction === jur) && (!kind || f.kind === kind) && (!q || `${f.name} ${f.shortName} ${f.description}`.toLowerCase().includes(q.toLowerCase())),
  );
  const jurs = [...new Set((lib.data ?? []).map((f) => f.jurisdiction))].sort((a, b) => (JUR_ORDER.indexOf(a) + 1 || 99) - (JUR_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const groups = jurs.map((j) => ({ j, list: items.filter((f) => f.jurisdiction === j) })).filter((g) => g.list.length);
  const jurName = (j: string) => (JURISDICTION_LABELS[j] ? `${t.lbl(JURISDICTION_LABELS[j]!)} (${j})` : j);

  return (
    <>
      <PageHeader
        title={t("fwl.title")}
        subtitle={t("fwl.subtitle")}
        actions={
          can("admin:settings") && (
            <Button onClick={() => setImporting(true)}>
              <FileUp size={16} /> {t("fwl.import")}
            </Button>
          )
        }
      />
      <ErrorBox error={lib.error} />
      <Card className="mb-4 flex flex-wrap gap-3 p-4">
        <Input className="max-w-xs" placeholder={t("fwl.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="w-48" value={jur} onChange={(e) => setJur(e.target.value)} aria-label={t("fwl.jurisdiction")}>
          <option value="">{t("fwl.allJurisdictions")}</option>
          {jurs.map((j) => (
            <option key={j} value={j}>
              {jurName(j)}
            </option>
          ))}
        </Select>
        <Select className="w-52" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("fwl.kind")}>
          <option value="">{t("fwl.allKinds")}</option>
          {FRAMEWORK_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.lbl(FRAMEWORK_KIND_LABELS[k])}
            </option>
          ))}
        </Select>
      </Card>
      {lib.data && !groups.length && <EmptyState>{t("fwl.empty")}</EmptyState>}
      <div className="space-y-6" data-testid="framework-library">
        {groups.map((g) => (
          <Card key={g.j} className="overflow-hidden">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-sm font-semibold text-slate-700">{jurName(g.j)}</div>
            <div className="divide-y divide-slate-100">
              {g.list.map((f) => (
                <div key={f.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm" data-testid={`fw-${f.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{f.shortName}</span>
                      <span className="text-slate-600">{f.name}</span>
                      {f.custom && <Badge tone="violet">{t("fwl.custom")}</Badge>}
                      {inScope.has(f.id) && <Badge tone="green">{t("fwl.tracked")}</Badge>}
                    </div>
                    {f.description && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{f.description}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <Badge tone="blue">{t.lbl(FRAMEWORK_KIND_LABELS[f.kind])}</Badge>
                      {f.uses.map((u) => (
                        <Badge key={u}>{t.lbl(FRAMEWORK_USE_LABELS[u])}</Badge>
                      ))}
                      <span>{t("fwl.counts", { n: f.requirements, s: f.sections })}</span>
                      {f.version && <span>· {f.version}</span>}
                      {f.source && <span className="truncate">· {f.source}</span>}
                      {f.importedAt && <span>· {t("fwl.importedAt", { at: fmtDate(f.importedAt) })}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link to="/controls/soa" search={{ framework: f.id }}>
                      <Button variant="secondary" className="px-2.5 py-1.5 text-xs">
                        <FileCheck2 size={14} /> {t("fwl.open")}
                      </Button>
                    </Link>
                    <ExportMenu id={f.id} />
                    {f.custom && can("admin:settings") && (
                      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setDeleting(f)} aria-label={t("fwl.delete", { name: f.shortName })}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {deleting && <DeleteModal f={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function ExportMenu({ id }: { id: string }) {
  const t = useT();
  const [fmt, setFmt] = useState<(typeof FRAMEWORK_EXPORT_FORMATS)[number]>("yaml");
  return (
    <div className="flex items-center">
      <Select className="w-20 rounded-r-none py-1.5 text-xs" value={fmt} onChange={(e) => setFmt(e.target.value as typeof fmt)} aria-label={t("fwl.exportFormat")}>
        {FRAMEWORK_EXPORT_FORMATS.map((x) => (
          <option key={x} value={x}>
            {x.toUpperCase()}
          </option>
        ))}
      </Select>
      <a href={api.frameworks.exportUrl(id, fmt)} download>
        <Button variant="secondary" className="rounded-l-none border-l-0 px-2.5 py-1.5 text-xs" aria-label={t("fwl.export")}>
          <Download size={14} />
        </Button>
      </a>
    </div>
  );
}

const TEMPLATE = `﻿${FRAMEWORK_CSV_HEADERS.join(";")}\r\n§ 1.1;§ 1;Úvodné ustanovenia;Prevádzkovateľ zavedie a udržiava systém riadenia informačnej bezpečnosti.;;;nis2:21/1\r\n§ 1.2;§ 1;Úvodné ustanovenia;Prevádzkovateľ určí manažéra kybernetickej bezpečnosti.;;;\r\n`;

function ImportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [m, setM] = useState({ key: "", name: "", shortName: "", jurisdiction: "", kind: "law" as FrameworkKind, uses: ["gap", "audit"] as FrameworkUse[], version: "", language: "", source: "", description: "", fullText: true });
  const isTable = !!file && /\.(csv|xlsx)$/i.test(file.name);
  const meta = useMemo(() => {
    // u tabulky jsou metadata povinná; u balíčku jen přepíší vyplněné hodnoty
    const base: Record<string, unknown> = { key: m.key, name: m.name, shortName: m.shortName, jurisdiction: m.jurisdiction, version: m.version, language: m.language, source: m.source, description: m.description };
    return isTable ? { ...base, kind: m.kind, uses: m.uses, fullText: m.fullText } : base;
  }, [m, isTable]);
  const preview = useMutation({ mutationFn: () => api.frameworks.import(file!, meta, "preview") });
  const commit = useMutation({
    mutationFn: () => api.frameworks.import(file!, meta, "commit", replace),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["frameworks"] });
      qc.invalidateQueries({ queryKey: ["controls"] });
      onClose();
    },
  });
  const p: FrameworkImportPreview | undefined = preview.data;
  const set = <K extends keyof typeof m>(k: K, v: (typeof m)[K]) => {
    setM((x) => ({ ...x, [k]: v }));
    preview.reset();
  };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "contix-ramec-sablona.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t("fwl.import")}
      footer={
        <>
          <Button variant="secondary" className="mr-auto" onClick={downloadTemplate}>
            <Download size={14} /> {t("fwl.template")}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button variant="secondary" disabled={!file || preview.isPending} onClick={() => preview.mutate()}>
            {t("fwl.preview")}
          </Button>
          <Button disabled={!p?.ok || commit.isPending || (p.existing && !replace)} onClick={() => commit.mutate()}>
            <FileUp size={15} /> {t("fwl.doImport")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("fwl.importHint")}</p>
      <Field label={t("fwl.file")} hint={t("fwl.fileHint")}>
        <Input
          type="file"
          accept={FRAMEWORK_FILE_EXTENSIONS.join(",")}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            preview.reset();
          }}
        />
      </Field>
      {file && (
        <>
          <p className="text-xs text-slate-500">{isTable ? t("fwl.metaRequired") : t("fwl.metaOptional")}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("fwl.key")} hint={t("fwl.keyHint")}>
              <Input value={m.key} onChange={(e) => set("key", e.target.value.toLowerCase())} placeholder="sk-zkb" className="font-mono" />
            </Field>
            <Field label={t("fwl.shortName")}>
              <Input value={m.shortName} onChange={(e) => set("shortName", e.target.value)} placeholder="SK ZKB" />
            </Field>
            <Field label={t("fwl.jurisdiction")} hint={t("fwl.jurisdictionHint")}>
              <Input value={m.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value.toUpperCase())} placeholder="SK" maxLength={3} />
            </Field>
          </div>
          <Field label={t("fwl.name")}>
            <Input value={m.name} onChange={(e) => set("name", e.target.value)} placeholder="Zákon č. 69/2018 Z. z. o kybernetickej bezpečnosti" />
          </Field>
          {isTable && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("fwl.kind")}>
                <Select value={m.kind} onChange={(e) => set("kind", e.target.value as FrameworkKind)}>
                  {FRAMEWORK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(FRAMEWORK_KIND_LABELS[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("fwl.version")}>
                <Input value={m.version} onChange={(e) => set("version", e.target.value)} placeholder="2024" />
              </Field>
              <Field label={t("fwl.language")}>
                <Input value={m.language} onChange={(e) => set("language", e.target.value)} placeholder="sk" />
              </Field>
            </div>
          )}
          {isTable && (
            <>
              <div className="flex flex-wrap gap-4">
                <span className="text-sm font-medium text-slate-700">{t("fwl.uses")}</span>
                {FRAMEWORK_USES.map((u) => (
                  <Checkbox key={u} checked={m.uses.includes(u)} onChange={(on) => set("uses", on ? [...m.uses, u] : m.uses.filter((x) => x !== u))} label={t.lbl(FRAMEWORK_USE_LABELS[u])} />
                ))}
              </div>
              <Checkbox checked={m.fullText} onChange={(v) => set("fullText", v)} label={t("fwl.fullText")} hint={t("fwl.fullTextHint")} />
              <Field label={t("fwl.source")}>
                <Input value={m.source} onChange={(e) => set("source", e.target.value)} placeholder="Slov-Lex, znenie účinné od 1. 1. 2025" />
              </Field>
              <Field label={t("fwl.description")}>
                <Textarea rows={2} value={m.description} onChange={(e) => set("description", e.target.value)} />
              </Field>
            </>
          )}
        </>
      )}
      <ErrorBox error={preview.error ?? commit.error} />
      {p && (
        <div className={`space-y-2 rounded-md border px-3 py-3 text-sm ${p.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`} data-testid="fw-preview">
          {p.meta && (
            <div className="font-medium">
              {p.meta.shortName} – {p.meta.name} <span className="font-mono text-xs text-slate-500">({p.meta.id})</span>
            </div>
          )}
          {p.ok && <div>{t("fwl.previewCounts", { n: p.requirements, s: p.sections, m: p.mappings, format: p.format.toUpperCase() })}</div>}
          {p.errors.map((e, i) => (
            <div key={`e${i}`} className="text-red-800">
              {e.row ? t("fwl.row", { row: e.row }) : ""} {e.message}
            </div>
          ))}
          {p.warnings.map((w, i) => (
            <div key={`w${i}`} className="text-amber-800">
              {w.message}
            </div>
          ))}
          {p.replace && (
            <div className="rounded bg-white/60 px-2 py-1.5 text-xs">
              {t("fwl.replaceInfo", { added: p.replace.added, removed: p.replace.removed, kept: p.replace.kept })}
              {p.replace.removedAssessed > 0 && <b> {t("fwl.replaceAssessed", { n: p.replace.removedAssessed })}</b>}
            </div>
          )}
          {p.existing && p.ok && <Checkbox checked={replace} onChange={setReplace} label={t("fwl.replaceConfirm")} />}
          {!!p.sample.length && (
            <table className="mt-1 w-full text-xs">
              <tbody>
                {p.sample.map((r) => (
                  <tr key={r.id} className="border-t border-black/5 align-top">
                    <td className="py-1 pr-2 font-mono whitespace-nowrap">{r.ref}</td>
                    <td className="py-1 pr-2 text-slate-500 whitespace-nowrap">{r.section}</td>
                    <td className="py-1">{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}

function DeleteModal({ f, onClose }: { f: FrameworkLibraryItem; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [ok, setOk] = useState(false);
  const del = useMutation({
    mutationFn: () => api.frameworks.remove(f.id, f.assessed > 0),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["frameworks"] });
      qc.invalidateQueries({ queryKey: ["controls"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("fwl.delete", { name: f.shortName })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button variant="danger" disabled={del.isPending || (f.assessed > 0 && !ok)} onClick={() => del.mutate()}>
            <Trash2 size={14} /> {t("fwl.deleteBtn")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-700">{t("fwl.deleteText", { name: f.name })}</p>
      {f.assessed > 0 && <Checkbox checked={ok} onChange={setOk} label={t("fwl.deleteAssessed", { n: f.assessed })} />}
      <ErrorBox error={del.error} />
    </Modal>
  );
}
