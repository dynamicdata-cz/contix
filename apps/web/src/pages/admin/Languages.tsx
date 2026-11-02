import { askConfirm } from "@/components/ui/overlay";
/**
 * Administrace → Jazyky (ADR-036): přehled jazykových balíčků, výchozí jazyk organizace,
 * export šablony pro překladatele (CSV / JSON) a nahrání vlastního balíčku bez nové verze aplikace.
 */
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Select, SuccessBox } from "@/components/ui";
import { api } from "@/lib/api";
import { useRefreshMe } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { LOCALE_RE } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";

export function AdminLanguagesPage() {
  const t = useT();
  const qc = useQueryClient();
  const refreshMe = useRefreshMe();
  const list = useQuery({ queryKey: ["i18n", "list"], queryFn: api.i18n.list });
  const done = () => {
    qc.invalidateQueries({ queryKey: ["i18n"] });
    refreshMe();
  };
  const setDefault = useMutation({ mutationFn: (l: string) => api.admin.updateSettings({ defaultLocale: l }), onSuccess: done });
  const remove = useMutation({ mutationFn: (l: string) => api.i18n.remove(l), onSuccess: done });
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ locale: "", name: "", nativeName: "", fallback: "en" });
  const upload = useMutation({
    mutationFn: () => api.i18n.upload(file!, file!.name.toLowerCase().endsWith(".json") ? {} : meta),
    onSuccess: () => (setFile(null), done()),
  });
  const [newCode, setNewCode] = useState("");
  const isJson = !!file && file.name.toLowerCase().endsWith(".json");
  const metaOk = isJson || (LOCALE_RE.test(meta.locale) && meta.name.trim() && meta.nativeName.trim());

  return (
    <div className="space-y-6">
      <ErrorBox error={setDefault.error ?? remove.error} />
      <Card className="overflow-hidden">
        <CardHeader title={t("adm.lang.title")} subtitle={t("adm.lang.subtitle")} />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5">{t("adm.lang.col.language")}</th>
              <th className="px-3 py-2.5">{t("adm.lang.col.code")}</th>
              <th className="px-3 py-2.5">{t("adm.lang.col.translated")}</th>
              <th className="px-3 py-2.5">{t("adm.lang.col.source")}</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(list.data?.locales ?? []).map((l) => (
              <tr key={l.locale}>
                <td className="px-5 py-3">
                  <div className="font-medium">{l.nativeName}</div>
                  <div className="text-xs text-slate-500">
                    {t.dyn(`lang.name.${l.locale}`, l.name)}
                    {l.fallback ? ` · ${t("adm.lang.fallback", { code: l.fallback })}` : ""}
                  </div>
                </td>
                <td className="px-3 py-3 font-mono text-xs">{l.locale}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-brand-500" style={{ width: `${l.completeness}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-slate-600">{l.completeness} %</span>
                  </div>
                  {l.helpTopics > 0 && <div className="mt-0.5 text-xs text-slate-500">{t("adm.lang.helpTopics", { n: l.helpTopics })}</div>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {l.builtin && <Badge tone="slate">{t("adm.lang.builtin")}</Badge>}
                    {l.custom && <Badge tone="violet">{t("adm.lang.uploaded")}</Badge>}
                    {list.data?.defaultLocale === l.locale && <Badge tone="green">{t("adm.lang.default")}</Badge>}
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    {list.data?.defaultLocale !== l.locale && (
                      <Button variant="ghost" className="px-2 py-1 text-xs" disabled={setDefault.isPending} onClick={() => setDefault.mutate(l.locale)}>
                        {t("adm.lang.makeDefault")}
                      </Button>
                    )}
                    <a href={api.i18n.exportUrl(l.locale, "csv")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" title={t("adm.lang.exportCsv")}>
                      <Download size={13} /> {t("set.csv")}
                    </a>
                    <a href={api.i18n.exportUrl(l.locale, "json")} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" title={t("adm.lang.exportJson")}>
                      <Download size={13} /> {t("set.json")}
                    </a>
                    {l.custom && (
                      <Button variant="ghost" className="px-1.5 py-1 text-red-600" onClick={async () => (await askConfirm(t("adm.lang.deleteConfirm", { name: l.nativeName }))) && remove.mutate(l.locale)} aria-label={t("adm.lang.delete")}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("adm.lang.newTitle")} subtitle={t("adm.lang.newSub")} />
          <div className="space-y-3 p-5 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-slate-600">
              <li>{t("adm.lang.step1")}</li>
              <li>{t("adm.lang.step2")}</li>
              <li>{t("adm.lang.step3")}</li>
            </ol>
            <div className="flex items-end gap-2">
              <Field label={t("adm.lang.code")} hint={t("adm.lang.codeHint")} className="flex-1">
                <Input value={newCode} onChange={(e) => setNewCode(e.target.value.trim())} placeholder={t("set.deUkSrLatn")} />
              </Field>
              <a
                href={LOCALE_RE.test(newCode) ? api.i18n.exportUrl(newCode, "csv") : undefined}
                aria-disabled={!LOCALE_RE.test(newCode)}
                className={`mb-[22px] inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-sm font-medium shadow-sm ${LOCALE_RE.test(newCode) ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50" : "pointer-events-none border-slate-200 text-slate-400"}`}
              >
                <Download size={15} /> {t("adm.lang.template")}
              </a>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title={t("adm.lang.uploadTitle")} subtitle={t("adm.lang.uploadSub")} />
          <div className="space-y-3 p-5">
            <ErrorBox error={upload.error} />
            {upload.data && (
              <SuccessBox>
                {t("adm.lang.uploaded.ok", { locale: upload.data.locale, n: upload.data.messages, pct: upload.data.completeness })}
                {upload.data.ignored > 0 && ` ${t("adm.lang.uploaded.ignored", { n: upload.data.ignored })}`}
              </SuccessBox>
            )}
            <Field label={t("adm.lang.file")}>
              <Input type="file" accept=".json,.csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            {file && !isJson && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("adm.lang.code")}>
                  <Input value={meta.locale} onChange={(e) => setMeta({ ...meta, locale: e.target.value.trim() })} placeholder={t("set.de")} />
                </Field>
                <Field label={t("adm.lang.fallbackLabel")}>
                  <Select value={meta.fallback} onChange={(e) => setMeta({ ...meta, fallback: e.target.value })}>
                    {(list.data?.locales ?? []).map((l) => (
                      <option key={l.locale} value={l.locale}>
                        {l.nativeName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("adm.lang.nativeName")}>
                  <Input value={meta.nativeName} onChange={(e) => setMeta({ ...meta, nativeName: e.target.value })} placeholder={t("set.deutsch")} />
                </Field>
                <Field label={t("adm.lang.adminName")}>
                  <Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} placeholder={t("set.nemcina")} />
                </Field>
              </div>
            )}
            <Button disabled={!file || !metaOk || upload.isPending} onClick={() => upload.mutate()}>
              <Upload size={15} /> {t("adm.lang.upload")}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
