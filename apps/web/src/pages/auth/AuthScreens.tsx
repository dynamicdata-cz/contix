import { ContixMark, ContixWordmark } from "@/components/logo";
import { rememberLocale, useT } from "@/lib/i18n";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { useRefreshMe } from "@/lib/auth";
import { PASSWORD_MIN } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { MfaSetup } from "./MfaSetup";

const SSO_ERRORS: Record<string, string> = {
  not_provisioned: "Váš účet v CONTIXu zatím neexistuje. Požádejte administrátora o založení.",
  sso_domain: "Přihlášení z této e-mailové domény není povoleno.",
  inactive: "Účet je deaktivován.",
  sso_failed: "Přihlášení u poskytovatele identity selhalo.",
  sso_expired: "Přihlášení vypršelo, zkuste to znovu.",
  sso_no_email: "Poskytovatel identity nevrátil e-mail.",
  sso_invalid: "Neplatná odpověď poskytovatele identity.",
};

/**
 * Přihlašovací obrazovky v duchu loga (v1.77, ADR-170): tmavý zaoblený rámeček jako značka „cx“, inkoustová hlavní
 * tlačítka a zaměření polí místo barvy motivu, logo nad kartou na střed. Barvy jen slate (tmavý režim je přepíše).
 */
export const AUTH_PRIMARY = "bg-slate-900 text-slate-50 shadow-none hover:bg-slate-700 focus-visible:ring-slate-400";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="auth-ink relative flex min-h-full items-center justify-center overflow-hidden bg-slate-100 px-4 py-12">
      {/* značka jako jemný vodoznak – opakuje rámeček loga */}
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-40 opacity-[0.045]">
        <ContixMark className="h-[34rem] w-[34rem]" title="" />
      </div>
      <div className="relative w-full max-w-[26rem]">
        <div className="mb-7 flex flex-col items-center gap-3">
          <ContixMark className="h-16 w-16" />
          <div className="flex flex-col items-center gap-1">
            <ContixWordmark className="block h-6 w-auto" title={t("my.contix")} />
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">{t("auth.tagline")}</div>
          </div>
        </div>
        <div className="rounded-[1.75rem] border-2 border-slate-900 bg-white p-8 shadow-[0_18px_40px_-24px_rgb(15_23_42/0.45)]">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6 space-y-4">{children}</div>
        </div>
        <LanguageSwitch />
      </div>
    </div>
  );
}

export function LoginScreen() {
  const t = useT();
  const refresh = useRefreshMe();
  const providers = useQuery({ queryKey: ["providers"], queryFn: api.auth.providers });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const ssoError = new URLSearchParams(location.search).get("error");
  const login = useMutation({ mutationFn: () => api.auth.login(email, password), onSuccess: refresh });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthShell title={t("auth.signIn")} subtitle={providers.data?.organizationName}>
      {ssoError && <ErrorBox error={SSO_ERRORS[ssoError] ? t.dyn(`auth.sso.${ssoError}`, SSO_ERRORS[ssoError]!) : t("auth.failed")} />}

      {!!providers.data?.oidc.length && (
        <>
          <div className="space-y-2">
            {providers.data.oidc.map((p) => (
              <a key={p.id} href={api.auth.ssoStartUrl(p.id)} className="block">
                <Button type="button" variant="secondary" className="w-full">
                  <KeyRound size={16} /> {t("auth.signInWith", { name: p.label })}
                </Button>
              </a>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="h-px flex-1 bg-slate-200" /> {t("auth.orLocal")} <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Field label={providers.data?.ad ? t("auth.emailOrAd") : t("auth.email")} hint={providers.data?.ad ? t("auth.adHint") : undefined}>
          <Input type={providers.data?.ad ? "text" : "email"} autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("auth.password")}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox error={login.error} />
        <Button type="submit" className={`w-full py-2.5 ${AUTH_PRIMARY}`} disabled={login.isPending}>
          <LogIn size={16} /> {t("auth.signInBtn")}
        </Button>
      </form>
    </AuthShell>
  );
}

export function MfaVerifyScreen() {
  const t = useT();
  const refresh = useRefreshMe();
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const verify = useMutation({ mutationFn: () => api.auth.verifyMfa(code), onSuccess: refresh });
  const logout = useMutation({ mutationFn: api.auth.logout, onSuccess: refresh });

  return (
    <AuthShell title={t("auth.mfaTitle")} subtitle={useRecovery ? t("auth.mfaRecoverySub") : t("auth.mfaSub")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          verify.mutate();
        }}
        className="space-y-4"
      >
        <Field label={useRecovery ? t("auth.recoveryCode") : t("auth.verificationCode")}>
          <Input
            autoFocus
            required
            autoComplete="one-time-code"
            inputMode={useRecovery ? "text" : "numeric"}
            placeholder={useRecovery ? "xxxx-xxxx" : "123456"}
            className="text-center font-mono text-lg tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <ErrorBox error={verify.error} />
        <Button type="submit" className={`w-full py-2.5 ${AUTH_PRIMARY}`} disabled={verify.isPending}>
          <ShieldCheck size={16} /> {t("auth.verify")}
        </Button>
      </form>
      <div className="flex justify-between text-sm">
        <button className="text-brand-600 hover:underline" onClick={() => (setUseRecovery(!useRecovery), setCode(""))}>
          {useRecovery ? t("auth.useApp") : t("auth.useRecovery")}
        </button>
        <button className="text-slate-500 hover:underline" onClick={() => logout.mutate()}>
          {t("nav.logout")}
        </button>
      </div>
    </AuthShell>
  );
}

export function ChangePasswordForm({ onDone, forced }: { onDone?: () => void; forced?: boolean }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [local, setLocal] = useState<string | null>(null);
  const change = useMutation({ mutationFn: () => api.auth.changePassword(current, next), onSuccess: () => onDone?.() });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setLocal(null);
        if (next !== again) return setLocal(t("auth.pwMismatch"));
        change.mutate();
      }}
    >
      <Field label={forced ? t("auth.pwTemp") : t("auth.pwCurrent")}>
        <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <Field label={t("auth.pwNew")} hint={t("auth.pwHint", { n: PASSWORD_MIN })}>
        <Input type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} value={next} onChange={(e) => setNext(e.target.value)} />
      </Field>
      <Field label={t("auth.pwAgain")}>
        <Input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      <ErrorBox error={local ?? change.error} />
      <Button type="submit" className={AUTH_PRIMARY} disabled={change.isPending}>
        {t("auth.pwChange")}
      </Button>
    </form>
  );
}

export function ForcedPasswordChangeScreen() {
  const t = useT();
  const refresh = useRefreshMe();
  return (
    <AuthShell title={t("auth.forcedPwTitle")} subtitle={t("auth.forcedPwSub")}>
      <ChangePasswordForm forced onDone={refresh} />
    </AuthShell>
  );
}

export function ForcedMfaSetupScreen() {
  const t = useT();
  const refresh = useRefreshMe();
  const logout = useMutation({ mutationFn: api.auth.logout, onSuccess: refresh });
  return (
    <AuthShell title={t("auth.forcedMfaTitle")} subtitle={t("auth.forcedMfaSub")}>
      <MfaSetup onDone={refresh} />
      <button className="text-sm text-slate-500 hover:underline" onClick={() => logout.mutate()}>
        {t("nav.logout")}
      </button>
    </AuthShell>
  );
}

/** Volba jazyka před přihlášením (po přihlášení platí jazyk z profilu). */
function LanguageSwitch() {
  const t = useT();
  const list = useQuery({ queryKey: ["i18n", "list"], queryFn: api.i18n.list, retry: false });
  const locales = list.data?.locales ?? [];
  if (locales.length < 2) return null;
  return (
    <div className="mt-4 flex justify-center">
      <select
        aria-label={t("profile.language")}
        className="ctx-select rounded-md border-0 bg-transparent px-2 py-1 text-xs text-slate-500 hover:text-slate-800"
        value={t.locale}
        onChange={(e) => {
          rememberLocale(e.target.value);
          location.reload();
        }}
      >
        {locales.map((l) => (
          <option key={l.locale} value={l.locale}>
            {l.nativeName}
          </option>
        ))}
      </select>
    </div>
  );
}
