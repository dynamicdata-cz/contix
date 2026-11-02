import { askConfirm } from "@/components/ui/overlay";
/** Administrace → Přihlášení: účty AD (LDAPS), mapování skupin na role a poskytovatelé SSO (ADR-078). */
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, SuccessBox, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { SSO_KIND_LABELS, SSO_KINDS, type AdLoginSourceDto, type AdLoginTestResult, type LoginAdminDto, type SsoKind, type SsoProviderDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Pencil, Plus, Server, Trash2, Users, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

const lines = (v: string) =>
  v
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export function AdminLoginPage() {
  const t = useT();
  const q = useQuery({ queryKey: ["admin", "login"], queryFn: api.admin.login });
  const [ad, setAd] = useState<AdLoginSourceDto | "new" | null>(null);
  const [test, setTest] = useState<AdLoginSourceDto | null>(null);
  const [sso, setSso] = useState<SsoProviderDto | "new" | null>(null);
  const [role, setRole] = useState<LoginAdminDto["roles"][number] | null>(null);
  const can = useCan();
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  return (
    <div className="space-y-6">
      <Card data-testid="ad-login">
        <CardHeader
          title={t("lgn.adTitle")}
          subtitle={t("lgn.adSubtitle")}
          action={
            <Button className="px-2.5 py-1.5 text-xs" onClick={() => setAd("new")}>
              <Plus size={14} /> {t("lgn.adConnect")}
            </Button>
          }
        />
        {d.ad.length === 0 ? (
          <div className="space-y-2 p-5 text-sm text-slate-600">
            <p>{t("lgn.adEmpty")}</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t("lgn.adStep1")}</li>
              <li>{t("lgn.adStep2")}</li>
              <li>{t("lgn.adStep3")}</li>
              <li>{t("lgn.adStep4")}</li>
            </ol>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {d.ad.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <Server size={16} className="text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="font-mono text-xs text-slate-500">
                    {s.config.url} · {s.config.baseDn}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {s.login.allowedGroups.length ? t("lgn.onlyGroups", { groups: s.login.allowedGroups.join(", ") }) : t("lgn.anyGroup")}
                    {" · "}
                    {s.login.autoProvision ? t("lgn.autoOn", { role: d.roles.find((r) => r.key === s.login.defaultRoleKey)?.name ?? t("lgn.rolesFromGroups") }) : t("lgn.autoOff")}
                  </div>
                </div>
                <Badge tone={s.login.enabled ? "green" : "slate"}>{s.login.enabled ? t("lgn.enabled") : t("lgn.disabled")}</Badge>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setTest(s)}>
                  <KeyRound size={14} /> {t("lgn.test")}
                </Button>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setAd(s)} aria-label={t("lgn.edit")}>
                  <Pencil size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card data-testid="login-roles">
        <CardHeader title={t("lgn.rolesTitle")} subtitle={t("lgn.rolesSubtitle")} />
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">{t("lgn.role")}</th>
              <th className="px-3 py-2">{t("lgn.groups")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.roles.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-xs text-slate-600">{r.externalGroups.length ? r.externalGroups.join(", ") : <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2 text-right">
                  {can("admin:roles") && (
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setRole(r)} aria-label={t("lgn.mapGroups", { role: r.name })}>
                      <Users size={13} />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card data-testid="sso-providers">
        <CardHeader
          title={t("lgn.ssoTitle")}
          subtitle={t("lgn.ssoSubtitle")}
          action={
            <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setSso("new")}>
              <Plus size={14} /> {t("lgn.ssoAdd")}
            </Button>
          }
        />
        {d.sso.length + d.envProviders.length === 0 ? (
          <EmptyState>{t("lgn.ssoEmpty")}</EmptyState>
        ) : (
          <div className="divide-y divide-slate-100">
            {d.envProviders.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.label}</div>
                  <div className="font-mono text-xs text-slate-500">{p.redirectUri}</div>
                </div>
                <Badge tone="slate">{t("lgn.fromEnv")}</Badge>
              </div>
            ))}
            {d.sso.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {p.label} <span className="text-xs font-normal text-slate-500">({t.lbl(SSO_KIND_LABELS[p.kind])})</span>
                  </div>
                  <div className="font-mono text-xs text-slate-500">{p.redirectUri}</div>
                </div>
                <Badge tone={p.enabled ? "green" : "slate"}>{p.enabled ? t("lgn.enabled") : t("lgn.disabled")}</Badge>
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setSso(p)} aria-label={t("lgn.edit")}>
                  <Pencil size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
        <SsoSettings roles={d.roles} />
      </Card>

      {ad && <AdModal source={ad === "new" ? null : ad} roles={d.roles} onClose={() => setAd(null)} />}
      {test && <AdTestModal source={test} onClose={() => setTest(null)} />}
      {sso && <SsoModal provider={sso === "new" ? null : sso} appUrl={d.appUrl} onClose={() => setSso(null)} />}
      {role && <RoleGroupsModal role={role} onClose={() => setRole(null)} />}
    </div>
  );
}

function AdModal({ source, roles, onClose }: { source: AdLoginSourceDto | null; roles: LoginAdminDto["roles"]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: source?.name ?? "Active Directory",
    url: source?.config.url ?? "ldaps://",
    baseDn: source?.config.baseDn ?? "",
    bindDn: source?.config.bindDn ?? "",
    secret: "",
    verifyTls: source?.config.verifyTls ?? true,
    caCert: source?.config.caCert ?? "",
    enabled: source?.login.enabled ?? true,
    allowedGroups: (source?.login.allowedGroups ?? []).join("\n"),
    autoProvision: source?.login.autoProvision ?? true,
    defaultRoleKey: source?.login.defaultRoleKey ?? "",
    upnSuffix: source?.login.upnSuffix ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const body = () => ({
    name: f.name,
    config: { url: f.url, baseDn: f.baseDn, bindDn: f.bindDn, verifyTls: f.verifyTls, caCert: f.caCert, extraPrivilegedGroups: source?.config.extraPrivilegedGroups ?? [] },
    secret: f.secret || undefined,
    login: { enabled: f.enabled, allowedGroups: lines(f.allowedGroups), autoProvision: f.autoProvision, defaultRoleKey: f.defaultRoleKey, upnSuffix: f.upnSuffix },
  });
  const save = useMutation({
    mutationFn: () => (source ? api.admin.updateAdLogin(source.id, body()) : api.admin.createAdLogin(body())),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "login"] });
      qc.invalidateQueries({ queryKey: ["providers"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={source ? source.name : t("lgn.adConnect")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !f.name || !f.baseDn || !f.bindDn || (!source && !f.secret)} onClick={() => save.mutate()}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <div className="text-sm font-semibold text-slate-800">{t("lgn.sec.connection")}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("lgn.name")}>
          <Input value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t("lgn.url")} hint={t("lgn.urlHint")}>
          <Input value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="ldaps://dc01.firma.local:636" className="font-mono" />
        </Field>
        <Field label="Base DN" hint={t("lgn.baseDnHint")}>
          <Input value={f.baseDn} onChange={(e) => set("baseDn", e.target.value)} placeholder="DC=firma,DC=local" className="font-mono" />
        </Field>
        <Field label={t("lgn.bindDn")} hint={t("lgn.bindDnHint")}>
          <Input value={f.bindDn} onChange={(e) => set("bindDn", e.target.value)} placeholder="svc-contix@firma.local" className="font-mono" />
        </Field>
        <Field label={t("lgn.secret")} hint={source?.hasSecret ? t("lgn.secretKeep") : undefined}>
          <Input type="password" autoComplete="new-password" value={f.secret} onChange={(e) => set("secret", e.target.value)} />
        </Field>
        <div className="pt-6">
          <Checkbox checked={f.verifyTls} onChange={(v) => set("verifyTls", v)} label={t("lgn.verifyTls")} hint={t("lgn.verifyTlsHint")} />
        </div>
      </div>
      {f.verifyTls && (
        <Field label={t("lgn.caCert")} hint={t("lgn.caCertHint")}>
          <Textarea rows={3} value={f.caCert} onChange={(e) => set("caCert", e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-xs" />
        </Field>
      )}

      <div className="pt-2 text-sm font-semibold text-slate-800">{t("lgn.sec.who")}</div>
      <Checkbox checked={f.enabled} onChange={(v) => set("enabled", v)} label={t("lgn.enable")} hint={t("lgn.enableHint")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("lgn.allowedGroups")} hint={t("lgn.allowedGroupsHint")}>
          <Textarea rows={3} value={f.allowedGroups} onChange={(e) => set("allowedGroups", e.target.value)} placeholder="CONTIX-Uzivatele" />
        </Field>
        <div className="space-y-3">
          <Checkbox checked={f.autoProvision} onChange={(v) => set("autoProvision", v)} label={t("lgn.autoProvision")} hint={t("lgn.autoProvisionHint")} />
          <Field label={t("lgn.defaultRole")}>
            <Select value={f.defaultRoleKey} onChange={(e) => set("defaultRoleKey", e.target.value)}>
              <option value="">{t("lgn.rolesFromGroupsOnly")}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("lgn.upnSuffix")} hint={t("lgn.upnSuffixHint")}>
            <Input value={f.upnSuffix} onChange={(e) => set("upnSuffix", e.target.value)} placeholder="firma.local" />
          </Field>
        </div>
      </div>
      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{t("lgn.securityNote")}</p>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function AdTestModal({ source, onClose }: { source: AdLoginSourceDto; onClose: () => void }) {
  const t = useT();
  const [username, setUser] = useState("");
  const [password, setPw] = useState("");
  const run = useMutation({ mutationFn: () => api.admin.testAdLogin(source.id, { username, password }), onSettled: () => setPw("") });
  const r: AdLoginTestResult | undefined = run.data;
  return (
    <Modal
      open
      onClose={onClose}
      title={t("lgn.testTitle", { name: source.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button disabled={run.isPending || !username || !password} onClick={() => run.mutate()}>
            <KeyRound size={15} /> {t("lgn.test")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("lgn.testHint")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("lgn.username")}>
          <Input value={username} autoComplete="off" onChange={(e) => setUser(e.target.value)} placeholder="jan.novak" />
        </Field>
        <Field label={t("auth.password")}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPw(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={run.error} />
      {r && (
        <div className={`space-y-2 rounded-md border px-3 py-3 text-sm ${r.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`} data-testid="ad-test-result">
          <div className="flex items-start gap-2 font-medium">
            {r.ok ? <CheckCircle2 size={16} className="mt-0.5 text-emerald-700" /> : <XCircle size={16} className="mt-0.5 text-red-700" />}
            {r.message}
          </div>
          {r.displayName && (
            <div className="text-xs text-slate-700">
              {r.displayName} · {r.login} · {r.email ?? "—"}
            </div>
          )}
          {!!r.roles.length && <div className="text-xs">{t("lgn.testRoles", { roles: r.roles.join(", ") })}</div>}
          {!!r.groups.length && <div className="text-xs text-slate-600">{t("lgn.testGroups", { groups: r.groups.slice(0, 40).join(", ") })}</div>}
        </div>
      )}
    </Modal>
  );
}

function RoleGroupsModal({ role, onClose }: { role: LoginAdminDto["roles"][number]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = useState(role.externalGroups.join("\n"));
  const save = useMutation({
    mutationFn: () => api.admin.updateRole(role.id, { externalGroups: lines(v) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("lgn.mapGroups", { role: role.name })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <Field label={t("lgn.groups")} hint={t("lgn.mapGroupsHint")}>
        <Textarea rows={5} value={v} onChange={(e) => setV(e.target.value)} placeholder={t("lgn.mapGroupsPlaceholder")} />
      </Field>
      <ErrorBox error={save.error} />
    </Modal>
  );
}

function SsoModal({ provider, appUrl, onClose }: { provider: SsoProviderDto | null; appUrl: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({
    kind: (provider?.kind ?? "entra") as SsoKind,
    label: provider?.label ?? "Microsoft 365",
    tenantId: provider?.tenantId ?? "",
    issuer: provider?.issuer ?? "",
    clientId: provider?.clientId ?? "",
    secret: "",
    scopes: provider?.scopes ?? "openid profile email",
    enabled: provider?.enabled ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const done = () => {
    qc.invalidateQueries({ queryKey: ["admin", "login"] });
    qc.invalidateQueries({ queryKey: ["providers"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, secret: f.secret || undefined };
      return provider ? api.admin.updateSso(provider.id, body) : api.admin.createSso(body);
    },
    onSuccess: done,
  });
  const del = useMutation({ mutationFn: () => api.admin.deleteSso(provider!.id), onSuccess: done });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={provider ? provider.label : t("lgn.ssoAdd")}
      footer={
        <>
          {provider && (
            <Button variant="danger" className="mr-auto" onClick={async () => (await askConfirm(t("lgn.ssoDeleteConfirm"))) && del.mutate()} aria-label={t("lgn.ssoDelete")}>
              <Trash2 size={14} />
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={save.isPending || !f.label || !f.clientId || (!provider && !f.secret)} onClick={() => save.mutate()}>
            {t("usr.ulozit")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("lgn.ssoKind")}>
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value as SsoKind)}>
            {SSO_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.lbl(SSO_KIND_LABELS[k])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("lgn.ssoLabel")} hint={t("lgn.ssoLabelHint")}>
          <Input value={f.label} onChange={(e) => set("label", e.target.value)} />
        </Field>
        {f.kind === "entra" && (
          <Field label={t("lgn.tenantId")}>
            <Input value={f.tenantId} onChange={(e) => set("tenantId", e.target.value)} className="font-mono" />
          </Field>
        )}
        {f.kind === "oidc" && (
          <Field label={t("lgn.issuer")} hint={t("lgn.issuerHint")}>
            <Input value={f.issuer} onChange={(e) => set("issuer", e.target.value)} placeholder="https://adfs.firma.cz/adfs" className="font-mono" />
          </Field>
        )}
        <Field label={t("lgn.clientId")}>
          <Input value={f.clientId} onChange={(e) => set("clientId", e.target.value)} className="font-mono" />
        </Field>
        <Field label={t("lgn.clientSecret")} hint={provider?.hasSecret ? t("lgn.secretKeep") : undefined}>
          <Input type="password" autoComplete="new-password" value={f.secret} onChange={(e) => set("secret", e.target.value)} />
        </Field>
        <Field label={t("lgn.scopes")}>
          <Input value={f.scopes} onChange={(e) => set("scopes", e.target.value)} className="font-mono" />
        </Field>
      </div>
      <Checkbox checked={f.enabled} onChange={(v) => set("enabled", v)} label={t("lgn.ssoEnabled")} />
      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {t("lgn.redirectHint")}{" "}
        <code className="break-all">{provider ? provider.redirectUri : `${appUrl.replace(/\/+$/, "")}/api/auth/oidc/sso-…/callback`}</code>
      </p>
      <ErrorBox error={save.error ?? del.error} />
    </Modal>
  );
}

/** Společná pravidla SSO: zakládání účtů, povolené domény, výchozí role (dříve v Nastavení). */
function SsoSettings({ roles }: { roles: LoginAdminDto["roles"] }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: api.admin.settings });
  const [s, setS] = useState<{ auto: boolean; domains: string; role: string } | null>(null);
  useEffect(() => {
    const st = q.data?.settings;
    if (st && !s) setS({ auto: st.oidcAutoProvision, domains: (st.oidcAllowedDomains ?? []).join(", "), role: st.oidcDefaultRoleKey });
  }, [q.data, s]);
  const save = useMutation({
    mutationFn: () =>
      api.admin.updateSettings({
        oidcAutoProvision: s!.auto,
        oidcAllowedDomains: s!.domains
          .split(/[,\s]+/)
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
        oidcDefaultRoleKey: s!.role,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });
  if (!s) return null;
  return (
    <div className="space-y-4 border-t border-slate-100 p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Checkbox checked={s.auto} onChange={(v) => setS({ ...s, auto: v })} label={t("set.automatickyZakladatUzivatelePriPrvnim")} hint={t("set.vypnutoPrihlasitSeMohouJen")} />
        <Field label={t("set.povoleneEMailoveDomenySso")} hint={t("set.oddelteCarkouNaprFirmaCz")}>
          <Input value={s.domains} onChange={(e) => setS({ ...s, domains: e.target.value })} placeholder={t("set.firmaCz")} />
        </Field>
        <Field label={t("set.vychoziRoleNoveZalozenehoSso")}>
          <Select value={s.role} onChange={(e) => setS({ ...s, role: e.target.value })}>
            {roles.map((r) => (
              <option key={r.id} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
          {t("lgn.ssoSaveRules")}
        </Button>
        {save.isSuccess && <SuccessBox>{t("lgn.saved")}</SuccessBox>}
      </div>
      <ErrorBox error={save.error} />
    </div>
  );
}
