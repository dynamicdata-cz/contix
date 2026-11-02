import { askConfirm } from "@/components/ui/overlay";
import { useT } from "@/lib/i18n";
import { RiskLevelBadge } from "@/components/risk";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { METHODOLOGY_FORMATS, type MethodologyDef, type MethodologyDto, type MethodologyFormat } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Download, FileUp, Plus, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";

const KIND = { risk: "Analýza rizik", audit: "Audit (kontrolní seznam)" } as const;
const FORMAT_LABEL: Record<MethodologyFormat, string> = { yaml: "YAML", json: "JSON", xml: "XML" };

/** Správa metodik: vestavěné (vyhláška, OCTAVE Allegro, 5×5, kontrolní seznamy dle 409/410) a importované balíčky. */
export function AdminMethodologiesPage() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["methodologies"], queryFn: api.methodologies.list });
  const [open, setOpen] = useState<string | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.methodologies.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["methodologies"] }) });
  const rows = list.data ?? [];
  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader
          title={t("meth.metodikyAnalyzyRizikAAuditu")}
          subtitle={t("meth.metodikuRizikVoliteVNastaveni")}
          action={
            <div className="flex gap-2">
              <Link to="/admin/methodologies/edit" search={{ kind: "risk" }}>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs">
                  <Plus size={14} /> {t("meth.metodikaRizik")}
                </Button>
              </Link>
              <Link to="/admin/methodologies/edit" search={{ kind: "audit" }}>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs">
                  <Plus size={14} /> {t("meth.kontrolniSeznam")}
                </Button>
              </Link>
            </div>
          }
        />
        <ErrorBox error={list.error ?? del.error} />
        {rows.length === 0 ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">{t("meth.metodika")}</th>
                <th className="px-3 py-2">{t("meth.druh")}</th>
                <th className="px-3 py-2">{t("meth.verze")}</th>
                <th className="px-3 py-2 text-right">{t("meth.pouziti")}</th>
                <th className="px-3 py-2">{t("meth.export")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => (
                <Fragment key={m.id}>
                  <tr className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <button className="flex items-start gap-1.5 text-left" onClick={() => setOpen(open === m.id ? null : m.id)} disabled={!m.definition}>
                        {m.definition ? open === m.id ? <ChevronDown size={15} className="mt-0.5 shrink-0" /> : <ChevronRight size={15} className="mt-0.5 shrink-0" /> : <span className="w-[15px]" />}
                        <span>
                          <span className="font-medium">{m.name}</span> {m.builtin ? <Badge>{t("meth.vestavena")}</Badge> : <Badge tone="blue">{t("meth.importovana")}</Badge>}
                          <span className="block text-xs text-slate-500">
                            {m.id}
                            {m.source ? ` · ${m.source}` : ""}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{t.lbl(KIND[m.kind])}</td>
                    <td className="px-3 py-2.5 text-slate-600">{m.version}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{m.usage}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {m.definition
                        ? METHODOLOGY_FORMATS.map((f) => (
                            <a key={f} href={api.methodologies.exportUrl(m.id, f)} className="mr-2 inline-flex items-center gap-0.5 text-xs text-brand-700 hover:underline">
                              <Download size={11} />
                              {FORMAT_LABEL[f]}
                            </a>
                          ))
                        : <span className="text-xs text-slate-400">{t("meth.nastaveniVAdministraci")}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {m.definition && (
                        <Link to="/admin/methodologies/edit" search={{ from: m.id }} className="mr-3 text-xs text-brand-700 hover:underline">
                          {m.builtin ? t("meth.upravitKopii") : "Upravit"}
                        </Link>
                      )}
                      {!m.builtin && (
                        <button
                          className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                          title={m.usage ? t("meth.metodikaSePouziva") : "Smazat"}
                          disabled={m.usage > 0}
                          onClick={async () => (await askConfirm(t("meth.smazatMetodiku", { name: m.name }))) && del.mutate(m.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === m.id && m.definition && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50 px-5 py-4">
                        <DefinitionSummary def={m.definition} description={m.description} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <ImportCard existing={rows} />
    </div>
  );
}

function DefinitionSummary({ def, description }: { def: MethodologyDef; description: string | null }) {
  const t = useT();
  if (def.kind === "audit") {
    const sections = [...new Set(def.checklist.map((i) => i.section).filter(Boolean))];
    return (
      <div className="space-y-2 text-sm">
        {description && <p className="text-slate-600">{description}</p>}
        <p>
          {t("meth.polozekKontrolnihoSeznamu")} <b>{def.checklist.length}</b>
          {sections.length > 0 && <> {t("meth.oddily")} {sections.slice(0, 20).join(", ")}{sections.length > 20 ? "…" : ""}</>}
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
          {def.checklist.slice(0, 5).map((i) => (
            <li key={i.id}>
              {i.ref && <span className="text-slate-400">{i.ref} </span>}
              {i.question}
            </li>
          ))}
          {def.checklist.length > 5 && <li className="list-none text-slate-400">…</li>}
        </ul>
      </div>
    );
  }
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <div className="space-y-2">
        {description && <p className="text-slate-600">{description}</p>}
        <p>
          {t("meth.skore")} <code className="rounded bg-white px-1">{def.formula}</code>
        </p>
        {def.areas?.length ? (
          <p>
            {t("meth.oblastiDopaduVaha")} {def.areas.map((a) => `${a.label} (${a.weight})`).join(", ")}
          </p>
        ) : null}
        <p>{t("meth.faktory")} {def.factors.map((f) => `${f.label}${f.perArea ? " po oblastech" : ""} (${f.scale.map((s) => s.value).join("/")})`).join("; ")}</p>
        {def.steps?.length ? (
          <ol className="list-decimal pl-5 text-slate-600">
            {def.steps.map((s) => (
              <li key={s.key}>{s.title}</li>
            ))}
          </ol>
        ) : null}
      </div>
      <table className="w-full self-start text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-1 pr-3">{t("meth.uroven2")}</th>
            <th className="py-1 pr-3">{t("meth.contix")}</th>
            <th className="py-1">{t("meth.zvladani2")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {def.levels.map((l) => (
            <tr key={l.key}>
              <td className="py-1.5 pr-3">
                {l.label}
                {l.acceptable && <span className="ml-1 text-xs text-green-700">{t("meth.akceptovatelne")}</span>}
              </td>
              <td className="py-1.5 pr-3">
                <RiskLevelBadge level={l.mapsTo} />
              </td>
              <td className="py-1.5 text-slate-600">{l.treatment}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const extFormat = (name: string): MethodologyFormat | null => {
  const e = name.toLowerCase().split(".").pop();
  return e === "yml" || e === "yaml" ? "yaml" : e === "json" ? "json" : e === "xml" ? "xml" : null;
};

function ImportCard({ existing }: { existing: MethodologyDto[] }) {
  const t = useT();
  const qc = useQueryClient();
  const [format, setFormat] = useState<MethodologyFormat>("yaml");
  const [content, setContent] = useState("");
  const [replace, setReplace] = useState(false);
  const validate = useMutation({ mutationFn: () => api.methodologies.validate({ format, content }) });
  const imp = useMutation({
    mutationFn: () => api.methodologies.import({ format, content, replace }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["methodologies"] });
      setContent("");
      validate.reset();
    },
  });
  const def = validate.data?.definition;
  const clash = def && existing.some((m) => m.id === def.id);
  return (
    <Card>
      <CardHeader title={t("meth.importMetodiky")} subtitle={t("meth.balicekVeFormatuYamlJson")} />
      <div className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label={t("meth.format")}>
            <Select value={format} onChange={(e) => setFormat(e.target.value as MethodologyFormat)}>
              {METHODOLOGY_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("meth.soubor")}>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <FileUp size={15} /> {t("meth.vybratSouborYamlYmlJson")}
              <input
                type="file"
                accept=".yaml,.yml,.json,.xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const f = extFormat(file.name);
                  if (f) setFormat(f);
                  setContent(await file.text());
                  validate.reset();
                  imp.reset();
                  e.target.value = "";
                }}
              />
            </label>
          </Field>
        </div>
        <Field label={t("meth.obsah")}>
          <Textarea
            rows={12}
            className="font-mono text-xs"
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              validate.reset();
            }}
            placeholder={"kind: risk\nid: moje_metodika\nname: …\nformula: dopad * pravdepodobnost\nfactors: …\nlevels: …"}
          />
        </Field>
        {validate.data && !validate.data.ok && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <div className="font-medium">{t("meth.metodikaNeniPlatna")}</div>
            <ul className="mt-1 list-disc pl-5">
              {validate.data.errors.slice(0, 30).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {def && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            {t("meth.platnaMetodika")} <b>{def.name}</b> ({def.id}, {t.lbl(KIND[def.kind])}) –{" "}
            {def.kind === "risk" ? t("meth.faktoruUrovni", { length: def.factors.length, length2: def.levels.length }) : t("meth.polozekKontrolnihoSeznamu2", { length: def.checklist.length })}.
            {clash && <div className="mt-1 text-amber-800">{t("meth.metodikaSeStejnymIdJiz")}</div>}
          </div>
        )}
        {imp.isSuccess && <SuccessBox>{t("meth.metodikaImportovana")}</SuccessBox>}
        <ErrorBox error={validate.error ?? imp.error} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!content.trim() || validate.isPending} onClick={() => validate.mutate()}>
            {t("meth.overit")}
          </Button>
          <Button disabled={!def || imp.isPending || (!!clash && !replace)} onClick={() => imp.mutate()}>
            {t("meth.importovat")}
          </Button>
          {clash && <Checkbox checked={replace} onChange={setReplace} label={t("meth.nahraditExistujiciStejneId")} />}
        </div>
      </div>
    </Card>
  );
}
