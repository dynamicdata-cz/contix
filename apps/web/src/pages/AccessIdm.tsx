import { UserSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, Select, Textarea, toggle, type Tone } from "@/components/ui";
import { askConfirm, toast } from "@/components/ui/overlay";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useUrlParam } from "@/lib/urlState";
import { cn, fmtDay } from "@/lib/utils";
import {
  ACCESS_LABELS,
  IDM_LABELS,
  JML_KINDS,
  type BusinessRoleDto,
  type BusinessRoleInput,
  type JmlKind,
  type JmlPreviewDto,
  type MatrixState,
  type SodConflict,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, ChevronRight, LogIn, LogOut, Pencil, Plus, Repeat, ShieldAlert, Trash2, UserRound, Users, Wand2, X } from "lucide-react";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/* IDM (v1.34, ADR-131): přehled, business role, matice, detail osoby 360°, průvodce nástup / přesun / odchod, SoD při žádosti. */

export type IdmTab = "overview" | "requests" | "grants" | "reviews" | "reconcile" | "provisioning" | "roles" | "matrix" | "resources" | "people";

/** Akce sdílené napříč záložkami: otevřít osobu, žádost, novou žádost s předvyplněním, průvodce JML. */
export interface IdmActions {
  openPerson: (id: string) => void;
  openRequest: (id: string) => void;
  newRequest: (init?: { personId?: string; resourceId?: string; action?: "grant" | "revoke" }) => void;
  jml: (init?: { personId?: string; kind?: JmlKind }) => void;
  goTab: (tab: IdmTab) => void;
}
const Ctx = createContext<IdmActions | null>(null);
export const IdmProvider = ({ value, children }: { value: IdmActions; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useIdm = () => useContext(Ctx);

/** Jméno osoby jako odkaz na detail 360° (mimo správce přístupů jen text). */
export function PersonLink({ id, name, className }: { id: string; name: string; className?: string }) {
  const idm = useIdm();
  if (!idm) return <span className={className}>{name}</span>;
  return (
    <button type="button" className={cn("text-left font-medium text-brand-700 hover:underline dark:text-brand-300", className)} onClick={() => idm.openPerson(id)}>
      {name}
    </button>
  );
}

export function SodWarning({ conflicts, className }: { conflicts: SodConflict[]; className?: string }) {
  const t = useT();
  if (!conflicts.length) return null;
  return (
    <div className={cn("rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200", className)}>
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle size={16} /> {t("idm.sod.title")}
      </div>
      <ul className="mt-1 space-y-1">
        {conflicts.map((c) => (
          <li key={c.ruleId}>
            <span className="font-medium">{c.rule}</span>: {c.sideA.join(", ")} <span className="opacity-70">×</span> {c.sideB.join(", ")}
          </li>
        ))}
      </ul>
      <div className="mt-1 text-xs opacity-80">{t("idm.sod.hint")}</div>
    </div>
  );
}

/* ---------------- přehled ---------------- */

function Tile({ label, value, tone = "slate", hint, onClick }: { label: string; value: number | string; tone?: Tone; hint?: string; onClick?: () => void }) {
  const ring: Record<string, string> = {
    red: "border-red-200 dark:border-red-900",
    amber: "border-amber-200 dark:border-amber-900",
    blue: "border-blue-200 dark:border-blue-900",
    green: "border-green-200 dark:border-green-900",
    slate: "border-slate-200 dark:border-slate-800",
  };
  const txt: Record<string, string> = { red: "text-red-700 dark:text-red-300", amber: "text-amber-700 dark:text-amber-300", blue: "text-blue-700 dark:text-blue-300", green: "text-green-700 dark:text-green-300", slate: "" };
  const active = typeof value === "number" ? value > 0 : true;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn("group rounded-lg border bg-white px-4 py-3 text-left transition dark:bg-slate-900", active ? ring[tone] : ring.slate, onClick && "hover:shadow-sm hover:ring-1 hover:ring-brand-300")}
    >
      <div className="flex items-center justify-between text-xs text-slate-500">
        {label} {onClick && <ChevronRight size={14} className="opacity-0 transition group-hover:opacity-100" />}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", active && txt[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </button>
  );
}

export function OverviewTab() {
  const t = useT();
  const idm = useIdm()!;
  const q = useQuery({ queryKey: ["access", "overview"], queryFn: api.access.overview });
  const d = q.data;
  if (!d) return <ErrorBox error={q.error} />;
  const flow = [
    { k: "pending", n: d.flow.pending, label: t("idm.flow.pending"), tone: "amber", tab: "requests" as const },
    { k: "approved", n: d.flow.approved, label: t("idm.flow.approved"), tone: "blue", tab: "requests" as const },
    { k: "prov", n: d.flow.toProvision, label: t("idm.flow.toProvision"), tone: "blue", tab: "provisioning" as const },
    { k: "done", n: d.flow.done30, label: t("idm.flow.done30"), tone: "green", tab: "grants" as const },
  ];
  const max = Math.max(1, ...flow.map((f) => f.n));
  return (
    <div className="space-y-5">
      <ErrorBox error={q.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t("idm.my.toApprove")} value={d.my.toApprove} tone="amber" onClick={() => idm.goTab("requests")} />
        <Tile label={t("idm.my.toCertify")} value={d.my.toCertify} tone="amber" onClick={() => idm.goTab("reviews")} />
        {d.manage && <Tile label={t("idm.people.total")} value={d.people.total} hint={t("idm.people.hint", { j: d.people.joiners14, l: d.people.leavers14 })} onClick={() => idm.goTab("people")} />}
        {d.manage && (
          <Tile label={t("idm.lastSync")} value={d.lastSyncAt ? fmtDay(d.lastSyncAt) : "—"} tone={d.lastSyncAt ? "slate" : "amber"} hint={d.lastSyncAt ? undefined : t("idm.noSync")} onClick={() => idm.goTab("reconcile")} />
        )}
      </div>
      {!d.manage && <EmptyState>{t("idm.notManager")}</EmptyState>}
      {d.manage && (
        <>
          <Card>
            <CardHeader title={t("idm.flow.title")} subtitle={t("idm.flow.subtitle")} />
            <div className="grid gap-2 px-5 pb-5 sm:grid-cols-4">
              {flow.map((f, i) => (
                <button key={f.k} type="button" onClick={() => idm.goTab(f.tab)} className="group relative rounded-md border border-slate-200 p-3 text-left hover:border-brand-300 dark:border-slate-800">
                  <div className="text-xs text-slate-500">{f.label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{f.n}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                    <div className={cn("h-full rounded", f.tone === "amber" ? "bg-amber-500" : f.tone === "green" ? "bg-green-500" : "bg-blue-500")} style={{ width: `${(f.n / max) * 100}%` }} />
                  </div>
                  {i < flow.length - 1 && <ArrowRight size={16} className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-slate-400 sm:block" />}
                </button>
              ))}
            </div>
          </Card>
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("idm.risks.title")}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label={t("idm.risks.unapproved")} value={d.risks.unapproved} tone="red" hint={t("idm.risks.unapprovedHint")} onClick={() => idm.goTab("reconcile")} />
              <Tile label={t("idm.risks.leaversInAd")} value={d.risks.leaversInAd} tone="red" onClick={() => idm.goTab("reconcile")} />
              <Tile label={t("idm.risks.sodOpen")} value={d.risks.sodOpen} tone="red" onClick={() => (window.location.href = "/identity?tab=sod")} />
              <Tile label={t("idm.risks.certOverdue")} value={d.risks.certOverdue} tone="red" onClick={() => idm.goTab("reviews")} />
              <Tile label={t("idm.risks.unknownAccounts")} value={d.risks.unknownAccounts} tone="amber" hint={t("idm.risks.unknownHint")} onClick={() => idm.goTab("reconcile")} />
              <Tile label={t("idm.risks.adMissing")} value={d.risks.adMissing} tone="amber" hint={t("idm.risks.adMissingHint")} onClick={() => idm.goTab("provisioning")} />
              <Tile label={t("idm.risks.roleGaps")} value={d.risks.roleGaps} tone="blue" hint={t("idm.risks.roleGapsHint")} onClick={() => idm.goTab("roles")} />
              <Tile label={t("idm.risks.expiring14")} value={d.risks.expiring14} tone="amber" hint={t("idm.risks.privileged", { n: d.risks.privilegedGrants })} onClick={() => idm.goTab("grants")} />
            </div>
          </div>
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader
                title={t("idm.upcoming")}
                action={
                  <Button variant="secondary" onClick={() => idm.jml()}>
                    <Wand2 size={16} /> {t("idm.jml.open")}
                  </Button>
                }
              />
              {!d.upcoming.length ? (
                <EmptyState>{t("idm.upcomingNone")}</EmptyState>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {d.upcoming.map((u, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
                      <span className="w-24 tabular-nums text-slate-500">{fmtDay(u.date)}</span>
                      <Badge tone={u.kind === "joiner" ? "blue" : u.kind === "leaver" ? "slate" : "amber"}>{t(`idm.up.${u.kind}`)}</Badge>
                      <PersonLink id={u.personId} name={u.person} />
                      {u.detail && <span className="text-slate-500">{u.detail}</span>}
                      {u.kind !== "expiry" && (
                        <Button variant="ghost" className="ml-auto px-2 text-xs" onClick={() => idm.jml({ personId: u.personId, kind: u.kind === "joiner" ? "joiner" : "leaver" })}>
                          {u.kind === "joiner" ? t("idm.jml.prepareJoiner") : t("idm.jml.prepareLeaver")}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title={t("idm.dataQuality")} />
              <dl className="space-y-2 px-5 pb-5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">{t("idm.people.withoutManager")}</dt>
                  <dd className={cn("tabular-nums", d.people.withoutManager > 0 && "font-semibold text-amber-700 dark:text-amber-300")}>{d.people.withoutManager}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">{t("idm.people.withoutAccount")}</dt>
                  <dd className="tabular-nums">{d.people.withoutAccount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">{t("idm.flow.rejected30")}</dt>
                  <dd className="tabular-nums">{d.flow.rejected30}</dd>
                </div>
              </dl>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- business role ---------------- */

const emptyRole = (): BusinessRoleInput => ({ name: "", description: "", ownerId: null, department: "", jobTitle: "", active: true, resourceIds: [] });

export function RolesTab({ manage }: { manage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "roles"], queryFn: api.access.roles });
  const [edit, setEdit] = useState<{ id: string | null; f: BusinessRoleInput } | null>(null);
  const [gapsOf, setGapsOf] = useState<BusinessRoleDto | null>(null);
  const remove = useMutation({ mutationFn: api.access.removeRole, onSuccess: () => qc.invalidateQueries({ queryKey: ["access"] }) });
  return (
    <Card>
      <CardHeader
        title={t("idm.roles.title")}
        subtitle={t("idm.roles.subtitle")}
        action={
          manage && (
            <Button onClick={() => setEdit({ id: null, f: emptyRole() })}>
              <Plus size={16} /> {t("idm.roles.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error ?? remove.error} />
      {q.data && !q.data.length && <EmptyState>{t("idm.roles.empty")}</EmptyState>}
      <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
        {q.data?.map((r) => (
          <div key={r.id} className={cn("rounded-lg border border-slate-200 p-4 dark:border-slate-800", !r.active && "opacity-60")}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {r.name} {!r.active && <Badge tone="slate">{t("idm.roles.inactive")}</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {r.department || r.jobTitle ? [r.department && `${t("acc.department")}: ${r.department}`, r.jobTitle && `${t("acc.jobTitle")}: ${r.jobTitle}`].filter(Boolean).join(" · ") : t("idm.roles.noCriteria")}
                  {r.ownerName && ` · ${t("idm.roles.owner")}: ${r.ownerName}`}
                </div>
              </div>
              {manage && (
                <>
                  <Button
                    variant="ghost"
                    className="px-2"
                    title={t("acc.edit")}
                    onClick={() => setEdit({ id: r.id, f: { name: r.name, description: r.description ?? "", ownerId: r.ownerId, department: r.department ?? "", jobTitle: r.jobTitle ?? "", active: r.active, resourceIds: r.resources.map((x) => x.id) } })}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button variant="ghost" className="px-2 text-red-600" title={t("acc.delete")} onClick={async () => (await askConfirm(t("idm.roles.deleteConfirm", { name: r.name }), { danger: true })) && remove.mutate(r.id)}>
                    <Trash2 size={15} />
                  </Button>
                </>
              )}
            </div>
            {r.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{r.description}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {r.resources.map((x) => (
                <span key={x.id} className={cn("inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800", !x.active && "line-through opacity-60")}>
                  {x.privileged && <ShieldAlert size={12} className="text-amber-600" />} {x.name}
                </span>
              ))}
              {!r.resources.length && <span className="text-xs text-slate-500">{t("idm.roles.noResources")}</span>}
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Users size={14} /> {t("idm.roles.members", { n: r.members })}
              </span>
              {r.gaps > 0 ? (
                manage ? (
                  <button type="button" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline dark:text-blue-300" onClick={() => setGapsOf(r)}>
                    <Wand2 size={14} /> {t("idm.roles.gaps", { n: r.gaps })}
                  </button>
                ) : (
                  <span className="text-blue-700 dark:text-blue-300">{t("idm.roles.gaps", { n: r.gaps })}</span>
                )
              ) : (
                r.members > 0 && (
                  <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300">
                    <Check size={14} /> {t("idm.roles.complete")}
                  </span>
                )
              )}
            </div>
          </div>
        ))}
      </div>
      {edit && <RoleModal edit={edit} onClose={() => setEdit(null)} />}
      {gapsOf && <RoleGapsModal role={gapsOf} onClose={() => setGapsOf(null)} />}
    </Card>
  );
}

function RoleModal({ edit, onClose }: { edit: { id: string | null; f: BusinessRoleInput }; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState(edit.f);
  const [search, setSearch] = useState("");
  const resources = useQuery({ queryKey: ["access", "resources"], queryFn: api.access.resources });
  const people = useQuery({ queryKey: ["access", "people"], queryFn: api.access.people });
  const users = useQuery({ queryKey: ["directory-users"], queryFn: api.directory.users });
  const depts = useMemo(() => [...new Set((people.data ?? []).map((p) => p.department).filter(Boolean))].sort() as string[], [people.data]);
  const titles = useMemo(() => [...new Set((people.data ?? []).map((p) => p.jobTitle).filter(Boolean))].sort() as string[], [people.data]);
  const matches = (people.data ?? []).filter(
    (p) => p.status !== "leaver" && (f.department || f.jobTitle) && (!f.department || (p.department ?? "").toLowerCase() === f.department.trim().toLowerCase()) && (!f.jobTitle || (p.jobTitle ?? "").toLowerCase() === f.jobTitle.trim().toLowerCase()),
  );
  const save = useMutation({
    mutationFn: () => (edit.id ? api.access.updateRole(edit.id, f) : api.access.createRole(f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(t("acc.saved"));
      onClose();
    },
  });
  const s = search.trim().toLowerCase();
  const list = (resources.data ?? []).filter((r) => r.active || f.resourceIds?.includes(r.id)).filter((r) => !s || `${r.name} ${r.adGroup ?? ""}`.toLowerCase().includes(s));
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={edit.id ? t("idm.roles.edit") : t("idm.roles.new")}
      footer={
        <Button disabled={f.name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
          {t("acc.save")}
        </Button>
      }
    >
      <div className="space-y-3">
        <ErrorBox error={save.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("idm.roles.name")}>
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("idm.roles.namePh")} />
          </Field>
          <Field label={t("idm.roles.owner")}>
            <UserSelect value={(f.ownerId ?? "") || null} onChange={(v) => setF({ ...f, ownerId: v })} emptyLabel="—" />
          </Field>
        </div>
        <Field label={t("acc.description")}>
          <Textarea rows={2} value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="mb-2 text-sm font-medium">{t("idm.roles.criteria")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("acc.department")}>
              <Input list="idm-depts" value={f.department ?? ""} onChange={(e) => setF({ ...f, department: e.target.value })} />
            </Field>
            <Field label={t("acc.jobTitle")}>
              <Input list="idm-titles" value={f.jobTitle ?? ""} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} />
            </Field>
          </div>
          <datalist id="idm-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
          <datalist id="idm-titles">{titles.map((d) => <option key={d} value={d} />)}</datalist>
          <p className="mt-2 text-xs text-slate-500">
            {f.department || f.jobTitle ? t("idm.roles.matchCount", { n: matches.length }) : t("idm.roles.criteriaHint")}
            {matches.length > 0 && `: ${matches.slice(0, 6).map((p) => p.name).join(", ")}${matches.length > 6 ? "…" : ""}`}
          </p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("idm.roles.resources", { n: f.resourceIds?.length ?? 0 })}</span>
            <Input className="max-w-56" placeholder={t("idm.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 p-2 dark:border-slate-800">
            {list.map((r) => (
              <Checkbox
                key={r.id}
                checked={!!f.resourceIds?.includes(r.id)}
                onChange={(on) => setF({ ...f, resourceIds: toggle(f.resourceIds ?? [], r.id, on) })}
                label={
                  <span className="inline-flex items-center gap-1">
                    {r.privileged && <ShieldAlert size={13} className="text-amber-600" />} {r.name} <span className="text-xs text-slate-500">· {t.lbl(ACCESS_LABELS.resourceKind[r.kind])}</span>
                  </span>
                }
              />
            ))}
            {!list.length && <div className="p-2 text-sm text-slate-500">{t("acc.noResources")}</div>}
          </div>
        </div>
        <Checkbox checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} label={t("idm.roles.active")} />
      </div>
    </Modal>
  );
}

function RoleGapsModal({ role, onClose }: { role: BusinessRoleDto; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "roles", role.id, "gaps"], queryFn: () => api.access.roleGaps(role.id) });
  const byPerson = useMemo(() => {
    const m = new Map<string, { name: string; items: string[] }>();
    for (const g of q.data ?? []) m.set(g.personId, { name: g.personName, items: [...(m.get(g.personId)?.items ?? []), g.resourceName] });
    return [...m.entries()];
  }, [q.data]);
  const [sel, setSel] = useState<string[] | null>(null);
  const chosen = sel ?? byPerson.map(([id]) => id);
  const fill = useMutation({
    mutationFn: () => api.access.fillRole(role.id, chosen),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(t("idm.roles.filled", { n: r.requests }) + (r.skipped ? ` ${t("idm.roles.skipped", { n: r.skipped })}` : ""));
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("idm.roles.gapsTitle", { name: role.name })}
      footer={
        <Button disabled={!chosen.length || fill.isPending} onClick={() => fill.mutate()}>
          <Wand2 size={16} /> {t("idm.roles.fill", { n: chosen.length })}
        </Button>
      }
    >
      <ErrorBox error={q.error ?? fill.error} />
      <p className="mb-3 text-sm text-slate-500">{t("idm.roles.fillHint")}</p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {byPerson.map(([id, p]) => (
          <li key={id} className="py-2">
            <Checkbox checked={chosen.includes(id)} onChange={(on) => setSel(toggle(chosen, id, on))} label={<PersonLink id={id} name={p.name} />} hint={p.items.join(", ")} />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ---------------- matice ---------------- */

const cellStyle: Record<MatrixState, string> = {
  ok: "bg-green-500 text-white",
  granted: "bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100",
  ad_missing: "bg-amber-300 text-amber-950",
  ad_only: "bg-red-500 text-white",
  pending: "bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  revoking: "bg-slate-400 text-white line-through",
  expected: "border-2 border-dashed border-blue-400 text-blue-600",
};
const cellMark: Record<MatrixState, string> = { ok: "✓", granted: "✓", ad_missing: "!", ad_only: "✕", pending: "…", revoking: "−", expected: "+" };

export function MatrixTab() {
  const t = useT();
  const idm = useIdm()!;
  const [dept, setDept] = useUrlParam<string>("dept", "");
  const [roleId, setRoleId] = useUrlParam<string>("role", "");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const roles = useQuery({ queryKey: ["access", "roles"], queryFn: api.access.roles });
  const m = useQuery({ queryKey: ["access", "matrix", dept, roleId, q], queryFn: () => api.access.matrix({ department: dept, roleId, q }) });
  const [cell, setCell] = useState<{ personId: string; resourceId: string; state: MatrixState | null } | null>(null);
  const d = m.data;
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <Field label={t("acc.department")} className="w-56">
          <Select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">{t("idm.matrix.allDepts")}</option>
            {d?.departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("idm.matrix.role")} className="w-56">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">—</option>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(search);
          }}
        >
          <Field label={t("idm.search")} className="w-56">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => setQ(search)} />
          </Field>
        </form>
        <div className="ml-auto flex flex-wrap gap-2 text-xs">
          {(["ok", "granted", "ad_missing", "ad_only", "pending", "revoking", "expected"] as MatrixState[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded text-[10px]", cellStyle[s])}>{cellMark[s]}</span> {t(`idm.matrix.s.${s}`)}
            </span>
          ))}
        </div>
      </div>
      <ErrorBox error={m.error} />
      {d && (!d.people.length || !d.resources.length) && <EmptyState>{t("idm.matrix.empty")}</EmptyState>}
      {d && d.people.length > 0 && d.resources.length > 0 && (
        <div className="max-h-[70vh] overflow-auto">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-56 border-b border-slate-200 bg-white px-3 py-2 text-left align-bottom text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                  {t("idm.matrix.counts", { p: d.people.length, r: d.resources.length })}
                </th>
                {d.resources.map((r) => (
                  <th key={r.id} className="sticky top-0 z-10 h-40 w-8 border-b border-slate-200 bg-white px-1 align-bottom dark:border-slate-800 dark:bg-slate-900" title={r.adGroup ?? r.name}>
                    <div className="mx-auto flex max-h-36 items-center gap-1 overflow-hidden whitespace-nowrap text-xs font-medium [writing-mode:vertical-rl] rotate-180">
                      {r.privileged && <ShieldAlert size={12} className="text-amber-600" />} {r.name}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.people.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-1 dark:border-slate-800 dark:bg-slate-900">
                    <PersonLink id={p.id} name={p.name} className="text-sm" />
                    <div className="truncate text-xs text-slate-500">{[p.jobTitle, !dept && p.department].filter(Boolean).join(" · ")}</div>
                  </td>
                  {d.resources.map((r) => {
                    const s = d.cells[`${p.id}:${r.id}`] ?? null;
                    return (
                      <td key={r.id} className="border-b border-slate-100 p-0.5 text-center dark:border-slate-800">
                        <button
                          type="button"
                          title={`${p.name} – ${r.name}${s ? `: ${t(`idm.matrix.s.${s}`)}` : ""}`}
                          onClick={() => setCell({ personId: p.id, resourceId: r.id, state: s })}
                          className={cn("h-6 w-6 rounded text-xs font-semibold transition hover:ring-2 hover:ring-brand-400", s ? cellStyle[s] : "bg-slate-50 text-transparent hover:text-slate-400 dark:bg-slate-800/50")}
                        >
                          {s ? cellMark[s] : "+"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {d.truncated && <div className="px-5 py-2 text-xs text-slate-500">{t("idm.matrix.truncated")}</div>}
        </div>
      )}
      {cell && d && (
        <CellModal
          person={d.people.find((p) => p.id === cell.personId)!}
          resource={d.resources.find((r) => r.id === cell.resourceId)!}
          state={cell.state}
          onClose={() => setCell(null)}
          onAction={(action) => {
            setCell(null);
            if (action === "person") idm.openPerson(cell.personId);
            else idm.newRequest({ personId: cell.personId, resourceId: cell.resourceId, action });
          }}
        />
      )}
    </Card>
  );
}

function CellModal({ person, resource, state, onClose, onAction }: { person: { name: string }; resource: { name: string; adGroup: string | null }; state: MatrixState | null; onClose: () => void; onAction: (a: "grant" | "revoke" | "person") => void }) {
  const t = useT();
  const has = state === "ok" || state === "granted" || state === "ad_missing";
  return (
    <Modal open onClose={onClose} title={`${person.name} – ${resource.name}`}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          {state ? <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-xs", cellStyle[state])}>{cellMark[state]}</span> : null}
          <span className="font-medium">{state ? t(`idm.matrix.s.${state}`) : t("idm.matrix.none")}</span>
        </div>
        <p className="text-slate-500">{t(`idm.matrix.d.${state ?? "none"}`)}</p>
        {resource.adGroup && <div className="break-all font-mono text-xs text-slate-500">{resource.adGroup}</div>}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onAction("person")}>
            <UserRound size={16} /> {t("idm.person.open")}
          </Button>
          {has && (
            <Button variant="secondary" className="text-red-700" onClick={() => onAction("revoke")}>
              <X size={16} /> {t("idm.requestRevoke")}
            </Button>
          )}
          {(state === null || state === "expected" || state === "ad_only") && (
            <Button onClick={() => onAction("grant")}>
              <Plus size={16} /> {state === "ad_only" ? t("idm.requestLegalize") : t("idm.requestGrant")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- detail osoby 360° ---------------- */

const personTone = { joiner: "blue", active: "green", leaver: "slate" } as const;
const reqTone: Record<string, Tone> = { pending: "amber", approved: "blue", rejected: "red", cancelled: "slate", done: "green" };

export function PersonModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const idm = useIdm()!;
  const q = useQuery({ queryKey: ["access", "person", id], queryFn: () => api.access.personOverview(id) });
  const revoke = useMutation({
    mutationFn: (resourceId: string) => api.access.createRequest({ personId: id, resourceId, action: "revoke", justification: t("idm.person.revokeJust") }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(t("acc.submitted"));
      idm.openRequest(r.id);
    },
  });
  const d = q.data;
  const p = d?.person;
  const section = (title: string, n?: number) => (
    <div className="mb-2 mt-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {title} {n !== undefined && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-slate-800">{n}</span>}
    </div>
  );
  return (
    <Modal open onClose={onClose} wide title={p?.name ?? t("acc.person")}>
      <ErrorBox error={q.error ?? revoke.error} />
      {d && p && (
        <div className="text-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
              {p.name
                .split(" ")
                .map((x) => x[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={personTone[p.status]}>{t.lbl(ACCESS_LABELS.personStatus[p.status])}</Badge>
                <span className="text-slate-500">{t.lbl(ACCESS_LABELS.personKind[p.kind as keyof typeof ACCESS_LABELS.personKind] ?? p.kind)}</span>
                {p.personalNumber && <span className="text-slate-500">#{p.personalNumber}</span>}
              </div>
              <div className="mt-1">{[p.jobTitle, p.department].filter(Boolean).join(" · ") || "—"}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {[p.email, p.login].filter(Boolean).join(" · ")}
                {p.startDate && ` · ${t("acc.startDate")} ${fmtDay(p.startDate)}`}
                {p.endDate && ` · ${t("acc.endDate")} ${fmtDay(p.endDate)}`}
              </div>
              {p.managerId && (
                <div className="mt-0.5 text-xs">
                  {t("acc.manager")}: <PersonLink id={p.managerId} name={p.managerName ?? "—"} className="text-xs" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {p.status !== "leaver" && (
                <Button onClick={() => idm.newRequest({ personId: p.id })}>
                  <Plus size={16} /> {t("acc.newRequest")}
                </Button>
              )}
              <Button variant="secondary" onClick={() => idm.jml({ personId: p.id, kind: p.status === "joiner" ? "joiner" : "mover" })}>
                <Repeat size={16} /> {t("idm.jml.short")}
              </Button>
              {p.status !== "leaver" && (
                <Button variant="ghost" className="text-red-700" onClick={() => idm.jml({ personId: p.id, kind: "leaver" })}>
                  <LogOut size={16} /> {t("idm.jml.k.leaver")}
                </Button>
              )}
            </div>
          </div>

          {d.sod.length > 0 && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={16} /> {t("idm.person.sod")}
              </div>
              {d.sod.map((s, i) => (
                <div key={i}>
                  {s.rule} · {s.status}
                </div>
              ))}
            </div>
          )}

          {section(t("idm.person.roles"), d.roles.length)}
          {!d.roles.length ? (
            <div className="text-slate-500">{t("idm.person.noRoles")}</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {d.roles.map((r) => (
                <span key={r.id} className={cn("rounded-md border px-2 py-1", r.missing.length ? "border-blue-300 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40" : "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40")}>
                  <span className="font-medium">{r.name}</span> {r.missing.length ? <span className="text-xs text-blue-700 dark:text-blue-300">· {t("idm.person.missing", { list: r.missing.join(", ") })}</span> : <Check size={13} className="inline text-green-600" />}
                </span>
              ))}
            </div>
          )}

          {section(t("idm.person.grants"), d.grants.length)}
          {!d.grants.length ? (
            <div className="text-slate-500">{t("acc.noGrants")}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-1.5 pr-3">{t("acc.resource")}</th>
                    <th className="py-1.5 pr-3">{t("idm.person.why")}</th>
                    <th className="py-1.5 pr-3">{t("acc.since")}</th>
                    <th className="py-1.5 pr-3">{t("acc.validUntil")}</th>
                    <th className="py-1.5 pr-3">AD</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.grants.map((g) => (
                    <tr key={g.id} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 pr-3">
                        {g.privileged && <ShieldAlert size={13} className="mr-1 inline text-amber-600" />}
                        {g.name}
                      </td>
                      <td className="py-1.5 pr-3 text-xs text-slate-500">{g.roles.length ? g.roles.join(", ") : g.origin ? t.lbl(ACCESS_LABELS.origin[g.origin as keyof typeof ACCESS_LABELS.origin] ?? g.origin) : t("idm.person.adopted")}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{fmtDay(g.since)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{g.validUntil ? fmtDay(g.validUntil) : t("acc.unlimited")}</td>
                      <td className="py-1.5 pr-3">
                        {g.inAd === null ? <span className="text-slate-400">—</span> : g.inAd ? <Check size={15} className="text-green-600" /> : <span className="text-xs font-medium text-amber-700">{t("idm.person.notInAd")}</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        {g.revoking ? (
                          <Badge tone="slate">{t("idm.person.revoking")}</Badge>
                        ) : (
                          <span className="flex justify-end gap-1">
                            {g.validUntil && (
                              <Button variant="ghost" className="px-2 text-xs" onClick={() => idm.newRequest({ personId: p.id, resourceId: g.resourceId, action: "grant" })}>
                                {t("idm.person.extend")}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              className="px-2 text-xs text-red-700"
                              disabled={revoke.isPending}
                              onClick={async () => (await askConfirm(t("idm.person.revokeConfirm", { name: g.name }))) && revoke.mutate(g.resourceId)}
                            >
                              {t("idm.revoke")}
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {section(t("idm.person.accounts"), d.accounts.length)}
          {!d.accounts.length ? (
            <div className="text-slate-500">{t("idm.person.noAccount")}</div>
          ) : (
            d.accounts.map((a) => (
              <div key={a.id} className="mb-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2">
                  <LogIn size={14} className="text-slate-400" />
                  <span className="font-mono text-xs">{a.login}</span>
                  <span className="text-xs text-slate-500">{a.source}</span>
                  <Badge tone={a.enabled ? "green" : "slate"}>{a.enabled ? t("idm.person.enabled") : t("idm.person.disabled")}</Badge>
                  {a.lastLogonAt && <span className="text-xs text-slate-500">{t("idm.person.lastLogon", { d: fmtDay(a.lastLogonAt) })}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.groups.map((g) => (
                    <span
                      key={g.name}
                      title={g.resourceId ? (g.approved ? t("idm.person.gApproved") : t("idm.person.gUnapproved")) : t("idm.person.gOutside")}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs",
                        !g.resourceId ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : g.approved ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200" : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
                      )}
                    >
                      {g.name.replace(/^CN=((?:\\,|[^,])+),.*$/i, "$1")}
                    </span>
                  ))}
                  {!a.groups.length && <span className="text-xs text-slate-500">—</span>}
                </div>
              </div>
            ))
          )}

          <div className="grid gap-x-6 md:grid-cols-2">
            <div>
              {section(t("idm.person.requests"), d.requests.length)}
              <ul className="space-y-1">
                {d.requests.slice(0, 15).map((r) => (
                  <li key={r.id}>
                    <button type="button" className="flex w-full flex-wrap items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => idm.openRequest(r.id)}>
                      <Badge tone={reqTone[r.status] ?? "slate"}>{t.lbl(ACCESS_LABELS.status[r.status])}</Badge>
                      <span>{t.lbl(ACCESS_LABELS.action[r.action as "grant" | "revoke"])}</span>
                      <span className="font-medium">{r.resourceName}</span>
                      <span className="ml-auto text-xs text-slate-500">{fmtDay(r.createdAt)}</span>
                    </button>
                  </li>
                ))}
                {!d.requests.length && <li className="text-slate-500">—</li>}
              </ul>
            </div>
            <div>
              {d.reports.length > 0 && (
                <>
                  {section(t("idm.person.reports"), d.reports.length)}
                  <div className="flex flex-wrap gap-2">
                    {d.reports.map((r) => (
                      <PersonLink key={r.id} id={r.id} name={r.name} className="text-sm" />
                    ))}
                  </div>
                </>
              )}
              {section(t("idm.person.history"))}
              <ol className="space-y-1 border-l border-slate-200 pl-3 dark:border-slate-700">
                {d.history.slice(0, 15).map((h, i) => (
                  <li key={i} className="text-xs">
                    <span className="tabular-nums text-slate-500">{fmtDay(h.at)}</span> · {h.text}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- průvodce nástup / přesun / odchod ---------------- */

const jmlIcon = { joiner: LogIn, mover: Repeat, leaver: LogOut };

export function JmlWizard({ init, onClose }: { init: { personId?: string; kind?: JmlKind }; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const idm = useIdm()!;
  const people = useQuery({ queryKey: ["access", "people"], queryFn: api.access.people });
  const [kind, setKind] = useState<JmlKind>(init.kind ?? "joiner");
  const [personId, setPersonId] = useState(init.personId ?? "");
  const person = people.data?.find((p) => p.id === personId);
  const [department, setDepartment] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [justification, setJustification] = useState("");
  const [plan, setPlan] = useState<JmlPreviewDto | null>(null);
  const [add, setAdd] = useState<string[]>([]);
  const [remove, setRemove] = useState<string[]>([]);
  const depts = useMemo(() => [...new Set((people.data ?? []).map((p) => p.department).filter(Boolean))].sort() as string[], [people.data]);
  const titles = useMemo(() => [...new Set((people.data ?? []).map((p) => p.jobTitle).filter(Boolean))].sort() as string[], [people.data]);
  const input = { personId, kind, department: kind === "mover" ? department || null : null, jobTitle: kind === "mover" ? jobTitle || null : null, endDate: kind === "leaver" ? endDate : null };
  const preview = useMutation({
    mutationFn: () => api.access.jmlPreview(input),
    onSuccess: (p) => {
      setPlan(p);
      setAdd(p.add.filter((x) => x.suggested).map((x) => x.resourceId));
      setRemove(p.remove.filter((x) => x.suggested).map((x) => x.resourceId));
    },
  });
  const apply = useMutation({
    mutationFn: () => api.access.jmlApply({ ...input, add, remove, justification: justification || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(r.scheduled ? t("idm.jml.scheduled", { d: fmtDay(endDate) }) : t("idm.jml.done", { n: r.requests }));
      onClose();
      idm.openPerson(personId);
    },
  });
  const candidates = (people.data ?? [])
    .filter((p) => (kind === "leaver" ? p.status !== "leaver" : p.status !== "leaver"))
    .sort((a, b) => (kind === "joiner" ? Number(b.status === "joiner") - Number(a.status === "joiner") || a.grants - b.grants : 0) || a.name.localeCompare(b.name));
  const ready = !!personId && (kind !== "mover" || !!(department || jobTitle)) && (kind !== "leaver" || !!endDate);
  const future = kind === "leaver" && endDate > new Date().toISOString().slice(0, 10);
  const list = (title: string, items: JmlPreviewDto["add"], sel: string[] | null, setSel: ((v: string[]) => void) | null, tone: string) => (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({items.length})
      </div>
      {!items.length ? (
        <div className="text-sm text-slate-500">—</div>
      ) : (
        <ul className={cn("space-y-1 rounded-md border p-2", tone)}>
          {items.map((x) => (
            <li key={x.resourceId}>
              {sel && setSel ? (
                <Checkbox
                  checked={sel.includes(x.resourceId)}
                  disabled={x.note === "open" || (future && setSel === setRemove)}
                  onChange={(on) => setSel(toggle(sel, x.resourceId, on))}
                  label={
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {x.privileged && <ShieldAlert size={13} className="text-amber-600" />} {x.name}
                      {x.sod.length > 0 && (
                        <Badge tone="red">
                          <AlertTriangle size={11} className="mr-0.5 inline" />
                          SoD
                        </Badge>
                      )}
                    </span>
                  }
                  hint={[x.roles.length ? t("idm.jml.fromRoles", { list: x.roles.join(", ") }) : null, x.note === "open" ? t("idm.jml.openReq") : x.note === "outside" ? t("idm.jml.outside") : null, x.sod.map((s) => s.rule).join(", ") || null].filter(Boolean).join(" · ")}
                />
              ) : (
                <span className="text-sm">
                  {x.name} {x.roles.length > 0 && <span className="text-xs text-slate-500">· {x.roles.join(", ")}</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("idm.jml.title")}
      footer={
        plan ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => setPlan(null)}>
              {t("idm.jml.back")}
            </Button>
            <Button disabled={apply.isPending || (!future && !add.length && !remove.length && kind !== "leaver")} onClick={() => apply.mutate()}>
              <Check size={16} /> {future ? t("idm.jml.applyScheduled") : t("idm.jml.apply", { n: add.length + remove.length })}
            </Button>
          </div>
        ) : (
          <Button disabled={!ready || preview.isPending} onClick={() => preview.mutate()}>
            {t("idm.jml.preview")} <ArrowRight size={16} />
          </Button>
        )
      }
    >
      <ErrorBox error={people.error ?? preview.error ?? apply.error} />
      {!plan ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            {JML_KINDS.map((k) => {
              const Icon = jmlIcon[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn("rounded-lg border p-3 text-left transition", kind === k ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-950/40" : "border-slate-200 hover:border-brand-300 dark:border-slate-800")}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon size={16} /> {t.lbl(IDM_LABELS.jml[k])}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{t(`idm.jml.d.${k}`)}</div>
                </button>
              );
            })}
          </div>
          <Field label={t("acc.person")}>
            <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">—</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.jobTitle || p.department ? ` (${[p.jobTitle, p.department].filter(Boolean).join(", ")})` : ""}
                  {p.status === "joiner" ? ` · ${t.lbl(ACCESS_LABELS.personStatus.joiner)}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          {person && (
            <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              {[person.jobTitle, person.department].filter(Boolean).join(" · ") || "—"} · {t("acc.manager")}: {person.managerName ?? "—"} · {t("idm.jml.grants", { n: person.grants })}
            </div>
          )}
          {kind === "mover" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("idm.jml.newDept")} hint={person?.department ? t("idm.jml.now", { v: person.department }) : undefined}>
                <Input list="jml-depts" value={department} onChange={(e) => setDepartment(e.target.value)} />
              </Field>
              <Field label={t("idm.jml.newTitle")} hint={person?.jobTitle ? t("idm.jml.now", { v: person.jobTitle }) : undefined}>
                <Input list="jml-titles" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
              </Field>
              <datalist id="jml-depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
              <datalist id="jml-titles">{titles.map((d) => <option key={d} value={d} />)}</datalist>
            </div>
          )}
          {kind === "leaver" && (
            <Field label={t("acc.endDate")} hint={t("idm.jml.endHint")}>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          )}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{plan.person.name}</span>
            <Badge tone="blue">{t.lbl(IDM_LABELS.jml[plan.kind])}</Badge>
            <span className="text-slate-500">
              {t("idm.jml.roles")}:{" "}
              {plan.kind === "joiner" ? (
                plan.rolesAfter.join(", ") || "—"
              ) : (
                <>
                  {plan.rolesBefore.join(", ") || "—"} <ArrowRight size={13} className="inline" /> {plan.kind === "leaver" ? "—" : plan.rolesAfter.join(", ") || "—"}
                </>
              )}
            </span>
          </div>
          {!plan.rolesAfter.length && plan.kind !== "leaver" && <div className="rounded-md bg-amber-50 p-3 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{t("idm.jml.noRoles")}</div>}
          {future && <div className="rounded-md bg-blue-50 p-3 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">{t("idm.jml.futureHint", { d: fmtDay(endDate) })}</div>}
          <SodWarning conflicts={plan.add.filter((x) => add.includes(x.resourceId)).flatMap((x) => x.sod)} />
          <div className="grid gap-4 md:grid-cols-2">
            {plan.kind !== "leaver" && list(t("idm.jml.add"), plan.add, add, setAdd, "border-green-200 dark:border-green-900")}
            {plan.kind !== "joiner" && list(t("idm.jml.remove"), plan.remove, remove, setRemove, "border-red-200 dark:border-red-900")}
            {plan.kind !== "leaver" && list(t("idm.jml.keep"), plan.keep, null, null, "border-slate-200 dark:border-slate-800")}
          </div>
          {plan.cancelRequests > 0 && !future && <p className="text-slate-500">{t("idm.jml.cancelReq", { n: plan.cancelRequests })}</p>}
          <Field label={t("idm.jml.justification")} hint={t("idm.jml.justHint")}>
            <Textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-500">{t("idm.jml.flowHint")}</p>
        </div>
      )}
    </Modal>
  );
}
