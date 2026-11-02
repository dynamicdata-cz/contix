import { useT } from "@/lib/i18n";
import { Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, SuccessBox } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDay } from "@/lib/utils";
import type { NotificationSettingsDto, NotificationSettingsInput } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

/** Nastavení upozornění na lhůty: SMTP, Microsoft Teams, denní souhrn. */
export function AdminNotificationsPage() {
  const q = useQuery({ queryKey: ["notifications", "settings"], queryFn: api.notifications.settings });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <Form key={q.data.lastRunAt ?? "x"} s={q.data} />;
}

function Form({ s }: { s: NotificationSettingsDto }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ ...s, smtpPassword: "", teamsWebhookUrl: "" });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [testTo, setTestTo] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const b: NotificationSettingsInput = {
        emailEnabled: f.emailEnabled,
        smtpHost: f.smtpHost || null,
        smtpPort: f.smtpPort,
        smtpSecure: f.smtpSecure,
        smtpUser: f.smtpUser || null,
        smtpFrom: f.smtpFrom || null,
        teamsEnabled: f.teamsEnabled,
        digestHour: f.digestHour,
        leadDays: f.leadDays,
        weekdaysOnly: f.weekdaysOnly,
        ...(f.smtpPassword ? { smtpPassword: f.smtpPassword } : {}),
        ...(f.teamsWebhookUrl ? { teamsWebhookUrl: f.teamsWebhookUrl } : {}),
      };
      return api.notifications.saveSettings(b);
    },
    onSuccess: (d) => qc.setQueryData(["notifications", "settings"], d),
  });
  const test = useMutation({ mutationFn: (ch: "email" | "teams") => api.notifications.test(ch, ch === "email" ? testTo : undefined) });
  const run = useMutation({ mutationFn: api.notifications.runNow, onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications", "settings"] }) });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={t("adt.upozorneniNaLhuty")}
          subtitle={t("adt.denniSouhrnPovinnostiBezpecnostnimuTymu")}
        />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <Field label={t("adt.hodinaDennihoSouhrnu")}>
            <Input type="number" min={0} max={23} value={f.digestHour} onChange={(e) => set("digestHour", Number(e.target.value))} />
          </Field>
          <Field label={t("adt.upozornovatDniPredem")}>
            <Input type="number" min={1} max={90} value={f.leadDays} onChange={(e) => set("leadDays", Number(e.target.value) || 14)} />
          </Field>
          <div className="pt-6">
            <Checkbox checked={f.weekdaysOnly} onChange={(v) => set("weekdaysOnly", v)} label={t("adt.souhrnJenVPracovniDny")} hint={t("adt.vystrahyIncidentuChodiVzdy")} />
          </div>
        </div>
        {s.lastRunAt && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            {t("adt.posledniBeh2", { p: fmtDay(s.lastRunAt), p2: new Date(s.lastRunAt).toLocaleTimeString("cs-CZ"), lastResult: s.lastResult })}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={t("adt.eMailSmtp")} />
        <div className="space-y-4 p-5">
          <Checkbox checked={f.emailEnabled} onChange={(v) => set("emailEnabled", v)} label={t("adt.posilatUpozorneniEMailem")} />
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem_auto]">
            <Field label={t("adt.smtpServer")}>
              <Input value={f.smtpHost ?? ""} onChange={(e) => set("smtpHost", e.target.value)} placeholder={t("adt.smtpOrganizaceCz")} />
            </Field>
            <Field label={t("adt.port")}>
              <Input type="number" value={f.smtpPort} onChange={(e) => set("smtpPort", Number(e.target.value) || 587)} />
            </Field>
            <div className="pt-6">
              <Checkbox checked={f.smtpSecure} onChange={(v) => set("smtpSecure", v)} label={t("adt.tlsOdZacatku465")} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("adt.uzivatel")}>
              <Input value={f.smtpUser ?? ""} onChange={(e) => set("smtpUser", e.target.value)} autoComplete="off" />
            </Field>
            <Field label={t("adt.heslo")} hint={s.smtpPasswordSet ? t("adt.ulozenoVyplnteJenProZmenu") : undefined}>
              <Input type="password" value={f.smtpPassword} onChange={(e) => set("smtpPassword", e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={t("adt.odesilatel")}>
              <Input value={f.smtpFrom ?? ""} onChange={(e) => set("smtpFrom", e.target.value)} placeholder={t("adt.contixContixOrganizaceCz")} />
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("adt.testovaciPrijemce")}>
              <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={t("adt.vyOrganizaceCz")} />
            </Field>
            <Button variant="secondary" disabled={!testTo || test.isPending} onClick={() => test.mutate("email")}>
              {t("adt.odeslatTest")}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("adt.microsoftTeams")} subtitle={t("adt.webhookKanaluWorkflowsPowerAutomate")} />
        <div className="space-y-4 p-5">
          <Checkbox checked={f.teamsEnabled} onChange={(v) => set("teamsEnabled", v)} label={t("adt.posilatSouhrnAVystrahyDo")} />
          <Field label={t("adt.adresaWebhooku")} hint={s.teamsWebhookSet ? t("adt.ulozenoVyplnteJenProZmenu2") : t("adt.jenHttpsAdresySluzebMicrosoftu")}>
            <Input value={f.teamsWebhookUrl} onChange={(e) => set("teamsWebhookUrl", e.target.value)} placeholder={t("adt.httpsLogicAzureComWorkflows")} />
          </Field>
          <Button variant="secondary" disabled={test.isPending || !s.teamsWebhookSet} onClick={() => test.mutate("teams")}>
            {t("adt.odeslatTestovaciZpravu")}
          </Button>
        </div>
      </Card>

      {test.data && (test.data.ok ? <SuccessBox>{test.data.message}</SuccessBox> : <ErrorBox error={new Error(test.data.message)} />)}
      {save.isSuccess && <SuccessBox>{t("adt.ulozeno")}</SuccessBox>}
      {run.data && <SuccessBox>{t("adt.odeslanoEMailuZpravTeams", { emails: run.data.emails, teams: run.data.teams })}</SuccessBox>}
      <ErrorBox error={save.error ?? test.error ?? run.error} />
      <div className="flex gap-3">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {t("adt.ulozit")}
        </Button>
        <Button variant="secondary" disabled={run.isPending || (!s.emailEnabled && !s.teamsEnabled)} onClick={() => run.mutate()}>
          {t("adt.odeslatSouhrnNyni")}
        </Button>
      </div>
    </div>
  );
}
