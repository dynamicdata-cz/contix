/** Nahlášení podezřelého e-mailu zaměstnancem (ADR-052) – volitelně s .eml; do SOC jdou jen hlavičky a odkazy. */
import { Button, Card, ErrorBox, Field, Input, PageHeader, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { PHISHING_EML_MAX_BYTES } from "@contix/shared";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fish, Send } from "lucide-react";
import { useState } from "react";

export function PhishingReportPage() {
  const t = useT();
  const can = useCan();
  const [file, setFile] = useState<File | null>(null);
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const tooBig = !!file && file.size > PHISHING_EML_MAX_BYTES;
  const m = useMutation({ mutationFn: () => api.soc.reportPhishing({ file, from, subject, note }) });
  const reset = () => (m.reset(), setFile(null), setFrom(""), setSubject(""), setNote(""));
  return (
    <>
      <PageHeader title={t("phish.title")} subtitle={t("phish.subtitle")} />
      {m.data ? (
        <div className="max-w-3xl space-y-3">
          <SuccessBox>{m.data.duplicate ? t("phish.thanksDuplicate") : t("phish.thanks")}</SuccessBox>
          <p className="text-sm text-slate-600">{t("phish.next")}</p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset}>
              {t("phish.another")}
            </Button>
            {can("soc:read") && (
              <Link to="/soc/$alertId" params={{ alertId: m.data.alertId }}>
                <Button variant="secondary">{t("phish.openAlert")}</Button>
              </Link>
            )}
          </div>
        </div>
      ) : (
        <Card className="max-w-3xl">
          <div className="space-y-4 p-5">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Fish size={16} className="mr-1 inline" /> {t("phish.dont")}
            </div>
            <Field label={t("phish.file")} hint={t("phish.fileHint")}>
              <input type="file" accept=".eml,message/rfc822" aria-label={t("phish.file")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            </Field>
            {tooBig && <p className="text-sm text-red-700">{t("phish.tooBig")}</p>}
            {!file && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("phish.from")}>
                  <Input value={from} maxLength={300} placeholder="podpora@banka-cz.top" onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label={t("phish.subject")}>
                  <Input value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label={t("phish.note")} hint={t("phish.noteHint")}>
              <Textarea rows={3} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <p className="text-xs text-slate-500">{t("phish.privacy")}</p>
            <ErrorBox error={m.error} />
            <div className="flex justify-end">
              <Button disabled={m.isPending || tooBig || (!file && !from.trim() && !subject.trim())} onClick={() => m.mutate()}>
                <Send size={15} /> {t("phish.send")}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}
