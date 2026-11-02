import { useT } from "@/lib/i18n";
import { Button, ErrorBox, Field, Input, SuccessBox } from "@/components/ui";
import { api } from "@/lib/api";
import { useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Průvodce nastavením TOTP (Microsoft/Google Authenticator, 1Password, …). */
export function MfaSetup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const setup = useMutation({ mutationFn: api.auth.setupMfa });
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const enable = useMutation({ mutationFn: () => api.auth.enableMfa(code) });

  useEffect(() => {
    if (setup.data) QRCode.toDataURL(setup.data.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [setup.data]);

  if (enable.data)
    return (
      <div className="space-y-4">
        <SuccessBox>{t("mfa.active")}</SuccessBox>
        <div>
          <p className="text-sm font-medium">{t("mfa.recoveryCodes")}</p>
          <p className="mt-1 text-xs text-slate-500">
            {t("mfa.recoveryHint")}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-3 font-mono text-sm">
            {enable.data.recoveryCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(enable.data.recoveryCodes.join("\n"))}>
            {t("mfa.copy")}
          </Button>
          <Button onClick={onDone}>{t("mfa.saved")}</Button>
        </div>
      </div>
    );

  if (!setup.data)
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          {t("mfa.needApp")}
        </p>
        <ErrorBox error={setup.error} />
        <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
          {t("mfa.start")}
        </Button>
      </div>
    );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        enable.mutate();
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
        <li>{t("mfa.step1")}</li>
        <li>{t("mfa.step2")}</li>
      </ol>
      <div className="flex flex-col items-center gap-2">
        {qr && <img src={qr} alt={t("mfa.qrAlt")} className="h-48 w-48 rounded border border-slate-200" />}
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">{t("mfa.manual")}</summary>
          <code className="mt-1 block break-all rounded bg-slate-50 p-2 font-mono">{setup.data.secret}</code>
        </details>
      </div>
      <Field label={t("mfa.code")}>
        <Input
          autoFocus
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          className="text-center font-mono text-lg tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <ErrorBox error={enable.error} />
      <Button type="submit" disabled={enable.isPending}>
        {t("mfa.activate")}
      </Button>
    </form>
  );
}
