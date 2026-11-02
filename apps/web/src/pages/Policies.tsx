import { Tabs, useTab } from "@/components/ui/tabs";
import { askConfirm } from "@/components/ui/overlay";
import { TasksCard } from "@/components/tasks";
import { FrameworkOptions } from "@/components/frameworkOptions";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { useT } from "@/lib/i18n";
import { useDecree } from "@/lib/regime";
import { AiSuggestPanel } from "@/components/ai";
import { CommentsCard, CoursesCard, QuizCard, VersionsCard } from "./policy/Dms";
import { linkStateOf, PolicyLinksCard } from "./policy/Links";
import { ImportTab } from "./policy/Import";
import { ALL, DisposalCard, FolderSelect, FolderTree, NONE, RetentionFields, RetentionTab, TemplatesTab } from "./policy/Library";
import { TransferButton } from "@/components/transfer";
import { AudienceEditor, audienceSummary } from "@/components/audience";
import { CompanyCell, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { IdMultiSelect, PositionSelect } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useMe, useModule } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import {
  CLASSIFICATIONS,
  EMPTY_AUDIENCE,
  FRAMEWORKS,
  MANAGEMENT_SYSTEMS,
  type FrameworkId,
  type ManagementSystem,
  folderDescendants,
  POLICY_LABELS,
  POLICY_STATUSES,
  POLICY_TYPES,
  requirementsOf,
  type Classification,
  type PolicyDetail,
  type PolicyInput,
  type PolicyStatus,
  type PolicyType,
  type RetentionMark,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Lock, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

const sectionsOf = (fw: FrameworkId) => [...new Map(requirementsOf(fw).map((r) => [r.section, r.sectionTitle])).entries()];
const statusTone: Record<PolicyStatus, Tone> = { draft: "amber", active: "green", retired: "slate" };

export function PoliciesPage() {
  const t = useT();
  const can = useCan();
  const group = useGroupView();
  const [tab, setTab] = useTab(["docs", "coverage", "templates", "retention", "import"] as const, "docs");
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState(ALL);
  const [showRetired, setShowRetired] = useState(false);
  const list = useQuery({ queryKey: ["policies"], queryFn: api.policies.list });
  const folders = useQuery({ queryKey: ["policies", "folders"], queryFn: api.policies.folders });
  const decree = useDecree();
  const [covFw, setCovFw] = useState<FrameworkId | "">("");
  const [system, setSystem] = useState<ManagementSystem | "">("");
  const cov = useQuery({ queryKey: ["policies", "coverage", covFw], queryFn: () => api.policies.coverage(covFw || undefined), enabled: tab === "coverage" && !group });
  const inFolder = folder === ALL || folder === NONE ? null : folderDescendants(folders.data ?? [], folder);
  const live = (list.data ?? []).filter((p) => showRetired || p.status !== "retired");
  const rows = live
    .filter((p) => (folder === NONE ? !p.folderId : !inFolder || (p.folderId && inFolder.has(p.folderId))))
    .filter((p) => !system || p.system === system)
    .filter((p) => !q || `${p.code ?? ""} ${p.title}`.toLowerCase().includes(q.toLowerCase()));
  const systems = [...new Set((list.data ?? []).map((p) => p.system))];
  const retired = (list.data ?? []).filter((p) => p.status === "retired").length;
  // fulltext v obsahu souborů a textech verzí (server) – se zpožděním po psaní
  const [term, setTerm] = useState("");
  useEffect(() => {
    const tx = setTimeout(() => setTerm(q.trim()), 400);
    return () => clearTimeout(tx);
  }, [q]);
  const found = useQuery({ queryKey: ["policies", "search", term], queryFn: () => api.policies.search(term), enabled: tab === "docs" && term.length >= 3 });
  const gaps = (list.data ?? []).filter((p) => p.gaps.length).length;
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("pol.rizenaDokumentace")}
        subtitle={t("pol.bezpecnostniDokumentace6Vyhl409")}
        actions={
          can("policies:write") && (
            <Link to="/policies/new">
              <Button>
                <Plus size={16} /> {t("pol.dokument")}
              </Button>
            </Link>
          )
        }
      />
      <ErrorBox error={list.error ?? cov.error} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: "docs" as const, label: gaps ? t("pol.tab.docsGaps", { n: gaps }) : t("pol.tab.docs") },
          { key: "coverage" as const, label: t("pol.pokrytiOddiluVyhlasky") },
          { key: "templates" as const, label: t("pol.sablony") },
          { key: "retention" as const, label: t("pol.tab.retention") },
          ...(can("policies:write") ? [{ key: "import" as const, label: t("pol.hromadnyImport") }] : []),
        ]}
      />
      {tab === "import" ? (
        <ImportTab />
      ) : tab === "templates" ? (
        <TemplatesTab />
      ) : tab === "retention" ? (
        <RetentionTab />
      ) : tab === "docs" ? (
        <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        <FolderTree value={folder} onChange={setFolder} counts={{ all: live.length, none: live.filter((p) => !p.folderId).length }} />
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 p-4">
            <Input className="max-w-xs" placeholder={t("pol.hledatVNazvuIObsahu")} value={q} onChange={(e) => setQ(e.target.value)} />
            {systems.length > 1 && (
              <Select className="w-64" value={system} onChange={(e) => setSystem(e.target.value as ManagementSystem | "")} aria-label={t("pol.systemRizeni")}>
                <option value="">{t("pol.vsechnySystemyRizeni")}</option>
                {MANAGEMENT_SYSTEMS.filter((x) => systems.includes(x)).map((x) => (
                  <option key={x} value={x}>
                    {t.lbl(POLICY_LABELS.system[x])}
                  </option>
                ))}
              </Select>
            )}
            {retired > 0 && (
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" className="accent-brand-600" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> {t("pol.zobrazitZrusene")}{retired})
              </label>
            )}
          </div>
          {rows.length === 0 ? (
            <EmptyState>{list.isLoading ? t("common.loading") : t("pol.zatimZadneDokumentyZacneteBezpecnostni")}</EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2">{t("pol.dokument")}</th>
                  <th className="px-3 py-2">{t("pol.druh")}</th>
                  <th className="px-3 py-2">{t("pol.verze")}</th>
                  <th className="px-3 py-2">{t("pol.prezkumDo")}</th>
                  <th className="px-3 py-2">{t("pol.seznameni")}</th>
                  <th className="px-3 py-2">{t("pol.odpovida")}</th>
                  <th className="px-3 py-2">{t("pol.stav")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2.5">
                      <Link to="/policies/$policyId" params={{ policyId: p.id }} className="font-medium hover:text-brand-700">
                        {p.code && <span className="mr-1.5 text-slate-500">{p.code}</span>}
                        {p.title}
                      </Link>
                      {p.locked && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-blue-700" title={t("pol.verzeRezervovanaKUpraveOd", { version: p.locked.version, p: new Date(p.locked.at).toLocaleString("cs-CZ") })}>
                          <Lock size={11} /> {p.locked.userName ?? t("pol.rezervovano")}
                        </span>
                      )}
                      {folder === ALL && p.folderPath && <div className="text-xs text-slate-400">{p.folderPath}</div>}
                      {group && (
                        <div>
                          <CompanyCell id={p.companyId} />
                        </div>
                      )}
                      {p.gaps.length > 0 && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-700" title={p.gaps.join("\n")}>
                          <AlertTriangle size={12} color={STATUS_COLORS.serious} /> {p.gaps[0]}
                          {p.gaps.length > 1 && ` (+${p.gaps.length - 1})`}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{t.lbl(POLICY_LABELS.type[p.docType])}</td>
                    <td className="px-3 py-2.5 tabular-nums">{p.currentVersion ?? <span className="text-slate-400">—</span>}</td>
                    <td className={cn("px-3 py-2.5 whitespace-nowrap", p.reviewOverdue ? "font-medium text-red-700" : "text-slate-600")}>{p.nextReviewDue ? fmtDay(p.nextReviewDue) : "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">{p.currentVersion && p.ack.required ? `${p.ack.done}/${p.ack.required}` : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{p.ownerPositionName ?? <span className="text-amber-700">{t("pol.neurceno")}</span>}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={statusTone[p.status]}>{t.lbl(POLICY_LABELS.status[p.status])}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {term.length >= 3 && (found.data?.length ?? 0) > 0 && (
            <div className="border-t border-slate-200">
              <div className="bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("pol.nalezenoVObsahuDokumentu", { length: found.data!.length })}</div>
              <ul className="divide-y divide-slate-100 text-sm">
                {found.data!.map((h, i) => (
                  <li key={i} className="px-5 py-2">
                    <Link to="/policies/$policyId" params={{ policyId: h.id }} className="font-medium hover:text-brand-700">
                      {h.code && <span className="mr-1.5 text-slate-500">{h.code}</span>}
                      {h.title}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500">
                      {t("pol.verze2", { version: h.version, p: t.lbl(POLICY_LABELS.versionStatus[h.versionStatus]), source: h.source })}
                    </span>
                    <div className="mt-0.5 text-xs text-slate-600">{h.snippet}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        </div>
      ) : group ? (
        <Card className="p-5 text-sm text-slate-600">{t("pol.pokrytiSeVyhodnocujeZaJednu")}</Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader
            title={t("pol.platnaDokumentaceKPozadavkum")}
            subtitle={
              !covFw || covFw === decree
                ? t("pol.6Odst1BezpecnostniDokumentace")
                : t("pol.platneDokumentyNavazaneNaPozadavky")
            }
            action={
              <Select className="w-56" value={covFw || decree} onChange={(e) => setCovFw(e.target.value === decree ? "" : (e.target.value as FrameworkId))} aria-label={t("pol.ramec")}>
                <FrameworkOptions label="short" />
              </Select>
            }
          />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {(cov.data ?? []).map((r) => (
                <tr key={r.section}>
                  <td className="w-20 px-5 py-2 font-medium">{r.section}</td>
                  <td className="px-3 py-2 text-slate-700">{r.title}</td>
                  <td className="px-3 py-2 text-right">
                    {r.documents ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 size={14} color={STATUS_COLORS.good} /> {r.documents}
                      </span>
                    ) : (
                      <span className="text-slate-400">{t("pol.bezDokumentu")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

export function PolicyNewPage() {
  return <PolicyEditor p={null} />;
}

export function PolicyDetailPage() {
  const { policyId } = useParams({ strict: false }) as { policyId: string };
  // během úpravy ve Wordu / Excelu obnovovat stav (uložení z Office se projeví jako nová revize)
  const q = useQuery({
    queryKey: ["policies", "detail", policyId],
    queryFn: () => api.policies.get(policyId),
    refetchInterval: (query) => (query.state.data?.versions.some((v) => v.office?.open) ? 10_000 : false),
  });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <PolicyEditor key={q.data.id + q.data.updatedAt} p={q.data} />;
}

function PolicyEditor({ p }: { p: PolicyDetail | null }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = p ? p.canEdit : can("policies:write");
  const decree = useDecree(p?.companyId);
  const [f, setF] = useState({
    code: p?.code ?? "",
    title: p?.title ?? "",
    folderId: p?.folderId ?? null,
    retentionYears: p?.retentionYears ?? null,
    retentionMark: p?.retentionMark ?? (null as RetentionMark | null),
    docType: p?.docType ?? ("directive" as PolicyType),
    system: p?.system ?? ("isms" as ManagementSystem),
    status: p?.status ?? ("draft" as PolicyStatus),
    description: p?.description ?? "",
    sections: p?.sections ?? [],
    ownerPositionId: p?.ownerPositionId ?? null,
    reviewerPositionId: p?.reviewerPositionId ?? null,
    approverPositionId: p?.approverPositionId ?? null,
    ackDueDays: p?.ackDueDays ?? 14,
    retrainOnNewVersion: p?.retrainOnNewVersion ?? false,
    quizPassPct: p?.quizPassPct ?? 80,
    reviewMonths: p?.reviewMonths ?? 12,
    classification: p?.classification ?? ("internal" as Classification),
    location: p?.location ?? "",
    audience: p?.audience ?? EMPTY_AUDIENCE,
    requireAcknowledgement: p?.requireAcknowledgement ?? true,
    controlIds: p?.controls.map((c) => c.id) ?? [],
    ...linkStateOf(p),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const controls = useQuery({ queryKey: ["controls", "all"], queryFn: () => api.controls.list({ withGroup: "1" }), enabled: mod("controls") && can("controls:read") });
  const [version, setVersion] = useState<"new" | string | null>(null);
  const [review, setReview] = useState(false);
  const done = (d: PolicyDetail) => {
    qc.invalidateQueries({ queryKey: ["policies"] });
    qc.setQueryData(["policies", "detail", d.id], d);
    if (!p) nav({ to: "/policies/$policyId", params: { policyId: d.id } });
  };
  const body = (): PolicyInput => {
    const { assets, ...rest } = f;
    return { ...rest, assetIds: assets.map((a) => a.id), code: f.code || null, description: f.description || null, location: f.location || null };
  };
  const save = useMutation({ mutationFn: () => (p ? api.policies.update(p.id, body()) : api.policies.create(body())), onSuccess: done });
  const del = useMutation({
    mutationFn: () => api.policies.remove(p!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["policies"] });
      nav({ to: "/policies" });
    },
  });
  return (
    <>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/policies" className="hover:text-brand-700">
          {t("pol.spravaDokumentace")}
        </Link>
      </div>
      <PageHeader
        title={p ? `${p.code ? `${p.code} ` : ""}${p.title}` : t("pol.novyDokument")}
        subtitle={p ? `${t.lbl(POLICY_LABELS.type[p.docType])} · ${t.lbl(POLICY_LABELS.status[p.status])}${p.currentVersion ? (" " + t("pol.platnaVerze", { currentVersion: p.currentVersion })) : ""}` : t("pol.bezpecnostniPolitikaNeboDokumentaceK")}
        actions={
          <>
            {p && edit && <TransferButton entity="policies" id={p.id} companyId={p.companyId} />}
            {p && edit && (
              <Button variant="danger" onClick={async () => (await askConfirm(t("pol.smazatDokumentJdeJenBez"))) && del.mutate()}>
                <Trash2 size={16} />
              </Button>
            )}
            {edit && (
              <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
                {p ? t("pol.ulozit") : t("common.create")}
              </Button>
            )}
          </>
        }
      />
      {p && p.gaps.length > 0 && (
        <div className="mb-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {p.gaps.map((g) => (
            <div key={g} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" color={STATUS_COLORS.serious} /> {g}
            </div>
          ))}
        </div>
      )}
      {save.isSuccess && <SuccessBox>{t("pol.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("pol.dokument")} />
          <fieldset disabled={!edit} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <Field label={t("pol.oznaceni")}>
                <Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder={p ? "" : "automaticky"} title={t("pol.prazdnePrideliSePodleSlozky")} />
              </Field>
              <Field label={t("pol.nazev")}>
                <Input value={f.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("pol.druh")}>
                <Select value={f.docType} onChange={(e) => set("docType", e.target.value as PolicyType)}>
                  {POLICY_TYPES.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(POLICY_LABELS.type[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pol.stav")}>
                <Select value={f.status} onChange={(e) => set("status", e.target.value as PolicyStatus)}>
                  {POLICY_STATUSES.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(POLICY_LABELS.status[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pol.klasifikace")} hint={t("pol.6Odst5PismD")}>
                <Select value={f.classification} onChange={(e) => set("classification", e.target.value as Classification)}>
                  {CLASSIFICATIONS.map((tx) => (
                    <option key={tx} value={tx}>
                      {t.lbl(POLICY_LABELS.classification[tx])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t("pol.systemRizeniOblast")} hint={t("pol.kontroly6VyhlaskyAPokryti")}>
              <Select value={f.system} onChange={(e) => set("system", e.target.value as ManagementSystem)} disabled={!can("policies:write")}>
                {MANAGEMENT_SYSTEMS.map((x) => (
                  <option key={x} value={x}>
                    {t.lbl(POLICY_LABELS.system[x])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("pol.slozka")}>
              <FolderSelect value={f.folderId} onChange={(v) => set("folderId", v)} companyId={p?.companyId} disabled={!can("policies:write")} />
            </Field>
            <Field label={t("pol.popisAUcel")}>
              <Textarea rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("pol.schvalovaciWorkflowFunkcniMista")}</p>
              <fieldset disabled={!can("policies:write")} className="grid gap-3 sm:grid-cols-3">
                <Field label={t("pol.gestor")} hint={t("pol.pripravujeVerzeOdpovidaZaPrezkum")}>
                  <PositionSelect value={f.ownerPositionId} onChange={(v) => set("ownerPositionId", v)} />
                </Field>
                <Field label={t("pol.vlastnikProcesu")} hint={t("pol.vecnaKontrolaPrazdneKrokSe")}>
                  <PositionSelect value={f.reviewerPositionId} onChange={(v) => set("reviewerPositionId", v)} emptyLabel={t("pol.bezVecneKontroly")} />
                </Field>
                <Field label={t("pol.schvalovatel")} hint={t("pol.prazdneSchvalovatDokumentyIsms")}>
                  <PositionSelect value={f.approverPositionId} onChange={(v) => set("approverPositionId", v)} emptyLabel={t("pol.opravneniSpravce")} />
                </Field>
              </fieldset>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("pol.prezkumMesice")} hint={t("pol.6Odst3")}>
                <Input type="number" min={1} max={60} value={f.reviewMonths} onChange={(e) => set("reviewMonths", Number(e.target.value) || 12)} />
              </Field>
              <Field label={t("pol.lhutaNaSeznameniDny")} hint={t("pol.odSchvaleniNoveVerze")}>
                <Input type="number" min={1} max={180} value={f.ackDueDays} onChange={(e) => set("ackDueDays", Number(e.target.value) || 14)} />
              </Field>
              <Field label={t("pol.testHraniceUspesnosti")}>
                <Input type="number" min={1} max={100} value={f.quizPassPct} onChange={(e) => set("quizPassPct", Number(e.target.value) || 80)} />
              </Field>
            </div>
            <Field label={t("pol.umisteniDostupnost")} hint={t("pol.6Odst5PismA")}>
              <Input value={f.location} onChange={(e) => set("location", e.target.value)} />
            </Field>
            <fieldset disabled={!can("policies:write")}>
              <RetentionFields docType={f.docType} years={f.retentionYears} mark={f.retentionMark} onChange={(v) => setF((x) => ({ ...x, ...v }))} />
            </fieldset>
            {p && (
              <div className="text-xs text-slate-500">
                {t("pol.posledniPrezkum")} {p.lastReviewedAt ? fmtDay(p.lastReviewedAt) : "—"}
                {p.lastReviewNote ? ` (${p.lastReviewNote})` : ""} {t("pol.dalsiDo")} {p.nextReviewDue ? fmtDay(p.nextReviewDue) : "—"}
              </div>
            )}
          </fieldset>
        </Card>
        <Card>
          <CardHeader title={t("pol.dotceneOsobyASeznameni")} subtitle={t("pol.6Odst5PismB")} />
          <fieldset disabled={!edit} className="space-y-4 p-5">
            <AudienceEditor value={f.audience} onChange={(v) => set("audience", v)} disabled={!edit} />
            <Checkbox checked={f.requireAcknowledgement} onChange={(v) => set("requireAcknowledgement", v)} label={t("pol.vyzadovatProkazatelneSeznameniSKazdou")} />
            <Checkbox
              checked={f.retrainOnNewVersion}
              onChange={(v) => set("retrainOnNewVersion", v)}
              label={t("pol.novaVerzeVyzadujeOpakovaniNavazanych")}
              hint={t("pol.absolvovaniKurzuNavazanychNaDokument")}
            />
          </fieldset>
          {p && p.currentVersion && f.requireAcknowledgement && (
            <div className="border-t border-slate-100 px-5 py-4">
              <div className="mb-2 text-sm font-medium text-slate-700">
                {t("pol.seznamenoSVerziZ", { currentVersion: p.currentVersion, done: p.ack.done, required: p.ack.required })}
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {p.people.map((x) => (
                  <div key={x.userId} className="flex justify-between gap-3">
                    <span>{x.name}</span>
                    {x.acknowledgedAt ? <span className="text-xs text-emerald-700">{fmtDay(x.acknowledgedAt)}</span> : <span className="text-xs text-amber-700">{t("pol.ceka")}</span>}
                  </div>
                ))}
                {p.people.length === 0 && <span className="text-slate-400">{t("pol.okruhJePrazdny", { p: audienceSummary(p.audience) })}</span>}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title={f.system === "isms" ? (decree === "cz409" || decree === "cz410" ? t("pol.oddilyVyhlaskyAOpatreni", { p: decree === "cz410" ? "410" : "409" }) : t("pol.oddilyRamce", { p: FRAMEWORKS.find((x) => x.id === decree)?.shortName ?? decree })) : t("pol.opatreni")}
          subtitle={f.system === "isms" ? t("pol.keKterymBezpecnostnimOpatrenimDokument") : t("pol.opatreniKteraDokumentPopisujeNebo")}
        />
        <fieldset disabled={!edit} className="space-y-4 p-5">
          {f.system === "isms" && (
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {sectionsOf(decree).map(([s, title]) => (
                <Checkbox key={s} checked={f.sections.includes(s)} onChange={(v) => set("sections", v ? [...f.sections, s] : f.sections.filter((x) => x !== s))} label={`${s} ${title}`} />
              ))}
            </div>
          )}
          {mod("controls") && can("controls:read") && (
            <Field label={t("pol.opatreni")}>
              <IdMultiSelect
                linkKind="control"
                value={f.controlIds}
                onChange={(v) => set("controlIds", v)}
                disabled={!edit}
                options={(controls.data ?? []).map((c) => ({ id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.name}` }))}
                known={(p?.controls ?? []).map((c) => ({ id: c.id, label: `${c.code ? `${c.code} ` : ""}${c.name}` }))}
              />
            </Field>
          )}
        </fieldset>
      </Card>

      <PolicyLinksCard p={p} value={f} onChange={(v) => setF((x) => ({ ...x, ...v }))} disabled={!edit} />

      {p && (
        <div className="mt-6 empty:hidden">
          <AiSuggestPanel useCase="policy_review" entityId={p.id} canApply />
        </div>
      )}

      {p && <VersionsCard p={p} onDone={done} onOpen={setVersion} onReview={() => setReview(true)} />}
      {p && <DisposalCard p={p} onDone={done} />}
      {p && <CommentsCard p={p} onDone={done} />}
      {p && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <QuizCard p={p} onDone={done} />
          <CoursesCard p={p} />
        </div>
      )}
      {p && version && <VersionModal policy={p} versionId={version === "new" ? null : version} edit={edit} onClose={() => setVersion(null)} onDone={done} />}
      {p && review && <ReviewModal policy={p} onClose={() => setReview(false)} onDone={done} />}
      {p && <TasksCard kind="policy" id={p.id} className="mt-6" />}
    </>
  );
}

function VersionModal({ policy, versionId, edit, onClose, onDone }: { policy: PolicyDetail; versionId: string | null; edit: boolean; onClose: () => void; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const v = policy.versions.find((x) => x.id === versionId);
  const content = useQuery({ queryKey: ["policies", "content", versionId], queryFn: () => api.policies.content(policy.id, versionId!), enabled: !!versionId });
  const draft = !v || v.status === "draft";
  const nextVersion = () => {
    const cur = policy.currentVersion ?? "0.0";
    const [a, b] = cur.split(".").map((x) => Number(x) || 0);
    return policy.currentVersion ? `${a}.${(b ?? 0) + 1}` : "1.0";
  };
  const [f, setF] = useState({ version: v?.version ?? nextVersion(), changeSummary: v?.changeSummary ?? "", content: "", effectiveFrom: v?.effectiveFrom ?? "" });
  const [loaded, setLoaded] = useState(!versionId);
  if (!loaded && content.data) {
    setF((x) => ({ ...x, content: content.data!.content ?? "" }));
    setLoaded(true);
  }
  const save = useMutation({
    mutationFn: () => {
      const body = { version: f.version, changeSummary: f.changeSummary || null, content: f.content || null, effectiveFrom: f.effectiveFrom || null };
      return v ? api.policies.updateVersion(policy.id, v.id, body) : api.policies.addVersion(policy.id, body);
    },
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const ro = !edit || !draft;
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={v ? `Verze ${v.version}` : t("pol.novaVerze")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {!ro && (
            <Button disabled={save.isPending || !f.version.trim()} onClick={() => save.mutate()}>
              {t("pol.ulozitNavrh")}
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={ro} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr_10rem]">
          <Field label={t("pol.verze")}>
            <Input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} />
          </Field>
          <Field label={t("pol.shrnutiZmen")}>
            <Input value={f.changeSummary} onChange={(e) => setF({ ...f, changeSummary: e.target.value })} />
          </Field>
          <Field label={t("pol.ucinnostOd")}>
            <Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
          </Field>
        </div>
        <Field label={t("pol.textDokumentuMarkdownVolitelne")} hint={t("pol.pokudJeDokumentVedenJinde")}>
          <Textarea rows={16} className="font-mono text-xs" value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
        </Field>
      </fieldset>
      <ErrorBox error={save.error ?? content.error} />
    </Modal>
  );
}

function ReviewModal({ policy, onClose, onDone }: { policy: PolicyDetail; onClose: () => void; onDone: (d: PolicyDetail) => void }) {
  const t = useT();
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => api.policies.review(policy.id, note || null),
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("pol.prezkumDokumentu")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancelAction")}
          </Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>
            {t("pol.potvrditPrezkum")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{t("pol.dokumentBylPrezkoumanAJe", { reviewMonths: policy.reviewMonths })}</p>
      <Field label={t("pol.poznamka")}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("pol.naprOverenoProtiZmenam2026")} />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}
