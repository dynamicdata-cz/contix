import { useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, SuccessBox } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe, useRefreshMe } from "@/lib/auth";
import { ApiTokensCard } from "@/components/tokens";
import { fmtDate } from "@/lib/utils";
import { PERMISSIONS } from "@contix/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MODES, THEMES, getMode, getTheme, setMode, setTheme, type ModeKey, type ThemeKey } from "@/lib/theme";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChangePasswordForm } from "./auth/AuthScreens";
import { MfaSetup } from "./auth/MfaSetup";

export function ProfilePage() {
  const t = useT();
  const me = useMe();
  const refresh = useRefreshMe();
  const u = me.user;
  const [pwDone, setPwDone] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [disablePw, setDisablePw] = useState("");
  const disable = useMutation({ mutationFn: () => api.auth.disableMfa(disablePw), onSuccess: refresh });
  const local = u.authProvider === "local";
  const can = useCan();

  return (
    <>
      <PageHeader title={t("profile.title")} subtitle={u.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <LanguageCard />
        <ThemeCard />
        <Card>
          <CardHeader title={t("profile.account")} />
          <dl className="space-y-3 p-5 text-sm">
            <Row label={t("profile.name")}>{u.displayName}</Row>
            <Row label={t("profile.jobTitle")}>{u.jobTitle ?? "—"}</Row>
            <Row label={t("profile.signIn")}>{local ? t("profile.localAccount") : t("profile.ssoAccount")}</Row>
            <Row label={t("profile.lastLogin")}>{fmtDate(u.lastLoginAt)}</Row>
            <Row label={t("profile.roles")}>
              <div className="flex flex-wrap gap-1">
                {u.roles.map((r) => (
                  <Badge key={r.id + r.source} tone={r.source === "idp" ? "violet" : "blue"}>
                    {r.name}
                    {r.source === "idp" && t("profile.fromIdp")}
                  </Badge>
                ))}
                {!u.roles.length && "—"}
              </div>
            </Row>
          </dl>
          <div className="border-t border-slate-100 p-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{t("profile.permissions")}</p>
            <ul className="space-y-1 text-sm text-slate-700">
              {me.permissions.map((p) => (
                <li key={p}>✓ {t.dyn(`enum.perm.${p}`, PERMISSIONS[p])}</li>
              ))}
            </ul>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={t("profile.mfa")} subtitle={local ? t("profile.mfaLocal") : t("profile.mfaIdp")} />
            <div className="space-y-4 p-5">
              {!local ? (
                <p className="text-sm text-slate-600">{t("profile.mfaIdpText")}</p>
              ) : u.mfaEnabled ? (
                <>
                  <SuccessBox>{t("profile.mfaActive")}</SuccessBox>
                  {!me.mfaSetupRequired && (
                    <form
                      className="flex items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        disable.mutate();
                      }}
                    >
                      <Field label={t("profile.mfaDisablePw")} className="flex-1">
                        <Input type="password" required value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
                      </Field>
                      <Button variant="danger" type="submit" disabled={disable.isPending}>
                        {t("profile.mfaDisable")}
                      </Button>
                    </form>
                  )}
                  <ErrorBox error={disable.error} />
                </>
              ) : setupOpen ? (
                <MfaSetup
                  onDone={() => {
                    setSetupOpen(false);
                    refresh();
                  }}
                />
              ) : (
                <>
                  <p className="text-sm text-slate-600">{t("profile.mfaRecommend")}</p>
                  <Button onClick={() => setSetupOpen(true)}>{t("profile.mfaSetup")}</Button>
                </>
              )}
            </div>
          </Card>

          {can("api:tokens") && <ApiTokensCard />}

          {local && (
            <Card>
              <CardHeader title={t("profile.password")} subtitle={t("profile.passwordSub")} />
              <div className="p-5">
                {pwDone ? <SuccessBox>{t("profile.passwordDone")}</SuccessBox> : <ChangePasswordForm onDone={() => setPwDone(true)} />}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[10rem_1fr] gap-3">
    <dt className="text-slate-500">{label}</dt>
    <dd>{children}</dd>
  </div>
);

function ThemeCard() {
  const t = useT();
  const tr = useT();
  const [cur, setCur] = useState<ThemeKey>(getTheme());
  const [mode, setM] = useState<ModeKey>(getMode());
  const icons = { system: Monitor, light: Sun, dark: Moon } as const;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title={t("profile.appearance")} subtitle={t("profile.appearanceSub")} />
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <span className="text-sm font-medium text-slate-700">{t("profile.mode")}</span>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label={t("profile.mode")}>
          {MODES.map((m) => {
            const I = icons[m];
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => (setMode(m), setM(m))}
                className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors", mode === m ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
              >
                <I size={15} /> {t(`profile.mode.${m}`)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-3">
        {THEMES.map((t) => (
          <button
            key={t.key}
            onClick={() => (setTheme(t.key), setCur(t.key))}
            className={cn("rounded-lg border p-3 text-left transition", cur === t.key ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300")}
            aria-pressed={cur === t.key}
          >
            <div className="flex h-12 overflow-hidden rounded-md border border-slate-200">
              <div className="w-1/4" style={{ background: t.swatch[1] }} />
              <div className="flex flex-1 items-center gap-1.5 px-2" style={{ background: t.swatch[2] }}>
                <span className="h-3 w-10 rounded-full" style={{ background: t.swatch[0] }} />
                <span className="h-2 w-6 rounded-full bg-slate-200" />
              </div>
            </div>
            <div className="mt-2 text-sm font-medium">{tr.dyn(`theme.${t.key}.label`, t.label)}</div>
            <div className="text-xs text-slate-500">{tr.dyn(`theme.${t.key}.hint`, t.hint)}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function LanguageCard() {
  const t = useT();
  const me = useMe();
  const refresh = useRefreshMe();
  const list = useQuery({ queryKey: ["i18n", "list"], queryFn: api.i18n.list });
  const save = useMutation({ mutationFn: (l: string | null) => api.i18n.setMine(l), onSuccess: refresh });
  const def = list.data?.locales.find((l) => l.locale === list.data?.defaultLocale);
  return (
    <Card className="lg:col-span-2">
      <CardHeader title={t("profile.language")} subtitle={t("profile.languageSub")} />
      <div className="flex flex-wrap gap-2 p-5">
        <ErrorBox error={save.error} />
        {[{ locale: null as string | null, label: t("profile.languageDefault", { name: def?.nativeName ?? "—" }), pct: 100 }, ...(list.data?.locales ?? []).map((l) => ({ locale: l.locale as string | null, label: l.nativeName, pct: l.completeness }))].map((o) => {
          const active = (me.user.locale ?? null) === o.locale;
          return (
            <button
              key={o.locale ?? "default"}
              disabled={save.isPending}
              onClick={() => save.mutate(o.locale)}
              className={cn("rounded-lg border px-3 py-2 text-left text-sm transition", active ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-slate-200 hover:border-slate-300")}
              aria-pressed={active}
            >
              {o.label}
              {o.pct < 100 && <span className="ml-2 text-xs font-normal text-slate-500">{t("profile.languagePartial", { pct: o.pct })}</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
