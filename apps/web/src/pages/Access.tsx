import { UserSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Textarea, type Tone, Kpi as UiKpi } from "@/components/ui";
import { ProcessGuide } from "@/components/processGuide";
import { askConfirm, toast } from "@/components/ui/overlay";
import { Tabs, useTab } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useUrlParam } from "@/lib/urlState";
import { cn, fmtDay } from "@/lib/utils";
import {
  ACCESS_LABELS,
  PERSON_KINDS,
  RESOURCE_KINDS,
  ACCESS_LABELS as AL,
  CERT_REVIEWERS,
  RECON_LABELS,
  PROVISIONING_LABELS,
  PROVISIONING_MODES,
  allowedOuError,
  bindAccountError,
  parentDn,
  type AdGroupDto,
  type ProvisioningResult,
  type ProvisioningSettingsInput,
  type ReconType,
  type AccessRequestDto,
  type CertificationDto,
  type CertificationInput,
  type AccessResourceDto,
  type AccessResourceInput,
  type PeopleImportDto,
  type PersonDto,
  type PersonInput,
  type RequestStatus,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FileUp, FolderInput, Lock, Pencil, Play, Plus, RefreshCw, ShieldAlert, Trash2, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { IdmProvider, JmlWizard, MatrixTab, OverviewTab, PersonLink, PersonModal, RolesTab, SodWarning, type IdmActions } from "./AccessIdm";
import type { JmlKind } from "@contix/shared";

/* Žádosti o přístup (v1.26, ADR-123): žádosti, přidělená oprávnění, katalog oprávnění, osoby a import z personalistiky. */

const statusTone: Record<RequestStatus, Tone> = { pending: "amber", approved: "blue", rejected: "red", cancelled: "slate", done: "green" };
const personTone = { joiner: "blue", active: "green", leaver: "slate" } as const;

export function AccessPage() {
  const t = useT();
  const sum = useQuery({ queryKey: ["access", "summary"], queryFn: api.access.summary });
  const manage = !!sum.data?.manage;
  const [tab, setTab] = useTab(["overview", "requests", "grants", "reviews", "reconcile", "provisioning", "roles", "matrix", "resources", "people"] as const, "overview");
  const [reqId, setReqId] = useUrlParam("request");
  const [personId, setPersonId] = useUrlParam("person");
  const [creating, setCreating] = useState<{ personId?: string; resourceId?: string; action?: "grant" | "revoke" } | null>(null);
  const [jml, setJml] = useState<{ personId?: string; kind?: JmlKind } | null>(null);
  const actions: IdmActions | null = manage
    ? {
        openPerson: (id) => setPersonId(id),
        openRequest: (id) => setReqId(id),
        newRequest: (init) => setCreating(init ?? {}),
        jml: (init) => setJml(init ?? {}),
        goTab: (k) => {
          setPersonId("");
          setTab(k);
        },
      }
    : null;
  return (
    <IdmProvider value={actions ?? { openPerson: () => {}, openRequest: setReqId, newRequest: (i) => setCreating(i ?? {}), jml: () => {}, goTab: setTab }}>
      <PageHeader
        title={t("acc.title")}
        subtitle={t("acc.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            {manage && (
              <Button variant="secondary" onClick={() => setJml({})}>
                <Wand2 size={16} /> {t("idm.jml.open")}
              </Button>
            )}
            <Button onClick={() => setCreating({})}>
              <Plus size={16} /> {t("acc.newRequest")}
            </Button>
          </div>
        }
      />
      <ProcessGuide id="access" />
      <ErrorBox error={sum.error} />
      {sum.data && tab !== "overview" && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label={t("acc.toApprove")} value={sum.data.toApprove} tone={sum.data.toApprove ? "amber" : "slate"} />
          <Stat label={t("acc.pending")} value={sum.data.pending} />
          {manage && <Stat label={t("acc.toFulfil")} value={sum.data.toFulfil} tone={sum.data.toFulfil ? "blue" : "slate"} />}
        </div>
      )}
      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview" as const, label: t("idm.tab.overview") },
          { key: "requests" as const, label: t("acc.tab.requests") },
          { key: "grants" as const, label: t("acc.tab.grants") },
          { key: "reviews" as const, label: t("acc.tab.reviews") },
          ...(manage ? [{ key: "reconcile" as const, label: t("acc.tab.reconcile") }, { key: "provisioning" as const, label: t("acc.tab.provisioning") }] : []),
          { key: "roles" as const, label: t("idm.tab.roles") },
          ...(manage ? [{ key: "matrix" as const, label: t("idm.tab.matrix") }] : []),
          { key: "resources" as const, label: t("acc.tab.resources") },
          ...(manage ? [{ key: "people" as const, label: t("acc.tab.people") }] : []),
        ]}
      />
      {tab === "overview" && <OverviewTab />}
      {tab === "roles" && <RolesTab manage={manage} />}
      {tab === "matrix" && manage && <MatrixTab />}
      {tab === "requests" && <RequestsTab onOpen={setReqId} manage={manage} />}
      {tab === "grants" && <GrantsTab />}
      {tab === "reviews" && <ReviewsTab manage={manage} />}
      {tab === "reconcile" && manage && <ReconcileTab onOpenRequest={setReqId} />}
      {tab === "provisioning" && manage && <ProvisioningTab onOpenRequest={setReqId} />}
      {tab === "resources" && <ResourcesTab manage={manage} />}
      {tab === "people" && manage && (
        <div className="space-y-6">
          <AutoImportCard />
          <PeopleTab />
        </div>
      )}
      <NewRequestModal open={!!creating} init={creating ?? {}} onClose={() => setCreating(null)} onCreated={(id) => setReqId(id)} />
      {personId && manage && <PersonModal id={personId} onClose={() => setPersonId("")} />}
      {jml && <JmlWizard init={jml} onClose={() => setJml(null)} />}
      {reqId && <RequestModal id={reqId} onClose={() => setReqId("")} />}
    </IdmProvider>
  );
}

function Stat({ label, value, tone = "slate" }: { label: string; value: number; tone?: Tone }) {
  return <UiKpi label={label} value={value} tone={value > 0 && (tone === "red" || tone === "amber" || tone === "green" || tone === "blue") ? tone : "slate"} />;
}

/* ---------------- žádosti ---------------- */

function RequestsTab({ onOpen, manage }: { onOpen: (id: string) => void; manage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [filter, setFilter] = useUrlParam<"open" | "mine" | "all">("f", "open");
  const q = useQuery({ queryKey: ["access", "requests", filter], queryFn: () => api.access.requests(filter === "open" ? "pending,approved" : undefined) });
  const life = useMutation({
    mutationFn: api.access.runLifecycle,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(t("acc.lifecycleDone", { n: r.expiry + r.leaver }));
    },
  });
  const rows = (q.data ?? []).filter((r) => filter !== "mine" || r.canDecide);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        {(["open", "mine", "all"] as const).map((k) => (
          <Button key={k} variant={filter === k ? "primary" : "secondary"} className="px-3 py-1 text-xs" onClick={() => setFilter(k)}>
            {t(`acc.filter.${k}`)}
          </Button>
        ))}
        <span className="flex-1" />
        {manage && (
          <Button variant="ghost" className="text-xs" disabled={life.isPending} onClick={() => life.mutate()} title={t("acc.lifecycleHint")}>
            <RefreshCw size={14} /> {t("acc.lifecycle")}
          </Button>
        )}
      </div>
      <ErrorBox error={q.error ?? life.error} />
      {q.data && !rows.length ? (
        <EmptyState>{t("acc.noRequests")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="px-5 py-2">{t("acc.person")}</th>
                <th className="py-2 pr-3">{t("acc.resource")}</th>
                <th className="py-2 pr-3">{t("acc.action")}</th>
                <th className="py-2 pr-3">{t("acc.status")}</th>
                <th className="py-2 pr-5">{t("acc.created")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50" onClick={() => onOpen(r.id)}>
                  <td className="px-5 py-2 font-medium" onClick={(e) => e.stopPropagation()}>
                    <PersonLink id={r.personId} name={r.personName} />
                  </td>
                  <td className="py-2 pr-3">
                    {r.resourceName} {r.privileged && <ShieldAlert size={13} className="inline text-amber-600" aria-label={t("acc.privileged")} />}
                  </td>
                  <td className="py-2 pr-3">
                    {t.lbl(ACCESS_LABELS.action[r.action])}
                    {r.origin !== "request" && <span className="ml-1 text-xs text-slate-500">({t.lbl(ACCESS_LABELS.origin[r.origin])})</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={statusTone[r.status]}>{t.lbl(ACCESS_LABELS.status[r.status])}</Badge> {r.canDecide && <Badge tone="amber">{t("acc.yourTurn")}</Badge>}
                  </td>
                  <td className="py-2 pr-5 text-slate-500">{fmtDay(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RequestModal({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "request", id], queryFn: () => api.access.request(id) });
  const [comment, setComment] = useState("");
  const done = (d: AccessRequestDto) => {
    qc.setQueryData(["access", "request", id], d);
    qc.invalidateQueries({ queryKey: ["access"] });
    qc.invalidateQueries({ queryKey: ["obligations"] });
    setComment("");
  };
  const decide = useMutation({ mutationFn: (d: "approved" | "rejected") => api.access.decide(id, d, comment || undefined), onSuccess: done });
  const fulfil = useMutation({ mutationFn: () => api.access.fulfil(id, comment || undefined), onSuccess: (d) => (done(d), toast(t("acc.fulfilled"))) });
  const cancel = useMutation({ mutationFn: () => api.access.cancel(id), onSuccess: done });
  const r = q.data;
  return (
    <Modal open onClose={onClose} title={r ? `${r.personName} – ${r.resourceName}` : t("acc.request")} wide>
      <ErrorBox error={q.error ?? decide.error ?? fulfil.error ?? cancel.error} />
      {r && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[r.status]}>{t.lbl(ACCESS_LABELS.status[r.status])}</Badge>
            <Badge tone={r.action === "grant" ? "blue" : "slate"}>{t.lbl(ACCESS_LABELS.action[r.action])}</Badge>
            <span className="text-slate-500">{t.lbl(ACCESS_LABELS.resourceKind[r.resourceKind])}</span>
            {r.privileged && <Badge tone="amber">{t("acc.privileged")}</Badge>}
            {r.origin !== "request" && <Badge tone="slate">{t.lbl(ACCESS_LABELS.origin[r.origin])}</Badge>}
          </div>
          <SodWarning conflicts={r.sodConflicts} />
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
            <dt className="text-slate-500">{t("acc.person")}</dt>
            <dd>
              <PersonLink id={r.personId} name={r.personName} />
            </dd>
            <dt className="text-slate-500">{t("acc.justification")}</dt>
            <dd className="whitespace-pre-wrap">{r.justification}</dd>
            {r.validUntil && (
              <>
                <dt className="text-slate-500">{t("acc.validUntil")}</dt>
                <dd>{fmtDay(r.validUntil)}</dd>
              </>
            )}
            {r.adGroup && (
              <>
                <dt className="text-slate-500">{t("acc.adGroup")}</dt>
                <dd className="break-all font-mono text-xs">{r.adGroup}</dd>
              </>
            )}
            <dt className="text-slate-500">{t("acc.requestedBy")}</dt>
            <dd>
              {r.requestedByName ?? t("acc.system")} · {fmtDay(r.createdAt)}
            </dd>
            {r.fulfilledAt && (
              <>
                <dt className="text-slate-500">{t("acc.fulfilledBy")}</dt>
                <dd>
                  {r.fulfilledByName} · {fmtDay(r.fulfilledAt)}
                  {r.fulfilNote && <div className="text-slate-500">{r.fulfilNote}</div>}
                </dd>
              </>
            )}
          </dl>
          {r.approvals.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("acc.approvals")}</div>
              <ol className="space-y-1.5">
                {r.approvals.map((a, i) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-400">{i + 1}.</span>
                    <span className="font-medium">{t.lbl(ACCESS_LABELS.approval[a.kind])}</span>
                    <span className="text-slate-500">{a.approverName ?? t("acc.anyManager")}</span>
                    {a.decision ? (
                      <Badge tone={a.decision === "approved" ? "green" : "red"}>{a.decision === "approved" ? t("acc.approved") : t("acc.rejected")}</Badge>
                    ) : (
                      <Badge tone="amber">{t("acc.waiting")}</Badge>
                    )}
                    {a.decidedAt && (
                      <span className="text-xs text-slate-500">
                        {a.decidedByName} · {fmtDay(a.decidedAt)}
                      </span>
                    )}
                    {a.comment && <span className="w-full pl-5 text-slate-600 dark:text-slate-300">„{a.comment}“</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {(r.canDecide || r.canFulfil) && (
            <Field label={r.canDecide ? t("acc.comment") : t("acc.fulfilNote")} hint={r.canDecide && r.sodConflicts.length ? t("idm.sod.commentRequired") : undefined}>
              <Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Field>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {r.canCancel && (
              <Button variant="ghost" onClick={async () => (await askConfirm(t("acc.cancelConfirm"))) && cancel.mutate()}>
                {t("acc.cancel")}
              </Button>
            )}
            {r.canDecide && (
              <>
                <Button variant="secondary" className="text-red-700" disabled={decide.isPending} onClick={() => decide.mutate("rejected")}>
                  <X size={16} /> {t("acc.reject")}
                </Button>
                <Button disabled={decide.isPending} onClick={() => decide.mutate("approved")}>
                  <Check size={16} /> {t("acc.approve")}
                </Button>
              </>
            )}
            {r.canFulfil && (
              <Button disabled={fulfil.isPending} onClick={() => fulfil.mutate()}>
                <Check size={16} /> {r.action === "grant" ? t("acc.fulfilGrant") : t("acc.fulfilRevoke")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function NewRequestModal({ open, init, onClose, onCreated }: { open: boolean; init: { personId?: string; resourceId?: string; action?: "grant" | "revoke" }; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ["access", "people"], queryFn: api.access.people, enabled: open });
  const resources = useQuery({ queryKey: ["access", "resources"], queryFn: api.access.resources, enabled: open });
  const [f, setF] = useState({ personId: "", resourceId: "", action: "grant" as "grant" | "revoke", justification: "", validUntil: "" });
  useEffect(() => {
    if (open) setF({ personId: init.personId ?? "", resourceId: init.resourceId ?? "", action: init.action ?? "grant", justification: "", validUntil: "" });
  }, [open, init.personId, init.resourceId, init.action]);
  useEffect(() => {
    if (open && !f.personId && people.data?.length === 1) setF((x) => ({ ...x, personId: people.data![0]!.id }));
  }, [open, people.data, f.personId]);
  const res = resources.data?.find((r) => r.id === f.resourceId);
  const sod = useQuery({
    queryKey: ["access", "sod-check", f.personId, f.resourceId],
    queryFn: () => api.access.sodCheck(f.personId, [f.resourceId]),
    enabled: open && !!f.personId && !!f.resourceId && f.action === "grant",
    retry: false,
  });
  const m = useMutation({
    mutationFn: () => api.access.createRequest({ ...f, validUntil: f.validUntil || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(t("acc.submitted"));
      onClose();
      onCreated(r.id);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("acc.newRequest")}
      footer={
        <Button disabled={!f.personId || !f.resourceId || f.justification.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
          {t("acc.submit")}
        </Button>
      }
    >
      <div className="space-y-3">
        <ErrorBox error={m.error ?? people.error} />
        {people.data && !people.data.length && <div className="rounded bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{t("acc.noPersonForYou")}</div>}
        <Field label={t("acc.person")}>
          <Select value={f.personId} onChange={(e) => setF({ ...f, personId: e.target.value })}>
            <option value="">—</option>
            {people.data
              ?.filter((p) => p.status !== "leaver")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.department ? ` (${p.department})` : ""}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label={t("acc.resource")}>
            <Select value={f.resourceId} onChange={(e) => setF({ ...f, resourceId: e.target.value })}>
              <option value="">—</option>
              {resources.data
                ?.filter((r) => r.active)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {t.lbl(ACCESS_LABELS.resourceKind[r.kind])}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("acc.action")}>
            <Select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as "grant" | "revoke" })}>
              <option value="grant">{t.lbl(ACCESS_LABELS.action.grant)}</option>
              <option value="revoke">{t.lbl(ACCESS_LABELS.action.revoke)}</option>
            </Select>
          </Field>
        </div>
        {res?.description && <p className="text-sm text-slate-500">{res.description}</p>}
        {f.action === "grant" && <SodWarning conflicts={sod.data?.[f.resourceId] ?? []} />}
        <Field label={t("acc.justification")}>
          <Textarea rows={3} value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
        </Field>
        {f.action === "grant" && (
          <Field label={t("acc.validUntil")} hint={res?.maxDays ? t("acc.maxDaysHint", { n: res.maxDays }) : t("acc.validUntilHint")}>
            <Input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
          </Field>
        )}
        {res && f.action === "grant" && (
          <p className="text-xs text-slate-500">
            {t("acc.flow")}: {[res.approvalManager && t.lbl(ACCESS_LABELS.approval.manager), res.approvalOwner && `${t.lbl(ACCESS_LABELS.approval.owner)}${res.ownerName ? ` (${res.ownerName})` : ""}`].filter(Boolean).join(" → ") || "—"} → {t("acc.itFulfil")}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- přidělení ---------------- */

function GrantsTab() {
  const t = useT();
  const [history, setHistory] = useState(false);
  const q = useQuery({ queryKey: ["access", "grants", history], queryFn: () => api.access.grants(history) });
  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <Checkbox checked={history} onChange={setHistory} label={t("acc.showRevoked")} />
      </div>
      <ErrorBox error={q.error} />
      {q.data && !q.data.length ? (
        <EmptyState>{t("acc.noGrants")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="px-5 py-2">{t("acc.person")}</th>
                <th className="py-2 pr-3">{t("acc.resource")}</th>
                <th className="py-2 pr-3">{t("acc.since")}</th>
                <th className="py-2 pr-5">{t("acc.validUntil")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((g) => (
                <tr key={g.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-5 py-2">
                    <PersonLink id={g.personId} name={g.personName} /> {g.personStatus !== "active" && <Badge tone={personTone[g.personStatus]}>{t.lbl(ACCESS_LABELS.personStatus[g.personStatus])}</Badge>}
                  </td>
                  <td className="py-2 pr-3">
                    {g.resourceName} {g.privileged && <ShieldAlert size={13} className="inline text-amber-600" />}
                  </td>
                  <td className="py-2 pr-3">{fmtDay(g.since)}</td>
                  <td className="py-2 pr-5">{g.validUntil ? <span className={g.expired ? "font-medium text-red-600" : ""}>{fmtDay(g.validUntil)}</span> : t("acc.unlimited")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- katalog oprávnění ---------------- */

const emptyResource = (): AccessResourceInput => ({ name: "", kind: "application", description: "", assetId: null, adGroup: "", ownerId: null, approvalManager: true, approvalOwner: true, maxDays: null, privileged: false, active: true });

function ResourcesTab({ manage }: { manage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "resources"], queryFn: api.access.resources });
  const users = useQuery({ queryKey: ["directory-users"], queryFn: api.directory.users, enabled: manage });
  const ad = useQuery({ queryKey: ["access", "ad-groups"], queryFn: api.access.adGroups, enabled: manage });
  const [importing, setImporting] = useState(false);
  const [edit, setEdit] = useState<{ id: string | null; f: AccessResourceInput } | null>(null);
  const save = useMutation({
    mutationFn: () => (edit!.id ? api.access.updateResource(edit!.id, edit!.f) : api.access.createResource(edit!.f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access", "resources"] });
      setEdit(null);
      toast(t("acc.saved"));
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.access.removeResource(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["access", "resources"] }) });
  const open = (r?: AccessResourceDto) =>
    setEdit(
      r
        ? { id: r.id, f: { name: r.name, kind: r.kind, description: r.description ?? "", assetId: r.assetId, adGroup: r.adGroup ?? "", ownerId: r.ownerId, approvalManager: r.approvalManager, approvalOwner: r.approvalOwner, maxDays: r.maxDays, privileged: r.privileged, active: r.active, adCreate: r.adCreate } }
        : { id: null, f: emptyResource() },
    );
  const set = (p: Partial<AccessResourceInput>) => setEdit((e) => e && { ...e, f: { ...e.f, ...p } });
  return (
    <Card>
      <CardHeader
        title={t("acc.tab.resources")}
        subtitle={t("acc.resourcesHint")}
        action={
          manage && (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <FolderInput size={16} /> {t("acc.adg.import")}
              </Button>
              <Button variant="secondary" onClick={() => open()}>
                <Plus size={16} /> {t("acc.newResource")}
              </Button>
            </div>
          )
        }
      />
      <ErrorBox error={q.error ?? remove.error} />
      {importing && <AdGroupsImportModal users={users.data ?? []} onClose={() => setImporting(false)} />}
      {q.data && !q.data.length ? (
        <EmptyState>{t("acc.noResources")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="px-5 py-2">{t("acc.name")}</th>
                <th className="py-2 pr-3">{t("acc.kind")}</th>
                <th className="py-2 pr-3">{t("acc.owner")}</th>
                <th className="py-2 pr-3">{t("acc.flow")}</th>
                <th className="py-2 pr-3 text-right">{t("acc.grantsCount")}</th>
                <th className="py-2 pr-5" />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((r) => (
                <tr key={r.id} className={`border-b border-slate-100 dark:border-slate-800 ${r.active ? "" : "opacity-50"}`}>
                  <td className="px-5 py-2">
                    <div className="font-medium">
                      {r.name} {r.privileged && <Badge tone="amber">{t("acc.privileged")}</Badge>}
                    </div>
                    {r.adGroup && <div className="break-all font-mono text-xs text-slate-500">{r.adGroup}</div>}
                    {r.adCreate && <Badge tone="blue">{t("acc.adg.pending")}</Badge>}
                  </td>
                  <td className="py-2 pr-3">{t.lbl(ACCESS_LABELS.resourceKind[r.kind])}</td>
                  <td className="py-2 pr-3">{r.ownerName ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs">
                    {[r.approvalManager && t.lbl(ACCESS_LABELS.approval.manager), r.approvalOwner && t.lbl(ACCESS_LABELS.approval.owner)].filter(Boolean).join(" → ") || t("acc.noApproval")}
                    {r.maxDays && <div className="text-slate-500">{t("acc.maxDays", { n: r.maxDays })}</div>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.grants}</td>
                  <td className="py-2 pr-5 text-right">
                    {manage && (
                      <span className="flex justify-end gap-1">
                        <Button variant="ghost" className="px-2" title={t("acc.edit")} onClick={() => open(r)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" className="px-2 text-red-600" title={t("acc.delete")} onClick={async () => (await askConfirm(t("acc.deleteResourceConfirm", { name: r.name }), { danger: true })) && remove.mutate(r.id)}>
                          <Trash2 size={14} />
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
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t("acc.editResource") : t("acc.newResource")}
        footer={
          <Button disabled={!edit?.f.name.trim() || save.isPending} onClick={() => save.mutate()}>
            {t("acc.save")}
          </Button>
        }
      >
        {edit && (
          <div className="space-y-3">
            <ErrorBox error={save.error} />
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <Field label={t("acc.name")}>
                <Input value={edit.f.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label={t("acc.kind")}>
                <Select value={edit.f.kind} onChange={(e) => set({ kind: e.target.value as AccessResourceInput["kind"] })}>
                  {RESOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(ACCESS_LABELS.resourceKind[k])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("acc.description")}>
              <Textarea rows={2} value={edit.f.description ?? ""} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            {edit.f.kind === "ad_group" && !edit.id && <Checkbox checked={!!edit.f.adCreate} onChange={(v) => set({ adCreate: v, adGroup: "" })} label={t("acc.adg.create")} hint={t("acc.adg.createHint")} />}
            {edit.f.adCreate ? (
              <NewGroupFields value={edit.f.adGroup ?? ""} ous={ad.data?.ous ?? []} onChange={(dn) => set({ adGroup: dn })} />
            ) : (
              <Field label={t("acc.adGroup")} hint={ad.data?.groups.length ? t("acc.adg.pickHint") : t("acc.adGroupHint")}>
                <Input list="ad-group-dns" value={edit.f.adGroup ?? ""} onChange={(e) => set({ adGroup: e.target.value })} placeholder="CN=…,OU=Groups,DC=firma,DC=cz" />
                <datalist id="ad-group-dns">
                  {ad.data?.groups.map((g) => (
                    <option key={g.dn} value={g.dn}>
                      {g.cn}
                    </option>
                  ))}
                </datalist>
              </Field>
            )}
            <Field label={t("acc.owner")} hint={t("acc.ownerHint")}>
              <UserSelect value={(edit.f.ownerId ?? "") || null} onChange={(v) => set({ ownerId: v })} emptyLabel="—" />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Checkbox checked={!!edit.f.approvalManager} onChange={(v) => set({ approvalManager: v })} label={t("acc.approvalManager")} />
              <Checkbox checked={!!edit.f.approvalOwner} onChange={(v) => set({ approvalOwner: v })} label={t("acc.approvalOwner")} />
              <Checkbox checked={!!edit.f.privileged} onChange={(v) => set({ privileged: v })} label={t("acc.privileged")} hint={t("acc.privilegedHint")} />
              <Checkbox checked={edit.f.active !== false} onChange={(v) => set({ active: v })} label={t("acc.active")} />
            </div>
            <Field label={t("acc.maxDaysLabel")} hint={t("acc.maxDaysLabelHint")}>
              <Input type="number" min={1} max={3650} value={edit.f.maxDays ?? ""} onChange={(e) => set({ maxDays: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}

/* ---------------- osoby a import ---------------- */

const emptyPerson = (): PersonInput => ({ personalNumber: "", firstName: "", lastName: "", email: "", login: "", department: "", jobTitle: "", kind: "employee", managerId: null, startDate: null, endDate: null });

function PeopleTab() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "people"], queryFn: api.access.people });
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<{ id: string | null; f: PersonInput } | null>(null);
  const [importing, setImporting] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const f = { ...edit!.f, startDate: edit!.f.startDate || null, endDate: edit!.f.endDate || null };
      return edit!.id ? api.access.updatePerson(edit!.id, f) : api.access.createPerson(f);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access"] });
      setEdit(null);
      toast(t("acc.saved"));
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api.access.removePerson(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["access", "people"] }) });
  const set = (p: Partial<PersonInput>) => setEdit((e) => e && { ...e, f: { ...e.f, ...p } });
  const s = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((p) => !s || `${p.name} ${p.personalNumber ?? ""} ${p.email ?? ""} ${p.department ?? ""}`.toLowerCase().includes(s));
  const open = (p?: PersonDto) =>
    setEdit(
      p
        ? { id: p.id, f: { personalNumber: p.personalNumber ?? "", firstName: p.firstName, lastName: p.lastName, email: p.email ?? "", login: p.login ?? "", department: p.department ?? "", jobTitle: p.jobTitle ?? "", kind: p.kind, managerId: p.managerId, startDate: p.startDate, endDate: p.endDate } }
        : { id: null, f: emptyPerson() },
    );
  return (
    <Card>
      <CardHeader
        title={t("acc.tab.people")}
        subtitle={t("acc.peopleHint")}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileUp size={16} /> {t("acc.import")}
            </Button>
            <Button variant="secondary" onClick={() => open()}>
              <Plus size={16} /> {t("acc.newPerson")}
            </Button>
          </div>
        }
      />
      <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">
        <Input placeholder={t("acc.searchPeople")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorBox error={q.error ?? remove.error} />
      {q.data && !q.data.length ? (
        <EmptyState>{t("acc.noPeople")}</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="px-5 py-2">{t("acc.name")}</th>
                <th className="py-2 pr-3">{t("acc.personalNumber")}</th>
                <th className="py-2 pr-3">{t("acc.department")}</th>
                <th className="py-2 pr-3">{t("acc.manager")}</th>
                <th className="py-2 pr-3">{t("acc.status")}</th>
                <th className="py-2 pr-3 text-right">{t("acc.grantsCount")}</th>
                <th className="py-2 pr-5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-5 py-2">
                    <PersonLink id={p.id} name={p.name} />
                    <div className="text-xs text-slate-500">{[p.email, p.jobTitle].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{p.personalNumber ?? "—"}</td>
                  <td className="py-2 pr-3">{p.department ?? "—"}</td>
                  <td className="py-2 pr-3">{p.managerName ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={personTone[p.status]}>{t.lbl(ACCESS_LABELS.personStatus[p.status])}</Badge>
                    {p.kind !== "employee" && <span className="ml-1 text-xs text-slate-500">{t.lbl(ACCESS_LABELS.personKind[p.kind])}</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.grants}</td>
                  <td className="py-2 pr-5 text-right">
                    <span className="flex justify-end gap-1">
                      <Button variant="ghost" className="px-2" title={t("acc.edit")} onClick={() => open(p)}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" className="px-2 text-red-600" title={t("acc.delete")} onClick={async () => (await askConfirm(t("acc.deletePersonConfirm", { name: p.name }), { danger: true })) && remove.mutate(p.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? t("acc.editPerson") : t("acc.newPerson")}
        footer={
          <Button disabled={!edit?.f.firstName.trim() || !edit?.f.lastName.trim() || save.isPending} onClick={() => save.mutate()}>
            {t("acc.save")}
          </Button>
        }
      >
        {edit && (
          <div className="space-y-3">
            <ErrorBox error={save.error} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("acc.firstName")}>
                <Input value={edit.f.firstName} onChange={(e) => set({ firstName: e.target.value })} />
              </Field>
              <Field label={t("acc.lastName")}>
                <Input value={edit.f.lastName} onChange={(e) => set({ lastName: e.target.value })} />
              </Field>
              <Field label={t("acc.personalNumber")}>
                <Input value={edit.f.personalNumber ?? ""} onChange={(e) => set({ personalNumber: e.target.value })} />
              </Field>
              <Field label={t("acc.email")}>
                <Input type="email" value={edit.f.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
              </Field>
              <Field label={t("acc.login")}>
                <Input value={edit.f.login ?? ""} onChange={(e) => set({ login: e.target.value })} />
              </Field>
              <Field label={t("acc.kind")}>
                <Select value={edit.f.kind} onChange={(e) => set({ kind: e.target.value as PersonInput["kind"] })}>
                  {PERSON_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t.lbl(ACCESS_LABELS.personKind[k])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("acc.department")}>
                <Input value={edit.f.department ?? ""} onChange={(e) => set({ department: e.target.value })} />
              </Field>
              <Field label={t("acc.jobTitle")}>
                <Input value={edit.f.jobTitle ?? ""} onChange={(e) => set({ jobTitle: e.target.value })} />
              </Field>
              <Field label={t("acc.manager")}>
                <Select value={edit.f.managerId ?? ""} onChange={(e) => set({ managerId: e.target.value || null })}>
                  <option value="">—</option>
                  {q.data
                    ?.filter((p) => p.id !== edit.id && p.status !== "leaver")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t("acc.startDate")}>
                <Input type="date" value={edit.f.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} />
              </Field>
              <Field label={t("acc.endDate")} hint={t("acc.endDateHint")}>
                <Input type="date" value={edit.f.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
              </Field>
            </div>
          </div>
        )}
      </Modal>
      <ImportModal open={importing} onClose={() => setImporting(false)} />
    </Card>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [prev, setPrev] = useState<PeopleImportDto | null>(null);
  const [missingAsLeft, setMissingAsLeft] = useState(false);
  useEffect(() => {
    if (open) {
      setFile(null);
      setPrev(null);
      setMissingAsLeft(false);
    }
  }, [open]);
  const preview = useMutation({ mutationFn: (f: File) => api.access.importPeople(f, false), onSuccess: setPrev });
  const commit = useMutation({
    mutationFn: () => api.access.importPeople(file!, true, missingAsLeft),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(t("acc.imported", { created: r.counts.create, updated: r.counts.update }));
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t("acc.importTitle")}
      footer={
        <Button disabled={!prev || prev.counts.create + prev.counts.update + (missingAsLeft ? prev.counts.missing : 0) === 0 || commit.isPending} onClick={() => commit.mutate()}>
          {t("acc.importCommit", { n: (prev?.counts.create ?? 0) + (prev?.counts.update ?? 0) })}
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <ErrorBox error={preview.error ?? commit.error} />
        <p className="text-slate-600 dark:text-slate-300">{t("acc.importHint")}</p>
        <Input
          type="file"
          accept=".csv,.xlsx,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPrev(null);
            if (f) preview.mutate(f);
          }}
        />
        {prev && (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">{t("acc.imp.create", { n: prev.counts.create })}</Badge>
              <Badge tone="blue">{t("acc.imp.update", { n: prev.counts.update })}</Badge>
              <Badge tone="slate">{t("acc.imp.skip", { n: prev.counts.skip })}</Badge>
              {prev.counts.errors > 0 && <Badge tone="red">{t("acc.imp.errors", { n: prev.counts.errors })}</Badge>}
              {prev.counts.leavers > 0 && <Badge tone="amber">{t("acc.imp.leavers", { n: prev.counts.leavers })}</Badge>}
            </div>
            {prev.ignoredSensitive.length > 0 && (
              <div className="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">{t("acc.imp.sensitive", { cols: prev.ignoredSensitive.join(", ") })}</div>
            )}
            {prev.counts.missing > 0 && (
              <div className="rounded border border-slate-200 p-3 dark:border-slate-700">
                <Checkbox checked={missingAsLeft} onChange={setMissingAsLeft} label={t("acc.imp.missingAsLeft", { n: prev.counts.missing })} hint={prev.missingNames.join(", ")} />
              </div>
            )}
            <div className="text-xs text-slate-500">
              {t("acc.imp.columns")}: {prev.headers.map((h, i) => `${h} → ${prev.mapping[i] ? t(`acc.col.${prev.mapping[i]}` as never) : "—"}`).join(" · ")}
            </div>
            <div className="max-h-80 overflow-auto rounded border border-slate-200 dark:border-slate-700">
              <table className="w-full text-xs">
                <tbody>
                  {prev.rows
                    .filter((r) => r.action !== "skip" || r.errors.length || r.warnings.length)
                    .map((r) => (
                      <tr key={r.row} className="border-b border-slate-100 align-top dark:border-slate-800">
                        <td className="px-2 py-1 text-slate-400">{r.row}</td>
                        <td className="px-2 py-1 font-medium">{r.name}</td>
                        <td className="px-2 py-1">{r.errors.length ? <Badge tone="red">{t("acc.imp.error")}</Badge> : <Badge tone={r.action === "create" ? "green" : r.action === "update" ? "blue" : "slate"}>{t(`acc.imp.${r.action}Short` as never)}</Badge>}</td>
                        <td className="px-2 py-1 text-slate-600 dark:text-slate-300">{[...r.errors, ...r.warnings, ...(r.changes.length ? [r.changes.map((c) => t(`acc.col.${c}` as never)).join(", ")] : [])].join(" · ")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- automatický import ze souboru (v1.27) ---------------- */

function AutoImportCard() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "import-settings"], queryFn: api.access.importSettings });
  const [f, setF] = useState<{ enabled: boolean; fileName: string; missingAsLeft: boolean } | null>(null);
  useEffect(() => {
    if (q.data && !f) setF({ enabled: q.data.enabled, fileName: q.data.fileName, missingAsLeft: q.data.missingAsLeft });
  }, [q.data, f]);
  const done = (d: Awaited<ReturnType<typeof api.access.importSettings>>) => {
    qc.setQueryData(["access", "import-settings"], d);
    qc.invalidateQueries({ queryKey: ["access", "people"] });
  };
  const save = useMutation({ mutationFn: () => api.access.saveImportSettings(f!), onSuccess: (d) => (done(d), toast(t("acc.saved"))) });
  const run = useMutation({ mutationFn: api.access.runImport, onSuccess: done });
  const d = q.data;
  return (
    <Card>
      <CardHeader title={t("acc.auto.title")} subtitle={t("acc.auto.subtitle", { dir: d?.dir ?? "/import" })} />
      <div className="space-y-3 px-5 py-4 text-sm">
        <ErrorBox error={q.error ?? save.error ?? run.error} />
        {d && !d.dirAvailable && <div className="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">{t("acc.auto.noDir", { dir: d.dir })}</div>}
        {f && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label={t("acc.auto.file")} hint={d?.fileName && !d.fileFound ? t("acc.auto.notFound") : undefined}>
              <Input value={f.fileName} onChange={(e) => setF({ ...f, fileName: e.target.value })} placeholder="perm-osoby.csv" />
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
                {t("acc.save")}
              </Button>
              <Button variant="secondary" disabled={!d?.fileFound || run.isPending} onClick={() => run.mutate()}>
                <Play size={14} /> {t("acc.auto.run")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 sm:col-span-2">
              <Checkbox checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t("acc.auto.enabled")} />
              <Checkbox checked={f.missingAsLeft} onChange={(v) => setF({ ...f, missingAsLeft: v })} label={t("acc.auto.missingAsLeft")} hint={t("acc.auto.missingAsLeftHint")} />
            </div>
          </div>
        )}
        {d?.lastRunAt && (
          <div className="text-slate-600 dark:text-slate-300">
            {t("acc.auto.last", { at: fmtDay(d.lastRunAt) })}{" "}
            {d.lastError ? (
              <span className="text-red-600">{d.lastError}</span>
            ) : (
              d.lastResult && t("acc.auto.result", { create: d.lastResult.create, update: d.lastResult.update, errors: d.lastResult.errors, missing: d.lastResult.missing ?? 0 })
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------------- recertifikace (v1.27) ---------------- */

function ReviewsTab({ manage }: { manage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [certId, setCertId] = useUrlParam("cert");
  const q = useQuery({ queryKey: ["access", "certifications"], queryFn: api.access.certifications });
  const resources = useQuery({ queryKey: ["access", "resources"], queryFn: api.access.resources, enabled: manage });
  const [creating, setCreating] = useState<CertificationInput | null>(null);
  const create = useMutation({
    mutationFn: () => api.access.createCertification(creating!),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["access", "certifications"] });
      setCreating(null);
      setCertId(c.id);
    },
  });
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  return (
    <Card>
      <CardHeader
        title={t("acc.tab.reviews")}
        subtitle={t("acc.rev.subtitle")}
        action={
          manage && (
            <Button variant="secondary" onClick={() => setCreating({ name: t("acc.rev.defaultName", { date: fmtDay(new Date().toISOString()) }), reviewer: "owner", resourceId: null, privilegedOnly: false, dueDate: in30 })}>
              <Plus size={16} /> {t("acc.rev.new")}
            </Button>
          )
        }
      />
      <ErrorBox error={q.error} />
      {q.data && !q.data.length ? (
        <EmptyState>{t("acc.rev.empty")}</EmptyState>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {q.data?.map((c) => (
            <button key={c.id} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => setCertId(c.id)}>
              <span className="min-w-48 flex-1 font-medium">{c.name}</span>
              <span className="text-slate-500">{t.lbl(AL.certReviewer[c.reviewer])}</span>
              <span className="tabular-nums">
                {c.decided}/{c.total}
              </span>
              {c.revoked > 0 && <Badge tone="red">{t("acc.rev.revokedN", { n: c.revoked })}</Badge>}
              {c.mine > 0 && <Badge tone="amber">{t("acc.rev.mineN", { n: c.mine })}</Badge>}
              <Badge tone={c.status === "closed" ? "slate" : c.overdue ? "red" : "blue"}>{c.status === "closed" ? t.lbl(AL.certStatus.closed) : `${t("acc.rev.due")} ${fmtDay(c.dueDate)}`}</Badge>
            </button>
          ))}
        </div>
      )}
      <Modal
        open={!!creating}
        onClose={() => setCreating(null)}
        title={t("acc.rev.new")}
        footer={
          <Button disabled={!creating?.name.trim() || create.isPending} onClick={() => create.mutate()}>
            {t("acc.rev.start")}
          </Button>
        }
      >
        {creating && (
          <div className="space-y-3">
            <ErrorBox error={create.error} />
            <Field label={t("acc.name")}>
              <Input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("acc.rev.reviewer")}>
                <Select value={creating.reviewer} onChange={(e) => setCreating({ ...creating, reviewer: e.target.value as CertificationInput["reviewer"] })}>
                  {CERT_REVIEWERS.map((r) => (
                    <option key={r} value={r}>
                      {t.lbl(AL.certReviewer[r])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("acc.rev.due")}>
                <Input type="date" value={creating.dueDate} onChange={(e) => setCreating({ ...creating, dueDate: e.target.value })} />
              </Field>
            </div>
            <Field label={t("acc.resource")}>
              <Select value={creating.resourceId ?? ""} onChange={(e) => setCreating({ ...creating, resourceId: e.target.value || null })}>
                <option value="">{t("acc.rev.allResources")}</option>
                {resources.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox checked={!!creating.privilegedOnly} onChange={(v) => setCreating({ ...creating, privilegedOnly: v })} label={t("acc.rev.privilegedOnly")} />
            <p className="text-xs text-slate-500">{t("acc.rev.hint")}</p>
          </div>
        )}
      </Modal>
      {certId && <CertificationModal id={certId} manage={manage} onClose={() => setCertId("")} />}
    </Card>
  );
}

function CertificationModal({ id, manage, onClose }: { id: string; manage: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "certification", id], queryFn: () => api.access.certification(id) });
  const [comments, setComments] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (x: { itemId: string; decision: "keep" | "revoke" }) => api.access.certify(id, x.itemId, x.decision, comments[x.itemId] || undefined),
    onSuccess: (d) => {
      qc.setQueryData(["access", "certification", id], d);
      qc.invalidateQueries({ queryKey: ["access", "certifications"] });
      qc.invalidateQueries({ queryKey: ["access", "requests"] });
    },
  });
  const close = useMutation({
    mutationFn: () => api.access.closeCertification(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["access"] });
      onClose();
    },
  });
  const d = q.data;
  return (
    <Modal open onClose={onClose} wide title={d?.name ?? t("acc.tab.reviews")}>
      <ErrorBox error={q.error ?? decide.error ?? close.error} />
      {d && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={d.status === "closed" ? "slate" : d.overdue ? "red" : "blue"}>{d.status === "closed" ? t.lbl(AL.certStatus.closed) : `${t("acc.rev.due")} ${fmtDay(d.dueDate)}`}</Badge>
            <span className="text-slate-500">
              {t.lbl(AL.certReviewer[d.reviewer])} · {d.decided}/{d.total} · {t("acc.rev.revokedN", { n: d.revoked })}
            </span>
            <span className="flex-1" />
            {manage && (
              <a href={api.access.certificationCsvUrl(d.id)}>
                <Button variant="ghost" className="text-xs">
                  <Download size={14} /> {t("acc.rev.export")}
                </Button>
              </a>
            )}
            {manage && d.status === "open" && (
              <Button variant="secondary" className="text-xs" onClick={async () => (await askConfirm(t("acc.rev.closeConfirm", { n: d.total - d.decided }))) && close.mutate()}>
                <Lock size={14} /> {t("acc.rev.close")}
              </Button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{t("acc.person")}</th>
                  <th className="py-2 pr-3">{t("acc.resource")}</th>
                  <th className="py-2 pr-3">{t("acc.since")}</th>
                  <th className="py-2 pr-3">{t("acc.rev.reviewer")}</th>
                  <th className="py-2">{t("acc.rev.decision")}</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{i.personName}</div>
                      <div className="text-xs text-slate-500">
                        {i.department}
                        {i.personStatus !== "active" && ` · ${t.lbl(AL.personStatus[i.personStatus])}`}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {i.resourceName} {i.privileged && <ShieldAlert size={13} className="inline text-amber-600" />}
                    </td>
                    <td className="py-2 pr-3">{fmtDay(i.since)}</td>
                    <td className="py-2 pr-3">{i.reviewerName ?? t("acc.anyManager")}</td>
                    <td className="py-2">
                      {i.decision && (
                        <div>
                          <Badge tone={i.decision === "keep" ? "green" : "red"}>{t.lbl(AL.certDecision[i.decision])}</Badge>
                          <span className="ml-1 text-xs text-slate-500">
                            {i.decidedByName} {i.comment && `· „${i.comment}“`}
                          </span>
                        </div>
                      )}
                      {i.canDecide && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Input className="h-8 w-44 text-xs" placeholder={t("acc.rev.comment")} value={comments[i.id] ?? ""} onChange={(e) => setComments({ ...comments, [i.id]: e.target.value })} />
                          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={decide.isPending} onClick={() => decide.mutate({ itemId: i.id, decision: "keep" })}>
                            <Check size={14} /> {t.lbl(AL.certDecision.keep)}
                          </Button>
                          <Button variant="secondary" className="px-2 py-1 text-xs text-red-700" disabled={decide.isPending || !comments[i.id]?.trim()} onClick={() => decide.mutate({ itemId: i.id, decision: "revoke" })}>
                            <X size={14} /> {t.lbl(AL.certDecision.revoke)}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------------- soulad s AD (v1.28) ---------------- */

const reconTone: Record<ReconType, Tone> = { unapproved: "red", leaver_in_ad: "red", unknown_account: "amber", missing: "blue", no_account: "slate" };

function ReconcileTab({ onOpenRequest }: { onOpenRequest: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "reconcile"], queryFn: api.access.reconcile });
  const adopt = useMutation({
    mutationFn: (x: { resourceId: string; personIds: string[] }) => api.access.adopt(x.resourceId, x.personIds),
    onSuccess: (d) => {
      qc.setQueryData(["access", "reconcile"], d);
      qc.invalidateQueries({ queryKey: ["access", "grants"] });
      toast(t("acc.rec.adopted"));
    },
  });
  const revoke = useMutation({
    mutationFn: (x: { resourceId: string; personId: string }) => api.access.reconcileRevoke(x.resourceId, x.personId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      onOpenRequest(r.requestId);
    },
  });
  const d = q.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("acc.tab.reconcile")} subtitle={t("acc.rec.subtitle")} />
        <div className="space-y-2 px-5 py-4 text-sm">
          <ErrorBox error={q.error ?? adopt.error ?? revoke.error} />
          {d && !d.sources.length && <div className="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">{t("acc.rec.noSource")}</div>}
          {d?.sources.map((s) => (
            <div key={s.id} className="text-slate-600 dark:text-slate-300">
              {s.name}: {s.lastSyncAt ? t("acc.rec.synced", { at: fmtDay(s.lastSyncAt) }) : t("acc.rec.neverSynced")}
            </div>
          ))}
          {d && !d.resources.length && <div className="text-slate-500">{t("acc.rec.noGroups")}</div>}
        </div>
      </Card>
      {d?.resources.map((r) => {
        const unapproved = r.items.filter((i) => i.type === "unapproved");
        return (
          <Card key={r.resourceId}>
            <CardHeader
              title={r.resourceName}
              subtitle={`${r.group} · ${t("acc.rec.counts", { members: r.members, granted: r.granted })}`}
              action={
                unapproved.length > 0 && (
                  <Button
                    variant="secondary"
                    className="text-xs"
                    disabled={adopt.isPending}
                    onClick={async () => (await askConfirm(t("acc.rec.adoptConfirm", { n: unapproved.length, name: r.resourceName }))) && adopt.mutate({ resourceId: r.resourceId, personIds: unapproved.map((i) => i.personId!) })}
                  >
                    {t("acc.rec.adoptAll", { n: unapproved.length })}
                  </Button>
                )
              }
            />
            {r.items.length === 0 ? (
              <div className="px-5 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                <Check size={14} className="inline" /> {t("acc.rec.ok")}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {r.items.map((i) => (
                  <li key={`${i.type}:${i.personId ?? i.accountId}`} className="flex flex-wrap items-center gap-2 px-5 py-2">
                    <Badge tone={reconTone[i.type]}>{t.lbl(RECON_LABELS[i.type])}</Badge>
                    <span className="font-medium">{i.personName ?? i.login}</span>
                    {i.personName && i.login && <span className="font-mono text-xs text-slate-500">{i.login}</span>}
                    {i.enabled === false && <span className="text-xs text-slate-500">({t("acc.rec.disabled")})</span>}
                    <span className="flex-1" />
                    {i.type === "unapproved" && (
                      <Button variant="ghost" className="px-2 text-xs" disabled={adopt.isPending} onClick={() => adopt.mutate({ resourceId: r.resourceId, personIds: [i.personId!] })}>
                        {t("acc.rec.adopt")}
                      </Button>
                    )}
                    {(i.type === "unapproved" || i.type === "leaver_in_ad") && (
                      <Button variant="ghost" className="px-2 text-xs text-red-700" disabled={revoke.isPending} onClick={() => revoke.mutate({ resourceId: r.resourceId, personId: i.personId! })}>
                        {t("acc.rec.revoke")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------- nastavení skupin v AD (v1.29) ---------------- */

function ProvisioningTab({ onOpenRequest }: { onOpenRequest: (id: string) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const can = useCan();
  const st = useQuery({ queryKey: ["access", "provisioning"], queryFn: api.access.provisioning });
  const plan = useQuery({ queryKey: ["access", "provisioning", "plan"], queryFn: api.access.provisioningPlan });
  const newGroups = useQuery({ queryKey: ["access", "provisioning", "groups"], queryFn: api.access.provisioningGroups });
  const ad = useQuery({ queryKey: ["access", "ad-groups"], queryFn: api.access.adGroups });
  const [f, setF] = useState<ProvisioningSettingsInput | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selG, setSelG] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ProvisioningResult[] | null>(null);
  useEffect(() => {
    if (st.data && !f) setF({ mode: st.data.mode, sourceId: st.data.sourceId, bindDn: st.data.bindDn, password: "", allowedOu: st.data.allowedOu, dailyLimit: st.data.dailyLimit, extraForbidden: st.data.extraForbidden });
  }, [st.data, f]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["access"] });
    setSel(new Set());
    setSelG(new Set());
  };
  const save = useMutation({
    mutationFn: () => api.access.saveProvisioning({ ...f!, password: f!.password || undefined }),
    onSuccess: (d) => {
      qc.setQueryData(["access", "provisioning"], d);
      setF((x) => x && { ...x, password: "" });
      qc.invalidateQueries({ queryKey: ["access", "provisioning", "plan"] });
      toast(t("acc.saved"));
    },
  });
  const apply = useMutation({ mutationFn: () => api.access.provisioningApply([...sel], [...selG]), onSuccess: (r) => (setResults(r), refresh()) });
  const script = useMutation({ mutationFn: () => api.access.provisioningScript([...sel], [...selG]) });
  const verify = useMutation({ mutationFn: api.access.provisioningVerify, onSuccess: (r) => (toast(t("acc.prov.verified", { n: r.fulfilled })), refresh()) });
  const d = st.data;
  const ready = (plan.data ?? []).filter((x) => !x.error);
  const isAdmin = can("admin:settings");
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t("acc.prov.settings")} subtitle={t("acc.prov.settingsHint")} />
        {f && d && (
          <div className="space-y-3 px-5 py-4 text-sm">
            <ErrorBox error={st.error ?? save.error} />
            <Field label={t("acc.prov.mode")}>
              <Select value={f.mode} disabled={!isAdmin} onChange={(e) => setF({ ...f, mode: e.target.value as ProvisioningSettingsInput["mode"] })}>
                {PROVISIONING_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t.lbl(PROVISIONING_LABELS[m])}
                  </option>
                ))}
              </Select>
            </Field>
            {f.mode !== "off" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("acc.prov.source")} hint={t("acc.prov.sourceHint")}>
                  <Select value={f.sourceId ?? ""} disabled={!isAdmin} onChange={(e) => setF({ ...f, sourceId: e.target.value || null })}>
                    <option value="">—</option>
                    {d.adSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("acc.prov.allowedOu")} hint={(f.allowedOu && allowedOuError(f.allowedOu) ? t.lbl(allowedOuError(f.allowedOu)!) : null) ?? t("acc.prov.allowedOuHint")}>
                  {ad.data?.ous.length ? (
                    <Select value={f.allowedOu ?? ""} disabled={!isAdmin} onChange={(e) => setF({ ...f, allowedOu: e.target.value })}>
                      <option value="">—</option>
                      {[...new Set([...(f.allowedOu ? [f.allowedOu] : []), ...ad.data.ous])].map((o) => (
                        <option key={o} value={o}>
                          {ouLabel(o) || o} {t("acc.prov.groupsIn", { n: ad.data!.groups.filter((g) => `,${g.ou.toLowerCase()}`.endsWith(`,${o.toLowerCase()}`) || g.ou.toLowerCase() === o.toLowerCase()).length })}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input value={f.allowedOu ?? ""} disabled={!isAdmin} onChange={(e) => setF({ ...f, allowedOu: e.target.value })} placeholder="OU=CONTIX,OU=Groups,DC=firma,DC=cz" />
                  )}
                  {f.allowedOu && <div className="mt-1 break-all font-mono text-xs text-slate-500">{f.allowedOu}</div>}
                </Field>
                {f.mode === "ldap" && (
                  <>
                    <Field label={t("acc.prov.bindDn")} hint={(f.bindDn && bindAccountError(f.bindDn) ? t.lbl(bindAccountError(f.bindDn)!) : null) ?? t("acc.prov.bindDnHint")}>
                      <Input value={f.bindDn ?? ""} disabled={!isAdmin} onChange={(e) => setF({ ...f, bindDn: e.target.value })} placeholder="contix-write@firma.cz" />
                    </Field>
                    <Field label={t("acc.prov.password")} hint={d.hasPassword ? t("acc.prov.passwordKept") : undefined}>
                      <Input type="password" autoComplete="new-password" value={f.password ?? ""} disabled={!isAdmin} onChange={(e) => setF({ ...f, password: e.target.value })} />
                    </Field>
                    <Field label={t("acc.prov.dailyLimit")} hint={t("acc.prov.usedToday", { n: d.usedToday })}>
                      <Input type="number" min={1} max={1000} value={f.dailyLimit ?? 50} disabled={!isAdmin} onChange={(e) => setF({ ...f, dailyLimit: Number(e.target.value) || 1 })} />
                    </Field>
                  </>
                )}
                <Field label={t("acc.prov.extraForbidden")} hint={t("acc.prov.extraForbiddenHint")}>
                  <Input value={(f.extraForbidden ?? []).join(", ")} disabled={!isAdmin} onChange={(e) => setF({ ...f, extraForbidden: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
                </Field>
              </div>
            )}
            {isAdmin ? (
              <div className="flex justify-end">
                <Button disabled={save.isPending} onClick={() => save.mutate()}>
                  {t("acc.save")}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">{t("acc.prov.adminOnly")}</p>
            )}
          </div>
        )}
      </Card>
      {(newGroups.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader title={t("acc.adg.newGroups")} subtitle={t("acc.adg.newGroupsHint")} />
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {newGroups.data!.map((g) => {
              const r = results?.find((y) => y.requestId === g.resourceId);
              return (
                <li key={g.resourceId} className="flex flex-wrap items-center gap-3 px-5 py-2">
                  <input type="checkbox" aria-label={g.name} disabled={!!g.error} checked={selG.has(g.resourceId)} onChange={(e) => setSelG((s) => new Set(e.target.checked ? [...s, g.resourceId] : [...s].filter((x) => x !== g.resourceId)))} />
                  <Badge tone="blue">{t("acc.adg.createShort")}</Badge>
                  <span className="font-medium">{g.name}</span>
                  <span className="break-all font-mono text-xs text-slate-500">{g.ou}</span>
                  <span className="flex-1" />
                  {g.error ? <span className="text-xs text-red-600">{t.lbl(g.error)}</span> : <span className="text-xs text-emerald-700">{t("acc.prov.ok")}</span>}
                  {r && <span className={cn("text-xs", r.ok ? "text-emerald-700" : "text-red-600")}>{t.lbl(r.message)}</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader
          title={t("acc.prov.plan")}
          subtitle={t("acc.prov.planHint")}
          action={
            d?.mode !== "off" && (
              <Button variant="ghost" className="text-xs" disabled={verify.isPending} onClick={() => verify.mutate()}>
                <RefreshCw size={14} /> {t("acc.prov.verify")}
              </Button>
            )
          }
        />
        <ErrorBox error={plan.error ?? apply.error ?? script.error ?? verify.error} />
        {plan.data && !plan.data.length ? (
          <EmptyState>{t("acc.prov.empty")}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="w-8 px-5 py-2">
                    <input type="checkbox" aria-label={t("acc.prov.selectAll")} checked={ready.length > 0 && ready.every((x) => sel.has(x.requestId))} onChange={(e) => setSel(e.target.checked ? new Set(ready.map((x) => x.requestId)) : new Set())} />
                  </th>
                  <th className="py-2 pr-3">{t("acc.action")}</th>
                  <th className="py-2 pr-3">{t("acc.person")}</th>
                  <th className="py-2 pr-3">{t("acc.prov.group")}</th>
                  <th className="py-2 pr-5">{t("acc.prov.check")}</th>
                </tr>
              </thead>
              <tbody>
                {plan.data?.map((x) => {
                  const r = results?.find((y) => y.requestId === x.requestId);
                  return (
                    <tr key={x.requestId} className="border-b border-slate-100 align-top dark:border-slate-800">
                      <td className="px-5 py-2">
                        <input
                          type="checkbox"
                          aria-label={x.personName}
                          disabled={!!x.error}
                          checked={sel.has(x.requestId)}
                          onChange={(e) => setSel((s) => (e.target.checked ? new Set([...s, x.requestId]) : new Set([...s].filter((y) => y !== x.requestId))))}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={x.action === "grant" ? "blue" : "red"}>{x.action === "grant" ? t("acc.prov.add") : t("acc.prov.remove")}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <button className="font-medium text-brand-700 hover:underline" onClick={() => onOpenRequest(x.requestId)}>
                          {x.personName}
                        </button>
                        {x.member && <div className="break-all font-mono text-xs text-slate-500">{x.member}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        {x.resourceName}
                        {x.groupDn && <div className="break-all font-mono text-xs text-slate-500">{x.groupDn}</div>}
                      </td>
                      <td className="py-2 pr-5 text-xs">
                        {x.error ? <span className="text-red-600">{x.error}</span> : <span className="text-emerald-700 dark:text-emerald-400">{t("acc.prov.ok")}</span>}
                        {r && <div className={r.ok ? "text-emerald-700" : "text-red-600"}>{r.message}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {d && d.mode !== "off" && ready.length + (newGroups.data?.filter((g) => !g.error).length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3">
            <span className="text-xs text-slate-500">{t("acc.prov.selected", { n: sel.size + selG.size })}</span>
            {d.mode === "script" && (
              <Button variant="secondary" disabled={!sel.size && !selG.size || script.isPending} onClick={() => script.mutate()}>
                <Download size={16} /> {t("acc.prov.script")}
              </Button>
            )}
            {d.mode === "ldap" && (
              <Button disabled={!sel.size && !selG.size || apply.isPending} onClick={async () => (await askConfirm(t("acc.prov.applyConfirm", { n: sel.size + selG.size }), { danger: true })) && apply.mutate()}>
                <Play size={16} /> {t("acc.prov.apply")}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- skupiny z AD (v1.33, ADR-130) ---------------- */

const ouLabel = (ou: string) =>
  ou
    .split(",")
    .filter((p) => /^OU=/i.test(p.trim()))
    .map((p) => p.trim().slice(3))
    .reverse()
    .join(" › ");

/** Nová skupina: název + OU ze seznamu → DN. */
function NewGroupFields({ value, ous, onChange }: { value: string; ous: string[]; onChange: (dn: string) => void }) {
  const t = useT();
  const cur = value.match(/^CN=((?:\\,|[^,])+),(.*)$/i);
  const [name, setName] = useState(cur?.[1] ?? "");
  const [ou, setOu] = useState(cur?.[2] ?? ous[0] ?? "");
  useEffect(() => {
    onChange(name.trim() && ou ? `CN=${name.trim().replace(/,/g, "\\,")},${ou}` : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ou]);
  return (
    <div className="grid gap-3 rounded border border-blue-200 bg-blue-50/50 p-3 sm:grid-cols-2 dark:border-blue-900 dark:bg-blue-950/20">
      <Field label={t("acc.adg.name")} hint={t("acc.adg.nameHint")}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="GG_APP_Nazev" />
      </Field>
      <Field label={t("acc.adg.ou")}>
        <Select value={ou} onChange={(e) => setOu(e.target.value)}>
          {!ous.length && <option value="">{t("acc.adg.noOus")}</option>}
          {ous.map((o) => (
            <option key={o} value={o}>
              {ouLabel(o)}
            </option>
          ))}
        </Select>
      </Field>
      {value && <div className="break-all font-mono text-xs text-slate-500 sm:col-span-2">{value}</div>}
    </div>
  );
}

function AdGroupsImportModal({ users, onClose }: { users: { id: string; displayName: string }[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["access", "ad-groups"], queryFn: api.access.adGroups });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [opt, setOpt] = useState({ approvalManager: true, approvalOwner: true, ownerId: "", adopt: true });
  const [filter, setFilter] = useState("");
  const m = useMutation({
    mutationFn: () => api.access.importAdGroups({ dns: [...sel], approvalManager: opt.approvalManager, approvalOwner: opt.approvalOwner, ownerId: opt.ownerId || null, adopt: opt.adopt }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["access"] });
      toast(t("acc.adg.done", { created: r.created, adopted: r.adopted }));
      onClose();
    },
  });
  const f = filter.trim().toLowerCase();
  const groups = (q.data?.groups ?? []).filter((g) => !f || `${g.cn} ${g.ou} ${g.description ?? ""}`.toLowerCase().includes(f));
  const byOu = new Map<string, AdGroupDto[]>();
  for (const g of groups) byOu.set(g.ou, [...(byOu.get(g.ou) ?? []), g]);
  const toggle = (dns: string[], on: boolean) => setSel((s) => new Set(on ? [...s, ...dns] : [...s].filter((x) => !dns.includes(x))));
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={t("acc.adg.import")}
      footer={
        <Button disabled={!sel.size || m.isPending} onClick={() => m.mutate()}>
          {t("acc.adg.importN", { n: sel.size })}
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <ErrorBox error={q.error ?? m.error} />
        {q.data && !q.data.groups.length && <div className="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">{t("acc.adg.none")}</div>}
        {q.data?.sources.map((s) => (
          <div key={s.id} className="text-xs text-slate-500">
            {s.name}: {s.lastSyncAt ? t("acc.rec.synced", { at: fmtDay(s.lastSyncAt) }) : t("acc.rec.neverSynced")}
          </div>
        ))}
        <Input placeholder={t("acc.adg.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-[45vh] overflow-auto rounded border border-slate-200 dark:border-slate-700">
          {[...byOu.entries()].map(([ou, gs]) => {
            const free = gs.filter((g) => !g.resourceId && !g.privileged && !g.protectedGroup).map((g) => g.dn);
            return (
              <div key={ou} className="border-b border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  <input type="checkbox" disabled={!free.length} checked={free.length > 0 && free.every((d) => sel.has(d))} onChange={(e) => toggle(free, e.target.checked)} />
                  {ouLabel(ou) || ou}
                </label>
                {gs.map((g) => (
                  <label key={g.dn} className={cn("flex items-center gap-2 px-3 py-1.5 pl-8", g.resourceId && "opacity-50")}>
                    <input type="checkbox" disabled={!!g.resourceId} checked={sel.has(g.dn)} onChange={(e) => toggle([g.dn], e.target.checked)} />
                    <span className="font-medium">{g.cn}</span>
                    <span className="text-xs text-slate-500">{t("acc.adg.members", { n: g.members })}</span>
                    {(g.privileged || g.protectedGroup) && <Badge tone="amber">{t("acc.privileged")}</Badge>}
                    {g.resourceId && <Badge tone="slate">{t("acc.adg.inCatalog")}</Badge>}
                    {g.description && <span className="truncate text-xs text-slate-400">{g.description}</span>}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Checkbox checked={opt.approvalManager} onChange={(v) => setOpt({ ...opt, approvalManager: v })} label={t("acc.approvalManager")} />
          <Checkbox checked={opt.approvalOwner} onChange={(v) => setOpt({ ...opt, approvalOwner: v })} label={t("acc.approvalOwner")} />
          <Checkbox checked={opt.adopt} onChange={(v) => setOpt({ ...opt, adopt: v })} label={t("acc.adg.adopt")} hint={t("acc.adg.adoptHint")} />
          <Field label={t("acc.owner")}>
            <Select value={opt.ownerId} onChange={(e) => setOpt({ ...opt, ownerId: e.target.value })}>
              <option value="">—</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-slate-500">{t("acc.adg.hint")}</p>
      </div>
    </Modal>
  );
}
