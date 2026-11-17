/**
 * Průvodce prvním nastavením nové instalace (v1.73, ADR-166): pět kroků s ukazatelem postupu – organizace (název,
 * IČO z ARES), klíčoví uživatelé, organizační struktura, síťové rozsahy a první import aktiv. Každý krok zapisuje
 * přes běžné API (stejná oprávnění a audit); stav kroků počítá server z dat, dokončení se pamatuje.
 */
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DEFAULT_ORG_NAME, temporaryPassword, type ImportPreviewDto, type ImportResultDto, type SetupWizardDto, type WizardStep } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Building2, Check, Network, PackagePlus, Users, Workflow } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const ICON: Record<WizardStep, ReactNode> = {
  organization: <Building2 size={16} />,
  users: <Users size={16} />,
  structure: <Workflow size={16} />,
  ranges: <Network size={16} />,
  assets: <PackagePlus size={16} />,
};
const STEP_KEY = { organization: "wiz.step.organization", users: "wiz.step.users", structure: "wiz.step.structure", ranges: "wiz.step.ranges", assets: "wiz.step.assets" } as const;

export function SetupWizardPage() {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({ queryKey: ["setup", "wizard"], queryFn: api.setup.wizard });
  const d = q.data;
  const steps = d ? d.steps.filter((s) => !s.skipped) : [];
  const [cur, setCur] = useState<WizardStep | "finish" | null>(null);
  // první nehotový krok
  useEffect(() => {
    if (d && cur == null) setCur(steps.find((s) => !s.done)?.key ?? "finish");
  }, [d, cur, steps]);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["setup"] }), qc.invalidateQueries({ queryKey: ["discovery"] }), qc.invalidateQueries({ queryKey: ["admin"] })]);
  const next = () => {
    void refresh();
    const i = steps.findIndex((s) => s.key === cur);
    setCur(steps[i + 1]?.key ?? "finish");
  };
  const finish = useMutation({
    mutationFn: api.setup.wizardFinish,
    onSuccess: (r) => {
      qc.setQueryData(["setup", "wizard"], r);
      void refresh();
      toast(t("wiz.finished"), "success");
      router.history.push("/");
    },
  });
  const pct = d && d.total ? Math.round((d.done / d.total) * 100) : 0;
  return (
    <>
      <PageHeader title={t("wiz.title")} subtitle={t("wiz.subtitle")} />
      <ErrorBox error={q.error ?? finish.error} />
      {d && (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit p-4" data-testid="wiz-steps">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <span>{t("wiz.progress", { done: d.done, total: d.total })}</span>
              <span className="tabular-nums">{pct} %</span>
            </div>
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("wiz.progressLabel")}>
              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setCur(s.key)}
                    aria-current={cur === s.key ? "step" : undefined}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", cur === s.key ? "bg-brand-50 font-medium text-brand-900" : "text-slate-700 hover:bg-slate-50")}
                    data-testid={`wiz-nav-${s.key}`}
                  >
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs", s.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                      {s.done ? <Check size={14} aria-label={t("wiz.done")} /> : i + 1}
                    </span>
                    <span className="flex-1">{t(STEP_KEY[s.key])}</span>
                    {s.count > 0 && s.key !== "organization" && <span className="text-xs tabular-nums text-slate-500">{s.count}</span>}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => setCur("finish")} aria-current={cur === "finish" ? "step" : undefined} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", cur === "finish" ? "bg-brand-50 font-medium text-brand-900" : "text-slate-700 hover:bg-slate-50")} data-testid="wiz-nav-finish">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">✓</span>
                  {t("wiz.step.finish")}
                </button>
              </li>
            </ol>
          </Card>
          <Card className="p-5" data-testid={`wiz-step-${cur}`}>
            {cur && cur !== "finish" && (
              <div className="mb-4 flex items-center gap-2">
                <span className="text-slate-500">{ICON[cur]}</span>
                <h2 className="text-lg font-semibold text-slate-900">{t(STEP_KEY[cur])}</h2>
                {d.steps.find((s) => s.key === cur)?.done && <Badge tone="green">{t("wiz.done")}</Badge>}
              </div>
            )}
            {cur === "organization" && <OrgStep d={d} onDone={next} />}
            {cur === "users" && <UsersStep d={d} onDone={next} />}
            {cur === "structure" && <StructureStep d={d} onDone={next} />}
            {cur === "ranges" && <RangesStep onDone={next} />}
            {cur === "assets" && <AssetsStep onDone={next} />}
            {cur === "finish" && (
              <div className="space-y-4 text-sm">
                <h2 className="text-lg font-semibold text-slate-900">{t("wiz.step.finish")}</h2>
                <ul className="space-y-1">
                  {steps.map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      {s.done ? <Check size={15} className="text-emerald-600" /> : <span className="inline-block h-[15px] w-[15px] rounded-full border border-slate-300" />}
                      <span className={s.done ? "text-slate-800" : "text-slate-500"}>{t(STEP_KEY[s.key])}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-slate-600">{t("wiz.finishText")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={finish.isPending} onClick={() => finish.mutate()} data-testid="wiz-finish">
                    {d.done < d.total ? t("wiz.finishAnyway") : t("wiz.finish")}
                  </Button>
                  <Link to="/admin/setup" className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-brand-700 hover:underline">
                    {t("wiz.checklist")} →
                  </Link>
                  <Link to="/compliance-path" className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-brand-700 hover:underline">
                    {t("wiz.compliancePath")} →
                  </Link>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function StepActions({ busy, onSave, onSkip, saveLabel, disabled }: { busy: boolean; onSave: () => void; onSkip: () => void; saveLabel?: string; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
      <Button disabled={busy || disabled} onClick={onSave} data-testid="wiz-save">
        {saveLabel ?? t("wiz.saveNext")}
      </Button>
      <Button variant="secondary" disabled={busy} onClick={onSkip} data-testid="wiz-skip">
        {t("wiz.skip")}
      </Button>
    </div>
  );
}

/* ---------- 1. organizace ---------- */
function OrgStep({ d, onDone }: { d: SetupWizardDto; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState(d.organizationName === DEFAULT_ORG_NAME ? "" : d.organizationName);
  const [ico, setIco] = useState(d.company?.ico ?? "");
  const [address, setAddress] = useState(d.company?.address ?? "");
  const ares = useQuery({ queryKey: ["ares", "status"], queryFn: api.ares.status, staleTime: 300_000 });
  const lookup = useMutation({
    mutationFn: () => api.ares.search(ico.trim()),
    onSuccess: (r) => {
      const s = r[0];
      if (!s) return toast(t("wiz.org.aresNone"), "error");
      setName(s.name);
      setAddress(s.address ?? "");
    },
  });
  // identita organizace = kořenová společnost (stejně jako Administrace → Nastavení)
  const save = useMutation({
    mutationFn: () => api.admin.updateSettings({ organizationName: name.trim(), organizationIco: ico.trim(), organizationAddress: address.trim() }),
    onSuccess: onDone,
  });
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">{t("wiz.org.intro")}</p>
      <ErrorBox error={save.error ?? lookup.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("wiz.org.ico")}>
          <div className="flex gap-2">
            <Input value={ico} onChange={(e) => setIco(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" aria-label={t("wiz.org.ico")} data-testid="wiz-org-ico" />
            {ares.data?.enabled && (
              <Button variant="secondary" disabled={ico.length !== 8 || lookup.isPending} onClick={() => lookup.mutate()}>
                {t("wiz.org.ares")}
              </Button>
            )}
          </div>
        </Field>
        <Field label={t("wiz.org.orgName")} hint={t("wiz.org.orgNameHint")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="wiz-org-name" />
        </Field>
        <Field label={t("wiz.org.address")} className="sm:col-span-2">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} data-testid="wiz-org-address" />
        </Field>
      </div>
      <StepActions busy={save.isPending} disabled={!name.trim()} onSave={() => save.mutate()} onSkip={onDone} />
    </>
  );
}

/* ---------- 2. uživatelé ---------- */
type Row = { email: string; name: string; roleId: string };
function UsersStep({ d, onDone }: { d: SetupWizardDto; onDone: () => void }) {
  const t = useT();
  const roles = useQuery({ queryKey: ["admin", "roles"], queryFn: api.admin.roles });
  const sso = d.login.oidc || d.login.ad;
  const [provider, setProvider] = useState<"local" | "oidc" | "ad">(d.login.oidc ? "oidc" : d.login.ad ? "ad" : "local");
  const [rows, setRows] = useState<Row[]>([{ email: "", name: "", roleId: "" }]);
  const [created, setCreated] = useState<{ email: string; password: string | null }[]>([]);
  const preferred = ["security_manager", "asset_owner", "auditor", "employee"];
  const roleList = (roles.data ?? []).filter((r) => r.key !== "external_auditor").sort((a, b) => (preferred.indexOf(a.key) + 1 || 99) - (preferred.indexOf(b.key) + 1 || 99));
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const valid = rows.filter((r) => r.email.includes("@") && r.name.trim());
  const save = useMutation({
    mutationFn: async () => {
      const out: { email: string; password: string | null }[] = [];
      for (const r of valid) {
        const password = provider === "local" ? temporaryPassword((n) => crypto.getRandomValues(new Uint8Array(n))) : null;
        await api.admin.createUser({ email: r.email.trim(), displayName: r.name.trim(), authProvider: provider, ...(password ? { password } : {}), roleIds: r.roleId ? [r.roleId] : [], groupIds: [] });
        out.push({ email: r.email.trim().toLowerCase(), password });
      }
      return out;
    },
    onSuccess: (out) => {
      setCreated((c) => [...c, ...out]);
      setRows([{ email: "", name: "", roleId: "" }]);
      if (provider !== "local") onDone();
    },
  });
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">{t("wiz.users.intro", { n: d.steps.find((s) => s.key === "users")?.count ?? 0 })}</p>
      <ErrorBox error={save.error ?? roles.error} />
      <Field label={t("wiz.users.login")} className="mb-4 max-w-xs">
        <Select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} data-testid="wiz-users-provider">
          {d.login.oidc && <option value="oidc">{t("wiz.users.oidc")}</option>}
          {d.login.ad && <option value="ad">{t("wiz.users.ad")}</option>}
          <option value="local">{t("wiz.users.local")}</option>
        </Select>
      </Field>
      {!sso && <p className="-mt-2 mb-4 text-xs text-slate-500">{t("wiz.users.ssoHint")}</p>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_220px]" data-testid="wiz-user-row">
            <Input placeholder={t("wiz.users.email")} aria-label={t("wiz.users.email")} type="email" value={r.email} onChange={(e) => set(i, { email: e.target.value })} />
            <Input placeholder={t("wiz.users.name")} aria-label={t("wiz.users.name")} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
            <Select aria-label={t("wiz.users.role")} value={r.roleId} onChange={(e) => set(i, { roleId: e.target.value })}>
              <option value="">{t("wiz.users.noRole")}</option>
              {roleList.map((x) => (
                <option key={x.id} value={x.id}>
                  {t.lbl(x.name)}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
      <Button variant="secondary" className="mt-2 px-2.5 py-1 text-xs" onClick={() => setRows((r) => [...r, { email: "", name: "", roleId: "" }])}>
        {t("wiz.users.add")}
      </Button>
      {created.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="wiz-users-created">
          <p className="mb-1 font-medium text-amber-900">{t("wiz.users.created", { n: created.length })}</p>
          {created.some((c) => c.password) && <p className="mb-2 text-xs text-amber-800">{t("wiz.users.passwordHint")}</p>}
          <ul className="space-y-0.5 font-mono text-xs">
            {created.map((c) => (
              <li key={c.email}>
                {c.email}
                {c.password && <> – {c.password}</>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <StepActions busy={save.isPending} disabled={!valid.length} saveLabel={t("wiz.users.create", { n: valid.length })} onSave={() => save.mutate()} onSkip={onDone} />
      {created.length > 0 && provider === "local" && (
        <Button variant="secondary" className="mt-2" onClick={onDone}>
          {t("wiz.next")}
        </Button>
      )}
    </>
  );
}

/* ---------- 3. organizační struktura ---------- */
function StructureStep({ d, onDone }: { d: SetupWizardDto; onDone: () => void }) {
  const t = useT();
  const [root, setRoot] = useState(d.organizationName === DEFAULT_ORG_NAME ? "" : d.organizationName);
  const [units, setUnits] = useState("");
  const [managers, setManagers] = useState(true);
  const list = units
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 50);
  const save = useMutation({
    mutationFn: async () => {
      const top = (await api.org.createUnit({ name: root.trim(), unitType: "organization" })) as { id: string };
      if (managers) await api.org.createPosition({ orgUnitId: top.id, name: t("wiz.structure.director"), isManager: true });
      for (const u of list) {
        const x = (await api.org.createUnit({ name: u, parentId: top.id })) as { id: string };
        if (managers) await api.org.createPosition({ orgUnitId: x.id, name: t("wiz.structure.head", { unit: u }), isManager: true });
      }
    },
    onSuccess: onDone,
  });
  const count = d.steps.find((s) => s.key === "structure")?.count ?? 0;
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">{t("wiz.structure.intro")}</p>
      {count > 0 && <p className="mb-4 text-sm text-emerald-700">{t("wiz.structure.exists", { n: count })}</p>}
      <ErrorBox error={save.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("wiz.structure.root")}>
          <Input value={root} onChange={(e) => setRoot(e.target.value)} data-testid="wiz-structure-root" />
        </Field>
        <Field label={t("wiz.structure.units")} hint={t("wiz.structure.unitsHint")}>
          <Textarea rows={6} value={units} onChange={(e) => setUnits(e.target.value)} data-testid="wiz-structure-units" />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={managers} onChange={(e) => setManagers(e.target.checked)} />
        {t("wiz.structure.managers")}
      </label>
      <StepActions busy={save.isPending} disabled={!root.trim()} onSave={() => save.mutate()} onSkip={onDone} />
    </>
  );
}

/* ---------- 4. síťové rozsahy ---------- */
function RangesStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const seg = useQuery({ queryKey: ["discovery", "segments"], queryFn: api.discovery.segments });
  const [rows, setRows] = useState([{ name: "", cidrs: "" }]);
  const split = (s: string) =>
    s
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const valid = rows.filter((r) => r.name.trim() && split(r.cidrs).length);
  const save = useMutation({
    mutationFn: async () => {
      for (const r of valid) await api.discovery.createSegment({ name: r.name.trim(), cidrs: split(r.cidrs) });
    },
    onSuccess: onDone,
  });
  const existing = seg.data?.segments ?? [];
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">{t("wiz.ranges.intro")}</p>
      {existing.length > 0 && (
        <ul className="mb-4 space-y-0.5 text-sm text-slate-700">
          {existing.map((s) => (
            <li key={s.id}>
              <Check size={14} className="mr-1 inline text-emerald-600" />
              {s.name} – <span className="font-mono text-xs">{s.cidrs.join(", ")}</span>
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={save.error} />
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr]" data-testid="wiz-range-row">
            <Input placeholder={t("wiz.ranges.name")} aria-label={t("wiz.ranges.name")} value={r.name} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} />
            <Input placeholder="192.0.2.0/24" aria-label={t("wiz.ranges.cidrs")} className="font-mono" value={r.cidrs} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, cidrs: e.target.value } : y)))} />
          </div>
        ))}
      </div>
      <Button variant="secondary" className="mt-2 px-2.5 py-1 text-xs" onClick={() => setRows((r) => [...r, { name: "", cidrs: "" }])}>
        {t("wiz.ranges.add")}
      </Button>
      <p className="mt-3 text-xs text-slate-500">
        {seg.data && (seg.data.scan.allowedCidrs.length ? t("wiz.ranges.allowed", { list: seg.data.scan.allowedCidrs.join(", ") }) : t("wiz.ranges.noneAllowed"))} {t("wiz.ranges.hint")}
      </p>
      <StepActions busy={save.isPending} disabled={!valid.length} onSave={() => save.mutate()} onSkip={onDone} />
    </>
  );
}

/* ---------- 5. první import aktiv ---------- */
function AssetsStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<ImportResultDto | null>(null);
  const form = () => {
    const fd = new FormData();
    fd.set("entity", "assets");
    fd.set("file", file!);
    fd.set("mode", "upsert");
    return fd;
  };
  const preview = useMutation({ mutationFn: () => api.import.preview(form()) });
  const commit = useMutation({ mutationFn: () => api.import.commit(form()), onSuccess: setRes });
  const p: ImportPreviewDto | undefined = preview.data;
  return (
    <>
      <p className="mb-4 text-sm text-slate-600">{t("wiz.assets.intro")}</p>
      <ErrorBox error={preview.error ?? commit.error} />
      <div className="flex flex-wrap items-center gap-3">
        <a href={api.import.templateUrl("assets")} className="text-sm font-medium text-brand-700 hover:underline">
          {t("wiz.assets.template")}
        </a>
        <input
          type="file"
          accept=".xlsx,.csv"
          aria-label={t("wiz.assets.file")}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            preview.reset();
            setRes(null);
          }}
          data-testid="wiz-assets-file"
          className="text-sm"
        />
        <Button variant="secondary" disabled={!file || preview.isPending} onClick={() => preview.mutate()} data-testid="wiz-assets-preview">
          {t("wiz.assets.check")}
        </Button>
      </div>
      {p && !res && (
        <p className="mt-3 text-sm text-slate-700" data-testid="wiz-assets-summary">
          {t("wiz.assets.summary", { create: p.counts.create, update: p.counts.update, errors: p.counts.errors })}
        </p>
      )}
      {res && (
        <p className="mt-3 text-sm text-emerald-700" data-testid="wiz-assets-result">
          {t("wiz.assets.result", { created: res.created, updated: res.updated, failed: res.failed.length })}
        </p>
      )}
      <p className="mt-4 text-xs text-slate-500">
        {t("wiz.assets.other")}{" "}
        <Link to="/admin/connectors" className="text-brand-700 hover:underline">
          {t("wiz.assets.connectors")}
        </Link>
        {" · "}
        <Link to="/import" className="text-brand-700 hover:underline">
          {t("wiz.assets.import")}
        </Link>
      </p>
      <StepActions
        busy={commit.isPending}
        disabled={!res && (!p || p.counts.create + p.counts.update === 0)}
        saveLabel={res ? t("wiz.next") : t("wiz.assets.commit")}
        onSave={() => (res ? onDone() : commit.mutate())}
        onSkip={onDone}
      />
    </>
  );
}
