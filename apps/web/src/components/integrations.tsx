import { Badge, Button, Card, CardHeader, Checkbox, ErrorBox, Field, Input, Select } from "@/components/ui";
import { askConfirm } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { CompanyDto, ConnectorTestResult, JiraConnectionDto, NetboxConnectionDto } from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2 } from "lucide-react";
import { useState } from "react";

function Result({ r }: { r?: ConnectorTestResult }) {
  if (!r) return null;
  return <p className={`rounded-md border px-3 py-2 text-sm ${r.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>{r.message}</p>;
}

/** NetBox a JIRA (v1.53, ADR-150) – Administrace → Konektory. */
export function NetboxJiraCards() {
  const t = useT();
  const q = useQuery({ queryKey: ["admin", "connections"], queryFn: api.admin.connections });
  const companies = useQuery({ queryKey: ["companies"], queryFn: api.companies.list });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card data-testid="netbox">
        <CardHeader title={t("nb.title")} subtitle={t("nb.subtitle")} />
        <div className="space-y-4 p-5">
          {(q.data?.netbox ?? []).map((n) => (
            <NetboxForm key={n.id} n={n} companies={companies.data ?? []} />
          ))}
          <NetboxForm key={`new-${q.data?.netbox.length ?? 0}`} n={null} companies={companies.data ?? []} />
        </div>
      </Card>
      <Card data-testid="jira">
        <CardHeader title={t("jr.title")} subtitle={t("jr.subtitle")} />
        <div className="space-y-4 p-5">
          {(q.data?.jira ?? []).map((j) => (
            <JiraForm key={j.id} j={j} companies={companies.data ?? []} />
          ))}
          <JiraForm key={`new-${q.data?.jira.length ?? 0}`} j={null} companies={companies.data ?? []} />
        </div>
      </Card>
    </div>
  );
}

function useSaved() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["admin", "connections"] });
    qc.invalidateQueries({ queryKey: ["connectors"] });
  };
}

function NetboxForm({ n, companies }: { n: NetboxConnectionDto | null; companies: CompanyDto[] }) {
  const t = useT();
  const done = useSaved();
  const [open, setOpen] = useState(!!n);
  const [f, setF] = useState({ name: n?.name ?? "NetBox", url: n?.url ?? "", token: "", verifyTls: n?.verifyTls ?? true, includeVms: n?.includeVms ?? true, companyId: n?.companyId ?? null, groupMap: n?.groupMap ?? [], autoSyncHours: (n?.autoSyncHours ?? 24) as 0 | 6 | 12 | 24, enabled: n?.enabled ?? true });
  const [map, setMap] = useState((n?.groupMap ?? []).map((m) => `${m.group}=${m.companyId}`).join("\n"));
  const data = () => ({ ...f, groupMap: f.companyId ? [] : map.split("\n").map((l) => l.split("=")).filter((x) => x[0]?.trim() && x[1]?.trim()).map(([g, c]) => ({ group: g!.trim(), companyId: c!.trim() })) });
  const test = useMutation({ mutationFn: () => api.admin.testNetbox({ ...data(), id: n?.id }) });
  const save = useMutation({ mutationFn: () => api.admin.saveNetbox(n?.id ?? null, data()), onSuccess: done });
  const del = useMutation({ mutationFn: async () => n && (await askConfirm(t("cn.deleteConfirm", { name: n.name }), { danger: true })) && api.admin.deleteConnectionOf("netbox", n.id), onSuccess: done });
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("conn.add")} NetBox
      </Button>
    );
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4" data-testid={n ? `netbox-${n.name}` : "netbox-new"}>
      {n && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone={n.enabled ? "green" : "slate"}>{n.enabled ? t("con.zapnuto") : t("con.vypnuto")}</Badge>
          <Badge>{t("nb.assets", { n: n.assets })}</Badge>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("cn.name")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t("nb.url")}>
          <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://netbox.firma.local" />
        </Field>
        <Field label={t("nb.token")} hint={n?.hasToken ? t("con.prazdnePonechatUlozene") : undefined}>
          <Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label={t("cn.scope")}>
          <Select value={f.companyId ?? ""} onChange={(e) => setF({ ...f, companyId: e.target.value || null })}>
            <option value="">{t("cn.scope.group")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {!f.companyId && (
        <Field label={t("nb.tenantMap")} hint={companies.map((c) => `${c.name}: ${c.id}`).join(" · ")}>
          <textarea className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs" rows={2} value={map} onChange={(e) => setMap(e.target.value)} placeholder="zakaznik-c=<id společnosti>" />
        </Field>
      )}
      <Checkbox checked={f.includeVms} onChange={(v) => setF({ ...f, includeVms: v })} label={t("nb.vms")} />
      <Checkbox checked={f.verifyTls} onChange={(v) => setF({ ...f, verifyTls: v })} label={t("con.overovatTlsCertifikat")} />
      <Result r={test.data} />
      <ErrorBox error={test.error ?? save.error ?? del.error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!f.url || test.isPending} onClick={() => test.mutate()}>
          {t("con.otestovatPripojeni")}
        </Button>
        <Button disabled={!f.url || !f.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {t("con.ulozit")}
        </Button>
        {n && (
          <Button variant="ghost" className="ml-auto text-red-700" onClick={() => del.mutate()}>
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}

function JiraForm({ j, companies }: { j: JiraConnectionDto | null; companies: CompanyDto[] }) {
  const t = useT();
  const done = useSaved();
  const [open, setOpen] = useState(!!j);
  const [f, setF] = useState({ name: j?.name ?? "JIRA", url: j?.url ?? "", deployment: (j?.deployment ?? "cloud") as "cloud" | "datacenter", user: j?.user ?? "", token: "", verifyTls: j?.verifyTls ?? true, projectKey: j?.projectKey ?? "", issueType: j?.issueType ?? "Task", companyId: j?.companyId ?? null, enabled: j?.enabled ?? true });
  const [doneSt, setDoneSt] = useState((j?.doneStatuses ?? ["Done", "Hotovo"]).join(", "));
  const data = () => ({ ...f, doneStatuses: doneSt.split(",").map((x) => x.trim()).filter(Boolean) });
  const test = useMutation({ mutationFn: () => api.admin.testJira({ ...data(), id: j?.id }) });
  const save = useMutation({ mutationFn: () => api.admin.saveJira(j?.id ?? null, data()), onSuccess: done });
  const del = useMutation({ mutationFn: async () => j && (await askConfirm(t("cn.deleteConfirm", { name: j.name }), { danger: true })) && api.admin.deleteConnectionOf("jira", j.id), onSuccess: done });
  if (!open)
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("conn.add")} JIRA
      </Button>
    );
  return (
    <div className="space-y-3 rounded-md border border-slate-200 p-4" data-testid={j ? `jira-${j.name}` : "jira-new"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("cn.name")}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t("jr.url")}>
          <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://firma.atlassian.net" />
        </Field>
        <Field label={t("jr.deployment")}>
          <Select value={f.deployment} onChange={(e) => setF({ ...f, deployment: e.target.value as "cloud" | "datacenter" })}>
            <option value="cloud">{t("jr.cloud")}</option>
            <option value="datacenter">{t("jr.dc")}</option>
          </Select>
        </Field>
        {f.deployment === "cloud" && (
          <Field label={t("jr.user")}>
            <Input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} />
          </Field>
        )}
        <Field label={t("nb.token")} hint={j?.hasToken ? t("con.prazdnePonechatUlozene") : undefined}>
          <Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="new-password" />
        </Field>
        <Field label={t("jr.project")}>
          <Input value={f.projectKey} onChange={(e) => setF({ ...f, projectKey: e.target.value.toUpperCase() })} placeholder="SEC" />
        </Field>
        <Field label={t("jr.issueType")}>
          <Input value={f.issueType} onChange={(e) => setF({ ...f, issueType: e.target.value })} />
        </Field>
        <Field label={t("jr.done")}>
          <Input value={doneSt} onChange={(e) => setDoneSt(e.target.value)} />
        </Field>
        <Field label={t("cn.scope")}>
          <Select value={f.companyId ?? ""} onChange={(e) => setF({ ...f, companyId: e.target.value || null })}>
            <option value="">{t("cn.scope.group")}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Result r={test.data} />
      <ErrorBox error={test.error ?? save.error ?? del.error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!f.url || !f.projectKey || test.isPending} onClick={() => test.mutate()}>
          {t("con.otestovatPripojeni")}
        </Button>
        <Button disabled={!f.url || !f.projectKey || !f.name.trim() || save.isPending} onClick={() => save.mutate()}>
          {t("con.ulozit")}
        </Button>
        {j && (
          <Button variant="ghost" className="ml-auto text-red-700" onClick={() => del.mutate()}>
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Issue v JIRA u úkolu (v1.53): odkaz se stavem, nebo tlačítko pro založení. */
export function JiraTaskLink({ taskId }: { taskId: string }) {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["jira", "task", taskId], queryFn: () => api.jira.issues(taskId) });
  const create = useMutation({ mutationFn: () => api.jira.create(taskId), onSuccess: (d) => qc.setQueryData(["jira", "task", taskId], d) });
  const list = q.data ?? [];
  if (!list.length && !can("actions:write")) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="jira-link">
      <span className="text-slate-500">{t("jr.issues")}:</span>
      {list.map((i) => (
        <a key={i.id} href={i.issueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
          {i.issueKey} <ExternalLink size={12} />
          {i.status && <Badge>{i.status}</Badge>}
        </a>
      ))}
      {!list.length && (
        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={create.isPending} onClick={() => create.mutate()}>
          {t("jr.create")}
        </Button>
      )}
      <ErrorBox error={create.error} />
    </div>
  );
}
