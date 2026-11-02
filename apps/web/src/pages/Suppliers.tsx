import { useUrlBatch, useUrlSort } from "@/lib/urlState";
import { SavedViews, SortTh } from "@/components/listTools";
import { useFormGuard } from "@/lib/unsaved";
import { useDebounced } from "@/lib/utils";
import { useUrlFlag, useUrlParam } from "@/lib/urlState";
import { askConfirm } from "@/components/ui/overlay";
import { LinkedRecordsCard } from "@/components/linkedRecords";
import { FrameworkBadge } from "@/components/frameworkBadge";
import { TasksCard } from "@/components/tasks";
import { useCzDecree } from "@/lib/regime";
import { QuestionnairesCard } from "@/components/supplierQuestionnaires";
import { SupplierReportsCard } from "@/components/supplierReports";
import { AresLookup } from "@/components/ares";
import { useT } from "@/lib/i18n";
import { LinkedDocsCard } from "@/components/linkedDocs";
import { DoraProviderCard } from "./Dora";
import { TransferButton } from "@/components/transfer";
import { CompanyCell, useGroupView } from "@/components/company";
import { STATUS_COLORS } from "@/components/health";
import { RiskLevelBadge } from "@/components/risk";
import { AssetPicker, IdMultiSelect, type PickedAsset } from "@/components/pickers";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SuccessBox, Textarea, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useCan, useModule } from "@/lib/auth";
import { cn, fmtDay } from "@/lib/utils";
import {
  CLAUSE_LABELS,
  CLAUSE_SETS,
  CLAUSE_STATES,
  missingClauses,
  type ClauseSet,
  type ClauseState,
  type ContractDto,
  type ContractInput,
  type RiskLevel,
  type SupplierDetail,
  type SupplierInput,
  sortRows,
} from "@contix/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AlertTriangle, FileSignature, Mail, Plus, Trash2, Landmark } from "lucide-react";
import { useState } from "react";

const clauseTone: Record<ClauseState, Tone> = { included: "green", partial: "amber", missing: "red", not_relevant: "slate" };

export function SuppliersPage() {
  const t = useT();
  const group = useGroupView();
  const can = useCan();
  const [q, setQ] = useUrlParam("q");
  const [onlySig, setOnlySig] = useUrlFlag("significant");
  const dq = useDebounced(q);
  const [sort, setSort] = useUrlSort<"name" | "significant" | "contracts" | "links" | "review" | "gaps">();
  const batch = useUrlBatch();
  const list = useQuery({ queryKey: ["suppliers", dq, onlySig], queryFn: () => api.suppliers.list({ q: dq || undefined, significant: onlySig ? "true" : undefined }) });
  const rows = sort
    ? sortRows(list.data ?? [], (s) => (sort.key === "name" ? s.name : sort.key === "significant" ? (s.significant ? 1 : 0) : sort.key === "contracts" ? s.contractCount : sort.key === "links" ? s.riskCount + s.assetCount : sort.key === "review" ? (s.lastReviewAt ?? "") : s.gaps.length), sort.dir)
    : (list.data ?? []);
  const withGaps = rows.filter((s) => s.gaps.length).length;
  return (
    <>
      <PageHeader badge={<FrameworkBadge />}
        title={t("sup.dodavatele")}
        subtitle={t("sup.9VyhlC4092025")}
        actions={
          <div className="flex gap-2">
            <Link to="/suppliers/dora">
              <Button variant="secondary">
                <Landmark size={16} /> {t("dora.title")}
              </Button>
            </Link>
            {can("suppliers:write") && (
              <Link to="/suppliers/new">
                <Button>
                  <Plus size={16} /> {t("sup.novyDodavatel")}
                </Button>
              </Link>
            )}
          </div>
        }
      />
      <ErrorBox error={list.error} />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <Input className="max-w-xs" placeholder={t("sup.hledatNazevNeboIco")} value={q} onChange={(e) => setQ(e.target.value)} />
          <Checkbox checked={onlySig} onChange={setOnlySig} label={t("sup.jenVyznamniDodavatele")} />
          <div className="ml-auto">
            <SavedViews
              page="suppliers"
              state={{ q, significant: onlySig ? "1" : "", sort: sort ? `${sort.key}:${sort.dir}` : "" }}
              onApply={(v) => batch({ q: String(v.q ?? ""), significant: String(v.significant ?? ""), sort: String(v.sort ?? "") })}
              onReset={() => batch({ q: "", significant: "", sort: "" })}
            />
          </div>
          {withGaps > 0 && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-sm text-amber-900">
              <AlertTriangle size={15} color={STATUS_COLORS.serious} /> {withGaps} {t("sup.sNesplnenymiPovinnostmi9")}
            </span>
          )}
        </div>
      </Card>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState>{t("sup.zadniDodavatele")}</EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <SortTh k="name" label={t("sup.dodavatel")} sort={sort} onSort={setSort} className="pl-5" />
                <SortTh k="significant" label={t("sup.vyznam")} sort={sort} onSort={setSort} firstDir="desc" />
                <SortTh k="contracts" label={t("sup.smlouvy")} sort={sort} onSort={setSort} firstDir="desc" />
                <SortTh k="links" label={t("sup.rizikaAktiva")} sort={sort} onSort={setSort} firstDir="desc" />
                <th className="px-3 py-2">{t("sup.informovan")}</th>
                <SortTh k="review" label={t("sup.prezkum")} sort={sort} onSort={setSort} />
                <SortTh k="gaps" label={t("sup.mezery9")} sort={sort} onSort={setSort} firstDir="desc" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s) => (
                <tr key={s.id} className={cn("hover:bg-slate-50", s.status === "ended" && "text-slate-400")}>
                  <td className="px-5 py-2.5">
                    <Link to="/suppliers/$supplierId" params={{ supplierId: s.id }} className="font-medium hover:text-brand-700">
                      {s.name}
                    </Link>
                    {group && <div><CompanyCell id={s.companyId} /></div>}
                    <div className="text-xs text-slate-500">
                      {s.ico ? t("sup.ico", { ico: s.ico }) : t("sup.bezIco")}
                      {s.country && ` · ${s.country}`}
                      {s.status === "ended" && t("sup.ukoncen")}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {s.significant ? <Badge tone="violet">{t("sup.vyznamny")}</Badge> : <span className="text-xs text-slate-400">—</span>}
                    {s.dataOutsideCz && (
                      <div className="mt-0.5">
                        <Badge tone="amber">{t("sup.mimoCr")}</Badge>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {s.contractCount}
                    {s.missingClauses > 0 && <span className="ml-1 text-xs text-red-700">{t("sup.chybi", { missingClauses: s.missingClauses })}</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">
                    {s.riskCount} / {s.assetCount}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{s.notifiedAt ? fmtDay(s.notifiedAt) : "—"}</td>
                  <td className={cn("px-3 py-2.5 whitespace-nowrap", s.reviewDue ? "font-medium text-red-700" : "text-slate-600")}>
                    {s.lastReviewAt ? fmtDay(s.lastReviewAt) : "—"}
                    {s.reviewDue && " ⚠"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {s.gaps.length ? (
                      <span className="inline-flex items-center gap-1 text-amber-800" title={s.gaps.join("\n")}>
                        <AlertTriangle size={13} color={STATUS_COLORS.serious} /> {s.gaps.length}
                      </span>
                    ) : s.significant ? (
                      <span className="text-emerald-700">{t("sup.vPoradku")}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

export function SupplierDetailPage() {
  const { supplierId } = useParams({ strict: false }) as { supplierId: string };
  const q = useQuery({ queryKey: ["suppliers", "detail", supplierId], queryFn: () => api.suppliers.get(supplierId) });
  if (!q.data) return <ErrorBox error={q.error} />;
  return <SupplierEditor key={q.data.id} s={q.data} />;
}

export const SupplierNewPage = () => <SupplierEditor s={null} />;

type Form = Required<Omit<SupplierInput, "assetIds" | "status" | "companyId">> & { status: "active" | "ended"; assets: PickedAsset[] };

function SupplierEditor({ s }: { s: SupplierDetail | null }) {
  const t = useT();
  const can = useCan();
  const mod = useModule();
  const qc = useQueryClient();
  const nav = useNavigate();
  const edit = s ? s.canEdit : can("suppliers:write");
  const [f, setF] = useState<Form>({
    name: s?.name ?? "",
    ico: s?.ico ?? "",
    address: s?.address ?? "",
    country: s?.country ?? t("sup.ceskaRepublika"),
    contactName: s?.contactName ?? "",
    contactEmail: s?.contactEmail ?? "",
    contactPhone: s?.contactPhone ?? "",
    supplyDescription: s?.supplyDescription ?? "",
    significant: s?.significant ?? false,
    significanceReason: s?.significanceReason ?? "",
    dataOutsideCz: s?.dataOutsideCz ?? false,
    rulesAcknowledgedAt: s?.rulesAcknowledgedAt ?? "",
    notifiedAt: s?.notifiedAt ?? "",
    notificationRef: s?.notificationRef ?? "",
    riskAssessedAt: s?.riskAssessedAt ?? "",
    lastReviewAt: s?.lastReviewAt ?? "",
    reviewIntervalMonths: s?.reviewIntervalMonths ?? 12,
    status: s?.status ?? "active",
    notes: s?.notes ?? "",
    processIds: s?.processes.map((p) => p.id) ?? [],
    riskIds: s?.risks.map((r) => r.id) ?? [],
    assets: s?.assets ?? [],
  });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const processes = useQuery({ queryKey: ["processes", "", ""], queryFn: () => api.processes.list({}), enabled: mod("processes") && can("processes:read") });
  const risks = useQuery({ queryKey: ["risks", "list", "all"], queryFn: () => api.risks.list({ limit: 500 }), enabled: mod("risks") && can("risks:read") });
  const [contract, setContract] = useState<ContractDto | "new" | null>(null);

  const nz = (v: string | null | undefined) => (v ? v : null);
  const body = (): SupplierInput => {
    const { assets, ...rest } = f;
    return {
      ...rest,
      ico: f.ico || null,
      address: nz(f.address),
      country: nz(f.country),
      contactName: nz(f.contactName),
      contactEmail: nz(f.contactEmail),
      contactPhone: nz(f.contactPhone),
      supplyDescription: nz(f.supplyDescription),
      significanceReason: nz(f.significanceReason),
      rulesAcknowledgedAt: nz(f.rulesAcknowledgedAt),
      notifiedAt: nz(f.notifiedAt),
      notificationRef: nz(f.notificationRef),
      riskAssessedAt: nz(f.riskAssessedAt),
      lastReviewAt: nz(f.lastReviewAt),
      notes: nz(f.notes),
      assetIds: assets.map((a) => a.id),
    };
  };
  const done = (d: SupplierDetail) => {
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.setQueryData(["suppliers", "detail", d.id], d);
    if (!s) nav({ to: "/suppliers/$supplierId", params: { supplierId: d.id } });
  };
  const save = useMutation({ mutationFn: () => (s ? api.suppliers.update(s.id, body()) : api.suppliers.create(body())), onSuccess: done });
  const guard = useFormGuard(save);
  const del = useMutation({
    mutationFn: () => api.suppliers.remove(s!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["suppliers"] });
      nav({ to: "/suppliers" });
    },
  });
  const delContract = useMutation({
    mutationFn: (id: string) => api.suppliers.deleteContract(s!.id, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suppliers"] }),
  });

  return (
    <div {...guard.bind}>
      <div className="mb-1 text-sm text-slate-500">
        <Link to="/suppliers" className="hover:text-brand-700">
          {t("sup.dodavatele")}
        </Link>
      </div>
      <PageHeader
        title={s ? s.name : t("sup.novyDodavatel")}
        subtitle={s ? `${s.significant ? t("sup.vyznamnyDodavatel") : "Dodavatel"}${s.ico ? (" " + t("sup.ico2", { ico: s.ico })) : ""}` : t("sup.vyznamnyDodavatel2PismH")}
        actions={
          <>
            {s?.significant && (
              <a href={api.suppliers.notificationUrl(s.id)} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <Mail size={16} /> {t("sup.oznameniDle9Odst3")}
                </Button>
              </a>
            )}
            {s && can("suppliers:write") && <TransferButton entity="suppliers" id={s.id} companyId={s.companyId} />}
            {s && can("suppliers:write") && (
              <Button variant="danger" aria-label={t("common.delete")} title={t("common.delete")} onClick={async () => (await askConfirm(t("sup.smazatDodavateleVcetneSmluv"))) && del.mutate()}>
                <Trash2 size={16} />
              </Button>
            )}
            {edit && (
              <Button disabled={save.isPending || !f.name.trim()} onClick={() => save.mutate()}>
                {s ? t("sup.ulozit") : t("common.create")}
              </Button>
            )}
          </>
        }
      />
      {s && s.gaps.length > 0 && (
        <div className="mb-4 space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {s.gaps.map((g) => (
            <div key={g} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" color={STATUS_COLORS.serious} /> {g}
            </div>
          ))}
        </div>
      )}
      {save.isSuccess && <SuccessBox>{t("sup.ulozeno")}</SuccessBox>}
      <ErrorBox error={save.error ?? del.error ?? delContract.error} />

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("sup.identifikaceAKontakt")} />
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <Field label={t("sup.nazev")}>
                <Input value={f.name} disabled={!edit} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label={t("sup.ico3")}>
                <Input value={f.ico ?? ""} disabled={!edit} maxLength={8} inputMode="numeric" onChange={(e) => set("ico", e.target.value.replace(/\D/g, ""))} />
              </Field>
            </div>
            {edit && (
              <AresLookup
                initial={f.ico || f.name}
                onPick={(a) => setF((x) => ({ ...x, name: a.name, ico: a.ico, address: a.address ?? x.address, country: a.country ?? x.country }))}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
              <Field label={t("sup.sidlo")}>
                <Input value={f.address ?? ""} disabled={!edit} onChange={(e) => set("address", e.target.value)} />
              </Field>
              <Field label={t("sup.stat")}>
                <Input value={f.country ?? ""} disabled={!edit} onChange={(e) => set("country", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("sup.kontaktniOsoba")}>
                <Input value={f.contactName ?? ""} disabled={!edit} onChange={(e) => set("contactName", e.target.value)} />
              </Field>
              <Field label={t("sup.eMail")}>
                <Input type="email" value={f.contactEmail ?? ""} disabled={!edit} onChange={(e) => set("contactEmail", e.target.value)} />
              </Field>
              <Field label={t("sup.telefon")}>
                <Input value={f.contactPhone ?? ""} disabled={!edit} onChange={(e) => set("contactPhone", e.target.value)} />
              </Field>
            </div>
            <Field label={t("sup.predmetPlneni")}>
              <Textarea rows={2} value={f.supplyDescription ?? ""} disabled={!edit} onChange={(e) => set("supplyDescription", e.target.value)} />
            </Field>
            <Field label={t("sup.stav")}>
              <Select value={f.status} disabled={!edit} onChange={(e) => set("status", e.target.value as Form["status"])}>
                <option value="active">{t("sup.aktivni")}</option>
                <option value="ended">{t("sup.spolupraceUkoncena")}</option>
              </Select>
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("sup.povinnostiDle9")} subtitle={t("sup.datumDolozeniJednotlivychKrokuZaznam")} />
          <div className="space-y-4 p-5">
            <Checkbox
              checked={f.significant}
              disabled={!edit}
              onChange={(v) => set("significant", v)}
              label={t("sup.vyznamnyDodavatel")}
              hint={t("sup.dodavatelKterySePodiliNa")}
            />
            {f.significant && (
              <Field label={t("sup.oduvodneniVyznamnosti")}>
                <Textarea rows={2} value={f.significanceReason ?? ""} disabled={!edit} onChange={(e) => set("significanceReason", e.target.value)} />
              </Field>
            )}
            <Checkbox
              checked={f.dataOutsideCz}
              disabled={!edit}
              onChange={(v) => set("dataOutsideCz", v)}
              label={t("sup.zpracovavaDataNeboProvozujeAktiva")}
              hint={t("sup.zohledneteVHodnoceniRizikHrozby")}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("sup.hodnoceniRizikPredUzavrenimSmlouvy")} hint={t("sup.9Odst2PismA")}>
                <Input type="date" value={f.riskAssessedAt ?? ""} disabled={!edit} onChange={(e) => set("riskAssessedAt", e.target.value)} />
              </Field>
              <Field label={t("sup.seznameniSPravidlyProDodavatele")} hint={t("sup.9Odst1PismB")}>
                <Input type="date" value={f.rulesAcknowledgedAt ?? ""} disabled={!edit} onChange={(e) => set("rulesAcknowledgedAt", e.target.value)} />
              </Field>
              <Field label={t("sup.informovaniOEvidenci")} hint={t("sup.9Odst1PismE")}>
                <Input type="date" value={f.notifiedAt ?? ""} disabled={!edit} onChange={(e) => set("notifiedAt", e.target.value)} />
              </Field>
              <Field label={t("sup.cJDokladODoruceni")}>
                <Input value={f.notificationRef ?? ""} disabled={!edit} onChange={(e) => set("notificationRef", e.target.value)} />
              </Field>
              <Field label={t("sup.posledniPrezkumPlneni")} hint={t("sup.9Odst1PismG")}>
                <Input type="date" value={f.lastReviewAt ?? ""} disabled={!edit} onChange={(e) => set("lastReviewAt", e.target.value)} />
              </Field>
              <Field label={t("sup.intervalPrezkumuMes")}>
                <Input type="number" min={1} max={36} value={f.reviewIntervalMonths} disabled={!edit} onChange={(e) => set("reviewIntervalMonths", Number(e.target.value) || 12)} />
              </Field>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title={t("sup.vazby")} subtitle={t("sup.aktivaAProcesyNaKterych")} />
        <div className="grid gap-6 p-5 lg:grid-cols-3">
          <div>
            <div className="mb-2 text-sm font-medium text-slate-700">{t("sup.aktiva")}</div>
            <AssetPicker value={f.assets} onChange={(v) => set("assets", v)} disabled={!edit} />
          </div>
          {mod("processes") && can("processes:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("sup.procesy")}</div>
              <IdMultiSelect
                linkKind="process"
                value={f.processIds}
                onChange={(v) => set("processIds", v)}
                disabled={!edit}
                placeholder={t("sup.pridatProces")}
                emptyLabel={t("sup.zadneProcesy")}
                options={(processes.data ?? []).map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
                known={(s?.processes ?? []).map((p) => ({ id: p.id, label: `${p.code ? `${p.code} ` : ""}${p.name}` }))}
              />
            </div>
          )}
          {mod("risks") && can("risks:read") && (
            <div>
              <div className="mb-2 text-sm font-medium text-slate-700">{t("sup.rizika")}</div>
              <IdMultiSelect
                linkKind="risk"
                value={f.riskIds}
                onChange={(v) => set("riskIds", v)}
                disabled={!edit}
                placeholder={t("sup.pridatRiziko")}
                emptyLabel={t("sup.zadnaRizika")}
                options={(risks.data?.items ?? []).map((r) => ({ id: r.id, label: `${r.code ? `${r.code} ` : ""}${r.name}` }))}
                known={(s?.risks ?? []).map((r) => ({ id: r.id, label: `${r.code ? `${r.code} ` : ""}${r.name}` }))}
              />
              {s && s.risks.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.risks.map((r) => (
                    <Link key={r.id} to="/risks/$riskId" params={{ riskId: r.id }} className="inline-flex items-center gap-1 text-xs hover:underline">
                      {r.code ?? r.name} <RiskLevelBadge level={r.level as RiskLevel | null} score={null} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {s && (
        <Card className="mt-6 overflow-hidden">
          <CardHeader
            title={t("sup.smlouvy")}
            subtitle={t("sup.kontrolaObsahuSmlouvyProtiRelevantnim")}
            action={
              edit && (
                <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setContract("new")}>
                  <FileSignature size={14} /> {t("sup.pridatSmlouvu")}
                </Button>
              )
            }
          />
          {s.contracts.length === 0 ? (
            <EmptyState>{t("sup.zadnaSmlouva")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {s.contracts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <button className="font-medium hover:text-brand-700" onClick={() => setContract(c)}>
                      {c.title}
                      {c.number && <span className="ml-1.5 text-slate-500">({c.number})</span>}
                    </button>
                    <div className="text-xs text-slate-500">
                      {c.validFrom ? fmtDay(c.validFrom) : "?"} – {c.validTo ? fmtDay(c.validTo) : t("sup.neurcito")} · {c.clauseSet === "cz410" ? t("sup.prilohaC2Vyhl410") : t("sup.prilohaC5Vyhl409")}
                      {c.expired && <span className="ml-1 text-slate-400">{t("sup.vyprsela")}</span>}
                    </div>
                  </div>
                  <ClauseSummary set={c.clauseSet} clauses={c.clauses} />
                  {edit && (
                    <Button variant="ghost" className="px-1.5 py-1 text-red-700" onClick={async () => (await askConfirm(t("sup.smazatSmlouvu"))) && delContract.mutate(c.id)} aria-label={t("sup.smazatSmlouvu2")}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {s && <QuestionnairesCard supplier={s} edit={edit} />}
      {s && <SupplierReportsCard supplierId={s.id} edit={can("suppliers:write")} />}
      {s && <DoraProviderCard supplierId={s.id} name={s.name} dora={s.dora ?? {}} edit={edit} />}
      {s && <LinkedRecordsCard target="supplier" id={s.id} className="mt-6" />}
      {s && <TasksCard kind="supplier" id={s.id} className="mt-6" />}
      {s && <LinkedDocsCard kind="supplier" id={s.id} className="mt-6" />}
      {s && contract && <ContractModal supplier={s} contract={contract === "new" ? null : contract} edit={edit} onClose={() => setContract(null)} onDone={done} />}
    </div>
  );
}

function ClauseSummary({ set, clauses }: { set: ClauseSet; clauses: Record<string, ClauseState> }) {
  const t = useT();
  const all = CLAUSE_SETS[set];
  const n = (st: ClauseState) => all.filter((c) => clauses[c.key] === st).length;
  const missing = missingClauses(set, clauses);
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Badge tone="green">{t("sup.obsazeno", { p: n("included") })}</Badge>
      {missing > 0 && <Badge tone="red">{t("sup.chybiNeposouzeno", { missing: missing })}</Badge>}
      {n("not_relevant") > 0 && <Badge>{t("sup.nerelevantni", { p: n("not_relevant") })}</Badge>}
    </div>
  );
}

function ContractModal({
  supplier,
  contract,
  edit,
  onClose,
  onDone,
}: {
  supplier: SupplierDetail;
  contract: ContractDto | null;
  edit: boolean;
  onClose: () => void;
  onDone: (d: SupplierDetail) => void;
}) {
  const t = useT();
  const decree = useCzDecree();
  const [f, setF] = useState<Required<ContractInput>>({
    title: contract?.title ?? "",
    number: contract?.number ?? "",
    validFrom: contract?.validFrom ?? "",
    validTo: contract?.validTo ?? "",
    clauseSet: contract?.clauseSet ?? decree,
    clauses: contract?.clauses ?? {},
    sla: contract?.sla ?? "",
    exitStrategy: contract?.exitStrategy ?? "",
    documentUrl: contract?.documentUrl ?? "",
    note: contract?.note ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const nz = (v: string | null | undefined) => (v ? v : null);
      const body: ContractInput = {
        ...f,
        number: nz(f.number),
        validFrom: nz(f.validFrom),
        validTo: nz(f.validTo),
        sla: nz(f.sla),
        exitStrategy: nz(f.exitStrategy),
        documentUrl: nz(f.documentUrl),
        note: nz(f.note),
      };
      return contract ? api.suppliers.updateContract(supplier.id, contract.id, body) : api.suppliers.addContract(supplier.id, body);
    },
    onSuccess: (d) => {
      onDone(d);
      onClose();
    },
  });
  const set_ = f.clauseSet as ClauseSet;
  const clauses = CLAUSE_SETS[set_];
  const allTo = (st: ClauseState) => set("clauses", Object.fromEntries(clauses.map((c) => [c.key, f.clauses[c.key] ?? st])));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={contract ? contract.title : t("sup.novaSmlouva")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          {edit && (
            <Button disabled={save.isPending || !f.title.trim()} onClick={() => save.mutate()}>
              {t("sup.ulozit")}
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label={t("sup.nazevSmlouvy")}>
          <Input value={f.title} disabled={!edit} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label={t("sup.cislo")}>
          <Input value={f.number ?? ""} disabled={!edit} onChange={(e) => set("number", e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("sup.platnostOd")}>
          <Input type="date" value={f.validFrom ?? ""} disabled={!edit} onChange={(e) => set("validFrom", e.target.value)} />
        </Field>
        <Field label={t("sup.platnostDo")}>
          <Input type="date" value={f.validTo ?? ""} disabled={!edit} onChange={(e) => set("validTo", e.target.value)} />
        </Field>
        <Field label={t("sup.pozadavkyDle")}>
          <Select value={f.clauseSet} disabled={!edit} onChange={(e) => set("clauseSet", e.target.value as ClauseSet)}>
            <option value="cz409">{t("sup.prilohaC5Vyhl4092")}</option>
            <option value="cz410">{t("sup.prilohaC2Vyhl4102")}</option>
          </Select>
        </Field>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-medium text-slate-700">{t("sup.ustanoveniSmlouvy")}</div>
          {edit && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => allTo("missing")}>
              {t("sup.neposouzenaOznacitChybi")}
            </Button>
          )}
        </div>
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {clauses.map((c) => {
            const st = f.clauses[c.key];
            return (
              <li key={c.key} className="flex items-start gap-3 px-3 py-2 text-sm">
                <span className="w-5 shrink-0 font-semibold text-slate-500">{c.key})</span>
                <div className="flex-1">
                  <div className="text-slate-800">{c.text}</div>
                  {c.points && (
                    <ul className="mt-0.5 text-xs text-slate-500">
                      {c.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {edit ? (
                  <Select
                    className="w-36 shrink-0 py-1 text-xs"
                    value={st ?? ""}
                    onChange={(e) => {
                      const next = { ...f.clauses };
                      if (e.target.value) next[c.key] = e.target.value as ClauseState;
                      else delete next[c.key];
                      set("clauses", next);
                    }}
                  >
                    <option value="">{t("sup.neposouzeno")}</option>
                    {CLAUSE_STATES.map((x) => (
                      <option key={x} value={x}>
                        {t.lbl(CLAUSE_LABELS[x])}
                      </option>
                    ))}
                  </Select>
                ) : st ? (
                  <Badge tone={clauseTone[st]}>{t.lbl(CLAUSE_LABELS[st])}</Badge>
                ) : (
                  <span className="text-xs text-slate-400">{t("sup.neposouzeno2")}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <Field label={t("sup.slaUrovenSluzeb")}>
        <Textarea rows={2} value={f.sla ?? ""} disabled={!edit} onChange={(e) => set("sla", e.target.value)} />
      </Field>
      <Field label={t("sup.exitStrategie")} hint={t("sup.podminkyUkonceniZPohleduBezpecnosti")}>
        <Textarea rows={2} value={f.exitStrategy ?? ""} disabled={!edit} onChange={(e) => set("exitStrategy", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("sup.odkazNaDokument")} hint={t("sup.spisovaSluzbaDms")}>
          <Input value={f.documentUrl ?? ""} disabled={!edit} onChange={(e) => set("documentUrl", e.target.value)} />
        </Field>
        <Field label={t("sup.poznamka")}>
          <Input value={f.note ?? ""} disabled={!edit} onChange={(e) => set("note", e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={save.error} />
    </Modal>
  );
}
